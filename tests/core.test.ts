import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  lineTotal,
  totals,
  applyRate,
  calibration,
  measure,
  civil,
} from "../src/lib/calculations";
import {
  itemSchema,
  rateSchema,
  projectSchema,
  uploadSchema,
  type Item,
  type Rate,
} from "../src/lib/schemas";
import { parseRates, exportRates } from "../src/lib/rates-csv";
import { analysisSchema, draftItems } from "../src/lib/ai-schema";
const org = randomUUID();
const item = (status: Item["status"] = "draft"): Item => ({
  id: randomUUID(),
  org_id: org,
  project_id: randomUUID(),
  estimate_id: randomUUID(),
  created_at: "",
  updated_at: "",
  version: 1,
  status,
  rate_snapshot: null,
  data: itemSchema.parse({
    description: "Drain",
    category: "Drainage",
    quantity: 3,
    unit: "m",
    rate: 10.005,
  }),
});
const rate = (): Rate => ({
  id: randomUUID(),
  org_id: org,
  project_id: "",
  created_at: "",
  updated_at: "",
  version: 1,
  data: rateSchema.parse({
    code: "TEST",
    description: "Test fixture only",
    category: "Drainage",
    unit: "m",
    rate: 25,
    source: "Fixture quote",
    supplier: "Fixture supplier",
  }),
});
describe("Financial calculations and review", () => {
  it("rounds each line half up without binary floating-point error", () => {
    expect(lineTotal(3, 0.1)).toBe(0.3);
    expect(lineTotal(1, 1.005)).toBe(1.01);
  });
  it("excludes draft and rejected items", () => {
    expect(totals([item(), item("rejected"), item("approved")]).direct).toBe(
      30.02,
    );
  });
  it("calculates original overhead/contingency/markup policy and distinct margin", () => {
    const i = item("approved");
    i.data.quantity = 10;
    i.data.rate = 10;
    const t = totals([i], 10, 5, 10);
    expect(t).toMatchObject({
      direct: 100,
      overhead: 10,
      contingency: 5,
      profit: 11.5,
      total: 126.5,
    });
    expect(t.margin).toBeCloseTo(9.090909);
  });
  it("handles zero and empty estimates", () =>
    expect(totals([])).toMatchObject({ total: 0, margin: 0 }));
  it.each([-1, Infinity, NaN])("rejects invalid money %s", (value) =>
    expect(() => lineTotal(value, 3)).toThrow(),
  );
  it("refuses approved unknown quantities", () => {
    const i = item("approved");
    i.data.quantity = null;
    expect(() => totals([i])).toThrow();
  });
  it("snapshots rates and resets approval without aliasing the library", () => {
    const r = rate();
    const updated = applyRate(item("approved"), r);
    r.data.source = "Changed";
    r.data.rate = 50;
    expect(updated.status).toBe("draft");
    expect(updated.rate_snapshot?.source).toBe("Fixture quote");
    expect(updated.data.rate).toBe(25);
  });
  it("rejects cross-organisation, archived and mismatched-unit rates", () => {
    const r = rate();
    r.org_id = randomUUID();
    expect(() => applyRate(item(), r)).toThrow();
    r.org_id = org;
    r.data.unit = "m3";
    expect(() => applyRate(item(), r)).toThrow();
    r.data.unit = "m";
    r.data.archived = true;
    expect(() => applyRate(item(), r)).toThrow();
  });
});
describe("Document geometry", () => {
  it("calibrates known lengths and polylines", () => {
    const scale = calibration(
      [
        [0, 0],
        [100, 0],
      ],
      10,
    );
    expect(scale).toBe(0.1);
    expect(
      measure(
        [
          [0, 0],
          [30, 40],
          [60, 40],
        ],
        scale,
        "length",
      ).quantity,
    ).toBe(8);
  });
  it("computes polygon area and volume independent of point direction", () => {
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    expect(measure(points, 0.1, "area").quantity).toBe(50);
    expect(measure([...points].reverse(), 0.1, "volume", 0.3).quantity).toBe(
      15,
    );
  });
  it("rejects invalid scale, missing depth, collinear and self-intersecting polygons", () => {
    expect(() =>
      calibration(
        [
          [1, 1],
          [1, 1],
        ],
        10,
      ),
    ).toThrow();
    expect(() =>
      calibration(
        [
          [0, 0],
          [1, 0],
        ],
        0,
      ),
    ).toThrow();
    expect(() =>
      measure(
        [
          [0, 0],
          [1, 1],
        ],
        NaN,
        "length",
      ),
    ).toThrow();
    expect(() =>
      measure(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        1,
        "area",
      ),
    ).toThrow();
    expect(() =>
      measure(
        [
          [0, 0],
          [10, 10],
          [0, 10],
          [10, 0],
        ],
        1,
        "area",
      ),
    ).toThrow();
    expect(() =>
      measure(
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        1,
        "volume",
        null,
      ),
    ).toThrow();
  });
});
describe("Civil calculators", () => {
  it("calculates trench, bedding, pavement and concrete", () => {
    expect(civil("trench", { length: 10, width: 2, depth: 3 }).quantity).toBe(
      60,
    );
    expect(
      civil("bedding", { length: 10, width: 2, thickness: 0.1 }).quantity,
    ).toBe(2);
    expect(civil("pavement", { area: 200, thickness: 0.15 }).quantity).toBe(30);
    expect(
      civil("concrete", { length: 3, width: 4, thickness: 0.25 }).quantity,
    ).toBe(3);
  });
  it("subtracts external pipe and bedding displacement", () => {
    expect(
      civil("backfill", {
        excavation: 10,
        pipeDiameter: 1,
        pipeLength: 2,
        bedding: 1,
      }).quantity,
    ).toBeCloseTo(9 - Math.PI / 2, 5);
  });
  it("applies bulking and rejects impossible inputs", () => {
    expect(
      civil("spoil", { excavation: 20, bulkingFactor: 1.3 }).quantity,
    ).toBe(26);
    expect(() =>
      civil("spoil", { excavation: 1, bulkingFactor: 0.8 }),
    ).toThrow();
    expect(() => civil("trench", { length: -1, width: 1, depth: 1 })).toThrow();
    expect(() =>
      civil("backfill", {
        excavation: 1,
        pipeDiameter: 2,
        pipeLength: 5,
        bedding: 1,
      }),
    ).toThrow();
  });
});
describe("API schemas and CSV", () => {
  it("rejects unexpected fields, invalid quantities and unsupported uploads", () => {
    expect(projectSchema.safeParse({ name: "A", org_id: org }).success).toBe(
      false,
    );
    expect(itemSchema.safeParse({ ...item().data, quantity: -1 }).success).toBe(
      false,
    );
    expect(
      uploadSchema.safeParse({
        name: "bad.exe",
        mime: "application/exe",
        size: 2,
        revision: "A",
        discipline: "Other",
      }).success,
    ).toBe(false);
    expect(
      uploadSchema.safeParse({
        name: "large.pdf",
        mime: "application/pdf",
        size: 30e6,
        revision: "A",
        discipline: "Other",
      }).success,
    ).toBe(false);
  });
  it("parses quoted fields, BOM and dates; rejects bad imports atomically before writes", () => {
    const parsed = parseRates(
      '\uFEFFcode,description,unit,rate\nA,"Pipe, concrete",m,12.50',
    );
    expect(parsed[0]).toMatchObject({
      description: "Pipe, concrete",
      rate: 12.5,
    });
    expect(() =>
      parseRates("code,description,unit,rate\nA,Pipe,m,1\nB,Bad,m,-5"),
    ).toThrow(/row 3/);
    expect(() =>
      parseRates("code,description,unit,rate\nA,Pipe,m,1\nA,Pipe,m,2"),
    ).toThrow(/Duplicate/);
  });
  it("neutralises spreadsheet formulas in CSV exports", () => {
    const r = rate().data;
    r.description = '=HYPERLINK("bad")';
    expect(exportRates([r])).toContain("'=HYPERLINK");
  });
});
describe("AI evidence validation", () => {
  const result = () =>
    analysisSchema.parse({
      summary: "Draft",
      warnings: [],
      items: [
        {
          description: "Pipe",
          category: "Drainage",
          quantity: 100,
          unit: "m",
          source_page: 1,
          evidence: "No explicit quantity",
          method: "Unknown",
          assumptions: "Verify length",
          confidence: "low",
          quantity_basis: "unknown",
        },
      ],
    });
  it("discards unsubstantiated quantities and never supplies approval or prices", () => {
    const rows = draftItems(result(), { id: randomUUID(), page_count: 2 });
    expect(rows[0]).toMatchObject({
      quantity: null,
      rate: 0,
      source_type: "ai",
    });
    expect(rows[0]).not.toHaveProperty("status");
  });
  it("rejects invented page references", () => {
    const r = result();
    r.items[0].source_page = 3;
    expect(() => draftItems(r, { id: randomUUID(), page_count: 2 })).toThrow(
      /source page/,
    );
  });
});

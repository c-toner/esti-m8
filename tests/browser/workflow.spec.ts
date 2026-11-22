import { test, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import {
  calibration,
  measure,
  applyRate,
  totals,
} from "../../src/lib/calculations";
import {
  itemSchema,
  rateSchema,
  estimateSchema,
  projectSchema,
  type Item,
  type Rate,
  type Drawing,
  type Entity,
  type EstimateData,
  type ProjectData,
  type MeasurementData,
  type Point,
} from "../../src/lib/schemas";
import { workbook } from "../../src/lib/excel";

test("sign in → project → upload PDF → calibrate → takeoff → rate → approve → Excel (mocked external services)", async ({
  page,
}) => {
  const org = randomUUID();
  const projects: Entity<ProjectData>[] = [],
    estimates: Entity<EstimateData>[] = [],
    rates: Rate[] = [],
    items: Item[] = [],
    drawings: Drawing[] = [];
  const calibrations: (Entity<{
    points: Point[];
    known: number;
    scale: number;
  }> & { drawing_id: string; page: number })[] = [];
  const measurements: (Entity<MeasurementData> & {
    drawing_id: string;
    page: number;
    calibration_id: string;
  })[] = [];
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([600, 400]);
  sheet.drawText("CIVIL ESTIMATOR — TEST DRAWING".replace("—", "-"), {
    x: 35,
    y: 350,
    size: 18,
  });
  sheet.drawLine({
    start: { x: 50, y: 320 },
    end: { x: 150, y: 320 },
    thickness: 2,
    color: rgb(0.1, 0.3, 0.3),
  });
  sheet.drawText("10 m known dimension", { x: 50, y: 335, size: 10 });
  const pdfBytes = Buffer.from(await pdf.save());
  const entity = <T>(data: T, project_id = ""): Entity<T> => ({
    id: randomUUID(),
    org_id: org,
    project_id,
    data,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await page.route("**/api/auth", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/test-upload", (route) =>
    route.fulfill({ status: 200, body: "{}" }),
  );
  await page.route("**/fixture.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: pdfBytes }),
  );
  await page.route("**/api/workspace**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const selectedEstimate = estimates.find(
      (e) => e.id === url.searchParams.get("estimate"),
    );
    const selectedItems = items.filter(
      (i) => i.estimate_id === selectedEstimate?.id,
    );
    if (req.method() === "GET") {
      if (url.searchParams.get("action") === "document") {
        await route.fulfill({
          json: { url: "http://127.0.0.1:4174/fixture.pdf" },
        });
        return;
      }
      if (url.searchParams.get("action") === "excel") {
        const bytes = await workbook(
          "Browser fixture",
          selectedEstimate!.data,
          selectedItems,
          drawings,
          measurements,
        );
        await route.fulfill({
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="estimate.xlsx"',
          },
          body: Buffer.from(bytes),
        });
        return;
      }
      await route.fulfill({
        json: {
          members: [
            {
              org_id: org,
              role: "admin",
              organisations: { name: "Test organisation" },
            },
          ],
          projects,
          estimates: estimates.filter(
            (e) => e.project_id === url.searchParams.get("project"),
          ),
          rates,
          items: selectedItems,
          drawings,
          calibrations,
          measurements,
          jobs: [],
          history: [],
          versions: [],
          totals: selectedEstimate
            ? totals(
                selectedItems,
                selectedEstimate.data.overhead,
                selectedEstimate.data.contingency,
                selectedEstimate.data.markup,
              )
            : null,
        },
      });
      return;
    }
    const b = req.postDataJSON();
    let result: unknown = { ok: true };
    switch (b.action) {
      case "project.save": {
        const p = entity(projectSchema.parse(b.data));
        projects.push(p);
        result = p;
        break;
      }
      case "estimate.save": {
        const e = entity(estimateSchema.parse(b.data), b.project);
        estimates.push(e);
        result = e;
        break;
      }
      case "upload.start": {
        const d = {
          ...b.data,
          id: randomUUID(),
          org_id: org,
          project_id: b.project,
          path: "fixture",
          status: "pending",
          page_count: 0,
        } as Drawing;
        drawings.push(d);
        result = { drawing: d, url: "http://127.0.0.1:4174/test-upload" };
        break;
      }
      case "upload.finish": {
        const d = drawings.find((d) => d.id === b.id)!;
        d.status = "ready";
        d.page_count = 1;
        result = d;
        break;
      }
      case "calibration.save": {
        const c = {
          ...entity(
            {
              points: b.data.points,
              known: b.data.known,
              scale: calibration(b.data.points, b.data.known),
            },
            b.project,
          ),
          drawing_id: b.data.drawing_id,
          page: b.data.page,
        };
        calibrations.unshift(c);
        result = c;
        break;
      }
      case "measurement.save": {
        const c = calibrations.find((c) => c.id === b.data.calibration_id)!;
        const m = b.data.measurement;
        const saved = {
          ...entity(
            {
              ...m,
              ...measure(m.points, c.data.scale, m.mode, m.depth),
              scale: c.data.scale,
            },
            b.project,
          ),
          drawing_id: c.drawing_id,
          page: c.page,
          calibration_id: c.id,
        };
        measurements.push(saved);
        result = saved;
        break;
      }
      case "measurement.item": {
        const m = measurements.find((m) => m.id === b.id)!;
        const data = itemSchema.parse({
          description: m.data.description,
          category: "Other",
          quantity: m.data.quantity,
          unit: m.data.unit,
          source_type: "measured",
          drawing_id: m.drawing_id,
          source_page: m.page,
        });
        const i = {
          ...entity(data, b.project),
          estimate_id: b.estimate,
          status: "draft" as const,
          rate_snapshot: null,
        };
        items.push(i);
        result = i;
        break;
      }
      case "rate.save": {
        const r = entity(rateSchema.parse(b.data));
        rates.push(r);
        result = r;
        break;
      }
      case "item.rate": {
        const i = items.find((i) => i.id === b.id)!;
        Object.assign(
          i,
          applyRate(
            i,
            rates.find((r) => r.id === b.data.rate)!,
          ),
        );
        i.version++;
        result = i;
        break;
      }
      case "item.approve": {
        const i = items.find((i) => i.id === b.id)!;
        i.status = "approved";
        i.version++;
        result = i;
        break;
      }
      default:
        throw new Error(`Unmocked mutation: ${b.action}`);
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Browser workflow fixture");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Estimates", exact: true }).click();
  await page.getByRole("button", { name: "New estimate", exact: true }).click();
  const estimateDialog = page.getByRole("dialog");
  await expect(
    estimateDialog.getByRole("button", { name: /^About / }),
  ).toHaveCount(5);
  const overheadHelp = page.getByRole("button", {
    name: "About Overheads %",
    exact: true,
  });
  await overheadHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "10% of $10,000 adds $1,000",
  );
  await page
    .getByRole("heading", { name: "Create estimate", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await overheadHelp.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(estimateDialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "About Profit markup %", exact: true })
    .click();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Markup is not profit margin");
  const bounds = await tooltip.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/estimate-help-mobile.png" });
  await page.getByLabel("Estimate name", { exact: true }).click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Drawings", exact: true }).click();
  await page.getByLabel("Document", { exact: true }).setInputFiles({
    name: "fixture.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });
  await page
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await page
    .getByRole("cell")
    .getByRole("button", { name: "Takeoff", exact: true })
    .click();
  const overlay = page.getByRole("img", {
    name: /Drawing measurement overlay/,
  });
  await expect(overlay).toBeVisible();
  await expect
    .poll(() =>
      page.locator("canvas").evaluate((c) => (c as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(300);
  await expect(page.getByText("Loading private drawing…")).toHaveCount(0);
  await overlay.click({ position: { x: 50, y: 80 } });
  await overlay.click({ position: { x: 150, y: 80 } });
  await page.getByLabel("Known distance (metres)", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Save page calibration", exact: true })
    .click();
  await expect(page.getByText(/Calibration: 10 m reference/)).toBeVisible();
  await overlay.click({ position: { x: 50, y: 100 } });
  await overlay.click({ position: { x: 250, y: 100 } });
  await page
    .getByLabel("Measurement description", { exact: true })
    .fill("Measured drain fixture");
  await page.getByRole("button", { name: "Save takeoff", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "20 m", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rotate 90°", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "20 m", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add to draft BOQ", exact: true })
    .click();
  await page.getByRole("button", { name: "Cost Library", exact: true }).click();
  await page.getByRole("button", { name: "Add rate", exact: true }).click();
  await page.getByLabel("Rate code", { exact: true }).fill("TEST-RATE");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Browser fixture rate");
  await page.getByLabel("Unit rate AUD", { exact: true }).fill("25");
  await page
    .getByLabel("Quote / source reference", { exact: true })
    .fill("Synthetic test fixture");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "BOQ", exact: true }).click();
  await page
    .getByLabel("Apply rate to Measured drain fixture", { exact: true })
    .selectOption({ label: "TEST-RATE · $25.00" });
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(page.locator(".metric.highlight strong")).toHaveText("$500.00");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export Excel estimate", exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  const out = new ExcelJS.Workbook();
  await out.xlsx.readFile(path!);
  expect(out.getWorksheet("Approved BOQ")!.getCell("G2").value).toMatchObject({
    result: 500,
  });
  await page.screenshot({
    path: "docs/screenshots/boq-browser-fixture.png",
    fullPage: true,
  });
  // A new revision must never reuse the previous revision's calibration.
  await page.getByRole("button", { name: "Drawings", exact: true }).click();
  await page.getByLabel("Document", { exact: true }).setInputFiles({
    name: "fixture.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });
  await page.getByLabel("Revision", { exact: true }).fill("B");
  await page
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await expect(page.getByText("ready", { exact: true })).toHaveCount(2);
  await page
    .getByRole("cell")
    .getByRole("button", { name: "Takeoff", exact: true })
    .last()
    .click();
  await page
    .getByRole("combobox", { name: "Tool", exact: true })
    .selectOption("length");
  await expect(
    page.getByText("This revision and page are not calibrated.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "20 m", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Drawing / revision", exact: true })
    .selectOption(drawings[0].id);
  await expect(page.getByText(/Calibration: 10 m reference/)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "20 m", exact: true }),
  ).toBeVisible();
});

import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import { workbook } from "../src/lib/excel";
import { itemSchema, estimateSchema, type Item } from "../src/lib/schemas";
import { validateDocument } from "../src/lib/documents";
import { PDFDocument } from "pdf-lib";
it("exports only approved tender rows, preserves review rows and cached formulas, and reopens", async () => {
  const make = (status: Item["status"]): Item => ({
    id: crypto.randomUUID(),
    org_id: crypto.randomUUID(),
    project_id: crypto.randomUUID(),
    estimate_id: crypto.randomUUID(),
    created_at: "",
    updated_at: "",
    version: 1,
    status,
    rate_snapshot: null,
    data: itemSchema.parse({
      description: "=UNTRUSTED()",
      category: "Concrete",
      quantity: 2,
      unit: "m3",
      rate: 15,
    }),
  });
  const bytes = await workbook(
    "Fixture project",
    estimateSchema.parse({
      name: "Test",
      overhead: 10,
      contingency: 5,
      markup: 10,
    }),
    [make("approved"), make("draft"), make("rejected")],
    [],
    [],
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  expect(wb.worksheets).toHaveLength(8);
  expect(wb.getWorksheet("Approved BOQ")!.rowCount).toBe(2);
  expect(wb.getWorksheet("Review items")!.rowCount).toBe(3);
  expect(wb.getWorksheet("Approved BOQ")!.getCell("B2").value).toBe(
    "=UNTRUSTED()",
  );
  expect(wb.getWorksheet("Approved BOQ")!.getCell("G2").value).toEqual({
    formula: "ROUND(D2*F2,2)",
    result: 30,
  });
  expect(wb.getWorksheet("Estimate summary")!.getCell("B11").value).toEqual({
    formula: "SUM(B4,B8:B10)",
    result: 37.95,
  });
  expect(
    await validateDocument(
      Buffer.from(bytes),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  ).toBe(1);
});
it("exports an empty estimate without invalid ranges", async () => {
  const bytes = await workbook(
    "Empty",
    estimateSchema.parse({ name: "Empty" }),
    [],
    [],
    [],
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  expect(
    wb.getWorksheet("Estimate summary")!.getCell("B4").value,
  ).toMatchObject({ formula: "0" });
});
it("validates document content rather than trusting MIME", async () => {
  await expect(
    validateDocument(Buffer.from("not a pdf"), "application/pdf"),
  ).rejects.toThrow();
  await expect(
    validateDocument(Buffer.from([0, 1, 2]), "text/plain"),
  ).rejects.toThrow();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  expect(
    await validateDocument(Buffer.from(await pdf.save()), "application/pdf"),
  ).toBe(2);
});

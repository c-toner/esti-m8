import ExcelJS from "exceljs";
import { totals, lineTotal } from "./calculations";
import type {
  Item,
  EstimateData,
  Drawing,
  MeasurementData,
  Entity,
} from "./schemas";
export async function workbook(
  name: string,
  estimate: EstimateData,
  items: Item[],
  drawings: Drawing[],
  measurements: Entity<MeasurementData>[],
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Civil Estimator";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const sheet = (name: string, headers: string[]) => {
    const s = wb.addWorksheet(name);
    s.addRow(headers);
    s.views = [{ state: "frozen", ySplit: 1 }];
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF154E4A" },
    };
    s.columns.forEach((c, i) => {
      c.width = i === 0 ? 44 : 22;
    });
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
    return s;
  };
  const summary = sheet("Estimate summary", [
    "Estimate • AUD excluding GST",
    "Value",
  ]);
  summary.addRow(["Project", name]);
  summary.addRow(["Estimate", estimate.name]);
  const boq = sheet("Approved BOQ", [
    "Code",
    "Description",
    "Category",
    "Quantity",
    "Unit",
    "Unit rate AUD",
    "Amount AUD",
    "Drawing reference",
    "Source type",
    "Rate source",
    "Notes",
  ]);
  const review = sheet("Review items", [
    "Code",
    "Description",
    "Quantity",
    "Unit",
    "Unit rate AUD",
    "Status",
    "Evidence",
    "Method",
    "Notes",
  ]);
  const sources = sheet("Rate sources", [
    "Item",
    "Rate code",
    "Supplier",
    "Effective date",
    "Source",
    "Unit",
    "Rate AUD",
  ]);
  const refs = sheet("Drawing references", [
    "Document",
    "Drawing number",
    "Revision",
    "Discipline",
    "Pages",
  ]);
  drawings.forEach((d) =>
    refs.addRow([d.name, d.number, d.revision, d.discipline, d.page_count]),
  );
  const assumptions = sheet("Assumptions and exclusions", [
    "Item",
    "Method and assumptions",
    "Evidence",
    "Notes",
  ]);
  assumptions.addRow(["Estimate", estimate.notes, "", ""]);
  const statuses = sheet("Review status", [
    "Item",
    "Status",
    "Confidence",
    "Quantity origin",
  ]);
  for (const i of items) {
    const d = i.data;
    statuses.addRow([d.description, i.status, d.confidence, d.source_type]);
    assumptions.addRow([d.description, d.method, d.evidence, d.notes]);
    if (i.rate_snapshot) {
      const r = i.rate_snapshot;
      sources.addRow([
        d.description,
        r.code,
        r.supplier,
        r.effective_date,
        r.source,
        r.unit,
        r.rate,
      ]);
    }
    if (i.status !== "approved") {
      review.addRow([
        d.code,
        d.description,
        d.quantity,
        d.unit,
        d.rate,
        i.status,
        d.evidence,
        d.method,
        d.notes,
      ]);
      continue;
    }
    if (d.quantity === null)
      throw new Error("Cannot export approved item with missing quantity.");
    const row = boq.rowCount + 1;
    const drawing = drawings.find((x) => x.id === d.drawing_id);
    boq.addRow([
      d.code,
      d.description,
      d.category,
      d.quantity,
      d.unit,
      d.rate,
      {
        formula: `ROUND(D${row}*F${row},2)`,
        result: lineTotal(d.quantity, d.rate),
      },
      drawing
        ? `${drawing.name} · rev ${drawing.revision} · p${d.source_page}`
        : "Manual",
      d.source_type,
      i.rate_snapshot?.source ?? "",
      d.notes,
    ]);
  }
  boq.getColumn(6).numFmt = boq.getColumn(7).numFmt = "#,##0.00";
  const t = totals(
    items,
    estimate.overhead,
    estimate.contingency,
    estimate.markup,
  );
  summary.addRow([
    "Approved direct costs",
    {
      formula:
        boq.rowCount > 1 ? `SUM('Approved BOQ'!G2:G${boq.rowCount})` : "0",
      result: t.direct,
    },
  ]);
  summary.addRow(["Overheads %", estimate.overhead]);
  summary.addRow(["Contingency %", estimate.contingency]);
  summary.addRow(["Profit markup %", estimate.markup]);
  summary.addRow([
    "Overheads AUD",
    { formula: "ROUND(B4*B5/100,2)", result: t.overhead },
  ]);
  summary.addRow([
    "Contingency AUD",
    { formula: "ROUND(B4*B6/100,2)", result: t.contingency },
  ]);
  summary.addRow([
    "Profit AUD",
    { formula: "ROUND((B4+B8+B9)*B7/100,2)", result: t.profit },
  ]);
  summary.addRow([
    "Tender total AUD excl. GST",
    { formula: "SUM(B4,B8:B10)", result: t.total },
  ]);
  summary.addRow(["Profit margin % (distinct from markup)", t.margin]);
  summary.getColumn(2).numFmt = "#,##0.00";
  const takeoffs = sheet("Quantity takeoffs", [
    "Description",
    "Mode",
    "Quantity",
    "Unit",
    "Scale m/document unit",
    "Depth m",
    "Notes",
  ]);
  measurements.forEach((m) =>
    takeoffs.addRow([
      m.data.description,
      m.data.mode,
      m.data.quantity,
      m.data.unit,
      m.data.scale,
      m.data.depth,
      m.data.notes,
    ]),
  );
  return wb.xlsx.writeBuffer();
}

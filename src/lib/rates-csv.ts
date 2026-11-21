import Papa from "papaparse";
import { rateSchema, type RateData } from "./schemas";
export function parseRates(csv: string) {
  if (csv.length > 4_000_000) throw new Error("CSV exceeds 4 MB.");
  const parsed = Papa.parse<Record<string, string>>(
    csv.replace(/^\uFEFF/, ""),
    { header: true, skipEmptyLines: "greedy" },
  );
  if (parsed.errors.length) throw new Error("CSV is malformed.");
  if (
    !["code", "description", "unit", "rate"].every((k) =>
      parsed.meta.fields?.includes(k),
    )
  )
    throw new Error("CSV requires code, description, unit and rate headers.");
  if (parsed.data.length > 10000) throw new Error("CSV limit is 10,000 rows.");
  const seen = new Set<string>();
  return parsed.data.map((r, i) => {
    const row = rateSchema.safeParse({
      ...r,
      category:
        r.category === "Subcontract" ? "Subcontractors" : r.category || "Other",
      effective_date: r.effective_date || null,
      archived: r.archived === "true",
    });
    if (!row.success) throw new Error(`Invalid rate on CSV row ${i + 2}.`);
    if (seen.has(row.data.code))
      throw new Error(`Duplicate code on CSV row ${i + 2}.`);
    seen.add(row.data.code);
    return row.data;
  });
}
export function exportRates(rates: RateData[]) {
  return (
    "\uFEFF" +
    Papa.unparse(rates, {
      escapeFormulae: true,
      columns: [
        "code",
        "description",
        "category",
        "unit",
        "rate",
        "supplier",
        "region",
        "effective_date",
        "source",
        "notes",
        "archived",
      ],
    })
  );
}

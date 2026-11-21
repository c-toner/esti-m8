import { z } from "zod";
export const id = z.string().uuid();
export const text = z.string().trim().max(2000);
export const amount = z
  .union([z.number(), z.string().regex(/^\d+(\.\d{1,6})?$/)])
  .transform(Number)
  .pipe(z.number().finite().nonnegative().max(1e12));
export const unit = z.enum([
  "m",
  "m2",
  "m3",
  "t",
  "kg",
  "ea",
  "item",
  "lot",
  "hr",
  "day",
  "L",
]);
export const categories = [
  "Labour",
  "Plant",
  "Materials",
  "Earthworks",
  "Drainage",
  "Roadworks",
  "Concrete",
  "Utilities",
  "Subcontractors",
  "Other",
] as const;
export const category = z.enum(categories);
export const projectSchema = z
  .object({
    name: text.min(1).max(200),
    client: text.default(""),
    location: text.default(""),
    region: text.default("NSW"),
    description: text.default(""),
    tender_reference: text.default(""),
    tender_closing_date: z.string().date().nullable().default(null),
    currency: z.literal("AUD").default("AUD"),
    status: z
      .enum(["Draft", "In review", "Tendered", "Archived"])
      .default("Draft"),
  })
  .strict();
export const rateSchema = z
  .object({
    code: text.min(1).max(80),
    description: text.min(1),
    category,
    unit,
    rate: amount,
    supplier: text.default(""),
    region: text.default("NSW"),
    effective_date: z.string().date().nullable().default(null),
    source: text.default(""),
    notes: text.default(""),
    archived: z.boolean().default(false),
  })
  .strict();
export const itemSchema = z
  .object({
    code: text.max(80).default(""),
    description: text.min(1),
    category,
    quantity: amount.nullable(),
    unit,
    rate: amount.default(0),
    source_type: z
      .enum(["manual", "measured", "calculated", "ai"])
      .default("manual"),
    drawing_id: id.nullable().default(null),
    source_page: z.number().int().positive().nullable().default(null),
    evidence: text.default(""),
    method: text.default(""),
    notes: text.default(""),
    confidence: z.enum(["low", "medium", "high"]).default("low"),
  })
  .strict();
export const estimateSchema = z
  .object({
    name: text.min(1),
    overhead: amount.pipe(z.number().max(100)).default(0),
    contingency: amount.pipe(z.number().max(100)).default(0),
    markup: amount.pipe(z.number().max(100)).default(0),
    notes: text.default(""),
  })
  .strict();
export const point = z.tuple([
  z.number().finite().min(0).max(1e6),
  z.number().finite().min(0).max(1e6),
]);
export const measurementSchema = z
  .object({
    description: text.min(1),
    mode: z.enum(["length", "area", "volume"]),
    points: z.array(point).min(2).max(1000),
    depth: amount.nullable().default(null),
    notes: text.default(""),
  })
  .strict();
export const uploadSchema = z
  .object({
    name: text.min(1).max(200),
    mime: z.enum([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
    ]),
    size: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    number: text.max(100).default(""),
    revision: text.min(1).max(50),
    discipline: category,
  })
  .strict();
export type ProjectData = z.infer<typeof projectSchema>;
export type RateData = z.infer<typeof rateSchema>;
export type ItemData = z.infer<typeof itemSchema>;
export type EstimateData = z.infer<typeof estimateSchema>;
export type Point = z.infer<typeof point>;
export type MeasurementData = z.infer<typeof measurementSchema> & {
  quantity: number;
  unit: string;
  scale: number;
};
export type Entity<T> = {
  id: string;
  org_id: string;
  project_id: string;
  data: T;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Rate = Entity<RateData>;
export type Item = Entity<ItemData> & {
  estimate_id: string;
  status: "draft" | "approved" | "rejected";
  rate_snapshot: RateData | null;
};
export type Drawing = {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  number: string;
  revision: string;
  discipline: string;
  status: string;
  page_count: number;
};

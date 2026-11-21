import Decimal from "decimal.js";
import type { Item, Rate, Point } from "./schemas";
export function number(value: Decimal.Value) {
  const n = new Decimal(value);
  if (!n.isFinite() || n.isNegative() || n.gt("1e15"))
    throw new Error(
      "Use a finite, nonnegative value within the supported range.",
    );
  return n;
}
export const money = (n: Decimal.Value) =>
  number(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export function lineTotal(quantity: Decimal.Value, rate: Decimal.Value) {
  return money(number(quantity).mul(number(rate)));
}
export function totals(
  items: Pick<Item, "data" | "status">[],
  overhead = 0,
  contingency = 0,
  markup = 0,
) {
  const groups: Record<string, number> = {};
  let direct = new Decimal(0);
  for (const item of items) {
    if (item.status !== "approved") continue;
    if (item.data.quantity === null)
      throw new Error("Approved quantities cannot be missing.");
    const total = lineTotal(item.data.quantity, item.data.rate);
    direct = direct.add(total);
    groups[item.data.category] = money(
      number(groups[item.data.category] ?? 0).add(total),
    );
  }
  for (const v of [overhead, contingency, markup])
    if (number(v).gt(100))
      throw new Error("Percentages must be between 0 and 100.");
  const oh = money(direct.mul(overhead).div(100));
  const ct = money(direct.mul(contingency).div(100));
  const base = direct.add(oh).add(ct);
  const profit = money(base.mul(markup).div(100));
  const total = money(base.add(profit));
  return {
    direct: money(direct),
    overhead: oh,
    contingency: ct,
    profit,
    total,
    groups,
    margin: total ? new Decimal(profit).div(total).mul(100).toNumber() : 0,
  };
}
export function applyRate(
  item: Item,
  rate: Rate,
): Pick<Item, "data" | "status" | "rate_snapshot"> {
  if (item.org_id !== rate.org_id)
    throw new Error("Rate belongs to another organisation.");
  if (item.data.unit !== rate.data.unit)
    throw new Error("Rate and item units must match.");
  if (rate.data.archived) throw new Error("Rate is archived.");
  return {
    data: { ...item.data, rate: rate.data.rate },
    status: "draft",
    rate_snapshot: structuredClone(rate.data),
  };
}
function validPoints(points: Point[], min: number) {
  if (
    points.length < min ||
    points.some(
      (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0),
    )
  )
    throw new Error("Select valid document points.");
}
export function distance(a: Point, b: Point) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
export function calibration(points: Point[], known: number) {
  validPoints(points, 2);
  if (
    points.length !== 2 ||
    distance(points[0], points[1]) < 1e-8 ||
    !Number.isFinite(known) ||
    known <= 0
  )
    throw new Error(
      "Calibration needs two distinct points and a positive known distance.",
    );
  return known / distance(points[0], points[1]);
}
function cross(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
export function measure(
  points: Point[],
  scale: number,
  mode: "length" | "area" | "volume",
  depth: number | null = null,
) {
  validPoints(points, mode === "length" ? 2 : 3);
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Calibrate this drawing page first.");
  let quantity = 0;
  if (mode === "length") {
    quantity =
      points.slice(1).reduce((s, p, i) => s + distance(points[i], p), 0) *
      scale;
  } else {
    // Reject crossing edges: a bow-tie cannot be treated as a valid polygon.
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        const a = points[i],
          b = points[(i + 1) % points.length],
          c = points[j],
          d = points[(j + 1) % points.length];
        if (
          cross(a, b, c) * cross(a, b, d) <= 0 &&
          cross(c, d, a) * cross(c, d, b) <= 0 &&
          Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
            Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
          Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
            Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
        )
          throw new Error("Polygon edges intersect.");
      }
    quantity =
      (Math.abs(
        points.reduce((sum, a, i) => {
          const b = points[(i + 1) % points.length];
          return sum + a[0] * b[1] - b[0] * a[1];
        }, 0),
      ) *
        scale *
        scale) /
      2;
    if (mode === "volume") {
      if (depth === null || !Number.isFinite(depth) || depth <= 0)
        throw new Error("Enter a positive depth in metres.");
      quantity *= depth;
    }
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12)
    throw new Error("Measurement must be positive and within range.");
  return {
    quantity,
    unit: mode === "length" ? "m" : mode === "area" ? "m2" : "m3",
  };
}
export const calculatorFields = {
  trench: ["length", "width", "depth"],
  bedding: ["length", "width", "thickness"],
  backfill: ["excavation", "pipeDiameter", "pipeLength", "bedding"],
  pavement: ["area", "thickness"],
  concrete: ["length", "width", "thickness"],
  spoil: ["excavation", "bulkingFactor"],
} as const;
export type Calculator = keyof typeof calculatorFields;
export function civil(mode: Calculator, input: Record<string, number>) {
  for (const key of calculatorFields[mode]) number(input[key]);
  const n = (key: string) => number(input[key]);
  let result: Decimal;
  let formula: string;
  switch (mode) {
    case "trench":
      result = n("length").mul(n("width")).mul(n("depth"));
      formula = "Length × width × depth";
      break;
    case "bedding":
    case "concrete":
      result = n("length").mul(n("width")).mul(n("thickness"));
      formula = "Length × width × thickness";
      break;
    case "pavement":
      result = n("area").mul(n("thickness"));
      formula = "Area × layer thickness";
      break;
    case "spoil":
      if (n("bulkingFactor").lt(1))
        throw new Error("Bulking factor must be at least 1.");
      result = n("excavation").mul(n("bulkingFactor"));
      formula = "Excavation volume × bulking factor";
      break;
    case "backfill":
      result = n("excavation")
        .sub(n("pipeDiameter").div(2).pow(2).mul(Math.PI).mul(n("pipeLength")))
        .sub(n("bedding"));
      formula =
        "Excavation − π × (pipe outside diameter ÷ 2)² × pipe length − bedding";
      break;
  }
  if (result.isNegative())
    throw new Error("Displacements exceed the excavation volume.");
  return {
    quantity: result.toDecimalPlaces(6).toNumber(),
    unit: "m3" as const,
    method: `${formula}. Inputs in metres/m²/m³: ${JSON.stringify(input)}. Uniform sections assumed; no overlaps or waste allowance included.`,
  };
}

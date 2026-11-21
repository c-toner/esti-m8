import { NextResponse } from "next/server";
import { z } from "zod";
import {
  context,
  requireUser,
  owned,
  write,
  limit,
  HttpError,
  type Context,
} from "@/lib/auth";
import {
  id,
  projectSchema,
  estimateSchema,
  itemSchema,
  rateSchema,
  uploadSchema,
  measurementSchema,
  point,
  amount,
  type Item,
  type Rate,
  type Drawing,
  type MeasurementData,
  type Entity,
} from "@/lib/schemas";
import {
  applyRate,
  calibration,
  measure,
  totals,
  civil,
  calculatorFields,
  type Calculator,
} from "@/lib/calculations";
import { parseRates, exportRates } from "@/lib/rates-csv";
import { validateDocument } from "@/lib/documents";
import { workbook } from "@/lib/excel";
export const runtime = "nodejs";
export const maxDuration = 60;
const envelope = z
  .object({
    action: z.string(),
    org: id,
    project: id.optional(),
    estimate: id.optional(),
    id: id.optional(),
    version: z.number().int().positive().optional(),
    data: z.unknown().optional(),
  })
  .strict();
const requiredId = (value: unknown) => id.parse(value);
function fail(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  console.error(
    "Workspace request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return NextResponse.json(
    {
      error:
        "The request could not be completed. Check the supplied values and try again.",
    },
    { status: 400 },
  );
}
async function list(
  ctx: Context,
  table: string,
  project?: string,
  estimate?: string,
) {
  const pageSize =
    table === "audit_events" ? 100 : table === "estimate_versions" ? 20 : 500;
  const records: Record<string, unknown>[] = [];
  for (let offset = 0; offset <= 10000; offset += pageSize) {
    let query = ctx.db.from(table).select("*").eq("org_id", ctx.org);
    if (project) query = query.eq("project_id", project);
    if (estimate) query = query.eq("estimate_id", estimate);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new HttpError(503, "Workspace data could not be loaded.");
    records.push(...data);
    if (records.length > 10000)
      throw new HttpError(
        413,
        "This dataset exceeds the 10,000-record workspace limit. Split the project before exporting.",
      );
    if (
      data.length < pageSize ||
      table === "audit_events" ||
      table === "estimate_versions"
    )
      break;
  }
  return records as Awaited<ReturnType<typeof owned>>[];
}
async function source(
  ctx: Context,
  project: string,
  drawingId: string | null,
  page: number | null,
) {
  if (!drawingId && !page) return;
  if (!drawingId || !page)
    throw new HttpError(400, "Select both a drawing and page.");
  const d = await owned(ctx, "drawings", drawingId, project);
  if (d.status !== "ready" || page > d.page_count)
    throw new HttpError(400, "Drawing page is unavailable.");
}
export async function GET(request: Request) {
  try {
    const { session, user } = await requireUser();
    const { data: members, error } = await session
      .from("organisation_members")
      .select("org_id,role,organisations(name)")
      .eq("user_id", user.id);
    if (error)
      throw new HttpError(
        503,
        "Apply the database migrations before continuing.",
      );
    const url = new URL(request.url);
    if (!url.searchParams.get("org"))
      return NextResponse.json(
        { members },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const ctx = await context(requiredId(url.searchParams.get("org")));
    await limit(ctx, "reads", 300);
    const project = url.searchParams.get("project") || undefined;
    const estimate = url.searchParams.get("estimate") || undefined;
    if (project) await owned(ctx, "projects", requiredId(project));
    if (estimate) {
      if (!project) throw new HttpError(400, "Project required.");
      await owned(ctx, "estimates", requiredId(estimate), project);
    }
    if (url.searchParams.get("action") === "document") {
      const d = await owned(
        ctx,
        "drawings",
        requiredId(url.searchParams.get("id")),
        project,
      );
      if (d.status !== "ready")
        throw new HttpError(400, "Upload is not ready.");
      const { data, error } = await ctx.db.storage
        .from("documents")
        .createSignedUrl(d.path, 300);
      if (error) throw new HttpError(503, "Document unavailable.");
      return NextResponse.json(
        { url: data.signedUrl },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (url.searchParams.get("action") === "rates-csv") {
      const rates = await list(ctx, "cost_rates");
      return new Response(
        exportRates(rates.map((r) => rateSchema.parse(r.data))),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="civil-rates.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    if (url.searchParams.get("action") === "excel") {
      if (!project || !estimate)
        throw new HttpError(400, "Select an estimate.");
      const p = await owned(ctx, "projects", project);
      const e = await owned(ctx, "estimates", estimate, project);
      const [items, drawings, measurements] = await Promise.all([
        list(ctx, "boq_items", project, estimate),
        list(ctx, "drawings", project),
        list(ctx, "takeoff_measurements", project),
      ]);
      const bytes = await workbook(
        p.data.name,
        estimateSchema.parse(e.data),
        items as Item[],
        drawings as Drawing[],
        measurements as Entity<MeasurementData>[],
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="civil-estimate.xlsx"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    const [
      projects,
      rates,
      estimates,
      drawings,
      items,
      calibrations,
      measurements,
      jobs,
      history,
      versions,
    ] = await Promise.all([
      list(ctx, "projects"),
      list(ctx, "cost_rates"),
      project ? list(ctx, "estimates", project) : [],
      project ? list(ctx, "drawings", project) : [],
      estimate ? list(ctx, "boq_items", project, estimate) : [],
      project ? list(ctx, "takeoff_calibrations", project) : [],
      project ? list(ctx, "takeoff_measurements", project) : [],
      project ? list(ctx, "ai_analysis_jobs", project) : [],
      project ? list(ctx, "audit_events", project) : [],
      estimate ? list(ctx, "estimate_versions", project, estimate) : [],
    ]);
    const selected = estimates.find((e) => e.id === estimate);
    return NextResponse.json(
      {
        members,
        projects,
        rates,
        estimates,
        drawings,
        items,
        calibrations,
        measurements,
        jobs,
        history,
        versions,
        totals: selected
          ? totals(
              items as Item[],
              selected.data.overhead,
              selected.data.contingency,
              selected.data.markup,
            )
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new HttpError(403, "Invalid request origin.");
    if (Number(request.headers.get("content-length") || 0) > 4_500_000)
      throw new HttpError(413, "Request is too large.");
    const raw = await request.text();
    if (raw.length > 4_500_000)
      throw new HttpError(413, "Request is too large.");
    const body = JSON.parse(raw);
    if (body.action === "organisation.create") {
      const { session } = await requireUser();
      const name = z.string().trim().min(1).max(200).parse(body.data?.name);
      const { data, error } = await session.rpc("create_organisation", {
        org_name: name,
      });
      if (error) throw new HttpError(400, "Organisation could not be created.");
      return NextResponse.json({ id: data });
    }
    const b = envelope.parse(body);
    const ctx = await context(b.org);
    await limit(ctx, "writes");
    if (b.project) await owned(ctx, "projects", b.project);
    if (b.estimate) {
      if (!b.project) throw new HttpError(400, "Project required.");
      await owned(ctx, "estimates", b.estimate, b.project);
    }
    let result: unknown = { ok: true };
    switch (b.action) {
      case "project.save": {
        if (b.id) await owned(ctx, "projects", b.id);
        result = await write(
          ctx,
          "projects",
          { data: projectSchema.parse(b.data) },
          b.id,
          b.version,
        );
        break;
      }
      case "estimate.save": {
        const project = requiredId(b.project);
        if (b.id) await owned(ctx, "estimates", b.id, project);
        result = await write(
          ctx,
          "estimates",
          { project_id: project, data: estimateSchema.parse(b.data) },
          b.id,
          b.version,
        );
        break;
      }
      case "estimate.duplicate": {
        await owned(
          ctx,
          "estimates",
          requiredId(b.estimate),
          requiredId(b.project),
        );
        const { data, error } = await ctx.db.rpc("duplicate_estimate", {
          p_org: ctx.org,
          p_actor: ctx.user,
          p_estimate: b.estimate,
        });
        if (error)
          throw new HttpError(400, "Estimate could not be duplicated.");
        result = { id: data };
        break;
      }
      case "rate.save": {
        if (b.id) await owned(ctx, "cost_rates", b.id);
        result = await write(
          ctx,
          "cost_rates",
          { data: rateSchema.parse(b.data) },
          b.id,
          b.version,
        );
        break;
      }
      case "rates.import": {
        const csv = z.string().max(4_000_000).parse(b.data);
        const rates = parseRates(csv);
        const { data, error } = await ctx.db.rpc("import_rates", {
          p_org: ctx.org,
          p_actor: ctx.user,
          p_rates: rates,
        });
        if (error)
          throw new HttpError(
            400,
            "Rate import failed; no rows were imported.",
          );
        result = { count: data };
        break;
      }
      case "item.save": {
        const project = requiredId(b.project),
          estimate = requiredId(b.estimate);
        const data = itemSchema.parse(b.data);
        let snapshot = null;
        if (b.id) {
          const old = await owned(ctx, "boq_items", b.id, project);
          if (old.estimate_id !== estimate)
            throw new HttpError(404, "Item not found in estimate.");
          data.source_type = old.data.source_type;
          if (
            data.quantity !== old.data.quantity ||
            data.unit !== old.data.unit ||
            data.drawing_id !== old.data.drawing_id ||
            data.source_page !== old.data.source_page
          ) {
            data.source_type = "manual";
            data.notes =
              `Manually revised from ${old.data.source_type} quantity ${old.data.quantity ?? "unknown"} ${old.data.unit}. ${data.notes}`.slice(
                0,
                2000,
              );
          }
          if (data.rate === old.data.rate && data.unit === old.data.unit)
            snapshot = old.rate_snapshot;
        } else data.source_type = "manual";
        await source(ctx, project, data.drawing_id, data.source_page);
        result = await write(
          ctx,
          "boq_items",
          {
            project_id: project,
            estimate_id: estimate,
            drawing_id: data.drawing_id,
            source_page: data.source_page,
            data,
            status: "draft",
            rate_snapshot: snapshot,
          },
          b.id,
          b.version,
        );
        break;
      }
      case "item.approve":
      case "item.reject":
      case "item.delete":
      case "item.rate": {
        const item = (await owned(
          ctx,
          "boq_items",
          requiredId(b.id),
          requiredId(b.project),
        )) as Item;
        if (item.estimate_id !== b.estimate)
          throw new HttpError(404, "Item not found in estimate.");
        if (b.action === "item.delete") {
          result = await write(ctx, "boq_items", {}, item.id, b.version, true);
          break;
        }
        if (b.action === "item.rate") {
          const rate = (await owned(
            ctx,
            "cost_rates",
            requiredId((b.data as { rate?: string })?.rate),
          )) as Rate;
          result = await write(
            ctx,
            "boq_items",
            applyRate(item, rate),
            item.id,
            b.version,
          );
          break;
        }
        if (b.action === "item.approve" && item.data.quantity === null)
          throw new HttpError(
            400,
            "Enter and verify a quantity before approval.",
          );
        result = await write(
          ctx,
          "boq_items",
          { status: b.action === "item.approve" ? "approved" : "rejected" },
          item.id,
          b.version,
        );
        break;
      }
      case "upload.start": {
        const project = requiredId(b.project);
        const data = uploadSchema.parse(b.data);
        await limit(ctx, "uploads", 50, 3600);
        const extensions: Record<string, string[]> = {
          "application/pdf": ["pdf"],
          "image/png": ["png"],
          "image/jpeg": ["jpg", "jpeg"],
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
            "xlsx",
          ],
          "text/plain": ["txt"],
          "text/csv": ["csv"],
        };
        if (
          !extensions[data.mime].includes(
            data.name.split(".").pop()?.toLowerCase() ?? "",
          )
        )
          throw new HttpError(400, "File extension and type must match.");
        const uid = crypto.randomUUID();
        const path = `${ctx.org}/${project}/${uid}`;
        const doc = await write(ctx, "drawings", {
          id: uid,
          project_id: project,
          ...data,
          path,
        });
        const { data: signed, error } = await ctx.db.storage
          .from("documents")
          .createSignedUploadUrl(path);
        if (error) throw new HttpError(503, "Could not create upload URL.");
        result = { drawing: doc, url: signed.signedUrl };
        break;
      }
      case "upload.finish": {
        const d = await owned(
          ctx,
          "drawings",
          requiredId(b.id),
          requiredId(b.project),
        );
        if (d.status === "ready") {
          result = d;
          break;
        }
        const { data: blob, error } = await ctx.db.storage
          .from("documents")
          .download(d.path);
        if (error || !blob)
          throw new HttpError(
            400,
            "Upload is missing. Please upload the file again.",
          );
        try {
          if (blob.size !== d.size) throw new Error("Size mismatch.");
          const pages = await validateDocument(
            Buffer.from(await blob.arrayBuffer()),
            d.mime,
          );
          const { error: pageError } = await ctx.db
            .from("drawing_pages")
            .upsert(
              Array.from({ length: pages }, (_, i) => ({
                org_id: ctx.org,
                project_id: b.project,
                drawing_id: d.id,
                page: i + 1,
              })),
              { onConflict: "drawing_id,page" },
            );
          if (pageError) throw new Error("Page registration failed.");
          result = await write(
            ctx,
            "drawings",
            { status: "ready", page_count: pages },
            d.id,
          );
        } catch {
          await write(ctx, "drawings", { status: "invalid" }, d.id);
          await ctx.db.storage.from("documents").remove([d.path]);
          throw new HttpError(
            400,
            "File validation failed. Check its format, size and page count.",
          );
        }
        break;
      }
      case "calibration.save": {
        const project = requiredId(b.project);
        const data = z
          .object({
            drawing_id: id,
            page: z.number().int().positive(),
            points: z.array(point).length(2),
            known: amount.pipe(z.number().positive()),
          })
          .strict()
          .parse(b.data);
        await source(ctx, project, data.drawing_id, data.page);
        result = await write(ctx, "takeoff_calibrations", {
          project_id: project,
          drawing_id: data.drawing_id,
          page: data.page,
          data: {
            points: data.points,
            known: data.known,
            scale: calibration(data.points, data.known),
          },
        });
        break;
      }
      case "measurement.save": {
        const project = requiredId(b.project);
        const input = z
          .object({ calibration_id: id, measurement: measurementSchema })
          .strict()
          .parse(b.data);
        const cal = await owned(
          ctx,
          "takeoff_calibrations",
          input.calibration_id,
          project,
        );
        const measured = measure(
          input.measurement.points,
          cal.data.scale,
          input.measurement.mode,
          input.measurement.depth,
        );
        if (b.id) await owned(ctx, "takeoff_measurements", b.id, project);
        result = await write(
          ctx,
          "takeoff_measurements",
          {
            project_id: project,
            calibration_id: cal.id,
            drawing_id: cal.drawing_id,
            page: cal.page,
            data: { ...input.measurement, ...measured, scale: cal.data.scale },
          },
          b.id,
          b.version,
        );
        break;
      }
      case "measurement.delete": {
        await owned(
          ctx,
          "takeoff_measurements",
          requiredId(b.id),
          requiredId(b.project),
        );
        result = await write(
          ctx,
          "takeoff_measurements",
          {},
          b.id,
          b.version,
          true,
        );
        break;
      }
      case "measurement.item": {
        const project = requiredId(b.project),
          estimate = requiredId(b.estimate);
        const m = await owned(
          ctx,
          "takeoff_measurements",
          requiredId(b.id),
          project,
        );
        const data = itemSchema.parse({
          description: m.data.description,
          category: "Other",
          quantity: m.data.quantity,
          unit: m.data.unit,
          source_type: "measured",
          drawing_id: m.drawing_id,
          source_page: m.page,
          evidence: `Manual takeoff ${m.id}; calibration ${m.calibration_id}`,
          method: `${m.data.mode}; scale ${m.data.scale} metres/document unit; depth ${m.data.depth ?? "n/a"} m; points ${JSON.stringify(m.data.points)}`,
          notes: m.data.notes,
        });
        result = await write(ctx, "boq_items", {
          project_id: project,
          estimate_id: estimate,
          drawing_id: m.drawing_id,
          source_page: m.page,
          data,
        });
        break;
      }
      case "calculator.item": {
        const project = requiredId(b.project),
          estimate = requiredId(b.estimate);
        const input = z
          .object({
            mode: z.enum(
              Object.keys(calculatorFields) as [Calculator, ...Calculator[]],
            ),
            inputs: z.record(z.string(), z.number().finite().nonnegative()),
            description: z.string().min(1).max(2000),
          })
          .parse(b.data);
        const calc = civil(input.mode, input.inputs);
        const data = itemSchema.parse({
          description: input.description,
          category: "Other",
          source_type: "calculated",
          ...calc,
        });
        result = await write(ctx, "boq_items", {
          project_id: project,
          estimate_id: estimate,
          data,
        });
        break;
      }
      case "ai.queue": {
        const project = requiredId(b.project),
          estimate = requiredId(b.estimate);
        const ids = z.array(id).min(1).max(20).parse(b.data);
        if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
          throw new HttpError(
            503,
            "AI credentials and model must be configured on the server.",
          );
        const docs = await Promise.all(
          [...new Set(ids)].map((d) => owned(ctx, "drawings", d, project)),
        );
        if (
          docs.some(
            (d) =>
              d.status !== "ready" ||
              d.size > 15 * 1024 * 1024 ||
              d.page_count > 50,
          )
        )
          throw new HttpError(
            400,
            "AI supports ready documents up to 15 MB and 50 pages each. Split larger documents.",
          );
        const { data, error } = await ctx.db.rpc("enqueue_analysis_jobs", {
          p_org: ctx.org,
          p_actor: ctx.user,
          p_project: project,
          p_estimate: estimate,
          p_drawings: docs.map((d) => d.id),
        });
        if (error)
          throw new HttpError(
            400,
            "Could not queue analysis. The limit is 20 documents per organisation per rolling 24 hours.",
          );
        result = data;
        break;
      }
      case "member.add": {
        if (ctx.role !== "admin")
          throw new HttpError(403, "Only admins can manage membership.");
        const input = z
          .object({ user_id: id, role: z.enum(["admin", "estimator"]) })
          .strict()
          .parse(b.data);
        const { error } = await ctx.db
          .from("organisation_members")
          .insert({ org_id: ctx.org, ...input });
        if (error)
          throw new HttpError(
            400,
            "Member could not be added. They must register first and provide their user ID.",
          );
        break;
      }
      default:
        throw new HttpError(400, "Unknown action.");
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}

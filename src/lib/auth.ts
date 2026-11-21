import "server-only";
import { sessionClient, adminClient } from "./supabase/server";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireUser() {
  const session = await sessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return { user, session };
}
export async function context(org: string) {
  const { user, session } = await requireUser();
  const { data: member, error } = await session
    .from("organisation_members")
    .select("role")
    .eq("org_id", org)
    .eq("user_id", user.id)
    .single();
  if (error || !member) throw new HttpError(403, "Organisation access denied.");
  return {
    db: adminClient(),
    org,
    user: user.id,
    role: member.role as "admin" | "estimator",
  };
}
export type Context = Awaited<ReturnType<typeof context>>;
export async function owned(
  ctx: Context,
  table: string,
  entity: string,
  project?: string,
) {
  let query = ctx.db
    .from(table)
    .select("*")
    .eq("org_id", ctx.org)
    .eq("id", entity);
  if (project) query = query.eq("project_id", project);
  const { data, error } = await query.single();
  if (error || !data) throw new HttpError(404, "Record not found.");
  return data;
}
export async function write(
  ctx: Context,
  table: string,
  values: unknown,
  entity: string | null = null,
  version: number | null = null,
  remove = false,
) {
  const { data, error } = await ctx.db.rpc("write_entity", {
    p_table: table,
    p_org: ctx.org,
    p_actor: ctx.user,
    p_id: entity,
    p_version: version,
    p_values: values,
    p_delete: remove,
  });
  if (error) {
    if (error.code === "40001")
      throw new HttpError(409, "This record changed. Reload before saving.");
    if (error.code === "23505")
      throw new HttpError(409, "This code already exists.");
    throw new HttpError(
      400,
      "The change could not be saved. Check references and required fields.",
    );
  }
  return data;
}
export async function limit(
  ctx: Context,
  bucket: string,
  count = 120,
  seconds = 60,
) {
  const { data, error } = await ctx.db.rpc("consume_limit", {
    p_org: ctx.org,
    p_bucket: bucket,
    p_limit: count,
    p_seconds: seconds,
  });
  if (error) throw new HttpError(503, "Request control unavailable.");
  if (!data)
    throw new HttpError(429, "Request limit reached. Please try again later.");
}

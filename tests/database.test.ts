import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  itemSchema,
  estimateSchema,
  rateSchema,
  type Item,
} from "../src/lib/schemas";
import {
  calibration,
  measure,
  applyRate,
  totals,
} from "../src/lib/calculations";
import { workbook } from "../src/lib/excel";
const db = new PGlite();
const userA = randomUUID(),
  userB = randomUUID();
let orgA: string, orgB: string;
async function scalar<T>(sql: string, args: unknown[] = []) {
  const result = await db.query<{ v: T }>(sql, args);
  return result.rows[0]?.v;
}
async function write(
  table: string,
  org: string,
  actor: string,
  values: unknown,
  id: string | null = null,
  version: number | null = null,
) {
  return scalar<Record<string, unknown>>(
    "select public.write_entity($1,$2,$3,$4,$5,$6,false) as v",
    [table, org, actor, id, version, JSON.stringify(values)],
  );
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users(id) values($1),($2)", [userA, userB]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userA,
  ]);
  orgA = await scalar<string>(
    "select public.create_organisation('Org A') as v",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userB,
  ]);
  orgB = await scalar<string>(
    "select public.create_organisation('Org B') as v",
  );
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
});
afterAll(() => db.close());
describe("Database isolation and transactional workflows", () => {
  it("applies all migrations with RLS enabled on every application table", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='r'",
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(14);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it("hides another organisation and denies direct browser writes and service-only functions", async () => {
    await write("projects", orgA, userA, { data: { name: "Private A" } });
    await write("projects", orgB, userB, { data: { name: "Private B" } });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      userA,
    ]);
    await db.exec("set role authenticated");
    try {
      const rows = await db.query<{ org_id: string }>(
        "select org_id from public.projects",
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows.every((r) => r.org_id === orgA)).toBe(true);
      await expect(
        db.query("insert into public.projects(org_id,data) values($1,$2)", [
          orgA,
          "{}",
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select public.claim_analysis_job()"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
  it("rejects cross-organisation parent references even through the service write gateway", async () => {
    const p = await write("projects", orgA, userA, {
      data: { name: "Parent" },
    });
    await expect(
      write("estimates", orgB, userB, {
        project_id: p.id,
        data: { name: "Foreign" },
      }),
    ).rejects.toThrow(/foreign key/);
    await expect(
      write("projects", orgA, userB, { data: { name: "Denied" } }),
    ).rejects.toThrow(/Membership/);
  });
  it("completes persisted project → drawing → calibration → measurement → rate → approval → Excel workflow", async () => {
    const p = await write("projects", orgA, userA, {
      data: { name: "Workflow fixture" },
    });
    const e = await write("estimates", orgA, userA, {
      project_id: p.id,
      data: estimateSchema.parse({ name: "Tender" }),
    });
    const did = randomUUID();
    const drawing = await write("drawings", orgA, userA, {
      id: did,
      project_id: p.id,
      name: "fixture.pdf",
      mime: "application/pdf",
      size: 100,
      path: `${orgA}/${p.id}/${did}`,
      number: "C1",
      revision: "A",
      discipline: "Drainage",
      status: "ready",
      page_count: 1,
    });
    await db.query(
      "insert into public.drawing_pages(org_id,project_id,drawing_id,page) values($1,$2,$3,1)",
      [orgA, p.id, drawing.id],
    );
    const scale = calibration(
      [
        [0, 0],
        [100, 0],
      ],
      10,
    );
    const cal = await write("takeoff_calibrations", orgA, userA, {
      project_id: p.id,
      drawing_id: did,
      page: 1,
      data: {
        points: [
          [0, 0],
          [100, 0],
        ],
        known: 10,
        scale,
      },
    });
    const geometry = measure(
      [
        [0, 0],
        [200, 0],
      ],
      scale,
      "length",
    );
    const measurement = await write("takeoff_measurements", orgA, userA, {
      project_id: p.id,
      drawing_id: did,
      page: 1,
      calibration_id: cal.id,
      data: {
        description: "Drain",
        points: [
          [0, 0],
          [200, 0],
        ],
        mode: "length",
        scale,
        ...geometry,
      },
    });
    expect((measurement.data as { quantity: number }).quantity).toBe(20);
    let item = (await write("boq_items", orgA, userA, {
      project_id: p.id,
      estimate_id: e.id,
      drawing_id: did,
      source_page: 1,
      data: itemSchema.parse({
        description: "Measured drain",
        category: "Drainage",
        source_type: "measured",
        quantity: 20,
        unit: "m",
        drawing_id: did,
        source_page: 1,
      }),
    })) as unknown as Item;
    const rate = await write("cost_rates", orgA, userA, {
      data: rateSchema.parse({
        code: "WORKFLOW",
        description: "Fixture rate",
        category: "Drainage",
        unit: "m",
        rate: 12,
        source: "Test quote",
      }),
    });
    const priced = applyRate(
      item,
      rate as unknown as Parameters<typeof applyRate>[1],
    );
    item = (await write(
      "boq_items",
      orgA,
      userA,
      priced,
      item.id,
      1,
    )) as unknown as Item;
    expect(totals([item]).total).toBe(0);
    item = (await write(
      "boq_items",
      orgA,
      userA,
      { status: "approved" },
      item.id,
      2,
    )) as unknown as Item;
    expect(totals([item]).total).toBe(240);
    await write(
      "cost_rates",
      orgA,
      userA,
      { data: { ...(rate.data as object), rate: 999 } },
      rate.id as string,
      1,
    );
    expect(item.rate_snapshot?.rate).toBe(12);
    const bytes = await workbook(
      "Workflow fixture",
      estimateSchema.parse(e.data),
      [item],
      [],
      [],
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const versions = await scalar<number>(
      "select count(*)::int as v from public.estimate_versions where estimate_id=$1",
      [e.id],
    );
    expect(versions).toBeGreaterThanOrEqual(3);
    await expect(
      write("boq_items", orgA, userA, { status: "rejected" }, item.id, 1),
    ).rejects.toThrow(/Version conflict/);
    const copy = await scalar<string>(
      "select public.duplicate_estimate($1,$2,$3) as v",
      [orgA, userA, e.id],
    );
    expect(
      await scalar<string>(
        "select status as v from public.boq_items where estimate_id=$1",
        [copy],
      ),
    ).toBe("draft");
    const actor = await scalar<string>(
      "select actor_id::text as v from public.audit_events where entity_id=$1 order by id desc limit 1",
      [item.id],
    );
    expect(actor).toBe(userA);
  });
  it("rejects approved null quantities and foreign page references", async () => {
    const p = await write("projects", orgA, userA, {
      data: { name: "Checks" },
    });
    const e = await write("estimates", orgA, userA, {
      project_id: p.id,
      data: { name: "Checks" },
    });
    await expect(
      write("boq_items", orgA, userA, {
        project_id: p.id,
        estimate_id: e.id,
        status: "approved",
        data: { description: "Unknown", quantity: null, rate: 0 },
      }),
    ).rejects.toThrow(/check constraint/);
    await expect(
      write("boq_items", orgA, userA, {
        project_id: p.id,
        estimate_id: e.id,
        drawing_id: randomUUID(),
        source_page: 1,
        data: {},
      }),
    ).rejects.toThrow(/foreign key/);
  });
  it("bounds request counts atomically", async () => {
    expect(
      await scalar<boolean>("select consume_limit($1,'test',2,60) as v", [
        orgA,
      ]),
    ).toBe(true);
    expect(
      await scalar<boolean>("select consume_limit($1,'test',2,60) as v", [
        orgA,
      ]),
    ).toBe(true);
    expect(
      await scalar<boolean>("select consume_limit($1,'test',2,60) as v", [
        orgA,
      ]),
    ).toBe(false);
  });
});

it("leases jobs with bounded concurrency and commits AI drafts exactly once", async () => {
  const p = await write("projects", orgA, userA, {
    data: { name: "AI fixture" },
  });
  const e = await write("estimates", orgA, userA, {
    project_id: p.id,
    data: { name: "AI fixture" },
  });
  const documents: string[] = [];
  for (let i = 0; i < 3; i++) {
    const did = randomUUID();
    await write("drawings", orgA, userA, {
      id: did,
      project_id: p.id,
      name: `fixture-${i}.pdf`,
      mime: "application/pdf",
      size: 100,
      path: `${orgA}/${p.id}/${did}`,
      number: "C1",
      revision: "A",
      discipline: "Drainage",
      status: "ready",
      page_count: 1,
    });
    await db.query(
      "insert into public.drawing_pages(org_id,project_id,drawing_id,page) values($1,$2,$3,1)",
      [orgA, p.id, did],
    );
    documents.push(did);
  }
  await db.query("select public.enqueue_analysis_jobs($1,$2,$3,$4,$5)", [
    orgA,
    userA,
    p.id,
    e.id,
    documents,
  ]);
  type Job = {
    id: string;
    lease_token: string;
    drawing_id: string;
    attempts: number;
  };
  const first = await scalar<Job>(
    "select to_jsonb(public.claim_analysis_job()) as v",
  );
  const second = await scalar<Job>(
    "select to_jsonb(public.claim_analysis_job()) as v",
  );
  expect(first.id).not.toBe(second.id);
  expect(
    await scalar("select to_jsonb(public.claim_analysis_job()) as v"),
  ).toBeNull();
  const items = [
    itemSchema.parse({
      description: "AI draft",
      category: "Drainage",
      quantity: null,
      unit: "m",
      source_type: "ai",
      drawing_id: first.drawing_id,
      source_page: 1,
    }),
  ];
  expect(
    await scalar<boolean>(
      "select public.finish_analysis_job($1,$2,$3,$4) as v",
      [first.id, first.lease_token, JSON.stringify(items), "{}"],
    ),
  ).toBe(true);
  expect(
    await scalar<boolean>(
      "select public.finish_analysis_job($1,$2,$3,$4) as v",
      [first.id, first.lease_token, JSON.stringify(items), "{}"],
    ),
  ).toBe(false);
  expect(
    await scalar<number>(
      "select count(*)::int as v from public.boq_items where estimate_id=$1",
      [e.id],
    ),
  ).toBe(1);
  expect(
    await scalar<string>(
      "select status as v from public.boq_items where estimate_id=$1",
      [e.id],
    ),
  ).toBe("draft");
  await db.query(
    "update public.ai_analysis_jobs set lease_until=now()-interval '1 minute',attempts=3 where id=$1",
    [second.id],
  );
  await db.query("select public.claim_analysis_job()");
  expect(
    await scalar<string>(
      "select status as v from public.ai_analysis_jobs where id=$1",
      [second.id],
    ),
  ).toBe("failed");
});

import { beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  owned: vi.fn(),
  write: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  ...mock,
  requireUser: vi.fn(),
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { POST } from "../src/app/api/workspace/route";
import { HttpError } from "../src/lib/auth";
import { itemSchema } from "../src/lib/schemas";
const org = randomUUID(),
  project = randomUUID(),
  estimate = randomUUID(),
  item = randomUUID();
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/workspace", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockResolvedValue({
    org,
    user: randomUUID(),
    role: "estimator",
  });
  mock.limit.mockResolvedValue(undefined);
  mock.owned.mockResolvedValue({
    id: item,
    org_id: org,
    project_id: project,
    estimate_id: estimate,
    data: { quantity: 10 },
    version: 2,
  });
  mock.write.mockResolvedValue({ ok: true });
});
it("rejects cross-origin mutations before database access", async () => {
  expect(
    (
      await POST(
        request({ action: "project.save", org }, "https://untrusted.example"),
      )
    ).status,
  ).toBe(403);
  expect(mock.context).not.toHaveBeenCalled();
});
it("rejects unauthenticated and foreign-organisation requests", async () => {
  mock.context
    .mockRejectedValueOnce(new HttpError(401, "Sign in"))
    .mockRejectedValueOnce(new HttpError(403, "Denied"));
  expect(
    (await POST(request({ action: "project.save", org, data: { name: "X" } })))
      .status,
  ).toBe(401);
  expect(
    (await POST(request({ action: "project.save", org, data: { name: "X" } })))
      .status,
  ).toBe(403);
  expect(mock.write).not.toHaveBeenCalled();
});
it("validates project input and blocks fields outside the schema", async () => {
  const r = await POST(
    request({
      action: "project.save",
      org,
      data: { name: "X", org_id: randomUUID() },
    }),
  );
  expect(r.status).toBe(400);
  expect(mock.write).not.toHaveBeenCalled();
});
it("requires a known quantity before approval", async () => {
  mock.owned.mockResolvedValue({
    id: item,
    estimate_id: estimate,
    data: { quantity: null },
  });
  const r = await POST(
    request({
      action: "item.approve",
      org,
      project,
      estimate,
      id: item,
      version: 2,
    }),
  );
  expect(r.status).toBe(400);
  expect(mock.write).not.toHaveBeenCalled();
});
it("approval is a separate explicit mutation with a version check", async () => {
  const r = await POST(
    request({
      action: "item.approve",
      org,
      project,
      estimate,
      id: item,
      version: 2,
    }),
  );
  expect(r.status).toBe(200);
  expect(mock.write).toHaveBeenCalledWith(
    expect.anything(),
    "boq_items",
    { status: "approved" },
    item,
    2,
  );
});
it("denies membership administration to estimators", async () => {
  const r = await POST(
    request({
      action: "member.add",
      org,
      data: { user_id: randomUUID(), role: "admin" },
    }),
  );
  expect(r.status).toBe(403);
});
it("rejects drawing MIME/extension mismatch before issuing an upload URL", async () => {
  const r = await POST(
    request({
      action: "upload.start",
      org,
      project,
      data: {
        name: "file.exe",
        mime: "application/pdf",
        size: 10,
        revision: "A",
        discipline: "Other",
      },
    }),
  );
  expect(r.status).toBe(400);
  expect(mock.write).not.toHaveBeenCalled();
});
it("returns a stale-write conflict instead of overwriting", async () => {
  mock.write.mockRejectedValue(new HttpError(409, "Version conflict"));
  const r = await POST(
    request({
      action: "project.save",
      org,
      id: project,
      version: 1,
      data: { name: "X" },
    }),
  );
  expect(r.status).toBe(409);
});

it("labels manually revised takeoffs as manual and returns them to draft", async () => {
  const original = itemSchema.parse({
    description: "Measured pipe",
    category: "Drainage",
    quantity: 10,
    unit: "m",
    rate: 25,
    source_type: "measured",
  });
  mock.owned.mockResolvedValue({
    id: item,
    estimate_id: estimate,
    data: original,
    rate_snapshot: { code: "SAVED", rate: 25 },
    version: 2,
  });
  const result = await POST(
    request({
      action: "item.save",
      org,
      project,
      estimate,
      id: item,
      version: 2,
      data: { ...original, quantity: 12 },
    }),
  );
  expect(result.status).toBe(200);
  expect(mock.write).toHaveBeenCalledWith(
    expect.anything(),
    "boq_items",
    expect.objectContaining({
      status: "draft",
      data: expect.objectContaining({ source_type: "manual", quantity: 12 }),
      rate_snapshot: { code: "SAVED", rate: 25 },
    }),
    item,
    2,
  );
});

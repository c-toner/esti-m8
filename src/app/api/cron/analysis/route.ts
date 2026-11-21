import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/ai-worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization") ?? "";
  const token = expected ? `Bearer ${expected}` : "";
  if (
    !token ||
    actual.length !== token.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(token))
  )
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
    return NextResponse.json(
      { error: "AI is not configured" },
      { status: 503 },
    );
  try {
    return NextResponse.json(await processOneJob(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Worker unavailable" }, { status: 503 });
  }
}

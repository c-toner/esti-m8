import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const input = z
      .object({
        action: z.enum(["login", "signup", "logout"]),
        email: z.string().email().optional(),
        password: z.string().min(10).max(128).optional(),
      })
      .parse(await request.json());
    const db = await sessionClient();
    if (input.action === "logout") {
      await db.auth.signOut();
      return NextResponse.json({ ok: true });
    }
    if (!input.email || !input.password)
      return NextResponse.json(
        { error: "Email and password required." },
        { status: 400 },
      );
    const { error } =
      input.action === "login"
        ? await db.auth.signInWithPassword({
            email: input.email,
            password: input.password,
          })
        : await db.auth.signUp({
            email: input.email,
            password: input.password,
          });
    return error
      ? NextResponse.json(
          {
            error:
              input.action === "login"
                ? "Sign-in failed. Check your credentials and confirm your email."
                : "Account could not be created. Please try again.",
          },
          { status: 400 },
        )
      : NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to process sign-in. Check configuration and input." },
      { status: 400 },
    );
  }
}

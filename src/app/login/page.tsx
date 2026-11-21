"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export default function Login() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  return (
    <main className="login">
      <div className="login-brand">
        <div className="brand-mark">CE</div>
        <h1>Civil Estimator</h1>
        <p>From drawing evidence to a reviewed tender.</p>
        <div className="login-line" />
        <p>Australian civil works · AUD · Estimator controlled</p>
      </div>
      <form
        className="panel login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const f = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: signup ? "signup" : "login",
                email: f.get("email"),
                password: f.get("password"),
              }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            if (signup)
              setMessage(
                "Check your email to confirm your account, then sign in.",
              );
            else {
              router.push("/");
              router.refresh();
            }
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">YOUR ESTIMATING WORKSPACE</span>
        <h2>{signup ? "Create an account" : "Welcome back"}</h2>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
        </label>
        <Button disabled={busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setSignup(!signup)}
        >
          {signup ? "Use an existing account" : "Create an account"}
        </Button>
        <p role="status">{message}</p>
      </form>
    </main>
  );
}

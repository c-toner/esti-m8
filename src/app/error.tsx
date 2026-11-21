"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="panel">
      <h1>We couldn’t load this workspace</h1>
      <p>Please retry. If this persists, check the Supabase configuration.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}

import { redirect } from "next/navigation";
import { configured, sessionClient } from "@/lib/supabase/server";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!configured())
    return (
      <main className="setup panel">
        <span className="eyebrow">CIVIL ESTIMATOR</span>
        <h1>Connect your workspace</h1>
        <p>
          The application needs a Supabase project before you can sign in and
          save estimates.
        </p>
        <ol>
          <li>
            Apply the SQL migrations in <code>supabase/migrations</code> in
            order.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and enter
            your Supabase keys.
          </li>
          <li>Restart the application and create your account.</li>
        </ol>
        <p>
          See <code>docs/DEPLOYMENT.md</code> for the complete setup, Storage
          and AI worker instructions.
        </p>
      </main>
    );
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return <Workspace email={user.email ?? ""} />;
}

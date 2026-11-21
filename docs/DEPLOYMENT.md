# Supabase and Vercel setup

## 1. Create Supabase infrastructure

1. Create a new Supabase project in the region appropriate for your organisation. Use a separate project for preview/staging and production.
2. Open the project's SQL Editor and run these migration files **in order**, once each:
   - `supabase/migrations/202611210001_foundation.sql`
   - `supabase/migrations/202611210002_mutations.sql`
   - `supabase/migrations/202611210003_jobs.sql`
   - `supabase/migrations/202611210004_hardening.sql`
3. Verify the `documents` Storage bucket exists, is **private**, and has a 20 MiB limit. The app deliberately creates no browser Storage read/write policies. The server issues scoped signed URLs; do not make the bucket public or add permissive policies.
4. In Authentication → Providers, enable email/password sign-in. Keep email confirmation enabled for production. Configure SMTP for reliable confirmation messages and review Supabase's authentication rate limits.
5. In Authentication → URL Configuration, set Site URL to the deployed application origin; use `http://localhost:3000` for local development. Add the relevant local/staging URLs to the redirect allowlist. After confirming email, sign in with email/password; this app does not require an automatic sign-in callback from the email link.
6. From project settings, obtain the project URL, anon/publishable client key and server service-role key. The `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable accepts the client key. Never put the service-role key in a `NEXT_PUBLIC_` variable.
7. Start the application, register, confirm email, and sign in. Create an organisation. The first member is its admin. Other users register first; an admin adds their Supabase Auth user UUID through Settings. User UUIDs are available to the project administrator in the Supabase Authentication user list.

SQL files are versioned migration sources. If you prefer the Supabase CLI, initialise/link the project using the installed CLI's current instructions and apply the same files with `supabase db push`; do not apply the SQL-editor method and then push the same unrecorded migrations again. See [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations).

## 2. Environment variables

Copy `.env.example` to `.env.local`. Configure the following in local development and in the correct Vercel environment scopes:

| Variable                        | Purpose                                                                                                           | Exposure             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                                                                              | Browser/server       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon or publishable client key                                                                           | Browser/server       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Authenticated server writes, signed URLs and worker                                                               | Server secret        |
| `OPENAI_API_KEY`                | API key for document analysis                                                                                     | Server secret        |
| `OPENAI_MODEL`                  | An account-accessible model supporting vision/file inputs, Responses structured outputs and background processing | Server configuration |
| `CRON_SECRET`                   | A long random secret protecting the scheduled worker                                                              | Server secret        |

The first three enable the estimating application. The final three enable asynchronous AI analysis. Generate `CRON_SECRET`, for example with `openssl rand -hex 32`, and store it in your secret manager/Vercel. Do not commit `.env.local`.

`OPENAI_MODEL` intentionally has no default: the prototype's `gpt-4.1-mini` is marked deprecated in [official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini). Select and test an available model for your account and document set before enabling production analysis. The implementation uses the installed SDK's Responses API and Zod structured-output helper; see [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [background mode](https://developers.openai.com/api/docs/guides/background).

## 3. Run and verify locally

```sh
cd /Users/conor/dev/personal/civil-estimator
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

The app uses port 3000 by default. For browser tests, install Chromium if necessary with `npx playwright install chromium`, then run `npm run test:e2e`. Browser fixtures contain synthetic test-only rates, never application seed data.

To process an AI job locally, queue a document in the UI and invoke the worker with your configured secret:

```sh
curl --fail -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/analysis
```

The shell must have `CRON_SECRET` set; Next.js reads `.env.local` but your shell does not automatically do so. Invoke again after the job's next eligible time to poll completion. In production the scheduler performs these calls without an open browser.

## 4. GitHub and Vercel

1. Create a private GitHub repository for this source and push the project, including `package-lock.json`, SQL migrations and `.github/workflows/checks.yml`. Exclude `.env.local`, `node_modules`, `.next` and test traces. No remote repository has been created or pushed as part of this implementation.
2. In Vercel choose **Add New → Project → Import Git Repository** and select it.
3. Select the Next.js framework, repository root directory, install command `npm ci`, build command `npm run build`, and the default Next.js output directory.
4. Use Node.js **26.x**, matching the locally verified runtime. Vercel currently supports it; see [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
5. Add all six environment variables to Production. Configure Preview separately with staging Supabase/OpenAI credentials. `NEXT_PUBLIC_` values are embedded at build time, so redeploy after changing them.
6. Deploy. Set Supabase's production Site URL/allowlist to the final HTTPS origin. Test registration/login, a private upload and the acceptance workflow below.
7. Verify the `/api/cron/analysis` cron registration and successful authenticated invocation in Vercel. `vercel.json` schedules once per minute. **This requires a Vercel plan supporting minute-level cron, currently Pro/Enterprise.** Hobby's daily-only cron rejects this configuration; use an appropriate plan or remove the cron declaration and arrange an authenticated external scheduler. See [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
8. Preview deployments need an explicitly configured staging scheduler or manual worker calls; do not assume production cron also runs on previews.

## 5. Live acceptance checklist

Run in staging with two separate organisations:

1. Register/confirm/sign in; create a project and estimate.
2. Upload a PDF and verify the unauthenticated Storage URL is inaccessible.
3. Open it, calibrate a known 10 m dimension, measure a second length, rotate/zoom and confirm the result is unchanged.
4. Save a takeoff and add it to the draft BOQ. Add a verified rate, apply it and approve the item. Confirm totals change only at approval.
5. Edit its quantity: verify it returns to draft. Reapprove, export Excel and open it in Microsoft Excel. Review approved/review sheets and formulas.
6. Change the saved library rate: confirm the existing estimate retains its snapshot price and source. Duplicate/reopen the estimate; confirm copied items require review.
7. Upload another revision: verify it has no inherited calibration.
8. Queue one small AI document. Confirm queued → running → completed, source page/evidence retention, zero generated prices and draft-only suggestions. Test a failed request and a retry.
9. Sign in under the second organisation. Attempt first-organisation UUIDs in API requests and direct PostgREST reads. Confirm no data or document URL is returned.
10. Verify job execution survives closing the browser, confirm Supabase backups/restore, set OpenAI spending limits and check logs for failures.

A local build and mocked browser test are not proof of a working hosted deployment. These live checks remain required.

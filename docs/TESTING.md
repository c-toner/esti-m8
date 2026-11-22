# Verification record

Verified locally on 21 November 2026 using Node.js 26.5.0.

| Check                               | Result                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| TypeScript strict check             | Passed                                                      |
| ESLint                              | Passed                                                      |
| Next.js production build            | Passed                                                      |
| Unit/API/PostgreSQL/Excel tests     | 40 passed                                                   |
| Browser workflow (mocked services)  | 1 passed                                                    |
| Production server smoke test        | Passed (setup page, no browser errors, cron authentication) |
| Original Python tests               | 13 passed                                                   |
| npm dependency audit after override | 0 known vulnerabilities at verification time                |

## What the automated checks cover

`tests/core.test.ts`: financial rounding, approval exclusion, invalid inputs, rate snapshot independence, tenant/unit mismatch, calibration, polyline length, polygon area/volume, self-intersection, civil calculator formulas, Zod validation, CSV atomic prevalidation and formula escaping, AI evidence/page checks.

`tests/database.test.ts`: applies all SQL migrations to PGlite with simulated Supabase Auth/Storage schemas; tests actual PostgreSQL RLS, browser-write/function denial, composite cross-tenant foreign keys, persisted drawing/calibration/measurement/BOQ/rate/approval workflow, version conflicts, audit attribution, duplicate-estimate draft status, job leases/concurrency/recovery and exactly-once ingestion.

`tests/api.test.ts`: Route Handler origin enforcement, unauthenticated/foreign-org rejection, strict field validation, missing-quantity approval prevention, explicit versioned approval, admin-only member changes, upload MIME/extension mismatch and stale-write responses. Authentication/database adapters are mocked at this boundary; database policies are independently exercised by SQL tests.

`tests/excel.test.ts`: workbook creation/reopening with ExcelJS, approved-only formula totals, separate draft/rejected rows, safe string cells, empty-workbook formulas, real PDF page counting and content validation.

`tests/browser/workflow.spec.ts`: renders the actual login/workspace/viewer components in a test-only Vite harness, with Next router adapters and mocked external service responses. Uses Chromium and real PDF.js rendering. Completes sign-in, project/estimate creation, PDF upload, calibration, saved measurement, rotation, rate creation/application, explicit approval and an Excel download that is reopened and checked. It also verifies that a new drawing revision has no inherited calibration and that switching back restores the original calibration. It is not a test of hosted authentication or Storage.

`docs/screenshots/boq-browser-fixture.png` is a browser test capture with synthetic data. It is not a real client project or market price.

A separate Chromium smoke check against `next start` confirmed the unconfigured production home returns HTTP 200, renders the setup page without browser errors, and rejects an unauthenticated cron request with HTTP 401. Hosted workflows still require credentials.

## Reproduce

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The 13 prototype tests in the historical record were run before the Python source was removed. They are not part of the current Next.js test suite.

## Not verified externally

No real Supabase credentials, OpenAI key/model, GitHub remote or Vercel project were configured. Microsoft Excel desktop opening/recalculation is also unverified. Use the live acceptance checklist in `DEPLOYMENT.md`; passing local checks does not replace it.

## Historical Vercel services import verification

After explicitly declaring the root Next.js `app` service, `npx vercel dev --local --listen 4176` detected only `app` and started successfully. HTTP checks through Vercel's router passed for `/`, `/login`, a generated `/_next/static/*` asset and `/pdf.worker.min.mjs` (200). The cron endpoint rejected missing authorisation (401). `/api/workspace` reached the application and returned its expected unconfigured-Supabase error (400); hosted authentication was not exercised.

A clean `npm ci` reported zero known vulnerabilities. Lint, strict typecheck, all 40 tests and the production build passed. This was the earlier services configuration. It has since been replaced by standard Next.js configuration after removal of the Python prototype.

## Next.js-only deployment verification — 22 November 2026

Removed the archived Python application and switched to the standard root Next.js Vercel configuration. No service declarations, bindings or cron schedules are enabled by default. ESLint, strict TypeScript, all 40 current tests and the production build passed. `vercel dev --local --listen 3000` started the Next.js app without detecting a Python service; the home/setup page and PDF worker both returned HTTP 200. Supabase credentials and AI scheduling remain external setup requirements. No remote deployment was performed.

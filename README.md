# Civil Estimator

A Next.js application for Australian civil estimating: projects → private drawings → calibrated takeoffs / AI draft suggestions → reviewed BOQ → saved rates → Excel.

The application runs entirely on Next.js and TypeScript, with Supabase for authentication, PostgreSQL and private file storage. The archived Python prototype has been removed from this repository.

## Vercel deployment

`vercel.json` uses Vercel's standard Next.js integration at the repository root. Pages, assets and API routes are handled by Next.js without service declarations, bindings or catch-all rewrites. Node.js is pinned to 26.x.

The default configuration has no scheduled jobs and can be imported without a minute-level cron plan requirement. AI analysis still needs the authenticated worker to run regularly; configure Vercel cron on a suitable plan or an external scheduler using [the deployment guide](docs/DEPLOYMENT.md#ai-worker-scheduling). Until configured, AI jobs remain queued.

## Start locally

Use Node.js 26 (verified locally with 26.5.0), then:

```sh
npm ci
cp .env.example .env.local
# Configure the environment and apply migrations using docs/DEPLOYMENT.md.
npm run dev
```

Open http://localhost:3000. Without Supabase configuration the app shows setup instructions. With configuration it requires sign-in; no demo data or default prices are inserted.

## Implemented workflows

- Email/password signup, login/logout, organisation onboarding, admin/estimator roles, membership checks, read RLS and service-only transactional writes.
- Projects with client, location, region, tender metadata and status. Estimates reopen, duplicate, retain BOQ/header snapshots and show project audit history.
- Direct private Storage uploads with progress, extension/MIME/content checks, upload limits, drawing metadata and immutable revision identities. Short-lived document retrieval.
- PDF.js/image viewer with page selection, zoom, pan, rotation, independent page/revision calibrations, saved length/area/volume takeoffs, annotations, editing/deletion and draft BOQ creation.
- Editable/searchable/filterable/sortable BOQ with manual drawing references, explicit approval/rejection, optimistic concurrency, automatic return to draft on edits, and decimal financial calculations.
- Organisation-owned rate library with CRUD/archive, CSV import/export, unit matching, supplier/source/date snapshots and historical price preservation.
- Trench, bedding, backfill, pavement, concrete and spoil calculators with exposed formulas and assumptions.
- Durable PostgreSQL/OpenAI background analysis jobs: bounded concurrency, leases, retries, daily quotas, validated structured output and draft-only ingestion.
- ExcelJS workbooks with summary, approved BOQ, separate review items, quantity takeoffs, drawing references, rate sources, assumptions/exclusions and review status.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The browser test uses real application components and PDF.js, with mocked authentication and external API responses. Database tests apply the migrations to PGlite and exercise real PostgreSQL RLS/constraints/functions with mocked Supabase Auth/Storage schemas. These tests do not establish that a hosted Supabase project or Vercel deployment works. See [test evidence and boundaries](docs/TESTING.md).

## Source map

| Path                                        | Responsibility                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `src/app`                                   | App Router pages, auth/workspace/worker Route Handlers                     |
| `src/components`                            | Workspace, edit dialogs, uploads, viewer and calculators                   |
| `src/components/ui`                         | shadcn-compatible Radix/CVA button primitive                               |
| `src/lib/auth.ts`                           | Session checks, membership, scoped lookups, write gateway and limits       |
| `src/lib/calculations.ts`                   | Financial arithmetic, geometry, civil calculations, rate snapshots         |
| `src/lib/schemas.ts`                        | Strict Zod input contracts and domain types                                |
| `src/lib/ai-*`                              | Structured extraction and durable processing                               |
| `src/lib/excel.ts`                          | Workbook generation                                                        |
| `src/lib/documents.ts`, `zip-validation.ts` | Content and archive validation                                             |
| `supabase/migrations`                       | Tables, RLS, composite references, transactions, history and job functions |
| `tests`                                     | Unit, SQL integration, API-boundary and browser workflow tests             |
| `.github/workflows/checks.yml`              | GitHub CI checks                                                           |
| `vercel.json`                               | Scheduled AI worker invocation                                             |

## Configuration and handover

- [Exact Supabase and Vercel setup](docs/DEPLOYMENT.md)
- [Migration notes and rate CSV transfer](docs/MIGRATION.md)
- [Security model, limits and remaining production work](docs/OPERATIONS.md)
- [Verification record](docs/TESTING.md)
- [Implementation phase record](IMPLEMENTATION_PLAN.md)

Live Auth/Storage/OpenAI calls and deployment have not been verified. Configure infrastructure and run the live acceptance checklist before using estimates for tendering.

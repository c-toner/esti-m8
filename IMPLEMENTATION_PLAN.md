# Migration phase record

- [x] Phase 1 — Next.js foundation, authentication, organisation RLS, projects and private uploads implemented.
- [x] Phase 2 — Decimal estimating, editable/reviewed BOQ, rates and snapshots, CSV and Excel export implemented.
- [x] Phase 3 — PDF/image viewer, per-revision/page calibration, document-coordinate geometry and saved takeoffs implemented.
- [x] Phase 4 — Structured OpenAI integration, durable job leases, quotas, retries and draft review implemented.
- [x] Phase 5 — Automated local verification, security checks, build fixes and deployment documentation implemented.
- [ ] External acceptance — configure Supabase, OpenAI/model, GitHub and Vercel; verify live sign-in/upload/analysis/isolation/export and Microsoft Excel.

## Baseline

The original Python source was inspected during migration and subsequently removed from the repository at the user's request. The supplied ZIP and Git history preserve it. It implements session-only BOQ editing, approval-filtered totals, raster-pixel manual takeoff, SQLite rate CRUD/CSV, OpenAI extraction and Excel export. It has no authentication, organisation isolation or saved project/estimate database. All 13 original pure-Python tests pass.

## Decisions

- Preserve overhead/contingency/markup order, with explicit Decimal line-cent rounding.
- Browser database writes are denied; validated server mutations require membership, scoped lookups and service-only SQL functions. RLS restricts direct reads.
- Store calibration snapshots against immutable drawing identities and exact pages.
- Snapshot applied rate provenance; edits reset item approval.
- Use PostgreSQL leases and OpenAI background Responses, avoiding a long-running request or local worker dependency.
- No seed market rates. No secrets committed. No real external deployment claimed.

## Current verification

40 automated unit/API/SQL/Excel tests; 1 mocked browser workflow; strict typecheck, lint and production build pass. See `docs/TESTING.md` for boundaries and `docs/OPERATIONS.md` for explicit limitations. Re-run checks after final changes.

# Security, reliability and operating limits

## Authorisation model

Supabase Auth validates the session on every protected server request. The server checks membership before creating its service client and scopes all record lookups by organisation; project relationships are checked separately. Cross-organisation composite foreign keys provide a second boundary. Browser PostgREST access is read-only under RLS. Mutation functions are executable only by `service_role`, and the server validates strict Zod contracts before calling them. Admin-only membership creation is checked server-side.

The service key must remain server-only. RLS does not restrict the service role; never add a route that accepts an unvalidated table name or bypasses membership/scoped lookups. The generic write SQL function has its own table allowlist and membership check. Versioned edits reject stale version numbers instead of overwriting another estimator's changes.

Storage objects use `org/project/drawing` paths. Uploads receive exact-path signed URLs with no overwrite option. Finalisation validates size/content before marking a document ready. Retrieval is authenticated, then produces a five-minute signed URL. These URLs are bearer capabilities until expiry; they are not public permanent document links. AI requests receive a one-hour URL for the chosen document. No application content is stored on the Vercel filesystem.

## Estimates and calculations

Only approved items enter tender totals. Unknown quantities cannot be approved. A zero rate requires a UI confirmation, remains visible in the workbook and should be reviewed before tender submission. Editing or repricing a line returns it to draft. Applying a rate snapshots its complete provenance; library edits have no effect on existing estimates. Editing description/quantity preserves the snapshot when rate and unit remain unchanged. Manual rate/unit changes clear it. Manually editing a measured/calculated/AI quantity or its source relabels the item as manual, records its previous origin in the notes, and requires reapproval.

Money uses Decimal.js with half-up rounding to two decimals for each line, then each allowance. Quantities and geometry use validated finite numeric inputs. The UI shows markup and effective profit margin separately. Costs are grouped by category server-side, including labour/plant/materials/subcontractors. All totals are AUD excluding GST.

Calibrations are immutable and tied to one uploaded drawing/page. Recalibration affects new measurements; existing measurements and BOQ lines retain snapshots. Editing/deleting a takeoff does not silently change a BOQ line previously created from it. Polygon edges must not intersect. A uniform scalar calibration assumes an undistorted drawing; nonuniform scan distortion, curved geometry, CAD layers, polygon holes and cut/fill surfaces are not supported.

## AI worker

The scheduler claims one job per invocation using row locks, a two-minute lease and a lease token. At most two worker leases are active concurrently. It starts a background Responses request or polls a stored response ID. Provider completion is validated and ingested transactionally once; all items are draft with zero rates. Failure recovery reclaims expired leases, with at most three creation attempts and three consecutive transient failures. Jobs expire after 24 hours.

Limits: 20 documents per organisation per rolling 24 hours; up to 20 queued in one request; 15 MiB/50 pages per analysed document; 60,000 characters for extracted text/spreadsheets; 200 suggestions and 12,000 output tokens per document. Split larger inputs explicitly; they are not silently truncated. These are application safeguards, not a guaranteed currency spend cap. Configure account/project spending limits with OpenAI.

There is an unavoidable external-request/checkpoint window: a process crash after OpenAI accepts a request but before its response ID is stored can create a duplicate provider request on retry. Database ingestion is exactly once for a job, but provider requests are at least once and may incur additional cost. Provider responses are deleted after successful ingestion where possible; failures may remain subject to provider retention. Background processing uses temporary provider storage and is unsuitable for a promise of zero data retention. Do not represent model evidence as independently verified; the estimator must check the original source.

## Current limits and remaining production work

- Hosted Supabase Auth/Storage, a real OpenAI request, Microsoft Excel desktop and Vercel have not been exercised in this implementation session. Run the staging checklist in `DEPLOYMENT.md` before production use.
- Browser end-to-end testing uses mocked services. SQL tests use PGlite with Auth/Storage schemas stubbed, so they validate PostgreSQL logic but not hosted Supabase service configuration.
- Viewer uploads: PDF, PNG, JPEG; supporting documents: XLSX, TXT, CSV. DOCX, legacy XLS and CAD formats are not supported. A PDF has a maximum of 500 pages. XLSX expansion is limited to 64 MiB total, 32 MiB per entry and 10,000 rows. Content validation is not malware scanning.
- Each queried dataset is paged from PostgreSQL with a 10,000-record limit; oversized datasets fail explicitly rather than producing incomplete tender totals. Recent UI history shows 100 audit events and 20 snapshots; older records remain in PostgreSQL.
- Signup/email confirmation and login/logout are implemented. Password reset, MFA enrolment, invitation emails, self-service member removal and billing are not implemented. Administrators manage those account lifecycle needs in Supabase until extended.
- Settings/BOQ changes save explicitly; no background autosave is used. Edit dialogs warn on discard/page exit. Final tender approval is item-level; there is no separate estimate freeze/signature or contractual approval workflow.
- Archive rates instead of hard deletion. Projects have an Archived status. Retention/deletion policy, backups, alert routing, failed-job monitoring and scheduled pruning of old rate-limit rows need organisation-specific operating configuration.
- The committed cron schedule requires minute-level scheduling. Verify plan limits and real invocation timing in staging. Preview environments need their own worker scheduling.

No production deployment is claimed. The application source is ready for infrastructure configuration and staging acceptance.

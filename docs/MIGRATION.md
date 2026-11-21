# Migration from the Python prototype

## Inspected baseline

The supplied ZIP contains 16 entries: Streamlit UI, OpenAI extraction, measurement utilities, SQLite rate-library code, workbook exporter, tests and configuration examples. It does not contain an actual SQLite rate database or saved project data.

Working pure-Python behaviour was verified with the reference test suite: **13 tests passed**. The Streamlit UI and live OpenAI requests were inspected in source, not exercised with external credentials.

| Prototype                          | Migration                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Session-state BOQ and project name | Persisted projects, estimates and BOQ with versions                           |
| No authentication/tenant boundary  | Supabase Auth, organisation memberships, RLS and server-authorised writes     |
| Local SQLite rates                 | Organisation-owned PostgreSQL rates                                           |
| Fixed raster display pixels        | Unrotated PDF/image document coordinates; page/revision calibration snapshots |
| Session-only takeoffs              | Persisted calibration, geometry and notes; explicit BOQ snapshot creation     |
| Synchronous OpenAI request         | Durable per-document jobs and background Responses polling                    |
| Float financial calculations       | Decimal multiplication and explicit half-up cent rounding                     |
| Rate application clears approval   | Preserved; all item changes require reapproval                                |
| Three-sheet workbook               | Eight-sheet export with approved totals and separate review items             |

Overhead and contingency remain percentages of direct cost. Profit markup applies to direct cost plus both allowances. The migration rounds each line to cents before aggregation, then each allowance/markup to cents, preventing fractional-cent inconsistencies. This intentionally differs from summing unrounded floating-point lines in the prototype.

## Transfer existing rates

1. Run the reference app against your existing SQLite database using its original environment.
2. Export rates with **Export rate library CSV**.
3. Open **Cost Library → Import CSV** in the new app.
4. Required headers: `code,description,unit,rate`. Optional: `category,supplier,region,effective_date,source,notes,archived`.
5. ISO dates use `YYYY-MM-DD`. Blank dates remain unknown. The prototype category `Subcontract` is mapped to `Subcontractors`.
6. All rows are validated before a transactional import. Matching codes update the library only; historical BOQ snapshots do not change. Duplicate codes within the incoming CSV are rejected.

There are no fabricated default market prices. The synthetic rates under `tests/` exist only as test fixtures.

## Transfer other content

The prototype did not persist projects, BOQs or takeoffs. Re-upload original documents into a new project, retain their drawing numbers/revisions, and recreate/calibrate takeoffs. Existing exported BOQ workbooks can be uploaded and analysed into draft suggestions, but this is not a lossless historical-estimate import. Independently verify quantities, approvals and rate provenance.

Reference source files are preserved unchanged. Python caches created during baseline testing are excluded by `.gitignore`.

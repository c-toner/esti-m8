# AI Civil Estimator — OpenAI-integrated prototype

Upgraded from the original Streamlit civil estimator MVP. This prototype adds OpenAI multimodal analysis of PDF pages and images, structured draft BOQ extraction, editable rates and quantities, verifiable source references, estimator approvals, and Excel export.

## Start

Requires Python 3.10+ and an OpenAI API key with access to a vision-capable model.

```bash
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # On Windows, copy .env.example .env
# Edit .env and set OPENAI_API_KEY
streamlit run app.py
```

Run tests with `python -m pytest -q`.

## Workflow

1. Enter a project name and upload PDFs, PNG/JPG images, TXT or CSV files. Max 15 MB each.
2. Click **Analyse with OpenAI**. The app renders up to 5 pages per PDF by default (up to 12 total image pages) and sends those images and extracted text to OpenAI using the Responses API.
3. Review the draft BOQ. Each AI row starts **unapproved**, with zero rate. Unknown quantities are blank. Review source file, page, evidence, method and warnings.
4. Enter/adjust quantities and unit rates, approve verified rows, and set overheads, contingency and profit markup.
5. Download Excel with BOQ, formulas, source references, approval flags and warnings.

## Important limitations

- This is a **local, single-user prototype**. It has no user authentication, persistent database or role-based access controls.
- AI interprets text and drawing images; it **does not perform calibrated geometric takeoff**. It may misread annotations, and page references can be incorrect even after automated range checks. Verify against original drawings.
- It does **not** supply market rates. All rates must be entered and verified by the estimator.
- Only pages selected by the page cap are analysed. Multi-sheet plans may be incomplete.
- No native DWG/DXF support, automated scale calibration, revision comparison, quote import, or scanned-PDF OCR pipeline beyond vision interpretation.
- Uploaded documents are transmitted to OpenAI only when Analyse is clicked. Do not upload confidential client drawings without permission and an appropriate data-processing agreement. Requests set `store=False`; review OpenAI's current data-handling terms separately.
- OpenAI usage incurs API charges. Network/API access is needed; the API integration cannot be exercised offline.
- All totals exclude GST; profit is a markup on subtotal + overhead + contingency, not a gross-margin calculation.
- All estimate data lives in the Streamlit session and may disappear on refresh/restart. Export before closing.
- Review every line before use in a real tender. No production-readiness claim.

## Files

- `app.py` — Streamlit interface
- `ai_analysis.py` — OpenAI Responses API + PDF/image preparation + structured schema
- `engine.py` — validated quantities and deterministic calculations
- `exporter.py` — Excel workbook with formulas and review traceability
- `tests/test_engine.py` — calculation and reference tests

## Future production work

Implement calibrated measurement tools, persisted projects and drawing revisions, secure tenant isolation, cost library, supplier quote imports, automated regression testing against real engineering plans, and deployment/monitoring before commercial use.

## NEW: calibrated manual takeoff (highest-priority upgrade)

Upload a PDF or image and open **2 · Calibrated drawing takeoff**. Select a drawing and page, choose **Calibrate**, click two endpoints of a dimension known from the plan, and press **Add selected point** after each click. Enter the real distance in **metres** and press **Set / update calibration**. Switch to **Measure**, click/add vertices, and choose **Length**, **Area**, or **Volume**. Volume multiplies the measured plan area by a **verified uniform depth/thickness**; it is not an earthworks cut/fill surface model. Click **Add measured quantity to draft BOQ**. This creates an unapproved, zero-rate line with source file, page and calculation method.

This is a *human-controlled 2D pixel takeoff*, not automatic geometry recognition or a substitute for a licensed survey/CAD takeoff. Calibration is specific to the displayed page, and accuracy depends on source resolution, distortion, calibration points and manual placement. Use a known dimension near the area being measured and independently verify against drawings. Do not assume drawings are to scale. The viewer does not account for multiple scales on one sheet, curved edges between vertices, sloped surfaces, complex excavation batters, or PDF georeferencing. All new BOQ lines require explicit approval.

## NEW: local construction cost database

The **3 · Construction cost rate library** section stores your own verified unit rates in a local SQLite database (`data/cost_rates.sqlite3` by default). Add or update records by unique code, including category, description, unit, AUD rate, supplier, NSW/other region, effective date, source/quote reference and inclusions/exclusions notes. Import/export CSV, delete entries and explicitly apply a saved rate to a BOQ line. Rates are **not automatically guessed, fetched or applied**. Applying a rate requires an exact unit match and resets the BOQ item's approval for re-review. The Excel BOQ includes rate code, source, date and supplier columns.

Use `CIVIL_RATES_DB=/path/to/rates.sqlite3` to override the storage location. Back up this file: the database persists rates, **not entire projects/BOQs**. CSV columns: `code,description,category,unit,rate,supplier,region,effective_date,source,notes`. Duplicate codes update existing entries. Import validation rolls back the whole file if any row is invalid. Keep supplier quotes and rate dates current; rates exclude GST unless you explicitly decide otherwise. This is a single-user local database without authentication or shared-company access.

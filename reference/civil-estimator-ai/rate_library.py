"""Local SQLite rate library. Rates are user-supplied, never market-price guesses."""
import csv
import io
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

COLUMNS = ('code','description','category','unit','rate','supplier','region','effective_date','source','notes')

def connect(path='data/cost_rates.sqlite3'):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path)
    db.row_factory=sqlite3.Row
    db.execute('''CREATE TABLE IF NOT EXISTS rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL, rate REAL NOT NULL CHECK(rate >= 0),
        supplier TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
        effective_date TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)''')
    db.commit(); return db

def list_rates(db):
    return [dict(r) for r in db.execute('SELECT * FROM rates ORDER BY category, code')]

def save_rate(db, record, commit=True):
    code=str(record.get('code','')).strip()
    desc=str(record.get('description','')).strip()
    unit=str(record.get('unit','')).strip()
    if not code or not desc or not unit: raise ValueError('Code, description and unit are required')
    try: rate=float(record.get('rate'))
    except (TypeError,ValueError): raise ValueError('Rate must be a nonnegative number')
    import math
    if not math.isfinite(rate) or rate < 0: raise ValueError('Rate must be finite and nonnegative')
    vals={k:str(record.get(k,'') or '').strip()[:500] for k in COLUMNS if k!='rate'}
    vals.update(code=code[:80],description=desc[:350],unit=unit[:30],rate=rate)
    vals['updated_at']=datetime.now(timezone.utc).isoformat()
    fields=list(COLUMNS)+['updated_at']
    db.execute(f'''INSERT INTO rates ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})
      ON CONFLICT(code) DO UPDATE SET {','.join(f'{k}=excluded.{k}' for k in fields if k!='code')}''', [vals[k] for k in fields])
    if commit: db.commit()

def delete_rate(db, code):
    db.execute('DELETE FROM rates WHERE code=?',(code,)); db.commit()

def import_csv(db, data):
    text=data.decode('utf-8-sig') if isinstance(data,bytes) else data
    reader=csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not {'code','description','unit','rate'}.issubset(reader.fieldnames):
        raise ValueError('CSV requires code, description, unit and rate headers')
    records=list(reader)
    if len(records)>10000: raise ValueError('CSV limit is 10,000 rows')
    # Validate all records before changing database; rollback entire import on failure.
    db.execute('SAVEPOINT csv_import')
    try:
        for i,r in enumerate(records,2):
            try: save_rate(db,r,commit=False)
            except ValueError as e: raise ValueError(f'CSV row {i}: {e}') from e
        db.execute('RELEASE csv_import')
    except Exception:
        db.execute('ROLLBACK TO csv_import'); db.execute('RELEASE csv_import'); raise
    return len(records)

def export_csv(db):
    output=io.StringIO(); writer=csv.DictWriter(output,fieldnames=COLUMNS)
    writer.writeheader()
    for r in list_rates(db): writer.writerow({k:r.get(k,'') for k in COLUMNS})
    return output.getvalue().encode('utf-8-sig')

def apply_rate(row, rate_record):
    """Require exact unit match; application is an explicit user action."""
    if str(row.get('unit','')).strip().lower()!=str(rate_record['unit']).strip().lower():
        raise ValueError('BOQ unit and rate library unit differ. Verify conversion manually.')
    updated=dict(row)
    updated.update(rate=float(rate_record['rate']),rate_code=rate_record['code'],
                   rate_source=rate_record.get('source',''),rate_date=rate_record.get('effective_date',''),
                   rate_supplier=rate_record.get('supplier',''))
    updated['approved']=False  # Re-approve after rate change
    return updated

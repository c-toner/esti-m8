"""Pure calculations and validation for estimator-reviewed draft BOQs."""
import math
import re

UNITS = {'m','m2','m3','t','kg','ea','item','lot','hr','day','L'}

def safe_number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else 0.0
    except (TypeError, ValueError):
        return 0.0

def totals(rows, overhead_pct=0, markup_pct=0, contingency_pct=0):
    subtotal = sum(safe_number(r.get('quantity')) * safe_number(r.get('rate')) for r in rows if r.get('approved'))
    overhead = subtotal * safe_number(overhead_pct) / 100
    contingency = subtotal * safe_number(contingency_pct) / 100
    markup = (subtotal + overhead + contingency) * safe_number(markup_pct) / 100
    return {'subtotal': round(subtotal, 2), 'overhead': round(overhead, 2), 'contingency': round(contingency, 2), 'markup': round(markup, 2), 'total': round(subtotal + overhead + contingency + markup, 2)}

def validate_ai_item(item, source_files):
    source = str(item.get('source_file','')).strip()
    if source not in source_files:
        source = ''
    try:
        page = int(item.get('page',0))
    except (ValueError, TypeError):
        page = 0
    if not source or not (1 <= page <= source_files[source]):
        page = 0
    q = item.get('quantity')
    try:
        q = float(q) if q is not None else None
        if q is not None and (not math.isfinite(q) or q < 0): q = None
    except (ValueError, TypeError):
        q = None
    return {'description': str(item.get('description',''))[:350], 'quantity': q,
            'unit': str(item.get('unit','item'))[:20], 'rate': 0.0,
            'source_file': source, 'page': page, 'evidence': str(item.get('evidence',''))[:1000],
            'method': str(item.get('method',''))[:500], 'confidence': str(item.get('confidence','low')).lower() if str(item.get('confidence','low')).lower() in ('high','medium','low') else 'low',
            'review_note': str(item.get('review_note',''))[:700], 'approved': False}

def clean_sheet_name(name):
    return re.sub(r'[\\/*?:\[\]]', '_', name)[:31]

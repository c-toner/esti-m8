import pytest
from rate_library import connect, save_rate, list_rates, export_csv, import_csv, apply_rate, delete_rate

def sample(**kwargs):
    return dict(code='DR-01',description='Drainage installation',category='Drainage',unit='m',rate=125.5,supplier='Supplier A',region='NSW',effective_date='2026-11-21',source='Quote-123',notes='Excludes excavation',**kwargs)

def test_rate_crud(tmp_path):
    db=connect(tmp_path/'rates.sqlite3')
    save_rate(db,sample())
    assert list_rates(db)[0]['rate']==125.5
    save_rate(db,{**sample(),'rate':140})
    assert len(list_rates(db))==1
    assert list_rates(db)[0]['rate']==140
    delete_rate(db,'DR-01')
    assert list_rates(db)==[]

def test_csv_roundtrip(tmp_path):
    a=connect(tmp_path/'a.sqlite3'); b=connect(tmp_path/'b.sqlite3')
    save_rate(a,sample())
    assert import_csv(b,export_csv(a))==1
    assert list_rates(b)[0]['source']=='Quote-123'

def test_import_validation_and_rollback(tmp_path):
    db=connect(tmp_path/'rates.sqlite3')
    with pytest.raises(ValueError):
        import_csv(db,'code,description,unit,rate\nOK,Valid,m,15\nBAD,Bad,m,-1\n')
    assert list_rates(db)==[]

def test_rate_unit_guard_and_approval_reset():
    rate=sample()
    with pytest.raises(ValueError): apply_rate({'unit':'m3'},rate)
    row=apply_rate({'unit':'m','approved':True,'quantity':5},rate)
    assert row['rate']==125.5 and row['approved'] is False and row['rate_source']=='Quote-123'

def test_reject_invalid_rate(tmp_path):
    db=connect(tmp_path/'rates.sqlite3')
    with pytest.raises(ValueError): save_rate(db,{**sample(),'rate':float('nan')})

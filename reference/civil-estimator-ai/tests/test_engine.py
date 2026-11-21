from engine import totals, validate_ai_item

def test_approved_only():
    rows=[{'quantity':10,'rate':20,'approved':True},{'quantity':99,'rate':99,'approved':False}]
    assert totals(rows,10,10,5)=={'subtotal':200,'overhead':20,'contingency':10,'markup':23,'total':253}

def test_bad_reference_and_unknown_quantity():
    row=validate_ai_item({'description':'Pipe','quantity':None,'source_file':'other.pdf','page':4}, {'plan.pdf':2})
    assert row['source_file']=='' and row['page']==0 and row['quantity'] is None and row['approved'] is False

def test_negative_rate_does_not_reduce_total():
    assert totals([{'quantity':3,'rate':-100,'approved':True}])['total']==0

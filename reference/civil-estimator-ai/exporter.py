"""Excel output with editable cells, source references and formula-driven totals."""
import io
import xlsxwriter
from engine import safe_number, totals

def make_workbook(rows, overhead, markup, contingency, project, warnings):
    out=io.BytesIO(); wb=xlsxwriter.Workbook(out,{'in_memory':True})
    title=wb.add_format({'bold':True,'font_size':16,'font_color':'#183153'})
    header=wb.add_format({'bold':True,'bg_color':'#183153','font_color':'white','text_wrap':True,'border':1})
    money=wb.add_format({'num_format':'$#,##0.00','border':1})
    number=wb.add_format({'num_format':'0.00','border':1})
    normal=wb.add_format({'border':1,'text_wrap':True,'valign':'top'})
    highlight=wb.add_format({'bg_color':'#FFF1C2','border':1})
    sheet=wb.add_worksheet('BOQ'); sheet.freeze_panes(3,0)
    sheet.write('A1',project or 'Civil estimate — review draft',title)
    sheet.write('A2','Only APPROVED items are included in totals. Check all AI suggestions and sources before tender submission.')
    columns=['Description','Quantity','Unit','Rate (AUD)','Amount (AUD)','Approved','Source file','Page','Evidence','Calculation method','Confidence','Review note','Rate code','Rate source','Rate date','Rate supplier']
    for i,h in enumerate(columns): sheet.write(2,i,h,header)
    for i,r in enumerate(rows,start=3):
        sheet.write(i,0,str(r.get('description','')),normal)
        if r.get('quantity') is None or r.get('quantity')=='': sheet.write_blank(i,1,None,highlight)
        else: sheet.write_number(i,1,safe_number(r.get('quantity')),number)
        sheet.write(i,2,str(r.get('unit','')),normal)
        sheet.write_number(i,3,safe_number(r.get('rate')),money)
        sheet.write_formula(i,4,f'=IF(AND(F{i+1}="Yes",ISNUMBER(B{i+1})),B{i+1}*D{i+1},0)',money)
        sheet.write(i,5,'Yes' if r.get('approved') else 'No',normal)
        for col,key in [(6,'source_file'),(8,'evidence'),(9,'method'),(10,'confidence'),(11,'review_note')]:
            sheet.write(i,col,str(r.get(key,'')),normal)
        sheet.write_number(i,7,int(r.get('page') or 0),normal)
        for col,key in [(12,'rate_code'),(13,'rate_source'),(14,'rate_date'),(15,'rate_supplier')]:
            sheet.write(i,col,str(r.get(key,'') or ''),normal)
    sheet.set_column('A:A',38); sheet.set_column('B:F',16); sheet.set_column('G:G',28)
    sheet.set_column('H:H',9); sheet.set_column('I:J',52); sheet.set_column('K:K',14); sheet.set_column('L:L',48); sheet.set_column('M:P',23)
    if rows: sheet.autofilter(2,0,len(rows)+2,len(columns)-1)
    summary=wb.add_worksheet('Summary'); summary.set_column('A:A',35); summary.set_column('B:B',20)
    summary.write('A1','Estimate summary (AUD, excl. GST)',title)
    labels=['Approved item subtotal','Overheads %','Contingency %','Profit markup %','Overheads amount','Contingency amount','Markup amount','Tender total']
    for i,label in enumerate(labels,start=2): summary.write(i,0,label)
    last=3+len(rows)
    summary.write_formula('B3',f'=SUM(BOQ!E4:E{max(last,4)})',money)
    summary.write_number('B4',safe_number(overhead),number)
    summary.write_number('B5',safe_number(contingency),number)
    summary.write_number('B6',safe_number(markup),number)
    summary.write_formula('B7','=B3*B4/100',money)
    summary.write_formula('B8','=B3*B5/100',money)
    summary.write_formula('B9','=(B3+B7+B8)*B6/100',money)
    summary.write_formula('B10','=SUM(B3,B7:B9)',money)
    notes=wb.add_worksheet('Review warnings'); notes.set_column('A:A',110)
    notes.write('A1','AI-generated quantities and references require independent checking.',header)
    for i,w in enumerate(warnings,start=1): notes.write(i,0,w)
    wb.close(); out.seek(0); return out.getvalue()

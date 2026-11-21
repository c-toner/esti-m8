"""AI Civil Estimator — Streamlit app, local prototype."""
import os
from pathlib import Path
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from ai_analysis import analyse
from engine import safe_number, totals
from exporter import make_workbook
from drawing_viewer import show as show_drawing_takeoff
from rate_library import connect, list_rates, save_rate, delete_rate, import_csv, export_csv, apply_rate

load_dotenv()
st.set_page_config(page_title='AI Civil Estimator',page_icon='🏗️',layout='wide')
st.title('🏗️ AI Civil Estimator')
st.caption('Document intelligence → estimator review → priced BOQ → Excel. No unverified AI quantities are automatically approved.')
if 'rows' not in st.session_state: st.session_state.rows=[]
if 'warnings' not in st.session_state: st.session_state.warnings=[]
if 'summary' not in st.session_state: st.session_state.summary=''

with st.sidebar:
    st.header('Project settings')
    project=st.text_input('Project name','New civil project')
    model=st.text_input('OpenAI model','gpt-4.1-mini',help='Use a vision-capable model supported by your OpenAI account.')
    max_pages=st.slider('Pages per PDF to analyse',1,10,5)
    st.caption('Each page may incur image-analysis charges. API key is read from OPENAI_API_KEY in your local environment.')
    st.divider()
    overhead=st.number_input('Overheads (%)',min_value=0.0,max_value=100.0,value=10.0,step=0.5)
    contingency=st.number_input('Contingency (%)',min_value=0.0,max_value=100.0,value=5.0,step=0.5)
    markup=st.number_input('Profit markup (%)',min_value=0.0,max_value=100.0,value=10.0,step=0.5)

st.subheader('1 · Upload drawings and supporting documents')
files=st.file_uploader('PDF drawings, PDF BOQs, images, text or CSV',type=['pdf','png','jpg','jpeg','txt','csv'],accept_multiple_files=True)
if files:
    st.caption(f'{len(files)} document(s) selected. Files are sent to OpenAI only when you click Analyse.')
    for f in files: st.write(f'• {f.name} ({f.size/1024:.0f} KB)')
col1,col2=st.columns([1,3])
with col1:
    run=st.button('✨ Analyse with OpenAI',type='primary',disabled=not files)
if run:
    if not os.getenv('OPENAI_API_KEY'):
        st.error('Missing OPENAI_API_KEY. Create .env from .env.example and add your key.')
    elif len({f.name for f in files})!=len(files):
        st.error('Uploaded files must have unique names for reliable source references.')
    elif any(f.size>15*1024*1024 for f in files):
        st.error('Each file must be 15 MB or smaller in this prototype.')
    else:
        try:
            with st.spinner('Analysing source pages and drafting the BOQ…'):
                result=analyse([(f.name,f.getvalue()) for f in files],model=model,max_pages_per_pdf=max_pages)
            st.session_state.rows=result['items']; st.session_state.warnings=result['warnings']; st.session_state.summary=result['summary']
            st.success(f"Drafted {len(result['items'])} items from {result['analysed_pages']} rendered pages. All items require review.")
        except Exception as exc:
            st.error(f'AI analysis failed: {exc}')

if st.session_state.summary: st.info(st.session_state.summary)
if st.session_state.warnings:
    with st.expander(f"Review warnings ({len(st.session_state.warnings)})",expanded=True):
        for warning in st.session_state.warnings: st.warning(warning)

show_drawing_takeoff(files or [])

st.subheader('3 · Construction cost rate library')
st.caption('Persistent local SQLite library. Enter your own verified AUD rates; no market prices are assumed. Rate updates do not silently reprice existing BOQ lines.')
try:
    db=connect(os.getenv('CIVIL_RATES_DB','data/cost_rates.sqlite3'))
    library=list_rates(db)
except Exception as exc:
    st.error(f'Cannot open rate library: {exc}')
    db=None; library=[]
if db:
    with st.expander('Manage cost rates and import/export CSV',expanded=not library):
        with st.form('rate_form',clear_on_submit=True):
            a,b,c=st.columns(3)
            with a:
                code=st.text_input('Unique rate code *',placeholder='DRAIN-PIPE-150')
                description=st.text_input('Description *',placeholder='150 mm pipe supply/install')
                category=st.selectbox('Category',['Drainage','Earthworks','Roadworks','Concrete','Labour','Plant','Materials','Subcontract','Other'])
            with b:
                unit=st.text_input('Unit *',value='m')
                price=st.number_input('Unit rate (AUD) *',min_value=0.0,step=1.0,format='%.2f')
                supplier=st.text_input('Supplier / subcontractor')
                region=st.text_input('Region',value='NSW')
            with c:
                effective_date=st.date_input('Rate effective date')
                source=st.text_input('Rate source / quote reference')
                notes=st.text_area('Notes / inclusions / exclusions')
            if st.form_submit_button('Save / update rate'):
                try:
                    save_rate(db,dict(code=code,description=description,category=category,unit=unit,rate=price,supplier=supplier,region=region,effective_date=effective_date.isoformat(),source=source,notes=notes))
                    st.success('Rate saved.'); st.rerun()
                except ValueError as exc: st.error(str(exc))
        if library:
            st.dataframe(pd.DataFrame(library)[['code','description','category','unit','rate','supplier','region','effective_date','source']],hide_index=True,use_container_width=True)
            remove=st.selectbox('Delete rate by code', ['']+[r['code'] for r in library])
            if st.button('Delete selected rate',disabled=not remove):
                delete_rate(db,remove); st.rerun()
        uploaded_rates=st.file_uploader('Import rate library CSV (matching codes are updated)',type=['csv'],key='rate_csv')
        if uploaded_rates and st.button('Import rates CSV'):
            try:
                count=import_csv(db,uploaded_rates.getvalue()); st.success(f'Imported {count} rates.'); st.rerun()
            except Exception as exc: st.error(str(exc))
        st.download_button('Export rate library CSV',export_csv(db),'civil_cost_rates.csv','text/csv')
    if library and st.session_state.rows:
        st.markdown('**Apply a saved rate to a BOQ line**')
        left,right=st.columns(2)
        with left:
            line_index=st.selectbox('BOQ line',range(len(st.session_state.rows)),format_func=lambda i:f"{i+1}: {st.session_state.rows[i].get('description','')[:65]}")
        with right:
            choice=st.selectbox('Library rate',library,format_func=lambda r:f"{r['code']} · {r['description'][:35]} · ${r['rate']:,.2f}/{r['unit']}")
        if st.button('Apply selected rate (requires re-approval)'):
            try:
                st.session_state.rows[line_index]=apply_rate(st.session_state.rows[line_index],choice)
                st.session_state.pop('boq_editor',None)
                st.success('Rate applied. Verify and re-approve the BOQ line.'); st.rerun()
            except ValueError as exc: st.error(str(exc))


st.subheader('4 · Review draft BOQ and set your rates')
st.caption('Tick Approved only after verifying the quantity, units and source. Blank quantities are intentionally not priced.')
if st.button('Add blank manual line'):
    st.session_state.rows.append({'description':'','quantity':None,'unit':'item','rate':0.,'source_file':'','page':0,'evidence':'Manual entry','method':'Manual takeoff','confidence':'low','review_note':'','approved':False,'rate_code':'','rate_source':'','rate_date':'','rate_supplier':''})
columns=['description','quantity','unit','rate','approved','rate_code','rate_source','rate_date','rate_supplier','source_file','page','evidence','method','confidence','review_note']
df=pd.DataFrame(st.session_state.rows,columns=columns)
if not df.empty:
    edited=st.data_editor(df,hide_index=True,num_rows='dynamic',use_container_width=True,key='boq_editor',column_config={
        'description':st.column_config.TextColumn('Work item',width='large'),
        'quantity':st.column_config.NumberColumn('Quantity',min_value=0.0,format='%.3f'),
        'unit':st.column_config.TextColumn('Unit'),
        'rate':st.column_config.NumberColumn('Rate (AUD)',min_value=0.0,format='$%.2f'),
        'approved':st.column_config.CheckboxColumn('Approved'),
        'rate_code':st.column_config.TextColumn('Rate code'),
        'rate_source':st.column_config.TextColumn('Rate source'),
        'rate_date':st.column_config.TextColumn('Rate date'),
        'rate_supplier':st.column_config.TextColumn('Supplier'),
        'source_file':st.column_config.TextColumn('Source file'),
        'page':st.column_config.NumberColumn('Page',min_value=0,step=1),
        'evidence':st.column_config.TextColumn('Evidence',width='large'),
        'method':st.column_config.TextColumn('Method',width='large'),
        'confidence':st.column_config.SelectboxColumn('Confidence',options=['high','medium','low']),
        'review_note':st.column_config.TextColumn('Review note',width='large')})
    rows=edited.where(pd.notnull(edited),None).to_dict('records')
    st.session_state.rows=rows
else:
    st.info('Upload drawings and run AI analysis, or add a manual line to begin.')
    rows=[]

summary=totals(rows,overhead,markup,contingency)
col_a,col_b,col_c=st.columns(3)
col_a.metric('Approved subtotal',f"${summary['subtotal']:,.2f}")
col_b.metric('Tender total (excl. GST)',f"${summary['total']:,.2f}")
col_c.metric('Approved items',f"{sum(bool(r.get('approved')) for r in rows)} / {len(rows)}")
if rows:
    st.subheader('5 · Export estimate')
    if any(r.get('approved') and (r.get('quantity') is None or safe_number(r.get('rate'))==0) for r in rows):
        st.warning('Some approved lines have missing quantities or zero rates. Verify before exporting.')
    workbook=make_workbook(rows,overhead,markup,contingency,project,st.session_state.warnings)
    st.download_button('⬇ Download Excel estimate',workbook,file_name='civil_ai_estimate.xlsx',mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',type='primary')
st.divider()
st.warning('Prototype only: calibrated on-screen manual takeoff is available, but not automated CAD-grade geometry extraction; no automatic market pricing, authentication or saved project database (rates are persisted locally). Independent estimator review is required before tender use.')

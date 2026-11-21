"""Human-controlled calibrated drawing takeoff widget for Streamlit."""
import io
from pathlib import Path
import fitz
from PIL import Image, ImageDraw
import streamlit as st
from streamlit_image_coordinates import streamlit_image_coordinates
from measurement import metres_per_pixel, quantity

WIDTH=900

def render(blob, name, page_index):
    if Path(name).suffix.lower()=='.pdf':
        with fitz.open(stream=blob,filetype='pdf') as doc:
            page=doc[page_index]
            pix=page.get_pixmap(matrix=fitz.Matrix(min(2, WIDTH/page.rect.width), min(2, WIDTH/page.rect.width)),alpha=False)
            image=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
    else:
        image=Image.open(io.BytesIO(blob)).convert('RGB')
    if image.width>WIDTH:
        image.thumbnail((WIDTH,100000))
    return image


def draw_marks(image, calibration, points):
    out=image.copy(); d=ImageDraw.Draw(out)
    for seq,color in [(calibration,'#f59e0b'),(points,'#16a34a')]:
        for x,y in seq:
            d.ellipse((x-5,y-5,x+5,y+5),fill=color,outline='white',width=2)
        if len(seq)>1: d.line(seq,fill=color,width=3)
    return out


def show(files):
    supported=[f for f in files if Path(f.name).suffix.lower() in ('.pdf','.png','.jpg','.jpeg')]
    if not supported:
        st.info('Upload a PDF or image above to begin manual calibrated takeoff.')
        return
    st.subheader('2 · Calibrated drawing takeoff')
    st.caption('Measure using two points on a **known dimension** on the same drawing. Do not rely on printed scale alone; scans and print-to-PDF can distort scale. Verify dimensions and units independently.')
    names=[f.name for f in supported]
    name=st.selectbox('Drawing',names,key='measure_file')
    f=next(f for f in supported if f.name==name)
    blob=f.getvalue()
    if name.lower().endswith('.pdf'):
        try:
            with fitz.open(stream=blob,filetype='pdf') as doc: page_count=len(doc)
        except Exception as e:
            st.error(f'Unable to read PDF: {e}'); return
        page=st.number_input('Drawing page (1-based)',1,page_count,1,key='measure_page')
        page_index=int(page)-1
    else: page_index=0
    try: image=render(blob,name,page_index)
    except Exception as e:
        st.error(f'Unable to display drawing: {e}'); return
    import hashlib
    digest=hashlib.sha256(blob).hexdigest()[:16]
    ident=f'{digest}:{page_index}'
    if st.session_state.get('takeoff_ident')!=ident:
        st.session_state.takeoff_ident=ident
        st.session_state.takeoff_cal=[]
        st.session_state.takeoff_pts=[]
        st.session_state.takeoff_scale=None
        st.session_state.takeoff_known=None
        st.session_state.takeoff_last_click=None
    cal=st.session_state.takeoff_cal
    pts=st.session_state.takeoff_pts
    stage=st.radio('Point selection', ['Calibrate (2 points)','Measure'],horizontal=True,key='takeoff_stage')
    click=streamlit_image_coordinates(draw_marks(image,cal,pts),key=f'drawing_click_{ident}',width=image.width)
    if click:
        st.caption(f'Selected pixel: ({click["x"]}, {click["y"]}). Click **Add selected point** to record it.')
    a,b,c=st.columns(3)
    if a.button('Add selected point',disabled=click is None):
        p=(int(click['x']),int(click['y']))
        if stage.startswith('Calibrate'):
            if len(cal)>=2: st.warning('Clear calibration to select a new reference.')
            else: cal.append(p)
        else: pts.append(p)
        st.rerun()
    if b.button('Undo last point'):
        seq=cal if stage.startswith('Calibrate') else pts
        if seq: seq.pop()
        if stage.startswith('Calibrate'):
            st.session_state.takeoff_scale=None
            st.session_state.takeoff_known=None
        st.rerun()
    if c.button('Clear measurement'):
        st.session_state.takeoff_pts=[]; st.rerun()
    st.write(f'Calibration points: {len(cal)}/2 · Measurement points: {len(pts)}')
    known=st.number_input('Known distance between calibration points (metres)',min_value=0.001,value=1.0,format='%.3f',key=f'known_{ident}')
    if st.button('Set / update calibration',disabled=len(cal)!=2):
        try:
            st.session_state.takeoff_scale=metres_per_pixel(cal[0],cal[1],known)
            st.session_state.takeoff_known=known
            st.success('Scale calibrated for this page and rendered image.')
        except ValueError as e: st.error(str(e))
    if st.button('Clear calibration'):
        st.session_state.takeoff_cal=[]; st.session_state.takeoff_scale=None; st.session_state.takeoff_known=None; st.rerun()
    scale=st.session_state.takeoff_scale
    if scale is None:
        st.warning('Calibrate against a known dimension before calculating quantities.')
        return
    st.caption(f'Calibration: {scale:.7f} metres per displayed pixel. Applies to this page only. Recalibrate if drawing/page changes.')
    mode=st.selectbox('Takeoff type',['Length (m)','Area (m²)','Volume (m³)'],key='takeoff_mode')
    depth=None
    if mode=='Volume (m³)':
        depth=st.number_input('Verified uniform depth/thickness (metres)',min_value=0.001,value=0.3,format='%.3f')
    try:
        value,unit=quantity(pts,scale,mode,depth)
    except ValueError as e:
        st.info(str(e)); return
    st.metric('Measured quantity (not yet approved)',f'{value:,.3f} {unit}')
    description=st.text_input('BOQ item description',value={'Length (m)':'Measured linear work','Area (m²)':'Measured surface work','Volume (m³)':'Measured volume work'}[mode],key='takeoff_desc')
    if st.button('Add measured quantity to draft BOQ',type='primary'):
        if not description.strip(): st.error('Enter a description.'); return
        method=f'Manual calibrated {mode}; known dimension {st.session_state.takeoff_known:g} m; {len(pts)} selected vertices; scale {scale:.8g} m/pixel'
        if depth is not None: method+=f'; uniform depth {depth:g} m'
        st.session_state.rows.append({'description':description.strip(),'quantity':round(value,4),'unit':unit,'rate':0.0,'approved':False,'source_file':name,'page':page_index+1,'evidence':f'Manual on-screen takeoff on page {page_index+1}; verify against drawing dimensions','method':method,'confidence':'medium','review_note':'Manual geometry estimate; confirm scale, vertices, drawing revision and site conditions before approval.'})
        st.success('Added to draft BOQ, unapproved and unpriced. Review it below.')

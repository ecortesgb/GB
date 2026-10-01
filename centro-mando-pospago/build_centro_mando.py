#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Centro de Mando Pospago · Grupo Benber
=======================================
Un solo script: lee las carpetas de ARCHIVOS GB\\BASE, recalcula todo y genera la página.

  py build_centro_mando.py                 -> genera  salida\\index.html
  py build_centro_mando.py --deploy        -> además la publica en el enlace fijo (Netlify)
  py build_centro_mando.py --root "D:\\ruta\\BASE"   -> otra ruta de archivos

Fuentes (todas dentro de BASE):
  ALTAS\\Pospago\\Mensual\\*.xlsx            hoja POSPAGO  -> base de todo (DN, plan, forma de pago, usuario, promotor, facturas)
  REGISTROS\\Semanal\\2026\\26-Sxx.csv        registros FW (solo productos PLAN)
  REGISTROS TELEFONICA\\Pospago\\26-Sxx.xlsx  estatus de Telefónica por DN (causa de no conversión)
  VINCULACION\\MM_2026.xlsx                  vinculación / enrolamiento
  CUOTAS\\Benber\\MM_2026.xlsx                hoja CAPILARIDAD, columna POSPAGO (cuota por tienda)
  ESTRUCTURAS\\Base Nueva Estructura.xlsx    hoja "Estructura Actual" (estructura vigente de tiendas)
Configuración opcional en config.json (junto a este script).
"""
import os, sys, re, io, json, glob, time, base64, hashlib, argparse, zipfile, datetime, warnings, traceback
import numpy as np, pandas as pd
warnings.filterwarnings('ignore')

AQUI = os.path.dirname(os.path.abspath(__file__))
def cargar_config():
    p = os.path.join(AQUI, 'config.json')
    if os.path.exists(p):
        try: return json.load(open(p, encoding='utf-8'))
        except Exception as e: print('config.json inválido:', e); sys.exit(2)
    return {}
CFG = cargar_config()

RAIZ_DEFAULT = r'C:\Users\ecort\OneDrive - Grupo Benber\ARCHIVOS GB\BASE'
VENTANA = 4              # facturas que se miden (1ª a 4ª)
MES_INICIO = '2026-05'   # primer mes que muestra el tablero
SEMANA_FW_INICIO = 13    # primera semana de registros FW que se lee
SEMANA_FW_MAX = int(CFG.get('semana_fw_max', 999))   # solo para pruebas

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)

nd  = lambda s: s.astype(str).str.replace(r'\.0$', '', regex=True).str.replace(r'\D', '', regex=True).str[-10:]
nid = lambda s: s.astype(str).str.replace(r'\.0$', '', regex=True).str.strip().str.lstrip('0')
dt  = lambda s: pd.to_datetime(s, errors='coerce')
STR = ['SUBDIRECCION GB', 'GERENTE / LIDER', 'SUPERVISOR', 'SUB_REG', 'SUB_TERR', 'LIDER']
EST = ['ID PDV', 'NOMBRE PDV', 'CADENA', 'REGION', 'ESTADO'] + STR

def fecha_mixta(s):
    """yyyy-mm-dd o dd/mm/yyyy en la misma columna."""
    s = s.astype(str).str.strip()
    iso = s.str.match(r'^\d{4}-\d{2}-\d{2}')
    a = pd.to_datetime(s.where(iso), errors='coerce', format='%Y-%m-%d', exact=False)
    b = pd.to_datetime(s.where(~iso), errors='coerce', dayfirst=True)
    return a.fillna(b)

def xl(f, **kw):
    """pd.read_excel con reintentos (por si el archivo está abierto/sincronizándose en OneDrive)."""
    for i in range(4):
        try: return pd.read_excel(f, **kw)
        except PermissionError:
            log('  archivo ocupado, reintento', i + 1, os.path.basename(f)); time.sleep(15)
    return pd.read_excel(f, **kw)

def leer_csv(f):
    for enc in ('utf-8-sig', 'cp1252', 'latin1'):
        try: return pd.read_csv(f, dtype=str, encoding=enc, low_memory=False)
        except UnicodeDecodeError: continue
    raise RuntimeError('no pude leer ' + f)

def semana(f):
    m = re.search(r'S(\d+)', os.path.basename(f)); return int(m.group(1)) if m else -1

# ====================================================================== CARGA
def cargar_estructura(R):
    f = os.path.join(R, 'ESTRUCTURAS', 'Base Nueva Estructura.xlsx')
    d = xl(f, sheet_name='Estructura Actual', dtype=object)
    d['ID PDV'] = nid(d['IDPDV'])
    m = d.rename(columns={'NOMBRE PDV': 'NOMBRE PDV'})
    cols = ['ID PDV', 'NOMBRE PDV', 'CADENA', 'REGION', 'ESTADO'] + STR
    m = m.reindex(columns=cols).drop_duplicates('ID PDV').set_index('ID PDV')
    log('estructura vigente:', len(m), 'tiendas')
    return m

def cargar_cuotas(R):
    fs = sorted(glob.glob(os.path.join(R, 'CUOTAS', 'Benber', '[0-9][0-9]_20[0-9][0-9].xlsx')))
    use = ['MES', 'IDPV', 'POSPAGO', 'REGION', 'SUB_REG', 'SUB_TERR', 'LIDER', 'NOMBRE_IDPV', 'ESTADO', 'CADENA']
    L, cap = [], None
    for f in fs:
        mm = os.path.basename(f)[:2] + os.path.basename(f)[3:7]   # MMYYYY
        ym = int(mm[2:] + mm[:2])                                  # YYYYMM
        d = xl(f, sheet_name='CAPILARIDAD', dtype=object, usecols=lambda c: c in use)
        d['MES'] = pd.to_numeric(d['MES'], errors='coerce'); d['POSPAGO'] = pd.to_numeric(d['POSPAGO'], errors='coerce').fillna(0)
        # Se usan TODOS los archivos de la carpeta (decisión de Elías); el mes sale del nombre del archivo.
        if d['MES'].dropna().nunique() and int(d['MES'].dropna().mode()[0]) != ym:
            log('  aviso: cuota', os.path.basename(f), 'trae MES distinto al nombre; se usa como', ym)
        d['IDPV'] = nid(d['IDPV'])
        d['M'] = ym; L.append(d[['M', 'IDPV', 'POSPAGO']]); cap = d
    if not L: raise RuntimeError('no encontré cuotas válidas en CUOTAS\\Benber')
    q = pd.concat(L); log('cuotas de', sorted(q.M.unique()), '· total pospago', int(q.POSPAGO.sum()))
    cap = cap.drop_duplicates('IDPV').set_index('IDPV')
    return q, cap

def cargar_altas(R):
    fs = glob.glob(os.path.join(R, 'ALTAS', 'Pospago', 'Mensual', '*.xlsx'))
    fs = [f for f in fs if not os.path.basename(f).startswith('~$')]
    if not fs: raise RuntimeError('no hay archivo en ALTAS\\Pospago\\Mensual')
    f = max(fs, key=os.path.getmtime)
    log('altas:', os.path.basename(f))
    return xl(f, sheet_name='POSPAGO')

def cargar_fw(R, M):
    L = []
    for f in sorted(glob.glob(os.path.join(R, 'REGISTROS', 'Semanal', '2026', '26-S*.csv'))):
        if semana(f) < SEMANA_FW_INICIO or semana(f) > SEMANA_FW_MAX: continue
        d = leer_csv(f); d = d[d['Producto'].astype(str).str.contains('PLAN', na=False)]
        d['wk'] = semana(f); L.append(d)
    fw = pd.concat(L, ignore_index=True)
    fw['DNn'] = nd(fw['DN']); fw['Fecha registro'] = fecha_mixta(fw['Fecha registro'])
    fw = fw.sort_values(['Fecha registro', 'Hora registro']).drop_duplicates('DNn', keep='first').copy()
    fw['Usuario FW'] = fw['Usuario']; fw['ID PDV FW'] = nid(fw['ID PDV']); fw['ID PDV'] = fw['ID PDV FW']
    fw = estructurar(fw, M)
    log('registros FW (plan):', len(fw), 'DN · último registro', fw['Fecha registro'].max().date())
    return fw

def estructurar(df, M, idcol='ID PDV'):
    """Agrega la estructura vigente (subdirección, supervisor, región...) por ID PDV."""
    df['ID PDV'] = nid(df[idcol])
    for c in EST[1:]:
        df[c] = df['ID PDV'].map(M[c]) if c in M else np.nan
    return df

def cargar_estatus(R, M):
    L = []
    for f in sorted(glob.glob(os.path.join(R, 'REGISTROS TELEFONICA', 'Pospago', '26-S*.xlsx'))):
        try: d = xl(f, sheet_name='FW', dtype=object)
        except Exception as e: log('  sin hoja FW en', os.path.basename(f)); continue
        d['wk'] = semana(f)
        d['ESTATUS'] = d['ESTATUS'] if 'ESTATUS' in d else d.get('Status')
        L.append(d)
    er = pd.concat(L, ignore_index=True); er['DNn'] = nd(er['DN'])
    er = er.sort_values('wk').drop_duplicates('DNn', keep='last').copy()
    er['ESTATUS'] = er['ESTATUS'].replace({'Sin datos': np.nan})
    er['Fecha registro'] = fecha_mixta(er['Fecha registro']) if 'Fecha registro' in er else pd.NaT
    if 'Nombre Usuario' not in er: er['Nombre Usuario'] = np.nan
    er = estructurar(er, M)
    log('estatus Telefónica:', len(er), 'DN')
    return er

def cargar_vinc(R):
    L = []
    use = ['DN', 'Producto', 'Fecha registro', 'DES_ESTATUS_ENROLAMIENTO', 'ESTATUS', 'FEC_ALTA', 'FEC_ACTIVACION']
    fs = sorted(glob.glob(os.path.join(R, 'VINCULACION', '[0-9][0-9]_20[0-9][0-9].xlsx')), key=lambda f: os.path.basename(f)[3:7] + os.path.basename(f)[:2])[-4:]
    for f in fs:
        d = xl(f, dtype=object, usecols=lambda c: c in use); d['arch'] = os.path.basename(f)[:2]; L.append(d)
    vi = pd.concat(L, ignore_index=True)
    for c in use:
        if c not in vi: vi[c] = np.nan
    vi['DNn'] = nd(vi['DN']); vi['Fecha registro'] = pd.to_datetime(vi['Fecha registro'], errors='coerce')
    vi = vi[vi['Producto'].astype(str).str.contains('PLAN')].copy()
    log('vinculación:', len(vi), 'filas')
    return vi
def cruce(fw,er,ca,vi,M,CORTE):
    VFA=pd.to_datetime(vi.assign(_f=vi.FEC_ALTA.where(vi.FEC_ALTA.notna(),vi.FEC_ACTIVACION)).dropna(subset=['_f']).drop_duplicates('DNn',keep='last').set_index('DNn')['_f'],errors='coerce')
    fw['DNn']=nd(fw.DN); er['DNn']=nd(er.DN); ca['DNn']=nd(ca.DN) if 'DNn' not in ca else ca['DNn']
    fw['ID PDV']=fw['ID PDV FW']
    er['Fecha Alta']=er.DNn.map(pd.to_datetime(ca.FECHA_ALTA,errors='coerce').groupby(ca.DNn).min()).fillna(er.DNn.map(VFA))
    ca=ca.copy()
    ca['DNn']=nd(ca.DN)
    ca=ca.rename(columns={'Usuario':'Usuario Calidad','PLAN':'Plan Calidad'}); ca['ID PDV Calidad']=ca['ID PDV']
    ca['FORMA PAGO']=np.nan; ca['MOTIVO_BAJA']=np.nan
    AL_EST={'ID PDV':'ID PDV','NOMBRE PDV':'Nombre PDV','CADENA':'Cadena','REGION':'Region','SUPERVISOR':'Supervisor','SUBDIRECCION GB':'Subdirector','GERENTE / LIDER':'Lider Zonal'}
    for k,v in AL_EST.items():
        if k!='ID PDV': ca[k]=ca[v]
    ca['ID PDV']=nid(ca['ID PDV'])
    for k in ['FECHA_ALTA','FECHA_EMISION','FECHA_PAGO','FECHA_VENCIMIENTO','FECHA_BAJA','FECHA_EXPORTADO']: ca[k]=dt(ca[k])
    ca['NUM_FACT']=pd.to_numeric(ca.NUM_FACT,errors='coerce')
    for k in ['MONTO_FACTURA','SALDO_PENDIENTE']: ca[k]=pd.to_numeric(ca[k],errors='coerce')
    fw['Fecha registro']=dt(fw['Fecha registro']); er['Fecha Alta']=dt(er['Fecha Alta']); er['Fecha registro']=dt(er['Fecha registro'])

    def fixtxt(x):
        if not isinstance(x,str): return x
        try: x=x.encode('latin1').decode('utf8')
        except Exception: pass
        return x
    def forma(x):
        x=fixtxt(x)
        if not isinstance(x,str): return x
        l=x.lower().replace('é','e')
        if 'efectivo' in l: return 'Efectivo'
        if 'debito' in l: return 'Tarjeta de débito'
        if 'credito' in l: return 'Tarjeta de crédito'
        return x
    for k in ['DES_FORMA_PAGO','FORMA PAGO']: ca[k]=ca[k].map(forma)
    # ---------------- FACTURAS ----------------
    inv=ca[ca.FACTURA.notna()].copy()
    inv=inv.sort_values(['DNn','FECHA_EMISION'])
    inv['NUM_FACT']=inv.NUM_FACT.fillna(inv.groupby('DNn').cumcount()+1).astype(int)
    print('facturas >4 omitidas:',(inv.NUM_FACT>VENTANA).sum()); inv=inv[inv.NUM_FACT<=VENTANA].copy()
    paid=inv.ESTATUS_FACTURA.isin(['Pago Total','Pagado'])
    inv['pagada']=paid
    inv['parcial']=inv.ESTATUS_FACTURA.eq('Pago Parcial')
    venc=inv.FECHA_VENCIMIENTO<=CORTE
    inv['clase']=np.where(paid,'Pagada',np.where(venc,'Vencida no pagada','Vigente no pagada'))
    inv['dias_atraso']=np.where(inv.clase=='Vencida no pagada',(CORTE-inv.FECHA_VENCIMIENTO).dt.days,0)
    inv['mes_emision']=inv.FECHA_EMISION.dt.to_period('M').astype(str)
    inv['mes_venc']=inv.FECHA_VENCIMIENTO.dt.to_period('M').astype(str)
    inv['mes_alta']=inv.FECHA_ALTA.dt.to_period('M').astype(str)
    inv['dias_a_pago']=(inv.FECHA_PAGO-inv.FECHA_VENCIMIENTO).dt.days
    inv['monto_pend']=np.where(paid,0,inv.MONTO_FACTURA)

    # ---------------- DN maestro ----------------
    allDN=sorted(set(fw.DNn)|set(er.DNn)|set(ca.DNn))
    dn=pd.DataFrame({'DN':allDN}).rename(columns={'DN':'DNn'})
    dn['en_registro']=dn.DNn.isin(fw.DNn); dn['en_telefonica']=dn.DNn.isin(er.DNn); dn['en_calidad']=dn.DNn.isin(ca.DNn)
    dn['en_proforma']=False; dn['en_nomina']=False; dn['en_vinculacion']=dn.DNn.isin(vi.DNn)
    # estructura: FW > ER > calidad
    def pick(df,cols):
        d=df.drop_duplicates('DNn').set_index('DNn').reindex(columns=cols); return d
    E=pick(fw,EST).combine_first(pick(er,EST)).combine_first(pick(ca,EST))
    dn=dn.merge(E,left_on='DNn',right_index=True,how='left')
    F=fw.drop_duplicates('DNn').set_index('DNn')
    dn['fecha_registro']=dn.DNn.map(F['Fecha registro']); dn['usuario_registro']=dn.DNn.map(F['Usuario FW']); dn['promotor']=dn.DNn.map(F['Nombre Usuario']) if 'Nombre Usuario' in F else np.nan
    dn['rol_registro']=dn.DNn.map(F['Rol de usuario']); dn['producto']=dn.DNn.map(F['Producto'])
    dn['portabilidad']=dn.producto.astype(str).str.contains('PORTA')
    # nombre promotor: FW no lo trae; tomar de ER/CA
    nm=pd.concat([er[['DNn','Nombre Usuario']],ca[['DNn','Nombre Usuario']]]).dropna().drop_duplicates('DNn').set_index('DNn')['Nombre Usuario']
    dn['promotor']=dn.promotor.fillna(dn.DNn.map(nm))
    CA1=ca.sort_values('FECHA_EMISION').drop_duplicates('DNn',keep='last').set_index('DNn')
    dn['usuario']=dn.DNn.map(CA1['Usuario Calidad']).fillna(dn.usuario_registro)
    dn['promotor']=dn.DNn.map(CA1['Nombre Usuario']).fillna(dn.promotor)
    dn['en_registro']=dn.en_registro|dn.en_calidad   # todo DN en Altas tiene registro válido
    _fr=pd.to_datetime(ca.drop_duplicates('DNn').set_index('DNn')['Fecha registro'],dayfirst=True,errors='coerce')
    dn['fecha_registro']=dn.fecha_registro.fillna(dn.DNn.map(_fr))
    R=er.drop_duplicates('DNn').set_index('DNn')
    dn['estatus_tel']=dn.DNn.map(R['ESTATUS']); dn['comentario_tel']=dn.DNn.map(R['COMENTARIOS']); dn['fecha_alta_tel']=dn.DNn.map(R['Fecha Alta'])
    dn['modalidad_tel']=dn.DNn.map(R['Modalidad'])
    V=vi.sort_values('Fecha registro').drop_duplicates('DNn',keep='last').set_index('DNn')
    dn['enrolamiento']=dn.DNn.map(V['DES_ESTATUS_ENROLAMIENTO'])
    V9=vi[vi.arch=='09'].drop_duplicates('DNn').set_index('DNn'); dn['estatus_vinc']=dn.DNn.map(V9['ESTATUS'])
    dn['estatus_tel']=dn.estatus_tel.fillna(dn.estatus_vinc)
    dn['fecha_registro']=dn.fecha_registro.fillna(dn.DNn.map(V['Fecha registro']))
    # calidad por DN
    C=ca.sort_values(['DNn','FECHA_EMISION']).drop_duplicates('DNn',keep='last').set_index('DNn')
    dn['estatus_linea']=dn.DNn.map(C['ESTATUS']); dn['fecha_alta']=dn.DNn.map(ca.groupby('DNn').FECHA_ALTA.min())
    dn['fecha_baja']=dn.DNn.map(C['FECHA_BAJA']); dn['motivo_baja']=dn.DNn.map(C['MOTIVO_BAJA'])
    dn['plan']=dn.DNn.map(C['Plan Calidad']).astype(str).str.replace(r'\.$','',regex=True).replace('nan',np.nan)

    dn['forma_pago']=dn.DNn.map(C['DES_FORMA_PAGO']).fillna(dn.DNn.map(C['FORMA PAGO']))
    dn['fecha_exportado']=dn.DNn.map(ca.groupby('DNn').FECHA_EXPORTADO.max()); dn['uso']=dn.DNn.map(C['USO']); dn['ciclo']=dn.DNn.map(C['DES_CICLO'])
    dn['fecha_alta']=dn.fecha_alta.fillna(dn.DNn.map(VFA)).fillna(dn.fecha_alta_tel)
    dn['mes_alta']=dn.fecha_alta.dt.to_period('M').astype(str).replace('NaT',np.nan)
    dn['mes_registro']=dn.fecha_registro.dt.to_period('M').astype(str).replace('NaT',np.nan)
    # nómina
    dn['pago_nomina']=False; dn['motivo_no_pago_nomina']=np.nan
    # agregados de facturas
    g=inv.groupby('DNn')
    A=pd.DataFrame({'fact_generadas':g.size(),'fact_pagadas':g.pagada.sum(),
     'fact_vencidas_np':g.apply(lambda x:(x.clase=='Vencida no pagada').sum()),'fact_vigentes_np':g.apply(lambda x:(x.clase=='Vigente no pagada').sum()),
     'monto_pagado':g.apply(lambda x:x.MONTO_FACTURA[x.pagada].sum()),'monto_vencido_np':g.apply(lambda x:x.MONTO_FACTURA[x.clase=='Vencida no pagada'].sum()),
     'monto_vigente_np':g.apply(lambda x:x.MONTO_FACTURA[x.clase=='Vigente no pagada'].sum()),'dias_atraso_max':g.dias_atraso.max(),
     'ultima_emision':g.FECHA_EMISION.max()})
    dn=dn.merge(A,left_on='DNn',right_index=True,how='left')
    for c in ['fact_generadas','fact_pagadas','fact_vencidas_np','fact_vigentes_np','monto_pagado','monto_vencido_np','monto_vigente_np']: dn[c]=dn[c].fillna(0)
    noBaja=~dn.estatus_linea.isin(['Baja','Desactivado'])
    dn['alta_confirmada']=dn.en_calidad
    dn['fact_por_generar']=np.where(dn.alta_confirmada&noBaja,np.maximum(VENTANA-dn.fact_generadas,0),0).astype(int)
    # salud del DN
    def salud(r):
        if not r.en_calidad: return 'Sin factura en Onix'
        if r.fact_generadas==0: return 'Sin factura generada'
        baja=r.estatus_linea in ('Baja','Desactivado')
        if r.fact_vencidas_np>0: return 'Baja con adeudo' if baja else 'Con adeudo vencido'
        if baja: return 'Baja sin adeudo vencido'
        return 'Sano'
    dn['salud']=dn.apply(salud,axis=1)
    # conciliación
    lim=CORTE-pd.Timedelta(days=35)
    def conc(r):
        t=str(r.estatus_tel) if pd.notna(r.estatus_tel) else ''
        if r.en_calidad and not r.en_registro: return '6 Factura sin registro FW'
        if r.en_calidad and t=='ALTA': return '1 OK · Alta y facturando'
        if r.en_calidad: return '2 Facturando · Tel sin alta confirmada'
        if not r.en_registro:
            return '9 Solo estatus Telefónica'
        if t=='ALTA': return '3 Alta reciente · esperando 1a factura' if (pd.notna(r.fecha_alta_tel) and r.fecha_alta_tel>lim) or (pd.notna(r.fecha_registro) and r.fecha_registro>lim) else '4 Alta Tel sin factura (revisar)'
        if t=='NO IDENTIFICADO': return '5 No identificado en Tel · sin factura'
        if t in ('EXPORTADO',): return '7 Exportado (sin alta)'
        if t in ('Prepago',): return '7 Es prepago'
        if t in ('BAJA',): return '7 Baja en Tel'
        if t in ('ACTIVO','SIN INFORMACION'): return '7 Activo/Sin info en Tel'
        return '8 Registro sin consulta Tel'
    dn['conciliacion']=dn.apply(conc,axis=1)
    dn['alta_confirmada']=dn.en_calidad
    dn['dias_activa']=((dn.fecha_baja.fillna(dn.fecha_exportado))-dn.fecha_alta).dt.days
    dn['dias_desde_registro']=(CORTE-dn.fecha_registro).dt.days
    # ---- por generar (estimado)
    gap=(inv.FECHA_VENCIMIENTO-inv.FECHA_EMISION).dt.days.median()
    first_off=(inv[inv.NUM_FACT==1].groupby('DNn').FECHA_EMISION.min()-dn.set_index('DNn').fecha_alta.reindex(inv[inv.NUM_FACT==1].DNn.unique())).dt.days.median()
    print('gap emision->venc',gap,'alta->1a emision',first_off)
    pg=[]
    for r in dn[dn.fact_por_generar>0].itertuples():
        basef=r.fecha_alta if pd.notna(r.fecha_alta) else (r.fecha_alta_tel if pd.notna(r.fecha_alta_tel) else r.fecha_registro)
        last=r.ultima_emision if pd.notna(r.ultima_emision) else (basef+pd.Timedelta(days=first_off)-pd.DateOffset(months=1) if pd.notna(basef) else pd.NaT)
        for k in range(int(r.fact_generadas)+1,VENTANA+1):
            n=k-int(r.fact_generadas); em=(last+pd.DateOffset(months=n)) if pd.notna(last) else pd.NaT
            pg.append((r.DNn,k,em,em+pd.Timedelta(days=gap) if pd.notna(em) else pd.NaT))
    pg=pd.DataFrame(pg,columns=['DNn','NUM_FACT','FECHA_EMISION','FECHA_VENCIMIENTO'])
    pg['clase']='Por generar'; pg['estimada']=True
    pg=pg.merge(dn[['DNn','fecha_alta','estatus_linea','forma_pago','plan']].rename(columns={'fecha_alta':'FECHA_ALTA','estatus_linea':'ESTATUS','forma_pago':'DES_FORMA_PAGO','plan':'Plan Calidad'}),on='DNn')
    pg['mes_emision']=pg.FECHA_EMISION.dt.to_period('M').astype(str); pg['mes_venc']=pg.FECHA_VENCIMIENTO.dt.to_period('M').astype(str)
    pg['mes_alta']=pg.FECHA_ALTA.dt.to_period('M').astype(str)
    inv['estimada']=False
    invx=pd.concat([inv,pg],ignore_index=True)
    # estructura a facturas
    invx=invx.drop(columns=[c for c in EST if c in invx.columns]).merge(dn[['DNn']+EST],on='DNn',how='left')

    # completar estructura faltante con la vigente
    for c in EST[1:]:
        dn[c]=dn[c].where(dn[c].notna(), dn['ID PDV'].map(M[c]) if c in M else np.nan)
    invx=invx.drop(columns=[c for c in EST if c in invx.columns]).merge(dn[['DNn']+EST],on='DNn',how='left')
    return dn,invx,ca
def mkdata(dn,inv,M,capf,cuota,fw,er,ca,CORTE,CORTE_TXT,GEN_TXT):
    dn=dn.reset_index(drop=True)
    TXT=['REGION','ESTADO','SUBDIRECCION GB','GERENTE / LIDER','LIDER','SUB_TERR','SUB_REG','SUPERVISOR','CADENA','NOMBRE PDV','plan','forma_pago']
    for c in TXT: dn[c]=dn[c].fillna('Sin dato').astype(str).str.strip().replace({'nan':'Sin dato','':'Sin dato'})
    dn['cohorte']=dn.mes_alta.fillna(dn.mes_registro)
    dn['mes_baja']=dn.fecha_baja.fillna(dn.fecha_exportado).dt.to_period('M').astype(str)
    months=sorted(set(dn.cohorte.dropna())|set(dn.mes_registro.dropna())|set(dn.mes_baja.dropna())|set(inv.mes_emision.dropna())|set(inv.mes_venc.dropna())); months=[m for m in months if m!='NaT' and m>=MES_INICIO]
    mi={m:i for i,m in enumerate(months)}
    def idx(col):
        v=sorted(dn[col].unique()); return v,dn[col].map({x:i for i,x in enumerate(v)}).values
    dn['promotor']=dn.promotor.fillna('Sin dato').astype(str).str.strip().replace({'nan':'Sin dato','':'Sin dato'})
    prom,rP=idx('promotor')
    reg,r0=idx('REGION'); est,rE=idx('ESTADO'); sub,r1=idx('SUBDIRECCION GB'); ger,r2=idx('GERENTE / LIDER'); lid,rL=idx('LIDER'); ter,rT=idx('SUB_TERR'); srg,rG=idx('SUB_REG'); sup,r3=idx('SUPERVISOR'); cad,r4=idx('CADENA'); pdv,r5=idx('NOMBRE PDV'); plan,r6=idx('plan'); forma,r7=idx('forma_pago')
    conc=sorted(dn.conciliacion.unique()); salud=['Sano','Con adeudo vencido','Baja con adeudo','Baja sin adeudo vencido','Sin factura generada','Sin factura en Onix']
    mm=lambda s: s.map(lambda x: mi.get(x,-1)).astype(int).values
    RST=['Alta','Alta Tel (pendiente en base)','Activo','Exportado','Prepago','Baja','No enrolado','No existe','Pendiente']
    def rstf(r):
        if r.alta_confirmada: return 0
        t=r.estatus_tel if isinstance(r.estatus_tel,str) else ''
        if t=='ALTA': return 1
        if t=='EXPORTADO': return 3
        if t=='Prepago': return 4
        if t=='BAJA': return 5
        if t=='ACTIVO': return 2
        if r.enrolamiento=='NO VINCULADO': return 6
        if t=='NO IDENTIFICADO': return 7
        return 8
    rst=dn.apply(rstf,axis=1).astype(int).values
    dn['usuario']=dn.usuario.fillna('Sin dato').astype(str).str.strip()
    dn['promotor']=dn.promotor.fillna('Sin dato')
    enrol=np.where(dn.enrolamiento.eq('NO VINCULADO'),2,np.where(dn.enrolamiento.notna(),1,0))
    tel=np.where(dn.estatus_tel.eq('ALTA'),1,np.where(dn.estatus_tel.eq('NO IDENTIFICADO'),2,np.where(dn.estatus_tel.notna(),3,0)))
    lin=dn.estatus_linea.map({'Activo':1,'Suspendido':2,'Baja':3,'Predesactivado':4,'Desactivado':5}).fillna(0).astype(int).values
    paid_any=inv[inv.clase=='Pagada'].groupby('DNn').size(); dn['tiene_pagada']=dn.DNn.map(paid_any).fillna(0)>0
    mask=lambda d: d[:4]+'••'+d[6:]
    dnv=dn.DNn.map(lambda d: d[:4]+d[6:]).tolist()   # 8 dígitos visibles, para buscar
    dnm=dn.DNn.map(mask).tolist()
    inv['en_ventana']=1
    # ---------- D ----------
    cols=[r0,r1,r2,r3,r4,r5,mm(dn.mes_registro),mm(dn.cohorte),dn.conciliacion.map({c:i for i,c in enumerate(conc)}).values,dn.salud.map({c:i for i,c in enumerate(salud)}).values,
     dn.alta_confirmada.astype(int).values,enrol,tel,lin,r6,r7,rE,dn.fact_generadas.astype(int).values,dn.fact_pagadas.astype(int).values,dn.fact_vencidas_np.astype(int).values,dn.fact_vigentes_np.astype(int).values,dn.fact_por_generar.values,
     rL,rT,rG,dn.dias_atraso_max.fillna(0).astype(int).values,dn.en_registro.astype(int).values,dn.en_calidad.astype(int).values,dnm,dn.tiene_pagada.astype(int).values,
     mm(dn.mes_baja),(dn.fecha_exportado.notna()|dn.estatus_tel.eq('EXPORTADO')).astype(int).values,dn.estatus_tel.map({'ALTA':1,'NO IDENTIFICADO':2,'EXPORTADO':3,'Prepago':4,'BAJA':5,'ACTIVO':6,'SIN INFORMACION':7}).fillna(0).astype(int).values,
     dn.dias_desde_registro.fillna(-1).astype(int).values,dn.dias_activa.fillna(-1).astype(int).values,np.zeros(len(dn),dtype=int),dn['ID PDV'].fillna('').astype(str).str.replace(r'\.0$','',regex=True).tolist(),dnv,rP,dn.usuario.tolist(),rst]
    D=[list(map(lambda x: x.item() if hasattr(x,'item') else x,r)) for r in zip(*cols)]
    pos={d:i for i,d in enumerate(dn.DNn)}
    cl={'Pagada':0,'Vencida no pagada':1,'Vigente no pagada':2,'Por generar':3}
    inv=inv[inv.DNn.isin(pos)].copy()
    pag=inv.clase.eq('Pagada'); venc=((inv.FECHA_VENCIMIENTO<=CORTE)&(inv.clase!='Por generar'))|pag   # pagada aunque no haya vencido = se mide
    ant=pag&(inv.FECHA_VENCIMIENTO>CORTE)
    I=list(zip(inv.DNn.map(pos).tolist(),inv.clase.map(cl).tolist(),inv.NUM_FACT.astype(int).tolist(),mm(inv.mes_emision).tolist(),mm(inv.mes_venc).tolist(),inv.dias_atraso.fillna(0).astype(int).tolist(),venc.astype(int).tolist(),ant.astype(int).tolist(),inv.estimada.astype(int).tolist()))
    # ---------- detalle de facturas (sin por generar) ----------
    t=inv[inv.clase!='Por generar'].copy().sort_values(['DNn','NUM_FACT'])
    ef=['No Pagado','Pago Parcial','Pago Total','Pagado']; ciclos=sorted(t.DES_CICLO.dropna().unique()); fm=forma
    d10=lambda s: s.dt.strftime('%Y-%m-%d').fillna('').tolist()
    T=list(zip(t.DNn.map(pos).tolist(),t.NUM_FACT.astype(int).tolist(),t.clase.map(cl).tolist(),t.ESTATUS_FACTURA.map(lambda x: ef.index(x) if x in ef else 0).tolist(),d10(t.FECHA_EMISION),d10(t.FECHA_VENCIMIENTO),d10(t.FECHA_PAGO),
     t.DES_CICLO.map(lambda x: ciclos.index(x) if x in ciclos else -1).tolist(),t.MONTO_FACTURA.fillna(0).round(2).tolist(),t.SALDO_PENDIENTE.fillna(0).round(2).tolist(),
     t.DES_FORMA_PAGO.map(lambda x: fm.index(fixed) if (fixed:=x) in fm else -1).tolist(),t.FACTURA.fillna('').astype(str).tolist()))

    # ---------- cuota pospago por tienda ----------
    STR_=STR
    fw_=fw.copy(); er_=er.copy(); ca_=ca.copy(); ca_['ID PDV']=ca_['ID PDV Calidad']
    st0=pd.concat([d.reindex(columns=EST) for d in (fw_,er_,ca_)]); st0['ID PDV']=nid(st0['ID PDV']); st0=st0.dropna(subset=['ID PDV']).groupby('ID PDV').first()
    capm=pd.DataFrame({'NOMBRE PDV':capf.NOMBRE_IDPV,'CADENA':capf.CADENA,'REGION':capf.REGION,'ESTADO':capf.ESTADO,'SUB_REG':capf.SUB_REG,'SUB_TERR':capf.SUB_TERR,'LIDER':capf.LIDER}).reindex(columns=EST[1:])
    ms=M.reindex(columns=EST[1:]).combine_first(st0.reindex(columns=EST[1:])).combine_first(capm)
    st=ms
    qd=cuota.rename(columns={'M':'MES'}).copy(); qd=qd[qd.POSPAGO>0].copy(); qd['IDPV']=nid(qd.IDPV)
    qd['m']=pd.to_datetime(qd.MES.astype(str),format='%Y%m').dt.strftime('%Y-%m')
    qd=qd[qd.m.isin(mi)]
    dims={'REGION':reg,'ESTADO':est,'SUBDIRECCION GB':sub,'GERENTE / LIDER':ger,'LIDER':lid,'SUB_TERR':ter,'SUB_REG':srg,'SUPERVISOR':sup,'CADENA':cad,'NOMBRE PDV':pdv}
    def gi(lst,v):
        v='Sin dato' if (not isinstance(v,str) or v.strip() in ('','nan')) else v.strip()
        if v not in lst: lst.append(v)
        return lst.index(v)
    NCOL=len(D[0]); S_=[];Q_=[]
    for idv,g in qd.groupby('IDPV'):
        row=[0]*NCOL; e=st.loc[idv] if idv in st.index else None
        get=lambda c: (e[c] if e is not None else None)
        for col,ix,lst in [('REGION',0,reg),('SUBDIRECCION GB',1,sub),('GERENTE / LIDER',2,ger),('SUPERVISOR',3,sup),('CADENA',4,cad),('NOMBRE PDV',5,pdv),('ESTADO',16,est),('LIDER',22,lid),('SUB_TERR',23,ter),('SUB_REG',24,srg)]:
            row[ix]=gi(lst,get(col))
        row[36]=idv; row[37]=''; row[38]=gi(prom,'Sin dato'); row[7]=-1; row[6]=-1
        S_.append(row); qv=[0]*len(months)
        for m,v in zip(g.m,g.POSPAGO): qv[mi[m]]+=int(v)
        Q_.append(qv)
    out={'corte':CORTE_TXT,'gen':GEN_TXT,'meses':months,'reg':reg,'estado':est,'sub':sub,'ger':ger,'lid':lid,'ter':ter,'srg':srg,'sup':sup,'cad':cad,'pdv':pdv,'plan':plan,'forma':forma,'conc':conc,'salud':salud,'ciclos':ciclos,'rst':RST,'prom':prom,'S':S_,'Q':Q_,'D':D,'I':I,'T':T}
    s=json.dumps(out,ensure_ascii=False,separators=(',',':'))
    log("datos:",round(len(s)/1e6,2),"MB · DN",len(D),"· facturas",len(I),"· tiendas con cuota",len(S_))
    return s,dict(dn=len(D),altas=int(sum(r[10] for r in D)),cuota=int(sum(sum(q) for q in Q_)),facturas=len(I))

# ====================================================================== PÁGINA
MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
ftxt = lambda d: f'{d.day:02d}-{MESES_ES[d.month-1]}-{d.year}'

def html_final(data_json, plantilla, assets):
    t = open(plantilla, encoding='utf-8').read()
    A = json.load(open(assets, encoding='utf-8'))
    use = ['logo_gb', 'gbsaurio_cargando', 'gbsaurio_celebracion_full', 'gbsaurio_celebrando_mini', 'gbsaurio_molesto_full', 'gbsaurio_molesto_mini',
           'gbsaurio_neutral_mini', 'gbsaurio_ok_full', 'gbsaurio_ok_mini', 'gbsaurio_triste_full', 'gbsaurio_triste_mini']
    assert '__DATA__' in t and '__ASSETS__' in t, 'plantilla inválida'
    return t.replace('__DATA__', data_json.replace('</', '<\\/'), 1).replace('__ASSETS__', json.dumps({k: A[k] for k in use if k in A}), 1)

GATE = """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Centro de Mando Pospago</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:#1b1e23;color:#f2f3f5;font-family:Poppins,system-ui,Segoe UI,Arial,sans-serif;display:grid;place-items:center;padding:16px}
.box{width:min(380px,100%);background:#23272e;border:1px solid #343a43;border-radius:14px;padding:28px 24px;text-align:center}
h1{font-size:18px;margin:0 0 4px}small{color:#a8afb9}
.tag{display:inline-block;background:#ee6602;color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle}
input{width:100%;margin:18px 0 10px;padding:11px 12px;border-radius:8px;border:1px solid #4a515c;background:#1b1e23;color:#fff;font:inherit}
button{width:100%;padding:11px;border:0;border-radius:8px;background:#ee6602;color:#fff;font:inherit;font-weight:600;cursor:pointer}
#m{min-height:18px;margin:10px 0 0;color:#ff8a80;font-size:13px}
</style></head><body><div class="box"><h1>Centro de Mando<span class="tag">POSPAGO</span></h1><small>Grupo Benber · acceso interno</small>
<form id="f"><input id="k" type="password" placeholder="Contraseña" autocomplete="current-password" autofocus><button>Entrar</button></form><p id="m"></p></div>
<script>
(function(){
var P=__PAYLOAD__;
function B(x){return Uint8Array.from(atob(x),function(c){return c.charCodeAt(0)})}
async function abrir(pw){
 var km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
 var k=await crypto.subtle.deriveKey({name:'PBKDF2',salt:B(P.s),iterations:P.n,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:B(P.i)},k,B(P.c)));
}
async function entrar(pw,auto){
 var m=document.getElementById('m');m.textContent=auto?'':'Abriendo…';
 var h;
 try{h=await abrir(pw)}catch(e){m.textContent=auto?'':'Contraseña incorrecta';return}
 P=null;document.open();document.write(h);document.close();
}
document.getElementById('f').onsubmit=function(e){e.preventDefault();entrar(document.getElementById('k').value.trim(),false)};
// No se recuerda la contraseña (decisión de Elías): se pide cada vez. Se borra la que guardaban versiones anteriores.
try{localStorage.removeItem('cm_pw');sessionStorage.removeItem('cm_pw')}catch(e){}
})();
</script></body></html>"""

def cifrar(html, clave):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise RuntimeError('Falta el paquete "cryptography". Instálalo una vez con:  py -m pip install cryptography')
    salt, iv, n = os.urandom(16), os.urandom(12), 200000
    k = hashlib.pbkdf2_hmac('sha256', clave.encode('utf-8'), salt, n, 32)
    c = AESGCM(k).encrypt(iv, html.encode('utf-8'), None)
    b = lambda x: base64.b64encode(x).decode()
    return GATE.replace('__PAYLOAD__', json.dumps({'s': b(salt), 'i': b(iv), 'c': b(c), 'n': n}))

# ====================================================================== PUBLICAR (Netlify)
def publicar(carpeta, site_id, token):
    import urllib.request
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in ('index.html', '_headers', 'robots.txt'):
            p = os.path.join(carpeta, f)
            if os.path.exists(p): z.write(p, f)
    req = urllib.request.Request(f'https://api.netlify.com/api/v1/sites/{site_id}/deploys', data=buf.getvalue(), method='POST',
                                 headers={'Content-Type': 'application/zip', 'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.loads(r.read().decode('utf-8'))
    return j.get('ssl_url') or j.get('url'), j.get('state')

def publicar_git(carpeta, repo_dir, subdir='pospago'):
    """Copia la página a <repo>/docs/<subdir>/ y hace commit + push (GitHub Pages), igual que Avance GB."""
    import shutil, subprocess
    def git(*a, check=True):
        r = subprocess.run(['git', '-C', repo_dir] + list(a), capture_output=True, text=True)
        if check and r.returncode != 0: raise RuntimeError('git ' + ' '.join(a) + ' -> ' + (r.stderr or r.stdout).strip())
        return r
    if not os.path.isdir(os.path.join(repo_dir, '.git')): raise RuntimeError('repo_dir no es un repositorio git: ' + repo_dir)
    dest = os.path.join(repo_dir, 'docs', subdir); os.makedirs(dest, exist_ok=True)
    git('pull', '--rebase', '--autostash', check=False)
    for f in ('index.html', 'robots.txt'):
        shutil.copyfile(os.path.join(carpeta, f), os.path.join(dest, f))
    git('add', '--', os.path.join('docs', subdir))
    if not git('status', '--porcelain', '--', os.path.join('docs', subdir)).stdout.strip(): return 'sin cambios'
    git('commit', '-m', 'Pospago ' + time.strftime('%Y-%m-%d %H:%M'))
    r = git('push', check=False)
    if r.returncode != 0:
        git('pull', '--rebase', '--autostash'); git('push')
    return 'publicado'

# ====================================================================== PRINCIPAL
def validar(res, prev):
    """Reglas para NO publicar una página rota o con datos incompletos."""
    err = []
    if res['altas'] < 500: err.append(f"muy pocas altas ({res['altas']})")
    if res['facturas'] < 1000: err.append(f"muy pocas facturas ({res['facturas']})")
    if res['cuota'] <= 0: err.append('cuota total en cero')
    if prev:
        for k in ('altas', 'dn', 'facturas'):
            if prev.get(k) and res[k] < 0.85 * prev[k]:
                err.append(f"{k} cayó de {prev[k]} a {res[k]} (más de 15%): revisa que los archivos fuente estén completos")
    return err

def construir(raiz, salida, clave=None, forzar=False):
    t0 = time.time()
    os.makedirs(salida, exist_ok=True)
    M = cargar_estructura(raiz)
    cuota, capf = cargar_cuotas(raiz)
    ca = cargar_altas(raiz)
    CORTE = pd.to_datetime(ca['FECHA_PAGO'], errors='coerce').max().normalize()
    log('corte de pagos (último pago en Onix):', CORTE.date())
    fw = cargar_fw(raiz, M)
    er = cargar_estatus(raiz, M)
    vi = cargar_vinc(raiz)
    dn, inv, ca2 = cruce(fw, er, ca, vi, M, CORTE)
    ahora = datetime.datetime.now()
    data, res = mkdata(dn, inv, M, capf, cuota, fw, er, ca2, CORTE, ftxt(CORTE), f'{ftxt(ahora)} {ahora:%H:%M}')
    estado_p = os.path.join(salida, 'estado.json')
    prev = json.load(open(estado_p)) if os.path.exists(estado_p) else None
    err = validar(res, prev)
    if err and not forzar:
        raise RuntimeError('VALIDACIÓN FALLIDA, no se publica: ' + '; '.join(err))
    plantilla = os.path.join(AQUI, 'plantilla_centro_mando.html'); assets = os.path.join(AQUI, 'assets.json')
    html = html_final(data, plantilla, assets)
    open(os.path.join(salida, 'index_abierto.html'), 'w', encoding='utf-8').write(html)    # copia local sin clave
    pub = cifrar(html, clave) if clave else html
    open(os.path.join(salida, 'index.html'), 'w', encoding='utf-8').write(pub)
    open(os.path.join(salida, '_headers'), 'w').write('/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n')
    open(os.path.join(salida, 'robots.txt'), 'w').write('User-agent: *\nDisallow: /\n')
    res['corte'] = str(CORTE.date()); res['generado'] = ahora.isoformat(timespec='seconds')
    json.dump(res, open(estado_p, 'w'), indent=1)
    log(f'listo en {time.time()-t0:.0f}s · {len(html)/1e6:.1f} MB', '· cifrada con clave' if clave else '· SIN clave')
    return res

def main():
    ap = argparse.ArgumentParser(description='Centro de Mando Pospago · Grupo Benber')
    ap.add_argument('--root', default=os.environ.get('CM_ROOT') or CFG.get('root') or RAIZ_DEFAULT, help='carpeta BASE con los archivos fuente')
    ap.add_argument('--out', default=os.path.join(AQUI, 'salida'), help='carpeta de salida')
    ap.add_argument('--deploy', action='store_true', help='publica en el enlace fijo (Netlify)')
    ap.add_argument('--sin-clave', action='store_true', help='no cifrar la página con contraseña')
    ap.add_argument('--forzar', action='store_true', help='publica aunque falle la validación')
    a = ap.parse_args()
    clave = None if a.sin_clave else (os.environ.get('CM_CLAVE') or CFG.get('clave') or None)
    try:
        res = construir(a.root, a.out, clave, a.forzar)
        if a.deploy:
            if not clave and not CFG.get('permitir_publico'):
                raise RuntimeError('La página trae nombres de promotores e importes: define "clave" en config.json (o "permitir_publico": true)')
            repo = os.environ.get('CM_REPO') or CFG.get('repo_dir')
            padre = os.path.dirname(AQUI)
            site = os.environ.get('NETLIFY_SITE_ID') or CFG.get('netlify_site_id'); tok = os.environ.get('NETLIFY_TOKEN') or CFG.get('netlify_token')
            if not repo and not (site and tok) and os.path.isdir(os.path.join(padre, '.git')): repo = padre   # el script vive dentro del repo
            if repo:
                est = publicar_git(a.out, repo, CFG.get('docs_subdir', 'pospago')); log('GITHUB PAGES:', est)
            elif site and tok:
                url, est = publicar(a.out, site, tok); log('PUBLICADO', url, est)
            else:
                raise RuntimeError('Falta destino: define "repo_dir" (GitHub Pages) o netlify_site_id + netlify_token en config.json')
    except Exception as e:
        log('ERROR:', e); traceback.print_exc(); sys.exit(1)

if __name__ == '__main__':
    main()

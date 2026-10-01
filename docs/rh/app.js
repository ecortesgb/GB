/* RH GB · app de Recursos Humanos. Pantalla 1: bandeja de posibles bajas y ausencias. */
const CFG = window.RH_CONFIG, ASSET = window.RH_ASSETS || {};
const DEMO = new URLSearchParams(location.search).has('demo');
const $ = id => document.getElementById(id);
const img = k => ASSET[k] || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const HOY = hoyISO();
const addD = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const diffD = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
const fdate = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(2, 4) : '—';
const fmt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('es-MX');
const toast = m => { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.k); toast.k = setTimeout(() => t.hidden = true, 2800); };
const NIVEL = { admin: 'Administrador', direccion: 'Dirección', gerente: 'Gerente', rh: 'RH', reclutador: 'Reclutador' };

/* ====================================================================== capa de datos ====================================================================== */
let sb = null;
async function todo(q) { // pagina de 1000 en 1000
  let out = [], i = 0;
  for (;;) { const { data, error } = await q().range(i, i + 999); if (error) throw error; out = out.concat(data); if (data.length < 1000) return out; i += 1000; }
}
const Real = {
  async init() { sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } }); const { data } = await sb.auth.getSession(); return !!data.session; },
  async login(u, p) { const email = u.includes('@') ? u : u.trim().toLowerCase() + CFG.dominio; const { error } = await sb.auth.signInWithPassword({ email, password: p }); if (error) throw new Error('Usuario o contraseña incorrectos'); },
  async logout() { await sb.auth.signOut(); },
  async me() {
    const { data: u } = await sb.auth.getUser(); const id = u.user.id;
    const { data: p, error } = await sb.from('perfiles').select('*').eq('id', id).maybeSingle();
    if (error || !p) throw new Error('Tu usuario existe pero no tiene perfil asignado. Pide a un administrador que lo active.');
    const { data: pm } = await sb.from('permisos').select('*').eq('rol', p.rol);
    return { id, nombre: p.nombre, rol: p.rol, rrhh: p.rrhh_nombre, zona: p.zona_rrhh, reclutador_id: p.reclutador_id, permisos: Object.fromEntries((pm || []).map(x => [x.modulo, x])) };
  },
  async catalogos() {
    const [t, ma, mb] = await Promise.all([todo(() => sb.from('tiendas').select('idpdv,nombre,cadena,estado,region,gerente,supervisor,rrhh,posiciones')),
      sb.from('catalogo_motivos_ausencia').select('motivo').eq('activo', true), sb.from('catalogo_motivos_baja').select('motivo,tipo').eq('activo', true)]);
    return { tiendas: Object.fromEntries(t.map(x => [x.idpdv, x])), motAus: ma.data.map(x => x.motivo), motBaja: mb.data };
  },
  async alertas() {
    const al = await todo(() => sb.from('alertas_asistencia').select('id,usuario_fieldwy,ultimo_check,dias_sin_check,idpdv,colaboradores(nombre,empresa,fecha_ingreso,idpdv)').eq('estatus', 'Abierta').order('dias_sin_check', { ascending: false }));
    const desde = addD(HOY, -90);
    const us = al.map(a => a.usuario_fieldwy);
    let hist = [];
    if (us.length) hist = await todo(() => sb.from('ausencias').select('usuario_fieldwy,motivo,fecha_inicio,dias,fecha_regreso').gte('fecha_inicio', desde).neq('motivo', 'Descanso').in('usuario_fieldwy', us.slice(0, 400)));
    const por = {}; hist.forEach(h => (por[h.usuario_fieldwy] = por[h.usuario_fieldwy] || []).push(h));
    return al.map(a => ({ id: a.id, usuario: a.usuario_fieldwy, nombre: a.colaboradores?.nombre || a.usuario_fieldwy, ultimo: a.ultimo_check, dias: a.dias_sin_check, idpdv: a.idpdv || a.colaboradores?.idpdv, empresa: a.colaboradores?.empresa, ingreso: a.colaboradores?.fecha_ingreso, aus: por[a.usuario_fieldwy] || [] }));
  },
  async vigentes() {
    const r = await todo(() => sb.from('ausencias').select('id,usuario_fieldwy,motivo,fecha_inicio,dias,fecha_regreso,comentarios,idpdv,colaboradores(nombre,idpdv)').gt('fecha_regreso', HOY).lte('fecha_inicio', HOY).neq('motivo', 'Descanso').order('fecha_regreso'));
    return r.map(a => ({ id: a.id, usuario: a.usuario_fieldwy, nombre: a.colaboradores?.nombre || a.usuario_fieldwy, motivo: a.motivo, inicio: a.fecha_inicio, dias: a.dias, regreso: a.fecha_regreso, idpdv: a.idpdv || a.colaboradores?.idpdv, comentarios: a.comentarios }));
  },
  async solapes(usuario, ini, reg) {
    const { data } = await sb.from('ausencias').select('motivo,fecha_inicio,fecha_regreso').eq('usuario_fieldwy', usuario).neq('motivo', 'Descanso').lt('fecha_inicio', reg).gt('fecha_regreso', ini);
    return data || [];
  },
  async registrarAusencia(al, d) {
    const { data, error } = await sb.from('ausencias').insert({ usuario_fieldwy: al.usuario, motivo: d.motivo, fecha_inicio: d.inicio, dias: d.dias, comentarios: d.comentarios || null, idpdv: al.idpdv || null }).select('id').single();
    if (error) throw error;
    await this.cerrar(al, 'Con ausencia', data.id);
  },
  async confirmarBaja(al, d, usr) {
    const { error } = await sb.from('bajas').insert({ usuario_fieldwy: al.usuario, fecha_baja: d.fecha, ultimo_dia_laborado: al.ultimo, motivo: d.motivo, marca_destino: d.marca || null, comentarios: d.comentarios || null, idpdv: al.idpdv || null });
    if (error) throw error;
    const m = await sb.from('movimientos').insert({ usuario_fieldwy: al.usuario, tipo: 'Baja', fecha: d.fecha, motivo: d.motivo, idpdv: al.idpdv || null, origen: 'app' }); if (m.error) throw m.error;
    const c = await sb.from('colaboradores').update({ estatus: 'Baja' }).eq('usuario_fieldwy', al.usuario); if (c.error) throw c.error;
    await this.cerrar(al, 'Baja confirmada');
  },
  async errorAsistencia(al) { await this.cerrar(al, 'Error de asistencia'); },
  async cerrar(al, estatus, ausId) {
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from('alertas_asistencia').update({ estatus, ausencia_id: ausId || null, resuelta_por: u.user.id, resuelta_en: new Date().toISOString() }).eq('id', al.id);
    if (error) throw error;
  }
};

/* ---------- datos de ejemplo (todo ficticio; escribe solo en memoria) ---------- */
const Demo = (() => {
  const nombres = ['Ana Karen Solís', 'Luis Ángel Ortega', 'María Fernanda Cruz', 'José Manuel Reyes', 'Daniela Ruiz Peña', 'Carlos Iván Mora', 'Paola Estrada', 'Jorge Alberto Lara', 'Valeria Núñez', 'Diego Armando Gil', 'Karla Itzel Vega', 'Miguel Ángel Soto', 'Fátima Luna', 'Ricardo Salas', 'Brenda Morales', 'Héctor Duarte', 'Itzel Aguirre', 'Omar Castañeda', 'Lucía Montes', 'Andrés Cabrera', 'Nancy Palacios', 'Emilio Rangel', 'Sofía Barrera', 'Raúl Meza'];
  const est = [['Puebla', 'SUR', 'Julio César Aldana'], ['Veracruz', 'SUR', 'Jessica Santos'], ['Guanajuato', 'OCCIDENTE', 'Andrea Maya'], ['Nuevo León', 'NORTE', 'Flor Morado'], ['Ciudad de México', 'CENTRO', 'Dulce Apaiz']];
  const cad = ['Coppel', 'Elektra', 'Suburbia', 'Cimaco'];
  const tiendas = {}; let id = 1000;
  const tien = []; for (let i = 0; i < 40; i++) { const e = est[i % 5]; const t = { idpdv: id + i, nombre: (cad[i % 4]).toUpperCase() + ' ' + ['CENTRO', 'PLAZA SOL', 'NORTE', 'REFORMA', 'ALAMEDA', 'LAS TORRES', 'CANADA', 'AZTECAS'][i % 8] + ' ' + (i + 1), cadena: cad[i % 4], estado: e[0], region: e[1], gerente: 'Gerente Demo', supervisor: 'Supervisor ' + (i % 7 + 1), rrhh: e[2], posiciones: 1 + ((id + i) % 2) }; tiendas[t.idpdv] = t; tien.push(t); }
  const mkAus = (u, k) => { const m = ['Permiso especial', 'Vacaciones', 'Incapacidad (IMSS)', 'Tema médico (particular)']; return Array.from({ length: k }, (_, j) => ({ motivo: m[(u + j) % 4], fecha_inicio: addD(HOY, -(8 + j * 21 + u % 9)), dias: 1 + (u + j) % 5, fecha_regreso: addD(HOY, -(8 + j * 21 + u % 9) + 1 + (u + j) % 5) })); };
  let alertas = nombres.map((n, i) => { const dias = [2, 2, 3, 2, 4, 6, 2, 3, 9, 2, 5, 2, 3, 2, 12, 2, 4, 3, 2, 7, 2, 3, 2, 5][i]; const t = tien[(i * 7) % 40]; return { id: i + 1, usuario: 'DEMO' + String(100 + i), nombre: n, ultimo: addD(HOY, -dias), dias, idpdv: t.idpdv, empresa: ['Benber SS', 'Revelor', 'Doma Legal', 'Atmosphera'][i % 4], ingreso: addD(HOY, -(30 + i * 37)), aus: mkAus(i, i % 4 === 0 ? 3 : i % 3) }; });
  let vigentes = [['Vacaciones', 6, 3], ['Incapacidad (IMSS)', 10, 5], ['Permiso especial', 3, 1], ['Tema médico (particular)', 4, 2], ['Vacaciones', 12, 8], ['Incapacidad (IMSS)', 20, 9], ['Permiso especial', 2, 1]].map((v, i) => ({ id: 500 + i, usuario: 'DEMO' + (300 + i), nombre: ['Pedro Lozano', 'Gabriela Ibarra', 'Mónica Téllez', 'Saúl Cervantes', 'Teresa Pineda', 'Víctor Maya', 'Elena Ochoa'][i], motivo: v[0], inicio: addD(HOY, -v[2]), dias: v[1], regreso: addD(HOY, v[1] - v[2]), idpdv: tien[(i * 5) % 40].idpdv }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  return {
    async init() { return true; }, async login() { }, async logout() { location.href = location.pathname; },
    async me() { return { id: 'demo', nombre: 'Usuario de ejemplo', rol: 'rh', rrhh: 'Julio César Aldana', zona: null, permisos: Object.fromEntries(['alertas', 'ausencias', 'bajas', 'colaboradores', 'posibles_ingresos', 'expedientes', 'reportes'].map(m => [m, { ver: true, crear: true, editar: true, borrar: false, alcance: 'estado' }])) }; },
    async catalogos() { return { tiendas, motAus: ['Permiso especial', 'Vacaciones', 'Incapacidad (IMSS)', 'Tema médico (particular)', 'No localizado'], motBaja: [['Motivos personales', 'Voluntaria'], ['Renuncia voluntaria', 'Voluntaria'], ['Abandono de trabajo', 'Voluntaria'], ['Mejor oferta laboral (telefonía)', 'Voluntaria'], ['Mejor oferta laboral (otro rubro)', 'Voluntaria'], ['Cambio a marca o cadena', 'Voluntaria'], ['Malas prácticas', 'Involuntaria'], ['Baja productividad', 'Involuntaria'], ['Rescisión de contrato', 'Involuntaria'], ['Faltas consecutivas e injustificadas', 'Involuntaria']].map(([motivo, tipo]) => ({ motivo, tipo })) }; },
    async alertas() { await wait(150); return alertas.map(a => ({ ...a, aus: a.aus.map(x => ({ usuario_fieldwy: a.usuario, ...x })) })); },
    async vigentes() { await wait(100); return vigentes; },
    async solapes(u, ini, reg) { return []; },
    async registrarAusencia(al, d) { await wait(250); vigentes.push({ id: Date.now(), usuario: al.usuario, nombre: al.nombre, motivo: d.motivo, inicio: d.inicio, dias: d.dias, regreso: addD(d.inicio, d.dias), idpdv: al.idpdv }); alertas = alertas.filter(x => x.id !== al.id); },
    async confirmarBaja(al) { await wait(250); alertas = alertas.filter(x => x.id !== al.id); },
    async errorAsistencia(al) { await wait(150); alertas = alertas.filter(x => x.id !== al.id); }
  };
})();
const API = DEMO ? Demo : Real;

/* ====================================================================== estado y UI ====================================================================== */
const S = { me: null, cat: null, alertas: [], vigentes: [], view: 'bandeja', f: { q: '', estado: '', rrhh: '', min: 2 } };
const can = (mod, acc) => !!(S.me && S.me.permisos[mod] && S.me.permisos[mod][acc]);
const tienda = id => (S.cat && S.cat.tiendas[id]) || null;
const colorDias = d => d >= 5 ? 'd5' : d >= 3 ? 'd3' : 'd2';

const VISTAS = [
  { k: 'resumen', ic: '📊', n: 'Resumen', mod: 'reportes', f: vResumen },
  { k: 'penal', ic: '⚠️', n: 'Penalización', mod: 'reportes', f: vPenal },
  { k: 'checks', ic: '✅', n: 'Detalle de checks', mod: 'reportes', f: vChecks },
  { k: 'hc', ic: '👥', n: 'HC', mod: 'reportes', f: vHC },
  { k: 'sep', n: 'Gestión', sep: true },
  { k: 'bandeja', ic: '🚨', n: 'Posibles bajas', mod: 'alertas', f: vBandeja },
  { k: 'vigentes', ic: '🩺', n: 'Ausencias vigentes', mod: 'ausencias', f: vVigentes },
  { k: 'ingresos', ic: '🧑‍💼', n: 'Posibles ingresos', mod: 'posibles_ingresos', f: vIngresos },
  { k: 'bajas', ic: '📤', n: 'Bajas y encuesta', mod: 'bajas', soon: true },
  { k: 'expedientes', ic: '🗂️', n: 'Expedientes', mod: 'expedientes', soon: true }
];

function nav() {
  $('nav').innerHTML = VISTAS.filter(v => v.sep || can(v.mod, 'ver')).map(v => v.sep ? `<div class="nav-sep">${v.n}</div>` : `<div class="nav-item ${v.k === S.view ? 'active' : ''} ${v.soon ? 'off' : ''}" ${v.soon ? '' : `onclick="ir('${v.k}')"`}><span class="ic">${v.ic}</span>${v.n}${v.soon ? '<span class="soon">pronto</span>' : ''}</div>`).join('');
}
function ir(k) { S.view = k; $('sidebar').classList.remove('open'); nav(); render(); window.scrollTo(0, 0); }
function render() { const v = VISTAS.find(x => x.k === S.view); if (v && v.f) v.f(); }
const cab = (t, sub, m) => `<div class="page-head"><div><h2>${t}${DEMO ? '<span class="demo-tag">DATOS DE EJEMPLO</span>' : ''}</h2><div class="sub">${sub}</div></div><img class="pg-mascot" src="${img(m)}" alt=""></div>`;

/* ---------- bandeja ---------- */
function filtradas() {
  const q = S.f.q.trim().toLowerCase();
  return S.alertas.filter(a => a.dias >= S.f.min).filter(a => {
    const t = tienda(a.idpdv);
    if (S.f.estado && (!t || t.estado !== S.f.estado)) return false;
    if (S.f.rrhh && (!t || t.rrhh !== S.f.rrhh)) return false;
    if (q && !(`${a.nombre} ${a.usuario} ${t ? t.nombre + ' ' + t.supervisor : ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
function vBandeja() {
  const todas = S.alertas, f = filtradas();
  const n = (min, max = 9999) => todas.filter(a => a.dias >= min && a.dias <= max).length;
  const estados = [...new Set(todas.map(a => (tienda(a.idpdv) || {}).estado).filter(Boolean))].sort();
  const rrhhs = [...new Set(todas.map(a => (tienda(a.idpdv) || {}).rrhh).filter(Boolean))].sort();
  const reg = S.vigentes.filter(v => diffD(v.regreso, HOY) <= 3).length;
  let h = cab('Posibles bajas', 'Promotores que llevan 2 o más días sin check y no tienen una ausencia registrada. Resuelve cada caso aquí mismo: registra la ausencia, confirma la baja o márcalo como error de asistencia.', 'guino');
  h += `<div class="kpis">
    <div class="kpi click ${S.f.min === 2 ? 'sel' : ''}" onclick="S.f.min=2;vBandeja()"><div class="l">Abiertas</div><div class="v">${fmt(todas.length)}</div><div class="s">2 o más días sin check</div></div>
    <div class="kpi click ${S.f.min === 3 ? 'sel' : ''}" onclick="S.f.min=3;vBandeja()"><div class="l">3 o más días</div><div class="v" style="color:var(--orange-n)">${fmt(n(3))}</div><div class="s">prioridad media</div></div>
    <div class="kpi click ${S.f.min === 5 ? 'sel' : ''}" onclick="S.f.min=5;vBandeja()"><div class="l">5 o más días</div><div class="v" style="color:var(--red)">${fmt(n(5))}</div><div class="s">prioridad alta</div></div>
    <div class="kpi"><div class="l">Con ausencia vigente</div><div class="v" style="color:var(--blue)">${fmt(S.vigentes.length)}</div><div class="s">${fmt(reg)} regresan en ≤ 3 días</div></div></div>`;
  h += `<div class="tools"><input type="search" id="q" placeholder="Buscar nombre, usuario, tienda o supervisor…" value="${esc(S.f.q)}">
    <select id="fe"><option value="">Todos los estados</option>${estados.map(e => `<option ${S.f.estado === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
    ${rrhhs.length > 1 ? `<select id="fr"><option value="">Todo RR.HH.</option>${rrhhs.map(e => `<option ${S.f.rrhh === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>` : ''}
    <span class="muted">${fmt(f.length)} caso${f.length === 1 ? '' : 's'}</span></div>`;
  if (!f.length) h += `<div class="card empty"><img src="${img('triunfo')}" alt="">Sin casos pendientes con estos filtros. ¡Todo al día!</div>`;
  else h += `<div class="list"><div class="al head"><span>Promotor</span><span>Tienda</span><span>Sin check</span><span>Último check</span><span>Últimos 90 días</span><span></span></div>${f.slice(0, 300).map(filaAlerta).join('')}</div>${f.length > 300 ? '<p class="muted">Mostrando 300; usa los filtros para acotar.</p>' : ''}`;
  $('content').innerHTML = h;
  $('q').oninput = e => { S.f.q = e.target.value; clearTimeout(vBandeja.t); vBandeja.t = setTimeout(() => { const p = e.target.selectionStart; vBandeja(); const q = $('q'); q.focus(); q.setSelectionRange(p, p); }, 250); };
  $('fe').onchange = e => { S.f.estado = e.target.value; vBandeja(); };
  if ($('fr')) $('fr').onchange = e => { S.f.rrhh = e.target.value; vBandeja(); };
}
function filaAlerta(a) {
  const t = tienda(a.idpdv), ant = a.ingreso ? diffD(HOY, a.ingreso) : null;
  const rep = a.aus.length >= 3;
  const dias90 = a.aus.reduce((s, x) => s + x.dias, 0);
  const hist = a.aus.length ? `<span class="${rep ? 'rep' : ''}">${a.aus.length} ausencia${a.aus.length > 1 ? 's' : ''} · ${dias90} d</span><br>${esc(a.aus.slice().sort((x, y) => y.fecha_inicio.localeCompare(x.fecha_inicio))[0].motivo)} (${fdate(a.aus.slice().sort((x, y) => y.fecha_inicio.localeCompare(x.fecha_inicio))[0].fecha_inicio)})` : 'Sin ausencias';
  return `<div class="al">
    <div class="who a-who"><b>${esc(a.nombre)}</b><small>${esc(a.usuario)}${ant != null ? ' · ' + (ant < 90 ? ant + ' días en la empresa' : Math.floor(ant / 30) + ' meses') : ''}${a.empresa ? ' · ' + esc(a.empresa) : ''}</small></div>
    <div class="store a-store"><b>${t ? esc(t.nombre) : 'Tienda no identificada'}</b><small>${t ? esc(t.estado) + ' · ' + esc(t.supervisor || '') : ''}</small></div>
    <div class="a-days"><span class="days ${colorDias(a.dias)}">${a.dias} d</span></div>
    <div class="muted a-last">${fdate(a.ultimo)}</div>
    <div class="hist a-hist">${hist}</div>
    <div class="acts a-acts">
      ${can('ausencias', 'crear') ? `<button class="btn sm primary" onclick="abrir('aus',${a.id})">Registrar ausencia</button>` : ''}
      ${can('bajas', 'crear') ? `<button class="btn sm danger" onclick="abrir('baja',${a.id})">Confirmar baja</button>` : ''}
      ${can('alertas', 'editar') ? `<button class="btn sm" onclick="abrir('err',${a.id})" title="Marcar como error de asistencia">Error</button>` : ''}
    </div></div>`;
}

/* ---------- ausencias vigentes ---------- */
function vVigentes() {
  const rows = S.vigentes.map(v => ({ ...v, faltan: diffD(v.regreso, HOY), t: tienda(v.idpdv) })).sort((a, b) => a.faltan - b.faltan);
  const porMot = {}; rows.forEach(r => porMot[r.motivo] = (porMot[r.motivo] || 0) + 1);
  let h = cab('Ausencias vigentes', 'Promotores con ausencia registrada que sigue vigente hoy, y cuándo regresan.', 'mochila');
  h += `<div class="kpis"><div class="kpi"><div class="l">Vigentes</div><div class="v">${fmt(rows.length)}</div><div class="s">hoy</div></div>${Object.entries(porMot).map(([m, c]) => `<div class="kpi"><div class="l">${esc(m)}</div><div class="v">${c}</div></div>`).join('')}<div class="kpi"><div class="l">Regresan en ≤ 3 días</div><div class="v" style="color:var(--orange-n)">${rows.filter(r => r.faltan <= 3).length}</div></div></div>`;
  h += rows.length ? `<div class="tbl-wrap"><table class="dt"><thead><tr><th>Promotor</th><th>Motivo</th><th>Inicio</th><th>Días</th><th>Regresa</th><th>Faltan</th><th>Tienda</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.nombre)}</b><br><span class="muted">${esc(r.usuario)}</span></td><td>${esc(r.motivo)}</td><td>${fdate(r.inicio)}</td><td>${r.dias}</td><td>${fdate(r.regreso)}</td><td><span class="pill ${r.faltan <= 0 ? 'r' : r.faltan <= 3 ? 'a' : 'x'}">${r.faltan <= 0 ? 'hoy' : r.faltan + ' d'}</span></td><td>${r.t ? esc(r.t.nombre) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card empty">No hay ausencias vigentes.</div>`;
  $('content').innerHTML = h;
}

/* ---------- acciones (ventana) ---------- */
const cerrarM = () => { $('modal').hidden = true; $('modal').innerHTML = ''; };
function abrir(tipo, id) {
  const a = S.alertas.find(x => x.id === id); if (!a) return;
  const t = tienda(a.idpdv);
  const cab = (tt) => `<h3>${tt}</h3><div class="who">${esc(a.nombre)} · ${esc(a.usuario)}<br>${t ? esc(t.nombre) : ''} · último check ${fdate(a.ultimo)} (${a.dias} días sin check)</div>`;
  let h = '';
  if (tipo === 'aus') {
    const ini = addD(a.ultimo, 1);
    h = cab('Registrar ausencia') + `<div class="fld"><label>Motivo</label><select id="m-mot">${S.cat.motAus.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="row2"><div class="fld"><label>Primer día de ausencia</label><input type="date" id="m-ini" value="${ini}"></div><div class="fld"><label>Días</label><input type="number" id="m-dias" min="1" max="365" value="${Math.max(1, a.dias)}"></div></div>
      <div class="note" id="m-reg"></div><div class="warn" id="m-warn" hidden></div>
      <div class="fld"><label>Comentarios (opcional)</label><textarea id="m-com" placeholder="Folio de incapacidad, quién avisó, etc."></textarea></div>
      <div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Guardar ausencia</button></div>`;
  } else if (tipo === 'baja') {
    const vol = S.cat.motBaja.filter(m => m.tipo === 'Voluntaria'), inv = S.cat.motBaja.filter(m => m.tipo !== 'Voluntaria');
    h = cab('Confirmar baja') + `<div class="fld"><label>Motivo de baja</label><select id="m-mot"><optgroup label="Voluntaria">${vol.map(m => `<option>${esc(m.motivo)}</option>`).join('')}</optgroup><optgroup label="Involuntaria">${inv.map(m => `<option>${esc(m.motivo)}</option>`).join('')}</optgroup></select></div>
      <div class="fld"><label>Fecha de baja</label><input type="date" id="m-fecha" value="${HOY}"></div>
      <div class="fld" id="m-marca-w" hidden><label>Marca o cadena destino</label><input id="m-marca" placeholder="Ej. Telcel, Walmart…"></div>
      <div class="fld"><label>Comentarios / adeudos con la agencia</label><textarea id="m-com"></textarea></div>
      <div class="note">La encuesta de salida la contestará el promotor por un enlace (próximamente).</div>
      <div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn danger" id="m-ok">Confirmar baja</button></div>`;
  } else {
    h = cab('Marcar como error de asistencia') + `<p class="muted" style="font-weight:600">Úsalo cuando el promotor sí laboró pero su check no se registró bien (falla de la app, equipo, ubicación…). Sale de la bandeja y no cuenta como ausencia ni baja.</p>
      <div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Marcar como error</button></div>`;
  }
  $('modal').innerHTML = `<div class="mbox" role="dialog" aria-modal="true">${h}</div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
  const calc = async () => {
    if (tipo !== 'aus') return;
    const ini = $('m-ini').value, dias = +$('m-dias').value, w = $('m-warn');
    if (!ini || !dias) { $('m-reg').textContent = ''; return; }
    const reg = addD(ini, dias); $('m-reg').textContent = `Regresa el ${fdate(reg)} (${dias} día${dias > 1 ? 's' : ''} desde el ${fdate(ini)}).`;
    const sol = await API.solapes(a.usuario, ini, reg);
    if (sol.length) { w.hidden = false; w.textContent = 'Se traslapa con otra ausencia: ' + sol.map(s => `${s.motivo} (${fdate(s.fecha_inicio)} al ${fdate(addD(s.fecha_regreso, -1))})`).join('; ') + '. Ajusta las fechas.'; } else w.hidden = true;
    $('m-ok').disabled = sol.length > 0;
  };
  if (tipo === 'aus') { $('m-ini').oninput = calc; $('m-dias').oninput = calc; calc(); }
  if (tipo === 'baja') { const mm = () => { $('m-marca-w').hidden = $('m-mot').value !== 'Cambio a marca o cadena'; }; $('m-mot').onchange = mm; mm(); }
  $('m-ok').onclick = async () => {
    const b = $('m-ok'); b.disabled = true; b.textContent = 'Guardando…';
    try {
      if (tipo === 'aus') await API.registrarAusencia(a, { motivo: $('m-mot').value, inicio: $('m-ini').value, dias: +$('m-dias').value, comentarios: $('m-com').value });
      else if (tipo === 'baja') await API.confirmarBaja(a, { motivo: $('m-mot').value, fecha: $('m-fecha').value, marca: $('m-marca').value, comentarios: $('m-com').value });
      else await API.errorAsistencia(a);
      cerrarM(); toast(tipo === 'aus' ? 'Ausencia registrada' : tipo === 'baja' ? 'Baja confirmada' : 'Marcada como error de asistencia');
      S.alertas = S.alertas.filter(x => x.id !== a.id); if (tipo === 'aus') S.vigentes = await API.vigentes(); nav(); render();
    } catch (e) { b.disabled = false; b.textContent = 'Reintentar'; const w = document.createElement('div'); w.className = 'warn'; w.textContent = 'No se pudo guardar: ' + (e.message || e); b.parentElement.before(w); }
  };
}

/* ---------- helpers de gráficos y tablas ---------- */
const sect=t=>`<div class="section-title"><span class="bar"></span><h3>${t}</h3></div>`;
function kpi(l,v,sub,col){return `<div class="etiqueta"><div class="et-lbl">${l}</div><div class="et-val" style="${col?'color:'+col:''}">${v}</div><div class="et-sub">${sub||'&nbsp;'}</div></div>`}
function legend(items){return `<div class="leg">${items.map(([n,c])=>`<span><b style="background:${c}"></b>${n}</span>`).join('')}</div>`}
function niceMax(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));const m=v/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p}
function chart(labels,series,o={}){
 const W=o.w||760,H=o.h||230,L=44,R=12,T=14,B=26,pw=W-L-R,ph=H-T-B,n=labels.length;
 let mx=o.max!=null?o.max:niceMax(Math.max(1e-9,...series.flatMap(s=>s.v.filter(x=>x!=null))));
 if(o.stack){const tot=labels.map((_,i)=>series.reduce((a,s)=>a+(s.v[i]||0),0));mx=o.max!=null?o.max:niceMax(Math.max(...tot))}
 const y=v=>T+ph-(v/mx)*ph, xs=i=>L+(n<=1?pw/2:i*pw/(n-1)), bw=pw/n;
 let g='';
 for(let k=0;k<=4;k++){const v=mx*k/4;g+=`<line class="g" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${o.pct?Math.round(v)+'%':fmt(v)}</text>`}
 const every=Math.ceil(n/(o.ticks||12));
 labels.forEach((l,i)=>{if(i%every===0)g+=`<text x="${o.bars?L+i*bw+bw/2:xs(i)}" y="${H-8}" text-anchor="middle">${esc(l)}</text>`});
 if(o.bars){
  const ns=o.stack?1:series.length, w=Math.max(2,bw*0.7/ns);
  labels.forEach((_,i)=>{let acc=0;series.forEach((s,j)=>{const v=s.v[i]||0;const x=o.stack?L+i*bw+bw*0.15:L+i*bw+bw*0.15+j*w;const h=v/mx*ph;const yy=o.stack?T+ph-(acc+v)/mx*ph:T+ph-h;
   g+=`<rect x="${x}" y="${yy}" width="${o.stack?bw*0.7:w}" height="${Math.max(0,h)}" fill="${s.c}" rx="2"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct?v.toFixed(1)+'%':fmt(v)}</title></rect>`;acc+=v})});
  (o.lines||[]).forEach(s=>{let d='';s.v.forEach((v,i)=>{if(v!=null)d+=(d?'L':'M')+(L+i*bw+bw/2)+','+y(v)});g+=`<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.2"/>`;s.v.forEach((v,i)=>{if(v!=null)g+=`<circle cx="${L+i*bw+bw/2}" cy="${y(v)}" r="3" fill="${s.c}"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct2?v.toFixed(1)+'%':fmt(v)}</title></circle>`})});
 }else series.forEach(s=>{let d='';s.v.forEach((v,i)=>{if(v!=null)d+=(d?'L':'M')+xs(i)+','+y(v)});g+=`<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round"/>`;
  if(n<=45)s.v.forEach((v,i)=>{if(v!=null)g+=`<circle cx="${xs(i)}" cy="${y(v)}" r="2.6" fill="${s.c}"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct?v.toFixed(1)+'%':fmt(v)}</title></circle>`})});
 return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
}
function donut(items){ // [{n,v,c}]
 const tot=items.reduce((a,b)=>a+b.v,0)||1;let a0=-Math.PI/2,p='';
 items.forEach(it=>{if(!it.v)return;const a1=a0+it.v/tot*2*Math.PI,r=64,ri=40,cx=80,cy=80,lg=a1-a0>Math.PI?1:0;
  const P=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];const [x0,y0]=P(r,a0),[x1,y1]=P(r,Math.min(a1,a0+6.2831)),[x2,y2]=P(ri,Math.min(a1,a0+6.2831)),[x3,y3]=P(ri,a0);
  p+=`<path d="M${x0},${y0}A${r},${r} 0 ${lg} 1 ${x1},${y1}L${x2},${y2}A${ri},${ri} 0 ${lg} 0 ${x3},${y3}Z" fill="${it.c}"><title>${esc(it.n)}: ${fmt(it.v)}</title></path>`;a0=a1});
 return `<div class="donut"><svg class="donut-svg" viewBox="0 0 160 160" width="160" height="160">${p}<text x="80" y="78" text-anchor="middle" style="font-size:17px;font-weight:800;fill:#1a1a1a">${fmt(tot)}</text><text x="80" y="94" text-anchor="middle" style="font-size:9px">total</text></svg>
 <div class="donut-leg">${items.map(it=>`<div class="dl-row"><i style="background:${it.c}"></i><span class="dl-n">${esc(it.n)}</span><b>${fmt(it.v)}</b><em>${pct(it.v,tot,0)}</em></div>`).join('')}</div></div>`;
}
function hbars(rows,col,o={}){ // [{n,v,s}]
 const mx=Math.max(1,...rows.map(r=>r.v));
 return `<div class="funnel">${rows.map(r=>`<div class="frow"><span title="${esc(r.n)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.n)}</span><div class="fb"><i style="width:${r.v/mx*100}%;background:${r.c||col}"></i></div><span>${o.pct?r.v.toFixed(1)+'%':fmt(r.v)}${r.s?` <small class="pc">${r.s}</small>`:''}</span></div>`).join('')}</div>`;
}

/* ---------- tablas ordenables con búsqueda y CSV ---------- */
let TB={};
function tbl(id,cols,rows,o={}){
 TB[id]={cols,rows,sort:o.sort==null?-1:o.sort,dir:o.dir||-1,q:'',lim:o.lim||250,file:o.file||id};
 return `<div class="tools">${o.search?`<input type="search" placeholder="Buscar…" oninput="tq('${id}',this.value)">`:''}<span class="muted" id="${id}-n"></span>${o.csv?`<button class="btn" onclick="tcsv('${id}')">⬇ CSV</button>`:''}</div><div class="tbl-wrap"><table class="dt" id="${id}"></table></div>`;
}
function tdraw(id){
 const T=TB[id],el=$(id);if(!el)return;let rows=T.rows;
 if(T.q){const q=T.q.toLowerCase();rows=rows.filter(r=>T.cols.some(c=>String(c.v(r)==null?'':c.v(r)).toLowerCase().includes(q)))}
 if(T.sort>=0){const c=T.cols[T.sort];rows=rows.slice().sort((a,b)=>{const x=c.v(a),y=c.v(b);const nx=x==null||x==='',ny=y==null||y==='';if(nx||ny)return nx&&ny?0:nx?1:-1;return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'es'))*T.dir})}
 const shown=rows.slice(0,T.lim);
 let h='<thead><tr>'+T.cols.map((c,i)=>`<th class="s" onclick="tsort('${id}',${i})">${c.h}${T.sort===i?(T.dir>0?' ▲':' ▼'):''}</th>`).join('')+'</tr></thead><tbody>';
 h+=shown.map(r=>'<tr>'+T.cols.map(c=>`<td class="${c.t?'t':''}">${c.r?c.r(r):(c.v(r)==null?'—':(typeof c.v(r)==='number'?fmt(c.v(r)):esc(c.v(r))))}</td>`).join('')+'</tr>').join('');
 const hasTot=T.cols.some(c=>c.tot);
 if(hasTot)h+='<tr class="tot">'+T.cols.map((c,i)=>`<td class="${c.t?'t':''}">${c.tot?c.tot(rows):(i===0?'Total':'')}</td>`).join('')+'</tr>';
 el.innerHTML=h+'</tbody>';const n=$(id+'-n');if(n)n.textContent=rows.length>T.lim?`Mostrando ${T.lim} de ${fmt(rows.length)}`:`${fmt(rows.length)} filas`;
}
function tsort(id,i){const T=TB[id];if(T.sort===i)T.dir=-T.dir;else{T.sort=i;T.dir=T.cols[i].t?1:-1}tdraw(id)}
function tq(id,v){TB[id].q=v;tdraw(id)}
function tcsv(id){const T=TB[id];let rows=T.rows;if(T.q){const q=T.q.toLowerCase();rows=rows.filter(r=>T.cols.some(c=>String(c.v(r)==null?'':c.v(r)).toLowerCase().includes(q)))}
 const q=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
 const t=[T.cols.map(c=>q(c.h.replace(/<[^>]+>/g,''))).join(',')].concat(rows.map(r=>T.cols.map(c=>q(c.v(r))).join(','))).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+t],{type:'text/csv;charset=utf-8'}));a.download=T.file+'.csv';a.click();toast('CSV descargado')}
const drawAll=()=>Object.keys(TB).forEach(tdraw);
/* ====================================================================== REPORTES: RESUMEN · PENALIZACIÓN · DETALLE CHECKS · HC ====================================================================== */
const pct = (a, b, d = 1) => b > 0 ? (a / b * 100).toFixed(d) + '%' : '—';
const kp = (l, v, s, col, click) => `<div class="kpi ${click ? 'click' : ''}" ${click ? `onclick="${click}"` : ''}><div class="l">${l}</div><div class="v" style="${col ? 'color:' + col : ''}">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
const pc1 = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + '%' : '—';
const pn = (a, b) => b > 0 ? a / b * 100 : null;
const f1 = n => n == null || isNaN(n) ? '—' : n.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MESN = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const mlabel = k => MESN[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4);
const pillx = (t, c) => `<span class="pill ${c}">${t}</span>`;
const C = { or: '#EE6602', gr: '#1E7A1E', rd: '#DC2626', am: '#D97706', bl: '#00509C', pu: '#5C2483', gy: '#8B939E', dk: '#3B4048' };
const EST_COB = ['Cubierta', 'Descubierta', 'Vacante'], COBC = [C.gr, C.am, C.rd];
const EST_PEN = ['Cubierto', 'Riesgo Penalización', 'Penalizado'];
const LOGO = { Coppel: 'logo_coppel_clean', Elektra: 'logo_elektra_clean', Suburbia: 'logo_suburbia_clean', Cimaco: 'logo_cimaco_clean' };

/* ----- carga ----- */
const R = { loaded: false, f: { region: '', gerente: '', supervisor: '', rrhh: '', cadena: '' }, sem: null, mes: null, solo: true, kw: null, T: [], movs: [], hc: [], uc: [], bajasLive: new Set() };
Real.reporte = async function () {
  const [m, t, h, u, mv, bj] = await Promise.all([sb.from('rep_meta').select('valor').eq('clave', 'ventana').maybeSingle(), todo(() => sb.from('rep_tienda').select('*')), todo(() => sb.from('rep_hc').select('*')), todo(() => sb.from('rep_ultimo_check').select('*')),
    todo(() => sb.from('movimientos').select('tipo,fecha,idpdv').gte('fecha', '2025-12-01')), todo(() => sb.from('bajas').select('usuario_fieldwy,fecha_baja').gte('fecha_baja', addD(HOY, -200)))]);
  if (!m.data) throw new Error('Todavía no hay reportes publicados. Corre publicar_reporte.py.');
  return { meta: m.data.valor, tiendas: t, hc: h, uc: u, movs: mv, bajas: bj };
};
Real.checks = function (desde, hasta) { return todo(() => sb.from('rep_checks').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora_in')); };

async function cargarReporte() {
  if (R.loaded) return;
  const d = await API.reporte();
  R.meta = d.meta; R.movs = d.movs; R.hc = d.hc; R.uc = Object.fromEntries(d.uc.map(x => [x.usuario, x]));
  R.bajasLive = new Map(d.bajas.map(b => [b.usuario_fieldwy, b.fecha_baja]));
  R.T = d.tiendas.map(r => ({ id: r.idpdv, t: tienda(r.idpdv) || { nombre: 'IDPDV ' + r.idpdv, cadena: '', estado: '', region: '', gerente: '', supervisor: '', rrhh: '', posiciones: 0 }, sem: r.semanas || [], chk: (r.chk && r.chk.s) || [], cd: (r.chk && r.chk.cd) || '', dias: r.dias || '', hc: r.hc_sem || [], pen: r.pen || [] }));
  R.sem = R.meta.ventana.length - 1; R.mes = null; R.loaded = true;
}
const okS = t => Object.entries(R.f).every(([k, v]) => !v || t[k] === v);
const okI = id => { const t = tienda(id); return t ? okS(t) : !Object.values(R.f).some(Boolean); };
function barraFiltros(fn) {
  const base = R.T.map(x => x.t); const campos = [['region', 'Región'], ['gerente', 'Gerente / Líder'], ['supervisor', 'Supervisor'], ['rrhh', 'RR.HH.'], ['cadena', 'Cadena']];
  const sel = campos.map(([k, l]) => { const ops = [...new Set(base.filter(t => Object.entries(R.f).every(([kk, v]) => kk === k || !v || t[kk] === v)).map(t => t[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    return `<div class="fb-field"><label>${l}</label><select onchange="R.f['${k}']=this.value;${fn}()"><option value="">Todos</option>${ops.map(o => `<option ${R.f[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`; }).join('');
  return `<div class="fbar">${sel}<button class="btn sm" onclick="Object.keys(R.f).forEach(k=>R.f[k]='');${fn}()">✕ Quitar filtros</button></div>`;
}
const cargando = (t, m) => { $('content').innerHTML = cab(t, 'Cargando…', m); };
async function conReporte(titulo, mascota, fn) {
  try { cargando(titulo, mascota); await cargarReporte(); await fn(); } catch (e) { $('content').innerHTML = cab(titulo, '', mascota) + `<div class="card empty"><img src="${img('guino')}" alt="">${esc(e.message || e)}</div>`; }
}

/* ====================================================================== 1 · RESUMEN ====================================================================== */
function mesesRot() { // rotación mensual con altas, bajas y HC promedio (estructura filtrada)
  const sa = R.meta.semanas_anio, hs = sa.map((_, i) => R.T.filter(x => okS(x.t)).reduce((a, x) => a + (x.hc[i] || 0), 0));
  const hp = {}; sa.forEach((s, i) => { if (dAddS(s.ini, 6) > HOY) return; const k = dAddS(s.ini, 3).slice(0, 7); (hp[k] = hp[k] || []).push(hs[i]); });
  const al = {}, bj = {}; R.movs.filter(m => okI(m.idpdv)).forEach(m => { const k = m.fecha.slice(0, 7); if (m.tipo === 'Alta') al[k] = (al[k] || 0) + 1; else if (m.tipo === 'Baja') bj[k] = (bj[k] || 0) + 1; });
  const ks = [...new Set([...Object.keys(al), ...Object.keys(bj)])].filter(k => k >= '2026-01').sort();
  return ks.map(k => { const h = hp[k] ? hp[k].reduce((a, b) => a + b, 0) / hp[k].length : null; return { k, al: al[k] || 0, bj: bj[k] || 0, hc: h, rot: h ? (bj[k] || 0) / h * 100 : null, parcial: k === HOY.slice(0, 7) }; });
}
const dAddS = (s, n) => addD(s, n);
/* ---- medidas de cobertura (misma lógica del Avance GB / medidas DAX del negocio) ----
   Dimensionamiento PDV      = Σ tiendas: (posiciones = 1 → 6/7, si no 1)
   Dimensionamiento Promotor = Σ tiendas: posiciones × 6/7
   Cobertura PDV    = promedio diario de tiendas con ≥ 1 check válido ÷ dimensionamiento PDV (tope 100 %)
   Asistencia Prom. = promedio diario de checks válidos ÷ dimensionamiento Promotor (tope 100 %)
   Checks vs cuota  = checks válidos ÷ cuota (6 por posición)
   Estatus (últimos 2 días con datos): ambos con check = Cubierta · solo uno = Descubierta · ninguno = Vacante */
const posc = t => t.posiciones || 1;
const dimPdv = ts => ts.reduce((a, t) => a + (posc(t) === 1 ? 6 / 7 : 1), 0);
const dimProm = ts => ts.reduce((a, t) => a + posc(t) * 6 / 7, 0);
const cdv = (x, d) => { const k = diffD(d, R.meta.cd_desde); const ch = x.cd[k]; return ch == null ? 0 : parseInt(ch, 36); };
function rangoSemana(i) { const w = R.meta.ventana[i]; const fin = [addD(w.ini, 6), R.meta.ultima_fecha || HOY, HOY].reduce((a, b) => a < b ? a : b); const dias = []; for (let d = w.ini; d <= fin; d = addD(d, 1)) dias.push(d); return dias; }
function medidas(xs, dias) {
  const ts = xs.filter(x => (x.t.posiciones || 0) > 0).map(x => ({ x, t: x.t })); const T = ts.map(z => z.t), nD = Math.max(1, dias.length);
  let cubSum = 0, chk = 0; ts.forEach(({ x }) => dias.forEach(d => { const c = cdv(x, d); if (c > 0) cubSum++; chk += c; }));
  const dP = dimPdv(T), dM = dimProm(T), pP = cubSum / nD, pM = chk / nD, cuota = T.reduce((a, t) => a + 6 * posc(t), 0), chkP = chk / nD * 7;
  return { n: ts.length, posc: T.reduce((a, t) => a + posc(t), 0), dP, pP, pctP: dP ? Math.min(pP / dP * 100, 100) : null, difP: pP - dP, dM, pM, pctM: dM ? Math.min(pM / dM * 100, 100) : null, difM: pM - dM, chk, chkP, nD, cuota, pctC: cuota ? Math.min(chkP / cuota * 100, 100) : null, exc: Math.max(0, chkP - cuota) };
}
function estatusTienda(x, dias) { // últimos 2 días con datos
  const last2 = dias.slice(-2).reverse(); const ps = posc(x.t); const r = last2.length ? cdv(x, last2[0]) : 0, a = last2.length > 1 ? cdv(x, last2[1]) : null;
  let cob; if (a == null) cob = r > 0 ? 'Cubierta' : 'Descubierta'; else cob = r > 0 && a > 0 ? 'Cubierta' : r === 0 && a === 0 ? 'Vacante' : 'Descubierta';
  let asi; const A = a || 0;
  if (ps <= 1) asi = cob;
  else if (a == null) asi = r >= ps ? 'Cubierta' : r > 0 ? 'Posc Desc' : 'Descubierta';
  else if (r > ps && A > ps) asi = 'Posc Adic'; else if (r >= ps && A >= ps) asi = 'Cubierta'; else if (r === 0 && A === 0) asi = 'Vacante';
  else if (r < ps && r > 0 && A < ps && A > 0) asi = 'Posc Faltante'; else if ((r < ps && r > 0) || (A < ps && A > 0)) asi = 'Posc Desc'; else if (r === 0 || A === 0) asi = 'Descubierta'; else asi = 'Sin Definir';
  return { cob, asi, r, a };
}
const ASIC = { 'Cubierta': 'g', 'Posc Adic': 'g', 'Posc Desc': 'a', 'Descubierta': 'a', 'Posc Faltante': 'r', 'Vacante': 'r', 'Sin Definir': 'x' };
function embudo(titulo, etapas, mascota) { // etapas: [{n,v,c}]
  const mx = etapas[0].v || 1;
  return `<div class="card"><h3>${titulo}</h3><div class="funnel2">${etapas.map(e => `<div class="fn-row"><div class="fn-l">${e.n}</div><div class="fn-b" style="width:${Math.max(9, e.v / mx * 100)}%;background:${e.c}"><span>${fmt1(e.v)}</span></div></div>`).join('')}</div></div>`;
}
const fmt1 = n => n == null || isNaN(n) ? '—' : (Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n).toLocaleString('es-MX') : n.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
function semData(i) {
  const xs = R.T.filter(x => okS(x.t)); const m = medidas(xs, rangoSemana(i));
  const ck = xs.filter(x => x.chk[i]); const d = ck.reduce((a, x) => a + x.chk[i][1], 0), c = ck.reduce((a, x) => a + x.chk[i][2], 0), pr = ck.reduce((a, x) => a + x.chk[i][3], 0), prom = ck.reduce((a, x) => a + x.chk[i][0], 0);
  return { ...m, cob: m.pctP, asis: m.pctM, d, c, pr, prom, cum: pn(c, d), prd: pn(pr, d) };
}
function vResumen() {
  conReporte('Resumen', 'pulgares', () => {
    const i = R.sem, W = R.meta.ventana, dias = rangoSemana(i), xs = R.T.filter(x => okS(x.t)), cur = semData(i), prev = i > 0 ? semData(i - 1) : null;
    const dl = (a, b) => a == null || b == null ? '' : `<span class="${a - b >= 0 ? 'up' : 'dn'}">${a - b >= 0 ? '▲' : '▼'} ${Math.abs(a - b).toFixed(1)} pts vs sem. ant.</span>`;
    const rm = mesesRot(), cer = rm.filter(r => !r.parcial && r.rot != null).slice(-1)[0], act = rm.find(r => r.parcial);
    let h = cab('Resumen', 'Cobertura de PDV, asistencia de promotores y checks contra cuota, con la misma lógica de Avance GB; más rotación y calidad de checks. Responde a los filtros de estructura y a la semana elegida.', 'pulgares') + barraFiltros('vResumen');
    h += `<div class="tools"><span>Semana:</span><select onchange="R.sem=+this.value;vResumen()">${W.map((w, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>${w.w}${k === W.length - 1 ? ' (en curso)' : ''}</option>`).join('')}</select><span class="muted">${dias.length} día${dias.length > 1 ? 's' : ''} con datos (${fdate(dias[0])} al ${fdate(dias[dias.length - 1])}) · publicado ${esc(R.meta.generado)}</span></div>`;
    h += `<div class="kpis kp-hero">${kp('% Cobertura PDV', cur.pctP == null ? '—' : f1(cur.pctP) + '%', `${fmt1(cur.pP)} tiendas/día vs ${fmt1(cur.dP)} dimensionadas<br>${dl(cur.pctP, prev && prev.pctP)}`, cur.pctP >= 90 ? C.gr : cur.pctP >= 75 ? C.am : C.rd)}
      ${kp('% Asistencia Promotor', cur.pctM == null ? '—' : f1(cur.pctM) + '%', `${fmt1(cur.pM)} promotores/día vs ${fmt1(cur.dM)} dimensionados<br>${dl(cur.pctM, prev && prev.pctM)}`, cur.pctM >= 90 ? C.gr : cur.pctM >= 75 ? C.am : C.rd)}
      ${kp('% Checks vs cuota', cur.pctC == null ? '—' : f1(cur.pctC) + '%', `${fmt(cur.chk)} checks en ${cur.nD} d${cur.nD < 7 ? ' → ' + fmt(cur.chkP) + ' proyectados a 7 d' : ''} vs cuota ${fmt(cur.cuota)} (6 por posición)<br>${dl(cur.pctC, prev && prev.pctC)}`, C.bl)}
      ${kp('Rotación mes cerrado', cer ? f1(cer.rot) + '%' : '—', cer ? `${mlabel(cer.k)} · ${cer.bj} bajas ÷ ${fmt(cer.hc)} HC` : '', C.am)}${kp('Rotación mes en curso', act && act.rot != null ? f1(act.rot) + '%' : '—', act ? `${act.bj} bajas · ${act.al} altas a la fecha` : '', C.am)}
      ${kp('Checks que cumplen', cur.cum == null ? '—' : f1(cur.cum) + '%', `${fmt(cur.c)} de ${fmt(cur.d)} checks · ${f1(cur.prd)}% por productividad`, cur.cum >= 90 ? C.gr : C.am)}</div>`;
    h += `<div class="grid g3">${embudo('Cobertura PDV', [{ n: "Total PDV's", v: cur.n, c: C.bl }, { n: 'Dimensionamiento', v: cur.dP, c: C.bl }, { n: 'Cubiertos (prom. diario)', v: cur.pP, c: C.gr }, { n: 'Descubiertos', v: Math.max(0, -cur.difP), c: C.rd }])}
      ${embudo('Asistencia Promotor', [{ n: 'Posiciones autorizadas', v: cur.posc, c: C.bl }, { n: 'Dimensionamiento', v: cur.dM, c: C.bl }, { n: 'Asistieron (prom. diario)', v: cur.pM, c: C.gr }, { n: 'Sin asistir', v: Math.max(0, -cur.difM), c: C.rd }])}
      ${embudo('Checks vs cuota', [{ n: 'Cuota de checks', v: cur.cuota, c: C.bl }, { n: cur.nD < 7 ? 'Checks válidos (proy. 7 d)' : 'Checks válidos', v: cur.chkP, c: C.gr }, { n: 'Faltantes', v: Math.max(0, cur.cuota - cur.chkP), c: C.rd }, { n: 'Adicionales', v: cur.exc, c: C.am }])}</div>`;
    // por cadena
    const cads = [...new Set(xs.map(x => x.t.cadena).filter(Boolean))];
    const cadRows = cads.map(c => { const m = medidas(xs.filter(y => y.t.cadena === c), dias); return { c, n: m.n, p: m.pctP, a: m.pctM }; }).filter(r => r.n).sort((a, b) => b.n - a.n);
    const col = p => p >= 90 ? C.gr : p >= 75 ? C.am : C.rd;
    const st = xs.filter(x => (x.t.posiciones || 0) > 0).map(x => ({ x, s: estatusTienda(x, dias) })); const ce = { Cubierta: 0, Descubierta: 0, Vacante: 0 }; st.forEach(z => ce[z.s.cob]++);
    h += `<div class="grid g2"><div class="card"><h3>Cobertura por cadena</h3><p class="note">% Cobertura PDV (barra) y % Asistencia Promotor.</p>${cadRows.map(r => `<div class="cadena-row">${LOGO[r.c] ? `<img class="cadena-logo" src="${img(LOGO[r.c])}" alt="${esc(r.c)}">` : `<b style="min-width:70px;font-size:12px">${esc(r.c)}</b>`}<div class="cadena-track"><i style="width:${r.p || 0}%;background:${col(r.p)}"></i></div><b class="cadena-val" style="color:${col(r.p)}">${f1(r.p)}%</b><span class="muted" style="min-width:90px;text-align:right">asist. ${f1(r.a)}%</span></div>`).join('')}</div>
      <div class="card"><h3>Estatus de tiendas (últimos 2 días)</h3><p class="note">Cubierta: check en los 2 días · Descubierta: falta 1 día · Vacante: 2 días sin check.</p>${donut(['Cubierta', 'Descubierta', 'Vacante'].map((n, k) => ({ n, v: ce[n], c: COBC[k] })))}</div></div>`;
    const labs = W.map(w => w.w.slice(3)), S_ = W.map((_, k) => semData(k));
    h += `<div class="grid g2"><div class="card"><h3>Comparativo semanal</h3>${legend([['% Cobertura PDV', C.gr], ['% Asistencia Promotor', C.bl], ['% Checks vs cuota', C.or]])}${chart(labs, [{ n: '% Cobertura PDV', c: C.gr, v: S_.map(x => x.pctP) }, { n: '% Asistencia', c: C.bl, v: S_.map(x => x.pctM) }, { n: '% Checks vs cuota', c: C.or, v: S_.map(x => x.pctC) }], { pct: 1, max: 100, h: 230 })}</div>
      <div class="card"><h3>Rotación: altas y bajas por mes</h3>${legend([['Altas', C.gr], ['Bajas', C.rd]])}${chart(rm.map(r => mlabel(r.k)), [{ n: 'Altas', c: C.gr, v: rm.map(r => r.al) }, { n: 'Bajas', c: C.rd, v: rm.map(r => r.bj) }], { bars: 1, h: 230, ticks: 12 })}<p class="tblnote">Rotación = bajas del mes ÷ promedio semanal de promotores con check. ${rm.filter(r => r.rot != null).map(r => mlabel(r.k) + ' ' + f1(r.rot) + '%').slice(-4).join(' · ')}</p></div></div>`;
    h += `<div class="card" style="margin-top:14px"><h3>Semana por semana</h3>${tablaSemanal(S_, W)}</div>`;
    h += sect('Tiendas: cobertura, asistencia y checks') + `<div class="tools">${['Todas', 'Cubierta', 'Descubierta', 'Vacante'].map(e => `<button class="chip ${(R.est || 'Todas') === e ? 'on' : ''}" onclick="R.est='${e}';vResumen()">${e}${e === 'Todas' ? '' : ' (' + ce[e] + ')'}</button>`).join('')}</div>`;
    const rows = st.filter(z => !R.est || R.est === 'Todas' || z.s.cob === R.est).map(({ x, s }) => { const sw = x.sem[i] || [], c = x.chk[i], pe = penActual(x); const ps = posc(x.t); const chs = dias.reduce((a, d) => a + cdv(x, d), 0), cu = 6 * ps, chsP = chs / Math.max(1, dias.length) * 7; const eCh = chs === 0 ? 'Vacante' : chsP < 6 ? 'Revisar cobertura' : ps >= 2 && chsP < 6 * ps ? 'Posc Faltante' : chsP > cu ? 'Posc Adicional' : 'Cubierta';
      return { ...x, s, ps, chs, chsP, cu, eCh, ul: sw[8], prom: c ? c[0] : 0, cd: c ? c[1] : 0, cc: c ? c[2] : 0, pe }; });
    TB = {};
    h += tbl('t-tiendas', [{ h: 'Tienda', t: 1, v: r => r.t.nombre, r: r => `<b>${esc(r.t.nombre)}</b><br><small class="muted">${r.id}</small>` }, { h: 'Cadena', t: 1, v: r => r.t.cadena }, { h: 'Estado', t: 1, v: r => r.t.estado }, { h: 'Posc.', v: r => r.ps },
      { h: 'Estatus cobertura', t: 1, v: r => r.s.cob, r: r => pillx(r.s.cob, r.s.cob === 'Cubierta' ? 'g' : r.s.cob === 'Vacante' ? 'r' : 'a') }, { h: 'Estatus asistencia', t: 1, v: r => r.s.asi, r: r => pillx(r.s.asi, ASIC[r.s.asi] || 'x') },
      { h: 'Último check', v: r => r.ul, r: r => fdate(r.ul) }, { h: 'Checks', v: r => r.chs }, { h: 'Cuota (sem.)', v: r => r.cu }, { h: '% cuota (proy.)', v: r => pn(r.chsP, r.cu), r: r => pc1(Math.min(r.chsP, r.cu), r.cu) }, { h: 'Estatus checks', t: 1, v: r => r.eCh, r: r => pillx(r.eCh, r.eCh === 'Cubierta' || r.eCh === 'Posc Adicional' ? 'g' : r.eCh === 'Revisar cobertura' ? 'a' : 'r') },
      { h: 'Promotores', v: r => r.prom }, { h: '% cumplen', v: r => pn(r.cc, r.cd), r: r => pc1(r.cc, r.cd) }, { h: 'Racha sin cobertura', v: r => r.pe ? r.pe.ra : null, r: r => r.pe ? semaforo(r.pe) : '—' }, { h: 'Región', t: 1, v: r => r.t.region }, { h: 'Gerente', t: 1, v: r => r.t.gerente }, { h: 'Supervisor', t: 1, v: r => r.t.supervisor }, { h: 'RR.HH.', t: 1, v: r => r.t.rrhh }], rows, { search: 1, csv: 1, file: 'tiendas_resumen', sort: 4, dir: -1 });
    $('content').innerHTML = h; drawAll();
  });
}

function tablaSemanal(S_, W) {
  const fila = (l, f) => `<tr><td><b>${l}</b></td>${S_.map(f).map(v => `<td>${v}</td>`).join('')}</tr>`;
  const p = v => v == null ? '—' : f1(v) + '%';
  return `<div class="tbl-wrap"><table class="dt"><thead><tr><th></th>${W.map(w => `<th>${w.w}</th>`).join('')}</tr></thead><tbody>${fila('Total PDV', x => fmt(x.n))}${fila('Dimensionamiento PDV', x => fmt1(x.dP))}${fila('Cubiertos (prom. diario)', x => fmt1(x.pP))}${fila('% Cobertura PDV', x => p(x.pctP))}${fila('Posiciones autorizadas', x => fmt(x.posc))}${fila('Dimensionamiento Promotor', x => fmt1(x.dM))}${fila('Asistieron (prom. diario)', x => fmt1(x.pM))}${fila('% Asistencia Promotor', x => p(x.pctM))}${fila('Checks válidos / cuota', x => fmt(x.chk) + ' / ' + fmt(x.cuota))}${fila('% Checks vs cuota', x => p(x.pctC))}${fila('% Checks que cumplen', x => p(x.cum))}${fila('% Por productividad', x => p(x.prd))}</tbody></table></div>`;
}

/* ====================================================================== 2 · PENALIZACIÓN ====================================================================== */
const penActual = x => (x.pen || []).find(p => p.act) || (x.pen || []).slice(-1)[0] || null;
function nivel(p) { // semáforo por días sin cobertura (racha confirmada hasta ayer) y estado de hoy
  if (!p) return { k: 'v', t: 'Sin dato' };
  if (p.e === 2) return { k: 'r', t: 'Penalizada' };
  if (p.act && p.hoy === 'C') return { k: 'v', t: 'Cubierta hoy' };
  if (p.act && p.ra >= 4) return { k: 'rp', t: p.hoy === 'A' ? 'Crítica: check abierto, debe completar 7 h' : 'Crítica: cubrir HOY' };
  if (p.act && p.ra === 3) return { k: 'n', t: 'Riesgo: cubrir antes de 5 días' };
  if (p.act && p.ra >= 1) return { k: 'a', t: 'Vigilar' };
  return { k: 'v', t: 'Cubierta' };
}
const semaforo = p => { const n = nivel(p); return `<span class="sem ${n.k}" title="${esc(n.t)}"><i></i>${p && p.act ? p.ra + ' d' : (p ? p.mx + ' d' : '—')}</span>`; };
function vPenal() {
  conReporte('Penalización', 'puno', () => {
    const meses = [...new Set(R.T.flatMap(x => (x.pen || []).map(p => p.m)))].sort(); if (!R.mes || !meses.includes(R.mes)) R.mes = meses[meses.length - 1];
    const cop = R.solo; const f = R.T.filter(x => okS(x.t) && (!cop || x.t.cadena === 'Coppel'));
    const dePenal = f.map(x => ({ ...x, p: (x.pen || []).find(p => p.m === R.mes) })).filter(x => x.p);
    const act = R.mes === HOY.slice(0, 7);
    const c = [0, 0, 0]; dePenal.forEach(x => c[x.p.e]++);
    const crit = act ? dePenal.filter(x => ['rp'].includes(nivel(x.p).k)) : [], ries = act ? dePenal.filter(x => nivel(x.p).k === 'n') : [], vig = act ? dePenal.filter(x => nivel(x.p).k === 'a') : [];
    const mi = meses.indexOf(R.mes), prevM = mi > 0 ? meses[mi - 1] : null;
    const prevPen = prevM ? f.filter(x => (x.pen || []).some(p => p.m === prevM && p.e === 2)).length : null;
    let h = cab('Penalización por falta de cobertura', 'Una tienda se penaliza con 5 o más días seguidos sin cobertura en el mes. Cuenta como cobertura un check dentro de rango y con 420 minutos en tienda (300 los domingos con horario diferenciado); el check de un supervisor también rompe la racha.', 'puno') + barraFiltros('vPenal');
    h += `<div class="tools"><span>Mes:</span><select onchange="R.mes=this.value;vPenal()">${meses.map(m => `<option value="${m}" ${m === R.mes ? 'selected' : ''}>${mlabel(m)}${m === HOY.slice(0, 7) ? ' (en curso)' : ''}</option>`).join('')}</select><button class="chip ${R.solo ? 'on' : ''}" onclick="R.solo=!R.solo;vPenal()">Solo Coppel (prioridad)</button><span class="muted">${fmt(dePenal.length)} tiendas</span></div>`;
    h += `<div class="kpis">${kp('Penalizadas', fmt(c[2]), pc1(c[2], dePenal.length) + ' de las tiendas', c[2] ? C.rd : C.gr)}${act ? kp('Críticas hoy', fmt(crit.length), '4+ días sin cobertura: cubrir HOY', crit.length ? C.rd : C.gr) : ''}${act ? kp('En riesgo', fmt(ries.length), '3 días: cubrir antes de 5', ries.length ? C.am : C.gr) : kp('En riesgo (cierre)', fmt(c[1]), 'con racha de 3 a 4 días')}${act ? kp('Vigilar', fmt(vig.length), '1 a 2 días sin cobertura', C.am) : ''}${kp('Cubiertas', fmt(c[0]), pc1(c[0], dePenal.length), C.gr)}${kp('Penalizadas mes anterior', prevPen == null ? '—' : fmt(prevPen), prevM ? mlabel(prevM) : '')}</div>`;
    if (act && (crit.length || ries.length)) {
      h += sect('Alertas: tiendas por cubrir antes de que se penalicen') + `<div class="alertas">${[...crit, ...ries].sort((a, b) => (b.t.cadena === 'Coppel') - (a.t.cadena === 'Coppel') || b.p.ra - a.p.ra).slice(0, 24).map(x => { const n = nivel(x.p); return `<div class="al-card ${n.k}"><b>${esc(x.t.nombre)}</b><span>${esc(x.t.estado)} · ${esc(x.t.supervisor || '')}</span><em>${x.p.ra} días sin cobertura · ${esc(n.t)}</em></div>`; }).join('')}</div>`;
    }
    const mm = meses.map(m => { const x = f.map(y => (y.pen || []).find(p => p.m === m)).filter(Boolean); return [0, 1, 2].map(e => x.filter(p => p.e === e).length); });
    const dist = {}; dePenal.forEach(x => { (x.p.rs || []).forEach(r => { const k = Math.min(r[0], 10); dist[k] = (dist[k] || 0) + 1; }); });
    h += `<div class="grid g2" style="margin-top:14px"><div class="card"><h3>Tiendas por estatus y mes</h3>${legend(EST_PEN.map((n, k) => [n, COBC[k]]))}${chart(meses.map(mlabel), EST_PEN.map((n, k) => ({ n, c: COBC[k], v: mm.map(x => x[k]) })), { bars: 1, stack: 1, h: 220, ticks: 6 })}</div>
      <div class="card"><h3>Rachas del mes por duración</h3><p class="note">Cuántas rachas sin cobertura hubo de cada duración (10 = 10 días o más).</p>${chart(Object.keys(dist).sort((a, b) => a - b).map(k => k + ' d'), [{ n: 'Rachas', c: C.rd, v: Object.keys(dist).sort((a, b) => a - b).map(k => dist[k]) }], { bars: 1, h: 200, ticks: 12 })}</div></div>`;
    TB = {};
    h += sect('Tiendas: semáforo y días sin cobertura') + tbl('t-pen', [{ h: 'Tienda', t: 1, v: r => r.t.nombre, r: r => `<b>${esc(r.t.nombre)}</b><br><small class="muted">${r.id}</small>` }, { h: 'Cadena', t: 1, v: r => r.t.cadena }, { h: 'Estado', t: 1, v: r => r.t.estado },
      { h: 'Semáforo', v: r => (nivel(r.p).k === 'rp' ? 5 : nivel(r.p).k === 'r' ? 4 : nivel(r.p).k === 'n' ? 3 : nivel(r.p).k === 'a' ? 2 : 1) * 100 + (r.p.act ? r.p.ra : r.p.mx), r: r => `${semaforo(r.p)} <small class="muted">${esc(nivel(r.p).t)}</small>` },
      { h: act ? 'Racha actual' : 'Racha máx.', v: r => act ? r.p.ra : r.p.mx }, { h: 'Hoy', v: r => r.p.hoy || '', r: r => !r.p.act ? '—' : r.p.hoy === 'C' ? pillx('Cubierta', 'g') : r.p.hoy === 'A' ? pillx('Check abierto', 'b') : pillx('Sin check', 'r') },
      { h: 'Estatus mes', v: r => r.p.e, r: r => pillx(EST_PEN[r.p.e], r.p.e === 2 ? 'r' : r.p.e === 1 ? 'a' : 'g') }, { h: 'Periodo en curso / penalizado', t: 1, v: r => r.p.pa }, { h: 'Mayor racha', v: r => r.p.mx }, { h: 'Periodo mayor racha', t: 1, v: r => r.p.pm },
      { h: 'Días sin check (mes)', v: r => r.p.ds }, { h: 'Último check', v: r => r.p.ul, r: r => fdate(r.p.ul) }, { h: 'Región', t: 1, v: r => r.t.region }, { h: 'Gerente', t: 1, v: r => r.t.gerente }, { h: 'Supervisor', t: 1, v: r => r.t.supervisor }, { h: 'RR.HH.', t: 1, v: r => r.t.rrhh }],
      dePenal, { search: 1, csv: 1, file: 'penalizacion_tiendas', sort: 3, dir: -1 });
    const rach = []; dePenal.forEach(x => (x.p.rs || []).forEach(r => rach.push({ ...x, dias: r[0], ini: r[1], fin: r[2] })));
    h += sect('Mayores rachas sin cobertura del mes') + `<p class="note">Cada racha de 2 o más días seguidos sin cobertura, con su periodo. Las de 5 días o más son penalizables.</p>` + tbl('t-rach', [{ h: 'Tienda', t: 1, v: r => r.t.nombre }, { h: 'Cadena', t: 1, v: r => r.t.cadena }, { h: 'Días sin cobertura', v: r => r.dias, r: r => `<span class="${r.dias >= 5 ? 'cell-red' : r.dias >= 3 ? 'cell-amber' : ''}">${r.dias}</span>` }, { h: 'Inicio', v: r => r.ini, r: r => fdate(r.ini) }, { h: 'Fin', v: r => r.fin, r: r => fdate(r.fin) }, { h: 'Penalizable', v: r => r.dias >= 5 ? 'Sí' : 'No', r: r => r.dias >= 5 ? pillx('Sí', 'r') : pillx('No', 'x') }, { h: 'Estado', t: 1, v: r => r.t.estado }, { h: 'Supervisor', t: 1, v: r => r.t.supervisor }, { h: 'RR.HH.', t: 1, v: r => r.t.rrhh }], rach, { search: 1, csv: 1, file: 'rachas', sort: 2, dir: -1 });
    $('content').innerHTML = h; drawAll();
  });
}

/* ====================================================================== 3 · DETALLE DE CHECKS ====================================================================== */
let CKS = { sem: null, rows: [], soloErr: false, est: '' };
const ERRN = { 'Cumple': 'Cumple', 'Check In Fuera Ventana': 'Entrada fuera de horario', 'Check Out Fuera Ventana': 'Salida fuera de horario', 'Error Comida': 'Error de comida', 'Tiempo Incompleto': 'Tiempo incompleto', 'Check In Fuera Rango': 'Entrada fuera de rango', 'Check Out Fuera Rango': 'Salida fuera de rango', 'No Check Salida': 'Sin check de salida', 'Equipo Duplicado': 'Equipo duplicado', 'Abierto': 'Abierto (hoy)' };
const VALC = { 'Cumple': 'g', 'Cumple Productividad': 'b', 'Cumple Telefonica': 'b', 'No Cumple': 'r' };
async function vChecks() {
  conReporte('Detalle de checks', 'sim', async () => {
    const W = R.meta.ventana; if (CKS.sem == null) CKS.sem = W.length - 1; const w = W[CKS.sem];
    if (CKS.cargada !== CKS.sem) { $('content').innerHTML = cab('Detalle de checks', 'Cargando checks de ' + w.w + '…', 'sim'); CKS.rows = await API.checks(w.ini, addD(w.ini, 6)); CKS.cargada = CKS.sem; }
    const f = CKS.rows.filter(r => okI(r.idpdv));
    const prim = f.filter(r => r.estatus_final !== 'Otro Check' && r.estatus_check !== 'Abierto');
    const ok = prim.filter(r => ['Cumple', 'Cumple Productividad', 'Cumple Telefonica'].includes(r.estatus_final));
    const prom = new Set(prim.map(r => r.usuario)).size, prod = prim.filter(r => r.estatus_final === 'Cumple Productividad').length;
    const mix = {}; prim.forEach(r => mix[r.estatus_check] = (mix[r.estatus_check] || 0) + 1);
    const errs = Object.entries(mix).filter(([k]) => k !== 'Cumple').sort((a, b) => b[1] - a[1]);
    const vtas = prim.reduce((a, r) => a + r.registros, 0), sinVta = prim.filter(r => r.estatus_check !== 'Cumple' && r.registros === 0 && r.estatus_final === 'No Cumple').length;
    let h = cab('Detalle de checks', 'Cada check de cada promotor: horarios, tiempos, rangos y resultado, con la venta registrada del día para confirmar la justificación por productividad.', 'sim') + barraFiltros('vChecks');
    h += `<div class="tools"><span>Semana:</span><select onchange="CKS.sem=+this.value;vChecks()">${W.map((x, k) => `<option value="${k}" ${k === CKS.sem ? 'selected' : ''}>${x.w}${k === W.length - 1 ? ' (en curso)' : ''}</option>`).join('')}</select><span class="muted">${fmt(f.length)} registros de check (${fmt(prim.length)} evaluados)</span></div>`;
    h += `<div class="kpis">${kp('Checks evaluados', fmt(prim.length), 'uno por promotor y día')}${kp('Promotores con check', fmt(prom), w.w)}${kp('Cumplen (regla de pago)', pc1(ok.length, prim.length), fmt(ok.length) + ' checks', ok.length / prim.length >= 0.9 ? C.gr : C.am)}${kp('Cumplen por productividad', pc1(prod, prim.length), fmt(prod) + ' justificados con ventas', C.pu)}${kp('Ventas registradas', fmt(vtas), 'en los días con check')}${kp('No cumplen y sin venta', fmt(sinVta), 'sin justificación', sinVta ? C.rd : C.gr)}</div>`;
    const dias7 = [...Array(7)].map((_, k) => addD(w.ini, k));
    const porDia = dias7.map(d => { const x = prim.filter(r => r.fecha === d); return { n: x.length, c: x.filter(r => ['Cumple', 'Cumple Productividad', 'Cumple Telefonica'].includes(r.estatus_final)).length }; });
    h += `<div class="grid g2"><div class="card"><h3>Resultado del check</h3><p class="note">Antes de aplicar productividad o Telefónica.</p>${hbars(Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ n: ERRN[k] || k, v, c: k === 'Cumple' ? C.gr : /Rango|Duplicado|Salida$/.test(k) && k !== 'Check Out Fuera Ventana' ? C.rd : C.am, s: pc1(v, prim.length) })), C.am)}</div>
      <div class="card"><h3>Checks por día</h3>${legend([['Cumplen', C.gr], ['No cumplen', C.rd]])}${chart(dias7.map(d => d.slice(8) + '/' + d.slice(5, 7)), [{ n: 'Cumplen', c: C.gr, v: porDia.map(x => x.c) }, { n: 'No cumplen', c: C.rd, v: porDia.map(x => x.n - x.c) }], { bars: 1, stack: 1, h: 210, ticks: 7 })}</div></div>`;
    // por promotor con errores
    const gp = new Map(); prim.forEach(r => { if (!gp.has(r.usuario)) gp.set(r.usuario, []); gp.get(r.usuario).push(r); });
    const rk = [...gp].map(([u, v]) => ({ u, n: v[0].nombre, d: v.length, c: v.filter(r => ['Cumple', 'Cumple Productividad', 'Cumple Telefonica'].includes(r.estatus_final)).length, v: v.reduce((a, r) => a + r.registros, 0), t: v[0].idpdv })).filter(x => x.d >= 3 && x.c / x.d < 0.7).sort((a, b) => a.c / a.d - b.c / b.d).slice(0, 12);
    if (rk.length) h += `<div class="card" style="margin-top:14px"><h3>Promotores con menor cumplimiento</h3>${hbars(rk.map(x => ({ n: x.n + ' · ' + (tienda(x.t) || { nombre: '' }).nombre, v: x.c / x.d * 100, s: `${x.c}/${x.d} · ${x.v} ventas`, c: C.rd })), C.rd, { pct: 1 })}</div>`;
    TB = {};
    const sel = f.filter(r => (!CKS.soloErr || (r.estatus_check !== 'Cumple' && r.estatus_final !== 'Otro Check')) && (!CKS.est || r.estatus_check === CKS.est));
    h += sect('Detalle de cada check') + `<div class="tools"><button class="chip ${CKS.soloErr ? 'on' : ''}" onclick="CKS.soloErr=!CKS.soloErr;vChecks()">Solo con error</button><select onchange="CKS.est=this.value;vChecks()"><option value="">Todos los resultados</option>${Object.keys(ERRN).map(k => `<option value="${k}" ${CKS.est === k ? 'selected' : ''}>${ERRN[k]}</option>`).join('')}</select></div>`;
    h += tbl('t-checks', [{ h: 'Fecha', v: r => r.fecha, r: r => fdate(r.fecha) }, { h: 'Promotor', t: 1, v: r => r.nombre, r: r => `<b>${esc(r.nombre)}</b><br><small class="muted">${esc(r.usuario)} · ${esc(r.rol)}</small>` }, { h: 'Tienda', t: 1, v: r => (tienda(r.idpdv) || {}).nombre || r.idpdv },
      { h: 'Entrada', v: r => r.hora_in, r: r => hh(r.hora_in) }, { h: 'Comida', v: r => r.hora_com_in, r: r => hh(r.hora_com_in) + ' – ' + hh(r.hora_com_out) }, { h: 'Salida', v: r => r.hora_out, r: r => hh(r.hora_out) }, { h: 'En tienda (min)', v: r => r.tiempo_ub, r: r => `<span class="${r.tiempo_ub < 420 ? 'cell-amber' : ''}">${fmt(r.tiempo_ub)}</span>` }, { h: 'Comida (min)', v: r => r.tiempo_com, r: r => f1(r.tiempo_com) },
      { h: 'Rango entrada', t: 1, v: r => r.rango_in, r: r => /fuera/i.test(r.rango_in || '') ? `<span class="cell-red">${esc(r.rango_in)}</span>` : esc(r.rango_in || '—') }, { h: 'Rango salida', t: 1, v: r => r.rango_out, r: r => /fuera/i.test(r.rango_out || '') ? `<span class="cell-red">${esc(r.rango_out)}</span>` : esc(r.rango_out || '—') },
      { h: 'Resultado', t: 1, v: r => ERRN[r.estatus_check] || r.estatus_check, r: r => pillx(ERRN[r.estatus_check] || r.estatus_check, r.estatus_check === 'Cumple' ? 'g' : r.estatus_check === 'Abierto' ? 'b' : 'a') }, { h: 'Estatus final', t: 1, v: r => r.estatus_final, r: r => pillx(r.estatus_final, VALC[r.estatus_final] || 'x') },
      { h: 'Ventas', v: r => r.registros, r: r => r.registros ? `<b>${r.registros}</b> <small class="muted">T${r.temm} P${r.porta} Pos${r.pospago} Pre${r.prepago}</small>` : '0' }, { h: 'Justifica', t: 1, v: r => r.estatus_final === 'Cumple Productividad' ? 'Productividad' : r.check_tel ? 'Telefónica' : '', r: r => r.estatus_final === 'Cumple Productividad' ? pillx('Con ventas', 'b') : r.estatus_check !== 'Cumple' && r.registros === 0 && r.estatus_final === 'No Cumple' ? pillx('Sin venta', 'r') : '' },
      { h: 'Región', t: 1, v: r => (tienda(r.idpdv) || {}).region }, { h: 'Gerente', t: 1, v: r => (tienda(r.idpdv) || {}).gerente }, { h: 'Supervisor', t: 1, v: r => (tienda(r.idpdv) || {}).supervisor }, { h: 'RR.HH.', t: 1, v: r => (tienda(r.idpdv) || {}).rrhh }], sel, { search: 1, csv: 1, file: 'detalle_checks', sort: 0, dir: -1, lim: 400 });
    $('content').innerHTML = h; drawAll();
  });
}
const hh = s => s ? s.slice(0, 5) : '—';

/* ====================================================================== 4 · HC ====================================================================== */
const ACTC = { 'Activo': 'g', 'Reingreso': 'g', 'Descanso / falta / error': 'a', 'Posible baja': 'r', 'Baja': 'x' };
function estadoVivo(h) { // se calcula con lo que RH capturó en la app (ausencias y bajas) encima del último check
  const baja = R.bajasLive.get(h.usuario); if (baja && (!h.fecha_alta || baja >= h.fecha_alta)) return { e: 'Baja', det: 'Baja ' + fdate(baja) };
  const au = S.vigentes.find(v => v.usuario === h.usuario); if (au) return { e: au.motivo, det: `${au.dias} d · regresa ${fdate(au.regreso)}`, aus: au };
  if (h.ausencia_motivo && h.ausencia_regreso && h.ausencia_regreso > HOY) return { e: h.ausencia_motivo, det: `${h.ausencia_dias} d · regresa ${fdate(h.ausencia_regreso)}` };
  const d = h.ultimo_check ? diffD(HOY, h.ultimo_check) : null;
  if (d == null) return { e: 'Sin check', det: '' }; if (d <= 0) return { e: 'Activo', det: '' }; if (d === 1) return { e: 'Descanso / falta / error', det: '1 día sin check' }; return { e: 'Posible baja', det: d + ' días sin check' };
}
async function vHC() {
  conReporte('HC', 'mochila', async () => {
    if (!R.vivo) { try { S.vigentes = await API.vigentes(); } catch (e) { } R.vivo = true; }
    const rows = R.hc.filter(h => okI(h.ultimo_idpdv)).map(h => { const v = estadoVivo(h), u = R.uc[h.usuario] || {}, t = tienda(h.ultimo_idpdv); const al = S.alertas.find(a => a.usuario === h.usuario); return { ...h, v, u, t: t || {}, ant: h.fecha_alta ? diffD(HOY, h.fecha_alta) : null, alerta: al }; });
    const vis = rows.filter(r => R.incBaja || r.v.e !== 'Baja');
    const cnt = {}; vis.forEach(r => cnt[r.v.e] = (cnt[r.v.e] || 0) + 1);
    const ausN = vis.filter(r => !['Activo', 'Descanso / falta / error', 'Posible baja', 'Baja', 'Sin check'].includes(r.v.e));
    let h = cab('HC · plantilla de promotoría', 'Promotores y cubre-descansos con su último check y estatus. El estatus se actualiza en vivo con las ausencias y bajas que RH captura en Posibles bajas.', 'mochila') + barraFiltros('vHC');
    h += `<div class="tools"><button class="chip ${R.incBaja ? 'on' : ''}" onclick="R.incBaja=!R.incBaja;vHC()">Incluir bajas</button><span class="muted">${fmt(vis.length)} promotores · datos publicados ${esc(R.meta.generado)}</span></div>`;
    h += `<div class="kpis">${kp('Plantilla', fmt(vis.filter(r => r.v.e !== 'Baja').length), 'sin bajas')}${kp('Activos hoy', fmt(cnt['Activo'] || 0), pc1(cnt['Activo'] || 0, vis.length), C.gr)}${kp('Descanso / falta', fmt(cnt['Descanso / falta / error'] || 0), 'último check ayer', C.am)}${kp('Posible baja', fmt(cnt['Posible baja'] || 0), '2 o más días sin check', C.rd, "ir('bandeja')")}${kp('Con ausencia', fmt(ausN.length), 'vacaciones, incapacidad…', C.bl, "ir('vigentes')")}${kp('Reingresos', fmt(vis.filter(r => r.tipo_ingreso === 'Reingreso').length), 'en la plantilla')}</div>`;
    const bk = [['< 30 d', 0, 29], ['30–89 d', 30, 89], ['90–179 d', 90, 179], ['180–364 d', 180, 364], ['1 año o más', 365, 1e9]];
    h += `<div class="grid g2"><div class="card"><h3>Estatus de la plantilla</h3>${donut(Object.entries(cnt).map(([k, v]) => ({ n: k, v, c: k === 'Activo' ? C.gr : k === 'Posible baja' ? C.rd : k === 'Descanso / falta / error' ? C.am : k === 'Baja' ? C.gy : C.bl })))}</div><div class="card"><h3>Antigüedad</h3>${hbars(bk.map(b => ({ n: b[0], v: vis.filter(r => r.ant != null && r.ant >= b[1] && r.ant <= b[2]).length })), C.pu)}</div></div>`;
    TB = {};
    h += sect('Promotores') + tbl('t-hc', [{ h: 'Usuario', t: 1, v: r => r.usuario }, { h: 'Nombre', t: 1, v: r => r.nombre }, { h: 'Estatus', t: 1, v: r => r.v.e, r: r => pillx(esc(r.v.e), ACTC[r.v.e] || 'b') + (r.v.det ? `<br><small class="muted">${esc(r.v.det)}</small>` : '') }, { h: 'Tipo ingreso', t: 1, v: r => r.tipo_ingreso, r: r => r.tipo_ingreso === 'Reingreso' ? pillx('Reingreso', 'b') : 'Nuevo' },
      { h: 'Fecha de ingreso', v: r => r.fecha_alta, r: r => fdate(r.fecha_alta) }, { h: 'Baja anterior', v: r => r.tipo_ingreso === 'Reingreso' ? r.baja_final : null, r: r => r.tipo_ingreso === 'Reingreso' ? fdate(r.baja_final) : '—' }, { h: 'Antigüedad (d)', v: r => r.ant },
      { h: 'Último check', v: r => r.ultimo_check, r: r => fdate(r.ultimo_check) + (r.u.hora_in ? `<br><small class="muted">${hh(r.u.hora_in)} – ${hh(r.u.hora_out)}</small>` : '') }, { h: 'Tipo de check', t: 1, v: r => r.rol, r: r => esc(r.rol || '—') + (r.u.estatus_check ? `<br><small class="muted">${esc(ERRN[r.u.estatus_check] || r.u.estatus_check)}</small>` : '') },
      { h: 'Ausencia', t: 1, v: r => r.v.aus ? r.v.aus.motivo : '', r: r => r.v.aus ? `${esc(r.v.aus.motivo)}<br><small class="muted">${fdate(r.v.aus.inicio)} → ${fdate(r.v.aus.regreso)}</small>` : '—' },
      { h: 'Tienda (último check)', t: 1, v: r => r.t.nombre || '', r: r => esc(r.t.nombre || '—') }, { h: 'Cadena', t: 1, v: r => r.t.cadena }, { h: 'Estado', t: 1, v: r => r.t.estado }, { h: 'Región', t: 1, v: r => r.t.region }, { h: 'Gerente', t: 1, v: r => r.t.gerente }, { h: 'Supervisor', t: 1, v: r => r.t.supervisor }, { h: 'RR.HH.', t: 1, v: r => r.t.rrhh }, { h: 'Empresa', t: 1, v: r => r.empresa },
      { h: '', v: r => '', r: r => r.alerta && can('alertas', 'editar') ? `<button class="btn sm primary" onclick="resolverDesdeHC(${r.alerta.id})">Resolver</button>` : '' }], vis, { search: 1, csv: 1, file: 'hc_promotores', sort: 2, dir: 1, lim: 300 });
    $('content').innerHTML = h; drawAll();
  });
}
function resolverDesdeHC(id) { S.view = 'bandeja'; nav(); render(); setTimeout(() => abrir('aus', id), 80); }

/* ----- datos de ejemplo para los reportes (ficticios) ----- */
(function () {
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  let cache = null;
  function monday(d) { const x = new Date(d + 'T12:00:00'); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }
  function build() {
    const tiendas = Object.values(S.cat.tiendas); const m0 = monday(HOY);
    const ventana = Array.from({ length: 10 }, (_, k) => { const ini = addD(m0, -7 * (9 - k)); return { w: '26-S' + (31 + k), ini }; });
    const sa = Array.from({ length: 40 }, (_, k) => ({ w: '26-S' + pad(k + 1), ini: addD(m0, -7 * (39 - k)) }));
    const f0 = addD(HOY, -90); const nd = 91;
    const meses = []; for (let i = 3; i >= 0; i--) { const d = new Date(HOY + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() - i); meses.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
    const tien = tiendas.map(t => {
      const posc = 1 + (t.idpdv % 2), cuota = posc * 6;
      const sem = ventana.map((w, i) => { const e = rnd() < 0.72 ? 0 : rnd() < 0.5 ? 1 : 2; const ch = e === 2 ? ri(0, 2) : ri(Math.max(2, cuota - 3), cuota + 2); return [e, ch, cuota, posc * 9, Math.max(0, cuota - ch), Math.max(0, ch - posc * 9), ch / 7 * 7, 0, addD(w.ini, ri(2, 6))]; });
      const chk = ventana.map(() => { const d = ri(4, 13), c = Math.round(d * (0.8 + rnd() * 0.2)), pr = ri(0, 3); const e = Array.from({ length: 9 }, () => ri(0, 2)); e[0] = c; return [ri(1, 3), d, c, pr, 0, ...e]; });
      let dias = ''; for (let i = 0; i < nd; i++) dias += rnd() < 0.8 ? 'C' : '0';
      if (t.idpdv % 7 === 0) dias = dias.slice(0, nd - 5) + '00000'; if (t.idpdv % 5 === 0) dias = dias.slice(0, nd - 4) + '0000'; if (t.idpdv % 6 === 0) dias = dias.slice(0, nd - 3) + '000';
      const pen = meses.map((m, k) => { const act = k === meses.length - 1; const mx = act ? (dias.match(/0+$/) || [''])[0].length : ri(0, 6); const e = mx >= 5 ? 2 : mx >= 3 ? 1 : 0; const ra = act ? mx : 0;
        return { m, e: act && ra >= 3 && ra < 5 ? 1 : e, pa: mx >= 3 ? `${ri(1, 20)} al ${ri(21, 28)} ${MESN[+m.slice(5) - 1]}.` : null, dr: mx >= 3 ? mx : 0, mx, pm: mx >= 2 ? `${ri(1, 10)} al ${ri(11, 20)} ${MESN[+m.slice(5) - 1]}.` : null, ds: ri(mx, mx + 5), ul: addD(HOY, -ri(0, 4)), ra, hoy: act ? (rnd() < 0.3 ? 'A' : '0') : null, rs: mx >= 2 ? [[mx, addD(HOY, -mx), addD(HOY, -1)]] : [], act }; });
      let cd = ''; for (let q = 0; q < 70; q++) cd += rnd() < 0.82 ? String(ri(1, posc + 1)) : '0'; if (t.idpdv % 7 === 0) cd = cd.slice(0, 66) + '0000'; if (t.idpdv % 4 === 0) cd = cd.slice(0, 68) + '00';
      return { idpdv: t.idpdv, semanas: sem, chk: { s: chk, cd }, dias, hc_sem: sa.map(() => ri(1, 3)), pen };
    });
    const nom = ['Ana Solís', 'Luis Ortega', 'María Cruz', 'José Reyes', 'Daniela Ruiz', 'Carlos Mora', 'Paola Estrada', 'Jorge Lara', 'Valeria Núñez', 'Diego Gil', 'Karla Vega', 'Miguel Soto', 'Fátima Luna', 'Ricardo Salas', 'Brenda Morales'];
    const hc = Array.from({ length: 70 }, (_, i) => { const t = tiendas[i % tiendas.length]; const dsc = i % 9 === 0 ? ri(2, 12) : i % 5 === 0 ? 1 : 0; const aus = i % 11 === 0; return { usuario: 'DEMO' + (100 + i), nombre: nom[i % 15] + ' ' + (i + 1), fecha_alta: addD(HOY, -ri(10, 700)), baja_final: i % 6 === 0 ? addD(HOY, -ri(200, 600)) : null, estatus_modelo: i % 6 === 0 ? 'Reingreso' : 'Activo', tipo_ingreso: i % 6 === 0 ? 'Reingreso' : 'Nuevo', empresa: ['Benber SS', 'Revelor', 'Doma Legal'][i % 3], ultimo_check: addD(HOY, -dsc), ultimo_idpdv: t.idpdv, ausencia_dias: aus ? 5 : null, ausencia_regreso: aus ? addD(HOY, 2) : null, ausencia_motivo: aus ? 'Vacaciones' : null, rol: i % 8 === 0 ? 'Cubre descansos' : 'Promotor' }; });
    const uc = hc.map(h => ({ usuario: h.usuario, fecha: h.ultimo_check, idpdv: h.ultimo_idpdv, rol: h.rol, hora_in: '09:' + pad(ri(0, 55)) + ':00', hora_out: '18:' + pad(ri(0, 50)) + ':00', estatus_check: rnd() < 0.8 ? 'Cumple' : 'Error Comida', validacion: 'Cumple' }));
    const movs = []; ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach(m => { for (let k = 0; k < ri(8, 14); k++) movs.push({ tipo: 'Alta', fecha: m + '-10', idpdv: tiendas[ri(0, tiendas.length - 1)].idpdv }); for (let k = 0; k < ri(8, 15); k++) movs.push({ tipo: 'Baja', fecha: m + '-12', idpdv: tiendas[ri(0, tiendas.length - 1)].idpdv }); });
    return { meta: { ventana, cd_desde: ventana[0].ini, ultima_fecha: HOY, dias_desde: f0, dias_n: nd, hoy: HOY, estatus_check: [], semanas_anio: sa, generado: 'datos de ejemplo' }, tiendas: tien, hc, uc, movs, bajas: [] };
  }
  Demo.reporte = async function () { if (!cache) cache = build(); return cache; };
  Demo.checks = async function (desde, hasta) {
    const out = []; const tiendas = Object.values(S.cat.tiendas).slice(0, 30); let k = 0;
    for (let d = 0; d < 7; d++) { const f = addD(desde, d); if (f > HOY) continue; tiendas.forEach((t, j) => { for (let n = 0; n < 2; n++) { k++; const r = rnd(); const est = r < 0.78 ? 'Cumple' : r < 0.84 ? 'Error Comida' : r < 0.9 ? 'Check Out Fuera Ventana' : r < 0.94 ? 'Tiempo Incompleto' : r < 0.97 ? 'Check In Fuera Rango' : 'No Check Salida'; const v = est === 'Cumple' ? 'Cumple' : (rnd() < 0.5 ? 'Cumple Productividad' : 'No Cumple'); const reg = v === 'Cumple Productividad' ? ri(1, 4) : (rnd() < 0.5 ? ri(0, 3) : 0);
      out.push({ id: 'k' + k, semana: '', fecha: f, usuario: 'DEMO' + (100 + (k % 60)), nombre: ['Ana Solís', 'Luis Ortega', 'María Cruz', 'José Reyes'][k % 4] + ' ' + (k % 60), idpdv: t.idpdv, rol: 'Promotor', hora_in: '09:' + pad(ri(0, 59)) + ':10', hora_com_in: '13:' + pad(ri(0, 30)) + ':00', hora_com_out: '14:' + pad(ri(0, 30)) + ':00', hora_out: '18:' + pad(ri(0, 59)) + ':00', tiempo_ub: est === 'Tiempo Incompleto' ? ri(300, 470) : ri(480, 560), tiempo_com: ri(10, 60), rango_in: est === 'Check In Fuera Rango' ? 'Fuera de Rango' : 'Dentro de Rango', rango_out: 'Dentro de Rango', equipo_dup: false, estatus_check: est, validacion: v, estatus_final: v, registros: reg, temm: Math.min(reg, 1), porta: reg > 1 ? 1 : 0, pospago: 0, prepago: Math.max(0, reg - 1), check_tel: 0 }); } }); }
    return out;
  };
})();

/* ====================================================================== POSIBLES INGRESOS ====================================================================== */
const ESTI = ['Programado', 'Confirmado', 'Ingresó', 'No llegó', 'Declinó', 'No contesta', 'Reagenda'];
const ESTC = { 'Programado': 'x', 'Confirmado': 'b', 'Ingresó': 'g', 'No llegó': 'r', 'Declinó': 'r', 'No contesta': 'a', 'Reagenda': 'a' };
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const IG = { tab: 'captura', cat: null, grid: [], lista: [], per: '90', loaded: false };
const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fdia = s => { const d = new Date(s + 'T12:00:00'); return DIAS_SEM[d.getDay()] + ' ' + fdate(s); };

/* ----- datos: real y demo ----- */
Real.catIngresos = async function () {
  const [r, f, v] = await Promise.all([sb.from('catalogo_reclutadores').select('id,nombre').eq('activo', true).order('nombre'), sb.from('catalogo_fuentes').select('id,fuente').order('fuente'), sb.from('catalogo_valores').select('tipo,valor,orden').eq('activo', true).order('orden')]);
  const val = t => (v.data || []).filter(x => x.tipo === t).map(x => x.valor);
  return { recl: r.data || [], fuentes: f.data || [], generado: val('generado_por'), experiencia: val('experiencia'), acomp: val('acompanamiento') };
};
const COLS_CAND = 'id,nombre,idpdv,fecha_programada,estatus,reclutador_id,fuente_id,generado_por,experiencia,acompanamiento,acompanado_por,referido_por,comentarios,usuario_fieldwy,reagendas,origen';
Real.candidatos = function (desde, hasta) { return todo(() => sb.from('candidatos').select(COLS_CAND).gte('fecha_programada', desde).lte('fecha_programada', hasta).order('fecha_programada').order('nombre')); };
Real.insertarCandidatos = async function (rows) {
  const lote = crypto.randomUUID(); let n = 0;
  for (let i = 0; i < rows.length; i += 200) { const parte = rows.slice(i, i + 200).map(r => ({ ...r, lote, origen: 'app' })); const { error } = await sb.from('candidatos').insert(parte); if (error) throw error; n += parte.length; }
  return n;
};
Real.actualizarCandidato = async function (id, patch) { const { error } = await sb.from('candidatos').update(patch).eq('id', id); if (error) throw error; };

Demo.catIngresos = async function () {
  return { recl: ['Julio', 'Itzel', 'Veronica', 'Sandy', 'Blanca', 'Luis', 'Karla Martinez', 'Jessica'].map((n, i) => ({ id: i + 1, nombre: n })), fuentes: ['Redes Sociales', 'Viterbit', 'Personal', 'Campo', 'Campaña', 'Referido', 'Pauta', 'Feria Del Empleo', 'Otros'].map((f, i) => ({ id: i + 1, fuente: f })),
    generado: ['Auxiliar', 'Supervisor', 'Reclutador', 'RR.HH.', 'Gerente', 'Telefónica'], experiencia: ['Ventas y atención al cliente', 'Atención al cliente', 'Ventas', 'Telefonía', 'Ventas de telefonía', 'Sin experiencia'], acomp: ['Ninguno', 'Supervisor', 'Auxiliar', 'Reclutador'] };
};
Demo._cands = null;
Demo.candidatos = async function (desde, hasta) {
  if (!Demo._cands) {
    const ids = Object.keys((await Demo.catalogos()).tiendas).map(Number); let k = 0;
    const nom = ['Alan Torres', 'Brenda Ríos', 'César Lugo', 'Diana Paz', 'Erick Salas', 'Fabiola Cruz', 'Gael Ponce', 'Hilda Mora', 'Iván Rojas', 'Julia Vera', 'Kevin Luna', 'Laura Peña', 'Marco Díaz', 'Nadia Soto', 'Oscar Meza'];
    Demo._cands = [];
    for (let d = -45; d <= 6; d++) for (let j = 0; j < (d < 0 ? 5 : 7); j++) {
      k++; const f = addD(HOY, d); const pas = d < 0 || (d === 0 && j % 2 === 0); const r = (k * 7) % 20;
      Demo._cands.push({ id: 'C' + k, nombre: nom[k % 15] + ' ' + (k % 97), idpdv: ids[(k * 3) % ids.length], fecha_programada: f, estatus: pas ? (r < 12 ? 'Ingresó' : r < 15 ? 'Declinó' : r < 17 ? 'No llegó' : r < 19 ? 'No contesta' : 'Reagenda') : (r < 8 ? 'Confirmado' : 'Programado'), reclutador_id: (k % 8) + 1, fuente_id: (k * 5) % 9 + 1, generado_por: ['Auxiliar', 'Supervisor', 'Reclutador', 'RR.HH.'][k % 4], experiencia: 'Ventas', acompanamiento: 'Ninguno', usuario_fieldwy: null, reagendas: 0, comentarios: null });
    }
  }
  return Demo._cands.filter(c => c.fecha_programada >= desde && c.fecha_programada <= hasta);
};
Demo.insertarCandidatos = async function (rows) { await new Promise(r => setTimeout(r, 300)); rows.forEach(r => Demo._cands.push({ id: 'N' + Math.random(), reagendas: 0, estatus: 'Programado', ...r })); return rows.length; };
Demo.actualizarCandidato = async function (id, patch) { const c = Demo._cands.find(x => x.id === id); Object.assign(c, patch); };

/* ----- normalización de lo que se pega desde Excel ----- */
function parseFecha(t) {
  t = String(t || '').trim(); if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return '';
}
function aOpcion(v, lista, mapa) { // lista de textos; devuelve el texto exacto de la lista o ''
  const k = norm(v); if (!k) return '';
  for (const o of lista) if (norm(o) === k) return o;
  for (const o of lista) if (norm(o).includes(k) || (k.length > 3 && k.includes(norm(o)))) return o;
  if (mapa) for (const [pat, dest] of mapa) if (pat.test(k)) { const o = lista.find(x => norm(x) === norm(dest)); if (o) return o; }
  return '';
}
const MAPA_FUENTE = [[/R\.?R\.?S\.?S|REDES/, 'Redes Sociales'], [/CAMPA/, 'Campaña'], [/FERIA/, 'Feria Del Empleo'], [/REFERID/, 'Referido'], [/OTRO/, 'Otros']];
const MAPA_GEN = [[/R\.?R\.?H\.?H|RHHH/, 'RR.HH.'], [/GERENTE/, 'Gerente'], [/TELEFON/, 'Telefónica']];
function aExperiencia(v) {
  const k = norm(v); if (!k) return '';
  const tel = k.includes('TELEFON'), ven = k.includes('VENT'), atc = /ATENC|ATC|CLIE|CLEIN/.test(k);
  const L = IG.cat.experiencia; const g = x => L.find(o => norm(o) === norm(x)) || '';
  if (tel && ven) return g('Ventas de telefonía'); if (tel) return g('Telefonía'); if (ven && atc) return g('Ventas y atención al cliente'); if (atc) return g('Atención al cliente'); if (ven) return g('Ventas'); if (/SIN EXP|NINGUNA/.test(k)) return g('Sin experiencia'); return '';
}
const CAMPOS = [
  { k: 'fecha', h: 'Fecha de ingreso', w: 128, tipo: 'date' }, { k: 'nombre', h: 'Nombre del candidato', w: 210 }, { k: 'idpdv', h: 'IDPDV', w: 96 },
  { k: 'fuente', h: 'Medio', w: 140, tipo: 'sel' }, { k: 'recl', h: 'Reclutado por', w: 140, tipo: 'sel' }, { k: 'generado', h: 'Generado por', w: 128, tipo: 'sel' },
  { k: 'experiencia', h: 'Experiencia', w: 170, tipo: 'sel' }, { k: 'acomp', h: 'Acompañamiento', w: 130, tipo: 'sel' }, { k: 'referido', h: 'Referido por', w: 130 }, { k: 'coment', h: 'Comentarios', w: 180 }
];
const filaVacia = () => ({ fecha: '', nombre: '', idpdv: '', fuente: '', recl: S.me && S.me.reclutador_id && S.me.permisos.posibles_ingresos.alcance === 'propio' ? String(S.me.reclutador_id) : '', generado: '', experiencia: '', acomp: '', referido: '', coment: '' });
function opcionesCampo(k) {
  const c = IG.cat;
  if (k === 'fuente') return c.fuentes.map(x => [String(x.id), x.fuente]); if (k === 'recl') return c.recl.map(x => [String(x.id), x.nombre]);
  if (k === 'generado') return c.generado.map(x => [x, x]); if (k === 'experiencia') return c.experiencia.map(x => [x, x]); if (k === 'acomp') return c.acomp.map(x => [x, x]); return [];
}
function valorPegado(k, t) {
  t = String(t || '').trim();
  if (k === 'fecha') return parseFecha(t);
  if (k === 'idpdv') return t.replace(/\D/g, '');
  if (k === 'fuente') { const o = aOpcion(t, IG.cat.fuentes.map(x => x.fuente), MAPA_FUENTE); const f = IG.cat.fuentes.find(x => x.fuente === o); return f ? String(f.id) : ''; }
  if (k === 'recl') { const nombre = t.replace(/\s+/g, ' ').trim(); const o = aOpcion(nombre, IG.cat.recl.map(x => x.nombre)); const f = IG.cat.recl.find(x => x.nombre === o); return f ? String(f.id) : ''; }
  if (k === 'generado') return aOpcion(t, IG.cat.generado, MAPA_GEN);
  if (k === 'experiencia') return aExperiencia(t);
  if (k === 'acomp') return aOpcion(t, IG.cat.acomp);
  return t;
}
function errorFila(r) {
  const e = {};
  if (!r.fecha) e.fecha = 'Falta la fecha'; else if (r.fecha < addD(HOY, -1)) e.fecha = 'Fecha pasada';
  if (r.nombre.trim().length < 5) e.nombre = 'Escribe nombre completo';
  if (!r.idpdv) e.idpdv = 'Falta IDPDV'; else if (!tienda(+r.idpdv)) e.idpdv = 'IDPDV no existe';
  if (!r.fuente) e.fuente = 'Elige el medio'; if (!r.recl) e.recl = 'Elige reclutador';
  return e;
}
const vacia = r => !r.fecha && !r.nombre && !r.idpdv && !r.fuente && !(r.generado || r.experiencia || r.referido || r.coment);

/* ----- vista principal ----- */
async function vIngresos() {
  if (!IG.loaded) { $('content').innerHTML = cab('Posibles ingresos', 'Cargando…', 'mochila'); IG.cat = await API.catIngresos(); IG.grid = Array.from({ length: 12 }, filaVacia); await cargarCands(); IG.loaded = true; }
  const T = [['captura', '✍️ Captura masiva', can('posibles_ingresos', 'crear')], ['seguimiento', '📅 Seguimiento', true], ['resumen', '📊 Resumen y conversión', true]].filter(x => x[2]);
  if (!T.find(x => x[0] === IG.tab)) IG.tab = T[0][0];
  let h = cab('Posibles ingresos', 'Programa los ingresos de la semana pegando filas desde Excel, da seguimiento día a día y mide qué reclutadores y medios convierten.', 'mochila');
  h += `<div class="tools">${T.map(([k, n]) => `<button class="chip ${IG.tab === k ? 'on' : ''}" onclick="IG.tab='${k}';vIngresos()">${n}</button>`).join('')}</div><div id="ig-body"></div>`;
  $('content').innerHTML = h;
  ({ captura: tCaptura, seguimiento: tSeguimiento, resumen: tResumen })[IG.tab]();
}
async function cargarCands() { IG.lista = await API.candidatos(addD(HOY, -120), addD(HOY, 60)); }

/* ----- captura masiva ----- */
function tCaptura() {
  const prop = S.me.permisos.posibles_ingresos.alcance === 'propio';
  let h = `<div class="card"><div class="note">Copia las filas de tu Excel (sin encabezados) en este orden: <b>fecha · nombre · IDPDV · medio · reclutado por · generado por · experiencia · acompañamiento · referido por · comentarios</b>, haz clic en la primera celda y pega con <b>Ctrl+V</b>. También puedes escribir directo. Lo que no se reconozca queda en rojo para que lo corrijas.</div>
  <div class="tools"><button class="btn sm" onclick="IG.grid.push(...Array.from({length:10},filaVacia));tCaptura()">+ 10 filas</button><button class="btn sm" onclick="limpiarVacias()">Quitar filas vacías</button><button class="btn sm" onclick="IG.grid=Array.from({length:12},filaVacia);tCaptura()">Empezar de nuevo</button><span class="muted" id="g-res"></span><button class="btn primary" id="g-ok" style="margin-left:auto" onclick="guardarGrid()">Guardar candidatos</button></div>
  <div class="tbl-wrap grid-wrap"><table class="dt gt" id="gt"><thead><tr><th>#</th>${CAMPOS.map(c => `<th style="min-width:${c.w}px">${c.h}</th>`).join('')}<th></th></tr></thead><tbody>${IG.grid.map((r, i) => filaGrid(r, i)).join('')}</tbody></table></div></div>`;
  $('ig-body').innerHTML = h; resumenGrid();
  const t = $('gt');
  t.addEventListener('paste', e => {
    const el = e.target.closest('[data-r]'); if (!el) return; const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!txt || !/[\t\n]/.test(txt)) return; e.preventDefault();
    const r0 = +el.dataset.r, c0 = +el.dataset.c; const filas = txt.replace(/\r/g, '').split('\n'); if (filas[filas.length - 1] === '') filas.pop();
    filas.forEach((ln, i) => { while (IG.grid.length <= r0 + i) IG.grid.push(filaVacia()); ln.split('\t').forEach((v, j) => { const c = CAMPOS[c0 + j]; if (c) IG.grid[r0 + i][c.k] = valorPegado(c.k, v); }); });
    tCaptura(); toast(filas.length + ' fila' + (filas.length > 1 ? 's' : '') + ' pegada' + (filas.length > 1 ? 's' : ''));
  });
  t.addEventListener('input', e => { const el = e.target.closest('[data-r]'); if (!el) return; const r = IG.grid[+el.dataset.r], k = CAMPOS[+el.dataset.c].k; r[k] = k === 'idpdv' ? el.value.replace(/\D/g, '') : el.value; if (k === 'idpdv') { const t2 = tienda(+r.idpdv); const s = $('ts' + el.dataset.r); if (s) s.textContent = t2 ? t2.nombre : (r.idpdv ? 'IDPDV no existe' : ''); el.title = ''; } marcar(+el.dataset.r); resumenGrid(); });
}
function filaGrid(r, i) {
  const e = errorFila(r), vac = vacia(r);
  const celda = (c, j) => {
    const bad = !vac && e[c.k] ? 'bad' : '', ttl = !vac && e[c.k] ? ` title="${esc(e[c.k])}"` : '';
    if (c.tipo === 'sel') return `<td class="${bad}"${ttl}><select data-r="${i}" data-c="${j}"><option value=""></option>${opcionesCampo(c.k).map(([v, t]) => `<option value="${esc(v)}" ${v === r[c.k] ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>`;
    if (c.tipo === 'date') return `<td class="${bad}"${ttl}><input type="date" data-r="${i}" data-c="${j}" value="${esc(r.fecha)}"></td>`;
    if (c.k === 'idpdv') { const t = tienda(+r.idpdv); return `<td class="${bad}"${ttl}><input data-r="${i}" data-c="${j}" inputmode="numeric" value="${esc(r.idpdv)}"><small id="ts${i}" class="ts">${t ? esc(t.nombre) : (r.idpdv ? 'IDPDV no existe' : '')}</small></td>`; }
    return `<td class="${bad}"${ttl}><input data-r="${i}" data-c="${j}" value="${esc(r[c.k])}"></td>`;
  };
  return `<tr id="gr${i}" class="${vac ? 'vac' : ''}"><td class="n">${i + 1}</td>${CAMPOS.map(celda).join('')}<td><button class="btn sm" title="Quitar fila" onclick="IG.grid.splice(${i},1);tCaptura()">✕</button></td></tr>`;
}
function marcar(i) { const tr = $('gr' + i); if (!tr) return; const r = IG.grid[i], e = errorFila(r), vac = vacia(r); tr.classList.toggle('vac', vac); CAMPOS.forEach((c, j) => { const td = tr.children[j + 1]; if (td) td.classList.toggle('bad', !vac && !!e[c.k]); }); }
function resumenGrid() {
  const llenas = IG.grid.filter(r => !vacia(r)), malas = llenas.filter(r => Object.keys(errorFila(r)).length);
  const dup = llenas.filter((r, i) => llenas.findIndex(x => norm(x.nombre) === norm(r.nombre) && x.fecha === r.fecha && x.nombre) !== i).length;
  const ya = llenas.filter(r => IG.lista.some(c => norm(c.nombre) === norm(r.nombre) && c.fecha_programada === r.fecha)).length;
  if ($('g-res')) $('g-res').innerHTML = `<b>${llenas.length}</b> fila${llenas.length === 1 ? '' : 's'} con datos · <span style="color:${malas.length ? 'var(--red)' : 'var(--green)'};font-weight:800">${malas.length} con errores</span>${dup + ya ? ` · <span style="color:var(--amber);font-weight:800">${dup + ya} posible${dup + ya > 1 ? 's' : ''} duplicado${dup + ya > 1 ? 's' : ''}</span>` : ''}`;
  if ($('g-ok')) $('g-ok').disabled = !llenas.length || malas.length > 0;
}
function limpiarVacias() { IG.grid = IG.grid.filter(r => !vacia(r)); while (IG.grid.length < 8) IG.grid.push(filaVacia()); tCaptura(); }
async function guardarGrid() {
  const llenas = IG.grid.filter(r => !vacia(r)); if (!llenas.length) return;
  const b = $('g-ok'); b.disabled = true; b.textContent = 'Guardando…';
  const rows = llenas.map(r => ({ nombre: r.nombre.replace(/\s+/g, ' ').trim(), idpdv: +r.idpdv, fecha_captura: HOY, fecha_programada: r.fecha, reclutador_id: +r.recl, fuente_id: +r.fuente, generado_por: r.generado || null, experiencia: r.experiencia || null, acompanamiento: r.acomp || null, referido_por: r.referido.trim() || null, comentarios: r.coment.trim() || null }));
  try { const n = await API.insertarCandidatos(rows); toast(n + ' candidato' + (n > 1 ? 's' : '') + ' guardado' + (n > 1 ? 's' : '')); IG.grid = Array.from({ length: 12 }, filaVacia); await cargarCands(); IG.tab = 'seguimiento'; vIngresos(); }
  catch (e) { b.disabled = false; b.textContent = 'Guardar candidatos'; toast('No se pudo guardar: ' + (e.message || e)); }
}

/* ----- seguimiento ----- */
function tSeguimiento() {
  const rangos = { hoy: ['Hoy', HOY, HOY], man: ['Mañana', addD(HOY, 1), addD(HOY, 1)], sem: ['Próximos 7 días', HOY, addD(HOY, 7)], pend: ['Por cerrar (pasados sin resultado)', addD(HOY, -30), addD(HOY, -1)] };
  const k = IG.rg || 'man'; const [nm, d1, d2] = rangos[k];
  const todos = IG.lista.filter(c => okAlc(c));
  const pen = c => (c.estatus === 'Programado' || c.estatus === 'Confirmado' || c.estatus === 'Reagenda');
  const en = todos.filter(c => c.fecha_programada >= d1 && c.fecha_programada <= d2 && (k !== 'pend' || pen(c)));
  const porCerrar = todos.filter(c => c.fecha_programada < HOY && pen(c)).length;
  const mañ = todos.filter(c => c.fecha_programada === addD(HOY, 1));
  let h = `<div class="kpis"><div class="kpi"><div class="l">Programados mañana</div><div class="v">${mañ.length}</div><div class="s">${mañ.filter(c => c.estatus === 'Confirmado').length} confirmados</div></div>
    <div class="kpi"><div class="l">Programados hoy</div><div class="v">${todos.filter(c => c.fecha_programada === HOY).length}</div><div class="s">${todos.filter(c => c.fecha_programada === HOY && c.estatus === 'Ingresó').length} ya ingresaron</div></div>
    <div class="kpi ${porCerrar ? 'click' : ''}" onclick="IG.rg='pend';tSeguimiento()"><div class="l">Por cerrar</div><div class="v" style="color:${porCerrar ? 'var(--red)' : 'var(--green)'}">${porCerrar}</div><div class="s">fecha pasada sin resultado</div></div></div>`;
  h += `<div class="tools">${Object.entries(rangos).map(([kk, v]) => `<button class="chip ${k === kk ? 'on' : ''}" onclick="IG.rg='${kk}';tSeguimiento()">${v[0]}</button>`).join('')}<input type="search" id="sg-q" placeholder="Buscar nombre…" value="${esc(IG.sq || '')}"><button class="btn sm" onclick="copiarMensaje()" title="Copia el resumen de mañana por estado para enviarlo a Operaciones">📋 Mensaje para Operaciones</button></div>`;
  const q = norm(IG.sq || ''); const f = en.filter(c => !q || norm(c.nombre).includes(q));
  const dias = [...new Set(f.map(c => c.fecha_programada))].sort();
  if (!f.length) h += `<div class="card empty"><img src="${img('pulgares')}" alt="">No hay candidatos en este rango.</div>`;
  for (const d of dias) {
    const g = f.filter(c => c.fecha_programada === d);
    h += `<div class="dia-h">${fdia(d)}${d === HOY ? ' · hoy' : d === addD(HOY, 1) ? ' · mañana' : ''} <span class="muted">${g.length} candidato${g.length > 1 ? 's' : ''} · ${g.filter(c => c.estatus === 'Ingresó').length} ingresaron · ${g.filter(c => c.estatus === 'Confirmado').length} confirmados</span></div><div class="list">${g.map(filaCand).join('')}</div>`;
  }
  $('ig-body').innerHTML = h;
  $('sg-q').oninput = e => { IG.sq = e.target.value; clearTimeout(IG.t); IG.t = setTimeout(() => { const p = e.target.selectionStart; tSeguimiento(); const q2 = $('sg-q'); q2.focus(); q2.setSelectionRange(p, p); }, 250); };
}
const okAlc = c => c.idpdv == null ? !anyFilt() : true;
const anyFilt = () => false;
const nombreRecl = id => (IG.cat.recl.find(x => x.id === id) || {}).nombre || '—';
const nombreFuente = id => (IG.cat.fuentes.find(x => x.id === id) || {}).fuente || '—';
function filaCand(c) {
  const t = tienda(c.idpdv);
  const ac = can('posibles_ingresos', 'editar') ? `<div class="acts">${c.estatus === 'Programado' ? `<button class="btn sm" onclick="cambiarEst('${c.id}','Confirmado')">Confirmó</button>` : ''}
    ${c.estatus !== 'Ingresó' ? `<button class="btn sm primary" onclick="modalIngreso('${c.id}')">Ingresó</button><button class="btn sm" onclick="cambiarEst('${c.id}','No llegó')">No llegó</button><button class="btn sm" onclick="cambiarEst('${c.id}','No contesta')">No contesta</button><button class="btn sm" onclick="cambiarEst('${c.id}','Declinó')">Declinó</button><button class="btn sm" onclick="modalReagendar('${c.id}')">Reagendar</button>` : ''}</div>` : '';
  return `<div class="cd"><div class="who"><b>${esc(c.nombre)}</b><small>${t ? esc(t.nombre) + ' · ' + esc(t.estado) : 'Tienda no identificada'}</small></div>
    <div class="muted">${esc(nombreFuente(c.fuente_id))} · ${esc(nombreRecl(c.reclutador_id))}${c.generado_por ? ' · ' + esc(c.generado_por) : ''}${c.reagendas ? ' · reagendó ' + c.reagendas + 'x' : ''}</div>
    <div><span class="pill ${ESTC[c.estatus] || 'x'}">${esc(c.estatus)}</span>${c.usuario_fieldwy ? `<br><small class="muted">${esc(c.usuario_fieldwy)}</small>` : ''}</div>${ac}</div>`;
}
async function cambiarEst(id, est) {
  try { await API.actualizarCandidato(id, { estatus: est }); const c = IG.lista.find(x => x.id === id); c.estatus = est; toast(est); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); }
}
function modalIngreso(id) {
  const c = IG.lista.find(x => x.id === id);
  $('modal').innerHTML = `<div class="mbox"><h3>Ingresó</h3><div class="who">${esc(c.nombre)}</div><div class="fld"><label>Usuario Fieldwy (opcional por ahora)</label><input id="m-usr" placeholder="Ej. ABCD010203" autocapitalize="characters"></div><div class="note">Con el usuario Fieldwy se enlaza después con su asistencia, su plantilla y su baja.</div><div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Guardar ingreso</button></div></div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
  $('m-ok').onclick = async () => { const u = $('m-usr').value.trim().toUpperCase(); try { await API.actualizarCandidato(id, { estatus: 'Ingresó', usuario_fieldwy: u || null }); c.estatus = 'Ingresó'; c.usuario_fieldwy = u || null; cerrarM(); toast('Ingreso registrado'); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); } };
}
function modalReagendar(id) {
  const c = IG.lista.find(x => x.id === id);
  $('modal').innerHTML = `<div class="mbox"><h3>Reagendar</h3><div class="who">${esc(c.nombre)} · estaba para ${fdate(c.fecha_programada)}</div><div class="fld"><label>Nueva fecha</label><input type="date" id="m-f" value="${addD(HOY, 1)}" min="${HOY}"></div><div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Reagendar</button></div></div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
  $('m-ok').onclick = async () => { const f = $('m-f').value; if (!f) return; try { await API.actualizarCandidato(id, { fecha_programada: f, estatus: 'Programado', reagendas: (c.reagendas || 0) + 1 }); c.fecha_programada = f; c.estatus = 'Programado'; c.reagendas = (c.reagendas || 0) + 1; cerrarM(); toast('Reagendado para ' + fdate(f)); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); } };
}
function copiarMensaje() {
  const d = addD(HOY, 1), g = IG.lista.filter(c => c.fecha_programada === d && ['Programado', 'Confirmado', 'Reagenda'].includes(c.estatus));
  const por = {}; g.forEach(c => { const t = tienda(c.idpdv); const e = t ? t.estado : 'Sin tienda'; (por[e] = por[e] || []).push(c); });
  const L = Object.entries(por).sort((a, b) => b[1].length - a[1].length).map(([e, v]) => `• ${e}: ${v.length} (${v.filter(c => c.estatus === 'Confirmado').length} confirmados)`);
  const txt = `📲 *Ingresos programados – ${fdia(d)}*\n\n*${g.length} ingresos programados* (${g.filter(c => c.estatus === 'Confirmado').length} confirmados)\n\n${L.join('\n')}`;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Mensaje copiado')).catch(() => prompt('Copia el mensaje:', txt)); else prompt('Copia el mensaje:', txt);
}

/* ----- resumen y conversión ----- */
function tResumen() {
  const per = IG.per, desde = per === 'all' ? '0000' : addD(HOY, -(+per));
  const c = IG.lista.filter(x => x.fecha_programada >= desde && x.fecha_programada < HOY);
  const cerr = c.filter(x => !['Programado', 'Confirmado'].includes(x.estatus));
  const ing = cerr.filter(x => x.estatus === 'Ingresó').length;
  const cnt = e => cerr.filter(x => x.estatus === e).length;
  const tabla = (titulo, keyf, namef) => {
    const g = new Map(); cerr.forEach(x => { const k = keyf(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
    const rows = [...g].map(([k, v]) => ({ n: namef(k), p: v.length, i: v.filter(x => x.estatus === 'Ingresó').length, nl: v.filter(x => x.estatus === 'No llegó').length, d: v.filter(x => x.estatus === 'Declinó').length, nc: v.filter(x => x.estatus === 'No contesta').length })).sort((a, b) => b.p - a.p).slice(0, 25);
    return `<h3 style="margin:18px 0 8px;font-size:14.5px">${titulo}</h3><div class="tbl-wrap"><table class="dt"><thead><tr><th>${titulo.replace('Por ', '')}</th><th>Programados</th><th>Ingresos</th><th>Conversión</th><th>No llegó</th><th>Declinó</th><th>No contesta</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.n)}</b></td><td>${r.p}</td><td>${r.i}</td><td><span class="pill ${r.i / r.p >= 0.7 ? 'g' : r.i / r.p >= 0.5 ? 'a' : 'r'}">${(r.i / r.p * 100).toFixed(0)}%</span></td><td>${r.nl}</td><td>${r.d}</td><td>${r.nc}</td></tr>`).join('')}</tbody></table></div>`;
  };
  let h = `<div class="tools"><span>Periodo:</span><select onchange="IG.per=this.value;tResumen()">${[['30', 'Últimos 30 días'], ['60', 'Últimos 60 días'], ['90', 'Últimos 90 días'], ['all', 'Todo lo cargado']].map(([v, t]) => `<option value="${v}" ${IG.per === v ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="muted">${fmt(cerr.length)} candidatos con resultado · no incluye los que siguen programados</span></div>
    <div class="kpis"><div class="kpi"><div class="l">Programados</div><div class="v">${fmt(cerr.length)}</div></div><div class="kpi"><div class="l">Ingresaron</div><div class="v" style="color:var(--green)">${fmt(ing)}</div></div>
    <div class="kpi"><div class="l">Conversión</div><div class="v">${cerr.length ? (ing / cerr.length * 100).toFixed(1) + '%' : '—'}</div></div><div class="kpi"><div class="l">No llegó</div><div class="v" style="color:var(--red)">${cnt('No llegó')}</div></div><div class="kpi"><div class="l">Declinó</div><div class="v" style="color:var(--red)">${cnt('Declinó')}</div></div><div class="kpi"><div class="l">No contesta</div><div class="v" style="color:var(--amber)">${cnt('No contesta')}</div></div></div>`;
  h += tabla('Por reclutador', x => x.reclutador_id, nombreRecl) + tabla('Por medio', x => x.fuente_id, nombreFuente) + tabla('Por estado', x => (tienda(x.idpdv) || {}).estado || 'Sin tienda', k => k) + tabla('Por generado por', x => x.generado_por || 'Sin dato', k => k);
  $('ig-body').innerHTML = h;
}

/* ====================================================================== arranque ====================================================================== */
async function entrar() {
  try {
    S.me = await API.me(); S.cat = await API.catalogos();
    $('login').hidden = true; $('app').hidden = false;
    $('u-nombre').textContent = S.me.nombre; $('u-rol').textContent = NIVEL[S.me.rol] || S.me.rol;
    const alc = S.me.permisos.alertas; $('u-alc').textContent = S.me.rol === 'rh' && S.me.rrhh ? 'Estados de ' + S.me.rrhh : alc && alc.alcance === 'todo' ? 'Acceso general' : alc ? 'Alcance: ' + alc.alcance : '';
    [S.alertas, S.vigentes] = await Promise.all([can('alertas', 'ver') ? API.alertas() : [], can('ausencias', 'ver') ? API.vigentes() : []]);
    const primera = VISTAS.find(v => !v.soon && can(v.mod, 'ver')); S.view = primera ? primera.k : 'bandeja';
    nav(); render();
  } catch (e) { await API.logout(); mostrarLogin(e.message || String(e)); }
}
function mostrarLogin(msg) { $('app').hidden = true; $('login').hidden = false; $('lg-msg').textContent = msg || ''; $('lg-u').focus(); }
(async function () {
  ['sb-logo', 'tb-logo'].forEach(i => $(i).src = img('logo_gb')); $('lg-mascot').src = img('mochila');
  $('u-salir').onclick = () => API.logout().then(() => mostrarLogin());
  $('tb-menu').onclick = () => $('sidebar').classList.toggle('open');
  $('lg-form').onsubmit = async e => { e.preventDefault(); $('lg-msg').textContent = ''; const b = $('lg-btn'); b.disabled = true; b.textContent = 'Entrando…'; try { await API.login($('lg-u').value, $('lg-p').value); await entrar(); } catch (x) { $('lg-msg').textContent = x.message; } b.disabled = false; b.textContent = 'Entrar'; };
  if (DEMO) { await entrar(); return; }
  try { if (await API.init()) await entrar(); else mostrarLogin(); } catch (e) { mostrarLogin('No se pudo conectar: ' + e.message); }
})();

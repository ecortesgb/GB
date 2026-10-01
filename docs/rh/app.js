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
    const [t, ma, mb] = await Promise.all([todo(() => sb.from('tiendas').select('idpdv,nombre,cadena,estado,region,gerente,supervisor,rrhh')),
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
  const tien = []; for (let i = 0; i < 40; i++) { const e = est[i % 5]; const t = { idpdv: id + i, nombre: (cad[i % 4]).toUpperCase() + ' ' + ['CENTRO', 'PLAZA SOL', 'NORTE', 'REFORMA', 'ALAMEDA', 'LAS TORRES', 'CANADA', 'AZTECAS'][i % 8] + ' ' + (i + 1), cadena: cad[i % 4], estado: e[0], region: e[1], gerente: 'Gerente Demo', supervisor: 'Supervisor ' + (i % 7 + 1), rrhh: e[2] }; tiendas[t.idpdv] = t; tien.push(t); }
  const mkAus = (u, k) => { const m = ['Permiso especial', 'Vacaciones', 'Incapacidad (IMSS)', 'Tema médico (particular)']; return Array.from({ length: k }, (_, j) => ({ motivo: m[(u + j) % 4], fecha_inicio: addD(HOY, -(8 + j * 21 + u % 9)), dias: 1 + (u + j) % 5, fecha_regreso: addD(HOY, -(8 + j * 21 + u % 9) + 1 + (u + j) % 5) })); };
  let alertas = nombres.map((n, i) => { const dias = [2, 2, 3, 2, 4, 6, 2, 3, 9, 2, 5, 2, 3, 2, 12, 2, 4, 3, 2, 7, 2, 3, 2, 5][i]; const t = tien[(i * 7) % 40]; return { id: i + 1, usuario: 'DEMO' + String(100 + i), nombre: n, ultimo: addD(HOY, -dias), dias, idpdv: t.idpdv, empresa: ['Benber SS', 'Revelor', 'Doma Legal', 'Atmosphera'][i % 4], ingreso: addD(HOY, -(30 + i * 37)), aus: mkAus(i, i % 4 === 0 ? 3 : i % 3) }; });
  let vigentes = [['Vacaciones', 6, 3], ['Incapacidad (IMSS)', 10, 5], ['Permiso especial', 3, 1], ['Tema médico (particular)', 4, 2], ['Vacaciones', 12, 8], ['Incapacidad (IMSS)', 20, 9], ['Permiso especial', 2, 1]].map((v, i) => ({ id: 500 + i, usuario: 'DEMO' + (300 + i), nombre: ['Pedro Lozano', 'Gabriela Ibarra', 'Mónica Téllez', 'Saúl Cervantes', 'Teresa Pineda', 'Víctor Maya', 'Elena Ochoa'][i], motivo: v[0], inicio: addD(HOY, -v[2]), dias: v[1], regreso: addD(HOY, v[1] - v[2]), idpdv: tien[(i * 5) % 40].idpdv }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  return {
    async init() { return true; }, async login() { }, async logout() { location.href = location.pathname; },
    async me() { return { id: 'demo', nombre: 'Usuario de ejemplo', rol: 'rh', rrhh: 'Julio César Aldana', zona: null, permisos: Object.fromEntries(['alertas', 'ausencias', 'bajas', 'colaboradores', 'posibles_ingresos', 'expedientes'].map(m => [m, { ver: true, crear: true, editar: true, borrar: false, alcance: 'estado' }])) }; },
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
  { k: 'bandeja', ic: '🚨', n: 'Posibles bajas', mod: 'alertas', f: vBandeja },
  { k: 'vigentes', ic: '🩺', n: 'Ausencias vigentes', mod: 'ausencias', f: vVigentes },
  { k: 'ingresos', ic: '🧑‍💼', n: 'Posibles ingresos', mod: 'posibles_ingresos', f: vIngresos },
  { k: 'bajas', ic: '📤', n: 'Bajas y encuesta', mod: 'bajas', soon: true },
  { k: 'expedientes', ic: '🗂️', n: 'Expedientes', mod: 'expedientes', soon: true }
];

function nav() {
  $('nav').innerHTML = VISTAS.filter(v => can(v.mod, 'ver')).map(v => `<div class="nav-item ${v.k === S.view ? 'active' : ''} ${v.soon ? 'off' : ''}" ${v.soon ? '' : `onclick="ir('${v.k}')"`}><span class="ic">${v.ic}</span>${v.n}${v.soon ? '<span class="soon">pronto</span>' : ''}</div>`).join('');
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

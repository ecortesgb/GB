/* >>> 01_core.js */
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
async function todo(q) { // pagina de 1000 en 1000, con reintentos si la red falla
  let out = [], i = 0;
  for (;;) {
    let data, error;
    for (let k = 0; k < 4; k++) { try { ({ data, error } = await q().range(i, i + 999)); if (!error) break; } catch (e) { error = e; } await new Promise(r => setTimeout(r, 700 * (k + 1))); }
    if (error) throw error; out = out.concat(data); if (data.length < 1000) return out; i += 1000;
  }
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
    const [t, ma, mb] = await Promise.all([todo(() => sb.from('tiendas').select('idpdv,nombre,cadena,estado,region,gerente,supervisor,rrhh,posiciones,zona_rrhh')),
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


/* >>> 01b_demo_base.js */
/* ---------- datos de ejemplo (todo ficticio; escribe solo en memoria) ---------- */
const Demo = (() => {
  const nombres = ['Ana Karen Solís', 'Luis Ángel Ortega', 'María Fernanda Cruz', 'José Manuel Reyes', 'Daniela Ruiz Peña', 'Carlos Iván Mora', 'Paola Estrada', 'Jorge Alberto Lara', 'Valeria Núñez', 'Diego Armando Gil', 'Karla Itzel Vega', 'Miguel Ángel Soto', 'Fátima Luna', 'Ricardo Salas', 'Brenda Morales', 'Héctor Duarte', 'Itzel Aguirre', 'Omar Castañeda', 'Lucía Montes', 'Andrés Cabrera', 'Nancy Palacios', 'Emilio Rangel', 'Sofía Barrera', 'Raúl Meza'];
  const est = [['Puebla', 'SUR', 'Julio César Aldana'], ['Veracruz', 'SUR', 'Jessica Santos'], ['Guanajuato', 'OCCIDENTE', 'Andrea Maya'], ['Nuevo León', 'NORTE', 'Flor Morado'], ['Ciudad de México', 'CENTRO', 'Dulce Apaiz']];
  const cad = ['Coppel', 'Elektra', 'Suburbia', 'Cimaco'];
  const tiendas = {}; let id = 1000;
  const tien = []; for (let i = 0; i < 40; i++) { const e = est[i % 5]; const t = { idpdv: id + i, nombre: (cad[i % 4]).toUpperCase() + ' ' + ['CENTRO', 'PLAZA SOL', 'NORTE', 'REFORMA', 'ALAMEDA', 'LAS TORRES', 'CANADA', 'AZTECAS'][i % 8] + ' ' + (i + 1), cadena: cad[i % 4], estado: e[0], region: e[1], gerente: 'Gerente Demo', supervisor: 'Supervisor ' + (i % 7 + 1), rrhh: e[2], posiciones: 1 + ((id + i) % 2), zona_rrhh: ['ANDREA AGUILAR BUENO', 'GUADALUPE GOMEZ GARCIA', 'MARIA EUGENIA JUAREZ MORA'][i % 3] }; tiendas[t.idpdv] = t; tien.push(t); }
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


/* >>> 02_ui.js */
/* ====================================================================== UI: gráficos, tablas fijas, filtros, periodo, capturas ====================================================================== */
const MESN = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const mlabel = k => MESN[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4);
const f1 = n => n == null || isNaN(n) ? '—' : n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = n => n == null || isNaN(n) ? '—' : (Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString('es-MX') : n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pn = (a, b) => b > 0 ? a / b * 100 : null;
const pc1 = (a, b) => b > 0 ? (a / b * 100).toFixed(2) + '%' : '—';
const pct = (a, b, d = 2) => b > 0 ? (a / b * 100).toFixed(d) + '%' : '—';
const C = { or: '#EE6602', od: '#C74F00', gr: '#1E7A1E', rd: '#DC2626', am: '#D97706', ye: '#F2C94C', bl: '#00509C', pu: '#5C2483', gy: '#8B939E', dk: '#3B4048', te: '#0F8B8D' };
const pillx = (t, c) => `<span class="pill ${c}">${t}</span>`;
const kp = (l, v, s, col, click, ic) => `<div class="kpi ${click ? 'click' : ''}" ${click ? `onclick="${click}"` : ''}><div class="l">${ic ? `<span class="kic">${ic}</span>` : ''}${l}</div><div class="v" style="${col ? 'color:' + col : ''}">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
const sect = (t, ic) => `<div class="section-title"><span class="bar"></span><h3>${ic ? ic + ' ' : ''}${t}</h3></div>`;
const legend = items => `<div class="leg">${items.map(([n, c]) => `<span><b style="background:${c}"></b>${n}</span>`).join('')}</div>`;
const dl = (a, b, fx = 2) => a == null || b == null ? '' : `<span class="${a - b >= 0 ? 'up' : 'dn'}">${a - b >= 0 ? '▲' : '▼'} ${Math.abs(a - b).toFixed(fx)} pts vs ant.</span>`;

/* ---------- gráficos SVG ---------- */
function niceTop(v) { // tope del eje tal que sus 4 divisiones sean números redondos (40 -> 0,10,20,30,40)
  if (v <= 0) return 1; const s = v / 4, p = Math.pow(10, Math.floor(Math.log10(s))), m = s / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : (m <= 2.5 && p >= 10) ? 2.5 : m <= 5 ? 5 : 10) * p * 4;
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
function regresion(vals) { // recta de tendencia (mínimos cuadrados) sobre los puntos con dato
  const p = vals.map((v, i) => [i, v]).filter(q => q[1] != null); if (p.length < 2) return null;
  const n = p.length, sx = p.reduce((a, q) => a + q[0], 0), sy = p.reduce((a, q) => a + q[1], 0), sxy = p.reduce((a, q) => a + q[0] * q[1], 0), sxx = p.reduce((a, q) => a + q[0] * q[0], 0), d = n * sxx - sx * sx;
  if (!d) return null; const m = (n * sxy - sx * sy) / d, b = (sy - m * sx) / n; return i => b + m * i;
}
/* chart(labels, series, {bars, stack, pct, max, h, w, ticks, vals, lines (misma escala), lines2 (escala derecha), band (la línea va en una franja arriba, sin tapar las barras), y2:{max,pct}}) */
function chart(labels, series, o = {}) {
  const l2 = o.lines2 || [], band = !!(o.band && l2.length), W = o.w || 600, H = o.h || 290, L = 46, R = l2.length ? 54 : 30, T = band ? 36 : 26, B = 28, pw = W - L - R, ph = H - T - B, n = labels.length;
  const phB = band ? ph * 0.64 : ph, phL = band ? ph * 0.27 : ph;
  const all = [...series.flatMap(s => s.v), ...(o.lines || []).flatMap(s => s.v)].filter(x => x != null);
  let mx = o.max != null ? o.max : niceTop(Math.max(1e-9, ...all));
  if (o.stack) { const tot = labels.map((_, i) => series.reduce((a, s) => a + (s.v[i] || 0), 0)); mx = o.max != null ? o.max : niceTop(Math.max(1e-9, ...tot, ...(o.lines || []).flatMap(s => s.v).filter(x => x != null))); }
  const y = v => T + ph - (v / mx) * phB, bw = pw / Math.max(1, n), xc = i => L + i * bw + bw / 2, xs = i => L + (n <= 1 ? pw / 2 : i * pw / (n - 1)), X = i => o.bars ? xc(i) : xs(i);
  const v2 = l2.flatMap(s => s.v).filter(x => x != null), fT = l2.map(s => s.trend ? regresion(s.v) : null);
  const vt = [...v2]; l2.forEach((s, k) => { if (fT[k]) { vt.push(fT[k](0), fT[k](n - 1)); } });
  let lo2 = 0, hi2 = o.y2 && o.y2.max != null ? o.y2.max : niceMax(Math.max(1e-9, ...v2) * 1.15);
  if (band) { const a = Math.min(...vt), b = Math.max(...vt), r = (b - a) || Math.max(0.5, Math.abs(b) * 0.2); lo2 = Math.max(0, a - r * 0.5); hi2 = b + r * 0.5; }
  const y2 = band ? v => T + phL - (v - lo2) / (hi2 - lo2) * phL : v => T + ph - (v / hi2) * ph;
  const lab = v => o.pct ? (mx < 10 ? v.toFixed(1) : Math.round(v)) + '%' : fmt(v), lab2 = v => o.y2 && o.y2.pct ? v.toFixed(2) + '%' : fmt1(v);
  let g = band ? `<rect x="${L}" y="${T - 12}" width="${pw}" height="${phL + 24}" rx="9" fill="#FFF3E6"/>` : '';
  for (let k = 0; k <= 4; k++) { const v = mx * k / 4; g += `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${lab(v)}</text>`; }
  if (l2.length) (band ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).forEach(f => { const v = lo2 + (hi2 - lo2) * f; g += `<text x="${W - R + 7}" y="${y2(v) + 4}" text-anchor="start" style="fill:#9A4A00;font-weight:700">${o.y2 && o.y2.pct ? v.toFixed(band ? 2 : 1) + '%' : fmt1(v)}</text>`; });
  const every = Math.ceil(n / (o.ticks || 14));
  labels.forEach((l, i) => { if (i % every === 0) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" style="font-weight:700;fill:#3a3f47">${esc(l)}</text>`; });
  const vi = (x, yy, t) => `<text x="${x}" y="${yy}" text-anchor="middle" class="vi">${t}</text>`, vo = (x, yy, t, c) => `<text x="${x}" y="${yy}" text-anchor="middle" class="vl" style="fill:${c}">${t}</text>`;
  const pill = (x, yy, t, c) => { const w = t.length * 7.6 + 14; return `<rect x="${x - w / 2}" y="${yy - 25}" width="${w}" height="20" rx="7" fill="#fff" stroke="${c}" stroke-width="1.8"/><text x="${x}" y="${yy - 10.5}" text-anchor="middle" class="vp" style="fill:${c}">${t}</text>`; };
  if (o.bars) {
    const ns = o.stack ? 1 : series.length, w = Math.max(3, bw * 0.8 / ns);
    labels.forEach((_, i) => {
      let acc = 0;
      series.forEach((s, j) => {
        const v = s.v[i] || 0, x = o.stack ? L + i * bw + bw * 0.1 : L + i * bw + bw * 0.1 + j * w, h = v / mx * phB, yy = o.stack ? T + ph - (acc + v) / mx * phB : T + ph - h, ww = o.stack ? bw * 0.8 : w;
        g += `<rect x="${x}" y="${yy}" width="${ww}" height="${Math.max(0, h)}" fill="${s.c}" rx="3"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct ? v.toFixed(2) + '%' : fmt(v)}</title></rect>`;
        if (o.vals && v > 0) { if (h >= 17 && ww >= 22) g += vi(x + ww / 2, yy + h / 2 + 5, fmt(v)); else if (!o.stack) g += vo(x + ww / 2, yy - 5, fmt(v), s.tc || s.c); }
        acc += v;
      });
    });
  } else series.forEach(s => {
    let d = ''; s.v.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + xs(i) + ',' + y(v); });
    g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="3" stroke-linejoin="round"/>`;
    s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${xs(i)}" cy="${y(v)}" r="4" fill="${s.c}"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct ? v.toFixed(2) + '%' : fmt(v)}</title></circle>${o.vals ? pill(xs(i), y(v) - 2, o.pct ? v.toFixed(2) + '%' : fmt(v), s.tc || s.c) : ''}`; });
  });
  (o.lines || []).forEach(s => {
    let d = ''; s.v.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + X(i) + ',' + y(v); });
    g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.8" stroke-dasharray="${s.dash || ''}"/>`;
    s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${y(v)}" r="3.6" fill="#fff" stroke="${s.c}" stroke-width="2"><title>${esc(labels[i])} · ${esc(s.n)}: ${o.pct2 ? v.toFixed(2) + '%' : fmt(v)}</title></circle>`; });
  });
  l2.forEach((s, k) => {
    const f = fT[k]; if (f) g += `<line x1="${X(0)}" y1="${y2(f(0))}" x2="${X(n - 1)}" y2="${y2(f(n - 1))}" stroke="${s.tc || '#3B4048'}" stroke-width="2.4" stroke-dasharray="7 5"><title>Tendencia de ${esc(s.n)}</title></line>`;
    let d = ''; s.v.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + X(i) + ',' + y2(v); });
    g += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="3.2" stroke-linejoin="round"/>`;
    s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${y2(v)}" r="4.6" fill="#fff" stroke="${s.c}" stroke-width="2.6"><title>${esc(labels[i])} · ${esc(s.n)}: ${lab2(v)}</title></circle>${pill(X(i), y2(v) - 5, lab2(v), s.c)}`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg>`;
}
function donut(items, o = {}) {
  const tot = items.reduce((a, b) => a + b.v, 0) || 1; let a0 = -Math.PI / 2, p = '';
  items.forEach(it => {
    if (!it.v) return; const a1 = a0 + it.v / tot * 2 * Math.PI, r = 66, ri = 42, cx = 80, cy = 80, lg = a1 - a0 > Math.PI ? 1 : 0;
    const P = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; const e = Math.min(a1, a0 + 6.2831);
    const [x0, y0] = P(r, a0), [x1, y1] = P(r, e), [x2, y2] = P(ri, e), [x3, y3] = P(ri, a0);
    p += `<path d="M${x0},${y0}A${r},${r} 0 ${lg} 1 ${x1},${y1}L${x2},${y2}A${ri},${ri} 0 ${lg} 0 ${x3},${y3}Z" fill="${it.c}" stroke="#fff" stroke-width="1.5"><title>${esc(it.n)}: ${fmt(it.v)}</title></path>`; a0 = a1;
  });
  const top = [...items].sort((a, b) => b.v - a.v)[0];
  return `<div class="donut"><svg class="donut-svg" viewBox="0 0 160 160" width="164" height="164">${p}<text x="80" y="76" text-anchor="middle" style="font-size:18px;font-weight:800;fill:#1a1a1a">${o.centro != null ? o.centro : fmt(tot)}</text><text x="80" y="92" text-anchor="middle" style="font-size:9px">${esc(o.sub || 'total')}</text></svg>
  <div class="donut-leg">${items.map(it => `<div class="dl-row ${top && it === top && o.best ? 'best' : ''}"><i style="background:${it.c}"></i><span class="dl-n" title="${esc(it.n)}">${esc(it.n)}</span><b>${o.fmtv ? o.fmtv(it) : fmt(it.v)}</b><em>${pct(it.v, tot, 0)}</em></div>`).join('')}</div></div>`;
}
function hbars(rows, col, o = {}) {
  const mx = Math.max(1e-9, ...rows.map(r => r.v));
  return `<div class="funnel">${rows.map(r => `<div class="frow"><span title="${esc(r.n)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.n)}</span><div class="fb"><i style="width:${Math.max(2, r.v / mx * 100)}%;background:${r.c || col}"></i></div><span>${o.pct ? r.v.toFixed(2) + '%' : fmt(r.v)}${r.s ? ` <small class="pc">${r.s}</small>` : ''}</span></div>`).join('')}</div>`;
}
function embudo(titulo, etapas) {
  const mx = etapas[0].v || 1;
  return `<div class="card"><h3>${titulo}</h3><div class="funnel2">${etapas.map(e => `<div class="fn-row"><div class="fn-l">${e.n}</div><div class="fn-b" style="width:${Math.max(10, e.v / mx * 100)}%;background:${e.c}"><span>${fmt1(e.v)}</span></div></div>`).join('')}</div></div>`;
}

/* ---------- tablas con encabezados y columnas fijas, búsqueda, CSV y PNG ----------
   cols: [{h, v, r, t(texto a la izquierda), w(ancho px), grp, c(clase de color)}] · opts: {fix:n, groups:[{t,span,cls}], search, csv, png, file, sort, dir, lim, titulo, maxh} */
let TB = {};
function tbl(id, cols, rows, o = {}) {
  TB[id] = { cols, rows, sort: o.sort == null ? -1 : o.sort, dir: o.dir || -1, q: '', lim: o.lim || 300, file: o.file || id, fix: o.fix || 0, groups: o.groups || null, titulo: o.titulo || o.file || id, maxh: o.maxh };
  return `<div class="tools tb-tools">${o.search ? `<input type="search" placeholder="🔎 Buscar…" oninput="tq('${id}',this.value)">` : ''}<span class="muted" id="${id}-n"></span><span class="tb-btns">${o.png ? `<button class="btn sm" onclick="tpng('${id}')" title="Descarga la tabla filtrada como imagen para compartirla">📸 Imagen</button><button class="btn sm" onclick="tpngCopiar('${id}')" title="Copia la imagen para pegarla en WhatsApp">📋 Copiar</button>` : ''}${o.csv ? `<button class="btn sm" onclick="tcsv('${id}')">⬇ CSV</button>` : ''}</span></div><div class="tw" id="${id}-w" ${o.maxh ? `style="max-height:${o.maxh}"` : ''}><table class="dt st" id="${id}"></table></div>`;
}
function filtraT(T) { let rows = T.rows; if (T.q) { const q = norm(T.q); rows = rows.filter(r => T.cols.some(c => norm(c.v(r) == null ? '' : c.v(r)).includes(q))); } return rows; }
function tdraw(id) {
  const T = TB[id], el = $(id); if (!el) return; let rows = filtraT(T);
  if (T.sort >= 0) { const c = T.cols[T.sort]; rows = rows.slice().sort((a, b) => { const x = c.v(a), y = c.v(b); const nx = x == null || x === '', ny = y == null || y === ''; if (nx || ny) return nx && ny ? 0 : nx ? 1 : -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * T.dir; }); }
  const shown = rows.slice(0, T.lim); const left = []; let acc = 0; T.cols.forEach((c, i) => { left[i] = acc; if (i < T.fix) acc += c.w || 110; });
  const fx = i => i < T.fix ? ` fx" style="left:${left[i]}px;min-width:${T.cols[i].w || 110}px;max-width:${T.cols[i].w || 110}px` : '"';
  const th = (c, i) => `<th class="s${i < T.fix ? ' fx' : ''}${c.hc ? ' ' + c.hc : ''}" ${i < T.fix ? `style="left:${left[i]}px;min-width:${c.w || 110}px;max-width:${c.w || 110}px"` : ''} onclick="tsort('${id}',${i})">${c.h}${T.sort === i ? (T.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  let h = '<thead>';
  if (T.groups) { let k = 0; h += '<tr class="g1">' + T.groups.map(g => { const cells = T.cols.slice(k, k + g.span); const fixed = k < T.fix; const lf = fixed ? left[k] : 0; const w = fixed ? cells.reduce((a, c, j) => a + (k + j < T.fix ? (c.w || 110) : 0), 0) : 0; const r = `<th colspan="${g.span}" class="gh ${g.cls || ''}${fixed ? ' fx' : ''}" ${fixed ? `style="left:${lf}px;min-width:${w}px"` : ''}>${g.t}</th>`; k += g.span; return r; }).join('') + '</tr>'; }
  h += `<tr class="${T.groups ? 'g2' : ''}">` + T.cols.map(th).join('') + '</tr></thead><tbody>';
  h += shown.map(r => '<tr>' + T.cols.map((c, i) => { const v = c.v(r), disp = c.r ? c.r(r) : (v == null ? '—' : (typeof v === 'number' ? (c.h === 'IDPDV' ? v : fmt(v)) : esc(v))); const cl = (typeof c.c === 'function' ? c.c(r) : c.c) || ''; return `<td class="${c.t ? 't ' : ''}${i < T.fix ? 'fx ' : ''}${cl}" ${i < T.fix ? `style="left:${left[i]}px;min-width:${c.w || 110}px;max-width:${c.w || 110}px"` : ''}>${i < T.fix ? `<div class="cut" style="max-width:${(c.w || 110) - 24}px" title="${esc(String(v == null ? '' : v))}">${disp}</div>` : disp}</td>`; }).join('') + '</tr>').join('');
  el.innerHTML = h + '</tbody>';
  const n = $(id + '-n'); if (n) n.textContent = rows.length > T.lim ? `Mostrando ${T.lim} de ${fmt(rows.length)}` : `${fmt(rows.length)} filas`;
}
const tsort = (id, i) => { const T = TB[id]; if (T.sort === i) T.dir = -T.dir; else { T.sort = i; T.dir = T.cols[i].t ? 1 : -1; } tdraw(id); };
const tq = (id, v) => { TB[id].q = v; tdraw(id); };
function tcsv(id) {
  const T = TB[id], rows = filtraT(T), q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const t = [T.cols.map(c => q(c.h.replace(/<[^>]+>/g, ''))).join(',')].concat(rows.map(r => T.cols.map(c => q(c.v(r))).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + t], { type: 'text/csv;charset=utf-8' })); a.download = T.file + '.csv'; a.click(); toast('CSV descargado');
}
const drawAll = () => Object.keys(TB).forEach(tdraw);

/* ---------- capturas (PNG) para compartir en los grupos ---------- */
async function pngDe(el, titulo, sub) {
  if (!window.html2canvas) throw new Error('El generador de imágenes no cargó (revisa tu conexión).');
  const box = document.createElement('div'); box.className = 'cap-box'; box.style.width = 'max-content'; box.style.minWidth = '760px';
  box.innerHTML = `<div class="cap-head"><img src="${img('logo_gb')}" alt=""><div><b>${esc(titulo)}</b><small>${esc(sub || '')}</small></div><span>Grupo Benber · RH · ${fdate(HOY)}</span></div>`;
  const clon = el.cloneNode(true);
  [clon, ...clon.querySelectorAll('.tw')].filter(t => t.classList && t.classList.contains('tw')).forEach(t => { t.style.maxHeight = 'none'; t.style.overflow = 'visible'; t.style.width = 'max-content'; t.style.maxWidth = 'none'; });
  clon.querySelectorAll('[data-nocap]').forEach(x => x.remove()); clon.querySelectorAll('details').forEach(d => d.setAttribute('open', '')); clon.querySelectorAll('.xlw').forEach(t => { t.style.overflow = 'visible'; t.style.maxHeight = 'none'; });
  clon.querySelectorAll('.fx').forEach(x => { x.style.position = 'static'; x.style.left = 'auto'; x.style.maxWidth = 'none'; }); clon.querySelectorAll('.cut').forEach(x => { x.style.overflow = 'visible'; x.style.textOverflow = 'clip'; x.style.maxWidth = 'none'; });
  clon.querySelectorAll('thead th').forEach(x => { x.style.position = 'static'; });
  box.appendChild(clon); document.body.appendChild(box);
  try { await (document.fonts && document.fonts.ready); await new Promise(r => setTimeout(r, 60)); const w = Math.ceil(Math.max(box.getBoundingClientRect().width, box.scrollWidth, 760)), hh = Math.ceil(Math.max(box.getBoundingClientRect().height, box.scrollHeight)), sc = Math.min(2, 16000 / Math.max(w, hh)); return await html2canvas(box, { scale: sc, backgroundColor: '#ffffff', useCORS: true, width: w, height: hh, windowWidth: w + 80, windowHeight: hh + 80, scrollX: 0, scrollY: 0 }); } finally { box.remove(); }
}
async function capturaDescargar(el, titulo, sub, nombre) { toast('Generando imagen…'); try { const c = await pngDe(el, titulo, sub); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = (nombre || titulo).replace(/[^\w\-]+/g, '_') + '_' + HOY + '.png'; a.click(); toast('Imagen descargada'); } catch (e) { toast(e.message || e); } }
async function capturaCopiar(el, titulo, sub) {
  // el portapapeles exige iniciar la escritura dentro del clic: se entrega una promesa del PNG y el navegador la espera
  toast('Generando imagen…');
  const blobP = pngDe(el, titulo, sub).then(c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo generar la imagen')), 'image/png')));
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sin portapapeles');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]); toast('Imagen copiada: pégala en WhatsApp o Excel');
  } catch (e) {
    try { const b = await blobP; mostrarImagen(b, titulo); } catch (e2) { toast(e2.message || e2); }
  }
}
function mostrarImagen(blob, titulo) { // plan B: la muestra para copiarla con clic derecho o guardarla
  const u = URL.createObjectURL(blob); $('modal').innerHTML = `<div class="mbox wide" style="width:min(1100px,96vw)"><h3>📋 ${esc(titulo)}</h3><p class="note">Tu navegador no dejó copiar directo. Haz clic derecho sobre la imagen → <b>Copiar imagen</b>, o descárgala.</p><div style="max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:10px"><img src="${u}" style="display:block;max-width:none;width:100%"></div><div class="mfoot"><button class="btn" onclick="cerrarM()">Cerrar</button><a class="btn primary" href="${u}" download="${esc(titulo).replace(/[^\w\-]+/g, '_')}.png">⬇ Descargar</a></div></div>`; $('modal').hidden = false; $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
}
const tpng = id => capturaDescargar($(id + '-w'), TB[id].titulo, subFiltros(), TB[id].file);
const tpngCopiar = id => capturaCopiar($(id + '-w'), TB[id].titulo, subFiltros());
const subFiltros = () => { const f = Object.entries(FL).filter(([, v]) => v).map(([k, v]) => v).join(' · '); return f || 'Todas las zonas'; };

/* ---------- filtros de estructura (compartidos por todas las secciones) ---------- */
const FL = { region: '', gerente: '', supervisor: '', zona_rrhh: '', rrhh: '', cadena: '' };
let FB_OPEN = false; // panel de filtros abierto en celular (sobrevive a los re-render de cada vista)
const FCAMPOS = [['region', 'Región'], ['gerente', 'Gerente / Líder'], ['supervisor', 'Supervisor'], ['zona_rrhh', 'Gerencia RR.HH.'], ['rrhh', 'RR.HH.'], ['cadena', 'Cadena']];
const okT = t => t ? Object.entries(FL).every(([k, v]) => !v || t[k] === v) : !Object.values(FL).some(Boolean);
const okI = id => okT(tienda(id));
function barraFiltros(fn, base, campos) {
  base = base || Object.values(S.cat.tiendas); campos = campos || FCAMPOS.map(c => c[0]);
  const sel = FCAMPOS.filter(c => campos.includes(c[0])).map(([k, l]) => {
    const ops = [...new Set(base.filter(t => Object.entries(FL).every(([kk, v]) => kk === k || !v || t[kk] === v)).map(t => t[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    return `<div class="fb-field ${FL[k] ? 'on' : ''}"><label>${l}</label><select aria-label="${esc(l)}" onchange="FL['${k}']=this.value;${fn}()"><option value="">Todos</option>${ops.map(o => `<option ${FL[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }).join('');
  const nAct = FCAMPOS.filter(c => campos.includes(c[0]) && FL[c[0]]).length;
  const tg = `<button type="button" class="btn sm fb-toggle" data-nocap aria-expanded="${FB_OPEN}" onclick="FB_OPEN=!FB_OPEN;this.setAttribute('aria-expanded',FB_OPEN);this.nextElementSibling.classList.toggle('open',FB_OPEN);this.querySelector('b').textContent=FB_OPEN?'Ocultar filtros':'Filtros'">🔎 <b>${FB_OPEN ? 'Ocultar filtros' : 'Filtros'}</b>${nAct ? `<span class="fb-n">${nAct}</span>` : ''}</button>`;
  return `${tg}<div class="fbar${FB_OPEN ? ' open' : ''}" data-nocap>${sel}<button class="btn sm" onclick="Object.keys(FL).forEach(k=>FL[k]='');${fn}()">✕ Quitar filtros</button></div>`;
}

/* ---------- periodo: semana · mes · rango (como Avance GB) ---------- */
const PER = { modo: 'semana', sem: null, mes: null, desde: null, hasta: null };
function ventana() { return R.meta.ventana; }
function limites() { const max = R.meta.hoy || R.meta.ultima_fecha || HOY, d = new Date(max.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 2); const m3 = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01'; return { min: R.meta.cd_desde > m3 ? R.meta.cd_desde : m3, max, mes3: m3 }; }
function rangoSemanaDe(i) { const w = ventana()[i], L = limites(); const fin = [addD(w.ini, 6), L.max].reduce((a, b) => a < b ? a : b); return { desde: w.ini, hasta: fin }; }
function perRango() {
  const L = limites(), W = ventana(); let d, h;
  if (PER.modo === 'semana') { if (PER.sem == null) PER.sem = W.length - 1; ({ desde: d, hasta: h } = rangoSemanaDe(PER.sem)); }
  else if (PER.modo === 'mes') { const m = PER.mes || L.max.slice(0, 7); d = m + '-01'; const nx = new Date(m + '-01T12:00:00'); nx.setMonth(nx.getMonth() + 1); nx.setDate(0); h = nx.getFullYear() + '-' + pad(nx.getMonth() + 1) + '-' + pad(nx.getDate()); }
  else if (PER.modo === 'dia') { d = h = PER.desde || L.max; }
  else if (PER.modo === 'hoy') { d = h = L.max; }
  else if (PER.modo === 'todo') { d = L.min; h = L.max; }
  else { d = PER.desde || addD(L.max, -6); h = PER.hasta || L.max; }
  if (d < L.min) d = L.min; if (h > L.max) h = L.max; if (h < d) h = d;
  const dias = []; for (let x = d; x <= h; x = addD(x, 1)) dias.push(x);
  return { desde: d, hasta: h, dias };
}
function semanasUlt4(r) { // las 4 últimas semanas (lun-dom) contra las que se compara el periodo filtrado
  const W = ventana(); let i = W.findIndex(w => addD(w.ini, 6) >= r.hasta && w.ini <= r.hasta); if (i < 0) i = W.length - 1;
  const out = []; for (let k = Math.max(0, i - 3); k <= i; k++) { const s = rangoSemanaDe(k); const dias = []; for (let x = s.desde; x <= s.hasta; x = addD(x, 1)) dias.push(x); out.push({ i: k, w: W[k].w, ...s, dias }); }
  return out;
}
function meses3() { const L = limites(), out = []; let m = L.max.slice(0, 7); for (let k = 0; k < 3; k++) { out.unshift(m); const x = new Date(m + '-01T12:00:00'); x.setMonth(x.getMonth() - 1); m = x.getFullYear() + '-' + pad(x.getMonth() + 1); } return out; }
function barraPeriodo(fn, opts = {}) {
  const W = ventana(), L = limites(), r = perRango(), modos = [['hoy', '☀️ Hoy'], ['semana', '📅 Semana'], ['mes', '🗓️ Mes'], ['rango', '↔️ Rango'], ['todo', '📊 Todo'], ...(opts.dia ? [['dia', '🗓️ Día']] : [])];
  let ctl = '';
  if (PER.modo === 'semana') ctl = `<select onchange="PER.sem=+this.value;${fn}()">${W.map((w, k) => ({ w, k })).filter(({ w }) => addD(w.ini, 6) >= L.min).map(({ w, k }) => `<option value="${k}" ${k === PER.sem ? 'selected' : ''}>${w.w} · ${fdate(w.ini)}${k === W.length - 1 ? ' (en curso)' : ''}</option>`).join('')}</select>`;
  else if (PER.modo === 'mes') ctl = `<select onchange="PER.mes=this.value;${fn}()">${meses3().map(m => `<option value="${m}" ${(PER.mes || L.max.slice(0, 7)) === m ? 'selected' : ''}>${mlabel(m)}${m === L.max.slice(0, 7) ? ' (en curso)' : ''}</option>`).join('')}</select>`;
  else if (PER.modo === 'dia') ctl = `<input type="date" min="${L.min}" max="${L.max}" value="${r.desde}" onchange="PER.desde=this.value;${fn}()">`;
  else if (PER.modo === 'hoy' || PER.modo === 'todo') ctl = '';
  else ctl = `<input type="date" min="${L.min}" max="${L.max}" value="${r.desde}" onchange="PER.desde=this.value;${fn}()"> <span>a</span> <input type="date" min="${L.min}" max="${L.max}" value="${r.hasta}" onchange="PER.hasta=this.value;${fn}()">`;
  return `<div class="pbar" data-nocap><div class="seg">${modos.map(([k, n]) => `<button class="${PER.modo === k ? 'on' : ''}" onclick="PER.modo='${k}';${k === 'dia' ? "PER.desde=PER.desde||'" + L.max + "';" : ''}${fn}()">${n}</button>`).join('')}</div>${ctl}<span class="muted">${r.dias.length} día${r.dias.length > 1 ? 's' : ''} · ${fdate(r.desde)} al ${fdate(r.hasta)} (últimos 3 meses disponibles)</span></div>`;
}

/* ---------- tabla expandible tipo Excel (tabla dinámica): región > gerente > supervisor > tienda, con columnas numéricas ---------- */
let ARN = 0;
function arRef(t) { const st = []; t.querySelectorAll('tbody tr[data-l]').forEach(tr => { const l = +tr.dataset.l, v = l === 0 || st[l - 1]; tr.style.display = v ? '' : 'none'; st[l] = v && tr.classList.contains('open'); }); }
function arTog(tr) { tr.classList.toggle('open'); arRef(tr.closest('table')); }
function arNivel(id, n) { const t = $(id); t.querySelectorAll('tbody tr[data-l]').forEach(tr => { if (tr.dataset.k === 'n') tr.classList.toggle('open', +tr.dataset.l < n); }); arRef(t); }
function arbol(items, cols, o = {}) {
  const T = x => tienda(x.idpdv) || {}, N = cols.length, id = 'ar' + (++ARN), niv = [['region', 'Sin región', '🗺️'], ['gerente', 'Sin gerente', '👔'], ['supervisor', 'Sin supervisor', '🧑‍💼']];
  const val = (v, c) => v === 0 && c.cero !== true ? '' : (c.fmt ? c.fmt(v) : fmt(v));
  const celdas = (arr, tot) => cols.map(c => { const v = c.f(arr); return `<td class="${tot ? '' : (c.cls === 'g' ? 'cg' : c.cls === 'r' ? 'cr' : '')}${v === 0 && !tot ? ' z' : ''}">${val(v, c)}</td>`; }).join('');
  const orden = (a, b) => cols[N - 1].f(b[1]) - cols[N - 1].f(a[1]);
  function nodo(arr, nivel) {
    if (nivel >= niv.length) { const g = new Map(); arr.forEach(x => { const k = T(x).nombre || ('IDPDV ' + x.idpdv); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }); return [...g].sort(orden).map(([k, v]) => `<tr data-l="3" class="lf"><td class="t">${esc(k)}</td>${celdas(v)}</tr>`).join(''); }
    const [campo, vacio, ic] = niv[nivel], g = new Map(); arr.forEach(x => { const k = T(x)[campo] || vacio; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
    return [...g].sort(orden).map(([k, v]) => `<tr data-l="${nivel}" data-k="n" class="n l${nivel}${nivel < (o.abrir == null ? 1 : o.abrir) ? ' open' : ''}" onclick="arTog(this)"><td class="t"><i class="ar-c"></i>${ic} ${esc(k)}</td>${celdas(v)}</tr>` + nodo(v, nivel + 1)).join('');
  }
  const ctl = `<div class="tools" data-nocap><span class="muted">Toca ⊞ para abrir cada nivel</span><button class="btn sm" onclick="arNivel('${id}',0)">Contraer todo</button><button class="btn sm" onclick="arNivel('${id}',1)">Regiones</button><button class="btn sm" onclick="arNivel('${id}',2)">+ Gerentes</button><button class="btn sm" onclick="arNivel('${id}',3)">+ Supervisores</button><button class="btn sm" onclick="arNivel('${id}',4)">Todo abierto</button></div>`;
  const cab = `<thead><tr><th class="t">${esc(o.titulo || 'REGIÓN / GERENTE / SUPERVISOR / TIENDA')}</th>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead>`;
  const tot = `<tr class="tt"><td class="t">Total general</td>${cols.map(c => `<td>${val(c.f(items), { ...c, cero: true })}</td>`).join('')}</tr>`;
  const body = items.length ? nodo(items, 0) : `<tr><td class="t" colspan="${N + 1}">Sin datos</td></tr>`;
  setTimeout(() => { const t = $(id); if (t) arRef(t); }, 0);
  return `${o.sinCtl ? '' : ctl}<div class="tw xlw"><table class="xl" id="${id}">${cab}<tbody>${body}${tot}</tbody></table></div>`;
}

/* >>> 03_reportes.js */
/* ====================================================================== REPORTES: RESUMEN · PENALIZACIÓN · DETALLE DE CHECKS · HC ====================================================================== */
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const EST_COB = ['Cubierta', 'Descubierta', 'Vacante'], COBC = [C.gr, C.am, C.rd];
const EST_PEN = ['Cubierto', 'Riesgo Penalización', 'Penalizado'];
const LOGO = { Coppel: 'logo_coppel_clean', Elektra: 'logo_elektra_clean', Suburbia: 'logo_suburbia_clean', Cimaco: 'logo_cimaco_clean' };
const logoCad = c => LOGO[c] ? `<img class="cadena-logo" src="${img(LOGO[c])}" alt="${esc(c)}">` : `<b style="min-width:70px;font-size:12px">${esc(c)}</b>`;

/* ----- carga ----- */
const R = { loaded: false, T: [], hc: [], uc: {}, bajasLive: new Map(), solo: true, rach: 'todas', est: '', estA: '', estC: '', cadenaPen: true };
Real.reporte = async function () {
  const [m, t, h, u, bj] = await Promise.all([sb.from('rep_meta').select('valor').eq('clave', 'ventana').maybeSingle(), todo(() => sb.from('rep_tienda').select('*')), todo(() => sb.from('rep_hc').select('*')), todo(() => sb.from('rep_ultimo_check').select('*')),
    todo(() => sb.from('bajas').select('usuario_fieldwy,fecha_baja').gte('fecha_baja', addD(HOY, -200)))]);
  if (!m.data) throw new Error('Todavía no hay reportes publicados. Corre publicar_reporte.py.');
  return { meta: m.data.valor, tiendas: t, hc: h, uc: u, bajas: bj };
};
const CHK_COLS = '*';
Real.checks = function (desde, hasta) { return todo(() => sb.from('rep_checks').select(CHK_COLS).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora_in')); };
async function cargarReporte() {
  if (R.loaded) return;
  const d = await API.reporte();
  R.meta = d.meta; R.hc = d.hc; R.uc = Object.fromEntries(d.uc.map(x => [x.usuario, x])); R.bajasLive = new Map(d.bajas.map(b => [b.usuario_fieldwy, b.fecha_baja]));
  R.T = d.tiendas.map(r => ({ id: r.idpdv, t: tienda(r.idpdv) || { nombre: 'IDPDV ' + r.idpdv, cadena: '', estado: '', region: '', gerente: '', supervisor: '', rrhh: '', zona_rrhh: '', posiciones: 0 }, sem: r.semanas || [], chk: (r.chk && r.chk.s) || [], cd: (r.chk && r.chk.cd) || '', dias: r.dias || '', hc: r.hc_sem || [], pen: r.pen || [] }));
  R.loaded = true;
}
const cargando = (t, m) => { $('content').innerHTML = cab(t, 'Cargando…', m); };
async function conReporte(titulo, mascota, fn) {
  try { cargando(titulo, mascota); await cargarReporte(); await fn(); } catch (e) { console.error(e); $('content').innerHTML = cab(titulo, '', mascota) + `<div class="card empty"><img src="${img('guino')}" alt="">${esc(e.message || e)}</div>`; }
}
const xsF = () => R.T.filter(x => okT(x.t));

/* ----- movimientos (ingresos reales por candidatos + bajas) para rotación ----- */
const MV = { loaded: false, ing: [], baj: [] };
Real.movs = async function () {
  const desde = addD(HOY, -125);
  const [i, b] = await Promise.all([todo(() => sb.from('candidatos').select('id,fecha_programada,idpdv,reclutador_id,fuente_id').eq('estatus', 'Ingresó').gte('fecha_programada', desde)), todo(() => sb.from('bajas').select('usuario_fieldwy,fecha_baja,idpdv,motivo').gte('fecha_baja', desde))]);
  return { ing: i.map(x => ({ f: x.fecha_programada, idpdv: x.idpdv, rec: x.reclutador_id, fu: x.fuente_id })), baj: b.map(x => ({ f: x.fecha_baja, idpdv: x.idpdv, mot: x.motivo, u: x.usuario_fieldwy })) };
};
async function cargarMovs(force) { if (MV.loaded && !force) return; const d = await API.movs(); MV.ing = d.ing; MV.baj = d.baj; MV.loaded = true; }
function hcProm(r) { // promedio de promotores con check por semana dentro del periodo (estructura filtrada)
  const sa = R.meta.semanas_anio, xs = xsF(); let tot = [], n = 0;
  sa.forEach((s, i) => { const fin = addD(s.ini, 6); if (fin < r.desde || s.ini > r.hasta) return; tot.push(xs.reduce((a, x) => a + (x.hc[i] || 0), 0)); });
  return tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : 0;
}
function hcPromX(r, pred) {
  const sa = R.meta.semanas_anio, xs = R.T.filter(x => okT(x.t) && pred(x.t)), tot = [];
  sa.forEach((s, i) => { const fin = addD(s.ini, 6); if (fin < r.desde || s.ini > r.hasta) return; tot.push(xs.reduce((a, x) => a + (x.hc[i] || 0), 0)); });
  return tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : 0;
}
function rotPeriodo(r) {
  const ing = MV.ing.filter(x => x.f >= r.desde && x.f <= r.hasta && okI(x.idpdv)).length, baj = MV.baj.filter(x => x.f >= r.desde && x.f <= r.hasta && okI(x.idpdv)).length, hc = hcProm(r);
  return { ing, baj, hc, rot: hc ? baj / hc * 100 : null };
}

/* ----- medidas de cobertura (misma lógica de Avance GB / medidas DAX) ----- */
const posc = t => t.posiciones || 1;
const dimPdv = ts => ts.reduce((a, t) => a + (posc(t) === 1 ? 6 / 7 : 1), 0);
const dimProm = ts => ts.reduce((a, t) => a + posc(t) * 6 / 7, 0);
const cdv = (x, d) => { const k = diffD(d, R.meta.cd_desde); const ch = x.cd[k]; return ch == null ? 0 : parseInt(ch, 36); };
function medidas(xs, dias) {
  const ts = xs.filter(x => (x.t.posiciones || 0) > 0), T = ts.map(z => z.t), nD = Math.max(1, dias.length);
  let cubSum = 0, chk = 0; ts.forEach(x => dias.forEach(d => { const c = cdv(x, d); if (c > 0) cubSum++; chk += c; }));
  const dP = dimPdv(T), dM = dimProm(T), pP = cubSum / nD, pM = chk / nD, cuota = T.reduce((a, t) => a + 6 * posc(t), 0) * nD / 7;
  return { n: ts.length, posc: T.reduce((a, t) => a + posc(t), 0), dP, pP, pctP: dP ? Math.min(pP / dP * 100, 100) : null, difP: pP - dP, dM, pM, pctM: dM ? Math.min(pM / dM * 100, 100) : null, difM: pM - dM, chk, nD, cuota, pctC: cuota ? Math.min(chk / cuota * 100, 100) : null, exc: Math.max(0, chk - cuota) };
}
function medTienda(x, dias, last) {
  const ps = posc(x.t), nD = Math.max(1, dias.length); let dc = 0, chk = 0; dias.forEach(d => { const c = cdv(x, d); if (c > 0) dc++; chk += c; });
  const cuota = 6 * ps * nD / 7, dimC = ps === 1 ? 6 / 7 : 1, dimA = ps * 6 / 7, promC = dc / nD, promA = chk / nD;
  let ult = null; const fin = diffD(dias[dias.length - 1], R.meta.cd_desde); for (let k = Math.min(fin, x.cd.length - 1); k >= 0; k--) if (x.cd[k] !== '0') { ult = addD(R.meta.cd_desde, k); break; }
  return { ps, chk, cuota, pctCh: Math.min(chk / cuota * 100, 100), falt: Math.max(0, cuota - chk), adic: Math.max(0, chk - cuota), dimA, promA, pctA: Math.min(promA / dimA * 100, 100), difA: promA - dimA, dimC, promC, pctC: Math.min(promC / dimC * 100, 100), difC: promC - dimC, ult };
}
function estatusTienda(x, dias) {
  const last2 = dias.slice(-2).reverse(), ps = posc(x.t), r = last2.length ? cdv(x, last2[0]) : 0, a = last2.length > 1 ? cdv(x, last2[1]) : null; let cob;
  if (a == null) cob = r > 0 ? 'Cubierta' : 'Descubierta'; else cob = r > 0 && a > 0 ? 'Cubierta' : r === 0 && a === 0 ? 'Vacante' : 'Descubierta';
  const A = a || 0; let asi;
  if (ps <= 1) asi = cob; else if (a == null) asi = r >= ps ? 'Cubierta' : r > 0 ? 'Posc Desc' : 'Descubierta';
  else if (r > ps && A > ps) asi = 'Posc Adic'; else if (r >= ps && A >= ps) asi = 'Cubierta'; else if (r === 0 && A === 0) asi = 'Vacante';
  else if (r < ps && r > 0 && A < ps && A > 0) asi = 'Posc Faltante'; else if ((r < ps && r > 0) || (A < ps && A > 0)) asi = 'Posc Desc'; else if (r === 0 || A === 0) asi = 'Descubierta'; else asi = 'Sin Definir';
  return { cob, asi };
}
const ASIC = { 'Cubierta': 'g', 'Posc Adic': 'g', 'Posc Desc': 'a', 'Descubierta': 'a', 'Posc Faltante': 'r', 'Vacante': 'r', 'Sin Definir': 'x' };
const ASIE = { 'Cubierta': '🟢', 'Posc Adic': '🔵', 'Posc Desc': '🟠', 'Descubierta': '🟠', 'Posc Faltante': '🔴', 'Vacante': '🔴', 'Sin Definir': '⚪' };
const colPct = p => p == null ? '' : p >= 90 ? 'ok' : p >= 75 ? 'wa' : 'ko';

/* ====================================================================== 1 · RESUMEN ====================================================================== */
async function vResumen() {
  await conReporte('Resumen', 'pulgares', async () => {
    await cargarMovs();
    const r = perRango(), dias = r.dias, xs = xsF(), cur = medidas(xs, dias), sems = semanasUlt4(r), S4 = sems.map(w => medidas(xs, w.dias)), prev = S4.length > 1 ? S4[S4.length - 2] : null;
    const rot = rotPeriodo(r);
    let h = cab('Resumen', 'Cobertura de PDV, asistencia de promotores y checks contra cuota (misma lógica de Avance GB), más rotación del periodo. Todo responde a los filtros de estructura y al periodo elegido.', 'pulgares') + barraFiltros('vResumen') + barraPeriodo('vResumen');
    h += `<div class="kpis kp-hero">${kp('% Cobertura PDV', cur.pctP == null ? '—' : f1(cur.pctP) + '%', `${fmt1(cur.pP)} tiendas/día vs ${fmt1(cur.dP)} dimensionadas<br>${dl(cur.pctP, prev && prev.pctP)}`, colorPct(cur.pctP), null, '🏬')}
      ${kp('% Asistencia Promotor', cur.pctM == null ? '—' : f1(cur.pctM) + '%', `${fmt1(cur.pM)} promotores/día vs ${fmt1(cur.dM)} dimensionados<br>${dl(cur.pctM, prev && prev.pctM)}`, colorPct(cur.pctM), null, '🧍')}
      ${kp('% Checks vs cuota', cur.pctC == null ? '—' : f1(cur.pctC) + '%', `${fmt(cur.chk)} checks vs cuota ${fmt(cur.cuota)} (6 por posición por semana)<br>${dl(cur.pctC, prev && prev.pctC)}`, colorPct(cur.pctC), null, '✅')}
      ${kp('Rotación del periodo', rot.rot == null ? '—' : f1(rot.rot) + '%', `${rot.baj} bajas ÷ ${fmt(rot.hc)} HC promedio<br>${rot.ing} ingresos · neto ${rot.ing - rot.baj >= 0 ? '+' : ''}${rot.ing - rot.baj}`, C.am, null, '🔄')}</div>`;
    h += `<div class="grid g3">${embudo('🏬 Cobertura PDV', [{ n: "Total PDV's", v: cur.n, c: C.bl }, { n: 'Dimensionamiento', v: cur.dP, c: '#3D6FB6' }, { n: 'Cubiertos (prom. diario)', v: cur.pP, c: C.gr }, { n: 'Descubiertos', v: Math.max(0, -cur.difP), c: C.rd }])}
      ${embudo('🧍 Asistencia Promotor', [{ n: 'Posiciones autorizadas', v: cur.posc, c: C.bl }, { n: 'Dimensionamiento', v: cur.dM, c: '#3D6FB6' }, { n: 'Asistieron (prom. diario)', v: cur.pM, c: C.gr }, { n: 'Sin asistir', v: Math.max(0, -cur.difM), c: C.rd }])}
      ${embudo('✅ Checks vs cuota', [{ n: 'Cuota de checks (periodo)', v: cur.cuota, c: C.bl }, { n: 'Checks válidos', v: cur.chk, c: C.gr }, { n: 'Faltantes', v: Math.max(0, cur.cuota - cur.chk), c: C.rd }, { n: 'Adicionales', v: cur.exc, c: C.am }])}</div>`;
    const cads = [...new Set(xs.map(x => x.t.cadena).filter(Boolean))];
    const cadRows = cads.map(c => { const m = medidas(xs.filter(y => y.t.cadena === c), dias); return { c, n: m.n, p: m.pctP, a: m.pctM }; }).filter(q => q.n).sort((a, b) => b.n - a.n);
    const st = xs.filter(x => (x.t.posiciones || 0) > 0).map(x => ({ x, s: estatusTienda(x, dias) })), ce = { Cubierta: 0, Descubierta: 0, Vacante: 0 }; st.forEach(z => ce[z.s.cob]++);
    h += `<div class="grid g2"><div class="card"><h3>🏪 Cobertura por cadena</h3><p class="note">% Cobertura PDV (barra) y % Asistencia Promotor.</p>${cadRows.map(q => `<div class="cadena-row">${logoCad(q.c)}<div class="cadena-track"><i style="width:${q.p || 0}%;background:${colorPct(q.p)}"></i></div><b class="cadena-val" style="color:${colorPct(q.p)}">${f1(q.p)}%</b><span class="muted" style="min-width:96px;text-align:right">asist. ${f1(q.a)}%</span></div>`).join('')}</div>
      <div class="card"><h3>🚦 Estatus de tiendas (últimos 2 días)</h3><p class="note">Cubierta: check los 2 días · Descubierta: falta 1 día · Vacante: 2 días sin check.</p>${donut(['Cubierta', 'Descubierta', 'Vacante'].map((n, k) => ({ n, v: ce[n], c: COBC[k] })), { sub: 'tiendas' })}</div></div>`;
    const labs = sems.map(w => w.w.slice(3));
    const est4 = sems.map(w => { const e = { Cubierta: 0, Descubierta: 0, Vacante: 0 }; xs.filter(x => (x.t.posiciones || 0) > 0).forEach(x => e[estatusTienda(x, w.dias).cob]++); return e; });
    const rotS = sems.map(w => { const hcS = hcPromX({ desde: w.desde, hasta: w.hasta }, () => true); const b = MV.baj.filter(x => x.f >= w.desde && x.f <= w.hasta && okI(x.idpdv)).length; return hcS ? b / hcS * 100 : null; });
    h += `<div class="grid g2"><div class="card"><h3>📈 Tiendas cubiertas, descubiertas y vacantes · últimas 4 semanas</h3><p class="note">Estatus de cada tienda al cierre de la semana (últimos 2 días con datos). La línea es el % de tiendas cubiertas.</p>${legend([['Cubiertas', C.gr], ['Descubiertas', C.am], ['Vacantes', C.rd], ['% cubiertas', C.dk]])}${chart(labs, [{ n: 'Cubiertas', c: C.gr, v: est4.map(e => e.Cubierta) }, { n: 'Descubiertas', c: C.am, v: est4.map(e => e.Descubierta) }, { n: 'Vacantes', c: C.rd, v: est4.map(e => e.Vacante) }], { bars: 1, stack: 1, vals: 1, h: 320, band: 1, lines2: [{ n: '% cubiertas', c: C.dk, v: est4.map(e => pn(e.Cubierta, e.Cubierta + e.Descubierta + e.Vacante)) }], y2: { pct: 1 } })}</div>
      <div class="card"><h3>🔄 Ingresos, bajas y rotación · últimas 4 semanas</h3><p class="note">Rotación del periodo: <b>${rot.rot == null ? '—' : f1(rot.rot) + '%'}</b> (${rot.baj} bajas ÷ ${fmt(rot.hc)} HC promedio). Línea: rotación semanal con su tendencia.</p>${legend([['Ingresos', C.gr], ['Bajas', C.rd], ['Rotación %', C.od], ['Tendencia', C.dk]])}${chart(labs, [{ n: 'Ingresos', c: C.gr, v: sems.map(w => MV.ing.filter(x => x.f >= w.desde && x.f <= w.hasta && okI(x.idpdv)).length) }, { n: 'Bajas', c: C.rd, v: sems.map(w => MV.baj.filter(x => x.f >= w.desde && x.f <= w.hasta && okI(x.idpdv)).length) }], { bars: 1, vals: 1, h: 320, band: 1, lines2: [{ n: 'Rotación %', c: C.od, v: rotS, trend: 1 }], y2: { pct: 1 } })}</div></div>`;
    h += sect('Tiendas: medición de checks, asistencia y cobertura', '🧾') + `<p class="note">Periodo ${fdate(r.desde)} – ${fdate(r.hasta)}. Mueve la tabla a los lados o hacia abajo: encabezados e IDPDV/tienda se quedan fijos.</p>`;
    h += `<div class="tools" data-nocap><span>Estatus cobertura:</span><select onchange="R.estC=this.value;vResumen()"><option value="">Todos</option>${['Cubierta', 'Descubierta', 'Vacante'].map(e => `<option ${R.estC === e ? 'selected' : ''}>${e} (${ce[e]})</option>`).join('')}</select><span>Estatus asistencia:</span><select onchange="R.estA=this.value;vResumen()"><option value="">Todos</option>${['Cubierta', 'Posc Adic', 'Posc Desc', 'Descubierta', 'Posc Faltante', 'Vacante'].map(e => `<option ${R.estA === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>`;
    const rows = st.filter(z => (!R.estC || R.estC.startsWith(z.s.cob + ' (') || R.estC === z.s.cob) && (!R.estA || R.estA === z.s.asi)).map(({ x, s }) => ({ ...x, s, m: medTienda(x, dias), pe: penActual(x) }));
    TB = {};
    const cs = [{ h: 'IDPDV', v: q => q.id, w: 86 }, { h: 'Nombre PDV', t: 1, v: q => q.t.nombre, w: 230, r: q => `<b>${esc(q.t.nombre)}</b>` },
      { h: 'Cadena', t: 1, v: q => q.t.cadena, r: q => `${esc(q.t.cadena)}` }, { h: 'Estado', t: 1, v: q => q.t.estado }, { h: 'Supervisor', t: 1, v: q => q.t.supervisor }, { h: 'Gerente / Líder', t: 1, v: q => q.t.gerente }, { h: 'Posc.', v: q => q.m.ps },
      { h: 'Checks válidos', v: q => q.m.chk, hc: 'hy' }, { h: 'Cuota checks', v: q => q.m.cuota, r: q => fmt1(q.m.cuota), hc: 'hy' }, { h: '% Cobertura checks', v: q => q.m.pctCh, r: q => `<span class="bar-pct ${colPct(q.m.pctCh)}">${f1(q.m.pctCh)}%</span>`, hc: 'hy' }, { h: 'Checks faltantes', v: q => q.m.falt, r: q => q.m.falt ? `<span class="cell-red">${fmt1(q.m.falt)}</span>` : '0', hc: 'hy' }, { h: 'Checks adicionales', v: q => q.m.adic, r: q => q.m.adic ? `<span class="cell-green">+${fmt1(q.m.adic)}</span>` : '0', hc: 'hy' },
      { h: 'Dimens. promotor', v: q => q.m.dimA, r: q => f1(q.m.dimA), hc: 'hg' }, { h: 'Prom. promotor/día', v: q => q.m.promA, r: q => f1(q.m.promA), hc: 'hg' }, { h: '% Asistencia', v: q => q.m.pctA, r: q => `<span class="bar-pct ${colPct(q.m.pctA)}">${f1(q.m.pctA)}%</span>`, hc: 'hg' }, { h: 'Dif. asistencia', v: q => q.m.difA, r: q => `<span class="${q.m.difA < -0.05 ? 'cell-red' : 'cell-green'}">${q.m.difA > 0 ? '+' : ''}${f1(q.m.difA)}</span>`, hc: 'hg' },
      { h: 'Dimens. PDV', v: q => q.m.dimC, r: q => f1(q.m.dimC), hc: 'hd' }, { h: 'Prom. cobertura/día', v: q => q.m.promC, r: q => f1(q.m.promC), hc: 'hd' }, { h: '% Cobertura real', v: q => q.m.pctC, r: q => `<span class="bar-pct ${colPct(q.m.pctC)}">${f1(q.m.pctC)}%</span>`, hc: 'hd' }, { h: 'Dif. cobertura', v: q => q.m.difC, r: q => `<span class="${q.m.difC < -0.05 ? 'cell-red' : 'cell-green'}">${q.m.difC > 0 ? '+' : ''}${f1(q.m.difC)}</span>`, hc: 'hd' },
      { h: 'Último check', v: q => q.m.ult, r: q => q.m.ult ? `${fdate(q.m.ult)}${diffD(r.hasta, q.m.ult) >= 2 ? ' <span title="2 o más días sin check">⚠️</span>' : ''}` : '—', hc: 'ho' },
      { h: 'Estatus cobertura', t: 1, v: q => q.s.cob, r: q => pillx((q.s.cob === 'Cubierta' ? '🟢 ' : q.s.cob === 'Vacante' ? '🔴 ' : '🟠 ') + q.s.cob, q.s.cob === 'Cubierta' ? 'g' : q.s.cob === 'Vacante' ? 'r' : 'a'), hc: 'hp' },
      { h: 'Estatus asistencia', t: 1, v: q => q.s.asi, r: q => pillx((ASIE[q.s.asi] || '') + ' ' + q.s.asi, ASIC[q.s.asi] || 'x'), hc: 'hp' }, { h: 'Región', t: 1, v: q => q.t.region }, { h: 'Gerencia RR.HH.', t: 1, v: q => q.t.zona_rrhh }, { h: 'RR.HH.', t: 1, v: q => q.t.rrhh }];
    const grp = [{ t: '🏪 Tienda', span: 2, cls: 'gt' }, { t: 'Estructura', span: 5, cls: 'gt' }, { t: '✅ Medición de checks', span: 5, cls: 'gy' }, { t: '🧍 Medición de asistencia promotoría', span: 4, cls: 'gg' }, { t: '🏬 Medición de cobertura', span: 4, cls: 'gd' }, { t: '📅 Último día check', span: 1, cls: 'go' }, { t: '🚦 Estatus', span: 2, cls: 'gp' }, { t: 'Estructura', span: 3, cls: 'gt' }];
    h += tbl('t-tiendas', cs, rows, { fix: 2, groups: grp, search: 1, csv: 1, png: 1, file: 'resumen_tiendas', titulo: 'Resumen de tiendas · cobertura, asistencia y checks', sort: 18, dir: 1, maxh: '72vh', lim: 600 });
    $('content').innerHTML = h; drawAll();
  });
}
const colorPct = p => p == null ? C.gy : p >= 90 ? C.gr : p >= 75 ? C.am : C.rd;

/* ====================================================================== 2 · PENALIZACIÓN ====================================================================== */
const penActual = x => (x.pen || []).find(p => p.act) || (x.pen || []).slice(-1)[0] || null;
/* Racha = días seguidos sin cobertura DENTRO del mes. Hoy todavía se puede salvar: el día en juego (hoy) no cuenta como perdido hasta que pasa.
   Día 3 / 4 / 5 = el día de la racha en el que estamos hoy (racha confirmada hasta ayer + hoy). Penalizada = 5 o más días ya perdidos (sin contar hoy). */
const HOYE = { 'C': '✅ Check cumple', 'A': '🔵 Check abierto', 'E': '🟠 Check con error', '0': '🔴 Sin check' };
const periodoIni = (ini, fin) => `${fdate(ini)} al ${fdate(fin)}`;
function rachasConfirmadas(p, act) { // rachas del mes con sus días ya perdidos (sin contar hoy)
  return (p.rs || []).map(q => { const enCurso = act && q[2] >= HOY; const conf = q[0] - (enCurso ? 1 : 0); return { dias: conf, ini: q[1], fin: enCurso ? addD(HOY, -1) : q[2], enCurso }; }).filter(q => q.dias >= 1);
}
async function vPenal() {
  await conReporte('Penalización', 'puno', async () => {
    const meses = meses3(); if (!R.mes || !meses.includes(R.mes)) R.mes = meses[meses.length - 1];
    const act = R.mes === HOY.slice(0, 7), sel = R.T.filter(x => okT(x.t) && (!R.solo || x.t.cadena === 'Coppel'));
    const dePen = sel.map(x => ({ ...x, p: (x.pen || []).find(p => p.m === R.mes) })).filter(x => x.p);
    const enJuego = act ? dePen.filter(x => x.p.act && x.p.hoy !== 'C') : [];
    const c5 = enJuego.filter(x => x.p.ra === 4), c4 = enJuego.filter(x => x.p.ra === 3), c3 = enJuego.filter(x => x.p.ra === 2);
    const todasR = []; dePen.forEach(x => rachasConfirmadas(x.p, act).forEach(q => todasR.push({ ...x, ...q })));
    const rach3 = todasR.filter(q => q.dias >= 3).sort((a, b) => b.dias - a.dias), pen = todasR.filter(q => q.dias >= 5).sort((a, b) => b.dias - a.dias);
    const penT = new Set(pen.map(q => q.id)).size;
    let h = cab('Penalización por falta de cobertura', 'Una tienda se penaliza con 5 días seguidos sin cobertura dentro del mes. Cuenta como cobertura un check dentro de rango con 420 minutos en tienda (300 los domingos con horario diferenciado); el check de un supervisor también rompe la racha. El día 5 todavía se puede salvar si hoy se cubre.', 'puno') + barraFiltros('vPenal');
    h += `<div class="tools"><span>Mes:</span><select onchange="R.mes=this.value;vPenal()">${meses.map(m => `<option value="${m}" ${m === R.mes ? 'selected' : ''}>${mlabel(m)}${m === HOY.slice(0, 7) ? ' (en curso)' : ''}</option>`).join('')}</select><button class="chip ${R.solo ? 'on' : ''}" onclick="R.solo=!R.solo;vPenal()">⭐ Solo Coppel (prioridad)</button><span class="muted">${fmt(dePen.length)} tiendas en el mes</span></div>`;
    h += `<div class="kpis">${act ? kp('Día 5 · último día', fmt(c5.length), 'si hoy no se cubre, se penaliza', c5.length ? C.rd : C.gr, null, '🔴') + kp('Día 4', fmt(c4.length), 'enviar a cubrir hoy', c4.length ? C.am : C.gr, null, '🟡') + kp('Día 3', fmt(c3.length), 'programar cobertura', C.gr, null, '🟢') : ''}${kp('Penalizadas ' + mlabel(R.mes), fmt(penT), `${fmt(pen.length)} racha${pen.length === 1 ? '' : 's'} de 5 o más días`, penT ? C.rd : C.gr, null, '🚫')}${kp('Rachas de 3+ días', fmt(rach3.length), 'en el mes', C.am, null, '📜')}</div>`;
    h += `<div class="tools" data-nocap><button class="btn sm" onclick="capturaDescargar($('alertas-wrap'),'Alertas de cobertura · ${fdate(HOY)}',subFiltros(),'alertas_cobertura')">📸 Imagen de todas las alertas</button><button class="btn sm" onclick="capturaCopiar($('alertas-wrap'),'Alertas de cobertura · ${fdate(HOY)}',subFiltros())">📋 Copiar imagen</button><span class="muted">Cada día RH comparte esta imagen. Abre una tarjeta para ver sus tiendas; 📸 captura solo esa tarjeta.</span></div>`;
    h += `<div id="alertas-wrap" class="alertas2">`;
    if (act) h += tarjetaPen({ k: 'r', ic: '🔴', t: 'Día 5 · último día para salvar', sub: 'Hoy es el 5.º día sin cobertura: si no se cubre hoy, queda penalizada', rows: c5.map(x => ({ ...x, per: periodoIni(addD(HOY, -4), addD(HOY, -1)) })), racha: false, abrir: true }) +
      tarjetaPen({ k: 'a', ic: '🟡', t: 'Día 4', sub: 'Hoy es el 4.º día sin cobertura · enviar a cubrir hoy', rows: c4.map(x => ({ ...x, per: periodoIni(addD(HOY, -3), addD(HOY, -1)) })), racha: false }) +
      tarjetaPen({ k: 'g', ic: '🟢', t: 'Día 3', sub: 'Hoy es el 3.er día sin cobertura · todavía hay margen', rows: c3.map(x => ({ ...x, per: periodoIni(addD(HOY, -2), addD(HOY, -1)) })), racha: false });
    h += tarjetaPen({ k: 'neutro', ic: '📜', t: 'Mayores rachas del mes', sub: 'Rachas de 3 o más días consecutivos en el mes (cerradas o en curso)', rows: rach3.map(q => ({ ...q, per: periodoIni(q.ini, q.fin) + (q.enCurso ? ' · en curso' : '') })), racha: true }) +
      tarjetaPen({ k: 'r', ic: '🚫', t: 'Penalizadas', sub: 'Rachas que ya cumplieron 5 o más días sin cobertura', rows: pen.map(q => ({ ...q, per: periodoIni(q.ini, q.fin) + (q.enCurso ? ' · en curso' : '') })), racha: true }) + '</div>';
    $('content').innerHTML = h; drawAll();
  });
}
function tarjetaPen(o) {
  const lista = o.rows.slice().sort((a, b) => (b.t.cadena === 'Coppel') - (a.t.cadena === 'Coppel') || (b.dias || 0) - (a.dias || 0));
  const titulo = o.t.replace(/'/g, '');
  const body = lista.length ? `<div class="tw tw-in"><table class="dt st"><thead><tr><th class="fx" style="left:0;min-width:92px">IDPDV</th><th class="fx t" style="left:92px;min-width:250px">Tienda</th>${o.racha ? '<th>Racha</th>' : ''}<th class="t">Periodo sin checks</th>${o.racha ? '' : '<th class="t">Hoy</th>'}<th class="t">Región</th><th class="t">Gerente</th><th class="t">Supervisor</th></tr></thead><tbody>${lista.map(x => `<tr><td class="fx" style="left:0;min-width:92px"><b>${x.id}</b></td><td class="fx t" style="left:92px;min-width:250px;max-width:250px"><div class="cut" style="max-width:226px" title="${esc(x.t.nombre)}"><b>${esc(x.t.nombre)}</b></div><small class="muted">${esc(x.t.cadena)} · ${esc(x.t.estado)}</small></td>${o.racha ? `<td><span class="dchip ${x.dias >= 5 ? 'r' : x.dias >= 4 ? 'a' : 'g'}">${x.dias} d</span></td>` : ''}<td class="t">${x.per}</td>${o.racha ? '' : `<td class="t">${HOYE[x.p.hoy] || '—'}</td>`}<td class="t">${esc(x.t.region)}</td><td class="t">${esc(x.t.gerente)}</td><td class="t">${esc(x.t.supervisor)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-in">Sin tiendas en esta categoría 🎉</div>`;
  return `<details class="alc ${o.k}" ${o.abrir && lista.length ? 'open' : ''}><summary><span class="alc-n">${lista.length}</span><div><b>${o.ic} ${esc(o.t)}</b><small>${esc(o.sub)}</small></div><button class="btn sm cam" data-nocap onclick="event.preventDefault();event.stopPropagation();capturaDescargar(this.closest('details'),'${o.ic} ${titulo} · ${fdate(HOY)}',subFiltros(),'alerta_${o.k}')">📸</button><i>▾</i></summary><div class="alc-body">${body}</div></details>`;
}

/* ====================================================================== 3 · DETALLE DE CHECKS ====================================================================== */
const CKS = { cache: {}, vista: null, just: '', est: '', fin: '', jus: '' };
const ERRN = { 'Cumple': 'Cumple', 'Check In Fuera Ventana': 'Entrada fuera de horario', 'Check Out Fuera Ventana': 'Salida fuera de horario', 'Error Comida': 'Error de comida', 'Tiempo Incompleto': 'Tiempo incompleto', 'Check In Fuera Rango': 'Entrada fuera de rango', 'Check Out Fuera Rango': 'Salida fuera de rango', 'No Check Salida': 'Sin check de salida', 'Equipo Duplicado': 'Equipo duplicado', 'Abierto': 'Abierto (hoy)' };
const ERRI = { 'Cumple': '✅', 'Check In Fuera Ventana': '🕘', 'Check Out Fuera Ventana': '🕕', 'Error Comida': '🍽️', 'Tiempo Incompleto': '⏱️', 'Check In Fuera Rango': '📍', 'Check Out Fuera Rango': '📍', 'No Check Salida': '🚪', 'Equipo Duplicado': '📱', 'Abierto': '🟦' };
const OKF = ['Cumple', 'Cumple Productividad', 'Cumple Telefonica'];
const VALC = { 'Cumple': 'g', 'Cumple Productividad': 'b', 'Cumple Telefonica': 'b', 'No Cumple': 'r' };
const NOJUST = ['Check In Fuera Rango', 'Check Out Fuera Rango', 'Equipo Duplicado', 'No Check Salida'];   // la venta no los justifica (regla del modelo): hay que enviarlos a otra tienda o corregir
async function checksRango(d, h) { // se piden por semana (con reintentos) y se guardan en memoria
  const W = ventana(), blocks = W.filter(w => addD(w.ini, 6) >= d && w.ini <= h), out = [];
  for (const w of blocks) { if (!CKS.cache[w.ini]) CKS.cache[w.ini] = await API.checks(w.ini, addD(w.ini, 6)); out.push(...CKS.cache[w.ini]); }
  return out.filter(r => r.fecha >= d && r.fecha <= h);
}
const esErr = r => r.estatus_check !== 'Cumple' && r.estatus_check !== 'Abierto' && r.estatus_final !== 'Otro Check';
const justif = r => r.estatus_final === 'Cumple Productividad' || r.estatus_final === 'Cumple Telefonica';
function justTxt(r) { if (r.estatus_check === 'Cumple' || r.estatus_check === 'Abierto' || NOJUST.includes(r.estatus_check)) return 'No aplica'; return justif(r) ? 'Con venta' : 'Sin venta'; }
const JUSTP = { 'No aplica': ['x', '➖ No aplica'], 'Con venta': ['b', '💸 Con venta'], 'Sin venta': ['r', '🔴 Sin venta'] };
async function vChecks() {
  await conReporte('Detalle de checks', 'sim', async () => {
    const r = perRango(); $('content').innerHTML = cab('Detalle de checks', 'Cargando checks… (los periodos largos tardan unos segundos)', 'sim');
    const vistaSem = CKS.vista ? CKS.vista === 'sem' : r.dias.length > 14, ws4 = semanasUlt4(r), desdeCarga = vistaSem && ws4.length ? (ws4[0].desde < r.desde ? ws4[0].desde : r.desde) : r.desde;
    const todos = (await checksRango(desdeCarga, r.hasta)).filter(x => okI(x.idpdv)), rows = todos.filter(x => x.fecha >= r.desde && x.fecha <= r.hasta);
    const prim = rows.filter(x => x.estatus_final !== 'Otro Check' && x.estatus_check !== 'Abierto'), ok = prim.filter(x => OKF.includes(x.estatus_final));
    const prom = new Set(prim.map(x => x.usuario)).size, prod = prim.filter(x => x.estatus_final === 'Cumple Productividad').length, vtas = prim.reduce((a, x) => a + x.registros, 0);
    const errores = prim.filter(esErr), sinVta = errores.filter(x => justTxt(x) === 'Sin venta').length, conJ = errores.filter(x => justTxt(x) === 'Con venta').length, noAp = errores.filter(x => justTxt(x) === 'No aplica').length;
    const mix = {}; prim.forEach(x => mix[x.estatus_check] = (mix[x.estatus_check] || 0) + 1);
    let h = cab('Detalle de checks', 'Cada check de cada promotor con horarios, tiempos, rangos y resultado, y la venta registrada del día para confirmar la justificación por productividad.', 'sim') + barraFiltros('vChecks') + barraPeriodo('vChecks', { dia: true });
    h += `<div class="kpis">${kp('Checks evaluados', fmt(prim.length), 'uno por promotor y día', null, null, '🧾')}${kp('Promotores con check', fmt(prom), fdate(r.desde) + ' – ' + fdate(r.hasta), null, null, '🧍')}${kp('Cumplen (regla de pago)', pc1(ok.length, prim.length), fmt(ok.length) + ' checks', colorPct(pn(ok.length, prim.length)), null, '✅')}${kp('Con error', fmt(errores.length), `${fmt(conJ)} con venta · ${fmt(sinVta)} sin venta · ${fmt(noAp)} no justificables`, errores.length ? C.rd : C.gr, null, '⚠️')}${kp('Cumple por productividad', pc1(prod, prim.length), fmt(prod) + ' checks', C.pu, null, '💸')}${kp('Ventas registradas', fmt(vtas), 'en días con check', null, null, '🛒')}</div>`;
    // gráfica: promotores que checaron bien / mal
    const cuenta = x => ({ b: new Set(x.filter(y => OKF.includes(y.estatus_final)).map(y => y.usuario)).size, m: new Set(x.filter(y => !OKF.includes(y.estatus_final)).map(y => y.usuario)).size, n: x.length, c: x.filter(y => OKF.includes(y.estatus_final)).length });
    const base = x => x.estatus_final !== 'Otro Check' && x.estatus_check !== 'Abierto';
    let labs, g, tit;
    if (vistaSem) { labs = ws4.map(w => w.w.slice(3)); g = ws4.map(w => cuenta(todos.filter(y => y.fecha >= w.desde && y.fecha <= w.hasta && base(y)))); tit = 'Vista semanal · comparativo de las últimas 4 semanas'; }
    else { labs = r.dias.map(d => d.slice(8) + '/' + d.slice(5, 7)); g = r.dias.map(d => cuenta(prim.filter(y => y.fecha === d))); tit = 'Vista diaria'; }
    h += `<div class="grid g2"><div class="card"><div class="card-h"><h3>👥 Promotores que checaron bien y mal</h3><span class="seg sm" data-nocap><button class="${!vistaSem ? 'on' : ''}" onclick="CKS.vista='dia';vChecks()">Diaria</button><button class="${vistaSem ? 'on' : ''}" onclick="CKS.vista='sem';vChecks()">Semanal</button></span></div><p class="note">${tit}. Cantidad de promotores por resultado; la línea es el % de checks que cumplen, con su tendencia.</p>${legend([['Checaron bien', C.gr], ['Checaron mal', C.rd], ['% checks que cumplen', C.dk]])}${chart(labs, [{ n: 'Checaron bien', c: C.gr, v: g.map(q => q.b) }, { n: 'Checaron mal', c: C.rd, v: g.map(q => q.m) }], { bars: 1, stack: 1, vals: 1, h: 310, ticks: 16, lines2: [{ n: '% cumplen', c: C.dk, v: g.map(q => pn(q.c, q.n)), trend: 1 }], y2: { pct: 1, max: 100 } })}</div>
      <div class="card"><h3>🧩 Resultado del check</h3><p class="note">Antes de aplicar productividad o Telefónica.</p>${hbars(Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ n: (ERRI[k] || '') + ' ' + (ERRN[k] || k), v, c: k === 'Cumple' ? C.gr : NOJUST.includes(k) ? C.rd : C.am, s: pc1(v, prim.length) })), C.am)}</div></div>`;
    // errores a corregir
    const just = CKS.just, errF = errores.filter(x => !just || (just === 'con' ? justTxt(x) === 'Con venta' : justTxt(x) !== 'Con venta'));
    h += sect('Promotores con errores a corregir', '🛠️') + `<div class="tools" data-nocap>${[['', 'Todos los errores'], ['sin', '🔴 Sin justificación'], ['con', '🟢 Con justificación (venta)']].map(([k, n]) => `<button class="chip ${just === k ? 'on' : ''}" onclick="CKS.just='${k}';vChecks()">${n}</button>`).join('')}<span class="muted">${r.dias.length === 1 ? 'Día elegido: todos los promotores con error.' : 'Varios días: top 10 con más errores del periodo.'} Fuera de rango, equipo duplicado y sin check de salida no se justifican con venta.</span></div>`;
    TB = {};
    if (r.dias.length === 1) {
      const lst = errF.slice().sort((a, b) => ((tienda(a.idpdv) || {}).supervisor || '').localeCompare((tienda(b.idpdv) || {}).supervisor || '') || a.nombre.localeCompare(b.nombre));
      h += tbl('t-err', [{ h: 'Usuario', t: 1, v: q => q.usuario, w: 112 }, { h: 'Promotor', t: 1, v: q => q.nombre, w: 230, r: q => `<b>${esc(q.nombre)}</b>` }, { h: 'IDPDV', v: q => q.idpdv }, { h: 'Tienda', t: 1, v: q => (tienda(q.idpdv) || {}).nombre || '' }, { h: 'Resultado', t: 1, v: q => ERRN[q.estatus_check] || q.estatus_check, r: q => pillx((ERRI[q.estatus_check] || '') + ' ' + (ERRN[q.estatus_check] || q.estatus_check), NOJUST.includes(q.estatus_check) ? 'r' : 'a') },
        { h: 'Ventas', v: q => q.registros, r: q => q.registros ? `<b>${q.registros}</b>` : '0' }, { h: 'Justifica', t: 1, v: q => justTxt(q), r: q => { const p = JUSTP[justTxt(q)]; return pillx(p[1] + (justTxt(q) === 'No aplica' && NOJUST.includes(q.estatus_check) ? ': enviar a otra tienda' : ''), p[0]); } }, { h: 'Supervisor', t: 1, v: q => (tienda(q.idpdv) || {}).supervisor }, { h: 'Gerente', t: 1, v: q => (tienda(q.idpdv) || {}).gerente }], lst, { fix: 2, search: 1, csv: 1, png: 1, file: 'promotores_con_error', titulo: 'Promotores con error · ' + fdate(r.desde), sort: -1, maxh: '60vh', lim: 500 });
    } else {
      const gm = new Map(); errF.forEach(x => { if (!gm.has(x.usuario)) gm.set(x.usuario, []); gm.get(x.usuario).push(x); });
      const dias_ = new Map(); prim.forEach(x => dias_.set(x.usuario, (dias_.get(x.usuario) || 0) + 1));
      const top = [...gm].map(([u, v]) => { const c = {}; v.forEach(x => c[x.estatus_check] = (c[x.estatus_check] || 0) + 1); return { u, n: v[0].nombre, e: v.length, d: dias_.get(u) || v.length, c, t: v[0].idpdv, j: v.filter(x => justTxt(x) === 'Con venta').length }; }).sort((a, b) => b.e - a.e || b.e / b.d - a.e / a.d).slice(0, 10);
      h += top.length ? `<div class="toplist" id="top-err">${top.map((q, k) => `<div class="tp-row"><span class="tp-n ${k < 3 ? 'hot' : ''}">${k + 1}</span><div class="tp-m"><b>${esc(q.n)}</b><small>${esc(q.u)} · ${esc((tienda(q.t) || {}).nombre || '')} · ${esc((tienda(q.t) || {}).supervisor || '')}</small><div class="tp-s">${Object.entries(q.c).sort((a, b) => b[1] - a[1]).map(([k2, v]) => `<span class="pill ${NOJUST.includes(k2) ? 'r' : 'a'}">${ERRI[k2] || ''} ${v} ${esc((ERRN[k2] || k2).toLowerCase())}</span>`).join(' ')}${q.j ? ` <span class="pill g">💸 ${q.j} con venta</span>` : ''}</div></div><div class="tp-v"><b>${q.e}/${q.d}</b><small>errores / checks</small></div></div>`).join('')}</div><div class="tools" data-nocap><button class="btn sm" onclick="capturaDescargar($('top-err'),'Top 10 promotores con más errores',subFiltros(),'top_errores')">📸 Imagen</button><button class="btn sm" onclick="capturaCopiar($('top-err'),'Top 10 promotores con más errores',subFiltros())">📋 Copiar</button></div>` : `<div class="card empty"><img src="${img('triunfo')}" alt="">Sin errores en este periodo con ese filtro 🎉</div>`;
    }
    // detalle
    const sel = rows.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || (a.hora_in || '').localeCompare(b.hora_in || '')).filter(q => (!CKS.est || q.estatus_check === CKS.est) && (!CKS.fin || q.estatus_final === CKS.fin) && (!CKS.jus || justTxt(q) === CKS.jus));
    h += sect('Detalle de cada check', '🧾') + `<div class="tools" data-nocap><select onchange="CKS.est=this.value;vChecks()"><option value="">Todos los resultados</option>${Object.keys(ERRN).map(k => `<option value="${k}" ${CKS.est === k ? 'selected' : ''}>${ERRI[k]} ${ERRN[k]}</option>`).join('')}</select><select onchange="CKS.fin=this.value;vChecks()"><option value="">Todos los estatus finales</option>${['Cumple', 'Cumple Productividad', 'Cumple Telefonica', 'No Cumple', 'Otro Check'].map(k => `<option ${CKS.fin === k ? 'selected' : ''}>${k}</option>`).join('')}</select><select onchange="CKS.jus=this.value;vChecks()"><option value="">Toda justificación</option>${['Con venta', 'Sin venta', 'No aplica'].map(k => `<option ${CKS.jus === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
    h += tbl('t-checks', [{ h: 'Fecha', v: q => q.fecha, r: q => fdate(q.fecha), w: 82 }, { h: 'Usuario', t: 1, v: q => q.usuario, w: 112 }, { h: 'Promotor', t: 1, v: q => q.nombre, w: 220, r: q => `<b>${esc(q.nombre)}</b>` }, { h: 'IDPDV', v: q => q.idpdv }, { h: 'Tienda', t: 1, v: q => (tienda(q.idpdv) || {}).nombre || '' },
      { h: 'Entrada', v: q => q.hora_in, r: q => hh(q.hora_in) }, { h: 'Comida', v: q => q.hora_com_in, r: q => hh(q.hora_com_in) + ' – ' + hh(q.hora_com_out) }, { h: 'Salida', v: q => q.hora_out, r: q => hh(q.hora_out) }, { h: 'En tienda (min)', v: q => q.tiempo_ub, r: q => `<span class="${q.tiempo_ub < 420 ? 'cell-amber' : ''}">${fmt(q.tiempo_ub)}</span>` }, { h: 'Comida (min)', v: q => q.tiempo_com, r: q => f1(q.tiempo_com) },
      { h: 'Rango entrada', t: 1, v: q => q.rango_in, r: q => /fuera/i.test(q.rango_in || '') ? `<span class="cell-red">📍 ${esc(q.rango_in)}</span>` : esc(q.rango_in || '—') }, { h: 'Rango salida', t: 1, v: q => q.rango_out, r: q => /fuera/i.test(q.rango_out || '') ? `<span class="cell-red">📍 ${esc(q.rango_out)}</span>` : esc(q.rango_out || '—') },
      { h: 'Resultado', t: 1, v: q => ERRN[q.estatus_check] || q.estatus_check, r: q => pillx((ERRI[q.estatus_check] || '') + ' ' + (ERRN[q.estatus_check] || q.estatus_check), q.estatus_check === 'Cumple' ? 'g' : q.estatus_check === 'Abierto' ? 'b' : NOJUST.includes(q.estatus_check) ? 'r' : 'a') }, { h: 'Estatus final', t: 1, v: q => q.estatus_final, r: q => pillx(q.estatus_final, VALC[q.estatus_final] || 'x') },
      { h: 'Ventas', v: q => q.registros, r: q => q.registros ? `<b>${q.registros}</b> <small class="muted">T${q.temm} P${q.porta} Pos${q.pospago} Pre${q.prepago}</small>` : '0' }, { h: 'Justifica', t: 1, v: q => justTxt(q), r: q => { const p = JUSTP[justTxt(q)]; return pillx(p[1], p[0]); } },
      { h: 'Supervisor', t: 1, v: q => (tienda(q.idpdv) || {}).supervisor }, { h: 'Gerente', t: 1, v: q => (tienda(q.idpdv) || {}).gerente }, { h: 'RR.HH.', t: 1, v: q => (tienda(q.idpdv) || {}).rrhh }], sel, { fix: 3, search: 1, csv: 1, png: 1, file: 'detalle_checks', titulo: 'Detalle de checks', sort: 0, dir: -1, maxh: '70vh', lim: 600 });
    $('content').innerHTML = h; drawAll();
  });
}
const hh = s => s ? s.slice(0, 5) : '—';

/* ====================================================================== 4 · HC ====================================================================== */
const ACTC = { 'Activo': 'g', 'Descanso / falta / error': 'a', 'Posible baja': 'r', 'Baja': 'x', 'Sin check': 'x' };
const ACTI = { 'Activo': '🟢', 'Descanso / falta / error': '🟠', 'Posible baja': '🔴', 'Baja': '⚫', 'Sin check': '⚪', 'Vacaciones': '🏖️', 'Incapacidad (IMSS)': '🏥', 'Permiso especial': '📝', 'Tema médico (particular)': '🩺', 'No localizado': '❓' };
const ANTB = [['< 2 sem', 0, 13, C.rd], ['2–4 sem', 14, 27, C.am], ['1–3 meses', 28, 89, C.ye], ['3–6 meses', 90, 179, C.te], ['6 m – 1 año', 180, 364, C.bl], ['1–2 años', 365, 729, C.pu], ['2–3 años', 730, 1094, C.gr], ['3+ años', 1095, 1e9, C.dk]];
const antLabel = d => d == null ? '—' : (ANTB.find(b => d >= b[1] && d <= b[2]) || [''])[0];
function tipoIngreso(h, ant) { if (h.tipo_ingreso === 'Reingreso') return 'Reingreso'; if (ant == null) return 'Normal'; if (ant <= 14) return 'Nuevo ingreso'; if (ant <= 28) return 'Adaptación'; return 'Normal'; }
const TIPC = { 'Nuevo ingreso': ['r', '🆕'], 'Reingreso': ['b', '🔁'], 'Adaptación': ['a', '🌱'], 'Normal': ['x', ''] };
function estadoVivo(h) {
  const baja = R.bajasLive.get(h.usuario); if (baja && (!h.fecha_alta || baja >= h.fecha_alta)) return { e: 'Baja', det: 'Baja ' + fdate(baja) };
  const au = S.vigentes.find(v => v.usuario === h.usuario); if (au) return { e: au.motivo, det: `${au.dias} d · regresa ${fdate(au.regreso)}`, aus: au };
  if (h.ausencia_motivo && h.ausencia_regreso && h.ausencia_regreso > HOY) return { e: h.ausencia_motivo, det: `${h.ausencia_dias} d · regresa ${fdate(h.ausencia_regreso)}`, aus: { motivo: h.ausencia_motivo, inicio: addD(h.ausencia_regreso, -h.ausencia_dias), regreso: h.ausencia_regreso } };
  const d = h.ultimo_check ? diffD(HOY, h.ultimo_check) : null;
  if (d == null) return { e: 'Sin check', det: '' }; if (d <= 0) return { e: 'Activo', det: '' }; if (d === 1) return { e: 'Descanso / falta / error', det: '1 día sin check' }; if (d > 21) return { e: 'Baja', det: d + ' días sin check · sin baja registrada' }; return { e: 'Posible baja', det: d + ' días sin check' };
}
const HCF = { est: '', tipo: '', ant: '', emp: '' };
async function vHC() {
  await conReporte('HC', 'mochila', async () => {
    if (!R.vivo) { try { S.vigentes = await API.vigentes(); } catch (e) { } R.vivo = true; }
    const rows = R.hc.filter(h => okI(h.ultimo_idpdv)).map(h => { const v = estadoVivo(h), u = R.uc[h.usuario] || {}, t = tienda(h.ultimo_idpdv), ant = h.fecha_alta ? diffD(HOY, h.fecha_alta) : null; return { ...h, v, u, t: t || {}, ant, tipo: tipoIngreso(h, ant), antL: antLabel(ant), alerta: S.alertas.find(a => a.usuario === h.usuario) }; });
    const vis = rows.filter(q => R.incBaja || q.v.e !== 'Baja'), cnt = {}; vis.forEach(q => cnt[q.v.e] = (cnt[q.v.e] || 0) + 1);
    const ausN = vis.filter(q => !['Activo', 'Descanso / falta / error', 'Posible baja', 'Baja', 'Sin check'].includes(q.v.e)), nuevos = vis.filter(q => q.tipo === 'Nuevo ingreso').length, adap = vis.filter(q => q.tipo === 'Adaptación').length;
    const ests = [...new Set(vis.map(q => q.v.e))].sort(), emps = [...new Set(vis.map(q => q.empresa).filter(Boolean))].sort();
    const tabla = vis.filter(q => (!HCF.est || q.v.e === HCF.est) && (!HCF.tipo || q.tipo === HCF.tipo) && (!HCF.ant || q.antL === HCF.ant) && (!HCF.emp || q.empresa === HCF.emp));
    let h = cab('HC · plantilla de promotoría', 'Promotores y cubre-descansos con su último check y estatus. El estatus se actualiza en vivo con las ausencias y bajas que RH captura en Posibles bajas.', 'mochila') + barraFiltros('vHC');
    h += `<div class="tools"><button class="chip ${R.incBaja ? 'on' : ''}" onclick="R.incBaja=!R.incBaja;vHC()">Incluir bajas</button><span class="muted">${fmt(vis.length)} promotores · publicado ${esc(R.meta.generado)}</span></div>`;
    h += `<div class="kpis">${kp('Plantilla', fmt(vis.filter(q => q.v.e !== 'Baja').length), 'sin bajas', null, null, '👥')}${kp('Activos hoy', fmt(cnt['Activo'] || 0), pc1(cnt['Activo'] || 0, vis.length), C.gr, null, '🟢')}${kp('Descanso / falta', fmt(cnt['Descanso / falta / error'] || 0), 'último check ayer', C.am, null, '🟠')}${kp('Posible baja', fmt(cnt['Posible baja'] || 0), '2 o más días sin check', C.rd, "ir('bandeja')", '🔴')}${kp('Con ausencia', fmt(ausN.length), 'vacaciones, incapacidad…', C.bl, "ir('vigentes')", '🏖️')}${kp('Nuevo ingreso', fmt(nuevos), 'menos de 2 semanas · arranque rápido', C.rd, null, '🆕')}${kp('Adaptación', fmt(adap), '2 a 4 semanas', C.am, null, '🌱')}</div>`;
    h += `<div class="grid g2"><div class="card"><h3>🚦 Estatus de la plantilla</h3>${donut(Object.entries(cnt).map(([k, v]) => ({ n: (ACTI[k] || '') + ' ' + k, v, c: k === 'Activo' ? C.gr : k === 'Posible baja' ? C.rd : k === 'Descanso / falta / error' ? C.am : k === 'Baja' ? C.gy : C.bl })), { sub: 'promotores' })}</div>
      <div class="card"><h3>⏳ Antigüedad</h3><p class="note">Menos de 2 semanas = nuevo ingreso: requiere arranque rápido (visita del supervisor, básicos y capacitación práctica).</p>${hbars(ANTB.map(b => ({ n: b[0], v: vis.filter(q => q.ant != null && q.ant >= b[1] && q.ant <= b[2]).length, c: b[3] })), C.pu)}</div></div>`;
    TB = {};
    h += sect('Promotores', '👥') + `<div class="tools" data-nocap><select onchange="HCF.est=this.value;vHC()"><option value="">Todos los estatus</option>${ests.map(e => `<option ${HCF.est === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select><select onchange="HCF.tipo=this.value;vHC()"><option value="">Todo tipo de ingreso</option>${['Nuevo ingreso', 'Adaptación', 'Reingreso', 'Normal'].map(e => `<option ${HCF.tipo === e ? 'selected' : ''}>${e}</option>`).join('')}</select><select onchange="HCF.ant=this.value;vHC()"><option value="">Toda antigüedad</option>${ANTB.map(b => `<option ${HCF.ant === b[0] ? 'selected' : ''}>${b[0]}</option>`).join('')}</select><select onchange="HCF.emp=this.value;vHC()"><option value="">Toda razón social</option>${emps.map(e => `<option ${HCF.emp === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>`;
    h += tbl('t-hc', [{ h: 'Usuario', t: 1, v: q => q.usuario, w: 120 }, { h: 'Nombre', t: 1, v: q => q.nombre, w: 230, r: q => `<b>${esc(q.nombre)}</b>` },
      { h: 'Estatus', t: 1, v: q => q.v.e, w: 250, r: q => { const pend = ['Posible baja', 'Descanso / falta / error'].includes(q.v.e) && q.alerta && can('alertas', 'editar'); return `<div class="est-c"><div class="est-r">${pillx((ACTI[q.v.e] || '🔵') + ' ' + esc(q.v.e), ACTC[q.v.e] || 'b')}${pend ? `<button class="rsv" onclick="resolverDesdeHC(${q.alerta.id})">Resolver ›</button>` : ''}</div>${q.v.det ? `<small class="muted">${esc(q.v.det)}</small>` : ''}</div>`; } },
      { h: 'Tipo de ingreso', t: 1, v: q => q.tipo, r: q => pillx((TIPC[q.tipo][1] + ' ' + q.tipo).trim(), TIPC[q.tipo][0]) }, { h: 'Antigüedad', t: 1, v: q => q.ant, r: q => q.ant == null ? '—' : `<b>${esc(q.antL)}</b><br><small class="muted">${Math.floor(q.ant / 7)} sem · ${q.ant} d</small>` },
      { h: 'Fecha de ingreso', v: q => q.fecha_alta, r: q => fdate(q.fecha_alta) }, { h: 'Baja anterior', v: q => q.tipo_ingreso === 'Reingreso' ? q.baja_final : null, r: q => q.tipo_ingreso === 'Reingreso' ? fdate(q.baja_final) : '—' },
      { h: 'Último check', v: q => q.ultimo_check, r: q => fdate(q.ultimo_check) + (q.u.hora_in ? `<br><small class="muted">${hh(q.u.hora_in)} – ${hh(q.u.hora_out)}</small>` : '') }, { h: 'Tipo de check', t: 1, v: q => q.rol, r: q => esc(q.rol || '—') + (q.u.estatus_check ? `<br><small class="muted">${esc((ERRI[q.u.estatus_check] || '') + ' ' + (ERRN[q.u.estatus_check] || q.u.estatus_check))}</small>` : '') },
      { h: 'Tienda (último check)', t: 1, v: q => q.t.nombre || '', r: q => esc(q.t.nombre || '—') }, { h: 'Cadena', t: 1, v: q => q.t.cadena }, { h: 'Estado', t: 1, v: q => q.t.estado }, { h: 'Región', t: 1, v: q => q.t.region }, { h: 'Gerente', t: 1, v: q => q.t.gerente }, { h: 'Supervisor', t: 1, v: q => q.t.supervisor }, { h: 'RR.HH.', t: 1, v: q => q.t.rrhh }, { h: 'Razón social', t: 1, v: q => q.empresa }],
      tabla, { fix: 3, search: 1, csv: 1, png: 1, file: 'hc_promotores', titulo: 'HC · promotores', sort: 2, dir: 1, maxh: '72vh', lim: 600 });
    $('content').innerHTML = h; drawAll();
  });
}
function resolverDesdeHC(id) { S.view = 'bandeja'; nav(); render(); setTimeout(() => abrir('aus', id), 80); }

/* >>> 04_gestion.js */
/* ====================================================================== estado y UI ====================================================================== */
const S = { me: null, cat: null, alertas: [], vigentes: [], view: 'resumen', f: { q: '', min: 2 } };
const can = (mod, acc) => !!(S.me && S.me.permisos[mod] && S.me.permisos[mod][acc]);
const tienda = id => (S.cat && S.cat.tiendas[id]) || null;
const colorDias = d => d >= 5 ? 'd5' : d >= 3 ? 'd3' : 'd2';

const VISTAS = [
  { k: 'resumen', ic: '📊', n: 'Resumen', mod: 'reportes', f: vResumen },
  { k: 'penal', ic: '⚠️', n: 'Penalización', mod: 'reportes', f: vPenal },
  { k: 'checks', ic: '✅', n: 'Detalle de checks', mod: 'reportes', f: vChecks },
  { k: 'hc', ic: '👥', n: 'HC', mod: 'reportes', f: vHC },
  { k: 'movs', ic: '🔄', n: 'Ingresos y bajas', mod: 'reportes', f: vMovs },
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
  const q = norm(S.f.q);
  return S.alertas.filter(a => a.dias >= S.f.min).filter(a => {
    const t = tienda(a.idpdv); if (!okT(t)) return false;
    if (q && !norm(`${a.nombre} ${a.usuario} ${t ? t.nombre + ' ' + t.supervisor : ''}`).includes(q)) return false;
    return true;
  });
}
function vBandeja() {
  const todas = S.alertas, f = filtradas();
  const n = (min, max = 9999) => todas.filter(a => a.dias >= min && a.dias <= max).length;
  const reg = S.vigentes.filter(v => diffD(v.regreso, HOY) <= 3).length;
  let h = cab('Posibles bajas', 'Promotores que llevan 2 o más días sin check y no tienen una ausencia registrada. Resuelve cada caso aquí mismo: registra la ausencia, confirma la baja o márcalo como error de asistencia.', 'guino');
  h += `<div class="kpis">
    <div class="kpi click ${S.f.min === 2 ? 'sel' : ''}" onclick="S.f.min=2;vBandeja()"><div class="l">Abiertas</div><div class="v">${fmt(todas.length)}</div><div class="s">2 o más días sin check</div></div>
    <div class="kpi click ${S.f.min === 3 ? 'sel' : ''}" onclick="S.f.min=3;vBandeja()"><div class="l">3 o más días</div><div class="v" style="color:var(--orange-n)">${fmt(n(3))}</div><div class="s">prioridad media</div></div>
    <div class="kpi click ${S.f.min === 5 ? 'sel' : ''}" onclick="S.f.min=5;vBandeja()"><div class="l">5 o más días</div><div class="v" style="color:var(--red)">${fmt(n(5))}</div><div class="s">prioridad alta</div></div>
    <div class="kpi"><div class="l">Con ausencia vigente</div><div class="v" style="color:var(--blue)">${fmt(S.vigentes.length)}</div><div class="s">${fmt(reg)} regresan en ≤ 3 días</div></div></div>`;
  h += barraFiltros('vBandeja', S.alertas.map(a => tienda(a.idpdv)).filter(Boolean), ['zona_rrhh', 'rrhh', 'supervisor', 'region', 'cadena']);
  h += `<div class="tools"><input type="search" id="q" placeholder="🔎 Buscar nombre, usuario, tienda o supervisor…" value="${esc(S.f.q)}"><span class="muted">${fmt(f.length)} caso${f.length === 1 ? '' : 's'}</span></div>`;
  if (!f.length) h += `<div class="card empty"><img src="${img('triunfo')}" alt="">Sin casos pendientes con estos filtros. ¡Todo al día!</div>`;
  else h += `<div class="list"><div class="al head"><span>Promotor</span><span>Tienda</span><span>Sin check</span><span>Último check</span><span>Últimos 90 días</span><span></span></div>${f.slice(0, 300).map(filaAlerta).join('')}</div>${f.length > 300 ? '<p class="muted">Mostrando 300; usa los filtros para acotar.</p>' : ''}`;
  $('content').innerHTML = h;
  $('q').oninput = e => { S.f.q = e.target.value; clearTimeout(vBandeja.t); vBandeja.t = setTimeout(() => { const p = e.target.selectionStart; vBandeja(); const q = $('q'); q.focus(); q.setSelectionRange(p, p); }, 250); };
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
  const todos = S.vigentes.map(v => ({ ...v, faltan: diffD(v.regreso, HOY), t: tienda(v.idpdv) || {} }));
  const rows = todos.filter(v => okT(v.t.nombre ? v.t : null) && (!S.f.mot || v.motivo === S.f.mot)).sort((a, b) => a.faltan - b.faltan);
  const porMot = {}; rows.forEach(r => porMot[r.motivo] = (porMot[r.motivo] || 0) + 1);
  const MI = { 'Vacaciones': '🏖️', 'Incapacidad (IMSS)': '🏥', 'Permiso especial': '📝', 'Tema médico (particular)': '🩺', 'No localizado': '❓' };
  let h = cab('Ausencias vigentes', 'Promotores con ausencia registrada que sigue vigente hoy, y cuándo regresan.', 'mochila') + barraFiltros('vVigentes', todos.map(v => v.t).filter(t => t.nombre), ['zona_rrhh', 'rrhh', 'supervisor', 'region', 'cadena']);
  h += `<div class="kpis"><div class="kpi"><div class="l">🩺 Vigentes</div><div class="v">${fmt(rows.length)}</div><div class="s">hoy</div></div>${Object.entries(porMot).map(([m, c]) => `<div class="kpi"><div class="l">${MI[m] || ''} ${esc(m)}</div><div class="v">${c}</div></div>`).join('')}<div class="kpi"><div class="l">⏰ Regresan en ≤ 3 días</div><div class="v" style="color:var(--orange-n)">${rows.filter(r => r.faltan <= 3).length}</div></div></div>`;
  h += `<div class="tools" data-nocap><span>Motivo:</span><select onchange="S.f.mot=this.value;vVigentes()"><option value="">Todos</option>${[...new Set(todos.map(v => v.motivo))].sort().map(m => `<option ${S.f.mot === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>`;
  TB = {};
  h += tbl('t-vig', [{ h: 'Usuario', t: 1, v: r => r.usuario, w: 112 }, { h: 'Promotor', t: 1, v: r => r.nombre, w: 210, r: r => `<b>${esc(r.nombre)}</b>` }, { h: 'Motivo', t: 1, v: r => r.motivo, r: r => `<span class="pill b">${MI[r.motivo] || ''} ${esc(r.motivo)}</span>` }, { h: 'Inicio', v: r => r.inicio, r: r => fdate(r.inicio) }, { h: 'Días', v: r => r.dias }, { h: 'Regresa', v: r => r.regreso, r: r => fdate(r.regreso) },
    { h: 'Faltan', v: r => r.faltan, r: r => `<span class="pill ${r.faltan <= 0 ? 'r' : r.faltan <= 3 ? 'a' : 'x'}">${r.faltan <= 0 ? '⏰ hoy' : r.faltan + ' d'}</span>` }, { h: 'Tienda', t: 1, v: r => r.t.nombre || '' }, { h: 'Estado', t: 1, v: r => r.t.estado }, { h: 'Supervisor', t: 1, v: r => r.t.supervisor }, { h: 'Gerente', t: 1, v: r => r.t.gerente }, { h: 'Gerencia RR.HH.', t: 1, v: r => r.t.zona_rrhh }, { h: 'RR.HH.', t: 1, v: r => r.t.rrhh }],
    rows, { fix: 2, search: 1, csv: 1, png: 1, file: 'ausencias_vigentes', titulo: 'Ausencias vigentes', sort: 6, dir: 1, maxh: '72vh' });
  $('content').innerHTML = h; drawAll();
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


/* >>> 05_ingresos.js */
/* ====================================================================== POSIBLES INGRESOS ====================================================================== */
const ESTI = ['Programado', 'Confirmado', 'Ingresó', 'No llegó', 'Declinó', 'No contesta', 'Reagenda'];
const ESTC = { 'Programado': 'x', 'Confirmado': 'b', 'Ingresó': 'g', 'No llegó': 'r', 'Declinó': 'r', 'No contesta': 'a', 'Reagenda': 'a' };
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
Real.eliminarCandidato = async function (id) { const { error } = await sb.from('candidatos').delete().eq('id', id); if (error) throw error; };
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
Demo.eliminarCandidato = async function (id) { Demo._cands = Demo._cands.filter(x => x.id !== id); };
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
const filaVacia = () => ({ fecha: '', nombre: '', idpdv: '', fuente: '', recl: S.me && S.me.reclutador_id ? String(S.me.reclutador_id) : '', generado: '', experiencia: '', acomp: '', referido: '', coment: '' });
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
  <div class="tools"><button class="btn sm" onclick="IG.grid.push(...Array.from({length:10},filaVacia));tCaptura()">+ 10 filas</button><button class="btn sm" onclick="limpiarVacias()">Quitar filas vacías</button><label class="btn sm xl-btn">📂 Cargar Excel<input type="file" accept=".xlsx,.xls,.csv" hidden onchange="importarExcel(this.files[0]);this.value=''"></label><button class="btn sm" onclick="IG.grid=Array.from({length:12},filaVacia);tCaptura()">Empezar de nuevo</button><span class="muted" id="g-res"></span><button class="btn primary" id="g-ok" style="margin-left:auto" onclick="guardarGrid()">Guardar candidatos</button></div>
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

/* ----- importar Excel ----- */
const ENC = { fecha: /^(FECHA|DIA|FECHA DE INGRESO)/, nombre: /^NOMBRE/, idpdv: /^ID ?PDV/, fuente: /^MEDIO/, recl: /^RECLUTADO/, generado: /^GENERADO/, experiencia: /^EXPERIENCIA/, acomp: /^ACOMPA/, referido: /^REFERIDO/, coment: /^COMENT/ };
function celdaTxt(v, k) {
  if (v == null || v === '') return '';
  if (k === 'fecha' && typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  if (k === 'fecha' && v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  return String(v);
}
async function importarExcel(file) {
  if (!file) return;
  if (!window.XLSX) { toast('El lector de Excel no cargó (revisa tu conexión).'); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]];
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    let hi = m.slice(0, 15).findIndex(r => r.some(c => /^NOMBRE/.test(norm(c))));
    const map = {}; if (hi >= 0) m[hi].forEach((c, j) => { const n = norm(c); for (const [k, re] of Object.entries(ENC)) if (re.test(n) && map[k] == null) map[k] = j; });
    const filas = m.slice(hi + 1).filter(r => r.some(c => String(c).trim() !== ''));
    const orden = CAMPOS.map(c => c.k); let n = 0, vac = 0;
    const nuevas = filas.map(r => { const o = filaVacia(); orden.forEach((k, j) => { const col = hi >= 0 && Object.keys(map).length >= 3 ? map[k] : j; if (col != null) o[k] = valorPegado(k, celdaTxt(r[col], k)); }); return o; }).filter(o => o.nombre || o.idpdv);
    IG.grid = IG.grid.filter(r => !vacia(r)).concat(nuevas); while (IG.grid.length < 12) IG.grid.push(filaVacia());
    tCaptura(); toast(`${nuevas.length} fila${nuevas.length === 1 ? '' : 's'} leída${nuevas.length === 1 ? '' : 's'} del Excel: revisa las que quedaron en rojo`);
  } catch (e) { console.error(e); toast('No pude leer el archivo: ' + (e.message || e)); }
}

/* ----- seguimiento ----- */
const okAlc = c => c.idpdv == null ? !Object.values(FL).some(Boolean) : okI(c.idpdv);
const nombreRecl = id => (IG.cat.recl.find(x => x.id === id) || {}).nombre || '—';
const nombreFuente = id => (IG.cat.fuentes.find(x => x.id === id) || {}).fuente || '—';
const PEND = ['Programado', 'Confirmado', 'Reagenda'];
function tSeguimiento() {
  const rangos = { hoy: ['Hoy', HOY, HOY], man: ['Mañana', addD(HOY, 1), addD(HOY, 1)], sem: ['Próximos 7 días', HOY, addD(HOY, 7)], pend: ['⏰ Por cerrar', addD(HOY, -30), addD(HOY, -1)] };
  const k = IG.rg || 'man', [nm, d1, d2] = rangos[k];
  const todos = IG.lista.filter(okAlc), pen = c => PEND.includes(c.estatus);
  const en = todos.filter(c => c.fecha_programada >= d1 && c.fecha_programada <= d2 && (k !== 'pend' || pen(c)));
  const porCerrar = todos.filter(c => c.fecha_programada < HOY && pen(c)).length, man = todos.filter(c => c.fecha_programada === addD(HOY, 1));
  let h = barraFiltros('tSeguimiento', IG.lista.map(c => tienda(c.idpdv)).filter(Boolean), ['region', 'gerente', 'supervisor', 'zona_rrhh', 'rrhh', 'cadena']);
  h += `<div class="kpis"><div class="kpi"><div class="l">📅 Programados mañana</div><div class="v">${man.length}</div><div class="s">${man.filter(c => c.estatus === 'Confirmado').length} confirmados</div></div>
    <div class="kpi"><div class="l">☀️ Programados hoy</div><div class="v">${todos.filter(c => c.fecha_programada === HOY).length}</div><div class="s">${todos.filter(c => c.fecha_programada === HOY && c.estatus === 'Ingresó').length} ya ingresaron</div></div>
    <div class="kpi ${porCerrar ? 'click' : ''}" onclick="IG.rg='pend';tSeguimiento()"><div class="l">⏰ Por cerrar</div><div class="v" style="color:${porCerrar ? 'var(--red)' : 'var(--green)'}">${porCerrar}</div><div class="s">fecha pasada sin resultado</div></div></div>`;
  h += `<div class="tools">${Object.entries(rangos).map(([kk, v]) => `<button class="chip ${k === kk ? 'on' : ''}" onclick="IG.rg='${kk}';tSeguimiento()">${v[0]}</button>`).join('')}<input type="search" id="sg-q" placeholder="🔎 Buscar nombre…" value="${esc(IG.sq || '')}"><button class="btn sm primary" onclick="modalOperaciones()">📲 Mensaje para Operaciones</button></div>`;
  const q = norm(IG.sq || ''), f = en.filter(c => !q || norm(c.nombre).includes(q)), dias = [...new Set(f.map(c => c.fecha_programada))].sort();
  if (!f.length) h += `<div class="card empty"><img src="${img('pulgares')}" alt="">No hay candidatos en este rango.</div>`;
  for (const d of dias) {
    const g = f.filter(c => c.fecha_programada === d);
    h += `<div class="dia-h">${fdia(d)}${d === HOY ? ' · hoy' : d === addD(HOY, 1) ? ' · mañana' : ''} <span class="muted">${g.length} candidato${g.length > 1 ? 's' : ''} · ${g.filter(c => c.estatus === 'Ingresó').length} ingresaron · ${g.filter(c => c.estatus === 'Confirmado').length} confirmados</span></div><div class="list">${g.map(filaCand).join('')}</div>`;
  }
  $('ig-body').innerHTML = h;
  $('sg-q').oninput = e => { IG.sq = e.target.value; clearTimeout(IG.t); IG.t = setTimeout(() => { const p = e.target.selectionStart; tSeguimiento(); const q2 = $('sg-q'); q2.focus(); q2.setSelectionRange(p, p); }, 250); };
}
function filaCand(c) {
  const t = tienda(c.idpdv);
  const ac = can('posibles_ingresos', 'editar') ? `<div class="acts">${c.estatus === 'Programado' ? `<button class="btn sm" onclick="cambiarEst('${c.id}','Confirmado')">✔️ Confirmó</button>` : ''}
    ${c.estatus !== 'Ingresó' ? `<button class="btn sm primary" onclick="modalIngreso('${c.id}')">🙌 Ingresó</button><button class="btn sm" onclick="cambiarEst('${c.id}','No llegó')">🚫 No llegó</button><button class="btn sm" onclick="cambiarEst('${c.id}','No contesta')">📵 No contesta</button><button class="btn sm" onclick="cambiarEst('${c.id}','Declinó')">✖️ Declinó</button><button class="btn sm" onclick="modalReagendar('${c.id}')">🔁 Reagendar</button>` : ''}${can('posibles_ingresos', 'borrar') ? `<button class="btn sm danger" title="Eliminar (creado por error)" onclick="eliminarCand('${c.id}')">🗑</button>` : ''}</div>` : '';
  return `<div class="cd"><div class="who"><b>${esc(c.nombre)}</b><small>${t ? esc(t.nombre) + ' · ' + esc(t.estado) : 'Tienda no identificada'}</small></div>
    <div class="muted">${esc(nombreFuente(c.fuente_id))} · ${esc(nombreRecl(c.reclutador_id))}${c.generado_por ? ' · ' + esc(c.generado_por) : ''}${c.reagendas ? ' · reagendó ' + c.reagendas + 'x' : ''}</div>
    <div><span class="pill ${ESTC[c.estatus] || 'x'}">${esc(c.estatus)}</span>${c.usuario_fieldwy ? `<br><small class="muted">${esc(c.usuario_fieldwy)}</small>` : ''}</div>${ac}</div>`;
}
async function cambiarEst(id, est) { try { await API.actualizarCandidato(id, { estatus: est }); IG.lista.find(x => x.id === id).estatus = est; toast(est); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); } }
async function eliminarCand(id) {
  const c = IG.lista.find(x => x.id === id); if (!confirm(`¿Eliminar a "${c.nombre}"? Solo debe usarse para candidatos creados por error. No se puede deshacer.`)) return;
  try { await API.eliminarCandidato(id); IG.lista = IG.lista.filter(x => x.id !== id); toast('Candidato eliminado'); tSeguimiento(); } catch (e) { toast('No se pudo eliminar: ' + (e.message || e)); }
}
function modalIngreso(id) {
  const c = IG.lista.find(x => x.id === id);
  $('modal').innerHTML = `<div class="mbox"><h3>🙌 Ingresó</h3><div class="who">${esc(c.nombre)}</div><div class="fld"><label>Usuario Fieldwy (opcional por ahora)</label><input id="m-usr" placeholder="Ej. ABCD010203" autocapitalize="characters"></div><div class="note">Con el usuario Fieldwy se enlaza después con su asistencia, su plantilla y su baja.</div><div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Guardar ingreso</button></div></div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
  $('m-ok').onclick = async () => { const u = $('m-usr').value.trim().toUpperCase(); try { await API.actualizarCandidato(id, { estatus: 'Ingresó', usuario_fieldwy: u || null }); c.estatus = 'Ingresó'; c.usuario_fieldwy = u || null; cerrarM(); toast('Ingreso registrado'); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); } };
}
function modalReagendar(id) {
  const c = IG.lista.find(x => x.id === id);
  $('modal').innerHTML = `<div class="mbox"><h3>🔁 Reagendar</h3><div class="who">${esc(c.nombre)} · estaba para ${fdate(c.fecha_programada)}</div><div class="fld"><label>Nueva fecha</label><input type="date" id="m-f" value="${addD(HOY, 1)}" min="${HOY}"></div><div class="mfoot"><button class="btn" onclick="cerrarM()">Cancelar</button><button class="btn primary" id="m-ok">Reagendar</button></div></div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); };
  $('m-ok').onclick = async () => { const f = $('m-f').value; if (!f) return; try { await API.actualizarCandidato(id, { fecha_programada: f, estatus: 'Programado', reagendas: (c.reagendas || 0) + 1 }); c.fecha_programada = f; c.estatus = 'Programado'; c.reagendas = (c.reagendas || 0) + 1; cerrarM(); toast('Reagendado para ' + fdate(f)); tSeguimiento(); } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); } };
}

/* ----- esquema de ingresos (como el que envía RH a Operaciones) y mensaje ----- */
const CADS = ['Coppel', 'Elektra', 'Suburbia', 'Cimaco'];
function esquemaHtml(rows, titulo) {
  const cad = [...CADS, ...new Set(rows.map(c => (tienda(c.idpdv) || {}).cadena).filter(x => x && !CADS.includes(x)))];
  return `<div>` + arbol(rows, [...cad.map(c => ({ h: c, f: a => a.filter(x => (tienda(x.idpdv) || {}).cadena === c).length })), { h: 'Total general', f: a => a.length, cero: true }], { titulo: 'REGIÓN / GERENTE / SUPERVISOR / TIENDA', abrir: 2 }) + '</div>';
}
function modalOperaciones() {
  const d = IG.opd || addD(HOY, 1);
  const g = IG.lista.filter(c => okAlc(c) && c.fecha_programada === d && [...PEND, 'Ingresó'].includes(c.estatus));
  const por = {}; g.forEach(c => { const e = (tienda(c.idpdv) || {}).estado || 'Sin tienda'; (por[e] = por[e] || []).push(c); });
  const txt = `📲 *Ingresos programados – ${fdia(d)}*\n\n*${g.length} ingresos programados* (${g.filter(c => c.estatus === 'Confirmado').length} confirmados)\n\n` + Object.entries(por).sort((a, b) => b[1].length - a[1].length).map(([e, v]) => `• ${e}: ${v.length} (${v.filter(c => c.estatus === 'Confirmado').length} confirmados)`).join('\n');
  $('modal').innerHTML = `<div class="mbox wide"><h3>📲 Mensaje y esquema para Operaciones</h3><div class="fld"><label>Día</label><input type="date" id="op-d" value="${d}"></div><div id="op-esq">${esquemaHtml(g, 'RESUMEN DE POSIBLES INGRESOS')}</div><div class="fld"><label>Texto para WhatsApp</label><textarea id="op-t" rows="7">${esc(txt)}</textarea></div>
    <div class="mfoot"><button class="btn" onclick="cerrarM()">Cerrar</button><button class="btn" onclick="capturaCopiar($('op-esq'),'Posibles ingresos · ${fdia(d)}','Operaciones')">📋 Copiar imagen</button><button class="btn" onclick="capturaDescargar($('op-esq'),'Posibles ingresos · ${fdia(d)}','Operaciones','esquema_ingresos')">📸 Descargar imagen</button><button class="btn primary" onclick="navigator.clipboard.writeText($('op-t').value).then(()=>toast('Texto copiado'))">📋 Copiar texto</button></div></div>`; $('modal').hidden = false;
  $('modal').onclick = e => { if (e.target.id === 'modal') cerrarM(); }; $('op-d').onchange = e => { IG.opd = e.target.value; modalOperaciones(); };
}

/* ----- resumen y conversión ----- */
const VER = [['cand', 'Candidato'], ['supervisor', 'Supervisor'], ['zona_rrhh', 'Gerencia RR.HH.'], ['rrhh', 'RR.HH.'], ['recl', 'Reclutador'], ['fuente', 'Medio'], ['estado', 'Estado'], ['region', 'Región']];
function tResumen() {
  const per = IG.per, hasta = IG.dh || addD(HOY, 14), desde = IG.dd || (per === 'all' ? '0000' : addD(HOY, -(+per)));
  const base = IG.lista.filter(okAlc).filter(x => x.fecha_programada >= desde && x.fecha_programada <= hasta);
  const cerr = base.filter(x => !PEND.includes(x.estatus)), ing = cerr.filter(x => x.estatus === 'Ingresó'), cnt = e => cerr.filter(x => x.estatus === e).length;
  const PAL = [C.or, C.bl, C.gr, C.pu, C.te, C.am, C.rd, '#7B8794', '#B0467B'];
  const pie = (rows, keyf, namef, o = {}) => { const g = new Map(); rows.forEach(x => { const k = keyf(x); g.set(k, (g.get(k) || 0) + 1); }); let it = [...g].map(([k, v]) => ({ n: namef(k), v })).sort((a, b) => b.v - a.v); if (it.length > 8) { const r = it.slice(7).reduce((a, b) => a + b.v, 0); it = it.slice(0, 7).concat([{ n: 'Otros', v: r }]); } return donut(it.map((x, i) => ({ ...x, c: PAL[i % PAL.length] })), { best: 1, sub: o.sub || 'candidatos' }); };
  const conv = (keyf, namef, min) => { const g = new Map(); cerr.forEach(x => { const k = keyf(x); const o = g.get(k) || { n: 0, i: 0 }; o.n++; if (x.estatus === 'Ingresó') o.i++; g.set(k, o); }); return [...g].filter(([, o]) => o.n >= min).map(([k, o]) => ({ n: namef(k), v: o.i / o.n * 100, s: `${o.i}/${o.n}`, c: o.i / o.n >= 0.75 ? C.gr : o.i / o.n >= 0.6 ? C.am : C.rd })).sort((a, b) => b.v - a.v).slice(0, 10); };
  let h = barraFiltros('tResumen', IG.lista.map(c => tienda(c.idpdv)).filter(Boolean), ['region', 'gerente', 'supervisor', 'zona_rrhh', 'rrhh', 'cadena']);
  h += `<div class="tools"><span>Periodo:</span><select onchange="IG.per=this.value;IG.dd=null;IG.dh=null;tResumen()">${[['30', 'Últimos 30 días'], ['60', 'Últimos 60 días'], ['90', 'Últimos 90 días'], ['all', 'Todo lo cargado']].map(([v, t]) => `<option value="${v}" ${IG.per === v && !IG.dd ? 'selected' : ''}>${t}</option>`).join('')}</select><span>o fechas:</span><input type="date" value="${desde === '0000' ? '' : desde}" onchange="IG.dd=this.value;tResumen()"> <input type="date" value="${hasta}" onchange="IG.dh=this.value;tResumen()"><span class="muted">${fmt(cerr.length)} candidatos con resultado</span></div>`;
  h += `<div class="kpis"><div class="kpi"><div class="l">🧑‍💼 Programados</div><div class="v">${fmt(cerr.length)}</div></div><div class="kpi"><div class="l">🙌 Ingresaron</div><div class="v" style="color:var(--green)">${fmt(ing.length)}</div></div><div class="kpi"><div class="l">📈 Conversión</div><div class="v">${cerr.length ? (ing.length / cerr.length * 100).toFixed(2) + '%' : '—'}</div></div><div class="kpi"><div class="l">🚫 No llegó</div><div class="v" style="color:var(--red)">${cnt('No llegó')}</div></div><div class="kpi"><div class="l">✖️ Declinó</div><div class="v" style="color:var(--red)">${cnt('Declinó')}</div></div><div class="kpi"><div class="l">📵 No contesta</div><div class="v" style="color:var(--amber)">${cnt('No contesta')}</div></div></div>`;
  const res = ['Ingresó', 'No llegó', 'Declinó', 'No contesta', 'Reagenda'].map((e, i) => ({ n: e, v: cnt(e), c: [C.gr, C.rd, C.am, C.dk, C.gy][i] }));
  h += `<div class="grid g3"><div class="card"><h3>🎯 Resultado de los candidatos</h3>${donut(res, { sub: 'candidatos' })}</div><div class="card"><h3>🏆 Ingresos por reclutador</h3>${pie(ing, x => x.reclutador_id, nombreRecl, { sub: 'ingresos' })}</div><div class="card"><h3>📣 Ingresos por medio</h3>${pie(ing, x => x.fuente_id, nombreFuente, { sub: 'ingresos' })}</div></div>`;
  h += `<div class="grid g3"><div class="card"><h3>✖️ Declinados por medio</h3>${pie(cerr.filter(x => x.estatus === 'Declinó'), x => x.fuente_id, nombreFuente, { sub: 'declinados' })}</div><div class="card"><h3>🚫 No llegaron por reclutador</h3>${pie(cerr.filter(x => x.estatus === 'No llegó'), x => x.reclutador_id, nombreRecl, { sub: 'no llegaron' })}</div><div class="card"><h3>📵 No contestan por reclutador</h3>${pie(cerr.filter(x => x.estatus === 'No contesta'), x => x.reclutador_id, nombreRecl, { sub: 'sin respuesta' })}</div></div>`;
  h += `<div class="grid g2"><div class="card"><h3>🥇 Mejor conversión por medio</h3><p class="note">Ingresos ÷ candidatos con resultado (mín. 10).</p>${hbars(conv(x => x.fuente_id, nombreFuente, 10), C.gr, { pct: 1 })}</div><div class="card"><h3>🥇 Mejor conversión por reclutador</h3><p class="note">Mín. 15 candidatos.</p>${hbars(conv(x => x.reclutador_id, nombreRecl, 15), C.gr, { pct: 1 })}</div></div>`;
  // tabla única con vista seleccionable
  const vista = IG.ver || 'cand';
  h += sect('Detalle', '🧾') + `<div class="tools"><span>Ver por:</span><select onchange="IG.ver=this.value;tResumen()">${VER.map(([k, n]) => `<option value="${k}" ${vista === k ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="muted">Mismo periodo y filtros de arriba (elige un solo día con las fechas para el día completo)</span></div>`;
  TB = {};
  if (vista === 'cand') {
    h += tbl('t-ig', [{ h: 'Fecha', v: c => c.fecha_programada, r: c => fdate(c.fecha_programada), w: 82 }, { h: 'Candidato', t: 1, v: c => c.nombre, w: 210, r: c => `<b>${esc(c.nombre)}</b>` }, { h: 'Estatus', t: 1, v: c => c.estatus, r: c => `<span class="pill ${ESTC[c.estatus] || 'x'}">${esc(c.estatus)}</span>` }, { h: 'IDPDV', v: c => c.idpdv }, { h: 'Tienda', t: 1, v: c => (tienda(c.idpdv) || {}).nombre || '' }, { h: 'Cadena', t: 1, v: c => (tienda(c.idpdv) || {}).cadena }, { h: 'Estado', t: 1, v: c => (tienda(c.idpdv) || {}).estado },
      { h: 'Reclutador', t: 1, v: c => nombreRecl(c.reclutador_id) }, { h: 'Medio', t: 1, v: c => nombreFuente(c.fuente_id) }, { h: 'Generado por', t: 1, v: c => c.generado_por }, { h: 'Usuario Fieldwy', t: 1, v: c => c.usuario_fieldwy }, { h: 'Supervisor', t: 1, v: c => (tienda(c.idpdv) || {}).supervisor }, { h: 'Gerencia RR.HH.', t: 1, v: c => (tienda(c.idpdv) || {}).zona_rrhh }, { h: 'RR.HH.', t: 1, v: c => (tienda(c.idpdv) || {}).rrhh }],
      base, { fix: 2, search: 1, csv: 1, png: 1, file: 'posibles_ingresos_detalle', titulo: 'Posibles ingresos · detalle', sort: 0, dir: -1, maxh: '65vh', lim: 600 });
  } else {
    const kf = { supervisor: c => (tienda(c.idpdv) || {}).supervisor || 'Sin dato', zona_rrhh: c => (tienda(c.idpdv) || {}).zona_rrhh || 'Sin dato', rrhh: c => (tienda(c.idpdv) || {}).rrhh || 'Sin dato', recl: c => nombreRecl(c.reclutador_id), fuente: c => nombreFuente(c.fuente_id), estado: c => (tienda(c.idpdv) || {}).estado || 'Sin dato', region: c => (tienda(c.idpdv) || {}).region || 'Sin dato' }[vista];
    const g = new Map(); base.forEach(c => { const k = kf(c); if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
    const rows = [...g].map(([k, v]) => { const ce = v.filter(x => !PEND.includes(x.estatus)); return { n: k, tot: v.length, pr: v.filter(x => PEND.includes(x.estatus)).length, i: v.filter(x => x.estatus === 'Ingresó').length, nl: v.filter(x => x.estatus === 'No llegó').length, d: v.filter(x => x.estatus === 'Declinó').length, nc: v.filter(x => x.estatus === 'No contesta').length, ce: ce.length }; });
    h += tbl('t-ig', [{ h: VER.find(x => x[0] === vista)[1], t: 1, v: r => r.n, w: 230, r: r => `<b>${esc(r.n)}</b>` }, { h: 'Candidatos', v: r => r.tot }, { h: '⏳ Pendientes', v: r => r.pr }, { h: '🙌 Ingresos', v: r => r.i, r: r => `<b class="cell-green">${r.i}</b>` }, { h: '📈 Conversión', v: r => pn(r.i, r.ce), r: r => r.ce ? `<span class="pill ${r.i / r.ce >= 0.75 ? 'g' : r.i / r.ce >= 0.6 ? 'a' : 'r'}">${(r.i / r.ce * 100).toFixed(0)}%</span>` : '—' }, { h: '🚫 No llegó', v: r => r.nl }, { h: '✖️ Declinó', v: r => r.d }, { h: '📵 No contesta', v: r => r.nc }],
      rows, { fix: 1, csv: 1, png: 1, file: 'posibles_ingresos_' + vista, titulo: 'Posibles ingresos por ' + VER.find(x => x[0] === vista)[1], sort: 3, dir: -1, maxh: '65vh' });
  }
  const dd = IG.dd && IG.dd === IG.dh ? IG.dd : null;
  h += sect('Esquema por región, gerente y cadena', '🗺️') + `<p class="note">Igual al que se envía a Operaciones. ${dd ? '' : 'Elige un solo día arriba (mismas fecha en ambos campos) para el esquema del día; mientras tanto suma el periodo.'}</p><div class="tools" data-nocap><button class="btn sm" onclick="capturaDescargar($('esq-wrap'),'Esquema de posibles ingresos',subFiltros(),'esquema_ingresos')">📸 Imagen</button><button class="btn sm" onclick="capturaCopiar($('esq-wrap'),'Esquema de posibles ingresos',subFiltros())">📋 Copiar</button></div><div id="esq-wrap" class="cap-pad">${esquemaHtml(base.filter(c => PEND.includes(c.estatus) || c.estatus === 'Ingresó'), 'POSIBLES INGRESOS')}</div>`;
  $('ig-body').innerHTML = h; drawAll();
}

/* >>> 06_movs.js */
/* ====================================================================== INGRESOS Y BAJAS ====================================================================== */
const MVX = { ver: 'region', dia: null };
const DIMV = [['region', 'Región'], ['gerente', 'Gerente / Líder'], ['supervisor', 'Supervisor'], ['zona_rrhh', 'Gerencia RR.HH.'], ['rrhh', 'RR.HH.'], ['cadena', 'Cadena'], ['estado', 'Estado']];
const enR = (arr, d, h) => arr.filter(x => x.f >= d && x.f <= h && okI(x.idpdv));
async function vMovs() {
  await conReporte('Ingresos y bajas', 'saltando', async () => {
    await cargarMovs();
    const r = perRango(), dias = r.dias.length, ing = enR(MV.ing, r.desde, r.hasta), baj = enR(MV.baj, r.desde, r.hasta), hc = hcPromX(r, () => true);
    const pd = addD(r.desde, -dias), ph = addD(r.desde, -1), ingP = enR(MV.ing, pd, ph).length, bajP = enR(MV.baj, pd, ph).length;
    const semanas = []; if (dias <= 10) { r.dias.forEach(d => semanas.push({ l: d.slice(8) + '/' + d.slice(5, 7), d, h: d })); } else { const W = ventana(); W.forEach(w => { const s = rangoSemanaDe(W.indexOf(w)); if (s.hasta >= r.desde && s.desde <= r.hasta) semanas.push({ l: w.w.slice(3), d: s.desde < r.desde ? r.desde : s.desde, h: s.hasta > r.hasta ? r.hasta : s.hasta }); }); }
    const si = semanas.map(s => enR(MV.ing, s.d, s.h).length), sb_ = semanas.map(s => enR(MV.baj, s.d, s.h).length);
    let h = cab('Ingresos y bajas', 'Ingresos (candidatos que ingresaron) y bajas registradas, con rotación, comparativos por semana y por cadena. Sirve de base para los cierres diarios y semanales.', 'saltando') + barraFiltros('vMovs') + barraPeriodo('vMovs', { dia: true });
    h += `<div class="kpis kp-hero">${kp('Ingresos', fmt(ing.length), `${dl(ing.length, ingP, 0).replace('pts', '')}`.replace('vs ant.', 'vs periodo anterior (' + ingP + ')'), C.gr, null, '🙌')}${kp('Bajas', fmt(baj.length), `${dl(baj.length, bajP, 0).replace('pts', '').replace('vs ant.', 'vs periodo anterior (' + bajP + ')')}`, C.rd, null, '📤')}${kp('Neto', (ing.length - baj.length >= 0 ? '+' : '') + (ing.length - baj.length), 'ingresos − bajas', ing.length - baj.length >= 0 ? C.gr : C.rd, null, '⚖️')}${kp('Rotación del periodo', hc ? f1(baj.length / hc * 100) + '%' : '—', `${baj.length} bajas ÷ ${fmt(hc)} HC promedio`, C.am, null, '🔄')}</div>`;
    const rotS = semanas.map(s => { const hcS = hcPromX({ desde: s.d, hasta: s.h }, () => true); return hcS ? enR(MV.baj, s.d, s.h).length / hcS * 100 : null; });
    h += `<div class="grid g2"><div class="card"><h3>📊 Ingresos, bajas y rotación por ${dias <= 10 ? 'día' : 'semana'}</h3><p class="note">Barras: cantidad. Línea naranja: % de rotación (eje derecho) con su tendencia punteada.</p>${legend([['Ingresos', C.gr], ['Bajas', C.rd], ['Rotación %', C.od], ['Tendencia', C.dk]])}${chart(semanas.map(s => s.l), [{ n: 'Ingresos', c: C.gr, v: si }, { n: 'Bajas', c: C.rd, v: sb_ }], { bars: 1, vals: 1, h: 320, ticks: 16, band: 1, lines2: [{ n: 'Rotación %', c: C.od, v: rotS, trend: 1 }], y2: { pct: 1 } })}</div>
      <div class="card"><h3>🔄 Rotación ${dias <= 10 ? 'diaria' : 'semanal'} y tendencia</h3><p class="note">Bajas ÷ promotores con check (HC promedio). Si la línea punteada baja, la rotación va mejorando.</p>${chart(semanas.map(s => s.l), [{ n: 'Rotación %', c: C.od, v: rotS }], { pct: 1, h: 320, vals: 1, ticks: 16 })}</div></div>`;
    const cads = [...new Set(R.T.filter(x => okT(x.t)).map(x => x.t.cadena).filter(Boolean))];
    const cr = cads.map(c => { const i = ing.filter(x => (tienda(x.idpdv) || {}).cadena === c).length, b = baj.filter(x => (tienda(x.idpdv) || {}).cadena === c).length, hcC = hcPromX(r, t => t.cadena === c); return { c, i, b, rot: hcC ? b / hcC * 100 : null }; }).sort((a, b) => b.i + b.b - a.i - a.b);
    const mot = {}; baj.forEach(x => mot[x.mot] = (mot[x.mot] || 0) + 1); const PAL = [C.or, C.bl, C.rd, C.pu, C.te, C.am, C.gr, C.gy];
    const mi = Object.entries(mot).sort((a, b) => b[1] - a[1]); const top = mi.slice(0, 6).map(([n, v], i) => ({ n, v, c: PAL[i] })); const rest = mi.slice(6).reduce((a, b) => a + b[1], 0); if (rest) top.push({ n: 'Otros', v: rest, c: C.gy });
    h += `<div class="grid g2"><div class="card"><h3>🏬 Por cadena</h3>${cr.map(q => `<div class="cadena-row">${logoCad(q.c)}<div class="dual"><div class="d-i" style="width:${Math.max(3, q.i / Math.max(1, ...cr.map(z => z.i + z.b)) * 100)}%"><span>${q.i}</span></div><div class="d-b" style="width:${Math.max(3, q.b / Math.max(1, ...cr.map(z => z.i + z.b)) * 100)}%"><span>${q.b}</span></div></div><span class="muted" style="min-width:92px;text-align:right">rot. ${f1(q.rot)}%</span></div>`).join('')}<p class="tblnote">🟩 ingresos · 🟥 bajas</p></div>
      <div class="card"><h3>📤 Motivos de baja</h3>${donut(top, { sub: 'bajas', best: 1 })}</div></div>`;
    // tabla por vista de estructura
    h += sect('Ingresos y bajas por estructura', '🧾') + `<div class="tools" data-nocap><span>Ver por:</span><select onchange="MVX.ver=this.value;vMovs()">${DIMV.map(([k, n]) => `<option value="${k}" ${MVX.ver === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
    const keys = [...new Set(R.T.filter(x => okT(x.t)).map(x => x.t[MVX.ver]).filter(Boolean))];
    const rows = keys.map(k => { const i = ing.filter(x => (tienda(x.idpdv) || {})[MVX.ver] === k).length, b = baj.filter(x => (tienda(x.idpdv) || {})[MVX.ver] === k).length, hcK = hcPromX(r, t => t[MVX.ver] === k); return { n: k, i, b, net: i - b, hc: hcK, rot: hcK ? b / hcK * 100 : null }; }).filter(q => q.i || q.b);
    TB = {};
    h += tbl('t-mv', [{ h: DIMV.find(x => x[0] === MVX.ver)[1], t: 1, v: q => q.n, w: 240, r: q => `<b>${esc(q.n)}</b>` }, { h: '🙌 Ingresos', v: q => q.i, r: q => `<b class="cell-green">${q.i}</b>` }, { h: '📤 Bajas', v: q => q.b, r: q => `<b class="cell-red">${q.b}</b>` }, { h: '⚖️ Neto', v: q => q.net, r: q => `<span class="${q.net < 0 ? 'cell-red' : 'cell-green'}">${q.net > 0 ? '+' : ''}${q.net}</span>` }, { h: 'HC promedio', v: q => q.hc, r: q => fmt(q.hc) }, { h: '🔄 Rotación', v: q => q.rot, r: q => q.rot == null ? '—' : `<span class="bar-pct ${q.rot > 40 ? 'ko' : q.rot > 25 ? 'wa' : 'ok'}">${f1(q.rot)}%</span>` }],
      rows, { fix: 1, csv: 1, png: 1, file: 'ingresos_bajas_estructura', titulo: 'Ingresos y bajas por ' + DIMV.find(x => x[0] === MVX.ver)[1], sort: 1, dir: -1, maxh: '60vh' });
    // cierre: una sola tabla expandible (región > gerente > supervisor > tienda) con una columna por cadena, del periodo elegido arriba
    const met = MVX.met || 'i', METN = { i: '🙌 Ingresos', b: '📤 Bajas', n: '⚖️ Neto' };
    const items = [...(met === 'b' ? [] : ing).map(x => ({ idpdv: x.idpdv, tipo: 'i' })), ...(met === 'i' ? [] : baj).map(x => ({ idpdv: x.idpdv, tipo: 'b' }))];
    const cadX = [...CADS, ...new Set(items.map(x => (tienda(x.idpdv) || {}).cadena).filter(c => c && !CADS.includes(c)))];
    const cnt = (a, c, t) => a.filter(x => x.tipo === t && (!c || (tienda(x.idpdv) || {}).cadena === c)).length;
    const fm = c => a => met === 'n' ? cnt(a, c, 'i') - cnt(a, c, 'b') : cnt(a, c, met);
    const nf = v => (v > 0 ? '+' : '') + v;
    const colsX = [...cadX.map(c => ({ h: c, f: fm(c), cero: met === 'n', fmt: met === 'n' ? nf : null })), { h: 'Total general', f: fm(null), cero: true, fmt: met === 'n' ? nf : null }];
    const perT = PER.modo === 'semana' ? 'Semana ' + ventana()[PER.sem == null ? ventana().length - 1 : PER.sem].w + ' · ' : PER.modo === 'mes' ? mlabel(PER.mes || r.hasta.slice(0, 7)) + ' · ' : '';
    const perL = perT + (r.desde === r.hasta ? fdia(r.desde) : fdate(r.desde) + ' al ' + fdate(r.hasta));
    const tt = `${METN[met].replace(/^\S+ /, '')} · ${perL}`;
    h += sect('Cierre por región, gerente, supervisor y tienda', '📸') + `<p class="note">Sigue el periodo de arriba: semana → cierre semanal, mes → mensual, día → diario, o un rango.</p><div class="tools" data-nocap><div class="seg">${Object.entries(METN).map(([k, n]) => `<button class="${met === k ? 'on' : ''}" onclick="MVX.met='${k}';vMovs()">${n}</button>`).join('')}</div><span class="tb-btns"><button class="btn sm" onclick="capturaDescargar($('cierre-x'),'Cierre · ${tt}',subFiltros(),'cierre_${met}')">📸 Imagen</button><button class="btn sm" onclick="capturaCopiar($('cierre-x'),'Cierre · ${tt}',subFiltros())">📋 Copiar</button></span></div><div id="cierre-x" class="cap-pad"><div class="cierre-t">${esc(tt)}</div>${arbol(items, colsX, { titulo: 'REGIÓN / GERENTE / SUPERVISOR / TIENDA', abrir: 2 })}</div>`;
    $('content').innerHTML = h; drawAll();
  });
}
function semanaCierre(d) { const W = ventana(); let i = W.findIndex(w => addD(w.ini, 6) >= d && w.ini <= d); if (i < 0) i = W.length - 1; const s = rangoSemanaDe(i); return { w: W[i].w, ...s }; }

/* >>> 08_demo_reportes.js */
/* ----- datos de ejemplo para reportes, ingresos y movimientos (todo ficticio) ----- */
(function () {
  const rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  let cache = null;
  const monday = d => { const x = new Date(d + 'T12:00:00'); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
  const NW = 13;
  function build() {
    const tiendas = Object.values(S.cat.tiendas); const m0 = monday(HOY);
    const ventana = Array.from({ length: NW }, (_, k) => ({ w: '26-S' + (28 + k), ini: addD(m0, -7 * (NW - 1 - k)) }));
    const sa = Array.from({ length: 40 }, (_, k) => ({ w: '26-S' + pad(k + 1), ini: addD(m0, -7 * (39 - k)) }));
    const f0 = addD(HOY, -93), nd = 94, nCd = diffD(HOY, ventana[0].ini) + 1;
    const meses = []; for (let i = 3; i >= 0; i--) { const d = new Date(HOY + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() - i); meses.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
    const tien = tiendas.map(t => {
      const ps = t.posiciones, cuota = ps * 6;
      const sem = ventana.map(w => [0, 0, cuota, ps * 9, 0, 0, 0, 0, w.ini]);
      const chk = ventana.map(() => { const d = ri(4, 13), c = Math.round(d * (0.8 + rnd() * 0.2)), pr = ri(0, 3); const e = Array.from({ length: 9 }, () => ri(0, 2)); e[0] = c; return [ri(1, 3), d, c, pr, 0, ...e]; });
      let cd = ''; for (let q = 0; q < nCd; q++) cd += rnd() < 0.84 ? String(ri(1, ps + 1)) : '0';
      if (t.idpdv % 7 === 0) cd = cd.slice(0, nCd - 5) + '00000'; if (t.idpdv % 5 === 0) cd = cd.slice(0, nCd - 4) + '0000'; if (t.idpdv % 6 === 0) cd = cd.slice(0, nCd - 3) + '000';
      let dias = ''; for (let i = 0; i < nd; i++) dias += rnd() < 0.8 ? 'C' : '0'; dias = dias.slice(0, nd - nCd % 7) ;
      const tail = cd.match(/0+$/); const ra0 = tail ? tail[0].length : 0;
      const pen = meses.map((m, k) => { const act = k === meses.length - 1; const mx = act ? ra0 : ri(0, 6); const e = mx >= 5 ? 2 : mx >= 3 ? 1 : 0;
        return { m, e, pa: mx >= 3 ? `${ri(1, 20)} al ${ri(21, 28)} ${MESN[+m.slice(5) - 1]}.` : null, dr: mx >= 3 ? mx : 0, mx, pm: mx >= 2 ? `${ri(1, 10)} al ${ri(11, 20)} ${MESN[+m.slice(5) - 1]}.` : null, ds: ri(mx, mx + 5), ul: addD(HOY, -ra0 - 1), uf: act ? addD(HOY, -ra0 - 1) : null, ue: act ? (rnd() < 0.85 ? 'Cumple Original' : 'Abierto') : null, ra: act ? ra0 : 0, hoy: act ? ['A', 'E', '0', '0'][ri(0, 3)] : null, rs: mx >= 2 ? [[mx, addD(HOY, -mx), addD(HOY, -1)]] : [], act }; });
      return { idpdv: t.idpdv, semanas: sem, chk: { s: chk, cd }, dias, hc_sem: sa.map(() => ri(1, 3)), pen };
    });
    const nom = ['Ana Solís', 'Luis Ortega', 'María Cruz', 'José Reyes', 'Daniela Ruiz', 'Carlos Mora', 'Paola Estrada', 'Jorge Lara', 'Valeria Núñez', 'Diego Gil', 'Karla Vega', 'Miguel Soto', 'Fátima Luna', 'Ricardo Salas', 'Brenda Morales'];
    const hc = Array.from({ length: 70 }, (_, i) => { const t = tiendas[i % tiendas.length]; const dsc = i % 9 === 0 ? ri(2, 12) : i % 5 === 0 ? 1 : 0; const aus = i % 11 === 0; const alta = i % 4 === 0 ? ri(1, 27) : ri(30, 900); return { usuario: 'DEMO' + (100 + i), nombre: nom[i % 15] + ' ' + (i + 1), fecha_alta: addD(HOY, -alta), baja_final: i % 6 === 0 ? addD(HOY, -ri(200, 600)) : null, estatus_modelo: 'Activo', tipo_ingreso: i % 6 === 0 ? 'Reingreso' : 'Nuevo', empresa: ['Benber SS', 'Revelor', 'Doma Legal'][i % 3], ultimo_check: addD(HOY, -dsc), ultimo_idpdv: t.idpdv, ausencia_dias: aus ? 5 : null, ausencia_regreso: aus ? addD(HOY, 2) : null, ausencia_motivo: aus ? 'Vacaciones' : null, rol: i % 8 === 0 ? 'Cubre descansos' : 'Promotor' }; });
    const uc = hc.map(h => ({ usuario: h.usuario, fecha: h.ultimo_check, idpdv: h.ultimo_idpdv, rol: h.rol, hora_in: '09:' + pad(ri(0, 55)) + ':00', hora_out: '18:' + pad(ri(0, 50)) + ':00', estatus_check: rnd() < 0.8 ? 'Cumple' : 'Error Comida', validacion: 'Cumple' }));
    return { meta: { ventana, cd_desde: ventana[0].ini, ultima_fecha: HOY, dias_desde: f0, dias_n: nd, hoy: HOY, estatus_check: [], semanas_anio: sa, generado: 'datos de ejemplo' }, tiendas: tien, hc, uc, bajas: [] };
  }
  Demo.reporte = async function () { if (!cache) cache = build(); return cache; };
  Demo.movs = async function () {
    const t = Object.values(S.cat.tiendas), ing = [], baj = [];
    for (let d = -100; d <= 0; d++) { const f = addD(HOY, d); for (let k = 0; k < ri(6, 14); k++) { const x = t[ri(0, t.length - 1)]; ing.push({ f, idpdv: x.idpdv, rec: ri(1, 8), fu: ri(1, 9) }); } for (let k = 0; k < ri(6, 15); k++) { const x = t[ri(0, t.length - 1)]; baj.push({ f, idpdv: x.idpdv, mot: ['Motivos personales', 'Abandono de trabajo', 'Renuncia voluntaria', 'Mejor oferta laboral (telefonía)', 'Malas prácticas'][ri(0, 4)], u: 'D' + k }); } }
    return { ing, baj };
  };
  Demo.checks = async function (desde, hasta) {
    const out = []; const tiendas = Object.values(S.cat.tiendas).slice(0, 30); let k = 0;
    for (let d = 0; d < 7; d++) { const f = addD(desde, d); if (f > HOY || f > hasta) continue; tiendas.forEach(t => { for (let n = 0; n < 2; n++) { k++; const r = rnd(); const est = r < 0.78 ? 'Cumple' : r < 0.84 ? 'Error Comida' : r < 0.9 ? 'Check Out Fuera Ventana' : r < 0.94 ? 'Tiempo Incompleto' : r < 0.97 ? 'Check In Fuera Rango' : 'Equipo Duplicado'; const v = est === 'Cumple' ? 'Cumple' : (rnd() < 0.5 && !/Rango|Duplicado/.test(est) ? 'Cumple Productividad' : 'No Cumple'); const reg = v === 'Cumple Productividad' ? ri(1, 4) : (rnd() < 0.4 ? ri(0, 3) : 0);
      out.push({ id: 'k' + k + f, semana: '', fecha: f, usuario: 'DEMO' + (100 + (k % 60)), nombre: ['Ana Solís', 'Luis Ortega', 'María Cruz', 'José Reyes'][k % 4] + ' ' + (k % 60), idpdv: t.idpdv, rol: 'Promotor', hora_in: '09:' + pad(ri(0, 59)) + ':10', hora_com_in: '13:' + pad(ri(0, 30)) + ':00', hora_com_out: '14:' + pad(ri(0, 30)) + ':00', hora_out: '18:' + pad(ri(0, 59)) + ':00', tiempo_ub: est === 'Tiempo Incompleto' ? ri(300, 470) : ri(480, 560), tiempo_com: ri(10, 60), rango_in: est === 'Check In Fuera Rango' ? 'Fuera de Rango' : 'Dentro de Rango', rango_out: 'Dentro de Rango', equipo_dup: est === 'Equipo Duplicado', estatus_check: est, validacion: v, estatus_final: v, registros: reg, temm: Math.min(reg, 1), porta: reg > 1 ? 1 : 0, pospago: 0, prepago: Math.max(0, reg - 1), check_tel: 0 }); } }); }
    return out;
  };
})();

/* >>> 99_init.js */
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


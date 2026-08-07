/* Ingresos y Egresos — consultorio y vida personal
 *
 * Todo vive en IndexedDB, dentro del teléfono. No hay red, no hay servidor,
 * no hay cuenta. La única forma de que un dato salga de aquí es que tú lo
 * exportes a propósito con el botón de respaldo.
 *
 * Dos secciones separadas — Consultorio y Personal — que no se mezclan nunca.
 *
 * Los montos se guardan en CENTAVOS como enteros. Nunca en decimales:
 * 0.1 + 0.2 no da 0.3 en coma flotante, y esto es dinero.
 */

'use strict';

/* ── Constantes ─────────────────────────────────────── */

const DB_NAME = 'consultorio-finanzas';
const DB_VER = 1;

const AMBITOS = ['consultorio', 'personal'];
const NOMBRE_AMBITO = { consultorio: 'Consultorio', personal: 'Personal' };
const COLOR_AMBITO = { consultorio: '#0E6E7D', personal: '#4B54A6' };

const CATS_DEFAULT = {
  consultorio: {
    ingreso: ['Consulta', 'Limpieza', 'Resina', 'Endodoncia', 'Ortodoncia', 'Extracción', 'Prótesis', 'Otro'],
    egreso: ['Laboratorio', 'Insumos', 'Renta', 'Sueldos', 'Servicios', 'Equipo', 'Publicidad', 'Otro'],
  },
  personal: {
    ingreso: ['Retiro del consultorio', 'Otro ingreso'],
    egreso: ['Comida', 'Casa', 'Transporte', 'Salud', 'Familia', 'Entretenimiento', 'Ropa', 'Educación', 'Ahorro', 'Otro'],
  },
};

const COMP_VACIO = () => ({ fijos: [], msi: [], tarjetas: [] });

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const NUM = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const money = (c) => MXN.format(c / 100);
const plain = (c) => NUM.format(c / 100);
const clonar = (o) => JSON.parse(JSON.stringify(o));
const nuevoId = () => (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);

/** Fecha local en YYYY-MM-DD. Nunca toISOString(): eso da UTC y en México
 *  adelanta el día por la tarde, guardando el movimiento en la fecha equivocada. */
function hoyISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const periodoDe = (iso) => iso.slice(0, 7);
const periodoHoy = () => hoyISO().slice(0, 7);

/** Meses enteros entre dos periodos 'YYYY-MM'. */
function mesesEntre(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

function sumaMeses(periodo, n) {
  const [y, m] = periodo.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const nombrePeriodo = (p) => {
  const [y, m] = p.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
};

function etiquetaFecha(iso) {
  if (iso === hoyISO()) return 'Hoy';
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (iso === hoyISO(ayer)) return 'Ayer';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MES3[m - 1]} ${y}`;
}

/** Días de aquí al próximo día `dia` del mes. 0 = hoy. */
function diasParaDia(dia) {
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const ultimoDeEste = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const objetivoEste = Math.min(dia, ultimoDeEste);
  if (diaHoy <= objetivoEste) return objetivoEste - diaHoy;
  const ultimoDelQue = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0).getDate();
  const objetivoSig = Math.min(dia, ultimoDelQue);
  const fSig = new Date(hoy.getFullYear(), hoy.getMonth() + 1, objetivoSig);
  return Math.round((fSig - new Date(hoy.getFullYear(), hoy.getMonth(), diaHoy)) / 86400000);
}

/* ── Base de datos ──────────────────────────────────── */

let db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('mov')) {
        const s = d.createObjectStore('mov', { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
      }
      if (!d.objectStoreNames.contains('cfg')) d.createObjectStore('cfg', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, modo, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const todosMov = () => tx('mov', 'readonly', (s) => s.getAll());
const guardarMov = (m) => tx('mov', 'readwrite', (s) => s.put(m));
const borrarMov = (id) => tx('mov', 'readwrite', (s) => s.delete(id));

async function leerCfg(k, fallback) {
  const r = await tx('cfg', 'readonly', (s) => s.get(k));
  return r && r.v !== undefined ? r.v : fallback;
}

const escribirCfg = (k, v) => tx('cfg', 'readwrite', (s) => s.put({ k, v }));

/* ── Estado ─────────────────────────────────────────── */

const estado = {
  ambito: 'consultorio',
  tipo: 'ingreso',
  centavos: 0,
  categoria: null,
  fecha: hoyISO(),
  cats: clonar(CATS_DEFAULT),
  comp: { consultorio: COMP_VACIO(), personal: COMP_VACIO() },
  movs: [],
  mes: { y: new Date().getFullYear(), m: new Date().getMonth() },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const catsActuales = () => (estado.cats[estado.ambito] && estado.cats[estado.ambito][estado.tipo]) || [];
const movsAmbito = () => estado.movs.filter((m) => m.ambito === estado.ambito);
const compAmbito = () => estado.comp[estado.ambito] || COMP_VACIO();
const periodoVista = () => `${estado.mes.y}-${String(estado.mes.m + 1).padStart(2, '0')}`;

const guardarComp = () => escribirCfg('compromisos', estado.comp);

let toastT = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Lee un monto escrito por el usuario y lo pasa a centavos enteros. */
function aCentavos(txt) {
  const limpio = String(txt).replace(/[^\d.,-]/g, '').replace(/,/g, '.');
  const n = parseFloat(limpio);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/* ── Migración ──────────────────────────────────────── */

async function migrar(catsGuardadas) {
  let cats;
  if (catsGuardadas && (catsGuardadas.consultorio || catsGuardadas.personal)) {
    cats = catsGuardadas;
  } else if (catsGuardadas && (catsGuardadas.ingreso || catsGuardadas.egreso)) {
    cats = {
      consultorio: {
        ingreso: catsGuardadas.ingreso || clonar(CATS_DEFAULT.consultorio.ingreso),
        egreso: catsGuardadas.egreso || clonar(CATS_DEFAULT.consultorio.egreso),
      },
      personal: clonar(CATS_DEFAULT.personal),
    };
    await escribirCfg('cats', cats);
  } else {
    cats = clonar(CATS_DEFAULT);
  }
  for (const a of AMBITOS) {
    if (!cats[a]) cats[a] = clonar(CATS_DEFAULT[a]);
    for (const t of ['ingreso', 'egreso']) {
      if (!Array.isArray(cats[a][t])) cats[a][t] = clonar(CATS_DEFAULT[a][t]);
    }
  }
  estado.cats = cats;

  const sinAmbito = estado.movs.filter((m) => !m.ambito);
  for (const m of sinAmbito) {
    m.ambito = 'consultorio';
    await guardarMov(m);
  }
}

/* ── Compromisos: cálculos ──────────────────────────── */

/** Mensualidad de una compra a meses. La última absorbe el redondeo para
 *  que la suma de todas dé exactamente el total. */
function cuotaMsi(m, indice) {
  const base = Math.round(m.totalCentavos / m.meses);
  if (indice < m.meses - 1) return base;
  return m.totalCentavos - base * (m.meses - 1);
}

/** Qué número de cuota toca en un periodo, o null si no aplica. */
function indiceCuota(m, periodo) {
  const i = mesesEntre(m.inicio, periodo);
  return i >= 0 && i < m.meses ? i : null;
}

const pagoRegistrado = (tipo, id, periodo) =>
  estado.movs.find((mv) => mv.origen && mv.origen.tipo === tipo && mv.origen.id === id && mv.origen.periodo === periodo);

const cuotasPagadas = (m) =>
  estado.movs.filter((mv) => mv.origen && mv.origen.tipo === 'msi' && mv.origen.id === m.id).length;

function saldoMsi(m) {
  const pagadas = cuotasPagadas(m);
  let s = 0;
  for (let i = pagadas; i < m.meses; i++) s += cuotaMsi(m, i);
  return s;
}

/** Todo lo comprometido en un periodo: fijos + cuotas de ese mes. */
function compromisosDe(periodo) {
  const c = compAmbito();
  const filas = [];
  for (const f of c.fijos) {
    filas.push({ tipo: 'fijo', ref: f, nombre: f.nombre, centavos: f.centavos, dia: f.dia, pagado: !!pagoRegistrado('fijo', f.id, periodo) });
  }
  for (const m of c.msi) {
    const i = indiceCuota(m, periodo);
    if (i === null) continue;
    filas.push({
      tipo: 'msi', ref: m, nombre: m.nombre, centavos: cuotaMsi(m, i), dia: null,
      pagado: !!pagoRegistrado('msi', m.id, periodo), cuota: i + 1, de: m.meses,
    });
  }
  return filas;
}

/* ── Salud: métricas ────────────────────────────────── */

function movsDelPeriodo(p) {
  return movsAmbito().filter((x) => x.fecha.startsWith(p));
}

function totalesDe(p) {
  const ms = movsDelPeriodo(p);
  const entro = ms.filter((m) => m.tipo === 'ingreso').reduce((a, b) => a + b.centavos, 0);
  const salio = ms.filter((m) => m.tipo === 'egreso').reduce((a, b) => a + b.centavos, 0);
  return { entro, salio, neto: entro - salio, ms };
}

/** Margen en porcentaje, o null si no entró nada (dividir entre cero miente). */
function margenDe(p) {
  const { entro, neto } = totalesDe(p);
  return entro > 0 ? (neto / entro) * 100 : null;
}

function lecturaMargen(m) {
  if (m === null) return { txt: 'Sin ingresos este mes', cls: '' };
  if (m < 0) return { txt: 'En pérdida', cls: 'neg' };
  if (m < 10) return { txt: 'Apretado', cls: 'neg' };
  if (m < 30) return { txt: 'Justo', cls: '' };
  return { txt: 'Sano', cls: 'pos' };
}

/* ── Pintado: capturar ──────────────────────────────── */

function pintarMonto() {
  $('#montoOut').textContent = plain(estado.centavos);
  $('#guardarBtn').disabled = estado.centavos <= 0 || !estado.categoria;
}

function pintarChips() {
  const cont = $('#chips');
  cont.innerHTML = '';
  const lista = catsActuales();
  if (!lista.includes(estado.categoria)) estado.categoria = null;
  for (const c of lista) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c === estado.categoria ? ' is-on' : '');
    b.textContent = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === estado.categoria));
    b.addEventListener('click', () => { estado.categoria = c; pintarChips(); pintarMonto(); });
    cont.appendChild(b);
  }
}

function setTipo(t) {
  estado.tipo = t;
  document.body.classList.toggle('t-ingreso', t === 'ingreso');
  document.body.classList.toggle('t-egreso', t === 'egreso');
  $$('.seg[data-tipo]').forEach((b) => {
    const on = b.dataset.tipo === t;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  pintarChips();
  pintarMonto();
  pintarCategorias();
}

function tecla(k) {
  if (k === 'del') {
    estado.centavos = Math.floor(estado.centavos / 10);
  } else {
    const add = k === '00' ? 2 : 1;
    let n = estado.centavos;
    for (let i = 0; i < add; i++) n = n * 10;
    n += Number(k === '00' ? 0 : k);
    if (n > 99999999999) return;
    estado.centavos = n;
  }
  pintarMonto();
}

function setFecha(iso) {
  estado.fecha = iso;
  $('#fechaLabel').textContent = etiquetaFecha(iso);
  $('#fechaInput').value = iso;
}

async function guardar() {
  if (estado.centavos <= 0 || !estado.categoria) return;
  const m = {
    id: nuevoId(),
    ambito: estado.ambito,
    tipo: estado.tipo,
    centavos: estado.centavos,
    categoria: estado.categoria,
    fecha: estado.fecha,
    nota: $('#notaInput').value.trim(),
    creado: Date.now(),
  };
  await guardarMov(m);
  estado.movs.push(m);
  toast(`${m.tipo === 'ingreso' ? 'Entró' : 'Salió'} ${money(m.centavos)} · ${m.categoria} · ${NOMBRE_AMBITO[m.ambito]}`);
  estado.centavos = 0;
  $('#notaInput').value = '';
  setFecha(hoyISO());
  pintarMonto();
  pintarSalud();
  pintarHistorial();
  pintarCompromisos();
}

/* ── Pintado: salud ─────────────────────────────────── */

function pintarBarras(cont, ms, tipo) {
  const el = $(cont);
  el.className = 'bars ' + (tipo === 'ingreso' ? 'in' : 'out');
  const filtrados = ms.filter((m) => m.tipo === tipo);
  if (filtrados.length === 0) {
    el.innerHTML = '<p class="empty">Nada registrado este mes.</p>';
    return;
  }
  const porCat = new Map();
  for (const m of filtrados) porCat.set(m.categoria, (porCat.get(m.categoria) || 0) + m.centavos);
  const orden = [...porCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = orden[0][1];
  el.innerHTML = '';
  for (const [cat, cents] of orden) {
    const row = document.createElement('div');
    row.className = 'bar';
    const top = document.createElement('div');
    top.className = 'bar-top';
    const name = document.createElement('span');
    name.textContent = cat;
    const val = document.createElement('b');
    val.textContent = money(cents);
    top.append(name, val);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = Math.max(3, Math.round((cents / max) * 100)) + '%';
    track.appendChild(fill);
    row.append(top, track);
    el.appendChild(row);
  }
}

function ficha(k, v, lect, cls, ancho) {
  const d = document.createElement('div');
  d.className = 'kpi' + (ancho ? ' ancho' : '');
  const a = document.createElement('span');
  a.className = 'kpi-k';
  a.textContent = k;
  const b = document.createElement('span');
  b.className = 'kpi-v' + (cls ? ' ' + cls : '');
  b.textContent = v;
  const c = document.createElement('span');
  c.className = 'kpi-lect';
  c.textContent = lect;
  d.append(a, b, c);
  return d;
}

function pintarKpis(p) {
  const cont = $('#kpis');
  cont.innerHTML = '';
  const { entro, salio } = totalesDe(p);
  const ms = movsDelPeriodo(p);

  // 1. Comprometido: lo que ya está apalabrado antes de empezar el mes.
  const comps = compromisosDe(p);
  const comprometido = comps.reduce((a, b) => a + b.centavos, 0);
  if (comprometido > 0) {
    const pct = entro > 0 ? Math.round((comprometido / entro) * 100) : null;
    cont.appendChild(ficha(
      'Comprometido',
      pct === null ? money(comprometido) : pct + '%',
      pct === null
        ? `${money(comprometido)} en gastos fijos y mensualidades.`
        : `De cada $100 que entran, $${pct} ya estaban comprometidos.`,
      pct !== null && pct > 70 ? 'neg' : '',
    ));
  }

  // 2. Razón de gasto
  if (entro > 0) {
    const r = Math.round((salio / entro) * 100);
    cont.appendChild(ficha('Razón de gasto', r + '%', `Por cada $100 que entran, salen $${r}.`, r > 100 ? 'neg' : ''));
  }

  // 3. Concentración: depender de una sola fuente es frágil.
  const porCat = new Map();
  for (const m of ms) if (m.tipo === 'ingreso') porCat.set(m.categoria, (porCat.get(m.categoria) || 0) + m.centavos);
  if (porCat.size > 0 && entro > 0) {
    const [topCat, topVal] = [...porCat.entries()].sort((a, b) => b[1] - a[1])[0];
    const pct = Math.round((topVal / entro) * 100);
    cont.appendChild(ficha(
      'Concentración',
      pct + '%',
      pct > 60
        ? `${topCat} carga el ${pct}% de tus ingresos. Si eso se cae, se cae el mes.`
        : `Tu mayor fuente es ${topCat}, con ${pct}%.`,
      pct > 60 ? 'neg' : '',
    ));
  }

  // 4. Tendencia contra el promedio de los 3 meses previos que sí tengan datos.
  const previos = [];
  for (let i = 1; i <= 3; i++) {
    const t = totalesDe(sumaMeses(p, -i));
    if (t.entro > 0) previos.push(t.entro);
  }
  if (previos.length > 0 && entro > 0) {
    const prom = previos.reduce((a, b) => a + b, 0) / previos.length;
    const delta = Math.round(((entro - prom) / prom) * 100);
    cont.appendChild(ficha(
      'Tendencia',
      (delta >= 0 ? '+' : '') + delta + '%',
      `Entró ${delta >= 0 ? 'más' : 'menos'} que el promedio de los ${previos.length} meses anteriores.`,
      delta >= 0 ? 'pos' : 'neg',
    ));
  }

  // 5. Días con ingreso: muchos días chicos es más sano que un día grande.
  const dias = new Set(ms.filter((m) => m.tipo === 'ingreso').map((m) => m.fecha)).size;
  if (dias > 0) {
    const [yy, mm] = p.split('-').map(Number);
    const esActual = p === periodoHoy();
    const totalDias = esActual ? new Date().getDate() : new Date(yy, mm, 0).getDate();
    cont.appendChild(ficha(
      'Días con ingreso',
      `${dias} de ${totalDias}`,
      dias <= 3 ? 'Muy concentrado en pocos días.' : 'Ingreso repartido a lo largo del mes.',
    ));
  }

  // 6. Deuda a meses pendiente
  const msis = compAmbito().msi.filter((m) => saldoMsi(m) > 0);
  if (msis.length > 0) {
    const saldo = msis.reduce((a, b) => a + saldoMsi(b), 0);
    const ultimo = msis.map((m) => sumaMeses(m.inicio, m.meses - 1)).sort().pop();
    cont.appendChild(ficha(
      'Deuda a meses',
      money(saldo),
      `Te liberas por completo en ${nombrePeriodo(ultimo)}.`,
      '', true,
    ));
  }

  if (cont.children.length === 0) {
    cont.innerHTML = '<p class="empty">Captura algunos movimientos y aquí aparecen tus indicadores.</p>';
  }
}

/** Barras divergentes del margen: positivo arriba, negativo abajo, cero real. */
function pintarTendencia(p) {
  const cont = $('#tendencia');
  const datos = [];
  for (let i = 5; i >= 0; i--) {
    const per = sumaMeses(p, -i);
    datos.push({ per, m: margenDe(per) });
  }
  const conDatos = datos.filter((d) => d.m !== null);
  if (conDatos.length < 2) {
    cont.innerHTML = '<p class="empty">Hacen falta al menos dos meses con ingresos para ver la tendencia.</p>';
    $('#tendenciaPie').textContent = 'El margen es lo que queda de cada peso que entra, después de todo lo que sale.';
    return;
  }

  const W = 340, H = 168;
  const top = 20, bot = 128;          // zona de trazo
  const yLab = 150;                    // etiquetas de mes
  const vals = conDatos.map((d) => d.m);
  const maxP = Math.max(0, ...vals);
  const minN = Math.min(0, ...vals);
  const rango = (maxP - minN) || 1;
  const zeroY = top + (maxP / rango) * (bot - top);

  const slot = W / datos.length;
  const bw = Math.min(34, slot * 0.56);

  // Etiquetas selectivas: el mes actual, y el mejor y el peor. Un número
  // sobre cada barra es ruido; estos tres son los que se leen.
  const mejor = conDatos.reduce((a, b) => (b.m > a.m ? b : a));
  const peor = conDatos.reduce((a, b) => (b.m < a.m ? b : a));
  const marcados = new Set([datos[datos.length - 1].per, mejor.per, peor.per]);

  const partes = [];
  partes.push(`<line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="currentColor" stroke-width="1" opacity="0.28"/>`);
  partes.push(`<text x="2" y="${zeroY - 4}" font-size="9" fill="currentColor" opacity="0.45" font-family="ui-monospace,monospace">0%</text>`);

  datos.forEach((d, i) => {
    const cx = i * slot + slot / 2;
    const x = cx - bw / 2;
    const [, mm] = d.per.split('-').map(Number);
    partes.push(`<text x="${cx}" y="${yLab}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.55">${MES3[mm - 1]}</text>`);
    if (d.m === null) return;

    const h = Math.abs(d.m / rango) * (bot - top);
    const pos = d.m >= 0;
    const r = Math.min(4, bw / 2, h);
    const color = pos ? 'var(--in)' : 'var(--out)';
    // Extremo redondeado del lado del dato; el lado de la base va recto.
    const path = pos
      ? `M${x},${zeroY} L${x},${zeroY - h + r} Q${x},${zeroY - h} ${x + r},${zeroY - h} L${x + bw - r},${zeroY - h} Q${x + bw},${zeroY - h} ${x + bw},${zeroY - h + r} L${x + bw},${zeroY} Z`
      : `M${x},${zeroY} L${x},${zeroY + h - r} Q${x},${zeroY + h} ${x + r},${zeroY + h} L${x + bw - r},${zeroY + h} Q${x + bw},${zeroY + h} ${x + bw},${zeroY + h - r} L${x + bw},${zeroY} Z`;
    partes.push(`<path d="${path}" fill="${color}"/>`);

    if (marcados.has(d.per)) {
      const v = Math.round(d.m) + '%';
      const ty = pos ? zeroY - h - 5 : zeroY + h + 12;
      partes.push(`<text x="${cx}" y="${ty}" font-size="10" text-anchor="middle" fill="currentColor" font-family="ui-monospace,monospace">${v}</text>`);
    }
  });

  const ultimo = datos[datos.length - 1];
  cont.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Margen mensual de los últimos seis meses. ` +
    datos.map((d) => `${MES3[Number(d.per.split('-')[1]) - 1]}: ${d.m === null ? 'sin datos' : Math.round(d.m) + ' por ciento'}`).join('; ') +
    `.">${partes.join('')}</svg>`;

  const pie = ultimo.m === null
    ? 'El mes en curso todavía no tiene ingresos capturados.'
    : `Marcados: el mes en curso (${Math.round(ultimo.m)}%), el mejor (${Math.round(mejor.m)}%) y el peor (${Math.round(peor.m)}%).`;
  $('#tendenciaPie').textContent = pie + ' El margen es lo que queda de cada peso que entra.';
}

function pintarSalud() {
  const p = periodoVista();
  const { entro, salio, neto, ms } = totalesDe(p);

  $('#mesLabel').textContent = nombrePeriodo(p);
  $('#totIn').textContent = money(entro);
  $('#totOut').textContent = money(salio);
  $('#totNet').textContent = money(neto);
  $('.tot-net').classList.toggle('neg', neto < 0);

  const m = margenDe(p);
  const lect = lecturaMargen(m);
  const hero = $('#hero');
  hero.classList.remove('pos', 'neg');
  if (lect.cls) hero.classList.add(lect.cls);
  $('#heroV').textContent = m === null ? '—' : Math.round(m) + '%';
  $('#heroLect').textContent = lect.txt;
  $('#heroSub').textContent = m === null
    ? 'Captura ingresos para calcularlo.'
    : `De cada $100 que entraron, te quedaron $${Math.round(m)} después de gastos.`;

  // La marca en la escala: −50% a la izquierda, +50% a la derecha.
  const esc = $('#heroEscala');
  esc.innerHTML = '';
  if (m !== null) {
    const pos = Math.min(100, Math.max(0, ((Math.max(-50, Math.min(50, m)) + 50) / 100) * 100));
    const marca = document.createElement('span');
    marca.className = 'marca';
    marca.style.left = `calc(${pos}% - 1.5px)`;
    esc.appendChild(marca);
  }

  pintarKpis(p);
  pintarTendencia(p);
  pintarBarras('#barsIn', ms, 'ingreso');
  pintarBarras('#barsOut', ms, 'egreso');
}

function moverMes(delta) {
  let { y, m } = estado.mes;
  m += delta;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  estado.mes = { y, m };
  pintarSalud();
}

/* ── Pintado: compromisos ───────────────────────────── */

async function marcarPagado(fila, periodo) {
  const cat = fila.tipo === 'msi' ? 'Otro' : (fila.nombre in {} ? 'Otro' : fila.nombre);
  const cats = estado.cats[estado.ambito].egreso;
  const categoria = cats.includes(cat) ? cat : (cats.includes('Otro') ? 'Otro' : (cats[0] || 'Otro'));

  // La fecha del pago: el día pactado de ese mes, o hoy si es el mes en curso.
  let fecha;
  if (periodo === periodoHoy()) {
    fecha = hoyISO();
  } else {
    const [y, mm] = periodo.split('-').map(Number);
    const ult = new Date(y, mm, 0).getDate();
    fecha = `${periodo}-${String(Math.min(fila.dia || 1, ult)).padStart(2, '0')}`;
  }

  const mov = {
    id: nuevoId(),
    ambito: estado.ambito,
    tipo: 'egreso',
    centavos: fila.centavos,
    categoria,
    fecha,
    nota: fila.tipo === 'msi' ? `${fila.nombre} · cuota ${fila.cuota} de ${fila.de}` : fila.nombre,
    origen: { tipo: fila.tipo, id: fila.ref.id, periodo },
    creado: Date.now(),
  };
  await guardarMov(mov);
  estado.movs.push(mov);
  toast(`Pagado ${money(fila.centavos)} · ${fila.nombre}`);
  pintarCompromisos();
  pintarSalud();
  pintarHistorial();
}

async function deshacerPago(mov) {
  await borrarMov(mov.id);
  estado.movs = estado.movs.filter((x) => x.id !== mov.id);
  toast('Pago deshecho');
  pintarCompromisos();
  pintarSalud();
  pintarHistorial();
}

function filaCompromiso(fila, periodo) {
  const row = document.createElement('div');
  row.className = 'comprow' + (fila.pagado ? ' pagado' : '');

  const main = document.createElement('div');
  main.className = 'cr-main';
  const t = document.createElement('div');
  t.className = 'cr-t';
  t.textContent = fila.nombre;
  const s = document.createElement('div');
  s.className = 'cr-s';
  if (fila.tipo === 'fijo') {
    const d = diasParaDia(fila.dia);
    s.textContent = fila.pagado ? `Día ${fila.dia} · pagado` : `Día ${fila.dia} · ${d === 0 ? 'es hoy' : `en ${d} día${d === 1 ? '' : 's'}`}`;
    if (!fila.pagado && d <= 3) { s.classList.add('urge'); row.classList.add('urge'); }
  } else {
    s.textContent = `Cuota ${fila.cuota} de ${fila.de}`;
  }
  main.append(t, s);

  const acts = document.createElement('div');
  acts.className = 'cr-acts';
  const monto = document.createElement('span');
  monto.className = 'cr-monto';
  monto.textContent = money(fila.centavos);
  acts.appendChild(monto);

  if (fila.pagado) {
    const tag = document.createElement('span');
    tag.className = 'pagado-tag';
    tag.textContent = '✓';
    tag.title = 'Pagado';
    acts.appendChild(tag);
    const und = document.createElement('button');
    und.type = 'button';
    und.className = 'btn-quitar';
    und.textContent = '↺';
    und.setAttribute('aria-label', `Deshacer el pago de ${fila.nombre}`);
    und.addEventListener('click', () => {
      const mv = pagoRegistrado(fila.tipo, fila.ref.id, periodo);
      if (mv && confirm(`¿Deshacer el pago de ${fila.nombre}? Se borra el movimiento.`)) deshacerPago(mv);
    });
    acts.appendChild(und);
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-pagar';
    b.textContent = 'Pagar';
    b.setAttribute('aria-label', `Registrar el pago de ${fila.nombre}`);
    b.addEventListener('click', () => marcarPagado(fila, periodo));
    acts.appendChild(b);
  }

  row.append(main, acts);

  if (fila.tipo === 'msi') {
    const prog = document.createElement('div');
    prog.className = 'cr-prog';
    const pagadas = cuotasPagadas(fila.ref);
    const track = document.createElement('div');
    track.className = 'cr-track';
    const fill = document.createElement('div');
    fill.className = 'cr-fill';
    fill.style.width = Math.round((pagadas / fila.de) * 100) + '%';
    track.appendChild(fill);
    const sub = document.createElement('div');
    sub.className = 'cr-s';
    const saldo = saldoMsi(fila.ref);
    sub.textContent = saldo > 0
      ? `Pagadas ${pagadas} de ${fila.de} · faltan ${money(saldo)} · termina en ${nombrePeriodo(sumaMeses(fila.ref.inicio, fila.de - 1))}`
      : `Liquidada. ${fila.de} de ${fila.de} pagadas.`;
    prog.append(track, sub);
    row.appendChild(prog);
  }

  return row;
}

function pintarCompromisos() {
  const periodo = periodoVista();
  const c = compAmbito();
  const filas = compromisosDe(periodo);

  // Resumen
  const total = filas.reduce((a, b) => a + b.centavos, 0);
  const pagado = filas.filter((f) => f.pagado).reduce((a, b) => a + b.centavos, 0);
  const rc = $('#resumenComp');
  rc.innerHTML = '';
  if (filas.length === 0) {
    rc.innerHTML = '<p class="note">Todavía no registras compromisos. Agrégalos abajo y aparecerán aquí cada mes.</p>';
  } else {
    const k = document.createElement('span');
    k.className = 'rc-k';
    k.textContent = `Comprometido en ${nombrePeriodo(periodo)}`;
    const v = document.createElement('span');
    v.className = 'rc-v';
    v.textContent = money(total - pagado);
    const sub = document.createElement('span');
    sub.className = 'rc-sub';
    sub.textContent = total === pagado
      ? `Todo pagado. ${money(total)} en total este mes.`
      : `Pendiente de ${money(total)}. Ya pagaste ${money(pagado)}.`;
    rc.append(k, v, sub);
  }
  $('#compMes').textContent = NOMBRE_AMBITO[estado.ambito];

  // Gastos fijos
  const lf = $('#listaFijos');
  lf.innerHTML = '';
  const fijos = filas.filter((f) => f.tipo === 'fijo');
  if (fijos.length === 0) {
    lf.innerHTML = '<p class="note">Ninguno. La renta, el internet, los sueldos — lo que se repite cada mes.</p>';
  } else {
    for (const f of fijos.sort((a, b) => a.dia - b.dia)) {
      const row = filaCompromiso(f, periodo);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-quitar';
      del.innerHTML = '&times;';
      del.setAttribute('aria-label', `Quitar el gasto fijo ${f.nombre}`);
      del.addEventListener('click', async () => {
        if (!confirm(`¿Quitar "${f.nombre}" de los gastos fijos? Los pagos ya registrados se quedan en el historial.`)) return;
        c.fijos = c.fijos.filter((x) => x.id !== f.ref.id);
        estado.comp[estado.ambito] = c;
        await guardarComp();
        pintarCompromisos();
        pintarSalud();
      });
      row.querySelector('.cr-acts').appendChild(del);
      lf.appendChild(row);
    }
  }

  // Meses sin intereses
  const lm = $('#listaMsi');
  lm.innerHTML = '';
  if (c.msi.length === 0) {
    lm.innerHTML = '<p class="note">Ninguna. Aquí llevas el avance de lo que compraste a plazos.</p>';
  } else {
    for (const m of c.msi) {
      const i = indiceCuota(m, periodo);
      const fila = i !== null
        ? filas.find((f) => f.tipo === 'msi' && f.ref.id === m.id)
        : { tipo: 'msi', ref: m, nombre: m.nombre, centavos: cuotaMsi(m, 0), pagado: true, cuota: cuotasPagadas(m), de: m.meses };
      const row = filaCompromiso(fila, periodo);
      if (i === null) {
        const s = row.querySelector('.cr-s');
        const term = sumaMeses(m.inicio, m.meses - 1);
        s.textContent = mesesEntre(periodo, m.inicio) > 0
          ? `Empieza en ${nombrePeriodo(m.inicio)}`
          : `Terminó en ${nombrePeriodo(term)}`;
        const acts = row.querySelector('.cr-acts');
        acts.innerHTML = '';
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-quitar';
      del.innerHTML = '&times;';
      del.setAttribute('aria-label', `Quitar la compra ${m.nombre}`);
      del.addEventListener('click', async () => {
        if (!confirm(`¿Quitar "${m.nombre}"? Los pagos ya registrados se quedan en el historial.`)) return;
        c.msi = c.msi.filter((x) => x.id !== m.id);
        estado.comp[estado.ambito] = c;
        await guardarComp();
        pintarCompromisos();
        pintarSalud();
      });
      row.querySelector('.cr-acts').appendChild(del);
      lm.appendChild(row);
    }
  }

  // Tarjetas
  const lt = $('#listaTarjetas');
  lt.innerHTML = '';
  if (c.tarjetas.length === 0) {
    lt.innerHTML = '<p class="note">Ninguna. Solo guardamos el nombre y el día de pago — nunca números ni claves.</p>';
  } else {
    for (const t of [...c.tarjetas].sort((a, b) => diasParaDia(a.diaPago) - diasParaDia(b.diaPago))) {
      const d = diasParaDia(t.diaPago);
      const urge = d <= (t.aviso ?? 3);
      const row = document.createElement('div');
      row.className = 'comprow' + (urge ? ' urge' : '');
      const main = document.createElement('div');
      main.className = 'cr-main';
      const tt = document.createElement('div');
      tt.className = 'cr-t';
      tt.textContent = t.nombre;
      const ss = document.createElement('div');
      ss.className = 'cr-s' + (urge ? ' urge' : '');
      ss.textContent = d === 0 ? `Se paga HOY (día ${t.diaPago})` : `Día ${t.diaPago} · faltan ${d} día${d === 1 ? '' : 's'}`;
      main.append(tt, ss);
      const acts = document.createElement('div');
      acts.className = 'cr-acts';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-quitar';
      del.innerHTML = '&times;';
      del.setAttribute('aria-label', `Quitar la tarjeta ${t.nombre}`);
      del.addEventListener('click', async () => {
        if (!confirm(`¿Quitar la tarjeta "${t.nombre}"?`)) return;
        c.tarjetas = c.tarjetas.filter((x) => x.id !== t.id);
        estado.comp[estado.ambito] = c;
        await guardarComp();
        pintarCompromisos();
        pintarAvisos();
      });
      acts.appendChild(del);
      row.append(main, acts);
      lt.appendChild(row);
    }
  }

  pintarNotifBox();
}

/* ── Avisos y notificaciones ────────────────────────── */

/** Tarjetas que ya entraron en su ventana de aviso, de las dos secciones. */
function tarjetasPorVencer() {
  const out = [];
  for (const a of AMBITOS) {
    for (const t of (estado.comp[a] || COMP_VACIO()).tarjetas) {
      const d = diasParaDia(t.diaPago);
      if (d <= (t.aviso ?? 3)) out.push({ ...t, dias: d, ambito: a });
    }
  }
  return out.sort((a, b) => a.dias - b.dias);
}

function pintarAvisos() {
  const cont = $('#avisos');
  cont.innerHTML = '';
  for (const t of tarjetasPorVencer()) {
    const d = document.createElement('div');
    d.className = 'aviso';
    d.innerHTML = t.dias === 0
      ? `<b>Hoy</b> se paga ${t.nombre}`
      : `${t.nombre} se paga en <b>${t.dias} día${t.dias === 1 ? '' : 's'}</b>`;
    cont.appendChild(d);
  }
}

function pintarNotifBox() {
  const box = $('#notifBox');
  box.innerHTML = '';
  const soportado = 'Notification' in window;
  const p = document.createElement('p');

  if (!soportado) {
    p.textContent = 'Este navegador no puede mandar notificaciones. Los recordatorios te van a aparecer dentro de la app al abrirla.';
    box.appendChild(p);
    return;
  }

  const est = Notification.permission;
  const e = document.createElement('p');
  e.className = 'estado';
  e.textContent = est === 'granted' ? 'Notificaciones activadas' : est === 'denied' ? 'Notificaciones bloqueadas' : 'Notificaciones apagadas';
  box.appendChild(e);

  if (est === 'granted') {
    p.textContent = 'Te avisará el día del pago. Ojo: sin un servidor de por medio, Android decide cuándo revisar — normalmente una o dos veces al día. Si no llega, el recordatorio te salta igual al abrir la app.';
    box.appendChild(p);
  } else if (est === 'denied') {
    p.textContent = 'Las bloqueaste para este sitio. Para reactivarlas: candado en la barra de Chrome → Permisos → Notificaciones.';
    box.appendChild(p);
  } else {
    p.textContent = 'Actívalas y te avisa el día que toca pagar cada tarjeta.';
    box.appendChild(p);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-primary';
    b.textContent = 'Activar notificaciones';
    b.addEventListener('click', pedirNotificaciones);
    box.appendChild(b);
  }
}

async function pedirNotificaciones() {
  try {
    const r = await Notification.requestPermission();
    if (r === 'granted') {
      toast('Notificaciones activadas');
      await registrarRevisionPeriodica();
      await revisarYNotificar();
    } else {
      toast('No se activaron');
    }
  } catch { toast('No se pudieron activar'); }
  pintarNotifBox();
}

/** Pide a Chrome que despierte al service worker de vez en cuando.
 *  No hay garantía: el navegador decide. Por eso existe el aviso en pantalla. */
async function registrarRevisionPeriodica() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.periodicSync) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') return;
    await reg.periodicSync.register('revisar-pagos', { minInterval: 12 * 60 * 60 * 1000 });
  } catch { /* no se pudo: queda el aviso al abrir */ }
}

/** Notifica una sola vez por tarjeta y por día. */
async function revisarYNotificar() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const pendientes = tarjetasPorVencer();
  if (pendientes.length === 0) return;
  const ya = await leerCfg('notificado', {});
  const hoy = hoyISO();
  let cambio = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    for (const t of pendientes) {
      if (ya[t.id] === hoy) continue;
      await reg.showNotification(
        t.dias === 0 ? `Hoy se paga ${t.nombre}` : `${t.nombre}: faltan ${t.dias} días`,
        {
          body: t.dias === 0 ? `Día límite de pago: ${t.diaPago}.` : `Día límite: ${t.diaPago} de cada mes.`,
          tag: 'tarjeta-' + t.id,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
        },
      );
      ya[t.id] = hoy;
      cambio = true;
    }
    if (cambio) await escribirCfg('notificado', ya);
  } catch { /* sin service worker: solo el aviso en pantalla */ }
}

/* ── Historial ──────────────────────────────────────── */

function pintarHistorial() {
  const cont = $('#lista');
  cont.innerHTML = '';
  const propios = movsAmbito();
  $('#histCount').textContent = propios.length ? `${propios.length} en ${NOMBRE_AMBITO[estado.ambito]}` : '';

  if (propios.length === 0) {
    cont.innerHTML = `<p class="empty">Todavía no capturas nada en ${NOMBRE_AMBITO[estado.ambito]}.<br>Ve a Capturar y anota el primero.</p>`;
    return;
  }

  const orden = [...propios].sort((a, b) => (a.fecha === b.fecha ? b.creado - a.creado : b.fecha.localeCompare(a.fecha)));
  let ultima = null;

  for (const m of orden) {
    if (m.fecha !== ultima) {
      ultima = m.fecha;
      const h = document.createElement('div');
      h.className = 'daygroup';
      h.textContent = etiquetaFecha(m.fecha);
      cont.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'row ' + (m.tipo === 'ingreso' ? 'in' : 'out');

    const main = document.createElement('div');
    main.className = 'row-main';
    const cat = document.createElement('div');
    cat.className = 'row-cat';
    cat.textContent = m.categoria;
    main.appendChild(cat);
    if (m.nota) {
      const n = document.createElement('div');
      n.className = 'row-nota';
      n.textContent = m.nota;
      main.appendChild(n);
    }

    const amt = document.createElement('div');
    amt.className = 'row-amt';
    amt.textContent = (m.tipo === 'ingreso' ? '+' : '−') + money(m.centavos).replace('$', '$ ');

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-del';
    del.innerHTML = '&times;';
    del.setAttribute('aria-label', `Borrar ${m.categoria} de ${money(m.centavos)}`);
    del.addEventListener('click', async () => {
      if (!confirm(`¿Borrar ${m.categoria} de ${money(m.centavos)}?`)) return;
      await borrarMov(m.id);
      estado.movs = estado.movs.filter((x) => x.id !== m.id);
      pintarHistorial();
      pintarSalud();
      pintarCompromisos();
      toast('Borrado');
    });

    row.append(main, amt, del);
    cont.appendChild(row);
  }
}

/* ── Categorías ─────────────────────────────────────── */

function pintarCategorias() {
  for (const [tipo, sel] of [['ingreso', '#catIn'], ['egreso', '#catOut']]) {
    const cont = $(sel);
    if (!cont) continue;
    cont.innerHTML = '';
    const lista = (estado.cats[estado.ambito] && estado.cats[estado.ambito][tipo]) || [];
    for (const c of lista) {
      const row = document.createElement('div');
      row.className = 'catrow';
      const s = document.createElement('span');
      s.textContent = c;
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '&times;';
      b.setAttribute('aria-label', `Quitar categoría ${c}`);
      b.addEventListener('click', async () => {
        const usada = estado.movs.some((m) => m.ambito === estado.ambito && m.tipo === tipo && m.categoria === c);
        if (usada && !confirm(`Ya usaste "${c}" en movimientos guardados. Si la quitas, esos movimientos la conservan pero ya no podrás elegirla. ¿Quitarla?`)) return;
        estado.cats[estado.ambito][tipo] = estado.cats[estado.ambito][tipo].filter((x) => x !== c);
        await escribirCfg('cats', estado.cats);
        pintarCategorias();
        pintarChips();
      });
      row.append(s, b);
      cont.appendChild(row);
    }
  }
}

/* ── Respaldo ───────────────────────────────────────── */

function descargar(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportarJson() {
  const payload = {
    formato: 'consultorio-finanzas',
    version: 3,
    exportado: new Date().toISOString(),
    categorias: estado.cats,
    compromisos: estado.comp,
    movimientos: estado.movs,
  };
  descargar(`finanzas-${hoyISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  await escribirCfg('ultimoRespaldo', Date.now());
  pintarRespaldoNota();
  toast(`Respaldo de ${estado.movs.length} movimientos, las dos secciones`);
}

function exportarCsv() {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const filas = [['seccion', 'fecha', 'tipo', 'categoria', 'monto', 'nota', 'origen'].join(';')];
  const orden = [...estado.movs].sort((a, b) => (a.ambito === b.ambito ? a.fecha.localeCompare(b.fecha) : a.ambito.localeCompare(b.ambito)));
  for (const m of orden) {
    filas.push([
      NOMBRE_AMBITO[m.ambito] || m.ambito, m.fecha, m.tipo, esc(m.categoria),
      (m.centavos / 100).toFixed(2), esc(m.nota), m.origen ? m.origen.tipo : '',
    ].join(';'));
  }
  descargar(`finanzas-${hoyISO()}.csv`, '﻿' + filas.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV exportado, las dos secciones');
}

async function importar(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('Ese archivo no es un respaldo válido'); return; }
  if (data.formato !== 'consultorio-finanzas' || !Array.isArray(data.movimientos)) {
    toast('Ese archivo no es un respaldo de esta app');
    return;
  }

  const existentes = new Set(estado.movs.map((m) => m.id));
  let nuevos = 0;
  for (const m of data.movimientos) {
    if (!m || typeof m.centavos !== 'number' || !m.fecha || !m.tipo) continue;
    if (existentes.has(m.id)) continue;
    if (!m.ambito) m.ambito = 'consultorio';
    await guardarMov(m);
    estado.movs.push(m);
    nuevos++;
  }

  if (data.categorias) {
    const entra = (data.categorias.consultorio || data.categorias.personal)
      ? data.categorias : { consultorio: data.categorias, personal: {} };
    for (const a of AMBITOS) {
      for (const t of ['ingreso', 'egreso']) {
        for (const c of (entra[a] && entra[a][t]) || []) {
          if (!estado.cats[a][t].includes(c)) estado.cats[a][t].push(c);
        }
      }
    }
    await escribirCfg('cats', estado.cats);
  }

  // Los compromisos se suman por id, sin duplicar.
  if (data.compromisos) {
    for (const a of AMBITOS) {
      const src = data.compromisos[a];
      if (!src) continue;
      for (const k of ['fijos', 'msi', 'tarjetas']) {
        const dst = estado.comp[a][k];
        for (const it of src[k] || []) if (!dst.some((x) => x.id === it.id)) dst.push(it);
      }
    }
    await guardarComp();
  }

  pintarCategorias();
  pintarChips();
  pintarHistorial();
  pintarSalud();
  pintarCompromisos();
  pintarAvisos();
  toast(nuevos ? `Restaurados ${nuevos} movimientos` : 'Ya tenías todo eso');
}

async function pintarRespaldoNota() {
  const t = await leerCfg('ultimoRespaldo', null);
  const el = $('#respaldoNota');
  if (!el) return;
  if (!t) { el.textContent = 'Nunca has respaldado.'; return; }
  const dias = Math.floor((Date.now() - t) / 86400000);
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
  el.textContent = `Último respaldo: ${cuando}.` + (dias >= 7 ? ' Ya toca otro.' : '');
}

/* ── Sección y navegación ───────────────────────────── */

async function setAmbito(a, persistir = true) {
  estado.ambito = a;
  document.body.classList.toggle('a-consultorio', a === 'consultorio');
  document.body.classList.toggle('a-personal', a === 'personal');
  $$('.amb').forEach((b) => {
    const on = b.dataset.amb === a;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const meta = document.querySelector('meta[name="theme-color"]:not([media*="dark"])');
  if (meta) meta.setAttribute('content', COLOR_AMBITO[a]);

  const nom = NOMBRE_AMBITO[a];
  ['#ambTag1', '#ambTag2'].forEach((s) => { const el = $(s); if (el) el.textContent = '· ' + nom; });
  ['#ambNombre', '#ambNombre2'].forEach((s) => { const el = $(s); if (el) el.textContent = nom; });

  estado.categoria = null;
  estado.centavos = 0;
  pintarChips();
  pintarMonto();
  pintarSalud();
  pintarHistorial();
  pintarCategorias();
  pintarCompromisos();

  if (persistir) await escribirCfg('ambito', a);
}

function ir(nombre) {
  $$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== nombre; });
  $$('.tab').forEach((t) => {
    const on = t.dataset.go === nombre;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', String(on));
  });
  window.scrollTo(0, 0);
  if (nombre === 'salud') pintarSalud();
  if (nombre === 'historial') pintarHistorial();
  if (nombre === 'compromisos') pintarCompromisos();
  if (nombre === 'ajustes') { pintarCategorias(); pintarRespaldoNota(); }
}

/* ── Arranque ───────────────────────────────────────── */

async function init() {
  db = await abrirDB();
  estado.movs = await todosMov();
  await migrar(await leerCfg('cats', null));

  const comp = await leerCfg('compromisos', null);
  estado.comp = { consultorio: COMP_VACIO(), personal: COMP_VACIO() };
  if (comp) {
    for (const a of AMBITOS) {
      if (!comp[a]) continue;
      for (const k of ['fijos', 'msi', 'tarjetas']) {
        if (Array.isArray(comp[a][k])) estado.comp[a][k] = comp[a][k];
      }
    }
  }

  if (navigator.storage && navigator.storage.persist) {
    try {
      const ok = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      const el = $('#almacenNota');
      if (el) {
        el.textContent = ok
          ? 'Almacenamiento marcado como persistente por el navegador.'
          : 'Ojo: el navegador podría borrar los datos si se queda sin espacio. Respalda seguido.';
      }
    } catch { /* no es crítico */ }
  }

  setTipo('ingreso');
  await setAmbito(await leerCfg('ambito', 'consultorio'), false);
  setFecha(hoyISO());
  pintarMonto();
  pintarAvisos();

  const hoyMes = periodoHoy();
  $('#msiInicio').value = hoyMes;

  // Sección, teclado, tipo, fecha
  $$('.amb').forEach((b) => b.addEventListener('click', () => setAmbito(b.dataset.amb)));
  $('#keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) tecla(b.dataset.k);
  });
  $$('.seg[data-tipo]').forEach((b) => b.addEventListener('click', () => setTipo(b.dataset.tipo)));
  $('#fechaInput').addEventListener('change', (e) => { if (e.target.value) setFecha(e.target.value); });
  $('#guardarBtn').addEventListener('click', guardar);

  // Navegación y mes
  $$('.tab').forEach((t) => t.addEventListener('click', () => ir(t.dataset.go)));
  $('#mesPrev').addEventListener('click', () => moverMes(-1));
  $('#mesNext').addEventListener('click', () => moverMes(1));

  // Respaldo
  $('#exportJson').addEventListener('click', exportarJson);
  $('#exportCsv').addEventListener('click', exportarCsv);
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importar(f);
    e.target.value = '';
  });

  // Categorías
  $$('.addcat[data-tipo]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const val = input.value.trim();
      const tipo = form.dataset.tipo;
      if (!val) return;
      if (estado.cats[estado.ambito][tipo].includes(val)) { toast('Esa categoría ya existe'); return; }
      estado.cats[estado.ambito][tipo].push(val);
      await escribirCfg('cats', estado.cats);
      input.value = '';
      pintarCategorias();
      pintarChips();
    });
  });

  // Gasto fijo
  $('#formFijo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#fijoNombre').value.trim();
    const cent = aCentavos($('#fijoMonto').value);
    const dia = Math.min(31, Math.max(1, parseInt($('#fijoDia').value, 10) || 1));
    if (!nombre) return;
    if (cent <= 0) { toast('Escribe un monto válido'); return; }
    estado.comp[estado.ambito].fijos.push({ id: nuevoId(), nombre, centavos: cent, dia });
    await guardarComp();
    $('#fijoNombre').value = ''; $('#fijoMonto').value = '';
    e.target.closest('details').open = false;
    pintarCompromisos();
    pintarSalud();
    toast(`"${nombre}" agregado a gastos fijos`);
  });

  // Compra a meses
  const previewMsi = () => {
    const total = aCentavos($('#msiTotal').value);
    const meses = parseInt($('#msiMeses').value, 10) || 0;
    $('#msiPreview').textContent = (total > 0 && meses >= 2)
      ? `Quedan ${meses} pagos de ${money(Math.round(total / meses))} al mes.`
      : '';
  };
  $('#msiTotal').addEventListener('input', previewMsi);
  $('#msiMeses').addEventListener('input', previewMsi);

  $('#formMsi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#msiNombre').value.trim();
    const total = aCentavos($('#msiTotal').value);
    const meses = parseInt($('#msiMeses').value, 10) || 0;
    const inicio = $('#msiInicio').value || periodoHoy();
    if (!nombre) return;
    if (total <= 0) { toast('Escribe el monto total'); return; }
    if (meses < 2) { toast('Tienen que ser 2 meses o más'); return; }
    estado.comp[estado.ambito].msi.push({ id: nuevoId(), nombre, totalCentavos: total, meses, inicio });
    await guardarComp();
    $('#msiNombre').value = ''; $('#msiTotal').value = ''; $('#msiPreview').textContent = '';
    e.target.closest('details').open = false;
    pintarCompromisos();
    pintarSalud();
    toast(`"${nombre}" a ${meses} meses`);
  });

  // Tarjeta
  $('#formTarjeta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#tarNombre').value.trim();
    const diaPago = Math.min(31, Math.max(1, parseInt($('#tarDiaPago').value, 10) || 1));
    const aviso = parseInt($('#tarAviso').value, 10);
    if (!nombre) return;
    estado.comp[estado.ambito].tarjetas.push({ id: nuevoId(), nombre, diaPago, aviso });
    await guardarComp();
    $('#tarNombre').value = '';
    e.target.closest('details').open = false;
    pintarCompromisos();
    pintarAvisos();
    toast(`Tarjeta "${nombre}" agregada`);
    if ('Notification' in window && Notification.permission === 'default') {
      toast('Actívale las notificaciones abajo para que te avise');
    }
  });

  // Borrar la sección activa
  $('#borrarTodo').addEventListener('click', async () => {
    const nom = NOMBRE_AMBITO[estado.ambito];
    const cuantos = movsAmbito().length;
    if (cuantos === 0) { toast(`No hay nada en ${nom}`); return; }
    if (!confirm(`Esto borra los ${cuantos} movimientos de ${nom}. La otra sección no se toca.\nNo se puede deshacer.\n\n¿Ya respaldaste?`)) return;
    if (!confirm(`Última confirmación: ¿borrar ${nom}?`)) return;
    for (const m of movsAmbito()) await borrarMov(m.id);
    estado.movs = estado.movs.filter((m) => m.ambito !== estado.ambito);
    pintarHistorial();
    pintarSalud();
    pintarCompromisos();
    toast(`${nom} borrado`);
  });

  // Teclado físico
  document.addEventListener('keydown', (e) => {
    if ($('#screen-capturar').hidden) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (/^[0-9]$/.test(e.key)) { tecla(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { tecla('del'); e.preventDefault(); }
    else if (e.key === 'Enter' && !$('#guardarBtn').disabled) { guardar(); e.preventDefault(); }
  });

  // Al volver a la app, los días cambian: recalcular avisos.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { pintarAvisos(); revisarYNotificar(); }
  });

  // El modo sin conexión es un extra. Si falla, la app abre igual.
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register('sw.js')
        .then(() => { registrarRevisionPeriodica(); revisarYNotificar(); })
        .catch(() => {});
    }
  } catch { /* sin modo sin conexión, pero la app abre */ }
}

init().catch((e) => {
  document.body.innerHTML = '<p style="padding:2rem;font-family:system-ui">No se pudo abrir el almacenamiento del teléfono.<br><br>' +
    'Si estás en modo incógnito, ciérralo y abre la app normal.<br><br><code>' + String(e) + '</code></p>';
});

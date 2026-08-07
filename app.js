/* Ingresos y Egresos — consultorio y vida personal
 *
 * Todo vive en IndexedDB, dentro del teléfono. No hay red, no hay servidor,
 * no hay cuenta. La única forma de que un dato salga de aquí es que tú lo
 * exportes a propósito con el botón de respaldo.
 *
 * Dos secciones separadas — Consultorio y Personal — que no se mezclan nunca:
 * cada una tiene sus movimientos, sus categorías y sus totales. El acento de
 * color cambia con la sección para que no haya duda de dónde estás anotando.
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

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const NUM = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const money = (c) => MXN.format(c / 100);
const plain = (c) => NUM.format(c / 100);

/** Copia profunda de datos simples. A propósito no usamos structuredClone:
 *  esto solo clona listas de texto y así la app no depende de una API que
 *  puede faltar en un navegador viejo. */
const clonar = (o) => JSON.parse(JSON.stringify(o));

/** Fecha local en YYYY-MM-DD. Nunca toISOString(): eso da UTC y en México
 *  adelanta el día por la tarde, guardando el movimiento en la fecha equivocada. */
function hoyISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function etiquetaFecha(iso) {
  const hoy = hoyISO();
  if (iso === hoy) return 'Hoy';
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (iso === hoyISO(ayer)) return 'Ayer';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1].slice(0, 3)} ${y}`;
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
      if (!d.objectStoreNames.contains('cfg')) {
        d.createObjectStore('cfg', { keyPath: 'k' });
      }
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
    try {
      out = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
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
  movs: [],
  mes: { y: new Date().getFullYear(), m: new Date().getMonth() },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Categorías de la sección y tipo actuales. */
const catsActuales = () => (estado.cats[estado.ambito] && estado.cats[estado.ambito][estado.tipo]) || [];

/** Movimientos de la sección actual. Todo lo que se muestra pasa por aquí:
 *  es lo que garantiza que las dos secciones no se mezclen. */
const movsAmbito = () => estado.movs.filter((m) => m.ambito === estado.ambito);

let toastT = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ── Migración de datos viejos ──────────────────────── */

/** La primera versión no tenía secciones. Lo que ya estaba capturado era del
 *  consultorio, así que ahí se queda; y las categorías sueltas pasan a ser
 *  las del consultorio, conservando las que el usuario hubiera agregado. */
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

  // Rellena huecos por si falta una rama entera.
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

/* ── Sección ────────────────────────────────────────── */

async function setAmbito(a, persistir = true) {
  estado.ambito = a;
  document.body.classList.toggle('a-consultorio', a === 'consultorio');
  document.body.classList.toggle('a-personal', a === 'personal');

  $$('.amb').forEach((b) => {
    const on = b.dataset.amb === a;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });

  // La barra de estado del teléfono se tiñe igual que la sección.
  const meta = document.querySelector('meta[name="theme-color"]:not([media*="dark"])');
  if (meta) meta.setAttribute('content', COLOR_AMBITO[a]);

  const nom = NOMBRE_AMBITO[a];
  ['#ambTag1', '#ambTag2'].forEach((s) => { const el = $(s); if (el) el.textContent = '· ' + nom; });
  ['#ambNombre', '#ambNombre2'].forEach((s) => { const el = $(s); if (el) el.textContent = nom; });

  estado.categoria = null;
  estado.centavos = 0;
  pintarChips();
  pintarMonto();
  pintarMes();
  pintarHistorial();
  pintarCategorias();

  if (persistir) await escribirCfg('ambito', a);
}

/* ── Pantalla: capturar ─────────────────────────────── */

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
    b.addEventListener('click', () => {
      estado.categoria = c;
      pintarChips();
      pintarMonto();
    });
    cont.appendChild(b);
  }
}

function setTipo(t) {
  estado.tipo = t;
  document.body.classList.toggle('t-ingreso', t === 'ingreso');
  document.body.classList.toggle('t-egreso', t === 'egreso');
  $$('.seg').forEach((b) => {
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
    if (n > 99999999999) return; // tope: ~mil millones de pesos
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
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2),
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

  const signo = m.tipo === 'ingreso' ? 'Entró' : 'Salió';
  toast(`${signo} ${money(m.centavos)} · ${m.categoria} · ${NOMBRE_AMBITO[m.ambito]}`);

  estado.centavos = 0;
  $('#notaInput').value = '';
  setFecha(hoyISO());
  pintarMonto();
  pintarMes();
  pintarHistorial();
}

/* ── Pantalla: mes ──────────────────────────────────── */

function movsDelMes() {
  const y = estado.mes.y;
  const m = String(estado.mes.m + 1).padStart(2, '0');
  const pre = `${y}-${m}`;
  return movsAmbito().filter((x) => x.fecha.startsWith(pre));
}

function pintarBarras(cont, movs, tipo) {
  const el = $(cont);
  el.className = 'bars ' + (tipo === 'ingreso' ? 'in' : 'out');
  const filtrados = movs.filter((m) => m.tipo === tipo);
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

function pintarMes() {
  const movs = movsDelMes();
  const entro = movs.filter((m) => m.tipo === 'ingreso').reduce((a, b) => a + b.centavos, 0);
  const salio = movs.filter((m) => m.tipo === 'egreso').reduce((a, b) => a + b.centavos, 0);
  const neto = entro - salio;

  $('#mesLabel').textContent = `${MESES[estado.mes.m]} ${estado.mes.y}`;
  $('#totIn').textContent = money(entro);
  $('#totOut').textContent = money(salio);
  $('#totNet').textContent = money(neto);
  $('.tot-net').classList.toggle('neg', neto < 0);

  pintarBarras('#barsIn', movs, 'ingreso');
  pintarBarras('#barsOut', movs, 'egreso');
}

function moverMes(delta) {
  let { y, m } = estado.mes;
  m += delta;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  estado.mes = { y, m };
  pintarMes();
}

/* ── Pantalla: historial ────────────────────────────── */

function pintarHistorial() {
  const cont = $('#lista');
  cont.innerHTML = '';
  const propios = movsAmbito();
  $('#histCount').textContent = propios.length
    ? `${propios.length} en ${NOMBRE_AMBITO[estado.ambito]}`
    : '';

  if (propios.length === 0) {
    cont.innerHTML = `<p class="empty">Todavía no capturas nada en ${NOMBRE_AMBITO[estado.ambito]}.<br>Ve a Capturar y anota el primero.</p>`;
    return;
  }

  const orden = [...propios].sort((a, b) => (a.fecha === b.fecha ? b.creado - a.creado : b.fecha.localeCompare(a.fecha)));
  let ultimaFecha = null;

  for (const m of orden) {
    if (m.fecha !== ultimaFecha) {
      ultimaFecha = m.fecha;
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
      pintarMes();
      toast('Borrado');
    });

    row.append(main, amt, del);
    cont.appendChild(row);
  }
}

/* ── Ajustes: categorías ────────────────────────────── */

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

/* ── Ajustes: respaldo ──────────────────────────────── */

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
  // El respaldo lleva SIEMPRE las dos secciones: si solo guardara la actual,
  // restaurarlo borraría media vida sin avisar.
  const payload = {
    formato: 'consultorio-finanzas',
    version: 2,
    exportado: new Date().toISOString(),
    categorias: estado.cats,
    movimientos: estado.movs,
  };
  descargar(`finanzas-${hoyISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  await escribirCfg('ultimoRespaldo', Date.now());
  pintarRespaldoNota();
  toast(`Respaldo de ${estado.movs.length} movimientos, las dos secciones`);
}

function exportarCsv() {
  // Punto y coma: es lo que Excel en español espera como separador de lista.
  // BOM al inicio: sin él, Excel rompe los acentos.
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const filas = [['seccion', 'fecha', 'tipo', 'categoria', 'monto', 'nota'].join(';')];
  const orden = [...estado.movs].sort((a, b) => (a.ambito === b.ambito ? a.fecha.localeCompare(b.fecha) : a.ambito.localeCompare(b.ambito)));
  for (const m of orden) {
    filas.push([NOMBRE_AMBITO[m.ambito] || m.ambito, m.fecha, m.tipo, esc(m.categoria), (m.centavos / 100).toFixed(2), esc(m.nota)].join(';'));
  }
  descargar(`finanzas-${hoyISO()}.csv`, '﻿' + filas.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV exportado, las dos secciones');
}

async function importar(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Ese archivo no es un respaldo válido');
    return;
  }
  if (data.formato !== 'consultorio-finanzas' || !Array.isArray(data.movimientos)) {
    toast('Ese archivo no es un respaldo de esta app');
    return;
  }

  const existentes = new Set(estado.movs.map((m) => m.id));
  let nuevos = 0;
  for (const m of data.movimientos) {
    if (!m || typeof m.centavos !== 'number' || !m.fecha || !m.tipo) continue;
    if (existentes.has(m.id)) continue;
    if (!m.ambito) m.ambito = 'consultorio'; // respaldo de la versión sin secciones
    await guardarMov(m);
    estado.movs.push(m);
    nuevos++;
  }

  // Las categorías se suman, no se reemplazan: no perdemos las que ya tenías.
  if (data.categorias) {
    const entra = (data.categorias.consultorio || data.categorias.personal)
      ? data.categorias
      : { consultorio: data.categorias, personal: {} };
    for (const a of AMBITOS) {
      for (const t of ['ingreso', 'egreso']) {
        for (const c of (entra[a] && entra[a][t]) || []) {
          if (!estado.cats[a][t].includes(c)) estado.cats[a][t].push(c);
        }
      }
    }
    await escribirCfg('cats', estado.cats);
  }

  pintarCategorias();
  pintarChips();
  pintarHistorial();
  pintarMes();
  toast(nuevos ? `Restaurados ${nuevos} movimientos` : 'Ya tenías todo eso');
}

async function pintarRespaldoNota() {
  const t = await leerCfg('ultimoRespaldo', null);
  const el = $('#respaldoNota');
  if (!t) {
    el.textContent = 'Nunca has respaldado.';
    return;
  }
  const dias = Math.floor((Date.now() - t) / 86400000);
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
  el.textContent = `Último respaldo: ${cuando}.` + (dias >= 7 ? ' Ya toca otro.' : '');
}

/* ── Navegación ─────────────────────────────────────── */

function ir(nombre) {
  $$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== nombre; });
  $$('.tab').forEach((t) => {
    const on = t.dataset.go === nombre;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', String(on));
  });
  window.scrollTo(0, 0);
  if (nombre === 'mes') pintarMes();
  if (nombre === 'historial') pintarHistorial();
  if (nombre === 'ajustes') { pintarCategorias(); pintarRespaldoNota(); }
}

/* ── Arranque ───────────────────────────────────────── */

async function init() {
  db = await abrirDB();
  estado.movs = await todosMov();
  await migrar(await leerCfg('cats', null));

  // Pide al navegador que no borre estos datos si le falta espacio.
  if (navigator.storage && navigator.storage.persist) {
    try {
      const yaEs = await navigator.storage.persisted();
      const ok = yaEs || (await navigator.storage.persist());
      $('#almacenNota').textContent = ok
        ? 'Almacenamiento marcado como persistente por el navegador.'
        : 'Ojo: el navegador podría borrar los datos si se queda sin espacio. Respalda seguido.';
    } catch { /* no es crítico */ }
  }

  setTipo('ingreso');
  await setAmbito(await leerCfg('ambito', 'consultorio'), false);
  setFecha(hoyISO());
  pintarMonto();

  // Sección
  $$('.amb').forEach((b) => b.addEventListener('click', () => setAmbito(b.dataset.amb)));

  // Teclado
  $('#keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) tecla(b.dataset.k);
  });

  // Tipo
  $$('.seg').forEach((b) => b.addEventListener('click', () => setTipo(b.dataset.tipo)));

  // Fecha
  $('#fechaInput').addEventListener('change', (e) => {
    if (e.target.value) setFecha(e.target.value);
  });

  $('#guardarBtn').addEventListener('click', guardar);

  // Tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => ir(t.dataset.go)));

  // Mes
  $('#mesPrev').addEventListener('click', () => moverMes(-1));
  $('#mesNext').addEventListener('click', () => moverMes(1));

  // Ajustes
  $('#exportJson').addEventListener('click', exportarJson);
  $('#exportCsv').addEventListener('click', exportarCsv);
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importar(f);
    e.target.value = '';
  });

  $$('.addcat').forEach((form) => {
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

  // Borra SOLO la sección en la que estás: nunca las dos de un golpe.
  $('#borrarTodo').addEventListener('click', async () => {
    const nom = NOMBRE_AMBITO[estado.ambito];
    const cuantos = movsAmbito().length;
    if (cuantos === 0) { toast(`No hay nada en ${nom}`); return; }
    if (!confirm(`Esto borra los ${cuantos} movimientos de ${nom}. La otra sección no se toca.\nNo se puede deshacer.\n\n¿Ya respaldaste?`)) return;
    if (!confirm(`Última confirmación: ¿borrar ${nom}?`)) return;
    for (const m of movsAmbito()) await borrarMov(m.id);
    estado.movs = estado.movs.filter((m) => m.ambito !== estado.ambito);
    pintarHistorial();
    pintarMes();
    toast(`${nom} borrado`);
  });

  // Teclado físico, por si la abres en la computadora
  document.addEventListener('keydown', (e) => {
    if ($('#screen-capturar').hidden) return;
    if (document.activeElement === $('#notaInput')) return;
    if (/^[0-9]$/.test(e.key)) { tecla(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { tecla('del'); e.preventDefault(); }
    else if (e.key === 'Enter' && !$('#guardarBtn').disabled) { guardar(); e.preventDefault(); }
  });

  // El modo sin conexión es un extra. Si falla, la app tiene que seguir
  // funcionando igual: nada aquí puede tumbar el arranque.
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch { /* sin modo sin conexión, pero la app abre */ }
}

init().catch((e) => {
  document.body.innerHTML = '<p style="padding:2rem;font-family:system-ui">No se pudo abrir el almacenamiento del teléfono.<br><br>' +
    'Si estás en modo incógnito, ciérralo y abre la app normal.<br><br><code>' + String(e) + '</code></p>';
});

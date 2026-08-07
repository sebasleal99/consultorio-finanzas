/* Prueba de humo: monta un DOM y un IndexedDB falsos y ejecuta el flujo real
 * de la app — capturar, guardar, totales, historial, exportar, borrar,
 * restaurar — en las dos secciones.
 *
 * Lo que más se vigila aquí: que Consultorio y Personal NO se mezclen.
 *
 * Uso:  npm test
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
let pasos = 0;

function ok(cond, msg) {
  pasos++;
  if (cond) console.log(`  OK    ${msg}`);
  else { fallos++; console.log(`  FALLA ${msg}`); }
}

const esperar = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/* ── Montaje ────────────────────────────────────────── */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

window.indexedDB = new FDBFactory();
window.IDBKeyRange = FDBKeyRange;
window.crypto = { randomUUID: () => 'id-' + Math.random().toString(16).slice(2) };
window.scrollTo = () => {};
window.confirm = () => true;
window.alert = () => {};
window.URL.createObjectURL = () => 'blob:fake';
window.URL.revokeObjectURL = () => {};
// jsdom no trae service workers; lo dejamos ausente de verdad, no en undefined.

const descargas = [];
const clickReal = window.HTMLAnchorElement.prototype.click;
window.HTMLAnchorElement.prototype.click = function () {
  if (this.download) descargas.push({ nombre: this.download });
  else clickReal.call(this);
};

let ultimoBlob = null;
const BlobReal = window.Blob;
window.Blob = class extends BlobReal {
  constructor(parts, opts) {
    super(parts, opts);
    this._texto = parts.join('');
    ultimoBlob = this;
  }
  text() { return Promise.resolve(this._texto); }
};

window.eval(readFileSync(join(ROOT, 'app.js'), 'utf8'));
await esperar(200);

const doc = window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const tap = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const teclear = (k) => tap($(`#keypad button[data-k="${k}"]`));
const soloNum = (s) => s.replace(/[^\d.-]/g, '');
const cats = () => $$('#chips .chip').map((c) => c.textContent);

/** Captura un movimiento completo en la sección/tipo actuales. */
async function capturar(digitos, categoria, nota = '') {
  for (const d of digitos) teclear(d);
  tap($$('#chips .chip').find((c) => c.textContent === categoria));
  $('#notaInput').value = nota;
  tap($('#guardarBtn'));
  await esperar(120);
}

/* ── 1. Arranque ────────────────────────────────────── */

console.log('\n1. Arranque');
ok($('#montoOut').textContent === '0.00', 'el monto arranca en 0.00');
ok($('#guardarBtn').disabled === true, 'Guardar arranca deshabilitado');
ok($('.amb[data-amb="consultorio"]').classList.contains('is-on'), 'arranca en la sección Consultorio');
ok(doc.body.classList.contains('a-consultorio'), 'el cuerpo lleva la clase de la sección, para teñir el acento');
ok(cats().length === 8, `Consultorio trae 8 categorías de ingreso (${cats().length})`);
ok(cats().includes('Endodoncia'), 'las categorías son las del consultorio');
ok($('#fechaLabel').textContent === 'Hoy', 'la fecha arranca en Hoy');

/* ── 2. Teclado ─────────────────────────────────────── */

console.log('\n2. Teclado');
teclear('1'); teclear('5'); teclear('00');
ok($('#montoOut').textContent === '15.00', `1,5,00 da 15.00 (dio ${$('#montoOut').textContent})`);
teclear('del');
ok($('#montoOut').textContent === '1.50', `borrar deja 1.50 (dio ${$('#montoOut').textContent})`);
teclear('del'); teclear('del'); teclear('del');
ok($('#montoOut').textContent === '0.00', 'se puede vaciar por completo');

/* ── 3. Capturar en Consultorio ─────────────────────── */

console.log('\n3. Capturar en Consultorio');
await capturar(['8', '5', '0', '00'], 'Resina', 'molar superior');
ok($('#montoOut').textContent === '0.00', 'tras guardar, el monto se limpia');
ok($('#notaInput').value === '', 'tras guardar, la nota se limpia');

tap($('.seg-out'));
ok(cats().includes('Laboratorio'), 'al cambiar a Salió aparecen las categorías de egreso del consultorio');
await capturar(['3', '2', '0', '00'], 'Laboratorio');

/* ── 4. Cambiar de sección ──────────────────────────── */

console.log('\n4. Cambiar a Personal');
tap($('.amb[data-amb="personal"]'));
await esperar(120);

ok(doc.body.classList.contains('a-personal'), 'el cuerpo cambia a la clase de Personal');
ok(!doc.body.classList.contains('a-consultorio'), 'y suelta la de Consultorio');
ok($('.amb[data-amb="personal"]').classList.contains('is-on'), 'el botón de Personal queda activo');
ok($('#montoOut').textContent === '0.00', 'al cambiar de sección se limpia el monto a medio capturar');
ok(cats().includes('Comida'), 'aparecen las categorías personales de egreso');
ok(!cats().includes('Laboratorio'), 'y NO se ven las del consultorio');

tap($('.seg-in'));
ok(cats().includes('Retiro del consultorio'), 'los ingresos personales tienen sus propias categorías');
ok(!cats().includes('Endodoncia'), 'no se cuelan las de odontología');

/* ── 5. Capturar en Personal ────────────────────────── */

console.log('\n5. Capturar en Personal');
await capturar(['1', '2', '0', '0', '00'], 'Retiro del consultorio');
tap($('.seg-out'));
await capturar(['4', '5', '0', '00'], 'Comida', 'despensa');

/* ── 6. Los totales NO se mezclan ───────────────────── */

console.log('\n6. Los totales no se mezclan');
tap($('.tab[data-go="mes"]'));
await esperar(80);
ok(soloNum($('#totIn').textContent) === '1200.00', `Personal: entró 1200.00 (dio ${$('#totIn').textContent})`);
ok(soloNum($('#totOut').textContent) === '450.00', `Personal: salió 450.00 (dio ${$('#totOut').textContent})`);
ok(soloNum($('#totNet').textContent) === '750.00', `Personal: queda 750.00 (dio ${$('#totNet').textContent})`);
ok(!$('#barsIn').textContent.includes('Resina'), 'las barras de Personal no muestran categorías del consultorio');

tap($('.amb[data-amb="consultorio"]'));
await esperar(120);
tap($('.tab[data-go="mes"]'));
await esperar(80);
ok(soloNum($('#totIn').textContent) === '850.00', `Consultorio: entró 850.00 (dio ${$('#totIn').textContent})`);
ok(soloNum($('#totOut').textContent) === '320.00', `Consultorio: salió 320.00 (dio ${$('#totOut').textContent})`);
ok(soloNum($('#totNet').textContent) === '530.00', `Consultorio: queda 530.00 (dio ${$('#totNet').textContent})`);
ok($('#barsIn').textContent.includes('Resina'), 'las barras de Consultorio sí muestran Resina');
ok(!$('#barsOut').textContent.includes('Comida'), 'y no muestran gastos personales');

/* ── 7. Historial por sección ───────────────────────── */

console.log('\n7. Historial por sección');
tap($('.tab[data-go="historial"]'));
await esperar(80);
ok($$('#lista .row').length === 2, `Consultorio: 2 movimientos (${$$('#lista .row').length})`);
ok($('#lista').textContent.includes('molar superior'), 'la nota se conserva');
ok(!$('#lista').textContent.includes('despensa'), 'no aparecen los de Personal');
ok($('#histCount').textContent.includes('Consultorio'), 'el contador dice de qué sección es');

tap($('.amb[data-amb="personal"]'));
await esperar(120);
ok($$('#lista .row').length === 2, `Personal: 2 movimientos (${$$('#lista .row').length})`);
ok($('#lista').textContent.includes('despensa'), 'sí aparece el gasto personal');
ok(!$('#lista').textContent.includes('molar superior'), 'y no el del consultorio');

/* ── 8. Respaldo: las DOS secciones ─────────────────── */

console.log('\n8. Respaldo');
tap($('.tab[data-go="ajustes"]'));
await esperar(80);
tap($('#exportJson'));
await esperar(150);

ok(descargas.length === 1, 'se disparó una descarga');
ok(/^finanzas-\d{4}-\d{2}-\d{2}\.json$/.test(descargas[0]?.nombre || ''), `nombre con fecha: ${descargas[0]?.nombre}`);

const respaldo = JSON.parse(ultimoBlob._texto);
const textoRespaldo = ultimoBlob._texto;
ok(respaldo.movimientos.length === 4, `el respaldo trae los 4 movimientos, no solo la sección activa (${respaldo.movimientos.length})`);
ok(respaldo.movimientos.filter((m) => m.ambito === 'consultorio').length === 2, '2 son de Consultorio');
ok(respaldo.movimientos.filter((m) => m.ambito === 'personal').length === 2, '2 son de Personal');
ok(respaldo.categorias.consultorio && respaldo.categorias.personal, 'guarda las categorías de las dos secciones');
ok(respaldo.movimientos.every((m) => Number.isInteger(m.centavos)), 'los montos van en centavos enteros');

tap($('#exportCsv'));
await esperar(100);
const csv = ultimoBlob._texto;
ok(csv.startsWith('﻿'), 'el CSV lleva BOM para que Excel no rompa los acentos');
// El BOM va antes del encabezado, hay que quitarlo para comparar.
ok(csv.replace(/^﻿/, '').split('\r\n')[0].startsWith('seccion;'), 'el CSV abre con la columna de sección');
ok(csv.split('\r\n').length === 5, `el CSV tiene encabezado + 4 filas (${csv.split('\r\n').length})`);
ok(csv.includes('Personal;') && csv.includes('Consultorio;'), 'el CSV distingue las dos secciones');

/* ── 9. Borrar afecta SOLO a la sección activa ──────── */

console.log('\n9. Borrar solo la sección activa');
tap($('#borrarTodo')); // estamos en Personal
await esperar(200);
tap($('.tab[data-go="historial"]'));
await esperar(80);
ok($$('#lista .row').length === 0, 'Personal quedó vacío');

tap($('.amb[data-amb="consultorio"]'));
await esperar(120);
ok($$('#lista .row').length === 2, `Consultorio conserva sus 2 movimientos (${$$('#lista .row').length})`);

/* ── 10. Restaurar ──────────────────────────────────── */

console.log('\n10. Restaurar');
tap($('.tab[data-go="ajustes"]'));
await esperar(60);
const input = $('#importFile');
Object.defineProperty(input, 'files', { value: [{ text: () => Promise.resolve(textoRespaldo) }], configurable: true });
input.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(300);

tap($('.amb[data-amb="personal"]'));
await esperar(120);
tap($('.tab[data-go="mes"]'));
await esperar(80);
ok(soloNum($('#totNet').textContent) === '750.00', `Personal vuelve a cuadrar en 750.00 (dio ${$('#totNet').textContent})`);

tap($('.amb[data-amb="consultorio"]'));
await esperar(120);
ok(soloNum($('#totNet').textContent) === '530.00', 'Consultorio no se duplicó al restaurar');

/* ── 11. Categorías por sección ─────────────────────── */

console.log('\n11. Categorías por sección');
tap($('.tab[data-go="ajustes"]'));
await esperar(80);
const form = $('.addcat[data-tipo="ingreso"]');
form.querySelector('input').value = 'Blanqueamiento';
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await esperar(150);
ok($('#catIn').textContent.includes('Blanqueamiento'), 'se agrega en Consultorio');

tap($('.amb[data-amb="personal"]'));
await esperar(150);
ok(!$('#catIn').textContent.includes('Blanqueamiento'), 'NO aparece en Personal');
ok($('#ambNombre').textContent === 'Personal', 'la etiqueta dice de qué sección son las categorías');

/* ── 12. Fecha local ────────────────────────────────── */

console.log('\n12. Fecha');
const h = new Date();
const esperado = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
ok($('#fechaInput').value === esperado, `la fecha usa el día local ${esperado} (dio ${$('#fechaInput').value})`);

/* ── Resultado ──────────────────────────────────────── */

console.log(`\n${'─'.repeat(56)}`);
console.log(fallos === 0 ? `TODO BIEN — ${pasos} comprobaciones` : `${fallos} FALLAS de ${pasos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);

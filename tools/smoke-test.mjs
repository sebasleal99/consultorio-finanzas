/* Prueba de humo: monta un DOM y un IndexedDB falsos y ejecuta el flujo real
 * de la app — capturar, guardar, totales del mes, historial, exportar,
 * borrar, restaurar.
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
  if (cond) {
    console.log(`  OK    ${msg}`);
  } else {
    fallos++;
    console.log(`  FALLA ${msg}`);
  }
}

const esperar = (ms = 40) => new Promise((r) => setTimeout(r, ms));

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

// Capturamos las descargas en vez de escribir archivos.
const descargas = [];
const clickReal = window.HTMLAnchorElement.prototype.click;
window.HTMLAnchorElement.prototype.click = function () {
  if (this.download) descargas.push({ nombre: this.download, href: this.href });
  else clickReal.call(this);
};

// Blob.text() no existe en jsdom; lo necesitamos para importar.
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

const appjs = readFileSync(join(ROOT, 'app.js'), 'utf8');
window.eval(appjs);

await esperar(150);

const doc = window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const tap = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const teclear = (k) => tap($(`#keypad button[data-k="${k}"]`));

/* ── 1. Arranque ────────────────────────────────────── */

console.log('\n1. Arranque');
ok($('#montoOut').textContent === '0.00', 'el monto arranca en 0.00');
ok($('#guardarBtn').disabled === true, 'Guardar arranca deshabilitado');
ok($$('#chips .chip').length === 8, `se pintan las 8 categorías de ingreso (${$$('#chips .chip').length})`);
ok($('.seg-in').classList.contains('is-on'), 'arranca en "Entró"');
ok($('#fechaLabel').textContent === 'Hoy', 'la fecha arranca en Hoy');

/* ── 2. Teclado ─────────────────────────────────────── */

console.log('\n2. Teclado');
teclear('1'); teclear('5'); teclear('00');
ok($('#montoOut').textContent === '15.00', `1,5,00 da 15.00 (dio ${$('#montoOut').textContent})`);
teclear('del');
ok($('#montoOut').textContent === '1.50', `borrar deja 1.50 (dio ${$('#montoOut').textContent})`);
teclear('del'); teclear('del'); teclear('del');
ok($('#montoOut').textContent === '0.00', 'se puede vaciar por completo');

teclear('8'); teclear('5'); teclear('0'); teclear('00');
ok($('#montoOut').textContent === '850.00', `850.00 se arma bien (dio ${$('#montoOut').textContent})`);
ok($('#guardarBtn').disabled === true, 'sigue deshabilitado sin categoría elegida');

/* ── 3. Guardar un ingreso ──────────────────────────── */

console.log('\n3. Guardar un ingreso');
const chipResina = $$('#chips .chip').find((c) => c.textContent === 'Resina');
tap(chipResina);
ok($('#guardarBtn').disabled === false, 'con monto y categoría, Guardar se habilita');

$('#notaInput').value = 'molar superior';
tap($('#guardarBtn'));
await esperar(120);

ok($('#montoOut').textContent === '0.00', 'tras guardar, el monto se limpia');
ok($('#notaInput').value === '', 'tras guardar, la nota se limpia');

/* ── 4. Guardar un egreso ───────────────────────────── */

console.log('\n4. Guardar un egreso');
tap($('.seg-out'));
ok($('.seg-out').classList.contains('is-on'), 'cambia a "Salió"');
const catsEgreso = $$('#chips .chip').map((c) => c.textContent);
ok(catsEgreso.includes('Laboratorio'), 'las categorías cambian a las de egreso');

teclear('3'); teclear('2'); teclear('0'); teclear('00');
tap($$('#chips .chip').find((c) => c.textContent === 'Laboratorio'));
tap($('#guardarBtn'));
await esperar(120);

/* ── 5. Totales del mes ─────────────────────────────── */

console.log('\n5. Totales del mes');
tap($('.tab[data-go="mes"]'));
await esperar(60);

const soloNum = (s) => s.replace(/[^\d.-]/g, '');
ok(soloNum($('#totIn').textContent) === '850.00', `entró = 850.00 (dio ${$('#totIn').textContent})`);
ok(soloNum($('#totOut').textContent) === '320.00', `salió = 320.00 (dio ${$('#totOut').textContent})`);
ok(soloNum($('#totNet').textContent) === '530.00', `queda = 530.00 (dio ${$('#totNet').textContent})`);
ok($('#barsIn').textContent.includes('Resina'), 'la barra de ingresos muestra Resina');
ok($('#barsOut').textContent.includes('Laboratorio'), 'la barra de egresos muestra Laboratorio');

/* ── 6. Historial ───────────────────────────────────── */

console.log('\n6. Historial');
tap($('.tab[data-go="historial"]'));
await esperar(60);
ok($$('#lista .row').length === 2, `hay 2 movimientos (${$$('#lista .row').length})`);
ok($('#lista').textContent.includes('molar superior'), 'la nota se conserva');
ok($('#histCount').textContent.includes('2'), 'el contador dice 2');

/* ── 7. Respaldo ────────────────────────────────────── */

console.log('\n7. Respaldo');
tap($('.tab[data-go="ajustes"]'));
await esperar(60);
tap($('#exportJson'));
await esperar(120);

ok(descargas.length === 1, 'se disparó una descarga');
ok(/^finanzas-\d{4}-\d{2}-\d{2}\.json$/.test(descargas[0]?.nombre || ''), `nombre con fecha: ${descargas[0]?.nombre}`);

const respaldo = JSON.parse(ultimoBlob._texto);
ok(respaldo.formato === 'consultorio-finanzas', 'el respaldo lleva marca de formato');
ok(respaldo.movimientos.length === 2, `el respaldo trae los 2 movimientos (${respaldo.movimientos.length})`);
ok(respaldo.movimientos.every((m) => Number.isInteger(m.centavos)), 'los montos van en centavos enteros, sin decimales flotantes');

const textoRespaldo = ultimoBlob._texto;

tap($('#exportCsv'));
await esperar(80);
const csv = ultimoBlob._texto;
ok(csv.startsWith('﻿'), 'el CSV lleva BOM para que Excel no rompa los acentos');
ok(csv.includes(';'), 'el CSV usa punto y coma');
ok(csv.split('\r\n').length === 3, `el CSV tiene encabezado + 2 filas (${csv.split('\r\n').length})`);

/* ── 8. Borrar todo y restaurar ─────────────────────── */

console.log('\n8. Borrar todo y restaurar');
tap($('#borrarTodo'));
await esperar(120);
tap($('.tab[data-go="historial"]'));
await esperar(60);
ok($$('#lista .row').length === 0, 'tras borrar no queda nada');
ok($('#lista').textContent.includes('Todavía no capturas'), 'aparece el mensaje de vacío');

tap($('.tab[data-go="ajustes"]'));
await esperar(40);
const fakeFile = { text: () => Promise.resolve(textoRespaldo) };
const input = $('#importFile');
Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true });
input.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(250);

tap($('.tab[data-go="historial"]'));
await esperar(60);
ok($$('#lista .row').length === 2, `restaurar devuelve los 2 movimientos (${$$('#lista .row').length})`);

tap($('.tab[data-go="mes"]'));
await esperar(60);
ok(soloNum($('#totNet').textContent) === '530.00', 'los totales cuadran igual tras restaurar');

/* ── 9. Categorías ──────────────────────────────────── */

console.log('\n9. Categorías');
tap($('.tab[data-go="ajustes"]'));
await esperar(60);
const form = $('.addcat[data-tipo="ingreso"]');
form.querySelector('input').value = 'Blanqueamiento';
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await esperar(120);
ok($('#catIn').textContent.includes('Blanqueamiento'), 'se agrega una categoría nueva');

tap($('.tab[data-go="capturar"]'));
await esperar(40);
tap($('.seg-in'));
ok($$('#chips .chip').some((c) => c.textContent === 'Blanqueamiento'), 'la categoría nueva aparece al capturar');

/* ── 10. Fecha local, no UTC ────────────────────────── */

console.log('\n10. Fecha');
const hoyLocal = new Date();
const esperado = `${hoyLocal.getFullYear()}-${String(hoyLocal.getMonth() + 1).padStart(2, '0')}-${String(hoyLocal.getDate()).padStart(2, '0')}`;
ok($('#fechaInput').value === esperado, `la fecha usa el día local ${esperado} (dio ${$('#fechaInput').value})`);

/* ── Resultado ──────────────────────────────────────── */

console.log(`\n${'─'.repeat(52)}`);
console.log(fallos === 0 ? `TODO BIEN — ${pasos} comprobaciones` : `${fallos} FALLAS de ${pasos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);

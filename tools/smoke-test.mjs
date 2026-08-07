/* Prueba de humo: DOM e IndexedDB falsos, flujo real de la app.
 *
 * Vigila sobre todo dos cosas: que Consultorio y Personal no se mezclen,
 * y que la aritmética de dinero cuadre al centavo.
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
const esperar = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/* ── Montaje ────────────────────────────────────────── */

const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
});
const { window } = dom;

window.indexedDB = new FDBFactory();
window.IDBKeyRange = FDBKeyRange;
let n = 0;
window.crypto = { randomUUID: () => 'id-' + (++n) };
window.scrollTo = () => {};
window.confirm = () => true;
window.alert = () => {};
window.URL.createObjectURL = () => 'blob:fake';
window.URL.revokeObjectURL = () => {};

const descargas = [];
const clickReal = window.HTMLAnchorElement.prototype.click;
window.HTMLAnchorElement.prototype.click = function () {
  if (this.download) descargas.push({ nombre: this.download });
  else clickReal.call(this);
};

let ultimoBlob = null;
const BlobReal = window.Blob;
window.Blob = class extends BlobReal {
  constructor(parts, opts) { super(parts, opts); this._texto = parts.join(''); ultimoBlob = this; }
  text() { return Promise.resolve(this._texto); }
};

window.eval(readFileSync(join(ROOT, 'app.js'), 'utf8'));
await esperar(250);

const doc = window.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const tap = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const teclear = (k) => tap($(`#keypad button[data-k="${k}"]`));
const soloNum = (s) => s.replace(/[^\d.-]/g, '');
const cats = () => $$('#chips .chip').map((c) => c.textContent);
const irA = async (t) => { tap($(`.tab[data-go="${t}"]`)); await esperar(90); };
const enviar = (sel) => $(sel).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

function escribir(sel, v) {
  const el = $(sel);
  el.value = v;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function capturar(digitos, categoria, nota = '') {
  for (const d of digitos) teclear(d);
  tap($$('#chips .chip').find((c) => c.textContent === categoria));
  $('#notaInput').value = nota;
  tap($('#guardarBtn'));
  await esperar(140);
}

/* ── 1. Arranque ────────────────────────────────────── */

console.log('\n1. Arranque');
ok($('#montoOut').textContent === '0.00', 'el monto arranca en 0.00');
ok($('#guardarBtn').disabled === true, 'Guardar arranca deshabilitado');
ok($('.amb[data-amb="consultorio"]').classList.contains('is-on'), 'arranca en Consultorio');
ok(cats().length === 8, `8 categorías de ingreso (${cats().length})`);
ok($$('.tab').length === 5, `hay 5 pestañas (${$$('.tab').length})`);

/* ── 2. Teclado ─────────────────────────────────────── */

console.log('\n2. Teclado');
teclear('1'); teclear('5'); teclear('00');
ok($('#montoOut').textContent === '15.00', `1,5,00 da 15.00 (dio ${$('#montoOut').textContent})`);
teclear('del');
ok($('#montoOut').textContent === '1.50', 'borrar deja 1.50');
teclear('del'); teclear('del'); teclear('del');
ok($('#montoOut').textContent === '0.00', 'se puede vaciar');

/* ── 3. Capturar en las dos secciones ───────────────── */

console.log('\n3. Capturar');
await capturar(['8', '5', '0', '00'], 'Resina', 'molar superior');
tap($('.seg-out'));
await capturar(['3', '2', '0', '00'], 'Laboratorio');

tap($('.amb[data-amb="personal"]'));
await esperar(150);
tap($('.seg-in'));
await esperar(60);
ok(cats().includes('Retiro del consultorio'), 'Personal tiene sus propias categorías');
await capturar(['1', '2', '0', '0', '00'], 'Retiro del consultorio');
tap($('.amb[data-amb="consultorio"]'));
await esperar(150);

/* ── 4. Dashboard de salud ──────────────────────────── */

console.log('\n4. Salud');
await irA('salud');
ok(soloNum($('#totIn').textContent) === '850.00', `entró 850.00 (dio ${$('#totIn').textContent})`);
ok(soloNum($('#totOut').textContent) === '320.00', `salió 320.00 (dio ${$('#totOut').textContent})`);
ok(soloNum($('#totNet').textContent) === '530.00', `queda 530.00 (dio ${$('#totNet').textContent})`);

// margen = 530/850 = 62.35% -> 62%
ok($('#heroV').textContent === '62%', `margen 62% (dio ${$('#heroV').textContent})`);
ok($('#heroLect').textContent === 'Sano', `lectura "Sano" (dio ${$('#heroLect').textContent})`);
ok($('#hero').classList.contains('pos'), 'el hero se marca como positivo');
ok($('#heroEscala').children.length === 1, 'la escala pone la marca del margen');

const kpiTxt = $('#kpis').textContent;
ok(kpiTxt.includes('Razón de gasto'), 'aparece la razón de gasto');
ok(kpiTxt.includes('38%'), `razón de gasto 38% — 320/850 (kpis: ${kpiTxt.slice(0, 80)}…)`);
ok(kpiTxt.includes('Concentración'), 'aparece la concentración de ingresos');
ok($('#barsIn').textContent.includes('Resina'), 'el desglose muestra Resina');
ok(!$('#barsIn').textContent.includes('Retiro'), 'y no mezcla lo de Personal');

/* ── 5. Gastos fijos ────────────────────────────────── */

console.log('\n5. Gastos fijos');
await irA('compromisos');
escribir('#fijoNombre', 'Renta');
escribir('#fijoMonto', '9000');
escribir('#fijoDia', '5');
enviar('#formFijo');
await esperar(220);

ok($('#listaFijos').textContent.includes('Renta'), 'el gasto fijo aparece en la lista');
ok($('#listaFijos').textContent.includes('9,000.00'), `con su monto (${$('#listaFijos').querySelector('.cr-monto')?.textContent})`);
ok($('#resumenComp').textContent.includes('9,000.00'), 'y entra al resumen del mes');

// Pagarlo crea un movimiento real
tap($('#listaFijos').querySelector('.btn-pagar'));
await esperar(250);
ok($('#listaFijos').querySelector('.pagado-tag') !== null, 'queda marcado como pagado');
await irA('salud');
ok(soloNum($('#totOut').textContent) === '9320.00', `el pago suma a los egresos: 9,320.00 (dio ${$('#totOut').textContent})`);

// Y no se puede pagar dos veces
await irA('compromisos');
ok($('#listaFijos').querySelector('.btn-pagar') === null, 'ya no ofrece pagarlo otra vez');

/* ── 6. Compras a meses sin intereses ───────────────── */

console.log('\n6. Meses sin intereses');
escribir('#msiNombre', 'Autoclave');
escribir('#msiTotal', '12000');
escribir('#msiMeses', '12');
ok($('#msiPreview').textContent.includes('1,000.00'), `la vista previa calcula la mensualidad (${$('#msiPreview').textContent})`);
enviar('#formMsi');
await esperar(250);

ok($('#listaMsi').textContent.includes('Autoclave'), 'la compra aparece');
ok($('#listaMsi').textContent.includes('Cuota 1 de 12'), `arranca en la cuota 1 (${$('#listaMsi').querySelector('.cr-s')?.textContent})`);
ok($('#listaMsi').textContent.includes('faltan $12,000.00'), 'el saldo pendiente es el total');

tap($('#listaMsi').querySelector('.btn-pagar'));
await esperar(250);
ok($('#listaMsi').textContent.includes('Pagadas 1 de 12'), `avanza a 1 de 12 (${$('#listaMsi').querySelector('.cr-prog .cr-s')?.textContent})`);
ok($('#listaMsi').textContent.includes('faltan $11,000.00'), 'y el saldo baja a 11,000');

await irA('salud');
ok(soloNum($('#totOut').textContent) === '10320.00', `la cuota entra a egresos: 10,320.00 (dio ${$('#totOut').textContent})`);
ok($('#kpis').textContent.includes('Deuda a meses'), 'aparece el indicador de deuda a meses');

/* ── 7. Redondeo: las cuotas suman exacto ───────────── */

console.log('\n7. Redondeo de cuotas');
await irA('compromisos');
escribir('#msiNombre', 'Sillón');
escribir('#msiTotal', '10000');   // 1,000,000 centavos entre 7 no es exacto
escribir('#msiMeses', '7');
enviar('#formMsi');
await esperar(250);

const respaldoPrev = null;
tap($('#exportJson'));
await esperar(200);
const datos = JSON.parse(ultimoBlob._texto);
const sillon = datos.compromisos.consultorio.msi.find((m) => m.nombre === 'Sillón');
ok(!!sillon, 'la compra con división inexacta se guardó');
if (sillon) {
  const base = Math.round(sillon.totalCentavos / sillon.meses);
  const suma = base * (sillon.meses - 1) + (sillon.totalCentavos - base * (sillon.meses - 1));
  ok(suma === sillon.totalCentavos, `las 7 cuotas suman exactamente el total (${suma} = ${sillon.totalCentavos})`);
  ok(sillon.totalCentavos === 1000000, `el total se guardó en centavos enteros (${sillon.totalCentavos})`);
}

/* ── 8. Tarjetas de crédito ─────────────────────────── */

console.log('\n8. Tarjetas');
const hoy = new Date();
const diaHoy = hoy.getDate();
escribir('#tarNombre', 'BBVA');
escribir('#tarDiaPago', String(diaHoy));   // vence hoy
$('#tarAviso').value = '3';
enviar('#formTarjeta');
await esperar(250);

ok($('#listaTarjetas').textContent.includes('BBVA'), 'la tarjeta aparece');
ok($('#listaTarjetas').textContent.includes('HOY'), `avisa que se paga hoy (${$('#listaTarjetas').querySelector('.cr-s')?.textContent})`);
ok($('#listaTarjetas').querySelector('.comprow').classList.contains('urge'), 'y se marca como urgente');

await irA('capturar');
ok($('#avisos').children.length === 1, 'el aviso salta en la pantalla de captura');
ok($('#avisos').textContent.includes('BBVA'), 'con el nombre de la tarjeta');

/* ── 9. El respaldo lleva todo ──────────────────────── */

console.log('\n9. Respaldo');
await irA('ajustes');
tap($('#exportJson'));
await esperar(220);
const r2 = JSON.parse(ultimoBlob._texto);
const textoRespaldo = ultimoBlob._texto;
ok(r2.compromisos && r2.compromisos.consultorio, 'el respaldo incluye los compromisos');
ok(r2.compromisos.consultorio.fijos.length === 1, '1 gasto fijo');
ok(r2.compromisos.consultorio.msi.length === 2, '2 compras a meses');
ok(r2.compromisos.consultorio.tarjetas.length === 1, '1 tarjeta');
ok(r2.movimientos.filter((m) => m.origen).length === 2, 'los pagos quedan ligados a su compromiso');
ok(r2.movimientos.every((m) => Number.isInteger(m.centavos)), 'todos los montos en centavos enteros');

/* ── 10. Restaurar no duplica ───────────────────────── */

console.log('\n10. Restaurar');
const input = $('#importFile');
Object.defineProperty(input, 'files', { value: [{ text: () => Promise.resolve(textoRespaldo) }], configurable: true });
input.dispatchEvent(new window.Event('change', { bubbles: true }));
await esperar(400);
await irA('compromisos');
ok($$('#listaMsi .comprow').length === 2, `siguen siendo 2 compras, no 4 (${$$('#listaMsi .comprow').length})`);
ok($$('#listaTarjetas .comprow').length === 1, 'y 1 tarjeta');
await irA('salud');
ok(soloNum($('#totOut').textContent) === '10320.00', 'los totales no se duplicaron');

/* ── 11. Las secciones siguen sin mezclarse ─────────── */

console.log('\n11. Secciones');
tap($('.amb[data-amb="personal"]'));
await esperar(180);
await irA('salud');
ok(soloNum($('#totIn').textContent) === '1200.00', `Personal: entró 1,200.00 (dio ${$('#totIn').textContent})`);
ok(soloNum($('#totOut').textContent) === '0.00', 'Personal no heredó los egresos del consultorio');
await irA('compromisos');
ok(!$('#listaFijos').textContent.includes('Renta'), 'Personal no ve los gastos fijos del consultorio');
ok(!$('#listaMsi').textContent.includes('Autoclave'), 'ni sus compras a meses');

/* ── 12. Fecha local ────────────────────────────────── */

console.log('\n12. Fecha');
await irA('capturar');
const esperado = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(diaHoy).padStart(2, '0')}`;
ok($('#fechaInput').value === esperado, `la fecha usa el día local ${esperado} (dio ${$('#fechaInput').value})`);

/* ── Resultado ──────────────────────────────────────── */

console.log(`\n${'─'.repeat(58)}`);
console.log(fallos === 0 ? `TODO BIEN — ${pasos} comprobaciones` : `${fallos} FALLAS de ${pasos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);

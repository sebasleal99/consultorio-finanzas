/* Prueba de humo: DOM e IndexedDB falsos, flujo real de la app.
 *
 * Vigila sobre todo dos cosas: que Consultorio y Personal no se mezclen,
 * y que la aritmética de dinero cuadre al centavo.
 *
 * Uso:  npm test
 */

import { readFileSync, existsSync } from 'node:fs';
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

/* ── 13. Nómina e ingresos fijos ────────────────────── */

console.log('\n13. Nómina');
tap($('.amb[data-amb="consultorio"]'));
await esperar(180);
await irA('compromisos');

escribir('#nomNombre', 'Nómina');
escribir('#nomMonto', '18000');
escribir('#nomDia', '15');
enviar('#formNomina');
await esperar(260);
ok($('#listaNomina').textContent.includes('Nómina'), 'el ingreso fijo aparece');
ok($('#listaNomina').textContent.includes('18,000.00'), 'con su monto');
ok($('#listaNomina').querySelector('.comprow').classList.contains('entra'), 'se pinta como algo que entra, no que sale');
ok($('#listaNomina').querySelector('.btn-pagar').textContent === 'Cobré', 'el botón dice Cobré, no Pagar');
ok($('#resumenComp').textContent.includes('Falta por cobrar'), 'el resumen separa lo que entra de lo que sale');

// La nómina varía: al cobrarla se ajusta el monto sin tocar la definición.
window.prompt = () => '17500';
tap($('#listaNomina').querySelector('.btn-pagar'));
await esperar(280);
ok($('#listaNomina').querySelector('.pagado-tag') !== null, 'queda marcada como cobrada');
ok($('#listaNomina').textContent.includes('17,500.00'), `muestra lo que de verdad entró, no lo planeado (${$('#listaNomina').querySelector('.cr-monto')?.textContent})`);

await irA('salud');
ok(soloNum($('#totIn').textContent) === '18350.00', `el cobro suma a ingresos: 850 + 17,500 (dio ${$('#totIn').textContent})`);
ok($('#kpis').textContent.includes('Ingreso asegurado'), 'aparece el indicador de ingreso asegurado');

// El monto base no se movió: sigue siendo 18,000 para el mes que viene.
await irA('ajustes');
tap($('#exportJson'));
await esperar(220);
const rNom = JSON.parse(ultimoBlob._texto);
const nomina = rNom.compromisos.consultorio.ingresos[0];
ok(nomina && nomina.centavos === 1800000, `la definición sigue en 18,000 (${nomina?.centavos})`);
const movNom = rNom.movimientos.find((m) => m.origen && m.origen.tipo === 'nomina');
ok(movNom && movNom.centavos === 1750000, `pero el movimiento guardó 17,500 (${movNom?.centavos})`);
ok(movNom && movNom.tipo === 'ingreso', 'y quedó como ingreso');

/* ── 14. Editar sin perder lo registrado ────────────── */

console.log('\n14. Editar sin perder');
await irA('compromisos');
const filaRenta = $$('#listaFijos .comprow').find((r) => r.textContent.includes('Renta'));
ok(!!filaRenta, 'la fila de Renta sigue ahí');
tap([...filaRenta.querySelectorAll('.btn-quitar')].find((b) => b.textContent === '✎'));
await esperar(120);
ok(filaRenta.querySelector('.cr-edit') !== null, 'se abre la edición en línea');

const inputs = filaRenta.querySelectorAll('.cr-edit input');
inputs[0].value = 'Renta del local';
inputs[1].value = '9500';
tap([...filaRenta.querySelectorAll('.cr-edit button')].find((b) => b.textContent === 'Guardar'));
await esperar(280);

ok($('#listaFijos').textContent.includes('Renta del local'), 'el nombre cambió');
ok($('#listaFijos').textContent.includes('9,500.00'), 'y el monto también');

await irA('salud');
ok(soloNum($('#totOut').textContent) === '10320.00', `el pago YA registrado sigue en 9,000: los egresos no se movieron (dio ${$('#totOut').textContent})`);

await irA('historial');
ok($('#lista').textContent.includes('Renta'), 'el movimiento viejo conserva su nota original');

/* ── 15. Captura rápida: atajos del icono ───────────── */

console.log('\n15. Captura rápida');
const man = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok(Array.isArray(man.shortcuts) && man.shortcuts.length === 2, `el manifiesto declara 2 atajos (${man.shortcuts?.length})`);
ok(man.shortcuts?.[0].url === './?t=ingreso', 'el primero abre en modo ingreso');
ok(man.shortcuts?.[1].url === './?t=egreso', 'el segundo en modo egreso');
ok(man.shortcuts?.every((s) => s.description), 'los dos llevan descripción');
ok(man.shortcuts?.every((s) => s.icons?.[0]?.src), 'y su propio icono');
for (const ic of ['icons/atajo-mas.png', 'icons/atajo-menos.png']) {
  ok(existsSync(join(ROOT, ic)), `existe ${ic}`);
}
const swTxt = readFileSync(join(ROOT, 'sw.js'), 'utf8');
ok(swTxt.includes("e.action === 'ingreso'"), 'el service worker atiende el botón +');
ok(swTxt.includes("e.action === 'egreso'"), 'y el botón −');

// La app abierta desde un atajo debe caer en el tipo correcto.
const dom2 = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/?t=egreso', pretendToBeVisual: true, runScripts: 'outside-only',
});
const w2 = dom2.window;
w2.indexedDB = new FDBFactory();
w2.IDBKeyRange = FDBKeyRange;
w2.crypto = { randomUUID: () => 'x-' + (++n) };
w2.scrollTo = () => {};
w2.confirm = () => true;
w2.eval(readFileSync(join(ROOT, 'app.js'), 'utf8'));
await esperar(300);
ok(w2.document.querySelector('.seg-out').classList.contains('is-on'), 'abrir con ?t=egreso arranca en "Salió"');
ok(w2.document.querySelector('#screen-capturar').hidden === false, 'y aterriza en la pantalla de capturar');
ok(!w2.location.search.includes('t='), 'el parámetro se limpia de la barra de direcciones');

/* ── 16. Todo lo de una tarjeta, junto ──────────────── */

console.log('\n16. Todo lo de una tarjeta');

// Una compra a meses cargada a la BBVA: 6,000 a 12 = 500 al mes.
await irA('compromisos');
escribir('#msiNombre', 'Laptop');
escribir('#msiTotal', '6000');
escribir('#msiMeses', '12');
const optBBVA = Array.from($('#msiTarjeta').options).find((o) => o.textContent === 'BBVA');
ok(!!optBBVA, 'se puede elegir la tarjeta al crear una compra a meses');
$('#msiTarjeta').value = optBBVA.value;
enviar('#formMsi');
await esperar(250);

// Y un gasto suelto pagado con esa misma tarjeta: 250.
await irA('capturar');
tap($('.seg[data-tipo="egreso"]'));
await esperar(80);
ok($('#pagoCon').hidden === false, 'al registrar una salida pregunta con qué se pagó');
const chipsTj = () => $$('#chipsTarjeta .chip').map((c) => c.textContent);
ok(chipsTj().includes('BBVA'), 'la tarjeta aparece como forma de pago');
ok(chipsTj()[0] === 'Efectivo o débito', 'y arranca en efectivo');
tap($$('#chipsTarjeta .chip').find((c) => c.textContent === 'BBVA'));
await esperar(60);
await capturar(['2', '5', '0', '00'], 'Insumos', 'Guantes');
ok($$('#chipsTarjeta .chip').find((c) => c.textContent === 'Efectivo o débito').classList.contains('is-on'),
  'al guardar vuelve a efectivo: la tarjeta no se queda pegada para el siguiente');

// El gasto quedó ligado a la tarjeta, no suelto por ahí.
await irA('ajustes');
tap($('#exportJson'));
await esperar(220);
const r16 = JSON.parse(ultimoBlob._texto);
const guantes = r16.movimientos.find((m) => m.nota === 'Guantes');
ok(!!guantes && guantes.tarjetaId === optBBVA.value, 'el gasto queda ligado a la tarjeta');

// La fila ya no habla solo de mensualidades: suma todo lo del mes.
await irA('compromisos');
const filaBBVA = $$('#listaTarjetas .comprow').find((r) => r.textContent.includes('BBVA'));
ok(!!filaBBVA, 'la tarjeta sigue en la lista');
ok(filaBBVA.textContent.includes('$750.00'), `la fila suma gasto y mensualidad: 250 + 500 (${filaBBVA.querySelector('.cr-s + .cr-s')?.textContent})`);

// Su pantalla: todo lo suyo junto.
tap(filaBBVA.querySelector('.cr-t.enlace'));
await esperar(150);
ok($('#screen-tarjeta').hidden === false, 'el nombre abre la pantalla de la tarjeta');
ok($('#tjNombre').textContent === 'BBVA', 'con el nombre de la tarjeta');
ok(soloNum($('#tjMes').textContent) === '750.00', `cargado este mes 750.00 (dio ${$('#tjMes').textContent})`);
ok(soloNum($('#tjDeuda').textContent) === '6000.00', `debes 6,000.00 a meses (dio ${$('#tjDeuda').textContent})`);
ok($('#tjMsi').textContent.includes('Laptop'), 'lista su compra a meses');
ok(!$('#tjMsi').textContent.includes('Autoclave'), 'y no las que no son suyas');
ok($('#tjMovs').textContent.includes('Guantes'), 'lista el gasto suelto que le cargaste');
ok($('#tjMovs').textContent.includes('Insumos'), 'con su categoría');
ok($('.tab[data-go="compromisos"]').classList.contains('is-on'), 'la pestaña de Compromisos se queda encendida');

// Pagar la mensualidad desde aquí no la cuenta dos veces.
tap($('#tjMsi').querySelector('.btn-pagar'));
await esperar(250);
ok(soloNum($('#tjMes').textContent) === '750.00', `pagarla no infla lo cargado del mes (dio ${$('#tjMes').textContent})`);
ok(soloNum($('#tjDeuda').textContent) === '5500.00', `y la deuda baja a 5,500 (dio ${$('#tjDeuda').textContent})`);

tap($('#tjVolver'));
await esperar(120);
ok($('#screen-compromisos').hidden === false, 'el botón de volver regresa a Compromisos');

/* ── 17. Juntar dos aparatos sin perder nada ────────── */

console.log('\n17. Juntar dos aparatos');

const importarTexto = async (txt) => {
  Object.defineProperty(input, 'files', { value: [{ text: () => Promise.resolve(txt) }], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await esperar(420);
};

tap($('.amb[data-amb="consultorio"]'));
await esperar(150);
await irA('ajustes');
tap($('#exportJson'));
await esperar(240);
const copiaVieja = ultimoBlob._texto;
const r17 = JSON.parse(copiaVieja);
ok(r17.tumbas !== undefined, 'el respaldo lleva las marcas de lo borrado');
ok(r17.movimientos.every((m) => m.actualizado), 'y cada movimiento lleva su sello de cuándo se tocó');

// Borrar aquí y restaurar un respaldo viejo que todavía lo trae.
await irA('historial');
const filaGuantes = $$('#lista .row').find((r) => r.textContent.includes('Guantes'));
ok(!!filaGuantes, 'el gasto de Guantes está en el historial');
tap(filaGuantes.querySelector('.row-del'));
await esperar(320);
ok(!$('#lista').textContent.includes('Guantes'), 'se borra');

await importarTexto(copiaVieja);
await irA('historial');
ok(!$('#lista').textContent.includes('Guantes'), 'lo borrado NO revive al restaurar un respaldo viejo');

// Un cambio más reciente hecho en el otro aparato debe ganar.
const otro = JSON.parse(copiaVieja);
const resina = otro.movimientos.find((m) => m.categoria === 'Resina');
ok(!!resina, 'hay un movimiento de Resina para probar el cambio');
resina.centavos = 90000;                  // 900.00 en vez de 850.00
resina.actualizado = Date.now() + 60000;  // como si se hubiera editado allá después
await importarTexto(JSON.stringify(otro));
await irA('historial');
ok($('#lista').textContent.includes('900.00'), 'el cambio más reciente del otro aparato gana');

// Y al revés: un cambio viejo no pisa lo que aquí es más nuevo.
const viejo = JSON.parse(copiaVieja);
const resina2 = viejo.movimientos.find((m) => m.categoria === 'Resina');
resina2.centavos = 100;
resina2.actualizado = 1;
await importarTexto(JSON.stringify(viejo));
await irA('historial');
ok($('#lista').textContent.includes('900.00'), 'y un cambio viejo no pisa lo nuevo');
ok(!$('#lista').textContent.includes('$ 1.00'), 'el monto viejo no se cuela');

// Un respaldo incompleto no puede vaciar la app: la ausencia no prueba nada.
const incompleto = JSON.parse(copiaVieja);
incompleto.movimientos = [];
incompleto.tumbas = {};
incompleto.compromisos = null;
await importarTexto(JSON.stringify(incompleto));
await irA('historial');
ok($('#lista').textContent.includes('Resina'), 'un respaldo vacío NO borra lo que ya tenías');
await irA('compromisos');
ok($('#listaTarjetas').textContent.includes('BBVA'), 'ni se lleva los compromisos');

/* ── Resultado ──────────────────────────────────────── */

console.log(`\n${'─'.repeat(58)}`);
console.log(fallos === 0 ? `TODO BIEN — ${pasos} comprobaciones` : `${fallos} FALLAS de ${pasos} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);

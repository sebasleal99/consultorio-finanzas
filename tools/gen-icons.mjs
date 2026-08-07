/* Genera los PNG de icono sin dependencias: rasterizado a mano + zlib de Node.
 *
 * Marca: dos barras sobre una línea base. La alta en menta (entró), la baja
 * en barro (salió) — los mismos colores semánticos que usa la app.
 *
 * Uso:  node tools/gen-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Codificador PNG (RGBA, 8 bits) ─────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // profundidad
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compresión
  ihdr[11] = 0;  // filtro
  ihdr[12] = 0;  // sin entrelazado

  // Cada scanline lleva un byte de filtro al frente (0 = ninguno).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Dibujo ─────────────────────────────────────────── */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const TEAL = hex('#0E6E7D');
const MINT = hex('#7FE3C4');
const CLAY = hex('#F2A184');
const LINE = hex('#4E9BA6');

/** ¿Está (x,y) dentro de un rectángulo de esquinas redondeadas? */
function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * @param {number} size  lado en píxeles
 * @param {boolean} maskable  si true: fondo a sangre y marca más chica
 *   (Android recorta el icono con una máscara y solo respeta el centro)
 */
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const S = 3; // supermuestreo 3x3 para bordes suaves

  // Geometría en fracción del lado.
  const inset = maskable ? 0 : 0.055;
  const corner = maskable ? 0 : 0.22;
  const scale = maskable ? 0.56 : 0.78; // tamaño de la marca dentro del icono

  const bx0 = inset * size, by0 = inset * size;
  const bx1 = (1 - inset) * size, by1 = (1 - inset) * size;
  const rad = corner * size;

  // Marca centrada
  const m = scale * size;
  const mx = (size - m) / 2;
  const my = (size - m) / 2;

  const baseY = my + m * 0.80;
  const barW = m * 0.26;
  const barR = barW / 2;
  const gap = m * 0.16;
  const totalW = barW * 2 + gap;
  const leftX = mx + (m - totalW) / 2;

  const tallTop = my + m * 0.14;
  const shortTop = my + m * 0.46;

  const lineY0 = baseY + m * 0.055;
  const lineY1 = lineY0 + Math.max(2, m * 0.045);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px_ = x + (sx + 0.5) / S;
          const py_ = y + (sy + 0.5) / S;

          let col = null;

          if (inRound(px_, py_, leftX, tallTop, leftX + barW, baseY, barR)) {
            col = MINT;
          } else if (inRound(px_, py_, leftX + barW + gap, shortTop, leftX + barW * 2 + gap, baseY, barR)) {
            col = CLAY;
          } else if (inRound(px_, py_, leftX - m * 0.06, lineY0, leftX + totalW + m * 0.06, lineY1, (lineY1 - lineY0) / 2)) {
            col = LINE;
          } else if (inRound(px_, py_, bx0, by0, bx1, by1, rad)) {
            col = TEAL;
          }

          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
        }
      }

      const n = S * S;
      const i = (y * size + x) * 4;
      if (a === 0) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      } else {
        // Premultiplicado inverso: promediamos color solo sobre las muestras cubiertas.
        const cov = a / n;
        px[i] = Math.round(r / (a / 255));
        px[i + 1] = Math.round(g / (a / 255));
        px[i + 2] = Math.round(b / (a / 255));
        px[i + 3] = Math.round(cov);
      }
    }
  }

  return encodePng(size, size, px);
}

/* ── Iconos de los atajos (mantener presionado el icono) ─────────────── */

// Verde y barro son los mismos del par divergente validado de la app.
const VERDE = hex('#0A8259');
const BARRO = hex('#BE4425');

/** Círculo de color con un signo blanco: + para ingreso, − para egreso. */
function renderSigno(size, mas) {
  const px = Buffer.alloc(size * size * 4);
  const S = 3;
  const col = mas ? VERDE : BARRO;

  const cx = size / 2, cy = size / 2;
  const rad = size * 0.46;
  const brazo = size * 0.26;   // media longitud del trazo
  const grosor = size * 0.085; // medio grosor

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px_ = x + (sx + 0.5) / S;
          const py_ = y + (sy + 0.5) / S;
          const dx = px_ - cx, dy = py_ - cy;
          if (dx * dx + dy * dy > rad * rad) continue;

          const enHorizontal = Math.abs(dx) <= brazo && Math.abs(dy) <= grosor;
          const enVertical = mas && Math.abs(dy) <= brazo && Math.abs(dx) <= grosor;
          const c = (enHorizontal || enVertical) ? [255, 255, 255] : col;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      if (a === 0) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      } else {
        px[i] = Math.round(r / (a / 255));
        px[i + 1] = Math.round(g / (a / 255));
        px[i + 2] = Math.round(b / (a / 255));
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return encodePng(size, size, px);
}

/* ── Salida ─────────────────────────────────────────── */

mkdirSync(join(ROOT, 'icons'), { recursive: true });

const salidas = [
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  ['icons/icon-maskable-512.png', 512, true],
];

for (const [rel, size, maskable] of salidas) {
  const buf = render(size, maskable);
  writeFileSync(join(ROOT, rel), buf);
  console.log(`${rel}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

for (const [rel, mas] of [['icons/atajo-mas.png', true], ['icons/atajo-menos.png', false]]) {
  const buf = renderSigno(96, mas);
  writeFileSync(join(ROOT, rel), buf);
  console.log(`${rel}  96x96  ${(buf.length / 1024).toFixed(1)} KB`);
}

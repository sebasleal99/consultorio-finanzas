# Ingresos y Egresos — Consultorio

App de bolsillo para anotar lo que entra y lo que sale del consultorio.

**Los datos nunca salen del teléfono.** No hay servidor, no hay cuenta, no hay quien los vea. Todo vive en el almacenamiento del navegador; la única forma de que un número salga de ahí es que lo exportes tú a propósito.

## Qué es

Una PWA: se instala en la pantalla de inicio y se abre a pantalla completa como cualquier app, pero por dentro es una página web. No pasa por Google Play, no necesita cuenta de desarrollador, y funciona sin internet.

- **Dos secciones separadas: Consultorio y Personal.** Cada una con sus movimientos, sus categorías y sus totales. No se suman nunca. El acento de color cambia con la sección para que no haya duda de dónde estás anotando
- Capturar toma tres toques: monto, tipo, categoría
- Resumen del mes con desglose por categoría
- Historial por día
- Respaldo a archivo (las dos secciones en uno), y restauración desde archivo
- Exportación a CSV que Excel en español abre bien

## Instalar en Android

1. Abre la dirección de la app en Chrome
2. Menú (⋮) → **Instalar aplicación** / *Agregar a pantalla principal*
3. Se instala y ya se abre como app

## Correrla en la computadora

```
npm run serve      # sirve en http://localhost:4173
```

Sin instalar nada: son archivos estáticos, cualquier servidor sirve.

## Desarrollo

La app **no tiene dependencias**. Las de `package.json` son solo para probarla.

```
npm install
npm test           # 38 comprobaciones del flujo completo, con DOM e IndexedDB falsos
npm run icons      # regenera los PNG desde tools/gen-icons.mjs
```

`npm test` monta la app en jsdom y ejecuta el recorrido real en las dos secciones: capturar, guardar, totales, historial, respaldar, borrar, restaurar. Vigila sobre todo que **Consultorio y Personal no se mezclen**. Si tocas `app.js`, córrelo antes de publicar.

## Detalles que importan

**Los montos se guardan en centavos, como enteros.** Nunca en decimales: `0.1 + 0.2` no da `0.3` en coma flotante y esto es dinero.

**Las fechas usan el día local, nunca `toISOString()`.** En México eso adelanta el día por la tarde y el movimiento quedaría con la fecha equivocada.

**El service worker no puede tumbar la app.** Si el modo sin conexión falla, la app abre igual.

## Estructura

```
index.html              armazón y pantallas
app.css                 estilos, claro y oscuro
app.js                  toda la lógica
manifest.webmanifest    metadatos de instalación
sw.js                   modo sin conexión
icons/                  PNG generados
tools/gen-icons.mjs     generador de iconos, sin dependencias
tools/smoke-test.mjs    prueba de humo
```

## Respaldo

**Ajustes → Respaldar** descarga un `.json`. Guárdalo donde lo vayas a encontrar: si pierdes el teléfono o borras los datos del navegador, el respaldo es lo único que queda.

Ese archivo también alimenta el resumen de la bóveda — ver `reference/App de ingresos y egresos.md` en la bóveda del consultorio.

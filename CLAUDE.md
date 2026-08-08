# Notas para Claude

**Responde siempre en español.** El usuario es el Dr. Leal Ricks, odontólogo, no
programador: explica en términos llanos y ejecuta en vez de preguntar cada paso.

**La memoria de Claude vive en `C:\Users\seble`**, no aquí. Si estás leyendo esto
es porque se abrió Claude desde esta carpeta y esa memoria no se cargó — ahí está
el contexto de quién es el usuario y qué más trae entre manos.

## Sobre este proyecto

Léete el `README.md`: explica qué es la app y las decisiones que no son obvias
(montos en centavos enteros, fechas locales, el service worker que no puede tumbar
la app, por qué un gasto de tarjeta no se cuenta dos veces).

**Corre `npm test` antes de dar por bueno cualquier cambio a `app.js`.** Son 107
comprobaciones sobre el flujo real, con DOM e IndexedDB falsos. Si tocas algo de
compromisos o tarjetas, agrega la comprobación que lo cubra.

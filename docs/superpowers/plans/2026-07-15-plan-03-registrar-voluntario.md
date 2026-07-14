# Plan 03 — Registrar voluntario (problema 3)

> **Para /build-loop:** materiales = este plan + `REGLAS.md`. Orden: 3º.

**Meta:** cédula solo por cámara con guía visual en pantalla, título
«Registrar voluntario», «Ciudad»→«Parroquia», y que el registro **funcione**,
con internet y sin internet (PWA instalada).

## Estado actual (verificado 2026-07-15)

- Wizard ya activo: `wizPublico('voluntario-form')` (`js/admin.js:1255`);
  11 campos → el «paso 6 de 13» del reporte de Luis cuadra con este form.
- Cédula = `<input id="vol-cedula" type="file" accept="image/*"
  capture="environment">` (`index.html:528-530`) — en escritorio y en varios
  Android abre la galería: **viola R3.2**.
- Campo ciudad: `index.html:522` (`#vol-ciudad`, label «Ciudad»).
- Submit: `js/admin.js:1287` → acción `registrar_voluntario`
  (edge fn `index.ts:293`).
- Cola offline: `services/api.js` ya encola acciones permitidas
  (`esAccionOffline`, línea ~329) cuando `navigator.onLine === false`.
- Motor de cámara unificado: `montarCamaraOferta(prefijo, fotos, max, alCambiar)`
  + `camaraHtml(prefijo)` + `pasoCamaraHtml(...)` en `js/admin.js`; con
  `max===1` ya da «Repetir foto» y 1280px/0.82.

## Tareas

### T1 — Diagnóstico de «no funciona» (antes de tocar nada)
Reproducir en Playwright el registro completo (cámara falsa: canvas repintado
por setInterval + `getUserMedia = async () => c.captureStream(30)`) capturando
el payload con el monkeypatch de `SheetsService.post` (captura y lanza; cero
escrituras a prod). Anotar el fallo real (candidatos: la foto en base64 supera
el límite del edge fn, validación del wizard bloquea el submit, o error de red
sin mensaje). Corregir la causa raíz encontrada, no el síntoma.

### T2 — Cédula por cámara con guía
- Sustituir el bloque `#vol-cedula` (`index.html:528-530`) por
  `pasoCamaraHtml('vol-cedula', …)` + `montarCamaraOferta('vol-cedula',
  fotoCedula, 1)` — el mismo patrón que las 3 fotos de
  `abrirRegistrarMotorizado`. El submit manda `fotoCedula[0]` con el mismo
  nombre de campo del payload actual (R2.3: el backend no cambia).
- **Guía visual** (nueva opción del motor, `guia:'cedula'`): overlay
  absoluto sobre el `<video>` con un marco redondeado de proporción de
  cédula (85.6:54), esquinas marcadas, exterior oscurecido
  (`box-shadow: 0 0 0 999px rgb(10 37 64 / .45)`) y texto
  `t('camera.idGuide')` = «Coloca la cédula dentro del marco» / «Place your
  ID inside the frame». Solo estilos con tokens (R4.1); el disparador sigue
  siendo el grande de R3.3. Esta opción la reusa el plan 04.
- La foto de cédula es identidad → viaja por la edge fn al bucket privado
  (R3.5); confirmar que `registrar_voluntario` ya lo hace y si no, hacerlo.

### T3 — Textos
- Título: cambiar el valor de la clave existente del hero de voluntarios
  (buscar «listo para ayudar» en `locales/es.json`) a **«Registrar
  voluntario»** y su gemela en `en.json` a **«Register volunteer»**.
- `#vol-ciudad`: label y placeholder pasan a **Parroquia** (es) / **Parish**
  (en). El `id` del campo y la columna de la base **no** cambian (sin
  migración; anotar en el plan de datos que `ciudad` guarda parroquia).

### T4 — Offline de verdad
- Confirmar que `registrar_voluntario` está en la lista `esAccionOffline` de
  `services/api.js`; si no, añadirla (el payload con foto base64 cabe en la
  cola IndexedDB).
- E2E offline en Playwright: `context.setOffline(true)` → registrar → mensaje
  de encolado (`messages.offlineQueue*`) → `setOffline(false)` → la cola
  vacía y el payload capturado por el monkeypatch.

### T5 — i18n + versión + commit (R1.2, R5.4, R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c 'type="file"' index.html` no incluye ninguno dentro de
   `#voluntario-form` (cero inputs de archivo en el form de voluntario).
3. `self` (Playwright, cámara falsa): registro completo pasa el wizard, toma
   cédula con la guía visible, y el payload capturado conserva los mismos
   nombres de campo que antes del cambio (R2.3).
4. `self`: flujo offline de T4 completo.
5. `self`: título dice «Registrar voluntario»/«Register volunteer» y el paso
   de ciudad dice «Parroquia»/«Parish», en ambos idiomas con cambio en
   caliente (R1.3).

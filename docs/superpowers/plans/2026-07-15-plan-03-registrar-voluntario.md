# Plan 03 — Registrar voluntario (problema 3)

> **Para /build-loop:** materiales = este plan + `REGLAS.md`. Orden: 3º.

## El problema, literal (del .txt)

> «Registrarse como voluntario, cuando se va a subir la cédula, aparece la
> opción de elegir archivo. Necesito que quites eso y que el usuario solo pueda
> abrir su cámara mediante la página para tomar una foto de su cédula. Haz una
> guía en la pantalla de dónde debería colocar la cédula para que se vea bien.
> Una imagen, me refiero, para que sea una guía en la cámara donde pueda poner
> su cédula. La parte de arriba dice "¿listo para ayudar?, regístrate como
> voluntario". Necesito que cambies eso a: "Registrar voluntario". En el paso 6
> de 13, donde dice ciudad, ahí debes cambiarlo por parroquia. Además, cuando se
> quiere registrar el usuario, no funciona. La aplicación, que está instalada,
> también debería funcionar cuando tiene acceso a internet y, cuando no lo
> tiene, sin ningún problema.»

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| Quitar «elegir archivo» de la cédula; solo cámara | T2 |
| Guía visual en pantalla de dónde colocar la cédula | T2 (overlay `guia:'cedula'`) |
| Título «¿Listo para ayudar?…» → «Registrar voluntario» | T3 |
| Paso 6 de 13: «Ciudad» → «Parroquia» | T3 |
| El registro «no funciona» | T1 (diagnóstico primero) |
| App instalada funciona con y sin internet | T4 |

## Estado actual (verificado 2026-07-17, anclas exactas)

- Wizard ya activo: `wizPublico('voluntario-form')` (`js/admin.js:1255`).
  11 campos + cédula + submit → cuadra con el «paso 6 de 13» que ve Luis.
- Cédula = `<input id="vol-cedula" type="file" accept="image/*"
  capture="environment">` (`index.html:528-530`) con preview
  `#vol-cedula-prev`. En escritorio y en varios Android `capture` es solo una
  *sugerencia*: abre el selector de archivos → **viola R3.2**.
- Campo ciudad: `index.html:522` — `<label for="vol-ciudad">Ciudad</label>
  <input id="vol-ciudad" autocomplete="address-level2" placeholder="Caraballeda">`.
- Submit: `js/admin.js:1287` → acción `registrar_voluntario`
  (edge fn `index.ts:293`). **En F0 leer el body completo de la acción** para
  saber cómo viaja hoy la foto (campo, tamaño máximo, bucket destino).
- Motor de cámara unificado ya construido (Tarea 5 del roadmap anterior):
  `montarCamaraOferta(prefijo, fotos, max, alCambiar)` + `camaraHtml(prefijo)`
  + `pasoCamaraHtml(id, titulo, ayuda)` en `js/admin.js`; con `max===1` da
  botón «Repetir foto» y calidad 1280px/0.82.
- Cola offline: `services/api.js:329` — `if (navigator.onLine === false &&
  esAccionOffline(data)) return encolar(data)`. **En F0 confirmar** si
  `registrar_voluntario` está en la lista `esAccionOffline`.

## Tareas

### T1 — Diagnóstico de «no funciona» (SIEMPRE antes de tocar)
Playwright a 390px, registro completo con cámara falsa
(`canvas` repintado por `setInterval` + `navigator.mediaDevices.getUserMedia =
async () => c.captureStream(30)`) y payload capturado con el monkeypatch de
`window.SheetsService.post` (captura y lanza — cero escrituras a prod).
Candidatos conocidos, en orden de sospecha:
1. La foto base64 supera el límite `s(p.foto…, 2_500_000)` del edge fn → error
   genérico. 2. Validación del wizard bloquea el paso de la cédula (input file
   dentro de `.field` y `wizPublico` esperando `value`). 3. Error de red/CORS
   sin mensaje traducido (R1.6). Documentar la causa raíz encontrada en el
   commit y arreglar ESA, no el síntoma.

### T2 — Cédula solo cámara + guía visual
- Sustituir el bloque `index.html:528-530` por un paso de cámara:

```html
<!-- reemplaza al input file: mismo lugar del form, R2.3 -->
${'' /* en index.html va el HTML estático equivalente a: */}
<div class="field full foto-field" id="vol-cedula-field" data-wiz-step>
  <!-- pasoCamaraHtml('vol-cedula', t('volunteers.idPhoto'), t('volunteers.idPhotoHelp')) -->
</div>
```

- `js/admin.js` (donde hoy se lee `#vol-cedula.files[0]`):
  `const fotoCedula = []; montarCamaraOferta('vol-cedula', fotoCedula, 1,
  null, { guia: 'cedula' });` y el submit manda `fotoCedula[0]` **en el mismo
  campo del payload que hoy** (R2.3: el backend no cambia).
- **Nueva opción `guia:'cedula'` del motor** (`montarCamaraOferta`): overlay
  encima del `<video>`:

```html
<div class="cam-guia" aria-hidden="true">
  <div class="cam-guia-marco"></div>
  <p class="cam-guia-texto"><!-- t('camera.idGuide') --></p>
</div>
```

```css
.cam-guia{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.cam-guia-marco{width:82%;aspect-ratio:856/540;border:2px dashed var(--surface);
  border-radius:12px;box-shadow:0 0 0 999px rgb(10 37 64 / .45)} /* tokens R4.1; 85.6:54 = cédula */
.cam-guia-texto{position:absolute;bottom:12px;color:var(--surface);font-size:.85rem}
```

  Claves: `camera.idGuide` = «Coloca la cédula dentro del marco» / «Place your
  ID inside the frame». El disparador sigue siendo el grande de R3.3.
- Privacidad: la cédula es identidad → debe viajar por la edge fn a bucket
  **privado** (R3.5). En F0 confirmar el destino actual de
  `registrar_voluntario`; si hoy va a bucket público, corregirlo ahí mismo.

### T3 — Textos exactos
- Localizar la clave del hero (buscar `listo para ayudar` en
  `locales/es.json`): valor es → **«Registrar voluntario»**, valor en →
  **«Register volunteer»**. Solo cambia el VALOR, no la clave (nada de tocar
  `setText`).
- `#vol-ciudad`: label → **«Parroquia»** / **«Parish»**; placeholder →
  ejemplo real de parroquia («Macuto»). El `id` del campo y la columna
  `ciudad` de la base **no cambian** (cero migración; queda anotado aquí que
  la columna `ciudad` almacena parroquia desde 2026-07).

### T4 — Offline de verdad (app instalada, PWA)
- Añadir `registrar_voluntario` a `esAccionOffline` en `services/api.js` si
  no está (el payload con foto base64 ~1-2 MB cabe en la cola IndexedDB).
- Mensajes de encolado ya existen (`messages.offlineQueue*`) — verificar que
  el form los muestra (no un error).
- E2E: `context.setOffline(true)` → registrar completo → mensaje de encolado;
  `setOffline(false)` → la cola se vacía y el payload capturado es idéntico
  al del camino online.

### T5 — i18n + versión + commit (R1.2, R5.4, R5.5). Claves nuevas:
`volunteers.idPhoto`, `volunteers.idPhotoHelp`, `camera.idGuide` (+ el cambio
de valor del hero y de ciudad→parroquia) en es **y** en.

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `sed -n '/id="voluntario-form"/,/<\/form>/p' index.html | grep -c
   'type="file"'` → **0** (cero inputs de archivo dentro del form).
3. `external`: `grep -c "cam-guia" js/admin.js css/app.css` ≥ 2 (la guía existe
   en motor y estilos).
4. `self` (Playwright, cámara falsa, payload capturado): registro completo —
   wizard avanza, la guía es visible sobre el visor en el paso de la cédula,
   el payload conserva los mismos nombres de campo que el HEAD base (R2.3).
5. `self`: flujo offline T4 completo; título «Registrar voluntario»/«Register
   volunteer» y paso «Parroquia»/«Parish» en ambos idiomas con cambio en
   caliente sin perder lo escrito ni la foto (R1.3/R1.4).

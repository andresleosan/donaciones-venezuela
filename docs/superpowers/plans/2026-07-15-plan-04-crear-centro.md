# Plan 04 — Crear-Centro (problema 4)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 03 (reusa
> la opción `guia:'cedula'` del motor de cámara). Orden: 4º.

## El problema, literal (del .txt)

> «https://donacionesvenezuela.vercel.app/crear-centro — Aquí en esta sección
> tampoco funciona bien toda la interfaz que estamos intentando hacer paso a
> paso para los formularios. Además, necesito que cambies también las partes de
> subir fotos para que solo se puedan tomar fotos directamente desde la
> aplicación, sin opción a seleccionar fotos guardadas en el dispositivo. Que
> permita tomar fotos directamente desde la aplicación, como el sitio y el ID.»

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| La interfaz paso a paso «no funciona bien» | T1 (diagnóstico) + T2 (wizard conforme) |
| Fotos solo desde la app, sin selección del dispositivo | T3 |
| Aplica a la foto del **sitio** y a la del **ID** | T3 (dos cámaras; el ID con guía) |

## Estado actual (verificado 2026-07-17, anclas exactas)

- El flujo vive en `js/panel.js` ~250: `campoFoto('pc-cedula',
  'modal.photoId')` — y el listener `#pc-cedula.addEventListener('change')`
  con preview `#pc-cedula-prev` (panel.js:255-266) lee
  `$('#pc-cedula').files[0]` → **inputs de archivo, violan R3.2**. El del
  sitio es su gemelo `pc-*` (localizar en F0 el prefijo exacto).
- La URL `/crear-centro` se sirve por rewrite de `vercel.json` sobre
  `ventana.html` (confirmar la línea exacta del rewrite en F0; el patrón ya
  existe también para `/panel-centro`, visto en admin.js:1176).
- Backend: `panel_crear` (edge fn `index.ts:598`) — exige PIN
  `/^[0-9]{4,8}$/`; crea el lugar + `centros_panel` con token `CTR-…` y hash
  del PIN (CLAUDE.md).
- Las páginas-ventana renden los flujos **en flujo, no en modal** (DESIGN.md
  §Modales) — `wizPublico` fue estrenado en forms de `index.html`; sospecha
  fundada de que aquí o no está aplicado o pelea con `hidden` vs `display`
  (R4.4, «el bug que más veces ha vuelto»).

## Tareas

### T1 — Diagnóstico con Playwright (SIEMPRE antes de tocar)
`/crear-centro` a 390px, recorrido completo con cámara falsa y payload
capturado (monkeypatch `SheetsService.post`, captura y lanza). Documentar QUÉ
está roto exactamente, con capturas: ¿wizard ausente?, ¿paso que no avanza?,
¿resumen oculto mal (R4.4: falta `.clase[hidden]{display:none}`)?, ¿submit que
falla?, ¿error sin traducir (R1.6)? Arreglar la causa raíz.

### T2 — Wizard conforme a REGLAS §2
- `wizPublico(<form de crear-centro>)` con TODAS las reglas: un campo por
  pantalla (R2.1), entra en «Paso 2 de N» (R2.2), ids y handler de submit
  intactos (R2.3), `opts.validar(paso)` por paso — el PIN valida
  `/^[0-9]{4,8}$/` en su paso, no al final (R2.4), Enter avanza (R2.5).
- Los bloques de foto pasan a pasos `[data-wiz-step]` con `pasoCamaraHtml`
  (mismo patrón que `abrirRegistrarMotorizado` en `js/admin.js`).
- Si el fallo de T1 es el conocido R4.4, además del fix puntual dejar la
  regla CSS defensiva del contenedor del wizard en `css/app.css`.

### T3 — Fotos solo cámara
- **Sitio**: `montarCamaraOferta('pc-sitio', fotoSitio, 1)` — obligatoria
  (R3.4: el transportista tiene que reconocer el sitio al llegar).
- **ID del responsable**: `montarCamaraOferta('pc-cedula', fotoCedula, 1,
  null, { guia: 'cedula' })` — la guía del plan 03, mismo overlay, mismas
  claves (`camera.idGuide`).
- Quitar los `<input type="file">` y sus listeners `change`/preview
  (panel.js:255-266); el submit manda `fotoSitio[0]`/`fotoCedula[0]` **en los
  mismos campos del payload actual** (R2.3).
- Identidad → bucket privado vía edge fn (R3.5): en F0 confirmar a qué bucket
  manda `panel_crear` la cédula; si es público, corregir en la misma corrida.
- Ubicación del centro: si el form pide dirección escrita como campo exacto,
  cambiar a GPS/clic en mapa Leaflet + nombre de referencia (R3.1) — mismo
  widget que `#ofrecer` (`js/vistas.js:83-130`, `mapaLeaflet`). Si ya cumple,
  no tocar (T1 lo dice).

### T4 — i18n + versión + commit
Claves nuevas es+en (R1.2); **`ventana.html` también lleva `?v=`** (R5.4);
commit Luismadef45 + push (R5.5). `verificar-idioma.py` cubre `js/panel.js`;
el recorrido E2E de `/crear-centro` lo cubre la regla 3.

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c 'type="file"' js/panel.js` → 0 en el flujo
   crear-centro (si otros flujos de panel.js legítimamente usan file para
   adjuntos admin, acotar el grep al rango del flujo con `sed -n`).
3. `self` (Playwright 390px, cámara falsa): `/crear-centro` completo en es y
   en en — wizard campo a campo con «Paso 2 de N» al entrar, ambas fotos se
   toman (la del ID muestra la guía), el PIN se valida en su paso, el resumen
   aparece, el payload capturado lleva PIN + 2 fotos con los nombres de campo
   del HEAD base, cero errores de consola, cero desbordes, táctiles ≥44px.
4. `self`: cambio de idioma a mitad del wizard no pierde lo escrito ni las
   fotos (R1.4 aplica también en páginas-ventana).

# Plan 04 — Crear-Centro (problema 4)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 03 (reusa
> la guía de cédula). Orden: 4º.

**Meta:** que el flujo paso a paso de https://donacionesvenezuela.vercel.app/crear-centro
funcione bien de punta a punta, y que TODAS las fotos (sitio e ID) se tomen
solo con la cámara, sin opción de elegir archivos del dispositivo.

## Estado actual (verificado 2026-07-15)

- El flujo vive en `js/panel.js` (~línea 250): `campoFoto('pc-cedula',
  'modal.photoId')` y su gemelo del sitio son **inputs de archivo** con
  preview — violan R3.2.
- La ruta `/crear-centro` se sirve vía rewrite de `vercel.json` sobre
  `ventana.html` (verificar el rewrite exacto en F0).
- Acción backend: `panel_crear` (edge fn `index.ts:598`), exige PIN 4-8
  dígitos.
- «No funciona bien la interfaz paso a paso»: síntoma reportado, causa por
  diagnosticar. Sospechoso conocido: R4.4 (`hidden` vs `display`) y el hecho
  de que `wizPublico` fue pensado para forms de `index.html` — en páginas
  ventana los modales se renden en flujo (DESIGN.md), puede que el wizard ni
  esté aplicado aquí.

## Tareas

### T1 — Diagnóstico con Playwright (primero)
Abrir `/crear-centro` a 390px, recorrer el form completo con cámara falsa y
payload capturado (monkeypatch `SheetsService.post`). Documentar qué está roto
exactamente: ¿wizard ausente?, ¿pasos que no avanzan?, ¿resumen oculto mal
(R4.4)?, ¿submit que falla? Arreglar la causa raíz.

### T2 — Wizard conforme a REGLAS
- Aplicar/reparar `wizPublico` sobre el form de crear-centro: un campo por
  pantalla (R2.1), entra en «Paso 2 de N» (R2.2), ids y submit intactos
  (R2.3), validación por paso (R2.4), Enter avanza (R2.5).
- Los dos bloques de foto se convierten en pasos `[data-wiz-step]` con
  `pasoCamaraHtml`, igual que en `abrirRegistrarMotorizado`.

### T3 — Fotos solo cámara
- `pc-sitio` (foto del sitio): `montarCamaraOferta('pc-sitio', fotoSitio, 1)`.
  Obligatoria (R3.4).
- `pc-cedula` (ID del responsable): `montarCamaraOferta('pc-cedula',
  fotoCedula, 1)` **con `guia:'cedula'`** (la opción creada en plan 03 T2).
  Identidad → bucket privado vía edge fn (R3.5); confirmar el destino actual
  de `panel_crear` y corregir si la sube a un bucket público.
- Payload sin cambios de nombres (R2.3): `fotoSitio[0]`/`fotoCedula[0]` van
  en los mismos campos que hoy manda `campoFoto`.
- Ubicación del centro: si el form aún pide dirección escrita, cambiarla a
  GPS o clic en mapa Leaflet + nombre de referencia (R3.1) — mismo patrón que
  ya usa `#ofrecer`.

### T4 — i18n + versión + commit
Claves nuevas en es+en (R1.2); `ventana.html` también lleva `?v=` (R5.4);
commit Luismadef45 (R5.5). Ojo: `verificar-idioma.py` y `e2e-idioma.js`
cubren `index.html`; el recorrido de `/crear-centro` se verifica con la regla
3 de abajo.

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -n 'type="file"' js/panel.js` → cero resultados en el
   flujo crear-centro (la cámara no deja rastro de input file).
3. `self` (Playwright, 390px, cámara falsa): `/crear-centro` completo en es y
   en en — wizard avanza campo a campo, ambas fotos se toman (la de cédula
   muestra la guía), el resumen aparece, el payload capturado llega con PIN y
   fotos, cero errores de consola, cero desbordes, táctiles ≥44px.
4. `self`: cambio de idioma a mitad del wizard no pierde lo escrito ni las
   fotos (R1.4 — en páginas ventana también aplica).

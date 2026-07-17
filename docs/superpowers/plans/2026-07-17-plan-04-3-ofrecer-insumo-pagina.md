# Plan 4.2 — «Ofrecer insumo» modal → página `/ofrecer-insumo`

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x
> (sección «Patrón reutilizable»). Frontend puro, sin backend. Orden: 3º del batch.
> Navega a la página de URL limpia `/ofrecer-insumo` (mismo origen) con `irAVentana`.

**Goal:** que «Ofrecer un insumo» deje de abrir un `<dialog>` flotante en el index
y sea su propia página `/ofrecer-insumo`, con el formulario 1-a-1, sin cambiar la
lógica de envío.

**Arquitectura:** reusar el patrón `ventana.html` (rewrite + ruta en `ventana.js`
+ `irAVentana`). La función `abrirOfrecerInsumo` no cambia: en la página,
`abrirModal` está sobrescrito para pintar página completa (js/ventana.js:10).

## Global Constraints

Ver roadmap 4.x. Claves: R2.x (1-a-1 `wizPublico`), R3.2 (fotos solo cámara —ya lo
cumple el flujo de ofertas), R1.x (idioma), R5.4 (bump `?v=`), `e()` en `innerHTML`.

## El problema (del batch)

El roadmap 4.x exige «ninguna ventana desplegable». «Ofrecer insumo» es una de las
3 ventanas «de la app» que hoy siguen siendo modal flotante.

## Estado actual (verificado 2026-07-17)

- `js/vistas.js:486` — disparador: `$$('[data-donar-necesidad]').forEach((btn) =>
  btn.addEventListener('click', () => abrirOfrecerInsumo(btn.dataset)));`
  → llamada **directa** a `abrirOfrecerInsumo` ⇒ modal flotante en index.
- `js/admin.js:669` — `function abrirOfrecerInsumo(datos)`: arma el form y llama
  `abrirModal(...)`.
- `js/panel.js:308-313` — deep-link por hash `#ofrecer`: `abrirPanelDesdeUrl()`
  llama `abrirOfrecerInsumo({})` cuando `hash === 'ofrecer'`.
- `js/ventana.js:46-54` — mapa `rutas` (sin `ofrecer-insumo` aún).
- `vercel.json` — 7 rewrites (sin `/ofrecer-insumo`).
- `js/vistas.js:386` — `irAVentana(ruta, params)` ya existe.

## File Structure

- Modify: `vercel.json` (rewrite)
- Modify: `js/ventana.js` (mapa `rutas`)
- Modify: `js/vistas.js` (disparador → `irAVentana`)
- Modify: `js/panel.js` (deep-link `#ofrecer` → redirigir a `/ofrecer-insumo`)
- Modify: `js/admin.js` (garantizar `wizPublico` en el form si no lo tuviera)
- Modify: `index.html`, `ventana.html` (`?v=`), `sw.js` (`VERSION` + caché)

---

### Task 1: Rewrite de la ruta

**Files:** Modify `vercel.json`

- [ ] Añadir al arreglo `rewrites` (junto a los otros):

```json
    { "source": "/ofrecer-insumo", "destination": "/ventana.html?v=ofrecer-insumo" },
```

**Verify:** `/ofrecer-insumo` (tras deploy) sirve `ventana.html`.

---

### Task 2: Ruta en el router de ventana

**Files:** Modify `js/ventana.js` (mapa `rutas`, ~46-54)

- [ ] Añadir la entrada. `abrirOfrecerInsumo` necesita los `datos` del insumo, que
  llegan por query. Añadir:

```js
        'ofrecer-insumo': function () { abrirOfrecerInsumo(solicitud); },
```

  Nota: `solicitud` ya expone `id`/`nombre`/`token`; si el form necesita más campos
  del `dataset` (p.ej. `insumo`, `centro`), leerlos también en `ventanaSolicitada()`
  (js/ventana.js:32-37) desde `params` y pasarlos. Verificar en F0 qué claves de
  `btn.dataset` consume `abrirOfrecerInsumo` y propagarlas por query en Task 3.

**Verify:** entrar a `/ofrecer-insumo?...` pinta el formulario como página.

---

### Task 3: Disparador del index → navegar en vez de abrir modal

**Files:** Modify `js/vistas.js:486`

- [ ] Reemplazar la llamada directa por navegación, propagando el `dataset`:

```js
      $$('[data-donar-necesidad]').forEach((btn) => btn.addEventListener('click', () => irAVentana('ofrecer-insumo', btn.dataset)));
```

  (`irAVentana` serializa el `dataset` a query con `URLSearchParams`.)

**Verify:** click en «Ofrecer» navega a `/ofrecer-insumo?...`, no abre `<dialog>`.

---

### Task 4: Deep-link `#ofrecer` → redirigir a la página

**Files:** Modify `js/panel.js:308-313`

- [ ] En `abrirPanelDesdeUrl`, cambiar la rama `#ofrecer` para redirigir en vez de
  abrir el modal:

```js
      if (hash === 'ofrecer') { window.location.href = '/ofrecer-insumo'; return; }
```

  Quitar `'ofrecer'` del arreglo `VISTAS` (panel.js:308) para no dejar una vista
  huérfana.

**Verify:** abrir `#ofrecer` (o recargar en él) lleva a `/ofrecer-insumo`.

---

### Task 5: Formulario 1-a-1 (solo verificación)

**Files:** ninguno esperado (`js/admin.js`)

- [ ] El form es `#ofrecer-form` (`data-wiz="ofrecer"`) y **ya** llama
  `wizPublico(form, {...})` (admin.js:778). No tocar salvo que en la página no
  entre en «Paso 2 de N»; en ese caso añadir
  `recordarModal(() => abrirOfrecerInsumo(datos))` (R1.3) o pasar el mismo objeto
  de opciones. **Ponytail:** no reescribir un wizard que ya funciona.

**Verify:** en la página, `#ofrecer-form` entra en «Paso 2 de N» (una casilla).

---

### Task 6: Versión

- [ ] Bump `?v=` en `index.html` y `ventana.html`; `VERSION` + nombre de caché +
  `?v=` de assets en `sw.js` (mismo commit).

## Reglas para /reglas-loop (F2)

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Ruta cableada en los 3 sitios:
   grep -q '/ofrecer-insumo' vercel.json
   && grep -q "'ofrecer-insumo'" js/ventana.js
   && grep -q "irAVentana('ofrecer-insumo'" js/vistas.js  → OK
R3 (external) · El disparador ya NO abre modal directo:
   grep -c 'abrirOfrecerInsumo(btn.dataset)' js/vistas.js  → 0
R4 (self · Playwright 390px):
   (a) navegar a /ofrecer-insumo?<params de un insumo real de prueba>: AFIRMAR que
   el formulario se pinta como PÁGINA (existe #modal-root dialog.ventana-dialog, y
   NO se llamó element.showModal —el dialog está [open] sin top-layer—) y NO hay
   backdrop de modal flotante;
   (b) el form es wizPublico (entra en «Paso 2 de N», una casilla visible);
   (c) desde el index, hacer click en un botón [data-donar-necesidad] cambia la URL
   a /ofrecer-insumo (no aparece <dialog> flotante en la home);
   (d) sin errores de consola nuevos; con monkeypatch de SheetsService.post que
   captura y lanza, enviar arma el mismo payload que antes (cero escrituras a prod).
```

## Notas de rendimiento (heredadas por 4.5)

La página reusa `core/vistas/panel/admin` ya cacheados ⇒ abre casi instantánea. No
añadir preloads específicos aquí; la auditoría Lighthouse va en 4.5.

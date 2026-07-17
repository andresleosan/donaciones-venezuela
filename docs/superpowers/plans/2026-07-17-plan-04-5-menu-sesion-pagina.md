# Plan 4.4 — «Menú de sesión» modal → página `/mi-cuenta`

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x.
> Frontend puro, sin backend. Orden: 5º del batch. Cierra las ventanas «de la app».
> Mismo origen: la sesión (`localStorage`, plan 02) ya se comparte entre páginas, sin
> cookies. Navega a `/mi-cuenta` con `irAVentana`.

**Goal:** que el menú de sesión (que hoy abre un `<dialog>` flotante al tocar el
nombre del usuario en la barra) sea su propia página `/mi-cuenta`: datos de la
sesión, roles, enlaces de registro y cerrar sesión.

## Global Constraints

Ver roadmap 4.x. Claves: R1.x (idioma, `innerHTML` re-render), R4.3 (touch ≥44px),
R5.4 (bump `?v=`), `e()` en `innerHTML`.

## Estado actual (verificado 2026-07-17)

- `js/core.js:556-575` — `abrirMenuSesion()`: arma el panel (email, roles, enlaces
  de registro `#voluntarios`/`#acceso`/`/crear-centro`/`#familiar`, botón
  `#session-logout`) y llama `abrirModal(t('session.menuTitle'), html)`. El logout
  hace `cerrarSesion()`, cierra `$('#modal-root dialog')` y `toast(...)`.
- `window.abrirMenuSesion` está exportado (core.js). El botón de la barra
  (`#btn-sesion`, plan 02) llama `abrirMenuSesion` al hacer click.
- `js/ventana.js:10` — en la página, `abrirModal` pinta página completa; el
  `dialog.close()` del logout dispara `volverAlInicio()` → va a `/`. Compatible.

### Decisión ponytail

El menú es pequeño (3-4 enlaces + logout). Convertirlo a página completa es
consistente con «cero ventanas desplegables» y **cuesta lo mismo** que las otras
conversiones (mismo patrón, diff mínimo). No se rediseña el contenido; solo cambia
la presentación (página en vez de `<dialog>`). Si en el futuro se prefiere un menú
desplegable no-`dialog`, sería otra decisión; aquí se sigue la regla de Luis.

## File Structure

- Modify: `vercel.json`, `js/ventana.js`, `js/core.js` (botón de la barra),
  `index.html`, `ventana.html`, `sw.js`.

---

### Task 1: Rewrite

**Files:** Modify `vercel.json`

- [ ] Añadir:

```json
    { "source": "/mi-cuenta", "destination": "/ventana.html?v=mi-cuenta" },
```

---

### Task 2: Router

**Files:** Modify `js/ventana.js` (mapa `rutas`)

- [ ] Añadir:

```js
        'mi-cuenta': function () { abrirMenuSesion(); },
```

  `abrirMenuSesion()` lee la sesión de `localStorage` (`sesionActual()`, plan 02),
  que está disponible en la página sin resembrar estado. Si **no hay sesión**,
  `abrirMenuSesion` debe redirigir a `/` (o abrir acceso); verificar en F0 su guard
  y, si no lo tiene, añadir al inicio de la función: `if (!sesionActual()) { volverAlInicio? }`
  — en la página, `window.location.href = '/'`. En el index mantener el
  comportamiento actual.

**Verify:** con sesión, `/mi-cuenta` pinta el panel; sin sesión, redirige a `/`.

---

### Task 3: Botón de la barra → navegar

**Files:** Modify `js/core.js` (handler de `#btn-sesion`)

- [ ] Localizar en `core.js` dónde `#btn-sesion` hace click → `abrirMenuSesion()`
  (en `pintarBotonSesion`). Cambiar la acción del botón por navegación:

```js
      btn.addEventListener('click', () => { window.location.href = '/mi-cuenta'; });
```

  (Dejar `abrirMenuSesion` intacta: la usa el router de la página en Task 2.)

**Verify:** tocar el nombre en la barra navega a `/mi-cuenta`, no abre `<dialog>`.

---

### Task 4: Logout en la página

**Files:** verificación (sin cambio esperado)

- [ ] Confirmar que el `#session-logout` de la página: `cerrarSesion()` + cerrar el
  `dialog` (que en la página dispara `volverAlInicio` → `/`) + toast. El toast en
  página se guarda en `sessionStorage` (js/ventana.js:20) y lo muestra el inicio al
  volver. Si el toast no aparece tras logout, ajustar el orden (cerrar dialog
  después de `toast`).

**Verify:** cerrar sesión desde `/mi-cuenta` desloguea y vuelve a `/` mostrando el
aviso; `#btn-sesion` desaparece.

---

### Task 5: Versión

- [ ] Bump `?v=` en `index.html`, `ventana.html`, `sw.js`.

## Reglas para /reglas-loop (F2)

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Ruta cableada:
   grep -q '/mi-cuenta' vercel.json && grep -q "'mi-cuenta'" js/ventana.js  → OK
R3 (external) · El botón de la barra ya NO abre modal directo:
   grep -q "'/mi-cuenta'" js/core.js  → OK
R4 (self · Playwright 390px, con una sesión falsa en localStorage —dv-sesion con
   access_token y email—):
   (a) navegar a /mi-cuenta: se pinta como PÁGINA (dialog.ventana-dialog [open], sin
   showModal) con el email, los roles y el botón de cerrar sesión;
   (b) desde el index con sesión, tocar #btn-sesion cambia la URL a /mi-cuenta y NO
   abre <dialog> flotante en la home;
   (c) sin sesión, /mi-cuenta redirige a /;
   (d) cerrar sesión limpia dv-sesion de localStorage y vuelve a /; sin errores de
   consola nuevos.
```

## Cierre parcial

Con 4.2+4.3+4.4 en verde, las 3 ventanas «de la app» (ofrecer, donar-dinero,
sesión) son páginas. Las que quedan (recoger-oferta, ciclo transportista,
track/presupuesto) pertenecen a los planes 06/07/08 y se construirán como páginas
nativas con este mismo patrón. La auditoría final (no queda `showModal` propio,
rendimiento) es el plan 4.5.

# Plan 4.3 — «Donar dinero» modal → página `/donar-dinero`

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x.
> Frontend puro, sin backend. Orden: 4º del batch. Mismo patrón que 4.3. El destino
> (ruta limpia vs subdominio) lo resuelve el helper `urlDeVentana` de 4.1.

**Goal:** que «Donar dinero» a un presupuesto deje de abrir un `<dialog>` flotante
y sea su propia página `/donar-dinero`, formulario 1-a-1, sin cambiar el envío.

## Global Constraints

Ver roadmap 4.x. Claves: R2.x (1-a-1), R1.x (idioma), R5.4 (bump `?v=`), `e()`.

## Estado actual (verificado 2026-07-17)

- `js/vistas.js:554-557` — disparador:

```js
      $$('[data-donar-dinero]').forEach((btn) => btn.addEventListener('click', () => {
        const pr = (estado.presupuestos || []).find((x) => x.token === btn.dataset.donarDinero);
        if (pr) abrirDonarDinero(pr);
      }));
```

  Pasa el objeto `pr` (presupuesto) completo. En la página no habrá `estado.presupuestos`
  en memoria ⇒ hay que resembrar por **token** (igual que ventana.js siembra el
  motorizado por `id`).
- `js/admin.js:906` — `function abrirDonarDinero(pr)`: arma el form
  `#donar-dinero-form` (data-wiz `donarDinero`) y llama `abrirModal(t('money.modalTitle'), …)`.
- `js/ventana.js:39-57` — `DOMContentLoaded`: siembra `estado.motorizados` por `id`.

## File Structure

- Modify: `vercel.json`, `js/ventana.js`, `js/vistas.js`, `js/admin.js`,
  `index.html`, `ventana.html`, `sw.js`.

---

### Task 1: Rewrite

**Files:** Modify `vercel.json`

- [ ] Añadir:

```json
    { "source": "/donar-dinero", "destination": "/ventana.html?v=donar-dinero" },
```

---

### Task 2: Router + resiembra por token

**Files:** Modify `js/ventana.js`

- [ ] En `ventanaSolicitada()` ya se lee `token`. En el mapa `rutas` añadir una
  entrada que reconstruye el presupuesto desde el token. `abrirDonarDinero` recibe
  un objeto `pr`; en la página lo mínimo que necesita es el token (y lo que pinte
  el form). Sembrar un `pr` mínimo:

```js
        'donar-dinero': function () { abrirDonarDinero({ token: solicitud.token, nombre: solicitud.nombre }); },
```

  Verificar en F0 qué campos de `pr` lee `abrirDonarDinero` (admin.js:906+). Si usa
  más que `token`/`nombre` para PINTAR (p.ej. `objetivo`, `monto`), propagarlos por
  query desde Task 3 y leerlos en `ventanaSolicitada()`. El **envío** debe ir por
  token, no por campos pintados (el backend valida por token).

**Verify:** `/donar-dinero?token=DV-…` pinta el form como página.

---

### Task 3: Disparador → navegar

**Files:** Modify `js/vistas.js:554-557`

- [ ] Reemplazar por navegación con el token (y los campos que el form necesite
  pintar):

```js
      $$('[data-donar-dinero]').forEach((btn) => btn.addEventListener('click', () => {
        const pr = (estado.presupuestos || []).find((x) => x.token === btn.dataset.donarDinero);
        if (pr) irAVentana('donar-dinero', { token: pr.token, nombre: pr.nombre });
      }));
```

**Verify:** click navega a `/donar-dinero?token=…`, sin `<dialog>` flotante.

---

### Task 4: Formulario 1-a-1 (solo verificación)

**Files:** ninguno esperado (`js/admin.js`)

- [ ] El form es `#donar-dinero-form` (`data-wiz="donarDinero"`) y **ya** llama
  `wizPublico('donar-dinero-form')` (admin.js:920). No tocar salvo que en la página
  no entre en «Paso 2 de N»; en ese caso añadir
  `recordarModal(() => abrirDonarDinero(pr))` (R1.3). **Ponytail:** no reescribir un
  wizard que ya funciona.

**Verify:** `#donar-dinero-form` entra en «Paso 2 de N».

---

### Task 5: Versión

- [ ] Bump `?v=` en `index.html`, `ventana.html`, `sw.js` (`VERSION` + caché +
  assets), mismo commit.

## Reglas para /reglas-loop (F2)

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Ruta cableada:
   grep -q '/donar-dinero' vercel.json
   && grep -q "'donar-dinero'" js/ventana.js
   && grep -q "irAVentana('donar-dinero'" js/vistas.js  → OK
R3 (self · Playwright 390px):
   (a) /donar-dinero?token=<un presupuesto real de prueba> se pinta como PÁGINA
   (dialog.ventana-dialog [open], sin showModal, sin backdrop flotante);
   (b) el form es wizPublico (Paso 2 de N);
   (c) desde el index, click en [data-donar-dinero] cambia la URL a /donar-dinero
   y NO abre <dialog> flotante en la home;
   (d) con monkeypatch de SheetsService.post que captura y lanza, el envío arma el
   mismo payload por token que antes (cero escrituras a prod); sin errores de
   consola nuevos.
```

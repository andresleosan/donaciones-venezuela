# Plan 4.5 — Rendimiento de las páginas-ventana + cierre del batch

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x + 4.1–4.5
> ya en verde. Frontend puro. Orden: 6º (último) del batch. Cierra
> /web-performance-optimization y la regla «cero ventanas desplegables propias».

**Goal:** que las páginas nuevas (`/ofrecer-insumo`, `/donar-dinero`, `/mi-cuenta`,
y `/crear-centro` con la foto del sitio) carguen rápido y sin errores, que el
service worker no sirva JS viejo, y auditar que no queda ninguna ventana flotante
propia de la app.

## Global Constraints

Ver roadmap 4.x. Aquí manda R5.4 (versión) y el requisito explícito de
carga-sin-problemas. **Ponytail:** las páginas ya reusan assets cacheados; solo se
añaden mejoras que **midan** un beneficio real, nada especulativo.

## Contexto (por qué es barato)

Toda página-ventana carga los mismos `services/api.js`, `js/core.js`, `js/wiz.js`,
`js/panel.js`, `js/admin.js`, `js/ventana.js`, `css/app.css`, `locales/*.json` y la
fuente. Tras la primera visita el SW los tiene en caché ⇒ la segunda navegación es
casi instantánea. El riesgo real de rendimiento es (a) primera carga fría de la
fuente/locale bloqueando el render, y (b) SW sirviendo una versión vieja tras un
deploy. Ambos se atacan aquí.

## File Structure

- Modify: `ventana.html` (preload de locale + fuente; ya tiene el CSS)
- Modify: `sw.js` (precache de las rutas nuevas + `VERSION`)
- Modify: `index.html` (`?v=` si aplica)

---

### Task 1: Precache de las rutas nuevas en el SW

**Files:** Modify `sw.js`

- [ ] En el arreglo `ESTATICOS` (sw.js:6-16), tras `'/ventana.html'`, añadir las
  rutas limpias nuevas para que la navegación offline las resuelva contra su
  cascarón:

```js
  '/', '/index.html', '/ventana.html',
  '/crear-centro', '/ofrecer-insumo', '/donar-dinero', '/mi-cuenta',
  OFFLINE_URL, '/manifest.json',
```

  Nota: la navegación ya es network-first con fallback a `'/'`/`ventana.html`
  (sw.js:38-51), así que esto es un extra de robustez offline, no un requisito de
  velocidad. **Ponytail:** si añadir estas entradas complica el `install` (una
  ruta que 404ea aborta `addAll`), dejar solo `/ventana.html` y documentar el
  porqué con un comentario `// ponytail:`.

- [ ] Subir `VERSION` en `sw.js` y los `?v=` de los assets al valor nuevo (mismo
  del commit de 4.4), y el nombre de caché `ayuda-ve-v<VERSION>`.

**Verify:** tras deploy, con el SW actualizado, navegar offline a `/ofrecer-insumo`
devuelve el cascarón (no error de red).

---

### Task 2: Preload de la fuente y del locale en `ventana.html`

**Files:** Modify `ventana.html` (`<head>`, ~16-17)

- [ ] Añadir preloads **solo si Lighthouse (Task 3) los reporta como oportunidad**.
  Candidatos:

```html
  <link rel="preload" href="/assets/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/locales/es.json" as="fetch" crossorigin>
```

  **Ponytail:** el locale correcto depende de `?lang=`/`navigator.language`; si
  preload de `es.json` no ayuda en `en`, omitirlo y dejar solo la fuente (que
  siempre se usa). No añadir preload que Lighthouse no acredite.

**Verify:** Lighthouse no marca «render-blocking» ni «font display» en la ruta.

---

### Task 3: Auditoría Lighthouse + consola

**Files:** ninguno (medición)

- [ ] Con un servidor estático local del `app/` (respetando la contención: el
  server en background dentro del workspace), correr Lighthouse (o
  `chrome-devtools` performance) a 390px sobre `/crear-centro`, `/ofrecer-insumo`,
  `/donar-dinero`, `/mi-cuenta`. Registrar Performance score y las oportunidades.
- [ ] Umbral: **Performance ≥ 90** en las 4 rutas (app estática sin JS pesado; es
  alcanzable). Si alguna queda por debajo, aplicar la oportunidad concreta que
  reporte Lighthouse (preload, dimensiones de imagen, etc.) y remedir.

**Verify:** las 4 rutas ≥ 90 en Performance; cero errores de consola.

---

### Task 4: Auditoría «cero ventanas desplegables propias»

**Files:** ninguno (medición)

- [ ] Confirmar que en `index.html` (la home) ningún flujo **propio de la app**
  abre ya un `<dialog>` flotante: ofrecer-insumo, donar-dinero y menú-sesión ahora
  navegan a su página.
- [ ] Documentar explícitamente que **sí** siguen existiendo `abrirModal`/`.showModal`
  para los flujos de **recoger-oferta (plan 07)**, **ciclo transportista (plan 06)**
  y **track/presupuesto de admin (plan 08)** — esos NO son deuda de 4.x: se
  convertirán a páginas en sus planes. Anotarlo en el mensaje final de F3.

**Verify:** desde el index, ninguno de los 3 flujos de 4.x abre `<dialog>` flotante.

## Reglas para /reglas-loop (F2)

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · SW versionado con las rutas nuevas:
   grep -q "'/ofrecer-insumo'" sw.js && grep -q "'/donar-dinero'" sw.js
   && grep -q "'/mi-cuenta'" sw.js  → OK
R3 (self · Lighthouse/chrome-devtools 390px, servidor local del workspace):
   Performance ≥ 90 en /crear-centro, /ofrecer-insumo, /donar-dinero, /mi-cuenta;
   cero errores de consola en cada una.
R4 (self · Playwright 390px, index): AFIRMAR que hacer click en los disparadores de
   ofrecer-insumo, donar-dinero y menú-sesión NAVEGA (cambia la URL) y NO llama a
   ningún element.showModal (cero <dialog> flotante en la home para esos 3 flujos).
   Registrar que recoger-oferta / ciclo-transportista / admin siguen como modal a
   propósito (dueños: planes 07/06/08).
```

## Despliegue y cierre

1. Push a GitHub con token efímero en URL (R5.5); Vercel redespliega.
2. Verificar en producción que el SW se actualiza (unregister + recarga) y que las
   4 rutas cargan bien.
3. Reportar a Luis: batch 4.x completo (foto del centro en vivo + backend
   desplegado; ofrecer-insumo, donar-dinero y mi-cuenta ahora son páginas;
   rendimiento ≥ 90). **Recién entonces arrancar el plan 06.**

# Plan 4.1 — Páginas con URL limpia (mismo origen), sin ventanas flotantes

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x.
> Fundación del batch. Orden: 1º. **En gran parte YA HECHO** (el mecanismo existe y
> el código quedó verificado + desplegado el 2026-07-17).

**Goal:** que cada «ventana» (modal) sea una **página aparte con URL propia** en el
**mismo origen**, servida por `ventana.html` vía rewrite de `vercel.json`. Sin
subdominios, sin dominio propio, sin DNS. Funciona en Vercel hoy
(`donacionesvenezuela.vercel.app`).

## Historia de la decisión (para no repetir el debate)

1. Primera propuesta: rutas limpias mismo origen (decisión D-SUB original).
2. Luis pidió **subdominios DNS literales** → se construyó y verificó toda la capa
   (rewrites por Host + cookie de dominio padre) en el loop 4.1 (commit `8e2a3ed`).
3. Luis reconsideró (2026-07-17): **«no necesitan ser subdominios; solo que no sean
   ventanas, que sean páginas aparte. Por ahora solo Vercel.»** → se **revirtió** la
   capa de subdominios y quedó solo el mecanismo de **URL limpia mismo origen**
   (commit de revert). **Esta es la decisión final.**

**Por qué mismo origen gana aquí (ponytail):**
- El mecanismo `ventana.html` + rewrite + ruta en `ventana.js` **ya está probado**
  en 7 rutas (`/crear-centro`, `/admin`, `/registrar-transportista`, …). Reusarlo =
  cero infraestructura.
- **Mismo origen ⇒ la sesión (`localStorage`, plan 02) se comparte sola** entre
  todas las páginas. No hace falta cookie de dominio padre ni nada cruzado.
- Assets cacheados compartidos ⇒ carga casi instantánea.
- Funciona en `*.vercel.app` sin comprar dominio.

## Estado del código (verificado 2026-07-17)

- ✅ El mecanismo de página con URL limpia existe y funciona (`irAVentana(ruta,
  params)` → `/<ruta>?<params>`; `ventana.js` sirve la página; `abrirModal`
  sobrescrito pinta página completa).
- ✅ Capa de subdominios **revertida**: `vercel.json` sin rewrites por Host;
  `core.js` sin cookie de dominio padre (sesión solo `localStorage`); `vistas.js`
  con `irAVentana` simple; `ventana.js` sin derivación por subdominio.
- ✅ **Web-perf conservado** (era buen extra, sin relación con subdominios):
  `Cache-Control: public, max-age=31536000, immutable` para
  `/(js|css|assets|services)/(.*)` + `preconnect` a Supabase en `ventana.html`.
- ✅ Verificado (Playwright, mismo origen): `/crear-centro` renderiza como PÁGINA
  (no modal), la sesión funciona por `localStorage`, sin cookie de sesión, 0
  errores de consola. Versión `?v=65` / `sw VERSION 65`.

## Lo que falta (lo hacen los otros sub-planes, con este mismo patrón)

Convertir cada modal restante en su página de URL limpia (rewrite + ruta en
`ventana.js` + disparador → `irAVentana` + deep-links; ver «Patrón reutilizable»
del roadmap):

- **4.3** — `/ofrecer-insumo`
- **4.4** — `/donar-dinero`
- **4.5** — `/mi-cuenta`

Y aparte: **4.2** foto del centro + backend, **4.6** rendimiento/cierre.

## Reglas para /reglas-loop (F2) — ya satisfechas por el estado actual

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Sin capa de subdominio (mismo origen):
   grep -c 'esDominioPropio\|urlDeVentana\|Domain=\.' js/*.js vercel.json  → 0
R3 (external) · Rutas limpias vivas (mecanismo de página):
   grep -q '"/crear-centro"' vercel.json && grep -q 'function irAVentana' js/vistas.js  → OK
R4 (external) · Web-perf conservado:
   grep -q 'immutable' vercel.json  → OK
R5 (self · Playwright, mismo origen): /crear-centro (ventana.html?v=crear-centro) se
   pinta como PÁGINA (dialog.ventana-dialog, sin showModal); la sesión funciona por
   localStorage (guardarSesion → sesionActual) sin escribir cookie de sesión; 0
   errores de consola nuevos.
```

## Despliegue

Ya desplegado a producción (Vercel redespliega desde GitHub). No requiere dominio ni
DNS. Reversible por naturaleza (es el estado base de la app).

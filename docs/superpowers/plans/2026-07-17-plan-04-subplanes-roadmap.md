# Roadmap sub-planes 4.x — Foto del centro + «cero ventanas desplegables»

> **Para /build-loop:** este archivo es el índice. Cada sub-plan (4.1…4.6) es un
> `/build-loop` independiente con sus propias reglas F2. Orden estricto: 4.1 →
> 4.2 → 4.3 → 4.4 → 4.5 → 4.6. **Todo esto va ANTES del plan 06.**
>
> **Actualizado 2026-07-17 (decisión FINAL):** se probó la vía de subdominios DNS
> (plan 4.1) y Luis reconsideró: **no necesitan ser subdominios, solo que no sean
> ventanas — páginas aparte, solo Vercel.** Se revirtió la capa de subdominios y
> quedó **plan 4.1 — páginas con URL limpia (mismo origen)**. Numeración estable
> (foto=4.2, ofrecer=4.3, donar=4.4, sesión=4.5, rendimiento=4.6).

## De dónde sale este batch (goal de Luis, 2026-07-17)

1. **Autorización de backend concedida**: añadir la **foto del centro (sitio)** al
   formulario de crear-centro, en el paso más oportuno, tocando la edge function.
2. **Ninguna ventana desplegable**: cada parte que hoy abre un `<dialog>` flotante
   pasa a ser **su propia página** (ruta limpia), reusando el patrón `ventana.html`
   que ya existe y funciona.
3. **Formularios 1-a-1** (una casilla a la vez, `wizPublico`), como los que ya
   funcionan (crear-centro, registrar-voluntario, registrar-transportista).
4. **Carga rápida** de esas páginas (/web-performance-optimization).
5. Construir **solo los planes** ahora; ejecutarlos con `/build-loop` uno a uno.

## Decisión D-SUB · **páginas con URL limpia (mismo origen)** — FINAL (2026-07-17)

Se recorrió el ciclo completo: (1) ruta limpia → (2) Luis pidió subdominios DNS y
se construyó/verificó la capa (commit `8e2a3ed`) → (3) Luis reconsideró: **«no
necesitan ser subdominios; solo que no sean ventanas, que sean páginas aparte, solo
Vercel»** → se **revirtió** la capa de subdominios. **Decisión final: páginas con
URL limpia en el mismo origen** (`/ofrecer-insumo`…), servidas por `ventana.html`
vía rewrite de `vercel.json`. Detalle e historia en **plan 4.1 — páginas con URL
limpia**.

Ventajas (por qué es la correcta): cero infraestructura (funciona en
`*.vercel.app` hoy, sin dominio ni DNS); **mismo origen ⇒ la sesión `localStorage`
se comparte sola** entre páginas (sin cookies cruzadas); mecanismo ya probado en 7
rutas. Los sub-planes 4.3–4.5 usan `irAVentana('<ruta>', {params})` → `/<ruta>`.

## Inventario de «ventanas» (auditado 2026-07-17)

| Ventana (modal flotante hoy) | Disparador | Dueño | Estado |
|---|---|---|---|
| Registrar transportista | `irAVentana` | — | ✅ ya es página `/registrar-transportista` |
| Apoyar transportista | `irAVentana` | — | ✅ ya es página `/apoyar-transportista` |
| Trayectos / Historial | `irAVentana` | — | ✅ ya son páginas |
| Crear-centro | `irAVentana` | plan 04 | ✅ página `/crear-centro` (le falta foto sitio → **4.2**) |
| Panel-centro / Admin | rewrite | plan 08 | ✅ ya son páginas |
| **Ofrecer insumo** | `abrirOfrecerInsumo` (modal) | **4.3** | ❌ modal flotante en index |
| **Donar dinero** | `abrirDonarDinero` (modal) | **4.4** | ❌ modal flotante en index |
| **Menú de sesión** | `abrirMenuSesion` (modal) | **4.5** | ❌ modal flotante en index |
| Voy a recogerla (recoger-oferta) | `abrirRecogerOferta` | **plan 07** | ⏭️ se construirá como página en 07 |
| Ciclo transportista (recogida/entrega) | `abrirRegistrarEntrega` | **plan 06** | ⏭️ se construirá como página en 06 |
| Track/Presupuesto (dentro de admin) | sub-modal en `/admin` | **plan 08** | ⏭️ plan 08 |

**Sub-planes del batch:**
- **4.1** — páginas con URL limpia mismo origen (fundación; ✅ ya hecho: mecanismo
  vivo + web-perf, subdominios revertidos).
- **4.2** — foto del centro (sitio) + backend (migración + edge fn).
- **4.3/4.4/4.5** — las 3 ventanas «de la app» (ofrecer / donar-dinero / sesión) a
  su propia página de URL limpia.
- **4.6** — rendimiento + auditoría de cierre.

Las ventanas de transportista/admin las construyen 06/07/08 **como páginas
nativas** con este mismo patrón (que 4.x deja consolidado y verificado).

## Patrón reutilizable · «convertir un modal en página» (lo aplica 4.3/4.4/4.5)

Un modal se vuelve página con **cambios pequeños**, sin tocar la función `abrir*`
(que ya llama a `abrirModal`, y en `ventana.html` ese `abrirModal` está
sobrescrito para pintar página completa — ver `js/ventana.js:10`):

1. **`vercel.json`** → rewrite de ruta limpia `{"source":"/<ruta>","destination":"/ventana.html?v=<ruta>"}`.
2. **`js/ventana.js`** → entrada al mapa `rutas`: `'<ruta>': function () { abrir<X>(<params>); }`.
3. **Disparador en index** (`js/vistas.js` o `core.js`) → cambiar la llamada
   directa `abrir<X>(...)` por `irAVentana('<ruta>', {params})` (→ navega a `/<ruta>`).
4. **Deep-links por hash** (si los hay, p.ej. `#ofrecer`) → redirigir a la página.
5. **Versión** → subir `?v=` en `index.html`, `ventana.html` y `VERSION`+nombre de
   caché en `sw.js` (mismo commit) — si no, el SW sirve JS viejo (R5.4).

El formulario ya debe llenarse **1-a-1** (`wizPublico('<form-id>')`, entra en
«Paso 2 de N»). Si el modal no usaba `wizPublico`, añadirlo es parte del plan.

## Constraints globales (heredadas por TODOS los sub-planes)

Copiadas de `REGLAS.md`:
- **R1.x idioma**: es/en siempre paralelos; nada de español cableado en JS
  (`verificar-idioma.py` exit 0); lo pintado con `innerHTML` re-renderiza al
  cambiar idioma.
- **R2.x wizard**: una casilla a la vez, empieza en «Paso 2 de N» (`wizPublico`).
- **R3.x**: ubicación por GPS/mapa, no texto libre (R3.1); fotos **solo cámara**,
  sin selector de archivos (R3.2), con guía visual cuando aplique.
- **R4.x**: tokens Stripe, touch ≥44px (R4.3), `[hidden]` no `display:none` (R4.4).
- **R5.x**: vanilla sin dependencias nuevas; bump `?v=` + `sw.js` en el mismo
  commit (R5.4); commits `Luismadef45 <luismadef45@gmail.com>`, push a GitHub con
  token efímero en URL, nunca persistido (R5.5).
- **Seguridad backend**: todo valor externo en `innerHTML` pasa por `e()`; las
  escrituras van por la edge function `api`; el despliegue a producción
  (migración + edge fn) se hace con MCP Supabase y se reporta a Luis.

## Cierre del batch

Cuando 4.1–4.6 estén en verde y desplegados (subdominios vivos incluidos), la app
no tiene ninguna ventana flotante propia; las que queden pertenecen a 06/07/08 y se
levantarán como páginas-subdominio. Recién entonces se arranca el **plan 06**.

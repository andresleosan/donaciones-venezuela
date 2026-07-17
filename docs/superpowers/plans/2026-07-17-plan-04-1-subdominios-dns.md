# Plan 4.1 — Subdominios DNS literales (fundación de las páginas-ventana)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 4.x. Es la
> **fundación**: define cómo cada «ventana» vive en su propio subdominio DNS real.
> Los sub-planes 4.2–4.6 se montan encima. Orden: **1º del batch**.
>
> **Mezcla de tareas:** parte es **infraestructura fuera de la jaula** (comprar
> dominio, DNS, dominios en Vercel) — se hace con MCP/consola y se reporta a Luis,
> NO la verifica el loop. Parte es **código** (rewrites por Host, sesión
> compartida, helper de navegación) — esa sí la verifica `/build-loop` (reglas F2).

**Goal:** que cada formulario que hoy es una ventana pase a ser una **página en su
propio subdominio DNS real** (p.ej. `ofrecer.donacionesvenezuela.net`), cumpliendo
todo lo del goal: fotos solo-cámara, formularios 1-a-1, código simple, carga
rápida y paridad visual con los formularios que ya funcionan.

**Arquitectura (ponytail — un solo deploy, no N proyectos):** UN dominio propio con
sus subdominios, TODOS apuntando al **mismo** proyecto Vercel. `vercel.json`
enruta por el header **Host**: cada subdominio reescribe a su
`ventana.html?v=<ruta>`. Un solo codebase, un solo deploy, cero infraestructura por
página. La sesión se comparte entre subdominios con una **cookie de dominio padre**
(`Domain=.donacionesvenezuela.net`), imposible en `*.vercel.app` — por eso hace
falta dominio propio.

**Tech:** dominio Hostinger + DNS; Vercel (dominios + rewrites por Host); JS vanilla
(cookie de sesión + helper de URL). Sin dependencias nuevas.

## Global Constraints

Ver «Constraints globales» del roadmap 4.x. Añade aquí: cookies `Secure;
SameSite=Lax`; CSP mantiene `frame-ancestors 'none'`; los subdominios de formulario
siguen `noindex` (ya en `ventana.html`); HSTS con `includeSubDomains` (ya presente).

## Por qué esto reemplaza la decisión D-SUB del roadmap

El roadmap 4.x eligió «ruta limpia bajo el mismo origen». Luis pidió
explícitamente **subdominios DNS literales**. Este plan **supersede** la decisión
D-SUB: las páginas viven en subdominios reales. Los sub-planes 4.2–4.6 no cambian
su lógica de formulario; solo cambia **a dónde navegan**, y eso se centraliza aquí
(Task 5, helper `urlDeVentana`).

## Trade-offs honestos (lo que cuesta vs rutas limpias) — léelos antes de ejecutar

Ponytail exige nombrar el coste real de la opción pedida:

1. **Dominio propio obligatorio (~costo anual).** `*.vercel.app` no da
   sub-subdominios ni cookies de dominio padre. Hay que comprar un dominio.
   `donacionesvenezuela.org` y `.com` están **tomados** (verificado 2026-07-17, no
   por tu cuenta); **`donacionesvenezuela.net` está libre**. Alternativas libres:
   `.info`, o el nombre que prefieras.
2. **Sesión cross-origin.** `localStorage` es **por-origen**: la sesión de plan 02
   NO se ve entre subdominios. Se resuelve migrándola a una **cookie de dominio
   padre** (Task 4). Funciona, pero la cookie con el token Supabase no puede ser
   HttpOnly (la app estática la lee en JS) → mitigación con `Secure`+`SameSite=Lax`
   +CSP estricta + dominio propio. Riesgo documentado en Task 4.
3. **Caché no compartida entre orígenes (web-perf).** Cada subdominio es un origen
   distinto → primera visita re-descarga `core.js`/`css`/locales/fuente y registra
   su **propio** service worker. Mitigación: assets versionados con
   `Cache-Control: immutable` (Task 6). Coste: una descarga por subdominio la
   primera vez; después, caché local del subdominio. Es intrínseco a subdominios.
4. **Más piezas móviles:** DNS + dominios en Vercel + rewrites por Host + cookie.
   Más superficie que una ruta limpia. A cambio: URLs de marca por función.

Si en algún momento el coste supera el beneficio, el diseño es **reversible**: las
rutas limpias (`/ofrecer-insumo`…) siguen funcionando como fallback (Task 5 las
mantiene), así que apagar subdominios = un flag.

## Mapa subdominio → ventana (propuesto)

| Subdominio | Sirve | Sub-plan que la construye |
|---|---|---|
| `donacionesvenezuela.net` (apex) | la home actual (`index.html`) | — |
| `crear-centro.donacionesvenezuela.net` | `ventana.html?v=crear-centro` | 4.2 |
| `ofrecer.donacionesvenezuela.net` | `ventana.html?v=ofrecer-insumo` | 4.3 |
| `donar.donacionesvenezuela.net` | `ventana.html?v=donar-dinero` | 4.4 |
| `mi-cuenta.donacionesvenezuela.net` | `ventana.html?v=mi-cuenta` | 4.5 |
| (06/07/08) `recoger.` / `transporte.` / `admin.` | sus ventanas | 06/07/08 |

`www` y el apex sirven la home. Las 7 rutas-ventana que ya existían
(registrar-transportista, etc.) pueden migrar a subdominios en el mismo patrón o
quedarse como rutas limpias (decisión por función; este plan deja el mecanismo).

## File Structure

- Modify: `vercel.json` (rewrites por Host + headers de caché inmutable)
- Modify: `services/api.js` o `js/core.js` (sesión: cookie de dominio padre en vez
  de/junto a localStorage — Task 4)
- Modify: `js/vistas.js` (helper `urlDeVentana` + `irAVentana` lo usa — Task 5)
- Modify: `ventana.html` (preconnect Supabase — Task 6)
- Infra (fuera del repo): dominio Hostinger, DNS, dominios en Vercel

---

### Task 0 — INFRA · Dominio + DNS + Vercel (fuera de la jaula, con Luis)

> No lo verifica el loop; se hace con MCP/consola y se **reporta a Luis** antes y
> después. Requiere su OK para comprar el dominio.

- [ ] **Paso 1: elegir y comprar el dominio.** Recomendado
  `donacionesvenezuela.net` (libre). MCP Hostinger
  `domains_purchaseNewDomainV1` (o consola) — **requiere confirmación explícita de
  Luis** (gasto). Alternativa: usar un dominio que Luis ya tenga en otro proveedor.
- [ ] **Paso 2: añadir el dominio a Vercel** (proyecto de donaciones): apex +
  `www` + wildcard `*.donacionesvenezuela.net` (el wildcard evita tener que
  registrar cada subdominio a mano). Vercel entrega los registros a crear.
- [ ] **Paso 3: DNS en Hostinger** (MCP `DNS_updateDNSRecordsV1`): apex → Vercel
  (registro A `76.76.21.21` o el que indique Vercel) y `*` / `www` → CNAME
  `cname.vercel-dns.com` (lo dicta Vercel). ⚠️ Cambia el DNS del dominio; hacer
  snapshot antes (`DNS_getDNSSnapshotListV1`).
- [ ] **Paso 4: verificar TLS.** Vercel emite el certificado (incluye wildcard).
  Confirmar que `https://donacionesvenezuela.net` y
  `https://ofrecer.donacionesvenezuela.net` cargan con candado.

**Verify (manual):** los subdominios resuelven por DNS y sirven con HTTPS válido.
**Reportar a Luis:** dominio comprado, DNS propagado, TLS activo.

---

### Task 1 — Rewrites por Host en `vercel.json`

**Files:** Modify `vercel.json`

- [ ] **Paso 1:** añadir, ANTES de los rewrites de ruta limpia existentes, un
  rewrite por Host por cada subdominio. Patrón (Vercel soporta `has` con
  `type:"host"`):

```json
    { "source": "/", "has": [{ "type": "host", "value": "crear-centro.donacionesvenezuela.net" }], "destination": "/ventana.html?v=crear-centro" },
    { "source": "/", "has": [{ "type": "host", "value": "ofrecer.donacionesvenezuela.net" }], "destination": "/ventana.html?v=ofrecer-insumo" },
    { "source": "/", "has": [{ "type": "host", "value": "donar.donacionesvenezuela.net" }], "destination": "/ventana.html?v=donar-dinero" },
    { "source": "/", "has": [{ "type": "host", "value": "mi-cuenta.donacionesvenezuela.net" }], "destination": "/ventana.html?v=mi-cuenta" },
```

  Los rewrites de ruta limpia (`/ofrecer-insumo` → `ventana.html?v=ofrecer-insumo`)
  se **mantienen** como fallback reversible.

- [ ] **Paso 2:** el apex y `www` sirven `index.html` por defecto (sin rewrite);
  confirmar que ninguna regla los captura.

**Verify:** `curl -sI https://ofrecer.donacionesvenezuela.net/` sirve el HTML de
`ventana.html` (título de la ventana), y el apex sirve la home.

---

### Task 2 — La página lee la ruta desde el Host (no solo `?v=`)

**Files:** Modify `js/ventana.js` (`ventanaSolicitada`, ~32-37)

**Contexto:** hoy `ventanaSolicitada()` lee `path`/`?v=`. Con el rewrite por Host,
la URL del usuario es `https://ofrecer.donacionesvenezuela.net/` (sin `?v=`
visible), pero Vercel reescribe internamente a `?v=ofrecer-insumo`, así que `?v=`
**sí** llega al servidor. Como es un rewrite (no redirect), el JS ve la URL del
usuario (`/`), no la reescrita. Por eso hay que **derivar la ruta del subdominio**.

- [ ] **Paso 1:** en `ventanaSolicitada()`, si no hay `path` ni `?v=`, derivar del
  `hostname`:

```js
      // Subdominio → ruta (ofrecer.dominio → ofrecer-insumo)
      const sub = window.location.hostname.split('.')[0];
      const deSub = { 'crear-centro': 'crear-centro', 'ofrecer': 'ofrecer-insumo', 'donar': 'donar-dinero', 'mi-cuenta': 'mi-cuenta' }[sub] || '';
```

  y usar `ruta = path && path!=='ventana' ? path : (params.get('v') || deSub)`.

**Verify:** cargar `https://ofrecer.donacionesvenezuela.net/` (o simulando el
hostname en Playwright) abre el formulario de ofrecer-insumo.

---

### Task 3 — Navegación entre orígenes conserva los parámetros

**Files:** parte de Task 5 (helper). Nota aquí el requisito.

Los formularios reciben datos por query (`token`, `id`, dataset del insumo). Al
navegar del apex a un subdominio hay que **propagar la query** a la URL del
subdominio (`https://donar.donacionesvenezuela.net/?token=DV-…`). Task 2 ya lee
`?token=` de `params`. Lo resuelve el helper de Task 5.

---

### Task 4 — Sesión compartida entre subdominios (cookie de dominio padre)

**Files:** Modify `js/core.js` (módulo de sesión de plan 02: `guardarSesion`,
`sesionActual`, `cerrarSesion`)

**Problema:** plan 02 guarda la sesión en `localStorage['dv-sesion']`, que es
**por-origen** → el subdominio no la ve. Solución: **espejar** la sesión en una
cookie con `Domain=.donacionesvenezuela.net`, que todos los subdominios comparten.

- [ ] **Paso 1:** en `guardarSesion(datos)`, además del `localStorage`, escribir la
  cookie de dominio padre:

```js
      // Compartida entre subdominios: dominio padre. Solo en produccion (dominio propio).
      const raiz = location.hostname.split('.').slice(-2).join('.'); // donacionesvenezuela.net
      if (location.protocol === 'https:' && raiz.includes('.')) {
        document.cookie = 'dv-sesion=' + encodeURIComponent(JSON.stringify(datos)) +
          ';Domain=.' + raiz + ';Path=/;Secure;SameSite=Lax;Max-Age=' + (60*60*24*30);
      }
```

- [ ] **Paso 2:** en `sesionActual()`, si `localStorage` no tiene sesión (otro
  subdominio), leerla de la cookie `dv-sesion` (decode + JSON.parse) y opcionalmente
  sembrarla en el `localStorage` local.
- [ ] **Paso 3:** en `cerrarSesion()`, además de limpiar `localStorage`, expirar la
  cookie: `document.cookie = 'dv-sesion=;Domain=.'+raiz+';Path=/;Max-Age=0'`.

**⚠️ Seguridad (documentar):** la cookie NO es HttpOnly (la app estática la lee en
JS), así que un XSS podría leer el token — mismo riesgo que el `localStorage`
actual, no peor. Mitigación: `Secure`+`SameSite=Lax`, CSP estricta ya presente
(`script-src 'self' 'unsafe-inline'`), dominio propio. Si algún día se quiere
HttpOnly de verdad, requiere un backend de sesión (fuera de alcance / ponytail: no
para una app estática). Alternativa evaluada y descartada por sobre-ingeniería: SSO
por redirect con token efímero en URL.

**Verify:** con sesión iniciada en el apex, `sesionActual()` la devuelve también al
cargar un subdominio (cookie compartida). Cerrar sesión la borra en ambos.

---

### Task 5 — Helper `urlDeVentana` + `irAVentana` centralizado

**Files:** Modify `js/vistas.js` (`irAVentana`, ~386)

**Objetivo (ponytail):** que 4.2–4.6 **no cambien**; solo cambia el destino, aquí.

- [ ] **Paso 1:** añadir un mapa ruta→subdominio y un helper:

```js
    // Si estamos en el dominio propio, cada ventana vive en su subdominio.
    const SUB_DE_RUTA = { 'crear-centro': 'crear-centro', 'ofrecer-insumo': 'ofrecer', 'donar-dinero': 'donar', 'mi-cuenta': 'mi-cuenta' };
    function urlDeVentana(ruta, params) {
      const q = new URLSearchParams(params || {}).toString();
      const raiz = location.hostname.split('.').slice(-2).join('.');
      const sub = SUB_DE_RUTA[ruta];
      // Dominio propio (no vercel.app, no localhost) + subdominio conocido → subdominio real.
      if (sub && location.hostname.endsWith('donacionesvenezuela.net')) {
        return 'https://' + sub + '.' + raiz + '/' + (q ? '?' + q : '');
      }
      return '/' + ruta + (q ? '?' + q : ''); // fallback: ruta limpia (dev / vercel.app)
    }
```

- [ ] **Paso 2:** `irAVentana` usa el helper:

```js
    function irAVentana(ruta, params) { window.location.href = urlDeVentana(ruta, params); }
```

**Verify:** en `donacionesvenezuela.net`, click en «Ofrecer» navega a
`https://ofrecer.donacionesvenezuela.net/?…`; en `localhost`/`vercel.app`, sigue a
`/ofrecer-insumo?…` (fallback). Sin romper los planes 4.3–4.5.

---

### Task 6 — Web-performance por origen

**Files:** Modify `vercel.json` (headers), `ventana.html` (preconnect)

- [ ] **Paso 1:** en `vercel.json`, añadir cache inmutable para los assets
  versionados (para que cada subdominio los cachee agresivamente tras la 1ª
  descarga):

```json
    { "source": "/(js|css|assets|services)/(.*)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" } ] },
```

  (Los `?v=` fuerzan la invalidación al desplegar; ver R5.4.)

- [ ] **Paso 2:** en `ventana.html` `<head>`, `preconnect` a Supabase (la página
  llama a la edge fn/PostgREST):

```html
  <link rel="preconnect" href="https://zryfwbjvlacorryzdaod.supabase.co" crossorigin>
```

- [ ] **Paso 3:** bump `?v=` en `index.html`, `ventana.html`, `sw.js`.

**Verify:** Lighthouse ≥ 90 en un subdominio (1ª carga) y ≈100 en recarga (assets
inmutables desde caché). El SW se registra por-origen (esperado).

---

### Task 7 — Paridad visual (impeccable / critica-de-diseno)

**Files:** ninguno (verificación)

Las páginas de subdominio reusan el **mismo** `css/app.css` y los mismos
componentes que los formularios que ya funcionan → la paridad visual es automática
por construcción. Se verifica, no se rediseña.

- [ ] Despachar `critico-de-diseno` en modo **CRITICAR**: referencia = un
  formulario que ya funciona (p.ej. `/crear-centro`), build = la misma página
  servida por subdominio. VEREDICTO esperado: **PASA** (tokens idénticos: mismo
  origen de CSS, misma tipografía/espaciado/colores; el asistente 1-a-1 idéntico).
  Cualquier diferencia (p.ej. la fuente re-descargándose y provocando FOUT en la 1ª
  carga del subdominio) se corrige con el `preconnect`/preload de Task 6.

**Verify:** veredicto critica-de-diseno = PASA en la página de subdominio.

---

## Reglas para /reglas-loop (F2) — solo lo verificable por código

Las tareas de infraestructura (Task 0) NO son reglas del loop (viven fuera de la
jaula); se reportan a Luis. El loop verifica el **código**:

```
R1 (external) · Paridad idioma:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Rewrites por Host presentes:
   grep -q '"type": "host"' vercel.json
   && grep -q 'ofrecer.donacionesvenezuela.net' vercel.json  → OK
R3 (external) · Fallback de ruta limpia intacto (reversibilidad):
   grep -q '/ofrecer-insumo' vercel.json  → OK
R4 (external) · Helper de navegación + mapa de subdominios:
   grep -q 'function urlDeVentana' js/vistas.js
   && grep -q 'SUB_DE_RUTA' js/vistas.js  → OK
R5 (external) · Sesión con cookie de dominio padre:
   grep -q 'Domain=.' js/core.js && grep -q 'SameSite=Lax' js/core.js  → OK
R6 (external) · Caché inmutable de assets versionados:
   grep -q 'immutable' vercel.json  → OK
R7 (self · Playwright, simulando hostname de subdominio):
   (a) forzando location.hostname = 'ofrecer.donacionesvenezuela.net' (o cargando el
   HTML de ventana con ?v=ofrecer-insumo), la página abre el formulario de
   ofrecer-insumo como PÁGINA (no <dialog> flotante) y es wizPublico (Paso 2 de N);
   (b) urlDeVentana('donar-dinero', {token:'DV-1'}) devuelve
   https://donar.donacionesvenezuela.net/?token=DV-1 cuando el hostname termina en
   donacionesvenezuela.net, y '/donar-dinero?token=DV-1' en localhost (fallback);
   (c) guardarSesion escribe la cookie dv-sesion con Domain=.donacionesvenezuela.net
   (solo bajo https+dominio propio; en localhost solo localStorage);
   (d) sin errores de consola nuevos.
R8 (self · critica-de-diseno): veredicto PASA — la página de subdominio es
   visualmente idéntica al formulario de referencia que ya funciona.
```

## Orden de ejecución dentro de 4.1

1. **Código primero** (Tasks 1,2,4,5,6 + reglas F2) con `/build-loop`, usando el
   **fallback de ruta limpia** para verificar en local/preview sin dominio aún.
2. **Infra después** (Task 0) con Luis: comprar dominio, DNS, Vercel, TLS.
3. **Verificación E2E en producción** (Task 7 + humo en subdominios reales) y
   reporte a Luis.

Así el código queda probado y desplegable aunque el dominio tarde, y encender
subdominios = añadir DNS. Recién con 4.1 en verde y el dominio vivo se sigue con
4.2.

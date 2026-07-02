# Diseño: Ronda integral de mejoras post-migración a Supabase

**Fecha:** 2026-07-02 · **Rama base:** `feature/supabase-redesign` (commit `6c5b633`)
**Origen:** auditoría Playwright + revisión de código de toda la app (todas las vistas, desktop y móvil 375px, formularios, consola, tamaños de assets).
**Alcance aprobado:** completo (bloques A rotas + B degradadas + C ausentes + D robustez). El usuario pidió "todas las mejoras" con el plan "lo más detallado y extenso posible".

---

## 0. Hallazgos de la auditoría (qué hay que modificar y por qué)

| # | Hallazgo | Gravedad | Evidencia |
|---|----------|----------|-----------|
| A1 | Matching de insumos muerto: `lugares_directorio` devuelve `coincidencias: []` fijo; el render de `app.js:1071` nunca muestra nada | 🔴 Rota | Vista SQL + grep |
| A2 | Trazabilidad inoperante: la UI consulta tokens `DV-…` pero no existe NINGUNA vía (UI ni backend) para crear facturas/donaciones/movimientos/evidencias | 🔴 Rota | Edge function sin acciones `crear_factura` etc.; tabla `facturas` vacía |
| A3 | Búsqueda familiar sin datos posibles: no hay UI para reportar personas (`reportar_persona` existe en backend, sin formulario) | 🔴 Rota | Vista familiar = solo buscador |
| B4 | Historial incompleto: `panel_insumo`/`panel_insumo_borrar` no escriben en `historial_movimientos` | 🟠 | Edge function |
| B5 | `estadisticas().personasLocalizadas` cuenta todas las personas, no las localizadas | 🟠 | RPC |
| B6 | Superficie muerta en `services/api.js`: `getFacturas` sin uso; `getDonacionesHumanitarias` mapeada a donaciones de motorizados (semántica errónea) | 🟠 | grep app.js: 0 usos |
| C7 | Geo ausente: `lat`/`lng` existen sin captura ni uso; "Mapa de necesidades" es placeholder textual; sin "cerca de mí". Además `vercel.json` tiene `Permissions-Policy: geolocation=()` que BLOQUEA la geolocalización | 🟡 | Código + headers |
| C8 | Panel por centro v1 limitado: sin recuperar token/PIN perdido, sin editar datos del centro, y `panel_crear` permite reclamar cualquier centro huérfano (first-come sin control) | 🟡 | Edge function |
| D9 | PWA mínima: solo icono 192 (falta 512 y maskable), sin shortcuts; lista `ESTATICOS` del SW hardcodeada (desincronización fácil en cada release) | 🔵 | manifest/sw.js |
| D10 | Rate limit único 30 escrituras/hora/IP: insuficiente para un centro activo gestionando insumos; el panel comparte cubo con los formularios públicos | 🔵 | `rate_hit` |
| D11 | `js/app.js` monolítico (110 KB / ~1900 líneas): cada feature nueva agrava el archivo | 🔵 | wc |
| D12 | Menores: el modal del panel no se re-traduce si cambias idioma con él abierto; emojis como iconografía en bottom-nav; `notice success` del token usa clases que hay que verificar | 🔵 | Auditoría visual |

Verificado también lo que **sí** funciona (no tocar): navegación, filtros, i18n ES/EN/FR, validación de formularios, alta de centros/voluntarios/rescatistas/transportistas, panel por centro v1 E2E, seguimiento con token inválido, consola limpia, móvil 375px correcto.

---

## 1. Decisiones de diseño (con alternativas evaluadas)

### D-1 · Autenticación del módulo admin de trazabilidad — **clave admin en secret de la edge function**

El módulo de facturas necesita un rol admin (crear facturas y registrar dinero no puede ser público).

- **(a) ELEGIDA — `ADMIN_KEY` como secret de la edge function** (`supabase secrets set`). El frontend pide la clave en la ruta `#admin`, la manda en cada acción `admin_*`, el backend compara en tiempo constante, rate-limit estricto (10 intentos fallidos/hora/IP → bloqueo del cubo) y log de cada acción admin en `historial_movimientos`. Pros: cero dependencias, coherente con el patrón token+PIN del panel, un solo secreto compartible con el equipo. Contras: un solo rol, rotación manual.
- (b) Supabase Auth (email+password + tabla `admins` + políticas RLS): más robusto y multi-usuario, pero arrastra flujos de sesión/refresh a una app vanilla sin SDK — complejidad desproporcionada hoy. Queda como upgrade path documentado.
- (c) Operar facturas desde el dashboard de Supabase: cero código pero sin generación de tokens amistosa, sin validaciones y inutilizable para no-técnicos. Descartada.

### D-2 · Mapa y geolocalización — **Leaflet autohospedado + tiles OSM + captura opcional**

- **(a) ELEGIDA — Leaflet self-hosted** (los archivos ya existen en la rama huérfana `feature/mejoras-ui-pwa`: `services/leaflet/` js+css+markers). Tiles de OpenStreetMap (`https://tile.openstreetmap.org`) — es *data*, no código; se permite vía CSP `img-src`. El mapa vive en la vista Centros y solo se muestra si ≥1 lugar tiene coordenadas; el estado vacío actual se conserva como fallback.
- (b) Solo enlaces Maps/Waze sin mapa embebido: ya lo tenemos; no cumple "mapa de necesidades".
- (c) Google Maps embed: iframe de terceros, CSP más laxa, dependencia comercial. Descartada.

Captura de coordenadas: botón «📍 Usar mi ubicación» (API `geolocation`) en (1) el formulario de reportar centro y (2) el panel del centro; también entrada manual `lat, lng` pegable. Requiere cambiar `Permissions-Policy` a `geolocation=(self)`. «Cerca de mí» = orden por distancia haversine client-side (sin backend).

### D-3 · Política de reclamo de centros huérfanos — **first-come + revocación admin**

`panel_crear` sobre un centro existente sin panel sigue permitido (los centros reales necesitan poder reclamarse sin fricción en una emergencia), PERO: (1) queda registrado en `historial_movimientos` («Panel creado para X»), (2) la acción admin `admin_regenerar_panel` puede revocar/regenerar token+PIN de cualquier centro (esto además resuelve la recuperación de credenciales perdidas), y (3) la tarjeta pública del centro muestra un badge «Gestionado por el centro» cuando tiene panel — visibilidad ante reclamos ilegítimos.
Alternativas descartadas: aprobación admin previa (fricción letal en emergencia) y verificación telefónica (requiere SMS/telefonía, fuera de alcance).

### D-4 · Modularización de `app.js` — **sí, al final, en 4 módulos sin bundler**

`js/core.js` (helpers `$`, `e`, i18n, modal, toast, formato), `js/vistas.js` (render de todas las vistas públicas + formularios), `js/panel.js` (panel por centro), `js/admin.js` (módulo admin nuevo) — cargados en orden con `<script>` clásicos, comunicados por el patrón IIFE+`window.App` que ya usa el proyecto. Se hace en la ÚLTIMA fase (es la de mayor riesgo de regresión y menor valor de usuario) con verificación en navegador tras cada corte. Alternativa "no modularizar": válida, pero el archivo ya duele y fue la causa del PR revertido de Ricardo — hacerlo bien ahora con verificación es el momento.

### D-5 · Matching de insumos — **en SQL, con normalización unaccent + lower**

La vista `lugares_directorio` computa `coincidencias` por insumo `Necesita`: lugares distintos con el mismo insumo en estado `Disponible`, comparando `lower(unaccent(nombre))` (así «Pañales» = «panales» = «PAÑALES»). Extensiones `unaccent` y `pg_trgm` disponibles en el proyecto (verificado); `pg_trgm` queda instalada para similitud difusa futura pero NO se usa en v1 (evitar falsos positivos en un contexto médico). Forma de cada coincidencia: `{nombre_lugar, tipo, ubicacion, telefono}` — exactamente lo que `app.js:1066` ya renderiza. Con pocos cientos de lugares el subquery es trivial; se añade índice funcional sobre `lower(unaccent(nombre))` e índice en `insumos(estado)`.

### D-6 · Reportar persona (búsqueda familiar) — **formulario público con bandera `verificada`**

Formulario en la vista Buscar familiar («Reportar a una persona»): nombre*, cédula, estado (Localizada/Hospitalizada/Buscándose/Fallecida), ubicación, contacto, fuente. Escritura vía `reportar_persona` (ya existe; se le añade `verificada=false`). Los resultados de búsqueda muestran badge «Sin verificar» hasta que un admin la confirme (`admin_verificar_persona`). El render sobrio de «Fallecida» ya existe y se conserva. Rate limit compartido del cubo público.

---

## 2. Arquitectura de los cambios

### 2.1 Backend (Supabase)

**Migración SQL `mejoras_integrales`** (una sola, idempotente):

1. `create extension if not exists unaccent; create extension if not exists pg_trgm;`
2. Función inmutable `norm_insumo(text) = lower(unaccent(trim($1)))` + índices: `insumos (norm_insumo(nombre))`, `insumos (estado)`.
3. `lugares_directorio` v2: `coincidencias` reales (subquery lateral sobre insumos Disponible de otros lugares) + campo `gestionado` (exists en `centros_panel`) + conserva forma actual.
4. `personas`: columna `verificada boolean not null default false`; `buscar_familiar` v2 devuelve además `verificada`.
5. `estadisticas()` v2: `personasLocalizadas` = count donde `estado ilike 'localiz%' or estado ilike 'hospital%'`; añade `facturasAbiertas`, `montoRecaudadoTotal`.
6. `rate_limit`: columna `cubo text not null default 'publico'` (PK pasa a `(ip, cubo, ventana)`); `rate_hit(p_ip, p_ventana, p_cubo, p_limite)` devuelve boolean.
7. Trigger `donaciones` → si `estado='Confirmada'`, recalcula `facturas.monto_recaudado` (suma de confirmadas) — el dato financiero no depende de que la edge function recuerde actualizarlo.
8. `historial_movimientos`: columna `origen text default 'publico'` (`publico`/`panel`/`admin`).

**Edge function `api` v6** — acciones nuevas / cambiadas:

| Acción | Auth | Notas |
|--------|------|-------|
| `panel_actualizar_lugar` | token+PIN | Edita tipo/ubicación/teléfono/lat/lng del propio centro (solo campos no vacíos; lat/lng validados rango VE aprox −4..13 / −74..−59) |
| `panel_insumo`, `panel_insumo_borrar` | token+PIN | + escriben `historial_movimientos` (`origen='panel'`, con cantidades) |
| `reportar_persona` | pública | + `verificada=false`, + lat/lng NO (no aplica) |
| `registrar_lugar` | pública | + acepta lat/lng opcionales (validados) |
| `admin_crear_factura` | ADMIN_KEY | numero `FAC-<año>-NNNNNN` secuencial, token `DV-XXXX-XXXX-XXXX` (mismo alfabeto sin ambiguos del panel); devuelve ambos UNA vez |
| `admin_listar_facturas` | ADMIN_KEY | Lista con tokens (el público usa `facturas_public` sin token) |
| `admin_registrar_donacion` | ADMIN_KEY | nombre_donante, monto, referencia, estado (Registrada/Confirmada) |
| `admin_registrar_movimiento` | ADMIN_KEY | tipo (Ingreso/Egreso/Compra/Entrega), descripción, monto |
| `admin_registrar_evidencia` | ADMIN_KEY | archivo (URL https), descripción, publica |
| `admin_cerrar_factura` | ADMIN_KEY | estado='Cerrada' + fecha_cierre |
| `admin_verificar_persona` | ADMIN_KEY | `verificada=true` por id |
| `admin_regenerar_panel` | ADMIN_KEY | Nuevo token+PIN para un lugar (revocación/recuperación) |

Autenticación admin: campo `adminKey` en el body JSON (misma vía que token/PIN del panel), comparada con `Deno.env.get('ADMIN_KEY')` en tiempo constante (comparación de digests SHA-256). Sin `ADMIN_KEY` configurada → todas las acciones admin devuelven 503 «módulo admin no configurado» (fail-closed).
Rate limits por cubo: `publico` 30/h/IP (igual), `panel` 120/h/token, `admin` 60/h/IP + cubo `admin_fallos` 10/h/IP para intentos con clave errónea (al superarse, 429 también para intentos válidos de esa IP).

### 2.2 Frontend

**`services/api.js`**: elimina `getFacturas`/`getDonacionesHumanitarias` (muertas); el resto igual. Nuevo namespace fino: `post()` sigue siendo la única vía de escritura (las acciones admin/panel viajan por ahí).

**Vista Centros**: mapa Leaflet (solo si hay coordenadas), botón «Cerca de mí» (geolocation + orden por haversine + distancia en la tarjeta), badge «Gestionado por el centro», coincidencias visibles de nuevo (render ya existente), botón 📍 en el form de reporte.

**Vista Buscar familiar**: formulario «Reportar a una persona» plegado (`<details>`), badge «Sin verificar» en resultados.

**Panel por centro v2**: sección «Datos del centro» editable (ubicación, teléfono, tipo, 📍 coordenadas); re-render si cambia el idioma (al cambiar el selector de idioma se cierra cualquier modal abierto — simple y suficiente).

**Módulo Admin (`#admin`)**: vista modal-wizard con la clave admin (se pide una vez por sesión, `sessionStorage`), pestañas: Facturas (crear → muestra token UNA vez / listar / cerrar), Registrar donación/movimiento/evidencia sobre factura seleccionada, Personas por verificar, Regenerar panel de centro. Todo texto pasa por `e()`; i18n completa ES/EN/FR.

**PWA**: `icon-512.png` + `icon-maskable-512.png` (generados desde el arte del 192 con padding seguro), `shortcuts` (Centros, Buscar familiar), `screenshots` opcionales fuera de v1. `sw.js`: constante única `VERSION` que forma el nombre de caché y las URLs `?v=` (una sola cosa que subir por release); checklist ya documentado en CLAUDE.md.

**Modularización (última fase)**: `js/core.js`, `js/vistas.js`, `js/panel.js`, `js/admin.js` — corte mecánico verificado en navegador tras cada archivo; `index.html` carga los 4 en orden. `app.js` desaparece.

**Iconos bottom-nav**: SVG inline de trazo (6 iconos), reemplazan ⌂✚✓⚑⌕#.

### 2.3 Seguridad

- ADMIN_KEY nunca en el repo (secret de Supabase); frontend solo la retiene en `sessionStorage` (se borra al cerrar pestaña) y ofrece «salir».
- Todas las acciones admin quedan logueadas en `historial_movimientos` con `origen='admin'`.
- Tokens `DV-`/`CTR-` generados server-side con `crypto.getRandomValues`, alfabeto sin ambiguos.
- Evidencias: solo URLs `https://` (validadas server-side); no hay upload de archivos en v1 (Storage de Supabase = upgrade path).
- El público jamás ve: `token_publico` (salvo el suyo), `referencia_pago`, teléfonos de donantes, `pin_hash/salt`.
- XSS: regla existente — todo dato externo pasa por `e()`; aplica a los renders nuevos (admin, personas, coincidencias).

### 2.4 Manejo de errores

- Acciones admin sin clave/clave errónea → mensaje específico + contador de bloqueo; 503 si el módulo no está configurado (mensaje en la UI: «pide al administrador configurar ADMIN_KEY»).
- Geolocalización denegada/timeout → toast informativo y la app sigue (orden alfabético).
- Tiles OSM caídos → el mapa muestra los pins sobre fondo gris (Leaflet nativo); la lista siempre existe.
- Escrituras: mantienen el patrón actual (mensaje inline éxito/error + `cargarTodo()`).

### 2.5 Testing (criterio de cierre por fase)

Cada fase termina con verificación en navegador real (Playwright) + curl para el backend; una fase no se commitea sin su verificación en verde. Casos adversariales obligatorios: admin con clave errónea ×11 (bloqueo), `panel_insumo` de un token sobre insumos de OTRO centro (imposible por diseño — verificar), XSS `<script>` en nombre de persona/insumo/factura (render escapado), coincidencias con acentos («pañales»/«PANALES»), rate limit de cubos independientes, seguimiento de factura con evidencia privada (no visible). QA final: 3 idiomas × móvil/desktop, consola limpia, Lighthouse rápido de a11y.

---

## 3. Fases de implementación (orden por dependencias)

1. **F1 · SQL + matching + limpieza api.js** — migración completa (§2.1.1-8), verificar coincidencias en UI con datos reales («Pañales» El Hatillo-Disponible ↔ Naiguatá-Necesita ya existe en los datos migrados).
2. **F2 · Panel v2 + historial + rate limits por cubo** — backend y UI del panel.
3. **F3 · Reportar persona + verificación** — formulario público + badge.
4. **F4 · Módulo admin de trazabilidad** — secret, acciones `admin_*`, UI `#admin`, E2E completo: crear factura → donación confirmada (trigger recalcula) → movimiento → evidencia → vista pública por token muestra todo → cerrar factura.
5. **F5 · Geo** — Permissions-Policy + CSP tiles, captura 📍, Leaflet (rescatar `services/leaflet/` de la rama huérfana), «cerca de mí», pins.
6. **F6 · PWA completa** — iconos 512/maskable, shortcuts, `VERSION` única en sw.js.
7. **F7 · Modularización + iconos SVG + minors** — 4 módulos, verificación por corte.
8. **F8 · QA integral + docs + push** — matriz 3 idiomas × 2 tamaños, adversariales, README/arquitectura/CLAUDE.md actualizados, push a `Luismadef45/donaciones-venezuela`.

**Fuera de alcance (explícito):** subida de archivos de evidencia (Storage), Supabase Auth multi-admin, notificaciones, SMS/verificación telefónica, mapa en tiempo real, edición/borrado de voluntarios-rescatistas-transportistas, migrar el deploy de Vercel (decisión aparte del usuario).

---

## 4. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Modularizar rompe algo sutil (como el PR revertido) | Última fase, corte por archivo con verificación en navegador tras cada uno, y diff mecánico |
| Tiles OSM añaden dependencia externa | Solo `img-src`; la app funciona 100% sin mapa (fallback = estado actual) |
| ADMIN_KEY compartida se filtra | Rotación con `supabase secrets set` + regenerable sin tocar código; log de acciones admin |
| Coincidencias con nombres libres generan matches pobres | v1 exacta normalizada (sin falsos positivos); pg_trgm instalada como upgrade |
| Rate limit por token del panel castiga a centros grandes | 120/h es ~2 ediciones/minuto sostenidas; configurable en una constante |

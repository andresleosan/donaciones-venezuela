# Reconstrucción Firebase greenfield + rediseño visual — diseño

**Fecha:** 2026-09-06
**Estado:** propuesto (pendiente de confirmación del operador en los gates marcados)
**Proyecto Firebase:** `donaciones-venezuela-4fc29` (Functions `us-east1`); pruebas locales en `demo-donaciones-venezuela` con Emulator Suite
**Extiende:** `docs/superpowers/specs/2026-08-07-reconstruccion-firebase-greenfield-design.md` (mantiene sus decisiones; añade el rediseño visual y los hallazgos del 2026-09-06)

## 1. Contexto verificado el 2026-09-06

- El proyecto Supabase `zryfwbjvlacorryzdaod` aparece **INACTIVE (pausado)** vía API; la base no responde y el operador no tiene acceso ni respaldo. La app publicada en Vercel apunta a ese backend, así que **hoy la aplicación no funciona en producción** (sin listados, sin estadísticas, sin escrituras).
- Decisión del operador (chat, 2026-09-06): **reconstruir todo sobre Firebase con la lógica existente**, sin migrar datos. `supabase/functions/api/index.ts` (65 acciones) y `supabase/migrations/*.sql` quedan como **referencia de reglas de negocio**, no como código vivo.
- La plataforma Firebase local ya existe y sus pruebas pasan: `npm.cmd run test:unit` (18 archivos / 327 pruebas OK); `npm.cmd --prefix functions run build` OK. La suite de emuladores solo arranca con JDK 21 o superior (resuelto con `scripts/emulators-exec.mjs`).
- Remoto: existe Firestore `(default)` (nativo, edición STANDARD); **no hay índices desplegados** y Functions no se pueden listar (Blaze no activado). Reglas remotas: sin evidencia de despliegue.
- Frontend: HTML/CSS/JS vanilla con `window.SheetsService` como único contrato de datos (`services/api.js`); Vite empaqueta `src/`; no hay framework.

## 2. Objetivo

Dejar la aplicación **funcional de punta a punta sobre Firebase**, por dominios y con pruebas, y **mejorar la parte visual** siguiendo patrones verificados en Mobbin, sin cambiar de framework ni romper el contrato de datos de la UI mientras se migra.

## 3. Decisiones

### D1. Fachada única `window.SheetsService`, implementación Firebase

La UI legada sigue llamando `SheetsService.getAll()`, `getLugares()`, `post({ accion, ... })`, etc. Se crea `src/data/sheets-service-firebase.js` (ES module empaquetado por Vite) que implementa **la misma interfaz** con:

- lecturas públicas → Firestore (proyecciones `*Publicos` / `*Publicas` con allowlist), conservando la caché IndexedDB de solo lectura;
- escrituras → Function HTTP `api` (`POST { accion, ... }` más `Authorization: Bearer <ID token>` cuando la acción lo exige);
- sesión → Firebase Auth (`observeAuth`); `registrarse`, `iniciarSesion` y `cerrarSesion` conservan sus nombres.

`services/api.js` se elimina al final (fase de limpieza), no antes. El módulo se carga con `<script type="module" src="/src/main.js">` **antes** de los scripts legados, que pasan a `defer` para garantizar el orden de ejecución.

### D2. Function `api` = despachador de acciones por dominio

Una sola Function `api` (`onRequest`, `us-east1`, CORS con allowlist de orígenes) despacha `accion` a handlers en `functions/src/api/<dominio>.ts`. Cada acción declara `auth` (`anon | user | panel | admin`), `cubo` de rate limit y `schema` de entrada (validador propio, sin dependencias), y devuelve `{ success: true, ...datos }` o `{ success: false, error }` **con el mismo shape que la edge function** para no tocar la UI. Las reglas de negocio se portan una a una desde el catálogo `docs/reference/contrato-acciones-legado.md`.

### D3. Modelo de datos: canónico privado + proyecciones públicas

Se adopta `FIRESTORE_SCHEMA.md` con estas precisiones:

- Colecciones canónicas privadas: `lugares` (con subcolección `insumos`), `centrosPanel`, `voluntarios`, `rescatistas`, `motorizados`, `personas`, `vacantesVoluntarios`, `facturas` (subcolecciones `donaciones`, `movimientos`, `evidencias`), `viajes`, `trayectos`, `entregas`, `donacionesMotorizados`, `historialMovimientos`, `familiasDamnificadas`, `denuncias`, `tasas`, `auditoriaAdmin`, `rateLimits`, `config`.
- Proyecciones públicas mantenidas **solo por Functions**, en la misma transacción o lote que la escritura canónica: `lugaresPublicos` (incluye `necesita`, `tieneDisponible` y `cubiertos` ya agregados, como hoy devuelve `lugares_directorio`), `voluntariosPublicos`, `motorizadosPublicos` (sin teléfono ni placa), `vacantesPublicas`, `facturasPublicas`, `historialPublico`, `entregasPublicas`, `trayectosPublicos`, `familiasPublicas` (solo agregados sin PII) y `estadisticas/global` (documento de contadores).
- Los contadores (`montoRecaudado`, `cantidadCubierta`, `cantidadRecibida`, número de factura) se modifican **solo en transacciones**; el número de factura sale de `config/contadores` con reserva transaccional.
- `rateLimits.expiresAt` pasa a `Timestamp` para activar la política TTL de Firestore (hoy es un número y nunca se purgaría).

### D4. Autenticación y roles

Firebase Auth email y contraseña. Roles por custom claims `role: panel | admin` (bootstrap admin por el runbook existente). El panel por centro deja el esquema token+PIN: un centro se asocia a un `authUid` (`centrosPanel.authUid`) y recibe `role: panel` y `panelLugarId` en claims; `admin_regenerar_panel` pasa a "vincular o desvincular la cuenta del panel". La pantalla del panel se conserva, pero pide correo y contraseña en lugar de token y PIN.

### D5. Archivos

Firebase Storage privado (contrato ya implementado: `private/{uid}/{category}/{fileId}.{ext}`, URLs firmadas de máximo 15 minutos por Functions). Se añaden las categorías `registro` (cédula, placa, vehículo), `evidencias`, `denuncias` (video webm o mp4 hasta 30 MB) y `presupuestos` (la cotización deja de ser pública y se sirve por URL temporal). Las fotos que hoy viajan como data URL dentro del JSON pasan a **subida directa a Storage desde el cliente**; la acción recibe solo el `path`.

### D6. Rediseño visual (mismo sistema, mejor ejecutado)

Se conservan los tokens Stripe de `DESIGN.md` (índigo `#635BFF`, tinta `#0A2540`, Inter) y se rehacen los patrones de pantalla con referencias reales de Mobbin:

- **Inicio "puertas":** tarjetas grandes de una sola pregunta (ref. IKEA Home smart, komoot).
- **Directorio de centros:** lista + mapa lateral en escritorio y hoja inferior en móvil, filtros como chips, tarjeta con estado y urgencia (ref. Care.com, Walmart store finder, Airbnb).
- **Necesidad o presupuesto (página de campaña):** progreso circular, "recaudado de meta", CTA fija y lista de últimas donaciones anónimas (ref. GoFundMe fundraiser, PayPal fundraiser).
- **Donar dinero:** montos preestablecidos + monto libre en un paso, resumen y confirmación con token copiable y "compartir por WhatsApp" (ref. PayPal Giving Fund, Venmo, flujo GoFundMe "Donating to a fundraiser").
- **Seguimiento por token:** línea de tiempo vertical con pasos completados, actual y pendientes (ref. Hers, Gusto, adidas "next steps").
- **Formularios largos (voluntario, transportista, centro, familia):** asistente por pasos con barra de progreso, un grupo de campos por paso, confirmación y éxito accionable (mismo patrón fijado para el admin en `docs/rediseno-admin-objetivo.md`).
- **Estados:** esqueleto, vacío, error honesto y "sin conexión" homogéneos en todas las listas.

Todo texto nuevo pasa por `locales/{es,en}.json`; se respetan `prefers-reduced-motion`, contraste AA y objetivos táctiles de 44 px.

### D7. Sin datos heredados

La base empieza vacía. `scripts/semilla-firebase.mjs` carga datos **sintéticos y marcados** (`PRUEBA · …`) en el emulador o, con confirmación explícita, en el proyecto de desarrollo.

## 4. Gates que requieren confirmación del operador

| Gate | Qué se necesita | Bloquea |
|---|---|---|
| G0 | Activar **Blaze** en `donaciones-venezuela-4fc29` con alertas de presupuesto (5, 20 y 50 USD). Cloud Functions 2.ª gen y Storage en proyectos nuevos lo exigen. | Desplegar `api`, Storage remoto y cualquier prueba remota de escritura |
| G1 | Desplegar reglas e índices (`firebase deploy --only firestore,storage`) | Lecturas públicas remotas |
| G2 | Crear el primer admin con `functions/scripts/bootstrap-admin.mjs` (runbook) | Acciones `admin_*` remotas |
| G3 | Cambiar CSP y preconnect de `vercel.json`, `index.html` y `ventana.html` a dominios Firebase y publicar en Vercel | Corte productivo |

Hasta G0 **todo se desarrolla y prueba en Emulator Suite**; ninguna tarea del plan depende de recursos remotos para pasar sus pruebas.

## 5. Riesgos y mitigación

- **Volumen (65 acciones):** se ataca por dominios con el mismo esqueleto; cada dominio cierra con pruebas de contrato y de reglas antes del siguiente.
- **Paridad de shapes:** el catálogo legado fija entradas y salidas; las pruebas de contrato comparan contra él.
- **Costo:** Blaze con alertas; sin fan-out de consultas en cliente (proyecciones precalculadas).
- **PII:** proyecciones por allowlist positiva y `findForbiddenPublicFields` en toda escritura pública; `buscar_familiar` deja de ser público (requiere sesión y devuelve campos mínimos).

## 6. Criterio de aceptación global

`npm.cmd run verify` en verde (unit, emuladores, build, audit e idioma), flujos principales verificados a mano contra el emulador (inicio → centros → necesidad → donar → seguimiento; voluntario; transportista; panel; admin), sin referencias funcionales a Supabase y sin PII en proyecciones, logs ni Storage público.

# Reconstrucción Firebase greenfield + rediseño visual — plan de implementación

> **Para el agente ejecutor (Opus 5):** usa `superpowers:subagent-driven-development` o `superpowers:executing-plans` y ejecuta este plan **tarea por tarea, en orden**. Cada paso es una casilla (`- [ ]`). Antes de empezar lee, en este orden: `AGENTS.md`, `docs/superpowers/specs/2026-09-06-reconstruccion-firebase-y-rediseno-visual-design.md`, `docs/reference/contrato-acciones-legado.md`, `docs/reference/contrato-datos-ui.md` y `FIRESTORE_SCHEMA.md`. No leas `supabase/functions/api/index.ts` completo salvo para resolver una duda puntual del catálogo: el catálogo ya lo resume acción por acción.

**Goal:** dejar la aplicación funcionando de punta a punta sobre Firebase (`donaciones-venezuela-4fc29`) con la lógica de negocio existente (65 acciones), sin datos heredados, y con la interfaz rediseñada según los patrones de Mobbin citados en cada tarea visual.

**Architecture:** UI vanilla intacta en su contrato (`window.SheetsService`), reimplementada en `src/data/` sobre Firebase Web SDK (lecturas de proyecciones públicas en Firestore, sesión con Firebase Auth) y una Function HTTP `api` que despacha `accion` a handlers por dominio en `functions/src/api/`. Colecciones canónicas privadas + proyecciones públicas mantenidas por Functions en la misma transacción. Storage privado con URLs temporales. Ver decisiones D1–D7 del diseño.

**Tech Stack:** HTML/CSS/JS vanilla + Vite 7 (solo `src/`), Firebase Web SDK 12 (modular), Firebase Admin 14, Cloud Functions v2 (`onRequest`, `onSchedule`, `onDocumentWritten`) en `us-east1`, Firestore nativo, Storage, Vitest 4, Emulator Suite (JDK 21 obligatorio; usar siempre los scripts `npm.cmd run test:*`, que lo resuelven solos).

## Global Constraints

- **Todo se prueba en Emulator Suite** (`demo-donaciones-venezuela`). Ninguna tarea toca el proyecto remoto sin pasar por un gate (G0–G3) confirmado por el operador en el chat.
- **No migrar datos de Supabase** ni inventarlos. Solo seeds sintéticos marcados `PRUEBA · …`.
- **Contrato de respuesta idéntico** al legado: `{ success: true, ...datos }` / `{ success: false, error }`. Mensajes de error en español, tal como los lista el catálogo, salvo donde el catálogo marque que el mensaje cambia.
- **Nunca PII en proyecciones públicas**: toda escritura pública pasa por `sanitizePublicProjection` + `findForbiddenPublicFields`. Sin teléfonos, placas, cédulas, correos, `observaciones` ni GPS exactos en colecciones públicas.
- **Contadores y estados solo en transacciones** (`runTransaction`), nunca leer-modificar-escribir suelto.
- **Toda acción `admin_*` que muta escribe `auditoriaAdmin`** (actor, acción, entidad, id, antes/después sin credenciales).
- **Rate limit falla cerrado**; si Firestore falla al contar, la acción se rechaza.
- **Ningún archivo viaja en el JSON**: fotos, videos, comprobantes y adjuntos se suben con `uploadPrivateFile` y la acción recibe `path`.
- **i18n**: todo texto nuevo en `locales/es.json` y `locales/en.json` con paridad de claves (`python scripts/verificar-idioma.py` debe pasar).
- **Cada tarea termina con** `npm.cmd run test:unit` verde, y si tocó reglas/Functions, `npm.cmd run test:emulators` verde; luego un commit propio con mensaje en inglés (`feat:`, `fix:`, `test:`, `docs:`), sin `--no-verify`.
- **Versiones**: cada cambio en `css/`, `js/` o `services/` sube `?v=` en `index.html`, `ventana.html` y `VERSION` en `sw.js`.

## Gates (confirmación explícita del operador, uno por vez)

| Gate | Acción del operador | Desbloquea |
|---|---|---|
| G0 | Activar plan **Blaze** en `donaciones-venezuela-4fc29` y crear alertas de presupuesto de 5, 20 y 50 USD | Despliegue de Functions, Storage remoto, `onSchedule` |
| G1 | `npx.cmd firebase deploy --only firestore:rules,firestore:indexes,storage --project donaciones-venezuela-4fc29` y activar TTL: `gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl --project donaciones-venezuela-4fc29` | Lecturas públicas remotas |
| G2 | Registrar el primer admin en Auth y correr `functions/scripts/bootstrap-admin.mjs` según `docs/runbooks/bootstrap-admin.md` | Acciones `admin_*` remotas |
| G3 | Cambiar CSP y `preconnect` a dominios Firebase, definir `VITE_*` y `API_ALLOWED_ORIGINS` en Vercel, publicar `dist/` | Corte productivo |

## Estado de ejecución (sesión del 2026-09-06)

**Completadas en esta sesión, sin commit todavía** (la Task 0.1 las agrupa):
Fase 0 completa salvo la parte de cliente de 0.5, y Fase 1 tareas 1.1 y 1.2.
Evidencia final de la sesión:

| Comando | Resultado |
|---|---|
| `npm.cmd run test:unit` | 24 archivos, **419** pruebas OK |
| `npm.cmd run test:emulators` | 22 archivos, **311** pruebas OK |
| `npm.cmd run test:rules` | 5 archivos, 95 pruebas OK |
| `npm.cmd --prefix functions run build` | código 0 |
| `npm.cmd run build` | código 0 |
| `python scripts/verificar-idioma.py` | 1499 claves paralelas, OK |

## Estado de partida (verificado el 2026-09-06)

Hecho en la sesión de análisis (sin commit todavía; la tarea 0.1 lo commitea):

- `scripts/emulators-exec.mjs` + scripts `test:rules|test:functions|test:emulators` reescritos: la suite de emuladores exige JDK 21 y el `java` del PATH era 1.8. Resultado: `test:emulators` 16 archivos / 170 pruebas OK.
- `functions/src/security/rate-limit.ts`: `expiresAt` ahora es `Timestamp` (antes número, imposible de purgar por TTL); acepta documentos heredados numéricos. 23 pruebas.
- `firebase/firestore.indexes.json`: eliminado el índice compuesto inválido de `vacantesPublicas` (un solo campo; el deploy devolvía 400) y añadido `fieldOverrides` TTL para `rateLimits.expiresAt`.
- `firebase.json`: `predeploy` compila Functions e `ignore` excluye `src`/`node_modules` (antes se desplegaba un `lib/` inexistente o viejo).
- `functions/src/index.ts` + `functions/src/security/cors.ts`: CORS con allowlist (`API_ALLOWED_ORIGINS` o valores por defecto), `memory`, `timeoutSeconds`, `maxInstances`, `concurrency` en todas las Functions (antes `cors: false`: el navegador bloqueaba toda llamada).
- `src/firebase/index.js`: el barrel reexportaba `uploadFile`/`deleteFile` inexistentes (error de build en Rollup); ahora exporta el contrato privado real. Prueba de presencia de exports añadida.
- `firebase/storage.rules`: `create` solo si `resource == null`, `update` solo metadata sin cambiar contenido (`md5Hash`/`size`/`contentType`), `hasOnly` en metadata, tamaño > 0; regex ancladas. Cliente alineado (`fileId` empieza por alfanumérico).
- `package.json`: `npm test` = `test:unit` (ya no exige emuladores).
- Task 1.1 (contrato y helpers portados) implementada y probada; ver la nota en la propia tarea.
- Suites tras todos los cambios: `test:unit` 20 archivos / 350 pruebas, `test:emulators` 17 archivos / 180 pruebas, `npm.cmd run build` OK.
- Auditorías completas en la conversación del 2026-09-06; sus hallazgos están repartidos como invariantes en las tareas de abajo.

Pendiente conocido: el trabajo en vuelo de Storage (Task 3 del plan 2026-08-12) está implementado pero sin commit, y falta su Task 4 (`tests/emulators/storage.integration.test.ts`). Se cierra en 0.5.

---

## Fase 0 — Cimientos y deuda de la capa de datos

### Task 0.1: Consolidar y commitear los arreglos del 2026-09-06

**Files:** los listados en "Estado de partida" más `docs/superpowers/specs/2026-09-06-*.md`, `docs/superpowers/plans/2026-09-06-*.md`, `docs/reference/*.md`.

- [ ] **Step 1:** `npm.cmd run test:unit` → PASS (≥ 334 pruebas). `npm.cmd run test:emulators` → PASS (≥ 173 pruebas). `npm.cmd --prefix functions run build` → código 0. `npm.cmd run build` → código 0.
- [ ] **Step 2:** `git add` de: `scripts/emulators-exec.mjs`, `package.json`, `firebase.json`, `firebase/`, `functions/src/`, `src/firebase/index.js`, `src/firebase/firebase-storage.js`, `tests/`, `docs/superpowers/specs/2026-09-06-*`, `docs/superpowers/plans/2026-09-06-*`, `docs/reference/`. Revisar `git diff --cached --stat`; **no** incluir `firestore-debug.log`, `.firebase/`, `dist/`.
- [ ] **Step 3:** Commit: `fix: harden firebase data layer and emulator tooling` (cuerpo: lista de los 8 arreglos). Segundo commit: `docs: plan firebase greenfield rebuild and visual redesign`.
- [ ] **Step 4:** Actualizar `tasks.md`: marcar T07 `en curso` y añadir una fila `T13 | en curso | Reconstrucción greenfield + rediseño visual | — | este plan`.

### Task 0.2: Rate limit por clase de acción y clave por endpoint — **HECHA**

> Implementada: 10 cubos (`uid`, `request`, `publico`, `lectura`, `denuncia`, `panel`, `admin`, `adminLectura`, `rafaga`, `archivos`), cada uno con su `key` (`uid`/`ip`). El nombre del cubo forma parte de la clave del documento, así que consentimiento y archivos ya no comparten cuota. `clientIp()` toma el primer salto de `X-Forwarded-For` y devuelve `desconocida` ante basura; nunca `req.ip`. En los endpoints de archivos el cupo se cobra **antes** de tocar Storage y los intentos sin sesión se miden por IP. 35 pruebas.

**Files:** Modify `functions/src/security/rate-limit.ts`, `tests/functions/rate-limit.test.ts`; Modify `functions/src/private-file-access-http.ts`, `functions/src/volunteers/public-consent-http.ts` (solo para pasar el nuevo `scope`).

**Interfaces:**
- `RATE_LIMITS` pasa a `{ [bucket]: { limit, windowMs, key: 'uid' | 'ip' } }` con buckets: `uid` (5/h, uid — se conserva), `request` (20/h, ip — se conserva), `publico` (30/h, ip), `lectura` (240/h, ip), `denuncia` (400/h, ip), `panel` (120/h, uid), `admin` (60/h, uid), `adminLectura` (600/h, uid), `rafaga` (12 por segundo, ip), `archivos` (60/h, uid).
- `consumeRateLimit(bucket, keyValue, now, db?, scope = bucket)`: la clave del documento es `sha256(\`${key}:${scope}:${sha256(keyValue)}\`)`, así el consentimiento y las URLs firmadas dejan de compartir cupo.
- `clientIp(req)`: primer salto de `X-Forwarded-For` validado como IP literal; si no hay, `'desconocida'`.

- [ ] **Step 1:** Escribir pruebas: cada bucket nuevo con su límite y ventana; `rafaga` con ventana de 1000 ms; dos scopes distintos con el mismo uid no comparten contador; `clientIp` con `X-Forwarded-For: "203.0.113.7, 10.0.0.1"` → `203.0.113.7`, con valor basura → `'desconocida'`.
- [ ] **Step 2:** `npx.cmd vitest run tests/functions/rate-limit.test.ts` → FAIL por símbolos nuevos.
- [ ] **Step 3:** Implementar; mantener `expiresAt: Timestamp`; los handlers existentes pasan `scope` (`'consent'`, `'privateFile'`) y consumen el cupo **antes** de tocar Storage/Firestore.
- [ ] **Step 4:** `npm.cmd run test:unit` PASS; `npm.cmd run test:emulators` PASS. Commit `feat: scope rate limits per endpoint and action class`.

### Task 0.3: App Check parametrizado y aplicado a todas las Functions — **HECHA**

> `getAppCheckMode` falla cerrado (`enforced`) ante valor ausente o desconocido, salvo en Emulator Suite (`FUNCTIONS_EMULATOR=true`). Aplicado a `authSession`, `api`, `getPrivateFileUrl` y `deletePrivateFile` (`health` queda fuera a propósito). `functions/.env.demo-donaciones-venezuela` = `disabled`, `functions/.env.donaciones-venezuela-4fc29` = `log-only`, y `.gitignore` deja de ignorarlos. Runbook en `docs/runbooks/app-check.md`.

**Files:** Modify `functions/src/security/app-check.ts`, `functions/src/auth/session.ts`, `functions/src/private-file-access-http.ts`, `functions/src/index.ts`; Create `functions/.env.demo-donaciones-venezuela` (`APP_CHECK_MODE=disabled`), `functions/.env.donaciones-venezuela-4fc29` (`APP_CHECK_MODE=log-only`); tests correspondientes.

- [ ] **Step 1:** Pruebas: valor desconocido de `APP_CHECK_MODE` → `'enforced'` (fail-closed); `authSession` y ambos handlers de archivos privados llaman `verifyConfiguredAppCheck` antes de autenticar y responden 403 `app-check-required` en modo `enforced` sin cabecera.
- [ ] **Step 2:** Implementar. Documentar en `docs/runbooks/app-check.md` cómo registrar reCAPTCHA v3 en la consola y pasar a `enforced` (parte de G3).
- [ ] **Step 3:** `npm.cmd run test:emulators` PASS. Commit `feat: fail-closed app check on all functions`.

### Task 0.4: Índices y reglas de las proyecciones públicas (todas) — **HECHA**

> `firebase/firestore.rules` reescrito: 11 proyecciones listables con `limit <= 50`, `facturasPublicas` solo por `get` (el id es el token), `estadisticas/global` y `tasas/actual` como documentos únicos, y denegaciones explícitas para las canónicas, `rateLimits`, `auditoriaAdmin`, `config` e `indices`. 10 índices compuestos (ninguno de un solo campo de usuario, que el deploy rechaza con 400) y `fieldOverrides` TTL. Nueva suite `tests/rules/public-projections.rules.test.ts`; el total de reglas pasa de 38 a 95 pruebas.

**Files:** Modify `firebase/firestore.rules`, `firebase/firestore.indexes.json`, `tests/rules/public-readings.rules.test.ts`.

**Interfaces (reglas):** un bloque por colección pública, todos con `allow get: if true; allow list: if request.query.limit != null && request.query.limit <= 50; allow write: if false;`: `lugaresPublicos`, `voluntariosPublicos`, `motorizadosPublicos`, `vacantesPublicas`, `facturasPublicas` (solo `get` por id = token; `list` denegado), `historialPublico`, `trayectosPublicos`, `donacionesMotorizadosPublicos`, `familiasPublicas`, `estadisticas` (solo `get` de `estadisticas/global`), `tasas` (solo `get` de `tasas/actual`). Bloques explícitos `allow read, write: if false` para `rateLimits`, `auditoriaAdmin`, `config`, `indices` y todas las canónicas.

**Índices (uno por consulta real de la fachada, Task 2.3):** `lugaresPublicos (activo ASC, nombreNorm ASC, __name__ ASC)`; `voluntariosPublicos (activo ASC, createdAt DESC, __name__ DESC)`; `motorizadosPublicos (activo ASC, createdAt DESC, __name__ DESC)`; `historialPublico (lugarId ASC, createdAt DESC, __name__ DESC)`; `trayectosPublicos (motorizadoId ASC, createdAt DESC, __name__ DESC)`; `familiasPublicas (createdAt DESC)` no necesita compuesto; `vacantesPublicas (estado ASC, createdAt DESC, __name__ DESC)`.

- [ ] **Step 1:** Pruebas de reglas: para cada colección pública, `get` anónimo OK, `list` con `limit(50)` OK, `list(51)` y sin límite FAIL, escritura FAIL para los cuatro roles; `facturasPublicas` `list` FAIL siempre; `estadisticas/global` y `tasas/actual` `get` OK y `list` FAIL.
- [ ] **Step 2:** `npm.cmd run test:rules` → FAIL en las colecciones nuevas.
- [ ] **Step 3:** Escribir reglas e índices. Validar formato con `npx.cmd firebase deploy --only firestore:indexes --project demo-donaciones-venezuela --dry-run` no aplica (proyecto demo): en su lugar, `node -e "JSON.parse(require('fs').readFileSync('firebase/firestore.indexes.json','utf8'))"` y revisar que ningún índice tenga un solo campo de usuario.
- [ ] **Step 4:** `npm.cmd run test:rules` PASS. Commit `feat: rules and indexes for all public projections`.

### Task 0.5: Cerrar Storage privado (Task 3/4 del plan 2026-08-12) — **PARCIAL**

> Hecho: reglas de Storage endurecidas (`create` solo si `resource == null`, `update` solo metadata comprobando `md5Hash`/`size`/`contentType`, `hasOnly` en metadata, tamaño > 0, regex ancladas) con 3 pruebas nuevas; `getSignedUrl` con `version: 'v4'` y bucket explícito desde `STORAGE_BUCKET`; auditoría en `auditoriaAdmin` de cada firma, borrado e intento rechazado, con el path hasheado; cliente `src/firebase/private-files.js` (`getPrivateFileUrl`, `requestPrivateFileDeletion`) y `src/firebase/functions-base.js`, con 16 pruebas; eliminado `deleteFile` del cliente (las Rules lo deniegan siempre).
>
> También cerrada la costura del bucket de Storage: el cliente apuntaba a
> `donaciones-venezuela-4fc29.firebasestorage.app`, las pruebas de emulador cableaban
> `demo-donaciones-venezuela.appspot.com` y Functions resolvía un tercer valor con el bucket
> por defecto, sin ninguna prueba en el punto de unión. Ahora `STORAGE_BUCKET` se declara en
> `functions/.env.<proyecto>`, las pruebas comparten `tests/emulators/entorno.ts` y
> `tests/functions/storage-bucket.test.ts` comprueba que cliente y servidor nombren el mismo bucket.
>
> **Falta:** `tests/emulators/storage.integration.test.ts` (Task 4 del plan 2026-08-12) y conceder `roles/iam.serviceAccountTokenCreator` a la cuenta de servicio en el gate G0.

**Files:** Modify `functions/src/private-file-access-http.ts`, `src/firebase/firebase-storage.js`, `src/firebase/index.js`; Create `tests/emulators/storage.integration.test.ts`, `src/firebase/private-files.js`; Modify `tests/firebase/firebase-storage.test.js`.

**Interfaces:**
- Cliente: `getPrivateFileUrl(path): Promise<{ url, expiresAt }>` y `requestPrivateFileDeletion(path): Promise<{ success: true }>` en `src/firebase/private-files.js`, ambos `POST { path }` a `${VITE_API_BASE}/getPrivateFileUrl` / `deletePrivateFile` con `Authorization: Bearer <idToken>`. Se elimina `deleteFile` (siempre denegado por reglas).
- Functions: `getSignedUrl({ version: 'v4', action: 'read', expires })`; bucket explícito desde `defineString('STORAGE_BUCKET')`; escribir `auditoriaAdmin` `{ actorUid, accion: 'firmar_url_privada' | 'eliminar_archivo_privado', entidad: 'storage', entidadId: sha256(path), resultado, createdAt }` en cada operación; cupo `archivos` consumido antes de `exists()`.
- Categorías de Storage ampliadas en reglas y cliente: `receipts`, `needs`, `reports`, `registro`, `evidencias`, `denuncias` (webm/mp4 ≤ 30 MiB), `presupuestos` (pdf/jpg/png/webp ≤ 5 MiB).

- [ ] **Step 1:** Pruebas unitarias del cliente nuevo (fetch mockeado: cabecera Bearer, cuerpo exacto `{ path }`, error → mensaje i18n) y de las categorías nuevas; prueba de handler: auditoría escrita en éxito y en `forbidden`.
- [ ] **Step 2:** Prueba de integración en emulador: subir con el SDK cliente como `owner`, pedir URL firmada con ID token real del emulador Auth → 200 con `url` y `expiresAt` ≤ 15 min; `panel` sobre `reports` → 403; borrado → 200 y `exists()` false; documento en `auditoriaAdmin`.
- [ ] **Step 3:** Implementar. `npm.cmd run test:emulators` PASS. Commit `feat: complete private storage loop with audit and client wrappers`. Actualizar `.superpowers/sdd/2026-08-12-storage-private-files/progress.md` y `tasks.md` (T07 `completada`).

### Task 0.6: CI — **HECHA**

> `.github/workflows/verify.yml`: Node 22, Temurin 21, caché de los binarios del emulador, `test:unit`, `test:emulators`, `build`, paridad de idiomas y auditoría de dependencias.

**Files:** Create `.github/workflows/verify.yml`.

- [ ] **Step 1:** Workflow en `pull_request` y `push` a `main`: `actions/setup-node@v4` (Node 22), `actions/setup-java@v4` (Temurin 21), caché de `~/.cache/firebase/emulators`, `npm ci`, `npm --prefix functions ci`, `npm run test:unit`, `npm run test:emulators`, `npm run build`, `python scripts/verificar-idioma.py`.
- [ ] **Step 2:** Commit `ci: run unit, emulator and build checks`. Verificar en GitHub que el workflow pasa antes de seguir.

---

## Fase 1 — Despachador `api` y utilidades de dominio

### Task 1.1: Contrato de acciones y helpers portados

**Files:** Create `functions/src/api/contract.ts`, `tests/functions/api-contract.test.ts`.

**Interfaces:**
```ts
export type ActionAuth = 'anon' | 'user' | 'panel' | 'admin';
export type ActionContext = { uid: string | null; role: 'anon' | 'user' | 'panel' | 'admin'; panelLugarId: string | null; ip: string; now: Date; db: Firestore; };
export type ActionDefinition = { nombre: string; auth: ActionAuth; cubo: RateLimitBucket; handler(ctx: ActionContext, payload: Record<string, unknown>): Promise<Record<string, unknown>>; };
export class ApiError extends Error { constructor(message: string, public status: 400 | 401 | 403 | 404 | 409 | 429 = 400) }
// Helpers portados 1:1 del legado (ver catálogo, sección "Reglas transversales"):
export const s: (v: unknown, max?: number) => string;      // trim + slice(0, max=300)
export const n: (v: unknown) => number;                    // Number finito o 0
export const emailNorm: (v: unknown) => string;            // minúsculas o ''
export const normalizar: (v: unknown) => string;           // NFD sin diacríticos, minúsculas, trim (equivale a norm_insumo)
export const tokenAlfa: (prefijo: string) => string;       // ABCDEFGHJKMNPQRSTUVWXYZ23456789, XXXX-XXXX-XXXX
export const geoValida: (p) => { lat: number | null; lng: number | null }; // lat -4..13, lng -74..-59
export const kmEntre: (aLat, aLng, bLat, bLng) => number;  // haversine, 1 decimal
export const numeroFactura: (year: number, seq: number) => string; // FAC-YYYY-000001
export const mov: (codigo: string, datos: Record<string, unknown>) => string; // JSON {k:'mov', c, ...}
```

> **Hecha el 2026-09-06** (sin commit; se incluye en el commit de la Task 0.1): `functions/src/api/contract.ts` y `tests/functions/api-contract.test.ts` (15 pruebas). Además exporta `ESTADOS_FACTURA`, `ESTADOS_DONACION`, `ESTADOS_INSUMO`, `URGENCIAS`, `TIPOS_LUGAR`, `opcion()`, `claveDocumento()`, `soloDigitos()`, `coordsAproximadas()`, `objetivoNecesidad()` y `TOKEN_PATRON`. `RateLimitBucket` ya se exporta desde `rate-limit.ts`.

- [x] **Step 1:** Pruebas de cada helper con los valores del catálogo (truncado, correos inválidos, tokens con alfabeto sin 0/O/1/I, geo fuera de Venezuela → null, `kmEntre` Caracas–La Guaira ≈ 13.7 km ±0.6, `numeroFactura(2026, 7)` → `FAC-2026-000007`).
- [x] **Step 2:** `npx.cmd vitest run tests/functions/api-contract.test.ts` → PASS (15). Commit pendiente dentro de la Task 0.1.

### Task 1.2: Despachador HTTP `api` — **HECHA**

> `functions/src/api/{registry,http,index}.ts` y la Function `api` exportada en `functions/src/index.ts`. Contrato idéntico al legado (`solo POST`, `accion desconocida`, `{success,...}`). **Añadido sobre el plan original:** comprobación de origen dentro del propio handler (403 `origen no permitido`), porque el CORS de la plataforma es un control del navegador y el emulador lo relaja; se detectó con la prueba de integración. 30 pruebas unitarias + 6 de integración contra el emulador.

**Files:** Create `functions/src/api/registry.ts`, `functions/src/api/http.ts`, `functions/src/api/index.ts`, `tests/functions/api-http.test.ts`, `tests/emulators/api.integration.test.ts`; Modify `functions/src/index.ts`.

**Interfaces:**
- `defineAction(def: ActionDefinition)` registra; `getAction(nombre)`; `listActions()`.
- `apiHandler(req, res, deps?)`: solo `POST` con `content-type: application/json` (otros → 405/400 con `{ success: false, error: 'solo POST' }`); `accion = s(body.accion, 40)`; desconocida → 400 `accion desconocida`; App Check según Task 0.3; cupo `rafaga` por IP siempre; luego autenticación según `auth` (`user` exige ID token válido; `panel` exige claim `role: 'panel'` y `panelLugarId`; `admin` exige `role: 'admin'`); cupo del `cubo` de la acción (por uid si autenticada, por IP si anónima); ejecuta `handler`; responde `{ success: true, ...resultado }`. `ApiError` → su status; `RateLimitError` → 429 + `Retry-After`; cualquier otro error → 500 `{ success: false, error: 'Error interno' }` sin detalles.
- `export const api = onRequest(httpOptions, apiHandler)` en `functions/src/index.ts`.

- [ ] **Step 1:** Pruebas unitarias con `deps` inyectadas (authenticate, rateLimiter, actions): matriz método/contenido; acción desconocida; `anon` OK; `user` sin token → 401; `panel` sin claim → 403; `admin` con rol `panel` → 403; 429 con `Retry-After`; `ApiError(409)`; error genérico → 500 sin mensaje interno; el payload que llega al handler no incluye `accion`.
- [ ] **Step 2:** Prueba de integración: `POST http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/api` con `{ accion: 'no_existe' }` → 400 `{ success:false, error:'accion desconocida' }`; preflight `OPTIONS` con `Origin: http://localhost:5173` → 204 con `Access-Control-Allow-Origin`.
- [ ] **Step 3:** Implementar. `npm.cmd run test:emulators` PASS. Commit `feat: api action dispatcher`.

### Task 1.3: Utilidades de persistencia compartidas

**Files:** Create `functions/src/api/db.ts`, `functions/src/api/publicar.ts`, `tests/functions/api-db.test.ts`.

**Interfaces:**
- `auditar(tx, ctx, { accion, entidad, entidadId, antes, despues, resultado })` → documento en `auditoriaAdmin`; nunca guarda `pin`, `token`, `hash`, `email` completo (se enmascara `a***@dominio`).
- `historial(tx, { lugarId, lugarNombre, insumo, descripcion, origen, cantidad })` → `historialMovimientos` + proyección `historialPublico`.
- `siguienteNumeroFactura(tx)` → lee/incrementa `config/contadores.facturaSeq` dentro de la transacción y devuelve `FAC-YYYY-NNNNNN`.
- `reservarClaveUnica(tx, coleccionIndice, clave, valor)` → crea `indices/{coleccionIndice}/{clave}` o lanza `ApiError(409)`; usado para `lugaresPorNombre`, `cuentasPorEmail`, `facturasPorToken`, `facturasAbiertasPorObjetivo`.
- `publicar(tx, nombreProyeccion, id, documentoPrivado)` → `sanitizePublicProjection` + `findForbiddenPublicFields` + `updatedAt: serverTimestamp()` (+ `createdAt` si no existe) y escribe la proyección; `despublicar(tx, nombreProyeccion, id)`.
- `PUBLIC_PROJECTION_FIELDS` se amplía en `functions/src/public-projections.ts` con las allowlists de `lugaresPublicos` (añadir `nombreNorm`, `necesita`, `tieneDisponible`, `cubiertos`, `gestionado`, `lat`, `lng` redondeados a 3 decimales), `trayectosPublicos`, `donacionesMotorizadosPublicos`, `familiasPublicas` (`codigo`, `municipio`, `estadoGeo`, `numPersonas`, `numMenores`, `perdioCasa`, `perdioVehiculo`, `perdioFamiliar`, `necesidadMedica`, `rangosEdad` en `0-17/18-64/65+`, `estado`, `createdAt`, `insumosNecesarios`) y `estadisticas`.

> **Hecha el 2026-09-06**, antes de la Task 2.3 (que necesita `publicar`). Desviaciones respecto a las interfaces de arriba, todas con motivo:
>
> - `publicar(tx, db, nombre, id, doc)` y `despublicar(tx, db, nombre, id)` reciben el `Firestore` porque hace falta para construir la referencia; `auditar` e `historial` reciben `ctx` (que ya lo lleva).
> - **Índices:** la ruta es `indices/<indice>/claves/<clave>`, no `indices/<indice>/<clave>`: tres segmentos en Firestore son una colección, no un documento. La regla `match /indices/{coleccion}/{documento=**}` ya cubre el árbol entero.
> - **`createdAt`:** en vez de rellenarlo con `serverTimestamp()` cuando falta (que lo reescribiría en cada publicación y borraría la fecha real de creación), `publicar` **falla** si la allowlist declara `createdAt` y el documento no lo trae. Una proyección que se consulta ordenada por `createdAt` sin ese campo existiría pero ninguna query la vería; mejor romper en pruebas.
> - **Lecturas antes que escrituras:** `siguienteNumeroFactura` y `reservarClaveUnica` leen, así que van al principio de la transacción (Firestore rechaza leer después de escribir). Documentado en la cabecera de `db.ts` y cubierto por el Firestore falso, que lanza si se invierte el orden.
> - `historialPublico.lugarId` se publica con el **nombre normalizado** del lugar (ver Task 2.2); el documento canónico conserva el `lugarId` real y `lugarNorm`.
> - `marcaServidor()` en `publicar.ts` es el único productor del centinela `serverTimestamp()`: `firebase-admin` solo está instalado dentro de `functions/`, así que las pruebas de la raíz no pueden importarlo.
> - Añadido `coordsPublicas(lat, lng)` a `contract.ts` (3 decimales, ~110 m) para las coordenadas de `lugaresPublicos`; `coordsAproximadas` (2 decimales) se queda para lo que necesita ~1 km.
> - Allowlists nuevas en `public-projections.ts`: `trayectosPublicos`, `donacionesMotorizadosPublicos`, `familiasPublicas`, `estadisticas` y `tasas`; ampliadas `lugaresPublicos` e `historialPublico`.

- [x] **Step 1:** Pruebas con Firestore falso en memoria (mismo patrón que `tests/functions/rate-limit.test.ts`) para cada utilidad; `publicar` rechaza un documento con `telefono` anidado; `siguienteNumeroFactura` es monotónico y no reutiliza tras rollback simulado. **22 pruebas** en `tests/functions/api-db.test.ts`.
- [x] **Step 2:** Implementar. `npm.cmd run test:unit` PASS. Commit `feat: shared persistence helpers for api actions`.

Evidencia: `npm.cmd run test:unit` 29 archivos / **506** pruebas OK; `npm.cmd run test:emulators` 23 archivos / **333** pruebas OK; `npm.cmd --prefix functions run build` código 0.

---

## Fase 2 — Fachada `SheetsService` sobre Firebase y arranque de la UI

### Task 2.1: Caché offline y cliente HTTP reutilizables

**Files:** Create `src/data/offline-cache.js` (mover `abrirDb`, `transaccion`, `guardarSnapshot`, `leerSnapshot`, cola `outbox` y `flushQueue` desde `services/api.js`, sin cambios de comportamiento), `src/data/api-client.js`; Create `tests/data/offline-cache.test.js`, `tests/data/api-client.test.js`.

**Interfaces:** `post(payload, { idToken })` → `fetch(\`${VITE_API_BASE}/api\`, { method:'POST', headers: { 'Content-Type':'application/json', Authorization? }, body })` con timeout 45 s; lanza `Error(data.error)` cuando `success === false`. `VITE_API_BASE` por defecto `http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1` en `import.meta.env.DEV`.

> **Hecha el 2026-09-06.** `src/data/offline-cache.js` conserva la mecánica del legado (misma base, almacenes, versión, política de descarte y evento `dv-offline-change`); lo único que cambia es que el envío se inyecta: `enviarConCola(payload, enviar)` y `flushQueue(enviar)` reciben la función que hace la petición, así la fachada de la Task 2.2 decide el transporte. `enviarConCola` es el `post()` del legado sin el cliente Supabase dentro. `src/data/api-client.js` reutiliza `functionsBaseUrl` de `src/firebase/functions-base.js` y solo añade el valor por defecto del emulador cuando `import.meta.env.DEV` y no hay `VITE_API_BASE` ni `DV_ENTORNO.apiBase`; se deja `functions-base.js` intacto porque `private-files.js` depende de su resolución actual. `services/api.js` sigue en su sitio: lo retira la Task 2.2 al cambiar los `<script>`.

- [x] **Step 1:** Mover el código de cola/caché con sus pruebas existentes (`tests/offline-queue-integration.test.js` debe seguir pasando apuntando al módulo nuevo). Pruebas del cliente: Bearer solo si hay token; timeout; error de red detectado como `esErrorDeRed`.
- [x] **Step 2:** `npm.cmd run test:unit` PASS. Commit `refactor: extract offline cache and api client modules`.

Evidencia: `npm.cmd run test:unit` 26 archivos / **449** pruebas OK (antes 24 / 419); `npm.cmd run test:emulators` 22 archivos / **311** pruebas OK; `npm.cmd run build` código 0.

### Task 2.2: `SheetsService` Firebase y arranque `src/main.js`

**Files:** Create `src/data/sheets-service-firebase.js`, `src/main.js`, `tests/data/sheets-service-firebase.test.js`; Modify `index.html`, `ventana.html`, `js/core.js` (sesión), `js/entorno.js`, `vite.config.js`, `sw.js`.

**Interfaces (misma firma que `services/api.js`, ver `docs/reference/contrato-datos-ui.md`):**
- `configure()` no-op; `getAll()` compone `getLugares`, `getVoluntarios`, `getMotorizados`, `getVacantes`, `getTraslados` (derivado en cliente), `estadisticas/global`; devuelve `{ data, source }` y guarda snapshot como hoy.
- `getLugares()` → `lugaresPublicos` ordenado por `nombreNorm`, paginando de 50 en 50 hasta agotar (máximo 20 páginas); calcula en cliente `necesita[].coincidencias` (insumos `Disponible` de otros lugares con el mismo `nombreNorm`) y `porcentaje`/`yaCubierto` si la proyección no los trae.
- `getVoluntarios/getMotorizados/getFamiliasPublicas/getTrayectos(motorizadoId)/getHistorial(lugar)` → sus proyecciones; `getRescatistas` → `{ data: [], source: 'restricted' }`.
- `getSeguimiento(token)` → `getDoc(facturasPublicas/{token})` → `{ factura, movimientos, evidencias }` con el shape del catálogo; `getDesgloseDonaciones(token)` → campo `donacionesPublicas` del mismo documento.
- `getFamiliares(q)` → `post({ accion: 'buscar_familiar', q })` (requiere sesión; ver Task 3.2).
- `registrarse/iniciarSesion` → Firebase Auth; devuelven `{ access_token, user: { email }, expires_at }` sintetizados para que `guardarSesion` de `js/core.js` siga funcionando; `refrescarSesion` → `getIdToken(true)`; `cerrarSesion` → `signOut` + `clearOfflineQueue`.
- `post(payload)`: adjunta `idToken` actual si existe (sustituye `accessToken`/`adminKey`/`token`+`pin` del legado: la acción autentica por claims); cola offline según `DVOfflinePolicy`.
- `src/main.js`: `configureAuthPersistence('local')`, `observeAuth` → mantiene `dv-sesion` en memoria (no en `localStorage`), `window.SheetsService = crearSheetsServiceFirebase()`, `window.DVFirebase = { getPrivateFileUrl, uploadPrivateFile, requestPrivateFileDeletion }`.
- `index.html`/`ventana.html`: `<script type="module" src="/src/main.js"></script>` **antes** de los scripts legados; todos los `<script src="js/...">` y `services/...` pasan a `defer`; se elimina `<script src="services/api.js">` y el `preconnect` a Supabase.

> **Hecha el 2026-09-06** salvo el Step 3 (ver abajo). Notas de implementación:
>
> - **Orden de scripts.** Vite inyecta el bundle en el `<head>`, así que en `dist/` el módulo se adelanta a `js/entorno.js` por mucho que en el HTML fuente vaya después. Para que `window.DV_ENTORNO` siga sirviendo: `src/firebase/firebase-config.js` pasa a getters (lee `DV_ENTORNO` en cada acceso, no al importar), `functions-base.js` y `api-client.js` lo consultan por llamada, y `src/main.js` conecta con Firebase Auth en `DOMContentLoaded`, no al evaluarse. `tests/firebase/firebase-config.test.js` fija ese contrato. En el HTML fuente el orden es: leaflet → `offline-queue-policy` → `entorno` → módulo → `pwa` → `core` → resto (`pwa.js` consulta `SheetsService` al arrancar).
> - **Nombres de campo.** Las proyecciones de la Fase 3 todavía no están fijadas, así que cada mapeo acepta el nombre del catálogo y el de la allowlist actual (`ubicacion`/`ubicacionPublica`, `telefono`/`contactoPublico`, `lat`/`latAproximada`, `tiene_disponible`/`tieneDisponible`, `fecha_registro`/`createdAt`). La UI siempre recibe el nombre del contrato.
> - **`getHistorial`.** La UI llama con el **nombre** del lugar y el único índice disponible es `historialPublico (lugarId, createdAt, __name__)`. La fachada consulta `where('lugarId','==', normalizar(nombre))`: la Task 3.1 debe publicar `historialPublico.lugarId` con el `nombreNorm` del lugar, o la ventana `historial` no resuelve sin una lectura extra.
> - **Derivaciones.** `necesita[].coincidencias` y `estado.traslados` se calculan en cliente con la misma lógica de las vistas `lugares_directorio` y `traslados_sugeridos` (cruce por insumo normalizado entre lugares distintos, `order by (urgencia='Alta') desc, nombre`, traslados ordenados por `actualizado` desc y cortados a 30).
> - **Sesión.** `dv-sesion` deja `localStorage`: vive en `window.DVSesion` (memoria) y `src/main.js` lo repuebla desde `observeAuth`; `js/core.js` emite/escucha `dv-sesion-change`. La persistencia entre recargas la lleva el SDK (`browserLocalPersistence`).
> - **`vite.config.js` no cambia:** las dos páginas ya son entradas de Rollup y el módulo entra por el `<script type="module">`.
>
> **Pendiente conocido, bloquea el Step 3:** el Web SDK no tiene cableado el Emulator Suite (no hay `connectFirestoreEmulator` / `connectAuthEmulator` / `connectStorageEmulator` en `src/firebase/`), y `getFirestore(app)` devuelve la misma instancia a `firebase-firestore.js`, `firebase-public-reads.js` y la fachada, así que la conexión debe centralizarse en un único punto (conectar dos veces lanza). Se resuelve como primer paso de la Task 2.4, que es donde el emulador se usa de verdad.

- [x] **Step 1:** Pruebas de la fachada con `firebase/firestore` mockeado (patrón `tests/firebase/firebase-public-reads.test.js`): envelope `{ data, source }`, derivación de `coincidencias`, `source: 'offline-cache'` cuando `getDocs` falla y hay snapshot, `post` con Bearer. **26 pruebas** en `tests/data/sheets-service-firebase.test.js`.
- [x] **Step 2:** Implementar. `npm.cmd run build` PASS; en `dist/index.html` comprobar que el módulo va antes de `js/core.js` y que no queda `services/api.js`. Verificado: `dist/index.html:56` es el módulo, `dist/index.html:840` es `js/core.js`, y `services/api.js` no aparece en ninguna de las dos páginas construidas.
- [ ] **Step 3:** Prueba manual con emulador: `npx.cmd firebase emulators:start --project demo-donaciones-venezuela --import=./seeds/emulador` (seeds de Task 2.4) + `npm.cmd run dev`; abrir `http://localhost:5173`, ver directorio con datos semilla, sin errores en consola. Anotar evidencia en el commit. **Aplazado a la Task 2.4:** faltan las semillas y el cableado del emulador en el Web SDK.
- [x] **Step 4:** Commit `feat: firebase-backed SheetsService facade and module bootstrap`.

Evidencia: `npm.cmd run test:unit` 28 archivos / **479** pruebas OK; `npm.cmd run test:emulators` 22 archivos / **311** pruebas OK; `npm.cmd run build` código 0; `python scripts/verificar-idioma.py` 1499 claves paralelas OK.

Hallazgos para tareas posteriores: el bundle `dist/assets/main-*.js` queda en **583 kB** (175 kB gzip) porque `firebase/firestore` y `firebase/storage` se importan estática y dinámicamente a la vez y Rollup no puede separarlos — corregirlo en la Task 4.9. La CSP de `vercel.json` sigue apuntando a `*.supabase.co` (`connect-src`): es el Step 5 del gate G3.

### Task 2.3: `estadisticas/global`, `tasas/actual` y publicador de arranque

**Files:** Create `functions/src/api/estadisticas.ts` (recalcular contadores dentro de las transacciones de cada dominio: `centrosRegistrados`, `hospitalesRegistrados`, `voluntariosActivos`, `motorizadosRegistrados`, `personasReportadas`, `personasLocalizadas`, `donacionesRegistradas`, `facturasAbiertas`, `montoRecaudadoTotal` (solo facturas `tipo: 'dinero'`), `actualizado`), `functions/src/jobs/reconciliar-proyecciones.ts` (acción admin `admin_reconstruir_proyecciones` que recorre las canónicas y reescribe todas las proyecciones y contadores por lotes de 400).

- [ ] **Step 1:** Pruebas: incrementos atómicos; reconstrucción idempotente con Firestore falso.
- [ ] **Step 2:** Implementar. Commit `feat: aggregate statistics document and projection rebuild action`.

### Task 2.4: Seeds sintéticos para el emulador

**Files:** Create `scripts/semilla-firebase.mjs`, `seeds/README.md`, `src/firebase/emuladores.js`; Modify `src/firebase/firebase-config.js`, `src/firebase/firebase-auth.js`, `src/firebase/firebase-firestore.js`, `src/firebase/firebase-public-reads.js`, `src/data/sheets-service-firebase.js`; `package.json` script `seed:emulador`.

- [ ] **Step 0 (traído de la Task 2.2):** cablear el Emulator Suite en el Web SDK. `getFirestore(app)` devuelve **una sola instancia** por app, así que la conexión no puede repetirse en cada módulo: centralizar la creación de Firestore, Auth y Storage en `firebase-config.js` (una promesa por servicio) y conectar `connectFirestoreEmulator` / `connectAuthEmulator` / `connectStorageEmulator` solo cuando `DV_ENTORNO.emuladores` o `VITE_FIREBASE_EMULATORS` lo pidan. Actualizar los mocks de `firebase-config.js` en las pruebas que hoy solo falsean `getFirebaseApp`. Con eso cerrar el Step 3 de la Task 2.2.
- [ ] **Step 1:** El script usa Admin SDK contra `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` y `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`; se niega a correr si esas variables no apuntan a `127.0.0.1`. Crea: 3 lugares con insumos (mismos de `scripts/semilla-pruebas.sql`, con prefijo `PRUEBA · `), 2 voluntarios, 2 motorizados, 1 vacante, 2 facturas (una presupuesto abierta, una necesidad), `tasas/actual` = 36.5 (fuente `seed`), usuarios `admin@prueba.local` (claim admin), `panel@prueba.local` (claim panel del lugar 1), `user@prueba.local`; y escribe todas las proyecciones vía las mismas funciones de `publicar`.
- [ ] **Step 2:** Exportar con `npx.cmd firebase emulators:export ./seeds/emulador --project demo-donaciones-venezuela` y versionar la carpeta. Commit `feat: deterministic emulator seeds`.

---

## Fase 3 — Dominios (portar acciones con la lógica del catálogo)

Reglas comunes a todas las tareas de esta fase:

1. Crear `functions/src/api/<dominio>.ts` con `defineAction` por acción; un archivo de pruebas de contrato `tests/functions/api-<dominio>.test.ts` (Firestore falso) con **una prueba por validación del catálogo** (mismo mensaje) y **una por efecto**; y una prueba de integración en `tests/emulators/api-<dominio>.integration.test.ts` para el flujo principal.
2. Documento canónico + proyección se escriben en la **misma transacción**.
3. Al terminar el dominio: `npm.cmd run test:emulators` PASS, prueba manual del flujo en la UI contra el emulador, commit `feat(api): <dominio> actions`.

### Task 3.1: Lugares, insumos, historial y panel de centro

**Acciones:** `registrar_lugar`, `panel_crear`, `panel_ver`, `panel_actualizar_lugar`, `panel_insumo`, `panel_insumo_borrar`, `admin_listar_necesidades`, `admin_regenerar_panel`.

**Modelo:** `lugares/{lugarId}` (`tipo`, `nombre`, `nombreNorm`, `ubicacion`, `telefono`, `lat`, `lng`, `actualizado`, `panelUid`), subcolección `insumos/{insumoNorm}` (`nombre`, `categoria`, `estado`, `cantidadNecesaria`, `cantidadRecibida`, `urgencia`, `unidad`, `actualizado`), índice de unicidad `indices/lugaresPorNombre/{nombreNorm}`; `centrosPanel/{lugarId}` (`authUid`, `email` enmascarado, `fotoCedulaPath`, `fotoSitioPath`, `creado`). Proyección `lugaresPublicos/{lugarId}` con `necesita/tieneDisponible/cubiertos` recalculados en la misma transacción.

**Invariantes (de la auditoría):** `registrar_lugar` nunca sobreescribe un lugar existente; `panel_crear` exige `auth: 'user'`, rechaza si el nombre existe, crea lugar + `centrosPanel` + claims `{ role: 'panel', panelLugarId }` **en ese orden dentro de una transacción y con las fotos ya subidas por el cliente** (no queda lugar huérfano); `panel_insumo` calcula el `delta` de `cantidadRecibida` dentro de la transacción y llama a `registrarEntrega` (Task 3.4) con él; `panel_insumo_borrar` elimina el subdocumento; `admin_regenerar_panel(email)` busca el usuario por correo con Admin Auth y reasigna claims (si no existe: error `Esa persona debe registrarse primero con ese correo`), auditado.

- [ ] **Step 1..3:** según las reglas comunes. La UI del panel (`js/panel.js`) cambia token+PIN por "entrar con tu cuenta": si `role !== 'panel'` muestra el mensaje `panel.sinAcceso` (nueva clave i18n); tras `panel_crear` la fachada llama `getIdToken(true)`.

### Task 3.2: Personas: voluntarios, rescatistas, transportistas, reportes y búsqueda familiar

**Acciones:** `registrar_voluntario`, `registrar_rescatista`, `registrar_motorizado`, `acceso_perfil`, `reportar_persona`, `buscar_familiar` (nueva, `auth: 'user'`, cupo `lectura`), `admin_listar_voluntarios`, `admin_listar_rescatistas`, `admin_listar_personas`, `admin_verificar_persona`, `setVolunteerPublicConsent` (ya existe; se registra como acción `voluntario_consentimiento`).

**Modelo:** `voluntarios/{id}`, `rescatistas/{id}`, `motorizados/{id}` con `authUid`, `emailNorm`, fotos como `path`; unicidad `indices/cuentasPorEmail/{emailNorm}` → `{ tipo, id }` (el catálogo documenta que hoy no es única: aquí sí); `personas/{id}` con `nombreNorm`, `cedula`, `verificada`. Proyecciones: `voluntariosPublicos` (consentimiento v1), `motorizadosPublicos` (`nombre`, `zona`, `tipoVehiculo`, `activo`, `createdAt`; **sin teléfono ni placa**).

**Invariantes:** ids generados por servidor (`VOL`/`RES`/`MOT` + 8 hex), nunca del cliente; `acceso_perfil` resuelve rol por `indices/cuentasPorEmail` (motorizado → voluntario → centro → donante); `buscar_familiar` exige sesión, mínimo 4 caracteres, devuelve máximo 25 con solo `nombre`, `estado`, `verificada`, `actualizado` y `cedulaCoincide: boolean` (la cédula solo se compara por igualdad exacta, nunca se devuelve); la UI de "Buscar familiar" pide iniciar sesión antes de buscar (patrón de referencia: resultados con estado, Saturn Calendar `https://mobbin.com/screens/0e8a7a73-af4e-4395-96c4-e1d6722342e8`). El contacto con un transportista pasa por la acción `contactar_motorizado` (`auth: 'user'`) que devuelve `telefono`; el botón de WhatsApp en la tarjeta pública abre el acceso si no hay sesión.

- [ ] **Step 1..3:** reglas comunes.

### Task 3.3: Vacantes de voluntariado

**Acciones:** `admin_crear_vacante`, `admin_actualizar_vacante`, `admin_listar_vacantes`. Proyección `vacantesPublicas` sin `telefono` (`tieneContacto: true` y acción `contactar_vacante` con sesión).

**Invariantes:** `cantidadCubierta` se actualiza en transacción y nunca supera `cantidadNecesaria`; al alcanzarla `estado = 'Cubierta'` y se retira de la proyección; `check` de `urgencia` y `lugarTipo` iguales al catálogo.

- [ ] **Step 1..3:** reglas comunes.

### Task 3.4: Facturas, donaciones, presupuestos, ofertas y seguimiento

**Acciones:** `donar_necesidad`, `donar_dinero`, `listar_presupuestos`, `listar_comprados`, `ofrecer_insumo`, `listar_ofertas`, `reserva_detalle`, `recoger_oferta`, `admin_crear_factura`, `admin_crear_presupuesto`, `admin_presupuestos_por_comprar`, `admin_donaciones_presupuesto`, `admin_donacion_anular`, `admin_presupuesto_transferido`, `admin_presupuesto_comprado`, `admin_listar_facturas`, `admin_registrar_donacion`, `admin_registrar_movimiento`, `admin_registrar_evidencia`, `admin_cerrar_factura`.

**Modelo:** `facturas/{facturaId}` con **`tipo: 'dinero' | 'especie' | 'oferta' | 'presupuesto'`** y `moneda` explícitos (el legado lo codificaba en `descripcion` JSON: se conservan los campos `meta` del catálogo pero el discriminador es `tipo`), `estado` validado contra la máquina de estados del catálogo, `montoRequerido`, `montoRecaudado`, `viajeVigenteId`; subcolecciones `donaciones`, `movimientos`, `evidencias`; índices de unicidad `indices/facturasPorToken/{token}` y `indices/facturasAbiertasPorObjetivo/{objetivoNorm}`; contador en `config/contadores`. Proyección `facturasPublicas/{tokenPublico}` con `factura`, `movimientos[]`, `evidencias[]` (solo `publica`), `donacionesPublicas[]` (`montoUsd`, `monto`, `tasa`, `creado`), y `presupuestosPublicos/{token}` / `ofertasPublicas/{token}` (vista pública con coordenadas redondeadas a 2 decimales).

**Invariantes:** `montoRecaudado` = suma de donaciones `Confirmada` no archivadas, recalculado en la misma transacción (no hay trigger); una sola factura `Abierta` por objetivo (índice); `donar_dinero` decide `PorComprar` en la transacción y emite `metaCubierta` una sola vez; `admin_donacion_anular` es idempotente (`Registrada|Confirmada` → `Anulada`, segunda vez 409); todas las transiciones de estado verifican el estado previo; `registrarEntrega` (desde `panel_insumo`) cierra la factura de necesidad al cubrirla; `tasas/actual` obligatoria para `donar_dinero` (error `tasa de cambio no disponible, intenta más tarde`).

- [ ] **Step 1..3:** reglas comunes. Prueba de integración obligatoria: donar → seguimiento por token muestra `porcentaje` correcto → panel confirma recepción → factura `Cerrada` y movimiento `necesidadCubierta`.

### Task 3.5: Transporte: trayectos, apoyo a motorizados, viajes y entregas

**Acciones:** `registrar_trayecto`, `donar_motorizado`, `viaje_iniciar`, `registrar_recogida`, `registrar_entrega_final`, `admin_viajes_atrasados`, `admin_viaje_resolver`.

**Modelo:** `viajes/{viajeId}` con `facturaId`, `authUid`, `email` enmascarado, `etaMinutos`, `paso1/2/3` (`ts`, `lat`, `lng`), `kmTramo1/2`, `resuelto`; `facturas.viajeVigenteId` garantiza **un solo viaje abierto por factura** (transacción); `trayectos`, `donacionesMotorizados` con proyecciones públicas sin PII; `viajesAtrasados` calculado por `onSchedule('every 15 minutes')` (Blaze) **y** también en `admin_viajes_atrasados` al vuelo para el emulador.

**Invariantes:** reserva viva = `paso1.ts + eta + 60 min`; solo el dueño (`authUid`) avanza pasos; GPS validado con `geoValida`; km con `kmEntre`; evidencias fotográficas como `path` de Storage categoría `evidencias`.

- [ ] **Step 1..3:** reglas comunes.

### Task 3.6: Familias damnificadas y denuncias

**Acciones:** `damnificado_registrar` (honeypot `web` → responde `{ codigo: 'FAM-000000', ok: true }` sin escribir), `admin_damnificados`, `admin_damnificado_estado`, `denuncia_parcial`, `denuncia_crear`, `denuncias_listar` (**`auth: 'user'`**), `admin_denuncias`, `admin_denuncia_estado`, `admin_denuncia_crear`.

**Modelo:** `familiasDamnificadas/{id}` (PII privada; fotos `path` categoría `registro`), proyección `familiasPublicas` con edades en rangos y `necesidadMedica` booleana; `denuncias/{id}` con `videoPath` (subida directa progresiva con `uploadPrivateFile` categoría `denuncias`, `denuncia_parcial` solo registra progreso), GPS exacto privado y **redondeado a 2 decimales** en cualquier respuesta no admin; URLs firmadas de video con TTL de 120 s.

- [ ] **Step 1..3:** reglas comunes.

### Task 3.7: Consola de datos del admin y bitácora

**Acciones:** `admin_datos_entidades`, `admin_datos_listar`, `admin_datos_ficha`, `admin_datos_crear`, `admin_datos_editar`, `admin_datos_duplicados`, `admin_datos_deshacer`, `admin_datos_borrar`, `admin_bitacora`.

**Invariantes:** portar la lista blanca `ENTIDADES` del catálogo (tablas → colecciones, columnas editables, tipos, opciones, naturales, hijos y modo de borrado); la ficha nunca devuelve `authUid`, hashes ni tokens; `deshacer` restaura `antes` desde `auditoriaAdmin`; `duplicados` compara `nombreNorm`/`emailNorm`/dígitos de teléfono sobre índices, no sobre 2000 filas en memoria; toda mutación auditada; búsqueda escapa `%`/`_` (ya no aplica ilike: usar `nombreNorm` prefijo + filtro en memoria de ≤ 500 documentos).

- [ ] **Step 1..3:** reglas comunes.

### Task 3.8: Integraciones: tasa de cambio y Telegram

**Files:** Create `functions/src/jobs/tasa.ts` (`onSchedule('every day 03:00', { timeZone: 'America/Caracas' })` → Remitly y respaldo BCV con el rango plausible 200–5000 del catálogo, escribe `tasas/actual` y `tasas/historial/{fecha}`), acción `admin_actualizar_tasa` (manual), `functions/src/integraciones/telegram.ts` con `defineSecret('TELEGRAM_BOT_TOKEN')` y `defineString('TELEGRAM_CHAT_ID')`, timeout 5 s, fail-soft.

- [ ] **Step 1:** Pruebas con `fetch` mockeado: parseo de Remitly, caída a BCV, rechazo fuera de rango, Telegram apagado sin secreto.
- [ ] **Step 2:** Implementar. Commit `feat: exchange rate job and telegram notifier`.

---

## Fase 4 — Rediseño visual (Mobbin como referencia, tokens Stripe como sistema)

Referencias verificadas en Mobbin el 2026-09-06 (abrir cada enlace antes de diseñar la pantalla):

| Patrón | Referencia | URL |
|---|---|---|
| Página de campaña con anillo de progreso, "recaudado de meta", CTA y últimas donaciones | GoFundMe fundraiser | https://mobbin.com/screens/3de2c128-9dc0-4cac-ad72-baa2abbf1e79 |
| Flujo completo donar → monto → datos → confirmación → compartir | GoFundMe "Donating to a fundraiser" | https://mobbin.com/flows/9969bfa1-1bb2-422a-b3be-20b69d8f3b05 |
| Página de recaudación con barra y "ends in" | PayPal fundraiser | https://mobbin.com/screens/bd03eebd-7132-448b-af4b-0925e0e1dd61 |
| Flujo de donación con montos preestablecidos + "Other" | PayPal "Donating money" | https://mobbin.com/flows/de773c9f-bdcd-4154-92fd-1749c7e0789a |
| Chips de monto + campo libre (móvil) | PayPal Giving Fund | https://mobbin.com/screens/57ab589c-2ecc-4303-8ab4-f563d0b8816b |
| Monto grande centrado + teclado + presets | Venmo donate | https://mobbin.com/screens/ecde4a56-c5f2-4d79-9f88-0c3a9407cf86 |
| Lista + mapa con filtros laterales y tarjetas con insignias | Care.com | https://mobbin.com/screens/afcc8806-e6e4-4b52-9044-82cb224472c5 |
| Buscador de tiendas: chips de servicios, lista a la izquierda, mapa a la derecha, "X km" | Walmart store finder | https://mobbin.com/screens/eab12fba-a6c7-487d-bc3c-57e7e3b07788 |
| Grid de tarjetas + mapa con precios/etiquetas en pines | Airbnb | https://mobbin.com/screens/4b9d614f-7f68-47bb-83e6-7fd35efca097 |
| Línea de tiempo vertical: completado / actual / pendiente | Hers | https://mobbin.com/screens/86231ec9-1c2b-4255-bfe0-8f30a3c32e4d |
| Checklist de pasos con fechas y CTA por paso | Gusto | https://mobbin.com/screens/afd1032f-ef50-460f-88fb-c1e6970ab079 |
| Confirmación con número de pedido + "next steps" | adidas | https://mobbin.com/screens/f1d7b8e3-a099-45a6-8678-31dd14fd9371 |
| Tarjetas grandes de una sola acción, color por categoría | IKEA Home smart | https://mobbin.com/screens/f4815e58-241b-4d0b-85f7-f23edfc96e77 |
| Lista de metas con barra de progreso y monto/objetivo | Monarch | https://mobbin.com/screens/b0d5032e-b6ac-43a3-8ddb-0ba3540c95e4 |
| Resultados de búsqueda de personas con estado | Saturn Calendar | https://mobbin.com/screens/0e8a7a73-af4e-4395-96c4-e1d6722342e8 |

Regla de oro: **ningún hex nuevo**; solo tokens de `css/app.css :root` (ampliados en 4.1). Todo verificado a 390 px y 1440 px sin scroll horizontal, con `prefers-reduced-motion`, contraste AA y objetivos táctiles ≥ 44 px.

### Task 4.1: Sistema base: tokens, limpieza y estados

**Files:** Modify `css/app.css`, `locales/es.json`, `locales/en.json`, `DESIGN.md`; Create `js/ui-estados.js` (helpers `renderSkeleton(n)`, `renderVacio(clave)`, `renderError(clave, reintentar)`, `renderOffline(fecha)`), `tests/ui/ui-estados.test.js` (jsdom no disponible: probar como funciones puras que devuelven HTML escapado con `e()`).

- [ ] **Step 1:** Tokens: `--text-xs .75rem`, `--text-sm .875rem`, `--text-base 1rem`, `--text-lg 1.125rem`, `--text-xl 1.375rem`, `--text-2xl 1.75rem`, `--text-3xl 2.25rem`; pesos `--w-regular 450`, `--w-medium 600`, `--w-bold 750`; espaciado `--space-1 4px` … `--space-8 48px`; `--shadow-sm`; promover a tokens los hex repetidos (`#52657A` → `--muted-2`, `#F8FAFC` → `--surface-tint`, `#E6EDF5` → `--border-tint`, `#8F2342` → `--danger-ink-2`, `#0B6B4A` → `--success-ink-2`) y sustituir todas sus ocurrencias. `--muted` vuelve a `#6B7C93` como dice `DESIGN.md` (o se actualiza el doc; una sola verdad).
- [ ] **Step 2:** Borrar el CSS muerto (~330 líneas: `.top-nav`/`.bottom-nav` viejos, `.hero*`, `.route-line/.map-pin`, `.ops-*`, `.stats-grid/.stat-*`, `.dashboard-*`, `.help-grid/.urgent-*`, `.place-card`, `.pill-*`, `.driver-photo-*`, `.offer-review*`, `.fam-seccion*`) y las 136 claves i18n huérfanas (`nav`, `dashboard`, `help`, `map`, `urgent`, `lugar`, `hero.*` salvo `hero.title`, `status.live|loading|error`). Confirmar con `grep -rn "<clase>" index.html ventana.html js/` antes de borrar cada bloque.
- [ ] **Step 3:** Tres primitivas de tarjeta (`.card`, `.card--interactive`, `.card--accent[data-accent=volunteer|rescue|critical]`) y un solo `.progress[--value]`; `.segmented .chip-btn[aria-pressed]` como único control segmentado; estilos para `.trip-stage*` y `.is-active` de chips ETA y de tipo de denuncia (hoy sin CSS).
- [ ] **Step 4:** Estados: cada grid usa `renderSkeleton` al cargar, `renderVacio` sin datos, `renderError` con botón "Reintentar" cuando `source === 'error'`, y una franja `renderOffline` cuando `source === 'offline-cache'` (banner global distingue los dos casos: `status.offlineBanner` nuevo). Eliminar `registrosMockDonaciones` y todo dato inventado.
- [ ] **Step 5:** Toast: `#toast-root` con `role="status" aria-live="polite"` permanente, cola de mensajes, botón cerrar, versión funcional en `ventana.html`. Foco: al cambiar de vista mover el foco al `h1/h2` de la vista (`tabindex="-1"`) con anillo visible; en `ventana.html` enfocar el primer encabezado del diálogo.
- [ ] **Step 6:** Subir `?v=`, `npm.cmd run build`, `python scripts/verificar-idioma.py` OK, revisión visual 390/1440. Commit `feat(ui): design tokens, dead css cleanup and unified states`.

### Task 4.2: Inicio de cuatro puertas y navegación

**Referencias:** IKEA Home smart, komoot (tarjetas de acción), `docs/rediseno-ux.html` (maqueta aprobada de 4 puertas).

- [ ] **Step 1:** `index.html` `#view-inicio`: cuatro puertas (`Necesito ayuda`, `Quiero ayudar`, `Soy transportista`, `Soy centro o equipo`); "Soy damnificado" pasa a ser la primera opción dentro de `Necesito ayuda`; "Registrarme o entrar" va al header (`#btn-sesion`) y "Donar a una necesidad" dentro de `Quiero ayudar`. Enlaces secundarios (guía, denuncias, seguimiento, admin) en un pie `.home-foot` de una sola línea. La `.pwa-card` sale del inicio y se convierte en una franja de una línea bajo el header solo cuando hay cola pendiente o la app no está instalada.
- [ ] **Step 2:** Navegación real: barra inferior en móvil (`Inicio`, `Centros`, `Necesidades`, `Seguimiento`, `Cuenta`) y superior desde 1024 px, reutilizando las claves `nav.*` (restaurar solo las 5 necesarias) y `aria-current`. Recuperar el gutter inferior fantasma (92 px) cuando la barra no está.
- [ ] **Step 3:** Verificar que el inicio cabe en una pantalla de 390×844 sin scroll, con 4 objetivos táctiles ≥ 88 px de alto. Commit `feat(ui): four-door home and app navigation`.

### Task 4.3: Directorio de centros: lista + mapa

**Referencias:** Care.com, Walmart store finder, Airbnb.

- [ ] **Step 1:** Layout: en ≥ 1024 px, lista (60 %) + mapa fijo (40 %) a la derecha; en móvil, mapa como hoja inferior de 40 vh que se abre con "Ver mapa" y tarjetas encima. Filtros como chips (`Todos`, `Centros`, `Hospitales`, `Refugios`, `Cerca de mí`) + buscador; categoría de insumo en `details`.
- [ ] **Step 2:** Tarjeta de centro: nombre, tipo, distancia (`1,4 km`), `actualizado hace…`, hasta 3 chips de necesidades con urgencia (`Alta` en `--critical`), botón "Cómo llegar" y "Llamar"; ARIA: encabezado en `div` con un botón pequeño para expandir (`aria-controls`), no un `<button>` que envuelve todo.
- [ ] **Step 3:** Rendimiento: `debounce(220 ms)` en filtros de texto; Leaflet cargado bajo demanda (`import()` del script y hoja de estilo al abrir el mapa); pines con color por tipo y agrupación simple por proximidad; `preload` de `inter-var.woff2`.
- [ ] **Step 4:** Verificación 390/1440, teclado y lector de pantalla (NVDA o VoiceOver: la lista anuncia el conteo, no cada tarjeta). Commit `feat(ui): centers directory with list and map`.

### Task 4.4: Necesidad y presupuesto como página de campaña

**Referencias:** GoFundMe fundraiser, PayPal fundraiser, Monarch (lista de metas).

- [ ] **Step 1:** `#view-necesidades`: lista de necesidades como tarjetas con barra de progreso (`recaudado de meta`, `Bs` y `USD` con la tasa del día) y estado (`Abierta`, `Por comprar`, `Comprada`, `En camino`). Clic → `#necesidad/<token>` (nueva vista) con: título `insumo → centro`, anillo de progreso, meta/recaudado, CTA fija "Donar" (móvil: barra inferior), últimas 5 donaciones anónimas (`Anónimo · 20 USD · hace 2 h`), cotización adjunta (URL temporal), enlace de seguimiento.
- [ ] **Step 2:** Datos: `presupuestosPublicos`/`facturasPublicas` (Task 3.4). Estados de carga/vacío/error de 4.1. Commit `feat(ui): need campaign page`.

### Task 4.5: Donar dinero y confirmación compartible

**Referencias:** PayPal Giving Fund, Venmo, flujo GoFundMe (pantalla final "You donated $10 — share").

- [ ] **Step 1:** `#view-donar-dinero`: un solo paso con chips `10 · 25 · 50 · 100 USD` + "Otro monto", conversión en vivo a Bs con la tasa y nota de fuente/fecha, nombre opcional ("Donar como anónimo" marcado por defecto), comprobante con `uploadPrivateFile` (vista previa y progreso), botón "Confirmar donación".
- [ ] **Step 2:** Éxito: número de factura y token en tarjeta copiable (`navigator.clipboard`), botón "Compartir por WhatsApp" con el enlace `?token=`, "Ver seguimiento" y "Donar a otra necesidad". Sin token provisional confuso: si la acción fue encolada offline, mostrar "Pendiente de enviar" y explicar que el código llegará al reconectar.
- [ ] **Step 3:** Commit `feat(ui): money donation flow and shareable confirmation`.

### Task 4.6: Seguimiento por token como línea de tiempo

**Referencias:** Hers, Gusto, adidas.

- [ ] **Step 1:** `#view-seguimiento` queda solo con el formulario de token (autocompleta desde `?token=`), y el resultado como línea de tiempo vertical: `Factura creada` → `Donación recibida` → `Meta cubierta` → `Transferido` → `Comprado` → `En camino` → `Entregado` → `Cerrada`, con pasos completados (check), actual (resaltado) y pendientes (gris), montos y fechas relativas; evidencias públicas como miniaturas (URL temporal) y desglose de donaciones.
- [ ] **Step 2:** El "Centro de Donaciones Humanitarias" (16 paneles) se elimina; si el operador quiere un tablero, se hace después con `estadisticas/global` en una vista propia `#panorama` de 4 KPIs reales. Commit `feat(ui): token tracking timeline`.

### Task 4.7: Formularios largos por pasos agrupados

**Referencias:** patrón ya fijado en `docs/rediseno-admin-objetivo.md` (Glide/Retool stepper).

- [ ] **Step 1:** `js/wiz.js`: agrupar por `[data-wiz-step]` (voluntario: Identidad → Contacto → Disponibilidad → Cédula → Confirmar; transportista: Identidad → Vehículo → Fotos → Confirmar; centro: Centro → Ubicación → Responsable → Fotos → Confirmar; familia: Responsable → Hogar → Integrantes → Pérdidas → Fotos → Confirmar). Barra de progreso superior, "Atrás/Siguiente", validación por paso con foco en el primer error **visible**, paso final de resumen, éxito accionable (token/copiable, "Registrar otro").
- [ ] **Step 2:** Fotos: `uploadPrivateFile` con compresión a ≤ 1600 px en cliente (canvas) y vista previa; nunca base64 en el JSON.
- [ ] **Step 3:** Commit `feat(ui): grouped step wizards for long forms`.

### Task 4.8: Flujo del transportista y denuncias

- [ ] **Step 1:** `#view-viaje`: stepper `En camino → Recogido → Entregado` con estilos reales (`.trip-stage*`), chips ETA con `aria-pressed`, mapa lazy, botones grandes con estado de envío; confirmación con km y evidencia.
- [ ] **Step 2:** Denuncias: chips de tipo con `aria-pressed`, grabación con indicador de tiempo y subida progresiva a Storage; lista privada solo con sesión.
- [ ] **Step 3:** Commit `feat(ui): transporter trip and reports flows`.

### Task 4.9: Accesibilidad, rendimiento y PWA

- [ ] **Step 1:** Objetivos táctiles: `.modal-close`, `details.match summary`, `.chip-add`, `.insumo-del`, `.language-control` ≥ 44 px; `tablist` de acceso corregido (`aria-selected`, `role=tabpanel`) o reemplazado por segmentado; `label for` en el panel; `aria-controls` en tarjetas colapsables; `#toast-root` y `#modal-root` con `aria-live`.
- [ ] **Step 2:** Scripts con `defer`; `admin*.js` solo en `ventana.html?v=admin` (extraer `init/cargarTodo/bindForms/bindFiltros` de `js/admin.js` a `js/app-init.js`); `sw.js` precache dividido en shell crítico y capa perezosa; badge de cola offline en el header, visible en modo instalado, con "Reintentar ahora" y aviso cuando se descarta un envío.
- [ ] **Step 3:** Medir con Lighthouse móvil (Chrome DevTools) antes y después; objetivo LCP < 2,5 s en 4G lento y CLS < 0,1. Anotar cifras en el commit. Commit `feat(ui): accessibility, performance and offline badge`.

### Task 4.10: Consola admin coherente

- [ ] **Step 1:** Sustituir emoji por el sprite SVG del sitio; aplicar tarjetas/botones de 4.1; asistentes por pasos según `docs/rediseno-admin-objetivo.md` (12 reglas de aceptación); listados con estados de 4.1; auditoría visible (`admin_bitacora`) con filtro por entidad.
- [ ] **Step 2:** Commit `feat(ui): admin console visual consistency`.

---

## Fase 5 — Corte, limpieza y documentación

### Task 5.1: Corte a Firebase (gates G0–G3)

- [ ] **Step 1 (G0):** Confirmación del operador de Blaze + alertas. Sin esto no seguir.
- [ ] **Step 2 (G1):** Desplegar reglas/índices/TTL; verificar en consola que los índices estén `READY`.
- [ ] **Step 3:** `npx.cmd firebase deploy --only functions --project donaciones-venezuela-4fc29` con `API_ALLOWED_ORIGINS`, `STORAGE_BUCKET`, `APP_CHECK_MODE=log-only`, secretos de Telegram (`firebase functions:secrets:set`). Probar `health` y `api` (`accion: 'no_existe'`) desde `curl` con `Origin` de producción.
- [ ] **Step 4 (G2):** Bootstrap del admin; probar `admin_listar_necesidades` desde la UI en `npm.cmd run preview` apuntando a remoto (`.env.production.local`).
- [ ] **Step 5 (G3):** `vercel.json`: `buildCommand: npm run build`, `outputDirectory: dist`, CSP `connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://firebasestorage.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com`, `frame-src https://donaciones-venezuela-4fc29.firebaseapp.com` (solo si se usa un proveedor OAuth), `img-src` + `https://firebasestorage.googleapis.com https://storage.googleapis.com`; quitar `*.supabase.co`. Variables `VITE_*` y `VITE_API_BASE` en Vercel. Publicar y verificar los flujos principales en producción con datos reales cargados por el operador.
- [ ] **Step 6:** `APP_CHECK_MODE=enforced` tras 48 h sin rechazos en logs.

### Task 5.2: Retirar Supabase y cerrar documentación

- [ ] **Step 1:** Borrar `services/api.js`, `supabase/` (mover `supabase/functions/api/index.ts` y las migraciones a `docs/reference/legado-supabase/` como historia), `scripts/export-supabase*.mjs`, `scripts/verify-supabase-export.mjs`, `scripts/semilla-pruebas.sql`, `scripts/verificar-v0*.mjs`, `scripts/verificar-admin-datos.mjs`, `js/entorno.js` (o dejarlo solo para `firebaseConfig`), `.env.example` con placeholders; `grep -rni supabase --exclude-dir=node_modules --exclude-dir=docs .` debe devolver cero resultados.
- [ ] **Step 2:** Reescribir `CLAUDE.md`, `README.md`, `README-ARQUITECTURA.md`, `STACK.md`, `FIRESTORE_SCHEMA.md` (estado real), `DESIGN.md` (tokens nuevos), `tasks.md` (todo `completada`) y crear `MIGRATION_REPORT.md` con la evidencia de `npm.cmd run verify`.
- [ ] **Step 3:** Commit `chore: remove supabase and finalize firebase docs`.

---

## Anexo A — Orden de ejecución y estimación

| Orden | Tarea | Depende de | Tamaño |
|---|---|---|---|
| 1 | 0.1 | — | S |
| 2 | 0.2, 0.3, 0.4, 0.6 | 0.1 | M |
| 3 | 0.5 | 0.2 | M |
| 4 | 1.1, 1.2, 1.3 | 0.2, 0.4 | M |
| 5 | 2.1, 2.2, 2.3, 2.4 | 1.x | L |
| 6 | 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 | 2.x | XL (cada una M/L) |
| 7 | 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7 → 4.8 → 4.9 → 4.10 | 4.1 depende solo de 2.2; las demás del dominio que muestran | L |
| 8 | 5.1, 5.2 | todo | M |

Las tareas de la fase 4 que no dependen de datos nuevos (4.1, 4.2, 4.9) pueden intercalarse después de 2.2 para que la app se vea bien desde el primer corte.

## Anexo B — Qué NO hacer

- No abrir reglas de Firestore para escritura desde el cliente "para avanzar rápido".
- No copiar `descripcion` JSON como discriminador de tipo de factura: usar `tipo`.
- No devolver `telefono`, `placa`, `cedula`, `email`, `observaciones` ni GPS exacto en ninguna proyección.
- No reintroducir `accessToken`/`adminKey`/`token+pin` en los payloads: la identidad viene del ID token.
- No desplegar, activar Blaze, crear proyectos ni cargar datos remotos sin el gate correspondiente confirmado en el chat.

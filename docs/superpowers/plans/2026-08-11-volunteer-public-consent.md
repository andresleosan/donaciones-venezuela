# Volunteer Public Consent Firebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar consentimiento opt-in y publicacion atomica de perfiles de voluntarios en Firebase sin exponer datos privados ni permitir activacion administrativa.

**Architecture:** Una Function HTTP autenticada verifica ownership, rol y version de consentimiento antes de ejecutar una transaccion Admin SDK. La transaccion actualiza el bloque privado `publicProfileConsent`, crea o elimina `voluntariosPublicos/{id}` con una allowlist v1 sin foto y registra auditoria minima; las reglas Firestore permiten solo lectura publica acotada y niegan escrituras. La UI, `services/api.js` y el resto de perfiles personales quedan fuera.

**Tech Stack:** Firebase Admin SDK `14.2.0`, Firebase Functions v2 `7.3.2`, Firebase Web SDK `12.16.0`, Firestore Security Rules v2, Emulator Suite, TypeScript estricto, Vitest `4.1.10`, Node.js 20+ en raiz y Node.js 22 en Functions.

## Global Constraints

- Proyecto Firebase: `donaciones-venezuela-4fc29`.
- Proyecto de pruebas: `demo-donaciones-venezuela`.
- La base comienza vacia; no se migran ni inventan usuarios, datos, tokens, PINs, hashes o credenciales heredadas.
- Solo un voluntario autenticado puede activar consentimiento de su propio perfil.
- `panel` y `admin` pueden revocar, pero nunca activar consentimiento en nombre del voluntario.
- La proyeccion v1 contiene solo `nombre`, `zona`, `habilidades`, `activo` y `createdAt`.
- `fotoPublicaPath`, email, telefono, `authUid`, documentos, ubicacion precisa y tokens no se publican.
- Las escrituras cliente sobre `voluntarios`, `voluntariosPublicos` y `auditoriaAdmin` permanecen denegadas.
- Las lecturas publicas usan limite maximo de 50; `list` sin limite o sobre 50 falla.
- Los errores no incluyen tokens, PII, secretos, claims completos, paths privados ni detalles del SDK.
- No se modifican `services/api.js`, `window.SheetsService` ni la UI legacy.
- No se habilitan rescatistas, motorizados, fotos, Storage, rate limiting distribuido, App Check, Blaze, deploy, staging, produccion ni perfiles reales.
- No se modifica la fila T08 de `tasks.md`, porque T08 representa el conjunto amplio de 65 acciones.
- Cada tarea termina con pruebas propias, revision del diff y un commit reversible.

## File Map

- Modify: `functions/src/public-projections.ts:1-71` - agregar sanitizer v1 sin foto para perfiles de voluntarios.
- Modify: `firebase/firestore.rules:1-25` - abrir solo lectura publica acotada para `voluntariosPublicos`.
- Modify: `firebase/firestore.indexes.json:1-25` - agregar indice de estado y fecha para perfiles publicos.
- Create: `tests/contracts/volunteer-public-profile.test.ts` - allowlist v1, denylist recursiva y ausencia de foto/PII.
- Create: `tests/rules/volunteer-public.rules.test.ts` - reglas de lectura, limite, escritura y acceso privado.
- Create: `functions/src/volunteers/public-consent.ts` - tipos, validacion, autorizacion y construccion pura de cambios.
- Create: `functions/src/volunteers/public-consent-http.ts` - handler POST seguro y adaptador transaccional Admin SDK.
- Modify: `functions/src/index.ts:1-20` - exportar `setVolunteerPublicConsent` en `us-east1`.
- Create: `tests/functions/public-consent.test.ts` - contrato de validacion, roles, respuestas y errores.
- Create: `tests/functions/public-consent-http.test.ts` - handler HTTP con servicio transaccional inyectado.
- Create: `tests/emulators/volunteer-consent.integration.test.ts` - Auth, Firestore y Function Emulator de activacion/revocacion.
- Create: `docs/runbooks/volunteer-public-consent.md` - operacion local, revocacion y rollback.
- Modify: `docs/superpowers/plans/2026-08-11-volunteer-public-consent.md` - marcar checks solo con evidencia real.

---

### Task 1: Allowlist v1, reglas e indices de voluntarios

**Files:**
- Modify: `functions/src/public-projections.ts:1-71`
- Modify: `firebase/firestore.rules:1-25`
- Modify: `firebase/firestore.indexes.json:1-25`
- Create: `tests/contracts/volunteer-public-profile.test.ts`
- Create: `tests/rules/volunteer-public.rules.test.ts`

**Interfaces:**
- Consumes: `findForbiddenPublicFields`, las reglas actuales de `lugaresPublicos`/`vacantesPublicas` y el proyecto demo.
- Produces: `sanitizeVolunteerPublicProfile(source)`, `VOLUNTEER_PUBLIC_PROFILE_FIELDS`, reglas publicas para `voluntariosPublicos` y fixtures de perfil sintetico.

- [ ] **Step 1: Write the failing contract and rules tests**

Crear `tests/contracts/volunteer-public-profile.test.ts` con esta expectativa de allowlist:

```ts
it('publica solo la allowlist v1 y omite foto y PII', () => {
  expect(sanitizeVolunteerPublicProfile({
    nombre: 'Ana Demo',
    zona: 'Este',
    habilidades: ['salud'],
    activo: true,
    createdAt: '2026-08-11T12:00:00.000Z',
    fotoPublicaPath: 'private/voluntarios/v1/foto.jpg',
    email: 'ana@example.test',
    telefono: '000',
    authUid: 'uid-privado',
    documento: 'V-1',
  })).toEqual({
    nombre: 'Ana Demo',
    zona: 'Este',
    habilidades: ['salud'],
    activo: true,
    createdAt: '2026-08-11T12:00:00.000Z',
  });
});

it('rechaza PII anidada dentro de habilidades', () => {
  expect(() => sanitizeVolunteerPublicProfile({
    nombre: 'Ana Demo',
    zona: 'Este',
    habilidades: [{ etiqueta: 'salud', telefono: '000' }],
    activo: true,
    createdAt: '2026-08-11T12:00:00.000Z',
  })).toThrow('forbidden-public-fields');
});
```

Crear `tests/rules/volunteer-public.rules.test.ts` con `initializeTestEnvironment`, reglas desde `firebase/firestore.rules`, `assertSucceeds`, `assertFails`, `collection`, `doc`, `getDoc`, `getDocs`, `limit`, `query` y `setDoc`. Sembrar `voluntariosPublicos/volunteer-1`, `voluntarios/volunteer-1` y `auditoriaAdmin/audit-1` mediante `withSecurityRulesDisabled`. Cubrir:

```ts
it('permite get/list publico con limite 50', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'voluntariosPublicos/volunteer-1')));
  await assertSucceeds(getDocs(query(
    collection(db, 'voluntariosPublicos'),
    limit(50),
  )));
  await assertFails(getDocs(query(collection(db, 'voluntariosPublicos'))));
  await assertFails(getDocs(query(
    collection(db, 'voluntariosPublicos'),
    limit(51),
  )));
});

it.each(['anonymous', 'user', 'panel', 'admin'])('deniega escritura publica a %s', async (role) => {
  const db = role === 'anonymous'
    ? testEnv.unauthenticatedContext().firestore()
    : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
  await assertFails(setDoc(
    doc(db, 'voluntariosPublicos/new'),
    { nombre: 'No permitido' },
  ));
});

it('deniega lectura directa del perfil privado y auditoria', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'voluntarios/volunteer-1')));
  await assertFails(getDoc(doc(db, 'auditoriaAdmin/audit-1')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/contracts/volunteer-public-profile.test.ts tests/rules/volunteer-public.rules.test.ts`

Expected: FAIL por los imports del sanitizer v1 y porque `voluntariosPublicos` todavia queda deny-by-default.

- [ ] **Step 3: Write minimal projection, rules and index implementation**

En `functions/src/public-projections.ts` agregar:

```ts
export const VOLUNTEER_PUBLIC_PROFILE_FIELDS = [
  'nombre', 'zona', 'habilidades', 'activo', 'createdAt',
] as const;

export function sanitizeVolunteerPublicProfile(source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = {};
  for (const field of VOLUNTEER_PUBLIC_PROFILE_FIELDS) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  const forbidden = findForbiddenPublicFields(result);
  if (forbidden.length) {
    throw new Error(`forbidden-public-fields:${forbidden.join(',')}`);
  }
  return result;
}
```

Mantener `sanitizePublicProjection` existente sin cambiar las otras proyecciones; la funcion nueva es la barrera explicita de v1 sin foto.

Agregar antes del fallback deny-by-default en `firebase/firestore.rules`:

```text
match /voluntariosPublicos/{id} {
  allow get: if true;
  allow list: if request.query.limit != null && request.query.limit <= 50;
  allow write: if false;
}
```

Agregar al indice existente:

```json
{
  "collectionGroup": "voluntariosPublicos",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "activo", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd run test:rules`

Expected: pasan las reglas existentes y las nuevas pruebas de perfil publico, limite, escritura denegada, privado denegado y auditoria cerrada.

- [ ] **Step 5: Commit**

```bash
git add functions/src/public-projections.ts firebase/firestore.rules firebase/firestore.indexes.json tests/contracts/volunteer-public-profile.test.ts tests/rules/volunteer-public.rules.test.ts
git commit -m "feat: prepare volunteer public projection v1"
```

### Task 2: Servicio transaccional de consentimiento

**Files:**
- Create: `functions/src/volunteers/public-consent.ts`
- Create: `tests/functions/public-consent.test.ts`

**Interfaces:**
- Consumes: `AuthContext`, `sanitizeVolunteerPublicProfile` y un perfil privado con `authUid`/`activo`.
- Produces: `VOLUNTEER_PUBLIC_CONSENT_VERSION`, `ConsentRequest`, `parseConsentRequest(body)`, `assertConsentPermission(context, profile, enabled)` y `buildConsentMutation(input, profile, timestamps)`.

- [ ] **Step 1: Write the failing unit tests**

Crear pruebas para estas firmas y resultados:

```ts
it('acepta el body exacto de activacion', () => {
  expect(parseConsentRequest({
    volunteerId: 'volunteer-1',
    enabled: true,
    consentVersion: 'volunteer-public-v1',
  })).toEqual({
    volunteerId: 'volunteer-1',
    enabled: true,
    consentVersion: 'volunteer-public-v1',
  });
});

it.each([
  null,
  {},
  { volunteerId: '', enabled: true, consentVersion: 'volunteer-public-v1' },
  { volunteerId: 'v1', enabled: 'true', consentVersion: 'volunteer-public-v1' },
])('rechaza body invalido: %j', (body) => {
  expect(() => parseConsentRequest(body)).toThrow('invalid-input');
});

it('rechaza una version de consentimiento desconocida con codigo especifico', () => {
  expect(() => parseConsentRequest({
    volunteerId: 'v1', enabled: true, consentVersion: 'v2',
  })).toThrow('invalid-consent-version');
});

it('solo permite activar al titular user de un perfil activo', () => {
  expect(() => assertConsentPermission(
    { uid: 'uid-1', role: 'user' },
    { authUid: 'uid-1', activo: true },
    true,
  )).not.toThrow();
  expect(() => assertConsentPermission(
    { uid: 'admin-1', role: 'admin' },
    { authUid: 'uid-1', activo: true },
    true,
  )).toThrow('forbidden');
});

it('permite revocar al titular, panel y admin, pero no a otro user', () => {
  const profile = { authUid: 'uid-1', activo: true };
  expect(() => assertConsentPermission({ uid: 'uid-1', role: 'user' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'panel-1', role: 'panel' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'admin-1', role: 'admin' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'other-1', role: 'user' }, profile, false)).toThrow('forbidden');
});

it('construye activacion sin foto y revocacion separada', () => {
  const profile = {
    authUid: 'uid-1',
    activo: true,
    nombre: 'Ana Demo',
    zona: 'Este',
    habilidades: ['salud'],
    createdAt: 'created-at',
    fotoPath: 'private/foto.jpg',
  };
  expect(buildConsentMutation(
    { volunteerId: 'v1', enabled: true, consentVersion: 'volunteer-public-v1' },
    profile,
    { now: 'now', actorUid: 'uid-1' },
  )).toMatchObject({
    enabled: true,
    publicDocument: {
      nombre: 'Ana Demo', zona: 'Este', habilidades: ['salud'],
      activo: true, createdAt: 'created-at',
    },
  });
  expect(buildConsentMutation(
    { volunteerId: 'v1', enabled: false, consentVersion: 'volunteer-public-v1' },
    profile,
    { now: 'now', actorUid: 'admin-1' },
  )).toMatchObject({ enabled: false, publicDocument: null });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/functions/public-consent.test.ts`

Expected: FAIL porque `functions/src/volunteers/public-consent.ts` no existe.

- [ ] **Step 3: Write minimal service implementation**

Implementar:

```ts
export const VOLUNTEER_PUBLIC_CONSENT_VERSION = 'volunteer-public-v1' as const;
export type ConsentRequest = {
  volunteerId: string;
  enabled: boolean;
  consentVersion: typeof VOLUNTEER_PUBLIC_CONSENT_VERSION;
};
```

`parseConsentRequest` debe rechazar valores no objeto, propiedades faltantes, `volunteerId` vacio, `enabled` no boolean y version distinta. `assertConsentPermission` debe lanzar `Error('forbidden')` para ownership/rol invalidos y `Error('volunteer-not-active')` al activar un perfil inactivo.

`buildConsentMutation` debe devolver un objeto serializable con `enabled`, `privatePatch`, `publicDocument` y `audit`. En activacion, `publicDocument` sale exclusivamente de `sanitizeVolunteerPublicProfile`; en revocacion es `null`. El audit contiene solo `actorUid`, `accion`, `entidad`, `entidadId`, `resultado` y `createdAt`.

El `privatePatch` exacto debe preservar la trazabilidad existente:

```text
activacion:
  enabled: true
  version: volunteer-public-v1
  consentedAt: now
  consentedByUid: actorUid
  revokedAt: previous.revokedAt o null
  revokedByUid: previous.revokedByUid o null

revocacion:
  enabled: false
  version: volunteer-public-v1
  consentedAt: previous.consentedAt o null
  consentedByUid: previous.consentedByUid o null
  revokedAt: now
  revokedByUid: actorUid
```

Una repeticion de la misma operacion conserva un unico documento publico y
devuelve exito; puede registrar un evento de auditoria separado por solicitud.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/functions/public-consent.test.ts`

Expected: pasan validacion, ownership, roles, perfil inactivo, allowlist sin foto y mutaciones de activacion/revocacion.

- [ ] **Step 5: Commit**

```bash
git add functions/src/volunteers/public-consent.ts tests/functions/public-consent.test.ts
git commit -m "feat: validate volunteer public consent"
```

### Task 3: Function HTTP y transaccion Admin SDK

**Files:**
- Create: `functions/src/volunteers/public-consent-http.ts`
- Modify: `functions/src/index.ts:1-20`
- Create: `tests/functions/public-consent-http.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest`, `parseConsentRequest`, `assertConsentPermission`, `buildConsentMutation` y Firestore Admin SDK.
- Produces: `setVolunteerPublicConsent` en `us-east1`; `setVolunteerPublicConsentHandler(req, res, applyConsent?)` con respuestas seguras.

- [ ] **Step 1: Write the failing HTTP tests**

Crear response fake y probar:

```ts
it('rechaza metodos distintos de POST', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler({ method: 'GET' }, res, vi.fn());

  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('POST');
});

it('devuelve exito minimo al activar', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    { method: 'POST', body: { volunteerId: 'v1', enabled: true, consentVersion: 'volunteer-public-v1' } },
    res,
    async () => ({ success: true, enabled: true, volunteerId: 'v1' }),
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true, enabled: true, volunteerId: 'v1' });
  expect(JSON.stringify(result.body)).not.toMatch(/email|telefono|authUid|token|claim/i);
});

it('normaliza errores desconocidos', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    {
      method: 'POST',
      body: { volunteerId: 'v1', enabled: true, consentVersion: 'volunteer-public-v1' },
    },
    res,
    async () => { throw new Error('private@example.test firestore path'); },
  );

  expect(result.status).toBe(500);
  expect(result.body).toEqual({ error: { code: 'internal', message: 'Internal error' } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/functions/public-consent-http.test.ts`

Expected: FAIL porque el handler no existe.

- [ ] **Step 3: Write minimal HTTP and transaction implementation**

Implementar `setVolunteerPublicConsentHandler` con estas decisiones:

- Solo acepta POST y establece `Allow: POST` en otros metodos.
- Usa `authenticateRequest` para el Bearer token.
- Convierte errores de autenticacion en `{ error: { code, message } }` sin detalles.
- Delega la operacion a `applyConsent` inyectable para tests.
- Devuelve solo `{ success, enabled, volunteerId }`.
- Errores `invalid-input`, `forbidden`, `volunteer-not-found`,
  `volunteer-not-active` e `invalid-consent-version` conservan esos codigos y
  mensajes publicos estables.
- Errores desconocidos devuelven 500 con `{ code: 'internal', message: 'Internal error' }`.

`applyConsent` debe inicializar `getFirestore()` y ejecutar `runTransaction`. Dentro de la transaccion:

1. Leer `voluntarios/{volunteerId}`.
2. Si no existe, lanzar `volunteer-not-found`.
3. Aplicar `assertConsentPermission` y construir `buildConsentMutation`.
4. Actualizar solo `publicProfileConsent` en el perfil privado.
5. En activacion, `transaction.set(voluntariosPublicos/{id}, publicDocument)`; en revocacion, `transaction.delete` de la proyeccion.
6. Crear `auditoriaAdmin/{eventId}` con el audit minimo y un ID generado por Admin SDK.

En `functions/src/index.ts` agregar:

```ts
import { setVolunteerPublicConsentHandler } from './volunteers/public-consent-http.js';

export const setVolunteerPublicConsent = onRequest(
  { cors: false, region: 'us-east1' },
  setVolunteerPublicConsentHandler,
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/functions/public-consent.test.ts tests/functions/public-consent-http.test.ts`

Expected: pasan contrato HTTP, respuestas seguras, autenticacion, errores y transaccion inyectada.

- [ ] **Step 5: Commit**

```bash
git add functions/src/volunteers/public-consent-http.ts functions/src/index.ts tests/functions/public-consent-http.test.ts
git commit -m "feat: publish volunteer consent transaction"
```

### Task 4: Integracion Emulator, runbook y cierre

**Files:**
- Create: `tests/emulators/volunteer-consent.integration.test.ts`
- Create: `docs/runbooks/volunteer-public-consent.md`
- Modify: `package.json:18-21` - incluir la prueba en los comandos de Functions/Emulator existentes.
- Modify: `docs/superpowers/plans/2026-08-11-volunteer-public-consent.md` - marcar checks con evidencia real.

**Interfaces:**
- Consumes: `setVolunteerPublicConsent`, Auth Emulator, Firestore Emulator y reglas de Task 1.
- Produces: evidencia de activacion/revocacion atomica, auditoria privada y rollback local.

- [x] **Step 1: Write the failing integration test**

Crear `tests/emulators/volunteer-consent.integration.test.ts` que:

1. Inicialice una app Firebase sintetica conectada a Auth Emulator.
2. Cree un usuario titular con email `volunteer-<uuid>@example.test` y password `Password-1234!`.
3. Cree un usuario panel y un usuario admin en Auth Emulator; use Admin SDK local para asignar claims `role: 'panel'` y `role: 'admin'`.
4. Siembre `voluntarios/volunteer-1` con `authUid` del titular, `activo: true`, campos publicos sinteticos, `email`, `telefono` y `fotoPath` privados usando contexto de reglas deshabilitadas.
5. Llame HTTP a `http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/setVolunteerPublicConsent` con el ID token del titular y body de activacion.
6. Verifique status 200, proyeccion publica con exactamente cinco campos y ausencia de foto/PII.
7. Llame revocacion con el token admin; verifique status 200, ausencia de proyeccion, perfil privado intacto y auditoria no legible por el cliente.
8. Verifique que panel/admin no pueden activar y otro usuario no puede revocar el perfil.
9. En `afterEach`, ejecute `signOut`, `deleteUser` y `deleteApp` en cleanup anidado que preserve el primer error.

El test debe usar solamente `demo-donaciones-venezuela`, URLs localhost, fixtures sintéticos y emuladores. No ejecutar el endpoint contra `donaciones-venezuela-4fc29`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix functions run build` y luego `npx vitest run tests/emulators/volunteer-consent.integration.test.ts`

Expected: el test enfocado falla sin emuladores o porque la Function aun no esta cableada; no se considera evidencia funcional hasta ejecutar el comando con Emulator Suite.

- [x] **Step 3: Write the runbook and wire test commands**

Crear `docs/runbooks/volunteer-public-consent.md` con estas instrucciones:

```text
Proyecto de pruebas: demo-donaciones-venezuela
Comando local: npm.cmd run test:emulators
Accion: setVolunteerPublicConsent
Version: volunteer-public-v1
Datos permitidos: fixtures sinteticos en Emulator Suite
Datos prohibidos: perfiles reales, PII, fotos, tokens y seeds remotos
Rollback: revertir Function/reglas; conservar perfil privado y auditoria
Produccion: bloqueada hasta textos legales, rate limiting/App Check y revision operativa
```

Actualizar `test:functions:run` para incluir `tests/emulators/volunteer-consent.integration.test.ts` y `test:functions` para iniciar `auth,firestore,functions` si la prueba requiere Firestore; conservar health y Auth existentes. No crear un script paralelo que omita la suite existente.

- [x] **Step 4: Run focused and full verification**

Run, en este orden:

```bash
npm.cmd run test:unit
npm.cmd run test:functions
npm.cmd run test:emulators
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

Expected: todas las pruebas pasan, las auditorias no reportan `high`/`critical`, el build pasa y el idioma queda verificado. Las vulnerabilidades `moderate`, Node host distinto del engine o warnings legacy se documentan como observaciones actuales.

- [x] **Step 5: Perform security review and commit**

Confirmar en el diff:

```text
solo voluntariosPublicos se abre adicionalmente;
voluntarios, auditoriaAdmin y todas las colecciones privadas siguen cerradas;
solo el titular puede activar consentimiento;
panel/admin solo pueden revocar;
foto, email, telefono, authUid, documentos y tokens nunca salen en la proyeccion;
la transaccion no tiene escrituras parciales;
services/api.js y UI no cambiaron;
no hubo deploy, Blaze, seeds remotos ni perfiles reales;
```

Ejecutar `git diff --check`, revisar `git status` y crear el commit:

```bash
git add tests/emulators/volunteer-consent.integration.test.ts docs/runbooks/volunteer-public-consent.md package.json docs/superpowers/plans/2026-08-11-volunteer-public-consent.md
git commit -m "test: verify volunteer public consent flow"
```

## Self-Review: Spec Coverage

Task 1 cubre allowlist v1 sin foto, reglas publicas, limite 50, escritura denegada, privado/auditoria cerrados e indices. Task 2 cubre body, version, ownership, roles, perfil activo, idempotencia y mutacion pura. Task 3 cubre handler POST, errores seguros, Admin transaction, auditoria y export Function. Task 4 cubre Auth/Firestore/Functions Emulator, cleanup, runbook, wiring y gates de seguridad.

Quedan fuera deliberadamente rescatistas, motorizados, fotos, Storage, rate limiting distribuido, App Check, textos legales de produccion, UI, `services/api.js`, datos reales, deploy y T08 completo.

No hay apartados incompletos ni tipos ambiguos: la version, endpoint, body, codigos, campos publicos, roles y firmas estan definidos literalmente.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-volunteer-public-consent.md`. Two execution options:

1. **Subagent-Driven (recommended):** dispatch a fresh subagent per task, review each result and rerun tests before accepting it.
2. **Inline Execution:** execute tasks in this session with checkpoints after each task.

# Firebase Foundation y Auth Greenfield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar una frontera de identidad Firebase verificable en Emulator Suite: Auth email/password, sesion cliente, roles seguros y bootstrap controlado del primer administrador.

**Architecture:** El cliente conserva `src/firebase/index.js` como superficie publica y usa Firebase Auth modular para registrar, iniciar/cerrar sesion, observar cambios y leer claims. Functions concentra la verificacion del ID token y la autorizacion en `functions/src/auth/`, y expone solo `authSession` como endpoint autenticado de prueba del contrato. El primer admin se provisiona mediante un script local controlado que usa Admin SDK; no existe una ruta HTTP publica para otorgar roles.

**Tech Stack:** Firebase Web SDK `12.16.0`, Firebase Admin SDK `14.2.0`, Cloud Functions v2, TypeScript estricto, Vitest `4.1.10`, Firebase Emulator Suite, Node.js 20+ en raiz y Node.js 22 en Functions.

## Global Constraints

- Proyecto Firebase de desarrollo: `donaciones-venezuela-4fc29`.
- Proyecto de pruebas: `demo-donaciones-venezuela`.
- La base comienza vacia; no se migran ni inventan usuarios, datos, tokens, PINs, hashes o credenciales heredadas.
- El codigo Supabase se conserva como referencia hasta validar cada dominio, pero este subproyecto no modifica aun `services/api.js`.
- Toda accion privilegiada futura debe pasar por Functions; los clientes no escriben claims ni colecciones privadas directamente.
- Nunca se habilita una ruta publica para otorgar roles; el bootstrap exige confirmacion local `BOOTSTRAP_ADMIN_APPROVED=YES` y un UID explicito.
- Los errores de autenticacion no incluyen tokens, PII, secretos, claims completos, cuerpos externos ni detalles de verificacion.
- No se habilitan produccion, staging, Blaze, despliegues ni escrituras remotas sin checkpoint explicito del operador.
- Las reglas de Firestore y Storage permanecen deny-by-default durante este subproyecto.
- Cada tarea termina con pruebas propias, revision del diff y un commit reversible.

## File Map

- Modify: `src/firebase/firebase-auth.js` - ampliar la superficie cliente de sesion sin cambiar los contratos existentes de `signIn`, `register`, `signOut`, `observeAuth` y `getIdToken`.
- Modify: `src/firebase/index.js` - exportar los nuevos helpers cliente.
- Create: `tests/firebase/firebase-auth.test.js` - pruebas unitarias mockeadas de persistencia, sesion y claims.
- Create: `functions/src/auth/authorization.ts` - extraccion segura de Bearer token, verificacion Admin SDK, contexto de auth y autorizacion por rol.
- Create: `functions/src/auth/session.ts` - handler HTTP GET que devuelve solamente `uid` y rol ya verificados.
- Modify: `functions/src/index.ts` - exportar `authSession` con la misma region que `health`.
- Create: `tests/functions/authorization.test.ts` - pruebas de headers, token, rol por defecto, rol invalido y errores seguros.
- Create: `tests/functions/auth-session.test.ts` - contrato HTTP del handler autenticado.
- Create: `functions/src/auth/bootstrap-admin.ts` - funcion pura de provisionamiento de claim admin sobre una dependencia Admin SDK inyectada.
- Create: `functions/scripts/bootstrap-admin.mjs` - comando local con guardas de aprobacion y proyecto.
- Modify: `functions/package.json` - agregar el script explicito `bootstrap-admin` sin convertirlo en endpoint desplegable.
- Create: `tests/functions/bootstrap-admin.test.ts` - pruebas de merge de claims y validacion de UID.
- Create: `tests/emulators/auth.integration.test.ts` - registro, login, token y consumo de `authSession` con Auth y Functions Emulator.
- Create: `docs/runbooks/bootstrap-admin.md` - procedimiento operativo, precondiciones, rollback de codigo y prohibiciones.

---

### Task 1: Cliente Firebase Auth y contrato de sesion

**Files:**
- Modify: `src/firebase/firebase-auth.js:1-50`
- Modify: `src/firebase/index.js:1-4`
- Create: `tests/firebase/firebase-auth.test.js`

**Interfaces:**
- Consumes: `getFirebaseApp()` y el Auth modular existente.
- Produces: `getCurrentUser(): Promise<User | null>` y `getIdTokenResult(forceRefresh = false): Promise<IdTokenResult | null>`, ademas de los exports existentes sin cambios de firma.

- [ ] **Step 1: Write the failing test**

Crear `tests/firebase/firebase-auth.test.js` con mocks de `firebase/auth` y de `firebase-config.js`. Cubrir el contrato minimo:

```js
it('devuelve el usuario actual y sus claims', async () => {
  const user = {
    uid: 'user-1',
    getIdTokenResult: vi.fn(async () => ({
      token: 'token-1',
      claims: { role: 'panel' },
    })),
  };
  authMocks.getAuth.mockReturnValue({ currentUser: user });

  expect(await getCurrentUser()).toBe(user);
  expect(await getIdTokenResult()).toEqual({
    token: 'token-1',
    claims: { role: 'panel' },
  });
});

it('devuelve null cuando no hay sesion', async () => {
  authMocks.getAuth.mockReturnValue({ currentUser: null });

  expect(await getCurrentUser()).toBeNull();
  expect(await getIdTokenResult()).toBeNull();
  expect(await getIdToken()).toBeNull();
});

it('rechaza persistencia desconocida antes de tocar Auth', async () => {
  await expect(configureAuthPersistence('persistente')).rejects.toThrow(
    'Persistencia Firebase no soportada: persistente',
  );
  expect(authMocks.setPersistence).not.toHaveBeenCalled();
});

it('observa cambios de sesion y devuelve el unsubscribe de Firebase', async () => {
  const unsubscribe = vi.fn();
  const callback = vi.fn();
  authMocks.onAuthStateChanged.mockReturnValue(unsubscribe);

  await expect(observeAuth(callback)).resolves.toBe(unsubscribe);
  expect(authMocks.onAuthStateChanged).toHaveBeenCalledWith(
    expect.anything(),
    callback,
    undefined,
  );
});
```

El archivo debe importar los helpers desde `../../src/firebase/firebase-auth.js` despues de declarar los mocks hoisted, siguiendo el patron de `tests/firebase/firebase-storage.test.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/firebase/firebase-auth.test.js`

Expected: FAIL porque `getCurrentUser` y `getIdTokenResult` aun no estan exportados.

- [ ] **Step 3: Write minimal implementation**

En `src/firebase/firebase-auth.js`, agregar despues de `getIdToken`:

```js
export async function getCurrentUser() {
  return (await getFirebaseAuth()).currentUser;
}

export async function getIdTokenResult(forceRefresh = false) {
  const user = await getCurrentUser();
  return user ? user.getIdTokenResult(forceRefresh) : null;
}
```

En `src/firebase/index.js`, exportar ambos nombres junto a `getIdToken`. No alterar el comportamiento de `register`, `signIn`, `signOut` ni `observeAuth`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/firebase/firebase-auth.test.js tests/firebase/firebase-storage.test.js`

Expected: todos los tests pasan y no aparece una URL persistente en el resultado de Auth.

- [ ] **Step 5: Commit**

```bash
git add src/firebase/firebase-auth.js src/firebase/index.js tests/firebase/firebase-auth.test.js
git commit -m "feat: expose firebase auth session helpers"
```

### Task 2: Frontera de verificacion y autorizacion

**Files:**
- Create: `functions/src/auth/authorization.ts`
- Create: `tests/functions/authorization.test.ts`

**Interfaces:**
- Consumes: una request con `headers.authorization` o `get('authorization')` y un verificador `verifyIdToken(token)`.
- Produces: `AuthContext`, `authenticateRequest(request, verifyIdToken?)`, `requireRole(context, allowedRoles)` y `AuthError` con `code` y `status` seguros.

- [ ] **Step 1: Write the failing test**

Crear pruebas con un verificador inyectado para que la unidad no dependa de credenciales reales:

```ts
it('extrae Bearer, verifica el token y usa user como rol por defecto', async () => {
  const verifyIdToken = vi.fn(async (token: string) => ({ uid: 'user-1', token }));

  await expect(authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    verifyIdToken,
  )).resolves.toEqual({ uid: 'user-1', role: 'user' });
  expect(verifyIdToken).toHaveBeenCalledWith('id-token');
});

it('rechaza header ausente o esquema distinto con 401 seguro', async () => {
  await expect(authenticateRequest({ headers: {} }, vi.fn()))
    .rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  await expect(authenticateRequest(
    { headers: { authorization: 'Basic abc' } },
    vi.fn(),
  )).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
});

it('no eleva un claim de rol desconocido', async () => {
  const context = await authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    async () => ({ uid: 'user-1', role: 'owner' }),
  );

  expect(context).toEqual({ uid: 'user-1', role: 'user' });
  expect(() => requireRole(context, ['admin']))
    .toThrowError(expect.objectContaining({ code: 'forbidden', status: 403 }));
});

it.each([
  ['user', ['user'], ['admin']],
  ['panel', ['panel', 'user'], ['admin']],
  ['admin', ['admin', 'panel'], ['user']],
] as const)('autoriza el rol %s solo en permisos declarados', (role, allowedRoles, deniedRoles) => {
  expect(() => requireRole({ uid: 'user-1', role }, allowedRoles)).not.toThrow();
  expect(() => requireRole({ uid: 'user-1', role }, deniedRoles)).toThrow();
});

it('no filtra el error real del verificador', async () => {
  await expect(authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    async () => { throw new Error('token secreto interno'); },
  )).rejects.toMatchObject({
    code: 'unauthenticated',
    status: 401,
    message: 'Authentication required',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/functions/authorization.test.ts`

Expected: FAIL porque `functions/src/auth/authorization.ts` no existe.

- [ ] **Step 3: Write minimal implementation**

Implementar estas decisiones exactas:

```ts
export type Role = 'user' | 'panel' | 'admin';
export type AuthContext = { uid: string; role: Role };

export class AuthError extends Error {
  constructor(
    public readonly code: 'unauthenticated' | 'forbidden',
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}
```

`authenticateRequest` debe aceptar exactamente el prefijo `Bearer `, rechazar token vacio, requerir un `uid` string no vacio, convertir cualquier claim `role` distinto de `user`, `panel` o `admin` a `user`, y transformar cualquier fallo de verificacion en `AuthError('unauthenticated', 401, 'Authentication required')`. El verificador por defecto debe llamar a `getAuth().verifyIdToken(token)` desde `firebase-admin/auth`.

`requireRole` debe lanzar `AuthError('forbidden', 403, 'Forbidden')` si el rol del contexto no pertenece a la lista permitida. No devolver ni registrar el objeto completo del token.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/functions/authorization.test.ts`

Expected: todos los casos de headers, rol por defecto, rol invalido y filtrado de errores pasan.

- [ ] **Step 5: Commit**

```bash
git add functions/src/auth/authorization.ts tests/functions/authorization.test.ts
git commit -m "feat: add firebase token authorization boundary"
```

### Task 3: Endpoint autenticado de sesion

**Files:**
- Create: `functions/src/auth/session.ts`
- Modify: `functions/src/index.ts:1-7`
- Create: `tests/functions/auth-session.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest` y una request HTTP.
- Produces: `authSession` desplegable en region `us-east1`; para GET autenticado devuelve `{ uid, role }`, para fallos devuelve `{ error: { code, message } }` sin detalles internos.

- [ ] **Step 1: Write the failing test**

Crear un response fake y cubrir el contrato:

```ts
it('devuelve solo uid y rol para una sesion autenticada', async () => {
  const { res, result } = createResponse();
  await authSessionHandler(
    { method: 'GET', headers: {} },
    res,
    async () => ({ uid: 'user-1', role: 'panel' }),
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ uid: 'user-1', role: 'panel' });
  expect(JSON.stringify(result.body)).not.toMatch(/token|email|secret|claim/i);
});

it('responde 401 sin revelar el error de verificacion', async () => {
  const { res, result } = createResponse();
  await authSessionHandler(
    { method: 'GET', headers: {} },
    res,
    async () => { throw new AuthError('unauthenticated', 401, 'Authentication required'); },
  );

  expect(result.status).toBe(401);
  expect(result.body).toEqual({
    error: { code: 'unauthenticated', message: 'Authentication required' },
  });
});

it('rechaza metodos diferentes de GET', async () => {
  const { res, result } = createResponse();
  await authSessionHandler({ method: 'POST', headers: {} }, res, vi.fn());

  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('GET');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/functions/auth-session.test.ts`

Expected: FAIL porque el handler no existe.

- [ ] **Step 3: Write minimal implementation**

Implementar `authSessionHandler` como funcion async. Para metodo distinto de GET, establecer `Allow: GET` y devolver 405. Para GET, llamar al autenticador inyectado, responder 200 con solo `{ uid, role }`, y capturar `AuthError` para devolver su codigo y mensaje. Cualquier error no reconocido debe devolver 401 con `unauthenticated` y `Authentication required`.

En `functions/src/index.ts` agregar:

```ts
import { authSessionHandler } from './auth/session.js';

export const authSession = onRequest(
  { cors: false, region: 'us-east1' },
  authSessionHandler,
);
```

No crear una exportacion `bootstrapAdmin` en este archivo.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/functions/authorization.test.ts tests/functions/auth-session.test.ts`

Expected: pasan las pruebas de autorizacion y del contrato HTTP.

- [ ] **Step 5: Commit**

```bash
git add functions/src/auth/session.ts functions/src/index.ts tests/functions/auth-session.test.ts
git commit -m "feat: expose authenticated session function"
```

### Task 4: Bootstrap administrativo controlado

**Files:**
- Create: `functions/src/auth/bootstrap-admin.ts`
- Create: `functions/scripts/bootstrap-admin.mjs`
- Modify: `functions/package.json:9-12`
- Create: `tests/functions/bootstrap-admin.test.ts`
- Create: `docs/runbooks/bootstrap-admin.md`

**Interfaces:**
- Consumes: UID existente de Firebase Auth y una dependencia Admin SDK con `getUser` y `setCustomUserClaims`.
- Produces: `bootstrapAdmin(uid, auth): Promise<{ uid: string; role: 'admin' }>`; el script local solo ejecuta con `FIREBASE_PROJECT_ID` permitido, `BOOTSTRAP_ADMIN_UID` y `BOOTSTRAP_ADMIN_APPROVED=YES`.

- [ ] **Step 1: Write the failing test**

Crear pruebas con un Admin Auth fake:

```ts
it('conserva claims existentes y agrega role admin', async () => {
  const auth = {
    getUser: vi.fn(async () => ({ customClaims: { tenant: 'demo' } })),
    setCustomUserClaims: vi.fn(async () => undefined),
  };

  await expect(bootstrapAdmin('admin-uid', auth)).resolves.toEqual({
    uid: 'admin-uid',
    role: 'admin',
  });
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith('admin-uid', {
    tenant: 'demo',
    role: 'admin',
  });
});

it('rechaza UID vacio sin escribir claims', async () => {
  const auth = {
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  };

  await expect(bootstrapAdmin('   ', auth)).rejects.toThrow('UID de administrador requerido');
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/functions/bootstrap-admin.test.ts`

Expected: FAIL porque el modulo de bootstrap no existe.

- [ ] **Step 3: Write minimal implementation**

Implementar `bootstrapAdmin` para recortar y validar el UID, llamar primero a `getUser`, combinar `customClaims` existentes y sobrescribir unicamente `role: 'admin'`, y devolver `{ uid, role: 'admin' }`. Si `getUser` falla, propagar un error seguro para el script sin escribir claims.

Crear `functions/scripts/bootstrap-admin.mjs` con estas guardas antes de importar o ejecutar Admin SDK:

```js
const projectId = process.env.FIREBASE_PROJECT_ID;
const uid = process.env.BOOTSTRAP_ADMIN_UID;
if (!['demo-donaciones-venezuela', 'donaciones-venezuela-4fc29'].includes(projectId)) {
  throw new Error('FIREBASE_PROJECT_ID no permitido para bootstrap');
}
if (process.env.BOOTSTRAP_ADMIN_APPROVED !== 'YES') {
  throw new Error('Se requiere BOOTSTRAP_ADMIN_APPROVED=YES');
}
if (!uid?.trim()) throw new Error('BOOTSTRAP_ADMIN_UID requerido');
```

Despues de las guardas, inicializar `firebase-admin/app` con `projectId`, obtener `getAuth()`, importar `bootstrapAdmin` compilado y mostrar un resultado JSON que solo contenga `uid` y `role`. No imprimir credenciales ni el objeto usuario.

Agregar en `functions/package.json`:

```json
"bootstrap-admin": "npm run build && node scripts/bootstrap-admin.mjs"
```

El runbook debe documentar que el operador debe confirmar el proyecto, tener credenciales ADC locales, verificar que el UID ya pertenece al proyecto, ejecutar desde `functions/`, y validar el claim cerrando y abriendo sesion para obtener un token nuevo. Debe indicar que el rollback es retirar el claim admin mediante un procedimiento separado y revisado; no se ejecuta automaticamente.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/functions/bootstrap-admin.test.ts`

Expected: pasan merge de claims, validacion de UID y ausencia de escrituras en el caso invalido. No ejecutar el script contra ningun proyecto en esta tarea.

- [ ] **Step 5: Commit**

```bash
git add functions/src/auth/bootstrap-admin.ts functions/scripts/bootstrap-admin.mjs functions/package.json tests/functions/bootstrap-admin.test.ts docs/runbooks/bootstrap-admin.md
git commit -m "feat: add controlled admin bootstrap procedure"
```

### Task 5: Pruebas de integracion con Emulator Suite

**Files:**
- Create: `tests/emulators/auth.integration.test.ts`

**Interfaces:**
- Consumes: Auth Emulator en `127.0.0.1:9099` y Functions Emulator en `127.0.0.1:5001` del proyecto `demo-donaciones-venezuela`.
- Produces: evidencia de registro, login, obtencion de ID token, rechazo sin token y respuesta autenticada de `authSession`.

- [ ] **Step 1: Write the failing test**

Crear una app Firebase con nombre de instancia unico, configuracion sintetica del proyecto demo y `connectAuthEmulator`. Usar un correo con `crypto.randomUUID()` para evitar estado entre ejecuciones. El caso principal debe seguir esta secuencia:

```ts
const credential = await createUserWithEmailAndPassword(
  auth,
  `auth-${crypto.randomUUID()}@example.test`,
  'Password-1234!',
);
const token = await credential.user.getIdToken();
const response = await fetch('http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/authSession', {
  headers: { Authorization: `Bearer ${token}` },
});

expect(response.status).toBe(200);
expect(await response.json()).toEqual({ uid: credential.user.uid, role: 'user' });
```

Agregar un segundo caso que haga `fetch` sin `Authorization` y espere 401 con `{ error: { code: 'unauthenticated', message: 'Authentication required' } }`. En `afterEach`, borrar el usuario creado mediante `deleteUser`.

En el caso autenticado, cerrar la sesion con `signOut(auth)` y volver a iniciar con `signInWithEmailAndPassword` antes de pedir el ID token. Esto prueba registro, login y logout en el mismo flujo; el `finally` debe volver a ejecutar `signOut(auth)` y borrar el usuario mediante `deleteUser`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix functions run build` y luego `npx vitest run tests/emulators/auth.integration.test.ts`

Expected: FAIL o no conecta mientras no se levanten los emuladores y `authSession` no este compilada.

- [ ] **Step 3: Wire the emulator test into the existing command**

Confirmar que `tests/emulators/auth.integration.test.ts` queda incluido por `test:emulators:run` y que `test:functions:run` tambien lo cubre si se ejecuta con Functions Emulator. No agregar llamadas a proyectos remotos ni seeds persistentes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run test:emulators`

Expected: pasan reglas existentes, health y los casos de Auth/session con Auth, Firestore, Storage y Functions Emulator; el endpoint no expone email, token ni claims completos.

- [ ] **Step 5: Commit**

```bash
git add tests/emulators/auth.integration.test.ts
git commit -m "test: verify firebase auth session in emulators"
```

### Task 6: Verificacion del subproyecto y checkpoint de seguridad

**Files:**
- Modify: `tasks.md:11-12` - actualizar solamente `T04` (Auth, persistencia y sesion frontend) y `T05` (verificador de ID token y roles) despues de tener evidencia de todos los comandos.
- Modify: `docs/superpowers/plans/2026-08-07-firebase-foundation-auth.md` - marcar checks solo si este plan se ejecuta en esta misma rama.

**Interfaces:**
- Consumes: todos los artefactos y tests de Tasks 1-5.
- Produces: evidencia reproducible de que el subproyecto no abre reglas privadas, no filtra secretos y compila en raiz y Functions.

- [x] **Step 1: Run the focused test suite**

Run:

```bash
npm.cmd run test:unit
npm.cmd run test:functions
```

Expected: pasan tests unitarios, contrato de handlers y la integracion de Functions en Emulator Suite.

Evidence (2026-08-07, misma rama): `npm.cmd run test:unit` paso con 11 archivos y 172 tests. `npm.cmd run test:functions` paso despues de repetir un primer arranque transitorio fallido, con build de Functions y 23 tests en 6 archivos, incluida la integracion con Emulator Suite.

- [x] **Step 2: Run build, security and language checks**

Run:

```bash
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

Expected: build exitoso, ninguna vulnerabilidad `high` o `critical` nueva atribuible al subproyecto, y verificacion de idioma exitosa. Las vulnerabilidades moderadas preexistentes deben quedar reportadas, no ocultas.

Evidence (2026-08-07, misma rama): `npm.cmd run build` paso con advertencias preexistentes de scripts clasicos sin `type="module"` y assets `layers*.png`; `npm.cmd audit --audit-level=high` reporto 5 vulnerabilidades moderadas y ninguna high/critical; `npm.cmd --prefix functions audit --audit-level=high` reporto 7 moderadas y ninguna high/critical; `python scripts/verificar-idioma.py` devolvio `Idioma OK: 1499 claves paralelas en es/en, sin texto cableado en el JS.`

- [x] **Step 3: Perform the manual security review**

Verificar en el diff que:

```text
no existe una funcion HTTP que asigne role=admin;
no existe escritura de custom claims en el cliente;
authSession no devuelve email, token, claims completos ni errores de Admin SDK;
firestore.rules y storage.rules siguen deny-by-default;
el runbook no contiene credenciales, tokens ni UID real;
```

Si aparece un hallazgo critico de seguridad, detener el avance y corregirlo antes del siguiente dominio.

Evidence (2026-08-07, misma rama): `functions/src/index.ts` solo exporta `health` y `authSession`; no hay funcion HTTP que asigne `role=admin`; `setCustomUserClaims` no aparece en `src/`; `authSession` solo serializa `uid` y `role` y transforma errores a respuestas seguras; `firebase/firestore.rules` y `firebase/storage.rules` mantienen `allow read, write: if false`; `docs/runbooks/bootstrap-admin.md` no contiene credenciales, tokens ni UID real y usa `<UID_EXISTENTE>` como marcador.

- [x] **Step 4: Record evidence and commit**

Actualizar `T04` y `T05` en `tasks.md` solo con comandos realmente ejecutados y su resultado; no cambiar `T06` ni tareas posteriores. Revisar `git diff --check`, `git status` y el diff de los archivos de este plan. Crear el commit final:

```bash
git add tasks.md docs/superpowers/plans/2026-08-07-firebase-foundation-auth.md
git commit -m "docs: record firebase auth foundation verification"
```

Evidence (2026-08-07, misma rama): `git diff --check` no reporto errores de whitespace; `git status --short --branch` se reviso y se conservaron cambios no relacionados; el diff de este plan se limito a `tasks.md` y este archivo antes del commit.

## Self-Review: Scope Coverage

Este plan cubre del diseño aprobado: Auth email/password, persistencia y observacion de sesion, ID tokens, claims de rol, bootstrap controlado del primer admin, frontera Functions, errores seguros, pruebas unitarias, contrato HTTP, Emulator Suite y restricciones de no exposicion de PII.

Queda deliberadamente fuera y requiere planes separados: reglas de Firestore/Storage por coleccion, proyecciones publicas, lecturas base, los 23 dominios de negocio, transacciones financieras, Storage privado y URLs temporales, rate limits, auditoria de acciones administrativas, integraciones externas, sustitucion de `services/api.js`, seeds de dominio y limpieza final de Supabase. No se puede declarar completa la reconstruccion total al completar este plan.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-firebase-foundation-auth.md`. Two execution options:

1. **Subagent-Driven (recommended):** dispatch a fresh subagent per task, review each result and rerun the tests before accepting it.
2. **Inline Execution:** execute the tasks in this session with checkpoints after each task.

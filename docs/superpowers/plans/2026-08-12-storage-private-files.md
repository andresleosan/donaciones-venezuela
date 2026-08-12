# Storage privado, evidencias y URLs temporales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar Storage privado v1 con carga directa protegida por Rules, URLs temporales autorizadas por Functions y eliminación segura, sin tocar datos remotos ni la UI legacy.

**Architecture:** El cliente genera paths canónicos y carga directamente a Storage. Storage Rules valida autenticación, propiedad, categoría, MIME, tamaño y metadata; nunca permite lectura o borrado directo. Functions autentica el request, aplica la matriz de roles, verifica que el objeto siga marcado como privado y genera URLs firmadas de máximo 15 minutos o elimina el archivo autorizado.

**Tech Stack:** Firebase Storage Rules v2, Firebase Web modular SDK 12, Firebase Cloud Functions v2 `onRequest`, Firebase Admin Storage, TypeScript estricto, JavaScript vanilla, Vitest 4, Firebase Emulator Suite.

## Global Constraints

- Mantener Supabase como fuente productiva durante esta tarea.
- No desplegar Functions o Rules, no activar Blaze, no crear buckets remotos y no escribir datos remotos.
- Mantener privadas las categorías `receipts`, `needs` y `reports`.
- Ruta única: `private/{uid}/{category}/{fileId}.{extension}`.
- Tipos: `image/jpeg`, `image/png`, `image/webp` hasta 5 MiB; `application/pdf` hasta 10 MiB.
- `panel` puede acceder y eliminar `receipts` y `needs`, pero nunca `reports`.
- `admin` puede acceder y eliminar las tres categorías mediante Functions.
- El propietario autenticado puede acceder y eliminar sus propios archivos mediante Functions; la carga directa solo es válida en su propio UID.
- El cliente devuelve únicamente `{ path }`; no exportar `getDownloadURL` ni URLs persistentes.
- `timeCreated` de Storage es la fecha autoritativa; `createdAt` enviado por cliente nunca autoriza ni audita.
- Las Functions deben fallar cerradas y no registrar tokens, IPs, metadata sensible ni URLs completas.
- Todo código nuevo tendrá pruebas reales; la tarea no pasa a aprobada con fallos o hallazgos críticos.
- No modificar `services/api.js`, la UI legacy ni las proyecciones públicas.

---

### Task 1: Contrato privado y adaptador cliente

**Files:**
- Modify: `src/firebase/firebase-storage.js`
- Test: `tests/firebase/firebase-storage.test.js`

**Interfaces:**
- Produces `createPrivateFilePath(uid, category, fileId, extension): string`.
- Produces `uploadPrivateFile(uid, category, file, options?): Promise<{ path: string }>`.
- `uploadPrivateFile` genera `fileId` con `crypto.randomUUID()` cuando no recibe uno en `options.fileId`.
- `uploadPrivateFile` fija `contentType`, `cacheControl` privado y `customMetadata` con `ownerUid`, `category` y `visibility: 'private'`.

- [ ] **Step 1: Escribir las pruebas fallidas del contrato de path y tipos.**

Actualizar los tests existentes de `tests/firebase/firebase-storage.test.js` para
importar `uploadPrivateFile` en lugar de `uploadFile` y conservar la prueba de
ausencia de URL persistente. Agregar estos casos:

```js
import { expect, beforeEach, it, vi } from 'vitest';

const validPdf = { size: 10 * 1024 * 1024, type: 'application/pdf' };

it('construye un path privado canónico', async () => {
  const { createPrivateFilePath } = await import('../../src/firebase/firebase-storage.js');
  expect(createPrivateFilePath('uid-1', 'receipts', 'file-1', 'pdf'))
    .toBe('private/uid-1/receipts/file-1.pdf');
});

it.each([
  ['text/plain', 128, 'Tipo de archivo no permitido'],
  ['image/png', 5 * 1024 * 1024 + 1, 'El archivo excede el tamano permitido'],
  ['application/pdf', 10 * 1024 * 1024 + 1, 'El archivo excede el tamano permitido'],
])('rechaza archivo invalido %s', async (type, size, message) => {
  const { uploadPrivateFile } = await import('../../src/firebase/firebase-storage.js');
  await expect(uploadPrivateFile('uid-1', 'needs', { type, size }))
    .rejects.toThrow(message);
});

it('sube con metadata custom privada y devuelve solo el path', async () => {
  const { uploadPrivateFile } = await import('../../src/firebase/firebase-storage.js');
  storageMocks.uploadBytes.mockResolvedValue({
    ref: { fullPath: 'private/uid-1/receipts/file-1.pdf' },
  });

  const result = await uploadPrivateFile('uid-1', 'receipts', validPdf, { fileId: 'file-1' });

  expect(result).toEqual({ path: 'private/uid-1/receipts/file-1.pdf' });
  expect(storageMocks.uploadBytes).toHaveBeenCalledWith(
    expect.objectContaining({ fullPath: 'private/uid-1/receipts/file-1.pdf' }),
    validPdf,
    expect.objectContaining({
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, no-store',
      customMetadata: {
        ownerUid: 'uid-1',
        category: 'receipts',
        visibility: 'private',
      },
    }),
  );
  expect(result).not.toHaveProperty('url');
});
```

También comprobar que se rechazan UIDs vacíos, categorías fuera de `receipts`,
`needs`, `reports`, `fileId` con `/`, `..` o caracteres de control, y extensiones
que no coinciden con el MIME. Mantener el test existente que verifica que
`module.downloadUrl` es `undefined`.

- [ ] **Step 2: Ejecutar únicamente los tests del adaptador para confirmar el fallo.**

Run: `npm.cmd exec vitest run tests/firebase/firebase-storage.test.js`

Expected: FAIL porque todavía no existen `createPrivateFilePath` ni
`uploadPrivateFile` y el adaptador actual acepta un path arbitrario.

- [ ] **Step 3: Implementar el contrato mínimo en el adaptador.**

En `src/firebase/firebase-storage.js`:

1. Declarar las categorías y los límites como constantes exportadas.
2. Mapear MIME a extensiones exactas: `image/jpeg -> jpg`, `image/png -> png`,
   `image/webp -> webp`, `application/pdf -> pdf`.
3. Validar UID, categoría, `fileId` y extensión con allowlists; no usar
   `file.name` para formar la ruta.
4. Generar `fileId` con `crypto.randomUUID()` cuando no se entregue uno.
5. Pasar metadata custom anidada en `customMetadata`, no expandida en el objeto
   de opciones de `uploadBytes`.
6. Devolver solo `snapshot.ref.fullPath`.

La firma debe quedar así:

```js
export async function uploadPrivateFile(uid, category, file, options = {}) {
  validatePrivateIdentity(uid, category, file, options);
  const extension = MIME_EXTENSIONS[file.type];
  const fileId = options.fileId ?? crypto.randomUUID();
  const path = createPrivateFilePath(uid, category, fileId, extension);
  const snapshot = await uploadBytes(ref(await getFirebaseStorage(), path), file, {
    contentType: file.type,
    cacheControl: 'private, max-age=0, no-store',
    customMetadata: { ownerUid: uid, category, visibility: 'private' },
  });
  return { path: snapshot.ref.fullPath };
}
```

No mantener un alias que acepte paths arbitrarios: no hay consumidores de
`uploadFile` fuera de sus tests y el nuevo contrato elimina esa superficie.

- [ ] **Step 4: Ejecutar los tests del adaptador y el build del frontend.**

Run: `npm.cmd exec vitest run tests/firebase/firebase-storage.test.js`

Expected: PASS con todos los tests del adaptador.

Run: `npm.cmd run build`

Expected: `vite build` termina con código 0.

- [ ] **Step 5: Commitear el entregable del cliente.**

```text
git add src/firebase/firebase-storage.js tests/firebase/firebase-storage.test.js
git commit -m "feat: add private storage client contract"
```

### Task 2: Storage Rules privadas

**Files:**
- Modify: `firebase/storage.rules`
- Test: `tests/rules/storage.rules.test.ts`

**Interfaces:**
- Rules permite `create` y `update` únicamente para el propietario autenticado.
- Rules deniega siempre `read` y `delete` desde el cliente.
- La condición de escritura valida `request.resource.size`,
  `request.resource.contentType`, `request.resource.metadata.ownerUid`,
  `request.resource.metadata.category` y `request.resource.metadata.visibility`.

- [ ] **Step 1: Reemplazar el test deny-by-default por casos de contrato.**

Importar `assertSucceeds` y añadir helpers con rutas y metadata explícitas:

```ts
const owner = testEnv.authenticatedContext('owner-uid', { role: 'user' }).storage();
const other = testEnv.authenticatedContext('other-uid', { role: 'user' }).storage();

const metadata = (contentType: string, category: string) => ({
  contentType,
  customMetadata: {
    ownerUid: 'owner-uid',
    category,
    visibility: 'private',
  },
});

it('permite carga valida del propietario para las tres categorias', async () => {
  for (const [category, extension, contentType] of [
    ['receipts', 'pdf', 'application/pdf'],
    ['needs', 'png', 'image/png'],
    ['reports', 'webp', 'image/webp'],
  ] as const) {
    await assertSucceeds(uploadBytes(
      ref(owner, `private/owner-uid/${category}/file-1.${extension}`),
      new Uint8Array([1]),
      metadata(contentType, category),
    ));
  }
});

it('deniega lectura y borrado directo incluso al propietario', async () => {
  await assertFails(getBytes(ref(owner, 'private/owner-uid/receipts/file-1.pdf')));
  await assertFails(deleteObject(ref(owner, 'private/owner-uid/receipts/file-1.pdf')));
});
```

Agregar casos para anónimo, UID ajeno, categoría desconocida, MIME inválido,
extensión incoherente, metadata ausente, `visibility: 'public'`, tamaño de
imagen `5 * 1024 * 1024 + 1` y PDF `10 * 1024 * 1024 + 1`. Verificar que
`panel` y `admin` tampoco puedan escribir en espacios ajenos.

Conservar el `beforeAll` existente que crea un objeto sintético bajo
`private/pruebas/existing.txt` usando `withSecurityRulesDisabled`; ese objeto
solo sirve para probar que la lectura del cliente sigue cerrada y no representa
una categoría válida del contrato.

- [ ] **Step 2: Ejecutar los tests de Rules para confirmar que fallan con deny-all.**

Run: `npm.cmd run test:rules`

Expected: FAIL en los casos válidos porque las Rules actuales niegan toda
escritura.

- [ ] **Step 3: Implementar funciones y match de Storage Rules.**

Usar `match /private/{uid}/{category}/{fileName}` y estas funciones de Rules:

```text
function isOwner(uid) {
  return request.auth != null && request.auth.uid == uid;
}

function isCategory(category) {
  return category == 'receipts' || category == 'needs' || category == 'reports';
}

function hasPrivateMetadata(uid, category) {
  return request.resource.metadata.ownerUid == uid
    && request.resource.metadata.category == category
    && request.resource.metadata.visibility == 'private';
}

function isAllowedFile(fileName) {
  return fileName.matches('[A-Za-z0-9][A-Za-z0-9_-]*\\.(jpg|jpeg|png|webp|pdf)');
}

function isAllowedContent(fileName) {
  return (fileName.matches('[A-Za-z0-9][A-Za-z0-9_-]*\\.(jpg|jpeg|png|webp)')
      && request.resource.contentType in ['image/jpeg', 'image/png', 'image/webp']
      && request.resource.size <= 5 * 1024 * 1024)
    || (fileName.matches('[A-Za-z0-9][A-Za-z0-9_-]*\\.pdf')
      && request.resource.contentType == 'application/pdf'
      && request.resource.size <= 10 * 1024 * 1024);
}

allow read, delete: if false;
allow create, update: if isOwner(uid)
  && isCategory(category)
  && isAllowedFile(fileName)
  && isAllowedContent(fileName)
  && hasPrivateMetadata(uid, category);
```

La expresión acepta únicamente un segmento final alfanumérico con `-` y `_`,
seguido de una extensión allowlisted; no acepta `..`, segmentos adicionales ni
caracteres de control. Mantener el match global deny-by-default para cualquier
ruta fuera del contrato.

- [ ] **Step 4: Ejecutar Rules y revisar el texto compilado.**

Run: `npm.cmd run test:rules`

Expected: todos los casos válidos pasan y todos los accesos inválidos fallan.

Run: `git diff --check -- firebase/storage.rules tests/rules/storage.rules.test.ts`

Expected: sin errores de whitespace.

- [ ] **Step 5: Commitear Rules y pruebas.**

```text
git add firebase/storage.rules tests/rules/storage.rules.test.ts
git commit -m "feat: enforce private storage rules"
```

### Task 3: Autorización, URLs temporales y eliminación en Functions

**Files:**
- Modify: `functions/src/private-file-access.ts`
- Create: `functions/src/private-file-access-http.ts`
- Modify: `functions/src/index.ts`
- Create: `tests/functions/private-file-access.test.ts`

**Interfaces:**
- `validatePrivateStoragePath(path): PrivateFileDescriptor` devuelve `{ path, ownerUid, category, fileName, extension }`.
- `canAccessPrivateFile(context, descriptor): boolean` aplica propietario, `panel` y `admin`.
- `canDeletePrivateFile(context, descriptor): boolean` usa la misma matriz.
- `privateUrlExpiresAt(now): Date` suma exactamente `PRIVATE_URL_TTL_MS`.
- `getPrivateFileUrl` y `deletePrivateFile` se exportan desde `functions/src/index.ts` como Functions `onRequest` en `us-east1`.
- Ambos handlers reciben JSON `{ path: string }` mediante `POST` y nunca aceptan UID o rol del body.
- URL exitosa: `{ url: string, expiresAt: string }` con `expiresAt` ISO.
- `getPrivateFileUrlHandler(req, res, dependencies?): Promise<void>` y
  `deletePrivateFileHandler(req, res, dependencies?): Promise<void>` reciben un
  request HTTP con `method`, `body`, `headers` y `get`, y un response con
  `setHeader`, `status` y `json`.
- `PrivateFileDependencies` inyecta
  `authenticate(request): Promise<AuthContext>`,
  `getFile(path): PrivateStorageFile`,
  `rateLimiter('uid', uid, nowMs): Promise<RateLimitResult>`,
  `now(): Date`, `signReadUrl(file, expiresAt): Promise<string>` y
  `deleteFile(file): Promise<void>`.
- `PrivateStorageFile` expone `exists(): Promise<[boolean]>`,
  `getMetadata(): Promise<[{ metadata?: Record<string, string> }]>` y
  `getSignedUrl(options): Promise<[string]>` para el adaptador por defecto.

- [ ] **Step 1: Escribir pruebas unitarias del contrato de path y autorización.**

En `tests/functions/private-file-access.test.ts` cubrir:

```ts
import { expect, it } from 'vitest';
import {
  canAccessPrivateFile,
  canDeletePrivateFile,
  validatePrivateStoragePath,
} from '../../functions/src/private-file-access.js';

it('extrae propietario, categoria y extension del path canonico', () => {
  expect(validatePrivateStoragePath('private/owner-1/reports/evidence.pdf'))
    .toEqual({
      path: 'private/owner-1/reports/evidence.pdf',
      ownerUid: 'owner-1',
      category: 'reports',
      fileName: 'evidence.pdf',
      extension: 'pdf',
    });
});

it.each([
  'public/owner-1/needs/photo.png',
  'private/owner-1/unknown/photo.png',
  'private/owner-1/reports/../photo.png',
  'private/owner-1/reports/a/b.png',
  'private/owner-1/reports/.png',
])('rechaza path invalido %s', (path) => {
  expect(() => validatePrivateStoragePath(path)).toThrow('invalid-private-storage-path');
});

it('aplica la matriz de acceso', () => {
  const reports = validatePrivateStoragePath('private/owner-1/reports/evidence.pdf');
  const needs = validatePrivateStoragePath('private/owner-1/needs/photo.png');

  expect(canAccessPrivateFile({ uid: 'owner-1', role: 'user' }, reports)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, reports)).toBe(false);
  expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, needs)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'admin-1', role: 'admin' }, reports)).toBe(true);
  expect(canDeletePrivateFile({ uid: 'panel-1', role: 'panel' }, reports)).toBe(false);
});
```

Añadir pruebas de TTL exacto, UIDs vacíos, caracteres de control, `fileId` con
separadores y extensiones fuera de la allowlist.

- [ ] **Step 2: Ejecutar las pruebas unitarias nuevas para confirmar el fallo.**

Run: `npm.cmd exec vitest run tests/functions/private-file-access.test.ts`

Expected: FAIL porque el descriptor y la matriz todavía no están implementados.

- [ ] **Step 3: Implementar contrato y matriz de autorización.**

En `functions/src/private-file-access.ts`:

1. Usar una expresión estricta para `private/{uid}/{category}/{fileName}` y
   devolver cada segmento validado.
2. Permitir solamente categorías `receipts`, `needs`, `reports`.
3. Permitir extensiones `jpg`, `jpeg`, `png`, `webp`, `pdf`.
4. Hacer que propietario sea `context.uid === descriptor.ownerUid`.
5. Hacer que `admin` acceda a todo y `panel` solo a `receipts`/`needs`.
6. Mantener el TTL de 15 minutos como constante única.

- [ ] **Step 4: Escribir pruebas fallidas de los handlers HTTP.**

Usar dependencias inyectadas, sin Storage remoto:

```ts
const file = {
  exists: async () => [true] as [boolean],
  getMetadata: async () => [{ metadata: {
    ownerUid: 'owner-1', category: 'receipts', visibility: 'private',
  } }],
  getSignedUrl: async () => ['https://signed.example/temporary'] as [string],
  delete: async () => undefined,
};

const dependencies = {
  authenticate: async () => ({ uid: 'owner-1', role: 'user' as const }),
  getFile: () => file,
  consumeRateLimit: async () => ({ allowed: true as const, hits: 1, retryAfter: 0 as const }),
  now: () => new Date('2026-08-12T12:00:00.000Z'),
};

it('devuelve URL temporal sin filtrar metadata', async () => {
  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf'),
    res,
    dependencies,
  );
  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    url: 'https://signed.example/temporary',
    expiresAt: '2026-08-12T12:15:00.000Z',
  });
  expect(JSON.stringify(result.body)).not.toMatch(/ownerUid|visibility|token/i);
});

it('rechaza panel para reports antes de consultar Storage', async () => {
  const getFile = vi.fn(() => file);
  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/reports/evidence.pdf'),
    res,
    { ...dependencies, authenticate: async () => ({ uid: 'panel-1', role: 'panel' as const }), getFile },
  );
  expect(result.status).toBe(403);
  expect(getFile).not.toHaveBeenCalled();
});
```

Cubrir además método/content-type inválido, autenticación fallida, objeto
inexistente o metadata no privada (`404` estable), límite de URL (`429` con
`Retry-After`), `admin` en `reports`, eliminación autorizada y eliminación
ajena. El handler nunca debe poner el path completo en la respuesta de error.

- [ ] **Step 5: Implementar handlers HTTP con Storage Admin inyectable.**

En `functions/src/private-file-access-http.ts`:

1. Aceptar solo `POST` y `application/json`.
2. Autenticar con `authenticateRequest` antes de usar el body.
3. Parsear exactamente `{ path: string }` y validar con
   `validatePrivateStoragePath`.
4. Aplicar `canAccessPrivateFile` o `canDeletePrivateFile` antes de consultar
   Storage, evitando revelar existencia a usuarios sin permiso.
5. Consumir `consumeRateLimit('uid', context.uid, now.getTime())` antes de firmar.
6. Usar por defecto `getStorage().bucket().file(path)` desde
   `firebase-admin/storage`; inyectar `getFile`, `signReadUrl`, `deleteFile`,
   `authenticate`, `now` y `rateLimiter` en tests.
7. Comprobar existencia y metadata custom exacta: `ownerUid`, `category` y
   `visibility: 'private'`. Objeto ausente o no privado responde como
   `file-not-found` sin detalles.
8. Firmar con `{ action: 'read', expires: expiresAt }` y devolver solo URL y
   expiración ISO.
9. Para eliminar, comprobar autorización y metadata antes de `delete()` y
   responder `{ success: true }`.
10. Normalizar errores a `unauthenticated`, `forbidden`, `invalid-input`,
    `invalid-file-path`, `file-not-found`, `rate-limit-exceeded` e `internal`.

- [ ] **Step 6: Conectar las Functions exportadas y ejecutar tests.**

En `functions/src/index.ts` exportar:

```ts
export const getPrivateFileUrl = onRequest(
  { cors: false, region: 'us-east1' },
  getPrivateFileUrlHandler,
);

export const deletePrivateFile = onRequest(
  { cors: false, region: 'us-east1' },
  deletePrivateFileHandler,
);
```

Importar los handlers y compilar:

Run: `npm.cmd --prefix functions run build`

Expected: TypeScript termina con código 0.

Run: `npm.cmd exec vitest run tests/functions/private-file-access.test.ts`

Expected: todos los tests de autorización, errores, TTL y eliminación pasan.

- [ ] **Step 7: Commitear Functions.**

```text
git add functions/src/private-file-access.ts functions/src/private-file-access-http.ts functions/src/index.ts tests/functions/private-file-access.test.ts
git commit -m "feat: add authorized private file access"
```

### Task 4: Integración de Emulator Suite, verificación y estado de migración

**Files:**
- Create: `tests/emulators/storage.integration.test.ts`
- Modify: `tasks.md`

**Interfaces:**
- El test usa `initializeTestEnvironment` con Storage Emulator en `127.0.0.1:9199` y las Rules actuales.
- La integración de Functions usa handlers con dependencias inyectadas para no requerir credenciales remotas ni URLs firmadas reales.
- `tasks.md` cambia `T07` a `en curso` al iniciar esta tarea y a `revisión` solo después de toda la evidencia verde.

- [ ] **Step 1: Crear fixtures sintéticos y helpers de Storage Emulator.**

Configurar una app cliente con `connectAuthEmulator` y `connectStorageEmulator`,
crear usuarios `owner`, `other`, `panel` y `admin`, y usar rutas bajo:

```text
private/{owner.uid}/receipts/receipt-1.pdf
private/{owner.uid}/needs/need-1.png
private/{owner.uid}/reports/report-1.pdf
```

Sembrar objetos únicamente con el contexto de Rules necesario para cada caso;
no usar datos personales reales ni escribir en `donaciones-venezuela-4fc29`.

- [ ] **Step 2: Escribir pruebas de integración de carga y no exposición.**

Declarar en el archivo, junto con los helpers de inicialización, las referencias
que usan los casos; no dejar nombres implícitos:

```ts
const ownerStorage = ownerApp.storage;
const otherStorage = otherApp.storage;
const panelStorage = panelApp.storage;
const adminStorage = adminApp.storage;
const ownerRef = ref(ownerStorage, `private/${owner.uid}/receipts/receipt-1.pdf`);
const reportRef = ref(ownerStorage, `private/${owner.uid}/reports/report-1.pdf`);
const ownerMetadata = {
  contentType: 'application/pdf',
  customMetadata: {
    ownerUid: owner.uid,
    category: 'receipts',
    visibility: 'private',
  },
};

it('permite al propietario cargar y deniega lectura/borrado directos', async () => {
  await assertSucceeds(uploadBytes(ownerRef, new Uint8Array([1]), ownerMetadata));
  await assertFails(getBytes(ownerRef));
  await assertFails(deleteObject(ownerRef));
});

it('deniega UID ajeno, panel/admin directos y reportes fuera de la propiedad', async () => {
  const reportMetadata = {
    contentType: 'application/pdf',
    customMetadata: {
      ownerUid: owner.uid,
      category: 'reports',
      visibility: 'private',
    },
  };
  const otherRef = ref(otherStorage, `private/${owner.uid}/reports/other.pdf`);
  const panelRef = ref(panelStorage, `private/${owner.uid}/reports/panel.pdf`);
  const reportRefAsPanel = ref(panelStorage, `private/${owner.uid}/reports/report-1.pdf`);
  const reportRefAsAdmin = ref(adminStorage, `private/${owner.uid}/reports/report-1.pdf`);

  await assertFails(uploadBytes(otherRef, new Uint8Array([1]), reportMetadata));
  await assertFails(uploadBytes(panelRef, new Uint8Array([1]), reportMetadata));
  await assertFails(getBytes(reportRefAsPanel));
  await assertFails(getBytes(reportRefAsAdmin));
});
```

La última expectativa debe mantenerse: incluso `admin` no lee directamente
desde el SDK; su acceso se prueba solo mediante el handler autorizado y un
adaptador de Storage inyectado.

- [ ] **Step 3: Ejecutar la integración aislada y corregir solo contratos del plan.**

Run: `npm.cmd exec vitest run tests/emulators/storage.integration.test.ts`

Expected: PASS cuando el Storage Emulator esté activo; si falla por puerto
ocupado, detener únicamente el proceso Emulator Suite propio y repetir una vez.
No matar procesos de otro proyecto ni cambiar puertos silenciosamente.

- [ ] **Step 4: Ejecutar la suite completa de autocrítica.**

Run: `npm.cmd run test:unit`

Expected: todos los tests unitarios existentes y nuevos pasan.

Run: `npm.cmd run test:rules`

Expected: Firestore y Storage Rules pasan sin accesos indebidos.

Run: `npm.cmd run test:functions`

Expected: build de Functions y tests HTTP/emulador existentes pasan.

Run: `npm.cmd run test:emulators`

Expected: tests de Rules, Functions y Storage Emulator pasan juntos.

Run: `npm.cmd run build`

Expected: build Vite termina con código 0.

Run: `npm.cmd audit --audit-level=high`

Expected: no aparecen vulnerabilidades `high` o `critical`; registrar cualquier
`moderate` sin actualizar dependencias dentro de esta tarea.

Run: `npm.cmd --prefix functions audit --audit-level=high`

Expected: no aparecen vulnerabilidades `high` o `critical`.

Run: `python scripts/verificar-idioma.py`

Expected: el verificador termina con código 0.

- [ ] **Step 5: Ejecutar revisión manual de seguridad del cambio.**

Comprobar el diff con estos criterios:

- ninguna Rule permite `read` o `delete` directo;
- ningún handler acepta UID, rol, bucket o expiración confiados por el body;
- `panel` no puede acceder a `reports`;
- metadata no privada se trata como archivo no accesible;
- la URL no supera 15 minutos;
- no se registra token, IP, metadata sensible, path ajeno o URL completa;
- no se modificaron `services/api.js`, la UI ni recursos remotos.

Run: `git diff --check HEAD~4..HEAD`

Expected: sin errores de whitespace en los commits de T07.

- [ ] **Step 6: Actualizar el estado de `T07` con evidencia.**

Cambiar en `tasks.md` la fila `T07` a:

```text
| T07 | revisión | Migrar Storage y URLs temporales | T05 | Rules, adaptador y Functions probados con MIME/tamaño/rol/propietario; suite unit, Rules, Functions, Emulator, build, auditorías y idioma verdes; sin despliegue ni escritura remota |
```

No marcar `aprobada` hasta que Cronos revise el diff final y confirme que no hay
hallazgos críticos.

- [ ] **Step 7: Commitear integración y evidencia documental.**

```text
git add tests/emulators/storage.integration.test.ts tasks.md
git commit -m "test: verify private storage migration"
```

## Self-Review del Plan

- **Cobertura:** rutas, categorías, MIME/tamaño, metadata, propiedad y Rules se cubren en Tasks 1-2; matriz `user`/`panel`/`admin`, TTL, firma, eliminación, errores y rate limit se cubren en Task 3; Emulator Suite, no exposición, auditorías y estado `tasks.md` se cubren en Task 4.
- **Placeholder scan:** el plan no deja requisitos abiertos ni pasos que dependan de completar detalles durante la ejecución. La única corrección documental permitida está condicionada a una contradicción comprobada por tests y no es necesaria para implementar el contrato aprobado.
- **Consistencia de tipos:** `PrivateFileDescriptor`, `canAccessPrivateFile`, `canDeletePrivateFile`, `validatePrivateStoragePath`, `getPrivateFileUrlHandler` y `deletePrivateFileHandler` se definen en Tasks 3 y se consumen con los mismos nombres y parámetros en Task 4.
- **Límite operativo:** ningún paso despliega, activa Blaze, crea entornos o migra objetos reales; el único estado remoto usado es Emulator Suite local.

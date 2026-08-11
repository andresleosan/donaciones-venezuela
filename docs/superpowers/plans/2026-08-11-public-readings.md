# Lecturas Publicas Firebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar lecturas publicas acotadas de `lugaresPublicos` y `vacantesPublicas` mediante reglas Firestore, repositorios Firebase de solo lectura y pruebas de seguridad en Emulator Suite.

**Architecture:** Las colecciones publicas son documentos independientes de las colecciones privadas y se leen directamente desde el cliente mediante dos funciones estrechas. Firestore permite `get` y `list` anonimos con un limite maximo de 50, pero deniega toda escritura y mantiene deny-by-default para el resto; Functions/Admin SDK sera la unica via futura para publicar documentos sanitizados. `services/api.js` y la UI legacy no se modifican.

**Tech Stack:** Firebase Web SDK `12.16.0`, Firestore Security Rules v2, Firebase Emulator Suite, Vitest `4.1.10`, Vite `7.1.7`, Node.js 20+ en raiz y Node.js 22 en Functions.

## Global Constraints

- Proyecto Firebase: `donaciones-venezuela-4fc29`.
- Proyecto de pruebas: `demo-donaciones-venezuela`.
- La base comienza vacia; no se migran ni inventan usuarios, datos, tokens, PINs, hashes o credenciales heredadas.
- El cliente lee directamente solo documentos ya publicados en `lugaresPublicos` y `vacantesPublicas`.
- Toda escritura cliente, lectura de colecciones privadas y cualquier otra ruta permanece denegada.
- La publicacion futura usara Functions/Admin SDK, allowlists positivas y `functions/src/public-projections.ts`; no forma parte de esta implementacion.
- El limite de consulta es 50 documentos; `list` sin limite explicito o con limite mayor debe fallar en reglas.
- Los errores no incluyen tokens, PII, secretos, paths privados, documentos completos ni detalles internos del SDK.
- `services/api.js`, `window.SheetsService` y la UI no se modifican.
- No se habilitan `voluntariosPublicos`, `rescatistasPublicos`, `motorizadosPublicos`, `facturasPublicas`, `historialPublico` ni `entregasPublicas`.
- No se ejecutan deploys, Blaze, staging, produccion, seeds remotos ni escrituras remotas.
- Cada tarea termina con pruebas propias, revision del diff y un commit reversible.

## File Map

- Modify: `firebase/firestore.rules:1-11` - abrir exclusivamente `get`/`list` publicos con limite 50 para las dos colecciones.
- Modify: `firebase/firestore.indexes.json:1-4` - registrar indices para filtros y orden estable de las consultas publicas.
- Create: `tests/rules/public-readings.rules.test.ts` - probar lectura, escritura, limite y acceso privado con Emulator Suite.
- Modify: `tests/contracts/public-projections.test.ts:9-46` - cubrir las allowlists exactas y la denylist recursiva de las dos proyecciones del dominio.
- Create: `src/firebase/firebase-public-reads.js` - repositorios `listPublicPlaces` y `listPublicVacancies` con paginacion acotada.
- Create: `tests/firebase/firebase-public-reads.test.js` - pruebas unitarias mockeadas de consultas, limites, cursores y errores seguros.
- Modify: `src/firebase/index.js:1-4` - exportar solo los dos repositorios y el limite publico.
- Create: `docs/runbooks/public-readings.md` - operacion local, fixtures, rollback y prohibiciones de despliegue.
- Modify: `tasks.md:13` - actualizar solo `T06` con evidencia real despues de pasar todas las pruebas.

---

### Task 1: Contrato publico, reglas e indices

**Files:**
- Modify: `firebase/firestore.rules:1-11`
- Modify: `firebase/firestore.indexes.json:1-4`
- Modify: `tests/contracts/public-projections.test.ts:9-46`
- Create: `tests/rules/public-readings.rules.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_PROJECTION_FIELDS`, `sanitizePublicProjection`, `findForbiddenPublicFields` y el emulador Firestore del proyecto demo.
- Produces: reglas ejecutables para `lugaresPublicos/{id}` y `vacantesPublicas/{id}`; fixtures de prueba que cualquier repositorio posterior puede leer.

- [ ] **Step 1: Write the failing contract and rules tests**

Agregar a `tests/contracts/public-projections.test.ts` estos casos, conservando los tests existentes para las otras proyecciones:

```ts
it('sanitiza lugaresPublicos con la allowlist exacta', () => {
  expect(sanitizePublicProjection('lugaresPublicos', {
    nombre: 'Centro Demo',
    tipo: 'Centro',
    ubicacionPublica: 'Zona Este',
    latAproximada: 10.5,
    lngAproximada: -66.9,
    contactoPublico: 'contacto publico',
    activo: true,
    updatedAt: '2026-08-11T12:00:00.000Z',
    telefono: '0000000000',
    direccion: 'Direccion privada',
    authUid: 'uid-privado',
  })).toEqual({
    nombre: 'Centro Demo',
    tipo: 'Centro',
    ubicacionPublica: 'Zona Este',
    latAproximada: 10.5,
    lngAproximada: -66.9,
    contactoPublico: 'contacto publico',
    activo: true,
    updatedAt: '2026-08-11T12:00:00.000Z',
  });
});

it('sanitiza vacantesPublicas y elimina campos privados', () => {
  expect(sanitizePublicProjection('vacantesPublicas', {
    lugarId: 'lugar-1',
    titulo: 'Apoyo logistico',
    descripcion: 'Turno de prueba',
    cupos: 2,
    estado: 'Abierta',
    createdAt: '2026-08-11T12:00:00.000Z',
    email: 'privado@example.test',
    telefono: '000',
    ubicacionPrecisa: { lat: 10.5, lng: -66.9 },
  })).toEqual({
    lugarId: 'lugar-1',
    titulo: 'Apoyo logistico',
    descripcion: 'Turno de prueba',
    cupos: 2,
    estado: 'Abierta',
    createdAt: '2026-08-11T12:00:00.000Z',
  });
});

it('rechaza campos prohibidos anidados despues de la allowlist', () => {
  expect(findForbiddenPublicFields({ contactoPublico: { documento: 'V-1' } }))
    .toEqual(['contactoPublico.documento']);
});
```

Crear `tests/rules/public-readings.rules.test.ts` con `initializeTestEnvironment`, reglas cargadas desde `firebase/firestore.rules`, `assertSucceeds`, `assertFails`, `collection`, `doc`, `getDoc`, `getDocs`, `limit`, `query` y `setDoc`. Sembrar un documento publico y uno privado antes de cada caso usando `testEnv.withSecurityRulesDisabled`. Cubrir estos casos concretos:

```ts
it('permite get anonimo de una proyeccion publica', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'lugaresPublicos/lugar-1')));
});

it('permite list publico solo con limite maximo 50', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(query(
    collection(db, 'vacantesPublicas'),
    limit(50),
  )));
  await assertFails(getDocs(query(collection(db, 'vacantesPublicas'))));
  await assertFails(getDocs(query(
    collection(db, 'vacantesPublicas'),
    limit(51),
  )));
});

it.each(['anonymous', 'user', 'panel', 'admin'])('deniega escritura publica a %s', async (role) => {
  const db = role === 'anonymous'
    ? testEnv.unauthenticatedContext().firestore()
    : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
  await assertFails(setDoc(doc(db, 'lugaresPublicos/new'), { nombre: 'No permitido' }));
});

it.each(['anonymous', 'user', 'panel', 'admin'])('deniega lectura privada a %s', async (role) => {
  const db = role === 'anonymous'
    ? testEnv.unauthenticatedContext().firestore()
    : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
  await assertFails(getDoc(doc(db, 'lugares/private')));
  await assertFails(getDoc(doc(db, 'vacantesVoluntarios/private')));
});
```

Usar `beforeEach` para limpiar Firestore, `afterAll` para `cleanup`, y sembrar los documentos con los campos sinteticos definidos en la especificacion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/contracts/public-projections.test.ts tests/rules/public-readings.rules.test.ts`

Expected: los contratos de sanitizer pasan porque su implementacion ya existe; las pruebas de reglas fallan para las lecturas publicas debido al deny-by-default actual. El resultado RED esperado debe registrar esa causa, no un error de importacion.

- [ ] **Step 3: Write minimal rules and indexes**

Reemplazar el bloqueo global por estas rutas antes del `match /{document=**}` final:

```text
match /lugaresPublicos/{id} {
  allow get: if true;
  allow list: if request.query.limit != null && request.query.limit <= 50;
  allow write: if false;
}

match /vacantesPublicas/{id} {
  allow get: if true;
  allow list: if request.query.limit != null && request.query.limit <= 50;
  allow write: if false;
}
```

Mantener `allow read, write: if false` para cualquier otra ruta. No agregar condiciones de rol para estas lecturas, porque `anonymous`, `user`, `panel` y `admin` comparten el mismo permiso publico.

Actualizar `firebase/firestore.indexes.json` para las consultas del repositorio:

```json
{
  "indexes": [
    {
      "collectionGroup": "lugaresPublicos",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "activo", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" },
        { "fieldPath": "__name__", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "vacantesPublicas",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "createdAt", "order": "DESCENDING" },
        { "fieldPath": "__name__", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd run test:rules`

Expected: pasan las pruebas existentes deny-by-default y las nuevas de lectura publica, incluyendo limite, escritura denegada y colecciones privadas cerradas.

- [ ] **Step 5: Commit**

```bash
git add firebase/firestore.rules firebase/firestore.indexes.json tests/contracts/public-projections.test.ts tests/rules/public-readings.rules.test.ts
git commit -m "feat: open bounded public firestore readings"
```

### Task 2: Repositorios Firebase de solo lectura

**Files:**
- Create: `src/firebase/firebase-public-reads.js`
- Create: `tests/firebase/firebase-public-reads.test.js`
- Modify: `src/firebase/index.js:1-4`

**Interfaces:**
- Consumes: `getFirebaseApp()` y documentos publicados por las reglas de Task 1.
- Produces: `MAX_PUBLIC_PAGE_SIZE = 50`, `listPublicPlaces(options?)` y `listPublicVacancies(options?)`, cada una con `Promise<{ data: Array<object>, nextCursor: object|null }>`.

- [ ] **Step 1: Write the failing unit tests**

Crear `tests/firebase/firebase-public-reads.test.js` con mocks de `firebase/firestore` y `firebase-config.js`, siguiendo el patron de `tests/firebase/firebase-storage.test.js`. Cubrir estas expectativas:

```js
it('lista lugares activos con limite y cursor de documento', async () => {
  const lastDoc = { id: 'lugar-2', ref: { path: 'lugaresPublicos/lugar-2' }, data: () => ({}) };
  firestoreMocks.getDocs.mockResolvedValue({
    docs: [
      { id: 'lugar-1', ref: { path: 'lugaresPublicos/lugar-1' }, data: () => ({ nombre: 'A' }) },
      lastDoc,
    ],
  });

  await expect(listPublicPlaces({ pageSize: 2 })).resolves.toEqual({
    data: [{ id: 'lugar-1', nombre: 'A' }, { id: 'lugar-2' }],
    nextCursor: lastDoc,
  });
  expect(firestoreMocks.where).toHaveBeenCalledWith('activo', '==', true);
  expect(firestoreMocks.limit).toHaveBeenCalledWith(2);
  expect(firestoreMocks.query).toHaveBeenCalled();
});

it.each([0, -1, 51, '50', NaN])('rechaza pageSize invalido: %s', async (pageSize) => {
  await expect(listPublicVacancies({ pageSize })).rejects.toThrow('invalid-public-page-size');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('rechaza cursor de otra coleccion', async () => {
  const cursor = { ref: { path: 'vacantesPublicas/v-1' } };

  await expect(listPublicPlaces({ cursor })).rejects.toThrow('invalid-public-cursor');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('normaliza fallos de Firestore sin filtrar detalles', async () => {
  firestoreMocks.getDocs.mockRejectedValue(new Error('private@example.test lugaresPublicos/lugar-1'));

  await expect(listPublicPlaces()).rejects.toThrow('public-read-failed');
  await expect(listPublicPlaces()).rejects.not.toThrow('private@example.test');
});
```

El mock debe permitir verificar `collection`, `where`, `orderBy`, `documentId`, `limit`, `startAfter`, `query` y `getDocs`. El `getDocs` mock debe reiniciarse en `beforeEach`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/firebase/firebase-public-reads.test.js`

Expected: FAIL porque `src/firebase/firebase-public-reads.js` no existe.

- [ ] **Step 3: Write minimal repository implementation**

Implementar una funcion interna `listPublicCollection(collectionName, orderField, options)` y dos wrappers publicos. El contrato exacto debe cumplir:

```js
export const MAX_PUBLIC_PAGE_SIZE = 50;
export async function listPublicPlaces(options = {});
export async function listPublicVacancies(options = {});
```

Reglas de implementacion:

- `pageSize` por defecto es 50 y debe ser un entero entre 1 y 50; cualquier otro valor lanza `Error('invalid-public-page-size')` antes de llamar a Firestore.
- `listPublicPlaces` consulta `lugaresPublicos`, aplica `where('activo', '==', true)`, `orderBy('updatedAt', 'desc')`, `orderBy(documentId(), 'desc')` y `limit(pageSize)`.
- `listPublicVacancies` consulta `vacantesPublicas`, aplica `orderBy('createdAt', 'desc')`, `orderBy(documentId(), 'desc')` y `limit(pageSize)`.
- Si `cursor` existe, debe tener `ref.path` con el prefijo de la coleccion solicitada; si no, lanzar `Error('invalid-public-cursor')`. Un cursor valido se pasa a `startAfter(cursor)`.
- El modulo debe obtener Firestore desde `getFirebaseApp()` con inicializacion lazy, igual que los adaptadores existentes.
- Mapear cada documento a `{ id: snapshot.id, ...snapshot.data() }` y devolver como `nextCursor` el ultimo snapshot solo cuando `docs.length === pageSize`; en otro caso devolver `null`.
- Capturar cualquier error de Firestore y lanzar `Error('public-read-failed')` sin conservar el mensaje original ni agregarlo como `cause`.
- No exportar ni reexportar ninguna funcion de escritura.

Agregar en `src/firebase/index.js`:

```js
export {
  MAX_PUBLIC_PAGE_SIZE,
  listPublicPlaces,
  listPublicVacancies,
} from './firebase-public-reads.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/firebase/firebase-public-reads.test.js tests/firebase/firebase-storage.test.js`

Expected: pasan limites, consultas, cursor, mapeo y normalizacion de errores, sin cambiar el comportamiento de los adaptadores existentes.

- [ ] **Step 5: Commit**

```bash
git add src/firebase/firebase-public-reads.js src/firebase/index.js tests/firebase/firebase-public-reads.test.js
git commit -m "feat: add bounded public firestore repositories"
```

### Task 3: Runbook, cierre del dominio y evidencia

**Files:**
- Create: `docs/runbooks/public-readings.md`
- Modify: `tasks.md:13`
- Modify: `docs/superpowers/plans/2026-08-11-public-readings.md` - marcar checks unicamente despues de ejecutar cada comando.

**Interfaces:**
- Consumes: reglas, indices, sanitizer, repositorios y pruebas de Tasks 1-2.
- Produces: procedimiento local reproducible, rollback documentado y evidencia de `T06` sin marcar tareas posteriores.

- [x] **Step 1: Write the runbook**

Crear `docs/runbooks/public-readings.md` con estas instrucciones operativas exactas:

```text
Proyecto de pruebas: demo-donaciones-venezuela
Comando de reglas: npm.cmd run test:rules
Comando completo: npm.cmd run verify
Datos permitidos: fixtures sinteticos dentro de Emulator Suite
Datos prohibidos: usuarios reales, PII, tokens, archivos y seeds remotos
Rollback: revertir el commit que modifica firestore.rules e índices; restaurar deny-by-default
Fuera de alcance: deploy, Blaze, services/api.js y colecciones privadas
```

Documentar que un documento publico debe ser generado por Functions/Admin SDK con `sanitizePublicProjection`; ningun cliente puede escribirlo. Documentar tambien que la ausencia de documentos en el proyecto greenfield es correcta y no autoriza inventar datos.

- [x] **Step 2: Run focused and full verification**

Run, en este orden:

```bash
npm.cmd run test:unit
npm.cmd run test:rules
npm.cmd run test:emulators
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

Expected: todas las pruebas pasan; las auditorias no reportan `high` ni `critical`; cualquier vulnerabilidad `moderate` observada queda documentada sin atribuirle una antiguedad no demostrada.

- [x] **Step 3: Update backlog and plan evidence**

Actualizar unicamente la fila `T06` de `tasks.md` con evidencia real de reglas, repositorios y comandos. Dejar `T07` a `T12` en su estado actual. Marcar checks del plan solo con resultados efectivamente obtenidos.

- [x] **Step 4: Perform security review and inspect diff**

Confirmar en el diff que:

```text
lugaresPublicos y vacantesPublicas son las unicas rutas Firestore abiertas;
request.query.limit limita list a 50;
no existe escritura cliente ni acceso cliente a colecciones privadas;
no aparecen email, telefono, documento, authUid, tokens ni ubicacion precisa;
services/api.js y la UI no cambiaron;
no se ejecutaron deploy, Blaze ni escrituras remotas;
```

Ejecutar `git diff --check` y revisar `git status` sin revertir cambios ajenos.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/public-readings.md tasks.md docs/superpowers/plans/2026-08-11-public-readings.md
git commit -m "docs: close public firebase readings domain"
```

## Self-Review: Spec Coverage

Task 1 cubre las dos allowlists, denylist recursiva, reglas publicas, limite 50, escrituras denegadas, acceso privado denegado e indices. Task 2 cubre repositorios estrechos, paginacion, cursor, limites, errores seguros y exports. Task 3 cubre runbook, rollback, evidencia, seguridad y backlog.

Quedan fuera deliberadamente las seis proyecciones restantes, el publicador Admin SDK, rate limits distribuidos, sustitucion de `services/api.js`, UI, Storage, facturas, donaciones, transporte y cualquier carga de datos reales.

No hay apartados incompletos ni tipos ambiguos: los nombres de coleccion, allowlists, limites, errores y firmas estan definidos literalmente en las tareas.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-public-readings.md`. Two execution options:

1. **Subagent-Driven (recommended):** dispatch a fresh subagent per task, review each result and rerun tests before accepting it.
2. **Inline Execution:** execute tasks in this session with checkpoints after each task.

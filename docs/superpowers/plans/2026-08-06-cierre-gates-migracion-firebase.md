# Cierre de gates de migración Firebase — Plan de implementación

> **Para ejecución agentic:** usar `superpowers:executing-plans` y ejecutar tarea por tarea con checkpoints. Este proyecto prohíbe subagentes, por lo que `subagent-driven-development` no aplica.

**Goal:** cerrar `T01` con contratos coherentes, plataforma Firebase local reproducible, controles de privacidad y evidencia real antes de habilitar `T04`.

**Architecture:** Supabase continúa como fuente productiva. Firebase se prepara solo en local/desarrollo con documentos canónicos privados, proyecciones públicas sanitizadas, archivos privados por defecto, Functions en `us-east1` y una cola offline cerrada hasta que cada acción sea segura e idempotente.

**Tech Stack:** JavaScript/ESM, TypeScript 7.0.2, Node 22 para Functions, Firebase Web 12.16.x, Firebase Admin 14.2.0, Firebase Functions 7.3.2, Firebase Tools 15.26.0, Vitest 4.1.10, Rules Unit Testing 5.0.1 y Emulator Suite.

## Global Constraints

- No desplegar Firebase, no activar Blaze y no crear staging/producción.
- No leer ni modificar datos productivos durante este plan.
- `donaciones-venezuela-4fc29` es exclusivamente desarrollo; las pruebas usan `demo-donaciones-venezuela`.
- Functions usa Node 22 y región `us-east1`.
- URLs privadas: máximo 15 minutos; este plan no emite ninguna URL remota.
- Cola offline: deny-by-default, TTL 24 horas, máximo 3 intentos e idempotency key.
- No copiar PIN, hashes, refresh tokens ni credenciales legacy a Firebase.
- No hacer commits salvo solicitud explícita del operador; cada tarea termina en checkpoint de diff y pruebas.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `docs/adr/ADR-001-migracion-supabase-firebase.md` | Decisión de proveedor, alternativas, región, costo de salida y consecuencias |
| `BACKUP_RESTORE_PLAN.md` | Exportación, restauración, RPO/RTO y gates antes de `T06`/corte |
| `package.json`, `package-lock.json`, `vitest.config.js` | Runner, scripts y versiones reproducibles |
| `firebase.json` | Rules, Functions y puertos de Emulator Suite |
| `functions/package.json`, `functions/package-lock.json`, `functions/tsconfig.json` | Runtime servidor fijado |
| `functions/src/health.ts`, `functions/src/index.ts` | Endpoint local `health` |
| `functions/src/public-projections.ts` | Allowlists y sanitización de proyecciones públicas |
| `functions/src/private-file-access.ts` | Contrato puro de paths privados y expiración máxima |
| `tests/rules/*` | Matriz deny-by-default Firestore/Storage |
| `tests/functions/*`, `tests/emulators/*` | Contrato unitario e integración local de `health` |
| `tests/contracts/public-projections.test.ts` | Prevención de fuga de campos privados |
| `src/firebase/firebase-storage.js`, `src/firebase/index.js` | Eliminar URLs persistentes del contrato cliente |
| `services/offline-queue-policy.js` | Política pura de cola, TTL, intentos e idempotencia |
| `services/api.js`, `js/core.js`, `index.html`, `ventana.html`, `sw.js` | Integración deny-by-default, purga de cola y precache atómico v107 |
| `tests/firebase/firebase-storage.test.js`, `tests/offline-queue-policy.test.js`, `tests/offline-queue-integration.test.js` | Regresiones de Storage y cola |
| `STACK.md`, `MIGRATION_PLAN.md`, `FIRESTORE_SCHEMA.md`, `SECURITY_AUDIT.md`, `MIGRATION_VALIDATION.md`, `tasks.md` | Contrato final y evidencia del gate |

---

### Tarea 1: Gobernanza, entornos, costos y rollback

**Archivos:**
- Crear: `docs/adr/ADR-001-migracion-supabase-firebase.md`
- Crear: `BACKUP_RESTORE_PLAN.md`
- Modificar: `STACK.md:16-56`
- Modificar: `MIGRATION_PLAN.md:55-100`

**Interfaces:**
- Consume: decisiones aprobadas en `docs/superpowers/specs/2026-08-06-cierre-gates-migracion-firebase-design.md`.
- Produce: región `us-east1`, política de entornos, autorización de costo y gates de backup que todas las tareas posteriores deben respetar.

- [ ] **Paso 1: escribir el ADR con una decisión explícita**

Crear el documento con estas secciones y decisiones exactas:

```markdown
# ADR-001: Migrar Supabase a Firebase de forma incremental
Fecha: 2026-08-06
Estado: aceptada

## Contexto
La aplicación concentra 65 acciones, datos personales, archivos privados y reglas transaccionales en Supabase. La decisión aprobada busca Firebase Auth, Firestore, Storage y Functions sin un reemplazo big-bang.

## Decisión
Migrar por contratos y dominios. Supabase seguirá como fuente productiva hasta reconciliación y corte. `donaciones-venezuela-4fc29` será solo desarrollo; staging y producción serán proyectos separados. Functions usará `us-east1`. No se activará Blaze ni se desplegará sin confirmación posterior.

## Alternativas consideradas
- Mantener Supabase: menor costo de migración, pero no cumple la decisión operativa de estandarizar en Firebase.
- Reemplazo big-bang: reduce convivencia temporal, pero eleva el riesgo de regresión sobre 65 acciones y datos sensibles.
- Firebase incremental: elegido porque permite doble lectura, rollback por dominio y pruebas de contrato.

## Consecuencias
Se gana integración con Firebase Auth/Rules/Emulator Suite. Se acepta lock-in documental, ausencia de joins SQL, necesidad de proyecciones públicas, control explícito de costos por operación y una salida más costosa hacia otro proveedor.
```

- [ ] **Paso 2: escribir el runbook de backup y restauración**

`BACKUP_RESTORE_PLAN.md` debe declarar, sin ejecutar comandos:

```markdown
# Plan de backup, restauración y reversión

## Alcance del respaldo
- PostgreSQL: esquema, tablas, vistas, funciones, triggers y conteos por tabla.
- Supabase Auth: exportación soportada de usuarios y metadata; nunca refresh tokens.
- Storage: inventario por bucket, tamaño, MIME y checksum SHA-256.

## Protección
Backup cifrado, acceso mínimo, ubicación aprobada fuera del repositorio y registro de responsable/fecha. Ningún secreto o respaldo se guarda en Git.

## Gate previo a T06
Restaurar en entorno aislado y comprobar conteos, relaciones, totales financieros, muestra de RPC y checksums de objetos. RPO objetivo del ensayo: 24 horas. RTO objetivo del ensayo: 4 horas.

## Gate de corte
Backup final verificado con RPO de 15 minutos, procedimiento de reversión probado, ventana aprobada y confirmación explícita del operador. Supabase permanece disponible durante la ventana de reversión.
```

- [ ] **Paso 3: actualizar `STACK.md`**

Añadir secciones `Entornos`, `Región` y `Costo` con estos valores:

```markdown
## Entornos Firebase
- Desarrollo: `donaciones-venezuela-4fc29`.
- Staging: proyecto separado obligatorio, no creado en esta fase.
- Producción: proyecto separado obligatorio, no creado en esta fase.
- Pruebas locales: `demo-donaciones-venezuela`, reservado a Emulator Suite.

## Región
Functions: `us-east1`, elegida por proximidad a Venezuela y elegibilidad de cuota gratuita aplicable a Storage en esa región. La ubicación de Firestore/Storage remoto se confirmará antes de crear recursos fuera de desarrollo.

## Costo
Desarrollo local: USD 0. Carga baja estimada: USD 0–10/mes. Escenario con archivos, egreso o fan-out: USD 10–100+/mes. Blaze no está autorizado. Antes de activarlo se requiere confirmación y alertas USD 5, 20 y 50; las alertas no son topes de gasto.
```

- [ ] **Paso 4: corregir fases y bloqueadores en `MIGRATION_PLAN.md`**

Cambiar el gate para que el procedimiento quede documentado antes de `T04`, el ensayo restaurable sea obligatorio antes de `T06` y el backup final antes del corte. Eliminar afirmaciones obsoletas de que proyecto, bundler y retención son desconocidos. Mantener como abiertos únicamente staging/prod, rotación de credenciales, ensayo de restore, ventana de corte y autorización Blaze.

- [ ] **Paso 5: verificar consistencia documental**

Run:

```powershell
git diff --check
```

Expected: código 0; solo pueden aparecer advertencias de conversión LF/CRLF existentes.

- [ ] **Paso 6: checkpoint de revisión**

Releer ADR, `STACK.md`, `MIGRATION_PLAN.md` y `BACKUP_RESTORE_PLAN.md`. Confirmar que ninguno autoriza despliegue, Blaze, acceso productivo o creación de entornos.

---

### Tarea 2: Harness reproducible y pruebas de reglas cerradas

**Archivos:**
- Modificar: `package.json`
- Modificar: `package-lock.json` mediante npm
- Crear: `vitest.config.js`
- Modificar: `firebase.json`
- Crear: `tests/rules/firestore.rules.test.ts`
- Crear: `tests/rules/storage.rules.test.ts`

**Interfaces:**
- Consume: `firebase/firestore.rules`, `firebase/storage.rules` y proyecto demo definido en Tarea 1.
- Produce: scripts `test`, `test:unit`, `test:rules:run` y `test:rules`; puertos estables 8080/9199/9099/5001.

- [ ] **Paso 1: instalar herramientas con versiones exactas**

Run:

```powershell
npm.cmd install --save-dev --save-exact vitest@4.1.10 firebase-tools@15.26.0 @firebase/rules-unit-testing@5.0.1 fake-indexeddb@6.2.5
```

Expected: código 0 y lockfile actualizado.

- [ ] **Paso 2: definir scripts y Vitest**

Agregar a `package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "preview": "vite preview",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/rules/** --exclude tests/emulators/**",
    "test:rules:run": "vitest run tests/rules",
    "test:rules": "firebase emulators:exec --project demo-donaciones-venezuela --only firestore,storage \"npm run test:rules:run\""
  }
}
```

Crear `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['tests/**/*.test.{js,ts}'],
  },
});
```

- [ ] **Paso 3: configurar emuladores sin cambiar aliases remotos**

Extender `firebase.json`:

```json
{
  "firestore": {
    "rules": "firebase/firestore.rules",
    "indexes": "firebase/firestore.indexes.json"
  },
  "storage": { "rules": "firebase/storage.rules" },
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "functions": { "host": "127.0.0.1", "port": 5001 },
    "firestore": { "host": "127.0.0.1", "port": 8080 },
    "storage": { "host": "127.0.0.1", "port": 9199 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

- [ ] **Paso 4: escribir la matriz Firestore**

Crear `tests/rules/firestore.rules.test.ts` con `initializeTestEnvironment`, reglas cargadas desde `firebase/firestore.rules`, y una tabla `anonymous/user/panel/admin`. Para cada contexto ejecutar `assertFails(getDoc(doc(db, 'voluntarios/example')))` y `assertFails(setDoc(...))`. Los usuarios autenticados usan claims `{ role }`.

Código central:

```ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-donaciones-venezuela',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firebase/firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => testEnv.clearFirestore());
afterAll(async () => testEnv.cleanup());

const roles = ['anonymous', 'user', 'panel', 'admin'] as const;

describe('Firestore deny-by-default', () => {
  for (const role of roles) {
    it(`deniega lectura y escritura a ${role}`, async () => {
      const context = role === 'anonymous'
        ? testEnv.unauthenticatedContext()
        : testEnv.authenticatedContext(`${role}-uid`, { role });
      const ref = doc(context.firestore(), 'voluntarios/example');
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { nombre: 'No permitido' }));
    });
  }
});
```

- [ ] **Paso 5: escribir la matriz Storage**

Crear `tests/rules/storage.rules.test.ts` con el mismo ciclo de vida, configuración Storage `host: '127.0.0.1'`, `port: 9199` y reglas leídas desde `firebase/storage.rules`. Sembrar una vez el objeto con:

```ts
await testEnv.withSecurityRulesDisabled(async (context) => {
  const objectRef = ref(context.storage(), 'private/pruebas/existing.txt');
  await uploadBytes(objectRef, new Uint8Array([1]), { contentType: 'text/plain' });
});
```

Para cada rol, exigir `assertFails` sobre `uploadBytes` a `private/pruebas/new-${role}.txt` y `getBytes` de `private/pruebas/existing.txt`. Importar `getBytes`, `ref` y `uploadBytes` desde `firebase/storage`.

- [ ] **Paso 6: correr reglas y confirmar caracterización verde**

Run:

```powershell
npm.cmd run test:rules
```

Expected: la matriz completa de cuatro roles pasa en Firestore y Storage; 0 fallos. Estas son pruebas de caracterización de reglas existentes, por lo que no requieren una fase roja artificial.

- [ ] **Paso 7: checkpoint de revisión**

Run `git diff -- package.json firebase.json vitest.config.js tests/rules`. Confirmar que `.firebaserc` sigue declarando solo el proyecto de desarrollo y que los tests usan el ID `demo-*`.

---

### Tarea 3: Functions local y endpoint `health`

**Archivos:**
- Crear: `functions/package.json`
- Crear: `functions/package-lock.json` mediante npm
- Crear: `functions/tsconfig.json`
- Crear: `functions/src/health.ts`
- Crear: `functions/src/index.ts`
- Crear: `tests/functions/health.test.ts`
- Crear: `tests/emulators/health.integration.test.ts`
- Modificar: `firebase.json`
- Modificar: `package.json`

**Interfaces:**
- Produce: `healthHandler(req, res, now?)`, `health` desplegable en región `us-east1` y respuesta `{status, version, timestamp}`.
- Consume: scripts/emuladores de Tarea 2.

- [ ] **Paso 1: crear el paquete Functions fijado**

`functions/package.json`:

```json
{
  "name": "donaciones-venezuela-functions",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "engines": { "node": "22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "node -e \"import('node:fs').then(({rmSync})=>rmSync('lib',{recursive:true,force:true}))\""
  },
  "dependencies": {
    "firebase-admin": "14.2.0",
    "firebase-functions": "7.3.2"
  },
  "devDependencies": {
    "@types/node": "22.20.1",
    "typescript": "7.0.2"
  }
}
```

Run `npm.cmd install --prefix functions` para generar `functions/package-lock.json`.

`functions/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "lib",
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Paso 2: escribir pruebas rojas de `healthHandler`**

Crear `tests/functions/health.test.ts` con un mock encadenable de `status`, `json` y `setHeader`. Casos:

```ts
import { expect, it } from 'vitest';
import { healthHandler } from '../../functions/src/health.js';

function createResponse() {
  const result: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { result.headers[name] = value; },
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; },
  };
  return { res, result };
}

it('responde solo estado, versión y timestamp', () => {
  const { res, result } = createResponse();
  healthHandler({ method: 'GET' }, res, () => new Date('2026-08-06T12:00:00.000Z'));
  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    status: 'ok',
    version: 'local',
    timestamp: '2026-08-06T12:00:00.000Z',
  });
  expect(JSON.stringify(result.body)).not.toMatch(/secret|project|env|token/i);
});

it('rechaza POST sin filtrar detalles', () => {
  const { res, result } = createResponse();
  healthHandler({ method: 'POST' }, res);
  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('GET');
  expect(result.body).toEqual({
    error: { code: 'method-not-allowed', message: 'Method not allowed' },
  });
});
```

Run `npx.cmd vitest run tests/functions/health.test.ts`.

Expected: FAIL porque `functions/src/health.ts` no existe.

- [ ] **Paso 3: implementar el handler mínimo**

Crear `functions/src/health.ts`:

```ts
type HealthRequest = { method: string };
type HealthResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): HealthResponse;
  json(body: unknown): void;
};

export function healthHandler(
  req: HealthRequest,
  res: HealthResponse,
  now: () => Date = () => new Date(),
): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: { code: 'method-not-allowed', message: 'Method not allowed' },
    });
    return;
  }
  res.status(200).json({
    status: 'ok',
    version: 'local',
    timestamp: now().toISOString(),
  });
}
```

Crear `functions/src/index.ts`:

```ts
import { onRequest } from 'firebase-functions/v2/https';
import { healthHandler } from './health.js';

export const health = onRequest(
  { cors: false, region: 'us-east1' },
  healthHandler,
);
```

- [ ] **Paso 4: verificar unidad y compilación**

Run:

```powershell
npx.cmd vitest run tests/functions/health.test.ts
npm.cmd run build --prefix functions
```

Expected: ambos código 0; 2 pruebas pasan.

- [ ] **Paso 5: conectar Functions al emulador y escribir integración**

Agregar a `firebase.json`:

```json
"functions": [{ "source": "functions", "codebase": "default" }]
```

Crear `tests/emulators/health.integration.test.ts`:

```ts
import { expect, it } from 'vitest';

const base = 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/health';

it('sirve health desde Functions Emulator', async () => {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'version']);
});
```

Agregar scripts raíz:

```json
"test:functions:run": "vitest run tests/functions tests/emulators/health.integration.test.ts",
"test:functions": "npm --prefix functions run build && firebase emulators:exec --project demo-donaciones-venezuela --only functions \"npm run test:functions:run\""
```

- [ ] **Paso 6: ejecutar integración local**

Run `npm.cmd run test:functions`.

Expected: código 0; unitarias e integración pasan; no se consulta Firebase remoto.

- [ ] **Paso 7: checkpoint de seguridad**

Buscar en la respuesta/test las claves `secret`, `env`, `projectId`, `token`, `config`. Confirmar que no aparecen y que POST devuelve 405.

---

### Tarea 4: Contrato de proyecciones públicas

**Archivos:**
- Crear: `functions/src/public-projections.ts`
- Crear: `tests/contracts/public-projections.test.ts`
- Modificar: `FIRESTORE_SCHEMA.md:13-69`

**Interfaces:**
- Produce: `ProjectionName`, `PUBLIC_PROJECTION_FIELDS`, `sanitizePublicProjection(name, source)` y `findForbiddenPublicFields(value)`.
- No escribe Firestore; entrega un contrato puro para `T06/T08`.

- [ ] **Paso 1: escribir pruebas rojas de allowlist y denylist**

Casos mínimos:

```ts
it('construye voluntario público solo desde allowlist', () => {
  expect(sanitizePublicProjection('voluntariosPublicos', {
    nombre: 'Ana', zona: 'Este', habilidades: ['salud'], activo: true,
    email: 'privado@example.com', telefono: '000', authUid: 'uid',
  })).toEqual({ nombre: 'Ana', zona: 'Este', habilidades: ['salud'], activo: true });
});

it('detecta campos prohibidos también anidados', () => {
  expect(findForbiddenPublicFields({ evidencia: { documento: 'V-1' } }))
    .toEqual(['evidencia.documento']);
});

const sensitiveFixture = {
  nombre: 'Ana', zona: 'Este', activo: true, email: 'privado@example.com',
  telefono: '000', documento: 'V-1', authUid: 'uid',
};

it.each(Object.keys(PUBLIC_PROJECTION_FIELDS))('%s nunca publica denylist', (name) => {
  const result = sanitizePublicProjection(name as ProjectionName, sensitiveFixture);
  expect(findForbiddenPublicFields(result)).toEqual([]);
});
```

Run `npx.cmd vitest run tests/contracts/public-projections.test.ts`.

Expected: FAIL por módulo inexistente.

- [ ] **Paso 2: implementar listas exactas y copia positiva**

Usar estas listas:

```ts
export const PUBLIC_PROJECTION_FIELDS = {
  lugaresPublicos: ['nombre', 'tipo', 'ubicacionPublica', 'latAproximada', 'lngAproximada', 'contactoPublico', 'activo', 'updatedAt'],
  voluntariosPublicos: ['nombre', 'zona', 'habilidades', 'fotoPublicaPath', 'activo', 'createdAt'],
  rescatistasPublicos: ['nombre', 'zona', 'especialidades', 'capacidadOperativa', 'fotoPublicaPath', 'activo', 'createdAt'],
  motorizadosPublicos: ['nombre', 'zona', 'tipoVehiculo', 'capacidad', 'fotoPublicaPath', 'activo', 'createdAt'],
  vacantesPublicas: ['lugarId', 'titulo', 'descripcion', 'cupos', 'estado', 'createdAt'],
  facturasPublicas: ['numero', 'tokenPublico', 'necesidad', 'montoObjetivo', 'recaudado', 'estado', 'moneda', 'createdAt'],
  historialPublico: ['entidadPublicaId', 'tipo', 'estado', 'descripcionPublica', 'createdAt'],
  entregasPublicas: ['facturaPublicaId', 'estado', 'createdAt', 'evidenciaPublicaPath'],
} as const;
```

`sanitizePublicProjection` crea `{}` y copia únicamente claves de la lista con valor distinto de `undefined`. No debe clonar todo el origen ni borrar campos después.

`findForbiddenPublicFields` recorre objetos/arrays y normaliza cada clave con `normalize('NFD')`, eliminación de diacríticos, eliminación de caracteres no alfanuméricos y conversión a minúsculas antes de compararla contra:

```ts
const FORBIDDEN = new Set([
  'email', 'telefono', 'documento', 'cedula', 'placa', 'authuid',
  'pin', 'pinhash', 'tokeninterno', 'refreshtoken', 'ip', 'iphash',
  'comprobantepath', 'fileprivatepath', 'ubicacionprecisa',
]);
```

Implementar las firmas y recorrido así:

```ts
export type ProjectionName = keyof typeof PUBLIC_PROJECTION_FIELDS;
type UnknownRecord = Record<string, unknown>;

function normalizeKey(key: string): string {
  return key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function findForbiddenPublicFields(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenPublicFields(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as UnknownRecord).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const own = FORBIDDEN.has(normalizeKey(key)) ? [childPath] : [];
    return own.concat(findForbiddenPublicFields(child, childPath));
  });
}

export function sanitizePublicProjection(name: ProjectionName, source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = {};
  for (const field of PUBLIC_PROJECTION_FIELDS[name]) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  const forbidden = findForbiddenPublicFields(result);
  if (forbidden.length) throw new Error(`forbidden-public-fields:${forbidden.join(',')}`);
  return result;
}
```

- [ ] **Paso 3: correr pruebas y compilación**

Run:

```powershell
npx.cmd vitest run tests/contracts/public-projections.test.ts
npm.cmd run build --prefix functions
```

Expected: código 0.

- [ ] **Paso 4: alinear `FIRESTORE_SCHEMA.md`**

Separar tabla de colecciones canónicas privadas y tabla de proyecciones. Copiar las allowlists exactas del código y declarar que los campos `*Publico` se generan tras consentimiento/criterio de publicación, no por renombrado automático de datos privados.

- [ ] **Paso 5: checkpoint de revisión**

Comparar nombres entre código, tests y esquema. Deben coincidir exactamente las ocho colecciones y sus campos.

---

### Tarea 5: Retirar URLs persistentes del adaptador Storage

**Archivos:**
- Modificar: `src/firebase/firebase-storage.js:1-43`
- Modificar: `src/firebase/index.js:4`
- Crear: `functions/src/private-file-access.ts`
- Crear: `tests/firebase/firebase-storage.test.js`
- Crear: `tests/contracts/private-file-access.test.ts`

**Interfaces:**
- `uploadFile(path, file, options)` pasa de `{path, url}` a `{path}`.
- Se elimina `downloadUrl` del módulo y del barrel.
- `deleteFile(path)` conserva su contrato.
- Produce `PRIVATE_URL_TTL_MS`, `validatePrivateStoragePath(path)` y `privateUrlExpiresAt(now)` para la Function firmante de `T07`.

- [ ] **Paso 1: escribir pruebas rojas**

Mockear `firebase/storage` y `getFirebaseApp`. Verificar:

```js
it('sube y devuelve solo el path privado', async () => {
  uploadBytes.mockResolvedValue({ ref: { fullPath: 'private/facturas/f1/a.png' } });
  const result = await uploadFile('private/facturas/f1/a.png', filePng);
  expect(result).toEqual({ path: 'private/facturas/f1/a.png' });
  expect(result).not.toHaveProperty('url');
});

it('no exporta un helper de URL persistente', async () => {
  const module = await import('../../src/firebase/firebase-storage.js');
  expect(module.downloadUrl).toBeUndefined();
});
```

Run `npx.cmd vitest run tests/firebase/firebase-storage.test.js`.

Expected: FAIL porque hoy devuelve `url` y exporta `downloadUrl`.

- [ ] **Paso 2: implementar el contrato mínimo**

Cambiar imports a:

```js
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
```

Cambiar retorno:

```js
return { path: snapshot.ref.fullPath };
```

Eliminar `downloadUrl` y exportar desde `src/firebase/index.js` únicamente:

```js
export { deleteFile, uploadFile } from './firebase-storage.js';
```

- [ ] **Paso 3: escribir y ejecutar la prueba roja de acceso privado**

Crear `tests/contracts/private-file-access.test.ts` para exigir TTL exacto de 900000 ms, aceptar `private/facturas/f1/a.png` y rechazar paths públicos, `..`, segmentos vacíos y backslashes.

```ts
import { expect, it } from 'vitest';
import {
  PRIVATE_URL_TTL_MS,
  privateUrlExpiresAt,
  validatePrivateStoragePath,
} from '../../functions/src/private-file-access.js';

it('limita la expiración a 15 minutos', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  expect(PRIVATE_URL_TTL_MS).toBe(900000);
  expect(privateUrlExpiresAt(now).toISOString()).toBe('2026-08-06T12:15:00.000Z');
});

it('acepta solo el path privado canónico', () => {
  expect(validatePrivateStoragePath('private/facturas/f1/a.png'))
    .toBe('private/facturas/f1/a.png');
  for (const invalid of ['public/facturas/f1/a.png', 'private/../f1/a.png', 'private//f1/a.png', 'private/facturas/f1/..', 'private\\facturas\\f1\\a.png']) {
    expect(() => validatePrivateStoragePath(invalid)).toThrow('invalid-private-storage-path');
  }
});
```

Run `npx.cmd vitest run tests/contracts/private-file-access.test.ts`.

Expected: FAIL por módulo inexistente.

- [ ] **Paso 4: implementar el contrato puro de acceso privado**

Crear `functions/src/private-file-access.ts`:

```ts
export const PRIVATE_URL_TTL_MS = 15 * 60 * 1000;

export function validatePrivateStoragePath(path: string): string {
  if (path.includes('..') || !/^private\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(path)) {
    throw new Error('invalid-private-storage-path');
  }
  return path;
}

export function privateUrlExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PRIVATE_URL_TTL_MS);
}
```

- [ ] **Paso 5: verificar tests, import y build**

Run:

```powershell
npx.cmd vitest run tests/firebase/firebase-storage.test.js tests/contracts/private-file-access.test.ts
node -e "import('./src/firebase/index.js').then(() => console.log('firebase adapters import: OK'))"
npm.cmd run build
npm.cmd run build --prefix functions
```

Expected: todos código 0; no hay consumidor existente roto porque la búsqueda previa solo encontró el barrel.

- [ ] **Paso 6: checkpoint de seguridad**

Buscar `getDownloadURL|downloadUrl` dentro de `src/firebase`. Expected: 0 coincidencias.

---

### Tarea 6: Cola offline deny-by-default y ciclo de vida

**Archivos:**
- Crear: `services/offline-queue-policy.js`
- Modificar: `services/api.js:19-30,90-123,347-407`
- Modificar: `js/core.js:557-560`
- Modificar: `index.html:837`
- Modificar: `ventana.html:46-48`
- Modificar: `sw.js:3-25`
- Crear: `tests/offline-queue-policy.test.js`
- Crear: `tests/offline-queue-integration.test.js`

**Interfaces:**
- Produce global clásico `DVOfflinePolicy` con `isQueueable`, `createQueueEntry`, `shouldDiscard` y `recordFailure`.
- `SheetsService.clearOfflineQueue()` elimina todo y emite `dv-offline-change`.
- Ninguna acción real está habilitada en `SAFE_OFFLINE_ACTIONS`.

- [ ] **Paso 1: escribir pruebas rojas de política**

Importar el script clásico y probar:

```js
it('rechaza todas las acciones actuales y payloads sensibles', () => {
  expect(DVOfflinePolicy.isQueueable({ accion: 'reportar_persona', documento: 'V-1' })).toBe(false);
  expect(DVOfflinePolicy.isQueueable({ accion: 'registrar_entrega_final', gps: { lat: 1 } })).toBe(false);
});

it('crea IDs estables y TTL de 24 horas para una acción explícitamente segura', () => {
  const row = DVOfflinePolicy.createQueueEntry(
    { accion: 'public_ping', value: 'ok' },
    { now: 1000, allowedActions: new Set(['public_ping']), createId: () => 'queue-1' },
  );
  expect(row).toMatchObject({
    id: 'queue-1', queueId: 'queue-1', idempotencyKey: 'queue-1',
    createdAt: 1000, expiresAt: 1000 + 86400000, attempts: 0,
  });
});

it('descarta al tercer fallo o al expirar', () => {
  const failed = DVOfflinePolicy.recordFailure({ attempts: 2 }, 'network-timeout');
  expect(failed.attempts).toBe(3);
  expect(DVOfflinePolicy.shouldDiscard(failed, 1000)).toBe(true);
  expect(DVOfflinePolicy.shouldDiscard({ attempts: 0, expiresAt: 999 }, 1000)).toBe(true);
});
```

Run `npx.cmd vitest run tests/offline-queue-policy.test.js`.

Expected: FAIL por script inexistente.

- [ ] **Paso 2: implementar política pura clásica**

`services/offline-queue-policy.js` debe ser este IIFE clásico:

```js
(function (root) {
  'use strict';

  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_ATTEMPTS = 3;
  const SAFE_OFFLINE_ACTIONS = new Set();
  const SENSITIVE_KEYS = /token|password|pin|documento|cedula|foto|video|comprobante|gps|ubicacion|email|telefono|familia|denuncia|monto|pago/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasSensitiveData(value, seen) {
    if (!value || typeof value !== 'object') return false;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) return value.some((item) => hasSensitiveData(item, visited));
    return Object.entries(value).some(([key, child]) =>
      SENSITIVE_KEYS.test(key) || hasSensitiveData(child, visited));
  }

  function isQueueable(payload, allowedActions) {
    const allowed = allowedActions || SAFE_OFFLINE_ACTIONS;
    return isPlainObject(payload) && allowed.has(String(payload.accion || ''))
      && !hasSensitiveData(payload);
  }

  function createQueueEntry(payload, options) {
    const config = options || {};
    if (!isQueueable(payload, config.allowedActions)) throw new Error('offline-payload-not-allowed');
    const now = Number(config.now == null ? Date.now() : config.now);
    const createId = config.createId || (() => root.crypto?.randomUUID?.()
      || `offline-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    const id = String(createId());
    return {
      id, queueId: id, idempotencyKey: id, payload,
      createdAt: now, expiresAt: now + TTL_MS, attempts: 0, lastErrorCode: '',
    };
  }

  function recordFailure(row, errorCode) {
    const code = String(errorCode || 'unknown-error').toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
    return Object.assign({}, row, {
      attempts: Number(row.attempts || 0) + 1,
      lastErrorCode: code || 'unknown-error',
    });
  }

  function shouldDiscard(row, now) {
    const current = Number(now == null ? Date.now() : now);
    return Number(row?.attempts || 0) >= MAX_ATTEMPTS
      || Number(row?.expiresAt || 0) <= current;
  }

  root.DVOfflinePolicy = Object.freeze({
    isQueueable, createQueueEntry, recordFailure, shouldDiscard,
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Paso 3: ejecutar política verde**

Run `npx.cmd vitest run tests/offline-queue-policy.test.js`.

Expected: todos los casos pasan.

- [ ] **Paso 4: escribir integración roja con `fake-indexeddb`**

En `tests/offline-queue-integration.test.js`, instalar `fake-indexeddb/auto`, exponer un `window` mínimo, `navigator.onLine = false`, timers falsos y cargar primero policy, después API. Caso:

```js
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false }, configurable: true,
  });
  globalThis.addEventListener = vi.fn();
  globalThis.dispatchEvent = vi.fn();
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  await import('../services/offline-queue-policy.js');
  await import('../services/api.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.addEventListener;
  delete globalThis.dispatchEvent;
  delete globalThis.CustomEvent;
  delete globalThis.DVOfflinePolicy;
  delete globalThis.SheetsService;
});

it('no persiste reportes sensibles cuando está offline', async () => {
  await expect(window.SheetsService.post({
    accion: 'reportar_persona', documento: 'V-1', foto: 'data:image/png;base64,AA',
  })).rejects.toThrow();
  expect(await window.SheetsService.getQueueCount()).toBe(0);
});
```

Expected antes de integrar policy: FAIL porque `reportar_persona` entra en la allowlist actual y se guarda.

- [ ] **Paso 5: integrar policy y purga**

1. Incluir `offline-queue-policy.js?v=107` inmediatamente antes de `api.js` en ambos HTML.
2. Reemplazar `ACCIONES_OFFLINE` por llamadas a `window.DVOfflinePolicy.isQueueable`.
3. Construir filas únicamente con `createQueueEntry`.
4. Antes de flush, eliminar filas expiradas, con 3 intentos o cuyo payload ya no sea queueable; esto purga entradas legacy sensibles.
5. Al fallar, usar `recordFailure`; eliminar si alcanza descarte.
6. Exportar `clearOfflineQueue` y llamarlo desde `cerrarSesion()` sin bloquear el logout si IndexedDB falla.
7. Cambiar `sw.js` a `VERSION = '107'`, agregar `/services/offline-queue-policy.js` + `V` a `ESTATICOS` y actualizar todas las referencias `?v=106` de `index.html`/`ventana.html` a `?v=107` para evitar una mezcla de cachés.

Las funciones centrales en `services/api.js` quedan con estas decisiones:

```js
function esAccionOffline(payload) {
  return Boolean(window.DVOfflinePolicy && window.DVOfflinePolicy.isQueueable(payload));
}

async function clearOfflineQueue() {
  await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.clear());
  return emitirCambioCola();
}

async function depurarCola(rows) {
  for (const row of rows) {
    if (!window.DVOfflinePolicy.isQueueable(row.payload)
        || window.DVOfflinePolicy.shouldDiscard(row)) {
      await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.delete(row.id));
    }
  }
}
```

`encolar` usará `createQueueEntry(payload)` y guardará solo esa fila. En el `catch` de `flushQueue`, construir `failed = recordFailure(row, err.name || 'request-failed')`; eliminarlo si `shouldDiscard(failed)` y, en caso contrario, reemplazar la fila con `store.put(failed)`. Exportar `clearOfflineQueue` dentro de `window.SheetsService`. En `cerrarSesion()`, ejecutar `window.SheetsService.clearOfflineQueue().catch(() => {})` si el método existe.

Después de `depurarCola(rows)`, `flushQueue` debe iterar una lista nueva filtrada con `isQueueable(row.payload) && !shouldDiscard(row)`; no debe reutilizar filas legacy que ya fueron eliminadas.

- [ ] **Paso 6: verificar integración y regresiones locales**

Run:

```powershell
npx.cmd vitest run tests/offline-queue-policy.test.js tests/offline-queue-integration.test.js
python scripts/verificar-idioma.py
npm.cmd run build
```

Expected: todos código 0; 1499 claves o más siguen paralelas; build completo.

- [ ] **Paso 7: checkpoint de seguridad**

Confirmar que `SAFE_OFFLINE_ACTIONS` está vacío y que ninguna ruta alternativa llama `encolar` sin pasar por `isQueueable`.

---

### Tarea 7: Reconciliación documental y gate final de T01

**Archivos:**
- Modificar: `SECURITY_AUDIT.md`
- Modificar: `MIGRATION_VALIDATION.md`
- Modificar: `MIGRATION_PLAN.md`
- Modificar: `FIRESTORE_SCHEMA.md`
- Modificar: `STACK.md`
- Modificar: `tasks.md`
- Modificar: `package.json`

**Interfaces:**
- Consume: todos los comandos y contratos de Tareas 1-6.
- Produce: script `verify`, evidencia completa y decisión objetiva sobre `T01`.

- [ ] **Paso 1: añadir scripts integrados**

Agregar a `package.json`:

```json
"test:emulators:run": "vitest run tests/rules tests/functions tests/emulators",
"test:emulators": "npm --prefix functions run build && firebase emulators:exec --project demo-donaciones-venezuela --only auth,firestore,storage,functions \"npm run test:emulators:run\"",
"verify": "npm run test:unit && npm run test:emulators && npm run build && npm audit --audit-level=high && npm audit --prefix functions --audit-level=high && python scripts/verificar-idioma.py"
```

- [ ] **Paso 2: actualizar auditoría y esquema**

`SECURITY_AUDIT.md` debe registrar como corregidos localmente:

- reglas cerradas probadas por rol;
- contrato Storage sin `getDownloadURL` privado;
- cola offline deny-by-default y purga legacy;
- `health` sin secretos.

Debe mantener abiertos Auth/claims, reglas funcionales, 65 contratos, rotación de credenciales, backup restaurado y CSP final.

`MIGRATION_VALIDATION.md` debe distinguir “gate T01 corregido localmente” de “migración funcional no iniciada”. No afirmar que staging/prod, Blaze, backup restore o Firebase remoto fueron verificados.

- [ ] **Paso 3: ejecutar verificación completa fresca**

Run:

```powershell
npm.cmd run verify
```

Expected: código 0 en unitarias, emuladores, build, auditoría e idioma. Registrar conteo real de pruebas, no estimado.

- [ ] **Paso 4: revisión de seguridad manual**

Verificar:

```powershell
git status --short
git diff --check
```

Usar búsqueda de contenido para confirmar:

- cero `getDownloadURL|downloadUrl` en `src/firebase`;
- cero `allow read, write: if true` en Rules;
- cero secretos Admin/llaves privadas en archivos nuevos;
- proyecto demo en todos los scripts de emulador;
- `us-east1` consistente en ADR, Stack, spec, plan y Function.

- [ ] **Paso 5: actualizar `tasks.md` con evidencia real**

Si y solo si todos los comandos pasan, cambiar `T01` de `bloqueada` a `completada`. La evidencia debe decir: `ADR-001 + contratos público/privado/Storage/offline + Functions health local; npm run verify código 0`, seguida por el conteo exacto que Vitest imprima en esa ejecución.

No cambiar `T04` a `en curso` dentro de este plan. Si cualquier prueba falla, mantener `T01` bloqueada y registrar comando/fallo exacto.

- [ ] **Paso 6: checkpoint final Cronos**

Aplicar `security-baseline`, `advanced-qa-strategy`, `self-critique-loop` y `verification-before-completion`. Confirmar explícitamente que no hubo deploy, gasto, migración ni acceso productivo.

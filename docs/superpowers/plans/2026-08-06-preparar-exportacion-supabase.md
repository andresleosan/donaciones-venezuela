# Preparar Exportacion Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un exportador seguro, reproducible y verificable para PostgreSQL, Auth y Storage de Supabase, sin ejecutarlo contra datos reales en este plan.

**Architecture:** Un CLI Node.js en modo `dry-run` por defecto validara configuracion, herramientas y rutas. En modo explicito `--execute` coordinara dumps PostgreSQL, paginacion de Auth, descarga de Storage, manifiestos, checksums y sellado cifrado fuera del repositorio. Un verificador independiente validara el paquete y podra restaurar el dump solo en un destino aislado.

**Tech Stack:** Node.js 20+, ESM, Vitest, `pg_dump`, `psql`, `pg_restore`, Supabase Auth/Storage HTTP API y `age` para cifrado del paquete.

## Global Constraints

- El destino Firebase es el proyecto real de desarrollo `donaciones-venezuela-4fc29`; no se toca produccion ni se crean staging/produccion.
- No se activa Blaze, no se despliega y no se genera gasto sin confirmacion explicita del operador.
- No se ejecuta exportacion remota en este plan; `--dry-run` puede resolver localmente herramientas y versiones, pero solo `--execute` puede abrir red, ejecutar dumps/descargas/sellado o crear artefactos de datos.
- Los secretos se reciben por variables de entorno o gestor seguro; nunca se escriben en el repositorio, logs, argumentos de proceso o manifiestos.
- La salida debe vivir fuera del repositorio y contener PII solo en el paquete protegido.
- El export incluye PostgreSQL, metadata permitida de Auth y objetos/metadata de Storage; excluye contrasenas, hashes no soportados, refresh tokens, sesiones, PINs y secretos.
- Una salida parcial, checksum incorrecto, diferencia de conteos o fallo de restauracion bloquea la aprobacion del paquete.
- El hallazgo `buscar_familiar` sigue siendo un bloqueo de privacidad para la migracion funcional; este plan no lo traslada ni lo corrige en Supabase.
- La implementacion no debe modificar datos remotos ni eliminar tablas, objetos, usuarios, funciones o credenciales de Supabase.

## Scope Boundary

Este plan produce un exportador preparado y verificable. No implementa el importador
Firestore/Auth/Storage ni reemplaza `services/api.js`; esos trabajos requieren planes
posteriores sobre el mismo paquete de exportacion aprobado.

## File Map

- Create: `scripts/export-supabase-lib.mjs` - funciones puras y coordinadores testeables para configuracion, rutas, ejecucion, paginacion, hashing y manifiestos.
- Create: `scripts/export-supabase.mjs` - CLI con `--dry-run`, `--execute`, `--run-dir` y `--project-ref`.
- Create: `scripts/verify-supabase-export.mjs` - verificacion independiente de estructura, checksums y restauracion aislada opcional.
- Create: `tests/export-supabase.test.js` - pruebas unitarias del exportador sin red ni herramientas reales.
- Create: `docs/runbooks/export-supabase.md` - prerrequisitos, variables, comandos, artefactos y checkpoint de ejecucion.
- Modify: `package.json` - comandos `export:supabase`, `export:supabase:dry-run` y `verify:export`.
- Modify: `BACKUP_RESTORE_PLAN.md` - enlazar el runbook ejecutable y precisar el gate de evidencia.
- Modify: `.gitignore` - defensa contra artefactos de exportacion si alguien elige una ruta incorrecta.

## Interfaces

El modulo `scripts/export-supabase-lib.mjs` expone estas interfaces:

```js
readExportConfig(env, repoRoot) -> ExportConfig
assertSafeOutputRoot(outputRoot, repoRoot) -> string
createRunDirectory(outputRoot, timestamp) -> Promise<RunPaths>
runCommand(command, args, options) -> Promise<{ stdout, stderr, code }>
exportPostgres(config, paths, runner) -> Promise<PostgresEvidence>
exportAuth(config, paths, fetchImpl) -> Promise<AuthEvidence>
exportStorage(config, paths, fetchImpl) -> Promise<StorageEvidence>
sealRun(paths, recipient, runner) -> Promise<string>
writeRunManifest(paths, evidence) -> Promise<void>
verifyRun(runDir, options) -> Promise<VerificationReport>
```

Las funciones que llaman a comandos o red reciben `runner`/`fetchImpl` para que
las pruebas no necesiten credenciales, red, `pg_dump`, `psql` ni `age`.

## Task 1: Preflight seguro y configuracion

**Files:**
- Create: `scripts/export-supabase-lib.mjs`
- Create: `scripts/export-supabase.mjs`
- Create: `tests/export-supabase.test.js`
- Modify: `package.json:10-22`

**Interfaces:**
- Produce `ExportConfig` con `projectRef`, `supabaseUrl`, `dbUrl`, `serviceRoleKey`, `outputRoot`, `ageRecipient` y `repoRoot`.
- `--dry-run` sera el modo predeterminado; `--execute` sera obligatorio para red, dumps, descargas, sellado y cualquier proceso que produzca artefactos de datos. El dry-run solo puede resolver ejecutables locales y leer nombres de variables.
- `--project-ref` tendra como valor esperado `zryfwbjvlacorryzdaod`; si difiere, el CLI terminara con error antes de leer red.

- [ ] **Step 1: Write the failing tests**

Agregar pruebas que cubran:

```js
import { describe, expect, it } from 'vitest';
import { assertSafeOutputRoot, readExportConfig } from '../scripts/export-supabase-lib.mjs';

describe('export config', () => {
  it('requires the exact Supabase project reference', () => {
    expect(() => readExportConfig({
      SUPABASE_PROJECT_REF: 'otro-proyecto',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_DB_URL: 'postgres://user:secret@example/db',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      EXPORT_ROOT: 'C:/secure/donaciones-export',
      EXPORT_AGE_RECIPIENT: 'age1test',
    }, 'F:/repo')).toThrow(/project/i);
  });

  it('rejects output inside the repository', () => {
    expect(() => assertSafeOutputRoot('F:/repo/backups', 'F:/repo')).toThrow(/outside/i);
  });

  it('never exposes credentials in the normalized config summary', () => {
    const config = readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
      SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
      SUPABASE_DB_URL: 'postgres://user:secret@example/db',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
      EXPORT_ROOT: 'C:/secure/donaciones-export',
      EXPORT_AGE_RECIPIENT: 'age1test',
    }, 'F:/repo');
    expect(JSON.stringify(config)).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because the exporter module and its interfaces do not exist.

- [ ] **Step 3: Implement the minimal preflight**

Implement:

- `readExportConfig(env, repoRoot)` requiring `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPORT_ROOT` and `EXPORT_AGE_RECIPIENT` only for `--execute`; dry-run may report missing values by name.
- URL parsing that validates HTTPS for `SUPABASE_URL`, PostgreSQL URL syntax for `SUPABASE_DB_URL` and never returns password text in errors.
- `assertSafeOutputRoot` using resolved absolute paths and rejecting the repository, its descendants, `.git`, `node_modules`, `dist` and `graphify-out`.
- A CLI parser that accepts `--dry-run`, `--execute`, `--project-ref`, `--run-dir` and `--help`; unknown flags terminate with code 2.
- A dry-run summary that prints tool names and missing variable names, never values.
- Package scripts:

```json
{
  "export:supabase": "node scripts/export-supabase.mjs",
  "export:supabase:dry-run": "node scripts/export-supabase.mjs --dry-run",
  "verify:export": "node scripts/verify-supabase-export.mjs"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: all preflight tests pass and no secret appears in test output.

## Task 2: Run command wrapper and protected staging

**Files:**
- Modify: `scripts/export-supabase-lib.mjs`
- Modify: `scripts/export-supabase.mjs`
- Modify: `tests/export-supabase.test.js`

**Interfaces:**
- `runCommand(command, args, options)` must use `spawn` with an argument array, not a shell string.
- `RunPaths` must contain `root`, `postgres`, `auth`, `storage`, `reconciliation` and `temp` under the validated external root.
- Any child process receives credentials only through its environment, never through command-line arguments.

- [ ] **Step 1: Write the failing tests**

Test that:

- a command runner receives `pg_dump` arguments without the database password or complete connection URL;
- a run directory has the required subdirectories;
- an existing run directory is never silently overwritten;
- dry-run never calls `fetch`, never invokes an export/seal command and never writes data artifacts; read-only executable resolution is allowed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because command redaction and run-path creation are not implemented.

- [ ] **Step 3: Implement staging and command execution**

Implement:

- `createRunDirectory(outputRoot, timestamp)` with a UTC directory name and exclusive creation.
- Temporary files under `temp/`, final artifacts under their typed directories, and cleanup on failed runs without deleting previous runs.
- `runCommand` with `stdio` capture, timeout, exit-code handling and redacted errors.
- PostgreSQL connection parsing into `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` and `PGSSLMODE=require`; command args contain only host, port, user, database and output paths.
- Preflight checks for `pg_dump`, `psql`, `pg_restore`, `tar` and `age` using `command -v` equivalent through `spawn`/platform resolution.
- A `run.json` status field that ends as `prepared`, `completed` or `failed`; failed runs retain an error code but never credentials.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: all staging, command-redaction and dry-run tests pass.

## Task 3: PostgreSQL schema, data dump and counts

**Files:**
- Modify: `scripts/export-supabase-lib.mjs`
- Modify: `scripts/export-supabase.mjs`
- Modify: `tests/export-supabase.test.js`
- Modify: `docs/runbooks/export-supabase.md`

**Interfaces:**
- `exportPostgres(config, paths, runner)` returns `{ schemaFile, dataFile, countsFile, tableCount }`.
- It exports only the application `public` schema; Auth and Storage metadata use their supported APIs instead of raw internal schemas.
- It must invoke `pg_dump` twice: schema-only SQL and data-only custom-format dump.

- [ ] **Step 1: Write the failing tests**

Test that a fake runner receives these safe command shapes:

```text
pg_dump --schema=public --schema-only --no-owner --no-privileges --file=<schema.sql>
pg_dump --schema=public --data-only --format=custom --no-owner --no-privileges --file=<data.dump>
psql --set=ON_ERROR_STOP=1 --file=<counts.sql>
```

Also test that the returned evidence records exact output paths and that a
non-zero command code rejects the export.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because `exportPostgres` is not implemented.

- [ ] **Step 3: Implement the PostgreSQL export**

Implement the two `pg_dump` calls with the parsed `PG*` environment and a
generated counts query. The counts query must enumerate `public` base tables via
`information_schema.tables`, then execute an exact `SELECT count(*)` per table
with identifiers quoted by a dedicated `quoteIdentifier` function. Store:

- `postgres/schema.sql`
- `postgres/data.dump`
- `postgres/object-counts.json` with relation names and exact row counts
- command versions in `run.json` without connection details

The CLI must not call `pg_restore` against a remote database. The optional
restore verifier will require an explicit local `--restore-db` value later.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: PostgreSQL command construction, failure propagation and identifier
quoting tests pass.

## Task 4: Auth metadata export with pagination and redaction

**Files:**
- Modify: `scripts/export-supabase-lib.mjs`
- Modify: `scripts/export-supabase.mjs`
- Modify: `tests/export-supabase.test.js`
- Modify: `docs/runbooks/export-supabase.md`

**Interfaces:**
- `exportAuth(config, paths, fetchImpl)` returns `{ usersFile, userCount, pages }`.
- `fetchImpl` receives only the Supabase Auth admin endpoint and headers; its response is normalized before writing.
- The output user shape is `{ id, email, emailConfirmedAt, createdAt, updatedAt, lastSignInAt, phone, userMetadata, appMetadata, disabled }` with unsupported identity/session fields removed.

- [ ] **Step 1: Write the failing tests**

Mock two paginated responses from `/auth/v1/admin/users` and assert:

- both pages are fetched with `page` and bounded `per_page`;
- only the approved fields are written;
- `identities`, access tokens, refresh tokens, password hashes and raw headers are absent;
- HTTP errors stop the export and do not write a successful manifest.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because Auth pagination and redaction are not implemented.

- [ ] **Step 3: Implement Auth export**

Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in the in-memory request
header. Fetch bounded pages until a page returns fewer users than the page size.
Normalize timestamps to ISO strings, copy only explicitly allowed metadata keys,
and write `auth/users.json` outside the repository. Write
`auth/metadata.json` with count, page count and field policy, never the key.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: pagination, redaction and HTTP failure tests pass.

## Task 5: Storage inventory, streaming download and SHA-256

**Files:**
- Modify: `scripts/export-supabase-lib.mjs`
- Modify: `scripts/export-supabase.mjs`
- Modify: `tests/export-supabase.test.js`
- Modify: `docs/runbooks/export-supabase.md`

**Interfaces:**
- `exportStorage(config, paths, fetchImpl)` returns `{ manifestFile, objectCount, bucketCount }`.
- `listStorageObjects` must recurse through folders and paginate every bucket returned by the bucket list endpoint.
- `downloadStorageObject` streams bytes to disk while updating SHA-256; it must not buffer an entire object.

- [ ] **Step 1: Write the failing tests**

Test with mocked bucket/list/download responses that:

- exports all discovered buckets and nested object paths;
- follows pagination;
- writes one JSONL manifest row per object with bucket, path, MIME, bytes and hash;
- rejects `..`, absolute paths and path separators that escape the bucket directory;
- retries a transient download once, then fails deterministically;
- never writes a successful manifest for a partial object.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because Storage listing, safe paths and streaming hashes are not
implemented.

- [ ] **Step 3: Implement Storage export**

List buckets through the Storage API, recursively list objects with bounded
pages, and download each object through the authenticated object endpoint. Use
`crypto.createHash('sha256')` with a stream and write objects under
`storage/objects/<bucket>/<safe-path>`.

Append manifest rows only after the file stream closes successfully. Record HTTP
status and retry count in an internal error report without recording response
bodies or authorization headers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: bucket discovery, pagination, traversal protection, retry and hashing
tests pass.

## Task 6: Reconciliation metadata, checksums and encrypted sealing

**Files:**
- Modify: `scripts/export-supabase-lib.mjs`
- Modify: `scripts/export-supabase.mjs`
- Modify: `scripts/verify-supabase-export.mjs`
- Modify: `tests/export-supabase.test.js`

**Interfaces:**
- `writeRunManifest(paths, evidence)` writes `run.json`, `checksums.sha256` and reconciliation summaries.
- `sealRun(paths, recipient, runner)` returns the encrypted archive path and removes only the unsealed temporary archive after successful sealing.
- `verifyRun(runDir, options)` returns `{ ok, checks, errors, counts }` and exits nonzero when any check fails.

- [ ] **Step 1: Write the failing tests**

Test that:

- checksums include every final artifact except the checksum file itself;
- changing one byte makes verification fail;
- a run with missing schema, data, Auth or Storage evidence fails;
- sealing refuses an empty or failed run;
- a failed `age` process keeps the unsealed run for diagnosis and marks the run failed;
- no secret value appears in `run.json`, errors or command logs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: FAIL because manifest, sealing and verification are not implemented.

- [ ] **Step 3: Implement manifests and verification**

Implement:

- `run.json` with project reference, UTC timestamps, tool versions, artifact
  names, counts, status and redacted failure codes;
- `checksums.sha256` generated from stable relative paths sorted bytewise;
- `reconciliation/source-counts.json` combining PostgreSQL and Auth/Storage
  counts;
- `reconciliation/financial-totals.json` generated only from these exact
  aggregate queries, with query names and values but no row-level PII:

```sql
select json_build_object(
  'facturas', json_build_object(
    'count', (select count(*) from public.facturas),
    'abiertas', (select count(*) from public.facturas where estado = 'Abierta'),
    'monto_requerido', (select coalesce(sum(monto_requerido), 0) from public.facturas),
    'monto_recaudado', (select coalesce(sum(monto_recaudado), 0) from public.facturas)
  ),
  'donaciones', json_build_object(
    'count', (select count(*) from public.donaciones),
    'confirmadas_count', (select count(*) from public.donaciones where estado = 'Confirmada'),
    'confirmadas_monto', (select coalesce(sum(monto), 0) from public.donaciones where estado = 'Confirmada')
  ),
  'movimientos_factura', json_build_object(
    'count', (select count(*) from public.movimientos_factura),
    'monto', (select coalesce(sum(monto), 0) from public.movimientos_factura)
  )
);
```

- `reconciliation/rpc-samples.json` containing only RPC names, status, output
  keys and primitive type names for `estadisticas`, `seguimiento_factura` and
  `seguimiento_donaciones`; it must never store RPC values, tokens or raw
  `buscar_familiar` results;
- `tar` plus `age -r $env:EXPORT_AGE_RECIPIENT` streaming seal, with recipient
  supplied only by `EXPORT_AGE_RECIPIENT`;
- independent verification of files, checksums, manifest completeness and
  archive status.

The verifier must operate on an already decrypted run directory. If
`--restore-db` is supplied, it may invoke `pg_restore` only against a database
whose host is `127.0.0.1` or `localhost` and whose project target is
`demo-donaciones-venezuela`; it must reject every other host or project.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: manifest, tamper detection, sealing failure and redaction tests pass.

## Task 7: Runbook, git guardrails and operator checkpoints

**Files:**
- Create: `docs/runbooks/export-supabase.md`
- Modify: `BACKUP_RESTORE_PLAN.md:16-25,37-41`
- Modify: `.gitignore`

**Interfaces:**
- The runbook must document preparation, dry-run, explicit execution, decryption for verification and evidence collection.
- It must state that the operator confirms the execution checkpoint immediately before `--execute`.

- [ ] **Step 1: Write the documentation checks**

Use a documentation test or a deterministic text check that requires the runbook
to contain:

- the exact target reference `zryfwbjvlacorryzdaod`;
- `--dry-run` as the default and `--execute` as the explicit remote action;
- all required environment variable names without secret values;
- an external output path;
- no production, Blaze, destructive migration or credential export;
- the six verification controls and the operator checkpoint.

- [ ] **Step 2: Run the documentation check to verify it fails**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js -t "runbook"`

Expected: FAIL because the runbook and checks do not exist.

- [ ] **Step 3: Write the runbook and guardrails**

Document the following safe sequence:

```powershell
npm.cmd run export:supabase:dry-run
# detenerse y obtener confirmacion explicita del operador
npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod
npm.cmd run verify:export -- --run-dir "C:\\secure\\donaciones-export\\2026-08-06T120000Z"
```

Document that the final command is a template for the operator and must not be
run by an agent without a fresh checkpoint. Add `.gitignore` entries for
`backups/`, `exports/`, `*.dump` and `*.age`, plus `/exports/**/*.jsonl` and
`/exports/**/*.sql`, while preserving existing user changes.

Update `BACKUP_RESTORE_PLAN.md` to reference the runbook, distinguish a written
plan from a passed gate, and require the generated manifest/checksum evidence.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js -t "runbook"`

Expected: documentation and guardrail checks pass.

## Task 8: Full local verification and handoff

**Files:**
- Modify only files listed by previous tasks; no new application runtime files.

- [ ] **Step 1: Run the focused exporter tests**

Run: `npm.cmd exec vitest run tests/export-supabase.test.js`

Expected: all exporter tests pass without network access.

- [ ] **Step 2: Run the dry-run CLI**

Run: `npm.cmd run export:supabase:dry-run`

Expected: the CLI reports available/missing tool and variable names, exits 0
when only preparation checks are missing, and does not create a data artifact
or call a remote endpoint.

- [ ] **Step 3: Run the project verification suite**

Run: `npm.cmd run verify`

Expected: unit tests, emulator tests, build, audits and language verification
pass. Any existing moderate audit finding or Vite legacy warning is recorded,
not hidden.

- [ ] **Step 4: Inspect the final diff and status**

Run: `git status --short` and `git diff -- .gitignore BACKUP_RESTORE_PLAN.md package.json scripts tests docs/runbooks`

Expected: only exporter preparation files are changed; no `.env`, dump, Auth
export, Storage object or encrypted package is present in the repository.

## Follow-up Plans

After this plan passes and the operator approves the generated export package,
create separate plans for:

1. Importing reconciled Auth, Firestore documents and Storage objects into
   `donaciones-venezuela-4fc29`.
2. Rebuilding `services/api.js`, repositories and the `api` Function by domain.
3. Migrating the UI/session flows and removing the public family search.
4. Final Supabase cleanup, regression evidence and operator-approved cutover.

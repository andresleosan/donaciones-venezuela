# Runbook de exportacion Supabase

## Alcance de Tasks 3 y 4

El exportador prepara evidencia de PostgreSQL para el proyecto Supabase
`zryfwbjvlacorryzdaod`. Esta tarea solo exporta el schema `public` de la
aplicacion:

- `postgres/schema.sql`: dump schema-only.
- `postgres/data.dump`: dump data-only en formato custom.
- `postgres/object-counts.json`: conteo exacto por tabla base de `public`.
- `reconciliation/financial-totals.json`: agregados financieros sin filas ni PII.
- `run.json`: estado `prepared` y versiones de `pg_dump`/`psql`, sin datos de
  conexion. `completed` queda reservado para el sellado de Task 6.

Auth y Storage no se leen desde schemas internos. Se exportaran mediante sus
APIs soportadas en tareas separadas. El CLI no ejecuta `pg_restore` contra una
base remota.

### Auth metadata

En `--execute`, despues de PostgreSQL, el exportador consulta el endpoint
administrativo paginado:

```text
<SUPABASE_URL>/auth/v1/admin/users?page=<page>&per_page=100
```

La paginacion empieza en la pagina 1, termina cuando una respuesta trae menos
de 100 usuarios y tiene un limite seguro de 100 paginas. Una pagina repetida,
una secuencia que alcanza el limite, una respuesta HTTP fuera de 2xx o JSON
invalido falla el run antes de escribir evidencia Auth exitosa. Las pruebas
inyectan `fetchImpl`; no necesitan red ni credenciales reales.

Los artefactos se escriben en el staging externo del run:

- `auth/users.json`: una lista de usuarios con solo `id`, `email`,
  `emailConfirmedAt`, `createdAt`, `updatedAt`, `lastSignInAt`, `phone`,
  `userMetadata`, `appMetadata` y `disabled`.
- `auth/metadata.json`: conteo, paginas y la whitelist de campos aplicada.

Las fechas se normalizan a ISO. `userMetadata` solo admite
`display_name`, `full_name`, `name` y `avatar_url`; `appMetadata` solo admite
`provider`, `providers`, `role` y `roles`. Identidades, tokens de acceso y
refresco, hashes de contrasena, cabeceras sin procesar y cualquier otro campo
se descartan. El email es PII y solo puede permanecer en el paquete externo
protegido; nunca se imprime en logs, Git o metadata.

## Variables y rutas

Entregar los valores solo por el entorno seguro del operador. Nunca escribirlos
en el repositorio, argumentos, logs o manifiestos:

```text
SUPABASE_PROJECT_REF
SUPABASE_URL
SUPABASE_DB_URL
SUPABASE_SERVICE_ROLE_KEY
EXPORT_ROOT
EXPORT_AGE_RECIPIENT
EXPORT_EXECUTION_APPROVED
```

`EXPORT_ROOT` o `--run-dir` debe ser una ruta absoluta externa al repositorio,
con permisos restringidos. El entorno explicito que recibe `runCommand`
reemplaza `process.env`: solo contiene `PGHOST`, `PGPORT`, `PGUSER`,
`PGDATABASE`, `PGPASSWORD` y `PGSSLMODE=require`. Los ejecutables se resuelven
localmente a rutas absolutas antes de invocarlos.

## Secuencia segura

El agente no ejecuta la secuencia `--execute` sin un checkpoint nuevo y
confirmacion explicita del operador inmediatamente antes de abrir red. El modo
`--execute` exige que el entorno contenga exactamente
`EXPORT_EXECUTION_APPROVED=YES`; el modo `--dry-run` no lee ni exige esta
variable.

```powershell
npm.cmd run export:supabase:dry-run
# detenerse y obtener confirmacion explicita del operador
$env:EXPORT_EXECUTION_APPROVED = 'YES'
npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod
```

El modo predeterminado es `--dry-run`; valida nombres de variables, rutas y
herramientas locales sin red, dumps ni artefactos de datos. En estas Tasks 3 y 4
las pruebas usan runners y `fetchImpl` falsos y no ejecutan `pg_dump`, `psql`,
Auth remoto, Firebase remoto, migraciones ni comandos que creen artefactos fuera
de fixtures.

## Conteos y reconciliacion

La consulta enumera tablas base mediante `information_schema.tables` limitada a
`table_schema = 'public'`, genera un `SELECT count(*)` por tabla con
identificadores citados de forma segura y guarda solo nombres de relacion y
conteos. La consulta financiera ejecutable es:

```sql
select json_build_object(
  'facturas', json_build_object(
    'count', (select count(*)::text from "public"."facturas"),
    'abiertas', (select count(*)::text from "public"."facturas" where estado = 'Abierta'),
    'monto_requerido', (select coalesce(sum(monto_requerido), 0)::text from "public"."facturas"),
    'monto_recaudado', (select coalesce(sum(monto_recaudado), 0)::text from "public"."facturas")
  ),
  'donaciones', json_build_object(
    'count', (select count(*)::text from "public"."donaciones"),
    'confirmadas_count', (select count(*)::text from "public"."donaciones" where estado = 'Confirmada'),
    'confirmadas_monto', (select coalesce(sum(monto), 0)::text from "public"."donaciones" where estado = 'Confirmada')
  ),
  'movimientos_factura', json_build_object(
    'count', (select count(*)::text from "public"."movimientos_factura"),
    'monto', (select coalesce(sum(monto), 0)::text from "public"."movimientos_factura")
  )
);
```

Cada linea no vacia de `psql` debe ser JSON valido. La salida debe contener al
menos una relacion `public` sin duplicados y exactamente un bloque financiero
con todos los campos aprobados. Conteos e importes se serializan como strings
decimales exactos; una salida vacia, parcial, duplicada o con un decimal invalido
rechaza el run antes de escribir la evidencia final.

No se guardan nombres de donantes, comprobantes, tokens, cabeceras ni filas
individuales en esta evidencia.

## Fallos y verificacion

Un codigo de salida distinto de cero bloquea la exportacion. El run queda
`failed`, conserva solo un codigo seguro y se limpia `temp/`; no se borran
runs anteriores ni dumps parciales de diagnostico. Antes de aprobar un paquete,
el operador debe comprobar los checksums, restaurar en una base local aislada,
comparar conteos y totales, verificar Auth/Storage cuando existan sus tareas,
y registrar cualquier diferencia sin explicar.

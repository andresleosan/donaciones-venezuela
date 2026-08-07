# Runbook de exportacion Supabase

## Alcance de Task 3

El exportador prepara evidencia de PostgreSQL para el proyecto Supabase
`zryfwbjvlacorryzdaod`. Esta tarea solo exporta el schema `public` de la
aplicacion:

- `postgres/schema.sql`: dump schema-only.
- `postgres/data.dump`: dump data-only en formato custom.
- `postgres/object-counts.json`: conteo exacto por tabla base de `public`.
- `reconciliation/financial-totals.json`: agregados financieros sin filas ni PII.
- `run.json`: estado y versiones de `pg_dump`/`psql`, sin datos de conexion.

Auth y Storage no se leen desde schemas internos. Se exportaran mediante sus
APIs soportadas en tareas separadas. El CLI no ejecuta `pg_restore` contra una
base remota.

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
```

`EXPORT_ROOT` o `--run-dir` debe ser una ruta absoluta externa al repositorio,
con permisos restringidos. El entorno explicito que recibe `runCommand`
reemplaza `process.env`: solo contiene `PGHOST`, `PGPORT`, `PGUSER`,
`PGDATABASE`, `PGPASSWORD` y `PGSSLMODE=require`. Los ejecutables se resuelven
localmente a rutas absolutas antes de invocarlos.

## Secuencia segura

El agente no ejecuta la secuencia `--execute` sin un checkpoint nuevo y
confirmacion explicita del operador inmediatamente antes de abrir red.

```powershell
npm.cmd run export:supabase:dry-run
# detenerse y obtener confirmacion explicita del operador
npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod
```

El modo predeterminado es `--dry-run`; valida nombres de variables, rutas y
herramientas locales sin red, dumps ni artefactos de datos. En esta Task 3 las
pruebas usan runners falsos y no ejecutan `pg_dump`, `psql`, Firebase remoto,
migraciones ni comandos que creen artefactos fuera de fixtures.

## Conteos y reconciliacion

La consulta enumera tablas base mediante `information_schema.tables` limitada a
`table_schema = 'public'`, genera un `SELECT count(*)` por tabla con
identificadores citados de forma segura y guarda solo nombres de relacion y
conteos. La consulta financiera ejecutable es:

```sql
select json_build_object(
  'facturas', json_build_object(
    'count', (select count(*) from "public"."facturas"),
    'abiertas', (select count(*) from "public"."facturas" where estado = 'Abierta'),
    'monto_requerido', (select coalesce(sum(monto_requerido), 0) from "public"."facturas"),
    'monto_recaudado', (select coalesce(sum(monto_recaudado), 0) from "public"."facturas")
  ),
  'donaciones', json_build_object(
    'count', (select count(*) from "public"."donaciones"),
    'confirmadas_count', (select count(*) from "public"."donaciones" where estado = 'Confirmada'),
    'confirmadas_monto', (select coalesce(sum(monto), 0) from "public"."donaciones" where estado = 'Confirmada')
  ),
  'movimientos_factura', json_build_object(
    'count', (select count(*) from "public"."movimientos_factura"),
    'monto', (select coalesce(sum(monto), 0) from "public"."movimientos_factura")
  )
);
```

No se guardan nombres de donantes, comprobantes, tokens, cabeceras ni filas
individuales en esta evidencia.

## Fallos y verificacion

Un codigo de salida distinto de cero bloquea la exportacion. El run queda
`failed`, conserva solo un codigo seguro y se limpia `temp/`; no se borran
runs anteriores ni dumps parciales de diagnostico. Antes de aprobar un paquete,
el operador debe comprobar los checksums, restaurar en una base local aislada,
comparar conteos y totales, verificar Auth/Storage cuando existan sus tareas,
y registrar cualquier diferencia sin explicar.

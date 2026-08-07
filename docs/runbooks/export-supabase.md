# Runbook de exportacion Supabase

## Alcance de Tasks 3 a 5

El exportador prepara evidencia de PostgreSQL para el proyecto Supabase
`zryfwbjvlacorryzdaod`. Esta tarea solo exporta el schema `public` de la
aplicacion:

- `postgres/schema.sql`: dump schema-only.
- `postgres/data.dump`: dump data-only en formato custom.
- `postgres/object-counts.json`: conteo exacto por tabla base de `public`.
- `reconciliation/financial-totals.json`: agregados financieros sin filas ni PII.
- `run.json`: estado `prepared` y versiones de `pg_dump`/`psql`, sin datos de
  conexion. `completed` queda reservado para el sellado de Task 6.

Auth y Storage no se leen desde schemas internos. Se exportan mediante sus APIs
soportadas. El CLI no ejecuta `pg_restore` contra una base remota.

### Auth metadata

En `--execute`, despues de PostgreSQL, el exportador consulta el endpoint
administrativo paginado:

```text
<SUPABASE_URL>/auth/v1/admin/users?page=<page>&per_page=100
```

La paginacion empieza en la pagina 1, termina cuando una respuesta trae menos
de 100 usuarios y tiene un limite seguro de 100 paginas. Una respuesta con mas
de 100 usuarios, un ID solapado entre paginas, una pagina repetida, una
secuencia que alcanza el limite, una respuesta HTTP fuera de 2xx o JSON
invalido falla el run antes de escribir evidencia Auth exitosa. La validacion
del helper exige, independientemente del CLI, el origen exacto aprobado, el
project reference aprobado y modo `execute` antes de leer la clave.

Las pruebas inyectan `fetchImpl` y el tiempo de referencia; no necesitan red ni
credenciales reales.

Los artefactos se escriben en el staging externo del run:

- `auth/users.json`: una lista de usuarios con solo `id`, `email`,
  `emailConfirmedAt`, `createdAt`, `updatedAt`, `lastSignInAt`, `phone`,
  `userMetadata`, `appMetadata` y `disabled`.
- `auth/metadata.json`: conteo, paginas y la whitelist de campos aplicada.

Las fechas se normalizan a ISO. `disabled` conserva el booleano entregado por
Supabase y tambien se activa si `banned_until` es un timestamp futuro respecto
al tiempo de referencia del run; un baneo vencido no desactiva el usuario. El
campo `banned_until` nunca se escribe. `userMetadata` solo admite
`display_name`, `full_name`, `name` y `avatar_url`; `appMetadata` solo admite
`provider`, `providers`, `role` y `roles`. Identidades, tokens de acceso y
refresco, hashes de contrasena, cabeceras sin procesar y cualquier otro campo
se descartan. El email es PII y solo puede permanecer en el paquete externo
protegido; nunca se imprime en logs, Git o metadata.

La publicacion usa primero `temp/auth-users.json.tmp` y
`temp/auth-metadata.json.tmp`. Solo despues de completar ambos se renombran a
`auth/users.json` y `auth/metadata.json`. Si una escritura o renombrado falla,
se eliminan los temporales y los dos finales; el flujo del CLI marca el run
como `failed` y limpia el resto de `temp/`.

### Storage de objetos

En `--execute`, despues de Auth, el exportador consulta solo la API soportada
de Storage con la clave administrativa en cabeceras de memoria:

- `GET <SUPABASE_URL>/storage/v1/bucket?limit=100&offset=<offset>` para
  descubrir todos los buckets.
- `POST <SUPABASE_URL>/storage/v1/object/list/<bucket>` con `prefix`, `limit`,
  `offset` y orden por nombre para listar cada pagina.
- `GET <SUPABASE_URL>/storage/v1/object/authenticated/<bucket>/<path>` para
  descargar cada objeto.

Cada bucket y cada prefijo tiene un limite de paginas. Los nombres repetidos o
solapados entre paginas, los prefijos repetidos y una respuesta mayor al limite
seguro detienen la exportacion. Las carpetas se recorren hasta agotar sus
paginas. Los buckets, segmentos de objeto y rutas absolutas se validan antes de
usarse en el filesystem; se rechazan `..`, `.` ambiguo, slash inverso,
separadores vacios, nombres reservados de Windows, caracteres de control y
destinos que no permanezcan dentro de `storage/objects/<bucket>`.

La respuesta de cada objeto se procesa como stream con SHA-256 y conteo de
bytes. No se usa `arrayBuffer`, no se guarda el payload en memoria y no se
escriben objetos directamente en su destino final:

- `storage/objects/<bucket>/<path>`: objeto publicado solo despues de cerrar
  correctamente el stream.
- `storage/manifest.jsonl`: una linea por objeto con `bucket`, `path`, `bytes`,
  `mime` y `sha256`; se construye en `temp/` y se renombra solo al completar
  todos los objetos.
- `storage/error-report.json`: solo si hubo reintentos o fallos; contiene
  unicamente la operacion, el estado HTTP (o `network`) y el numero de
  reintentos. Nunca contiene cabeceras, cuerpos remotos, claves ni rutas de
  objetos.

Solo se reintenta una vez un fallo de red o HTTP `408`, `429` o `5xx`. Un fallo
de stream elimina el temporal del objeto y no agrega una linea al manifiesto.
El helper valida el proyecto exacto `zryfwbjvlacorryzdaod`, el origen HTTPS
exacto y `mode=execute` antes de leer `SUPABASE_SERVICE_ROLE_KEY`.

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
herramientas locales sin red, dumps ni artefactos de datos. En estas Tasks 3 a 5
las pruebas usan runners, streams de Node y `fetchImpl` falsos y no ejecutan
`pg_dump`, `psql`, Auth remoto, Storage remoto, Firebase remoto, migraciones ni
comandos que creen artefactos fuera de fixtures. Los runs de `--execute` siguen
en `prepared`; `completed` queda reservado para el sellado de Task 6.

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

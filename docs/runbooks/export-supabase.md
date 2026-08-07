# Runbook de exportacion Supabase

## Alcance de Tasks 3 a 7

El exportador prepara evidencia de PostgreSQL para el proyecto Supabase
`zryfwbjvlacorryzdaod`. Esta tarea solo exporta el schema `public` de la
aplicacion:

- `postgres/schema.sql`: dump schema-only.
- `postgres/data.dump`: dump data-only en formato custom.
- `postgres/object-counts.json`: conteo exacto por tabla base de `public`.
- `reconciliation/financial-totals.json`: agregados financieros sin filas ni PII.
- `run.json`: estado `prepared` y versiones de `pg_dump`/`psql`, sin datos de
  conexion. `completed` significa que la evidencia local, el manifest y los
  checksums estan completos y habilita el sellado; no confirma que exista el
  archivo cifrado.

Auth y Storage no se leen desde schemas internos. Se exportan mediante sus APIs
soportadas. El CLI no ejecuta `pg_restore` contra una base remota.

## Preparacion local y limites

Este runbook prepara una exportacion verificable del proyecto Supabase con
referencia exacta `zryfwbjvlacorryzdaod`. No es una autorizacion de acceso
remoto: la autorizacion de cada ejecucion pertenece al operador.

Antes de abrir la red, el operador debe:

1. Trabajar desde una copia local del repositorio con Node.js 20 o posterior y
   las herramientas locales `pg_dump`, `psql`, `pg_restore`, `tar` y `age`.
2. Confirmar que `EXPORT_ROOT` y cualquier `--run-dir` son rutas absolutas,
   externas al repositorio, con permisos restringidos. Un ejemplo de ruta
   externa es `C:\\secure\\donaciones-export`; no debe convertirse en una
   carpeta del repositorio.
3. Cargar los nombres de variables requeridas mediante el entorno seguro del
   operador, sin escribir sus valores en archivos, argumentos, historial,
   logs, manifiestos o este runbook.
4. Comprobar que el destino sigue siendo el proyecto exacto
   `zryfwbjvlacorryzdaod` y que la ventana de trabajo fue aprobada.

El modo predeterminado es `--dry-run`: solo revisa la preparacion local, los
nombres de variables, las rutas y las herramientas. No hace red, dumps,
descargas, sellado ni crea artefactos de datos. Solo `--execute` es la accion
remota explicita; tambien es la unica opcion que puede abrir red y producir la
exportacion.

Esta tarea no ejecuta una migracion destructiva, no modifica ni elimina datos
remotos y no se permite exportar credenciales, contrasenas, hashes, sesiones, refresh
tokens, PINs ni valores secretos. No es produccion y no autoriza ningun acceso
a produccion. Blaze permanece deshabilitado y no se activa por este runbook.

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

Solo se reintenta una vez un fallo de red identificado por codigo (incluido un
codigo en `cause`) o HTTP `408`, `429` o `5xx`. Las excepciones de programacion
o configuracion y el JSON invalido fallan sin retry. Un fallo de stream elimina
el temporal del objeto; si falla un objeto posterior, tambien se eliminan todos
los objetos publicados por ese mismo export antes de propagar el error. No se
tocan runs anteriores y no se agrega una linea al manifiesto.
El helper valida el proyecto exacto `zryfwbjvlacorryzdaod`, el origen HTTPS
exacto y `mode=execute` antes de leer `SUPABASE_SERVICE_ROLE_KEY`.

## Variables y rutas

Entregar los valores solo por el entorno seguro del operador. La siguiente
lista contiene nombres, no valores; nunca escribir valores en el repositorio,
argumentos, logs o manifiestos:

```text
SUPABASE_PROJECT_REF
SUPABASE_URL
SUPABASE_DB_URL
SUPABASE_SERVICE_ROLE_KEY
EXPORT_ROOT
EXPORT_AGE_RECIPIENT
```

`EXPORT_EXECUTION_APPROVED` es una variable separada de control del checkpoint,
no un secreto. En modo `--execute` debe estar establecida por el operador como
`YES` inmediatamente antes de la accion remota; no se usa en `--dry-run`.

`EXPORT_ROOT` o `--run-dir` debe ser una ruta absoluta externa al repositorio,
con permisos restringidos. El entorno explicito que recibe `runCommand`
reemplaza `process.env`: solo contiene `PGHOST`, `PGPORT`, `PGUSER`,
`PGDATABASE`, `PGPASSWORD` y `PGSSLMODE=require`. Los ejecutables se resuelven
localmente a rutas absolutas antes de invocarlos.

## Secuencia PowerShell segura

El agente no ejecuta la secuencia `--execute` sin un checkpoint nuevo y
confirmacion explicita del operador inmediatamente antes de abrir red. El
operador debe cargar `EXPORT_EXECUTION_APPROVED=YES` en la sesion aprobada antes
del bloque siguiente y confirmar de nuevo el proyecto, la ruta externa y la
ventana. El comando final es una plantilla para el operador: un agente no puede
ejecutar `--execute` sin una confirmacion fresca inmediatamente antes.

```powershell
npm.cmd run export:supabase:dry-run
# detenerse y obtener confirmacion explicita del operador
$env:EXPORT_EXECUTION_APPROVED = 'YES'
npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod
npm.cmd run verify:export -- --run-dir "C:\\secure\\donaciones-export\\2026-08-06T120000Z"
```

La asignacion solo se realiza despues de una confirmacion fresca del operador
para el target, la ruta externa y la ventana. Si la confirmacion cambia, se debe
retirar la variable y repetir el checkpoint. En estas Tasks 3 a 7 las pruebas usan runners, streams de Node y `fetchImpl` falsos y no ejecutan
`pg_dump`, `psql`, Auth remoto, Storage remoto, Firebase remoto, migraciones ni
comandos que creen artefactos fuera de fixtures. Los runs de `--execute` pasan a
`completed` al terminar la evidencia local y los checksums; el archive status es
un control separado que se comprueba despues del sellado.

## Lifecycle del run y temporales

El estado `completed` habilita `sealRun` porque indica que el manifest,
reconciliacion, artefactos requeridos y `checksums.sha256` ya fueron verificados
localmente. No implica que el archivo `.tar.age` exista todavía. El archive
status se aprueba por separado cuando el archivo cifrado existe, no esta vacio y
la verificacion lo encuentra.

`temp/` queda fuera de `artifacts` y del archive cifrado. `temp/run.tar` solo se
elimina despues de un sellado exitoso. `temp/counts.sql` y otros temporales
diagnosticos pueden conservarse segun el resultado para investigar un fallo;
no se debe exigir que `temp/` este vacio para aprobar los controles de evidencia.

## Desencriptado, verificacion y evidencia

El archivo cifrado se crea fuera del repositorio, junto al directorio del run,
con extension `.tar.age`. El operador debe desencriptarlo en una ruta externa
de verificacion, sin reemplazar un run anterior y sin poner el contenido
desencriptado en Git. La identidad privada y su contenido se entregan por el
gestor seguro; no se copia el secreto al comando, historial o evidencia. El
placeholder del siguiente comando representa solo una ruta administrada por el
operador. Es una plantilla operativa, no un comando para un agente:

```powershell
age --decrypt --identity <AGE_IDENTITY_FILE> --output "C:\\secure\\donaciones-export\\2026-08-06T120000Z.tar" "C:\\secure\\donaciones-export\\2026-08-06T120000Z.tar.age"
tar --extract --file="C:\\secure\\donaciones-export\\2026-08-06T120000Z.tar" --directory="C:\\secure\\donaciones-export\\2026-08-06T120000Z"
npm.cmd run verify:export -- --run-dir "C:\\secure\\donaciones-export\\2026-08-06T120000Z"
```

La salida del verificador, el `run.json`, `checksums.sha256`, los manifiestos y
los conteos se conservan en una ubicacion externa aprobada como evidencia de la
ejecucion. La evidencia debe registrar fecha UTC, responsable, target exacto,
resultado de cada control y cualquier diferencia explicada, pero nunca filas
con PII, claves, contrasenas, tokens, identidades de `age` o valores de las
variables.

## Seis controles de verificacion

El paquete no se aprueba hasta que los seis controles tengan resultado y
evidencia:

1. **Estructura y completitud:** el directorio desencriptado contiene
   `run.json` con estado `completed` y todos los artefactos requeridos. `temp/`
   queda fuera de este control y puede conservar temporales diagnosticos.
2. **Manifest:** `run.json` enumera los artefactos finales y
   `storage/manifest.jsonl` tiene una fila por objeto, buckets consistentes y
   ninguna fila duplicada o ruta insegura.
3. **Checksums y tamper:** `checksums.sha256` cubre todos los artefactos salvo
   el propio archivo; `verify:export` debe detectar cualquier cambio de bytes,
   checksum o integridad.
4. **Reconciliacion y conteos:** `source-counts.json`, conteos de PostgreSQL,
   Auth y Storage, totales financieros y filas del manifest coinciden; no se
   aceptan diferencias sin explicar.
5. **Archive status:** existe un archivo `.tar.age` no vacio junto al run y el
   verificador informa el archive status como aprobado.
6. **Restore local opcional para la verificacion general (localhost):** para la
   verificacion general se puede omitir, pero si se hace un ensayo usar solo una
   base aislada en `localhost` o `127.0.0.1`, con el target local
   `demo-donaciones-venezuela`; nunca una base remota. Si no se ejecuta, registrar
   `restore: not-run` y el motivo. Ejemplo sin credencial:

   ```powershell
   npm.cmd run verify:export -- --run-dir "C:\\secure\\donaciones-export\\2026-08-06T120000Z" --restore-db "postgres://restore@127.0.0.1/demo_restore" --project-target demo-donaciones-venezuela
   ```

   El ensayo aislado restaura primero `postgres/schema.sql` con `psql` usando
   `ON_ERROR_STOP=1` y solo despues carga `postgres/data.dump` con `pg_restore`.
   Si falla cualquier control previo, no se invoca ningun comando de restore.

Un control fallido bloquea la aprobacion del paquete y obliga a registrar el
motivo antes de repetir la verificacion.

## Conteos y reconciliacion

La consulta enumera tablas base mediante `information_schema.tables` limitada a
`table_schema = 'public'`, genera un `SELECT count(*)` por tabla con
identificadores citados de forma segura y guarda solo nombres de relacion y
conteos. La consulta financiera ejecutable es:

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

Cada linea no vacia de `psql` debe ser JSON valido. La salida debe contener al
menos una relacion `public` sin duplicados y exactamente un bloque financiero
con todos los campos aprobados. Conteos e importes se serializan como strings
decimales exactos; una salida vacia, parcial, duplicada o con un decimal invalido
rechaza el run antes de escribir la evidencia final.

No se guardan nombres de donantes, comprobantes, tokens, cabeceras ni filas
individuales en esta evidencia.

## Fallos y verificacion

Un codigo de salida distinto de cero bloquea la exportacion. Un fallo antes del
sellado deja el run en `failed`, conserva solo un codigo seguro y puede limpiar
el staging temporal de esa fase; no se borran runs anteriores ni dumps parciales
de diagnostico. Un fallo de `age` durante el sellado elimina el archivo cifrado
parcial, conserva cualquier `temp/run.tar` existente y otros temporales diagnosticos para investigar,
y deja el run en `failed`; solo un sellado exitoso elimina `temp/run.tar`.
Antes de aprobar un paquete, el operador debe comprobar los checksums, el
archive status, restaurar en una base local aislada cuando corresponda,
comparar conteos y totales, verificar Auth/Storage cuando existan sus tareas, y
registrar cualquier diferencia sin explicar.

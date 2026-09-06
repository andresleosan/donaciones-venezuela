# Especificacion: migracion Firebase-only

**Fecha:** 2026-08-06  
**Proyecto:** Donaciones Venezuela  
**Estado:** diseno aprobado por el operador; pendiente de plan de implementacion  
**Nivel Cronos:** 3

## Contexto

La aplicacion actual usa HTML, CSS y JavaScript vanilla, Supabase Auth,
PostgreSQL, Supabase Storage y una Edge Function con aproximadamente 65
acciones de negocio. La preparacion local de Firebase ya existe y el proyecto
real de desarrollo es `donaciones-venezuela-4fc29`.

La prioridad es retirar Supabase como dependencia funcional y hacer que Firebase
sea la fuente de verdad. Se permite reconstruir modulos cuando el codigo legacy
impida una migracion segura, pero se conservara temporalmente la interfaz que la
UI ya consume para reducir regresiones.

Existe un hallazgo critico previo a la migracion: `buscar_familiar` expone PII
desde un RPC publico `SECURITY DEFINER` y el navegador conserva sus resultados en
IndexedDB sin TTL. Esta ruta no se trasladara como lectura anonima.

## Objetivos

- Preparar una exportacion verificable de PostgreSQL, Auth y Storage de Supabase.
- Cargar una copia reconciliada en el proyecto Firebase real de desarrollo.
- Convertir Auth, lecturas, escrituras, archivos y acciones privilegiadas a
  Firebase por dominios.
- Mantener rollback por dominio mientras Supabase siga disponible.
- Eliminar del runtime el SDK, endpoints, claves y funciones de Supabase.
- Dejar una aplicacion que use Firebase como unica fuente de datos funcional.

## Fuera de alcance

- Crear proyectos de staging o produccion.
- Activar Blaze o generar gasto sin confirmacion explicita.
- Ejecutar migraciones destructivas sobre Supabase.
- Copiar contrasenas, hashes no soportados, refresh tokens, sesiones, PINs o
  secretos.
- Mantener una busqueda anonima de nombres, cedulas o ubicaciones familiares.
- Redisenar la UI o cambiarla a React/Vue.

## Arquitectura objetivo

```text
UI vanilla
  -> fachada temporal SheetsService/services/api.js
     -> repositorios Firebase para lecturas
     -> Cloud Function api para operaciones privilegiadas

Firebase Auth -> ID tokens -> Function api -> Firestore/Storage
Firestore -> documentos canonicos privados + proyecciones publicas sanitizadas
Storage -> objetos privados por defecto + paths y URLs temporales autorizadas
```

### Identidad

- Firebase Authentication sera la unica sesion funcional.
- El frontend usara `onAuthStateChanged`, persistencia del SDK y
  `getIdToken()`.
- Se eliminara la sesion propia `dv-sesion` y cualquier refresh token gestionado
  por la aplicacion.
- Los roles se expresaran mediante custom claims y comprobaciones server-side.
- Las cuentas importadas no recibiran contrasenas desde Supabase. Se conservara
  el UID cuando sea valido y se enviara un flujo de restablecimiento de
  contrasena.

### Datos

- Firestore sera la fuente de verdad despues de la reconciliacion.
- Los IDs de documentos seran deterministas o conservaran un mapa estable desde
  la clave primaria de PostgreSQL.
- Las proyecciones publicas se construiran desde allowlists; nunca se intentara
  ocultar PII mediante reglas sobre una consulta amplia.
- Facturas, donaciones, reservas, cupos, numeracion y agregados usaran
  transacciones o escrituras por lote con idempotency keys.

### Function `api`

- Mantendra inicialmente el contrato de las 65 acciones para permitir una
  migracion por dominios.
- Verificara el header `Authorization: Bearer <Firebase ID token>`.
- Validara metodo, origen, esquema de entrada, claim, ownership y rate limit.
- Devolvera errores estables sin secretos, tokens, PII innecesaria ni trazas
  internas.
- Se podra reescribir internamente por modulo sin obligar a conservar la
  implementacion de la Edge Function.

### Privacidad familiar

- `buscar_familiar` se retira del acceso anonimo.
- Si el negocio requiere la capacidad, sera una accion autenticada con un claim
  explicito, respuesta minimizada y sin cedula o ubicacion completa por defecto.
- Sus resultados no se guardaran en la cache offline ni en IndexedDB sin una
  politica especifica, TTL y autorizacion documentada.

## Exportacion de Supabase

La exportacion se preparara como un runbook y scripts locales, pero su ejecucion
contra datos reales sera un checkpoint separado. Los secretos se entregaran por
variables de entorno o un gestor seguro, nunca por archivos versionados.

### Entradas

- Referencia del proyecto Supabase: `zryfwbjvlacorryzdaod`.
- URL de conexion PostgreSQL para `pg_dump` y restauracion aislada.
- Credenciales temporales autorizadas para Auth y Storage, si la herramienta
  oficial las requiere.
- Ruta de salida fuera del repositorio y con acceso limitado.
- Proyecto Firebase destino: `donaciones-venezuela-4fc29`.

El proceso validara la presencia de variables sin imprimir sus valores y
rechazara una ruta de salida dentro del repositorio.

### Artefactos

```text
<export-root>/<timestamp>/
  run.json
  checksums.sha256
  postgres/
    schema.sql
    data.dump
    object-counts.json
  auth/
    users.json
    metadata.json
  storage/
    manifest.jsonl
    objects/<bucket>/<path>
  reconciliation/
    source-counts.json
    financial-totals.json
    rpc-samples.json
```

- `data.dump` sera restaurable en PostgreSQL aislado.
- `users.json` contendra solo UID, email y metadata permitida para el flujo de
  importacion; no contendra credenciales ni sesiones.
- `manifest.jsonl` registrara bucket, path, bytes, MIME y SHA-256 por objeto.
- `checksums.sha256` y `run.json` permitiran verificar integridad, herramienta,
  version, responsable y fecha UTC.
- Ningun artefacto con PII se guardara en Git, `graphify-out`, `dist` o el repo.

### Validacion del export

Antes de importar:

1. Verificar checksums del paquete.
2. Restaurar el dump en un entorno aislado sin rutas hacia produccion.
3. Comparar conteos por tabla, totales financieros y relaciones.
4. Verificar una muestra controlada de respuestas historicas sin publicar PII.
5. Verificar los checksums de Storage y la metadata de cada objeto.
6. Registrar diferencias y bloquear el import si alguna queda sin explicar.

## Importacion a Firebase

- La carga masiva usara Firebase Admin SDK desde un proceso controlado, nunca
  credenciales Admin en el navegador.
- El importador sera reanudable e idempotente mediante IDs estables y un
  manifiesto de elementos procesados.
- Se importaran primero documentos base, luego relaciones, agregados y
  proyecciones publicas.
- Auth se importara con metadata permitida y restablecimiento de contrasena; no
  se copiaran hashes ni refresh tokens.
- Storage se copiara por path, se verificara SHA-256 y se mantendra privado por
  defecto.
- Firestore y Storage permaneceran deny-by-default hasta que las Rules tengan
  pruebas para cada ruta que se vaya a abrir.
- El resultado incluira conteos destino, totales, relaciones y checksums para
  comparar con el paquete fuente.

La ejecucion de esta carga sobre Firebase real requiere confirmacion explicita
del operador despues de revisar el paquete exportado. Si Firebase exige Blaze
para un componente, se detendra antes de habilitar facturacion.

## Migracion funcional por dominios

1. Auth, sesion y claims.
2. Lecturas publicas mediante proyecciones y repositorios.
3. Storage privado y flujos de archivos.
4. Function `api` por grupos: perfiles, lugares/insumos, donaciones/facturas,
   transporte/viajes, denuncias y administracion.
5. Frontend contra la fachada Firebase.
6. Eliminacion de referencias funcionales a Supabase.

Durante la transicion, la fachada podra seleccionar el backend por dominio. Esta
compatibilidad sera temporal y se eliminara en la fase de limpieza; no se
agregara como abstraccion permanente sin una necesidad concreta.

## Errores y rollback

- Cada dominio tendra estado `pendiente`, `importado`, `reconciliado`, `activo`
  o `bloqueado`.
- Los errores de transformacion, autorizacion, relacion o checksum bloquearan
  el dominio y quedaran registrados sin PII innecesaria.
- Repetir una importacion no duplicara documentos, usuarios ni objetos.
- Supabase permanecera intacto durante la migracion y servira de referencia de
  rollback.
- Si un dominio falla, se detendra ese dominio y se podra enrutar temporalmente
  al adaptador anterior mientras se reconcilian las escrituras Firebase.
- No se eliminaran tablas, objetos, usuarios ni funciones de Supabase hasta el
  cierre de todos los dominios y la aprobacion del corte.

## Pruebas y aceptacion

### Exportacion y reconciliacion

- Restauracion aislada exitosa.
- Conteos por tabla y coleccion sin diferencias inexplicadas.
- Totales financieros, estados y relaciones reconciliados.
- Checksums de Storage coincidentes.
- Manifiesto y evidencia fuera del repositorio.

### Firebase real de desarrollo

- Registro, login, logout, expiracion y cambio de contrasena con cuentas de
  prueba dedicadas.
- Claims de usuario, panel y admin; denegacion de claim ausente o revocado.
- Smoke de lecturas publicas, operaciones principales, archivos y offline.
- Verificacion de que no se accede a produccion ni se usan secretos del repo.

### Rules, contratos y regresion

- Rules para anonimo, usuario, panel, admin y propietario.
- Contratos de las 65 acciones con token invalido, rol incorrecto, esquema
  invalido, duplicados, rate limit y concurrencia.
- Pruebas deterministas con Emulator Suite y smoke final contra el proyecto de
  desarrollo real.
- `npm.cmd run verify` exitoso y sin fallos abiertos.

### Limpieza final

- Busqueda global sin referencias Supabase en runtime, dependencias, endpoints,
  CSP o configuracion.
- Build reproducible y verificacion manual de los flujos principales.
- `MIGRATION_REPORT.md` con conteos, diferencias, decisiones y rollback.
- Confirmacion explicita antes de borrar Supabase o desplegar cualquier entorno.

## Checkpoints obligatorios

1. Aprobacion de este diseno.
2. Confirmacion para ejecutar la exportacion de Supabase.
3. Revision del paquete y aprobacion para importar a Firebase real.
4. Confirmacion separada si alguna accion requiere Blaze, despliegue o gasto.
5. Aprobacion de reconciliacion y corte por dominio.
6. Aprobacion final para eliminar Supabase.

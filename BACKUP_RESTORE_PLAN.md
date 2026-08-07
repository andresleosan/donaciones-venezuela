# Plan de backup, restauracion y reversion

Este documento define el procedimiento y sus gates. No autoriza ni ejecuta acceso a produccion, exportaciones, restauraciones o migraciones.

## Alcance del respaldo

- PostgreSQL: esquema, tablas, vistas, funciones, triggers y conteos por tabla.
- Supabase Auth: exportacion soportada de usuarios y metadata; nunca hashes no soportados, refresh tokens ni sesiones.
- Storage: inventario por bucket, tamano, MIME y checksum SHA-256 de cada objeto.
- Configuracion: inventario de RLS, politicas de Storage, variables y secretos por nombre, sin copiar valores secretos al repositorio.

## Proteccion

El backup debe cifrarse, guardarse en una ubicacion aprobada fuera del repositorio y quedar limitado al personal responsable de la migracion. Cada ejecucion registrara responsable, fecha UTC, origen, herramienta y version, ubicacion, checksum del respaldo y resultado de la verificacion. Ningun secreto o respaldo se guarda en Git.

## Procedimiento de exportacion

La secuencia operativa, el checkpoint de ejecucion y la verificacion se
describen en [`docs/runbooks/export-supabase.md`](docs/runbooks/export-supabase.md).
Este plan define controles y gates; el runbook no autoriza por si solo una
ejecucion remota.

1. Confirmar por escrito el proyecto y la ventana autorizados antes de usar credenciales productivas.
2. Exportar PostgreSQL con la herramienta soportada por Supabase/PostgreSQL, incluyendo esquema y datos, sin imprimir credenciales en consola o archivos de comandos.
3. Exportar usuarios y metadata por un mecanismo soportado. Excluir refresh tokens, sesiones, PIN y credenciales legacy.
4. Descargar los objetos de cada bucket a almacenamiento cifrado y generar un manifiesto con bucket, path, bytes, MIME y SHA-256.
5. Generar conteos por tabla, totales financieros y una muestra identificada de resultados RPC para reconciliacion.
6. Cifrar los artefactos, verificar sus checksums y registrar la evidencia fuera del repositorio.
7. Conservar el manifest generado (`run.json` y `storage/manifest.jsonl`) y la
   evidencia de checksum (`checksums.sha256`) junto con el resultado de cada
   control, fuera del repositorio y sin valores secretos.

Los comandos concretos se ejecutan solo conforme al runbook operativo, con IDs y
rutas aprobados. No se conservaran tokens o contrasenas en historial de shell,
documentos o Git.

## Procedimiento de restauracion aislada

1. Crear o seleccionar un entorno aislado que no tenga rutas de escritura hacia produccion.
2. Restaurar primero esquema y funciones; revisar errores antes de cargar datos.
3. Restaurar datos y verificar claves, relaciones, vistas, triggers y funciones.
4. Restaurar una copia de Storage conservando paths y metadata; recalcular SHA-256 y comparar con el manifiesto.
5. Importar solo la metadata de Auth permitida mediante el mecanismo soportado; probar el flujo de restablecimiento en lugar de copiar credenciales legacy.
6. Comparar conteos, totales financieros, relaciones, muestra de RPC y checksums. Registrar diferencias y no aprobar el ensayo mientras exista una diferencia sin explicar.
7. Destruir o archivar el entorno aislado segun la politica aprobada, manteniendo la evidencia minima de la prueba.

## Gate previo a T06

Antes de iniciar repositorios Firestore contra datos migrados se debe restaurar un respaldo reciente en un entorno aislado y comprobar conteos, relaciones, totales financieros, una muestra de RPC y checksums de objetos. RPO objetivo del ensayo: 24 horas. RTO objetivo del ensayo: 4 horas.

Para aprobar este Gate, el restore local es un requisito obligatorio, no una
opcion de la verificacion general. Un resultado `restore: not-run` debe incluir
el motivo y deja el gate pendiente.

El gate requiere evidencia del responsable, fecha, manifest generado, checksum y evidencia
de cada control, ademas del tratamiento de diferencias. La evidencia
debe corresponder a una ejecucion real del runbook, no a una lectura del plan.
Tener este plan escrito no equivale a haber pasado el gate.

## Gate de corte

El corte exige backup final verificado con RPO de 15 minutos, procedimiento de reversion probado, reconciliacion aprobada, ventana autorizada y confirmacion explicita del operador. Supabase permanece disponible y sin eliminacion destructiva durante la ventana de reversion.

## Reversion

Ante errores de integridad, autorizacion o contrato se detiene el dominio afectado, se enruta nuevamente al adaptador Supabase y se preservan ambos lados para reconciliacion. No se eliminan colecciones, objetos ni estructuras SQL durante la reversion. Cualquier escritura aceptada por Firebase antes de revertir debe identificarse por su clave de idempotencia y reconciliarse antes de reabrir el flujo.

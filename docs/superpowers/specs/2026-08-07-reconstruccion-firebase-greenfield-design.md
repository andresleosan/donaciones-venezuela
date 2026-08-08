# Reconstruccion Firebase Greenfield

**Fecha:** 2026-08-07
**Estado:** aprobada por el operador
**Proyecto Firebase:** `donaciones-venezuela-4fc29`
**Proyecto de pruebas:** `demo-donaciones-venezuela`

## Contexto

La aplicacion actual depende de Supabase, pero el operador no tiene acceso al
proyecto origen ni dispone de una exportacion o backup verificable. Por tanto,
no existe una fuente autorizada para migrar usuarios, donaciones, facturas,
movimientos, archivos o configuracion. Inventar o reconstruir esos datos seria
incorrecto y podria crear riesgos de privacidad y reconciliacion.

Firebase ya tiene una plataforma local preparada: configuracion Vite, SDK
modular, reglas iniciales, Emulator Suite, Functions y un esquema logico
propuesto para 23 dominios. La interfaz sigue usando temporalmente
`services/api.js` y la funcionalidad Firebase completa aun no existe.

## Decision

Reconstruir toda la funcionalidad existente sobre Firebase con una base vacia,
por dominios y conservando los contratos y la UX vanilla actuales. El codigo
Supabase se conserva solo como referencia durante la reconstruccion y se retira
cuando cada dominio haya sido implementado y validado.

No se hara una migracion de datos inexistentes. Los datos iniciales seran
configuracion minima y seeds deterministas de prueba; los datos reales deberan
ser registrados nuevamente por los operadores autorizados.

## Alcance

### Incluye

- Reconstruir las 65 acciones actuales por dominios funcionales.
- Mantener la interfaz publica que consume la UI, incluyendo el shape de las
  respuestas y errores donde sea seguro y posible.
- Migrar autenticacion, sesion, roles, lecturas, escrituras, Storage,
  transacciones, auditoria e integraciones necesarias.
- Usar Firebase Authentication, Firestore, Storage y Cloud Functions.
- Probar reglas y contratos con Emulator Suite antes de tocar datos remotos.
- Crear seeds explicitamente marcados como demo o prueba.

### No incluye

- Recuperar o inventar datos de Supabase.
- Copiar hashes, refresh tokens, sesiones, PINs, secretos o credenciales
  heredadas.
- Publicar `buscar_familiar` o cualquier busqueda libre sobre PII.
- Rediseñar la UI o introducir React/Vue.
- Crear staging/produccion, activar Blaze, desplegar o ejecutar migraciones
  destructivas sin autorizacion explicita.

## Arquitectura

### Frontend

Se conserva la interfaz vanilla y su contrato de servicio existente. El
adaptador interno deja de usar Supabase y delega en el SDK Firebase Web modular
para Auth y, cuando sea seguro, lecturas publicas. Las acciones privilegiadas se
envian a la Function HTTP `api` con el ID token Firebase.

### Functions

Cloud Functions sera la frontera para:

- Verificar ID tokens y claims de rol.
- Validar esquemas de entrada y permisos por accion.
- Ejecutar escrituras atomicas y transacciones.
- Generar proyecciones publicas desde documentos privados.
- Aplicar rate limits y registrar auditoria.
- Resolver Storage privado, URLs temporales e integraciones externas.

La implementacion mantiene un monorepo modular en `functions/src/`, con
handlers por dominio y repositorios separados de la logica de autorizacion.

### Datos

Firestore usa las colecciones canónicas privadas y las proyecciones publicas
definidas en `FIRESTORE_SCHEMA.md`. Las colecciones privadas nunca se leen
directamente desde clientes anonimos. Las proyecciones publicas contienen
allowlists positivas y no se generan renombrando automaticamente campos
privados.

Los IDs nuevos seran UUID o IDs estables generados por el servidor. Los
timestamps seran `Timestamp` UTC. Las relaciones seran referencias logicas o
`DocumentReference` dentro de Functions, evitando joins cliente-cliente.

### Storage

Firebase Storage sera privado por defecto. Firestore almacenara solo paths y
metadata minima. Functions generara URLs temporales autorizadas por un maximo
de 15 minutos. Fotos, comprobantes, documentos y videos nunca seran publicos
por defecto.

## Flujo de seguridad

1. El usuario inicia sesion con Firebase Auth email/password.
2. El SDK conserva la sesion y notifica cambios mediante `onAuthStateChanged`.
3. La UI envia el ID token a la Function cuando la accion requiere backend.
4. La Function valida token, rol, schema, ownership y permiso de accion.
5. El handler usa el repositorio de dominio y transacciones cuando modifica
   estado relacionado.
6. Toda accion administrativa registra actor, entidad, resultado y timestamp en
   `auditoriaAdmin`.
7. Los errores no imprimen tokens, PII, secretos ni cuerpos externos.

El bootstrap del primer administrador se ejecutara mediante procedimiento
controlado de operador. Nunca se habilitara una ruta publica para otorgar roles.

## Dominios y orden

Cada dominio se implementara, probara y revisara antes del siguiente:

1. Auth, sesion, claims y bootstrap administrativo.
2. Reglas, proyecciones publicas y lecturas base.
3. Lugares, insumos, centros, voluntarios, rescatistas y motorizados.
4. Facturas, donaciones, comprobantes y movimientos transaccionales.
5. Storage, fotos, evidencias y URLs temporales.
6. Transporte, viajes, trayectos, entregas y reservas.
7. Denuncias, administracion, reportes e integraciones externas.
8. Sustitucion final de `services/api.js`, limpieza de referencias Supabase y
   documentacion de cierre.

El orden prioriza primero identidad y seguridad, luego lecturas de bajo riesgo,
despues operaciones financieras y finalmente dominios con mas integraciones.

## Datos iniciales y seeds

La base comienza vacia. Los seeds locales contienen solo datos sinteticos y
deterministas para probar reglas, contratos y flujos de UI. Los seeds no pueden
contener correos, documentos, telefonos, tokens o archivos de personas reales.

La carga de datos reales, si en el futuro aparece una fuente autorizada, sera un
plan separado con backup, reconciliacion, rollback y checkpoint propio. No forma
parte de esta reconstruccion greenfield.

## Rollback y operacion

- Cada dominio se entrega en commits reversibles.
- Las reglas se prueban primero en Emulator Suite.
- No se eliminan referencias Supabase antes de validar el dominio Firebase
  equivalente.
- Si un dominio falla, se deshabilita su ruta Firebase y se conserva el resto
  de dominios ya validados.
- No existe fallback de datos hacia Supabase porque el origen no esta
  disponible; el rollback de esta fase es de codigo, reglas y despliegue, no de
  datos heredados.
- Cualquier carga remota en el proyecto de desarrollo requiere confirmacion
  separada. Produccion, staging y Blaze quedan fuera del alcance.

## Pruebas y aceptacion

Cada dominio debe tener:

- Pruebas unitarias de validacion y reglas de negocio.
- Pruebas de contrato de sus acciones y respuestas.
- Pruebas de reglas para anonimo, usuario, panel y admin.
- Casos negativos de autenticacion, ownership, PII y entradas invalidas.
- Pruebas de transaccion, idempotencia y reintentos cuando corresponda.
- Verificacion de build y ausencia de errores de consola en el flujo manual.

La reconstruccion completa se acepta cuando:

- Las 65 acciones tienen implementacion Firebase y pruebas de contrato.
- Auth, reglas Firestore/Storage y roles pasan Emulator Suite.
- La UI conserva sus flujos principales sobre el adaptador Firebase.
- No quedan referencias funcionales a Supabase, salvo historial documentado.
- No se expone PII por proyecciones, logs, errores o Storage publico.
- `npm.cmd run verify` pasa con evidencia reciente.
- El operador valida manualmente Auth, lecturas, escrituras, Storage,
  administracion y rollback por dominio.

## Alternativas descartadas

### Big bang

Reescribir las 65 acciones y cambiar toda la aplicacion en una sola entrega
concentra riesgo, dificulta aislar regresiones y no aporta beneficio al no
existir datos que reconciliar.

### Aplicacion nueva sin conservar contratos

Rehacer frontend, API y shapes desde cero puede eliminar dependencias antiguas,
pero aumenta el riesgo de perder funcionalidades y comportamiento que los
usuarios ya conocen.

## Riesgos aceptados

- No hay continuidad automatica de datos porque no existe acceso al origen.
- Los usuarios reales deben registrarse nuevamente.
- La reconstruccion de 65 acciones es mas extensa que un MVP reducido.
- Las vulnerabilidades moderadas de dependencias y warnings legacy existentes
  deben seguir registrandose y revisandose por separado.

## Gates explicitos

- No leer ni recibir secretos por chat.
- No ejecutar exportaciones o imports remotos sin checkpoint del operador.
- No activar Blaze ni crear ambientes adicionales.
- No hacer migraciones destructivas.
- No aprobar un dominio sin pruebas y revision de seguridad.

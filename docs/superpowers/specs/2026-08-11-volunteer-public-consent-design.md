# Consentimiento Publico de Voluntarios Firebase

**Fecha:** 2026-08-11
**Estado:** aprobada por el operador
**Proyecto Firebase:** `donaciones-venezuela-4fc29`
**Proyecto de pruebas:** `demo-donaciones-venezuela`

## Contexto

Las lecturas publicas de `lugaresPublicos` y `vacantesPublicas` ya estan
protegidas por reglas, allowlists, paginacion y pruebas de Emulator Suite. Las
proyecciones de `voluntariosPublicos`, `rescatistasPublicos` y
`motorizadosPublicos` permanecen cerradas porque sus fuentes privadas contienen
email, telefono, `authUid`, fotos y otros datos sensibles.

La auditoria del sistema legacy identifico exposicion historica de telefonos y
placas en vistas publicas. No se debe repetir ese comportamiento ni asumir que
la existencia de un perfil implica consentimiento para publicarlo. Esta entrega
define solamente el consentimiento y la publicacion segura de voluntarios. Los
rescatistas y motorizados tendran planes separados.

## Decision

Implementar opt-in del propio voluntario y publicacion server-side atomica:

- Un voluntario autenticado puede activar o revocar la publicacion de su propio
  perfil usando la Function HTTP `setVolunteerPublicConsent`.
- `panel` y `admin` pueden revocar una publicacion, pero nunca activarla en
  nombre del voluntario.
- La Function verifica ID token, ownership, rol, version de consentimiento y
  estado activo antes de modificar datos.
- Una transaccion actualiza el consentimiento privado, crea o elimina la
  proyeccion publica y registra un evento minimo en `auditoriaAdmin`.
- La proyeccion v1 no incluye foto; `fotoPublicaPath` requiere una version de
  consentimiento distinta y queda fuera de este dominio.
- Las reglas Firestore permiten lectura publica acotada de
  `voluntariosPublicos`, pero toda escritura cliente sigue denegada.
- No se ejecutan deploys, seeds remotos ni publicaciones de perfiles reales.

## Alternativas descartadas

### Solicitud con aprobacion administrativa

Una cola de solicitudes daria un control adicional, pero requiere estados,
pantallas, notificaciones y permisos de revision antes de resolver el contrato
basico. Puede ser una evolucion para organizaciones con politica de aprobacion.

### Publicacion manual con script Admin SDK

Reduciria el codigo inicial, pero no ofreceria una funcion usable por el
voluntario ni una prueba automatica de ownership y revocacion. Tambien aumenta
el riesgo de operaciones manuales no auditadas.

### Activacion administrativa directa

Se descarta porque un admin no debe convertir un perfil personal en publico sin
consentimiento verificable del titular. El admin conserva capacidad de
revocacion para responder a incidentes o solicitudes de privacidad.

## Alcance

### Incluye

- Campo privado `publicProfileConsent` en `voluntarios/{voluntarioId}`.
- Function HTTP `setVolunteerPublicConsent` con contrato POST seguro.
- Verificacion de ownership y roles `user`, `panel` y `admin`.
- Publicacion y revocacion atomica de `voluntariosPublicos/{voluntarioId}`.
- Auditoria minima de activacion y revocacion.
- Allowlist publica v1 sin foto, email, telefono, `authUid`, documentos,
  ubicacion precisa ni tokens.
- Reglas de lectura publica con limite maximo de 50 y escritura denegada.
- Tests unitarios, de contrato y Emulator Suite.
- Runbook de consentimiento, revocacion y rollback local.

### No incluye

- Consentimiento de rescatistas o motorizados.
- Publicacion de fotos o archivos.
- Cambio de `services/api.js`, `window.SheetsService` o UI legacy.
- Edicion de datos privados del voluntario fuera del bloque de consentimiento.
- Activacion de Blaze, deploy, staging, produccion o carga de perfiles reales.
- Rate limiting distribuido, App Check o textos legales de produccion.
- Importacion, reconciliacion o eliminacion de datos Supabase.

## Modelo de consentimiento

Agregar al documento privado `voluntarios/{voluntarioId}`:

```text
publicProfileConsent:
  enabled: boolean
  version: "volunteer-public-v1"
  consentedAt: Timestamp|null
  consentedByUid: string|null
  revokedAt: Timestamp|null
  revokedByUid: string|null
```

Reglas del modelo:

- En activacion, `enabled=true`, `version` debe ser exactamente
  `volunteer-public-v1`, `consentedAt` recibe timestamp del servidor y
  `consentedByUid` es el UID autenticado del voluntario.
- En revocacion, `enabled=false`, `revokedAt` recibe timestamp del servidor y
  `revokedByUid` es el UID que ejecuto la revocacion.
- Una revocacion no borra ni modifica nombre, zona, habilidades, estado ni
  `authUid` del perfil privado.
- Una nueva activacion despues de revocar reemplaza `consentedAt` y conserva la
  trazabilidad de revocacion mas reciente.
- Activaciones y revocaciones repetidas son idempotentes y no crean documentos
  duplicados.

## Contrato de Function

Endpoint: `POST /setVolunteerPublicConsent` en region `us-east1`.

Headers requeridos:

```text
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

Body exacto:

```json
{
  "volunteerId": "volunteer-1",
  "enabled": true,
  "consentVersion": "volunteer-public-v1"
}
```

Respuestas seguras:

```json
{"success":true,"enabled":true,"volunteerId":"volunteer-1"}
{"success":true,"enabled":false,"volunteerId":"volunteer-1"}
```

Codigos de error permitidos:

```text
unauthenticated
forbidden
invalid-input
volunteer-not-found
volunteer-not-active
invalid-consent-version
```

El endpoint no devuelve el perfil privado, claims completos, email, telefono,
mensajes del Admin SDK ni detalles de Firestore. Metodos distintos de POST
reciben `405` con `Allow: POST`.

## Autorizacion

Antes de abrir una transaccion, la Function debe:

1. Verificar el Bearer ID token con el autorizador existente.
2. Validar que `volunteerId` sea string no vacio y que `enabled` sea boolean.
3. Validar que `consentVersion` sea exactamente `volunteer-public-v1`.
4. Leer `voluntarios/{volunteerId}` mediante Admin SDK.
5. Permitir activar solo si `context.role === 'user'` y
   `profile.authUid === context.uid`.
6. Permitir revocar si el actor es el titular, `panel` o `admin`.
7. Rechazar activacion si `profile.activo !== true`.

Un `admin` no recibe una excepcion para activar consentimiento. La revocacion
administrativa debe quedar identificada por su `actorUid` en auditoria.

## Proyeccion publica v1

`voluntariosPublicos/{volunteerId}` contiene solamente:

```text
nombre
zona
habilidades
activo
createdAt
```

El publicador construye un objeto nuevo desde esos campos y pasa el resultado
por el sanitizer. No copia el documento privado completo ni usa un renombrado
automatico. `fotoPublicaPath` no se genera en v1 aunque aparezca como campo
reservado en el esquema general.

La proyeccion se crea solo cuando `enabled=true` y el perfil esta activo. Al
revocar, se elimina el documento publico dentro de la misma transaccion. El
cliente nunca escribe `voluntariosPublicos`.

## Transaccion y auditoria

La transaccion Admin SDK debe leer el perfil privado y realizar las escrituras
relacionadas de forma atomica:

### Activacion

- actualizar `publicProfileConsent` en `voluntarios/{id}`;
- crear o reemplazar `voluntariosPublicos/{id}` con la allowlist v1;
- crear `auditoriaAdmin/{eventId}` con `actorUid`, `accion`, `entidad`,
  `entidadId`, `resultado` y `createdAt`.

### Revocacion

- actualizar `publicProfileConsent` con estado revocado;
- eliminar `voluntariosPublicos/{id}`;
- crear el evento de auditoria con resultado exitoso.

El evento de auditoria no guarda email, telefono, documento, claims completos,
IP sin hash ni contenido del perfil. Los errores de la transaccion se convierten
en codigos estables y no dejan una escritura parcial.

## Reglas Firestore

Agregar solo la ruta publica siguiente al conjunto actualmente habilitado:

```text
voluntariosPublicos/{id}
  get: allow anonimo
  list: allow anonimo solo si request.query.limit existe y <= 50
  write: deny
```

Mantener deny-by-default para `voluntarios`, `auditoriaAdmin` y todas las demas
colecciones. La Function usa Admin SDK y no depende de abrir escrituras en las
reglas del cliente.

## Pruebas y aceptacion

### Unitarias

- Validacion del body, version y metodo HTTP.
- Ownership del voluntario.
- Matriz de permisos: user titular activa/revoca; panel/admin revocan; panel,
  admin y otro user no activan ni modifican perfiles ajenos.
- Perfil inactivo no puede activarse.
- Respuestas no contienen PII ni detalles internos.
- Sanitizer v1 omite foto y campos sensibles.
- Activacion y revocacion son idempotentes.

### Emulator Suite

Con Auth, Firestore y Functions Emulator:

- Crear fixtures sinteticos de usuario titular, panel y admin.
- Obtener ID tokens del Auth Emulator.
- Activar consentimiento por HTTP y verificar `voluntariosPublicos/{id}`.
- Revocar por HTTP y verificar que la proyeccion desaparece.
- Verificar que el perfil privado sigue existiendo y que `auditoriaAdmin` registra
  el actor y resultado sin PII.
- Verificar que lecturas publicas tienen limite 50 y escrituras cliente fallan.
- Verificar que acceso directo cliente a `voluntarios/{id}` y
  `auditoriaAdmin/{id}` falla para anonimo y roles autenticados.

La aceptacion exige `npm.cmd run test:emulators`, build, auditorias sin
`high`/`critical` y verificacion de idioma. No se ejecuta el endpoint contra el
proyecto Firebase real.

## Rollback y operacion

- Revertir el commit de la Function y reglas para cerrar la nueva proyeccion.
- No borrar documentos privados ni consentimiento historico durante rollback de
  codigo.
- Si se revoca por incidente, usar la Function y conservar auditoria.
- No desplegar ni publicar perfiles reales hasta revisar textos legales,
  rate limiting/App Check y el flujo de renovacion de consentimiento.
- No recibir secretos por chat ni crear seeds remotos.

## Riesgos aceptados y gates

- La ausencia de texto legal de produccion se acepta solo en Emulator Suite.
- La ausencia de rate limiting/App Check bloquea cualquier exposicion a escala.
- La ausencia de consentimiento separado para fotos bloquea publicar fotos.
- Un hallazgo critico de seguridad detiene la tarea sin excepciones.
- No se aprueba rescatistas ni motorizados como parte de este dominio.

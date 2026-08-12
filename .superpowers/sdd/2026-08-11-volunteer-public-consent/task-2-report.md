# Task 2: Servicio transaccional de consentimiento

## Estado

Implementado, probado y committed. El cambio queda listo para revision.

## Commit

- `39e6722 feat: validate volunteer public consent`

## Alcance implementado

- Se creo `functions/src/volunteers/public-consent.ts` como servicio puro.
- Se exporto `VOLUNTEER_PUBLIC_CONSENT_VERSION` con el valor exacto
  `volunteer-public-v1`.
- Se exporto `ConsentRequest` y `parseConsentRequest(body)`.
- La validacion rechaza valores no objeto, propiedades faltantes o adicionales,
  `volunteerId` vacio, `enabled` no boolean y versiones desconocidas con
  `invalid-input` o `invalid-consent-version`.
- `assertConsentPermission` permite activar unicamente al `user` titular y
  exige `activo === true`.
- `assertConsentPermission` permite revocar al titular, `panel` y `admin`, pero
  rechaza a otro `user`.
- `buildConsentMutation` devuelve solo `enabled`, `privatePatch`,
  `publicDocument` y `audit`.
- La activacion proyecta exclusivamente mediante `sanitizeVolunteerPublicProfile`
  y no incluye `fotoPath` ni otros campos privados.
- La revocacion devuelve `publicDocument: null`.
- La mutacion conserva timestamps y actor IDs previos, normalizando ausencias a
  `null`, y actualiza la trazabilidad correspondiente con `now` y `actorUid`.
- El audit contiene unicamente `actorUid`, `accion`, `entidad`, `entidadId`,
  `resultado` y `createdAt`.
- Se creo `tests/functions/public-consent.test.ts` con cobertura de validacion,
  version, roles, ownership, perfil inactivo, allowlist, idempotencia de forma
  pura y trazabilidad.

## TDD

1. RED: `npx vitest run tests/functions/public-consent.test.ts` fallo antes de
   crear el servicio porque no existia
   `functions/src/volunteers/public-consent.ts`.
2. GREEN inicial: tras la implementacion, 11 de 13 tests pasaron. Los 2 fallos
   fueron assertions de los valores de auditoria no fijados por el fragmento
   inicial del brief.
3. Ajuste: se fijaron en los tests los nombres de accion y entidad coherentes
   con `FIRESTORE_SCHEMA.md` y el contrato de auditoria del proyecto.
4. GREEN final: `npx vitest run tests/functions/public-consent.test.ts` paso con
   13 tests.

## Evidencia de pruebas

- `npx vitest run tests/functions/public-consent.test.ts`: 1 archivo, 13 tests
  OK.
- `npm.cmd run test:unit`: 14 archivos, 218 tests OK.
- `npm.cmd --prefix functions run build`: TypeScript OK.
- `git diff --check`: OK.
- Verificacion post-commit de `npx vitest run tests/functions/public-consent.test.ts`:
  1 archivo, 13 tests OK.
- `git diff HEAD^ HEAD --check`: OK.

## Autorrevision de seguridad

- No se agregaron endpoints, acceso a Admin SDK, reglas, migraciones, UI,
  operaciones remotas ni secretos.
- La entrada se valida por tipo, forma y allowlist de propiedades.
- La autorizacion verifica rol, UID titular y estado activo antes de activar.
- `admin` y `panel` no pueden activar; solo pueden revocar.
- La proyeccion publica se genera desde el sanitizer v1 existente, sin copiar el
  perfil privado completo.
- El audit no contiene email, telefono, documento, claims ni contenido privado.
- No se agregaron dependencias ni logs sensibles.
- No quedan hallazgos criticos de seguridad en el alcance de esta tarea.

## Alcance no incluido

- No se implementaron HTTP, Function exportada, transaccion Admin SDK, cambios
  de reglas, cambios de UI/API, despliegues, migraciones ni operaciones remotas.
- No se modificaron archivos preexistentes ajenos a Task 2.

## Preocupaciones

- Los valores textuales de `accion` (`activar_consentimiento_publico` y
  `revocar_consentimiento_publico`) quedaron definidos por el servicio porque el
  brief exige esos campos pero no fija sus literales; deberan ser consumidos por
  Task 3 sin reinterpretarlos.
- El servicio es puro y no realiza transacciones por diseño; la garantia atomica
  queda pendiente de Task 3, tal como indica el brief.
- El worktree mantiene cambios y archivos no relacionados preexistentes; no se
  incluyeron en el commit.

## Fix Round 1

### Hallazgos atendidos

- Se endurecio unicamente `VOLUNTEER_FORBIDDEN` para rechazar tambien claves
  sensibles alternativas dentro de `habilidades`: `foto`, `photo`, `fotoPath`,
  `photoPath`, `imagen`, `image`, `imagenPath`, `imagePath`, `location`,
  `ubicacion`, `token` y `tokenPublico`, incluyendo sus variantes normalizadas.
- No se modifico el denylist generico. Las proyecciones existentes conservan su
  comportamiento, incluido `tokenPublico` en facturas, mientras el sanitizer v1
  mantiene su barrera especifica contra campos sensibles anidados.
- `buildConsentMutation` ahora compara el estado previo con el solicitado. Si la
  operacion repite el estado actual, conserva `consentedAt`, `consentedByUid`,
  `revokedAt` y `revokedByUid`; una transicion sigue asignando `now` y
  `actorUid` al lado correspondiente.
- Se agregaron pruebas explicitas para activacion rechazada por `panel`, `admin`
  titular y otro `user`.
- Se agregaron regresiones para aliases sensibles anidados y para activaciones y
  revocaciones repetidas.
- Se corrigio la referencia del modulo en la evidencia TDD de `.js` a `.ts`.

### TDD y verificacion

- RED: `npx vitest run tests/functions/public-consent.test.ts` produjo 6 fallos
  esperados: cuatro aliases anidados se publicaban y dos operaciones repetidas
  reemplazaban trazabilidad.
- GREEN: `npx vitest run tests/functions/public-consent.test.ts tests/contracts/volunteer-public-profile.test.ts`:
  2 archivos, 38 tests OK.
- `npm.cmd run test:unit`: 14 archivos, 233 tests OK.
- `npm.cmd --prefix functions run build`: TypeScript OK.
- `git diff --check`: OK.

### Autorrevision

- La protección nueva esta limitada a `VOLUNTEER_FORBIDDEN`; no altera el
  comportamiento generico de `sanitizePublicProjection`.
- La idempotencia conserva la trazabilidad de la operacion ya aplicada, pero el
  audit de cada solicitud mantiene el actor y timestamp actuales como evento
  separado.
- Se mantiene la distincion de permisos: solo el titular `user` activa; titular,
  `panel` y `admin` revocan.
- No se agregaron HTTP, Admin SDK, reglas, UI/API, migraciones, despliegues,
  operaciones remotas, secretos ni dependencias.
- No quedan hallazgos criticos abiertos en el alcance del fix round 1.

### Preocupaciones

- La garantia atomica sigue pendiente de Task 3, fuera del alcance de este fix.
- El worktree conserva cambios preexistentes no relacionados y no fueron
  incluidos en el commit.

# Task 4 Fix Round 1

## Estado

Hallazgos del reviewer atendidos únicamente en la prueba de integración. Se conservaron
los comandos existentes, el alcance local, la UI/API y la evidencia del reporte original.
No se ejecutaron bootstrap, deploy, acceso remoto, Blaze, seeds remotos ni perfiles reales.

## Correcciones

- Estado Firestore limpiado en `beforeEach` y `volunteerId` generado con UUID por prueba.
- Auditoría consultada con Admin SDK local filtrando por `entidadId`, `accion` y `actorUid`,
  sin depender de `docs[0]`; se verifica el conjunto exacto de seis claves permitidas,
  actor, acción, entidad, entidadId, resultado y ausencia de PII/tokens/campos de perfil.
- Añadida denegación de lectura directa de `voluntarios/{id}` para anonymous, user, panel y admin.
- Añadida cobertura end-to-end de revocación por panel y por titular, con auditoría determinista.
- Añadida prueba de servicio transaccional con fallo inyectado en la escritura de auditoría;
  verifica que el staging contiene las tres operaciones previstas pero el estado comprometido
  conserva exactamente el perfil inicial y no crea proyección ni auditoría parcial.
- No se modificó la implementación de producción de la transacción.

## TDD y verificación

- RED enfocado: `npm.cmd --prefix functions run build; npx vitest run tests/emulators/volunteer-consent.integration.test.ts`
  falló porque no había Firestore Emulator en `127.0.0.1:8080` (`ECONNREFUSED`); el build de
  Functions pasó.
- GREEN enfocado: `firebase emulators:exec --project demo-donaciones-venezuela --only auth,firestore,functions "npx vitest run tests/emulators/volunteer-consent.integration.test.ts"`
  pasó: 1 archivo, 4 tests.
- `npm.cmd run test:functions` pasó: 9 archivos, 64 tests.
- `npm.cmd run test:emulators` pasó: 13 archivos, 88 tests.
- Todos los comandos usaron únicamente `demo-donaciones-venezuela` y emuladores locales.

## Observaciones

- Firebase Functions continúa reportando host Node 24 frente al engine solicitado Node 22.
- Se observaron puertos alternativos para Hub/Logging y `MetadataLookupWarning`; los emuladores
  y las pruebas terminaron correctamente. No se mataron procesos ajenos.
- Producción continúa bloqueada por textos legales, rate limiting, App Check y revisión operativa.

## Commit

`7bc0d58 test: harden volunteer consent emulator coverage`

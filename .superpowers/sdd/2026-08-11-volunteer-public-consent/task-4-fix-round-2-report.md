# Task 4 Fix Round 2

## Estado

Se atendieron los dos hallazgos abiertos del reviewer únicamente en la prueba de
integración. Se preservaron producción, wiring de comandos, UI/API y las restricciones
local-only. No se ejecutaron bootstrap, deploy, acceso remoto, Blaze, seeds remotos ni
perfiles reales.

## Correcciones

- El rollback usa un fake transaccional fiel que ejecuta el callback real de
  `applyConsentTransaction`, mantiene staging independiente por transacción y aplica
  `update`, `set` y `delete` al estado comprometido solo si el callback termina con éxito.
- El fake fuerza una excepción al staging de la auditoría, verifica que las tres
  operaciones previstas quedaron staged pero que el perfil privado, la proyección y la
  auditoría comprometidos permanecen exactamente sin cambios, y luego verifica el camino
  exitoso con commit real del staging.
- La auditoría Admin local devuelve el ID del documento junto con sus datos; se conservan
  las aserciones exactas de claves, actor, acción, entidad, entidadId, resultado y ausencia
  de PII/tokens, y se restaura la aserción E2E de que el cliente no puede leer el documento
  `auditoriaAdmin/{id}`.
- No se modificó la implementación de producción de la transacción.

## TDD y verificación

- RED enfocado: `firebase emulators:exec --project demo-donaciones-venezuela --only auth,firestore,functions "npx vitest run tests/emulators/volunteer-consent.integration.test.ts"`
  falló en la aserción del ID de auditoría porque el ID no forma parte de `data()`.
- GREEN enfocado: el mismo comando pasó: 1 archivo, 4 tests.
- `npm.cmd run test:functions` pasó: 9 archivos, 64 tests.
- `npm.cmd run test:emulators` pasó: 13 archivos, 88 tests.
- Todas las ejecuciones usaron únicamente `demo-donaciones-venezuela` y emuladores locales.

## Observaciones

- Firebase Functions continúa reportando host Node 24 frente al engine solicitado Node 22.
- Persistió `MetadataLookupWarning` del entorno local; las pruebas y emuladores terminaron
  correctamente. No se mataron procesos ajenos.
- Producción continúa bloqueada por textos legales, rate limiting, App Check y revisión operativa.

## Commits

`5e97c2d test: make volunteer consent rollback faithful`

`0b4ac55 docs: record volunteer consent fix round 2`

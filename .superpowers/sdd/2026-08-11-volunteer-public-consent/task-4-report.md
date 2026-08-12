# Task 4: Integración Emulator, runbook y cierre

## Estado

Implementación completada en local con `demo-donaciones-venezuela`, Auth Emulator,
Firestore Emulator y Functions Emulator. No se ejecutaron bootstrap, deploy, acceso
remoto, Blaze, seeds remotos ni perfiles reales. T08 no fue modificado.

## Cambios

- `tests/emulators/volunteer-consent.integration.test.ts`
  - Crea usuarios sintéticos titular, panel, admin y otro usuario en Auth Emulator.
  - Asigna claims `panel` y `admin` mediante Admin SDK contra emuladores locales.
  - Siembra un perfil privado sintético con reglas deshabilitadas.
  - Verifica activación HTTP, allowlist pública exacta de cinco campos y ausencia de PII/foto.
  - Verifica revocación administrativa atómica, perfil privado intacto y auditoría ilegible.
  - Verifica activación prohibida para panel/admin y revocación prohibida para otro usuario.
  - Limpia con `signOut`, `deleteUser` y `deleteApp` en cleanup anidado preservando el primer error.
- `docs/runbooks/volunteer-public-consent.md`
  - Runbook local, datos permitidos/prohibidos, rollback y bloqueo de producción.
- `package.json`
  - Incluye la prueba en `test:functions:run`.
  - Hace que `test:functions` inicie `auth,firestore,functions` conservando la suite existente.
- `docs/superpowers/plans/2026-08-11-volunteer-public-consent.md`
  - Marca únicamente los cinco checks de Task 4 con evidencia.

## TDD

La prueba enfocada se ejecutó primero tras el build de Functions y falló porque no había
Firestore Emulator escuchando en `127.0.0.1:8080`. Tras el wiring y los ajustes mínimos del
test, la suite pasó bajo Emulator Suite.

## Verificación

Ejecutada en este orden:

- `npm.cmd run test:unit`: 15 archivos, 247 tests pasaron.
- `npm.cmd run test:functions`: 9 archivos, 62 tests pasaron.
- `npm.cmd run test:emulators`: 13 archivos, 86 tests pasaron.
- `npm.cmd run build`: pasó.
- `npm.cmd audit --audit-level=high`: sin vulnerabilidades high/critical; 5 moderate transitivas.
- `npm.cmd --prefix functions audit --audit-level=high`: sin vulnerabilidades high/critical; 7 moderate transitivas.
- `python scripts/verificar-idioma.py`: `Idioma OK`, 1499 claves paralelas.
- `git diff --check`: pasó sin errores.

## Seguridad y alcance

- Solo se usa `demo-donaciones-venezuela` y URLs localhost.
- No se modificaron `services/api.js`, la UI ni reglas de colecciones privadas fuera del alcance previo.
- No se exponen `fotoPath`, email, teléfono, `authUid`, tokens ni otros campos privados.
- La transacción verificada conserva el perfil privado, elimina la proyección al revocar y registra auditoría privada.
- Producción permanece bloqueada hasta textos legales, rate limiting, App Check y revisión operativa.

## Observaciones

- Firebase Functions reporta que el engine solicitado es Node 22, pero el host ejecuta Node 24.
- El build conserva warnings legacy existentes sobre scripts sin `type="module"` y referencias de imágenes no resueltas en tiempo de build.
- Las auditorías muestran vulnerabilidades moderate transitivas; no se aplicó `audit fix --force` porque propone cambios mayores fuera del alcance.

## Commit

`6b9080f test: verify volunteer public consent flow`

## Fix Round Final

### Correcciones

- `FIRESTORE_SCHEMA.md` identifica `voluntariosPublicos` v1 como una proyeccion sin
  foto y documenta que cualquier foto futura exige un plan separado de consentimiento,
  version y publicacion. La allowlist generica ejecutable conserva compatibilidad para
  otras proyecciones; el sanitizer v1 sigue usando su allowlist separada sin foto.
- `setVolunteerPublicConsent` exige `Content-Type: application/json`, aceptando
  parametros como `charset`, y devuelve `invalid-input` estable sin autenticar ni
  ejecutar el servicio cuando falta o es incorrecto.
- `parseConsentRequest` rechaza IDs vacios o solo whitespace y devuelve el
  `volunteerId` recortado; la respuesta HTTP tambien usa el ID canonicalizado.
- Se actualizaron los fixtures HTTP y la llamada de Emulator Suite para enviar el
  header JSON explicitamente. No se tocaron UI/API, rescatistas, motorizados, fotos,
  rate limiting, App Check ni operaciones remotas.

### TDD y verificacion

- RED: `npx vitest run tests/functions/public-consent-http.test.ts tests/functions/public-consent.test.ts`
  produjo 4 fallos esperados: tres por media type no validado y uno por ID sin recortar.
- GREEN: el mismo comando paso: 2 archivos, 43 tests OK.
- `npm.cmd --prefix functions run build`: TypeScript OK.
- `firebase emulators:exec --project demo-donaciones-venezuela --only auth,firestore,functions "npx vitest run tests/emulators/volunteer-consent.integration.test.ts"`:
  1 archivo, 4 tests OK; solo emuladores locales.
- `git diff --check`: OK.

### Autorrevision

- El chequeo de media type ocurre antes de autenticacion y no expone detalles
  internos.
- El ID canonicalizado llega al servicio puro y a la transaccion mediante
  `parseConsentRequest`; no se modifico la seguridad de la proyeccion generica.
- No hay hallazgos criticos abiertos en esta ronda. Produccion sigue bloqueada por
  textos legales, rate limiting, App Check y revision operativa.

### Commit

`95a872f fix: harden volunteer consent request validation`

El reporte de esta ronda se conserva como artefacto local del ledger SDD y se registra
en un commit documental separado.

# Task 1: Allowlist v1, reglas e indices de voluntarios

## Estado

Implementado y verificado. El cambio queda listo para revision.

## Alcance implementado

- Se agrego `VOLUNTEER_PUBLIC_PROFILE_FIELDS` con la allowlist v1 exacta:
  `nombre`, `zona`, `habilidades`, `activo`, `createdAt`.
- Se agrego `sanitizeVolunteerPublicProfile(source)` como barrera explicita de la
  proyeccion v1 sin foto.
- La sanitizacion conserva solo la allowlist y ejecuta `findForbiddenPublicFields`
  sobre el resultado, incluyendo objetos anidados dentro de `habilidades`.
- Se habilito solo la lectura publica de `voluntariosPublicos`:
  `get` sin autenticacion y `list` unicamente con `limit <= 50`.
- Se mantuvo `allow write: if false` para `voluntariosPublicos`.
- Se mantuvo el fallback deny-by-default para colecciones no declaradas, incluyendo
  `voluntarios` y `auditoriaAdmin`.
- Se agrego el indice compuesto de `voluntariosPublicos` por `activo ASCENDING`,
  `createdAt DESCENDING` y `__name__ DESCENDING`.
- Se agregaron los contratos del sanitizer y las pruebas de reglas con fixtures
  sinteticos.

## TDD

1. RED: `npx vitest run tests/contracts/volunteer-public-profile.test.ts tests/rules/volunteer-public.rules.test.ts`
   fallo el contrato porque `sanitizeVolunteerPublicProfile` no existia. La prueba
   de reglas no pudo conectarse al emulador porque no estaba levantado
   (`ECONNREFUSED 127.0.0.1:8080`); no se modifico codigo para ocultar ese fallo.
2. GREEN: se implementaron unicamente el sanitizer, las reglas, el indice y las
   dos pruebas del brief.
3. El contrato nuevo paso: 2 tests.

## Evidencia de pruebas

- `npx vitest run tests/contracts/volunteer-public-profile.test.ts`: 1 archivo,
  2 tests OK.
- `npm.cmd run test:rules`: 4 archivos, 24 tests OK, con Firestore y Storage
  Emulator iniciados por Firebase CLI.
- `npx vitest run tests/contracts/volunteer-public-profile.test.ts tests/contracts/public-projections.test.ts`:
  2 archivos, 15 tests OK.
- `npm.cmd --prefix functions run build`: TypeScript OK.
- `node -e "JSON.parse(require('node:fs').readFileSync('firebase/firestore.indexes.json','utf8')); console.log('firestore.indexes.json: valid JSON')"`:
  JSON valido.
- `git diff --check`: OK.

## Revisión de seguridad

- La nueva proyeccion no incluye `fotoPublicaPath` ni campos de PII del fixture.
- La deteccion de campos prohibidos se aplica despues de construir la allowlist y
  recorre valores anidados.
- No se agregaron secretos, logs sensibles, endpoints, escrituras remotas ni cambios
  de autenticacion.
- Las escrituras publicas permanecen denegadas para anonymous, user, panel y admin.
- Las lecturas directas de `voluntarios` y `auditoriaAdmin` permanecen denegadas.
- No se modificaron `services/api.js`, UI ni cambios de usuario no relacionados.

## Archivos

- `functions/src/public-projections.ts`
- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`
- `tests/contracts/volunteer-public-profile.test.ts`
- `tests/rules/volunteer-public.rules.test.ts`

## Preocupaciones

- La funcion existente `sanitizePublicProjection('voluntariosPublicos', ...)`
  conserva su contrato anterior, que incluye `fotoPublicaPath`; no se cambio porque
  el brief exige mantener las otras proyecciones sin cambios. La nueva funcion
  `sanitizeVolunteerPublicProfile` es la barrera v1 sin foto solicitada.
- No se ejecuto `npm.cmd run verify` completo porque el brief solicita verificacion
  enfocada y limita el alcance de esta tarea; las pruebas de contrato, reglas y
  compilacion relevantes si fueron ejecutadas.

## Fix Round 1

### Hallazgos atendidos

- Se amplio el denylist normalizado compartido con `fotoPublicaPath`, `documentos`
  y `tokens`. Las claves ya cubiertas (`ubicacionPrecisa`, `email`, `telefono` y
  `authUid`) siguen siendo rechazadas cuando aparecen dentro de `habilidades`.
- Se agrego cobertura parametrizada para las siete claves anidadas indicadas por la
  revision.
- Se agrego una prueba de regresion que confirma que `tokenPublico` de
  `facturasPublicas` sigue permitido. No se modifico el comportamiento de las otras
  proyecciones, reglas, UI, API ni activacion/publicacion.

### TDD y verificacion

- RED: `npx vitest run tests/contracts/volunteer-public-profile.test.ts` produjo
  3 fallos esperados para `fotoPublicaPath`, `documentos` y `tokens`; las cuatro
  claves que ya estaban en el denylist fallaron correctamente.
- GREEN: `npx vitest run tests/contracts/volunteer-public-profile.test.ts`:
  1 archivo, 10 tests OK.
- `npx vitest run tests/contracts/public-projections.test.ts`: 1 archivo,
  13 tests OK.
- `npm.cmd run test:rules`: 4 archivos, 24 tests OK, con emuladores locales;
  no hubo operaciones remotas ni escrituras fuera del entorno de prueba.
- `npm.cmd run test:unit`: 13 archivos, 202 tests OK.
- `npm.cmd --prefix functions run build`: TypeScript OK.
- `git diff --check`: OK.

### Autorrevision

- El arreglo se limita a la normalizacion del denylist y a sus contratos.
- `tokenPublico` no coincide con `tokens` al normalizarse y su prueba pasa.
- No se tocaron `firebase/firestore.rules`, `firebase/firestore.indexes.json`,
  `services/api.js`, UI, activacion, publisher ni datos remotos.
- No quedan hallazgos abiertos de este fix round.

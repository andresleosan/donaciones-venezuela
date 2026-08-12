# Task 3: App Check configurable y guards del endpoint

## Estado

Implementación completada y comprometida en dos commits.

## Commits

- `894b7a6 feat: guard volunteer consent with app check and limits`
- `972cd84 fix: normalize consent auth guard failures`

## Cambios

- `functions/src/security/app-check.ts`
  - Añade `AppCheckMode`, `AppCheckError`, `getAppCheckMode()` y `verifyConfiguredAppCheck()`.
  - Acepta únicamente `disabled`, `log-only` y `enforced`; valores desconocidos vuelven a `disabled`.
  - Lee `x-firebase-appcheck` o `X-Firebase-AppCheck` mediante el accessor `request.get()` y los headers tipados.
  - Usa `getAppCheck().verifyToken()` solo cuando corresponde y permite verificador inyectable.
  - Normaliza ausencia y fallos de verificación en `AppCheckError` sin exponer detalles del SDK.
  - `log-only` no bloquea solicitudes y no registra tokens ni errores.

- `functions/src/volunteers/public-consent-http.ts`
  - Ejecuta el guard App Check antes de Auth.
  - Autentica antes de consumir el bucket UID y pasa el `AuthContext` verificado al consentimiento.
  - Ante Auth fallida consume el bucket `request` con `req.ip.trim()` cuando existe y responde 401 seguro.
  - Responde 429 con `Retry-After` y `rate-limit-exceeded` cuando se excede cualquier bucket.
  - No llama a `apply` si falla App Check, Auth o rate limit.
  - Mantiene la allowlist de respuesta `{ success, enabled, volunteerId }` y normaliza errores desconocidos.
  - Deja todas las dependencias de guards inyectables para pruebas unitarias.

- `tests/functions/app-check.test.ts`
  - Cubre los tres modos, valores desconocidos, ausencia de token, verificación inyectada, accessor y errores seguros.

- `tests/functions/public-consent-http.test.ts`
  - Cubre 429/`Retry-After`, rechazo App Check 403, no ejecución del consentimiento, semántica UID/request y normalización de fallos de Auth.

## Verificación TDD

1. Se escribieron primero las pruebas de App Check y guards.
2. La corrida inicial falló por el adaptador inexistente y guards no integrados: 2 suites fallidas, 3 tests fallidos y 1 suite sin módulo.
3. La implementación mínima pasó la primera ronda enfocada: 27 tests OK.
4. Se agregó la regresión de fallo genérico del autenticador; falló inicialmente con 500 y luego pasó con la normalización 401.

## Verificación final

- `npx vitest run tests/functions/rate-limit.test.ts tests/functions/app-check.test.ts tests/functions/public-consent-http.test.ts`: 3 archivos, 46 tests OK.
- `npm run build` ejecutado en `functions`: TypeScript OK.
- `git diff --check`: sin errores.
- `npm audit --audit-level=high`: salida con 5 vulnerabilidades moderadas, 0 high/critical; el arreglo sugerido exige `--force` y downgrade mayor de `firebase-tools`.
- `npm audit --prefix functions --audit-level=high`: salida con 7 vulnerabilidades moderadas, 0 high/critical; el arreglo sugerido exige downgrade mayor de `firebase-admin`.

## Autocrítica de seguridad

- Auth permanece obligatorio en el handler de producción.
- UID e IP solo se usan como entradas del rate limiter; el limitador existente persiste hashes y no valores crudos.
- No se registran ni devuelven tokens App Check, detalles del SDK, errores del verificador, UID, IP o datos de rate limit.
- App Check queda deshabilitado por defecto y no se modificó configuración remota, `index.ts`, UI, API pública adicional u otro endpoint.
- La respuesta HTTP conserva la allowlist existente.
- No se agregaron dependencias ni se solicitaron secretos.

## Preocupaciones

- `APP_CHECK_MODE=enforced` requiere configuración operativa posterior y tokens válidos de clientes; esta tarea no hace enforcement remoto ni despliegue.
- Cuando Auth falla sin IP válida, el rate limiter no usa una clave global, por diseño del Task 2; la respuesta continúa siendo 401 segura.
- La auditoría de dependencias debe conservar evidencia de la corrida final; no se modificaron manifests en esta tarea.

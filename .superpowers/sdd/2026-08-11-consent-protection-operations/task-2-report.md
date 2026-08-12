# Task 2: Rate limiter transaccional

## Estado

Implementación completada para el módulo aislado de rate limiting transaccional.

## Cambios

- `functions/src/security/rate-limit.ts`
  - SHA-256 hexadecimal para claves.
  - Límite UID de 5 requests por hora.
  - Límite request de 20 requests por hora.
  - Claves persistidas como hash de la clave completa (`uid:<hash>` o `request:<hash>`).
  - Transacción compatible con el adaptador estructural de Firestore Admin SDK.
  - Persistencia limitada a `rateLimits/{keyHash}` con `bucket`, `windowStart`, `hits` y `expiresAt`.
  - `RateLimitError` con `retryAfter` entero positivo.
  - Errores de almacenamiento normalizados a `rate-limit-storage-failed` sin causa original.
  - IP ausente rechazada; no existe fallback a una clave global.
- `tests/functions/rate-limit.test.ts`
  - Fake transaction con writes aplicados solo si el callback termina correctamente.
  - Cobertura de hash, límites UID/request, expiración, identidad ausente, rollback y ausencia de datos sensibles.

## Verificación

- `npx vitest run tests/functions/rate-limit.test.ts`: 1 archivo, 7 pruebas OK.
- `npm run build` ejecutado en `functions`: TypeScript OK.
- `git diff --check`: sin errores atribuibles a los archivos de esta tarea.

## Autocrítica de seguridad

No se detectó persistencia de IP, UID, token, email, body ni headers en el documento del límite. No se modificaron endpoints, UI, API, App Check, Firebase remoto, despliegues ni secretos.

## Preocupaciones abiertas

La integración del limitador en endpoints y la verificación de App Check quedan deliberadamente para tareas posteriores.

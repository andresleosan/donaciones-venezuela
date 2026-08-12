# Task 4 Report: Emulator Suite, runbooks y cierre

## Estado

Implementación local completada y verificada. No se ejecutaron deploys, bootstrap,
configuración remota, activación de Blaze, migraciones ni uso de perfiles reales.

## Cambios

- La integración cubre seis solicitudes concurrentes con exactamente cinco `200` y
  una `429`, `Retry-After`, cinco auditorías y ausencia de mutación adicional.
- La integración cubre 21 intentos de Auth fallidos desde una IP sintética, con
  veinte `401`, una `429` y cero auditorías.
- La integración cubre App Check local en `disabled`, `log-only` y `enforced` con
  verificador inyectado; el caso enforced bloquea antes de Auth y consentimiento.
- Las pruebas de reglas y la integración confirman que el cliente no puede leer ni
  escribir `rateLimits`.
- El cableado de `package.json`, el runbook, el borrador legal y los gates ya
  presentes cumplen el alcance de Task 4; no se duplicaron cambios existentes.
- El plan `docs/superpowers/plans/2026-08-11-consent-protection-operations.md`
  queda marcado con checks y evidencia.

## Verificación

Ejecutados en el orden solicitado:

- `npm.cmd run test:unit`: 17 archivos, 282 tests pasaron.
- `npm.cmd run test:functions`: 11 archivos, 103 tests pasaron.
- `npm.cmd run test:emulators`: 15 archivos, 128 tests pasaron.
- `npm.cmd run build`: pasó.
- `npm.cmd audit --audit-level=high`: sin high/critical; 5 moderate existentes.
- `npm.cmd --prefix functions audit --audit-level=high`: sin high/critical; 7 moderate existentes.
- `python scripts/verificar-idioma.py`: idioma OK, 1499 claves paralelas.
- `git diff --check`: sin errores.

## Seguridad y alcance

- `rateLimits` permanece cerrado al cliente.
- No se almacenan IP, token, email, body ni headers completos.
- App Check enforced no se activa remotamente.
- El borrador legal conserva `BORRADOR - REVISIÓN LEGAL PENDIENTE` y el canal
  `PENDIENTE DE APROBACIÓN`.
- Las casillas operativas mantienen producción, staging, Blaze y publicación real
  bloqueados hasta aprobación humana.
- `services/api.js`, UI y acciones no relacionadas no cambiaron en Task 4.

## Observaciones

- Emulator Suite usa Node 24 del host aunque Functions declara Node 22.
- Vite mantiene warnings legacy de scripts sin `type="module"` y referencias de
  imágenes no resueltas en el build; no son introducidos por Task 4.
- Las auditorías solo reportan vulnerabilidades `moderate`; no se ejecutó
  `npm audit fix --force` porque implicaría cambios mayores fuera del alcance.

## Fix Round 1

Hallazgos P2 corregidos sin cambios remotos ni producción:

- El sexto request ahora se ejecuta después de cinco requests concurrentes
  permitidos; captura el estado privado, la proyección pública y la auditoría
  antes del request bloqueado, identifica explícitamente el `429` y compara los
  tres estados después del bloqueo.
- Cada modo App Check vive en un caso independiente, por lo que `beforeEach`
  limpia Firestore y asigna un UUID nuevo. `disabled` prueba que el verificador
  no se llama; `log-only` usa un spy con token sintético y verifica la llamada;
  `enforced` prueba tanto token ausente como inválido y ausencia de mutación,
  Auth, rate limit y `apply`.
- Se añadió cobertura de Auth fallida sin `req.ip`: responde `401`, no llama al
  rate limiter y no crea un bucket global.
- Se corrigió la evidencia RED del plan: la corrida aislada sin emuladores se
  conserva como error de harness (`ECONNREFUSED`), no como fallo funcional. La
  corrida válida en Emulator Suite se reporta con su resultado real; el timeout
  inicial de 20 s para 21 requests concurrentes se documenta como contención del
  harness y el caso tiene timeout explícito de 40 s.

## Fix Round 1 Verification

- `npm.cmd --prefix functions run build`: pasó.
- `npx vitest run tests/functions/public-consent-http.test.ts`: 1 archivo,
  24 tests pasaron.
- `npx firebase emulators:exec --project demo-donaciones-venezuela --only
  auth,firestore,functions "npx vitest run
  tests/emulators/volunteer-consent.integration.test.ts"`: 1 archivo,
  11 tests pasaron.
- `npm.cmd run test:functions`: 11 archivos, 107 tests pasaron.
- `npm.cmd run test:emulators`: 15 archivos, 132 tests pasaron.
- Ambas corridas emitieron únicamente las observaciones existentes de Node 24
  del host frente a Functions Node 22 y `MetadataLookupWarning` del entorno
  local; terminaron con código 0.

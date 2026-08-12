# Consent Protection and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proteger `setVolunteerPublicConsent` con rate limiting transaccional y App Check configurable, y documentar el borrador de consentimiento y los gates operativos sin activar servicios remotos.

**Architecture:** Un guard previo al consentimiento valida App Check según modo configurable y consume un rate limit Firestore antes de abrir la transacción de perfil/proyección/auditoría. El rate limiter usa hashes SHA-256, cubos separados para UID autenticado e intentos fallidos por `req.ip`, y responde con errores estables sin almacenar secretos. La documentación legal y operativa queda separada del código y bloquea producción hasta revisión humana.

**Tech Stack:** Firebase Admin SDK `14.2.0`, Firebase Functions v2 `7.3.2`, Firestore, Firebase App Check Admin SDK, TypeScript estricto, Vitest `4.1.10`, Emulator Suite, Node.js 22 declarado para Functions.

## Global Constraints

- Proyecto Firebase: `donaciones-venezuela-4fc29`.
- Proyecto de pruebas: `demo-donaciones-venezuela`.
- La base comienza vacia; no se migran ni inventan usuarios, datos, tokens, PINs, hashes o credenciales heredadas.
- El endpoint seguirá exigiendo Auth; la identidad anónima solo limita intentos fallidos y nunca sustituye Auth.
- `uid:<sha256(uid)>` permite 5 solicitudes por hora; `request:<sha256(req.ip)>` permite 20 intentos fallidos de Auth por hora.
- Nunca se almacenan IP, token, email, body ni headers completos; `rateLimits/{keyHash}` solo contiene bucket, windowStart, hits y expiresAt.
- `APP_CHECK_MODE` admite `disabled`, `log-only` y `enforced`; no se activa enforcement remoto en este plan.
- Errores de rate limit/App Check son estables y no contienen detalles del SDK.
- La proyección sigue v1 sin foto y no se modifican `services/api.js`, UI, otros perfiles ni las 65 acciones.
- No se despliega, activa Blaze, crea staging/producción, escribe datos remotos ni ejecuta bootstrap.
- El texto legal comienza con `BORRADOR - REVISIÓN LEGAL PENDIENTE` y no se considera aprobado.
- Producción queda bloqueada hasta completar el checklist operativo y obtener confirmación explícita.
- Cada tarea termina con pruebas propias, revisión del diff y un commit reversible.

## File Map

- Create: `docs/legal/volunteer-public-consent-draft.md` - borrador técnico de consentimiento v1.
- Create: `docs/runbooks/volunteer-consent-production-gates.md` - checklist de producción, monitoreo y rollback.
- Modify: `docs/runbooks/volunteer-public-consent.md:1-17` - referenciar los nuevos gates y mantener producción bloqueada.
- Create: `functions/src/security/rate-limit.ts` - hashing, buckets, transacción, límites y `RateLimitError`.
- Create: `tests/functions/rate-limit.test.ts` - pruebas unitarias de ventana, hash, límites y errores.
- Create: `functions/src/security/app-check.ts` - modos configurables y verificador inyectable.
- Create: `tests/functions/app-check.test.ts` - pruebas de `disabled`, `log-only`, `enforced` y errores seguros.
- Modify: `functions/src/volunteers/public-consent-http.ts:1-181` - aplicar guards antes de la transacción y respuestas 429/403.
- Modify: `functions/src/index.ts:1-22` - mantener exports y configuración sin activar enforcement remoto.
- Modify: `tests/functions/public-consent-http.test.ts` - probar rate limit/App Check antes de publicar.
- Modify: `tests/emulators/volunteer-consent.integration.test.ts` - probar seis requests, bloqueo y ausencia de mutación.
- Modify: `package.json:18-21` - incluir las pruebas nuevas en comandos existentes.
- Modify: `docs/superpowers/plans/2026-08-11-consent-protection-operations.md` - marcar checks con evidencia real.

---

### Task 1: Borrador de consentimiento y gates operativos

**Files:**
- Create: `docs/legal/volunteer-public-consent-draft.md`
- Create: `docs/runbooks/volunteer-consent-production-gates.md`
- Modify: `docs/runbooks/volunteer-public-consent.md:1-17`

**Interfaces:**
- Consumes: contrato técnico `volunteer-public-v1`, `DATA_RETENTION_POLICY.md` y runbook actual.
- Produces: texto versionado marcado como borrador y checklist que bloquea producción.

- [ ] **Step 1: Write the draft and checklist**

Crear `docs/legal/volunteer-public-consent-draft.md` empezando exactamente con:

```text
BORRADOR - REVISIÓN LEGAL PENDIENTE
Versión técnica: volunteer-public-v1
No usar como texto legal aprobado ni desplegar sin revisión del operador.
```

Incluir secciones `Finalidad`, `Audiencia`, `Campos de esta versión`, `Datos excluidos`, `Voluntariedad`, `Duración y retiro`, `Revocación administrativa`, `Cambios de versión` y `Canal de contacto`. El cuerpo debe decir que se publican solo nombre, zona, habilidades, estado activo y fecha de alta; no fotografía, email, teléfono, UID, documentos, ubicación precisa, tokens, archivos ni rutas privadas. El canal de contacto debe permanecer como `PENDIENTE DE APROBACIÓN`, sin inventar correo, teléfono o URL.

Crear `docs/runbooks/volunteer-consent-production-gates.md` con estas casillas:

```text
[ ] Revisión legal del borrador y aprobación de la versión publicada.
[ ] Canal de contacto real aprobado y probado.
[ ] Texto de retiro y revocación probado manualmente.
[ ] App Check configurado para clientes reales y enforcement aprobado.
[ ] Rate limits, alertas y métricas configurados.
[ ] Backup y restauración verificados; rollback ensayado.
[ ] Node runtime de Functions alineado con Node 22 en CI.
[ ] npm audit revisado y decisión documentada para moderates.
[ ] Pruebas unitarias, Functions y Emulator Suite verdes.
[ ] Revisión de seguridad sin hallazgos críticos.
[ ] Prueba manual de activar, revocar y verificar ausencia pública.
[ ] Confirmación explícita del operador para desplegar.
```

Documentar que cualquier casilla pendiente bloquea producción, staging, Blaze y publicación real. Documentar rollback por revert de código/reglas sin borrar perfiles privados ni auditoría.

- [ ] **Step 2: Run documentation checks**

Run: `git diff --check -- docs/legal/volunteer-public-consent-draft.md docs/runbooks/volunteer-consent-production-gates.md docs/runbooks/volunteer-public-consent.md`

Expected: sin errores; el borrador conserva la cabecera exacta y no contiene credenciales ni canales inventados.

- [ ] **Step 3: Update existing runbook**

Agregar al runbook existente referencias a:

```text
Borrador legal: docs/legal/volunteer-public-consent-draft.md
Gates de producción: docs/runbooks/volunteer-consent-production-gates.md
Estado: producción bloqueada; App Check enforced no activado remotamente.
```

- [ ] **Step 4: Commit**

```bash
git add docs/legal/volunteer-public-consent-draft.md docs/runbooks/volunteer-consent-production-gates.md docs/runbooks/volunteer-public-consent.md
git commit -m "docs: add volunteer consent production gates"
```

### Task 2: Rate limiter transaccional

**Files:**
- Create: `functions/src/security/rate-limit.ts`
- Create: `tests/functions/rate-limit.test.ts`

**Interfaces:**
- Consumes: Firestore Admin adapter con `collection`, `doc`, `runTransaction`, `get`, `set` y reloj inyectable.
- Produces: `RATE_LIMITS`, `RateLimitError`, `hashRateLimitKey(value)`, `createUidRateLimitKey(uid)`, `createRequestRateLimitKey(reqIp)`, `consumeRateLimit(bucket, keyValue, now, db)`.

- [ ] **Step 1: Write the failing tests**

Crear pruebas con fake transaction que aplique writes solo cuando el callback termina correctamente:

```ts
it('hashea la clave sin guardar el valor original', () => {
  expect(hashRateLimitKey('uid-1')).toMatch(/^[a-f0-9]{64}$/);
  expect(hashRateLimitKey('uid-1')).not.toContain('uid-1');
  expect(createUidRateLimitKey('uid-1')).toBe(`uid:${hashRateLimitKey('uid-1')}`);
   expect(createRequestRateLimitKey('203.0.113.7')).toBe(`request:${hashRateLimitKey('203.0.113.7')}`);
});

it('permite cinco requests UID y rechaza la sexta', async () => {
  const db = createRateLimitDb();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await expect(consumeRateLimit('uid', 'uid-1', 0, db)).resolves.toMatchObject({ allowed: true });
  }
  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toMatchObject({
    code: 'rate-limit-exceeded',
    retryAfter: 3600,
  });
});

it('reinicia una ventana expirada', async () => {
  const db = createRateLimitDb();
  await consumeRateLimit('uid', 'uid-1', 0, db);
  await expect(consumeRateLimit('uid', 'uid-1', 3600001, db)).resolves.toMatchObject({ allowed: true, hits: 1 });
});

it('rechaza IP ausente sin usar una clave global', async () => {
  await expect(createRequestRateLimitKey('')).toThrow('request-identity-required');
});

it('no deja write committed cuando falla la transaccion', async () => {
  const db = createRateLimitDb({ failOnSet: true });
  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow('rate-limit-storage-failed');
  expect(db.committed()).toEqual({});
});
```

La prueba debe llamar directamente a `hashRateLimitKey`; no introducir un segundo algoritmo hash.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/functions/rate-limit.test.ts`

Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Write the minimal implementation**

Implementar:

```ts
export const RATE_LIMITS = {
  uid: { limit: 5, windowMs: 60 * 60 * 1000 },
  request: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

export class RateLimitError extends Error {
  readonly code = 'rate-limit-exceeded';
  constructor(public readonly retryAfter: number) {
    super('Too many requests');
  }
}
```

Usar `createHash('sha256').update(value, 'utf8').digest('hex')`. `createRequestRateLimitKey` debe recortar `req.ip` y rechazar vacío. `consumeRateLimit` debe validar bucket, calcular `keyHash` sobre la clave completa (`uid:<hash>` o `request:<hash>`), usar una transacción Admin SDK, crear/actualizar únicamente `rateLimits/{keyHash}` con `bucket`, `windowStart`, `hits`, `expiresAt`, y devolver `{ allowed: true, hits, retryAfter: 0 }`. Al superar el límite, no incrementar y lanzar `RateLimitError` con segundos enteros positivos. Los errores de Firestore deben convertirse en `Error('rate-limit-storage-failed')` sin causa original.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/functions/rate-limit.test.ts`

Expected: pasan hash, límites UID/request, ventana, rollback y errores seguros.

- [ ] **Step 5: Commit**

```bash
git add functions/src/security/rate-limit.ts tests/functions/rate-limit.test.ts
git commit -m "feat: add transactional consent rate limits"
```

### Task 3: App Check configurable y guards del endpoint

**Files:**
- Create: `functions/src/security/app-check.ts`
- Create: `tests/functions/app-check.test.ts`
- Modify: `functions/src/volunteers/public-consent-http.ts:1-181`
- Modify: `tests/functions/public-consent-http.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest`, rate limiter, `APP_CHECK_MODE` y verificador App Check inyectable.
- Produces: `AppCheckMode`, `AppCheckError`, `getAppCheckMode()`, `verifyConfiguredAppCheck(request, verifier?)`, y guards previos en `setVolunteerPublicConsentHandler`.

- [ ] **Step 1: Write the failing App Check and endpoint tests**

Crear pruebas:

```ts
it('disabled no exige token', async () => {
  expect(await verifyConfiguredAppCheck({ headers: {} }, async () => {
    throw new Error('must-not-run');
  }, 'disabled')).toEqual({ mode: 'disabled', verified: false });
});

it('log-only acepta ausencia y no expone errores', async () => {
  await expect(verifyConfiguredAppCheck({ headers: {} }, vi.fn(), 'log-only'))
    .resolves.toEqual({ mode: 'log-only', verified: false });
});

it('enforced exige X-Firebase-AppCheck y normaliza fallo', async () => {
  await expect(verifyConfiguredAppCheck({ headers: {} }, vi.fn(), 'enforced'))
    .rejects.toMatchObject({ code: 'app-check-required', status: 403 });
  await expect(verifyConfiguredAppCheck(
    { headers: { 'x-firebase-appcheck': 'bad' } },
    async () => { throw new Error('secret SDK detail'); },
    'enforced',
  )).rejects.toMatchObject({ code: 'app-check-required', status: 403 });
});
```

Extender `tests/functions/public-consent-http.test.ts` para que un rate-limit rechazado devuelva status 429 con `Retry-After`, App Check enforced rechazado devuelva 403, y ninguno llame a `applyConsent`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/functions/app-check.test.ts tests/functions/public-consent-http.test.ts`

Expected: FAIL porque no existe el adaptador App Check ni los guards integrados.

- [ ] **Step 3: Write minimal App Check implementation and endpoint guards**

`getAppCheckMode` debe aceptar solo `disabled`, `log-only`, `enforced`; cualquier otro valor vuelve a `disabled` en tests y no habilita enforcement accidental.

Leer el token únicamente de `x-firebase-appcheck` o `X-Firebase-AppCheck` mediante el accessor de request. En `enforced`, llamar a `getAppCheck().verifyToken(token)` por defecto y permitir un verificador inyectado en tests. Cualquier ausencia/fallo lanza `AppCheckError('app-check-required', 403, 'App Check required')`. En `log-only`, devolver `{ mode, verified: false }` si falta y `{ mode, verified: true }` si verifica; no registrar token ni detalles.

En `setVolunteerPublicConsentHandler`, antes de `apply`:

1. validar App Check según modo;
2. ejecutar Auth y usar el UID verificado para consumir el bucket `uid`;
3. si Auth falla, consumir `request` usando `req.ip` normalizada y responder 401 seguro;
4. si rate limit excede, responder 429, `Retry-After` y `rate-limit-exceeded`;
5. solo entonces ejecutar el consentimiento.

Los guards deben usar dependencias inyectables para que no se creen documentos reales en tests unitarios. No almacenar datos de rate limit en logs o respuestas.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/functions/rate-limit.test.ts tests/functions/app-check.test.ts tests/functions/public-consent-http.test.ts`

Expected: pasan modos, headers, errores, limites y garantía de que el consentimiento no se ejecuta cuando un guard falla.

- [ ] **Step 5: Commit**

```bash
git add functions/src/security/app-check.ts functions/src/volunteers/public-consent-http.ts tests/functions/app-check.test.ts tests/functions/public-consent-http.test.ts
git commit -m "feat: guard volunteer consent with app check and limits"
```

### Task 4: Emulator Suite, runbooks y cierre

**Files:**
- Modify: `tests/emulators/volunteer-consent.integration.test.ts`
- Modify: `tests/rules/volunteer-public.rules.test.ts`
- Modify: `package.json:18-21`
- Modify: `docs/runbooks/volunteer-public-consent.md:1-17`
- Create: `docs/runbooks/volunteer-consent-production-gates.md`
- Create: `docs/legal/volunteer-public-consent-draft.md`
- Modify: `docs/superpowers/plans/2026-08-11-consent-protection-operations.md` - marcar checks con evidencia.

**Interfaces:**
- Consumes: rate limiter, App Check, endpoint de consentimiento, Auth/Firestore/Functions Emulator y runbook actual.
- Produces: evidencia local de `5 OK + 1 429`, intentos request limitados, App Check por modo, rateLimits cerrado y gates de producción.

- [x] **Step 1: Write the failing integration additions**

  Evidencia: `tests/emulators/volunteer-consent.integration.test.ts` cubre 6
  solicitudes concurrentes (`5` respuestas `200` y `1` respuesta `429`),
  `Retry-After`, cinco auditorías exactas, 21 intentos Auth fallidos (`20`
  respuestas `401` y `1` respuesta `429`), App Check local en `disabled`,
  `log-only` y `enforced`, y ausencia de mutación cuando el guard bloquea.
  `tests/rules/volunteer-public.rules.test.ts` cubre lectura/escritura
  denegadas para `rateLimits`.

Agregar a la integración:

```ts
it('bloquea la sexta solicitud UID sin mutar el consentimiento', async () => {
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => callConsent({ enabled: true })),
  );
  expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
  expect(responses[5].status).toBe(429);
  expect(responses[5].headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/);
  expect(await readPrivateConsent()).toEqual(previousState);
});

it('no permite al cliente leer ni escribir rateLimits', async () => {
  await assertFails(getDoc(doc(clientFirestore, 'rateLimits/test')));
  await assertFails(setDoc(doc(clientFirestore, 'rateLimits/test'), { hits: 1 }));
});
```

Agregar casos de App Check local para `disabled`, `log-only` y `enforced` mediante verificador inyectado o configuración de test, sin activar enforcement remoto. Limpiar Firestore antes de cada caso y usar IDs UUID para que no haya contaminación.

- [x] **Step 2: Run tests to verify they fail**

  Evidencia: `npm.cmd --prefix functions run build` pasó; la primera corrida
  aislada sin emuladores falló con `ECONNREFUSED 127.0.0.1:8080`, y la primera
  corrida con emuladores detectó una aserción incorrecta de estado de prueba.
  La expectativa se corrigió sin cambios de producción.

Run: `npm.cmd --prefix functions run build` y después `npx vitest run tests/emulators/volunteer-consent.integration.test.ts`

Expected: FAIL hasta que los guards estén cableados y `rateLimits` siga cerrado en las reglas.

- [x] **Step 3: Wire commands and document gates**

  Evidencia: `package.json` ya contiene la integración de consentimiento junto
  con `health` y `authSession`, y `test:functions` levanta `auth,firestore,functions`.
  `docs/runbooks/volunteer-public-consent.md`, el borrador legal y los gates
  operativos están presentes; producción y `APP_CHECK_MODE=enforced` remoto
  siguen bloqueados.

Actualizar `package.json` para que `test:functions:run` incluya la integración actual y `test:functions` levante `auth,firestore,functions`; conservar health y authSession.

Actualizar el runbook de consentimiento con enlaces al borrador y checklist, indicando que `APP_CHECK_MODE=enforced` no se activa remotamente en esta tarea.

- [x] **Step 4: Run complete verification**

  Evidencia de cierre registrada en el reporte de Task 4:
  `npm.cmd run test:unit`, `npm.cmd run test:functions`,
  `npm.cmd run test:emulators`, `npm.cmd run build`, auditorías npm y
  `python scripts/verificar-idioma.py`, ejecutados en ese orden.
  Observaciones esperadas: host Node 24 frente a runtime Functions 22 y
  advertencias/moderates existentes, documentadas sin activar servicios remotos.

Run, en este orden:

```bash
npm.cmd run test:unit
npm.cmd run test:functions
npm.cmd run test:emulators
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

Expected: todas pasan; no hay `high`/`critical`; moderate, Node host 24 vs engine 22 y warnings legacy se documentan como observaciones actuales. No ejecutar deploy ni configuración remota.

- [x] **Step 5: Security review and commit**

  Evidencia: diff revisado; `rateLimits` permanece cerrado al cliente, no se
  persisten IP/token/email/body/header completos, App Check enforced no se
  activa remotamente, y `services/api.js`, UI y otras acciones no cambian.

Confirmar en el diff:

```text
rateLimits sigue inaccesible al cliente;
no se almacena IP/token/email/body/header completo;
App Check enforced nunca se activa remotamente;
el sexto request no muta consentimiento/proyección/auditoría;
el borrador legal conserva su encabezado pendiente;
las casillas operativas bloquean producción;
services/api.js, UI y otras acciones no cambiaron;
```

Ejecutar `git diff --check`, revisar `git status` y commitear:

```bash
git add functions/src/security functions/src/volunteers/public-consent-http.ts tests/functions tests/emulators/volunteer-consent.integration.test.ts tests/rules/volunteer-public.rules.test.ts package.json docs/legal docs/runbooks docs/superpowers/plans/2026-08-11-consent-protection-operations.md
git commit -m "test: verify consent protection gates"
```

## Self-Review: Spec Coverage

Task 1 cubre borrador legal, version v1, retiro, canal pendiente y checklist operativo. Task 2 cubre hash SHA-256, buckets UID/request, ventanas, límites, retry-after y fail-closed. Task 3 cubre App Check configurable, headers, modos, errores seguros y guards previos. Task 4 cubre concurrencia, no mutación bloqueada, reglas rateLimits, comandos y verificación completa.

Quedan fuera deliberadamente activación App Check remota, deploy, Blaze, asesoría legal, otros endpoints, UI, `services/api.js`, fotos y perfiles reales.

No hay apartados incompletos ni tipos ambiguos: los límites, cubos, campos, modos, headers, errores, archivos y comandos están definidos literalmente.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-consent-protection-operations.md`. Two execution options:

1. **Subagent-Driven (recommended):** dispatch a fresh subagent per task, review each result and rerun tests before accepting it.
2. **Inline Execution:** execute tasks in this session with checkpoints after each task.

# Proteccion del Consentimiento y Gates Operativos

**Fecha:** 2026-08-11
**Estado:** aprobada por el operador
**Proyecto Firebase:** `donaciones-venezuela-4fc29`
**Proyecto de pruebas:** `demo-donaciones-venezuela`

> **BORRADOR - REVISIÓN LEGAL PENDIENTE**

## Contexto

La Function `setVolunteerPublicConsent` permite que el titular de un perfil de
voluntario active o revoque una proyeccion publica v1 sin foto. La transaccion,
allowlist, auditoria y pruebas de Emulator Suite ya estan implementadas. Antes
de cualquier exposicion a escala faltan tres gates:

1. un texto de consentimiento revisado legalmente;
2. proteccion contra abuso y validacion configurable de App Check;
3. un checklist operativo con rollback, monitoreo y aprobacion explicita.

No se habilitara produccion ni se modificara el proyecto Firebase remoto como
parte de este subproyecto. Las pruebas seran locales y usaran fixtures
sinteticos.

## Decision

Implementar localmente los tres prerrequisitos:

- Un borrador versionado de consentimiento en español, separado del codigo y
  marcado como pendiente de revision legal.
- Rate limiting distribuido en Firestore mediante transacciones y documentos
  `rateLimits`, aplicado antes de la transaccion de consentimiento.
- Validacion de App Check configurable con modos `disabled`, `log-only` y
  `enforced`, probados localmente sin exigir activacion remota.
- Checklist operativo que bloquea producción hasta cumplir revisión legal,
  configuración remota, alertas, backup/rollback, prueba manual y autorización
  explícita del operador.

El endpoint seguirá exigiendo Auth. El cubo de identidad autenticada se aplica
por UID después de verificar el token; la identidad de request solo limita
intentos fallidos de autenticación y nunca sustituye Auth.

## Alternativas descartadas

### Solo documentación

Un borrador y un checklist sin protección técnica dejarían el endpoint expuesto a
abuso. Se descarta como entrega suficiente.

### App Check remoto inmediato

Activar App Check, alertas o límites en el proyecto real requiere configuración
operativa, posible impacto en clientes y un checkpoint separado. Se reserva
para después de validar los contratos en Emulator Suite.

### Callable Function obligatoria

Callable integra Auth/App Check con Firebase, pero cambiar el contrato HTTP
existente ahora introduce una decisión de compatibilidad innecesaria. Se
mantiene HTTP con validadores explícitos.

## Alcance

### Incluye

- Documento `docs/legal/volunteer-public-consent-draft.md` marcado como borrador.
- Version `volunteer-public-v1` y texto de finalidad, audiencia, campos,
  voluntariedad, duración, retiro, revocación y revisión de versión.
- Rate limiter por `uid:<hash>` y por `request:<hash>` para fallos de Auth.
- Documentos privados `rateLimits/{keyHash}` con `windowStart`, `hits`,
  `expiresAt` y tipo de cubo, sin IP/token/body.
- App Check configurable y errores estables.
- Tests unitarios, Functions y Emulator Suite de límites, concurrencia y modos.
- Checklist `docs/runbooks/volunteer-consent-production-gates.md`.
- Actualización del runbook de consentimiento para referenciar los gates.

### No incluye

- Activar App Check en `donaciones-venezuela-4fc29`.
- Desplegar Functions o reglas.
- Crear staging/producción, activar Blaze o generar gasto.
- Obtener asesoría legal real o declarar el borrador jurídicamente aprobado.
- Cambiar UI legacy, `services/api.js` o el contrato público de otros dominios.
- Publicar perfiles reales, añadir fotos o ampliar la allowlist.
- Rate limiting para las demás 65 acciones.

## Borrador de consentimiento

El archivo legal debe comenzar exactamente con:

```text
BORRADOR - REVISIÓN LEGAL PENDIENTE
Versión técnica: volunteer-public-v1
No usar como texto legal aprobado ni desplegar sin revisión del operador.
```

Contenido mínimo:

```text
Finalidad
Autorizo que mi perfil de voluntariado pueda aparecer en un directorio público
para facilitar que organizaciones y personas conozcan la disponibilidad de
apoyo voluntario.

Audiencia
La información publicada podrá ser consultada por cualquier visitante del sitio.

Campos de esta versión
Se mostrarán únicamente nombre, zona, habilidades, estado activo y fecha de alta.
Esta versión no publica fotografía.

Datos excluidos
No se publicarán correo electrónico, teléfono, UID de autenticación,
documentos, ubicación precisa, tokens, archivos ni rutas privadas.

Voluntariedad
Aceptar esta publicación es opcional. Recibir ayuda, registrarse o participar
como voluntario no depende de aceptar la publicación del perfil.

Duración y retiro
El consentimiento permanece vigente hasta que lo retire, el perfil deje de
estar activo o la organización retire la publicación por seguridad, privacidad o
incumplimiento. Puedo pedir el retiro mediante el canal de contacto aprobado.

Revocación administrativa
El titular puede revocar. Personal panel o administrador puede retirar la
proyección para proteger a la persona o al servicio, dejando constancia mínima
de la acción. La revocación no borra el perfil privado.

Cambios de versión
Agregar una fotografía, un nuevo campo o una audiencia distinta requiere una
nueva versión de consentimiento y no queda autorizado por este texto.

Canal de contacto
El canal se completará únicamente después de aprobación operativa. No inventar
correo, teléfono ni URL en esta versión.
```

La UI no incorporará este texto en esta entrega; el archivo es el insumo para
revisión legal y para una futura tarea de interfaz. La confirmación técnica
debe conservar `consentVersion: "volunteer-public-v1"`.

## Rate limiting

### Cubos

```text
uid:<sha256(uid)>       5 solicitudes por hora
request:<sha256(id)>   20 intentos fallidos de autenticación por hora
```

`uid` se obtiene solo después de verificar el ID token. Para intentos sin Auth,
`request identity` es `req.ip` normalizada por Functions, con espacios recortados
y formato IPv4/IPv6 conservado, hasheada con SHA-256. El valor crudo nunca se
persiste. No se almacenan IP, token, email, body ni headers completos. Si
`req.ip` no existe, el intento se rechaza con error seguro y no se usa una clave
global compartida.

### Documento

`rateLimits/{keyHash}`:

```text
bucket: "uid" | "request"
windowStart: Timestamp
hits: number
expiresAt: Timestamp
```

El hash completo es el ID del documento. Firestore Rules mantiene esta ruta
cerrada al cliente. La transacción debe:

1. leer el documento;
2. crear una ventana nueva si no existe o expiró;
3. rechazar con `RateLimitError` si `hits >= limit`;
4. incrementar `hits` dentro de la misma transacción;
5. devolver el tiempo restante para `Retry-After`.

El control se ejecuta antes de `runTransaction` de consentimiento. Si el
rate-limit falla por error de infraestructura, la solicitud se rechaza de forma
fail-closed y no se ejecuta ninguna publicación.

### Respuesta

```json
{"error":{"code":"rate-limit-exceeded","message":"Too many requests"}}
```

Status `429`, header `Retry-After` en segundos enteros. No incluir keyHash,
contador interno ni identidad de request.

## App Check configurable

El adaptador debe exponer:

```text
APP_CHECK_MODE=disabled | log-only | enforced
```

- `disabled`: no intenta verificar App Check; usado en unit tests.
- `log-only`: valida cuando hay token, registra solo un resultado seguro y no
  bloquea ausencia; usado para pruebas de transición local.
- `enforced`: requiere token App Check válido y devuelve `403` genérico si falta
  o es inválido.

El token se recibe únicamente en el header `X-Firebase-AppCheck`. En modo
`enforced`, la Function debe llamar a `getAppCheck().verifyToken(token)` antes
de la transacción de consentimiento y rechazar el request si el header falta,
está vacío o no verifica.

El token App Check nunca aparece en logs, errores, auditoría ni respuestas. Los
errores remotos del SDK se convierten a `app-check-required` y `App Check
required`. La implementación local debe permitir inyección de un verificador
para pruebas y no activar enforcement remoto.

## Pruebas

### Unitarias

- SHA-256 determinista y no reversible en el ID de documento.
- Ventana nueva, ventana expirada e incremento atómico.
- Quinta solicitud permitida y sexta rechazada para UID.
- Vigésimo intento fallido permitido y vigésimo primero rechazado.
- `Retry-After` entero y positivo.
- No se guarda IP, token, email, body ni headers.
- App Check en `disabled`, `log-only` y `enforced`.
- Errores de rate limit/App Check sin detalles internos.

### Emulator Suite

- Ejecutar seis solicitudes autenticadas sintéticas y comprobar `5 OK + 1 429`.
- Ejecutar intentos inválidos y comprobar el límite del cubo request.
- Simular dos incrementos concurrentes y verificar que no se supera el límite.
- Verificar que el cliente no puede leer ni escribir `rateLimits`.
- Verificar que una solicitud bloqueada no crea, elimina ni modifica proyección,
  consentimiento ni auditoría.
- Repetir el flujo actual de activación/revocación de voluntario.
- Ejecutar los tres modos App Check con verificador inyectado/local.

## Checklist operativo de producción

El archivo de gates debe exigir marcar todos estos puntos antes de cualquier
despliegue:

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

Mientras una casilla esté pendiente, producción, staging, Blaze y publicación
real permanecen bloqueados.

## Rollback

- Revertir el commit del rate limiter/App Check para volver al endpoint local
  anterior; no borrar perfiles ni auditoría.
- Si el rate limiter bloquea incorrectamente, deshabilitarlo solo en Emulator
  Suite mediante configuración de test; nunca ignorar límites en producción.
- Si el texto legal cambia, incrementar la versión y requerir nuevo
  consentimiento; no reinterpretar consentimientos anteriores.
- No ejecutar migración destructiva ni escribir en el proyecto remoto.

## Gates

- No declarar el borrador como asesoría legal.
- No activar `enforced` remotamente sin autorización.
- No desplegar, activar Blaze ni crear entornos nuevos.
- No almacenar secretos, IP cruda, tokens o PII en rate limits/logs.
- Un hallazgo crítico de seguridad detiene el avance.

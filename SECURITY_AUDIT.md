# Auditoría de seguridad — estado previo a Firebase

**Fecha:** 2026-08-06  
**Resultado:** **hallazgo crítico confirmado; avance bloqueado**. `buscar_familiar` expone nombre, cédula y ubicación mediante un RPC público `SECURITY DEFINER`, y el navegador conserva esos resultados en snapshots sin TTL. Los demás gates locales de privacidad, Storage, cola offline y `health` están implementados, pero no pueden aprobarse mientras este hallazgo siga abierto.

La configuración web recibida corresponde a `donaciones-venezuela-4fc29`, documentado exclusivamente como desarrollo. Las reglas locales de Firestore y Storage permanecen deny-by-default. Las contraseñas compartidas en el canal no se guardaron ni se usaron; deben rotarse antes de cualquier prueba de autenticación. El build local de Vite pasa, pero todavía no hay lectura/escritura Firebase conectada a la UI.

Evidencia local de esta fase: `npm.cmd run test:unit` pasó 22 pruebas; la matriz de Rules pasó 8 pruebas en una ejecución previa de Emulator Suite; `npm.cmd run build` y `npm.cmd run build --prefix functions` terminaron correctamente; las auditorías con umbral alto terminaron con código 0 y reportaron solo vulnerabilidades moderadas transitivas. El build aún emite advertencias por los scripts clásicos legacy, que serán eliminados al migrar la fachada de datos. `npm.cmd run verify` no tiene todavía una ejecución completa porque otro proyecto mantiene ocupados los puertos contractuales de emulador, incluido `5001`.

## Controles corregidos localmente

- Firestore y Storage continúan cerrados y la matriz anónimo/usuario/panel/admin demuestra denegación de lectura y escritura.
- Los documentos canónicos sensibles y las ocho proyecciones públicas están separados; el sanitizador copia solo allowlists positivas y detecta campos prohibidos anidados.
- El adaptador Storage ya no importa ni exporta `getDownloadURL`; una carga devuelve únicamente el path. El contrato servidor limita futuras URLs privadas a 15 minutos y valida paths `private/` canónicos.
- La cola offline está deny-by-default, sin acciones habilitadas, con TTL de 24 horas, máximo de 3 intentos, idempotency key, purga legacy y borrado al cerrar sesión.
- `health` acepta solo `GET`, devuelve únicamente estado, versión y timestamp, y su unidad rechaza `POST` sin filtrar configuración.

## Controles todavía abiertos

- Retirar el acceso público a `buscar_familiar` o aprobar y diseñar un flujo autenticado/autorizado con respuesta minimizada; eliminar la persistencia indefinida de sus resultados. La corrección remota requiere migración y confirmación explícita.
- Migración de Auth, verificación de ID token, claims, revocación y eliminación de tokens propios en `localStorage`.
- Reglas funcionales por rol/propietario y pruebas adversariales una vez que se abran rutas.
- Contratos de las 65 acciones, rate limits distribuidos, idempotencia y concurrencia.
- Rotación comprobada de credenciales previamente compartidas.
- Ensayo restaurable previo a `T06`, backup final, reconciliación y procedimiento de corte.
- CSP/headers finales y eliminación de referencias funcionales a Supabase.

## Controles actuales observados

- Edge Function usa service role en servidor y valida JWT Supabase para perfiles.
- Hay límites de tasa (`rate_hit`), comparación constante para claves y validaciones de MIME/tamaño en uploads.
- Buckets privados usan URLs firmadas; `presupuestos` es público.
- CORS de la Edge Function es `*`.
- La clave administrativa se envía en el cuerpo de acciones admin y se compara con hash almacenado en `config`.
- El navegador guarda sesión/token en `localStorage` bajo `dv-sesion`.
- El frontend incluye una publishable key Supabase en código; no es un service role, pero debe desaparecer con la migración.
- `vercel.json` permite `connect-src https://*.supabase.co` y debe revisarse por completo.

## Riesgos de migración

| Riesgo | Nivel | Control requerido |
|---|---|---|
| Reglas permisivas que expongan PII | Alto | Denegar por defecto, claims y pruebas por rol con Emulator Suite |
| Confundir config Firebase con secreto Admin | Alto | Config pública solo en frontend; Admin SDK/Secret Manager solo Functions |
| Migrar hashes o tokens de Auth incorrectamente | Alto | Flujo oficial de importación o restablecimiento; no copiar refresh tokens |
| Cambiar atomicidad de facturas/donaciones/reservas | Alto | Transactions/batches e idempotency keys |
| URLs públicas para documentos privados | Alto | Storage privado, path por entidad, URL temporal y expiración |
| CORS/CSRF en Function HTTP | Alto | Orígenes explícitos, validación de `Authorization`, rate limit y esquema |
| Consultas que leen colecciones completas | Medio | Índices, límites, paginación y agregados |
| Logs con PII, tokens o comprobantes | Medio | Redacción estructurada y retención mínima |
| CSP incompleta tras quitar Supabase | Medio | Lista allowlist de Firebase, Functions, Storage y fuentes necesarias |
| Dependencias/build sin control | Medio | Lockfile, npm audit, revisión de bundle y headers Vercel |

## Diseño objetivo

### Auth y autorización

Firebase Auth debe gestionar la sesión con persistencia explícita (local, sesión o ninguna) y `onAuthStateChanged`; el SDK documenta esas opciones ([persistencia](https://firebase.google.com/docs/auth/web/auth-state-persistence?hl=en)). El frontend nunca debe guardar claves administrativas ni refresh tokens propios. Las Functions deben verificar el ID token y claims antes de ejecutar una acción; la colección de perfiles no sustituye la verificación criptográfica.

### Firestore

Las reglas deben empezar con `allow read, write: if false` y abrir únicamente operaciones necesarias. Firestore combina SDK cliente, Auth y Security Rules para autorización ([visión general](https://firebase.google.com/docs/firestore/security/overview?hl=en)); las librerías de servidor/Functions bypassan Rules y se controlan con IAM, por lo que cada Function requiere autorización propia.

Las reglas no son filtros: una consulta debe satisfacer las reglas para todos sus posibles resultados ([reglas y consultas](https://firebase.google.com/docs/firestore/security/rules-query)). Se deben probar anónimo, usuario autenticado, panel, admin y usuario de otra entidad.

### Cloud Functions

La Function `api` debe aceptar solo métodos y orígenes definidos, validar JSON con esquema, verificar `Authorization: Bearer`, aplicar rate limit distribuido, usar idempotencia en escrituras y devolver errores sin detalles internos. Las Functions HTTP no habilitan CORS por defecto y permiten configurar orígenes explícitos ([HTTP events](https://firebase.google.com/docs/functions/http-events)). Callable Functions ofrecen validación automática de Auth/App Check ([callable](https://firebase.google.com/docs/functions/callable?hl=en)), pero cambiar el contrato actual a callable requiere una decisión de compatibilidad; se recomienda conservar HTTP inicialmente.

### Storage

Reglas por bucket/path deben separar `comprobantes`, `damnificados`, `denuncias`, `registro-transportistas` y `presupuestos`. Validar autenticación, rol, propietario, MIME y tamaño tanto en Rules como en Function. Las descargas privadas deben usar URL temporal; las APIs Firebase soportan carga, descarga y borrado con controles del SDK ([subidas](https://firebase.google.com/docs/storage/web/upload-files), [descargas](https://firebase.google.com/docs/storage/web/download-files), [borrado](https://firebase.google.com/docs/storage/web/delete-files)).

### Integraciones y secretos

Telegram, fuentes de tasas, claves de cron, credenciales SMTP y cualquier secreto deben vivir en Secret Manager/configuración de Functions. Los errores de proveedores externos deben ser fail-soft, con timeout, backoff y sin registrar payloads sensibles.

## Checklist de verificación antes del corte

- [x] Caracterización deny-by-default de reglas Firestore y Storage para anónimo, usuario, panel y admin.
- [ ] Pruebas de Auth: alta, login, logout, expiración, cambio de contraseña y rol revocado.
- [ ] Pruebas de 65 acciones: anónimo, usuario, panel, admin y token inválido.
- [ ] Pruebas de concurrencia para factura, donación, reserva y contador.
- [ ] Validación MIME/tamaño y expiración de URLs de los cinco buckets.
- [ ] Prueba de redacción de logs y revisión de secretos en historial Git.
- [ ] CSP/headers Vercel sin `supabase.co` ni orígenes innecesarios.
- [ ] `npm audit`/lockfile/build reproducible y revisión del bundle.
- [ ] Ensayo de restauración desde respaldo Supabase y comparación de conteos/totales.
- [ ] Aprobación explícita del operador para el corte y el rollback.
- [ ] Rotación de las credenciales de prueba expuestas en el canal y creación de usuarios con contraseñas nuevas fuera del repositorio.

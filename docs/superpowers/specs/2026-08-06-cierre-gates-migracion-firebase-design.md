# Diseño de cierre de gates para la migración a Firebase

**Fecha:** 2026-08-06  
**Estado:** aprobado en conversación; pendiente de plan de implementación  
**Alcance:** cerrar `T01` y completar la preparación local de plataforma antes de iniciar `T04`  
**Fuera de alcance:** migrar Auth, desplegar Firebase, activar Blaze, crear staging/producción o mover datos reales

## 1. Contexto

La validación de `T00-T03` confirmó que las reglas deny-by-default y el scaffold Firebase existen localmente, pero la fase no puede avanzar a Auth. Persisten gates de arquitectura, privacidad, rollback, costos, entornos y QA documentados en `MIGRATION_VALIDATION.md`.

El enfoque aprobado es **gate-first incremental**: cerrar primero el contrato de plataforma y su evidencia local; después habilitar `T04` como una tarea separada.

## 2. Decisiones

1. `donaciones-venezuela-4fc29` se tratará exclusivamente como desarrollo.
2. Staging y producción serán proyectos Firebase separados, pero no se crearán ni configurarán durante este alcance.
3. Supabase seguirá siendo la fuente productiva hasta completar migración, reconciliación y corte aprobado.
4. Los datos canónicos sensibles serán privados. Las lecturas públicas usarán colecciones de proyección separadas.
5. Los archivos serán privados por defecto. El acceso privado temporal se emitirá desde Functions después de autorizar al solicitante.
6. La cola offline será deny-by-default y no persistirá payloads sensibles.
7. No se activará Blaze ni se desplegarán Functions sin una confirmación explícita posterior.
8. El backup restaurable bloqueará `T06`, no `T04`; un backup final verificado bloqueará el corte productivo.
9. Los accesos de centros migrarán por invitación/restablecimiento Firebase. No se copiarán PIN, hash ni tokens de sesión.
10. Cloud Functions usará `us-east1`, elegida por proximidad a Venezuela y elegibilidad de cuota gratuita aplicable a Storage en esa región.

## 3. Arquitectura

### 3.1 Entornos

La configuración local reconocerá tres aliases conceptuales:

- `dev`: `donaciones-venezuela-4fc29`.
- `staging`: proyecto separado obligatorio antes de pruebas integradas remotas; ID aún no asignado porque su creación está fuera de alcance.
- `prod`: proyecto separado obligatorio antes del corte; ID aún no asignado porque su creación y uso requieren confirmación explícita.

Los IDs no asignados no se escribirán como valores ficticios en `.firebaserc`. Se documentarán como prerequisitos operativos para evitar que un comando apunte accidentalmente al proyecto incorrecto.

### 3.2 Componentes

```text
Navegador
  ├─ Firebase Auth SDK
  ├─ repositorios de proyecciones públicas
  └─ cliente HTTP autenticado
          │
          ▼
Cloud Functions
  ├─ health
  ├─ api (frontera futura de acciones privilegiadas)
  ├─ autorización por ID token + custom claims
  ├─ sanitización de proyecciones públicas
  └─ emisión de URLs firmadas temporales
          │
          ├─ Firestore privado + proyecciones públicas
          └─ Storage private/ + public/
```

En este alcance solo se implementará la estructura local mínima de Functions y `health`. `api`, proyecciones y firma de URLs se definen como contratos verificables, no como integración productiva.

## 4. Modelo de datos

### 4.1 Documentos canónicos privados

Las colecciones canónicas conservarán el estado completo necesario para negocio y auditoría. Entre ellas:

- `voluntarios`
- `rescatistas`
- `motorizados`
- `personas`
- `familiasDamnificadas`
- `facturas`
- `donaciones`
- `denuncias`
- `centrosPanel`
- `auditoriaAdmin`

No se autorizarán lecturas públicas directas sobre estas colecciones.

### 4.2 Proyecciones públicas

Las vistas públicas actuales se representarán con colecciones independientes:

- `lugaresPublicos`
- `voluntariosPublicos`
- `rescatistasPublicos`
- `motorizadosPublicos`
- `vacantesPublicas`
- `facturasPublicas`
- `historialPublico`
- `entregasPublicas`

Cada proyección tendrá una allowlist de campos. Una denylist defensiva impedirá publicar, como mínimo:

- email y teléfono privados;
- documento, cédula y placa;
- `authUid`, PIN, hash, token interno o claims;
- direcciones/ubicaciones familiares precisas;
- paths privados, comprobantes y evidencias no públicas;
- metadata interna, IP, notas de investigación o payloads de auditoría.

La implementación deberá enumerar la allowlist exacta de cada colección en `FIRESTORE_SCHEMA.md`. El sanitizador construirá un objeto nuevo tomando solo esas claves; no copiará el documento y luego intentará borrar campos prohibidos.

Cuando una operación de negocio requiera actualizar el documento privado y su proyección, Functions usará una transacción o batch para que ambos cambios se confirmen juntos. Si la proyección no puede generarse de forma segura, la operación privada podrá completarse únicamente cuando el caso de uso tolere una proyección ausente y exista un mecanismo idempotente de reparación; ese comportamiento deberá quedar explícito por dominio en las tareas posteriores.

### 4.3 Roles e identidad

- Firebase Auth establece identidad y sesión.
- Custom claims establece roles privilegiados `admin` y `panel`.
- Firestore puede guardar perfiles y relaciones de negocio, pero no reemplaza la verificación criptográfica del ID token.
- Functions verificará token, claim, pertenencia y esquema de entrada. La revocación se comprobará en acciones administrativas, accesos a archivos privados y cambios de rol; un endpoint público sin identidad no intentará validar tokens.
- Los centros recibirán invitación o flujo de restablecimiento. El token + PIN legacy permanecerá solo en Supabase durante la transición y se revocará al corte.

## 5. Storage

### 5.1 Rutas

```text
private/{dominio}/{entidadId}/{archivoId}
public/{dominio}/{entidadId}/{archivoId}
```

- `private/` contendrá comprobantes, documentos, fotos de verificación, denuncias y evidencias restringidas.
- `public/` contendrá solo artefactos aprobados para publicación y sin PII.
- El estado público no podrá decidirse mediante metadata enviada libremente por el cliente.

### 5.2 Acceso

- El cliente no usará `getDownloadURL()` como contrato para archivos privados.
- Mientras no exista la Function firmante, `uploadFile()` devolverá solo el path y no una URL; el helper público `downloadUrl()` se retirará para impedir que se consolide como contrato accidental.
- Una Function verificará ID token, rol/propiedad y finalidad antes de emitir una URL firmada.
- La expiración máxima será de 15 minutos.
- La respuesta y los logs no incluirán más metadata que la necesaria.
- MIME, tamaño y path se validarán en cliente como UX, en Rules como control de frontera y en Functions como defensa adicional cuando el backend intervenga.

## 6. Cola offline

### 6.1 Política

La cola cambia de allowlist amplia a deny-by-default. Inicialmente ninguna acción actual estará habilitada. Cada dominio podrá habilitar una acción solo después de demostrar mediante prueba de esquema que su payload no contiene:

- credenciales o tokens;
- documentos, fotos, video o comprobantes;
- GPS o ubicación sensible;
- información familiar, denuncias o datos financieros;
- PII no destinada explícitamente a publicación.

### 6.2 Ciclo de vida

Toda entrada permitida incluirá:

- `queueId` e `idempotencyKey` estables;
- `createdAt` y `expiresAt` con TTL máximo de 24 horas;
- `attempts`, con máximo de 3;
- código de último error sanitizado, sin copiar respuestas o payloads sensibles.

La entrada se eliminará al confirmar éxito, al expirar, al superar intentos o al cerrar sesión. Una acción no podrá habilitarse offline hasta que su endpoint implemente consulta/reconciliación por `idempotencyKey`; una respuesta incierta después de timeout se reconciliará antes de repetir la escritura.

## 7. Functions y errores

### 7.1 Scaffold local

Se añadirá un workspace TypeScript de Functions con:

- runtime Node 22 fijado;
- región `us-east1` fijada;
- Firebase Admin SDK solo en servidor;
- `health` HTTP;
- estructura preparada para `api`, sin portar todavía las 65 acciones;
- configuración de emuladores Firestore, Storage, Auth y Functions.

`health` aceptará únicamente `GET` y responderá:

```json
{
  "status": "ok",
  "version": "local",
  "timestamp": "ISO-8601"
}
```

No devolverá variables de entorno, project metadata, secretos, stack traces ni estado de proveedores externos.

### 7.2 Errores y logs

- Los errores públicos usarán código estable, status HTTP y mensaje sanitizado.
- Los detalles internos se conservarán solo en logs estructurados y redactados.
- No se registrarán tokens, emails completos, documentos, archivos, URLs firmadas ni payloads completos.
- Las integraciones externas usarán timeout, reintentos finitos con backoff e idempotencia cuando aplique.
- Telegram seguirá siendo fail-soft: su falla no revierte una operación de negocio ya confirmada.

## 8. Backup y rollback

### 8.1 Antes de T04

Se documentará:

- qué exportar de PostgreSQL/Auth/Storage;
- cifrado y ubicación del respaldo;
- responsable y fecha;
- comandos/procedimiento de restauración;
- criterios de integridad y reconciliación;
- RPO/RTO objetivo para ensayo y corte.

No se ejecutará una migración ni se accederá a datos productivos dentro de este alcance.

### 8.2 Gate antes de T06

Antes de implementar lecturas Firestore contra datos migrados deberá existir un respaldo reciente y un ensayo de restauración en entorno aislado. La evidencia incluirá conteos, relaciones, checksums de objetos y una muestra de consultas críticas.

### 8.3 Gate de corte

El corte requerirá backup final verificado, reconciliación, procedimiento de reversión, ventana aprobada y confirmación explícita del operador. Supabase no se eliminará durante la ventana de reversión.

## 9. Costos

- Desarrollo actual: Emulator Suite local, sin costo Firebase por pruebas.
- No se activará Blaze durante este alcance.
- Antes de Functions remotas se solicitará confirmación explícita para Blaze.
- Estimación inicial de carga baja: USD 0–10/mes dentro o cerca de cuotas incluidas.
- Escenario con archivos, egreso o consultas con fan-out: USD 10–100+/mes; deberá recalcularse con MAU, operaciones, GB almacenados y GB descargados reales.
- Alertas futuras: USD 5, USD 20 y USD 50.
- Las alertas notifican; no detienen automáticamente consumo ni facturación.

## 10. Estrategia de pruebas

El proyecto fijará en `package-lock.json`:

- `firebase-tools`;
- `@firebase/rules-unit-testing`;
- Vitest como runner compatible con ESM y Node 22.

Scripts mínimos:

- `test`: unitarias y contratos locales sin emulador cuando sea posible;
- `test:rules`: matriz anónimo/usuario/panel/admin sobre reglas cerradas;
- `test:functions`: contrato y seguridad de `health`;
- `test:emulators`: arranque de Auth, Firestore, Storage y Functions + suites integradas;
- `verify`: pruebas, build, auditoría y guardia de idiomas.

Cobertura obligatoria de este cierre:

1. Las reglas deny-by-default rechazan lectura y escritura para todos los roles.
2. `health` acepta `GET`, rechaza otros métodos y no filtra configuración.
3. La sanitización de proyecciones elimina todos los campos de la denylist.
4. La cola offline rechaza payloads sensibles.
5. TTL, máximo de intentos, purga e idempotency key funcionan de forma determinista.
6. `npm run build`, auditoría de dependencias y guardia de idiomas terminan con código 0.

Las pruebas E2E de Auth pertenecen a `T04` y quedan fuera de este cierre.

## 11. Criterios de aceptación

`T01` podrá volver a `completada` únicamente si:

1. Existe ADR aceptado para Supabase a Firebase, incluyendo alternativas y costo de salida.
2. `STACK.md`, `MIGRATION_PLAN.md`, `FIRESTORE_SCHEMA.md`, `SECURITY_AUDIT.md` y `tasks.md` no se contradicen.
3. El proyecto Firebase actual está documentado solo como desarrollo.
4. Staging/producción y Blaze permanecen sin crear/activar en este alcance.
5. El contrato público/privado y Storage temporal está documentado y cubierto por pruebas de contrato.
6. La cola offline ya no puede persistir acciones sensibles y sus pruebas pasan.
7. Functions local y `health` pasan pruebas en Emulator Suite.
8. El plan de backup/restauración está escrito y el ensayo queda marcado como gate previo a `T06`.
9. Costos, cuotas y alertas futuras están documentados.
10. Todas las verificaciones locales relevantes terminan con código 0 y su evidencia se registra en `tasks.md`.

Cumplir este diseño no autoriza despliegue, migración de datos ni gasto nuevo. Esas acciones mantienen sus checkpoints independientes.

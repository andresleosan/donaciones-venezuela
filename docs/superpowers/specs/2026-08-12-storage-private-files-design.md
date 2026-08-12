# Storage privado, evidencias y URLs temporales

**Fecha:** 2026-08-12  
**Estado:** aprobada por el operador para planificación  
**Proyecto Firebase:** `donaciones-venezuela-4fc29`  
**Proyecto de pruebas:** `demo-donaciones-venezuela`

## Contexto

La migración aprobada conserva Supabase como fuente productiva mientras Firebase
se valida localmente. `firebase/storage.rules` permanece en deny-by-default y el
cliente ya tiene un adaptador que valida tamaño y MIME antes de subir archivos.
Functions ya contiene la validación base de paths privados y el TTL previsto para
URLs temporales, pero todavía no existe el contrato completo de Storage ni una
Function que autorice el acceso a archivos.

El alcance v1 incluye comprobantes/facturas, fotos de necesidades y evidencias de
denuncias. Todos los archivos serán privados. Las denuncias no tendrán lectura ni
proyección pública.

No se desplegará, no se activará Blaze y no se escribirán datos remotos como parte
de este subproyecto.

## Decisión

Usar carga directa desde el navegador a Firebase Storage, protegida por Rules, y
centralizar toda lectura y eliminación autorizada en Functions:

- El propietario autenticado puede cargar únicamente en su propio espacio.
- El propietario no recibe URLs persistentes desde el SDK cliente.
- `panel` y `admin` acceden a archivos mediante Functions, con autorización por
  propietario, rol y categoría según esta matriz:

  | Actor | `receipts` | `needs` | `reports` |
  |---|---|---|---|
  | Propietario autenticado | Su propio archivo | Su propio archivo | Su propio archivo |
  | `panel` | Permitido | Permitido | Denegado |
  | `admin` | Permitido | Permitido | Permitido |

  El acceso administrativo siempre se ejecuta mediante Functions; no otorga
  lectura directa desde el SDK cliente ni acceso a espacios ajenos por Rules.
- Functions genera una URL firmada de máximo 15 minutos después de validar el
  ID token y el path.
- No se habilita acceso público ni se devuelve `getDownloadURL()` al cliente.
- La eliminación también pasa por Functions para evitar borrados arbitrarios y
  mantener una frontera única de autorización.

La carga mediante Functions se descarta para v1 porque agrega latencia, memoria y
complejidad sin resolver un riesgo que ya cubren las Rules y la validación del
backend.

## Contrato de rutas

La ruta canónica es:

```text
private/{uid}/{category}/{fileId}.{extension}
```

Categorías permitidas:

| Categoría | Uso | Exposición pública |
|---|---|---|
| `receipts` | Comprobantes y facturas | Nunca |
| `needs` | Fotos de productos o necesidades | Nunca en v1 |
| `reports` | Evidencias de denuncias | Nunca |

`uid` debe coincidir exactamente con `request.auth.uid` para cargas directas.
`fileId` se genera con un identificador aleatorio de la aplicación y no acepta
separadores, rutas anidadas ni nombres de archivo proporcionados directamente por
el usuario. La extensión debe corresponder al MIME permitido.

La validación común debe rechazar `..`, segmentos vacíos, prefijos distintos de
`private/`, categorías desconocidas, extensiones no permitidas y paths con
caracteres de control. La validación de Functions y la de Rules deben aplicar el
mismo contrato.

## Tipos, tamaños y metadata

Tipos permitidos:

- `image/jpeg`, `image/png`, `image/webp`: máximo 5 MiB.
- `application/pdf`: máximo 10 MiB.

La carga debe fijar metadata mínima:

```text
contentType: MIME permitido
ownerUid: UID autenticado
category: categoría de la ruta
visibility: private
```

El cliente puede enviar `createdAt` como dato informativo si un contrato de
dominio lo requiere, pero nunca será una fecha de auditoría confiable. La fecha
autoritativa será `timeCreated` del objeto de Storage. Metadata adicional no puede
convertir el objeto en público ni alterar las condiciones de autorización.

La validación del cliente es una mejora de UX, no un control de seguridad. Rules
deben volver a comprobar tamaño, `contentType`, metadata de propiedad y
`visibility`.

## Autorización y flujo de datos

### Carga

1. El cliente obtiene la sesión Auth vigente.
2. Genera un `fileId` aleatorio y forma la ruta canónica.
3. Valida localmente MIME, extensión y tamaño.
4. Ejecuta `uploadBytes` con `contentType`, `ownerUid`, `category` y
   `visibility: private`.
5. Storage Rules valida autenticación, propiedad de la ruta, categoría, tamaño,
   MIME y metadata.
6. El adaptador devuelve únicamente `{ path }`.

No se permitirá que el cliente escoja el UID de otra persona ni que escriba en
`panel`, `admin`, `public` u otra ruta fuera del contrato.

### Solicitud de URL temporal

La Function recibirá el path privado y:

1. verificará el ID token;
2. validará la ruta y la categoría;
3. resolverá el propietario desde el path, nunca desde un campo confiado del
   body;
4. permitirá al propietario el acceso a sus archivos;
5. permitirá `panel` para `receipts` y `needs`, pero lo rechazará para `reports`;
6. permitirá `admin` para las tres categorías;
7. comprobará que el objeto existe y que sigue siendo privado;
8. generará una URL firmada con TTL de 15 minutos como máximo;
9. devolverá un contrato mínimo con URL y expiración, sin metadata sensible.

El token, path inválido y errores internos no se incluirán en logs ni mensajes de
error. Los errores públicos serán estables y genéricos (`unauthorized`,
`forbidden`, `invalid-file-path`, `file-not-found`).

### Eliminación

La Function de eliminación repetirá la validación de token, path, propiedad y
rol antes de borrar. Un usuario no podrá borrar archivos ajenos. `panel` podrá
eliminar solo `receipts` y `needs`, nunca `reports`; `admin` podrá eliminar las
tres categorías según el contrato del dominio. No habrá una operación
administrativa genérica que acepte cualquier bucket/path.

## Componentes

- `firebase/storage.rules`: reglas de carga privada con allowlist de categorías,
  MIME, tamaño y metadata.
- `src/firebase/firebase-storage.js`: generación de file IDs, normalización de
  metadata, validación de extensión y carga que devuelve solo el path.
- `functions/src/private-file-access.ts`: contrato de path, TTL y autorización
  reutilizable por las Functions de URL y eliminación.
- `functions/src/private-file-access-http.ts`: endpoints HTTP `onRequest`
  protegidos para URL temporal y eliminación, siguiendo el contrato HTTP ya
  utilizado por Functions en esta migración.
- `tests/rules/storage.rules.test.ts`: casos permitidos y denegados de Rules.
- `tests/firebase/firebase-storage.test.js`: validación del adaptador y ausencia
  de URL persistente.
- `tests/functions/private-file-access.test.ts`: autorización, path, TTL y
  errores públicos.
- `tests/emulators/storage.integration.test.ts`: flujo completo contra Storage
  Emulator, incluyendo límites y no exposición.

No se añadirán proyecciones públicas, lectura de `reports`, migración de objetos
reales ni cambios a `services/api.js` en esta tarea.

## Manejo de errores y abuso

- Rechazar antes de escribir cualquier ruta inválida, categoría desconocida,
  MIME no permitido o archivo sobredimensionado.
- No confiar en `file.name`, `file.type` del navegador ni metadata de fecha para
  autorización; Rules y Functions repiten las verificaciones.
- No devolver URLs persistentes, tokens de Storage ni paths de otros usuarios.
- La Function de URL temporal debe tener rate limiting antes de generar firmas,
  usando el mismo patrón de límites por UID ya adoptado para endpoints sensibles.
- Los errores de infraestructura deben fallar cerrados: si no se puede verificar
  autorización o existencia, no se genera una URL.

## Pruebas y criterios de aceptación

### Rules

- Usuario autenticado puede cargar un JPEG/PNG/WebP válido en su propia ruta.
- Usuario autenticado puede cargar un PDF válido dentro de 10 MiB.
- Se rechazan anónimos, UID ajeno, categorías desconocidas, MIME inválido,
  extensión incoherente, metadata ausente o `visibility` distinta de `private`.
- Se rechazan imágenes mayores de 5 MiB y PDF mayores de 10 MiB.
- Lectura y eliminación directas desde el cliente permanecen cerradas.
- El cliente no puede leer ni escribir rutas de `reports` ajenas.

### Functions

- Propietario recibe una URL temporal válida para su archivo existente.
- `panel` recibe acceso a `receipts` y `needs`, pero no a `reports`.
- `admin` recibe acceso a las tres categorías.
- Usuario autenticado sin autorización recibe `403` sin revelar existencia del
  archivo ajeno.
- Path inválido, archivo inexistente y token inválido producen errores estables.
- La expiración nunca supera 15 minutos desde la generación.
- Eliminación autorizada borra el archivo; eliminación ajena es rechazada.
- No se escriben tokens, IPs, metadata sensible ni URLs completas en logs.

### Verificación

La evidencia mínima será:

```text
npm.cmd run test:unit
npm.cmd run test:rules
npm.cmd run test:functions
npm.cmd run test:emulators
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

La tarea no pasa a aprobada si alguna prueba relevante falla o si la auditoría
detecta un hallazgo crítico.

## Rollback y límites operativos

- El rollback local consiste en restaurar la versión anterior de `storage.rules`,
  adaptador y Functions; no se borran datos remotos.
- No se aplican migraciones destructivas ni se crean buckets nuevos.
- Storage remoto, Blaze, despliegues y carga de datos reales requieren los gates
  operativos ya documentados y confirmación explícita del operador.
- Una futura migración de objetos deberá incluir inventario, backup restaurable,
  conteos, checksum o verificación equivalente y procedimiento de reversión antes
  de ejecutarse.

## Fuera de alcance

- Publicar fotos o evidencias mediante URLs públicas.
- Exponer denuncias en Firestore, Storage o endpoints públicos.
- Procesamiento antivirus, OCR, thumbnails o compresión automática.
- Reemplazar todavía Supabase Storage.
- Cambiar la UI legacy o migrar las 65 acciones.

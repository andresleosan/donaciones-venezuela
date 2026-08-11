# Lecturas Publicas Firebase: Lugares y Vacantes

**Fecha:** 2026-08-11
**Estado:** aprobada por el operador
**Proyecto Firebase:** `donaciones-venezuela-4fc29`
**Proyecto de pruebas:** `demo-donaciones-venezuela`

## Contexto

La reconstruccion de Auth, sesion, claims y bootstrap administrativo ya esta
implementada y verificada en Emulator Suite. Firestore permanece bloqueado por
defecto y `services/api.js` sigue usando Supabase como referencia temporal.

El siguiente dominio debe habilitar lecturas publicas de bajo riesgo sin abrir
colecciones privadas, sin publicar PII y sin mezclar todavia facturas,
seguimiento humanitario, Storage o acciones de escritura.

El contrato logico existente define ocho proyecciones publicas. Para reducir el
riesgo, esta entrega solo implementara las dos primeras superficies operativas:
`lugaresPublicos` y `vacantesPublicas`. Las proyecciones de perfiles personales,
facturas, historial y entregas quedan para planes separados.

## Decision

Usar un enfoque hibrido:

- El cliente lee directamente documentos ya publicados en `lugaresPublicos` y
  `vacantesPublicas` mediante repositorios Firebase estrechos.
- Firestore permite solo `get` y `list` publicos sobre esas colecciones, con
  limite maximo de 50 documentos por consulta.
- Toda escritura cliente, lectura de colecciones privadas y cualquier otra ruta
  permanece denegada.
- Functions/Admin SDK sera la unica via futura para generar o actualizar
  documentos publicos, usando allowlists positivas y el sanitizer existente.
- Los tests sembraran documentos sinteticos unicamente dentro del emulador.
- `services/api.js` no se reemplaza en esta entrega y no se despliega ningun
  cambio al proyecto real.

## Alternativas descartadas

### Functions para todas las lecturas

Una Function HTTP o callable centralizaria validacion y rate limiting, pero
agregaria latencia, coste operativo y superficie de codigo para dos colecciones
que ya son publicas por contrato. Se reservara para consultas combinadas,
seguimiento de casos o datos que requieran autorizacion.

### Lectura directa de colecciones privadas

Aunque reduciria duplicacion, mezclaria datos publicos y privados, haria que las
reglas cargaran responsabilidad de negocio que no pueden expresar de forma
completa y aumentaria el riesgo de PII accidental. Se descarta de forma
permanente para este dominio.

### Habilitar las ocho proyecciones a la vez

`voluntariosPublicos`, `rescatistasPublicos` y `motorizadosPublicos` contienen
identidad o capacidad de personas; `facturasPublicas`, `historialPublico` y
`entregasPublicas` afectan seguimiento financiero y humanitario. Requieren
consentimiento, contratos y pruebas propias, por lo que no se incluyen aqui.

## Alcance

### Incluye

- Reglas Firestore para `lugaresPublicos` y `vacantesPublicas`.
- Repositorios cliente de solo lectura para ambas colecciones.
- Limite de 50 documentos por consulta y paginacion con cursor opaco.
- Uso de las allowlists existentes en `functions/src/public-projections.ts`.
- Pruebas de sanitizer para estas dos proyecciones y campos sensibles anidados.
- Pruebas Emulator Suite para lectura publica, escritura denegada y acceso
  privado denegado.
- Documentacion de rollback de reglas y repositorios.

### No incluye

- Sustituir `services/api.js` o cambiar la interfaz completa de la UI.
- Crear o modificar `buscar_familiar`.
- Habilitar `voluntariosPublicos`, `rescatistasPublicos`,
  `motorizadosPublicos`, `facturasPublicas`, `historialPublico` o
  `entregasPublicas`.
- Generar datos reales, importar datos Supabase o sembrar el proyecto de
  desarrollo remoto.
- Crear rutas HTTP publicas, rate limits distribuidos o escrituras de negocio.
- Habilitar Storage, facturas, donaciones, transporte o administracion.

## Contrato de datos publico

Los documentos publicados son independientes de las colecciones privadas. La
existencia de un documento dentro de una coleccion `*Publicos` representa una
decision explicita de publicacion; el cliente no puede crearlo ni modificarlo.

### `lugaresPublicos/{lugarId}`

Allowlist exacta:

```text
nombre
tipo
ubicacionPublica
latAproximada
lngAproximada
contactoPublico
activo
updatedAt
```

`contactoPublico` nunca se copia automaticamente desde `telefono` o cualquier
otro campo privado. `latAproximada` y `lngAproximada` no pueden ser la
ubicacion precisa del documento privado.

### `vacantesPublicas/{vacanteId}`

Allowlist exacta:

```text
lugarId
titulo
descripcion
cupos
estado
createdAt
```

La vacante publica no incluye datos de voluntarios, correos, telefonos,
documentos, ubicacion precisa ni campos de auditoria.

### Denylist recursiva

El sanitizer debe rechazar, incluso dentro de objetos o arrays anidados:

```text
email, telefono, documento, cedula, placa, authUid, pin, pinHash,
tokenInterno, refreshToken, ip, ipHash, comprobantePath, filePrivatePath,
ubicacionPrecisa
```

Los campos no incluidos en la allowlist se descartan; si un campo prohibido
logra entrar en el resultado sanitizado, la operacion falla de forma segura.

## Repositorios cliente

Crear una superficie de solo lectura separada del CRUD generico existente:

```text
listPublicPlaces(options?) -> Promise<{ data, nextCursor }>
listPublicVacancies(options?) -> Promise<{ data, nextCursor }>
```

Cada repositorio debe:

- Leer solo su ruta publica fija.
- Aplicar `limit <= 50` antes de ejecutar la consulta.
- Usar orden estable por timestamp descendente y document ID como desempate.
- Aceptar solo un cursor producido por el mismo repositorio.
- Devolver documentos con `id` y campos publicos, sin agregar datos privados.
- Convertir fallos de red o permiso en errores seguros sin incluir path, PII o
  detalles del SDK.
- No exponer `createDocument`, `setDocument`, `updateDocument` ni
  `deleteDocument` a traves de esta superficie.

Consultas iniciales:

- Lugares: `activo == true`, orden `updatedAt DESC`, luego document ID, limite
  maximo 50.
- Vacantes: documentos ya presentes en `vacantesPublicas`, orden `createdAt
  DESC`, luego document ID, limite maximo 50.

El repositorio no actualiza `window.SheetsService` en esta fase. La sustitucion
del adaptador legacy se hara cuando el dominio tenga equivalencia de contrato y
un plan de UI separado.

## Reglas Firestore

Mantener deny-by-default global y abrir unicamente las dos colecciones:

```text
lugaresPublicos/{id}
  get: allow anonimo
  list: allow anonimo solo si request.query.limit existe y <= 50
  write: deny

vacantesPublicas/{id}
  get: allow anonimo
  list: allow anonimo solo si request.query.limit existe y <= 50
  write: deny

todo lo demas
  read/write: deny
```

Los roles `user`, `panel` y `admin` pueden leer las mismas proyecciones publicas
sin recibir permisos adicionales. La escritura mediante Admin SDK no queda
controlada por estas reglas y no forma parte de este plan; cualquier publicador
futuro debe usar el sanitizer y tener un plan propio.

## Flujo de lectura

1. El usuario anonimo o autenticado solicita una pagina a un repositorio fijo.
2. El repositorio valida el limite y cursor localmente.
3. Firebase Firestore evalua la regla de `get` o `list`.
4. Firestore devuelve unicamente documentos de la coleccion publica.
5. El repositorio normaliza el resultado a `{ id, ...data }` y entrega el cursor
   opaco de la siguiente pagina.
6. Ante error, el repositorio devuelve un error estable sin detalles sensibles.

No existe un camino cliente desde una proyeccion publica hacia una coleccion
privada. No se hacen joins cliente-cliente.

## Pruebas y aceptacion

### Unitarias

- Allowlist exacta para `lugaresPublicos`.
- Allowlist exacta para `vacantesPublicas`.
- Denylist en campos de primer nivel y anidados.
- Rechazo de limite cero, negativo, no numerico o mayor que 50.
- Cursor producido por otra coleccion rechazado.
- Errores de Firestore normalizados sin path ni datos del documento.

### Emulator Suite

Para cada coleccion publica:

- `get` anonimo permitido.
- `list` anonimo con limite valido permitido.
- `list` sin limite o sobre 50 denegado.
- Escritura anonima, de usuario, panel y admin denegada.
- Lectura de la coleccion privada equivalente denegada para anonimo, usuario,
  panel y admin.
- Los mismos documentos sinteticos no contienen campos de la denylist.

La aceptacion exige `npm.cmd run test:emulators`, build, auditoria de seguridad
y verificacion de idioma exitosos. No se declara migrada ninguna accion de
`services/api.js` hasta una fase posterior.

## Rollback

- Cada cambio de reglas y repositorio vive en commits reversibles.
- Si una prueba de seguridad falla, revertir el commit que abre las dos rutas y
  restaurar el deny-by-default global.
- No hay rollback de datos porque solo se usan fixtures efimeros del emulador.
- No se toca el proyecto Firebase de desarrollo remoto.

## Riesgos y controles

- **Publicacion accidental de PII:** allowlist positiva, denylist recursiva y
  documentos publicos independientes.
- **Lecturas ilimitadas:** limite obligatorio en cliente y regla `request.query`.
- **Abuso de consultas publicas:** limite de pagina y futura evaluacion de rate
  limit antes de exponer datos a gran escala.
- **Desalineacion con la UI legacy:** no cambiar `services/api.js` hasta validar
  el contrato en un plan posterior.
- **Datos vacios:** la base es greenfield; los tests usan fixtures sinteticos,
  no se inventan registros reales ni se cargan seeds remotos.

## Gates

- No ejecutar deploy, activar Blaze ni crear staging/produccion.
- No cargar datos reales ni recibir secretos por chat.
- No habilitar busqueda libre sobre PII.
- No abrir colecciones privadas por conveniencia del cliente.
- No aprobar el dominio sin pruebas de reglas, sanitizer, repositorios y build.

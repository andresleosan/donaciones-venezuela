# Esquema Firestore propuesto

Este es el diseño lógico derivado de las 23 tablas Supabase. Es una propuesta para revisión; no se ha creado ninguna colección ni se ha cargado información.

## Convenciones

- IDs: conservar UUID/texto existente cuando haya referencias externas; usar ID de documento estable, no números autoincrementales del cliente.
- Tiempos: `Timestamp` UTC (`createdAt`, `updatedAt`) y conservar fecha original en `legacy*` durante la transición.
- Relaciones: guardar `*_id` como referencia lógica y, cuando convenga, `DocumentReference` dentro de Functions; evitar joins cliente-cliente.
- PII: separar campos públicos de privados. Los documentos privados no deben aparecer en consultas públicas.
- Escrituras de estado, contadores y reservas: transaction/batch; nunca read-modify-write separado.

## Colecciones canónicas privadas

Las colecciones de esta sección contienen el estado completo de negocio. Ninguna admite lectura pública directa, aunque algunos campos tengan un equivalente sanitizado en una proyección pública.

| Colección / documento | Campos principales | Relaciones y seguridad |
|---|---|---|
| `config/{key}` | `value`, `type`, `isSecret`, `updatedAt` | Solo Functions/admin; secretos en Secret Manager, no en Firestore público |
| `rateLimits/{key}` | `windowStart`, `hits`, `burstHits`, `expiresAt` | Solo Function; TTL y transacción |
| `lugares/{lugarId}` | `nombre`, `direccion`, `lat`, `lng`, `telefono`, `activo`, timestamps | Privado; `insumos` referencia `lugarId` |
| `insumos/{insumoId}` | `lugarId`, `nombre`, `cantidad`, `unidad`, `condicion`, `activo`, timestamps | Privado; índice `(lugarId,nombre)` |
| `centrosPanel/{centroId}` | `lugarId`, `authUid`, `fotoCedulaPath`, `fotoSitioPath`, `activo` | Solo panel/admin; no migrar token, PIN ni hash legado |
| `voluntarios/{voluntarioId}` | `nombre`, `email`, `telefono`, `zona`, `habilidades`, `fotoPath`, `activo`, `authUid` | Privado; escritura propia/admin |
| `rescatistas/{rescatistaId}` | `nombre`, `email`, `telefono`, `zona`, `fotoPath`, `activo`, `authUid` | Privado; escritura propia/admin |
| `motorizados/{motorizadoId}` | `nombre`, `email`, `telefono`, `vehiculo`, `placa`, `zona`, `fotoPath`, `activo`, `authUid` | Placa y documentos privados; escritura propia/admin |
| `personas/{personaId}` | `nombre`, `documento`, `telefono`, `email`, `tipo`, `estado`, `ubicacion`, timestamps | PII; acceso por rol y necesidad |
| `vacantesVoluntarios/{vacanteId}` | `lugarId`, `titulo`, `descripcion`, `cupos`, `estado`, timestamps | Privado; cambios panel/admin |
| `facturas/{facturaId}` | `numero`, `token`, `familiaId`, `necesidad`, `montoObjetivo`, `recaudado`, `estado`, `moneda`, `tasa`, `createdAt`, `closedAt` | `donaciones`, `movimientos`, `evidencias`; número/token únicos mediante transaction |
| `donaciones/{donacionId}` | `facturaId`, `donanteNombre`, `donanteEmail`, `monto`, `moneda`, `referenciaPago`, `estado`, `montoUsd`, `tasa`, `comprobantePath`, `archiveAt` | Donante puede crear; cambios de estado solo Function/admin |
| `movimientosFactura/{movimientoId}` | `facturaId`, `tipo`, `estadoAnterior`, `estadoNuevo`, `actorUid`, `nota`, `createdAt` | Append-only para auditoría; subcolección recomendada de `facturas` |
| `evidencias/{evidenciaId}` | `facturaId`, `tipo`, `descripcion`, `filePath`, `actorUid`, `createdAt` | Privado; URL temporal |
| `viajes/{viajeId}` | `facturaId`, `motorizadoId`, `estado`, `origen`, `destino`, `startedAt`, `finishedAt`, `kms`, GPS resumido | Acceso por participantes/panel/admin; cambios transaccionales |
| `trayectos/{trayectoId}` | `motorizadoId`, `origen`, `destino`, `estado`, `kms`, timestamps | Consultas por motorizado/estado; ubicación sensible |
| `entregas/{entregaId}` | `facturaId`, `viajeId`, `receptor`, `evidenciaPath`, `createdAt`, `actorUid` | Privado/panel/admin |
| `donacionesMotorizados/{donacionId}` | `motorizadoId`, `donante`, `origen`, `destino`, `estado`, `reserva`, timestamps | Reservas y cupos con transaction |
| `historialMovimientos/{movimientoId}` | `entidad`, `entidadId`, `accion`, `actorUid`, `metadataMinima`, `createdAt` | Append-only; admin/auditoría |
| `familiasDamnificadas/{familiaId}` | `nombre`, `documento`, `contacto`, `direccion`, `miembros[]`, `fotosPaths[]`, `estado`, timestamps | PII y fotos privadas; acceso restringido |
| `denuncias/{denunciaId}` | `tipo`, `descripcion`, `email`, `ubicacion`, `videoPath`, `adjuntosPaths[]`, `estado`, `createdAt`, `resolvedAt` | Crear público con rate limit; lectura admin/panel autorizado |
| `tasas/{tasaId}` | `fuente`, `moneda`, `valor`, `capturadaAt`, `vigente` | Escritura Function; lectura controlada |
| `auditoriaAdmin/{eventoId}` | `actorUid`, `accion`, `entidad`, `entidadId`, `resultado`, `ipHash`, `createdAt` | Append-only, solo auditoría/admin |

## Proyecciones públicas

Las lecturas públicas usan documentos independientes, generados en servidor desde allowlists positivas. Un campo `*Publico` requiere consentimiento o criterio de publicación explícito; no se obtiene renombrando automáticamente el valor privado. Functions debe rechazar cualquier proyección que contenga campos prohibidos, incluso anidados.

El consentimiento de voluntarios `volunteer-public-v1` es un contrato explícito sin foto y usa la allowlist ejecutable `VOLUNTEER_PUBLIC_PROFILE_FIELDS`. La allowlist genérica `PUBLIC_PROJECTION_FIELDS` conserva compatibilidad para otras proyecciones de perfiles futuras; no habilita fotos para este v1. Cualquier futura proyección fotográfica requiere un plan separado de consentimiento, versión y publicación antes de incorporarse.

| Colección | Allowlist exacta |
|---|---|
| `lugaresPublicos` | `nombre`, `tipo`, `ubicacionPublica`, `latAproximada`, `lngAproximada`, `contactoPublico`, `activo`, `updatedAt` |
| `voluntariosPublicos` (v1, sin foto) | `nombre`, `zona`, `habilidades`, `activo`, `createdAt` |
| `rescatistasPublicos` (futuro, no implementado en v1) | `nombre`, `zona`, `especialidades`, `capacidadOperativa`, `fotoPublicaPath`, `activo`, `createdAt`; cualquier foto requiere un plan separado de consentimiento, versión y publicación |
| `motorizadosPublicos` (futuro, no implementado en v1) | `nombre`, `zona`, `tipoVehiculo`, `capacidad`, `fotoPublicaPath`, `activo`, `createdAt`; cualquier foto requiere un plan separado de consentimiento, versión y publicación |
| `vacantesPublicas` | `lugarId`, `titulo`, `descripcion`, `cupos`, `estado`, `createdAt` |
| `facturasPublicas` | `numero`, `tokenPublico`, `necesidad`, `montoObjetivo`, `recaudado`, `estado`, `moneda`, `createdAt` |
| `historialPublico` | `entidadPublicaId`, `tipo`, `estado`, `descripcionPublica`, `createdAt` |
| `entregasPublicas` | `facturaPublicaId`, `estado`, `createdAt`, `evidenciaPublicaPath` |

La denylist defensiva incluye email, teléfono, documento, cédula, placa, `authUid`, PIN, hashes, tokens internos o de refresco, IP, paths de comprobantes o archivos privados y ubicación precisa. El contrato ejecutable vive en `functions/src/public-projections.ts`.

## Índices iniciales

Se deben confirmar con consultas reales antes de crear índices. Como mínimo:

- `insumos`: `lugarId ASC, activo ASC, nombre ASC`.
- `voluntarios`, `rescatistas`, `motorizados`: `activo ASC, zona ASC, createdAt DESC`.
- `facturas`: `estado ASC, createdAt DESC`; `token ASC`; `numero ASC`.
- `donaciones`: `facturaId ASC, createdAt DESC`; `estado ASC, createdAt DESC`.
- `movimientosFactura`: `facturaId ASC, createdAt DESC`.
- `viajes`: `estado ASC, createdAt DESC`; `motorizadoId ASC, estado ASC`.
- `trayectos`: `motorizadoId ASC, createdAt DESC`.
- `donacionesMotorizados`: `estado ASC, createdAt DESC`; `motorizadoId ASC, estado ASC`.
- `vacantesVoluntarios`: `estado ASC, createdAt DESC`; `lugarId ASC, estado ASC`.
- `familiasDamnificadas`: `estado ASC, createdAt DESC`; campos de búsqueda normalizados solo si son imprescindibles.
- `denuncias`: `estado ASC, createdAt DESC`.

## Vistas y agregados derivados

Las ocho proyecciones enumeradas arriba son duplicación deliberada para imponer una frontera pública a nivel de documento. Las demás vistas SQL (`familias_public`, `trayectos_public`, `donaciones_motorizados_public`, `denuncias_public`, `traslados_sugeridos` y `viajes_atrasados`) no se copiarán hasta definir un caso público, su allowlist y una consulta o documento derivado mantenido por Functions.

`estadisticas` debe ser un documento agregado por periodo o dominio. `seguimiento_factura` y `seguimiento_donaciones` deben consultar subcolecciones indexadas. `buscar_familiar` necesita un campo normalizado no reversible y reglas de autorización; no se debe habilitar una búsqueda libre sobre PII.

## Reglas de consistencia

- Una donación aceptada incrementa `facturas.recaudado` y registra `movimientosFactura` en una misma transacción.
- Una reserva de viaje/oferta comprueba disponibilidad y marca el recurso en una misma transacción.
- Un número de factura se asigna mediante contador transaccional y no se reutiliza tras rollback lógico.
- Toda acción administrativa escribe `auditoriaAdmin` con resultado y actor.
- Los documentos de Storage guardan solo `path`, hash/checksum opcional y metadata mínima en Firestore.

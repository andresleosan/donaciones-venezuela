# Arquitectura

## Flujo principal

1. `index.html` carga `services/api.js` y los módulos `js/core.js`, `js/vistas.js`, `js/panel.js` y `js/admin.js`; las páginas-formulario (`ventana.html`) añaden `js/ventana.js`.
2. `services/api.js` habla exclusivamente con Supabase: lecturas por PostgREST (`/rest/v1/...`) y escrituras por la edge function (`/functions/v1/api`).
3. Las respuestas JSON reconstruyen listados, contadores, filtros, prioridades y estadísticas.
4. Después de cada escritura, el frontend vuelve a leer Supabase (`cargarTodo()`) y renderiza desde esa respuesta.

## Backend (Supabase, proyecto `zryfwbjvlacorryzdaod`)

### Lecturas (PostgREST, anon key publishable)

- Vistas públicas sin PII ni tokens: `lugares_directorio` (con `necesita` / `tiene_disponible` / `cubiertos` agregados en la misma forma que consumía el frontend), `voluntarios_public`, `rescatistas_public`, `motorizados_public`, `trayectos_public`, `historial_public`, `facturas_public` (sin `token_publico`), `donaciones_motorizados_public`.
- RPCs `security definer`: `estadisticas()`, `buscar_familiar(q)` (mínimo 3 caracteres, máximo 25 resultados), `seguimiento_factura(tok)` (solo datos públicos).

### Escrituras (edge function `api`, service role)

Todas las tablas tienen **RLS habilitado sin políticas para anon**: la única vía de escritura es la edge function, que valida por acción, recorta longitudes y aplica rate-limit por IP (30 escrituras/hora, RPC `rate_hit`).

Acciones cubiertas:

- `registrar_lugar` (upsert por `nombre`; no pisa campos existentes con valores vacíos)
- `registrar_voluntario`, `registrar_rescatista`, `registrar_motorizado`
- `registrar_trayecto`, `donar_motorizado`
- `reportar_persona`
- Panel por centro: `panel_crear`, `panel_ver`, `panel_insumo`, `panel_insumo_borrar`

### Panel por centro

Tabla `centros_panel` (`lugar_id` único, `token_centro` `CTR-XXXX-XXXX-XXXX`, `pin_hash` = SHA-256(salt+PIN), `pin_salt`). Cada acción del panel se autentica sin sesión: token+PIN viajan en cada petición y se validan contra el hash. El token se entrega una sola vez al crear el panel.

## Fuente única

No hay registros embebidos, archivos locales de datos ni almacenamiento persistente del navegador para información operativa. El service worker cachea solo assets estáticos versionados; los datos se leen siempre en vivo.

## Trazabilidad financiera

El módulo público de seguimiento se consulta con `?token=DV-XXXX-XXXX-XXXX` o `#seguimiento/DV-XXXX-XXXX-XXXX`. El RPC `seguimiento_factura` devuelve únicamente:

- factura, objetivo y descripción pública;
- monto requerido, monto recaudado y porcentaje completado;
- movimientos financieros;
- evidencias con `publica = true`;
- estado actual.

Los datos de donante, referencia de pago y cualquier dato operativo viven en tablas sin acceso anon y no se devuelven en el endpoint público.

Tablas financieras: `facturas`, `donaciones`, `movimientos_factura`, `evidencias`.

## Integridad

- `lugares.nombre` es único (los reportes repetidos actualizan, no duplican).
- `insumos` tiene clave única `(lugar_id, nombre)`: reportar el mismo insumo actualiza su estado en vez de insertar otra fila.
- `facturas.numero_factura` y `facturas.token_publico` son únicos.

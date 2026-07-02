# Notas operativas

- Proyecto estático sin dependencias: `index.html`, `css/app.css`, `js/app.js`, `services/api.js`, `locales/` y archivos de despliegue.
- La única fuente de registros es **Supabase** (proyecto `zryfwbjvlacorryzdaod`): lecturas por PostgREST (vistas `*_public` y `lugares_directorio`, RPCs), escrituras por la edge function `api`. No reintroducir Google Sheets ni Apps Script.
- No reintroducir archivos locales con registros, datos embebidos ni almacenamiento persistente del navegador para listados o estadísticas (el service worker solo cachea estáticos).
- Después de cada guardado, la UI debe llamar `cargarTodo()` y volver a pintar desde Supabase.
- La búsqueda familiar usa el RPC `buscar_familiar` (tabla `personas`; mínimo 3 caracteres, máximo 25 resultados).
- La trazabilidad pública usa el RPC `seguimiento_factura` por token y solo puede mostrar factura, objetivo, montos, porcentaje, historial financiero, evidencias públicas y estado.
- El panel por centro autentica cada acción con token `CTR-…` + PIN (hash SHA-256 + salt en `centros_panel`); acciones `panel_crear`, `panel_ver`, `panel_insumo`, `panel_insumo_borrar`.
- Todo valor externo interpolado en `innerHTML` pasa por `e()`.
- Al cambiar assets estáticos, subir la versión `?v=` en `index.html` y `sw.js` (y el nombre de caché del SW).

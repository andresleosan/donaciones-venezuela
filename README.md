# Respuesta Humanitaria Venezuela

Aplicación estática (sin dependencias ni bundler) para coordinar centros de ayuda, hospitales, refugios, voluntarios, rescatistas, transportistas, trayectos, aportes, búsqueda familiar y trazabilidad pública de donaciones por factura.

## Fuente de datos

**Supabase** (Postgres + PostgREST + Edge Functions). Proyecto: `zryfwbjvlacorryzdaod`.

- **Lecturas**: PostgREST sobre vistas públicas sin PII ni tokens (`lugares_directorio`, `voluntarios_public`, `rescatistas_public`, `motorizados_public`, `trayectos_public`, `historial_public`, `facturas_public`, `donaciones_motorizados_public`) y RPCs `estadisticas`, `buscar_familiar`, `seguimiento_factura`.
- **Escrituras**: edge function `api` (`/functions/v1/api`) con validación estricta por acción y rate-limit por IP (30/hora). Las tablas tienen RLS cerrado: la anon key no puede escribir nada directamente.
- La clave usada en el cliente es la **publishable** (pública por diseño).

No hay archivos locales de registros ni datos alternativos: si Supabase no responde, la interfaz muestra estado de error y listas vacías.

## Estructura

- `index.html`: markup de la app (el CSS y JS viven aparte).
- `css/app.css`: sistema de diseño (tokens estilo Stripe: índigo `#635BFF`, tinta `#0A2540`, Inter autohospedada).
- `js/app.js`: lógica de la interfaz (vanilla).
- `services/api.js`: único cliente de datos (PostgREST + edge function). Mantiene la interfaz histórica `window.SheetsService`.
- `locales/`: textos de interfaz en español, inglés y francés.
- `manifest.json` + `sw.js`: PWA (los estáticos se cachean; los datos nunca).
- `vercel.json`: cabeceras de seguridad y CSP (solo permite `connect-src` a Supabase).

## Esquema (tablas principales)

`lugares` + `insumos` (necesidades/disponibles/cubiertos por centro), `voluntarios`, `rescatistas`, `motorizados`, `trayectos`, `donaciones_motorizados`, `historial_movimientos`, `facturas` + `donaciones` + `movimientos_factura` + `evidencias` (trazabilidad), `personas` (búsqueda familiar), `centros_panel` (acceso token+PIN de cada centro), `rate_limit`.

## Trazabilidad por token

- Vista pública: `/?token=DV-XXXX-XXXX-XXXX` o `#seguimiento/DV-XXXX-XXXX-XXXX`.
- El RPC `seguimiento_factura` solo devuelve datos públicos: factura, objetivo, montos, porcentaje, movimientos, evidencias públicas y estado. Nunca teléfonos, donantes, referencias de pago ni datos operativos.

## Panel por centro

Cada centro puede gestionar sus insumos en vivo:

- Crear: botón «Gestionar mi centro» → «Crear panel de mi centro» → define un PIN (4-8 dígitos) → recibe un token `CTR-XXXX-XXXX-XXXX` **que se muestra una sola vez**.
- Entrar: mismo botón o enlace `#centro/CTR-XXXX-XXXX-XXXX` + PIN.
- El PIN se guarda hasheado (SHA-256 + salt); el backend nunca lo conoce en claro.

## Desarrollo local

```bash
python3 -m http.server 8000
```

Abrir `http://127.0.0.1:8000/`.

## Verificación rápida

```bash
curl -s -H "apikey: <PUBLISHABLE_KEY>" \
  "https://zryfwbjvlacorryzdaod.supabase.co/rest/v1/lugares_directorio?select=nombre&limit=1"
```

Debe devolver JSON con al menos un lugar.

## Despliegue

Publicar la app estática en Vercel (sin build). Los cambios de backend se aplican con migraciones SQL y redespliegue de la edge function `api` en Supabase.

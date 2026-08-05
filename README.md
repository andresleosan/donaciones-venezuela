# Respuesta Humanitaria Venezuela

Aplicación estática para coordinar centros de ayuda, hospitales, refugios, voluntarios, rescatistas, transportistas, trayectos, aportes, búsqueda familiar y trazabilidad pública de donaciones por factura.

## Fuente de datos

La única fuente operativa es Google Sheets mediante este Google Apps Script:

```text
https://script.google.com/macros/s/AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g/exec
```

Spreadsheet principal:

```text
1fnXiSy1TbPqwlLKDSfPoBfKs8pH0WptoECGq_zu_Lco
```

La app no incluye archivos locales de registros ni datos alternativos. Si Google Sheets no responde, la interfaz muestra estado de error y listas vacías.

## Estructura

- `index.html`: frontend estático con HTML, CSS y JavaScript.
- `services/sheets.js`: cliente único para lecturas y escrituras contra Apps Script.
- `apps-script/codigo.gs`: backend de Google Apps Script para leer, escribir, buscar y sincronizar Google Sheets.
- `locales/`: textos de interfaz en español, inglés y francés.
- `vercel.json`: cabeceras de seguridad y CSP para Apps Script.

## Hojas esperadas

- `lugares`: `Tipo`, `Nombre`, `Ubicacion`, `Telefono`, `Insumo`, `Categoria`, `Estado`, `Actualizado`.
- `voluntarios`
- `rescatistas`
- `motorizados`
- `trayectos`
- `historial_movimientos`
- `donaciones_motorizados`
- `facturas`: `id`, `numero_factura`, `token_publico`, `objetivo`, `descripcion`, `monto_requerido`, `monto_recaudado`, `estado`, `fecha_creacion`, `fecha_cierre`.
- `donaciones`: `id`, `factura_id`, `nombre_donante`, `monto`, `referencia_pago`, `fecha`, `estado`.
- `movimientos_factura`: `id`, `factura_id`, `tipo`, `descripcion`, `monto`, `fecha`.
- `evidencias`: `id`, `factura_id`, `archivo`, `descripcion`, `fecha`.
- Opcional para búsqueda familiar: `personas` o `familiares`.

`apps-script/codigo.gs` inicializa las hojas base si faltan y mantiene `lugares` con el esquema A-H.

## Trazabilidad por token

La vista pública está disponible desde:

```text
/?token=DV-8K4P-X2MN-7QTR
#seguimiento/DV-8K4P-X2MN-7QTR
```

El frontend llama `accion=seguimiento_factura` y muestra solo datos públicos: factura, objetivo, montos, porcentaje, historial financiero, evidencias públicas y estado. No expone teléfonos, correos, coordenadas, donantes, referencias de pago ni datos operativos.

Endpoints Apps Script principales:

- `crear_factura` / `registrar_factura`
- `registrar_donacion` / `registrar_donacion_factura`
- `registrar_movimiento_factura`
- `registrar_evidencia` / `registrar_evidencia_factura`
- `seguimiento_factura` / `seguimiento_token` / `trazabilidad`
- `facturas`

## Desarrollo local

No hay bundler ni dependencias.

```bash
python3 -m http.server 8000
```

Abrir `http://127.0.0.1:8000/`.

## Verificación rápida

```bash
curl -sL "https://script.google.com/macros/s/AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g/exec"
```

Debe devolver JSON con `lugares`, `voluntarios`, `rescatistas`, `motorizados` y `estadisticas`.
Si devuelve HTML de inicio de sesión de Google, el despliegue del Apps Script no está publicado para acceso anónimo y la web mostrará estado de error sin datos alternativos.

## Despliegue

1. Pegar el contenido actualizado de `apps-script/codigo.gs` en el proyecto de Apps Script.
2. Desplegar una nueva versión en el despliegue existente para conservar la URL `/exec`.
3. Publicar la app estática en Vercel.

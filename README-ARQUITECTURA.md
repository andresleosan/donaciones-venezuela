# Arquitectura técnica - Respuesta Humanitaria Venezuela

## Resumen

La aplicación mantiene una arquitectura estática y sin dependencias pesadas:

- Frontend: `index.html` con HTML, CSS y JavaScript vanilla.
- Capa de datos frontend: `services/sheets.js`.
- Backend: Google Apps Script en `apps-script/codigo.gs`.
- Base de datos: Google Sheets.
- Hosting: Vercel como sitio estático.

No utiliza Firebase, Firestore, Supabase, SQL, MongoDB, Node backend ni framework de frontend.

## Spreadsheet principal

Toda la aplicación usa este Spreadsheet:

```text
1fnXiSy1TbPqwlLKDSfPoBfKs8pH0WptoECGq_zu_Lco
```

El `SHEET_ID` está definido en `apps-script/codigo.gs`.

## Hojas

### lugares

Hoja compatible con la versión original. No se debe romper ni renombrar.

Columnas:

```text
Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado
```

Uso:

- Una fila representa un insumo de un lugar.
- `Estado = Necesita` se transforma en una necesidad activa.
- `Estado = Tiene disponible` se usa para calcular coincidencias con otros lugares.
- Apps Script agrupa filas por `Tipo + Nombre`.

### voluntarios

Se crea automáticamente si no existe.

Columnas:

```text
id, nombre, apellido, telefono, estado, ciudad, profesion, disponibilidad, medio_transporte, observaciones, fecha_registro
```

### rescatistas

Se crea automáticamente si no existe.

Columnas:

```text
id, nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones, fecha_registro
```

### Hojas heredadas conservadas

El backend conserva soporte para estas hojas si existen:

- `centros_necesidades`
- `motorizados`
- `trayectos`
- `historial_movimientos`
- `donaciones_motorizados`

Si `centros_necesidades` existe, `accion=centros` devuelve el modelo cuantitativo heredado. Si no existe, cae al modelo compatible de `lugares`.

## Flujo de datos

1. El navegador carga `index.html` desde Vercel o desde `file://`.
2. `index.html` inicializa `services/sheets.js` con `APPS_SCRIPT_URL`, modo demo y datos fallback.
3. La app llama `SheetsService.getAll()`.
4. Si `APPS_SCRIPT_URL` sigue como placeholder, se usa modo demo.
5. Si está configurado, el navegador hace `GET` al Apps Script publicado como Web App.
6. Apps Script lee Google Sheets, normaliza datos y devuelve JSON.
7. El frontend renderiza centros, estadísticas, voluntarios, rescatistas y logística.
8. Los formularios hacen `POST` a Apps Script con `mode: 'no-cors'` por la limitación CORS del redirect de Apps Script.
9. Como la respuesta POST es opaca, el frontend hace actualización optimista y queda preparado para refrescar datos desde GET.

## Endpoints GET

Todos los endpoints cuelgan de la URL `/exec` del Apps Script.

### GET sin accion

Devuelve el paquete principal:

```json
{
  "lugares": [],
  "centros": [],
  "voluntarios": [],
  "rescatistas": [],
  "motorizados": [],
  "estadisticas": {}
}
```

### GET `?accion=lugares`

Lee la hoja `lugares`, agrupa por lugar y calcula coincidencias.

Alias de salida:

- `lugares`
- `centros`

Filtros opcionales:

- `q`
- `busqueda`
- `tipo`
- `categoria`

### GET `?accion=estadisticas`

Devuelve:

```json
{
  "estadisticas": {
    "centrosRegistrados": 0,
    "hospitalesRegistrados": 0,
    "personasLocalizadas": 0,
    "voluntariosActivos": 0,
    "rescatistasRegistrados": 0,
    "motorizadosRegistrados": 0,
    "actualizado": "..."
  }
}
```

### GET `?accion=voluntarios`

Devuelve voluntarios registrados.

Filtros opcionales:

- `q`
- `busqueda`
- `estado`
- `profesion`

### GET `?accion=rescatistas`

Devuelve rescatistas registrados.

Filtros opcionales:

- `q`
- `busqueda`
- `estado`
- `especialidad`

### GET heredados

Se mantienen:

- `?accion=centros`
- `?accion=motorizados`
- `?accion=perfil_motorizado&id=...`
- `?accion=trayectos&motorizado=...`
- `?accion=historial&centro=...`

## Endpoints POST

El frontend envía JSON como texto simple con `mode: 'no-cors'`.

### POST lugares

Acciones aceptadas:

- `registrar_lugar`
- `agregar_lugar`
- `lugares`
- payload legacy sin `accion`, si incluye `tipo`, `nombre`, `insumo` y `estado`

Payload:

```json
{
  "accion": "registrar_lugar",
  "tipo": "Centro",
  "nombre": "Iglesia San Jose",
  "ubicacion": "La Guaira",
  "telefono": "+58...",
  "insumo": "Agua potable",
  "categoria": "Agua potable",
  "estado": "Necesita"
}
```

### POST voluntarios

Acciones aceptadas:

- `registrar_voluntario`
- `voluntarios`

Payload:

```json
{
  "accion": "registrar_voluntario",
  "nombre": "Andrea",
  "apellido": "Mendoza",
  "telefono": "+58...",
  "estado": "La Guaira",
  "ciudad": "Maiquetia",
  "profesion": "Enfermero",
  "disponibilidad": "Tardes",
  "medio_transporte": "Moto",
  "observaciones": "Primeros auxilios"
}
```

### POST rescatistas

Acciones aceptadas:

- `registrar_rescatista`
- `rescatistas`

Payload:

```json
{
  "accion": "registrar_rescatista",
  "nombre": "Unidad Bravo",
  "organizacion": "Proteccion Civil",
  "telefono": "+58...",
  "especialidad": "Rescate Urbano",
  "estado": "La Guaira",
  "ciudad": "Caraballeda",
  "disponibilidad": "Activo",
  "equipo_disponible": "Herramientas livianas y radio",
  "capacidad_operativa": "3-5 personas",
  "observaciones": "Equipo con herramientas"
}
```

### POST heredados

Se mantienen:

- `registrar_movimiento`
- `registrar_motorizado`
- `registrar_trayecto`
- `donar_motorizado`

## Matching de insumos

Apps Script calcula coincidencias desde `lugares`:

1. Normaliza insumos sin acentos, minúsculas y espacios externos.
2. Indexa filas con `Estado = Tiene disponible` por insumo.
3. Para cada necesidad, busca disponibilidad del mismo insumo en otro lugar.
4. Inserta `coincidencias` en cada item de `necesita`.

## Frontend

### `index.html`

Contiene:

- Hero `Respuesta Humanitaria Venezuela`.
- Estadísticas dinámicas desde Sheets/fallback.
- Sección `Cómo ayudar`.
- Sección `Necesidades urgentes`.
- Placeholder de mapa preparado para Leaflet.
- Módulo de centros de ayuda.
- Formularios de centros, voluntarios y rescatistas.
- Búsqueda familiar con webhook N8N o fallback.
- Módulo heredado de transportistas solidarios.
- Navegación desktop sticky y navegación inferior mobile.

### `services/sheets.js`

Centraliza:

- Configuración de Apps Script.
- Lecturas GET por `accion`.
- POST opaco compatible con Apps Script.
- Cache `localStorage`.
- Fallback demo.

## Accesibilidad

La interfaz incluye:

- `lang="es"`.
- Skip link.
- Landmarks semánticos.
- Labels explícitos.
- Botones nativos.
- Focus visible.
- Tamaño mínimo táctil de 44px en controles principales.
- `aria-live` para conteos y resultados dinámicos.
- Navegación mobile y desktop consistente.

## Despliegue Apps Script

1. Abrir el Spreadsheet principal.
2. Ir a `Extensiones -> Apps Script`.
3. Reemplazar el contenido por `apps-script/codigo.gs`.
4. Usar `Implementar -> Gestionar implementaciones -> Editar`.
5. Seleccionar `Nueva versión`.
6. Mantener:
   - Ejecutar como: `Yo`.
   - Acceso: `Cualquier usuario`.
7. Copiar la URL `/exec` existente.
8. Pegarla en `index.html` como `APPS_SCRIPT_URL`.

No crear una nueva implementación si se quiere conservar la misma URL pública.

## Despliegue Vercel

Vercel sirve el sitio como estático, sin build.

Archivos relevantes:

- `index.html`
- `services/sheets.js`
- `vercel.json`
- `robots.txt`
- `sitemap.xml`

Al hacer push a la rama conectada, Vercel redespliega automáticamente.

## Seguridad y CSP

`vercel.json` permite:

- `self`
- `unsafe-inline` por CSS/JS inline actual.
- `https://script.google.com`
- `https://script.googleusercontent.com`
- `https://wa.me`

Si se conecta un webhook N8N real para búsqueda familiar, agregar su dominio a la CSP.

No guardar secretos ni tokens privados en `index.html`.

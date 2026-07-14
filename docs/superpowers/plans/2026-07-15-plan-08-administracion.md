# Plan 08 — Administración (problema 8)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 01 (estado
> «con denuncia»). Orden: 8º (cierre).

**Meta:** el panel de administración (ventana admin) funciona igual de bien en
español e inglés; «Record a donation» desaparece y en su lugar hay **«Track
donation»** (pipeline de estados de cada insumo); «Create a budget» se ata a
las necesidades reales de un centro registrado, con presentación, adjunto de
presupuesto y tienda elegida en el mapa.

## Estado actual (verificado 2026-07-15)

- Tareas del panel en `locales/en.json:968-973`: `taskDonation` («Record a
  donation»), `taskBudget` («Create a budget»), `taskVacancy`.
- Presupuestos YA existen: `admin_crear_presupuesto` (index.ts:740) y claves
  `budget*` bilingües, incluida **`budgetPresentation`** («Box of 20 pills,
  250 mg each» — exactamente el ejemplo de Luis). Hoy tienda y dirección son
  **campos de texto** (`budgetStore`, `budgetAddress`) — violan R3.1.
- Estados existentes: `values.invoiceState` ya tiene Abierta/Comprada/…/
  Entregada; los movimientos codificados dan la cronología.

## Tareas

### T1 — es/en de verdad en el panel admin
`verificar-idioma.py` cubre el código; lo que falta es el equivalente E2E:
extender `scripts/e2e-idioma.js` con un recorrido de la ventana admin (mismo
patrón de 14 vistas) o crear `scripts/e2e-idioma-admin.js`. Corregir todo
texto fijo que aparezca (labels, toasts, badges) moviéndolo a claves (R1.1).

### T2 — «Track donation» en lugar de «Record a donation»
- Quitar la **tarjeta** `taskDonation` del menú de tareas (la acción backend
  `admin_registrar_donacion` se queda: otros flujos la usan).
- Nueva tarea `taskTrack` («Rastrear donación» / «Track donation»): lista
  todas las facturas/ofertas con su estado del pipeline, derivado de datos
  existentes + plan 01:
  1. **Esperando recogida** (comprada/ofrecida, sin recogida)
  2. **Recogido** (movimiento de recogida registrado)
  3. **Entregado al centro** (entrega final registrada)
  4. **Con denuncia** (existe `denuncias.factura_token` = su token)
- Cada fila: insumo, centro destino, transportista (si hay), hace cuánto fue
  la última actualización («hace 2 h» — el corazón del objetivo transversal),
  y filtro segmentado por estado. Estados canónicos es + `tValue` (R1.5).

### T3 — «Create a budget» atado a necesidades reales
Rehacer el form de presupuesto (los nombres de payload existentes se
conservan, R2.3; se añaden campos):
1. **Centro**: `<select>` de centros registrados que tengan necesidades
   abiertas (fuente: las mismas vistas públicas de necesidades).
2. **Insumo**: segundo `<select>` dependiente — solo las necesidades de ESE
   centro (conexión directa necesidad↔presupuesto: guardar `necesidad_id` en
   el insert).
3. **Presentación**: ya existe (`budgetPresentation`), se mantiene.
4. **Adjunto**: foto o archivo del presupuesto real (aquí SÍ se permite
   archivo además de cámara — es un documento del admin, no evidencia de
   campo; R3.2 aplica a fotos de terreno). Bucket `presupuestos` público-
   lectura; límite 5 MB; cualquier tipo. El donante lo ve en la vista de la
   necesidad/seguimiento como «Ver presupuesto» (motivación de donar).
5. **Tienda/farmacia**: mapa Leaflet para clavar el punto exacto (R3.1) +
   nombre de referencia + **URL opcional** de la tienda + dirección opcional
   como texto de referencia. Guardar `tienda_lat`, `tienda_lng`, `tienda_url`.

Migración: `alter table presupuestos add column if not exists necesidad_id …,
tienda_lat double precision, tienda_lng double precision, tienda_url text,
adjunto_path text;` (nombre exacto de tabla a confirmar en F0 leyendo
`admin_crear_presupuesto`).

### T4 — i18n + versión + commit (R1.2, R5.4 — `ventana.html` incluida, R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "taskTrack" js/*.js locales/es.json locales/en.json` ≥ 3
   y `grep -c "taskDonation" <archivo del menú de tareas>` = 0 en el render.
3. `self` (Playwright, ventana admin con clave de prueba/fixture): la tarjeta
   «Record a donation» no existe; «Track donation» lista un fixture con los 4
   estados bien clasificados (incluido «Con denuncia» desde una denuncia
   fixture) en es y en en, con cambio en caliente.
4. `self`: crear presupuesto con payload capturado: el insumo elegido viene de
   las necesidades del centro seleccionado (los selects son dependientes), el
   punto de tienda sale del mapa (payload lleva lat/lng, no dirección
   obligatoria) y el adjunto viaja; nombres de campos preexistentes intactos.

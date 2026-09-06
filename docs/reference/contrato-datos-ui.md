# Contrato de datos entre la UI y `SheetsService`

Referencia exhaustiva de **todo lo que la interfaz espera** del facade `window.SheetsService` (hoy `services/api.js` sobre Supabase) y de las estructuras que guarda en `estado`. Está escrita para que una reimplementación sobre Firebase (Cloud Functions + proyecciones públicas en Firestore) pueda diseñarse **sin leer el código de la UI**.

Todas las citas son `archivo:línea` del estado del repositorio al 2026-09-06 (assets `?v=107`, `sw.js:3`). Los nombres de campo se transcriben **exactamente como los lee o envía la UI** (camelCase y snake_case conviven a propósito).

Índice

0. Convenciones y arranque
1. Métodos de `SheetsService`
2. Shape de `estado` y de los datos derivados
3. Respuestas de `post()` por acción (agrupadas por módulo)
4. Sesión (`dv-sesion`, `accessToken`, `acceso_perfil`)
5. Lecturas por página `ventana.html?v=`
6. Textos canónicos guardados en BD
7. Apéndice: índice alfabético de acciones

---

## 0. Convenciones y arranque

### 0.1 Módulos y orden de carga

- `index.html:836-850` carga, en orden: `services/leaflet/leaflet.js`, `services/offline-queue-policy.js`, `services/api.js`, `js/pwa.js`, `js/entorno.js`, `js/core.js`, `js/wiz.js`, `js/vistas.js`, `js/panel.js`, `js/admin.js`, `js/admin-datos.js`, `js/admin-personas.js`, `js/admin-centros.js`, `js/viaje.js`, `js/denuncias.js`.
- `ventana.html:46-59` carga lo mismo **sin** `vistas.js`, `viaje.js` ni `denuncias.js`, y añade `js/damnificado.js` y `js/ventana.js`.
- Todos los módulos `js/*.js` comparten scope global (sin IIFE). `services/api.js` es un IIFE que publica `window.SheetsService` (`services/api.js:398-420`) y arranca la sincronización de la cola offline al evaluarse (`services/api.js:421`, `388-396`).
- `js/wiz.js` (asistente "una casilla a la vez") no toca datos: no participa en este contrato.

### 0.2 Configuración

- `js/core.js:696-697` define `SUPABASE_URL` / `SUPABASE_KEY` (sobrescribibles por `window.DV_ENTORNO` desde `js/entorno.js`, hoy un stub vacío) y `js/core.js:773` llama `window.SheetsService.configure({ supabaseUrl, supabaseKey })` en **toda** página. `configure` hace `Object.assign` sobre la config interna (`services/api.js:133-135`). Una implementación Firebase debe aceptar cualquier objeto sin lanzar.

### 0.3 Arranque de `index.html` (`js/admin.js:2036-2086`)

1. `initI18n()` (`js/core.js:679-690`).
2. `bindFiltros()`, `bindForms()`, `bindAcceso()`.
3. `renderDonations()` con estado vacío.
4. `await cargarTodo()` (`js/admin.js:2074`) → `SheetsService.getAll()` → `renderAll()` (`js/admin.js:2016-2019`), que además dispara `cargarPresupuestos()`, `cargarComprados()`, `cargarOfertas()` (tres `post()` de listado).
5. `abrirPanelDesdeUrl()` (router por hash, `js/panel.js:313-360`).
6. `await cargarSeguimientoDesdeUrl()` (`js/admin.js:1986-1990`): si la URL trae `?token=` o `#seguimiento/<token>` llama `getSeguimiento` y luego `getDesgloseDonaciones`.
7. `denRevisarPendiente()` (denuncias grabadas offline).

`init()` sólo corre si existe algún `.view` (`js/admin.js:2090`); `ventana.html` no lo tiene y arranca por `js/ventana.js:39-60`.

### 0.4 Regla de oro tras guardar

Después de cada escritura con éxito la UI llama `cargarTodo()` y repinta desde el backend: `js/admin.js:935, 951, 1490, 1691, 1727, 1762`; `js/panel.js:183, 219, 302`; `js/viaje.js:65, 74, 78, 269, 320, 383`. En `ventana.html`, `cargarTodo` es un no-op (`js/ventana.js:26`).

### 0.5 Cambio de idioma

`cambiarIdioma()` (`js/core.js:631-677`) vuelve a llamar `renderAll()` (`js/core.js:662`), lo que **repite** los tres `post()` de listado (`listar_presupuestos`, `listar_comprados`, `listar_ofertas`). No vuelve a llamar `getAll()`.

---

## 1. Métodos de `SheetsService`

### 1.1 Tabla resumen

| Método | Firma | Llamadores en la UI | Resultado | Uso de `source` |
|---|---|---|---|---|
| `configure` | `(config: object) → void` | `js/core.js:773` | nada | — |
| `getAll` | `() → Promise<{data, source, error?}>` | `js/admin.js:2022` (`cargarTodo`) | envelope | `setStatus(source)` `js/admin.js:2032` |
| `getLugares` | `() → Promise<{data, source, error?}>` | **ninguno** | envelope | — |
| `getVoluntarios` | `() → Promise<{data, source, error?}>` | **ninguno** | envelope | — |
| `getRescatistas` | `() → Promise<{data:[], source:'restricted'}>` | **ninguno** | envelope | — |
| `getMotorizados` | `() → Promise<{data, source, error?}>` | **ninguno** | envelope | — |
| `getFamiliasPublicas` | `() → Promise<{data, source, error?}>` | `js/damnificado.js:333` | envelope (`.data`) | ignorado |
| `getDesgloseDonaciones` | `(token) → Promise<Array>` | `js/admin.js:1974` | **crudo** (array) | — |
| `getTrayectos` | `(motorizadoId) → Promise<{data, source, error?}>` | `js/admin.js:920` | envelope (`.data`) | ignorado |
| `getHistorial` | `(lugarNombre) → Promise<{data, source, error?}>` | `js/admin.js:912` | envelope (`.data`) | ignorado |
| `getFamiliares` | `(query) → Promise<{data, source, error?}>` | `js/admin.js:1812` | envelope | exige `'live'` `js/admin.js:1813` |
| `getSeguimiento` | `(token) → Promise<{data, source, error?}>` | `js/admin.js:1861` | envelope | exige `'live'` `js/admin.js:1862` |
| `registrarse` | `(email, password) → Promise<GoTrueSignup>` | `js/admin.js:1643` | **crudo** | — |
| `iniciarSesion` | `(email, password) → Promise<GoTrueSession>` | `js/admin.js:1620` | **crudo** | — |
| `refrescarSesion` | `(refreshToken) → Promise<GoTrueSession>` | `js/core.js:551` (vía `sesionValida`, hoy sin llamadores) | **crudo** | — |
| `post` | `(payload) → Promise<object>` | 29 llamadas directas (`postAdmin` en `js/admin.js:16-18` reparte otras 45) → 62 acciones distintas (ver §3 y §7) | **crudo** (lo que devuelva la acción) | — |
| `flushQueue` | `() → Promise<{sent, pending}>` | sólo interno (`services/api.js:389, 392, 395`) | crudo | — |
| `getQueueCount` | `() → Promise<number>` | `js/pwa.js:50` | número | — |
| `clearOfflineQueue` | `() → Promise<number>` | `js/core.js:560` (`cerrarSesion`) | número (pendientes) | — |

### 1.2 Envelope de lectura `{ data, source, error }`

Producido por `getAll` (`services/api.js:216, 241, 244`), `getList` (`services/api.js:252, 258, 261`), `getFamiliares` (`services/api.js:269, 274, 277`) y `getSeguimiento` (`services/api.js:285, 289, 291, 294`).

| `source` | Cuándo | `data` | `error` |
|---|---|---|---|
| `'live'` | respuesta de red OK | filas frescas | ausente |
| `'offline-cache'` | `navigator.onLine === false` con snapshot, o fallo de red con snapshot | snapshot IndexedDB (`snapshots`, `services/api.js:24, 65-71`) | presente sólo si hubo fallo |
| `'error'` | fallo sin snapshot | `emptyAll()` / `[]` / `null` | `Error` |
| `'restricted'` | sólo `getRescatistas` (`services/api.js:403`) | `[]` | ausente |

Cómo lo usa la UI:

- `getAll` → `setStatus(result.source)` (`js/admin.js:2032`; `js/core.js:787-793`): el banner `#banner` se muestra con `status.errorBanner` si `source ∉ {'live','loading'}`. Es decir, **`'offline-cache'` también muestra el banner de error**. En `ventana.html` no hay `#banner` y `setStatus` retorna sin hacer nada (`js/core.js:790`).
- `getFamiliares` → si `res.source !== 'live'` lanza `res.error || Error(...)` y pinta `family.errorMessage` (`js/admin.js:1813-1820`). Los resultados cacheados **se rechazan**.
- `getSeguimiento` → si `res.source !== 'live' || !res.data || res.data.success === false` lanza (`js/admin.js:1862-1863`); el mensaje `/no encontrada|not found|404/i` se traduce a `tracking.notFound`, cualquier otro a `tracking.error` (`js/admin.js:1871-1873`).
- `getHistorial`, `getTrayectos`, `getFamiliasPublicas` → sólo leen `.data || []`; ignoran `source`.

### 1.3 Detalle por método

#### `getAll()` — `services/api.js:212-246`

- Lecturas actuales (en paralelo, `services/api.js:219-227`): `lugares_directorio?order=nombre`, `voluntarios_public?order=fecha_registro.desc`, `motorizados_public?order=fecha_registro.desc`, RPC `estadisticas` (sin args), `traslados_sugeridos?order=actualizado.desc&limit=30` (con `catch → []`), `vacantes_public?order=fecha_creacion.desc&limit=100` (con `catch → []`).
- `data` (`services/api.js:228-239`, sobre `emptyAll()` `143-158`): `{ lugares, centros (alias de lugares), voluntarios, rescatistas: [] (siempre), motorizados, estadisticas, traslados, vacantes, trayectos: [], historial: [], facturas: [], donacionesHumanitarias: [] }`.
- Mapeos aplicados a las filas (`services/api.js:195-210`): voluntarios → `medioTransporte = medio_transporte`; motorizados → `tipoVehiculo = tipo_vehiculo`, `zonaOperacion = zona_operacion`, `operaEn = zona_operacion`. (`rescatistaUI` existe pero no se usa.)
- Consumo en `cargarTodo` (`js/admin.js:2021-2034`): `estado.lugares = data.lugares || data.centros || []`; `estado.voluntarios = data.voluntarios || []`; `estado.rescatistas = data.rescatistas || []`; `estado.motorizados = data.motorizados || []`; `estado.traslados = data.traslados || []`; `estado.vacantes = data.vacantes || []`; `estado.donacionesHumanitarias = data.donacionesHumanitarias || data.donaciones_humanitarias || data.donations || []`; `estado.estadisticas = data.estadisticas || data.stats || {}`. `trayectos`, `historial` y `facturas` nunca se leen.
- Snapshot: se guarda bajo la clave `'all'` (`services/api.js:213, 240`).

#### `getLugares`, `getVoluntarios`, `getMotorizados`, `getRescatistas` — `services/api.js:401-404`

Exportados pero **sin llamadores** en `js/` ni en el HTML. `getRescatistas` resuelve `{ data: [], source: 'restricted' }` sin tocar la red. Conviene mantener las cuatro firmas por compatibilidad, con el mismo envelope de `getList`.

#### `getFamiliasPublicas()` — `services/api.js:405`

- Fuente: `familias_public?order=created_at.desc&limit=200`.
- Consumo: `js/damnificado.js:333` `(await getFamiliasPublicas()).data || []`; error → mensaje `familiasPub.error` (`js/damnificado.js:334`).
- Campos por fila (`js/damnificado.js:344-357`): `num_personas` (number), `num_menores` (number), `perdio_casa` (bool), `perdio_vehiculo` (bool), `necesidad_medica` (bool), `perdio_familiar` (bool), `municipio`, `estado_geo`, `estado` (`'nuevo'|'contactado'|'atendido'` → `tValue('familyStatePublic')`), `codigo`. **Nunca** nombres, contacto, dirección, GPS ni fotos (comentario `js/damnificado.js:6-9`).

#### `getDesgloseDonaciones(token)` — `services/api.js:406`

- Fuente: RPC `seguimiento_donaciones` con `{ p_token: token }`. Devuelve el resultado **crudo** (array), sin envelope y sin cache.
- Consumo: `js/admin.js:1970-1984`: `filas = (await getDesgloseDonaciones(token)) || []`; cualquier error vacía el contenedor. Campos por fila: `monto_usd` (number), `monto` (number, Bs), `creado` (ISO). Anónimo por diseño: no debe traer identidad del donante (`js/admin.js:1968-1969`).

#### `getTrayectos(motorizadoId)` — `services/api.js:407-408`

- Fuente: `trayectos_public?order=fecha.desc[&motorizado_id=eq.<id>]`. Filtra por **id de motorizado**.
- Consumo: `js/admin.js:917-924` (`abrirTrayectos`): `res.data || []`. Campos por ítem (`js/admin.js:922`): `origen`, `destino`, `kmRecorridos || km` (number), `insumo` (canónico → `mostrarInsumo`) o en su defecto `insumoTransportado` (texto `"<insumo> · <detalle>"` partido por `' · '`, `js/core.js:766-770`), `timestamp` (ISO → `fechaRelativa`).

#### `getHistorial(lugar)` — `services/api.js:409-410`

- Fuente: `historial_public?order=fecha.desc[&lugar=eq.<nombre>]`. Filtra por **nombre del lugar**, no por id.
- Consumo: `js/admin.js:910-915` (`abrirHistorial`): `res.data || []`. Campos por ítem (`js/admin.js:914`): `tipoMovimiento || tipo`, `insumo` (→ `mostrarInsumo`), `cantidad`, `unidad` (→ `mostrarUnidad`), `timestamp` (ISO).

#### `getFamiliares(query)` — `services/api.js:265-279`

- Fuente: RPC `buscar_familiar` con `{ q: String(query) }` (mínimo 3 caracteres, máximo 25 resultados según `CLAUDE.md`). Snapshot por consulta normalizada (`'familiares:' + q.trim().toLowerCase()`).
- Consumo: `js/admin.js:1807-1822`; render `js/admin.js:1824-1834`. Campos por persona (`js/admin.js:1831-1832`): `nombre`, `cedula`, `estado` (→ `tValue('familyStatus')`; si normalizado contiene `'fallec'` se pinta en gris con `family.supportLine`), `ubicacion` (opcional; si empieza por `Última vez:` se traduce el prefijo, `js/core.js:771`), `fuente` (opcional → `tValue('sources')`), `actualizado` (ISO), `verificada` (si es **exactamente** `false` muestra `family.unverifiedBadge`).

#### `getSeguimiento(token)` — `services/api.js:281-296`

- Fuente: RPC `seguimiento_factura` con `{ tok: token }`. Si el RPC devuelve `null` → `{ data: null, source: 'error', error: Error('Factura no encontrada') }` (`services/api.js:289`). Snapshot por token en mayúsculas.
- Entrada: el token ya llega normalizado a `DV-XXXX-XXXX-XXXX` (`js/core.js:721-726`; validación `js/admin.js:1836-1838`).
- `data` (objeto) consumido por `renderSeguimiento` (`js/admin.js:1897-1966`):
  - `data.success` / `data.error`: si `success === false` la UI lanza con `data.error` (`js/admin.js:1862-1863`).
  - `data.factura` (obligatorio; si falta se vacía el resultado, `js/admin.js:1898`): `objetivo`, `descripcion` (texto plano **o** JSON, ver §6.3), `porcentaje_completado` (preferido) o `porcentaje` (0-100), `estado` (→ `tValue('invoiceState')`; clase verde si normalizado empieza por `complet` o `cerrad`, `js/admin.js:1923`), `numero_factura`, `monto_requerido`, `monto_recaudado`, `token_publico`, `fecha_creacion`, `fecha_cierre` (ISO o vacío).
  - `data.historial` o, en su defecto, `data.movimientos` (`js/admin.js:1921`): array de `{ tipo (→ tValue('movementTypes')), monto (number), descripcion (texto o JSON {k:'mov'}, §6.2), fecha (ISO) }` (`js/admin.js:1924`).
  - `data.evidencias` (`js/admin.js:1922`): array de `{ archivo (URL https o nombre), descripcion, fecha }` (`js/admin.js:1926-1929`).
  - El RPC **no** devuelve el token: la UI lo toma del campo `#seguimiento-token` para pedir el desglose (`js/admin.js:1963-1965`).

#### `registrarse(email, password)` — `services/api.js:316-318`

- Consumo `js/admin.js:1643-1650`: si la respuesta trae `access_token` se entra al instante (`entrarConSesion(resp)`, que lee `access_token`, `refresh_token`, `expires_at`, `js/admin.js:1593-1595`); si no, se muestra `access.confirmSent` (correo por confirmar). Si el error contiene `/registered|already|exists/i` se muestra `access.emailTaken`, si no `access.signupError` (`js/admin.js:1652-1654`).

#### `iniciarSesion(email, password)` — `services/api.js:322-324`

- Consumo `js/admin.js:1620-1621`: se pasa la respuesta a `entrarConSesion` → necesita `access_token`, `refresh_token`, `expires_at`. Cualquier error muestra `access.loginError` genérico (anti-enumeración, `js/admin.js:1623-1624`). Antes de llamar, la UI exige contraseña ≥ 8 caracteres (`js/admin.js:1615`) y correo en minúsculas (`1613`).

#### `refrescarSesion(refreshToken)` — `services/api.js:327-329`

- Único llamador: `sesionValida()` (`js/core.js:546-556`), exportada en `window.sesionValida` (`js/core.js:625`) pero **hoy sin llamadores** en ningún módulo. Contrato de todos modos: si `Date.now()/1000 >= expires_at - 60` llama `refrescarSesion(s.refresh_token)`, fusiona `Object.assign({}, s, fresca)` y guarda; si falla cierra sesión (`js/core.js:549-555`). La respuesta debe traer `access_token`, `refresh_token`, `expires_at` (epoch en segundos).

#### `post(payload)` — `services/api.js:344-353`

- `payload` siempre es un objeto plano con `accion` (string) y campos planos (base64 `data:` para fotos/archivos).
- Semántica actual (`requestPost`, `services/api.js:331-342`): POST JSON, timeout 45 s; si HTTP no-OK lanza `Error(data.error || data.message || 'HTTP <status>')` con `error.status` (`services/api.js:171-174`); si el cuerpo es nulo o `data.success === false` lanza `Error(data.error || messages.saveError)` (`services/api.js:338-340`). Si no, **devuelve el JSON crudo** (sin envelope). La UI muestra `err.message` en casi todos los formularios → el backend debe devolver `error` legible en español/inglés neutro.
- Cola offline (`services/api.js:346, 350`): sólo si `DVOfflinePolicy.isQueueable(payload)`; como `SAFE_OFFLINE_ACTIONS` es un `Set` vacío (`services/offline-queue-policy.js:6`) y cualquier clave que coincida con `/token|password|pin|documento|cedula|foto|video|comprobante|gps|ubicacion|email|telefono|familia|denuncia|monto|pago/i` descalifica (`:7, 13-30`), **hoy ninguna acción se encola**. Si se activara, la respuesta sería `{ success: true, queued: true, queueId, token: 'PENDIENTE-' + últimos 6 del id en mayúsculas }` (`services/api.js:111-116`) y la UI la trataría como éxito.
- `flushQueue()` devuelve `{ sent, pending }`, reintenta en orden, descarta tras 3 intentos o 24 h (`services/offline-queue-policy.js:4-5, 62-66`) y emite `window` `CustomEvent('dv-offline-change', { detail: { count } })` (`services/api.js:73-78`), que `js/pwa.js:89` escucha para repintar `#pwa-queue-status` con `getQueueCount()` (`js/pwa.js:49-53`). Se dispara al volver `online`, al recibir `{type:'dv-sync'}` del SW (`sw.js:93, 97`) y 1,2 s tras cargar (`services/api.js:388-396`).

---

## 2. Shape de `estado` y de los datos derivados

`estado` se declara en `js/core.js:699-710`: `{ lugares, voluntarios, rescatistas, motorizados, traslados, donacionesHumanitarias, estadisticas, presupuestos, comprados, ofertas, vacantes, filtros }`. En runtime se añade `estado.tasa` (`js/vistas.js:503`). `filtros` es estado de UI puro.

Leyenda: **R** = requerido (la UI rompe o pinta basura sin él); O = opcional (tiene fallback). Tipos según el uso.

### 2.1 `estado.lugares[]` (hoy vista `lugares_directorio`, ordenada por `nombre`)

| Campo | Tipo | R/O | Uso |
|---|---|---|---|
| `nombre` | string | **R** | título de tarjeta `js/core.js:1836`; filtro texto `js/vistas.js:15`; id de historial `js/core.js:1762` → `getHistorial(nombre)`; opciones del select `#of-centro` `js/admin.js:1102`; cruce por nombre para teléfono `js/vistas.js:396-399` y destino del viaje `js/viaje.js:24-29`; id derivado `js/core.js:1383`; popup del mapa `js/vistas.js:133` |
| `tipo` | string: `'Centro'` \| `'Hospital'` \| `'Refugio'` (también acepta `'Punto de ayuda'`) | O (por defecto `'Centro'` en `mostrarTipo`, `js/core.js:752, 1835`) | filtro por prefijo normalizado `js/vistas.js:17`; clase/badge por prefijo `hospital`/`refugio` `js/core.js:1805-1806, 1819`; `tipoDonacionCanonico` `js/core.js:1375-1376` |
| `ubicacion` | string (texto libre; se parte por `,` en `estado, ciudad` `js/core.js:1322-1325`) | O (`centers.locationPending`) | `js/core.js:1743-1744, 1837`; `js/vistas.js:15, 133, 450, 470` |
| `telefono` | string (dígitos; se valida con `soloDigitos`) | O (`centers.phonePending`) | `js/core.js:1391, 1395, 1742-1756`; `js/vistas.js:398` |
| `actualizado` | ISO string | O | orden por reciente `js/vistas.js:21-25`; `centers.updated` `js/core.js:1837`; `ultimaActualizacion` `js/core.js:819`; `lastUpdate` `js/core.js:1392` |
| `lat`, `lng` | number \| null | O | mapa/distancia `js/vistas.js:90, 105-109, 117, 133-134`; destino del viaje `js/viaje.js:28`; formulario del panel `js/panel.js:104` |
| `gestionado` | boolean | O | badge `centers.managedBadge` `js/core.js:1835` |
| `necesita` | array de Insumo (§2.1.1) | O (`[]`) | `js/core.js:1378-1381, 1393, 1707, 1809-1816, 1821`; `js/vistas.js:14, 448-454` |
| `tiene_disponible` | array de Insumo | O (`[]`) | `js/core.js:1707, 1817, 1822`; `js/vistas.js:14` |
| `cubiertos` | array de Insumo | O (`[]`) | `js/core.js:1707, 1818`; `js/vistas.js:14` |

#### 2.1.1 Ítem de `necesita[]` / `tiene_disponible[]` / `cubiertos[]`

| Campo | Tipo | R/O | Uso |
|---|---|---|---|
| `nombre` | string canónico (→ `tValue('items')`) | **R** | `js/core.js:1378, 1790, 1812, 1817-1818`; `js/vistas.js:15, 450, 469, 479` |
| `categoria` | string canónico (→ `tValue('categories')`) | O (`'Otros'`) | filtro `js/vistas.js:18`; select de categorías `js/core.js:1707`; badge `js/core.js:1815`; `js/vistas.js:450, 468` |
| `urgencia` | string: `'Alta'` \| `'Normal'` \| `'Baja'` (legado: prefijos `critico`/`moderado`/`alto`) | O (`'Normal'`) | peso `js/core.js:1379`; clases `js/core.js:1720-1725, 1774-1779`; orden `js/vistas.js:454` (`=== 'Alta'`) |
| `cantidadNecesaria` | number | O (1) | `js/core.js:1381, 1714`; `js/vistas.js:464, 475` |
| `cantidadRecibida` | number | O (0) | `js/core.js:1715`; `js/vistas.js:464, 475` |
| `porcentaje` | number 0-100 | O (se recalcula si `cantidadNecesaria > 0`) | `js/core.js:1716` |
| `unidad` | string canónico (→ `tValue('units')`) | O (`'unidades'`) | `js/core.js:1717, 1793`; `js/vistas.js:463` |
| `yaCubierto` | boolean | O | excluye la necesidad de «Donar a una necesidad» `js/vistas.js:449` |
| `coincidencias` | array de `{ nombre_lugar, tipo, ubicacion, telefono }` | O (`[]`) | «Disponible en N lugares» `js/core.js:1811, 1814` (sólo se usa en `necesita`) |
| `estado` | — | no se lee en la proyección pública | (sólo en `panel_ver`, §3.2) |

Los ítems sólo se usan por sus campos; la búsqueda de texto concatena `nombre` de todos ellos (`js/vistas.js:14-15`).

### 2.2 `estado.voluntarios[]` (hoy `voluntarios_public` ordenada por `fecha_registro.desc`)

No existe tarjeta pública de voluntarios (`personaCard` sólo se invoca para rescatistas, `js/vistas.js:298`). Campos leídos:

| Campo | Tipo | Uso |
|---|---|---|
| `nombre`, `apellido` | string | `js/core.js:1405, 1407` |
| `telefono` | string | `js/core.js:1405, 1413, 1417` |
| `ciudad`, `estado` | string | `js/core.js:1408-1409`; `contarUnicos(voluntarios,'estado')` `js/core.js:1695` |
| `medioTransporte` \| `medio_transporte` \| `transporte` | string canónico (→ `tValue('transport')`) | `js/core.js:1410, 1691` (cualquiera de los tres; `api.js` añade `medioTransporte`) |
| `fecha_registro` | ISO | `js/core.js:820, 1414, 1689` |
| `profesion` | string canónico (→ `tValue('professions')`) | `js/core.js:1416, 1418` |
| `disponibilidad` | string | `js/core.js:1419` |

Si algún día se pinta `personaCard(v,'voluntario')` (`js/vistas.js:190-204`) también leería `observaciones` (→ `tValue('notes')`) y `disponibilidad` (→ `tValue('operationalStatus')`).

### 2.3 `estado.rescatistas[]`

Siempre `[]` desde `getAll` (`services/api.js:232-234`): la lista pública `renderRescatistas` (`js/vistas.js:291-299`) queda vacía y los KPIs usan `estado.rescatistas.length` (`js/core.js:1509, 1699`). Si se poblara, los campos leídos serían (`js/vistas.js:190-204, 206-215`; `js/core.js:1424-1443, 1690-1692`): `nombre`, `organizacion`, `telefono`, `especialidad` (→ `tValue('specialties')`; filtro exacto normalizado), `estado` (filtro exacto normalizado), `ciudad`, `disponibilidad`, `equipoDisponible` \| `equipo_disponible` \| `equipo` (→ `tValue('notes')`), `capacidadOperativa` \| `capacidad_operativa` \| `capacidad` (→ `tValue('capacity')`), `observaciones`, `fecha_registro`. **Atención**: `filtrarLista` busca texto sobre `Object.values(item).join(' ')` (`js/vistas.js:209`), así que cualquier campo extra de la fila es buscable: la proyección no debe incluir datos sensibles.

### 2.4 `estado.motorizados[]` (hoy `motorizados_public` ordenada por `fecha_registro.desc`)

| Campo | Tipo | R/O | Uso |
|---|---|---|---|
| `id` | string \| number (estable, apto para query string) | **R** | `data-trayectos` / `data-donar-mot` `js/vistas.js:311-318` → `irAVentana('trayectos', { id, nombre })`; comparación `String(x.id) === String(id)` `js/vistas.js:313, 317`, `js/admin.js:918, 942`; semilla `js/ventana.js:45` |
| `nombre` | string | **R** | `js/vistas.js:305, 311, 314, 318`; `js/admin.js:934, 950` |
| `tipoVehiculo` | string canónico (`'Moto'|'Carro'|'Bicicleta'|'Camión'|'Motocarro'`, → `tValue('transport')`) | O (`drivers.vehicleFallback`) | filtro por prefijo `js/vistas.js:307`; badge `311` (lo añade `motorizadoUI` desde `tipo_vehiculo`) |
| `zonaOperacion` \| `operaEn` | string | O (`drivers.zonePending`) | `js/vistas.js:305, 311` (ambos derivan de `zona_operacion` en `api.js:207-208`) |
| `placa` | string | O | `js/vistas.js:305, 311` |
| `telefono` | string | O | botón WhatsApp `js/vistas.js:311` |
| `totalTrayectos` | number | O (0) | `js/vistas.js:311` |
| `totalKm` | number | O (0) | `js/vistas.js:311` |
| `aporteDonado` | number | O (0) | `js/vistas.js:311` |
| `ultimoTrayecto` | ISO | O | `ultimaActualizacion` `js/core.js:822` |

Los cuatro últimos deben llegar **ya en camelCase** desde la proyección (no los mapea `api.js`).

### 2.5 `estado.traslados[]` (hoy `traslados_sugeridos`, orden `actualizado.desc`, límite 30)

Campos (`js/vistas.js:406-439`): `origen` (nombre de lugar; se cruza con `estado.lugares` por nombre para obtener teléfono, `415`), `destino` (nombre de lugar), `origen_ubicacion`, `destino_ubicacion` (texto; si ambos existen se arma ruta Google Maps, `419-421`), `urgencia` (→ `urgenciaClass` + `tValue('urgency')`, `425`), `categoria` (→ `tValue('categories')`), `insumo` (→ `tValue('items')`, `426`). La vista **no expone teléfonos** por diseño (`js/vistas.js:394-395`). `actualizado` sólo se usa para ordenar en la consulta.

### 2.6 `estado.vacantes[]` (hoy `vacantes_public`, orden `fecha_creacion.desc`, límite 100)

Campos (`js/vistas.js:220-289`): `rol` (→ `tValue('professions')`; también prellena `#vol-profesion` por prefijo, `281-283`), `lugar_nombre` (**R**; `contarUnicos`), `lugar_tipo` (`'Centro'|'Hospital'|'Refugio'|'Zona de derrumbe'`; filtro por igualdad estricta `228`; `'Zona de derrumbe'` pinta badge `rescue`, `253`), `ubicacion`, `descripcion`, `urgencia` (`'Alta'|'Normal'|'Baja'`; igualdad estricta `229`, peso `225`, KPI `239`), `cupos_faltantes` (number), `cantidad_necesaria` (number), `cantidad_cubierta` (number), `turno` (opcional), `telefono` (opcional, WhatsApp). Sólo deben publicarse vacantes abiertas (los KPIs cuentan «todas las abiertas», `233-241`).

### 2.7 `estado.donacionesHumanitarias[]` (legado)

Nunca lo llena `api.js` (`emptyAll` lo deja `[]`). Si se poblara, `normalizarDonacionSheet` (`js/core.js:1350-1371`) aceptaría, por fila y con alias en este orden: `donation_type|tipo|type`, `organization|organizacion|nombre|name`, `city|ciudad`, `state|estado`, `priority|prioridad`, `requested_items|items|necesidades|insumos` (array o texto separado por `,;|\n`), `beneficiaries|beneficiarios|personas_beneficiadas`, `verified|verificado` (`true|'si'|'sí'|'true'|'verificado'|'verified'`), `last_update|actualizado|fecha`, `status|estado_entrega`, `responsable|responsible`, `contact|contacto|telefono`, `specialty|especialidad`, `availability|disponibilidad`. Se puede omitir en Firebase: el tablero cae a `registrosDesdeLugares/Voluntarios/Rescatistas` y, si todo está vacío, a datos de ejemplo (`js/core.js:1470-1474`).

### 2.8 `estado.estadisticas` (hoy RPC `estadisticas`)

Objeto libre; el único campo leído es `actualizado` (ISO) en `ultimaActualizacion` (`js/core.js:818`). Alias de entrada `data.stats` (`js/admin.js:2031`).

### 2.9 `estado.presupuestos[]` y `estado.tasa` (acción `listar_presupuestos`, `js/vistas.js:497-507`)

`estado.presupuestos = r.presupuestos || []`; `estado.tasa = r.tasa` si viene (`js/vistas.js:502-503`).

Presupuesto (`js/vistas.js:539-582`, `js/admin.js:1330-1401`): `token` (**R**, formato `DV-…`; identifica el presupuesto en `donar_dinero` y en los botones), `estado` (`'Abierta'` muestra «Donar dinero»; `'Comprada'|'EnTransito'|'Entregada'` sólo badge, `js/vistas.js:510, 555`), `insumo` (→ `tValue('items')`), `centro` (nombre de lugar), `tienda`, `direccion` (opcional), `precio` (number, **Bs**), `recaudado` (number, Bs), `cantidad` (number), `presentacion` (opcional). El filtro de texto cubre `insumo, centro, tienda, direccion` (`545`).

Tasa (`js/vistas.js:517-531`): `{ efectiva: number (Bs por 1 USD), fuente: 'bcv' (se muestra «BCV») | cualquier otro (se muestra «Remitly»), fecha: ISO }`. Sin `efectiva > 0` no se muestran equivalentes en USD.

### 2.10 `estado.comprados[]` (acción `listar_comprados`, `js/vistas.js:654-708`)

`estado.comprados = r.comprados || []`. Campos: `token` (**R**), `estado` (`'Comprada'` → botón «recoger» → `abrirViaje(pr)` etapa 0; cualquier otro → botón «entregar» → `abrirViaje(pr, { etapa: 2 })`, `675-677, 696-707`), `insumo`, `tienda`, `centro`, `cantidad`, `presentacion`, `direccion`. El objeto se pasa entero a `abrirViaje` (§2.12).

### 2.11 `estado.ofertas[]` (acción `listar_ofertas`, `js/vistas.js:586-650`)

`estado.ofertas = r.ofertas || []`. Campos: `token` (**R**), `estado` (`'EnCamino'` → badge `invoiceState.EnCamino` y CTA «continuar», etapa 1; cualquier otro (p. ej. `'Ofrecida'`) → badge `offer.badge`, etapa 0; `608, 619, 649`), `insumo`, `cantidad`, `unidad`, `zona` (texto aproximado; reemplaza dirección exacta), `centro` (opcional, sugerido), `coordsAprox` (`{lat, lng}` aproximado ~1 km, opcional). Se convierte a un `pr` de oferta (`643-647`): `{ token, estado, insumo, centro, esOferta: true, recogidaCoords: coordsAprox || null, ubicacion: zona, tienda: zona, direccion: '' }`.

### 2.12 Objeto `pr` que consume `abrirViaje(pr, opciones)` (`js/viaje.js:84-390`)

Lee: `pr.token`, `pr.estado` (`'Comprada'` → etapa 0, si no 1, cuando no se fuerza `opciones.etapa`, `:88`), `pr.centro` (cruce por nombre con `estado.lugares` para `lat/lng`, `:24-29, 89`), `pr.insumo`, `pr.tienda`, `pr.direccion` (`:134, 153, 174-176`), `pr.esOferta`, `pr.recogidaCoords`, `pr.ubicacion` (`:193-195, 258`).

### 2.13 Semillas en `ventana.html`

`js/ventana.js:45`: si la URL trae `?id=`, `estado.motorizados = [{ id, nombre }]` (de `?nombre=`), sin llamar a `getAll`. Las ventanas `apoyar-transportista`/`trayectos` sólo necesitan eso (`js/admin.js:918, 942`).

### 2.14 `adminData` (`js/admin.js:12`, sólo consola admin)

`{ facturas, personas, vacantes, rescatistas, denuncias, voluntarios, familias, porComprar, atrasos }`, llenado por `cargarAdminData` (`js/admin.js:60-74`). Las formas se detallan en §3.7.

---

## 3. Respuestas de `post()` por acción

Convenciones: «→ éxito» significa que la UI sólo necesita que la promesa resuelva (no lee campos); cualquier `{ success: false, error }` o HTTP de error se muestra como `err.message`. Todos los archivos/fotos viajan como `data:` URL base64 (JPEG recomprimido ≤1280/1600 px o PDF).

### 3.1 `js/vistas.js` — listados públicos (sin autenticación)

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `listar_presupuestos` | `{ accion }` | `presupuestos[]` (§2.9), `tasa` (opcional) | `js/vistas.js:501-503` |
| `listar_ofertas` | `{ accion }` | `ofertas[]` (§2.11) | `js/vistas.js:590-591` |
| `listar_comprados` | `{ accion }` | `comprados[]` (§2.10) | `js/vistas.js:658-659` |

Los tres se lanzan en `renderAll()` y, si fallan, se ignoran silenciosamente (`js/vistas.js:504, 592, 660`).

### 3.2 `js/panel.js` — panel por centro (`token CTR-… + pin` en cada acción)

Credenciales: `credencialesPanel = { token, pin }` (`js/panel.js:43`) se mezclan en cada payload con `Object.assign` (`:180, 215`). El token se guarda en `localStorage['dv-token-centro']` tras un `panel_ver` exitoso (`:46`).

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `panel_ver` | `{ accion, token, pin }` | `PanelData` (abajo) → `renderPanelCentro(data)` | `js/panel.js:42, 48` |
| `panel_actualizar_lugar` | `{ accion, tipo, ubicacion, telefono, lat?, lng?, token, pin }` | `PanelData` (se repinta con la respuesta) | `js/panel.js:175-181` |
| `panel_insumo` | `{ accion, token, pin, insumoNombre, categoria, estado, urgencia, cantidadNecesaria, cantidadRecibida }` | `PanelData` | `js/panel.js:215-216, 227-229, 235` |
| `panel_insumo_borrar` | mismos campos que `panel_insumo` (identifica por `insumoNombre`) | `PanelData` | `js/panel.js:239` |
| `panel_crear` | `{ accion, nombre, tipo, ubicacion, telefono, email, fotoCedula, fotoSitio, pin, lat?, lng? }` | `token` (se muestra al centro; el servidor ya no lo envía por correo, V02) | `js/panel.js:287-300` |

`PanelData` (`js/panel.js:63-104`): `{ lugar: { nombre, tipo ('Centro'|'Hospital'|'Refugio'), ubicacion, telefono, lat, lng }, insumos: [{ nombre, categoria, estado ('Necesita'|'Disponible'|'Cubierto', defecto 'Necesita'), urgencia ('Alta'|'Normal'|'Baja', defecto 'Normal'), cantidad_necesaria (defecto 1), cantidad_recibida (defecto 0) }] }`. Nótese que el panel **lee** snake_case (`cantidad_necesaria`) y **envía** camelCase (`cantidadNecesaria`).

Valores que envía el panel: `estado` ∈ {`Necesita`,`Disponible`,`Cubierto`} y `urgencia` ∈ {`Alta`,`Normal`,`Baja`} (`js/panel.js:79-80, 199-206`); al añadir desde el catálogo: `estado: 'Necesita', urgencia: 'Normal', cantidadNecesaria: 1, cantidadRecibida: 0` (`:228`); `categoria` ∈ `CATEGORIAS_INSUMO` (`:18`) y nombres del `CATALOGO_INSUMOS` (`:9-17`); `tipo` ∈ {`Centro`,`Hospital`,`Refugio`} (`:67, 253`).

### 3.3 `js/admin.js` — formularios y flujos públicos (sin clave admin)

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `registrar_lugar` | `{ accion, tipo ('Centro'|'Hospital'|'Refugio'|'Punto de ayuda'), nombre, ubicacion, telefono, insumo, categoria, estado ('Necesita'|'Tiene disponible'), lat?, lng? }` | → éxito | `js/admin.js:1686-1690`; opciones `index.html:322-328` |
| `registrar_voluntario` | `{ accion, id ('VOL'+4 dígitos, generado en cliente), nombre, apellido, telefono, email, estado, ciudad, profesion, disponibilidad, medioTransporte, medio_transporte (duplicado), observaciones, fecha_registro (ISO cliente), fotoCedula }` | → éxito | `js/admin.js:1708-1726` |
| `registrar_rescatista` | `{ accion, id ('RES'+4), nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipoDisponible, equipo_disponible, capacidadOperativa, capacidad_operativa, observaciones, fecha_registro }` | → éxito | `js/admin.js:1743-1761` |
| `reportar_persona` | `{ accion, nombre, cedula, estado (§6.1 familyStatus), ubicacion, contacto, fuente }` | → éxito | `js/admin.js:1783-1791` |
| `registrar_trayecto` | `{ accion, idMotorizado, nombreMotorizado, origen, destino, km (number), insumo (defecto `'Varios'`) }` | → éxito | `js/admin.js:934` |
| `donar_motorizado` | `{ accion, idMotorizado, nombreMotorizado, monto (number), tipo (§6.1 supportTypes), donanteName (defecto `'Anónimo'`), ciudad }` | → éxito | `js/admin.js:950` |
| `registrar_motorizado` | `{ accion, nombre, tipoVehiculo, telefono, email, zonaOperacion, operaEn (duplicado), placa, fotoPlaca, fotoVehiculo, fotoCedula }` | → éxito | `js/admin.js:1488-1489` |
| `ofrecer_insumo` | `{ accion, insumo, cantidad (number), unidad, ubicacion (referencia del punto), telefono, nombreDonante, fotoInsumo (primera), fotosInsumo (array ≤20), fotoCedula, fotoLugar, zona, lat, lng, centro (nombre de lugar, obligatorio) }` | `token` | `js/admin.js:1256-1266` |
| `donar_dinero` | `{ accion, token (del presupuesto), montoUsd (number), nombreDonante, comprobante (dataURL imagen/PDF, obligatorio) }` | `estado` (`'Comprada'` → texto «ya comprado»), `recaudado`, `precio` (Bs), `montoUsd`, `montoBs`, `referencia`, `token` | `js/admin.js:1389-1393, 1405-1430` |
| `acceso_perfil` | `{ accion, accessToken }` | `roles[] { tipo, nombre }`, `email` | `js/admin.js:1588-1591` (§4) |

### 3.4 `js/viaje.js` — ciclo del transportista (exige sesión: `accessToken`)

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `viaje_iniciar` | `{ accion, token, nombreTransportista, etaMinutos (5-480), gps: {lat, lng}, accessToken, email }` | → éxito | `js/viaje.js:375-381` (sim `:63-64`) |
| `registrar_recogida` | `{ accion, token, nombreTransportista, accessToken, notas, fotoSitio, fotoInsumo, fotoPersona, gps }` | `km` (opcional) | `js/viaje.js:263-270` (sim `:70-74`) |
| `recoger_oferta` | `{ accion, token, nombreTransportista, accessToken, centroDestino, fotoSitio, fotoInsumo, fotoPersona, gps }` | `km` (opcional) | `js/viaje.js:259-262, 270` (sim `:67-69`) |
| `registrar_entrega_final` | `{ accion, token, accessToken, nombreReceptor, cargoReceptor, fotoCentro, fotoEncargado, gps }` | `km` (opcional) | `js/viaje.js:312-321` (sim `:75-78`) |

`recoger_oferta` se usa cuando `pr.esOferta`; `registrar_recogida` para compras (`js/viaje.js:257-266`).

### 3.5 `js/denuncias.js` — denuncias con video (exige sesión salvo el listado)

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `denuncia_parcial` | `{ accion, accessToken, denunciaId (null la primera vez), videoBase64 (todo lo grabado hasta ahora), duracionS, tipo, gps: {lat, lng, precision} \| null, facturaToken }` | `id` (se conserva para las siguientes parciales y la final) | `js/denuncias.js:228-232` |
| `denuncia_crear` | `{ accion, accessToken, denunciaId?, tipo, gps, texto, facturaToken, videoBase64, duracionS }` | → éxito | `js/denuncias.js:264-268`; reenvío offline sin `denunciaId` ni `texto` `:306-309` |
| `denuncias_listar` | `{ accion }` (público) | `denuncias[] { created_at, gps_lat, gps_lng, tipo, estado, video_url }` — **sin identidad** | `js/denuncias.js:327, 338-343` |

`tipo` ∈ {`'Retención de insumos'`, `'Otro'`} (`js/denuncias.js:69, 118-119`; defecto `'Otro'`).

### 3.6 `js/damnificado.js` — registro de familias (público, honeypot `web`)

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `damnificado_registrar` | `{ accion, web (honeypot, debe ir vacío), responsableNombre, responsableTelefono, responsableEmail, alojamiento, municipio, estadoGeo, gps: {lat, lng} \| null, integrantes: [{ nombre, parentesco (§6.1 familyRel), edad, ocupacion, condicionMedica, notas }], sustentoPrincipal, fallecidos (string numérico), fallecidosDetalle, perdioCasa (bool), perdioVehiculo (bool), vehiculosDetalle, bienesPerdidos, fotos: [dataURL ≤12] }` | `codigo` (se muestra y copia) | `js/damnificado.js:243-263` |

### 3.7 `js/admin.js` — consola de administración (`adminKey` en cada payload)

`postAdmin` añade `adminKey` desde `sessionStorage['adminKey']` (`js/admin.js:15-18`). `admin_listar_facturas` **valida la clave**: si falla, no se entra (`js/admin.js:49-56, 61-62`); el resto de listados son opcionales y caen a `[]` (`:63-73`).

#### Listados de `cargarAdminData` (`js/admin.js:60-74`)

| Acción | Respuesta | Campos leídos |
|---|---|---|
| `admin_listar_facturas` | `facturas[]` | `token_publico` (**R**, id de operación), `estado`, `objetivo`, `ultima_actualizacion` (ISO), `numero_factura`, `monto_recaudado`, `monto_requerido` (`js/admin.js:579-599, 771-774, 786, 792`). Mapeo `estatusTrack`: `Comprada|Ofrecida|EnCamino` → esperando; `EnTransito|Recogida` → recogido; `Entregada` → entregado; `'Cerrada'` → badge gris (`:581-583, 774`) |
| `admin_listar_personas` | `personas[]` | `id`, `nombre`, `cedula`, `estado`, `ubicacion`, `fuente` (sólo pendientes de verificar, `:853-856`) |
| `admin_listar_vacantes` | `vacantes[]` | `id`, `rol`, `lugar_nombre`, `lugar_tipo`, `urgencia`, `cantidad_cubierta`, `cantidad_necesaria`, `turno`, `estado` (`'Abierta'` habilita «cerrar», `:829-836`) |
| `admin_listar_rescatistas` | `rescatistas[]` | `nombre`, `especialidad`, `organizacion`, `ciudad`, `estado`, `capacidad_operativa`, `disponibilidad`, `telefono`, `equipo_disponible`, `observaciones`, `fecha_registro` (`:867-872`) |
| `admin_listar_voluntarios` | `voluntarios[]` | `nombre`, `apellido`, `profesion`, `ciudad`, `estado`, `disponibilidad`, `telefono`, `email`, `medio_transporte`, `fecha_registro` (`:879-885`) |
| `admin_denuncias` | `denuncias[]` | `id`, `created_at`, `gps_lat`, `gps_lng`, `tipo`, `estado`, `video_url`, `nombre`, `email`, `rol` (§6.1 reportRole), `texto`, `factura_token` (`:588, 612-625`) |
| `admin_damnificados` | `familias[]` | `id`, `created_at`, `gps_lat`, `gps_lng`, `integrantes[] { nombre, parentesco, edad, menor (bool), ocupacion, condicion_medica, notas }`, `fotos_urls[]` (URLs firmadas), `perdio_casa`, `perdio_vehiculo`, `vehiculos_detalle`, `alojamiento`, `municipio`, `estado_geo`, `estado` (`nuevo|contactado|atendido`), `num_personas`, `num_menores`, `fallecidos`, `responsable_nombre`, `codigo`, `responsable_telefono`, `responsable_email`, `sustento_principal`, `bienes_perdidos`, `fallecidos_detalle` (`:644-676`) |
| `admin_presupuestos_por_comprar` | `presupuestos[]` | `token`, `estado` (`'PorComprar'` habilita «marcar transferido», `:712`), `objetivo`, `recaudado`, `precio` (`:158-168, 697`) |
| `admin_viajes_atrasados` | `viajes[]` | `id`, `objetivo`, `transportista`, `email`, `tramo` (number), `eta_minutos`, `transcurrido_min`, `token_publico` (`:137-153`) |

#### Acciones del menú y alertas (`js/admin.js:88-216`)

| Acción | Payload | Respuesta | Cita |
|---|---|---|---|
| `admin_viaje_resolver` | `{ id }` | → éxito | `:202` |
| `admin_denuncia_crear` | `{ facturaToken, transportista, horas (number), tramo (number) }` | → éxito | `:208-209` |

#### Asistentes de creación (`js/admin.js:219-294, 300-404`)

| Acción | Payload | Respuesta | Cita |
|---|---|---|---|
| `admin_listar_necesidades` | `{ accion }` | `centros[] { centro (nombre), insumos[] { id, nombre, pendiente (number), unidad } }` | `:307, 313, 341-355, 380, 392-393` |
| `admin_crear_presupuesto` (asistente real) | `{ centro, insumo, necesidadId (id del insumo o ''), tienda, direccion, tiendaLat, tiendaLng, tiendaUrl, cantidad, presentacion, precio, adjunto (dataURL ≤5 MB o '') }` | `numeroFactura`, `token` | `:392-398` |
| `admin_crear_presupuesto` (definición declarativa, **inalcanzable**: `abrirAsistente('presupuesto')` desvía a `abrirPresupuesto`, `:407`) | `{ centro, insumo, tienda, direccion, cantidad, presentacion, precio }` | `numeroFactura`, `token` | `:265-267` |
| `admin_crear_vacante` | `{ lugarTipo ('Centro'|'Hospital'|'Refugio'|'Zona de derrumbe'), lugarNombre, ubicacion, rol, cantidad, urgencia ('Alta'|'Normal'|'Baja'), turno, telefono, descripcion }` | → éxito | `:273-288` |
| `admin_crear_factura` (asistente `donacion`, **no está en el menú**, `:93-96`) | `{ objetivo, descripcion, montoRequerido }` | `token`, `numeroFactura` | `:240-242` |

#### Gestión de facturas (`js/admin.js:770-826`)

| Acción | Payload | Respuesta | Cita |
|---|---|---|---|
| `admin_registrar_donacion` | `{ token, nombreDonante (defecto `'Anónimo'` en el asistente), monto, referencia, estado ('Registrada'|'Confirmada') }` | → éxito | `:241, 822` |
| `admin_registrar_movimiento` | `{ token, tipo ('Ingreso'|'Egreso'|'Compra'|'Entrega'), descripcion, monto }` | → éxito | `:804, 823` |
| `admin_registrar_evidencia` | `{ token, archivo (URL https), descripcion }` | → éxito | `:824` |
| `admin_cerrar_factura` | `{ token }` | → éxito | `:825` |

#### Compra verificada (`js/admin.js:696-756`)

| Acción | Payload | Respuesta | Cita |
|---|---|---|---|
| `admin_donaciones_presupuesto` | `{ token }` | `donaciones[] { id, estado ('Anulada' → rojo; §6.1 donationState), monto_usd, monto (Bs), nombre_donante, fecha, referencia_pago, comprobante_url (URL firmada, privada) }` | `:701-709` |
| `admin_donacion_anular` | `{ id }` | → éxito | `:737` |
| `admin_presupuesto_transferido` | `{ token, consolidado (dataURL imagen/PDF, público) }` | → éxito | `:745` |
| `admin_presupuesto_comprado` | `{ token, factura (dataURL imagen/PDF, público) }` | → éxito | `:753` |

#### Otros paneles

| Acción | Payload | Respuesta | Cita |
|---|---|---|---|
| `admin_denuncia_estado` | `{ id, estado ('Recibida'|'En revisión'|'Atendida') }` | → éxito | `:625, 633` |
| `admin_damnificado_estado` | `{ id, estado ('nuevo'|'contactado'|'atendido') }` | → éxito | `:676, 684` |
| `admin_actualizar_vacante` | `{ id, cantidadCubierta }` **o** `{ id, estado: 'Cerrada' }` | → éxito | `:843, 847` |
| `admin_verificar_persona` | `{ id }` | → éxito | `:861` |
| `admin_regenerar_panel` | `{ nombre (del centro) }` | `token`, `pin` | `:903-904`; también `js/admin-centros.js:162-168` |

### 3.8 `js/admin-datos.js`, `js/admin-centros.js`, `js/admin-personas.js` — consola de datos genérica (`adminKey`)

Fontanería común (`js/admin-datos.js`):

| Acción | Payload | Respuesta leída | Cita |
|---|---|---|---|
| `admin_datos_listar` | `{ entidad, busca (texto, búsqueda en servidor), pagina (1-based), porPagina (25; 100 para cachés) }` | `filas[]`, `total` (number) | `js/admin-datos.js:123-126`; cachés `:23-24` (`lugares` → `{id, nombre}`), `js/admin-centros.js:13-14` (`centros_panel` → `lugar_id`), `:108-109` (`insumos` filtradas por `lugar_id`) |
| `admin_datos_ficha` | `{ entidad, id }` | `fila` (objeto), `fotos[] { url, campo }`, `dependientes[] { modo ('cascade' u otro), cuantos, etiqueta }` | `:142-143, 155, 218-220`; `js/admin-personas.js:73-74` |
| `admin_datos_crear` | `{ entidad, campos: {…}, forzar (bool) }` | `duplicados[] { id, etiqueta, porque }` (si viene no vacío se pide confirmar) | `:185-188, 205-206` |
| `admin_datos_editar` | `{ entidad, id, campos: {…}, forzar }` | `duplicados[]`, `cambiados[]` (nombres de campo) | `:184-195` |
| `admin_datos_borrar` | `{ entidad, id, confirmar (el nombre tecleado) }` | → éxito | `:233-234` |
| `admin_datos_duplicados` | `{ entidad }` | `grupos[] { porque, filas[] { id, etiqueta } }` | `:252-258` |
| `admin_bitacora` | `{ entidad ('' = todas) }` | `cambios[] { id, accion ('crear'|'editar'|'borrar'|…, se traduce como `datos.action<Accion>`), entidad, fila_id, antes { nombre? , fila?: { nombre } }, despues { nombre? }, fecha, ip }` | `:271-285` |
| `admin_datos_deshacer` | `{ auditoriaId (number) }` | → éxito | `:292` |

`campos` en crear/editar: los `tipo: 'numero'|'coord'` van como `Number` (o `''` si vacío), `booleano` como bool, `ref` como `Number(id)` del centro, resto como string recortado (`js/admin-datos.js:63-74`).

Entidades y columnas que la UI **edita** (`campos`) o **muestra** (`fila`):

| `entidad` | Columnas editadas | Columnas mostradas además | Cita |
|---|---|---|---|
| `lugares` | `nombre`, `tipo` (`Centro|Hospital|Refugio`), `ubicacion`, `telefono`, `lat`, `lng` | `id` | `js/admin-centros.js:45-72` |
| `insumos` | `lugar_id` (ref), `nombre`, `categoria`, `estado` (`Necesita|Disponible|Cubierto`), `cantidad_necesaria`, `cantidad_recibida`, `urgencia` (`Alta|Normal|Baja`), `unidad` | `id` | `js/admin-centros.js:21-43, 103-119` |
| `centros_panel` | `email` | `id`, `lugar_id`, `token_centro`, `creado` (el token/PIN nunca se editan; se regeneran con `admin_regenerar_panel`) | `js/admin-centros.js:132-179` |
| `vacantes_voluntarios` | `rol`, `lugar_tipo` (`Centro|Hospital|Refugio|Zona de derrumbe`), `lugar_nombre`, `ubicacion`, `descripcion`, `cantidad_necesaria`, `cantidad_cubierta`, `urgencia`, `turno`, `telefono`, `estado` (`Abierta|Cubierta|Cerrada`) | `id` | `js/admin-centros.js:182-210` |
| `voluntarios` | `nombre`, `apellido`, `email`, `telefono`, `ciudad`, `estado`, `profesion`, `disponibilidad`, `medio_transporte`, `observaciones` | `id`, `foto_cedula` (truthy = tiene cédula) | `js/admin-personas.js:20-47` |
| `motorizados` | `nombre`, `tipo_vehiculo` (`Moto|Carro|Bicicleta|Camión|Triciclo motorizado`), `placa`, `zona_operacion`, `telefono`, `email` | `id`, `foto_cedula`, `foto_placa`, `foto_vehiculo` | `js/admin-personas.js:50-77` |
| `rescatistas` | `nombre`, `organizacion`, `especialidad`, `telefono`, `ciudad`, `estado`, `disponibilidad`, `equipo_disponible`, `capacidad_operativa`, `observaciones` | `id` | `js/admin-personas.js:80-103` |
| `personas` | `nombre`, `cedula`, `estado`, `ubicacion`, `contacto`, `fuente`, `reportado_por`, `verificada` (bool) | `id`, `fecha` | `js/admin-personas.js:106-129` |

---

## 4. Sesión

### 4.1 `localStorage['dv-sesion']` (`js/core.js:536`)

Escrita por `guardarSesion(datos)` (`js/core.js:537-540`) desde `entrarConSesion` (`js/admin.js:1592-1599`) con exactamente:

```json
{
  "access_token": "<JWT>",
  "refresh_token": "<string>",
  "expires_at": 1725600000,
  "email": "persona@correo",
  "nombre": "Nombre visible",
  "roles": [ { "tipo": "transportista" | "voluntario" | "<otro = centro>", "nombre": "…" } ]
}
```

- `access_token`, `refresh_token`, `expires_at` salen tal cual de `iniciarSesion`/`registrarse` (`js/admin.js:1593-1595`).
- `email` = `acceso_perfil.email || correo tecleado` (`js/admin.js:1591`).
- `nombre` = `nombre` del primer rol con nombre, si no la parte local del correo (`js/admin.js:1590, 1597`).
- `roles` = `acceso_perfil.roles || []` (`js/admin.js:1589`).
- Si `sesionValida` llegara a ejecutarse, el objeto se fusionaría con la respuesta completa de `refrescarSesion` (`js/core.js:552`), por lo que pueden aparecer claves GoTrue extra (`expires_in`, `token_type`, `user`, …); la UI las ignora.

Lecturas:

| Campo | Dónde | Para qué |
|---|---|---|
| `access_token` (truthy) | `js/core.js:544` | `sesionActual()` devuelve `null` sin él; guardias de sesión en `js/vistas.js:634`, `js/viaje.js:90-96`, `js/denuncias.js:98, 257, 299`, `js/panel.js:328`, `js/admin.js:1511, 2043` |
| `access_token` (valor) | `js/viaje.js:61, 260, 264, 314, 379`; `js/denuncias.js:229, 265, 307` | se envía como `accessToken` en los payloads |
| `expires_at`, `refresh_token` | `js/core.js:549-551` | sólo en `sesionValida` (sin llamadores) |
| `email` | `js/core.js:569, 594`; `js/admin.js:1549`; `js/viaje.js:64, 118-119, 380` | nombre de respaldo, «Sesión iniciada como», campo `email` de `viaje_iniciar` |
| `nombre` | `js/core.js:566`; `js/viaje.js:58, 101` | nombre del transportista |
| `roles[].tipo`, `roles[].nombre` | `js/core.js:567, 579-586, 591`; `js/admin.js:1525-1538` | filas «Ir a transportista / voluntario / centro»; `tipo` distinto de `transportista`/`voluntario` se trata como centro |

Cierre: `cerrarSesion()` borra la clave y limpia la cola offline (`js/core.js:557-563`).

### 4.2 `acceso_perfil` (`js/admin.js:1588`)

Payload `{ accion: 'acceso_perfil', accessToken }`. Debe validar el JWT y devolver `{ roles: [{ tipo, nombre }], email }`. Un usuario **sin roles no se rechaza** (`js/admin.js:1539-1547, 1600`): es el caso del donante. Valores de `tipo` que la UI distingue: `'transportista'`, `'voluntario'`; cualquier otro (p. ej. `'centro'`) cae en la fila de centro.

### 4.3 Dónde viaja `accessToken`

`viaje_iniciar`, `registrar_recogida`, `recoger_oferta`, `registrar_entrega_final` (`js/viaje.js:63, 67, 70, 76, 260, 264, 314, 379`), `denuncia_parcial`, `denuncia_crear` (`js/denuncias.js:229, 265, 307`) y `acceso_perfil` (`js/admin.js:1588`). Ninguna otra acción lleva JWT: las lecturas públicas y los formularios de registro son anónimos; el panel usa `token + pin`; la consola usa `adminKey`.

### 4.4 Otras claves de almacenamiento relacionadas

| Clave | Ámbito | Escribe | Lee |
|---|---|---|---|
| `dv-token-centro` | `localStorage` | `js/panel.js:46` (tras `panel_ver` OK) | `js/core.js:584`, `js/admin.js:1535` (prellenar `/panel-centro?token=`) |
| `dv-retorno` | `sessionStorage` | `js/vistas.js:636`, `js/viaje.js:95`, `js/denuncias.js:100`, `js/panel.js:332` | `js/admin.js:1603-1604` (vuelve al hash tras entrar) |
| `dv-acceso` | `sessionStorage` (legado) | nunca (sólo se borra `js/admin.js:1555`) | `js/admin.js:1504-1506, 1511` como respaldo de `sesionActual` |
| `adminKey` | `sessionStorage` | `js/admin.js:46` | `js/admin.js:15`; se borra en `:54, 81` |
| `ventana-toast` | `sessionStorage` | `js/ventana.js:21` | `js/admin.js:2071-2072` |

---

## 5. Lecturas por página `ventana.html?v=`

Las nueve rutas se reescriben en `vercel.json:5-15` a `/ventana.html?v=<ruta>` y se resuelven en `js/ventana.js:32-58`. En todas: `configure` (`js/core.js:773`), `initI18n` (`js/ventana.js:40`), `getAll` **no** se llama (`cargarTodo` es no-op, `js/ventana.js:26`), `flushQueue` corre a los 1,2 s (`services/api.js:395`) y `js/pwa.js:50` pide `getQueueCount`.

| Ruta | Parámetros | Al cargar | Acciones posteriores |
|---|---|---|---|
| `registrar-transportista` | — | nada | `registrar_motorizado` (`js/admin.js:1489`) |
| `apoyar-transportista` | `id`, `nombre` (siembran `estado.motorizados`, `js/ventana.js:45`) | nada | `donar_motorizado` (`js/admin.js:950`) |
| `trayectos` | `id`, `nombre` | `getTrayectos(id)` (`js/admin.js:920`) | `registrar_trayecto` (`js/admin.js:934`) |
| `historial` | `nombre` | `getHistorial(nombre)` (`js/admin.js:912`) | — |
| `crear-centro` | — | nada | `panel_crear` (`js/panel.js:287`) |
| `registro-familia` | — | nada | `damnificado_registrar` (`js/damnificado.js:243`) |
| `familias-afectadas` | — | `getFamiliasPublicas()` (`js/damnificado.js:333`) | — |
| `panel-centro` | `token` (prellena `#panel-token`) | nada hasta enviar token+PIN | `panel_ver` → luego `panel_actualizar_lugar`, `panel_insumo`, `panel_insumo_borrar` (`js/panel.js:42, 175, 215`) |
| `admin` | — | nada hasta enviar la clave | `admin_listar_facturas` (valida) + `admin_listar_personas`, `admin_listar_vacantes`, `admin_listar_rescatistas`, `admin_listar_voluntarios`, `admin_denuncias`, `admin_damnificados`, `admin_presupuestos_por_comprar`, `admin_viajes_atrasados` (`js/admin.js:60-74`); después, todas las de §3.7-3.8 |

Rutas y deep-links desde `index.html`: `#centro/CTR-…` → `/panel-centro?token=` y `#admin` → `/admin` (`js/panel.js:315-317`); botones `js/admin.js:2050-2056` (`/panel-centro`, `/crear-centro`, `/registro-familia`, `/registrar-transportista`, `/admin`); `irAVentana` (`js/vistas.js:388-391`). Toda ventana vuelve a `/` al cerrar (`js/ventana.js:28`).

Lecturas de `index.html` por hash (tras `getAll` + los tres listados): `#denuncias` → `denuncias_listar` (`js/denuncias.js:327`); `?token=` o `#seguimiento/DV-…` → `getSeguimiento` + `getDesgloseDonaciones` (`js/admin.js:1986-1990, 1965`); búsqueda familiar → `getFamiliares` (`js/admin.js:1774, 1812`).

---

## 6. Textos canónicos guardados en BD

La UI traduce valores con `tValue(scope, valor)` (`js/core.js:61-65`): busca `values.<scope>.<valor>` en `locales/<idioma>.json` y, si no existe, muestra el valor tal cual. Por tanto **los valores en BD deben ser exactamente estas cadenas en español** (con tildes y mayúsculas).

### 6.1 Valores por ámbito (`locales/es.json` → `values`)

| Ámbito (`tValue`) | Valores canónicos | Quién los escribe / lee |
|---|---|---|
| `types` | `Centro`, `Hospital`, `Refugio`, `Punto de ayuda`, `Zona de derrumbe` (`Centro de acopio` es sólo etiqueta) | `registrar_lugar` (`index.html:322`), `panel_crear`/`panel_actualizar_lugar` (`js/panel.js:67, 253`), vacantes (`js/admin.js:273`, `js/admin-centros.js:196`), lectura `lugar.tipo`, `vacante.lugar_tipo` |
| `categories` | `Agua potable`, `Medicamentos`, `Insumos médicos`, `Alimentos`, `Plantas eléctricas`, `Combustible`, `Higiene`, `Ropa`, `Otros` (+ legado `Medicinas`, `Bebidas`, `Equipos médicos`, `Suministros quirúrgicos`, `Fluidos IV`) | `registrar_lugar` (`index.html:327`), panel (`js/panel.js:9-18`), lectura `item.categoria`, `traslado.categoria` |
| `supplyStatus` | `Necesita`, `Disponible`, `Cubierto` (estado de insumo); `Tiene disponible` (sólo en `registrar_lugar`) | `js/panel.js:79, 202, 228`; `js/admin-centros.js:35`; `index.html:328` |
| `urgency` | `Alta`, `Normal`, `Baja` (+ legado `Crítico`, `Moderado`) | `js/panel.js:80, 203, 228`; vacantes `js/admin.js:280`; `js/admin-centros.js:39, 203`; lectura `item.urgencia`, `vacante.urgencia`, `traslado.urgencia` |
| `professions` | `Voluntario`, `Médico`, `Enfermero`, `Psicólogo`, `Logística`, `Transportista`, `Ingeniero`, `Electricista`, `Comunicaciones`, `Otro` | `registrar_voluntario.profesion` (`index.html:556`); `vacante.rol` se traduce con este ámbito (`js/vistas.js:259`) |
| `transport` | `A pie`, `Bicicleta`, `Moto`, `Carro`, `Camioneta`, `Transporte público`, `Ambulancia o unidad médica`, `Otro`, `Camión`, `Motocarro` | `registrar_voluntario.medioTransporte` (`index.html:558`); `registrar_motorizado.tipoVehiculo` (`js/admin.js:1443`); consola admin usa además `Triciclo motorizado` (`js/admin-personas.js:65`) |
| `specialties` | `Bombero`, `Paramédico`, `Protección Civil`, `Rescate Urbano`, `Rescate Acuático`, `Rescate Canino`, `Defensa Civil`, `Otro` | `registrar_rescatista.especialidad` (`index.html:584`) |
| `capacity` | `1-2 personas`, `3-5 personas`, `6-10 personas`, `Más de 10 personas`, `Unidad médica`, `Unidad de rescate pesado` | `registrar_rescatista.capacidadOperativa` (`index.html:589`) |
| `items` | `Gasas estériles`, `Agua potable`, `Agua embotellada`, `Leche en polvo`, `Mantas`, `Ropa de adulto`, `Pañales`, `Analgésicos`, `Sueros fisiológicos`, `Plantas eléctricas`, `Colchonetas`, `Arroz`, `Jabón`, `Calzado`, `Oxímetros`, `Guantes`, `Material médico`, `Transporte`, `Alimentos`, `Combustible`, `Kits de higiene`, `Equipos`, `Herramientas` | catálogo del panel (`js/panel.js:9-17`); cualquier `insumo`/`nombre` de insumo; los no listados se muestran tal cual |
| `units` | `unidades` (defecto), `paquetes`, `cajas`, `latas`, `kg`, `pares`, `bolsas`, `personas` | `item.unidad`, `oferta.unidad`, `historial.unidad`, JSON de movimientos |
| `supportTypes` | `Pago móvil`, `Efectivo`, `Combustible`, `Repuesto`, `Otro` | `donar_motorizado.tipo` (`js/admin.js:944`) |
| `familyStatus` | `Localizado con vida`, `Hospitalizado`, `En refugio`, `Sin información reciente`, `Fallecido` | `reportar_persona.estado` (`index.html:643`, `js/core.js:124-130`); lectura `persona.estado` (`js/admin.js:1831-1832`) |
| `sources` | `Lista Cruz Roja`, `Protección Civil`, `Registro hospitalario`, `Reporte familiar`, `Lista comunitaria`, `Cruz Roja`, `Registro oficial` | `persona.fuente` (texto libre en el formulario; estos se traducen) |
| `notes`, `operationalStatus` | textos de ejemplo (`Primeros auxilios`, `Activo`, …) | `observaciones`/`equipo` y `disponibilidad` de personas; texto libre |
| `donationPriorities` | `Crítico`, `Alto`, `Medio` | derivados en cliente (`js/core.js:1277-1282`), no se guardan |
| `aidStatus` | `Pendiente`, `En proceso`, `Entregado` | derivados en cliente (`js/core.js:1298-1303`) |
| `budgetState` | `Abierta`, `Comprada`, `EnTransito`, `Entregada` | `presupuesto.estado` / `comprado.estado` (`js/vistas.js:510`) |
| `invoiceState` | `Abierta`, `Comprada`, `Cerrada`, `Completada`, `Ofrecida`, `Recogida`, `EnTransito`, `Entregada`, `Registrada`, `Confirmada`, `EnCamino`, `PorComprar`, `Transferida` | `factura.estado` (seguimiento `js/admin.js:1936`, admin `:596, 728, 774`), `oferta.estado` (`js/vistas.js:608`), `porComprar.estado` (`js/admin.js:164`) |
| `movementTypes` | `Ingreso`, `Egreso`, `Compra`, `Entrega`, `Recogida`, `Oferta` | `admin_registrar_movimiento.tipo` (`js/admin.js:804`); `mov.tipo` en seguimiento (`:1924`) |
| `donationState` | `Registrada`, `Confirmada`, `Anulada` | `admin_registrar_donacion.estado` (`js/admin.js:234-235, 799`); `donacion.estado` (`:704, 709`) |
| `reportType` | `Retención de insumos`, `Otro` | `denuncia.tipo` (`js/denuncias.js:69, 91, 118-119, 308`) |
| `reportState` | `Recibida`, `En revisión`, `Atendida` | `admin_denuncia_estado` (`js/admin.js:625`); `denuncia.estado` |
| `reportRole` | `transportista`, `voluntario`, `centro`, `donante` | `denuncia.rol` (admin `js/admin.js:620`); coincide con `roles[].tipo` de la sesión |
| `familyRel` | `self`, `spouse`, `child`, `parent`, `grandparent`, `sibling`, `other` | `integrantes[].parentesco` (`js/damnificado.js:18`; admin `js/admin.js:651`) |
| `familyState` / `familyStatePublic` | `nuevo`, `contactado`, `atendido` | `familia.estado` (`js/admin.js:664, 676`; `js/damnificado.js:356`) |

### 6.2 Movimientos codificados `{ "k": "mov", "c": "<código>", … }`

`textoMovimiento(descripcion)` (`js/admin.js:1881-1895`) intenta `JSON.parse`; si el objeto tiene `k === 'mov'` y `c`, traduce `movements.<c>` interpolando el resto de claves del objeto; antes traduce `insumo` con `mostrarInsumo` y `unidad` con `mostrarUnidad` (`:1888-1890`). Si el JSON no parsea, se muestra el texto plano (filas antiguas). Un código desconocido se pinta como la clave literal `movements.<c>` (`js/core.js:57`).

Códigos que la UI sabe redactar (`locales/es.json` y `en.json`, 17 claves idénticas) y las claves que cada uno lee:

| `c` | Claves interpoladas |
|---|---|
| `recepcionConfirmada` | `delta`, `unidad` |
| `donacionRegistrada` | `cantidad`, `unidad`, `insumo` |
| `dineroRecibido` | `referencia` |
| `metaAlcanzada` | `insumo`, `tienda` |
| `metaCubierta` | `insumo`, `tienda` |
| `transferidoABs` | — |
| `compraConfirmada` | — |
| `reabiertoPorAnulacion` | — |
| `insumoRecogido` | `nombre`, `tienda`, `direccion` |
| `insumoRecogidoConNota` | `nombre`, `tienda`, `direccion`, `notas` |
| `entregado` | `centro`, `receptor` |
| `entregadoConCargo` | `centro`, `receptor`, `cargo` |
| `donacionOfrecida` | `cantidad`, `unidad`, `insumo`, `ubicacion` |
| `donacionRecogida` | `nombre`, `ubicacion`, `centro` |
| `necesidadCubierta` | — |
| `viajeIniciado` | `nombre`, `eta` |
| `denunciaRegistrada` | — |

Claves ausentes se interpolan como cadena vacía (`js/core.js:52-54`).

### 6.3 `factura.descripcion` codificada (seguimiento, `js/admin.js:1907-1919`)

- `{ "k": "pres", "cantidad", "presentacion", "tienda", "direccion", "centro", "adjunto" }` → se pinta `needs.budgetLine` + `· direccion` + `→ centro`; si `adjunto` es URL `https?://` se ofrece «ver presupuesto».
- `{ "k": "oferta", "cantidad", "unidad", "ubicacion", "centro" }` → `"<cantidad> <unidad> · <ubicacion> → <centro>"` (sin teléfono del donante).
- Cualquier otro texto se muestra literal.

### 6.4 Literales que la UI escribe por defecto

| Literal | Dónde | Campo |
|---|---|---|
| `'Anónimo'` | `js/admin.js:241, 950` | `nombreDonante` (asistente admin), `donanteName` (`donar_motorizado`) |
| `'Varios'` | `js/admin.js:934` | `registrar_trayecto.insumo` |
| `'Necesita'`, `'Normal'`, `1`, `0` | `js/panel.js:202-203, 228` | estado/urgencia/cantidades de insumo nuevo |
| `'Registrada'` | `js/admin.js:241` | `admin_registrar_donacion.estado` por defecto |
| `'Cerrada'` | `js/admin.js:847` | `admin_actualizar_vacante.estado` |
| `'Otro'` | `js/denuncias.js:69, 308` | `denuncia.tipo` por defecto |
| `'Retención de insumos'` | `js/denuncias.js:91` | tipo preseleccionado con viaje activo |
| `'unidades'` | `js/core.js:756, 1717`; `js/vistas.js:463` | unidad por defecto al pintar |
| `'VOL'+4 dígitos`, `'RES'+4 dígitos` | `js/admin.js:1709, 1744` | `id` cliente de voluntario/rescatista (el backend puede ignorarlo) |
| `'Zona de derrumbe'` | `js/vistas.js:253` | `lugar_tipo` que pinta badge `rescue` |

### 6.5 Formatos de identificadores

| Formato | Uso | Cita |
|---|---|---|
| `DV-XXXX-XXXX-XXXX` (A-Z0-9) | token público de factura/presupuesto/oferta; `normalizarTokenCliente` acepta `DV` + 12 alfanuméricos sin guiones y lo reformatea | `js/core.js:721-726`; `js/admin.js:1836-1838` |
| `CTR-XXXX-XXXX-XXXX` | token de panel de centro (se sube a mayúsculas antes de enviar) | `js/panel.js:26, 38, 315` |
| PIN 4-8 dígitos | `panel_crear.pin` / `panel_ver.pin` (hash SHA-256 + salt en servidor, `CLAUDE.md`) | `js/panel.js:27, 259` |
| `PENDIENTE-XXXXXX` | token provisional de una acción encolada offline | `services/api.js:115` |
| `codigo` de familia | devuelto por `damnificado_registrar`, visible en `familias_public` | `js/damnificado.js:263, 357` |
| `numero_factura` / `numeroFactura` | número legible de factura (admin) | `js/admin.js:242, 398, 773, 1941` |

---

## 7. Apéndice: índice alfabético de acciones `post()`

| Acción | Módulo | Auth | Cita del envío |
|---|---|---|---|
| `acceso_perfil` | admin.js (acceso) | `accessToken` | `js/admin.js:1588` |
| `admin_actualizar_vacante` | admin.js | `adminKey` | `js/admin.js:843, 847` |
| `admin_bitacora` | admin-datos.js | `adminKey` | `js/admin-datos.js:271` |
| `admin_cerrar_factura` | admin.js | `adminKey` | `js/admin.js:825` |
| `admin_crear_factura` | admin.js | `adminKey` | `js/admin.js:240` |
| `admin_crear_presupuesto` | admin.js | `adminKey` | `js/admin.js:265, 392` |
| `admin_crear_vacante` | admin.js | `adminKey` | `js/admin.js:288` |
| `admin_damnificado_estado` | admin.js | `adminKey` | `js/admin.js:684` |
| `admin_damnificados` | admin.js | `adminKey` | `js/admin.js:71` |
| `admin_datos_borrar` | admin-datos.js | `adminKey` | `js/admin-datos.js:233` |
| `admin_datos_crear` | admin-datos.js | `adminKey` | `js/admin-datos.js:185` |
| `admin_datos_deshacer` | admin-datos.js | `adminKey` | `js/admin-datos.js:292` |
| `admin_datos_duplicados` | admin-datos.js | `adminKey` | `js/admin-datos.js:252` |
| `admin_datos_editar` | admin-datos.js | `adminKey` | `js/admin-datos.js:184` |
| `admin_datos_ficha` | admin-datos.js | `adminKey` | `js/admin-datos.js:142` |
| `admin_datos_listar` | admin-datos.js, admin-centros.js | `adminKey` | `js/admin-datos.js:23, 123`; `js/admin-centros.js:13, 108` |
| `admin_denuncia_crear` | admin.js | `adminKey` | `js/admin.js:208` |
| `admin_denuncia_estado` | admin.js | `adminKey` | `js/admin.js:633` |
| `admin_denuncias` | admin.js | `adminKey` | `js/admin.js:70` |
| `admin_donacion_anular` | admin.js | `adminKey` | `js/admin.js:737` |
| `admin_donaciones_presupuesto` | admin.js | `adminKey` | `js/admin.js:701` |
| `admin_listar_facturas` | admin.js | `adminKey` (valida clave) | `js/admin.js:62` |
| `admin_listar_necesidades` | admin.js | `adminKey` | `js/admin.js:307` |
| `admin_listar_personas` | admin.js | `adminKey` | `js/admin.js:66` |
| `admin_listar_rescatistas` | admin.js | `adminKey` | `js/admin.js:68` |
| `admin_listar_vacantes` | admin.js | `adminKey` | `js/admin.js:67` |
| `admin_listar_voluntarios` | admin.js | `adminKey` | `js/admin.js:69` |
| `admin_presupuesto_comprado` | admin.js | `adminKey` | `js/admin.js:753` |
| `admin_presupuesto_transferido` | admin.js | `adminKey` | `js/admin.js:745` |
| `admin_presupuestos_por_comprar` | admin.js | `adminKey` | `js/admin.js:72` |
| `admin_regenerar_panel` | admin.js, admin-centros.js | `adminKey` | `js/admin.js:903`; `js/admin-centros.js:162` |
| `admin_registrar_donacion` | admin.js | `adminKey` | `js/admin.js:241, 822` |
| `admin_registrar_evidencia` | admin.js | `adminKey` | `js/admin.js:824` |
| `admin_registrar_movimiento` | admin.js | `adminKey` | `js/admin.js:823` |
| `admin_verificar_persona` | admin.js | `adminKey` | `js/admin.js:861` |
| `admin_viaje_resolver` | admin.js | `adminKey` | `js/admin.js:202` |
| `admin_viajes_atrasados` | admin.js | `adminKey` | `js/admin.js:73` |
| `damnificado_registrar` | damnificado.js | público (honeypot `web`) | `js/damnificado.js:243` |
| `denuncia_crear` | denuncias.js | `accessToken` | `js/denuncias.js:264, 306` |
| `denuncia_parcial` | denuncias.js | `accessToken` | `js/denuncias.js:228` |
| `denuncias_listar` | denuncias.js | público | `js/denuncias.js:327` |
| `donar_dinero` | admin.js | público | `js/admin.js:1389` |
| `donar_motorizado` | admin.js | público | `js/admin.js:950` |
| `listar_comprados` | vistas.js | público | `js/vistas.js:658` |
| `listar_ofertas` | vistas.js | público | `js/vistas.js:590` |
| `listar_presupuestos` | vistas.js | público | `js/vistas.js:501` |
| `ofrecer_insumo` | admin.js | público | `js/admin.js:1256` |
| `panel_actualizar_lugar` | panel.js | `token`+`pin` | `js/panel.js:175` |
| `panel_crear` | panel.js | público (crea `token`+`pin`) | `js/panel.js:287` |
| `panel_insumo` | panel.js | `token`+`pin` | `js/panel.js:215, 227, 235` |
| `panel_insumo_borrar` | panel.js | `token`+`pin` | `js/panel.js:215, 239` |
| `panel_ver` | panel.js | `token`+`pin` | `js/panel.js:42` |
| `recoger_oferta` | viaje.js | `accessToken` | `js/viaje.js:67, 259` |
| `registrar_entrega_final` | viaje.js | `accessToken` | `js/viaje.js:75, 312` |
| `registrar_lugar` | admin.js | público | `js/admin.js:1687` |
| `registrar_motorizado` | admin.js | público | `js/admin.js:1489` |
| `registrar_recogida` | viaje.js | `accessToken` | `js/viaje.js:70, 263` |
| `registrar_rescatista` | admin.js | público | `js/admin.js:1761` |
| `registrar_trayecto` | admin.js | público | `js/admin.js:934` |
| `registrar_voluntario` | admin.js | público | `js/admin.js:1726` |
| `reportar_persona` | admin.js | público | `js/admin.js:1783` |
| `viaje_iniciar` | viaje.js | `accessToken` | `js/viaje.js:63, 375` |

Total: 62 acciones distintas (54 con `accion: '…'` literal más las 8 que `cargarAdminData` pasa como `{ accion }`, `js/admin.js:63-73`). Lecturas por PostgREST/RPC que el facade encapsula: `lugares_directorio`, `voluntarios_public`, `motorizados_public`, `traslados_sugeridos`, `vacantes_public`, `familias_public`, `trayectos_public`, `historial_public`, RPC `estadisticas`, `buscar_familiar`, `seguimiento_factura`, `seguimiento_donaciones`; más Supabase Auth (`signup`, `token?grant_type=password`, `token?grant_type=refresh_token`).

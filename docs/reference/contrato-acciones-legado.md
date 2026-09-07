# Contrato de acciones del backend legado (edge function `api`)

Referencia exhaustiva de la lógica de negocio que vive hoy en la edge function de Supabase
`supabase/functions/api/index.ts` (2180 líneas, 65 acciones + `cron_tasa`), de las vistas y RPCs
que el frontend lee por PostgREST (`supabase/migrations/20260101000001_esquema_vistas.sql`) y del
cliente `services/api.js`. Está escrita para que otro ingeniero pueda reimplementar cada acción
sobre Firebase **sin leer el código legado**: copia literalmente límites, expresiones regulares,
mensajes de error, nombres de campos y formas de respuesta.

Convenciones:

- `index.ts:926-938` = rango de líneas en `supabase/functions/api/index.ts`. `vistas.sql:` =
  `supabase/migrations/20260101000001_esquema_vistas.sql`. `base.sql:` =
  `supabase/migrations/20260101000000_esquema_base.sql` (solo se cita para valores por defecto de
  columnas). `api.js:` = `services/api.js`.
- `s(x, N)` significa «texto saneado con `s()` y tope N» (ver 1.2). `n(x)` = número saneado. Cuando
  no se indica tope, `s()` usa 300.
- «dataURL» = cadena `data:<mime>;base64,<b64>` completa en el cuerpo JSON (las fotos viajan
  embebidas, no como multipart).
- Los mensajes de error se copian **entre comillas y textualmente**; el backend los devuelve en
  `error` (ver 1.1). Un mensaje con `${…}` es una plantilla con los valores indicados.
- «Respuesta» describe el objeto que se fusiona con `{ success: true }`. `{}` significa que solo se
  devuelve `{ success: true }`.
- Todas las fechas se escriben como ISO-8601 UTC (`new Date().toISOString()`).

---

## 1. Reglas transversales

### 1.1 Envoltura HTTP y códigos de estado (`index.ts:11-15`, `index.ts:2165-2180`; `api.js:319-331`)

- Solo `POST` con cuerpo JSON `{ "accion": "<nombre>", ...campos }`. `OPTIONS` responde vacío con
  CORS. Cualquier otro método responde `405` con `{ "success": false, "error": "solo POST" }`.
- CORS: `Access-Control-Allow-Origin: *`; `Access-Control-Allow-Headers: authorization,
  x-client-info, apikey, content-type`; `Content-Type: application/json`.
- `accion = s(body.accion, 40)`. Acción desconocida → `"accion desconocida"` (400).
- Éxito: `{ "success": true, ...respuestaDeLaAccion }` con `200`.
- Error: `{ "success": false, "error": msg }` donde `msg = s(err.message, 200)` (se trunca a 200).
  Estado HTTP calculado **por regex sobre el mensaje**:
  - `/demasiadas/i` → `429`
  - `/clave admin|no configurado/i` → `401`
  - cualquier otro → `400`
- Los errores de PostgREST/Storage que no se traducen se propagan con su `message` original (por
  ejemplo, violación de clave única al insertar). Firebase debe decidir mensajes equivalentes.
- Cliente (`api.js` `requestPost`): `fetch(config.supabaseUrl + '/functions/v1/api')`, cabeceras
  `apikey: <clave publishable>` y `Content-Type: application/json` (nunca `Authorization`),
  tiempo máximo **45 000 ms**. Si `!data || data.success === false` lanza `Error(data.error ||
  t('messages.saveError') /* «No se pudo guardar» */)`. El JWT de sesión viaja **dentro del cuerpo**
  como `accessToken`, no en cabecera.
- Cola offline (`api.js` `post`, `services/offline-queue-policy.js`): solo se encola si
  `DVOfflinePolicy.isQueueable(payload)`; hoy `SAFE_OFFLINE_ACTIONS` está **vacío**, así que ninguna
  acción se reintenta desde el cliente. Si se abre en el futuro, la entrada encolada devuelve
  `{ success: true, queued: true, queueId, token: 'PENDIENTE-' + queueId.slice(-6).toUpperCase() }`,
  TTL 24 h, máximo 3 intentos; las claves que contengan
  `/token|password|pin|documento|cedula|foto|video|comprobante|gps|ubicacion|email|telefono|familia|denuncia|monto|pago/i`
  nunca se encolan.

### 1.2 Saneamiento básico (`index.ts:17-29`)

| Helper | Definición exacta | Consecuencias |
|---|---|---|
| `s(v, max = 300)` | `String(v ?? '').trim().slice(0, max)` | Nunca lanza. `null`/`undefined` → `''`. Objetos → `"[object Object]"`. **Trunca, no rechaza** (un nombre de 500 caracteres se guarda cortado a 120). Se recorta antes de truncar, así que el resultado puede terminar en espacio. `slice` cuenta unidades UTF-16. |
| `n(v)` | `Number(v)`; si no es finito → `0` | `''`, `null`, `'abc'`, `NaN`, `Infinity` → `0`; `true` → `1`; `'12abc'` → `0`; `' 7 '` → `7`. |
| `emailNorm(v)` | `x = s(v, 254).toLowerCase()`; devuelve `x` si cumple `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, si no `''` | El correo se guarda **siempre en minúsculas** para que las búsquedas por igualdad (`acceso_perfil`, `identidadSesion`) coincidan. |
| `ipDe(req)` | `s(req.headers.get('x-forwarded-for')?.split(',')[0] \|\| 'desconocida', 64)` | Primera IP de `X-Forwarded-For`; sin cabecera → `'desconocida'` (todos los clientes sin cabecera comparten cubo). |
| `ventanaActual()` | `new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString()` | Inicio de la hora UTC en curso. Las ventanas de rate-limit son **horas de reloj**, no ventanas deslizantes. |
| `sha256Hex(texto)` | SHA-256 del UTF-8 de `texto`, hex minúsculas de 64 caracteres | Se usa para PIN (`salt + pin`) y clave admin. |
| `hashIguales(a, b)` | Comparación en tiempo constante; `false` si las longitudes difieren | Se usa para los dos hashes anteriores. |

### 1.3 Identificadores y tokens (`index.ts:66-71`, `index.ts:336-348`)

- `tokenAlfa(prefijo)`: alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 símbolos: mayúsculas sin
  `I`, `L`, `O` y dígitos sin `0`, `1`); toma 12 bytes de `crypto.getRandomValues` y usa
  `abc[byte % 31]` (hay un ligero sesgo modular, no importa funcionalmente); formato
  `${prefijo}-XXXX-XXXX-XXXX`. Prefijos usados:
  - `DV` → `facturas.token_publico` (17 caracteres, p. ej. `DV-7HK2-QW9P-ZX4M`).
  - `CTR` → `centros_panel.token_centro` (18 caracteres). Al autenticar se valida con
    `/^CTR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/` tras `s(token, 24).toUpperCase()`.
  - `REF` → `donaciones.referencia_pago` generada por el sistema en `donar_dinero`.
  - `C` → nombre del archivo del comprobante (`don/<facturaId>/C-XXXX-XXXX-XXXX.<ext>`).
- Número de factura: `FAC-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}` donde
  `seq` viene del RPC `factura_numero_siguiente()` = `nextval('factura_numero_seq')` (bigint,
  secuencia global que **no se reinicia por año**). Año = año UTC del servidor. `numero_factura` y
  `token_publico` tienen restricción `unique`. Si `seq` supera 999999 el número crece a 7 dígitos.
- Ids de texto generados en registro público: `'VOL' | 'MOT' | 'RES' + crypto.randomUUID().slice(0, 8)`
  (8 hex **minúsculas**, p. ej. `VOL3f9a1c2b`). El cliente puede mandar su propio `id` (`s(p.id, 40)`),
  que se acepta sin validar formato.
- Código de familia damnificada: `'FAM-' + crypto.randomUUID().slice(0, 8).toUpperCase()`; el
  honeypot devuelve el código falso `FAM-000000`.
- Consola admin (`admin_datos_crear`): `(def.prefijoId || 'REG') + crypto.randomUUID().slice(0, 8).toUpperCase()`.
- Marca de evidencias fotográficas: `marca = crypto.randomUUID().slice(0, 8)` (minúsculas) para que
  varias recogidas/entregas del mismo ciclo no colisionen.
- Salt del PIN: `crypto.randomUUID()`; `pin_hash = sha256Hex(pin_salt + pin)`.
- Clave admin: `sha256Hex(s(p.adminKey, 64))` comparada con `config.admin_key_hash`.
- PIN regenerado por admin: `String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)`
  → 6 dígitos entre `100000` y `999999`.

### 1.4 Geografía (`index.ts:73-90`)

- `geoValida(p)`: lee `p.lat` y `p.lng` con `Number()`. Válido solo si ambos son finitos y
  `-4 <= lat <= 13` y `-74 <= lng <= -59` (caja de Venezuela). Si no, devuelve
  `{ lat: null, lng: null }` **sin lanzar** (la acción decide si es error).
- Excepciones que **no** usan la caja de Venezuela: `ofrecer_insumo` (`|lat| <= 90 && |lng| <= 180`),
  `admin_crear_presupuesto` (`tiendaLat`/`tiendaLng`, mismo criterio ±90/±180) y
  `damnificado_registrar` (`gps.lat`/`gps.lng` con `n()` sin rango).
- `kmEntre(aLat, aLng, bLat, bLng)`: haversine con `R = 6371` km, resultado
  `Math.round(km * 10) / 10` (1 decimal). Es línea recta, no ruta de carretera.
- Los km del viaje se guardan en `viajes.km_tramo1` (paso 1 → paso 2) y `viajes.km_tramo2`
  (paso 2 → paso 3), columnas `numeric(7,1)`; el total se recalcula al entregar:
  `Math.round((km_tramo1 ?? 0 + km_tramo2 ?? 0) * 10) / 10`.

### 1.5 Enrutamiento, cubos y límites de tasa (`index.ts:31-49`, `index.ts:275-304`, `index.ts:893-923`)

Persistencia: tabla `rate_limit(ip text, cubo text, ventana timestamptz, contador int)` con PK
`(ip, cubo, ventana)`. RPC `rate_hit(p_ip, p_ventana, p_cubo, p_limite)` hace
`insert … on conflict (ip, cubo, ventana) do update set contador = contador + 1 returning contador <= p_limite`.
**El contador se incrementa siempre**, incluso cuando la acción luego falla por validación. Si el
RPC devuelve error, `rateHit` registra en consola y devuelve `true` (**fail-open**: la petición pasa).

Orden exacto en `handle()`:

1. Si `accion === 'cron_tasa'`: valida cabecera `x-cron-secret` (`s(…, 128)`) contra
   `config.cron_secret`; si falta la config o no coincide → `"no autorizado"`. Ejecuta
   `actualizarTasa()` y **no pasa por ningún cubo**.
2. Anti-ráfaga: `rateHitRafaga(ipDe(req), 12)` → cubo `burst`, ventana = segundo en curso
   (`Math.floor(Date.now()/1000)*1000`), límite **12 por segundo por IP**. Falla →
   `"Demasiadas solicitudes, baja el ritmo"` (429).
3. Clasificación:
   - `esPanel = accion.startsWith('panel_') && accion !== 'panel_crear'`
   - `esAdmin = accion.startsWith('admin_')`
   - `esLectura ∈ { listar_presupuestos, listar_comprados, listar_ofertas, acceso_perfil, denuncias_listar, reserva_detalle }`
   - `esDenuncia ∈ { denuncia_crear, denuncia_parcial }`
   - `esAdminLectura ∈ { admin_datos_entidades, admin_datos_listar, admin_datos_ficha }`
4. Cubos por hora (`ventanaActual()`):

| Cubo | Clave | Límite | Quién | Mensaje al superarlo |
|---|---|---|---|---|
| `burst` | IP | 12 / 1 s | todas menos `cron_tasa` | `"Demasiadas solicitudes, baja el ritmo"` |
| `publico` | IP | 30 / h | todo lo que no cae en otro cubo: `registrar_*`, `damnificado_registrar`, `donar_*`, `viaje_iniciar`, `registrar_recogida`, `registrar_entrega_final`, `ofrecer_insumo`, `recoger_oferta`, `reportar_persona`, **`panel_crear`** | `"Demasiadas solicitudes, intenta en una hora"` |
| `lectura` | IP | 240 / h | `listar_presupuestos`, `listar_comprados`, `listar_ofertas`, `acceso_perfil`, `denuncias_listar`, `reserva_detalle` | `"Demasiadas solicitudes, intenta en una hora"` |
| `denuncia` | IP | 400 / h | `denuncia_crear`, `denuncia_parcial` | `"Demasiadas solicitudes, intenta en una hora"` |
| `panel` | **token `CTR-…`** (no la IP) | 120 / h | `panel_ver`, `panel_actualizar_lugar`, `panel_insumo`, `panel_insumo_borrar` (dentro de `autenticarPanel`, después de validar el formato del token) | `"Demasiadas solicitudes del panel, intenta en una hora"` |
| `admin` | IP | 60 / h | todas las `admin_*` salvo las tres de lectura | `"Demasiadas solicitudes admin, intenta en una hora"` |
| `admin_lectura` | IP | 600 / h | `admin_datos_entidades`, `admin_datos_listar`, `admin_datos_ficha` | `"Demasiadas solicitudes admin, intenta en una hora"` |
| `admin_fallos` | IP | 10 / h (se **lee** `contador >= 10` para bloquear; se **escribe** con límite `999999` en cada clave incorrecta) | `autenticarAdmin` | `"Demasiadas claves incorrectas, espera una hora"` |

Las acciones `panel_*` (salvo `panel_crear`) **no** consumen cubo por IP; las `admin_*` **no**
consumen `publico`. Todas consumen `burst`.

### 1.6 Autenticación por clase (`index.ts:117-133`, `index.ts:225-238`, `index.ts:275-304`)

**anon**: sin credencial. Solo protege el rate-limit.

**sesión (JWT de Supabase Auth)** — `exigirSesion(p)`:

1. `jwt = s(p.accessToken, 4000)`; vacío → `"Entra con tu cuenta para reservar este trabajo"`.
2. `identidadSesion(jwt)`: `supa.auth.getUser(jwt)`; si hay error o el usuario no tiene correo →
   `"Sesión inválida o vencida, vuelve a pedir un código"`. `email = user.email.toLowerCase()`.
3. Resolución del rol, **en este orden y con el primero que coincida** (`.eq('email', email).limit(1)`):
   1. `motorizados` → `{ rol: 'transportista', nombre: motorizado.nombre || '' }`
   2. `voluntarios` → `{ rol: 'voluntario', nombre: \`${nombre} ${apellido || ''}\`.trim() }`
   3. `centros_panel` (join `lugares(nombre)`) → `{ rol: 'centro', nombre: lugares.nombre || 'Centro' }`
   4. ninguno → `{ rol: 'donante', nombre: email.split('@')[0] }`
4. El correo **nunca** se toma del cuerpo; solo del JWT.

`acceso_perfil`, `denuncia_parcial` y `denuncia_crear` leen el JWT directamente
(`s(p.accessToken, 4000)`) y, si está vacío, lanzan `"sesión requerida"` en lugar del mensaje de
`exigirSesion`; luego usan `identidadSesion` (mismo mensaje de sesión inválida).

Las acciones con sesión toman el nombre del actor como
`nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email`.

**Auth del frontend** (`api.js:279-311`): `POST /auth/v1/signup {email, password}`,
`POST /auth/v1/token?grant_type=password {email, password}`,
`POST /auth/v1/token?grant_type=refresh_token {refresh_token}`; cabeceras `apikey` +
`Content-Type`. Errores: `data.msg || data.error_description || data.message || 'HTTP <status>'`.

**panel (token + PIN)** — `autenticarPanel(p)`:

1. `token = s(p.token, 24).toUpperCase()`, `pin = s(p.pin, 12)`.
2. Si el token no cumple `/^CTR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/` **o** `pin.length < 4` →
   `"Token o PIN inválido"`.
3. `rateHit(token, 'panel', 120)` → `"Demasiadas solicitudes del panel, intenta en una hora"`.
4. `centros_panel` por `token_centro` (`select id, lugar_id, pin_hash, pin_salt`); no existe →
   `"Token o PIN inválido"`.
5. `hashIguales(sha256Hex(pin_salt + pin), pin_hash)`; falla → `"Token o PIN inválido"`.
6. Devuelve `{ id, lugar_id, pin_hash, pin_salt }`; las acciones solo usan `lugar_id`.

**admin (adminKey)** — `autenticarAdmin(p, req, cubo, limite)`:

1. `rateHit(ip, cubo, limite)` → `"Demasiadas solicitudes admin, intenta en una hora"`.
2. Lee `rate_limit` donde `ip`, `cubo = 'admin_fallos'`, `ventana = ventanaActual()`; si
   `contador >= 10` → `"Demasiadas claves incorrectas, espera una hora"`.
3. Lee `config` clave `admin_key_hash`; si no existe o está vacía → `"Módulo admin no configurado"`
   (fail-closed, HTTP 401).
4. `hashIguales(sha256Hex(s(p.adminKey, 64)), valor)`; si no coincide: `rateHit(ip, 'admin_fallos', 999999)`
   y `"Clave admin incorrecta"` (401).

**cron**: cabecera `x-cron-secret` = `config.cron_secret` (ver 1.5).

### 1.7 Reserva del viaje y ciclo logístico (`index.ts:92-133`)

- `viajeVigente(facturaId)`: última fila de `viajes` con `factura_id = facturaId` **y `paso3_ts IS NULL`**,
  ordenada por `creado_at desc`, `limit 1`. Campos leídos: `id, email, eta_minutos, paso1_ts,
  resuelto, paso1_lat, paso1_lng, paso2_lat, paso2_lng, km_tramo1`. Devuelve `null` si no hay.
- `GRACIA_RESERVA_MIN = 60`.
- `reservaViva(facturaId)`:
  1. `v = viajeVigente(facturaId)`; si no hay o `v.resuelto === true` → `null`.
  2. `inicio = Date.parse(v.paso1_ts)`; si `paso1_ts` es nulo/inválido → `null`.
  3. `vence = inicio + ((Number(v.eta_minutos) || 0) + 60) * 60_000`.
  4. Devuelve `v` si `Date.now() < vence`, si no `null` (la reserva venció y el trabajo queda libre).
- `exigirDuenoReserva(facturaId, email)`: `v = reservaViva(...)`; sin reserva viva →
  `"Tu reserva venció; vuelve a reservarla"`; si `v.email` (minúsculas) ≠ `email` (minúsculas) →
  `"Este trabajo está reservado por otra persona"`. Devuelve `v`.
- Semántica: **la reserva es el permiso**. Solo quien reservó (fila `viajes` con su correo) puede
  registrar recogida y entrega. Una reserva vencida no borra la fila: `viajeVigente` sigue
  devolviéndola (su `paso3_ts` es nulo) y las actualizaciones de GPS/km del paso 2/3 caerían sobre
  ella si alguien la re-reserva... salvo que `viaje_iniciar` inserta una fila nueva (más reciente),
  que pasa a ser la vigente. El paso 3 (`paso3_ts`) cierra el viaje.
- `admin_viaje_resolver` pone `resuelto = true` → `reservaViva` devuelve `null` aunque el plazo
  no haya vencido (libera el trabajo), pero **no** cambia el estado de la factura.
  > **Divergencia deliberada en Firebase (Task 3.5, 2026-09-07).** El dueño de la reserva es el
  > `uid` del ID token, no el correo: el que guardaba `viajes.email` venía del cuerpo de la petición
  > y nadie lo verificaba, así que bastaba escribir la dirección de otra persona para quedarse con su
  > trabajo. Por eso `admin_viajes_atrasados` **no devuelve `email`** (devuelve `uid`; la consola ya
  > lo pintaba condicionalmente). El viaje vigente lo apunta `facturas.viajeVigenteId` en vez de
  > resolverse con «la última fila sin `paso3_ts`», así que dos reservas simultáneas chocan en un
  > documento y una se reintenta, en lugar de convivir y que gane la más reciente. `venceReserva` y
  > `venceAlerta` van precalculados en la fila: la vista `viajes_atrasados` pasa a ser una consulta
  > de dos campos. Y el paso 3 se sella **siempre**, con GPS o sin él, que es lo que este mismo
  > catálogo recomienda en `registrar_entrega_final`.

### 1.8 Archivos: fotos, video, adjuntos y comprobantes (`index.ts:135-207`; buckets en `vistas.sql`)

Buckets (`storage.buckets`): `comprobantes` (privado), `damnificados` (privado), `denuncias`
(privado), `presupuestos` (**público**), `registro-transportistas` (privado). Los privados solo se
sirven por URL firmada de **3600 s** generada por el backend (`createSignedUrl(ruta, 3600)`).
El tamaño se mide en **bytes decodificados** del base64 (`atob`).

| Función | Regex del dataURL | Tamaño | Bucket / `upsert` | Ruta | Devuelve | Errores (en orden) |
|---|---|---|---|---|---|---|
| `guardarFoto(dataUrl, carpeta, nombre, bucket = 'registro-transportistas', maxBytes = 1_800_000)` | `/^data:image\/(jpeg\|png\|webp);base64,([A-Za-z0-9+/=]+)$/` | `>= 1000` y `<= maxBytes` | bucket del parámetro; `upsert: false`; `contentType: image/<tipo>` | `${carpeta}/${nombre}.${ext}` con `ext = jpeg→jpg, png, webp` | **ruta** (no URL) | `` `foto de ${nombre} inválida (se espera imagen JPEG/PNG)` ``, `` `foto de ${nombre} vacía` ``, `` `foto de ${nombre} demasiado grande` ``, `` `no se pudo guardar la foto de ${nombre}` `` |
| `guardarVideo(dataUrl, carpeta, nombre, upsert = false)` | `/^data:video\/(webm\|mp4);base64,([A-Za-z0-9+/=]+)$/` | `>= 1000` y `<= 30_000_000` | `denuncias`; `upsert` según parámetro (las dos llamadas usan `true`); `contentType: video/<tipo>` | `${carpeta}/${nombre}.${webm\|mp4}` | ruta | `"video inválido (se espera webm o mp4)"`, `"video vacío"`, `"video demasiado grande"`, `"no se pudo guardar el video"` |
| `guardarAdjunto(dataUrl, carpeta, nombre)` | `/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/` (cualquier MIME) | `>= 100` y `<= 5_000_000` | `presupuestos` (público); `upsert: true`; `contentType` = el MIME solo si está en `{application/pdf, image/jpeg, image/png, image/webp}`, si no `application/octet-stream` (fuerza descarga, anti-XSS) | `${carpeta}/${nombre}.${ext}` con `ext` = `pdf/jpg/png/webp` según mapa, o el subtipo MIME sin caracteres no alfanuméricos recortado a 8, o `bin` | **URL pública** (`getPublicUrl`) | `"adjunto inválido"`, `"adjunto vacío"`, `"adjunto demasiado grande (máx 5 MB)"`, `"no se pudo guardar el adjunto"` |
| `guardarComprobante(dataUrl, carpeta, nombre)` | `/^data:(image\/(?:jpeg\|png\|webp)\|application\/pdf);base64,([A-Za-z0-9+/=]+)$/` | `>= 200` y `<= 5_000_000` | `comprobantes` (privado); `upsert: false`; `contentType` = el MIME | `${carpeta}/${nombre}.${pdf\|jpg\|png\|webp}` | ruta | `"comprobante inválido (se espera imagen JPEG/PNG o PDF)"`, `"comprobante vacío"`, `"comprobante demasiado grande (máx 5 MB)"`, `"no se pudo guardar el comprobante"` |

Rutas por acción (todas relativas al bucket):

| Acción | Bucket | Rutas |
|---|---|---|
| `registrar_voluntario` | registro-transportistas | `voluntarios/<id>/cedula.<ext>` |
| `registrar_motorizado` | registro-transportistas | `<id>/placa.<ext>`, `<id>/vehiculo.<ext>`, `<id>/cedula.<ext>` |
| `damnificado_registrar` | damnificados | `<codigo>/p<i>.<ext>` (i = índice en el array original, 0..11; máx 2 500 000 bytes) |
| `panel_crear` | registro-transportistas | `centros/<lugarId>/cedula.<ext>`, `centros/<lugarId>/sitio.<ext>` |
| `ofrecer_insumo` | registro-transportistas | `ofertas/<tokenDV>/insumo-<k>.<ext>` (k = 1..20) o `ofertas/<tokenDV>/insumo.<ext>`; `ofertas/<tokenDV>/cedula.<ext>`; `ofertas/<tokenDV>/lugar.<ext>` |
| `registrar_recogida` | registro-transportistas | `ciclo/<numero_factura>/recogida-sitio-<marca>.<ext>`, `…/recogida-insumo-<marca>.<ext>`, `…/recogida-persona-<marca>.<ext>` |
| `recoger_oferta` | registro-transportistas | `ofertas/<tokenDV>/recogida-sitio-<marca>.<ext>`, `…/recogida-insumo-<marca>.<ext>`, `…/recogida-persona-<marca>.<ext>` |
| `registrar_entrega_final` | registro-transportistas | `ciclo/<numero_factura>/entrega-centro-<marca>.<ext>`, `…/entrega-encargado-<marca>.<ext>` (también para ofertas) |
| `donar_dinero` | comprobantes | `don/<facturaId>/C-XXXX-XXXX-XXXX.<ext>` |
| `denuncia_parcial` / `denuncia_crear` | denuncias | `denuncias/<denunciaId>/video.<webm\|mp4>` (upsert) |
| `admin_crear_presupuesto` | presupuestos (público) | `presupuestos/<tokenDV>/presupuesto.<ext>` |
| `admin_presupuesto_transferido` | presupuestos (público) | `presupuestos/<tokenDV>/transferencias-<Date.now()>.<ext>` |
| `admin_presupuesto_comprado` | presupuestos (público) | `presupuestos/<tokenDV>/factura-compra-<Date.now()>.<ext>` |

Las subidas ocurren **antes** del `insert` de la fila; si el insert falla, el archivo queda huérfano
(sin limpieza en el legado).

### 1.9 `notificarTelegram(texto)` (`index.ts:209-223`)

- Lee `config` claves `telegram_bot_token` y `telegram_chat_id`. Si falta cualquiera → no hace nada
  (función «apagada»).
- `POST https://api.telegram.org/bot<token>/sendMessage` con JSON
  `{ chat_id, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }`. Cualquier
  excepción se ignora; **nunca** interrumpe la acción.
- Único mensaje existente (desde `donar_dinero`, al cubrir la meta):
  `` `✅ Se recaudó todo para <b>${m.insumo}</b> (${m.centro}). Toca transferir y comprar. Token: ${f.token_publico}` ``

### 1.10 `mov()` — movimientos codificados de la factura (`index.ts:240-245`)

`movimientos_factura.descripcion` guarda `JSON.stringify({ k: 'mov', c: <codigo>, ...datos })`
para que el cliente lo redacte en el idioma del usuario. Las filas antiguas y las de
`admin_registrar_movimiento` son texto plano y se muestran tal cual. Columnas de la fila:
`{ factura_id, tipo, descripcion, monto }` (`fecha` = `now()` por defecto).

| Código `c` | Claves de `datos` | `tipo` | `monto` | Acción emisora |
|---|---|---|---|---|
| `donacionRegistrada` | `cantidad` (número), `unidad` (texto), `insumo` (texto) | `Ingreso` | `cantidad` | `donar_necesidad` |
| `recepcionConfirmada` | `delta` (número), `unidad` | `Entrega` | `delta` | `registrarEntrega` ← `panel_insumo` |
| `necesidadCubierta` | — (`{}`) | `Entrega` | `0` | `registrarEntrega` ← `panel_insumo` |
| `dineroRecibido` | `referencia` (`REF-…`) | `Ingreso` | `montoBs` | `donar_dinero` |
| `metaCubierta` | `insumo`, `tienda` | `Recaudado` | `0` | `donar_dinero` |
| `viajeIniciado` | `nombre` (transportista), `eta` (minutos, entero) | `Viaje` | `0` | `viaje_iniciar` |
| `insumoRecogido` / `insumoRecogidoConNota` (con nota cuando `notas` no está vacío) | `nombre`, `tienda`, `direccion`, `notas`, `km` (solo si se calculó) | `Recogida` | `0` | `registrar_recogida` |
| `entregado` / `entregadoConCargo` (con cargo cuando `cargo` no está vacío) | `centro`, `receptor`, `cargo`, `km` (total, solo si se calculó) | `Entrega` | `0` | `registrar_entrega_final` |
| `donacionOfrecida` | `cantidad`, `unidad`, `insumo`, `ubicacion` | `Oferta` | `cantidad` | `ofrecer_insumo` |
| `donacionRecogida` | `nombre`, `ubicacion`, `centro` (destino), `km` (solo si se calculó) | `Recogida` | `0` | `recoger_oferta` |
| `denunciaRegistrada` | — | `Denuncia` | `0` | `denuncia_crear`, `admin_denuncia_crear` |
| `reabiertoPorAnulacion` | — | `Reapertura` | `0` | `admin_donacion_anular` |
| `transferidoABs` | — | `Transferencia` | `0` | `admin_presupuesto_transferido` |
| `compraConfirmada` | — | `Compra` | `0` | `admin_presupuesto_comprado` |

Valores posibles de `movimientos_factura.tipo`: `Ingreso`, `Egreso`, `Compra`, `Entrega`,
`Recaudado`, `Viaje`, `Recogida`, `Oferta`, `Denuncia`, `Reapertura`, `Transferencia`
(`Egreso` solo lo produce `admin_registrar_movimiento`). Los movimientos son **públicos** vía
`seguimiento_factura` (sección 3): nada de lo que se ponga en `datos` debe identificar al donante.

### 1.11 `historial()` — bitácora pública por centro (`index.ts:247-249`)

`historial(lugar, insumo, descripcion, origen, cantidad = 0)` inserta en `historial_movimientos`
`{ lugar, insumo, descripcion, origen, cantidad }` (`fecha = now()`). `origen ∈ { 'publico', 'panel', 'admin' }`.
`lugar` es el **nombre** del centro (texto, no id), o `'Administración'` / `'Donaciones ofrecidas'`.
Es texto en español fijo (no se codifica). Se lee públicamente por `historial_public` filtrando por
`lugar`. Todas las entradas se listan en el catálogo de cada acción; no hay ninguna otra.

### 1.12 `auditar()` — bitácora del admin (`index.ts:879-891`)

`auditar(req, accion, entidad, filaId, antes, despues)` inserta en `auditoria_admin`
`{ ip: ipDe(req), accion, entidad, fila_id: String(filaId ?? ''), antes: antes ?? null, despues: despues ?? null }`
(`fecha = now()`). Si el insert falla **solo se registra en consola**; la acción no se revierte.
`accion ∈ { 'crear', 'editar', 'deshacer', 'borrar' }`. Solo lo llaman las acciones
`admin_datos_crear`, `admin_datos_editar`, `admin_datos_deshacer`, `admin_datos_borrar`. Lo consume
`admin_bitacora` y `admin_datos_deshacer`.

### 1.13 Lugares e insumos compartidos (`index.ts:251-273`, `index.ts:467-480`)

- `obtenerOCrearLugar(p)`:
  1. `nombre = s(p.nombre, 120)`; vacío → `"nombre requerido"`.
  2. Busca `lugares` por `nombre` exacto (sensible a mayúsculas y acentos). Si existe devuelve
     `{ id }` **sin modificar nada** (evita que un anónimo sobrescriba teléfono/ubicación de un
     hospital ya listado).
  3. Si no existe inserta `{ tipo: s(p.tipo, 40) || 'Centro', nombre, ubicacion: s(p.ubicacion, 300),
     telefono: s(p.telefono, 40), actualizado: now }` + `lat`/`lng` solo si `geoValida(p)` es válida.
     **`tipo` no se valida** contra la lista (cualquier texto ≤ 40).
  4. Error de inserción (p. ej. carrera sobre `lugares.nombre unique`) se propaga tal cual.
- `nombreDeLugar(id)` → `lugares.nombre` o `''`.
- `verPanel(lugarId)` → `{ lugar: { id, tipo, nombre, ubicacion, telefono, lat, lng, actualizado },
  insumos: [{ id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad }] }`
  (insumos ordenados por `nombre` asc; si el lugar no existe se propaga el error de PostgREST).
- Restricciones de esquema relevantes: `lugares.nombre unique`; `insumos (lugar_id, nombre) unique`;
  `insumos.estado check in ('Necesita','Disponible','Cubierto')`; valores por defecto de `insumos`:
  `categoria 'General'`, `estado 'Necesita'`, `cantidad_necesaria 1`, `cantidad_recibida 0`,
  `urgencia 'Normal'`, `unidad 'unidades'`; `lugares.tipo` por defecto `'Centro'`.
- Borrar un lugar borra en cascada sus `insumos` y su `centros_panel` (FK `on delete cascade`).

### 1.14 Facturas: tipos, metadatos JSON y vistas de salida (`index.ts:306-425`)

Una **factura** (`facturas`) es el hilo público de trazabilidad. Columnas:
`id, numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado (numeric, default 0),
estado (default 'Abierta'), fecha_creacion, fecha_cierre, archivado_at`. Hay cuatro «sabores»,
distinguidos por el contenido de `descripcion`:

| Sabor | `objetivo` | `descripcion` | `monto_requerido` | Estado inicial | Creada por |
|---|---|---|---|---|---|
| Necesidad | `objetivoNecesidad(insumo, centro)` = `` `${insumo} → ${centro}` `` (flecha U+2192 con espacios) | texto `` `Necesidad publicada por ${centro}` `` | `max(cantidad_necesaria, cantidad donada)` (unidades, no dinero) | `Abierta` | `donar_necesidad` (reutiliza la `Abierta` existente del mismo objetivo) |
| Presupuesto | `s(\`${insumo} → ${centro} · ${tienda}\`, 200)` | JSON `metaPresupuesto` (abajo) | `precio` en Bs | `Abierta` | `admin_crear_presupuesto` |
| Oferta | `s(\`Oferta: ${insumo} (${ubicacion})\`, 200)` | JSON `metaOferta` (abajo) | `cantidad` | `Ofrecida` | `ofrecer_insumo` |
| Manual | libre (`s(p.objetivo, 200)`) | `s(p.descripcion, 500)` | `montoRequerido` | `Abierta` | `admin_crear_factura` |

- `facturaAbiertaDe(objetivo)`: primera `facturas` con `objetivo` igual y `estado = 'Abierta'`,
  ordenada por `fecha_creacion` asc (`select id, numero_factura, token_publico`).
- `facturaDeNecesidad(objetivo, descripcion, montoRequerido)`: devuelve la abierta o crea una nueva
  (`factura_numero_siguiente` + `tokenAlfa('DV')`). No hay restricción única por `objetivo`: dos
  peticiones concurrentes pueden crear dos facturas abiertas para la misma necesidad.
- `registrarEntrega(centro, insumo, unidad, delta, recibida, necesaria)` (llamada solo por
  `panel_insumo`): busca la factura abierta de `objetivoNecesidad(insumo, centro)`; si no hay, nada.
  Si `delta > 0` inserta movimiento `recepcionConfirmada` (tipo `Entrega`, monto `delta`). Si
  `necesaria > 0 && recibida >= necesaria` inserta `necesidadCubierta` y **cierra** la factura
  (`estado 'Cerrada'`, `fecha_cierre = now`).
- `facturaPor(p)` (acciones admin): `token = s(p.token, 24).toUpperCase()`,
  `numero = s(p.numeroFactura, 24).toUpperCase()`; busca por `token_publico` si hay token, si no
  por `numero_factura`; ninguno → `"token o numeroFactura requerido"`; sin fila →
  `"Factura no encontrada"`. Devuelve `{ id, numero_factura, token_publico, estado }`.
- **`metaPresupuesto(descripcion)`**: `JSON.parse`; devuelve el objeto solo si `o.k === 'pres'`,
  si no `null`. Forma escrita por `admin_crear_presupuesto` (orden de claves exacto, porque las
  listas filtran con `like '{"k":"pres"%'`):
  ```json
  { "k": "pres", "moneda": "VES", "centro": "…", "insumo": "…", "tienda": "…", "direccion": "…",
    "cantidad": 0, "presentacion": "…", "necesidadId": "…"|null, "tiendaLat": 0, "tiendaLng": 0,
    "tiendaUrl": "https://…"|null, "adjunto": "https://<url pública>"|null }
  ```
- **`metaOferta(descripcion)`**: igual con `o.k === 'oferta'`. Forma escrita por `ofrecer_insumo`
  (filtro `like '{"k":"oferta"%'`):
  ```json
  { "k": "oferta", "insumo": "…", "cantidad": 0, "unidad": "unidades", "ubicacion": "…",
    "telefono": "…", "nombreDonante": "…", "zona": "…", "fotoInsumo": "<ruta>", "fotos": ["<ruta>"],
    "fotoCedula": "<ruta>|''", "fotoLugar": "<ruta>|''", "coords": {"lat": 0, "lng": 0}|null, "centro": "…" }
  ```
- **`presupuestoUI(f)`** (público): `null` si no es presupuesto; si no
  `{ token: f.token_publico, objetivo: f.objetivo, estado: f.estado, centro: m.centro, insumo: m.insumo,
  tienda: m.tienda, direccion: m.direccion, cantidad: m.cantidad, presentacion: m.presentacion,
  moneda: m.moneda || 'VES', precio: Number(f.monto_requerido) || 0, recaudado: Number(f.monto_recaudado) || 0 }`.
  **No** expone `necesidadId`, `tiendaLat/Lng`, `tiendaUrl` ni `adjunto` (aunque la `descripcion`
  completa sí sale por `seguimiento_factura`).
- **`ofertaUI(f)`** (privada, solo para el dueño de la reserva):
  `{ token, estado, insumo, cantidad, unidad, ubicacion, telefono, nombreDonante, centro, zona: m.zona || '', coords: m.coords ?? null }`.
- **`ofertaPublicaUI(f)`** (pública): `{ token, estado, insumo, cantidad, unidad, zona: m.zona || '', centro,
  coordsAprox }` donde `coordsAprox = { lat: Math.round(lat*100)/100, lng: Math.round(lng*100)/100 }`
  si `coords` tiene números finitos, si no `null` (≈1 km de precisión; sin nombre, teléfono ni
  dirección).
- **Fuga a tener en cuenta**: `seguimiento_factura(tok)` devuelve `descripcion` íntegra, así que con
  el token de una oferta cualquiera ve `telefono`, `nombreDonante`, `ubicacion` y `coords`. Firebase
  debería guardar el contacto fuera del documento público.
  > **Divergencia deliberada en Firebase (Task 3.4, 2026-09-07).** El sabor ya no se deduce de
  > `descripcion`: es la columna `tipo`, y los campos del JSON viven en `meta`. El contacto de una
  > oferta (`telefono`, `nombreDonante`, `ubicacion` exacta, `coords` finas y las fotos) está en
  > **otra colección**, `facturasContacto/{facturaId}`, que las reglas deniegan y ninguna función de
  > proyección puede alcanzar; su única salida es `reserva_detalle`. Lo público es la **zona**,
  > también en el movimiento `donacionOfrecida`. Y `presupuestoUI.adjunto` ya no es una URL pública:
  > los archivos del ciclo de compra son rutas privadas de Storage y solo se abren firmados, porque
  > en Firebase no hay bucket público.

### 1.15 Máquina de estados de `facturas`

Estados: `Abierta`, `PorComprar`, `Transferida`, `Comprada`, `EnTransito`, `Entregada`,
`Ofrecida`, `EnCamino`, `Recogida`, `Cerrada`.

| Desde | Hacia | Acción | Condición / efecto adicional |
|---|---|---|---|
| (inserción) | `Abierta` | `donar_necesidad`, `admin_crear_presupuesto`, `admin_crear_factura` | valor por defecto de la columna |
| (inserción) | `Ofrecida` | `ofrecer_insumo` | explícito |
| `Abierta` | `PorComprar` | `donar_dinero` | tras la donación, `monto_recaudado >= monto_requerido` **y** `estado === 'Abierta'`; añade `metaCubierta` y Telegram |
| `PorComprar` | `Transferida` | `admin_presupuesto_transferido` | exige `estado === 'PorComprar'`; evidencia pública + `transferidoABs` |
| `PorComprar` \| `Transferida` | `Comprada` | `admin_presupuesto_comprado` | evidencia pública + `compraConfirmada` |
| `PorComprar` \| `Transferida` | `Abierta` | `admin_donacion_anular` | si tras anular `monto_recaudado < monto_requerido`; añade `reabiertoPorAnulacion` |
| `Comprada` | (sin cambio) | `viaje_iniciar` (presupuesto) | exige `Comprada`; crea la reserva |
| `Comprada` | `EnTransito` | `registrar_recogida` | exige `Comprada` + dueño de reserva |
| `EnTransito` | `Entregada` | `registrar_entrega_final` (presupuesto) | exige `EnTransito` + dueño; `fecha_cierre = now` |
| `Ofrecida` | `EnCamino` | `viaje_iniciar` (oferta) | exige `Ofrecida` |
| `Ofrecida` \| `EnCamino` | `Recogida` | `recoger_oferta` | exige dueño de reserva; **sin** `fecha_cierre` |
| `Recogida` | `Entregada` | `registrar_entrega_final` (oferta) | exige `Recogida` + dueño; `fecha_cierre = now` |
| `Abierta` (necesidad) | `Cerrada` | `panel_insumo` → `registrarEntrega` | `recibida >= necesaria`; `fecha_cierre = now` |
| cualquiera | `Cerrada` | `admin_cerrar_factura` | sin comprobación de estado; `fecha_cierre = now` |

Estados terminales: `Entregada`, `Cerrada`. `donar_dinero` solo acepta `Abierta`. Ninguna acción
vuelve de `Comprada`/`EnTransito`/`EnCamino`/`Recogida` hacia atrás; una oferta `EnCamino` cuya
reserva venció queda bloqueada en el legado (`viaje_iniciar` exige `Ofrecida` y `recoger_oferta`
exige reserva viva) — Firebase puede permitir re-reservar una `EnCamino` sin reserva viva.

### 1.16 Estados de `donaciones`, `denuncias`, `familias_damnificadas`, `vacantes`, `personas`

- `donaciones.estado`: `Registrada` (por defecto; `donar_necesidad`, `admin_registrar_donacion`),
  `Confirmada` (`donar_dinero`, `admin_registrar_donacion` opcional), `Anulada`
  (`admin_donacion_anular`). Disparador `trg_recalcular_recaudado` (after insert/update/delete):
  `facturas.monto_recaudado = coalesce(sum(monto) where factura_id = X and estado = 'Confirmada', 0)`.
  **Solo suman las `Confirmada`**; una necesidad con donaciones `Registrada` mantiene
  `monto_recaudado = 0` (y `porcentaje = 0` en `seguimiento_factura`). Firebase no tiene disparador:
  cada escritura de `donaciones` debe recalcular la suma en la misma transacción.
- `denuncias.estado`: `Recibida` (por defecto) → `En revisión` → `Atendida` (solo
  `admin_denuncia_estado`; cualquier valor fuera de la lista se convierte en `Recibida`).
  `denuncias.tipo`: `Retención de insumos` | `Otro`. `denuncias.origen`: `usuario` | `admin`.
- `familias_damnificadas.estado`: `nuevo` (por defecto) | `contactado` | `atendido`
  (`admin_damnificado_estado`; fuera de lista → `nuevo`).
- `vacantes_voluntarios.estado`: `Abierta` (por defecto) | `Cubierta` | `Cerrada`;
  `lugar_tipo ∈ {Centro, Hospital, Refugio, Zona de derrumbe}`; `urgencia ∈ {Alta, Normal, Baja}`;
  checks: `cantidad_necesaria > 0`, `cantidad_cubierta >= 0`.
- `personas.verificada`: `false` al reportar; `true` con `admin_verificar_persona` o consola.
- `insumos.estado`: `Necesita` | `Disponible` | `Cubierto`; `urgencia`: `Alta` | `Normal` | `Baja`.
- `lugares.tipo`: `Centro` | `Hospital` | `Refugio` (validado en panel/consola; libre en `registrar_lugar`).

### 1.17 Tasa de cambio USD→Bs (`index.ts:426-465`)

- `tasaActual()`: última fila de `tasas` por `capturado_en desc` → `{ efectiva: Number(efectiva),
  diaria: Number(diaria) || Number(efectiva), fuente: String(fuente), fecha: String(capturado_en) }`
  o `null` si la tabla está vacía.
- `tasaPlausible(x)`: `x !== null && x > 200 && x < 5000`.
- `actualizarTasa()` (solo `cron_tasa`):
  1. `GET https://www.remitly.com/us/en/currency-converter/usd-to-ves-rate` con
     `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36`; del HTML extrae
     `efectiva` con `/"effectiveRateAsLowAs"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/` y `diaria` con
     `/"everydayRateAsLowAs"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/`; `fuente = 'remitly'`. Excepciones
     de red se tragan.
  2. Si `efectiva` no es plausible: `GET https://ve.dolarapi.com/v1/dolares/oficial` (mismo UA),
     `efectiva = Number(json.promedio) || null`, `diaria = efectiva`, `fuente = 'bcv'`. Si sigue sin
     ser plausible → `"no se pudo obtener la tasa"`.
  3. Si `diaria` no es plausible → `diaria = efectiva`.
  4. `insert tasas { fuente, efectiva, diaria }` (`capturado_en = now()`); devuelve
     `{ fuente, efectiva, diaria }`.
- La tabla `tasas` está revocada para `anon`; el navegador solo ve la tasa dentro de
  `listar_presupuestos.tasa` y en la respuesta de `donar_dinero`.

### 1.18 Consola de datos del admin: lista blanca `ENTIDADES` (`index.ts:482-717`)

Todo lo que las acciones `admin_datos_*` pueden listar, crear, editar o borrar está declarado aquí.
Una columna ausente de `editables` **no se puede tocar desde la web** (se rechaza, no se ignora).

Tipos de columna (`ColTipo`): `texto`, `entero`, `numero`, `booleano`, `email`, `telefono`, `lat`,
`lng`, `opcion`, `refLugar`. Cada `ColDef` = `{ id, tipo, max?, opciones?, requerido?, minNum?, maxNum? }`.

Definición por entidad (`tabla`, `pk`, `pkTexto`/`prefijoId`, `etiqueta` = columna humana,
`orden`/`ordenAsc`, `lectura` = columnas devueltas, `editables`, `buscar` = columnas del `ilike`,
`borrado` (siempre `'fisico'`), `naturales` = claves naturales para detectar duplicados,
`fotos` = columnas con ruta de foto privada, `hijos` = dependientes al borrar):

**`lugares`** — tabla `lugares`, pk `id` (numérico), etiqueta `nombre`, orden `nombre` asc.
- lectura: `id, tipo, nombre, ubicacion, telefono, lat, lng, actualizado`
- editables: `tipo` opcion `['Centro','Hospital','Refugio']` requerido · `nombre` texto max 120
  requerido · `ubicacion` texto max 300 · `telefono` telefono max 40 · `lat` lat · `lng` lng
- buscar: `nombre, ubicacion, telefono` · naturales: `[nombre]` norma `texto` · fotos: ninguna
- hijos: `insumos` (fk `lugar_id`, etiqueta `insumos`, modo `cascade`), `centros_panel`
  (fk `lugar_id`, etiqueta `accesos de panel`, modo `cascade`)

**`insumos`** — tabla `insumos`, pk `id`, etiqueta `nombre`, orden `nombre` asc.
- lectura: `id, lugar_id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad, actualizado`
- editables: `lugar_id` refLugar requerido · `nombre` texto 120 requerido · `categoria` texto 60 ·
  `estado` opcion `['Necesita','Disponible','Cubierto']` requerido · `cantidad_necesaria` numero
  min 0 max 1_000_000 · `cantidad_recibida` numero min 0 max 1_000_000 · `urgencia` opcion
  `['Alta','Normal','Baja']` requerido · `unidad` texto 30
- buscar: `nombre, categoria` · naturales: `[lugar_id, nombre]` texto · fotos: ninguna · hijos: ninguno

**`voluntarios`** — tabla `voluntarios`, pk `id` **texto**, prefijo `VOL`, etiqueta `nombre`,
orden `fecha_registro` desc.
- lectura: `id, nombre, apellido, email, telefono, estado, ciudad, profesion, disponibilidad, medio_transporte, observaciones, foto_cedula, fecha_registro`
- editables: `nombre` texto 120 requerido · `apellido` texto 120 · `email` email 254 · `telefono`
  telefono 40 · `estado` texto 60 · `ciudad` texto 80 · `profesion` texto 80 · `disponibilidad`
  texto 120 · `medio_transporte` texto 60 · `observaciones` texto 500
- buscar: `nombre, apellido, email, telefono, ciudad`
- naturales: `[email]` email · `[telefono]` digitos · `[nombre, apellido]` texto
- fotos: `foto_cedula` (bucket `registro-transportistas`) · hijos: ninguno

**`motorizados`** — tabla `motorizados`, pk `id` texto, prefijo `MOT`, etiqueta `nombre`, orden
`fecha_registro` desc.
- lectura: `id, nombre, tipo_vehiculo, telefono, zona_operacion, placa, email, foto_placa, foto_vehiculo, foto_cedula, fecha_registro`
- editables: `nombre` texto 120 requerido · `tipo_vehiculo` opcion
  `['Moto','Carro','Bicicleta','Camión','Triciclo motorizado']` requerido · `telefono` telefono 40 ·
  `zona_operacion` texto 120 · `placa` texto 20 · `email` email 254
- buscar: `nombre, placa, telefono, email, zona_operacion`
- naturales: `[email]` email · `[telefono]` digitos · `[placa]` texto
- fotos: `foto_placa`, `foto_vehiculo`, `foto_cedula` (todas `registro-transportistas`)
- hijos: `trayectos` (fk `motorizado_id`, etiqueta `trayectos`, modo `null`),
  `donaciones_motorizados` (fk `motorizado_id`, etiqueta `aportes recibidos`, modo `null`)

**`rescatistas`** — tabla `rescatistas`, pk `id` texto, prefijo `RES`, etiqueta `nombre`, orden
`fecha_registro` desc.
- lectura: `id, nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones, fecha_registro`
- editables: `nombre` texto 120 requerido · `organizacion` texto 120 · `telefono` telefono 40 ·
  `especialidad` texto 80 · `estado` texto 60 · `ciudad` texto 80 · `disponibilidad` texto 120 ·
  `equipo_disponible` texto 300 · `capacidad_operativa` texto 120 · `observaciones` texto 500
- buscar: `nombre, organizacion, telefono, ciudad, especialidad`
- naturales: `[telefono]` digitos · `[nombre, organizacion]` texto · fotos: ninguna · hijos: ninguno

**`centros_panel`** — tabla `centros_panel`, pk `id` numérico, etiqueta `token_centro`, orden
`creado` desc.
- lectura: `id, lugar_id, token_centro, email, foto_cedula, foto_sitio, creado` (**nunca**
  `pin_hash` ni `pin_salt`; `token_centro` se lee pero no se edita)
- editables: solo `email` email 254
- buscar: `token_centro, email` · naturales: ninguna
- fotos: `foto_cedula`, `foto_sitio` (`registro-transportistas`) · hijos: ninguno

**`vacantes_voluntarios`** — tabla `vacantes_voluntarios`, pk `id`, etiqueta `rol`, orden
`fecha_creacion` desc.
- lectura: `id, lugar_tipo, lugar_nombre, ubicacion, rol, descripcion, cantidad_necesaria, cantidad_cubierta, urgencia, turno, telefono, estado, fecha_creacion`
- editables: `lugar_tipo` opcion `['Centro','Hospital','Refugio','Zona de derrumbe']` requerido ·
  `lugar_nombre` texto 120 requerido · `ubicacion` texto 160 · `rol` texto 80 requerido ·
  `descripcion` texto 400 · `cantidad_necesaria` numero min 1 max 10_000 · `cantidad_cubierta`
  numero min 0 max 10_000 · `urgencia` opcion `['Alta','Normal','Baja']` requerido · `turno` texto
  80 · `telefono` telefono 40 · `estado` opcion `['Abierta','Cubierta','Cerrada']` requerido
- buscar: `lugar_nombre, rol, ubicacion` · naturales: `[lugar_nombre, rol]` texto · fotos: ninguna · hijos: ninguno

**`personas`** — tabla `personas`, pk `id`, etiqueta `nombre`, orden `fecha` desc.
- lectura: `id, nombre, cedula, estado, ubicacion, contacto, fuente, reportado_por, verificada, fecha`
- editables: `nombre` texto 160 requerido · `cedula` texto 20 · `estado` texto 120 · `ubicacion`
  texto 200 · `contacto` texto 120 · `fuente` texto 120 · `reportado_por` texto 120 · `verificada` booleano
- buscar: `nombre, cedula, ubicacion, contacto` · naturales: `[cedula]` digitos · `[nombre]` texto ·
  fotos: ninguna · hijos: ninguno

Entidades **fuera** de la consola (no editables desde la web): `facturas`, `donaciones`,
`movimientos_factura`, `evidencias`, `viajes`, `trayectos`, `donaciones_motorizados`,
`historial_movimientos`, `familias_damnificadas`, `denuncias`, `tasas`, `config`, `rate_limit`,
`auditoria_admin`, `entregas`.

Helpers de la consola (`index.ts:719-877`):

- `entidadDe(nombre)`: `ENTIDADES[s(nombre, 40)]`; no existe → `"Ese dato no se puede editar desde aquí"`.
- `sinAcentos(x)`: `x.normalize('NFD').replace(/[̀-ͯ]/g, '')` (quita las marcas diacríticas combinantes).
- `normaClave(valor, norma)`: `v = String(valor ?? '').trim()`; vacío → `''`; `digitos` →
  `v.replace(/[^0-9]/g, '')`; `email` → `v.toLowerCase()`; `texto` →
  `sinAcentos(v.toLowerCase()).replace(/\s+/g, ' ')`. Así «José Pérez» ≡ «jose perez  » y
  «0412-000 00 00» ≡ «04120000000».
- `idDe(def, id)`: `def.pkTexto ? s(id, 60) : Math.round(n(id))`.
- `filaPorId(def, id)`: `select <def.lectura>` donde `pk = idDe(...)`, `maybeSingle` → fila o `null`.
- `dependientesDe(def, id)`: para cada hijo, `count exact` de filas con `fk = idDe(...)`; devuelve
  `[{ etiqueta, cuantos, modo }]` solo con `cuantos > 0`.
- `fotosFirmadas(def, fila)`: para cada `FotoDef` con ruta no vacía, URL firmada 3600 s →
  `[{ campo, url }]` (se omiten las que fallan).
- `mensajeDePostgres(err)`: `23505` → `"Ya existe un registro con ese valor único"`; `23503` →
  `"Ese registro está enlazado con otro y no se puede guardar así"`; `23502` →
  `"Falta un campo obligatorio"`; otro → `s(err.message, 200) || 'No se pudo guardar'`.
- `valorValidado(col, crudo)` (lanza nombrando la columna):
  - `booleano` → `crudo === true || crudo === 'true'`.
  - `entero` / `numero` → `x = n(crudo)`; `x < minNum` → `` `${id}: el mínimo es ${minNum}` ``;
    `x > maxNum` → `` `${id}: el máximo es ${maxNum}` ``; entero se redondea.
  - `lat` / `lng` → `''`/`null`/`undefined` → `null`; si no, `Number(crudo)` debe ser finito y
    estar en `[-4, 13]` (lat) o `[-74, -59]` (lng), si no
    `` `${id}: esa coordenada cae fuera de Venezuela` ``.
  - `email` → `s(crudo, 254)`; vacío → `null`; `emailNorm` inválido →
    `` `${id}: correo electrónico inválido` ``.
  - `telefono` → `s(crudo, max ?? 40)`; si no está vacío y tiene menos de 7 dígitos →
    `` `${id}: teléfono demasiado corto` ``.
  - `opcion` → `s(crudo, 60)` debe estar en `opciones`, si no `` `${id}: ese valor no está permitido` ``
    (un valor ausente `''` también falla: en la práctica toda columna `opcion` es obligatoria al crear).
  - `refLugar` → `Math.round(n(crudo))`; `<= 0` → `` `${id}: hay que elegir un centro` ``.
  - `texto` → `s(crudo, max ?? 300)`.
- `camposValidados(def, crudos, parcial)`:
  1. Cualquier clave de `crudos` que no esté en `editables` →
     `` `Ese dato no se puede editar desde aquí: ${k}` ``.
  2. Para cada `ColDef`: si `parcial && !presente` se salta; si no, `valorValidado(col, presente ? valor : '')`.
     Con `parcial = false` (crear) las columnas ausentes se evalúan con `''` (→ `texto` `''`,
     `numero` `0` — ojo: `vacantes.cantidad_necesaria` min 1 falla si se omite —, `lat` `null`…).
  3. `requerido` y valor `''`/`null`/`undefined` → `` `${id}: es obligatorio` ``.
  4. `refLugar`: comprueba que exista `lugares.id`; si no → `` `${id}: ese centro no existe` ``.
  5. Sin ninguna columna resultante → `"No hay nada que guardar"`.
- `duplicadosDe(def, datos, excluirId)`: si no hay `naturales` → `[]`. Lee **las primeras 2000
  filas** de la tabla (`select pk, etiqueta, columnas naturales`, sin orden) y compara en memoria:
  para cada clave natural cuyas partes normalizadas estén todas no vacías, busca filas (excluyendo
  `excluirId`) con la misma tupla normalizada. Devuelve `[{ id, etiqueta: String(fila[etiqueta] ?? id), porque: campos.join(' + ') }]`
  sin repetir ids. **Informa, no bloquea** (el cliente reenvía con `forzar: true`).

### 1.19 Otras funciones auxiliares

- `s(p.tipo, 40) === 'Retención de insumos' ? 'Retención de insumos' : 'Otro'` — normalización del
  tipo de denuncia (`denuncia_parcial`, `denuncia_crear`).
- `duracion = Math.max(0, Math.min(600, Math.round(n(p.duracionS))))` — duración del video (0..600 s).
- `prec = Number(p.gps?.precision)`; se guarda `gps_precision = Number.isFinite(prec) ? prec : null`.
- Vista `viajes_atrasados` (`vistas.sql`): filas de `viajes` con `resuelto = false`, `paso3_ts is null`,
  no archivadas, y (`paso2_ts is null and now() > paso1_ts + (eta_minutos + 120) min`) **o**
  (`paso2_ts is not null and now() > paso2_ts + 2 h`). Columnas: `id, factura_id, transportista,
  email, eta_minutos, paso1_ts, paso2_ts, token_publico, objetivo, tramo (1 si paso2_ts es nulo,
  si no 2), transcurrido_min = floor(minutos desde coalesce(paso2_ts, paso1_ts))`.
- Vista `denuncias_public`: `id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado`
  de `denuncias` no archivadas (sin correo, nombre, rol, texto ni precisión GPS).

---

## 2. Catálogo de acciones

Orden = orden del `switch` (`index.ts:925-2161`). `cron_tasa` se atiende antes del `switch`
(`index.ts:896-901`) y se documenta al final. En «Entrada», «Req.» = obligatorio; «Por defecto» es el
valor efectivo cuando el campo falta o no pasa la validación blanda. Salvo indicación, los textos se
sanean con `s(campo, límite)`.

### registrar_lugar (`index.ts:926-938`)

- **Auth:** anon; **Cubo:** `publico` (30/h por IP).
- **Entrada:**

| Campo | Tipo | Límite / regex | Req. | Por defecto |
|---|---|---|---|---|
| `nombre` | texto | 120 | sí | — |
| `tipo` | texto | 40 (**sin** lista de opciones) | no | `'Centro'` |
| `ubicacion` | texto | 300 | no | `''` |
| `telefono` | texto | 40 | no | `''` |
| `lat`, `lng` | número | `geoValida` (−4..13 / −74..−59) | no | no se guardan si inválidos |
| `insumo` | texto | 120 | no | si vacío, no se toca `insumos` |
| `categoria` | texto | 60 | no | `'General'` |
| `estado` | opción | `Necesita` \| `Disponible` \| `Cubierto` | no | `'Necesita'` |

- **Validaciones:**
  1. `nombre` vacío → `"nombre requerido"` (desde `obtenerOCrearLugar`).
- **Efectos:**
  1. `obtenerOCrearLugar(p)` (1.13): lee `lugares` por `nombre`; si no existe, inserta
     `{ tipo, nombre, ubicacion, telefono, actualizado: now, lat?, lng? }`; si existe **no modifica nada**.
  2. Si `insumo` no está vacío: `upsert insumos { lugar_id, nombre: insumo, categoria, estado, actualizado: now }`
     con `onConflict: 'lugar_id,nombre'` (sobrescribe `categoria`, `estado` y `actualizado` del
     insumo existente; conserva `cantidad_necesaria`, `cantidad_recibida`, `urgencia`, `unidad`, o
     aplica los valores por defecto si es nuevo).
  3. `historial(s(p.nombre, 120), insumo, \`Reporte: ${insumo} (${estado})\`, 'publico', 0)` (solo si hubo insumo).
- **Respuesta:** `{}`.
- **Notas:** cualquiera puede añadir un insumo o cambiar el `estado` de un insumo en **cualquier**
  centro existente conociendo su nombre. Dos altas concurrentes del mismo nombre producen una
  violación de `lugares.nombre unique` cuyo mensaje crudo se devuelve al cliente; Firebase debe
  usar el nombre como clave de documento o una transacción. Cuando el lugar ya existe, su
  `actualizado` no cambia (solo cambia el del insumo).
- **Divergencia deliberada en Firebase (2026-09-06, decisión del operador):** el puerto
  **no** deja que un anónimo cambie el `estado` ni la `categoria` de un insumo que ya existe.
  Un reporte público puede dar de alta un insumo nuevo (con el `estado` y la `categoria` que
  indique) y, sobre uno existente, refresca `actualizado` y escribe la entrada de historial con
  el estado **real**; bajar un `Necesita` a `Cubierto` queda reservado a `panel_insumo` y al
  admin. Motivo: con el comportamiento legado bastaba acertar el nombre de un hospital para
  marcar su necesidad crítica como `Cubierto` y hacerla desaparecer del directorio.

### registrar_voluntario (`index.ts:939-956`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite / regex | Req. | Por defecto |
|---|---|---|---|---|
| `nombre` | texto | 120 | sí | — |
| `apellido` | texto | 120 | no | `''` |
| `email` | email | `emailNorm` (254, minúsculas) | sí | — |
| `telefono` | texto | 40; debe contener ≥ 7 dígitos | sí | — |
| `fotoCedula` | dataURL imagen | `guardarFoto` (jpeg/png/webp, 1 000..1 800 000 B) | sí | — |
| `id` | texto | 40 (sin validar formato) | no | `'VOL' + uuid.slice(0,8)` |
| `estado` | texto | 60 | no | `''` |
| `ciudad` | texto | 80 | no | `''` |
| `profesion` | texto | 80 | no | `''` |
| `disponibilidad` | texto | 120 | no | `''` |
| `medioTransporte` (alias `medio_transporte`) | texto | 60 | no | `''` |
| `observaciones` | texto | 500 | no | `''` |

- **Validaciones (en orden):**
  1. `!s(p.nombre)` → `"nombre requerido"`.
  2. `emailNorm(p.email)` vacío → `"correo electrónico válido requerido"`.
  3. `s(p.telefono, 40).replace(/[^0-9]/g, '').length < 7` → `"teléfono requerido"`.
  4. `!p.fotoCedula` → `"Falta la foto de la cédula"`.
  5. Errores de `guardarFoto` con `nombre = 'cedula'` (`"foto de cedula inválida (se espera imagen JPEG/PNG)"`, `"foto de cedula vacía"`, `"foto de cedula demasiado grande"`, `"no se pudo guardar la foto de cedula"`).
- **Efectos:**
  1. Storage `registro-transportistas`: `voluntarios/<id>/cedula.<ext>` (`upsert: false`).
  2. `insert voluntarios { id, email, foto_cedula: <ruta>, nombre, apellido, telefono, estado, ciudad, profesion, disponibilidad, medio_transporte, observaciones }` (`fecha_registro = now()`).
- **Respuesta:** `{}`.
- **Notas:** no escribe `historial`. Si el cliente manda un `id` repetido, el insert falla por PK
  **después** de subir la foto (archivo huérfano). El correo se guarda normalizado porque
  `identidadSesion`/`acceso_perfil` buscan por igualdad exacta.

### registrar_rescatista (`index.ts:957-969`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `nombre` | texto | 120 | sí | — |
| `id` | texto | 40 | no | `'RES' + uuid.slice(0,8)` |
| `organizacion` | texto | 120 | no | `''` |
| `telefono` | texto | 40 (sin mínimo de dígitos) | no | `''` |
| `especialidad` | texto | 80 | no | `''` |
| `estado` | texto | 60 | no | `''` |
| `ciudad` | texto | 80 | no | `''` |
| `disponibilidad` | texto | 120 | no | `''` |
| `equipoDisponible` (alias `equipo_disponible`) | texto | 300 | no | `''` |
| `capacidadOperativa` (alias `capacidad_operativa`) | texto | 120 | no | `''` |
| `observaciones` | texto | 500 | no | `''` |

- **Validaciones:** `!s(p.nombre)` → `"nombre requerido"`.
- **Efectos:** `insert rescatistas { id, nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones }`.
- **Respuesta:** `{}`.
- **Notas:** sin foto, sin correo, sin historial. La vista `rescatistas_public` existe en la BD pero
  el frontend no la consume (ver sección 3).

### registrar_motorizado (`index.ts:970-991`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite / regex | Req. | Por defecto |
|---|---|---|---|---|
| `nombre` | texto | 120 | sí | — |
| `email` | email | `emailNorm` | sí | — |
| `telefono` | texto | 40; ≥ 7 dígitos | sí | — |
| `fotoPlaca`, `fotoVehiculo`, `fotoCedula` | dataURL imagen | `guardarFoto` 1,8 MB | sí (las tres) | — |
| `id` | texto | 40 | no | `'MOT' + uuid.slice(0,8)` |
| `tipoVehiculo` (alias `tipo_vehiculo`) | texto | 40 (**sin** lista) | no | `'Moto'` |
| `zonaOperacion` (alias `operaEn`) | texto | 120 | no | `''` |
| `placa` | texto | 20 | no | `''` |

- **Validaciones (en orden):** `"nombre requerido"`; `"correo electrónico válido requerido"`;
  `"teléfono requerido"`; si falta cualquiera de las tres fotos →
  `"Faltan fotos: placa, vehículo y cédula son obligatorias"`; luego errores de `guardarFoto` en el
  orden `placa`, `vehiculo`, `cedula` (p. ej. `"foto de placa inválida (se espera imagen JPEG/PNG)"`).
- **Efectos:**
  1. Storage `registro-transportistas`: `<id>/placa.<ext>`, `<id>/vehiculo.<ext>`, `<id>/cedula.<ext>` (en ese orden, sin upsert).
  2. `insert motorizados { id, email, nombre, tipo_vehiculo, telefono, zona_operacion, placa, foto_placa, foto_vehiculo, foto_cedula }`.
- **Respuesta:** `{}`.
- **Notas:** `tipo_vehiculo` acepta cualquier texto aquí, pero la consola admin solo permite
  `Moto | Carro | Bicicleta | Camión | Triciclo motorizado`. El correo determina el rol
  `transportista` en `identidadSesion` (prioridad máxima). Sin historial.

### damnificado_registrar (`index.ts:992-1045`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite / regla | Req. | Por defecto |
|---|---|---|---|---|
| `web` | texto (honeypot) | 100; si **no** está vacío se finge éxito sin escribir | no | — |
| `responsableNombre` | texto | 120 | sí | — |
| `responsableTelefono` | texto | 40 (sin mínimo) | no | `''` |
| `responsableEmail` | texto | 120 (**sin** `emailNorm`) | no | `''` |
| `alojamiento` | texto | 500 | no | `''` |
| `municipio` | texto | 120 | no | `''` |
| `estadoGeo` | texto | 120 | no | `''` |
| `gps` | `{ lat, lng }` | `n()` de cada uno **sin rango**; `null` si el campo es `null`/`undefined` | no | `null` |
| `integrantes` | array (máx. 20; el resto se descarta) | cada elemento: `nombre` 120, `parentesco` 60, `edad` = `clamp(round(n(edad)), 0, 120)`, `menor` = `it.menor === true \|\| (edad > 0 && edad < 18)`, `ocupacion` 160, `condicionMedica` (alias `condicion_medica`) 400, `notas` 400; se descartan los que no tengan `nombre`, `parentesco` ni `edad` | no | `[]` |
| `fotos` | array de dataURL (máx. 12) | `guardarFoto(..., 'damnificados', 2_500_000)`; **una foto inválida se omite en silencio** | no | `[]` |
| `fallecidos` | entero | `clamp(round(n), 0, 99)` | no | `0` |
| `fallecidosDetalle` | texto | 500 | no | `''` |
| `perdioCasa` | booleano | `p.perdioCasa !== false` | no | `true` |
| `perdioVehiculo` | booleano | `p.perdioVehiculo === true` | no | `false` |
| `vehiculosDetalle` | texto | 400 | no | `''` |
| `sustentoPrincipal` | texto | 400 | no | `''` |
| `bienesPerdidos` | texto | 2000 | no | `''` |
| `notas` | texto | 1000 | no | `''` |

- **Validaciones (en orden):**
  1. `s(p.web, 100)` no vacío → devuelve `{ codigo: 'FAM-000000', ok: true }` **sin escribir nada**.
  2. `responsableNombre` vacío → `"Falta el nombre de quien registra a la familia"`.
- **Efectos:**
  1. `codigo = 'FAM-' + uuid.slice(0,8).toUpperCase()`.
  2. Storage `damnificados`: `<codigo>/p<i>.<ext>` por cada foto válida (`i` = índice original; puede haber huecos).
  3. `insert familias_damnificadas { codigo, responsable_nombre, responsable_telefono, responsable_email,
     alojamiento, municipio, estado_geo, gps_lat, gps_lng, num_personas: integrantes.length,
     num_menores, integrantes (jsonb [{nombre, parentesco, edad, menor, ocupacion, condicion_medica, notas}]),
     fallecidos, fallecidos_detalle, perdio_casa, perdio_vehiculo, vehiculos_detalle, sustento_principal,
     bienes_perdidos, notas, fotos (jsonb [rutas]) }` (`estado = 'nuevo'`, `insumos_necesarios = ''`, `created_at = now()` por defecto).
- **Respuesta:** `{ codigo: string, numPersonas: number, numMenores: number }`.
- **Notas:** PII sensible: la tabla está revocada para `anon`; solo `admin_damnificados` la lee y la
  vista `familias_public` expone un resumen sin nombres. Sin historial. `codigo` es `unique`.

### registrar_trayecto (`index.ts:1046-1054`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:** `origen` texto 160 (req.), `destino` texto 160 (req.), `idMotorizado` texto 40
  (vacío → `null`), `nombreMotorizado` texto 120, `km` número (`n()`, puede ser 0 o negativo),
  `insumo` texto 120 (por defecto `'Varios'`).
- **Validaciones:** `!s(p.origen) || !s(p.destino)` → `"origen y destino requeridos"`.
- **Efectos:** `insert trayectos { motorizado_id, nombre_motorizado, origen, destino, km, insumo }` (`fecha = now()`).
- **Respuesta:** `{}`.
- **Notas:** `motorizado_id` tiene FK a `motorizados.id` (`on delete set null`); un id inexistente
  produce error crudo `23503`. Se lee por `trayectos_public`.

### donar_motorizado (`index.ts:1055-1062`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:** `idMotorizado` texto 40 (vacío → `null`), `nombreMotorizado` texto 120, `monto`
  número (`n()`, **sin validar** signo ni tope), `tipo` texto 60, `donanteName` (alias `donante`)
  texto 120 (por defecto `'Anónimo'`), `ciudad` texto 80.
- **Validaciones:** ninguna.
- **Efectos:** `insert donaciones_motorizados { motorizado_id, nombre_motorizado, monto, tipo, donante, ciudad }` (`fecha = now()`).
- **Respuesta:** `{}`.
- **Notas:** cuenta en `estadisticas.donacionesRegistradas`. FK `on delete set null`. Sin historial.

### donar_necesidad (`index.ts:1063-1090`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `centro` | texto (nombre exacto del lugar) | 120 | sí | — |
| `insumo` | texto (nombre exacto del insumo) | 120 | sí | — |
| `cantidad` | número | `0 < x <= 1_000_000` | sí | — |
| `nombreDonante` | texto | 120 | no | `'Anónimo'` |
| `referencia` | texto | 80 | no | `''` |

- **Validaciones (en orden):**
  1. `!centro || !insumo` → `"centro e insumo requeridos"`.
  2. `cantidad <= 0 || cantidad > 1_000_000` → `"cantidad inválida"`.
  3. `lugares` por `nombre = centro` (`select id, nombre`) inexistente → `"Centro no encontrado"`.
  4. `insumos` por `lugar_id` y `nombre = insumo` (**cualquier estado**; `select nombre, unidad, cantidad_necesaria`) inexistente → `"Necesidad no encontrada"`.
- **Efectos:**
  1. `unidad = item.unidad || 'unidades'`; `objetivo = \`${item.nombre} → ${lugar.nombre}\``.
  2. `facturaDeNecesidad(objetivo, \`Necesidad publicada por ${lugar.nombre}\`, Math.max(Number(item.cantidad_necesaria) || 0, cantidad))`:
     reutiliza la factura `Abierta` más antigua con ese `objetivo`; si no hay, RPC
     `factura_numero_siguiente` + `insert facturas { numero_factura, token_publico: DV, objetivo, descripcion, monto_requerido }`.
  3. `insert donaciones { factura_id, nombre_donante, monto: cantidad, referencia_pago, estado: 'Registrada' }`
     (el disparador recalcula, pero `Registrada` no suma).
  4. `insert movimientos_factura { factura_id, tipo: 'Ingreso', descripcion: mov('donacionRegistrada', { cantidad, unidad, insumo: item.nombre }), monto: cantidad }`.
  5. `historial(lugar.nombre, item.nombre, \`Donación registrada: ${cantidad} ${unidad}\`, 'publico', cantidad)`.
- **Respuesta:** `{ token: string (DV-…), numeroFactura: string, objetivo: string }`.
- **Notas:** no modifica `insumos.cantidad_recibida` (eso lo hace el centro con `panel_insumo`,
  que a su vez cierra la factura vía `registrarEntrega`). `monto_requerido` solo se fija al crear
  la factura; donaciones posteriores mayores no lo suben. Sin transacción: dos primeras donaciones
  simultáneas pueden crear dos facturas abiertas para el mismo objetivo. Firebase: transacción
  sobre `facturas` indexada por `(objetivo, estado='Abierta')`.

### listar_presupuestos (`index.ts:1091-1097`)

- **Auth:** anon; **Cubo:** `lectura` (240/h).
- **Entrada:** ninguna.
- **Validaciones:** ninguna.
- **Efectos (solo lectura):** `facturas` con `descripcion like '{"k":"pres"%'` (cualquier estado),
  `select token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado, fecha_creacion`,
  `order fecha_creacion desc`, `limit 200`; `tasaActual()`.
- **Respuesta:** `{ presupuestos: presupuestoUI[], tasa: { efectiva, diaria, fuente, fecha } | null }`.
- **Notas:** incluye presupuestos en cualquier estado (el cliente filtra). `presupuestoUI` omite las
  filas cuyo JSON no parsea.

### listar_comprados (`index.ts:1098-1105`)

- **Auth:** anon; **Cubo:** `lectura`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `facturas` presupuesto con `estado in ('Comprada', 'EnTransito')`,
  `order fecha_creacion asc`, `limit 100`.
- **Respuesta:** `{ comprados: presupuestoUI[] }`.
- **Notas:** es la «lista de recogidas» del transportista (compras listas o en tránsito).

### donar_dinero (`index.ts:1106-1154`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `montoUsd` (alias `monto`) | número USD | `0 < x <= 100_000` | sí | — |
| `token` | texto | `s(…, 24).toUpperCase()` | sí | — |
| `comprobante` | dataURL imagen/PDF | `guardarComprobante` (200 B..5 MB) | sí | — |
| `nombreDonante` | texto | 120 | no | `'Anónimo'` |

- **Validaciones (en orden):**
  1. `montoUsd <= 0 || montoUsd > 100_000` → `"monto inválido"`.
  2. `tasaActual()` nulo o `efectiva <= 0` → `"tasa de cambio no disponible, intenta más tarde"`.
  3. Factura por `token_publico` (`select id, numero_factura, token_publico, descripcion, monto_requerido, monto_recaudado, estado`) inexistente **o** sin `metaPresupuesto` → `"Presupuesto no encontrado"`.
  4. `estado !== 'Abierta'` → `"Este presupuesto ya está financiado"`.
  5. `!p.comprobante` → `"Adjunta el comprobante de tu transferencia"`.
  6. Errores de `guardarComprobante`.
- **Efectos:**
  1. `montoBs = Math.round(montoUsd * tasa.efectiva)`.
  2. Storage `comprobantes`: `don/<facturaId>/<tokenAlfa('C')>.<ext>`.
  3. `referencia = tokenAlfa('REF')`.
  4. `insert donaciones { factura_id, nombre_donante, monto: montoBs, monto_usd: montoUsd, tasa: tasa.efectiva, comprobante: <ruta>, referencia_pago: referencia, estado: 'Confirmada' }` → el disparador suma a `monto_recaudado`.
  5. `insert movimientos_factura { tipo: 'Ingreso', descripcion: mov('dineroRecibido', { referencia }), monto: montoBs }`.
  6. Relee `facturas` (`monto_recaudado, monto_requerido, estado`). Si `monto_recaudado >= monto_requerido && estado === 'Abierta'`:
     `update facturas { estado: 'PorComprar' }`;
     `insert movimientos_factura { tipo: 'Recaudado', descripcion: mov('metaCubierta', { insumo: m.insumo, tienda: m.tienda }), monto: 0 }`;
     `notificarTelegram('✅ Se recaudó todo para <b>${m.insumo}</b> (${m.centro}). Toca transferir y comprar. Token: ${f.token_publico}')`.
  7. `historial(String(m.centro), String(m.insumo), \`Donación de ${montoUsd} USD (${montoBs} Bs, ref ${referencia})\`, 'publico', montoBs)`.
- **Respuesta:** `{ referencia: string, token: string, numeroFactura: string, recaudado: number (Bs, tras la donación), precio: number (Bs), montoUsd: number, montoBs: number, tasa: number, estado: 'Abierta' | 'PorComprar' }`.
- **Notas:** no se limita la donación al restante: puede sobrepasar la meta. La donación se
  guarda `Confirmada` de inmediato (la verificación del admin es posterior, por
  `admin_donaciones_presupuesto` / `admin_donacion_anular`). Firebase no tiene disparador: debe
  insertar la donación y recalcular `monto_recaudado = Σ monto (estado = 'Confirmada')` en una
  transacción, y decidir el paso a `PorComprar` dentro de la misma para evitar dos `metaCubierta`
  con donaciones concurrentes. La `referencia` es la referencia de pago que ve el donante.

### viaje_iniciar (`index.ts:1155-1201`)

- **Auth:** sesión (`exigirSesion`); **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `accessToken` | JWT | 4000 | sí | — |
| `token` | texto | 24, mayúsculas | sí | — |
| `etaMinutos` | entero | `Math.round(n)`, `5..480` | sí | — |
| `gps` | `{ lat, lng }` | `geoValida` (caja Venezuela) | sí | — |
| `nombreTransportista` | texto | 120; solo si `ident.nombre` está vacío | no | `ident.email` |

- **Validaciones (en orden):**
  1. `exigirSesion`: `"Entra con tu cuenta para reservar este trabajo"` / `"Sesión inválida o vencida, vuelve a pedir un código"`.
  2. `eta < 5 || eta > 480` → `"Tiempo estimado inválido (5 a 480 minutos)"`.
  3. GPS inválido → `"Se necesita tu ubicación GPS para iniciar el viaje"`.
  4. Factura por token (`select id, numero_factura, token_publico, objetivo, descripcion, estado, monto_requerido, monto_recaudado`); si no existe o no es presupuesto ni oferta → `"Presupuesto no encontrado"`.
  5. Presupuesto con `estado !== 'Comprada'` → `"Este insumo no está listo para recoger"`.
  6. Oferta con `estado !== 'Ofrecida'` → `"Esta donación ya está en camino o fue recogida"`.
  7. `reservaViva(f.id)` de **otro** correo → `"Este trabajo ya lo reservó otra persona"`.
  8. `reservaViva` **propia** → responde `{ ok: true, yaReservado: true, viajeId: <uuid>, detalle }` sin escribir.
- **Efectos:**
  1. `insert viajes { factura_id, transportista: nombre, email: ident.email, eta_minutos: eta, paso1_ts: now, paso1_lat, paso1_lng }` (`id uuid`, `resuelto false`, `creado_at now`).
  2. `insert movimientos_factura { tipo: 'Viaje', descripcion: mov('viajeIniciado', { nombre, eta }), monto: 0 }`.
  3. Solo oferta: `update facturas { estado: 'EnCamino' }`.
  4. `historial(String(m.centro), String(m.insumo), \`Transportista ${nombre} va en camino a recoger el insumo (llega en ~${eta} min)\`, 'publico')`.
- **Respuesta:** `{ ok: true, etaMinutos: number, detalle: ofertaUI | presupuestoUI }` o la forma
  `yaReservado` de arriba. `detalle` de una oferta incluye el contacto completo (V03).
- **Notas:** la comprobación de reserva y el insert no son atómicos: dos transportistas pueden
  reservar a la vez y la fila más reciente gana. Firebase: transacción que lea la reserva viva y
  escriba el viaje. Para una oferta `m.centro` puede ser `''` (historial con `lugar = ''`).

### registrar_recogida (`index.ts:1202-1254`)

- **Auth:** sesión + dueño de la reserva viva; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `accessToken` | JWT | 4000 | sí | — |
| `token` | texto | 24, mayúsculas; debe ser **presupuesto** | sí | — |
| `fotoSitio`, `fotoInsumo` | dataURL imagen | `guardarFoto` 1,8 MB | sí | — |
| `fotoPersona` | dataURL imagen | `guardarFoto` | no | — |
| `gps` | `{ lat, lng }` | `geoValida`; si inválido se omite el tramo | no | — |
| `notas` | texto | 300 | no | `''` |
| `nombreTransportista` | texto | 120 (respaldo) | no | — |

- **Validaciones (en orden):**
  1. `exigirSesion`.
  2. `!p.fotoSitio || !p.fotoInsumo` → `"Faltan fotos: sitio de recogida e insumo son obligatorias"`.
  3. Factura (`select id, numero_factura, descripcion, estado`) sin `metaPresupuesto` → `"Presupuesto no encontrado"`.
  4. `estado !== 'Comprada'` → `"Este insumo no está listo para recoger"`.
  5. `exigirDuenoReserva` → `"Tu reserva venció; vuelve a reservarla"` / `"Este trabajo está reservado por otra persona"`.
  6. Errores de `guardarFoto` (`recogida-sitio-<marca>`, `recogida-insumo-<marca>`, `recogida-persona-<marca>`).
- **Efectos:**
  1. Storage `registro-transportistas`, carpeta `ciclo/<numero_factura>/`: `recogida-sitio-<marca>.<ext>`, `recogida-insumo-<marca>.<ext>`, opcional `recogida-persona-<marca>.<ext>`.
  2. `insert evidencias` (todas `publica: false`): `{ archivo: <ruta>, descripcion: \`Foto del sitio de recogida (${m.tienda})\` }`, `{ …, descripcion: 'Foto del insumo comprado' }`, opcional `{ …, descripcion: 'Foto de quien entrega el insumo' }`.
  3. Si GPS válido y `viajeVigente(f.id)` existe: `km_tramo1 = kmEntre(paso1, gps)` (o `null` si `paso1_lat/lng` nulos); `update viajes { paso2_ts: now, paso2_lat, paso2_lng, km_tramo1 }`.
  4. `insert movimientos_factura { tipo: 'Recogida', descripcion: mov(notas ? 'insumoRecogidoConNota' : 'insumoRecogido', { nombre, tienda: m.tienda, direccion: m.direccion, notas, km? }), monto: 0 }`.
  5. `update facturas { estado: 'EnTransito' }`.
  6. `historial(String(m.centro), String(m.insumo), \`Transportista ${nombre} recogió el insumo comprado en ${m.tienda}\`, 'publico')`.
- **Respuesta:** `{ estado: 'EnTransito', km: number | null }`.
- **Notas:** `viajeVigente` (no `reservaViva`) es el que recibe el GPS: la fila más reciente sin
  `paso3_ts`. Las evidencias privadas solo las ve el admin (no salen en `seguimiento_factura`).

### registrar_entrega_final (`index.ts:1255-1319`)

- **Auth:** sesión + dueño de la reserva; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `nombreReceptor` | texto | 120 | sí (se valida **antes** de la sesión) | — |
| `accessToken` | JWT | 4000 | sí | — |
| `fotoCentro` (alias antiguo `fotoEntrega`) | dataURL imagen | `guardarFoto` | sí | — |
| `fotoEncargado` | dataURL imagen | `guardarFoto` | no | — |
| `token` | texto | 24, mayúsculas; presupuesto **u** oferta | sí | — |
| `gps` | `{ lat, lng }` | `geoValida` | no | — |
| `cargoReceptor` | texto | 80 | no | `''` |
| `nombreTransportista` | texto | 120 (respaldo; no se usa en la salida) | no | — |

- **Validaciones (en orden):**
  1. `receptor` vacío → `"nombre de quien recibe requerido"`.
  2. `exigirSesion`.
  3. `!(p.fotoCentro ?? p.fotoEntrega)` → `"Falta la foto de la entrega en el centro"`.
  4. Factura (`select id, numero_factura, descripcion, estado`) sin meta pres/oferta → `"Presupuesto no encontrado"`.
  5. Presupuesto con `estado !== 'EnTransito'` → `"Este insumo no está en tránsito"`.
  6. Oferta con `estado !== 'Recogida'` → `"Esta donación no está lista para entregar"`.
  7. `exigirDuenoReserva`.
  8. Errores de `guardarFoto` (`entrega-centro-<marca>`, `entrega-encargado-<marca>`).
- **Efectos:**
  1. Storage `registro-transportistas`, carpeta `ciclo/<numero_factura>/` (también para ofertas): `entrega-centro-<marca>.<ext>`, opcional `entrega-encargado-<marca>.<ext>`.
  2. `insert evidencias` (`publica: false`): `{ descripcion: \`Foto de la entrega en ${m.centro}\` }`, opcional `{ descripcion: \`Foto de quien recibe en ${m.centro}\` }`.
  3. Si GPS válido y hay `viajeVigente`: `km_tramo2 = kmEntre(paso2, gps)` (o `null` si `paso2_lat/lng` nulos); `update viajes { paso3_ts: now, paso3_lat, paso3_lng, km_tramo2 }`; `kmTotal = Math.round(((km_tramo1 ?? 0) + (km_tramo2 ?? 0)) * 10) / 10`.
  4. `insert movimientos_factura { tipo: 'Entrega', descripcion: mov(cargo ? 'entregadoConCargo' : 'entregado', { centro: m.centro, receptor, cargo, km?: kmTotal }), monto: 0 }`.
  5. `update facturas { estado: 'Entregada', fecha_cierre: now }`.
  6. `historial(String(m.centro), String(m.insumo), \`Insumo comprado entregado en el centro. Recibió ${receptor}\`, 'publico')` (mismo texto para ofertas).
- **Respuesta:** `{ estado: 'Entregada', km: number | null }`.
- **Notas:** sin GPS válido el viaje **no** se cierra (`paso3_ts` queda nulo) y seguirá apareciendo
  en `viajes_atrasados` pasadas 2 h aunque la factura esté `Entregada`; Firebase debería cerrar el
  viaje siempre (guardando GPS nulo). Para ofertas, `m.centro` es el centro sugerido al ofrecer,
  no el `centroDestino` elegido en `recoger_oferta`.

### ofrecer_insumo (`index.ts:1320-1370`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `insumo` | texto | 120 | sí | — |
| `cantidad` | número | `0 < x <= 1_000_000` | sí | — |
| `unidad` | texto | 30 | no | `'unidades'` |
| `ubicacion` | texto (nombre de referencia del sitio) | 160 | sí | — |
| `telefono` | texto | 40; ≥ 7 dígitos | sí | — |
| `nombreDonante` | texto | 120 | sí | — |
| `fotosInsumo` | array dataURL (máx. 20) | `guardarFoto` 1,8 MB cada una | sí (o `fotoInsumo`) | `[]` |
| `fotoInsumo` | dataURL (compatibilidad) | `s(…, 2_500_000)` y luego `guardarFoto` | sí si no hay array | — |
| `fotoCedula`, `fotoLugar` | dataURL | `s(…, 2_500_000)` + `guardarFoto` | no | `''` |
| `lat`, `lng` | número | `\|lat\| <= 90 && \|lng\| <= 180` (no caja Venezuela); si inválidos `coords = null` | no | `null` |
| `centro` | texto (destino sugerido) | 120 | no | `''` |
| `zona` | texto (municipio/sector) | 80 | no | `''` |

- **Validaciones (en orden):** `"insumo requerido"`; `"cantidad inválida"`;
  `"nombre de referencia del sitio requerido"`; `"teléfono requerido para coordinar la recogida"`;
  `"nombre de contacto requerido"`; `!fotoInsumo && !fotosCrudas.length` →
  `"foto del insumo requerida"`; error del RPC; errores de `guardarFoto` (`insumo-1`…, `insumo`, `cedula`, `lugar`).
- **Efectos:**
  1. RPC `factura_numero_siguiente` → `numero`; `token = tokenAlfa('DV')`.
  2. Storage `registro-transportistas`: `ofertas/<token>/insumo-<k>.<ext>` (k = 1..n) si hay array, si no `ofertas/<token>/insumo.<ext>`; opcional `ofertas/<token>/cedula.<ext>`, `ofertas/<token>/lugar.<ext>`.
  3. `insert facturas { numero_factura, token_publico, objetivo: s(\`Oferta: ${insumo} (${ubicacion})\`, 200), descripcion: JSON metaOferta (1.14; fotoInsumo = rutas[0], fotos = rutas, coords = { lat, lng } | null), monto_requerido: cantidad, estado: 'Ofrecida' }`.
  4. `insert movimientos_factura { tipo: 'Oferta', descripcion: mov('donacionOfrecida', { cantidad, unidad, insumo, ubicacion }), monto: cantidad }`.
  5. `historial(centro || 'Donaciones ofrecidas', insumo, \`Oferta de ${cantidad} ${unidad} en ${ubicacion}\`, 'publico', cantidad)`.
- **Respuesta:** `{ token: string, numeroFactura: string }`.
- **Notas:** el JSON con teléfono/nombre/coords exactas queda en `facturas.descripcion`, que es
  visible con el token por `seguimiento_factura` (ver 1.14). El movimiento `donacionOfrecida`
  expone `ubicacion` (nombre de referencia) públicamente.

### listar_ofertas (`index.ts:1371-1379`)

- **Auth:** anon; **Cubo:** `lectura`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `facturas` con `descripcion like '{"k":"oferta"%'` y
  `estado in ('Ofrecida', 'EnCamino')`, `select token_publico, descripcion, estado, fecha_creacion`,
  `order fecha_creacion asc`, `limit 100`.
- **Respuesta:** `{ ofertas: ofertaPublicaUI[] }` (sin contacto; `coordsAprox` redondeadas a 2 decimales).

### reserva_detalle (`index.ts:1380-1391`)

- **Auth:** sesión + dueño de la reserva viva; **Cubo:** `lectura`.
- **Entrada:** `accessToken` (req.), `token` texto 24 mayúsculas (req.).
- **Validaciones (en orden):** `exigirSesion`; factura por token
  (`select id, token_publico, objetivo, descripcion, estado, monto_requerido, monto_recaudado`)
  inexistente → `"Trabajo no encontrado"`; `exigirDuenoReserva`; `ofertaUI(f) || presupuestoUI(f)`
  nulo → `"Trabajo no encontrado"`.
- **Efectos:** solo lectura.
- **Respuesta:** `{ detalle: ofertaUI | presupuestoUI }`.
- **Notas:** es la única vía pública para obtener el teléfono/dirección del donante de una oferta.

### recoger_oferta (`index.ts:1392-1443`)

- **Auth:** sesión + dueño de la reserva; **Cubo:** `publico`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `accessToken` | JWT | 4000 | sí | — |
| `token` | texto | 24, mayúsculas; debe ser **oferta** | sí | — |
| `centroDestino` | texto | 120 | sí (si `m.centro` está vacío) | `m.centro` |
| `fotoSitio`, `fotoInsumo`, `fotoPersona` | dataURL imagen | `guardarFoto` | no | — |
| `gps` | `{ lat, lng }` | `geoValida` | no | — |
| `nombreTransportista` | texto | 120 (respaldo) | no | — |

- **Validaciones (en orden):**
  1. `exigirSesion`.
  2. Factura (`select id, numero_factura, descripcion, estado`) sin `metaOferta` → `"Oferta no encontrada"`.
  3. `estado` distinto de `EnCamino` y de `Ofrecida` → `"Esta donación ya fue recogida"`.
  4. `exigirDuenoReserva`.
  5. `centroDestino` vacío → `"centro de destino requerido"`.
  6. Errores de `guardarFoto`.
- **Efectos:**
  1. Storage `registro-transportistas`, carpeta `ofertas/<token>/`: opcionales `recogida-sitio-<marca>`, `recogida-insumo-<marca>`, `recogida-persona-<marca>`.
  2. `insert evidencias` (`publica: false`) solo de las fotos presentes: `'Foto del sitio de recogida de la oferta'`, `'Foto de la donación recogida'`, `'Foto de quien entrega la donación'`.
  3. GPS válido + `viajeVigente`: `update viajes { paso2_ts: now, paso2_lat, paso2_lng, km_tramo1: kmEntre(paso1, gps) | null }`.
  4. `insert movimientos_factura { tipo: 'Recogida', descripcion: mov('donacionRecogida', { nombre, ubicacion: m.ubicacion, centro: centroDestino, km? }), monto: 0 }`.
  5. `update facturas { estado: 'Recogida' }` (**sin** `fecha_cierre`).
  6. `historial(centroDestino, String(m.insumo), \`Transportista ${nombre} recogió la donación ofrecida (${m.cantidad} ${m.unidad})\`, 'publico', n(m.cantidad))`.
- **Respuesta:** `{ estado: 'Recogida', km: number | null }`.
- **Notas:** `centroDestino` **no se persiste** en la factura (solo en el movimiento y el historial);
  la entrega posterior usará `m.centro` original. Firebase debería guardar el destino en el
  documento de la oferta.

### acceso_perfil (`index.ts:1444-1462`)

- **Auth:** JWT directo (sin `exigirSesion`); **Cubo:** `lectura`.
- **Entrada:** `accessToken` texto 4000 (req.).
- **Validaciones:** vacío → `"sesión requerida"`; `supa.auth.getUser` con error o sin correo →
  `"Sesión inválida o vencida, vuelve a pedir un código"`.
- **Efectos (lectura):** con `email = user.email.toLowerCase()`: todas las filas de `motorizados`
  (`nombre`), `voluntarios` (`nombre, apellido`) y `centros_panel` (join `lugares(nombre)`) con ese
  correo (**sin** `limit 1`, a diferencia de `identidadSesion`).
- **Respuesta:** `{ email: string, roles: [{ tipo: 'transportista' | 'voluntario' | 'centro', nombre: string }] }`
  (`nombre` del voluntario = `\`${nombre} ${apellido || ''}\`.trim()`; del centro = `lugares.nombre || 'Centro'`).
- **Notas:** por diseño (V02) **nunca** devuelve `token_centro`; el centro entra siempre con
  token + PIN. Un donante sin roles recibe `roles: []`.

### reportar_persona (`index.ts:1463-1476`)

- **Auth:** anon; **Cubo:** `publico`.
- **Entrada:** `nombre` texto 160 (req.), `cedula` texto 20, `estado` (alias `estadoSalud`) texto
  120, `ubicacion` texto 200, `contacto` texto 120, `fuente` texto 120, `reportadoPor` (alias
  `reportado_por`) texto 120.
- **Validaciones:** `!s(p.nombre)` → `"nombre requerido"`.
- **Efectos:** `insert personas { nombre, cedula, estado, ubicacion, contacto, fuente, reportado_por, verificada: false }` (`fecha = now()`).
- **Respuesta:** `{}`.
- **Notas:** se busca públicamente por `buscar_familiar` (sección 3) sin importar `verificada`;
  el admin la marca con `admin_verificar_persona`. Sin historial.

### denuncia_parcial (`index.ts:1477-1504`)

- **Auth:** JWT directo (`"sesión requerida"` si falta) + `identidadSesion`; cualquier rol,
  incluido `donante`; **Cubo:** `denuncia` (400/h).
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `accessToken` | JWT | 4000 | sí | — |
| `videoBase64` | dataURL video | `guardarVideo` (webm/mp4, 1 000 B..30 MB) | sí | — |
| `duracionS` | entero | `clamp(round(n), 0, 600)` | no | `0` |
| `denunciaId` | uuid texto | 40; si viene, la fila debe existir y ser del mismo correo | no | se crea una fila nueva |
| `tipo` (solo al crear) | opción | `'Retención de insumos'`, cualquier otro → `'Otro'` | no | `'Otro'` |
| `gps` (solo al crear) | `{ lat, lng, precision }` | `geoValida`; `precision` finita o `null` | no | `null` |
| `facturaToken` (solo al crear) | texto | 24, mayúsculas | no | `null` |

- **Validaciones (en orden):**
  1. JWT vacío → `"sesión requerida"`.
  2. `!p.videoBase64` → `"Falta el fragmento de video"`.
  3. `identidadSesion` → `"Sesión inválida o vencida, vuelve a pedir un código"`.
  4. Si `denunciaId`: `denuncias` (`select id, email`) inexistente o `email !== ident.email` → `"Denuncia no encontrada"`.
  5. Errores de `guardarVideo`.
- **Efectos:**
  1. Sin `denunciaId`: `insert denuncias { email: ident.email, nombre: ident.nombre, rol: ident.rol, tipo, gps_lat, gps_lng, gps_precision, factura_token: facturaToken || null, origen: 'usuario', estado: 'Recibida' }` → `id` (uuid).
  2. Storage `denuncias`: `denuncias/<id>/video.<webm|mp4>` con **`upsert: true`** (se resube el video completo en cada parcial, cada ~5 s).
  3. `update denuncias { video_path: <ruta>, duracion_s: duracion }`.
- **Respuesta:** `{ id: string }`.
- **Notas:** el primer parcial crea la fila; los siguientes reutilizan `denunciaId`. Si el cliente
  cambia de contenedor (webm→mp4) queda un objeto antiguo huérfano. Firebase: subida resumable o
  sobrescritura del mismo objeto; el `texto` no se guarda hasta `denuncia_crear`.

### denuncia_crear (`index.ts:1505-1540`)

- **Auth:** JWT directo + `identidadSesion`; **Cubo:** `denuncia`.
- **Entrada:** como `denuncia_parcial` más `texto` texto 1000; `tipo`, `gps`, `facturaToken` y
  `duracionS` se aplican tanto al crear como al actualizar.
- **Validaciones (en orden):** `"sesión requerida"`; `!p.videoBase64` →
  `"Falta el video de la denuncia"`; `identidadSesion`; `denunciaId` ajeno o inexistente →
  `"Denuncia no encontrada"`; errores de `guardarVideo`.
- **Efectos:**
  1. Sin `denunciaId`: `insert denuncias { email, nombre, rol, tipo, gps_lat, gps_lng, gps_precision, texto, factura_token: facturaToken || null, origen: 'usuario', estado: 'Recibida' }`.
  2. Storage `denuncias`: `denuncias/<id>/video.<ext>` (`upsert: true`).
  3. `update denuncias { video_path, duracion_s, tipo, texto, gps_lat, gps_lng, gps_precision }` (**no** toca `estado` ni `factura_token` de una fila existente).
  4. Si `facturaToken` no está vacío y existe `facturas.token_publico = facturaToken`:
     `insert movimientos_factura { factura_id, tipo: 'Denuncia', descripcion: mov('denunciaRegistrada', {}), monto: 0 }`.
- **Respuesta:** `{ id: string, estado: 'Recibida' }` (literal, aunque la fila ya tuviera otro estado).
- **Notas:** el público solo ve `denuncias_public` (`denuncias_listar`); identidad, rol, texto y
  precisión GPS son solo-admin. El movimiento `denunciaRegistrada` sí es público en el token.
  > **Divergencia deliberada en Firebase (Task 3.6, 2026-09-07).** `denuncia_parcial` **no sube
  > vídeo**: solo registra el progreso. El legado resubía el vídeo entero cada ~5 s (hasta 30 MB por
  > parcial, decenas de veces) para acabar sustituyéndolo otra vez al enviar; el cliente ya guarda
  > los trozos en IndexedDB, así que el vídeo sube una vez, en `denuncia_crear`. Y un campo ausente
  > en el envío final ya no reescribe el guardado: enviar sin `tipo` convertía la denuncia en «Otro»
  > y borraba sus coordenadas. `denuncias` **no tiene proyección pública**: `denuncias_listar` la lee
  > desde la Function, exige sesión y redondea el GPS a 2 decimales; la ruta del vídeo no sale nunca
  > y su URL la firma `denuncia_video` (acción nueva, 120 s) al pulsar play, en vez de las 50 URLs de
  > una hora que el legado emitía en cada apertura de la lista. La identidad es el `uid` del ID
  > token, no el correo del cuerpo de la petición.

### denuncias_listar (`index.ts:1541-1554`)

- **Auth:** anon; **Cubo:** `lectura`.
- **Entrada:** ninguna.
- **Efectos (lectura):** vista `denuncias_public` (`id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado`),
  `order created_at desc`, `limit 50`; por cada fila con `video_path`, URL firmada 3600 s del
  bucket `denuncias`.
- **Respuesta:** `{ denuncias: [{ id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado, video_url: string ('' si no hay video o falla la firma) }] }`.
- **Notas:** N+1 llamadas de firma. Expone GPS exacto del denunciante públicamente (el legado no
  redondea); Firebase puede redondear como `ofertaPublicaUI`.

### admin_denuncias (`index.ts:1555-1568`)

- **Auth:** admin; **Cubo:** `admin` (60/h).
- **Entrada:** ninguna (además de `adminKey`).
- **Efectos (lectura):** `denuncias select *` `order created_at desc` `limit 100` + `video_url`
  firmada 3600 s.
- **Respuesta:** `{ denuncias: [{ id, created_at, email, nombre, rol, tipo, gps_lat, gps_lng, gps_precision, video_path, duracion_s, texto, factura_token, origen, estado, archivado_at, video_url }] }`.

### admin_denuncia_estado (`index.ts:1569-1576`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `id` texto 40 (uuid); `estado` opción `Recibida | En revisión | Atendida` (otro valor → `Recibida`).
- **Validaciones:** ninguna explícita (un `id` inexistente no falla: `update` de 0 filas).
- **Efectos:** `update denuncias { estado } where id`.
- **Respuesta:** `{ estado: string }`.

### admin_damnificados (`index.ts:1577-1590`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `familias_damnificadas select *` `order created_at desc` `limit 300`;
  por cada ruta en `fotos` (jsonb), URL firmada 3600 s del bucket `damnificados` (las que fallan se omiten).
- **Respuesta:** `{ familias: [{ …todas las columnas de familias_damnificadas…, fotos_urls: string[] }] }`.
- **Notas:** hasta 300 × 12 firmas por llamada.

### admin_damnificado_estado (`index.ts:1591-1598`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `id` texto 40 (uuid); `estado` opción `nuevo | contactado | atendido` (otro → `nuevo`).
- **Efectos:** `update familias_damnificadas { estado } where id`.
- **Respuesta:** `{ estado: string }`.

### admin_viajes_atrasados (`index.ts:1599-1604`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** vista `viajes_atrasados` (1.19)
  `select id, transportista, email, eta_minutos, token_publico, objetivo, tramo, transcurrido_min`,
  `order transcurrido_min desc`, `limit 100`.
- **Respuesta:** `{ viajes: [{ id: uuid, transportista, email, eta_minutos, token_publico, objetivo, tramo: 1 | 2, transcurrido_min: number }] }`.
- **Notas:** umbrales: tramo 1 = `eta_minutos + 120` min desde `paso1_ts`; tramo 2 = 120 min desde
  `paso2_ts`. Firebase necesita una consulta equivalente (o un campo `vence_alerta_ts` precalculado).

### admin_viaje_resolver (`index.ts:1605-1614`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `id` texto 40 (uuid del viaje), req.
- **Validaciones:** vacío → `"id requerido"`.
- **Efectos:** `update viajes { resuelto: true } where id`.
- **Respuesta:** `{ resuelto: true }`.
- **Notas:** libera la reserva (`reservaViva` → `null`) y saca el viaje de `viajes_atrasados`;
  no cambia el estado de la factura.

### admin_denuncia_crear (`index.ts:1615-1634`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `facturaToken` texto 24 mayúsculas (opcional), `transportista` texto 120 (por
  defecto `'desconocido'`), `horas` entero `clamp(round(n), 0, 999)`, `tramo` = `2` si `n(p.tramo) === 2`, si no `1`.
- **Validaciones:** ninguna.
- **Efectos:**
  1. `insert denuncias { email: 'administracion@sistema.local', nombre: 'Administración', rol: 'admin', tipo: 'Retención de insumos', texto: \`Generada por administración: el transportista ${transportista} no se reportó; retraso de ${horas} h en el tramo ${tramo}.\`, factura_token: facturaToken || null, origen: 'admin', estado: 'Recibida' }` (sin video).
  2. Si `facturaToken` existe en `facturas`: `insert movimientos_factura { tipo: 'Denuncia', descripcion: mov('denunciaRegistrada', {}), monto: 0 }`.
- **Respuesta:** `{ id: string (uuid), estado: 'Recibida' }`.
- **Notas:** el texto se compone en el backend en español canónico (solo-admin).

### panel_crear (`index.ts:1635-1664`)

- **Auth:** anon; **Cubo:** `publico` (no `panel`).
- **Entrada:**

| Campo | Tipo | Límite / regex | Req. | Por defecto |
|---|---|---|---|---|
| `pin` | texto | `s(…, 12)` debe cumplir `/^[0-9]{4,8}$/` | sí | — |
| `nombre` | texto (nombre del centro **nuevo**) | 120 | sí | — |
| `email` | email | `emailNorm` | sí | — |
| `telefono` | texto | 40; ≥ 7 dígitos | sí | — |
| `fotoCedula`, `fotoSitio` | dataURL imagen | `guardarFoto` 1,8 MB | sí | — |
| `tipo` | texto | 40 (sin lista, vía `obtenerOCrearLugar`) | no | `'Centro'` |
| `ubicacion` | texto | 300 | no | `''` |
| `lat`, `lng` | número | `geoValida` | no | — |

- **Validaciones (en orden):**
  1. PIN inválido → `"El PIN debe tener de 4 a 8 dígitos"`.
  2. `nombre` vacío → `"nombre requerido"`.
  3. Correo inválido → `"correo electrónico válido requerido"`.
  4. Teléfono con < 7 dígitos → `"teléfono requerido"`.
  5. `!p.fotoCedula` → `"Falta la foto de la cédula de la persona responsable"`.
  6. `!p.fotoSitio` → `"Falta la foto del sitio del centro"`.
  7. `lugares` por `nombre` ya existe → `"Este centro ya está registrado. Pide al administrador que genere el acceso del panel."`
  8. Errores de `guardarFoto` (`cedula`, `sitio`).
- **Efectos:**
  1. `obtenerOCrearLugar(p)` → crea el lugar (nuevo por la comprobación anterior).
  2. Storage `registro-transportistas`: `centros/<lugarId>/cedula.<ext>`, `centros/<lugarId>/sitio.<ext>`.
  3. `token = tokenAlfa('CTR')`; `salt = crypto.randomUUID()`.
  4. `insert centros_panel { lugar_id, token_centro: token, pin_hash: sha256Hex(salt + pin), pin_salt: salt, email, foto_cedula, foto_sitio }` (`creado = now()`).
  5. `historial(nombre, '', 'Panel de centro creado', 'panel')`.
- **Respuesta:** `{ token: string (CTR-…) }` (el PIN no se devuelve: lo eligió el usuario).
- **Notas:** el lugar se crea **antes** de subir las fotos; si una foto falla, queda un centro sin
  panel que ya no puede auto-reclamarse (solo `admin_regenerar_panel`). Firebase: validar/subir
  primero y crear lugar + panel en una transacción. `centros_panel.lugar_id` y `token_centro` son
  `unique`. Comprobación existe/crea no atómica (carrera → error `23505` crudo).

### panel_ver (`index.ts:1665-1668`)

- **Auth:** panel (`token` + `pin`); **Cubo:** `panel` (120/h por token).
- **Entrada:** `token` texto 24 (mayúsculas), `pin` texto 12.
- **Validaciones:** las de `autenticarPanel` (1.6).
- **Efectos:** lectura `verPanel(lugar_id)`.
- **Respuesta:** `{ lugar: { id, tipo, nombre, ubicacion, telefono, lat, lng, actualizado }, insumos: [{ id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad }] }`.

### panel_actualizar_lugar (`index.ts:1669-1681`)

- **Auth:** panel; **Cubo:** `panel`.
- **Entrada:** `token`, `pin`; `tipo` opción `Centro | Hospital | Refugio` (otro valor → se ignora);
  `ubicacion` texto 300 (vacío → se ignora); `telefono` texto 40 (vacío → se ignora; sin mínimo de
  dígitos); `lat`, `lng` (`geoValida`; inválidos → se ignoran).
- **Validaciones:** solo `autenticarPanel`.
- **Efectos:**
  1. `update lugares { actualizado: now, tipo?, ubicacion?, telefono?, lat?, lng? } where id = lugar_id`.
  2. `historial(nombreDeLugar(lugar_id), '', 'Datos del centro actualizados desde el panel', 'panel')`.
- **Respuesta:** `verPanel(lugar_id)` (misma forma que `panel_ver`).
- **Notas:** no permite vaciar campos ni cambiar `nombre`.

### panel_insumo (`index.ts:1682-1705`)

- **Auth:** panel; **Cubo:** `panel`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `token`, `pin` | — | `autenticarPanel` | sí | — |
| `insumoNombre` | texto | 120 | sí | — |
| `estado` | opción | `Necesita \| Disponible \| Cubierto` | no | `'Necesita'` |
| `cantidadNecesaria` | número | `Math.max(0, n) \|\| 1` (0 o negativo → **1**) | no | `1` |
| `cantidadRecibida` | número | `Math.max(0, n)` | no | `0` |
| `unidad` | texto | 30 | no | `'unidades'` |
| `categoria` | texto | 60 | no | `'General'` |
| `urgencia` | opción | `Alta \| Normal \| Baja` (`s(…, 12)`) | no | `'Normal'` |

- **Validaciones:** `autenticarPanel`; `insumoNombre` vacío → `"insumo requerido"`.
- **Efectos (en orden):**
  1. Lee `previo = insumos.cantidad_recibida` del insumo (`lugar_id`, `nombre`) si existe.
  2. `upsert insumos { lugar_id, nombre, categoria, estado, cantidad_necesaria: necesaria, cantidad_recibida: recibida, urgencia, unidad, actualizado: now }` con `onConflict: 'lugar_id,nombre'` (sobrescribe **todas** las columnas).
  3. `update lugares { actualizado: now } where id = lugar_id`.
  4. `centro = nombreDeLugar(lugar_id)`.
  5. `historial(centro, nombre, \`Panel: ${nombre} (${estado}, ${recibida} de ${necesaria})\`, 'panel', recibida)`.
  6. `registrarEntrega(centro, nombre, unidad, delta = recibida - (previo ?? 0), recibida, necesaria)`:
     busca la factura `Abierta` con `objetivo = \`${nombre} → ${centro}\``; si existe y `delta > 0`
     → movimiento `recepcionConfirmada { delta, unidad }` (tipo `Entrega`, monto `delta`); si
     `recibida >= necesaria` (necesaria siempre ≥ 1 aquí) → movimiento `necesidadCubierta {}` y
     `update facturas { estado: 'Cerrada', fecha_cierre: now }`.
- **Respuesta:** `verPanel(lugar_id)`.
- **Notas:** el `estado` del insumo **no** pasa solo a `Cubierto`: lo decide el centro. Un ajuste a
  la baja (`delta < 0`) no deja movimiento. Como `registrarEntrega` solo mira la factura `Abierta`,
  una necesidad ya `Cerrada` que vuelve a recibir no reabre nada. Lectura-luego-escritura sin
  transacción (delta puede calcularse sobre un `previo` desactualizado).

### panel_insumo_borrar (`index.ts:1706-1716`)

- **Auth:** panel; **Cubo:** `panel`.
- **Entrada:** `token`, `pin`, `insumoNombre` texto 120 (sin comprobación de vacío: `''` no borra nada).
- **Validaciones:** `autenticarPanel`.
- **Efectos:** `delete insumos where lugar_id and nombre`;
  `historial(nombreDeLugar(lugar_id), nombre, \`Panel: insumo ${nombre} retirado\`, 'panel')`
  (se escribe aunque no existiera el insumo).
- **Respuesta:** `verPanel(lugar_id)`.
- **Notas:** no toca la factura de necesidad asociada (queda `Abierta`).

### admin_crear_factura (`index.ts:1717-1732`)

- **Auth:** admin; **Cubo:** `admin` (60/h).
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `adminKey` | texto | 64 (1.6) | sí | — |
| `objetivo` | texto | 200 | sí | — |
| `montoRequerido` | número | `n()`, debe ser `> 0` | sí | — |
| `descripcion` | texto | 500 | no | `''` |

- **Validaciones (en orden):**
  1. `objetivo` vacío → `"objetivo requerido"`.
  2. `montoRequerido <= 0` → `"montoRequerido debe ser mayor que 0"`.
- **Efectos:**
  1. RPC `factura_numero_siguiente()` (error → se propaga tal cual) →
     `numero = \`FAC-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}\`` (1.3).
  2. `token = tokenAlfa('DV')`.
  3. `insert facturas { numero_factura: numero, token_publico: token, objetivo, descripcion, monto_requerido: montoReq }`;
     por defecto de columna `estado = 'Abierta'`, `monto_recaudado = 0`, `fecha_creacion = now()`.
  4. `historial('Administración', '', \`Factura ${numero} creada: ${objetivo}\`, 'admin')`.
- **Respuesta:** `{ numeroFactura: string, token: string }`.
- **Notas:** es la factura de sabor «Manual» (1.14): la `descripcion` es texto libre, así que
  `metaPresupuesto`/`metaOferta` devuelven `null` y la factura **no** aparece en
  `listar_presupuestos`, `listar_comprados` ni `listar_ofertas`; solo se ve por
  `seguimiento_factura` con su token. No comprueba duplicados de `objetivo`. La secuencia se
  consume aunque el `insert` falle después (huecos en la numeración).

### admin_crear_vacante (`index.ts:1733-1752`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:**

| Campo | Tipo | Límite / opciones | Req. | Por defecto |
|---|---|---|---|---|
| `lugarTipo` | opción | `s(…, 40)` ∈ `Centro \| Hospital \| Refugio \| Zona de derrumbe` | no | `'Centro'` |
| `lugarNombre` | texto | 120 | sí | — |
| `rol` | texto | 80 | sí | — |
| `cantidad` | número | `n()`, `0 < x <= 10_000` | sí | — |
| `ubicacion` | texto | 160 | no | `''` |
| `descripcion` | texto | 400 | no | `''` |
| `urgencia` | opción | `s(…, 12)` ∈ `Alta \| Normal \| Baja` | no | `'Normal'` |
| `turno` | texto | 80 | no | `''` |
| `telefono` | texto | 40 (sin mínimo de dígitos) | no | `''` |

- **Validaciones (en orden):**
  1. `lugarNombre` vacío → `"nombre del lugar o zona requerido"`.
  2. `rol` vacío → `"tipo de voluntario requerido"`.
  3. `cantidad <= 0 || cantidad > 10_000` → `"cantidad inválida"`.
- **Efectos:**
  1. `insert vacantes_voluntarios { lugar_tipo, lugar_nombre, ubicacion, rol, descripcion,
     cantidad_necesaria: cantidad, urgencia, turno, telefono }` → `select('id').single()`
     (error → se propaga). Por defecto de columna: `cantidad_cubierta = 0`, `estado = 'Abierta'`,
     `fecha_creacion = now()`, `actualizado = now()`.
  2. `historial(lugarNombre, '', \`Vacante de voluntariado: ${cantidad} × ${rol} (${lugarTipo})\`, 'admin', cantidad)`
     (el separador es `×`, U+00D7).
- **Respuesta:** `{ id: number (bigint) }`.
- **Notas:** `lugar_nombre` es texto libre, **no** una FK a `lugares` (una vacante puede apuntar a
  una zona de derrumbe que no es un centro). `lugarTipo` y `urgencia` fuera de lista no dan error:
  caen al valor por defecto. La entrada del historial se escribe con el nombre del lugar aunque ese
  lugar no exista en `lugares`.

### admin_actualizar_vacante (`index.ts:1753-1765`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `id` | número | `n()`, debe ser `> 0` | sí | — |
| `cantidadCubierta` | número | se aplica **solo si `p.cantidadCubierta != null`**; valor = `Math.max(0, n(…))` | no | no se toca |
| `estado` | opción | `s(…, 20)` ∈ `Abierta \| Cubierta \| Cerrada`; fuera de lista → no se toca | no | no se toca |

- **Validaciones:**
  1. `id <= 0` → `"id requerido"`.
  2. Si el `id` no existe, `.single()` sobre 0 filas devuelve error de PostgREST y se propaga
     **crudo** (`"JSON object requested, multiple (or no) rows returned"`).
- **Efectos:**
  1. `update vacantes_voluntarios { actualizado: now, cantidad_cubierta?, estado? } where id`
     → `select('id, lugar_nombre, rol, estado, cantidad_cubierta').single()`.
  2. `historial(fila.lugar_nombre, '', \`Vacante ${fila.rol}: ${fila.estado}, ${fila.cantidad_cubierta} cubiertos\`, 'admin')`.
- **Respuesta:** `{}` (solo `{ success: true }`; la fila leída no se devuelve).
- **Notas:** `actualizado` se toca **siempre**, aunque no cambie nada más. No valida
  `cantidad_cubierta <= cantidad_necesaria` ni cierra la vacante automáticamente al cubrirla: el
  estado lo pone el admin a mano. `p.cantidadCubierta = 0` sí se aplica (la comprobación es
  `!= null`, no truthiness); `null` y ausente se ignoran.

### admin_listar_vacantes (`index.ts:1766-1771`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna (además de `adminKey`).
- **Efectos (lectura):** `vacantes_voluntarios select id, lugar_tipo, lugar_nombre, ubicacion, rol,
  cantidad_necesaria, cantidad_cubierta, urgencia, turno, estado` `order fecha_creacion desc`
  `limit 100`. **No comprueba `error`**: un fallo de PostgREST devuelve `{ vacantes: [] }` con
  `success: true`.
- **Respuesta:** `{ vacantes: [{ id, lugar_tipo, lugar_nombre, ubicacion, rol, cantidad_necesaria, cantidad_cubierta, urgencia, turno, estado }] }`.
- **Notas:** no devuelve `descripcion`, `telefono` ni `fecha_creacion` (sí se leen por
  `admin_datos_listar` sobre la entidad `vacantes_voluntarios`, sección 4). Sin paginación: la
  vacante 101 es invisible desde aquí.

### admin_listar_rescatistas (`index.ts:1772-1778`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `rescatistas select id, nombre, organizacion, telefono, especialidad,
  estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones,
  fecha_registro` `order fecha_registro desc` `limit 100`. Error → se propaga.
- **Respuesta:** `{ rescatistas: [{ …esas columnas… }] }`.
- **Notas:** incluye el **teléfono**, que la vista pública `rescatistas_public` no expone. Sin
  paginación ni búsqueda (para eso está `admin_datos_listar`).

### admin_listar_voluntarios (`index.ts:1779-1789`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `voluntarios select id, nombre, apellido, email, telefono, estado, ciudad,
  profesion, disponibilidad, medio_transporte, observaciones, fecha_registro`
  `order fecha_registro desc` `limit 200`. Error → se propaga.
- **Respuesta:** `{ voluntarios: [{ …esas columnas… }] }`.
- **Notas:** expone `email` y `telefono`, que **no** están en la vista pública (decisión S2 del
  legado: los datos de contacto solo se ven autenticado como admin). No devuelve `foto_cedula`
  (para verla hay que pasar por `admin_datos_ficha`, que firma la URL).

### admin_datos_entidades (`index.ts:1790-1798`)

- **Auth:** admin; **Cubo:** `admin_lectura` (600/h).
- **Entrada:** ninguna.
- **Validaciones:** ninguna.
- **Efectos:** ninguno (solo lee la constante `ENTIDADES` en memoria; no toca la base).
- **Respuesta:**
  ```json
  { "entidades": [
    { "id": "lugares", "etiqueta": "…", "pk": "id", "borrado": "fisico",
      "columnas": [ { "id": "tipo", "tipo": "opcion", "opciones": ["Centro","Hospital","Refugio"], "requerido": true } ],
      "fotos": ["foto_cedula"],
      "hijos": [ { "etiqueta": "insumos", "modo": "cascade" } ] } ] }
  ```
  `columnas` es el array `editables` **íntegro** (los `ColDef` tal cual, con `max`, `opciones`,
  `minNum`, `maxNum`, `requerido`), pensado para que el cliente pinte el formulario y valide antes
  de enviar. `fotos` son solo los nombres de campo; `hijos` solo `etiqueta` + `modo` (nunca la
  tabla ni la FK reales).
- **Notas:** el orden de `entidades` es el de declaración de `ENTIDADES` (`Object.entries`):
  `lugares`, `insumos`, `voluntarios`, `motorizados`, `rescatistas`, `centros_panel`,
  `vacantes_voluntarios`, `personas`. `etiqueta` aquí es el **nombre de la columna humana** de la
  entidad (p. ej. `'nombre'`, `'token_centro'`, `'rol'`), no un rótulo traducible. El catálogo
  completo está en la sección 4.

### admin_datos_listar (`index.ts:1799-1816`)

- **Auth:** admin; **Cubo:** `admin_lectura` (600/h).
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `entidad` | texto | `s(…, 40)`, clave de `ENTIDADES` | sí | — |
| `porPagina` | número | `Math.min(100, Math.max(5, Math.round(n(x)) || 25))` | no | `25` |
| `pagina` | número | `Math.max(1, Math.round(n(x)) || 1)` | no | `1` |
| `busca` | texto | 80 | no | `''` |

- **Validaciones:**
  1. `entidadDe(p.entidad)` → `"Ese dato no se puede editar desde aquí"` (1.18) si no está en la
     lista blanca.
  2. Error de PostgREST → se propaga **crudo** (aquí no se traduce con `mensajeDePostgres`).
- **Efectos (lectura):**
  1. `from(def.tabla).select(def.lectura.join(', '), { count: 'exact' })`.
  2. Si `busca` y `def.buscar.length`: `limpio = busca.replace(/[(),*]/g, ' ').trim()`; si queda
     algo, `q.or(def.buscar.map(c => \`${c}.ilike.%${limpio}%\`).join(','))`.
  3. `.order(def.orden, { ascending: def.ordenAsc }).range(desde, desde + porPagina - 1)` con
     `desde = (pagina - 1) * porPagina`.
- **Respuesta:** `{ filas: object[], total: number, pagina: number, porPagina: number }`
  (`filas` trae exactamente las columnas de `def.lectura`, sección 4; `total` es el `count exact`
  **tras** el filtro de búsqueda).
- **Notas:** `(`, `)`, `,` y `*` se sustituyen por espacios porque romperían la sintaxis del filtro
  `or` de PostgREST — no es escapado, es borrado. Los comodines `%` y `_` que escriba el usuario
  **sí** llegan al `ilike` (una búsqueda de `%` lista todo). La búsqueda no quita acentos
  (a diferencia de `normaClave`). `porPagina` sin tope superior real: 100. Página fuera de rango →
  `filas: []` con el `total` correcto.

### admin_datos_ficha (`index.ts:1817-1826`)

- **Auth:** admin; **Cubo:** `admin_lectura` (600/h).
- **Entrada:** `entidad` (clave de `ENTIDADES`); `id` (se normaliza con `idDe(def, id)`:
  `s(id, 60)` si `pkTexto`, si no `Math.round(n(id))`).
- **Validaciones:**
  1. `entidadDe` → `"Ese dato no se puede editar desde aquí"`.
  2. `filaPorId` devuelve `null` → `"No se encontró ese registro"`.
- **Efectos (lectura):** `filaPorId(def, id)` (1.18) + `fotosFirmadas(def, fila)` (URLs firmadas de
  3600 s, las que fallen se omiten) + `dependientesDe(def, id)` (un `count exact` por hijo).
- **Respuesta:** `{ fila: object, fotos: [{ campo: string, url: string }], dependientes: [{ etiqueta: string, cuantos: number, modo: 'cascade' | 'null' }] }`.
- **Notas:** es la única vía por la que el admin ve las fotos privadas de voluntarios, motorizados
  y centros (`registro-transportistas`). `dependientes` solo lista los hijos con `cuantos > 0`.
  Con `centros_panel` la ficha **nunca** trae `pin_hash` ni `pin_salt` (no están en `lectura`).

### admin_datos_crear (`index.ts:1827-1843`)

- **Auth:** admin; **Cubo:** `admin` (60/h — **no** es lectura).
- **Entrada:** `entidad`; `campos` objeto `{ <columna>: valor }` (por defecto `{}`);
  `forzar` booleano (solo `=== true` cuenta).
- **Validaciones (en orden):**
  1. `entidadDe` → `"Ese dato no se puede editar desde aquí"`.
  2. `camposValidados(def, p.campos ?? {}, false)` (1.18, modo **no parcial**): clave no editable →
     `` `Ese dato no se puede editar desde aquí: ${k}` ``; por columna, los errores de
     `valorValidado` (`` `${id}: el mínimo es …` ``, `` `${id}: correo electrónico inválido` ``,
     `` `${id}: esa coordenada cae fuera de Venezuela` ``, `` `${id}: teléfono demasiado corto` ``,
     `` `${id}: ese valor no está permitido` ``, `` `${id}: hay que elegir un centro` ``);
     `requerido` vacío → `` `${id}: es obligatorio` ``; `refLugar` inexistente →
     `` `${id}: ese centro no existe` ``; sin columnas → `"No hay nada que guardar"`.
  3. Error de inserción → `mensajeDePostgres(error)` (`"Ya existe un registro con ese valor único"`,
     `"Ese registro está enlazado con otro y no se puede guardar así"`,
     `"Falta un campo obligatorio"`, o el mensaje crudo recortado a 200).
- **Efectos (en orden):**
  1. `duplicadosDe(def, datos, null)` (1.18). Si hay duplicados **y** `p.forzar !== true` →
     **sale sin insertar nada** devolviendo `{ duplicados }`.
  2. Si `def.pkTexto`: `datos[def.pk] = (def.prefijoId || 'REG') + crypto.randomUUID().slice(0, 8).toUpperCase()`
     (p. ej. `VOL3F9A1C2B` — mayúsculas, a diferencia del id en minúsculas que generan los
     registros públicos, 1.3).
  3. `insert def.tabla` → `select(def.lectura.join(', ')).single()`.
  4. `auditar(req, 'crear', s(p.entidad, 40), fila[def.pk], null, fila)` (1.12).
- **Respuesta:**
  - Duplicado sin forzar: `{ duplicados: [{ id, etiqueta, porque }] }` **con `success: true`**
    (el cliente debe distinguir este caso por la ausencia de `fila`).
  - Creado: `{ fila: object, duplicados: [] }`.
- **Notas:** al ser modo no parcial, **toda** columna `editable` ausente se evalúa con `''`: los
  `texto` quedan `''`, los `numero` `0` (y por eso crear una `vacantes_voluntarios` sin
  `cantidad_necesaria` falla con `"cantidad_necesaria: el mínimo es 1"`), los `lat`/`lng` `null` y
  las `opcion` requeridas fallan con `"…: ese valor no está permitido"`. `duplicadosDe` solo mira
  las primeras 2000 filas de la tabla: en tablas grandes puede no detectar el duplicado.

### admin_datos_editar (`index.ts:1844-1856`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `entidad`; `id`; `campos` objeto parcial; `forzar` booleano.
- **Validaciones (en orden):**
  1. `entidadDe` → `"Ese dato no se puede editar desde aquí"`.
  2. `filaPorId` `null` → `"No se encontró ese registro"`.
  3. `camposValidados(def, campos, true)` (modo **parcial**: las columnas ausentes se saltan, las
     presentes se validan igual que en crear); sin columnas → `"No hay nada que guardar"`.
  4. Error de `update` → `mensajeDePostgres(error)`.
- **Efectos (en orden):**
  1. `antes = filaPorId(def, p.id)`.
  2. `duplicadosDe(def, { ...antes, ...datos }, p.id)` — compara la fila **resultante**, excluyéndose
     a sí misma. Con duplicados y `forzar !== true` → sale sin escribir.
  3. `update def.tabla set datos where def.pk = idDe(def, p.id)` → `select(def.lectura).single()`.
  4. `auditar(req, 'editar', s(p.entidad, 40), p.id, antes, data)`.
- **Respuesta:**
  - Duplicado sin forzar: `{ duplicados: [{ id, etiqueta, porque }] }`.
  - Editado: `{ fila: object, cambiados: string[] }` (`cambiados = Object.keys(datos)`: las columnas
    **enviadas y validadas**, no las que realmente cambiaron de valor).
- **Notas:** `fila_id` en la bitácora se guarda como `String(p.id)` **sin** normalizar por `idDe`,
  así que un id numérico enviado como `"7 "` queda auditado con el espacio (y `admin_datos_deshacer`
  lo vuelve a pasar por `idDe`, que sí lo normaliza). Editar el `nombre` de un `lugar` no renombra
  el `objetivo` de las facturas ni las entradas de `historial_movimientos`, que guardan el nombre
  como texto: se rompe el enlace lógico (ver 1.13/1.14).

### admin_datos_duplicados (`index.ts:1857-1878`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `entidad`.
- **Validaciones:** `entidadDe` → `"Ese dato no se puede editar desde aquí"`.
- **Efectos (lectura):**
  1. Si `def.naturales` está vacío (`insumos` sí tiene, `centros_panel` no) → devuelve `{ grupos: [] }`
     sin consultar nada.
  2. `cols = [...new Set([def.pk, def.etiqueta, ...naturales.flatMap(x => x.campos)])]`;
     `select(cols) limit 2000` (**sin `order`**: son «2000 filas cualesquiera»).
  3. Por cada clave natural agrupa en memoria con `normaClave(valor, nat.norma)` (1.18); las filas
     con alguna parte vacía se descartan; los grupos con más de una fila se emiten.
- **Respuesta:** `{ grupos: [{ porque: string /* campos.join(' + ') */, clave: string /* partes normalizadas unidas por '|' */, filas: [{ id, etiqueta: string }] }] }`.
- **Notas:** solo informa, no fusiona ni borra. La misma fila puede salir en varios grupos (por
  correo y por teléfono). El tope de 2000 filas es el mismo de `duplicadosDe` y hace la detección
  incompleta en tablas grandes. `etiqueta` cae en `String(fila[def.pk])` cuando la columna humana
  es nula.

### admin_bitacora (`index.ts:1879-1891`)

- **Auth:** admin; **Cubo:** `admin` (60/h; **no** es una de las tres lecturas con cubo propio).
- **Entrada:** `pagina` número (`Math.max(1, Math.round(n(x)) || 1)`, por defecto `1`);
  `entidad` texto 40 (opcional, filtro exacto `eq`; **no** se valida contra `ENTIDADES`).
- **Validaciones:** ninguna; error de PostgREST → se propaga crudo.
- **Efectos (lectura):** `auditoria_admin select id, fecha, ip, accion, entidad, fila_id, antes,
  despues` con `count: 'exact'`, `eq('entidad', ent)` si se envía, `order fecha desc`,
  `range(desde, desde + 39)` con `porPagina = 40` fijo (no configurable).
- **Respuesta:** `{ cambios: [{ id, fecha, ip, accion, entidad, fila_id, antes, despues }], total: number, pagina: number }`
  (no devuelve `porPagina`, a diferencia de `admin_datos_listar`).
- **Notas:** `antes`/`despues` son los `jsonb` completos de la fila (1.12), incluidas columnas
  sensibles de la entidad (correos, teléfonos). En `borrar`, `antes` tiene la forma
  `{ fila, dependientes }`. Expone la `ip` del admin que hizo cada cambio. La bitácora **no** se
  puede purgar desde la web (`auditoria_admin` está fuera de `ENTIDADES`).

### admin_datos_deshacer (`index.ts:1892-1914`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `auditoriaId` número (`Math.round(n(p.auditoriaId))`).
- **Validaciones (en orden):**
  1. Sin fila en `auditoria_admin` → `"No se encontró ese cambio en la bitácora"`.
  2. `reg.accion !== 'editar'` → `"Solo se puede deshacer una edición"` (no se deshacen `crear`,
     `borrar` ni un `deshacer` previo).
  3. `entidadDe(reg.entidad)` → `"Ese dato no se puede editar desde aquí"` (protege contra una
     entidad retirada de la lista blanca después del cambio).
  4. `camposValidados(def, soloEditables, true)`: los mismos mensajes que editar; sin columnas →
     `"No hay nada que guardar"`.
  5. `filaPorId(def, reg.fila_id)` `null` → `"Ese registro ya no existe"`.
  6. Error de `update` → `mensajeDePostgres(error)`.
- **Efectos (en orden):**
  1. Lee `auditoria_admin select id, accion, entidad, fila_id, antes` por `id` (`maybeSingle`).
  2. Filtra `antes` **por la lista blanca vigente**: solo las claves que hoy son `editables`
     (`Object.prototype.hasOwnProperty`), de modo que deshacer nunca escribe una columna que una
     edición normal no podría tocar.
  3. `datos = camposValidados(def, soloEditables, true)` (revalida los valores viejos con las
     reglas de hoy).
  4. `actual = filaPorId(def, reg.fila_id)`.
  5. `update def.tabla set datos where def.pk = idDe(def, reg.fila_id)` → `select(def.lectura).single()`.
  6. `auditar(req, 'deshacer', String(reg.entidad), reg.fila_id, actual, data)` — el deshacer
     genera **su propia** entrada de bitácora (y no es deshacible: su `accion` es `'deshacer'`).
- **Respuesta:** `{ fila: object }`.
- **Notas:** deshacer **no** comprueba duplicados (`duplicadosDe` no se llama) y **no** verifica que
  la fila siga como la dejó esa edición: deshacer un cambio antiguo pisa todo lo posterior. Si una
  columna dejó de ser editable, ese valor sencillamente no se restaura (silencio, no error). Si las
  reglas se endurecieron (p. ej. un teléfono viejo con 5 dígitos), la restauración falla con
  `"telefono: teléfono demasiado corto"`.
  > **Divergencia deliberada en Firebase (Task 3.7, 2026-09-07).** `auditoriaId` es **texto** (el id
  > de un documento de Firestore no es un entero autoincremental), y deshacer **nunca restaura un
  > correo**: `auditar` los enmascara al escribir la bitácora, así que restaurarlo desde ahí dejaría
  > `a***@x.local` como correo real del registro —y pasaría la validación sin protestar—. Lo que la
  > bitácora no guarda no se puede deshacer. La búsqueda de `admin_datos_listar` ya no es un `ilike`:
  > es un filtro en memoria sobre una ventana de 500 documentos, sin acentos y sin comodines que
  > romper (en el legado, buscar `%` listaba la tabla entera). Ni la ficha ni la lista devuelven URLs
  > firmadas: dan la **ruta**, y la consola firma la foto que abre. Un insumo se direcciona con
  > `<lugarId>/<clave>` porque vive en la subcolección de su centro, y `centros_panel` no se crea
  > desde la consola: su credencial es un claim de Auth, no una fila que se pueda teclear.

### admin_datos_borrar (`index.ts:1915-1933`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `entidad`; `id`; `confirmar` texto (el usuario teclea la etiqueta de la fila).
- **Validaciones (en orden):**
  1. `entidadDe` → `"Ese dato no se puede editar desde aquí"`.
  2. `filaPorId` `null` → `"No se encontró ese registro"`.
  3. `esperado = normaClave(antes[def.etiqueta], 'texto')`; si `esperado` está vacío **o**
     `normaClave(p.confirmar, 'texto') !== esperado` →
     `"Escribe el nombre del registro para confirmar el borrado"`. La comparación va sin acentos,
     en minúsculas y con espacios colapsados (1.18), así que «Hospital  Vargas» ≡ «hospital vargas».
     Una fila con la etiqueta vacía o nula **no se puede borrar desde la consola**.
  4. Error de `delete` → `mensajeDePostgres(error)` (típicamente `23503`
     `"Ese registro está enlazado con otro y no se puede guardar así"` cuando un hijo con FK
     `on delete restrict`/`no action` lo impide).
- **Efectos (en orden):**
  1. `dependientes = dependientesDe(def, p.id)` — se cuentan **antes** del borrado, porque tras la
     cascada ya no hay a quién contar.
  2. `delete from def.tabla where def.pk = idDe(def, p.id)` (borrado **físico**: `def.borrado` es
     siempre `'fisico'`; no hay archivado).
  3. `auditar(req, 'borrar', s(p.entidad, 40), p.id, { fila: antes, dependientes }, null)` — la
     bitácora guarda la fila entera y lo que se llevó por delante: es lo único que queda.
- **Respuesta:** `{ borrado: true, dependientes: [{ etiqueta, cuantos, modo }] }`.
- **Notas:** no borra los archivos de Storage asociados (`foto_cedula`, `foto_sitio`,
  `foto_placa`, `foto_vehiculo` quedan huérfanos en el bucket). Borrar un `lugar` arrastra en
  cascada sus `insumos` y su `centros_panel` (1.13), dejando el panel del centro inaccesible.
  Borrar un `motorizado` pone a `null` la FK de sus `trayectos` y `donaciones_motorizados`
  (modo `'null'`). El borrado **no** es transaccional con la bitácora: si `auditar` falla, la fila
  ya está borrada y solo queda la línea en los logs de la función (1.12).

### admin_crear_presupuesto (`index.ts:1934-1976`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:**

| Campo | Tipo | Límite | Req. | Por defecto |
|---|---|---|---|---|
| `centro` | texto | 120; debe existir en `lugares.nombre` (exacto) | sí | — |
| `insumo` | texto | 120 | sí | — |
| `tienda` | texto | 100 | sí | — |
| `direccion` | texto | 160 | no | `''` |
| `cantidad` | número | `n()`, `> 0` (sin tope) | sí | — |
| `presentacion` | texto | 140 | no | `''` |
| `precio` | número | `n()`, `0 < x <= 100_000_000` (Bs) | sí | — |
| `necesidadId` | texto | 40 (id del `insumos` de origen) | no | `null` en el JSON |
| `tiendaLat`, `tiendaLng` | número | `Number()`; finitos, `\|lat\| <= 90`, `\|lng\| <= 180` (**no** la caja de Venezuela) | sí | — |
| `tiendaUrl` | texto | 300; si no está vacío debe cumplir `/^https?:\/\//i` | no | `null` en el JSON |
| `adjunto` | dataURL | `guardarAdjunto` (cualquier MIME, 100 B–5 MB) | no | `null` en el JSON |

- **Validaciones (en orden):**
  1. `!centro || !insumo || !tienda` → `"centro, insumo y tienda requeridos"`.
  2. `cantidad <= 0` → `"cantidad debe ser mayor que 0"`.
  3. `precio <= 0 || precio > 100_000_000` → `"precio inválido"`.
  4. Coordenadas no finitas o fuera de ±90/±180 → `"marca la tienda en el mapa"`.
  5. `tiendaUrl` no vacía sin `http(s)://` → `"la URL de la tienda debe empezar por http(s)://"`.
  6. `lugares` sin fila con `nombre = centro` → `"Centro no encontrado"`.
  7. Errores de `guardarAdjunto` (1.8): `"adjunto inválido"`, `"adjunto vacío"`,
     `"adjunto demasiado grande (máx 5 MB)"`, `"no se pudo guardar el adjunto"`.
- **Efectos (en orden):**
  1. RPC `factura_numero_siguiente()` → `numero`; `token = tokenAlfa('DV')`.
  2. Si hay `adjunto`: `guardarAdjunto(p.adjunto, \`presupuestos/${token}\`, 'presupuesto')` →
     bucket **público** `presupuestos`, ruta `presupuestos/<token>/presupuesto.<ext>`, devuelve URL
     pública.
  3. `insert facturas { numero_factura, token_publico: token,
     objetivo: s(\`${insumo} → ${centro} · ${tienda}\`, 200),
     descripcion: JSON.stringify(metaPresupuesto), monto_requerido: precio }`; `estado` = `'Abierta'`.
     El JSON se escribe con **este orden de claves exacto** (1.14), porque las listas filtran con
     `like '{"k":"pres"%'`:
     `{ k: 'pres', moneda: 'VES', centro, insumo, tienda, direccion, cantidad, presentacion,
     necesidadId: necesidadId || null, tiendaLat, tiendaLng, tiendaUrl: tiendaUrl || null,
     adjunto: adjunto || null }`.
  4. `historial(centro, insumo, \`Presupuesto ${numero}: ${cantidad} × ${insumo} en ${tienda} por ${precio}\`, 'admin', cantidad)`.
- **Respuesta:** `{ numeroFactura: string, token: string }`.
- **Notas:** el separador del objetivo es `→` (U+2192) entre espacios y `·` (U+00B7) antes de la
  tienda; el frontend y `facturaAbiertaDe` dependen de esa forma. `necesidadId` **no** se valida
  contra `insumos` (puede apuntar a un insumo borrado). Pueden coexistir varios presupuestos
  abiertos del mismo insumo y centro en tiendas distintas: es el diseño («una farmacia cotiza 200,
  otra 1000»). El adjunto es **público** por diseño (transparencia), así que la cotización no debe
  llevar datos personales. La secuencia se consume aunque el `insert` falle.

### admin_presupuestos_por_comprar (`index.ts:1977-1984`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `facturas select numero_factura, token_publico, objetivo, descripcion,
  monto_requerido, monto_recaudado, estado, fecha_creacion` `in estado ('PorComprar','Transferida')`
  `order fecha_creacion asc`. **Sin `limit`** y sin comprobación de `error` (fallo → lista vacía).
- **Respuesta:** `{ presupuestos: [presupuestoUI(f)] }` (1.14): `{ token, objetivo, estado, centro,
  insumo, tienda, direccion, cantidad, presentacion, moneda, precio, recaudado }`. Las filas cuya
  `descripcion` no sea un JSON `{"k":"pres",…}` devuelven `null` en `presupuestoUI` y se descartan
  con `.filter(Boolean)`.
- **Notas:** el filtro es por **estado**, no por el `like '{"k":"pres"%'` que usan las lecturas
  públicas; por eso hace falta el `.filter(Boolean)`. `numero_factura` y `fecha_creacion` se leen
  pero `presupuestoUI` no los expone. La cola es FIFO por fecha de creación.

### admin_donaciones_presupuesto (`index.ts:1985-2003`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` texto 40 (`token_publico` de la factura; **no** se pasa a mayúsculas, a
  diferencia de `facturaPor`).
- **Validaciones:** factura inexistente → `"presupuesto no encontrado"`.
- **Efectos (lectura):**
  1. `facturas select id where token_publico = token` (`maybeSingle`).
  2. `donaciones select id, nombre_donante, monto, monto_usd, tasa, referencia_pago, estado,
     comprobante, fecha` `where factura_id` `order fecha desc` (sin `limit`).
  3. Por cada donación con `comprobante` no vacío: URL firmada de **3600 s** del bucket privado
     `comprobantes`; si falla, `comprobante_url = ''`.
- **Respuesta:** `{ donaciones: [{ id, nombre_donante, monto, monto_usd, tasa, referencia_pago, estado, comprobante, comprobante_url }] }`
  (`comprobante` es la ruta interna; `comprobante_url` la firmada, `''` si no hay).
- **Notas:** es la pantalla de verificación manual: el admin compara comprobante contra referencia
  antes de anular o de marcar la transferencia. Devuelve `nombre_donante` de **todas** las
  donaciones, incluidas las `Anulada`. Una firma por donación: N llamadas a Storage por petición.
  El `token` se usa tal cual, así que un token en minúsculas no encuentra la factura.

### admin_donacion_anular (`index.ts:2004-2022`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `id` texto 40 (id de `donaciones`, un `bigint` que viaja como texto).
- **Validaciones:** donación inexistente → `"donación no encontrada"`. El `select … .single()` de la
  factura propaga su error si la factura no existe.
- **Efectos (en orden):**
  1. `update donaciones { estado: 'Anulada' } where id` (**sin** comprobar el estado previo: anular
     dos veces es inocuo; también se puede anular una `Registrada` que nunca sumó). El disparador
     `trg_recalcular_recaudado` (1.16) recalcula `facturas.monto_recaudado` con solo las
     `Confirmada`.
  2. `facturas select id, monto_recaudado, monto_requerido, estado where id = d.factura_id`
     (`.single()`) — se lee **después** del `update`, así que ya trae el recaudado recalculado.
  3. Si `estado ∈ ('PorComprar','Transferida')` **y** `monto_recaudado < monto_requerido`:
     - `update facturas { estado: 'Abierta' }`;
     - `insert movimientos_factura { tipo: 'Reapertura', descripcion: mov('reabiertoPorAnulacion', {}), monto: 0 }`;
     - `estadoFin = 'Abierta'`.
- **Respuesta:** `{ estado: string | undefined, recaudado: number }` (`estado` es el estado final de
  la factura; `recaudado = Number(f?.monto_recaudado) || 0`).
- **Notas:** una factura ya `Comprada` **no** se reabre aunque el recaudado caiga (el dinero ya se
  gastó): queda con `monto_recaudado < monto_requerido`. Ninguno de los dos `update` comprueba
  `error`, así que un fallo pasa desapercibido y se responde `success: true`. No hay `historial`
  ni `auditar` para esta acción: la única traza es el movimiento `reabiertoPorAnulacion` (público)
  y el cambio de estado de la donación.

### admin_presupuesto_transferido (`index.ts:2023-2038`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` texto 40; `consolidado` dataURL (archivo consolidado de transferencias
  recibidas, ya anonimizado por el admin).
- **Validaciones (en orden):**
  1. Factura inexistente → `"presupuesto no encontrado"`.
  2. `estado !== 'PorComprar'` → `"El presupuesto no está en espera de compra"`.
  3. `!p.consolidado` → `"Sube el archivo consolidado de transferencias recibidas"`.
  4. Errores de `guardarAdjunto` (1.8).
- **Efectos (en orden):**
  1. `guardarAdjunto(p.consolidado, \`presupuestos/${token}\`, \`transferencias-${Date.now()}\`)` →
     bucket **público** `presupuestos`, ruta `presupuestos/<token>/transferencias-<ms>.<ext>`,
     `upsert: true`; devuelve URL pública.
  2. `insert evidencias { factura_id, archivo: url, descripcion: 'Transferencias recibidas (consolidado)', publica: true }`.
  3. `update facturas { estado: 'Transferida' } where id`.
  4. `insert movimientos_factura { tipo: 'Transferencia', descripcion: mov('transferidoABs', {}), monto: 0 }`.
- **Respuesta:** `{ estado: 'Transferida' }`.
- **Notas:** el archivo es **público** e irrevocable (bucket `presupuestos`): la anonimización es
  responsabilidad del admin, el backend no la verifica. El sufijo `Date.now()` evita colisiones
  entre reintentos, pero cada intento deja un archivo y una evidencia más. No hay `historial` ni
  `auditar`; la traza es la evidencia pública y el movimiento. Ninguno de los `insert`/`update`
  comprueba `error`.

### admin_presupuesto_comprado (`index.ts:2039-2055`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` texto 40; `factura` dataURL (la factura pagada al proveedor).
- **Validaciones (en orden):**
  1. Factura inexistente → `"presupuesto no encontrado"`.
  2. `estado ∉ ('PorComprar','Transferida')` → `"El presupuesto no está listo para comprar"`
     (se puede comprar **saltándose** el paso de transferencia).
  3. `!p.factura` → `"Sube la factura pagada al proveedor"`.
  4. Errores de `guardarAdjunto`.
- **Efectos (en orden):**
  1. `guardarAdjunto(p.factura, \`presupuestos/${token}\`, \`factura-compra-${Date.now()}\`)` →
     `presupuestos/<token>/factura-compra-<ms>.<ext>` (público).
  2. `insert evidencias { factura_id, archivo: url, descripcion: 'Factura de compra pagada al proveedor', publica: true }`.
  3. `update facturas { estado: 'Comprada' }`.
  4. `insert movimientos_factura { tipo: 'Compra', descripcion: mov('compraConfirmada', {}), monto: 0 }`.
- **Respuesta:** `{ estado: 'Comprada' }`.
- **Notas:** `Comprada` es la puerta al ciclo del transportista: solo desde ahí `viaje_iniciar`
  acepta reservar un presupuesto (1.15). La factura del proveedor es pública: no debe llevar datos
  de donantes. Sin `historial` ni `auditar`.

### admin_listar_necesidades (`index.ts:2056-2076`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura, sin `limit` en ninguna consulta):**
  1. `insumos select id, nombre, unidad, cantidad_necesaria, cantidad_recibida, urgencia, lugar_id`
     `where estado = 'Necesita'`.
  2. `ids = [...new Set(insumos.map(i => i.lugar_id))]`; si hay alguno,
     `lugares select id, nombre where id in (ids)`.
  3. Agrupa en memoria por **nombre** de centro. Descarta el insumo si su `lugar_id` no resolvió a
     un nombre y si `pendiente = Math.max(0, (cantidad_necesaria || 0) - (cantidad_recibida || 0))`
     es `<= 0`. Descarta el centro si se quedó sin insumos.
- **Respuesta:** `{ centros: [{ centro: string, insumos: [{ id, nombre, unidad, pendiente, urgencia }] }] }`
  (`unidad` cae a `'unidades'` si está vacía; el orden es el de aparición de los insumos, sin
  ordenar).
- **Notas:** alimenta los selects dependientes del asistente de `admin_crear_presupuesto` (el panel
  admin no carga los datos públicos: `cargarTodo()` es no-op en `ventana.html`). Solo mira los
  insumos en estado `Necesita`: uno pasado a `Disponible`/`Cubierto` desaparece aunque le falte
  cantidad. `id` es el `insumos.id` que se envía luego como `necesidadId`.

### admin_listar_facturas (`index.ts:2077-2092`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):**
  1. `facturas select id, numero_factura, token_publico, objetivo, monto_requerido,
     monto_recaudado, estado, fecha_creacion` `order fecha_creacion desc` `limit 100` (sin
     comprobación de `error`).
  2. Si hay filas: `movimientos_factura select factura_id, fecha` `in factura_id (ids)`
     `order fecha desc` (**sin `limit`**); se recorre quedándose con la primera fecha de cada
     factura (la más reciente) y se cruza en memoria.
- **Respuesta:** `{ facturas: [{ id, numero_factura, token_publico, objetivo, monto_requerido, monto_recaudado, estado, fecha_creacion, ultima_actualizacion }] }`
  donde `ultima_actualizacion = fecha del último movimiento || fecha_creacion`.
- **Notas:** `ultima_actualizacion` es el «hace X» de la pantalla de seguimiento. La segunda
  consulta trae **todos** los movimientos de esas 100 facturas para quedarse con 100 fechas: es la
  lectura más pesada del legado (en Firebase conviene un campo `ultima_actualizacion` mantenido en
  la escritura). Sin paginación ni filtro por estado.

### admin_registrar_donacion (`index.ts:2093-2104`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` o `numeroFactura` (`facturaPor`, 1.14); `monto` número `> 0`;
  `nombreDonante` texto 120 (por defecto `'Anónimo'`); `referencia` texto 80 (por defecto `''`);
  `estado` opción `s(…, 20)` ∈ `Registrada | Confirmada` (fuera de lista → `'Registrada'`).
- **Validaciones (en orden):**
  1. `facturaPor`: sin ninguno de los dos → `"token o numeroFactura requerido"`; sin fila →
     `"Factura no encontrada"`.
  2. `monto <= 0` → `"monto debe ser mayor que 0"`.
  3. Error de inserción → se propaga crudo.
- **Efectos:**
  1. `insert donaciones { factura_id, nombre_donante, monto, referencia_pago, estado }`
     (`monto_usd`, `tasa` y `comprobante` quedan en sus valores por defecto: `null`, `null`, `''`).
     Si `estado = 'Confirmada'`, el disparador recalcula `facturas.monto_recaudado` (1.16).
  2. `historial('Administración', '', \`Donación ${estado.toLowerCase()} de ${monto} a ${f.numero_factura}\`, 'admin', monto)`.
- **Respuesta:** `{}`.
- **Notas:** es la vía para asentar donaciones recibidas fuera de la web (efectivo, transferencia
  directa). **No** dispara la transición a `PorComprar` aunque la donación cubra la meta: eso solo
  lo hace `donar_dinero` (1.15), así que un presupuesto financiado por esta vía se queda `Abierta`
  y hay que cerrarlo o gestionarlo a mano. Tampoco envía Telegram ni escribe un movimiento en la
  factura (para eso, `admin_registrar_movimiento` aparte).

### admin_registrar_movimiento (`index.ts:2105-2113`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` o `numeroFactura` (`facturaPor`); `tipo` opción `s(…, 20)` ∈
  `Ingreso | Egreso | Compra | Entrega` (fuera de lista → `'Ingreso'`); `descripcion` texto 300;
  `monto` número (`n()`, se acepta 0 y negativo).
- **Validaciones:** las de `facturaPor`; error de inserción → se propaga.
- **Efectos:**
  1. `insert movimientos_factura { factura_id, tipo, descripcion, monto }` — la `descripcion` es
     **texto plano**, no el JSON codificado de `mov()` (1.10), así que el cliente la muestra tal
     cual, sin traducir.
  2. `historial('Administración', '', \`Movimiento ${tipo} en ${f.numero_factura}: ${s(p.descripcion, 80)}\`, 'admin', n(p.monto))`
     (la descripción se recorta a **80** en el historial, aunque en el movimiento va a 300).
- **Respuesta:** `{}`.
- **Notas:** es el único emisor del tipo `Egreso`. Los movimientos son **públicos** vía
  `seguimiento_factura`: el texto escrito aquí se publica sin filtrar y sin traducir.

### admin_registrar_evidencia (`index.ts:2114-2123`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` o `numeroFactura` (`facturaPor`); `archivo` texto 400 que debe cumplir
  `/^https:\/\//` (**https obligatorio**, sin `i`: `HTTPS://` en mayúsculas es rechazado);
  `descripcion` texto 300; `publica` booleano (`p.publica !== false`, es decir **por defecto
  `true`**: solo un `false` explícito la hace privada).
- **Validaciones (en orden):**
  1. Las de `facturaPor`.
  2. `archivo` sin `https://` al principio → `"archivo debe ser una URL https"`.
  3. Error de inserción → se propaga.
- **Efectos:**
  1. `insert evidencias { factura_id, archivo, descripcion, publica }` (`fecha = now()`).
  2. `historial('Administración', '', \`Evidencia registrada en ${f.numero_factura}\`, 'admin')`.
- **Respuesta:** `{}`.
- **Notas:** aquí **no** se sube ningún archivo: se registra una URL ya existente (típicamente la
  pública del bucket `presupuestos`, o un enlace externo). No se valida el dominio, así que se
  puede enlazar cualquier host https. Las evidencias con `publica = true` salen por
  `seguimiento_factura`.

### admin_cerrar_factura (`index.ts:2124-2131`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `token` o `numeroFactura` (`facturaPor`).
- **Validaciones:** las de `facturaPor`; error de `update` → se propaga.
- **Efectos:**
  1. `update facturas { estado: 'Cerrada', fecha_cierre: now } where id`.
  2. `historial('Administración', '', \`Factura ${f.numero_factura} cerrada\`, 'admin')`.
- **Respuesta:** `{}`.
- **Notas:** es la única transición **sin comprobación de estado** (1.15): cierra desde cualquier
  estado, incluidas `EnTransito` o `Ofrecida`, y no hay acción para reabrirla (solo
  `admin_donacion_anular`, y únicamente desde `PorComprar`/`Transferida`). Una factura `Cerrada`
  deja de ser candidata de `facturaAbiertaDe`, así que una necesidad cerrada a mano genera una
  factura nueva en la siguiente donación.

### admin_listar_personas (`index.ts:2132-2137`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** ninguna.
- **Efectos (lectura):** `personas select id, nombre, cedula, estado, ubicacion, contacto, fuente,
  fecha` `where verificada = false` `order fecha desc` `limit 100`. Sin comprobación de `error`
  (fallo → lista vacía).
- **Respuesta:** `{ personas: [{ id, nombre, cedula, estado, ubicacion, contacto, fuente, fecha }] }`.
- **Notas:** es la **cola de moderación**: solo las no verificadas. No devuelve `reportado_por` ni
  `verificada` (constante `false` aquí); para verlos hay que usar `admin_datos_ficha` sobre la
  entidad `personas`. El RPC público `buscar_familiar` solo devuelve verificadas, así que hasta que
  el admin pase por aquí el reporte no es visible.

### admin_verificar_persona (`index.ts:2138-2145`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `id` número (`n()`), debe ser `> 0`.
- **Validaciones:** `id <= 0` → `"id requerido"`; error de `update` → se propaga.
- **Efectos:**
  1. `update personas { verificada: true } where id` (un `id` inexistente **no** falla: `update` de
     0 filas).
  2. `historial('Administración', '', \`Persona ${id} verificada\`, 'admin')`.
- **Respuesta:** `{}`.
- **Notas:** operación de un solo sentido: no hay acción para desverificar (sí desde
  `admin_datos_editar`, columna `verificada` de tipo `booleano`). El historial se escribe aunque no
  se haya actualizado ninguna fila.

### admin_regenerar_panel (`index.ts:2146-2159`)

- **Auth:** admin; **Cubo:** `admin`.
- **Entrada:** `nombre` texto 120 (nombre exacto del centro en `lugares.nombre`).
- **Validaciones (en orden):**
  1. `nombre` vacío → `"nombre del centro requerido"`.
  2. `lugares` sin fila con ese `nombre` → `"Centro no encontrado"`.
  3. Error del `upsert` → se propaga crudo.
- **Efectos (en orden):**
  1. `token = tokenAlfa('CTR')` (1.3).
  2. `pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)` → 6 dígitos
     entre `100000` y `999999`.
  3. `salt = crypto.randomUUID()`; `pin_hash = sha256Hex(salt + pin)`.
  4. `upsert centros_panel { lugar_id, token_centro: token, pin_hash, pin_salt: salt }` con
     `onConflict: 'lugar_id'` (`centros_panel.lugar_id` es `unique`). Solo se escriben esas cuatro
     columnas: `email`, `foto_cedula`, `foto_sitio` y `creado` de una fila existente **se conservan**.
  5. `historial(nombre, '', 'Panel regenerado por administración', 'admin')`.
- **Respuesta:** `{ token: string (CTR-…), pin: string (6 dígitos) }` — **la única acción que
  devuelve un PIN en claro**; se le entrega al centro por un canal aparte y no vuelve a poder
  consultarse (solo queda el hash).
- **Notas:** es la contraparte de `panel_crear` (que sí exige fotos y deja elegir el PIN): sirve
  para dar acceso a un centro creado por `registrar_lugar`/`obtenerOCrearLugar` y para reponer un
  acceso perdido. Regenerar **invalida el token y el PIN anteriores** (`token_centro` es `unique`;
  la fila se reescribe). Renombrar el centro con `admin_datos_editar` no rompe el panel (el enlace
  es por `lugar_id`), pero sí hace que este `nombre` deje de encontrarlo.

### default (`index.ts:2160-2161`)

Cualquier `accion` que no coincida con un `case` → `"accion desconocida"` (HTTP 400). Nótese que la
autenticación y el rate-limit ya se aplicaron: una acción inexistente que empiece por `admin_`
**consume cubo `admin` y exige `adminKey` válida** antes de llegar aquí.

---

## 3. Envoltura HTTP

### 3.1 `Deno.serve` (`index.ts:2165-2180`)

```ts
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'solo POST' }), { status: 405, headers: CORS });
  }
  try {
    const body = await req.json();
    const accion = s(body?.accion, 40);
    const extra = await handle(accion, body || {}, req);
    return new Response(JSON.stringify({ success: true, ...extra }), { headers: CORS });
  } catch (err) {
    const msg = s((err as Error).message, 200);
    const status = /demasiadas/i.test(msg) ? 429 : /clave admin|no configurado/i.test(msg) ? 401 : 400;
    return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: CORS });
  }
});
```

- **`OPTIONS`** → `200` con cuerpo `null` y las cabeceras `CORS`. No hay
  `Access-Control-Max-Age` ni `Access-Control-Allow-Methods`: el preflight se repite en cada
  petición que lo requiera.
- **Cualquier método distinto de `POST`** (incluidos `GET` y `HEAD`) → `405` con
  `{ "success": false, "error": "solo POST" }`. No existe ningún endpoint de salud ni de lectura por
  `GET`.
- **`POST`**: `body = await req.json()`. Si el cuerpo no es JSON válido, la excepción de `req.json()`
  cae en el `catch` y sale como `400` con el mensaje del parser (`"Unexpected end of JSON input"`,
  etc.) — **no** con un mensaje en español.
- `accion = s(body?.accion, 40)`; el cuerpo se pasa a `handle` como `body || {}`. Un cuerpo `null`
  (`"null"` literal) da `accion = ''` → `"accion desconocida"`.
- **Éxito:** `200` con `{ success: true, ...extra }`, donde `extra` es el objeto que devuelve la
  acción. Como es un *spread*, una acción que devolviera una clave `success` la sobrescribiría
  (ninguna lo hace). `{}` produce exactamente `{ "success": true }`.
- **Error:** `msg = s(err.message, 200)` (recortado a 200 caracteres) y el estado se decide **por
  regex sobre el mensaje ya truncado**:

  | Regex | Estado | Mensajes que la disparan |
  |---|---|---|
  | `/demasiadas/i` | `429` | `"Demasiadas solicitudes, baja el ritmo"`, `"Demasiadas solicitudes, intenta en una hora"`, `"Demasiadas solicitudes del panel, intenta en una hora"`, `"Demasiadas solicitudes admin, intenta en una hora"`, `"Demasiadas claves incorrectas, espera una hora"` |
  | `/clave admin\|no configurado/i` | `401` | `"Clave admin incorrecta"`, `"Módulo admin no configurado"` |
  | (resto) | `400` | todos los demás, incluidos los errores crudos de PostgREST y de Storage |

  El acoplamiento es **frágil por diseño legado**: cualquier mensaje futuro que contenga la palabra
  «demasiadas» o «no configurado» cambiaría el código HTTP. Firebase debería lanzar errores
  tipados (código + mensaje) en vez de deducir el estado del texto.
- **Cabeceras (`CORS`, `index.ts:11-15`)** en las cuatro salidas (OPTIONS, 405, éxito y error):
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
  Content-Type: application/json
  ```
  `Access-Control-Allow-Origin: *` es deliberado (el formulario es público y anónimo) y no hay
  cookies ni credenciales: la sesión viaja como `accessToken` **dentro del cuerpo** (1.6). El
  `Content-Type: application/json` se manda incluso en el `OPTIONS` de cuerpo vacío.
- La función se despliega con `verify_jwt = false` (`index.ts:1-3`): el `apikey` publishable que
  manda el cliente no autentica nada; toda la protección es el rate-limit por cubo, la validación
  por acción y la clave admin hasheada en `config` (1.5, 1.6).
- El cliente (`api.js`) impone además un tiempo máximo de **45 000 ms** y trata cualquier
  `success === false` como excepción (1.1).

### 3.2 `cron_tasa` — la acción fuera del `switch` (`index.ts:896-901`)

```ts
if (accion === 'cron_tasa') {
  const secret = s(req.headers.get('x-cron-secret') || '', 128);
  const { data: cfg } = await supa.from('config').select('valor').eq('clave', 'cron_secret').maybeSingle();
  if (!cfg || !cfg.valor || secret !== String(cfg.valor)) throw new Error('no autorizado');
  return await actualizarTasa();
}
```

- **Auth:** cabecera `x-cron-secret` (`s(…, 128)`) comparada con `config.cron_secret`. La
  comparación es `!==` sobre cadenas (**no** en tiempo constante, a diferencia de `hashIguales`), y
  el secreto se guarda en claro en `config`.
- **Cubo:** **ninguno**. Es la única acción que se atiende **antes** del anti-ráfaga
  (`rateHitRafaga`, 12/s) y de todos los cubos por hora, precisamente para que un pico de tráfico
  público no impida actualizar la tasa. A cambio, quien conozca el secreto puede llamarla sin
  límite.
- **Entrada:** ninguna en el cuerpo, salvo `accion: 'cron_tasa'`.
- **Validaciones:** falta la clave `cron_secret` en `config`, está vacía o no coincide →
  `"no autorizado"`. **Ese mensaje no casa con ninguna de las dos regex de estado**, así que sale
  como **`400`**, no `401`. Después, los errores de `actualizarTasa` (1.17):
  `"no se pudo obtener la tasa"` (400).
- **Efectos:** `actualizarTasa()` (1.17): Remitly → fallback dolarapi/BCV → `insert tasas
  { fuente, efectiva, diaria }`.
- **Respuesta:** `{ success: true, fuente: 'remitly' | 'bcv', efectiva: number, diaria: number }`.
- **Notas:** la dispara `pg_cron` con el secreto compartido. No escribe `historial` ni
  `auditoria_admin`: la única traza es la fila nueva de `tasas`. `cron_tasa` **no** aparece en el
  `switch`, así que no hay `case` que mantener sincronizado.

---

## 4. Registro de la consola de datos (`ENTIDADES`)

Lista blanca declarada en `index.ts:519-717` (los tipos `ColTipo`, `ColDef`, `NaturalDef`,
`HijoDef`, `FotoDef` y `EntidadDef` en `index.ts:486-518`). La consumen `admin_datos_entidades`,
`admin_datos_listar`, `admin_datos_ficha`, `admin_datos_crear`, `admin_datos_editar`,
`admin_datos_duplicados`, `admin_datos_deshacer` y `admin_datos_borrar`; las reglas de validación
comunes (`entidadDe`, `camposValidados`, `valorValidado`, `normaClave`, `duplicadosDe`,
`filaPorId`, `dependientesDe`, `fotosFirmadas`, `mensajeDePostgres`, `idDe`) están en 1.18.

Reglas que valen para las ocho entidades:

- `borrado` es **siempre** `'fisico'` (no hay archivado lógico en el legado).
- Una columna que no esté en `editables` **se rechaza**, no se ignora:
  `` `Ese dato no se puede editar desde aquí: ${k}` ``.
- Las columnas que no estén en `lectura` no se devuelven nunca (así `centros_panel.pin_hash` y
  `pin_salt` son invisibles desde la consola).
- `buscar` alimenta el `or` de `ilike` de `admin_datos_listar`; una entidad con `buscar` vacío
  ignora el parámetro `busca` (ninguna lo tiene hoy).
- `naturales` **solo informa** de duplicados (`duplicadosDe` lee las primeras 2000 filas y compara
  en memoria con `normaClave`); el cliente reenvía con `forzar: true`.
- `fotos` son rutas de Storage que `fotosFirmadas` convierte en URLs firmadas de 3600 s.
- `hijos` con `modo: 'cascade'` desaparecen al borrar el padre; con `modo: 'null'` sobreviven con la
  FK a `null`. El modo es **descriptivo**: lo que realmente ocurre lo decide la FK en `base.sql`.

### 4.1 `lugares` (`index.ts:521-541`)

| Propiedad | Valor |
|---|---|
| tabla | `lugares` |
| pk | `id` (`pkTexto: false` → `Math.round(n(id))`); sin `prefijoId` |
| etiqueta | `nombre` |
| orden | `nombre` ascendente (`ordenAsc: true`) |
| lectura | `id, tipo, nombre, ubicacion, telefono, lat, lng, actualizado` |
| buscar | `nombre, ubicacion, telefono` |
| naturales | `[nombre]` norma `texto` |
| fotos | ninguna |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max / opciones / rango | requerido |
|---|---|---|---|
| `tipo` | `opcion` | `['Centro', 'Hospital', 'Refugio']` | sí |
| `nombre` | `texto` | max 120 | sí |
| `ubicacion` | `texto` | max 300 | no |
| `telefono` | `telefono` | max 40; ≥ 7 dígitos si no está vacío | no |
| `lat` | `lat` | `[-4, 13]` o `null` | no |
| `lng` | `lng` | `[-74, -59]` o `null` | no |

Hijos: `insumos` (fk `lugar_id`, etiqueta `insumos`, modo `cascade`) · `centros_panel`
(fk `lugar_id`, etiqueta `accesos de panel`, modo `cascade`).

Notas: `lugares.nombre` es `unique`, así que un duplicado forzado falla con
`"Ya existe un registro con ese valor único"`. `tipo` aquí sí está restringido a tres valores,
mientras que `obtenerOCrearLugar` (1.13) acepta cualquier texto ≤ 40: la consola puede encontrarse
lugares con un `tipo` que ya no puede reeditar sin cambiarlo. Renombrar un lugar **no** propaga el
cambio a `facturas.objetivo` ni a `historial_movimientos.lugar` (guardan el nombre como texto).

### 4.2 `insumos` (`index.ts:542-562`)

| Propiedad | Valor |
|---|---|
| tabla | `insumos` |
| pk | `id` (numérico) |
| etiqueta | `nombre` |
| orden | `nombre` ascendente |
| lectura | `id, lugar_id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad, actualizado` |
| buscar | `nombre, categoria` |
| naturales | `[lugar_id, nombre]` norma `texto` |
| fotos | ninguna |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max / opciones / rango | requerido |
|---|---|---|---|
| `lugar_id` | `refLugar` | `Math.round(n())` > 0 y debe existir en `lugares.id` | sí |
| `nombre` | `texto` | max 120 | sí |
| `categoria` | `texto` | max 60 | no |
| `estado` | `opcion` | `['Necesita', 'Disponible', 'Cubierto']` | sí |
| `cantidad_necesaria` | `numero` | `minNum: 0`, `maxNum: 1_000_000` | no |
| `cantidad_recibida` | `numero` | `minNum: 0`, `maxNum: 1_000_000` | no |
| `urgencia` | `opcion` | `['Alta', 'Normal', 'Baja']` | sí |
| `unidad` | `texto` | max 30 | no |

Hijos: ninguno.

Notas: `(lugar_id, nombre)` es `unique` en la tabla, además de ser la clave natural. La clave
natural usa norma `texto` para las **dos** partes, así que `lugar_id` se compara como su
representación decimal normalizada. Editar `cantidad_recibida` desde aquí **no** dispara
`registrarEntrega` (1.14): la factura de la necesidad no se cierra ni recibe movimiento; eso solo
pasa por `panel_insumo`.

### 4.3 `voluntarios` (`index.ts:563-590`)

| Propiedad | Valor |
|---|---|
| tabla | `voluntarios` |
| pk | `id` **texto** (`pkTexto: true` → `s(id, 60)`), `prefijoId: 'VOL'` |
| etiqueta | `nombre` |
| orden | `fecha_registro` descendente (`ordenAsc: false`) |
| lectura | `id, nombre, apellido, email, telefono, estado, ciudad, profesion, disponibilidad, medio_transporte, observaciones, foto_cedula, fecha_registro` |
| buscar | `nombre, apellido, email, telefono, ciudad` |
| naturales | `[email]` norma `email` · `[telefono]` norma `digitos` · `[nombre, apellido]` norma `texto` |
| fotos | `foto_cedula` → bucket `registro-transportistas` |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max | requerido |
|---|---|---|---|
| `nombre` | `texto` | 120 | sí |
| `apellido` | `texto` | 120 | no |
| `email` | `email` | 254 (vacío → `null`) | no |
| `telefono` | `telefono` | 40; ≥ 7 dígitos si no está vacío | no |
| `estado` | `texto` | 60 | no |
| `ciudad` | `texto` | 80 | no |
| `profesion` | `texto` | 80 | no |
| `disponibilidad` | `texto` | 120 | no |
| `medio_transporte` | `texto` | 60 | no |
| `observaciones` | `texto` | 500 | no |

Hijos: ninguno.

Notas: el `id` creado desde la consola es `VOL` + 8 hex **mayúsculas**, mientras que
`registrar_voluntario` genera `VOL` + 8 hex minúsculas (1.3): conviven los dos formatos.
`foto_cedula` se **lee** (para firmarla en la ficha) pero no es editable; borrar el voluntario deja
la imagen huérfana en el bucket.

### 4.4 `motorizados` (`index.ts:591-621`)

| Propiedad | Valor |
|---|---|
| tabla | `motorizados` |
| pk | `id` texto, `prefijoId: 'MOT'` |
| etiqueta | `nombre` |
| orden | `fecha_registro` descendente |
| lectura | `id, nombre, tipo_vehiculo, telefono, zona_operacion, placa, email, foto_placa, foto_vehiculo, foto_cedula, fecha_registro` |
| buscar | `nombre, placa, telefono, email, zona_operacion` |
| naturales | `[email]` norma `email` · `[telefono]` norma `digitos` · `[placa]` norma `texto` |
| fotos | `foto_placa`, `foto_vehiculo`, `foto_cedula` → bucket `registro-transportistas` |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max / opciones | requerido |
|---|---|---|---|
| `nombre` | `texto` | 120 | sí |
| `tipo_vehiculo` | `opcion` | `['Moto', 'Carro', 'Bicicleta', 'Camión', 'Triciclo motorizado']` | sí |
| `telefono` | `telefono` | 40 | no |
| `zona_operacion` | `texto` | 120 | no |
| `placa` | `texto` | 20 | no |
| `email` | `email` | 254 | no |

Hijos: `trayectos` (fk `motorizado_id`, etiqueta `trayectos`, modo `null`) ·
`donaciones_motorizados` (fk `motorizado_id`, etiqueta `aportes recibidos`, modo `null`).

Notas: `Camión` lleva tilde y así debe enviarse (la comparación de `opcion` es exacta, sin
`sinAcentos`). El `email` de un motorizado es la llave con la que `identidadSesion` (1.6) le asigna
el rol `transportista`: editarlo aquí **cambia quién puede reservar viajes** con esa identidad, y
vaciarlo (`email` vacío → `null`) le quita el rol. La placa se normaliza como `texto` (sin acentos,
minúsculas, espacios colapsados) para detectar duplicados.

### 4.5 `rescatistas` (`index.ts:622-648`)

| Propiedad | Valor |
|---|---|
| tabla | `rescatistas` |
| pk | `id` texto, `prefijoId: 'RES'` |
| etiqueta | `nombre` |
| orden | `fecha_registro` descendente |
| lectura | `id, nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones, fecha_registro` |
| buscar | `nombre, organizacion, telefono, ciudad, especialidad` |
| naturales | `[telefono]` norma `digitos` · `[nombre, organizacion]` norma `texto` |
| fotos | ninguna |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max | requerido |
|---|---|---|---|
| `nombre` | `texto` | 120 | sí |
| `organizacion` | `texto` | 120 | no |
| `telefono` | `telefono` | 40 | no |
| `especialidad` | `texto` | 80 | no |
| `estado` | `texto` | 60 | no |
| `ciudad` | `texto` | 80 | no |
| `disponibilidad` | `texto` | 120 | no |
| `equipo_disponible` | `texto` | 300 | no |
| `capacidad_operativa` | `texto` | 120 | no |
| `observaciones` | `texto` | 500 | no |

Hijos: ninguno.

Notas: no tiene columna `email` (a diferencia de voluntarios y motorizados), así que un rescatista
nunca obtiene rol por `identidadSesion`. `estado` es texto libre, no una `opcion`.

### 4.6 `centros_panel` (`index.ts:649-666`)

| Propiedad | Valor |
|---|---|
| tabla | `centros_panel` |
| pk | `id` (numérico) |
| etiqueta | `token_centro` |
| orden | `creado` descendente |
| lectura | `id, lugar_id, token_centro, email, foto_cedula, foto_sitio, creado` |
| buscar | `token_centro, email` |
| naturales | **ninguna** (`admin_datos_duplicados` devuelve `{ grupos: [] }` sin consultar) |
| fotos | `foto_cedula`, `foto_sitio` → bucket `registro-transportistas` |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max | requerido |
|---|---|---|---|
| `email` | `email` | 254 | no |

Hijos: ninguno.

Notas: es la entidad más restringida a propósito. `pin_hash` y `pin_salt` **no están en `lectura`**:
la credencial no se puede ni mirar desde la consola; para reponerla está `admin_regenerar_panel`.
`token_centro` se lee (el admin necesita identificar la fila y dárselo al centro) pero **no** se
edita. `lugar_id` tampoco es editable: un panel no se puede reasignar a otro centro. La confirmación
de borrado de `admin_datos_borrar` exige teclear el **token** (`CTR-…`), que es la `etiqueta`.
Borrar aquí deja al centro sin acceso al panel pero conserva el lugar y sus insumos.

### 4.7 `vacantes_voluntarios` (`index.ts:667-692`)

| Propiedad | Valor |
|---|---|
| tabla | `vacantes_voluntarios` |
| pk | `id` (numérico) |
| etiqueta | `rol` |
| orden | `fecha_creacion` descendente |
| lectura | `id, lugar_tipo, lugar_nombre, ubicacion, rol, descripcion, cantidad_necesaria, cantidad_cubierta, urgencia, turno, telefono, estado, fecha_creacion` |
| buscar | `lugar_nombre, rol, ubicacion` |
| naturales | `[lugar_nombre, rol]` norma `texto` |
| fotos | ninguna |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max / opciones / rango | requerido |
|---|---|---|---|
| `lugar_tipo` | `opcion` | `['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe']` | sí |
| `lugar_nombre` | `texto` | max 120 | sí |
| `ubicacion` | `texto` | max 160 | no |
| `rol` | `texto` | max 80 | sí |
| `descripcion` | `texto` | max 400 | no |
| `cantidad_necesaria` | `numero` | `minNum: 1`, `maxNum: 10_000` | no |
| `cantidad_cubierta` | `numero` | `minNum: 0`, `maxNum: 10_000` | no |
| `urgencia` | `opcion` | `['Alta', 'Normal', 'Baja']` | sí |
| `turno` | `texto` | max 80 | no |
| `telefono` | `telefono` | max 40 | no |
| `estado` | `opcion` | `['Abierta', 'Cubierta', 'Cerrada']` | sí |

Hijos: ninguno.

Notas: `cantidad_necesaria` tiene `minNum: 1` y **no** es `requerido`, así que en
`admin_datos_crear` (modo no parcial) omitirla la evalúa como `0` y falla con
`"cantidad_necesaria: el mínimo es 1"` — hay que enviarla siempre al crear. La columna
`actualizado` existe en la tabla pero **no** está en `lectura` ni en `editables`: solo la toca
`admin_actualizar_vacante`. `lugar_nombre` es texto libre, sin FK a `lugares`.

### 4.8 `personas` (`index.ts:693-716`)

| Propiedad | Valor |
|---|---|
| tabla | `personas` |
| pk | `id` (numérico) |
| etiqueta | `nombre` |
| orden | `fecha` descendente |
| lectura | `id, nombre, cedula, estado, ubicacion, contacto, fuente, reportado_por, verificada, fecha` |
| buscar | `nombre, cedula, ubicacion, contacto` |
| naturales | `[cedula]` norma `digitos` · `[nombre]` norma `texto` |
| fotos | ninguna |
| borrado | `fisico` |

Columnas editables:

| id | tipo | max | requerido |
|---|---|---|---|
| `nombre` | `texto` | 160 | sí |
| `cedula` | `texto` | 20 | no |
| `estado` | `texto` | 120 | no |
| `ubicacion` | `texto` | 200 | no |
| `contacto` | `texto` | 120 | no |
| `fuente` | `texto` | 120 | no |
| `reportado_por` | `texto` | 120 | no |
| `verificada` | `booleano` | — (`crudo === true \|\| crudo === 'true'`) | no |

Hijos: ninguno.

Notas: es la única entidad con una columna `booleano`. `verificada` es lo que separa un reporte de
la búsqueda pública: el RPC `buscar_familiar` solo devuelve verificadas, y desde aquí se puede
poner a `true` **y** volver a `false` (`admin_verificar_persona` solo hace lo primero). La clave
natural por `cedula` usa norma `digitos`, así que «V-12.345.678» ≡ «12345678». Como `verificada` no
es `requerido`, omitirla en `admin_datos_crear` la deja en `false` (`'' → false`), que coincide con
el valor por defecto de la columna.

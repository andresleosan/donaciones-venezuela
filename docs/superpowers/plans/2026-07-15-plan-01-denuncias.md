# Plan 01 — Denuncias con video (problema 1)

> **Para /build-loop:** materiales = este plan + `REGLAS.md`. Orden: 5º
> (**requiere el plan 02**: solo se denuncia con sesión iniciada, incluido el
> donante sin rol). Es el único problema 100 % nuevo: `grep -ri denuncia` en el
> repo = 0 resultados.

## El problema, literal (del .txt)

> «En la página principal necesito que añadas un botón en la parte superior que
> sea "hacer una denuncia". Al pulsar ese botón se debe grabar un video con la
> cámara, con funcionamiento online y offline. El video debe grabarse en al
> menos 720p y el archivo debe estar optimizado para que no pese mucho y sea
> compatible con cualquier teléfono. Cuando se presiona el botón, se abre una
> página nueva […]. Al pulsar el botón, se deben grabar los datos y mantener la
> sesión iniciada de quien está haciendo la denuncia. Cualquier usuario puede
> hacer la denuncia siempre y cuando haya iniciado sesión […].
> Si el usuario es un transportista que está en tránsito […] se hace un reporte
> de los insumos que alguien quiere quedarse […] podrían ser policías, guardias
> o civiles […].
> Además, añade un botón en la parte inferior de la misma interfaz para ver las
> denuncias realizadas. Las denuncias son completamente anónimas para el
> público, pero el administrador debe poder ver todos los datos, incluida la
> persona que está denunciando y la ubicación exacta mediante GPS. Esta
> información debe capturarse automáticamente al iniciar una denuncia y, cada
> vez que se comience a grabar el video, se debe intentar guardar toda la
> información posible del video cada cinco segundos, por si ocurre algún
> accidente y no se puede pausar el video antes de que suceda algo peor.»

Decisión D3 (grill-me 2026-07-15): el público ve **video + fecha + hora +
coordenadas del punto exacto**; identidad y rol, solo el admin.

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| Botón «hacer una denuncia» arriba en la página principal | T1 |
| Se abre una «página nueva» | T1 (vista `#denunciar` a pantalla completa) |
| Graba video con la cámara (no galería) | T2 |
| ≥720p, optimizado, compatible con cualquier teléfono | T2 (constraints + codecs) |
| Online **y** offline | T4 |
| Guardar toda la info posible **cada 5 segundos** | T3 |
| Solo con sesión iniciada; se graban los datos del usuario | T1 + T5 (plan 02) |
| Caso transportista en tránsito → reporte de retención de insumos | T5 (chips de tipo + `factura_token` automático) |
| GPS exacto capturado automáticamente al iniciar | T5 |
| Botón abajo «ver las denuncias realizadas» | T6 |
| Anónimas para el público / todo para el admin | T6 + T7 + vista SQL |

## Diseño (referencias Mobbin: Citizen, Kino/Edits)

- **`#denunciar`**: pantalla propia (cumple «página nueva» sin romper el SW:
  `index.html` ya está cacheado → funciona offline gratis). Visor
  `<video>` a pantalla completa, cronómetro arriba (`00:12 / 1:30`),
  **disparador rojo grande centrado abajo** (R3.3, 52px), botón detener.
  Aviso corto permanente: `t('report.locationNotice')` = «La ubicación exacta
  será pública» (ver Nota de privacidad).
- **`#denuncias`** (pública): cards con `<video controls preload="none">`,
  fecha, hora, `lat, lng` como texto y mini-mapa Leaflet con el punto.
  Nada de identidad en el DOM.
- Tope de grabación: **90 s** (a ~1.5 Mbps ≈ 15 MB máx; se anuncia en
  pantalla). Corte automático al llegar.

## Datos

Tabla propia (NO va en `facturas`: otra vida, otra visibilidad):

```sql
create table denuncias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,             -- solo admin
  nombre text,                     -- solo admin
  rol text,                        -- solo admin: transportista|voluntario|centro|donante
  tipo text not null default 'Otro',        -- canónico es (R1.5): 'Retención de insumos' | 'Otro'
  gps_lat double precision, gps_lng double precision, gps_precision real,
  video_path text, duracion_s int,
  texto text,                      -- opcional «¿qué pasó?»
  factura_token text,              -- si el denunciante iba en tránsito (plan 07)
  origen text not null default 'usuario',   -- 'usuario' | 'admin' (plan 07 T5)
  estado text not null default 'Recibida'   -- 'Recibida'|'En revisión'|'Atendida'
);
alter table denuncias enable row level security; -- sin policies: solo la edge fn (service role)
create view denuncias_public as
  select id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado
  from denuncias;                  -- jamás email/nombre/rol/texto
```

Bucket Storage **privado** `denuncias` (el video se ve por URL firmada de 1 h
que entrega la edge fn: público puede VER, nadie puede LISTAR ni enlazar
permanente).

Acciones nuevas en `supabase/functions/api/index.ts` (mismo estilo `case`):

- `denuncia_crear` `{accessToken, tipo, gps:{lat,lng,precision}, texto?,
  facturaToken?, videoBase64, duracionS}` → valida sesión con
  `supa.auth.getUser(jwt)` (patrón exacto de `acceso_perfil`, index.ts:570),
  deriva `email/nombre/rol` de la sesión + `acceso_perfil` interno, sube video
  con `guardarFoto`-equivalente para binario (`guardarVideo(base64, carpeta,
  nombre)` nuevo, mismo helper con contentType `video/webm|mp4`), inserta fila.
  Si trae `facturaToken` válido: además `movimientos_factura` +=
  `mov('denunciaRegistrada', {})` y la factura queda marcada (plan 08 la lee).
- `denuncia_parcial` `{accessToken, denunciaId, videoBase64, duracionS}` →
  **upsert del MISMO objeto** en Storage (`upsert: true`): es el guardado
  progresivo de cada 5 s. Crea la fila si no existe aún (primer parcial) con
  `estado='Recibida'` y `duracion_s` parcial.
- `denuncias_listar` `{}` → filas de `denuncias_public` (orden desc, limit 50)
  + URL firmada por video (`createSignedUrl(path, 3600)`).
- `denuncias_admin` `{clave}` → todo, con identidad (misma validación de clave
  que las acciones `admin_*`). Incluye `denuncia_estado {clave, id, estado}`
  para marcar En revisión/Atendida.

## Grabación (T2/T3, el corazón técnico)

```js
// js/denuncias.js (archivo nuevo, cargado desde index.html con ?v=)
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
  audio: true
});
const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)); // mp4 = Safari/iOS
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
rec.start(5000); // ← dataavailable cada 5 s
```

En cada `dataavailable` (cada 5 s), en este orden:
1. **IndexedDB primero** (a prueba de que quiten/rompan el teléfono): store
   `dv-denuncia-chunks` `{denunciaLocalId, seq, blob, ts}` + metadatos
   (`gps`, `tipo`, `sesion.email`, `facturaToken`) en `dv-denuncia-meta`.
2. **Red después, si hay**: `new Blob(chunksHastaAhora, {type: mime})` →
   base64 → `denuncia_parcial` (los chunks webm/mp4 concatenados desde el
   primero son un archivo reproducible). **Saltar** si el envío anterior sigue
   en vuelo (`enVuelo` flag) — en red lenta no se acumulan.

Al detener (o a los 90 s): ensamblar todo → `denuncia_crear` → limpiar
IndexedDB → pantalla de confirmación con enlace a `#denuncias`.

## Tareas

### T1 — Entradas y guardia de sesión
- `index.html` página principal (`#view-inicio`, encima de las puertas):
  botón `t('report.ctaTop')` («Hacer una denuncia»/«File a report»), estilo
  `.btn` con acento `--critical` (urgencia real — principio 3 de PRODUCT.md).
  Abajo del mismo view: `t('report.ctaList')` («Ver denuncias»/«View reports»)
  → `#denuncias`.
- Router (`js/panel.js`, patrón del hash `ofrecer`): `#denunciar` sin
  `sesionActual()` → toast `t('report.needSession')` + redirigir a `#acceso`
  guardando retorno (`sessionStorage['dv-retorno']='#denunciar'`; al terminar
  el login, si hay retorno, navegar ahí). El donante sin roles VALE (plan 02 T3).

### T2 — Grabador (código de arriba) + UI Kino: visor, cronómetro, disparador R3.3.
### T3 — Guardado cada 5 s (IndexedDB + `denuncia_parcial`, código de arriba).

### T4 — Offline completo
- Sin red: todo queda en IndexedDB. Listener `online` (mismo patrón de la cola
  de `services/api.js`) + al abrir la app: si hay denuncia pendiente en
  `dv-denuncia-meta` → banner `t('report.pendingUpload')` con botón enviar.
- Playwright E2E: `context.setOffline(true)` → grabar → detener → chunks en
  IndexedDB; `setOffline(false)` → recarga → banner → subida capturada.

### T5 — Datos automáticos al iniciar
- Al ENTRAR a `#denunciar` (antes de grabar): `getCurrentPosition`
  (`enableHighAccuracy:true, timeout:10s`) → si falla, se puede grabar igual y
  se reintenta al enviar (la denuncia no se pierde por el GPS).
- Chips de tipo (`.segmented`, R1.5 canónico es): «Retención de insumos» /
  «Otro». Si `sesionActual()` es transportista con viaje activo (plan 07
  expone `viajeActivo()`), preseleccionar «Retención de insumos» y adjuntar
  `facturaToken` automáticamente — cumple el caso «policías, guardias o
  civiles que quieran quedarse con los insumos» sin teclear nada.
- Campo opcional único `t('report.whatHappened')` tras grabar (no bloquea).

### T6 — Vista pública `#denuncias`
- Carga por `denuncias_listar`; cards video+fecha+hora+coords+mini-mapa.
  Estados con `tValue('reportState', estado)`. Cero identidad en el DOM
  (regla r05). Registrar la vista en `VISTAS` de `scripts/e2e-idioma.js`.

### T7 — Vista admin (en la ventana admin, plan 08 la enlaza)
- Sección «Denuncias» con todo (quién, email, rol, GPS con enlace a mapa,
  video, texto) + cambiar estado. Reusa `denuncias_admin`.

### T8 — i18n (`report.*`, `values.reportState.*`, `values.reportType.*` en
es+en, R1.2) + enganche a `cambiarIdioma()`: `#denuncias` se reconstruye
(R1.3); `#denunciar` **grabando NO se reconstruye** — mientras `rec.state ===
'recording'` el selector de idioma se deshabilita con title explicativo
(decisión consciente: reconstruir mataría el stream; documentada aquí).
Versión `?v=`/`VERSION` + commit Luismadef45 (R5.4/R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "start(5000)\|denuncia_parcial" js/denuncias.js` ≥ 2 y
   `grep -c "denuncia_crear\|denuncias_listar" supabase/functions/api/index.ts` ≥ 2.
3. `self` (Playwright, cámara falsa `canvas.captureStream(30)` + micrófono
   falso o `audio:false` en test): grabar 12 s → ≥2 chunks en IndexedDB y ≥1
   `denuncia_parcial` capturada por el monkeypatch de `SheetsService.post`
   (captura y lanza — cero escrituras a prod); detener → `denuncia_crear`
   capturada con `gps`, `tipo` y `accessToken`.
4. `self`: sin sesión `#denunciar` redirige a `#acceso` y tras inyectar
   `dv-sesion` de prueba deja grabar; el flujo offline de T4 completo.
5. `self`: `#denuncias` con fixture pinta video+fecha+hora+coordenadas y NO
   contiene email/nombre/rol en el DOM; es/en con cambio en caliente; táctiles
   ≥44px a 390px; consola limpia.

## Nota de privacidad (decir, no callar)
El público verá coordenadas exactas por decisión D3 de Luis. Si se graba desde
la casa del denunciante, esas coordenadas lo exponen aunque no salga su nombre.
Se implementa como se pidió + el aviso `report.locationNotice` visible antes de
enviar. Si Luis cambia de idea, el único cambio es redondear `gps_lat/lng` a 3
decimales en la vista `denuncias_public` (≈110 m) — anotado para el futuro.

## Qué NO se hace
- Ni streaming en vivo ni WebRTC: el «cada 5 s» se cumple con chunks + upsert.
- Sin compresión adicional en cliente (el bitrate 1.5 Mbps ya es el
  optimizado); nada de ffmpeg.wasm (peso prohibitivo, R5.1).

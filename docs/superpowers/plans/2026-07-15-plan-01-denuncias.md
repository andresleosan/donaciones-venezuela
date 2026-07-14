# Plan 01 — Denuncias con video (problema 1)

> **Para /build-loop:** materiales = este plan + `REGLAS.md`. Orden: 5º
> (**requiere el plan 02**: solo se denuncia con sesión iniciada).
> Es el único problema 100% nuevo (grep «denuncia» en el repo = 0).

**Meta:** botón «Hacer una denuncia» arriba en la página principal → pantalla
de grabación de video (≥720p, optimizado, online y offline, guardado cada 5 s
por si pasa algo); botón abajo «Ver denuncias» → lista pública anónima.
Decisión D3: el público ve **video + fecha + hora + coordenadas exactas**; la
identidad del denunciante y su rol solo los ve el admin.

## Diseño (referencias Mobbin: Citizen, Kino)

- Nueva vista hash `#denunciar` (no una página aparte: el SW ya cachea
  `index.html`, así funciona offline gratis; «página nueva» del pedido se
  cumple como pantalla completa propia).
- UI de grabación: visor a pantalla completa, cronómetro arriba, disparador
  rojo grande centrado abajo (R3.3), botón detener. Sin galería (R3.2).
  Límite 90 s (tope de tamaño; se anuncia en pantalla).
- Vista `#denuncias` (pública): lista de cards con `<video controls>`, fecha,
  hora, coordenadas (texto `lat, lng`) + mini-mapa Leaflet con el punto
  exacto. Sin nombre, sin rol, sin email.

## Datos

Tabla nueva (migración `denuncias`):

```sql
create table denuncias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,            -- solo admin
  nombre text,                    -- solo admin
  rol text,                       -- solo admin (transportista/voluntario/centro/donante)
  gps_lat double precision, gps_lng double precision, gps_precision real,
  video_path text,                -- objeto en bucket 'denuncias'
  duracion_s int,
  texto text,                     -- opcional: «qué pasó»
  factura_token text,             -- si el denunciante iba en tránsito
  origen text not null default 'usuario',  -- 'usuario' | 'admin' (plan 07)
  estado text not null default 'Recibida'  -- canónico es (R1.5)
);
alter table denuncias enable row level security;  -- sin policies: solo edge fn
create view denuncias_public as
  select id, created_at, gps_lat, gps_lng, video_path, duracion_s, estado
  from denuncias;                 -- la vista pública NO expone identidad
```

Bucket Storage **privado** `denuncias`. Reproducción pública vía URLs firmadas
(1 h) que devuelve la edge fn — así el video es visible pero el bucket no es
listable.

Acciones nuevas en la edge fn `api`:
- `denuncia_crear` {accessToken, gps, texto?, facturaToken?, videoBase64|videoPath}
  → valida sesión con `supa.auth.getUser` (mismo patrón que `acceso_perfil`,
  `index.ts:570`), inserta fila, sube el video al bucket. Además escribe un
  `mov('denunciaRegistrada', …)` si hay `factura_token` (transparencia).
- `denuncia_parcial` {accessToken, denunciaId, videoBase64} → **upsert** del
  mismo objeto: es el guardado progresivo de cada 5 s.
- `denuncias_listar` {} → filas de `denuncias_public` + URL firmada por video.
- `denuncias_admin` {clave} → todo, con identidad (misma clave admin que las
  demás acciones `admin_*`).

## Grabación (el corazón técnico)

- `getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:
  'environment'}, audio:true})`.
- `MediaRecorder` con `video/webm;codecs=vp8` y fallback `video/mp4` (Safari);
  bitrate ~1.5 Mbps para que 90 s ≈ 15 MB máx.
- `recorder.start(5000)` → cada `dataavailable` (5 s): **(1)** persistir el
  chunk en IndexedDB al instante (a prueba de que quiten el teléfono) y
  **(2)** si hay red, ensamblar `new Blob(chunks)` y mandarlo a
  `denuncia_parcial` (upsert del mismo path; saltar si el envío anterior
  sigue en vuelo). Los chunks webm concatenados desde el primero son un
  archivo válido.
- GPS: `getCurrentPosition` de alta precisión **al iniciar** la denuncia
  (D3: punto exacto) — se manda en `denuncia_crear`.
- Offline: todo queda en IndexedDB (chunks + metadatos + sesión); al volver
  la red (evento `online`, mismo patrón de la cola de `services/api.js`) se
  sube completo y se limpia. Si la app se cerró a mitad de grabación, al
  abrir de nuevo se detecta la denuncia pendiente y se ofrece enviarla.

## UI de entrada

- `index.html` página principal: botón destacado arriba
  (`t('report.ctaTop')` = «Hacer una denuncia»/«File a report», estilo
  `.btn` con `--critical` **solo** como acento semántico — es urgencia real,
  cumple el principio 3 de PRODUCT.md) + botón abajo «Ver denuncias» /
  «View reports».
- Sin sesión → toast + redirección a `#acceso` (con retorno a `#denunciar`
  al entrar). Con sesión (plan 02 `sesionActual()`): captura automática de
  email/nombre/rol; si el usuario es transportista con viaje activo, se
  adjunta `factura_token` automáticamente (transparencia del roadmap).
- Campo opcional único «¿Qué pasó?» después de grabar (no bloquea el envío).
- Vistas nuevas registradas en `VISTAS` de `scripts/e2e-idioma.js` y
  enganchadas al cambio de idioma (R1.3): el estado grabando NUNCA se
  reconstruye (no parar la grabación por cambiar idioma — congelar el selector
  de idioma mientras graba es aceptable y más simple: documentarlo).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "denuncia_parcial\|start(5000)" js/*.js` ≥ 2 (guardado
   cada 5 s existe de verdad).
3. `self` (Playwright, cámara falsa con `captureStream`): grabar 12 s →
   existen ≥2 chunks en IndexedDB y ≥1 llamada `denuncia_parcial` capturada
   por el monkeypatch (captura y lanza: cero escrituras a prod); detener →
   `denuncia_crear` capturada con gps y accessToken.
4. `self`: sin sesión, `#denunciar` redirige a `#acceso`; con sesión inyectada
   (`dv-sesion` de prueba) deja grabar.
5. `self`: `#denuncias` pinta las cards desde un `denuncias_listar` simulado
   (fixture) con video, fecha, hora y coordenadas, sin ningún dato de
   identidad en el DOM; es/en con cambio en caliente.

## Nota de privacidad (decir, no callar)
El público verá coordenadas exactas por decisión D3 de Luis. Si la denuncia se
graba desde la casa del denunciante, esas coordenadas lo exponen aunque no
salga su nombre. El plan lo implementa como se pidió, pero la pantalla de
grabación mostrará un aviso corto («La ubicación exacta será pública») para
que quien denuncia lo sepa antes de enviar.

# Plan 07 — «Voy a recogerla» de punta a punta (problema 7)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + planes 01, 02,
> 05 y 06 (es el plan integrador). Orden: 7º. Aquí también viven la **semilla**
> y el **botón de simulación** (decisión D1: «ambas cosas»).

**Meta:** en `#transporte`, «Voy a recogerla» funciona sin pedir nada que el
sistema ya sabe: el transportista sale de la sesión, el destino sale del
enlace insumo→centro, aparece el mapa recogida→destino con pregunta de ETA,
el estado «transportista en camino» se publica para todos, y si se pasa 2 h
del ETA los administradores se enteran (panel + correo, decisión D4) y pueden
generar una denuncia.

## Estado actual (verificado 2026-07-15)

- `abrirRecogerOferta(of)` (`js/admin.js:861`) pide **el nombre a mano** y
  llama `recoger_oferta` (index.ts:546). CTA: `offer.pickupCta` = «Voy a
  recogerla» (`js/vistas.js:596`).
- No hay enlace explícito oferta→centro de destino en el flujo (verificar en
  F0 el shape de `ofrecer_insumo`/`listar_ofertas`).
- No existe vigilancia de atrasos ni correo.

## Tareas

### T1 — Autollenado por sesión
- En `abrirRecogerOferta`: si `sesionActual()` tiene rol transportista, se
  eliminan los campos de identidad del form y el payload lleva sus datos
  (mismos nombres de campo, R2.3). Sin sesión → invitación a entrar
  (#acceso) o a registrarse como transportista.

### T2 — Destino ya enlazado
- Toda oferta debe nacer apuntando a una necesidad/centro (revisar
  `ofrecer_insumo`: si hoy no guarda `centro_destino`, añadirlo eligiendo la
  necesidad abierta que cubre — el formulario `#ofrecer` ya conoce el insumo).
- `listar_ofertas` devuelve también el destino para pintar el mapa sin pasos
  extra.

### T3 — Mapa + ETA + estado público
- Al pulsar «Voy a recogerla»: pantalla del viaje (componente `js/viaje.js`
  del plan 06) con mapa recogida→destino y chips de ETA; al confirmar,
  `viaje_iniciar` marca la oferta `estado='En camino'` (canónico es, R1.5) y
  escribe `mov('viajeIniciado', {eta})`.
- Ese estado se ve en TODAS las superficies: lista de ofertas, panel del
  centro destino («hay un transportista en camino»), y línea de tiempo del
  donante. Repintar con `cargarTodo()` tras guardar (CLAUDE.md).

### T4 — Vigilancia de atrasos (D4: panel + correo)
- Vista SQL `viajes_atrasados`: viajes con `estado='En camino'` donde
  `now() > inicio + (eta_minutos + 120) * interval '1 min'`.
- **Panel**: al abrir el panel admin, sección roja arriba con esos viajes:
  transportista, teléfono, insumo, retraso, botón «Generar denuncia» y botón
  «Marcar resuelto». Sin infraestructura: se calcula al leer.
- **Correo**: `pg_cron` cada 15 min → `net.http_post` a la edge fn acción
  `vigilar_viajes` (clave interna) → si hay atrasos NUEVOS (columna
  `alertado_at is null`), envía correo al admin por **SMTP SES** (denomailer
  en Deno; credenciales SMTP del plan 05 como secrets de la función:
  `supabase secrets set SES_SMTP_USER=… SES_SMTP_PASS=… ADMIN_EMAIL=…`) y
  sella `alertado_at`. Si el plan 05 aún no está hecho, la parte de correo
  queda detrás de un `if (secrets)` y el panel funciona igual.
- El correo es texto bilingüe simple (es primero), sin HTML.

### T5 — Denuncia desde admin
- El botón «Generar denuncia» del panel llama `denuncia_crear` con
  `origen='admin'`, `factura_token`/oferta y texto automático («Transportista
  no se reportó; retraso de X h») — reusa todo el plan 01, sin video.

### T6 — Semilla + simulación (decisión D1)
- `scripts/semilla-pruebas.sql`: datos ficticios realistas — 3 centros con
  necesidades, 2 facturas pagadas, 3 ofertas enlazadas a centros, 2
  transportistas, 1 voluntario (emails `*@prueba.local`). Idempotente
  (`on conflict do nothing`) y con un marcador `origen='semilla'` donde la
  tabla lo permita para poder limpiar. **Se ejecuta a mano** contra Supabase
  (nunca desde el loop).
- Botón «▶ Simular viaje» visible solo con `?dev=1` (misma puerta
  `editAssistantDisponible()` / sessionStorage `dv-dev` de `js/core.js:1114`)
  en la pantalla del viaje: avanza paso 1→2→3 con GPS ficticio y fotos de
  canvas cada pocos segundos, usando las MISMAS acciones reales — así el
  donante ve la línea de tiempo moverse de verdad sobre datos de mentira.

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "viajes_atrasados\|vigilar_viajes"
   supabase/functions/api/index.ts` ≥ 1 y `test -f scripts/semilla-pruebas.sql`.
3. `self` (Playwright, sesión transportista inyectada, payload capturado):
   «Voy a recogerla» NO muestra campo de nombre, abre mapa con dos marcadores,
   pide ETA y el payload lleva los datos de la sesión.
4. `self`: con fixture de un viaje 3 h tarde, el panel admin pinta la alerta
   roja con botón «Generar denuncia», y ese botón produce un payload
   `denuncia_crear` con `origen='admin'`.
5. `self`: con `?dev=1` aparece «Simular viaje» y al pulsarlo se capturan en
   orden los payloads de los 3 pasos; sin `?dev=1` el botón no existe en el
   DOM.

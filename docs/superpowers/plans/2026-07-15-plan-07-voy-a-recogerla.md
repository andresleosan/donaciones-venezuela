# Plan 07 — «Voy a recogerla» de punta a punta (problema 7)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + planes 01, 02,
> 05 y 06 (es el plan integrador). Orden: 7º. Aquí viven también la **semilla**
> y el **botón de simulación** (decisión D1: «ambas cosas»).

## El problema, literal (del .txt, condensado fiel)

> «En #transporte, la opción "voy a recogerla" necesita que todo el paso a paso
> funcione correctamente. En registrar la recogida, en vez de poner el nombre
> del transportista, debería estar iniciada la sesión del transportista y que,
> al darle al botón, ya se recopilen sus datos. Además, el centro de destino
> debería también ya tener la información, porque el insumo ya debería estar
> enlazado al destino exacto. Ese botón debería mandar a la interfaz del
> transportista directamente un mapa entre el punto de recogida y el punto de
> entrega. […] se actualizará la base de datos para todos y llegará al centro
> de destino, indicando que ya hay un transportista en camino. Se le preguntará
> al transportista: ¿cuánto tiempo cree que demora en llegar? Si tarda más de
> dos horas después del tiempo estimado, se enviará una notificación a los
> administradores indicando sospechas de extravío; el administrador deberá
> contactar al transportista y verificar qué sucedió. Además, el administrador
> tendrá la opción, desde su interfaz, de generar una denuncia si el
> transportista no se reportó, **manteniendo el mismo proceso incluso después
> de haber recogido el insumo**.»

Decisión D4 (grill-me): la alerta llega por **panel + correo**.

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| «Voy a recogerla» sin escribir el nombre: datos de la sesión | T1 |
| Centro de destino ya enlazado al insumo | T2 |
| El botón manda directo al mapa recogida→entrega | T3 |
| Pregunta de ETA | T3 (pantalla de viaje del plan 06) |
| La base se actualiza para todos + el centro ve «transportista en camino» | T3 |
| >2 h tras el ETA → notificación a administradores (extravío) | T4 |
| Vigilancia también DESPUÉS de recogido el insumo | T4 (dos tramos) |
| Admin contacta al transportista | T4 (teléfono/email en la alerta) |
| Admin genera denuncia desde su interfaz | T5 |
| (Transversal D1) semilla + botón de simulación | T6 |

## Estado actual (verificado 2026-07-17, anclas exactas)

- CTA `offer.pickupCta` («Voy a recogerla») en `js/vistas.js:596` →
  `abrirRecogerOferta(of)` (`js/admin.js:861`) → **pide nombre y centro a
  mano** → `recoger_oferta` (`index.ts:546`) exige `nombreTransportista` y
  `centroDestino`, y salta la oferta directo a `estado='Recogida'` **con
  `fecha_cierre`** — no hay viaje, ni mapa, ni «en camino».
- ¡Buena noticia verificada!: el meta de la oferta **ya guarda** `coords`
  ({lat,lng} del mapa de `#ofrecer`) y `centro` (destino sugerido, opcional)
  — `ofrecer_insumo`, index.ts:488-537. Falta hacerlos obligatorios/reales.
- `centros_panel` tiene email por centro (`acceso_perfil` lo lee) — sirve
  para mostrar el aviso en el panel del centro destino.

## Tareas

### T1 — Autollenado por sesión
- `abrirRecogerOferta` (admin.js:861): si `sesionActual()` tiene rol
  transportista → NO pintar el campo de nombre; payload con
  `accessToken` (el backend deriva nombre/email — mismo patrón
  `supa.auth.getUser` de `acceso_perfil`). Mantener `nombreTransportista`
  como fallback aceptado por el backend para compatibilidad (R2.3), pero la
  UI con sesión ya no lo pide. Sin sesión → tarjeta con dos botones:
  `t('session.login')` → #acceso (con retorno) y «Registrarme como
  transportista».

### T2 — Destino ya enlazado
- `#ofrecer`: el campo `centro` (hoy opcional, texto) pasa a **select
  obligatorio** de centros con necesidades abiertas (misma fuente que la
  vista `#necesidades`); guarda además `centroId`/coords del centro en el
  meta de la oferta. Ofertas viejas sin centro: al pulsar «Voy a recogerla»
  se pide elegir destino UNA vez (select, no texto) y se persiste.
- `listar_ofertas`/`ofertaUI`: exponer `centro` y `coordsDestino` para pintar
  el mapa sin pasos extra.

### T3 — Mapa + ETA + estado «En camino» para todos
- Al pulsar «Voy a recogerla» (con sesión): directo a la **pantalla de viaje**
  (`js/viaje.js`, plan 06) — mapa con recogida (coords de la oferta) y
  destino (coords del centro), polyline, chips de ETA, botón «Comenzar viaje».
- Al confirmar → `viaje_iniciar` (plan 06) sobre la oferta: crea el viaje,
  pone `estado='EnCamino'` (nuevo estado canónico es — añadirlo a
  `values.invoiceState` es/en) y escribe `mov('viajeIniciado', {nombre,eta})`.
- **Nuevo flujo de estados de oferta**: `Ofrecida → EnCamino (paso 1) →
  Recogida (paso 2, con fotos persona/insumo, SIN fecha_cierre) → Entregada
  (paso 3)`. `recoger_oferta` deja de cerrar la factura: pasa a ser el paso 2
  del viaje (adaptar el case: exige `EnCamino` o `Ofrecida` para ofertas
  viejas, guarda gps/fotos/km como en el plan 06).
- Visible para todos: `listar_ofertas` deja de filtrar solo `Ofrecida` y
  devuelve también `EnCamino` con badge; el panel del centro destino muestra
  `t('panel.incomingDriver', {nombre, insumo, eta})`; la línea de tiempo del
  donante ya lo muestra por el movimiento.

### T4 — Vigilancia de atrasos (D4: panel + correo, DOS tramos)
- Vista SQL:

```sql
create view viajes_atrasados as
select v.*, f.token_publico, f.objetivo, f.estado
from viajes v join facturas f on f.id = v.factura_id
where v.resuelto = false and v.paso3_ts is null and (
  -- tramo 1: no ha reportado recogida 2 h después del ETA
  (v.paso2_ts is null and now() > v.paso1_ts + make_interval(mins => v.eta_minutos + 120))
  or
  -- tramo 2 («incluso después de haber recogido»): recogió y lleva >2 h sin entregar
  (v.paso2_ts is not null and now() > v.paso2_ts + interval '2 hours')
);
```

- **Panel admin**: al abrir, acción `admin_viajes_atrasados {clave}` → sección
  roja arriba: transportista, teléfono/email (para «contactar y verificar»),
  insumo, tramo y retraso («ETA 60 min, van 3 h 12 min»), botones
  `t('admin.markResolved')` (→ `viajes.resuelto=true`) y «Generar denuncia»
  (T5). Cero infraestructura: se calcula al leer.
- **Correo**: `pg_cron` cada 15 min → `select net.http_post(<edge fn>,
  '{"accion":"vigilar_viajes","claveInterna":"…"}')` → la acción busca
  `viajes_atrasados` con `alertado_at is null`, envía UN correo (agrupado) al
  admin vía **SMTP SES** (credenciales del plan 05 como secrets:
  `supabase secrets set SES_SMTP_USER=… SES_SMTP_PASS=… ADMIN_EMAIL=…`;
  cliente SMTP Deno `denomailer`) y sella `alertado_at=now()`. Si los secrets
  no existen aún (plan 05 pendiente), la acción loguea y sale limpia — el
  panel funciona igual.
- Correo en texto plano bilingüe (es primero), asunto:
  «⚠ Sospecha de extravío: {insumo} — {transportista}».

### T5 — Denuncia desde admin
Botón en la alerta → `denuncia_crear` (plan 01) con `origen='admin'`,
`facturaToken`, `tipo='Retención de insumos'`, sin video, `texto` automático:
«Generada por administración: el transportista {nombre} no se reportó;
retraso de {horas} h en el tramo {1|2}». Aparece en `#denuncias` como
cualquier otra (anónima para el público) y marca la factura para el estado
«Con denuncia» del plan 08.

### T6 — Semilla + simulación (decisión D1)
- `scripts/semilla-pruebas.sql`: datos ficticios realistas e idempotentes
  (`on conflict do nothing`): 3 centros con necesidades y coords reales de
  Caracas/La Guaira, 2 presupuestos pagados (`Comprada`), 3 ofertas con
  coords+centro destino, 2 transportistas y 1 voluntario con emails
  `*@prueba.local`. **Se ejecuta a mano** contra Supabase (nunca desde el
  loop). Documentar dentro del propio .sql cómo limpiar
  (`delete … where email like '%@prueba.local'`).
- **Botón «▶ Simular viaje»** en la pantalla de viaje, visible SOLO con
  `?dev=1` (misma puerta `editAssistantDisponible()` / `sessionStorage
  'dv-dev'`, `js/core.js:1114`): ejecuta paso 1→2→3 contra las acciones
  REALES con GPS ficticio interpolado y fotos de canvas, esperando ~5 s entre
  pasos — el donante ve la línea de tiempo moverse de verdad sobre datos de
  mentira (exactamente la «simulación» del .txt). Sin `?dev=1` el botón no
  existe en el DOM.

### T7 — i18n (`trip.*`, `panel.incomingDriver`, `admin.lateTrips*`,
`values.invoiceState.EnCamino` es+en) + versión + commit (R1.2, R5.4, R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "vigilar_viajes\|viajes_atrasados"
   supabase/functions/api/index.ts` ≥ 2 y `test -f scripts/semilla-pruebas.sql`.
3. `self` (Playwright, sesión transportista inyectada, payloads capturados):
   «Voy a recogerla» NO muestra campo de nombre, abre el mapa con dos
   marcadores y chips de ETA, y el payload de `viaje_iniciar` lleva
   `accessToken` + `etaMinutos` + `gps`.
4. `self`: con fixture de un viaje atrasado en cada tramo, el panel admin
   pinta las dos alertas con contacto y botones; «Generar denuncia» produce
   payload `denuncia_crear` con `origen='admin'` y `tipo='Retención de
   insumos'`; «Marcar resuelto» produce su payload.
5. `self`: con `?dev=1` el botón «Simular viaje» existe y al pulsarlo se
   capturan EN ORDEN los payloads de los 3 pasos; sin `?dev=1` no está en el
   DOM.
6. `self`: `scripts/semilla-pruebas.sql` es idempotente (contiene `on
   conflict`), usa solo emails `@prueba.local` y trae el bloque de limpieza.

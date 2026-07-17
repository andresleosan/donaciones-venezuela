# Plan 06 — Proceso del transportista en 3 pasos (problema 6)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 02
> (sesión). Orden: 6º. Referencias UX (Mobbin): Shopee «Kirim Instant» (mapa
> arriba, barra de etapas, ETA visible) y foodpanda (foto-evidencia de entrega).

## El problema, literal (del .txt, condensado fiel)

> **Paso 1** — botón «Voy a recogerlo»: mapa del punto de recogida y punto de
> destino (enlazado al lugar exacto de entrega); el transportista indica un
> tiempo estimado de llegada; al comenzar el viaje se toman GPS y hora.
> **Paso 2** — «Ya tengo el insumo»: fotos necesarias **+ foto de la persona
> que entrega el insumo**; al registrar: GPS exacto + hora de recogida; luego
> mostrar en el mapa el destino (a qué centro se entrega); se van contabilizando
> los **kilómetros** desde el paso 1 → 2 → 3.
> **Paso 3** — «Entrega de Insumo al Centro»: interfaz similar al paso 2; foto
> del **centro** + foto de la **persona encargada**; ubicación exacta, hora y
> km recorridos hasta la entrega.
> Todas las fotos SOLO desde la cámara de la app. Cada paso guarda GPS, fotos
> de sitios y de las personas responsables.

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| Paso 1: mapa recogida→destino | T2 (pantalla de viaje `js/viaje.js`) |
| Paso 1: destino ya enlazado al lugar exacto de entrega | T2 (+ plan 07 T2 para ofertas) |
| Paso 1: indicar tiempo estimado (ETA) | T2 (chips segmentados) |
| Paso 1: GPS + hora al comenzar el viaje | T2 (`viaje_iniciar`) |
| Paso 2: foto de la persona que entrega | T3 (`fotoPersona`, nueva) |
| Paso 2: GPS + hora de recogida automáticos | T3 |
| Paso 2: mostrar destino en el mapa tras registrar | T3 |
| Km contabilizados 1→2→3 | T3 + T4 (haversine por tramo) |
| Paso 3: foto del centro + foto del encargado | T4 (hoy solo hay `fotoEntrega`) |
| Paso 3: GPS, hora, km recorridos | T4 |
| Fotos solo cámara | Ya cumplido por el motor unificado (verificar en r-reglas) |
| Transparencia (el donante ve cada paso y hace cuánto) | T5 (`mov()` codificados) |

## Estado actual (verificado 2026-07-17, anclas exactas)

El ciclo del insumo COMPRADO ya existe en `facturas` (estados
`Comprada → EnTransito → Entregada`):

- `registrar_recogida` (`index.ts:437`): exige `estado==='Comprada'`, pide
  `nombreTransportista` + `fotoSitio` + `fotoInsumo` (→ `evidencias`,
  privadas), escribe `mov('insumoRecogido'|'insumoRecogidoConNota',
  {nombre,tienda,direccion,notas})` y pasa a `EnTransito`.
- `registrar_entrega_final` (`index.ts:464`): exige `EnTransito`, pide
  `nombreReceptor` + `fotoEntrega`, escribe `mov('entregado'|'entregadoConCargo',
  {centro,receptor,cargo})` y cierra `Entregada`.
- Los formularios cliente (`abrirRegistrarRecogida`, `abrirRegistrarEntrega`
  en `js/admin.js`) ya usan wizard + cámara unificada.
- **No existe**: paso 1 como tal (nada entre «Comprada» y la recogida), mapa,
  ETA, GPS/hora persistidos, km, foto de PERSONA en paso 2, ni fotos de
  centro+encargado en paso 3 (solo `fotoEntrega`).
- La tienda de recogida viene del meta `{k:'pres', tienda, direccion}` — hoy
  **sin coordenadas** (texto). Las coords de tienda las añade el plan 08 T3;
  hasta entonces el mapa del paso 1 en ciclo comprado muestra solo el destino
  si no hay coords (degradación honesta, sin inventar puntos).

## Datos (migración nueva)

```sql
create table viajes (
  id uuid primary key default gen_random_uuid(),
  factura_id bigint not null references facturas(id),
  transportista text not null,
  email text,                          -- de la sesión (plan 02/07)
  eta_minutos int not null,
  paso1_ts timestamptz, paso1_lat double precision, paso1_lng double precision,
  paso2_ts timestamptz, paso2_lat double precision, paso2_lng double precision,
  paso3_ts timestamptz, paso3_lat double precision, paso3_lng double precision,
  km_tramo1 numeric(7,1), km_tramo2 numeric(7,1),
  alertado_at timestamptz,             -- lo usa el plan 07 (vigilancia)
  resuelto boolean not null default false
);
create index viajes_factura on viajes(factura_id);
alter table viajes enable row level security;  -- solo edge fn
```

Una factura puede tener varios intentos de viaje; el vigente = el último sin
`paso3_ts`.

## Backend (edge fn `api`)

- **Nueva** `viaje_iniciar` `{token, etaMinutos, gps:{lat,lng},
  nombreTransportista|accessToken}` → valida estado (`Comprada` para ciclo
  comprado; `Ofrecida` lo maneja el plan 07), inserta fila en `viajes` con
  `paso1_*`, y `movimientos_factura` += `mov('viajeIniciado', {nombre, eta})`
  (clave `movements.viajeIniciado` = «{nombre} va en camino a recoger el
  insumo (llega en ~{eta} min)» es/en).
- `registrar_recogida` **extendida** (campos nuevos opcionales para no romper
  el cliente viejo, R2.3): `fotoPersona`, `gps:{lat,lng}` → guarda evidencia
  «Foto de quien entrega el insumo» (privada), actualiza el viaje vigente
  (`paso2_ts=now()`, `paso2_lat/lng`, `km_tramo1=haversine(paso1,paso2)`), y
  añade `{km}` al dato del movimiento.
- `registrar_entrega_final` **extendida**: `fotoCentro`, `fotoEncargado`
  (además del actual `fotoEntrega`), `gps` → evidencias privadas, viaje
  `paso3_*`, `km_tramo2`, y `mov('entregado', {centro, receptor, cargo, km})`
  con `km = km_tramo1 + km_tramo2`.
- Haversine en TS (una función pura en `index.ts`):

```ts
function kmEntre(aLat:number,aLng:number,bLat:number,bLng:number){
  const r=(x:number)=>x*Math.PI/180, R=6371;
  const dLat=r(bLat-aLat), dLng=r(bLng-aLng);
  const h=Math.sin(dLat/2)**2+Math.cos(r(aLat))*Math.cos(r(bLat))*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.asin(Math.sqrt(h))*10)/10;
}
```

Distancia por tramos entre puntos de paso (sin rastreo continuo: batería y
permisos). Techo conocido: es línea recta por tramo, no ruta de carretera —
`// ponytail:` anotado; upgrade futuro = OSRM público.

## Cliente

### T2 — Pantalla de viaje (`js/viaje.js`, nueva)
- `abrirViaje(factura)`: barra de 3 etapas arriba (patrón Shopee: Recogida →
  En camino → Entregado), **mapa Leaflet** (lib ya vendida en
  `services/leaflet/`) con marcador de recogida (coords de oferta/tienda si
  existen) y de destino + `L.polyline` entre ambos, y el botón grande de la
  etapa actual.
- Paso 1 «Voy a recogerlo»: chips `.segmented` de ETA — 30 min / 1 h / 2 h /
  `t('trip.etaOther')` (input numérico de minutos, 5-480). Al confirmar:
  `getCurrentPosition` (highAccuracy) + `viaje_iniciar`. Si el GPS falla →
  mensaje claro y reintento; sin GPS no se inicia (el dato es el corazón de la
  vigilancia del plan 07).
- Tras cada paso: `cargarTodo()` y repintar desde Supabase (CLAUDE.md).

### T3 — Paso 2 «Ya tengo el insumo»
- En `abrirRegistrarRecogida`: paso de cámara nuevo
  `montarCamaraOferta('rec-persona', fotoPersona, 1)` con título
  `t('cycle.personPhoto')` = «Foto de quien entrega el insumo» — obligatoria
  (el .txt la pide). GPS+hora se capturan en el submit, invisibles para el
  usuario. Tras guardar: la pantalla de viaje muestra el mapa al destino
  («a qué centro debe ser entregado») + `t('trip.kmSoFar', {km})`.

### T4 — Paso 3 «Entrega de insumo al centro»
- En `abrirRegistrarEntrega`: DOS pasos de cámara nuevos —
  `('ent-centro', …)` «Foto del centro» y `('ent-encargado', …)` «Foto de la
  persona encargada» (además de la actual de los insumos). GPS+hora en el
  submit. Pantalla final: `t('trip.done', {km})` con km totales.

### T5 — Transparencia (objetivo transversal)
- Claves `movements.viajeIniciado` (+ km en `movements.entregado`) en es/en;
  la línea de tiempo del donante (`textoMovimiento`) las pinta ya traducidas
  y con «hace X» — exactamente lo que el .txt pide que vea el donante.

### T6 — i18n (`trip.*`, `cycle.personPhoto`, etc. es+en) + versión + commit
(R1.2, R5.4, R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "viaje_iniciar" js/viaje.js supabase/functions/api/index.ts` ≥ 2
   y `grep -c "kmEntre" supabase/functions/api/index.ts` ≥ 2 (definida y usada).
3. `external`: `grep -c 'type="file"' js/viaje.js` = 0.
4. `self` (Playwright, cámara falsa + `context.setGeolocation`): ciclo de 3
   pasos con payloads capturados (monkeypatch, cero prod): paso 1 manda
   `etaMinutos`+`gps`; paso 2 manda `fotoPersona`+`gps`; paso 3 manda
   `fotoCentro`+`fotoEncargado`+`gps`; los campos preexistentes
   (`nombreTransportista`, `fotoSitio`, `fotoInsumo`, `nombreReceptor`,
   `fotoEntrega`, `token`) conservan sus nombres (R2.3).
5. `self`: test unitario de `kmEntre` en el workspace: Caracas
   (10.4806,-66.9036) → La Guaira (10.6000,-66.9333) da 13-15 km; mismo punto
   → 0.0.
6. `self`: la línea de tiempo del donante (fixture) muestra «va en camino…
   (~60 min)» y «Entregado… (X km)» en es y en en, con cambio en caliente.

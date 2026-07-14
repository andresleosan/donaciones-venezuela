# Plan 06 — Proceso del transportista en 3 pasos (problema 6)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 02
> (sesión). Orden: 6º. Referencia UX: Shopee «Kirim Instant» (mapa arriba,
> barra de etapas, ETA) y foodpanda (foto-evidencia de entrega).

**Meta:** que el ciclo Voy a recogerlo → Ya tengo el insumo → Entrega al
centro capture solo (GPS + hora + fotos + km) todo lo que el donante necesita
ver, con mapa de recogida→destino y tiempo estimado.

## Estado actual (verificado 2026-07-15)

- Ya existen los 3 formularios con wizard y cámara unificada:
  `abrirRegistrarTrayecto`, `abrirRegistrarRecogida`, `abrirRegistrarEntrega`
  (js/admin.js), acciones `registrar_trayecto`, `registrar_recogida`
  (index.ts:437), `registrar_entrega_final` (index.ts:464).
- La línea de tiempo del donante ya se alimenta con `mov('insumoRecogido'…)`,
  `mov('entregado'…)` — codificado, bilingüe (R1.5).
- **Falta:** mapa recogida→destino, ETA, GPS+hora capturados al pulsar cada
  botón, km acumulados, y la foto de la **persona** (quien entrega en paso 2,
  el encargado del centro en paso 3).

## Diseño del ciclo

Componente nuevo `js/viaje.js` (pantalla del viaje activo del transportista):
barra de 3 etapas arriba (recogida → en camino → entregado, patrón Shopee),
mapa Leaflet debajo con marcador de recogida y de destino + línea entre ambos,
y el botón de la etapa actual bien grande.

**Paso 1 — «Voy a recogerlo»**
- Muestra mapa con punto de recogida y punto de destino (el insumo ya sabe a
  qué centro va; si el dato no existe en la factura/oferta, ver plan 07 T2).
- Pregunta ETA con chips segmentados (`.segmented`): 30 min / 1 h / 2 h /
  otro (input minutos). R2.x no aplica (no es form público de campos; es una
  sola pregunta).
- Al confirmar: captura `getCurrentPosition` + `now()` y llama la acción
  nueva `viaje_iniciar` {facturaToken|ofertaToken, etaMinutos, gps} → guarda
  y escribe `mov('viajeIniciado', {eta})`.

**Paso 2 — «Ya tengo el insumo»**
- Reusar `abrirRegistrarRecogida` añadiendo: segunda cámara
  `montarCamaraOferta('rec-persona', fotoPersona, 1)` («Foto de quien entrega
  el insumo»), y captura automática de GPS+hora al enviar.
- El backend (registrar_recogida) recibe `gps`, `fotoPersona` y calcula
  `km_tramo1` = haversine(gps_paso1, gps_paso2) (SQL o TS, redondeado a 0.1).
- Tras guardar, la pantalla muestra el mapa al destino (a qué centro se
  entrega) y el total de km hasta ahora.

**Paso 3 — «Entrega de insumo al centro»**
- Reusar `abrirRegistrarEntrega` añadiendo: foto del **centro** + foto del
  **encargado** (dos pasos de cámara), GPS+hora automáticos,
  `km_tramo2` = haversine(gps_paso2, gps_paso3), y `km_total` en el
  `mov('entregado', {..., km})` para que el donante lo vea.

Distancia: **haversine entre los puntos de los pasos** (sin rastreo continuo:
ahorra batería y permisos; es «km en línea recta por tramo»). Anotado como
techo conocido; si algún día hacen falta km de carretera, OSRM público.

## Datos

Columnas nuevas (migración; en la tabla que persiste recogidas/entregas —
confirmar nombre exacto en F0 leyendo `registrar_recogida`):

```sql
alter table <tabla_ciclo> add column if not exists
  eta_minutos int, gps_lat double precision, gps_lng double precision,
  paso_ts timestamptz, km_tramo numeric(7,1);
```

Acción nueva `viaje_iniciar` en la edge fn + campos extra en
`registrar_recogida` / `registrar_entrega_final` (los nombres de campos
actuales NO cambian — R2.3; solo se añaden).

Todas las fotos: solo cámara (ya cumplido por el motor unificado), las de
personas van al bucket privado (R3.5 — son identidad).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "viaje_iniciar" js/*.js supabase/functions/api/index.ts` ≥ 2.
3. `self` (Playwright, cámara falsa + `setGeolocation`): ciclo completo de 3
   pasos con payloads capturados (monkeypatch, cero prod): el paso 1 manda
   `etaMinutos` y `gps`; el 2 manda `fotoPersona` + gps; el 3 manda dos fotos
   + gps; los nombres de campos preexistentes son idénticos a los de antes.
4. `self`: con dos coordenadas conocidas (p. ej. Caracas→La Guaira), el km
   calculado por haversine da 25±2 km (test unitario del cálculo en el
   workspace).
5. `self`: la línea de tiempo del donante (seguimiento por token, fixture)
   muestra los movimientos nuevos traducidos en es y en en (R1.5/R1.3).

# Plan 06 — Roadmap de sub-loops (6.1 · 6.2 · 6.3)

> Decidido con Luis el 2026-07-21. El plan 06 original es ~3-4× un sub-plan del
> batch 4.x, toca flujos logísticos **vivos** y requiere backend nuevo, así que se
> parte en **3 rebanadas verticales**: cada una funciona de punta a punta y se
> verifica sola. Backend **autorizado** para desplegar a Supabase.

## Corrección al plan 06 escrito (hallazgo de F0)

El plan afirma que los formularios del ciclo «ya usan wizard + cámara unificada» y
su tabla de trazabilidad marca *«Fotos solo cámara → Ya cumplido por el motor
unificado»*. **Es falso.** `abrirRegistrarRecogida` y `abrirRegistrarEntrega`
(js/admin.js) usan `campoFoto()`, que emite:

```html
<input type="file" accept="image/*" capture="environment" required />
```

Son los **últimos dos `<input type="file">` de toda la app**, y están justo en el
ciclo del transportista, donde el .txt exige «todas las fotos SOLO desde la cámara
de la app». Migrarlos al motor de cámara (`pasoCamaraHtml` + `montarCamaraOferta`)
es trabajo real de **6.2 y 6.3**.

También: la **tienda de recogida no tiene coordenadas** (solo texto), así que el
mapa del paso 1 pinta el destino y la posición del transportista, pero no el punto
de recogida. Degradación honesta; las coords de tienda las añade el plan 08 T3.

## Estado

| Sub-loop | Alcance | Estado |
|---|---|---|
| **6.1** | Paso 1 «Voy a recogerlo»: tabla `viajes` + acción `viaje_iniciar` (GPS+hora+ETA) + pantalla de viaje `#viaje` (3 etapas, mapa Leaflet, chips de ETA) | ✅ **hecho** (v70, edge fn v20) |
| **6.2** | Paso 2 «Ya tengo el insumo»: migrar `abrirRegistrarRecogida` a cámara, `fotoPersona` (quien entrega), GPS+hora, `km_tramo1` con haversine | ✅ **hecho** (v71, edge fn v21) |
| **6.3** | Paso 3 «Entrega en el centro»: migrar `abrirRegistrarEntrega` a cámara, `fotoCentro` + `fotoEncargado`, GPS+hora, `km_tramo2` y km totales | pendiente |

## Notas de arquitectura (heredadas del batch 4.x)

- La pantalla de viaje es una **vista-página** (`#viaje`), no un modal: coherente
  con ofrecer / donar-dinero / mi-cuenta.
- **Anti-rebote obligatorio:** fijar el hash dispara `hashchange` →
  `abrirPanelDesdeUrl`; toda vista-página nueva necesita su rama ahí o el usuario
  sale disparado al inicio un tick después. Verificar **siempre de forma asíncrona**
  (>300 ms), nunca síncrona.
- Varios intentos de viaje por factura son válidos; el vigente = el último sin
  `paso3_ts`. Lo aprovechan 6.2/6.3 y la vigilancia del plan 07.

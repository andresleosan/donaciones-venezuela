# Plan 08 — Administración (problema 8)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 01 (estado
> «con denuncia»). Orden: 8º (cierre).

## El problema, literal (del .txt)

> «La parte de administración debería funcionar tanto en español como en
> inglés. Necesitamos desaparecer la opción de Record a Donation y sustituirla
> por Track Donation, de manera que se ve cuáles son los estatus en los cuales
> se encuentran los insumos, bien sea que están esperando para ser recogido en
> el sitio donde venden el insumo, o si ya fue recogido […], o ver si ya fue
> entregada en el centro […], o ver si el insumo fue reportado con una denuncia.
> En la parte de create a budget, debería solamente elegirse un centro que ya
> esté registrado, del cual necesite insumos, y se selecciona directamente los
> insumos que ese centro necesita. Es decir, esta parte de la base de datos debe
> estar conectada completamente a las necesidades de los centros […]. Y luego
> que le dé una opción de añadir qué insumo se necesita, la presentación del
> insumo (ejemplo: Caja de 20 pastillas de 250G cada una) más la opción de
> añadir una foto o un archivo que sea el presupuesto, puede ser cualquier tipo
> de archivo para que el donante pueda ver que el presupuesto sea real y esté
> más motivado a querer donar. En la parte de store or pharmacy, debería salir
> la opción de elegir en el mapa exactamente en dónde se encuentra esa tienda o
> farmacia. Opcional sería poder incluir un URL, la cual posea información
> sobre la tienda, y la dirección de la farmacia o tienda.»

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| Admin funciona en español e inglés | T1 |
| Desaparecer «Record a Donation» | T2 (se quita la tarjeta, no la acción) |
| «Track Donation» con 4 estatus (esperando recogida / recogido / entregado / con denuncia) | T2 |
| Budget: solo centros registrados que necesiten insumos | T3.1 |
| Seleccionar directamente los insumos que ESE centro necesita (conexión total a necesidades) | T3.2 |
| Presentación del insumo (ej. caja de 20 pastillas 250 g) | Ya existe (`budgetPresentation`) — se conserva |
| Foto O archivo del presupuesto, cualquier tipo, visible al donante | T3.3 |
| Store/pharmacy: elegir el punto exacto en el mapa | T3.4 |
| URL opcional con info de la tienda + dirección | T3.4 |

## Estado actual (verificado 2026-07-17, anclas exactas)

- Tarjetas del panel admin: claves `admin.taskDonation` («Record a
  donation»), `taskBudget`, `taskVacancy` (`locales/en.json:968-973`).
- `admin_crear_presupuesto` (`index.ts:740`): valida centro contra `lugares`
  por **nombre**, crea factura con meta
  `descripcion = JSON {k:'pres', centro, insumo, tienda, direccion, cantidad,
  presentacion}` + `monto_requerido=precio`. **Tienda y dirección son texto
  libre** — violan R3.1. `insumo` es texto libre — no conectado a necesidades.
- Estados reales de factura: `Abierta/Comprada/EnTransito/Entregada` (ciclo
  comprado) y `Ofrecida/EnCamino*/Recogida/Entregada` (ofertas; *EnCamino lo
  crea el plan 07). `values.invoiceState` ya los traduce.
- Las necesidades por centro existen (vista `#necesidades` pública y
  `panel_insumo` del panel de centro — en F0 confirmar la tabla/vista exacta
  de la que leer, p. ej. la misma fuente de `#necesidades`).
- `admin_listar_facturas` (`index.ts:769`) ya lista todo con estado — base
  perfecta para Track Donation.

## Tareas

### T1 — es/en de verdad en el panel admin
- `verificar-idioma.py` ya vigila el código; lo que falta es el E2E de la
  ventana: crear `scripts/e2e-idioma-admin.js` (mismo patrón que
  `e2e-idioma.js`: recorrer las vistas de la ventana admin en es y en en,
  buscar texto del otro idioma, desbordes y táctiles <44px; documentarlo en
  `scripts/e2e-idioma.md`). Corregir todo texto fijo que aparezca moviéndolo
  a claves (R1.1) — sospechosos típicos: toasts, badges, títulos de modal.

### T2 — «Track donation» sustituye a «Record a donation»
- Quitar la **tarjeta** `taskDonation` del menú (la acción backend
  `admin_registrar_donacion` se queda — otros flujos la usan; solo desaparece
  la entrada de UI, que es lo que pide el .txt).
- Nueva tarjeta `admin.taskTrack` = «Rastrear donación» / «Track donation» →
  vista con `admin_listar_facturas` + `denuncias_admin` (plan 01) mapeadas a
  los 4 estatus del .txt:

| Estatus (.txt) | Regla de mapeo |
|---|---|
| Esperando ser recogido donde venden/ofrecen | `estado ∈ {Comprada, Ofrecida, EnCamino}` |
| Ya recogido | `estado ∈ {EnTransito, Recogida}` |
| Entregado en el centro | `estado = Entregada` |
| Reportado con denuncia | su `token_publico ∈ denuncias.factura_token` (prioridad sobre los demás: badge rojo) |

- Cada fila: insumo, centro destino, transportista (si hay viaje), **«última
  actualización hace X»** (del último `movimientos_factura` — el corazón del
  objetivo transversal del .txt), filtro `.segmented` por estatus, y enlace al
  seguimiento por token. Estados canónicos es + `tValue` (R1.5).

### T3 — «Create a budget» conectado a necesidades reales
El form actual se rehace como wizard admin; **los nombres del payload actual
se conservan** (centro, insumo, tienda, direccion, cantidad, presentacion,
precio — R2.3) y se AÑADEN campos nuevos al meta JSON (cero migración de
columnas, mismo patrón `{k:'pres'}`):

1. **Centro** (T3.1): `<select>` poblado solo con centros registrados que
   tengan necesidades abiertas (misma fuente que `#necesidades`).
2. **Insumo** (T3.2): segundo `<select>` dependiente — solo las necesidades
   de ESE centro; al elegir se autocompletan cantidad faltante y unidad.
   Guardar además `necesidadId` en el meta para trazabilidad total
   necesidad↔presupuesto. (Opción «añadir qué insumo se necesita»: enlace a
   crear la necesidad en el panel del centro — no se duplica el alta aquí.)
3. **Adjunto** (T3.3): `<input type="file">` SIN restricción de tipo
   («cualquier tipo de archivo», dice el .txt) ≤5 MB. ⚠️ Excepción consciente
   y acotada a R3.2: esto NO es evidencia de campo sino un documento del
   admin (factura proforma, PDF de la farmacia); R3.2 sigue intacta para todo
   lo demás. Sube por la edge fn a bucket **público-lectura** `presupuestos`
   (`adjunto` en el meta). El donante lo ve como enlace `t('donate.seeBudget')`
   = «Ver presupuesto» en la card de la necesidad y en el seguimiento por
   token — la motivación que pide el .txt.
4. **Tienda/farmacia** (T3.4): mapa Leaflet para clavar el punto exacto
   (R3.1; mismo widget de `#ofrecer`, vistas.js:83-130) → `tiendaLat`,
   `tiendaLng` al meta; `tienda` (nombre) se conserva; `direccion` pasa a ser
   texto de referencia opcional; campo nuevo opcional `tiendaUrl`
   (validar `https?://`). **Bonus que desbloquea el plan 06**: con
   `tiendaLat/Lng` el mapa del paso 1 del ciclo comprado ya tiene el punto de
   recogida real.

### T4 — i18n + versión + commit
Claves `admin.taskTrack*`, `admin.trackState.*`, `donate.seeBudget`,
`admin.budgetMap*`, `admin.budgetUrl*` en es+en (R1.2); `?v=` en
`index.html` **y `ventana.html`** + `VERSION` (R5.4); commit Luismadef45 +
push (R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "taskTrack" locales/es.json locales/en.json js/*.js` ≥ 3
   y la tarjeta `taskDonation` ya no se rende (grep = 0 en el render del menú
   de tareas; la clave puede seguir existiendo).
3. `external`: `test -f scripts/e2e-idioma-admin.js`.
4. `self` (Playwright, ventana admin con fixture): Track Donation clasifica un
   fixture con los 4 estatus correctamente (incluida una factura con denuncia
   → badge rojo prioritario) y muestra «hace X» de la última actualización,
   en es y en en con cambio en caliente.
5. `self`: crear presupuesto — selects dependientes (cambiar de centro cambia
   los insumos), el payload capturado lleva los campos viejos con sus nombres
   + `necesidadId`, `tiendaLat/Lng` del clic en el mapa, `tiendaUrl` y el
   adjunto; sin mapa clicado no deja enviar; con URL inválida avisa en su
   paso (R2.4).
6. `self`: en la vista pública del donante (fixture con adjunto), aparece
   «Ver presupuesto»/«See budget» y abre el archivo.

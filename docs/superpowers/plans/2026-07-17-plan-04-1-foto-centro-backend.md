# Plan 4.1 — Foto del centro (sitio) en crear-centro + backend

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + plan 04 + el
> roadmap 4.x. **Toca backend** (migración + edge function `api`) — Luis autorizó
> el despliegue el 2026-07-17. Orden: 1º del batch.

**Goal:** que crear-centro tome también una **foto del sitio** (el centro), solo
con la cámara, en el paso más oportuno, y que la edge function la valide y guarde.

**Arquitectura:** frontend añade una segunda cámara (`pc-sitio`, `max=1`) al
asistente existente; la edge function `panel_crear` acepta `p.fotoSitio`, la sube
con `guardarFoto(...)` y la persiste en una columna nueva `foto_sitio` de
`centros_panel`. Sin dependencias nuevas.

**Tech:** HTML/CSS/JS vanilla; Supabase (Postgres + Storage + edge function Deno).

## Global Constraints

Ver «Constraints globales» del roadmap 4.x. Claves aquí: R3.2 (foto solo cámara,
sin `<input type=file>`), R2.x (asistente 1-a-1), R1.x (idioma paralelo), R5.4
(bump `?v=`), `e()` en todo `innerHTML`, despliegue backend por MCP + reporte.

## El problema, literal (del .txt)

> «Que permita tomar fotos directamente desde la aplicación, **como el sitio y el
> ID**.»

El plan 04 dejó **solo la foto del ID** (`pc-cedula`) porque `panel_crear` no
aceptaba la del sitio. 4.1 completa el «sitio y el ID».

## Trazabilidad requisito → tarea

| Requisito | Tarea |
|---|---|
| Foto del **sitio** del centro, solo cámara | T2 (frontend) |
| En el paso más oportuno del formulario | T2 (tras coordenadas, junto a la identidad del centro) |
| El backend la recibe, valida y guarda | T1 (migración) + T3 (edge fn) |
| Idioma es/en paralelo | T4 |

## Estado actual (verificado 2026-07-17, anclas exactas)

- `js/panel.js:243-295` — `abrirCrearPanel()`: form `#panel-crear-form`, orden de
  casillas: `pc-nombre`, `pc-tipo`, `pc-ubicacion`, `pc-coords`(+`pc-geo`),
  `pc-telefono`, `pc-email`, `pc-pin`, y `pasoCamaraHtml('pc-cedula', …, {guia:'cedula'})`.
  Al final: `wizPublico('panel-crear-form')`, `montarCamaraOferta('pc-cedula', fotoCedula, 1)`.
  El submit (panel.js:264-295) arma el payload con `fotoCedula: fotoCedula[0]`.
- `supabase/functions/api/index.ts:598-625` — `case 'panel_crear'`: valida pin,
  nombre, email, teléfono, exige `p.fotoCedula`, crea el lugar
  (`obtenerOCrearLugar`), sube la cédula con
  `guardarFoto(p.fotoCedula, 'centros/${lugar.id}', 'cedula')` e inserta en
  `centros_panel` `{ lugar_id, token_centro, pin_hash, pin_salt, email, foto_cedula }`.
- `guardarFoto` (index.ts:73-85): valida data-URL imagen, sube al bucket
  `registro-transportistas` en `carpeta/nombre.ext` con `upsert:false`, devuelve la
  ruta. La cédula va a `centros/<id>/cedula.jpg`; el sitio irá a
  `centros/<id>/sitio.jpg` (no colisiona).
- `supabase/migrations/` solo tiene `20260712_rescatistas_admin_only.sql`.
- Motor de cámara: `pasoCamaraHtml(prefijo, titulo, copia, opts)` +
  `montarCamaraOferta(prefijo, fotos, max, alCambiar)` (js/admin.js). `max===1` da
  foto única 1280px/0.82.

### Decisiones de diseño

- **D1 · Dónde va el paso**: **después de `pc-coords`** (antes de teléfono). La
  foto del sitio documenta el lugar físico → agrupa con nombre/tipo/ubicación/coords
  (identidad del centro), separado del contacto y de la cédula (que es de la
  persona responsable y va al final). Orden final del asistente: nombre → tipo →
  ubicación → coordenadas → **foto del sitio** → teléfono → email → pin → cédula.
- **D2 · Guía visual**: la foto del sitio **no** lleva marco de cédula; usa
  `pasoCamaraHtml('pc-sitio', …)` **sin** `opts.guia` (encuadre libre del edificio).
- **D3 · Obligatoria**: el .txt pide «el sitio y el ID» → `fotoSitio` es requerida
  en frontend (bloquea submit) y en backend (`throw` si falta), igual que la cédula.
- **D4 · Almacenamiento**: columna nueva `centros_panel.foto_sitio text` (junto a
  `foto_cedula`). No es PII sensible como la cédula, pero se guarda en el mismo
  bucket privado por simplicidad (ponytail: una sola ruta de storage ya probada).

## File Structure

- Create: `supabase/migrations/2026-07-17_centros_panel_foto_sitio.sql`
- Modify: `supabase/functions/api/index.ts` (case `panel_crear`, ~598-625)
- Modify: `js/panel.js` (form + montaje + submit, ~243-295)
- Modify: `locales/es.json`, `locales/en.json` (claves `panel.sitePhoto*`)
- Modify: `index.html`, `ventana.html` (`?v=`), `sw.js` (`VERSION` + caché)

---

### Task 1: Migración — columna `foto_sitio`

**Files:** Create `supabase/migrations/2026-07-17_centros_panel_foto_sitio.sql`

- [ ] **Paso 1: escribir la migración**

```sql
-- Foto del sitio (edificio/local) del centro, tomada en crear-centro.
-- Ruta en el bucket privado registro-transportistas: centros/<lugar_id>/sitio.<ext>
alter table public.centros_panel add column if not exists foto_sitio text;
```

- [ ] **Paso 2: aplicar en producción** (MCP Supabase, proyecto
  `zryfwbjvlacorryzdaod`): `apply_migration` con el nombre
  `centros_panel_foto_sitio` y el SQL de arriba. Verificar con `list_tables` que
  `centros_panel` tiene la columna `foto_sitio`.
- [ ] **Paso 3: commit** de la migración.

**Verify:** `list_tables` muestra `centros_panel.foto_sitio`; la migración está en
el repo.

---

### Task 2: Frontend — cámara del sitio en el asistente

**Files:** Modify `js/panel.js`

**Interfaces:** consume `pasoCamaraHtml`, `montarCamaraOferta` (js/admin.js) y
`wizPublico` (js/wiz.js), ya existentes.

- [ ] **Paso 1: declarar el arreglo de la foto**. Junto a `const fotoCedula = [];`
  (panel.js:243) añadir:

```js
const fotoSitio = [];
```

- [ ] **Paso 2: insertar el paso de cámara tras las coordenadas**. En el template
  del form, **después** de la casilla `pc-coords` (panel.js:251) y **antes** de
  `pc-telefono` (panel.js:252), insertar:

```js
            ${pasoCamaraHtml('pc-sitio', t('panel.sitePhoto'), t('panel.sitePhotoHelp'))}
```

- [ ] **Paso 3: montar la cámara del sitio**. Junto a
  `montarCamaraOferta('pc-cedula', fotoCedula, 1);` (panel.js:262) añadir:

```js
      montarCamaraOferta('pc-sitio', fotoSitio, 1);
```

- [ ] **Paso 4: exigir la foto y sumarla al payload**. En el submit
  (panel.js:264-295), tras el guard de `fotoCedula` (panel.js:267-271) añadir un
  guard gemelo, y en el `Object.assign` (panel.js:276-285) añadir `fotoSitio`:

```js
        if (!fotoSitio.length) {
          msg.className = 'form-message visible error';
          msg.textContent = t('panel.sitePhotoMissing');
          return;
        }
```

```js
            fotoCedula: fotoCedula[0],
            fotoSitio: fotoSitio[0],
```

**Verify:** en Playwright a 390px sobre `/crear-centro` con cámara falsa, el
asistente tiene el paso «foto del sitio» con `<video>` y **cero** `input[type=file]`;
enviar sin foto del sitio muestra `panel.sitePhotoMissing`; con foto, el payload
`panel_crear` incluye `fotoSitio` (data:image). Ver T5 (reglas F2).

---

### Task 3: Backend — `panel_crear` acepta y guarda `fotoSitio`

**Files:** Modify `supabase/functions/api/index.ts` (case `panel_crear`)

- [ ] **Paso 1: validar la foto del sitio**. Tras la línea que exige la cédula
  (index.ts:606 `if (!p.fotoCedula) throw …`) añadir:

```ts
      if (!p.fotoSitio) throw new Error('Falta la foto del sitio del centro');
```

- [ ] **Paso 2: subir la foto del sitio**. Tras
  `const foto_cedula = await guardarFoto(p.fotoCedula, `centros/${lugar.id}`, 'cedula');`
  (index.ts:616) añadir:

```ts
      const foto_sitio = await guardarFoto(p.fotoSitio, `centros/${lugar.id}`, 'sitio');
```

- [ ] **Paso 3: persistir en el insert**. En el `insert` a `centros_panel`
  (index.ts:619-621) añadir `foto_sitio` al objeto:

```ts
      const { error: e2 } = await supa.from('centros_panel').insert({
        lugar_id: lugar.id, token_centro: token, pin_hash: await sha256Hex(salt + pin), pin_salt: salt,
        email, foto_cedula, foto_sitio });
```

- [ ] **Paso 4: desplegar** (MCP Supabase): `deploy_edge_function` de la función
  `api` con el `index.ts` completo actualizado. Reportar a Luis el despliegue.
- [ ] **Paso 5: commit** del cambio de la edge function.

**Verify:** `get_edge_function('api')` contiene `foto_sitio` y `p.fotoSitio`; un
`panel_crear` sin `fotoSitio` responde error «Falta la foto del sitio».

---

### Task 4: i18n — claves nuevas

**Files:** Modify `locales/es.json`, `locales/en.json`

- [ ] **Paso 1: añadir claves** (mismas rutas en ambos, dentro de `panel`):

`es.json`:
```json
    "sitePhoto": "Foto del centro",
    "sitePhotoHelp": "Toma una foto del frente o interior del centro con la cámara.",
    "sitePhotoMissing": "Toma la foto del sitio del centro para continuar."
```

`en.json`:
```json
    "sitePhoto": "Center photo",
    "sitePhotoHelp": "Take a photo of the center's front or interior with the camera.",
    "sitePhotoMissing": "Take the center site photo to continue."
```

- [ ] **Paso 2: validar paridad**: `python3 scripts/verificar-idioma.py` → exit 0.

**Verify:** `verificar-idioma.py` exit 0; `/crear-centro?lang=en` muestra «Center
photo», `?lang=es` «Foto del centro».

---

### Task 5: Versión + reglas F2

- [ ] Subir `?v=` en `index.html` y `ventana.html`, y `VERSION` + nombre de caché
  en `sw.js` (mismo commit). Bump los `?v=` de los assets en `sw.js`.

## Reglas para /reglas-loop (F2)

```
R1 (external) · Paridad idioma es/en:  python3 scripts/verificar-idioma.py  → exit 0
R2 (external) · Backend acepta la foto del sitio:
   grep -q 'p.fotoSitio' supabase/functions/api/index.ts
   && grep -q 'foto_sitio' supabase/functions/api/index.ts  → imprime OK
R3 (external) · La cámara del sitio se monta sin input de archivo:
   grep -q "montarCamaraOferta('pc-sitio'" js/panel.js
   && grep -q "pasoCamaraHtml('pc-sitio'" js/panel.js  → OK
R4 (external) · Migración presente:
   test -f supabase/migrations/2026-07-17_centros_panel_foto_sitio.sql  → OK
R5 (self · Playwright 390px, /crear-centro, cámara falsa, monkeypatch
   SheetsService.post que captura y lanza —cero escrituras a prod—):
   AFIRMAR (i) el asistente tiene el paso «foto del sitio» con <video> y NINGÚN
   input[type=file]; (ii) enviar sin foto del sitio bloquea con
   panel.sitePhotoMissing; (iii) tomando la foto del sitio + la cédula + coords +
   pin, el payload capturado accion=panel_crear lleva fotoSitio (data:image),
   fotoCedula, pin y lat/lng. Sin errores de consola nuevos.
R6 (self · backend desplegado): get_edge_function('api') contiene 'foto_sitio' y
   'p.fotoSitio'; list_tables muestra centros_panel.foto_sitio.
```

## Despliegue (tras verde F3)

1. Migración: MCP `apply_migration`.
2. Edge fn: MCP `deploy_edge_function('api', …)`.
3. Push del código a GitHub `andresleosan/donaciones-venezuela` con token efímero
   en URL (R5.5); Vercel redespliega el frontend.
4. Reportar a Luis: migración + edge fn desplegadas, foto del sitio en vivo.

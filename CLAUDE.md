# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

App web de respuesta a los terremotos de Venezuela (2026). La spec fuente de verdad es `PROMPT_ORIGINAL.md` (no se despliega); el setup de usuario está en `README.md`.

## Restricción dura del proyecto

**Un solo `index.html` vanilla: cero dependencias, cero CDN, cero bundler, cero paso de build.** No hay `package.json` ni framework, y no debe haberlo — añadir una dependencia o un CDN (incluidas Google Fonts) rompe el principio del proyecto y la CSP. Toda la app (HTML + `<style>` + `<script>`) vive en `index.html`.

## Arquitectura

Una sola página, tres pestañas (Donaciones / Buscar familiar / Agregar) conmutadas por JS sin recargar (`cambiarTab` recorre el array `TABS`).

**Donaciones:** el navegador hace `fetch` a `APPS_SCRIPT_URL` (`.../exec`). El backend es Google Apps Script (`apps-script/codigo.gs`) que lee el Google Sheet `lugares`, agrupa las filas por lugar, **calcula el matching de insumos en `doGet`** y devuelve el JSON. Respaldo en 3 niveles dentro de `cargarDatos()`: fetch en vivo → cache `localStorage` (`vz_donaciones_cache`) → `DATOS_FALLBACK` embebido. Modo demo cuando `APPS_SCRIPT_URL` contiene `YOUR_SCRIPT_ID` (lee `data/ejemplo.json`).

**Buscar familiar:** `POST` a `BUSCAR_WEBHOOK_URL` (webhook N8N de un tercero). Vacío o con fallo → modo demo buscando en `data/familiares-ejemplo.json` / `FAMILIARES_FALLBACK`.

**Agregar:** `POST` a `APPS_SCRIPT_URL` → `doPost` en `codigo.gs` valida y hace `appendRow` al Sheet (mismas columnas A–H). **Apps Script NO expone CORS en el POST** (su 302 inicial en `script.google.com` no lleva `Access-Control-Allow-Origin`; el GET sí, por eso leer datos funciona y escribir no). Por eso el `fetch` del form va con **`mode:'no-cors'`**: la escritura ocurre pero la respuesta es **opaca** (no se puede leer `{exito}`) → se confirma **recargando Donaciones**. El body como string viaja `text/plain` (petición simple, sin preflight); el servidor lee `JSON.parse(e.postData.contents)`. Ojo: incluso un POST en modo `cors` que el navegador bloquea **igual escribe la fila** server-side (la app solo no se entera) — cuidado con filas duplicadas al depurar. Tras tocar `doPost`, **redeploy con _Nueva versión_**. Los `id` del form llevan prefijo `ag-` para no chocar con `id="categoria"` del filtro.

### Invariantes que se deben mantener sincronizados

- `normalizar()` (minúsculas + sin acentos + trim) existe **idéntica** en `index.html` y `codigo.gs`. El matching depende de que ambos normalicen igual; cambiar una sin la otra rompe las coincidencias.
- `DATOS_FALLBACK` (en `index.html`) lleva el array `coincidencias` **precalculado a mano**; el Apps Script lo calcula en vivo. Si tocas la lógica o los datos de matching, actualiza ambos o el demo y la realidad divergen.
- Esquema del Sheet `lugares`, columnas **A–H**: Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado. **Una fila por insumo por lugar.** `Estado` ∈ {`Necesita`, `Tiene disponible`} (el `.gs` lo acepta con cualquier mayúscula/acento).
- Render por template literals + `innerHTML`: **todo dato externo pasa por `escaparHTML` (alias `e`)** antes de insertarse. Cualquier campo nuevo que renderices debe ir envuelto en `e()`.
- El `<script>` está dividido en secciones con banners de comentario fijos (CONFIGURACIÓN / ESTADO / TABS / FETCH Y CACHE / RENDER / FILTROS / CONTACTO / BUSCAR FAMILIAR / INIT) que la spec exige; consérvalos.

Constantes editables al inicio del `<script>`: `APPS_SCRIPT_URL`, `BUSCAR_WEBHOOK_URL`, `BUSCAR_WEBHOOK_TOKEN` (no hardcodear secretos: `index.html` es código público), `CACHE_KEY`, `WA_MENSAJE`, `LINEA_APOYO`.

## Correr y verificar (no hay test runner)

- **Local sin servidor:** abre `index.html` por `file://` → usa `DATOS_FALLBACK` (el fetch a los JSON de `data/` lo bloquea CORS en `file://`, por eso existe el respaldo embebido).
- **Con los JSON de `data/`:** sírvelo por HTTP, p.ej. `python3 -m http.server 8000`.
- **Backend:** `curl -sL "<APPS_SCRIPT_URL>"` debe devolver `{"lugares":[...]}`. ⚠️ `curl` ignora la CSP (ver gotchas).
- **Visual/headless** (patrón usado en este repo, Chromium de Playwright):
  ```
  /root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome \
    --headless --no-sandbox --window-size=375,900 --virtual-time-budget=9000 \
    --screenshot=out.png "file://$PWD/index.html"
  ```
  Discriminador de "datos reales vs demo": el `<div id="banner">` queda con clase `oculto` solo si el fetch real tuvo éxito.

## Deploy

`git push origin main` → Vercel redespliega solo, sin build. Proyecto Vercel = **`donacionesvenezuela`** (sin guion; `donaciones-venezuela.vercel.app` con guion es OTRA app distinta). `robots.txt` y `sitemap.xml` son estáticos en la raíz (Vercel los sirve). SEO/Open Graph/JSON-LD (`WebSite`) viven inline en `<head>`; los helpers de accesibilidad (`.visually-hidden`, `.skip-link`, `:focus-visible`, `prefers-reduced-motion`) en el `<style>` — todo sigue el vanilla (sin fuentes web ni assets, por eso no hay `og:image`).

## Gotchas críticos (verificados en producción)

- **CSP ↔ Apps Script:** `/exec` hace **302 → `script.googleusercontent.com`** (ese es el destino real del `fetch`). La CSP en `vercel.json` debe incluir ese dominio o el navegador bloquea los datos y la app cae **silenciosamente** a modo demo. `curl` no lo detecta. Al conectar el webhook N8N, añade también su dominio a la CSP.
- **Actualizar el Apps Script:** usa *Implementar → Gestionar implementaciones → Editar ✏️ → Versión: Nueva versión*, **no** "Nueva implementación" (esa genera una URL `/exec` nueva y obliga a re-cablear `index.html`).
- `SHEET_ID` en `codigo.gs` = solo el ID del Sheet (entre `/d/` y `/edit`), no la URL `/exec`.
- `data/lugares.csv` es la semilla importable del Sheet (mismos 5 lugares del demo, con coincidencias listas).

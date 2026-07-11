# DESIGN.md — Respuesta Humanitaria Venezuela

## Theme
Claro, lenguaje visual Stripe. Fondo azulado frío (#F6F9FC) con luces índigo sutiles; superficies blancas con sombras suaves de dos capas.

## Color palette (tokens en css/app.css `:root`)
- `--primary #635BFF` acciones primarias · `--primary-dark #4F46E5` hover
- `--ink #0A2540` titulares · `--text #3C4257` cuerpo · `--muted #6B7C93` metadatos
- Semánticos: `--critical #CD3D64` (urgencia alta/error), `--warning #A16207`, `--success #3ECF8E`, `--volunteer #0E7A5F` (verde voluntariado), `--rescue #C2410C` (naranja rescate/transporte)
- Soft pairs: `--primary-soft`, `--volunteer-soft`, `--rescue-soft` para fondos de badge/icono
- `--border #E6EBF1`, `--surface #FFFFFF`, `--bg #F6F9FC`

## Typography
Inter variable autohospedada (100–900), única familia. Escala fija rem, ratio ~1.2. Titulares 700–800 en `--ink`; cuerpo 400 en `--text`; metadatos 0.85rem en `--muted`. `--mono` solo para tokens/códigos (`.tracking-code`, `.token-value`).

## Components (vocabulario existente — reusar, no reinventar)
- **Botones**: `.btn` + `.btn-primary|-secondary|-soft|-ghost` + `.btn-small|-block`. Verbo + objeto.
- **Badges**: `.badge` + `.green|.yellow|.gray|.red|.rescue` (fondo soft + texto semántico).
- **Cards**: `.card`, `.centro-card` (colapsable con `data-centro-toggle`, chevron y `.centro-more`), `.help-card`, `.gate-card`, `.door` (home).
- **Formularios**: `.form-grid` + `.field`, mensajes `.form-message` con `role="status"`, validación `validarFormulario()`.
- **Segmentados**: `.segmented` + `.chip-btn` con `aria-pressed` (guardar al tocar).
- **Progreso**: `.progress` (role="progressbar", `<span style="--value:N%">`）.
- **Modales**: `abrirModal()` → `<dialog>`; en páginas-ventana se rende en flujo.
- **Toast**: `toast()` 3.4s.
- **Listas**: `.lista-centros` (columna), `.grid` (auto-fit minmax 280px), `.supply-item`.

## Layout
Header fijo 68px, `main` máx ~1080px centrado, vistas `.view` conmutadas por hash. Secciones con `.section-header` (título + copy). Espaciado 8/12/16/24/32.

## Motion
Transiciones 150–250ms ease-out; `transform: translateY(1px)` en :active de botones; sin coreografías de carga. Respetar `prefers-reduced-motion`.

## i18n
Todo texto vive en `locales/{es,en,fr}.json`; estáticos via `setText()` en core.js, dinámicos via `t()`/`tValue()`. Valores canónicos en español en la base de datos, traducidos al pintar.

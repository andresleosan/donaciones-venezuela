# Auditoría UX/UI, accesibilidad, SEO y rendimiento

Proyecto: Respuesta Humanitaria Venezuela  
Fecha: 2026-06-30

## Resumen ejecutivo

La aplicación mantiene su arquitectura estática sin build: `index.html` concentra HTML/CSS/JS, `services/sheets.js` conserva la capa de datos frontend y `apps-script/codigo.gs` mantiene Google Sheets como backend. El rediseño se implementó sin migrar framework ni romper las acciones existentes de Apps Script.

## Problemas encontrados y solución

| Área | Archivo afectado | Problema | Impacto | Solución implementada |
|---|---|---|---|---|
| Arquitectura UI | `index.html` | La interfaz dependía de estilos genéricos y tarjetas uniformes. | Baja percepción de confianza en un contexto de emergencia. | Sistema visual mobile-first con tokens, superficies neutras, acentos diferenciados y tarjetas por dominio. |
| Responsive | `index.html` | Layouts poco especializados para 320-414px y navegación inferior ajustada. | Riesgo de scroll horizontal, botones pequeños y lectura difícil en teléfonos. | Grids fluidos, botones de 44px+, `minmax(0, 1fr)`, `overflow-wrap`, bottom nav táctil y breakpoints 640/820/1024/1280. |
| Hero | `index.html` | Hero correcto pero poco operativo. | CTAs y métricas no comunicaban prioridad ni uso inmediato. | Nuevo hero con CTAs primarios, métricas compactas y visual operativo con activo local existente. |
| Dashboard | `index.html` | No existía panel consolidado de operaciones. | Usuarios debían saltar entre secciones para entender estado general. | Nueva sección `Dashboard de Operaciones` con voluntarios, rescatistas, centros, hospitales, reportes y última actualización. |
| Formularios | `index.html` | Validación dependía del navegador y no exponía errores inline. | Errores menos claros para teclado/lectores de pantalla. | `novalidate`, `aria-invalid`, errores inline, foco al primer error y mensajes `role=alert/status`. |
| Voluntarios | `index.html`, `apps-script/codigo.gs` | Faltaba campo medio de transporte y vista tipo dashboard. | Registro incompleto para coordinación en terreno. | Nueva pestaña `Registro de Voluntarios`, campo `medio_transporte`, resumen lateral y tarjetas enriquecidas. |
| Rescatistas | `index.html`, `apps-script/codigo.gs` | Faltaban equipo disponible y capacidad operativa. | No se distinguía rescate técnico del voluntariado general. | Nueva pestaña `Registro de Rescatistas`, campos `equipo_disponible` y `capacidad_operativa`, estilo visual diferenciado. |
| Google Sheets | `apps-script/codigo.gs` | Agregar columnas podía desalinear hojas existentes si se usaba `appendRow` posicional. | Riesgo alto de escribir datos en columnas incorrectas. | `asegurarHoja()` ahora agrega cabeceras faltantes y `anexarObjeto()` escribe por nombre de columna. |
| Tarjetas | `index.html` | Centros, hospitales, voluntarios, rescatistas y familiares compartían patrón visual básico. | Baja escaneabilidad. | Cards por tipo, metadatos estructurados, progreso accesible y acciones de contacto condicionales. |
| Navegación | `index.html` | Navegación móvil tenía etiquetas abreviadas sin nombre accesible completo. | Lectores de pantalla podían recibir contexto incompleto. | `aria-label` explícito para cada botón de bottom nav. |
| Modales | `index.html` | Modales heredados tenían estilos inline y scroll dependiente de contenido. | Riesgo de overflow en móvil. | `modal-body` con `max-height` y estilos inline movidos a clase `form-actions`. |
| SEO | `index.html`, `sitemap.xml`, `vercel.json` | Open Graph incompleto, Twitter card básica, sitemap desactualizado. | Menor calidad de preview social e indexación técnica. | OG image con asset existente, `summary_large_image`, JSON-LD WebSite/WebApplication y `lastmod` 2026-06-30. |
| Seguridad/SEO técnico | `vercel.json` | CSP muy amplia y headers incompletos. | Menor hardening y señales técnicas pobres. | CSP por directiva, `nosniff`, HSTS, Referrer-Policy y Permissions-Policy. |
| Rendimiento | `index.html` | Riesgo de reflow por layouts flexibles no acotados y asset roto. | Layout shifts y carga visual inconsistente. | Dimensiones estables, `minmax`, `decoding=async`, asset local existente y eliminación de referencia rota. |

## Lista priorizada de mejoras

1. Corregido: responsive mobile-first para 320-1440px.
2. Corregido: formularios accesibles con errores inline.
3. Corregido: dashboard operativo y métricas accionables.
4. Corregido: campos nuevos en Sheets de forma aditiva.
5. Corregido: SEO técnico, OG/Twitter y sitemap.
6. Pendiente recomendado: validar con Lighthouse/axe en despliegue público real.
7. Pendiente recomendado: agregar coordenadas reales para activar mapa geográfico.
8. Pendiente recomendado: revisar contenido legal/políticas si el sitio se usa públicamente con datos personales.

## Archivos modificados

- `index.html`
- `apps-script/codigo.gs`
- `README-ARQUITECTURA.md`
- `vercel.json`
- `sitemap.xml`

## Checklist responsive

| Viewport | Estado | Nota |
|---|---|---|
| 320px | Cubierto por CSS mobile-first | Chromium CLI no generó screenshot estable para este ancho en el entorno. |
| 375px | Cubierto por CSS mobile-first | Grid de 1 columna, botones full width bajo 420px. |
| 390px | Validado con screenshot | `/tmp/donaciones-mobile.png` generado a 390x1200. |
| 414px | Cubierto por CSS mobile-first | Reglas `max-width: 420px` aplican a acciones y navegación. |
| 768px | Cubierto por breakpoint | Grids pasan a 2 columnas desde 640px. |
| 820px | Cubierto por breakpoint | `registry-shell` pasa a layout formulario + resumen. |
| 1024px | Cubierto por breakpoint | Top nav desktop, hero 2 columnas, grid 3 columnas. |
| 1280px | Cubierto por breakpoint | Espaciado y padding ampliados. |
| 1440px | Validado con screenshot | `/tmp/donaciones-desktop.png` disponible a 1440x1200. |

## Checklist accesibilidad WCAG 2.2

- [x] `lang="es"` conservado.
- [x] Skip link conservado.
- [x] Landmarks principales (`header`, `nav`, `main`, `section`) conservados.
- [x] Labels explícitos en formularios principales.
- [x] Estados `:focus-visible` visibles y con `scroll-margin`.
- [x] Objetivos táctiles principales 44px+.
- [x] Errores de formularios con `aria-invalid`, texto visible y `role="alert"`.
- [x] Regiones dinámicas con `aria-live`.
- [x] Botones nativos para navegación y acciones.
- [x] Modales con `<dialog>` nativo y cierre por Escape.
- [ ] Pendiente recomendado: prueba manual con NVDA/VoiceOver/TalkBack en dispositivo real.

## Checklist SEO

- [x] Title y meta description presentes.
- [x] Canonical presente.
- [x] Meta robots index/follow presente.
- [x] Open Graph ampliado con imagen y descripción específica.
- [x] Twitter card `summary_large_image`.
- [x] JSON-LD `WebSite` + `WebApplication`.
- [x] `robots.txt` apunta a sitemap.
- [x] `sitemap.xml` actualizado a 2026-06-30.
- [x] Headers técnicos reforzados en `vercel.json`.
- [ ] Pendiente recomendado: validar Rich Results y Search Console tras deploy.

## Checklist rendimiento

- [x] Sin dependencias nuevas ni CDN.
- [x] CSS inline único, sin framework ni bundle adicional.
- [x] Asset roto eliminado.
- [x] Icono local usado como imagen social/hero decorativa.
- [x] Layouts con `minmax(0, 1fr)` para reducir overflow.
- [x] Animaciones respetan `prefers-reduced-motion`.
- [x] JS mantiene fallback/cache existente de `SheetsService`.
- [ ] Pendiente recomendado: medir Core Web Vitals en Vercel con Lighthouse/PageSpeed.

## Validación realizada

- `node --check /root/donaciones-venezuela/services/sheets.js`: OK.
- `node --check /tmp/codigo-gs-validacion.js`: OK.
- `node --check /tmp/donaciones-index-inline.js`: OK.
- `vercel.json` validado con `json.loads`: OK.
- Chromium headless generó `/tmp/donaciones-mobile.png` a 390x1200.
- Chromium headless generó `/tmp/donaciones-desktop.png` a 1440x1200.

## Referencias técnicas

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Google Search Central: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Schema.org: https://schema.org/

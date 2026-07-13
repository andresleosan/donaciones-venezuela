# Reglas de construcción — Respuesta Humanitaria Venezuela

Qué hay que respetar **siempre** al arreglar o construir algo en esta app.
Cada regla nació de un fallo real o de una decisión ya tomada. Si vas a
saltarte una, dilo antes, no después.

Última revisión: 2026-07-13 (auditoría completa con Playwright, v49).

---

## 1. Idioma: español e inglés, los dos, siempre

La app tiene **dos idiomas y solo dos**: español (por defecto) e inglés. El
francés se retiró el 2026-07-13 y no vuelve.

**R1.1 — Ningún texto visible se escribe a mano.** Todo pasa por `t('clave')`.
Si escribes una cadena en español dentro de un `.js`, es un bug, aunque se vea
bien en tu pantalla.

**R1.2 — Las dos claves, en el mismo commit.** Cada clave nueva va a
`locales/es.json` **y** a `locales/en.json`. Un archivo sin el otro no se
comitea. Verificación: los dos deben tener el mismo número de claves.

**R1.3 — Lo pintado con `innerHTML` NO se traduce solo.** Esta es la que nos
mordió. `cambiarIdioma()` solo re-rotula lo estático; cualquier vista construida
en JavaScript se queda congelada en el idioma en que se pintó. Si creas una
vista dinámica nueva, **tienes que engancharla al cambio de idioma**:

- Vistas tipo página (como `#ofrecer`): expón una función que la reconstruya y
  llámala desde `cambiarIdioma()` en `js/core.js`.
- Asistentes (`wizPublico`): ya se re-rotulan solos vía `wizRetraducirTodos()`.

**R1.4 — Reconstruir no puede costarle datos al usuario.** Si repintas una vista
por cambio de idioma, primero capturas el estado vivo (lo escrito, las fotos
tomadas, las coordenadas) y lo vuelves a inyectar. Nadie pierde 20 fotos por
tocar el selector de idioma. Ver `window.reconstruirOfrecer` en `js/admin.js`.

**R1.5 — Los valores canónicos se guardan en español y se traducen al mostrar.**
En la base de datos van `Anónimo`, `Crítico`, `Centro de acopio`. La traducción
ocurre en la capa de presentación (`values.*`). Nunca guardes texto ya traducido:
ensucia los datos con dos idiomas mezclados.

**R1.6 — Los mensajes de error también son texto visible.** Un `throw new
Error('No se pudo guardar')` se le muestra al usuario. Pasa por `t()`.

**Cómo se comprueba:** carga la app en inglés (`?lang=en`), recorre la pantalla,
y luego cambia a español **con la pantalla ya abierta**. Todo tiene que cambiar,
y nada que hayas escrito puede desaparecer. Las dos direcciones.

---

## 2. Formularios: una casilla a la vez

Esta es la decisión de producto, no una preferencia estética.

**R2.1 — Todo formulario público es un asistente.** Un campo por pantalla, como
una app de Apple. Se usa `wizPublico(form, opts)` de `js/wiz.js`; no se
reimplementa a mano.

**R2.2 — La barra de progreso empieza con el paso 1 ya completado.** El usuario
entra viendo "Paso 2 de N": llegar ya fue un paso. Nunca arranca en cero.

**R2.3 — El asistente es una mejora, no una reescritura.** `wizPublico` respeta
los `id` de los campos y el handler de `submit` original, así el payload que
llega al backend no cambia. Si tienes que tocar el payload para meter el
asistente, lo estás haciendo mal.

**R2.4 — Cada paso valida antes de dejar pasar.** `opts.validar(paso)` devuelve
`true` (pasa), un `string` (mensaje de error) o `undefined` (validación HTML
normal). El error se muestra en el paso, no al final.

**R2.5 — Enter avanza.** En móvil y en teclado, Enter equivale a "Siguiente".

---

## 3. Ubicación y fotos: del mundo real, no de un cajón de texto

**R3.1 — La dirección NO se escribe.** El punto exacto sale del GPS o de un clic
en el mapa. Lo único que el usuario teclea es un **nombre de referencia**
("Portón azul, casa 12"), que sirve para reconocer el sitio al llegar.

**R3.2 — Las fotos se toman, no se suben.** La cámara del navegador, con permiso
explícito. Se retiró el botón de "subir de la galería" a propósito: una foto
tomada en el sitio es evidencia; una de la galería, no.

**R3.3 — El botón de disparo va grande y justo debajo del visor**, del mismo
ancho que la cámara (52px de alto, 12px de separación). Nada de botones
pequeños al lado.

**R3.4 — Foto del sitio de recogida obligatoria.** El transportista tiene que
ver a dónde llega, no solo un punto en un mapa.

**R3.5 — Las fotos de identidad son privadas.** Van al bucket privado
`registro-transportistas` vía la edge function, nunca a un bucket público ni al
`localStorage`.

---

## 4. Aspecto: sistema Stripe, sin excepciones

**R4.1 — Tokens, no valores sueltos.** `--primary #635BFF`, `--ink #0A2540`,
`--surface`, `--border`, `--muted #6B7C93`, `--radius`. Si escribes un color en
hexadecimal dentro de una regla nueva, para y busca el token.

**R4.2 — Espaciado en múltiplos de 4** (8 / 12 / 16 / 24). Nada de 7px, 15px ni
"lo que se veía bien".

**R4.3 — Móvil primero, 390px es la medida.** Cero desbordes horizontales. Toda
área táctil (botón, enlace, input, select) mide **44px de alto como mínimo**.
Esto está verificado hoy en las 14 vistas: si tu cambio lo rompe, es tu cambio.

**R4.4 — El `hidden` tiene que ganarle al `display`.** Un elemento con
`display:grid`/`flex` ignora el atributo `hidden`. Siempre declara
`.tu-clase[hidden]{display:none}`. Esto nos rompió el resumen del asistente y
antes la tarjeta de admin. Es el bug que más veces ha vuelto.

---

## 5. Plataforma: lo que no se toca

**R5.1 — Vanilla puro.** HTML, CSS y JS a mano. Sin frameworks, sin npm, sin
CDN. Los archivos son `index.html`, `ventana.html`, `css/app.css`,
`js/{core,vistas,panel,admin,ventana,wiz}.js`, `services/api.js`, `locales/`.

**R5.2 — Todo lo que se interpola con `innerHTML` pasa por `e()`.** Sin
excepciones: los nombres y las referencias los escribe el público.

**R5.3 — Supabase es la única fuente.** Lecturas por PostgREST, escrituras por
la edge function `api`. No vuelven Google Sheets ni los datos embebidos.

**R5.4 — Si cambias un archivo estático, sube la versión.** El `?v=` en
`index.html` y `ventana.html`, y `VERSION` en `sw.js`, **en el mismo commit**.
Si no, el service worker le sirve al usuario la versión vieja y jurarás que tu
arreglo no funciona.

**R5.5 — Los commits van con la identidad de Luismadef45** y se empujan a
`origin` (`andresleosan/donaciones-venezuela`), que es de donde despliega
producción.

---

## 6. Antes de decir "listo"

No se cierra nada sin esto:

1. Recorrer la pantalla en **Playwright**, no solo leer el código.
2. Probarla en **390px** (móvil) y en 1440px.
3. Probarla en **español y en inglés**, y cambiando el idioma con la pantalla
   abierta.
4. **Cero errores** en consola.
5. Versiones subidas (R5.4) y desplegado verificado en producción (`curl` al
   sitio y confirmar el `?v=` nuevo).

Si algo no se pudo probar, se dice. No se supone.

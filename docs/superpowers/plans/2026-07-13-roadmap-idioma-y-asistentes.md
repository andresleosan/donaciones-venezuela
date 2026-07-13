# Roadmap: idioma completo, asistentes en todos los formularios y limpieza de producción

> **Para quien ejecute esto (agente o persona):** los pasos usan casillas
> (`- [ ]`). Sigue las tareas en orden; cada una termina en algo probado y
> comiteado. Las reglas del proyecto están en `REGLAS.md` y son obligatorias.

**Objetivo:** que toda la app funcione idénticamente en español e inglés, que
todos los formularios que llena una persona del público sean asistentes paso a
paso, y que no se le sirva herramienta de desarrollo a un usuario real.

**Arquitectura:** app estática vanilla (sin build). El idioma se aplica en dos
capas: lo estático por `aplicarTraduccionesEstaticas()` y lo dinámico
reconstruyéndolo desde `cambiarIdioma()` en `js/core.js`. Los asistentes salen
todos del mismo motor, `wizPublico()` en `js/wiz.js`.

**Stack:** HTML/CSS/JS vanilla, Supabase (PostgREST + edge function `api`),
Leaflet local, Playwright para verificar.

## Restricciones globales

- Vanilla puro: sin frameworks, sin npm, sin CDN.
- Todo valor dinámico interpolado en `innerHTML` pasa por `e()`.
- Toda cadena visible pasa por `t()`, y la clave se añade a `locales/es.json`
  **y** `locales/en.json` en el mismo commit.
- Al cambiar cualquier estático: subir `?v=` en `index.html` / `ventana.html` y
  `VERSION` en `sw.js`. Versión actual: **49**.
- Commits como `Luismadef45`, push a `origin` (andresleosan), que es de donde
  despliega producción.
- Nada se da por bueno sin pasarlo por Playwright en 390px, en los dos idiomas.

---

## Estado: qué ya está hecho (2026-07-13, v49)

- [x] **Francés retirado**: `locales/fr.json` borrado, y fuera el `<option>`, el
  `hreflang`, el `og:locale:alternate` y la entrada en `I18N_LANGUAGES`.
- [x] **Vistas dinámicas se re-traducen** al cambiar idioma: `#ofrecer` se
  reconstruye conservando texto, fotos y coordenadas; el cromo de los seis
  asistentes se re-rotula (`wizRetraducirTodos()`).
- [x] **`#ofrecer` con enlace directo / recarga** ya no queda en blanco.
- [x] **Error de guardado** de `services/api.js` pasa por `t('messages.saveError')`.

---

## Tarea 1: El widget de desarrollo no se le sirve al público — HECHA (v50)

> Resuelta el 2026-07-13. La compuerta existía pero al revés (encendido por
> defecto, se apagaba con `?edit=0`): ahora es opt-in con `?dev=1`, persiste en
> `sessionStorage` durante la pestaña y se apaga con `?dev=0`. El público no lo
> ve nunca. Verificado en las cuatro rutas.


Hoy, cualquier usuario en producción ve flotando dos botones: "Copiar pantalla"
y "Seleccionar elemento". Son la herramienta de Luis para pedir cambios; no son
parte del producto. Además están **solo en español**, así que un usuario en
inglés ve dos botones en un idioma que no eligió.

**Decisión previa (preguntar a Luis):** ¿se retira del todo, o se deja detrás de
un interruptor? Recomendado: dejarlo, pero **solo cuando la URL lo pide**
(`?dev=1`), guardado en `sessionStorage`. Así Luis lo tiene cuando lo necesita y
el público no lo ve nunca.

**Archivos:**
- Modificar: `js/core.js` (bloque del widget, ~líneas 640-860)
- Modificar: `index.html` (contenedor del widget, si lo hay)

- [ ] **Paso 1: Encontrar el punto de montaje**

```bash
grep -n "Copiar pantalla\|Seleccionar elemento\|copiar-pantalla" js/core.js index.html
```

- [ ] **Paso 2: Poner el widget detrás del interruptor**

En `js/core.js`, donde se monta el widget, envolver el montaje:

```js
// Herramienta interna para pedir cambios: solo con ?dev=1, nunca para el público.
const modoDev = new URLSearchParams(location.search).has('dev') ||
  sessionStorage.getItem('dv-dev') === '1';
if (modoDev) {
  sessionStorage.setItem('dv-dev', '1');
  montarWidgetDev(); // el nombre real de la función que ya existe
}
```

- [ ] **Paso 3: Comprobar que el público no lo ve**

```bash
python3 -m http.server 8099 &
```

En Playwright: abrir `http://localhost:8099/` y verificar que NO existen los
botones; abrir `http://localhost:8099/?dev=1` y verificar que SÍ existen.

```js
document.body.innerText.includes('Copiar pantalla') // false sin ?dev=1, true con él
```

- [ ] **Paso 4: Subir versión y comitear**

```bash
git add -A && git commit -m "fix: el widget interno de cambios solo aparece con ?dev=1"
```

---

## Tarea 2: Guardia automática de idioma — HECHA (v51)

> Resuelta el 2026-07-13. `scripts/verificar-idioma.py` compara la paridad de
> claves es/en y busca texto en español cableado en el JS. Se corre con
> `python3 scripts/verificar-idioma.py` desde la raíz. Probado en negativo (se
> le introdujo una clave huérfana y un literal en español: los detecta; sin
> ellos, pasa). Lista blanca explícita para los valores canónicos (R1.5), los
> respaldos de `tx()/traducir()` y el widget interno. De paso descubrió un error
> real: `services/api.js` lanzaba dos mensajes de error solo en español, ya
> traducidos (`messages.saveError`, `messages.offlineQueueError`).


Un script que falla si las dos traducciones se desincronizan o si alguien deja
una cadena en español dentro del JS. Se corre a mano antes de comitear; es la
red que evita repetir la auditoría de hoy.

**Archivos:**
- Crear: `scripts/verificar-idioma.py`

- [ ] **Paso 1: Escribir el verificador**

```python
#!/usr/bin/env python3
"""Falla si es.json y en.json no son paralelos, o si hay español suelto en el JS."""
import json, re, sys, glob

def aplanar(d, p=''):
    o = {}
    for k, v in d.items():
        o.update(aplanar(v, p + k + '.')) if isinstance(v, dict) else o.update({p + k: v})
    return o

es = aplanar(json.load(open('locales/es.json')))
en = aplanar(json.load(open('locales/en.json')))
fallos = []

for k in sorted(set(es) - set(en)):
    fallos.append(f'clave sin inglés: {k}')
for k in sorted(set(en) - set(es)):
    fallos.append(f'clave sin español: {k}')

# Cadenas con acentos/ñ dentro del JS, fuera de t('...') -> texto cableado
acento = re.compile(r'[áéíóúñ¿¡]')
for archivo in glob.glob('js/*.js') + glob.glob('services/*.js'):
    for n, linea in enumerate(open(archivo, encoding='utf-8'), 1):
        limpia = re.sub(r"t\(\s*'[^']*'", 't(', linea)          # ignora claves de t()
        if limpia.lstrip().startswith('//'):
            continue
        for m in re.finditer(r"'([^'\\\n]{6,})'|\"([^\"\\\n]{6,})\"", limpia):
            txt = m.group(1) or m.group(2)
            if acento.search(txt):
                fallos.append(f'{archivo}:{n}: texto cableado en español: {txt!r}')

if fallos:
    print('\n'.join(fallos))
    print(f'\n{len(fallos)} problema(s) de idioma.')
    sys.exit(1)
print(f'Idioma OK: {len(es)} claves paralelas en es/en, sin texto cableado.')
```

- [ ] **Paso 2: Correrlo y ver que pasa (o que señala lo real)**

```bash
python3 scripts/verificar-idioma.py
```

Esperado: `Idioma OK: 1053 claves paralelas…`, salvo los valores canónicos que
sí deben quedarse en español (`Anónimo`, `Crítico`, categorías). Si los marca,
añade una lista blanca explícita al script con esos valores y un comentario
diciendo por qué son legítimos (regla R1.5 de `REGLAS.md`).

- [ ] **Paso 3: Comitear**

```bash
git add scripts/verificar-idioma.py && git commit -m "chore: verificador de paridad es/en y de texto cableado"
```

---

## Tarea 3: Los valores canónicos se muestran traducidos — HECHA en código (v53); FALTA DESPLEGAR LA EDGE FUNCTION

> 2026-07-13. La tarea apuntaba a `Anónimo`, pero rastreando el dato resultó que
> **el nombre del donante nunca se muestra en público** (privacidad por diseño:
> `seguimiento_factura` no lo expone). El hueco real estaba en la **línea de
> tiempo del seguimiento**: la edge function escribía 9 frases en español
> (`"Donación registrada: 5 unidades de Agua"`) y los tipos/estados
> (`Ingreso`, `Entrega`, `Ofrecida`) se pintaban crudos.
>
> Arreglado según R1.5: el servidor guarda **código + datos**
> (`mov('donacionOfrecida', {…})` → `{"k":"mov","c":"…"}`) y el cliente lo
> redacta con `textoMovimiento()` en el idioma activo; los tipos y estados pasan
> por `tValue('movementTypes'|'invoiceState', …)`. Las filas anteriores (texto
> plano) se siguen mostrando tal cual. Verificado en los dos idiomas.
>
> **Edge function desplegada**: `api` v18 ACTIVE (2026-07-13, autorizado por
> Luis). Verificado en producción: tipos y estados traducen (`Offer`/`Offered`),
> y las filas antiguas siguen mostrándose en texto plano sin romperse.
>
> **Queda una decisión abierta**: los movimientos GUARDADOS ANTES del cambio
> siguen siendo frases en español y se verán así para siempre, también en inglés.
> Son pocos (la app es reciente). Para traducirlos habría que migrar esas filas
> de `movimientos_factura` a formato código+datos (`UPDATE` sobre producción,
> reversible con respaldo previo). Preguntar a Luis si quiere hacerlo.


En la base se guarda `Anónimo` (correcto). Pero un donante que navega en inglés
ve "Anónimo" en la lista de donaciones. La traducción falta en la capa de
presentación.

**Archivos:**
- Modificar: `js/vistas.js` y `js/core.js` (donde se pinta el nombre del donante)
- Ya existe la clave: `common.anonymous` en ambos locales.

- [ ] **Paso 1: Localizar dónde se pinta el nombre del donante**

```bash
grep -rn "donante\|nombreDonante\|donanteName" js/*.js | grep -i "innerHTML\|e(" | head
```

- [ ] **Paso 2: Traducir al mostrar, no al guardar**

Añadir en `js/core.js`, junto a los demás ayudantes de presentación:

```js
// Los valores canónicos viven en español en la base (R1.5): se traducen aquí.
const mostrarDonante = (nombre) => (nombre === 'Anónimo' ? t('common.anonymous') : nombre);
```

Y usarlo en cada sitio donde hoy se interpola el nombre crudo:
`${e(mostrarDonante(d.donante))}`.

- [ ] **Paso 3: Verificar en los dos idiomas**

Playwright en `#donaciones`: en `?lang=en` no puede aparecer la cadena
`Anónimo`; en `?lang=es` sí.

- [ ] **Paso 4: Subir versión (v50) y comitear**

---

## Tarea 4: Asistente en los formularios del transportista — HECHA (v54)

> 2026-07-13. `wizPublico('trayecto-form' | 'recogida-form' | 'entrega-form')`.
> Bastó una línea por formulario: los campos ya eran `.field` y las fotos son
> `input file` con `required`, así que el motor los valida solo. Verificado:
> trayecto (6 pasos), recogida (6), entrega (5); todos entran en "Paso 2 de N",
> un campo a la vez; bloquean el paso si falta el dato o la foto; el resumen
> final lista lo escrito; el payload enviado es idéntico al de antes
> (interceptado en el navegador, sin escribir en producción). Probado en 390px y
> en inglés: sin desbordes y sin controles por debajo de 44px.


El transportista es público, pero sus tres formularios se quedaron fuera del
rediseño: se llenan de golpe, con todos los campos a la vez. Rompe la promesa de
"una casilla a la vez" justo para el usuario que rellena cosas en la calle,
desde el móvil y con prisa.

**Formularios pendientes:** `trayecto-form` (`js/admin.js:513`), `recogida-form`
(`js/admin.js:936`), `entrega-form` (`js/admin.js:976`).

**Archivos:**
- Modificar: `js/admin.js`

**Interfaces:**
- Consume: `wizPublico(form, opts)` de `js/wiz.js`. Devuelve `{form, retraducir,
  irA}` o `null` si el formulario tiene menos de 2 campos.

- [ ] **Paso 1: Enganchar el asistente a `trayecto-form`**

Justo después de que el formulario esté en el DOM y sus handlers atados (mismo
patrón que `donar-mot-form` en `js/admin.js:528`):

```js
wizPublico('trayecto-form');
```

- [ ] **Paso 2: Probar el paso a paso en Playwright**

Entrar como transportista, abrir "Registrar trayecto" y comprobar:
- Aparece la barra de progreso y dice "Paso 2 de N" al entrar (regla R2.2).
- Solo se ve un campo a la vez.
- El envío sigue guardando igual (el payload no cambia, regla R2.3).

- [ ] **Paso 3: Repetir para `recogida-form` y `entrega-form`**

```js
wizPublico('recogida-form');
wizPublico('entrega-form');
```

Ojo: estos dos llevan fotos. Si el campo de foto es un `input file`, el paso lo
gestiona igual el asistente; comprueba que el paso de foto no se salta la
validación.

- [ ] **Paso 4: Verificar los tres en 390px, en los dos idiomas, sin errores**

- [ ] **Paso 5: Subir versión y comitear**

```bash
git commit -m "feat(transportista): trayecto, recogida y entrega paso a paso"
```

---

## Tarea 5: La cámara del transportista, igual que la de #ofrecer — HECHA (v55)

> 2026-07-13. **La premisa del plan era inexacta**: el registro de transportista
> NO usaba un `input file`, ya tenía su propia cámara en vivo (con la misma
> pinta, porque compartían el CSS). Lo que sobraba era el **código**: dos motores
> de cámara casi idénticos.
>
> Unificados en `montarCamaraOferta` + `camaraHtml`; borradas las 90 líneas de
> `montarCamaraTransportista`/`camaraTransportistaHtml`. El motor único se queda
> con lo mejor de cada uno: hereda el botón **«Repetir foto»** del transportista
> (que a `#ofrecer` le faltaba: había que quitar la miniatura con la ✕ y reabrir),
> y los documentos de una sola foto (cédula, placa, sitio) se capturan a 1280px /
> 0.82 en vez de 1024 / 0.72, porque una cédula tiene que poder leerse.
>
> Verificado con cámara simulada: registro de transportista completo (3 fotos,
> «Repetir» reemplaza la foto, el paso bloquea si falta) y `#ofrecer` sin
> regresión (el lote de 20 lleva contador y no «Repetir»; la cédula al revés). El
> payload al backend no cambia.
>
> Nota: quedan sin uso las clases CSS `.driver-camera` / `.driver-photo-*` y las
> claves `modal.retakePhoto`/`modal.camera*`. No las borro en este commit (no
> estorban y borrarlas es otro cambio).


El registro de transportista pide tres fotos (placa, vehículo, cédula) y hoy no
usa el componente de cámara que construimos para `#ofrecer`. Dos cámaras
distintas en la misma app es deuda: una se arregla y la otra no.

**Archivos:**
- Modificar: `js/admin.js` (`mot-form`, ~línea 1131; reusar `montarCamaraOferta`
  y `camaraHtml`)

**Interfaces:**
- Consume: `camaraHtml(prefijo)` y
  `montarCamaraOferta(prefijo, fotosArray, max, alCambiar)` → `{parar}`.
  Renderiza visor 4:3, botón de disparo a todo el ancho debajo, contador y
  miniaturas con botón de quitar.

- [ ] **Paso 1: Sustituir cada campo de foto por un bloque de cámara**

Por cada una de las tres fotos, cambiar el `input type=file` por
`camaraHtml('mot-placa')` (y `mot-vehiculo`, `mot-cedula`), y montar:

```js
const placa = [], vehiculo = [], cedulaMot = [];
const camPlaca = montarCamaraOferta('mot-placa', placa, 1);
const camVehiculo = montarCamaraOferta('mot-vehiculo', vehiculo, 1);
const camCedulaMot = montarCamaraOferta('mot-cedula', cedulaMot, 1);
```

- [ ] **Paso 2: Que el submit lea de los arrays, no del input**

El payload debe seguir mandando los mismos campos que hoy espera la edge
function. Confirmar los nombres exactos antes de tocar:

```bash
grep -n "registrar_motorizado" -A 20 supabase/functions/api/index.ts | head -30
```

- [ ] **Paso 3: Probar con cámara simulada en Playwright**

Receta que funciona (un canvas repintado; si no se repinta, el vídeo no recibe
fotogramas y la captura no hace nada):

```js
const c = document.createElement('canvas'); c.width = 640; c.height = 480;
const ctx = c.getContext('2d'); let i = 0;
setInterval(() => { ctx.fillStyle = ['#635BFF', '#0A2540'][i++ % 2]; ctx.fillRect(0, 0, 640, 480); }, 100);
navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
```

- [ ] **Paso 4: Subir versión y comitear**

---

## Tarea 6: Cambiar de idioma con un modal abierto no puede borrar lo escrito — HECHA (v57)

> 2026-07-13. `cambiarIdioma()` hacía `modalAbierto.close()`: quien llevaba medio
> formulario escrito y tocaba el selector lo perdía todo sin aviso. Ahora el
> modal se **reconstruye** en el idioma nuevo y se le devuelve su estado:
> valores de los campos, **fotos ya tomadas** y **paso del asistente**.
>
> Mecanismo: cada modal declara cómo volver a abrirse (`recordarModal(fn)`, 7
> formularios); `guardarEstadoModal()` / `restaurarEstadoModal()` en `js/core.js`;
> las cámaras exponen sus fotos en `raiz.__camara` y los asistentes su paso en
> `form.__wiz`. Un modal que no declare reconstructor se cierra como antes.
>
> **Pitfall que costó una vuelta**: `dialog.close()` emite su evento `close` de
> forma ASÍNCRONA, y ese manejador vacía `#modal-root` — llegaba *después* de la
> reconstrucción y borraba el modal nuevo. Solución: no cerrar el diálogo viejo,
> reemplazarlo, apagando antes sus cámaras a mano (de eso se encargaba el
> manejador de cierre).
>
> Verificado: registro de transportista a medias (5 campos + foto de la placa, en
> el paso 8 de 11) → cambio a inglés → modal abierto, traducido, mismo paso 8 de
> 11, datos y foto intactos; un solo diálogo, ninguna cámara siguió grabando, y
> el modal de historial (sin reconstructor) se sigue cerrando.


Hoy `cambiarIdioma()` hace `modalAbierto.close()`: si el usuario llevaba medio
formulario escrito en un modal y toca el selector, pierde todo sin aviso.

**Archivos:**
- Modificar: `js/core.js` (`cambiarIdioma`, ~línea 461)

- [ ] **Paso 1: Reconstruir el modal en vez de cerrarlo**

Guardar qué modal está abierto y con qué datos (mismo patrón que
`window.reconstruirOfrecer`): cada función que abre un modal registra su
reconstructor.

```js
// El modal se vuelve a abrir en el idioma nuevo con lo que el usuario llevaba.
if (typeof window.reconstruirModal === 'function') window.reconstruirModal();
else if (modalAbierto) modalAbierto.close();
```

- [ ] **Paso 2: Prueba honesta**

Abrir "Donar a una necesidad", escribir monto y nombre, cambiar idioma:
el modal sigue abierto, en el idioma nuevo, con el monto y el nombre intactos.

- [ ] **Paso 3: Subir versión y comitear**

---

## Tarea 7: Guion E2E de idioma, guardado — HECHA (v57)

> 2026-07-13. `scripts/e2e-idioma.js` (se pega en la consola del navegador y se
> llama con `await pruebaIdioma()`) + `scripts/e2e-idioma.md` con cómo correrlo y
> cómo leerlo. Recorre las 14 vistas en los dos idiomas, más el cambio de idioma
> **en caliente** sobre `#ofrecer`. Solo lee: no escribe en la base.
>
> **Corrido contra producción a 390px: `ok: true`.** En la primera pasada dio dos
> hallazgos y los dos resultaron falsos positivos, ya filtrados en el guion: los
> textos de EJEMPLO (un placeholder en español que coincide con el nombre real de
> un centro) y las casillas de verificación (el área táctil es la etiqueta de
> 46px, no el cuadradito de 13px).
>
> Hallazgo colateral: mi auditoría manual del 2026-07-13 medía las áreas táctiles
> con el selector `.view.is-active`, que **no existe** (la clase real es
> `.view.active`), así que medía sobre un conjunto vacío y por eso salió limpia.
> El guion no comete ese error.


Que la comprobación de hoy no dependa de que alguien se acuerde de hacerla.

**Archivos:**
- Crear: `scripts/e2e-idioma.md` (guion reproducible, paso a paso)

- [ ] **Paso 1: Escribir el guion**

Para cada una de las 14 vistas (`inicio`, `donaciones`, `ayuda`, `donar`,
`ayudar`, `necesidades`, `acceso`, `transporte`, `centro`, `voluntarios`,
`rescatistas`, `familiar`, `seguimiento`, `ofrecer`):

1. Cargar en `?lang=en`, recorrer la vista y capturar todo texto visible.
2. Marcar cualquier texto que exista en `es.json` pero no en `en.json`.
3. Cambiar a español **sin recargar** y repetir a la inversa.
4. Comprobar: 0 errores de consola, 0 desbordes a 390px, ninguna área táctil
   por debajo de 44px.

Incluir el detector que usamos hoy (compara el texto visible contra el conjunto
de cadenas exclusivas de cada locale), ya escrito en la auditoría.

- [ ] **Paso 2: Comitear**

---

## Comprobación final del roadmap

Cuando las 7 tareas estén hechas:

```bash
python3 scripts/verificar-idioma.py                       # paridad es/en, sin texto cableado
curl -s https://donacionesvenezuela.vercel.app/ | grep -o "app.css?v=[0-9]*"   # versión desplegada
```

Y en Playwright, la prueba que resume todo: **entrar en inglés, llenar medio
formulario en cualquier pantalla, cambiar a español, y que no se pierda nada ni
quede una sola palabra en el idioma anterior.**

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

## Tarea 2: Guardia automática de idioma (que el bug no vuelva)

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

## Tarea 3: Los valores canónicos se muestran traducidos

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

## Tarea 4: Asistente en los formularios del transportista

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

## Tarea 5: La cámara del transportista, igual que la de #ofrecer

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

## Tarea 6: Cambiar de idioma con un modal abierto no puede borrar lo escrito

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

## Tarea 7: Guion E2E de idioma, guardado

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

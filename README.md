# 🆘 Donaciones Venezuela

App web de respuesta rápida a los terremotos de Venezuela del 24 de junio de 2026.
Sin dependencias, sin build, sin servidor propio: un solo `index.html` + Google Sheets como base de datos + Google Apps Script como backend + Vercel como hosting.

---

## 1. ¿Qué hace esta app?

Tiene **dos pestañas**:

1. **🎁 Donaciones** — lista de **centros de acopio** y **hospitales** con lo que **necesitan** y lo que **tienen disponible** para compartir. Incluye **matching automático**: si un lugar necesita un insumo y otro lo tiene disponible, la app lo señala sola. Botones directos de **📞 Llamar** y **💬 WhatsApp**.
2. **🔍 Buscar familiar** — permite buscar por nombre o cédula en los registros de personas reportadas (localizadas, en refugio, hospitalizadas, etc.). Consulta un **webhook de N8N** (lo aporta un compañero del equipo). Mientras llega esa URL, funciona en **modo demo** con datos de ejemplo.

La app es **mobile first**, funciona **parcialmente offline** (cachea los últimos datos en el navegador) y **arranca con datos de ejemplo** apenas la abres, sin configurar nada.

---

## 2. Setup completo paso a paso

> Puedes **abrir `index.html` directamente** (doble clic) para verla funcionando en modo demo ahora mismo. Para datos en vivo, sigue estos pasos (~30 min).

### Paso 1 — Crear el Google Sheet
1. Entra a [sheets.new](https://sheets.new) y crea una hoja de cálculo.
2. Renombra la pestaña inferior a **`lugares`** (en minúsculas).
3. En la **fila 1**, pon estos encabezados (columnas A a H):

   `Tipo` · `Nombre` · `Ubicacion` · `Telefono` · `Insumo` · `Categoria` · `Estado` · `Actualizado`

4. Llena una fila **por cada insumo de cada lugar**. Ejemplo:

   | Tipo | Nombre | Ubicacion | Telefono | Insumo | Categoria | Estado | Actualizado |
   |---|---|---|---|---|---|---|---|
   | Centro | Iglesia San José | Los Corales, La Guaira | +58 412 555 1234 | Gasas estériles | Medicinas | Necesita | 2026-06-28 |
   | Hospital | Hospital El Algodonal | El Algodonal, Caracas | +58 212 555 5000 | Gasas estériles | Suministros quirúrgicos | Tiene disponible | 2026-06-28 |

   > **Atajo (recomendado):** en vez de teclear filas a mano, importa el archivo `data/lugares.csv` del repo — *Archivo → Importar → Subir → elige `lugares.csv` → "Reemplazar la hoja actual" → Importar datos*. Trae los mismos 5 lugares del demo con las coincidencias listas.

5. Copia el **ID del Sheet**: en la URL `https://docs.google.com/spreadsheets/d/`**`ESTO_DE_AQUI`**`/edit`.

### Paso 2 — Publicar el Apps Script (backend)
1. En el Sheet: menú **Extensiones → Apps Script**.
2. Borra el contenido y pega **todo** el archivo `apps-script/codigo.gs`.
3. Arriba del archivo, reemplaza `YOUR_SHEET_ID` por el ID que copiaste.
4. **Implementar → Nueva implementación → tipo: Aplicación web**.
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**
5. Autoriza los permisos cuando lo pida y copia la **URL `.../exec`** que te da.

> ⚠️ **Al actualizar el código del Apps Script más adelante**, no crees otra "Nueva implementación" (eso genera una URL `/exec` distinta y tendrías que volver a tocar `index.html`). Usa **Implementar → Gestionar implementaciones → editar ✏️ → Versión: _Nueva versión_ → Implementar**: así la misma URL `/exec` toma el código nuevo.
>
> 📌 Dos errores típicos al configurar: (a) `SHEET_ID` es **solo el ID** del Sheet (lo que va entre `/d/` y `/edit`), **no** la URL `/exec` del script; (b) el `/exec` redirige internamente a `script.googleusercontent.com` — por eso el `vercel.json` incluye ese dominio en la CSP (si lo quitas, el navegador bloquea los datos y la app cae a modo demo).

### Paso 3 — Conectar `index.html`
1. Abre `index.html` en un editor.
2. Busca, al inicio del `<script>`, la línea `const APPS_SCRIPT_URL = ...`.
3. Reemplaza la URL completa por tu URL `.../exec` del paso anterior.
4. Guarda. (Mientras la URL contenga `YOUR_SCRIPT_ID`, la app sigue en modo demo.)

### Paso 4 — Desplegar en Vercel
1. Entra a [vercel.com](https://vercel.com) e inicia sesión.
2. Opción rápida: **arrastra la carpeta del proyecto** a Vercel (o conéctala a un repo de GitHub).
3. Vercel detecta el sitio estático y lo publica. El `vercel.json` ya trae las cabeceras de seguridad.
4. Comparte la URL pública. ¡Listo!

---

## 3. Cómo editar los datos

Todo se edita **en el Google Sheet** (no toques el código para esto):

- **Agregar un lugar/insumo:** añade una fila nueva con sus 8 columnas.
- **Marcar una necesidad:** columna `Estado` = `Necesita`.
- **Marcar algo disponible para compartir:** columna `Estado` = `Tiene disponible`.
- **Categorías válidas:**
  - *Centros:* Alimentos, Bebidas, Ropa, Medicinas, Higiene, Herramientas, Mascotas, Otros.
  - *Hospitales:* Medicinas, Equipos médicos, Suministros quirúrgicos, Higiene, Fluidos IV, Otros.
- Los cambios aparecen en la app al recargar (no hay que volver a desplegar nada).

> No importan mayúsculas ni acentos en `Estado` (`necesita`, `NECESITA`, `Tiene Disponible`… todo vale).

---

## 4. Cómo funciona el matching automático

La idea es simple: **lo que a un lugar le sobra, a otro le falta.**

1. El backend mira todas las filas marcadas como `Necesita` y todas las marcadas como `Tiene disponible`.
2. Para cada necesidad, busca si **otro lugar distinto** tiene ese mismo insumo disponible (comparando el nombre sin distinguir mayúsculas ni acentos, así "Gasas estériles" y "gasas esteriles" cuentan como el mismo).
3. Cuando hay coincidencia, en la tarjeta del lugar que **necesita** aparece un botón morado **🔗 Disponible en N lugar(es)**.
4. Al tocarlo, se despliega el lugar que **tiene** ese insumo, con sus botones de **Llamar / WhatsApp** apuntando **a ese lugar** (el que puede entregarlo), para coordinar el traslado directamente.

Así nadie tiene que cruzar listas a mano.

---

## 5. Pendiente — Buscar familiar (webhook de N8N)

El módulo **Buscar familiar** ya está construido y funcionando en **modo demo** (usa `data/familiares-ejemplo.json`). Falta solo enchufar la fuente real:

- Un compañero del equipo tiene el sistema de scraping en **N8N**, expuesto como **webhook**. **La URL la comparte mañana.**
- Cuando llegue, en `index.html` reemplaza:
  ```js
  const BUSCAR_WEBHOOK_URL = '';   // <-- pega aquí la URL del webhook
  ```
- La app envía `POST { "query": "<lo que escribió el usuario>" }` y espera de vuelta:
  ```json
  { "encontrado": true, "resultados": [ { "nombre": "...", "cedula": "...", "estado": "...", "ubicacion": "...", "fuente": "...", "actualizado": "..." } ] }
  ```
- Si el **formato real** de la respuesta difiere, ajusta la función `buscarFamiliar()` en la sección `// ── BUSCAR FAMILIAR ───` del `<script>`.
- **Seguridad:** si el webhook pide una API key, **no la pongas en `index.html`** (es código público). Hay un comentario `// TODO` marcado donde decidir cómo protegerla (proxy en Apps Script o similar). Verifica también que el webhook permita **CORS**.

---

## 6. Troubleshooting (problemas comunes)

1. **La app muestra "Modo demo" aunque configuré el Apps Script.**
   La constante `APPS_SCRIPT_URL` todavía contiene `YOUR_SCRIPT_ID`, o no es la URL `.../exec`. Vuelve al Paso 3.

2. **Sale "Sin conexión" o no carga nada en vivo.**
   La implementación del Apps Script no es pública. Re-despliega con *Acceso: Cualquier usuario* y usa la URL `.../exec` (no la del editor).

3. **El matching no aparece.**
   Revisa que los nombres de insumo coincidan (la app ignora mayúsculas/acentos, pero no errores de tipeo) y que un lugar lo tenga como `Necesita` y **otro distinto** como `Tiene disponible`.

4. **El botón de WhatsApp no abre el chat correcto.**
   El número en la columna `Telefono` debe incluir el código de país (ej. `+58 412...`). La app deja solo los dígitos para armar el enlace `wa.me`.

5. **Buscar familiar no devuelve nada real.**
   Es lo esperado hasta que se configure `BUSCAR_WEBHOOK_URL` (ver sección 5). En modo demo solo encuentra los nombres del archivo de ejemplo.

---

## 7. Roadmap / Fase 2

- Conectar la URL real del webhook de N8N de Buscar familiar.
- Geolocalización: ordenar lugares por cercanía al usuario.
- Filtro por "solo lugares con coincidencias".
- Indicador de "última actualización" global y auto-refresco.
- Panel de administración ligero para editar el Sheet desde la propia app.
- Soporte multi-idioma (es/en) para apoyo internacional.

---

### Estructura del proyecto

```
/
├── index.html                    App completa (HTML + CSS + JS en un archivo)
├── apps-script/codigo.gs         Backend de Google Apps Script
├── data/ejemplo.json             Datos demo de donaciones (con matching)
├── data/familiares-ejemplo.json  Datos demo de Buscar familiar
├── vercel.json                   Cabeceras de seguridad para el deploy
├── .gitignore
└── README.md                     Este archivo
```

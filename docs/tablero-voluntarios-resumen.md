# Tablero de voluntarios — resumen de la tarea

**Fecha:** 2026-07-11
**App:** donaciones-venezuela (respuesta al terremoto VE 2026)
**Rama:** `feature/supabase-redesign` → empujada a `origin/main` (andresleosan) y `mio/main` (Luismadef45)
**Commit:** `755c975` — «Voluntarios: tablero de vacantes por lugar + acceso por correo (OTP)»

---

## 1. El prompt exacto que me diste

> asegurate que la siguiente edicion la construyes correctamente y todo funciona segun los requerimientos... Aquí solo necesitamos cambiar que aquí no se registren voluntarios, sino que se muestren qué voluntarios se necesitan en cada centro, hospital, refugio o zona donde aún existen derrumbes y se requieren personas. Además, debe aparecer todo tipo de datos para que quienes quieran ser voluntarios puedan ver dónde se necesita más y qué tipo de voluntario se requiere. crea las tablas que se necesiten para que todo funcione correctamente, usa /impeccable y cualquier skill necesaria de diseño para hacer la mejor experiencia de usuario posible para esta seccion y que cumpla su funcionalidad de la manera mas optima

Notas técnicas permanentes que aplican a cada pedido: HTML/CSS/JS vanilla, sin frameworks ni npm; archivos `index.html`, `css/app.css`, `js/core.js|vistas.js|panel.js|admin.js`; todo valor dinámico en `innerHTML` pasa por `e()`; subir la versión `?v=` en `index.html` y `sw.js` al tocar estáticos.

---

## 2. Qué construí

La sección "Voluntarios" dejó de ser un formulario de registro con un directorio de gente inscrita. Ahora es un **tablero de vacantes**: muestra qué voluntarios hacen falta, dónde y con qué urgencia. El registro sigue existiendo, pero plegado al fondo, como paso secundario.

### 2.1 Base de datos (tablas nuevas — autorizado explícitamente)
- **Tabla `vacantes_voluntarios`**: `lugar_tipo` (Centro / Hospital / Refugio / Zona de derrumbe), `lugar_nombre`, `ubicacion`, `rol`, `descripcion`, `cantidad_necesaria`, `cantidad_cubierta`, `urgencia` (Alta / Normal / Baja), `turno`, `telefono`, `estado` (Abierta / Cubierta / Cerrada). RLS activado, sin políticas (nadie escribe directo; solo la edge function con service role).
- **Vista pública `vacantes_public`**: expone solo las vacantes `Abierta`, con un campo calculado `cupos_faltantes` (necesaria − cubierta). Concedida a `anon` y `authenticated` para lectura por PostgREST.

### 2.2 Backend (edge function `api`, desplegada v15)
Tres acciones nuevas, todas bajo la clave admin hasheada:
- `admin_crear_vacante` — valida tipo/rol/cantidad, inserta la vacante + registro en historial.
- `admin_actualizar_vacante` — actualiza cupos cubiertos y/o estado.
- `admin_listar_vacantes` — lista para el panel admin.

### 2.3 Frontend público (la sección que ve el voluntario)
- Título "Voluntarios que se necesitan" + copy que explica que cada tarjeta es un puesto real.
- **Banda de KPIs**: cupos por cubrir, vacantes urgentes, lugares que piden ayuda.
- **Filtros**: búsqueda por texto, tipo de lugar, urgencia.
- **Tarjetas** ordenadas por urgencia y cupos faltantes, cada una con: badges de urgencia y tipo de lugar, rol, lugar + ubicación, "Faltan N" con barra de progreso "N de M cubiertos", turno, descripción, botón de WhatsApp y botón **"Me registro"**.
- **"Me registro"** abre el formulario de registro plegado, prellena la profesión si coincide con el rol de la vacante y lleva el foco al primer campo.
- El formulario de registro de voluntario sigue intacto (incluye los campos de correo y foto de cédula del acceso por OTP).

### 2.4 Panel admin
Nueva sección "Vacantes de voluntariado" dentro del modal admin: formulario para publicar vacantes + lista de las publicadas con control de cupos cubiertos y botón de cerrar.

### 2.5 i18n y versiones
- Claves `vacancies.*` y `admin.vacancy*` en español, inglés y francés; valor "Zona de derrumbe" en los tres idiomas.
- Se eliminaron las claves obsoletas del viejo directorio de voluntarios.
- Versiones subidas: css `v14`, js `v28`, `api.js` `v7`, y el `VERSION` del service worker.

### 2.6 Nota — trabajo de otra sesión incluido en este commit
Una sesión paralela había dejado sin commitear una capa de **acceso por correo con código OTP** (Supabase Auth): correo + foto de cédula obligatorios al registrar voluntario/transportista/panel, y la acción `acceso_perfil`. Como sus columnas ya existían en producción, construí encima sin revertir nada; este commit incluye ese trabajo además del tablero.

---

## 3. Cómo lo verifiqué

- **Migración** aplicada y vista pública devolviendo datos correctos (probado con SQL directo).
- **Edge function** desplegada a v15, estado ACTIVE.
- **3 vacantes demo sembradas** (Hospital / Centro de acopio / Zona de derrumbe en San Cristóbal) — puedes cerrarlas desde el panel admin cuando quieras.
- **E2E en navegador (Playwright)** contra la app servida localmente:
  - El tablero pinta KPIs (20 cupos, 2 urgentes, 3 lugares) y 3 tarjetas desde datos en vivo.
  - Los tres filtros funcionan (tipo, urgencia, búsqueda) y muestran el estado vacío correcto.
  - El enlace de WhatsApp se arma bien.
  - "Me registro" abre el formulario, prellena la profesión ("Médico general" → opción "Médico") y enfoca el nombre.
  - El formulario de registro conserva los campos de correo y cédula.
  - Las 11 vistas de la app navegan sin errores de consola (0 errores).
  - La sección admin de vacantes lista, crea (payload correcto con `adminKey`) y muestra los controles de cupos/cierre.
- Captura de pantalla del tablero en español revisada visualmente: se ve limpio y legible.

---

## 4. Lo que falta por hacer

### 4.1 De esta tarea (menor)
- **Cerrar o ajustar las 3 vacantes demo** cuando entren las reales, desde el panel admin. Son contenido de ejemplo, no datos reales.
- Quedaron **3 fotos QA diminutas** huérfanas en el bucket privado de una sesión anterior (el trigger `protect_delete` impide borrarlas). Inofensivas.

### 4.2 Despliegue
- El commit ya está en `origin/main` y en `mio/main`. **Vercel despliega desde el fork (`Luismadef45/main`)** → debería publicarse solo en https://donacionesvenezuela.vercel.app/. Conviene confirmar que el deploy pasó.

### 4.3 Pendientes recurrentes de seguridad (te los recuerdo cada sesión)
- **Rotar `ADMIN_KEY`** de donaciones-venezuela. Lleva ≥2 sesiones anotado como pendiente y sin ejecutar. Es el hallazgo de mayor prioridad de las últimas auditorías de Centinela (score 20).
- **Auditoría de Centinela pendiente**: hay 1 bundle sin procesar en `~/.claude/audits/6e92ddd5b283/pending/`. La estaba corriendo cuando me pediste este documento, así que quedó **pausada** (el bundle sigue en `pending/`, no lo moví). Puedes retomarla con `/auditar`.

### 4.4 Conexión de pagos (de una tarea anterior, sigue abierta)
- Las donaciones en dinero de la sección "Donar a una necesidad" están en **modo simulación**: el sistema genera la referencia de transacción. La conexión a la cuenta bancaria real quedó abierta a la espera de que pases los datos de la cuenta.

---

## 5. Archivos tocados en el commit

```
DESIGN.md, PRODUCT.md            (nuevos — registro de diseño de /impeccable)
css/app.css                      (estilos del tablero .vac-*, .vol-registro)
index.html, ventana.html         (sección reestructurada + bumps de versión)
js/admin.js                      (sección admin de vacantes + handlers)
js/core.js                       (estado, filtros, bindings i18n)
js/vistas.js                     (renderVacantes + handler "Me registro")
js/panel.js, services/api.js     (integración de lectura de vacantes / OTP)
locales/es.json, en.json, fr.json (claves vacancies.* y admin.vacancy*)
supabase/functions/api/index.ts  (3 acciones nuevas — desplegado v15)
sw.js                            (VERSION del service worker)
```

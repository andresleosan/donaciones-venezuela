# Consola de datos del admin — diseño

**Fecha:** 2026-07-25
**Objetivo:** que el admin pueda **ver, crear, corregir y eliminar** cualquier dato de
negocio de la aplicación desde la propia app, con defensas contra duplicados y datos
falsos, y sin que nadie más pueda hacerlo.

## Problema

La base tiene **22 tablas**. La consola de admin actual solo cubre bien seis
(facturas, vacantes, personas, denuncias, familias y presupuestos), y de esas casi todo
es **crear y listar**: apenas hay editar y no hay borrar.

Consecuencias medidas en el esquema real:

- `motorizados` (los transportistas), `trayectos`, `insumos`, `lugares`,
  `donaciones_motorizados` y `entregas` **no tienen ninguna acción de admin**.
- De `voluntarios` y `rescatistas` solo hay lectura: un voluntario que se registró con
  el teléfono mal escrito no se puede corregir, y uno falso no se puede quitar.
- **`voluntarios`, `motorizados`, `rescatistas` y `personas` no tienen ninguna
  restricción de unicidad** — ni por correo, ni por cédula, ni por teléfono. La base
  acepta el mismo voluntario diez veces sin protestar. Es justo el punto donde nacen
  los duplicados.
- Lo único que hoy frena un duplicado es `lugares.nombre UNIQUE`, y el error que
  produce es un fallo crudo de Postgres, no un aviso útil.

## Decisiones tomadas (trazables)

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | **19 tablas de negocio**; fuera `config`, `rate_limit`, `tasas` y `spatial_ref_sys` | Incluir también las de sistema | En `config` vive el hash de la clave de admin, el secreto del cron y el token de Telegram; en `rate_limit`, la defensa anti-fuerza-bruta. Editarlas desde el navegador convierte un acceso puntual en persistencia. |
| D2 | **Borrado mixto**: los registros se borran de verdad; la trazabilidad se archiva | Borrar todo; archivar todo | Un voluntario duplicado se borra. Un historial de donaciones no: la trazabilidad por token `DV-` es la promesa central del producto. |
| D3 | Sigue **una sola ADMIN_KEY**, y se añade **bitácora** de cada cambio | Cuentas de admin individuales | Cierra el riesgo grande (no saber qué se tocó ni qué había antes) sin construir un sistema de identidades. El «quién» real queda pendiente con el JWT de admin (S1). |
| D4 | **Pantallas a medida** por entidad, sobre **fontanería compartida** | Un patrón único generado; rejilla tipo hoja de cálculo | Elección de Luis. Lo «a medida» es el diseño de cada ficha; el listado, la búsqueda, el borrado, la bitácora y el detector de duplicados son código común: 8 pantallas distintas, no 8 implementaciones. |
| D5 | El servidor expone **acciones genéricas con lista blanca**, no una acción por tabla | 4 acciones × 19 tablas = 76 acciones | 76 acciones son inmantenibles y cada una es una superficie de ataque nueva. La lista blanca declara qué tabla y **qué columnas** se pueden tocar: es la pieza de seguridad central. |
| D6 | Hay columnas que **nunca** son editables | Editar cualquier columna | `pin_hash`, `token_publico`, `monto_recaudado`, `video_path`, las rutas de fotos: son credenciales, identidad o evidencia. Corregir un dato no puede significar falsificar una prueba. |
| D7 | Los duplicados se **avisan al guardar**, no se bloquean | Rechazar el guardado | Dos personas pueden llamarse igual. El admin decide; el sistema le enseña el registro parecido antes de crear otro. |
| D8 | Las fotos de cédula se **ven** (URL firmada), nunca se editan | No mostrarlas | Es la única palanca real contra los datos falsos: ver la cédula, comparar con el nombre, y borrar lo que no cuadre. |

## Arquitectura

Dos mitades con reglas distintas, y esa asimetría es deliberada:

**El servidor es uniforme y está en lista blanca.** Un registro declarativo en la edge
function describe cada entidad: tabla, clave primaria, columnas que se listan, columnas
que se pueden editar, columnas de búsqueda, política de borrado y claves naturales de
duplicado. Ocho acciones genéricas (`admin_datos_*`) operan **solo** sobre lo declarado.
Todo lo que no esté en el registro no existe para la API.

**El cliente es a medida.** Cada entidad tiene su propia pantalla, con el diseño que le
conviene: el centro de acopio con mapa e insumos anidados; el transportista con sus tres
fotos; el voluntario con su cédula y su profesión. Todas se apoyan en helpers comunes
para listar, buscar, paginar, confirmar un borrado y avisar de un duplicado.

Ninguna acción nueva se salta el portero: **toda acción nueva se llama `admin_…`**, y
`handle()` ya exige `autenticarAdmin` a cualquier acción con ese prefijo. Eso, y no una
comprobación repetida en cada caso, es lo que garantiza el «solo los admin». La RLS
sigue denegando por defecto: nada de esto se puede hacer desde PostgREST.

### Las 19 entidades y su política de borrado

**Grupo A — Registros (8). Se borran de verdad.** Un duplicado o un dato falso debe
desaparecer, y ninguna de estas filas es evidencia de nada.

`lugares`, `insumos`, `voluntarios`, `rescatistas`, `motorizados`, `centros_panel`,
`vacantes_voluntarios`, `personas`.

**Grupo B — Trazabilidad, evidencia y PII (11). Se archivan.** Dejan de verse en la app
y en las vistas públicas, pero la fila sigue ahí. Desde la papelera se pueden restaurar
o, con una segunda confirmación, borrar definitivamente.

`facturas`, `donaciones`, `movimientos_factura`, `evidencias`, `viajes`, `trayectos`,
`donaciones_motorizados`, `historial_movimientos`, `denuncias`,
`familias_damnificadas`, `entregas`.

> `entregas` tiene 0 filas y **ninguna acción la escribe**: parece código muerto de una
> versión anterior. Se incluye por completitud; conviene decidir aparte si se retira.

### Borrados que arrastran

El esquema ya define cascadas, y la pantalla debe decirlo **antes** de borrar:

| Borrar… | Arrastra | Aviso obligatorio |
|---|---|---|
| `lugares` | `insumos` y `centros_panel` en **CASCADE** | «Esto borrará N insumos y dejará al centro sin acceso a su panel» |
| `motorizados` | `trayectos` y `donaciones_motorizados` a **SET NULL** | «N trayectos quedarán sin transportista asignado» |
| `facturas` | `donaciones`, `movimientos_factura`, `evidencias` en CASCADE; `viajes` lo **bloquea** (NO ACTION) | Por eso las facturas se archivan, no se borran |

### Columnas que nunca se editan

Credenciales (`centros_panel.pin_hash`, `pin_salt`, `token_centro`), identidad y
trazabilidad (`facturas.numero_factura`, `token_publico`, `familias.codigo`), totales que
calcula un trigger (`facturas.monto_recaudado`), evidencia (`donaciones.comprobante`,
`denuncias.video_path`, `viajes.paso*`, las rutas `foto_*`) y las marcas de tiempo
automáticas. Las fotos **se ven** por URL firmada de una hora; no se sustituyen.

El acceso de un centro no se edita: se **regenera** con la acción que ya existe
(`admin_regenerar_panel`) o se **revoca** borrando su fila de `centros_panel`.

### Bitácora

Tabla nueva `auditoria_admin`: fecha, IP, acción (`crear`/`editar`/`borrar`/`archivar`/
`restaurar`), entidad, id de la fila, y dos instantáneas JSON, `antes` y `despues`.
La escribe la edge function dentro de cada mutación; el admin la consulta en su propio
panel, filtrable por entidad y por fecha.

Como se guarda el `antes` completo, **deshacer una edición** es volver a aplicarlo por el
mismo camino con lista blanca. Se incluye: es barato y convierte la bitácora en una red
de seguridad de verdad, no en un archivo que nadie lee.

### Duplicados

Cada entidad declara sus **claves naturales**, normalizadas antes de comparar (sin
acentos, en minúsculas, sin espacios de más; los teléfonos y las cédulas, solo dígitos):

| Entidad | Claves naturales |
|---|---|
| `lugares` | nombre |
| `insumos` | centro + nombre |
| `voluntarios` | correo · teléfono · nombre y apellido |
| `motorizados` | correo · teléfono · placa |
| `rescatistas` | teléfono · nombre y organización |
| `personas` | cédula · nombre |
| `vacantes_voluntarios` | lugar + rol |

Al guardar, el servidor busca coincidencias y las devuelve. La pantalla no bloquea:
muestra el registro parecido y ofrece **abrir el que ya existe** o **crear igualmente**.
Además, cada entidad con claves naturales tiene una vista «posibles duplicados» que los
agrupa para revisarlos en bloque.

Para `lugares` hay una herramienta aparte de **fusión**: mueve los insumos del duplicado
al centro que se conserva y borra el sobrante. Es la única entidad donde fusionar aporta
algo, porque es la única con hijos que perder.

### Datos falsos

Tres palancas, ninguna mágica:

1. **Ver la cédula.** Voluntarios, transportistas y centros ya suben foto a un bucket
   privado. La ficha la muestra con URL firmada para comparar con el nombre declarado.
2. **Validar el formato en el servidor.** Correo con forma de correo, teléfono con al
   menos 7 dígitos, coordenadas dentro de Venezuela, cantidades no negativas, estados
   dentro de su lista. Mismo criterio que ya aplican los formularios públicos.
3. **Borrar.** Con la cédula a la vista y el botón de borrar al lado, revisar el padrón
   deja de ser una queja y pasa a ser una tarea de cinco minutos.

## UX

Un grupo nuevo, **«Datos»**, en el menú del admin, junto a «Crear» y «Gestionar». Cada
entrada abre su pantalla, y todas comparten el mismo esqueleto para que se aprendan una
vez: **lista con buscador y filtros → ficha → editar / borrar**, con la papelera y la
bitácora como dos entradas más.

Lo que cambia de una pantalla a otra es lo que importa en cada una:

| Pantalla | Qué tiene de propio |
|---|---|
| Centros de acopio | Mapa con el punto arrastrable, insumos del centro anidados y editables, distintivo de «gestionado» si tiene panel |
| Insumos | Agrupados por centro, barra de recibido/necesario, filtro por urgencia y estado |
| Voluntarios | Foto de cédula, profesión y disponibilidad, aviso de duplicado por correo o teléfono |
| Transportistas | Las tres fotos (placa, vehículo, cédula), placa, zona, y cuántos trayectos tiene |
| Rescatistas | Organización, especialidad, equipo y capacidad operativa |
| Accesos de centro | Una fila por centro con el estado del acceso, y los botones de regenerar y revocar |
| Vacantes | Barra de cubierto/necesario y cambio de estado |
| Personas buscadas | Distintivo de verificada, con el botón de verificar que ya existe |

Detalles que valen para todas: la lista pagina de 25 en 25; el buscador filtra en el
servidor, no en el navegador; borrar exige **escribir el nombre del registro**, no un
«¿seguro?»; y cada cambio guardado dice qué campos cambiaron.

## Errores

| Situación | Mensaje |
|---|---|
| Entidad o columna fuera de la lista blanca | «Ese dato no se puede editar desde aquí» |
| Duplicado detectado al crear | «Ya existe algo muy parecido: {nombre}» + abrir / crear igualmente |
| Borrado con hijos en cascada | «Esto borrará también {n} {cosa}. Escribe {nombre} para confirmar» |
| Borrar una factura con viajes | «Esta factura tiene viajes registrados; archívala en vez de borrarla» |
| Campo obligatorio vacío o con formato inválido | El mensaje concreto del campo, junto al campo |

Todos los textos van a `locales/es.json` y `locales/en.json`;
`scripts/verificar-idioma.py` debe seguir dando salida `0`.

## Pruebas

Cada una debe fallar antes del arreglo y pasar después:

1. Una acción `admin_datos_*` **sin clave de admin** → rechazada.
2. Editar una columna fuera de la lista blanca (`pin_hash`, `monto_recaudado`) → rechazado.
3. Editar una entidad fuera del registro (`config`) → rechazado.
4. Crear un voluntario con un correo que ya existe → responde con el duplicado.
5. Borrar un lugar con insumos → avisa cuántos arrastra, y al confirmar los borra.
6. Archivar una factura → desaparece de la lista pública y del seguimiento por token.
7. Restaurar esa factura → vuelve a verse.
8. Toda mutación deja fila en `auditoria_admin` con `antes` y `despues`.
9. Deshacer una edición → la fila vuelve a su valor anterior.

## Alcance y orden

El trabajo se parte en **dos planes**, cada uno desplegable y verificable por sí mismo:

**Plan 1 (ahora) — cimientos + Grupo A.** Migración, registro y acciones genéricas,
bitácora, papelera, detector de duplicados, fontanería compartida y las **8 pantallas de
registros**: centros, insumos, voluntarios, rescatistas, transportistas, accesos de
centro, vacantes y personas. Es exactamente lo que Luis nombró («transportistas,
voluntarios, centros de acopio… revisar todos los usuarios registrados») y funciona solo.

**Plan 2 (después) — Grupo B.** Las 11 pantallas de trazabilidad, evidencia y PII
(facturas, donaciones, movimientos, evidencias, viajes, trayectos, donaciones de
motorizados, historial, denuncias, familias y entregas), más la fusión de lugares. No
inventa arquitectura: reusa el registro, la bitácora y la papelera del Plan 1.

## Fuera de alcance

`config`, `rate_limit`, `tasas` y `spatial_ref_sys` (D1). Las **cuentas de admin
individuales** y el JWT de admin (S1), que Luis pospuso; hasta entonces la bitácora
registra «admin» sin nombre propio. Las vulnerabilidades V04–V18 del escaneo.

> ⚠️ Aparte de este trabajo: el asesor de Supabase marca `public.spatial_ref_sys` (tabla
> de sistema de PostGIS, 8.500 filas) **sin RLS**. Es un catálogo público de sistemas de
> coordenadas, sin datos de nadie, y activarle RLS sin políticas rompería PostGIS. Queda
> como decisión de Luis, igual que en auditorías anteriores.

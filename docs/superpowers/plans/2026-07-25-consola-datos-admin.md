# Consola de datos del admin — Plan 1 (cimientos + Grupo A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el admin pueda ver, crear, corregir y borrar los ocho registros de la app
(centros, insumos, voluntarios, rescatistas, transportistas, accesos de centro, vacantes
y personas) desde la propia consola, con aviso de duplicados y bitácora de cada cambio.

**Architecture:** El servidor expone **ocho acciones genéricas** (`admin_datos_*`)
gobernadas por un **registro con lista blanca**: lo que no está declarado ahí no se puede
leer, editar ni borrar. El cliente pone encima **pantallas a medida**, una por entidad,
apoyadas en fontanería compartida (listar, buscar, paginar, confirmar borrado, avisar de
duplicados). Toda mutación escribe en `auditoria_admin` con instantáneas `antes`/`despues`,
lo que hace posible deshacer.

**Tech Stack:** Frontend estático vanilla (HTML/CSS/JS, sin dependencias ni build).
Backend: Supabase Edge Function `api` (Deno/TypeScript, `verify_jwt=false`) con
`service_role`. Postgres con RLS deny-by-default. Despliegue: Vercel (frontend, por
`git push` a `origin`) y Supabase (edge function).

**Spec:** `docs/superpowers/specs/2026-07-25-consola-datos-admin-design.md`

## Global Constraints

- Proyecto **sin dependencias ni build**: no añadir npm, frameworks ni paquetes.
- Todo valor externo interpolado en `innerHTML` pasa por `e()`.
- **Toda acción nueva se llama `admin_…`**. `handle()` hace
  `const esAdmin = accion.startsWith('admin_')` y entonces `await autenticarAdmin(p, req)`.
  Ese prefijo **es** el control de acceso: una acción de datos con otro nombre queda
  abierta al público.
- **i18n obligatorio:** cada texto visible vive en `locales/es.json` **y** `locales/en.json`.
  `python3 scripts/verificar-idioma.py` debe terminar con salida `0` (claves paralelas y
  sin texto español cableado en `js/`).
- **Versión PWA:** al tocar cualquier asset estático hay que subir `?v=N` en `index.html`
  y `ventana.html` **y** `const VERSION = 'N'` en `sw.js`, los tres al mismo número.
  Hoy están en **95**.
- **Un archivo `.js` nuevo hay que declararlo en `index.html` y en `ventana.html`**, con su
  `?v=`. Los `js/*.js` comparten **scope global** (no hay módulos ni IIFE): una función
  declarada en un archivo es visible en los demás, y el orden de las etiquetas `<script>`
  manda. `admin.js` va antes que los archivos nuevos.
- La edge function se edita en `supabase/functions/api/index.ts` (fuente de verdad
  versionada) y se despliega aparte; el repo y el despliegue deben quedar iguales.
- **El despliegue de la edge function no cabe en un mensaje** (el archivo pasa de 95 KB y
  la herramienta exige mandarlo entero). Se delega al subagente `agente-solucionador-vps`
  con el prompt del paso correspondiente. Conviene agrupar cambios y desplegar lo menos
  posible.
- **Columnas que nunca son editables:** `centros_panel.pin_hash`, `pin_salt`,
  `token_centro`; `facturas.numero_factura`, `token_publico`, `monto_recaudado`;
  `familias_damnificadas.codigo`; `donaciones.comprobante`; `denuncias.video_path`;
  `viajes.paso*`; toda ruta `foto_*`; toda clave primaria y toda marca de tiempo
  automática. Las fotos se **ven** por URL firmada, no se sustituyen.
- No hay entorno de staging: las pruebas corren contra producción con datos marcados
  `ZZTEST` y **se limpian al final de cada tarea**.
- **No hay ADMIN_KEY legible** (en `config` solo vive su hash SHA-256). Quien ejecute
  este plan necesita que Luis le pase la clave en claro para las pruebas, en la variable
  de entorno `ADMINKEY`. Sin ella, las pruebas de este plan no se pueden correr.
- Proyecto Supabase: `zryfwbjvlacorryzdaod`. App: `https://donacionesvenezuela.vercel.app`.
- Clave publishable (pública, va en el cliente): `sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56`.

---

## File Structure

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `supabase/functions/api/index.ts` | Registro con lista blanca, validación, duplicados, bitácora y las 8 acciones `admin_datos_*` | 2, 3, 4 |
| `js/admin-datos.js` | **Nuevo.** Fontanería compartida de la consola de datos: llamada al servidor, pantalla de lista (buscador + paginación), ficha genérica, confirmación de borrado, aviso de duplicados, panel de bitácora | 5, 8 |
| `js/admin-personas.js` | **Nuevo.** Las 4 pantallas a medida de personas: voluntarios, transportistas, rescatistas y personas buscadas | 6 |
| `js/admin-centros.js` | **Nuevo.** Las 4 pantallas a medida de centros: lugares, insumos, accesos de centro y vacantes | 7 |
| `js/admin.js` | Solo se toca el menú: grupo «Datos» nuevo en `irAMenu()` y su enrutado | 5 |
| `index.html`, `ventana.html` | Declarar los 3 `.js` nuevos + subir `?v=` | 5, 8 |
| `sw.js` | Subir `const VERSION` | 5, 8 |
| `locales/es.json`, `locales/en.json` | Todos los textos nuevos | 5, 6, 7, 8 |
| `scripts/verificar-admin-datos.mjs` | **Nuevo.** Prueba ejecutable del backend (lectura, escritura, borrado, permisos, duplicados, bitácora) | 2, 3, 4 |

**Nota sobre las pruebas:** el proyecto no tiene framework de tests. La prueba es un
script de Node sin dependencias (`fetch` nativo) que golpea la API real y **falla antes
del arreglo**. Se ejecuta con variables de entorno para no escribir secretos en el repo.
Crece a lo largo de las tareas 2, 3 y 4: cada tarea le añade su bloque y vuelve a
correrlo entero.

**Por qué tres archivos nuevos y no uno:** `js/admin.js` ya tiene 2.069 líneas. Meterle
ocho pantallas a medida lo llevaría por encima de las 4.000 y lo haría imposible de
sostener. El corte es por responsabilidad (fontanería / personas / centros), no por capa.

---

## Task 1: Tabla de bitácora

**Files:**
- Migración en Supabase (proyecto `zryfwbjvlacorryzdaod`), sin archivos del repo.

**Interfaces:**
- Consumes: nada.
- Produces: tabla `auditoria_admin` con las columnas
  `id bigint`, `fecha timestamptz`, `ip text`, `accion text`, `entidad text`,
  `fila_id text`, `antes jsonb`, `despues jsonb`. La escriben las tareas 3 y 4.

- [ ] **Step 1: Comprobar que la tabla NO existe**

Ejecutar en Supabase:

```sql
select count(*) as existe from information_schema.tables
where table_schema = 'public' and table_name = 'auditoria_admin';
```

Esperado: `existe = 0`. Si ya existe, parar y revisar por qué antes de seguir.

- [ ] **Step 2: Crear la tabla con RLS y sin políticas**

```sql
create table public.auditoria_admin (
  id         bigint generated always as identity primary key,
  fecha      timestamptz not null default now(),
  ip         text not null default '',
  accion     text not null,
  entidad    text not null,
  fila_id    text not null default '',
  antes      jsonb,
  despues    jsonb
);

-- Deny-by-default como el resto del esquema: sin políticas, solo el service_role
-- (la edge function) entra. Nadie la lee con la clave publishable.
alter table public.auditoria_admin enable row level security;
revoke all on public.auditoria_admin from anon, authenticated;

create index auditoria_admin_fecha_idx  on public.auditoria_admin (fecha desc);
create index auditoria_admin_fila_idx   on public.auditoria_admin (entidad, fila_id);
```

- [ ] **Step 3: Verificar que el público NO la puede leer**

```bash
curl -s "https://zryfwbjvlacorryzdaod.supabase.co/rest/v1/auditoria_admin?select=id" \
  -H "apikey: sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56"
```

Esperado: un error de permisos (`42501` / «permission denied»), **no** una lista vacía
`[]`. Una lista vacía significaría que la tabla es legible y hay que revisar el `revoke`.

- [ ] **Step 4: Verificar la forma de la tabla**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'auditoria_admin'
order by ordinal_position;
```

Esperado: las 8 columnas de arriba, con `antes` y `despues` en `jsonb` y anulables.

---

## Task 2: Backend de lectura — registro con lista blanca, listar y ficha

**Files:**
- Modify: `supabase/functions/api/index.ts` (bloque nuevo antes de `async function handle(`)
- Modify: `supabase/functions/api/index.ts` (tres `case` nuevos dentro de `switch (accion)`)
- Modify: `supabase/functions/api/index.ts` (la línea de `esLectura`)
- Create: `scripts/verificar-admin-datos.mjs`

**Interfaces:**
- Consumes: `s()`, `n()`, `ipDe(req)`, `supa`, `autenticarAdmin` (ya existen).
- Produces (las usan las tareas 3 y 4):
  - `ENTIDADES: Record<string, EntidadDef>` — el registro con lista blanca.
  - `entidadDe(nombre: string) → EntidadDef` — lanza si no está en el registro.
  - `filaPorId(def: EntidadDef, id: unknown) → Promise<Record<string, unknown> | null>`
  - `normaClave(valor: unknown, norma: 'texto'|'digitos'|'email') → string`
  - Acciones `admin_datos_entidades`, `admin_datos_listar`, `admin_datos_ficha`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/verificar-admin-datos.mjs`:

```js
#!/usr/bin/env node
// Prueba de la consola de datos del admin.
// Uso: ANON=... ADMINKEY=... node scripts/verificar-admin-datos.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, ADMINKEY } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

async function api(payload) {
  const r = await fetch(`${BASE}/functions/v1/api`, {
    method: 'POST', headers: H, body: JSON.stringify(payload) });
  return await r.json().catch(() => null);
}
const adm = (payload) => api({ ...payload, adminKey: ADMINKEY });

const fallos = [];
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? ' — ' + String(extra).slice(0, 90) : ''}`);
  if (!cond) fallos.push(nombre);
};

// ---------- Permisos ----------
const sinClave = await api({ accion: 'admin_datos_listar', entidad: 'voluntarios' });
ok('1. Sin clave de admin es rechazado', sinClave?.success === false, sinClave?.error);

const claveMala = await api({ accion: 'admin_datos_listar', entidad: 'voluntarios', adminKey: 'no-es-la-clave' });
ok('2. Con clave incorrecta es rechazado', claveMala?.success === false, claveMala?.error);

// ---------- Lista blanca de entidades ----------
const fuera = await adm({ accion: 'admin_datos_listar', entidad: 'config' });
ok('3. Una entidad fuera del registro es rechazada', fuera?.success === false, fuera?.error);

const inventada = await adm({ accion: 'admin_datos_listar', entidad: 'no_existe' });
ok('4. Una entidad inventada es rechazada', inventada?.success === false, inventada?.error);

// ---------- Listar ----------
const lista = await adm({ accion: 'admin_datos_listar', entidad: 'lugares' });
ok('5. Lista lugares', Array.isArray(lista?.filas) && lista.filas.length > 0,
   `${lista?.filas?.length} filas, total ${lista?.total}`);
ok('6. La lista trae el total para paginar', Number.isFinite(lista?.total), lista?.total);

const buscada = await adm({ accion: 'admin_datos_listar', entidad: 'lugares', busca: 'hatillo' });
ok('7. El buscador filtra en el servidor',
   Array.isArray(buscada?.filas) && buscada.filas.length < (lista?.filas?.length || 99),
   `${buscada?.filas?.length} de ${lista?.filas?.length}`);

// ---------- Ficha ----------
const idLugar = lista?.filas?.[0]?.id;
const ficha = await adm({ accion: 'admin_datos_ficha', entidad: 'lugares', id: idLugar });
ok('8. La ficha trae la fila', !!ficha?.fila && String(ficha.fila.id) === String(idLugar));
ok('9. La ficha dice qué arrastra al borrar', Array.isArray(ficha?.dependientes),
   JSON.stringify(ficha?.dependientes));

// ---------- Catálogo de entidades ----------
const cat = await adm({ accion: 'admin_datos_entidades' });
ok('10. El catálogo lista las entidades y sus columnas',
   Array.isArray(cat?.entidades) && cat.entidades.length >= 8,
   `${cat?.entidades?.length} entidades`);

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que FALLA**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado **antes** del arreglo: fallan de la 3 a la 10 con «accion desconocida»
(las pruebas 1 y 2 pasan de casualidad, porque una acción desconocida también se
rechaza). Salida distinta de `0`.

- [ ] **Step 3: Añadir los tipos y el registro con lista blanca**

En `supabase/functions/api/index.ts`, **inmediatamente antes** de la línea
`async function handle(accion: string, p: Record<string, unknown>, req: Request) {`,
insertar:

```ts
// ===== Consola de datos del admin: registro con LISTA BLANCA =====
// Lo que no esté declarado aquí no se puede listar, crear, editar ni borrar por las
// acciones admin_datos_*. Esta constante ES el control de qué toca el admin: una
// columna ausente de `editables` es una columna que nadie puede cambiar desde la web.
type ColTipo = 'texto' | 'entero' | 'numero' | 'booleano' | 'email' | 'telefono'
             | 'lat' | 'lng' | 'opcion' | 'refLugar';

interface ColDef {
  id: string;
  tipo: ColTipo;
  max?: number;          // largo máximo (texto) — se recorta, no se rechaza
  opciones?: string[];   // valores permitidos (tipo 'opcion')
  requerido?: boolean;
  minNum?: number;
  maxNum?: number;
}

interface NaturalDef { campos: string[]; norma: 'texto' | 'digitos' | 'email' }
interface HijoDef { tabla: string; fk: string; etiqueta: string; modo: 'cascade' | 'null' }
interface FotoDef { campo: string; bucket: string }

interface EntidadDef {
  tabla: string;
  pk: string;
  pkTexto: boolean;      // true si la clave primaria es texto (voluntarios, motorizados…)
  prefijoId?: string;    // prefijo del id generado cuando pkTexto (VOL1a2b3c4d)
  etiqueta: string;      // columna que identifica la fila para el humano
  orden: string;
  ordenAsc: boolean;
  lectura: string[];     // columnas que se devuelven al listar y en la ficha
  editables: ColDef[];
  buscar: string[];      // columnas del buscador (ilike)
  borrado: 'fisico';     // el Plan 2 añade 'archivo'
  naturales: NaturalDef[];
  fotos: FotoDef[];
  hijos: HijoDef[];
}

const ENTIDADES: Record<string, EntidadDef> = {
  lugares: {
    tabla: 'lugares', pk: 'id', pkTexto: false, etiqueta: 'nombre',
    orden: 'nombre', ordenAsc: true,
    lectura: ['id', 'tipo', 'nombre', 'ubicacion', 'telefono', 'lat', 'lng', 'actualizado'],
    editables: [
      { id: 'tipo', tipo: 'opcion', opciones: ['Centro', 'Hospital', 'Refugio'], requerido: true },
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'ubicacion', tipo: 'texto', max: 300 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'lat', tipo: 'lat' },
      { id: 'lng', tipo: 'lng' },
    ],
    buscar: ['nombre', 'ubicacion', 'telefono'],
    borrado: 'fisico',
    naturales: [{ campos: ['nombre'], norma: 'texto' }],
    fotos: [],
    hijos: [
      { tabla: 'insumos', fk: 'lugar_id', etiqueta: 'insumos', modo: 'cascade' },
      { tabla: 'centros_panel', fk: 'lugar_id', etiqueta: 'accesos de panel', modo: 'cascade' },
    ],
  },
  insumos: {
    tabla: 'insumos', pk: 'id', pkTexto: false, etiqueta: 'nombre',
    orden: 'nombre', ordenAsc: true,
    lectura: ['id', 'lugar_id', 'nombre', 'categoria', 'estado', 'cantidad_necesaria',
              'cantidad_recibida', 'urgencia', 'unidad', 'actualizado'],
    editables: [
      { id: 'lugar_id', tipo: 'refLugar', requerido: true },
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'categoria', tipo: 'texto', max: 60 },
      { id: 'estado', tipo: 'opcion', opciones: ['Necesita', 'Disponible', 'Cubierto'], requerido: true },
      { id: 'cantidad_necesaria', tipo: 'numero', minNum: 0, maxNum: 1_000_000 },
      { id: 'cantidad_recibida', tipo: 'numero', minNum: 0, maxNum: 1_000_000 },
      { id: 'urgencia', tipo: 'opcion', opciones: ['Alta', 'Normal', 'Baja'], requerido: true },
      { id: 'unidad', tipo: 'texto', max: 30 },
    ],
    buscar: ['nombre', 'categoria'],
    borrado: 'fisico',
    naturales: [{ campos: ['lugar_id', 'nombre'], norma: 'texto' }],
    fotos: [],
    hijos: [],
  },
  voluntarios: {
    tabla: 'voluntarios', pk: 'id', pkTexto: true, prefijoId: 'VOL', etiqueta: 'nombre',
    orden: 'fecha_registro', ordenAsc: false,
    lectura: ['id', 'nombre', 'apellido', 'email', 'telefono', 'estado', 'ciudad',
              'profesion', 'disponibilidad', 'medio_transporte', 'observaciones',
              'foto_cedula', 'fecha_registro'],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'apellido', tipo: 'texto', max: 120 },
      { id: 'email', tipo: 'email', max: 254 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'estado', tipo: 'texto', max: 60 },
      { id: 'ciudad', tipo: 'texto', max: 80 },
      { id: 'profesion', tipo: 'texto', max: 80 },
      { id: 'disponibilidad', tipo: 'texto', max: 120 },
      { id: 'medio_transporte', tipo: 'texto', max: 60 },
      { id: 'observaciones', tipo: 'texto', max: 500 },
    ],
    buscar: ['nombre', 'apellido', 'email', 'telefono', 'ciudad'],
    borrado: 'fisico',
    naturales: [
      { campos: ['email'], norma: 'email' },
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['nombre', 'apellido'], norma: 'texto' },
    ],
    fotos: [{ campo: 'foto_cedula', bucket: 'registro-transportistas' }],
    hijos: [],
  },
  motorizados: {
    tabla: 'motorizados', pk: 'id', pkTexto: true, prefijoId: 'MOT', etiqueta: 'nombre',
    orden: 'fecha_registro', ordenAsc: false,
    lectura: ['id', 'nombre', 'tipo_vehiculo', 'telefono', 'zona_operacion', 'placa',
              'email', 'foto_placa', 'foto_vehiculo', 'foto_cedula', 'fecha_registro'],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'tipo_vehiculo', tipo: 'opcion',
        opciones: ['Moto', 'Carro', 'Bicicleta', 'Camión', 'Triciclo motorizado'], requerido: true },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'zona_operacion', tipo: 'texto', max: 120 },
      { id: 'placa', tipo: 'texto', max: 20 },
      { id: 'email', tipo: 'email', max: 254 },
    ],
    buscar: ['nombre', 'placa', 'telefono', 'email', 'zona_operacion'],
    borrado: 'fisico',
    naturales: [
      { campos: ['email'], norma: 'email' },
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['placa'], norma: 'texto' },
    ],
    fotos: [
      { campo: 'foto_placa', bucket: 'registro-transportistas' },
      { campo: 'foto_vehiculo', bucket: 'registro-transportistas' },
      { campo: 'foto_cedula', bucket: 'registro-transportistas' },
    ],
    hijos: [
      { tabla: 'trayectos', fk: 'motorizado_id', etiqueta: 'trayectos', modo: 'null' },
      { tabla: 'donaciones_motorizados', fk: 'motorizado_id', etiqueta: 'aportes recibidos', modo: 'null' },
    ],
  },
  rescatistas: {
    tabla: 'rescatistas', pk: 'id', pkTexto: true, prefijoId: 'RES', etiqueta: 'nombre',
    orden: 'fecha_registro', ordenAsc: false,
    lectura: ['id', 'nombre', 'organizacion', 'telefono', 'especialidad', 'estado',
              'ciudad', 'disponibilidad', 'equipo_disponible', 'capacidad_operativa',
              'observaciones', 'fecha_registro'],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'organizacion', tipo: 'texto', max: 120 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'especialidad', tipo: 'texto', max: 80 },
      { id: 'estado', tipo: 'texto', max: 60 },
      { id: 'ciudad', tipo: 'texto', max: 80 },
      { id: 'disponibilidad', tipo: 'texto', max: 120 },
      { id: 'equipo_disponible', tipo: 'texto', max: 300 },
      { id: 'capacidad_operativa', tipo: 'texto', max: 120 },
      { id: 'observaciones', tipo: 'texto', max: 500 },
    ],
    buscar: ['nombre', 'organizacion', 'telefono', 'ciudad', 'especialidad'],
    borrado: 'fisico',
    naturales: [
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['nombre', 'organizacion'], norma: 'texto' },
    ],
    fotos: [],
    hijos: [],
  },
  centros_panel: {
    tabla: 'centros_panel', pk: 'id', pkTexto: false, etiqueta: 'token_centro',
    orden: 'creado', ordenAsc: false,
    // token_centro se LEE (el admin necesita identificar la fila) pero NO se edita.
    // pin_hash y pin_salt no se leen siquiera: son la credencial.
    lectura: ['id', 'lugar_id', 'token_centro', 'email', 'foto_cedula', 'foto_sitio', 'creado'],
    editables: [
      { id: 'email', tipo: 'email', max: 254 },
    ],
    buscar: ['token_centro', 'email'],
    borrado: 'fisico',
    naturales: [],
    fotos: [
      { campo: 'foto_cedula', bucket: 'registro-transportistas' },
      { campo: 'foto_sitio', bucket: 'registro-transportistas' },
    ],
    hijos: [],
  },
  vacantes_voluntarios: {
    tabla: 'vacantes_voluntarios', pk: 'id', pkTexto: false, etiqueta: 'rol',
    orden: 'fecha_creacion', ordenAsc: false,
    lectura: ['id', 'lugar_tipo', 'lugar_nombre', 'ubicacion', 'rol', 'descripcion',
              'cantidad_necesaria', 'cantidad_cubierta', 'urgencia', 'turno', 'telefono',
              'estado', 'fecha_creacion'],
    editables: [
      { id: 'lugar_tipo', tipo: 'opcion',
        opciones: ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'], requerido: true },
      { id: 'lugar_nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'ubicacion', tipo: 'texto', max: 160 },
      { id: 'rol', tipo: 'texto', max: 80, requerido: true },
      { id: 'descripcion', tipo: 'texto', max: 400 },
      { id: 'cantidad_necesaria', tipo: 'numero', minNum: 1, maxNum: 10_000 },
      { id: 'cantidad_cubierta', tipo: 'numero', minNum: 0, maxNum: 10_000 },
      { id: 'urgencia', tipo: 'opcion', opciones: ['Alta', 'Normal', 'Baja'], requerido: true },
      { id: 'turno', tipo: 'texto', max: 80 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'estado', tipo: 'opcion', opciones: ['Abierta', 'Cubierta', 'Cerrada'], requerido: true },
    ],
    buscar: ['lugar_nombre', 'rol', 'ubicacion'],
    borrado: 'fisico',
    naturales: [{ campos: ['lugar_nombre', 'rol'], norma: 'texto' }],
    fotos: [],
    hijos: [],
  },
  personas: {
    tabla: 'personas', pk: 'id', pkTexto: false, etiqueta: 'nombre',
    orden: 'fecha', ordenAsc: false,
    lectura: ['id', 'nombre', 'cedula', 'estado', 'ubicacion', 'contacto', 'fuente',
              'reportado_por', 'verificada', 'fecha'],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 160, requerido: true },
      { id: 'cedula', tipo: 'texto', max: 20 },
      { id: 'estado', tipo: 'texto', max: 120 },
      { id: 'ubicacion', tipo: 'texto', max: 200 },
      { id: 'contacto', tipo: 'texto', max: 120 },
      { id: 'fuente', tipo: 'texto', max: 120 },
      { id: 'reportado_por', tipo: 'texto', max: 120 },
      { id: 'verificada', tipo: 'booleano' },
    ],
    buscar: ['nombre', 'cedula', 'ubicacion', 'contacto'],
    borrado: 'fisico',
    naturales: [
      { campos: ['cedula'], norma: 'digitos' },
      { campos: ['nombre'], norma: 'texto' },
    ],
    fotos: [],
    hijos: [],
  },
};

function entidadDe(nombre: unknown): EntidadDef {
  const def = ENTIDADES[s(nombre, 40)];
  if (!def) throw new Error('Ese dato no se puede editar desde aquí');
  return def;
}

// Clave natural normalizada: así «José Pérez» y «jose perez  » son el mismo,
// y «0412-000 00 00» y «04120000000» también.
const sinAcentos = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function normaClave(valor: unknown, norma: 'texto' | 'digitos' | 'email'): string {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (norma === 'digitos') return v.replace(/[^0-9]/g, '');
  if (norma === 'email') return v.toLowerCase();
  return sinAcentos(v.toLowerCase()).replace(/\s+/g, ' ');
}

const idDe = (def: EntidadDef, id: unknown) => (def.pkTexto ? s(id, 60) : Math.round(n(id)));

async function filaPorId(def: EntidadDef, id: unknown) {
  const { data } = await supa.from(def.tabla)
    .select(def.lectura.join(', ')).eq(def.pk, idDe(def, id)).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

// Cuántas filas dependen de esta y qué les pasa al borrarla. La pantalla lo enseña
// ANTES de confirmar: borrar un centro se lleva sus insumos y su acceso al panel.
async function dependientesDe(def: EntidadDef, id: unknown) {
  const salida: { etiqueta: string; cuantos: number; modo: string }[] = [];
  for (const h of def.hijos) {
    const { count } = await supa.from(h.tabla)
      .select('*', { count: 'exact', head: true }).eq(h.fk, idDe(def, id));
    if (count) salida.push({ etiqueta: h.etiqueta, cuantos: count, modo: h.modo });
  }
  return salida;
}

// URL firmada de una hora para las fotos privadas: el admin las VE para comprobar
// que el registro es real, pero nunca las sustituye.
async function fotosFirmadas(def: EntidadDef, fila: Record<string, unknown>) {
  const salida: { campo: string; url: string }[] = [];
  for (const f of def.fotos) {
    const ruta = String(fila[f.campo] || '');
    if (!ruta) continue;
    const { data } = await supa.storage.from(f.bucket).createSignedUrl(ruta, 3600);
    if (data?.signedUrl) salida.push({ campo: f.campo, url: data.signedUrl });
  }
  return salida;
}
```

- [ ] **Step 4: Añadir las tres acciones de lectura**

En el mismo archivo, dentro de `switch (accion) {`, **justo antes** de
`case 'admin_crear_presupuesto': {`, insertar:

```ts
    // ===== Consola de datos del admin (lectura) =====
    // Nombre con prefijo admin_ ⇒ handle() ya exigió autenticarAdmin más arriba.
    case 'admin_datos_entidades': {
      // Catálogo para que el cliente sepa qué campos pintar y cómo validarlos.
      const entidades = Object.entries(ENTIDADES).map(([id, d]) => ({
        id, etiqueta: d.etiqueta, pk: d.pk, borrado: d.borrado,
        columnas: d.editables, fotos: d.fotos.map((f) => f.campo),
        hijos: d.hijos.map((h) => ({ etiqueta: h.etiqueta, modo: h.modo })),
      }));
      return { entidades };
    }
    case 'admin_datos_listar': {
      const def = entidadDe(p.entidad);
      const porPagina = Math.min(100, Math.max(5, Math.round(n(p.porPagina)) || 25));
      const pagina = Math.max(1, Math.round(n(p.pagina)) || 1);
      const desde = (pagina - 1) * porPagina;
      const busca = s(p.busca, 80);
      let q = supa.from(def.tabla).select(def.lectura.join(', '), { count: 'exact' });
      if (busca && def.buscar.length) {
        // PostgREST: OR de ilike sobre las columnas declaradas para buscar. Las comas
        // y los paréntesis romperían la sintaxis del filtro, así que se quitan.
        const limpio = busca.replace(/[(),*]/g, ' ').trim();
        if (limpio) q = q.or(def.buscar.map((c) => `${c}.ilike.%${limpio}%`).join(','));
      }
      const { data, count, error } = await q
        .order(def.orden, { ascending: def.ordenAsc }).range(desde, desde + porPagina - 1);
      if (error) throw error;
      return { filas: data || [], total: count || 0, pagina, porPagina };
    }
    case 'admin_datos_ficha': {
      const def = entidadDe(p.entidad);
      const fila = await filaPorId(def, p.id);
      if (!fila) throw new Error('No se encontró ese registro');
      return {
        fila,
        fotos: await fotosFirmadas(def, fila),
        dependientes: await dependientesDe(def, p.id),
      };
    }
```

- [ ] **Step 5: Que las lecturas no gasten el cupo de escrituras**

En la función `handle`, sustituir la línea de `esLectura` por:

```ts
  const esLectura = ['listar_presupuestos', 'listar_comprados', 'listar_ofertas', 'acceso_perfil', 'denuncias_listar', 'reserva_detalle'].includes(accion);
```

por:

```ts
  const esLectura = ['listar_presupuestos', 'listar_comprados', 'listar_ofertas', 'acceso_perfil', 'denuncias_listar', 'reserva_detalle'].includes(accion);
  // Ojo: las acciones admin_* NO pasan por aquí (van por autenticarAdmin, que tiene su
  // propio cubo de 60/h). Navegar la consola de datos son muchas lecturas seguidas:
  // se les da su propio cubo generoso para no agotar el de admin y quedarse fuera.
  const esAdminLectura = ['admin_datos_entidades', 'admin_datos_listar', 'admin_datos_ficha'].includes(accion);
```

Y **justo después** de la línea `if (esAdmin) await autenticarAdmin(p, req);` añadir:

```ts
  if (esAdminLectura && !(await rateHit(ipDe(req), 'admin_lectura', 600))) {
    throw new Error('Demasiadas solicitudes, intenta en una hora');
  }
```

- [ ] **Step 6: Desplegar la edge function**

Delegar al subagente `agente-solucionador-vps` con este encargo:

> Lee el archivo COMPLETO `/root/donaciones-venezuela/supabase/functions/api/index.ts` y
> despliégalo con `mcp__claude_ai_Supabase__deploy_edge_function`: project_id
> `zryfwbjvlacorryzdaod`, name `api`, entrypoint_path `index.ts`, **verify_jwt false**,
> files `[{ name: "index.ts", content: <el contenido íntegro y literal> }]`. No
> modifiques el archivo. Si falla por sintaxis, devuelve el error exacto sin arreglarlo.
> Devuelve el número de versión nueva.

Anotar el número de versión que devuelva.

- [ ] **Step 7: Ejecutar la prueba y confirmar que PASA**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: las 10 pruebas en ✅ y salida `0`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/api/index.ts scripts/verificar-admin-datos.mjs
git commit -m "feat(admin): registro con lista blanca y lectura de datos

Declara las 8 entidades del Grupo A con sus columnas editables, sus claves
naturales de duplicado, sus fotos privadas y sus dependientes en cascada.
Acciones admin_datos_entidades / listar / ficha, con cubo de lectura propio.
Lo que no está en el registro no existe para la API."
```

---

## Task 3: Backend de escritura — validación, duplicados y bitácora

**Files:**
- Modify: `supabase/functions/api/index.ts` (helpers nuevos tras `fotosFirmadas`)
- Modify: `supabase/functions/api/index.ts` (cuatro `case` nuevos tras `admin_datos_ficha`)
- Modify: `scripts/verificar-admin-datos.mjs` (bloque de pruebas nuevo)

**Interfaces:**
- Consumes: de la Tarea 2 — `ENTIDADES`, `entidadDe()`, `filaPorId()`, `normaClave()`,
  `idDe()`, `EntidadDef`, `ColDef`. De antes — `emailNorm()`, `s()`, `n()`, `ipDe()`.
- Produces (las usa la Tarea 4):
  - `valorValidado(col: ColDef, crudo: unknown) → unknown`
  - `camposValidados(def, crudos, parcial) → Promise<Record<string, unknown>>`
  - `duplicadosDe(def, datos, excluirId) → Promise<{id, etiqueta, porque}[]>`
  - `auditar(req, accion, entidad, filaId, antes, despues) → Promise<void>`
  - `mensajeDePostgres(err) → string`
  - Acciones `admin_datos_crear`, `admin_datos_editar`, `admin_datos_duplicados`,
    `admin_datos_deshacer`, `admin_bitacora`.

- [ ] **Step 1: Añadir las pruebas de escritura al script**

En `scripts/verificar-admin-datos.mjs`, **antes** de la línea
`console.log(fallos.length ? ...)`, insertar:

```js
// ---------- Crear ----------
const nuevo = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana@example.com',
            telefono: '04120000001', ciudad: 'Chacao', profesion: 'Médica' } });
ok('11. Crea un voluntario', !!nuevo?.fila?.id, nuevo?.error || nuevo?.fila?.id);
const idVol = nuevo?.fila?.id;

// ---------- Columna fuera de la lista blanca ----------
const colProhibida = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { foto_cedula: 'ruta/falsa.jpg' } });
ok('12. Una columna fuera de la lista blanca es rechazada',
   colProhibida?.success === false, colProhibida?.error);

// Se usa un acceso REAL: con un id inventado la prueba pasaría por el motivo
// equivocado («no se encontró») en vez de por la lista blanca.
const accesos = await adm({ accion: 'admin_datos_listar', entidad: 'centros_panel' });
const idAcceso = accesos?.filas?.[0]?.id;
const pinProhibido = await adm({ accion: 'admin_datos_editar', entidad: 'centros_panel',
  id: idAcceso, campos: { pin_hash: 'x' } });
ok('13. pin_hash no se puede editar',
   pinProhibido?.success === false && /no se puede editar/i.test(pinProhibido?.error || ''),
   pinProhibido?.error);

// ---------- Validación ----------
const correoMalo = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { email: 'esto-no-es-un-correo' } });
ok('14. Rechaza un correo con formato inválido', correoMalo?.success === false, correoMalo?.error);

const sinNombre = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: '', telefono: '04120000009' } });
ok('15. Rechaza un obligatorio vacío', sinNombre?.success === false, sinNombre?.error);

// ---------- Duplicados ----------
const dup = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana@example.com' } });
ok('16. Avisa del duplicado en vez de crearlo',
   Array.isArray(dup?.duplicados) && dup.duplicados.length > 0 && !dup?.fila,
   JSON.stringify(dup?.duplicados));

const forzado = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios', forzar: true,
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana2@example.com',
            telefono: '04120000002' } });
ok('17. Con forzar:true lo crea igualmente', !!forzado?.fila?.id, forzado?.error);
const idVol2 = forzado?.fila?.id;

const grupos = await adm({ accion: 'admin_datos_duplicados', entidad: 'voluntarios' });
ok('18. El panel de duplicados los agrupa',
   Array.isArray(grupos?.grupos) && grupos.grupos.some((g) => g.filas.length > 1),
   `${grupos?.grupos?.length} grupos`);

// ---------- Editar ----------
const editado = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { ciudad: 'Petare' } });
ok('19. Edita y dice qué cambió', editado?.fila?.ciudad === 'Petare',
   JSON.stringify(editado?.cambiados));

// ---------- Bitácora ----------
const bit = await adm({ accion: 'admin_bitacora', entidad: 'voluntarios' });
const cambioEdicion = (bit?.cambios || []).find(
  (c) => c.accion === 'editar' && String(c.fila_id) === String(idVol));
ok('20. La bitácora guarda antes y después',
   !!cambioEdicion && cambioEdicion.antes?.ciudad === 'Chacao' && cambioEdicion.despues?.ciudad === 'Petare',
   cambioEdicion ? `${cambioEdicion.antes?.ciudad} → ${cambioEdicion.despues?.ciudad}` : 'sin fila');

// ---------- Deshacer ----------
const deshecho = await adm({ accion: 'admin_datos_deshacer', auditoriaId: cambioEdicion?.id });
ok('21. Deshacer devuelve el valor anterior', deshecho?.fila?.ciudad === 'Chacao',
   deshecho?.error || deshecho?.fila?.ciudad);

console.log(`\nZZTEST_VOLUNTARIOS=${idVol},${idVol2}`);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que las nuevas FALLAN**

```bash
ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: del 1 al 10 en ✅ (los de la Tarea 2) y del 11 al 21 en ❌ con
«accion desconocida». Salida distinta de `0`.

- [ ] **Step 3: Añadir la validación de campos**

En `supabase/functions/api/index.ts`, **justo después** de la función `fotosFirmadas`,
añadir:

```ts
// Traduce a algo legible los errores de Postgres que el admin puede provocar.
function mensajeDePostgres(err: { code?: string; message?: string } | null): string {
  if (err?.code === '23505') return 'Ya existe un registro con ese valor único';
  if (err?.code === '23503') return 'Ese registro está enlazado con otro y no se puede guardar así';
  if (err?.code === '23502') return 'Falta un campo obligatorio';
  return s(err?.message, 200) || 'No se pudo guardar';
}

// Valida y normaliza UN campo según su declaración. Lanza nombrando el campo, para
// que la pantalla pueda enseñar el error junto al recuadro correcto.
function valorValidado(col: ColDef, crudo: unknown): unknown {
  if (col.tipo === 'booleano') return crudo === true || crudo === 'true';
  if (col.tipo === 'entero' || col.tipo === 'numero') {
    const x = n(crudo);
    if (col.minNum != null && x < col.minNum) throw new Error(`${col.id}: el mínimo es ${col.minNum}`);
    if (col.maxNum != null && x > col.maxNum) throw new Error(`${col.id}: el máximo es ${col.maxNum}`);
    return col.tipo === 'entero' ? Math.round(x) : x;
  }
  if (col.tipo === 'lat' || col.tipo === 'lng') {
    if (crudo === '' || crudo === null || crudo === undefined) return null;
    const x = Number(crudo);
    // Mismo recuadro que usa geoValida() para el resto de la app.
    const min = col.tipo === 'lat' ? -4 : -74;
    const max = col.tipo === 'lat' ? 13 : -59;
    if (!Number.isFinite(x) || x < min || x > max) {
      throw new Error(`${col.id}: esa coordenada cae fuera de Venezuela`);
    }
    return x;
  }
  if (col.tipo === 'email') {
    const bruto = s(crudo, 254);
    if (!bruto) return null;
    const v = emailNorm(bruto);
    if (!v) throw new Error(`${col.id}: correo electrónico inválido`);
    return v;
  }
  if (col.tipo === 'telefono') {
    const v = s(crudo, col.max ?? 40);
    if (v && v.replace(/[^0-9]/g, '').length < 7) throw new Error(`${col.id}: teléfono demasiado corto`);
    return v;
  }
  if (col.tipo === 'opcion') {
    const v = s(crudo, 60);
    if (!col.opciones || !col.opciones.includes(v)) throw new Error(`${col.id}: ese valor no está permitido`);
    return v;
  }
  if (col.tipo === 'refLugar') {
    const id = Math.round(n(crudo));
    if (id <= 0) throw new Error(`${col.id}: hay que elegir un centro`);
    return id;
  }
  return s(crudo, col.max ?? 300);
}

// Convierte lo que manda el cliente en el objeto exacto que se va a escribir.
// `parcial` = true al editar: solo se toca lo que venga en la petición.
// Una columna que no esté en `editables` NO se ignora en silencio: se rechaza, para
// que un intento de tocar pin_hash o monto_recaudado sea visible y no una sorpresa.
async function camposValidados(def: EntidadDef, crudos: Record<string, unknown>, parcial: boolean) {
  const permitidas = new Set(def.editables.map((c) => c.id));
  for (const k of Object.keys(crudos)) {
    if (!permitidas.has(k)) throw new Error(`Ese dato no se puede editar desde aquí: ${k}`);
  }
  const datos: Record<string, unknown> = {};
  for (const col of def.editables) {
    const presente = Object.prototype.hasOwnProperty.call(crudos, col.id);
    if (parcial && !presente) continue;
    const valor = valorValidado(col, presente ? crudos[col.id] : '');
    if (col.requerido && (valor === '' || valor === null || valor === undefined)) {
      throw new Error(`${col.id}: es obligatorio`);
    }
    if (col.tipo === 'refLugar') {
      const { data } = await supa.from('lugares').select('id').eq('id', valor).maybeSingle();
      if (!data) throw new Error(`${col.id}: ese centro no existe`);
    }
    datos[col.id] = valor;
  }
  if (!Object.keys(datos).length) throw new Error('No hay nada que guardar');
  return datos;
}
```

- [ ] **Step 4: Añadir el detector de duplicados y la bitácora**

A continuación de lo anterior, en el mismo archivo:

```ts
// Filas que comparten alguna clave natural con lo que se va a guardar. NO bloquea:
// informa. Dos personas pueden llamarse igual; quien decide es el admin.
// ponytail: compara en memoria sobre las primeras 2000 filas — normalizar sin acentos
// no se puede expresar en un filtro de PostgREST. Si un padrón pasa de ahí, mover la
// normalización a columnas generadas con índice.
async function duplicadosDe(def: EntidadDef, datos: Record<string, unknown>, excluirId: unknown) {
  if (!def.naturales.length) return [];
  const cols = [...new Set([def.pk, def.etiqueta, ...def.naturales.flatMap((x) => x.campos)])];
  const { data } = await supa.from(def.tabla).select(cols.join(', ')).limit(2000);
  const encontrados: { id: unknown; etiqueta: string; porque: string }[] = [];
  const vistos = new Set<string>();
  for (const nat of def.naturales) {
    const buscadas = nat.campos.map((c) => normaClave(datos[c], nat.norma));
    if (buscadas.some((k) => !k)) continue; // clave incompleta: no se compara
    for (const fila of (data || []) as Record<string, unknown>[]) {
      if (excluirId != null && String(fila[def.pk]) === String(excluirId)) continue;
      const suyas = nat.campos.map((c) => normaClave(fila[c], nat.norma));
      if (suyas.join('|') !== buscadas.join('|')) continue;
      const id = String(fila[def.pk]);
      if (vistos.has(id)) continue;
      vistos.add(id);
      encontrados.push({
        id: fila[def.pk],
        etiqueta: String(fila[def.etiqueta] ?? id),
        porque: nat.campos.join(' + '),
      });
    }
  }
  return encontrados;
}

// Bitácora de cada cambio del admin. Deliberadamente NO tumba la operación si falla
// el registro: perder una línea de bitácora es malo, pero impedir que el admin
// corrija un dato en plena emergencia es peor. El fallo queda en los logs de la
// función y la prueba 20 verifica que en condiciones normales sí se escribe.
async function auditar(req: Request, accion: string, entidad: string, filaId: unknown,
                       antes: unknown, despues: unknown) {
  const { error } = await supa.from('auditoria_admin').insert({
    ip: ipDe(req), accion, entidad, fila_id: String(filaId ?? ''),
    antes: antes ?? null, despues: despues ?? null });
  if (error) console.error('auditoria_admin', error.message);
}
```

- [ ] **Step 5: Añadir las acciones de crear y editar**

En el `switch (accion)`, **justo después** del `case 'admin_datos_ficha'`, añadir:

```ts
    case 'admin_datos_crear': {
      const def = entidadDe(p.entidad);
      const datos = await camposValidados(def, (p.campos ?? {}) as Record<string, unknown>, false);
      const dups = await duplicadosDe(def, datos, null);
      // Sin forzar, un duplicado NO crea nada: devuelve los parecidos para que la
      // pantalla ofrezca abrir el que ya existe.
      if (dups.length && p.forzar !== true) return { duplicados: dups };
      if (def.pkTexto) {
        datos[def.pk] = (def.prefijoId || 'REG') + crypto.randomUUID().slice(0, 8).toUpperCase();
      }
      const { data, error } = await supa.from(def.tabla)
        .insert(datos).select(def.lectura.join(', ')).single();
      if (error) throw new Error(mensajeDePostgres(error));
      const fila = data as Record<string, unknown>;
      await auditar(req, 'crear', s(p.entidad, 40), fila[def.pk], null, fila);
      return { fila, duplicados: [] };
    }
    case 'admin_datos_editar': {
      const def = entidadDe(p.entidad);
      const antes = await filaPorId(def, p.id);
      if (!antes) throw new Error('No se encontró ese registro');
      const datos = await camposValidados(def, (p.campos ?? {}) as Record<string, unknown>, true);
      const dups = await duplicadosDe(def, { ...antes, ...datos }, p.id);
      if (dups.length && p.forzar !== true) return { duplicados: dups };
      const { data, error } = await supa.from(def.tabla)
        .update(datos).eq(def.pk, idDe(def, p.id)).select(def.lectura.join(', ')).single();
      if (error) throw new Error(mensajeDePostgres(error));
      await auditar(req, 'editar', s(p.entidad, 40), p.id, antes, data);
      return { fila: data, cambiados: Object.keys(datos) };
    }
```

- [ ] **Step 6: Añadir el panel de duplicados, la bitácora y el deshacer**

A continuación de los dos `case` anteriores:

```ts
    case 'admin_datos_duplicados': {
      const def = entidadDe(p.entidad);
      if (!def.naturales.length) return { grupos: [] };
      const cols = [...new Set([def.pk, def.etiqueta, ...def.naturales.flatMap((x) => x.campos)])];
      const { data } = await supa.from(def.tabla).select(cols.join(', ')).limit(2000);
      const grupos: { porque: string; clave: string; filas: { id: unknown; etiqueta: string }[] }[] = [];
      for (const nat of def.naturales) {
        const mapa = new Map<string, { id: unknown; etiqueta: string }[]>();
        for (const fila of (data || []) as Record<string, unknown>[]) {
          const partes = nat.campos.map((c) => normaClave(fila[c], nat.norma));
          if (partes.some((k) => !k)) continue;
          const clave = partes.join('|');
          const lista = mapa.get(clave) || [];
          lista.push({ id: fila[def.pk], etiqueta: String(fila[def.etiqueta] ?? fila[def.pk]) });
          mapa.set(clave, lista);
        }
        for (const [clave, filas] of mapa) {
          if (filas.length > 1) grupos.push({ porque: nat.campos.join(' + '), clave, filas });
        }
      }
      return { grupos };
    }
    case 'admin_bitacora': {
      const pagina = Math.max(1, Math.round(n(p.pagina)) || 1);
      const porPagina = 40;
      const desde = (pagina - 1) * porPagina;
      let q = supa.from('auditoria_admin')
        .select('id, fecha, ip, accion, entidad, fila_id, antes, despues', { count: 'exact' });
      const ent = s(p.entidad, 40);
      if (ent) q = q.eq('entidad', ent);
      const { data, count, error } = await q
        .order('fecha', { ascending: false }).range(desde, desde + porPagina - 1);
      if (error) throw error;
      return { cambios: data || [], total: count || 0, pagina };
    }
    case 'admin_datos_deshacer': {
      const { data: reg } = await supa.from('auditoria_admin')
        .select('id, accion, entidad, fila_id, antes')
        .eq('id', Math.round(n(p.auditoriaId))).maybeSingle();
      if (!reg) throw new Error('No se encontró ese cambio en la bitácora');
      if (reg.accion !== 'editar') throw new Error('Solo se puede deshacer una edición');
      const def = entidadDe(reg.entidad);
      const antes = (reg.antes || {}) as Record<string, unknown>;
      // Se re-aplica por el MISMO camino con lista blanca: deshacer no puede escribir
      // una columna que una edición normal no podría tocar.
      const soloEditables: Record<string, unknown> = {};
      for (const col of def.editables) {
        if (Object.prototype.hasOwnProperty.call(antes, col.id)) soloEditables[col.id] = antes[col.id];
      }
      const datos = await camposValidados(def, soloEditables, true);
      const actual = await filaPorId(def, reg.fila_id);
      if (!actual) throw new Error('Ese registro ya no existe');
      const { data, error } = await supa.from(def.tabla)
        .update(datos).eq(def.pk, idDe(def, reg.fila_id)).select(def.lectura.join(', ')).single();
      if (error) throw new Error(mensajeDePostgres(error));
      await auditar(req, 'deshacer', String(reg.entidad), reg.fila_id, actual, data);
      return { fila: data };
    }
```

- [ ] **Step 7: Desplegar la edge function**

Delegar al subagente `agente-solucionador-vps` con este encargo:

> Lee el archivo COMPLETO `/root/donaciones-venezuela/supabase/functions/api/index.ts` y
> despliégalo con `mcp__claude_ai_Supabase__deploy_edge_function`: project_id
> `zryfwbjvlacorryzdaod`, name `api`, entrypoint_path `index.ts`, **verify_jwt false**,
> files `[{ name: "index.ts", content: <el contenido íntegro y literal> }]`. No
> modifiques el archivo. Si falla por sintaxis, devuelve el error exacto sin arreglarlo.
> Devuelve el número de versión nueva.

- [ ] **Step 8: Ejecutar la prueba y confirmar que PASA**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: las 21 pruebas en ✅ y salida `0`. Anotar la línea
`ZZTEST_VOLUNTARIOS=<id1>,<id2>` que imprime al final: hace falta en el paso siguiente.

- [ ] **Step 9: Limpiar los datos de prueba**

Con los dos identificadores del paso anterior, ejecutar en Supabase:

```sql
delete from auditoria_admin where entidad = 'voluntarios' and fila_id in ('<ID1>', '<ID2>');
delete from voluntarios where nombre like 'ZZTEST%';
select (select count(*) from voluntarios where nombre like 'ZZTEST%') as vol_zztest,
       (select count(*) from auditoria_admin where despues->>'nombre' like 'ZZTEST%') as bitacora_zztest;
```

Esperado: ambos en `0`.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/api/index.ts scripts/verificar-admin-datos.mjs
git commit -m "feat(admin): crear y editar datos con validación, duplicados y bitácora

Valida cada campo por su tipo declarado y RECHAZA (no ignora) cualquier columna
fuera de la lista blanca. Avisa de duplicados por claves naturales normalizadas
sin acentos, que es lo que hoy no existe: voluntarios, motorizados, rescatistas
y personas no tienen ninguna restricción de unicidad. Cada cambio deja antes y
despues en auditoria_admin, y por eso se puede deshacer."
```

---

## Task 4: Backend de borrado — con aviso de lo que arrastra

**Files:**
- Modify: `supabase/functions/api/index.ts` (un `case` nuevo tras `admin_datos_deshacer`)
- Modify: `scripts/verificar-admin-datos.mjs` (bloque de pruebas nuevo)

**Interfaces:**
- Consumes: de la Tarea 2 — `entidadDe()`, `filaPorId()`, `dependientesDe()`, `idDe()`,
  `normaClave()`. De la Tarea 3 — `auditar()`, `mensajeDePostgres()`.
- Produces: acción `admin_datos_borrar`. La usa la Tarea 5 (fontanería del cliente).

- [ ] **Step 1: Añadir las pruebas de borrado al script**

En `scripts/verificar-admin-datos.mjs`, **justo antes** de la línea
`console.log(\`\nZZTEST_VOLUNTARIOS=...\`)`, insertar:

```js
// ---------- Borrar ----------
const sinConfirmar = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios', id: idVol2 });
ok('22. Borrar sin escribir el nombre es rechazado', sinConfirmar?.success === false, sinConfirmar?.error);

const malConfirmado = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios',
  id: idVol2, confirmar: 'otro nombre' });
ok('23. Borrar con el nombre equivocado es rechazado', malConfirmado?.success === false, malConfirmado?.error);

const borrado = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios',
  id: idVol2, confirmar: 'ZZTEST Ana' });
ok('24. Borra al escribir el nombre', borrado?.borrado === true, borrado?.error);

const yaNoEsta = await adm({ accion: 'admin_datos_ficha', entidad: 'voluntarios', id: idVol2 });
ok('25. El borrado ya no aparece', yaNoEsta?.success === false, yaNoEsta?.error);

// ---------- Aviso de cascada ----------
const cre = await adm({ accion: 'admin_datos_crear', entidad: 'lugares',
  campos: { tipo: 'Centro', nombre: 'ZZTEST Centro Cascada', ubicacion: 'Av prueba',
            telefono: '04120000003', lat: 10.48, lng: -66.9 } });
const idLug = cre?.fila?.id;
ok('26. Crea un centro de prueba', !!idLug, cre?.error);

await adm({ accion: 'admin_datos_crear', entidad: 'insumos',
  campos: { lugar_id: idLug, nombre: 'ZZTEST Gasas', categoria: 'General', estado: 'Necesita',
            cantidad_necesaria: 10, cantidad_recibida: 0, urgencia: 'Normal', unidad: 'cajas' } });

const fichaLug = await adm({ accion: 'admin_datos_ficha', entidad: 'lugares', id: idLug });
const avisoInsumos = (fichaLug?.dependientes || []).find((d) => d.etiqueta === 'insumos');
ok('27. La ficha avisa de los insumos que arrastra',
   !!avisoInsumos && avisoInsumos.cuantos === 1 && avisoInsumos.modo === 'cascade',
   JSON.stringify(fichaLug?.dependientes));

const borrLug = await adm({ accion: 'admin_datos_borrar', entidad: 'lugares',
  id: idLug, confirmar: 'ZZTEST Centro Cascada' });
ok('28. Borra el centro y devuelve lo que arrastró', borrLug?.borrado === true,
   JSON.stringify(borrLug?.dependientes));

const insumosHuerfanos = await adm({ accion: 'admin_datos_listar', entidad: 'insumos', busca: 'ZZTEST Gasas' });
ok('29. La cascada se llevó el insumo', (insumosHuerfanos?.filas || []).length === 0,
   `${insumosHuerfanos?.filas?.length} insumos`);

// ---------- La bitácora registró el borrado ----------
const bitBorra = await adm({ accion: 'admin_bitacora', entidad: 'lugares' });
const filaBorrado = (bitBorra?.cambios || []).find(
  (c) => c.accion === 'borrar' && String(c.fila_id) === String(idLug));
ok('30. La bitácora guarda la fila borrada entera',
   !!filaBorrado && filaBorrado.antes?.fila?.nombre === 'ZZTEST Centro Cascada',
   filaBorrado ? JSON.stringify(filaBorrado.antes?.dependientes) : 'sin fila');

console.log(`ZZTEST_LUGAR=${idLug}`);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que las nuevas FALLAN**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: del 1 al 21 en ✅ y del 22 al 30 en ❌ («accion desconocida» en las de borrar).
Salida distinta de `0`.

- [ ] **Step 3: Añadir la acción de borrar**

En el `switch (accion)`, **justo después** del `case 'admin_datos_deshacer'`, añadir:

```ts
    case 'admin_datos_borrar': {
      const def = entidadDe(p.entidad);
      const antes = await filaPorId(def, p.id);
      if (!antes) throw new Error('No se encontró ese registro');
      // Confirmación POR ESCRITO: hay que teclear la etiqueta de la fila. Un «¿seguro?»
      // se acepta sin leerlo; escribir el nombre obliga a mirar qué se está borrando.
      const esperado = normaClave(antes[def.etiqueta], 'texto');
      if (!esperado || normaClave(p.confirmar, 'texto') !== esperado) {
        throw new Error('Escribe el nombre del registro para confirmar el borrado');
      }
      // Se calculan ANTES de borrar: después de la cascada ya no hay a quién contar.
      const dependientes = await dependientesDe(def, p.id);
      const { error } = await supa.from(def.tabla).delete().eq(def.pk, idDe(def, p.id));
      if (error) throw new Error(mensajeDePostgres(error));
      // La bitácora guarda la fila ENTERA y lo que se llevó por delante: es lo único
      // que queda de un borrado físico.
      await auditar(req, 'borrar', s(p.entidad, 40), p.id, { fila: antes, dependientes }, null);
      return { borrado: true, dependientes };
    }
```

- [ ] **Step 4: Desplegar la edge function**

Delegar al subagente `agente-solucionador-vps` con este encargo:

> Lee el archivo COMPLETO `/root/donaciones-venezuela/supabase/functions/api/index.ts` y
> despliégalo con `mcp__claude_ai_Supabase__deploy_edge_function`: project_id
> `zryfwbjvlacorryzdaod`, name `api`, entrypoint_path `index.ts`, **verify_jwt false**,
> files `[{ name: "index.ts", content: <el contenido íntegro y literal> }]`. No
> modifiques el archivo. Si falla por sintaxis, devuelve el error exacto sin arreglarlo.
> Devuelve el número de versión nueva.

- [ ] **Step 5: Ejecutar la prueba y confirmar que PASA**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: las 30 pruebas en ✅ y salida `0`.

- [ ] **Step 6: Limpiar los datos de prueba**

Con los identificadores que imprimió el script (`ZZTEST_VOLUNTARIOS` y `ZZTEST_LUGAR`):

```sql
delete from insumos where nombre like 'ZZTEST%';
delete from lugares where nombre like 'ZZTEST%';
delete from voluntarios where nombre like 'ZZTEST%';
delete from auditoria_admin
  where despues->>'nombre' like 'ZZTEST%'
     or antes->>'nombre' like 'ZZTEST%'
     or antes->'fila'->>'nombre' like 'ZZTEST%';
select (select count(*) from lugares where nombre like 'ZZTEST%') as lugares_zztest,
       (select count(*) from insumos where nombre like 'ZZTEST%') as insumos_zztest,
       (select count(*) from voluntarios where nombre like 'ZZTEST%') as vol_zztest,
       (select count(*) from auditoria_admin
         where antes::text like '%ZZTEST%' or despues::text like '%ZZTEST%') as bitacora_zztest;
```

Esperado: los cuatro en `0`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/api/index.ts scripts/verificar-admin-datos.mjs
git commit -m "feat(admin): borrado con confirmación escrita y aviso de cascada

Borrar exige teclear el nombre del registro, no un «¿seguro?». La ficha dice
antes cuántas filas arrastra (un centro se lleva sus insumos y su acceso al
panel) y la bitácora guarda la fila entera: es lo único que queda de un
borrado físico."
```

---

## Task 5: Fontanería compartida del cliente y grupo «Datos» en el menú

**Files:**
- Create: `js/admin-datos.js`
- Modify: `js/admin.js:88-108` (la función `irAMenu`, para añadir el grupo «Datos»)
- Modify: `js/admin.js` (el enrutado de `data-admin-gestion`)
- Modify: `index.html`, `ventana.html` (declarar el archivo nuevo)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: globales que ya existen en `js/core.js` y `js/admin.js` —
  `$(sel)`, `$$(sel)`, `e(txt)`, `t(clave, params)`, `toast(txt)`, `postAdmin(payload)`,
  `marcoGestion(titulo, cuerpo)`, `bindGestMenu()`, `irAMenu()`, `mensajeAdmin(sel, tipo, txt)`,
  `fechaRelativa(iso)`. Del backend: `admin_datos_listar`, `admin_datos_ficha`,
  `admin_datos_crear`, `admin_datos_editar`, `admin_datos_borrar`,
  `admin_datos_duplicados`, `admin_bitacora`, `admin_datos_deshacer`.
- Produces (las usan las tareas 6, 7 y 8):
  - `DV_DATOS_PANELES` — objeto `{ [id]: { icono: string, titulo(): string, abrir(): void } }`
    que las tareas 6 y 7 rellenan y que `js/admin.js` consulta para pintar el menú y
    enrutar. **Se declara aquí y en ningún otro sitio.**
  - `dvDatosLista(cfg)` — pinta la pantalla de lista completa. `cfg` es:
    `{ entidad: string, pk?: string ('id'), etiqueta?: string ('nombre'), titulo: string,
       fila(item) → html, campos: [{ id, etiqueta, tipo, opciones? }],
       extras?(fila, dependientes) → html, alPintar?(fila, id) → void }`.
    `tipo` ∈ `texto` · `texto-largo` · `numero` · `coord` · `email` · `telefono` ·
    `opcion` (con `opciones: string[]`) · `booleano` · `ref` (desplegable de centros).
  - `dvDatosFicha(cfg, id)` — abre la ficha de una fila (ver, editar, borrar).
  - `dvDatosNuevo(cfg)` — abre la ficha vacía para crear.
  - `dvBorrar(cfg, fila, dependientes, id)` — modal que exige escribir el nombre.
  - `dvPanelBitacora(entidad)` — panel de la bitácora con deshacer; `''` = todas.
  - `dvPanelDuplicados(cfg)` — panel de posibles duplicados de una entidad.
  - `dvCentros() → Promise<{id, nombre}[]>` — lista de centros, cacheada.
  - `dvTexto(clave, params)` — atajo de `t('datos.' + clave, params)`.

> **Cuidado con el scope:** los `js/*.js` comparten el ámbito global y no tienen IIFE.
> Un `let`/`const` de nivel superior declarado dos veces en dos archivos distintos
> lanza `SyntaxError` y **rompe toda la página**. Cada nombre de este plan se declara
> exactamente una vez.

- [ ] **Step 1: Añadir los textos a los dos idiomas**

```bash
python3 - <<'PY'
import json, collections

def add(path, seccion, nuevas):
    with open(path, encoding='utf-8') as f:
        d = json.load(f, object_pairs_hook=collections.OrderedDict)
    d.setdefault(seccion, collections.OrderedDict())
    for k, v in nuevas.items():
        d[seccion][k] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')

add('locales/es.json', 'datos', {
  "groupTitle": "Datos",
  "groupIntro": "Revisa, corrige y elimina cualquier registro de la aplicación.",
  "search": "Buscar",
  "searchPh": "Nombre, teléfono, correo…",
  "new": "Nuevo",
  "empty": "No hay nada aquí todavía.",
  "showing": "{desde}–{hasta} de {total}",
  "prev": "Anterior",
  "next": "Siguiente",
  "edit": "Editar",
  "save": "Guardar",
  "cancel": "Cancelar",
  "delete": "Eliminar",
  "saved": "Guardado",
  "created": "Creado",
  "deleted": "Eliminado",
  "changedFields": "Cambió: {campos}",
  "loading": "Cargando…",
  "confirmTitle": "Vas a eliminar «{nombre}»",
  "confirmType": "Escribe {nombre} para confirmar",
  "confirmCascade": "Esto eliminará también {cuantos} {cosa}.",
  "confirmOrphan": "{cuantos} {cosa} quedarán sin asignar.",
  "dupTitle": "Ya existe algo muy parecido",
  "dupBecause": "Coincide en {campos}",
  "dupOpen": "Abrir el que existe",
  "dupForce": "Crear igualmente",
  "dupPanel": "Posibles duplicados",
  "dupNone": "No se encontraron duplicados.",
  "photos": "Documentos",
  "photoOpen": "Ver documento",
  "logTitle": "Bitácora de cambios",
  "logIntro": "Todo lo que se ha creado, corregido o eliminado desde la consola.",
  "logEmpty": "Todavía no hay cambios registrados.",
  "logUndo": "Deshacer",
  "logUndone": "Cambio deshecho",
  "logAll": "Todas las secciones",
  "actionCrear": "creó",
  "actionEditar": "corrigió",
  "actionBorrar": "eliminó",
  "actionDeshacer": "deshizo",
})

add('locales/en.json', 'datos', {
  "groupTitle": "Data",
  "groupIntro": "Review, correct and remove any record in the app.",
  "search": "Search",
  "searchPh": "Name, phone, email…",
  "new": "New",
  "empty": "Nothing here yet.",
  "showing": "{desde}–{hasta} of {total}",
  "prev": "Previous",
  "next": "Next",
  "edit": "Edit",
  "save": "Save",
  "cancel": "Cancel",
  "delete": "Delete",
  "saved": "Saved",
  "created": "Created",
  "deleted": "Deleted",
  "changedFields": "Changed: {campos}",
  "loading": "Loading…",
  "confirmTitle": "You are about to delete “{nombre}”",
  "confirmType": "Type {nombre} to confirm",
  "confirmCascade": "This will also delete {cuantos} {cosa}.",
  "confirmOrphan": "{cuantos} {cosa} will be left unassigned.",
  "dupTitle": "Something very similar already exists",
  "dupBecause": "Matches on {campos}",
  "dupOpen": "Open the existing one",
  "dupForce": "Create anyway",
  "dupPanel": "Possible duplicates",
  "dupNone": "No duplicates found.",
  "photos": "Documents",
  "photoOpen": "View document",
  "logTitle": "Change log",
  "logIntro": "Everything created, corrected or deleted from the console.",
  "logEmpty": "No changes recorded yet.",
  "logUndo": "Undo",
  "logUndone": "Change undone",
  "logAll": "All sections",
  "actionCrear": "created",
  "actionEditar": "corrected",
  "actionBorrar": "deleted",
  "actionDeshacer": "undid",
})
print('ok')
PY
python3 scripts/verificar-idioma.py
```

Esperado: `Idioma OK: … claves paralelas en es/en, sin texto cableado en el JS.` y salida `0`.

- [ ] **Step 2: Crear `js/admin-datos.js`**

```js
// Consola de datos del admin — fontanería compartida de las pantallas a medida.
// Aquí vive TODO lo que se repite: lista con buscador y paginación, ficha, guardado,
// confirmación de borrado, aviso de duplicados y bitácora. Lo que cambia de una
// entidad a otra vive en admin-personas.js y admin-centros.js.
// Scope global compartido (sin módulos ni IIFE), igual que el resto de js/.
'use strict';

    // Cada pantalla se registra aquí: { icono, titulo() , abrir() }.
    // Lo rellenan admin-personas.js y admin-centros.js; lo lee irAMenu() de admin.js.
    const DV_DATOS_PANELES = {};

    const DV_POR_PAGINA = 25;
    let dvLista = { entidad: '', pagina: 1, busca: '', total: 0, filas: [] };
    let dvCentrosCache = null;

    function dvTexto(clave, params) { return t('datos.' + clave, params); }
    function dvError(err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }

    // Los centros se piden una vez y se reutilizan: los selectores de «a qué centro
    // pertenece esto» aparecen en varias pantallas.
    async function dvCentros() {
      if (dvCentrosCache) return dvCentrosCache;
      const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'lugares', porPagina: 100 });
      dvCentrosCache = (r.filas || []).map((l) => ({ id: l.id, nombre: l.nombre }));
      return dvCentrosCache;
    }

    // Un campo declarado como 'ref' se convierte en un desplegable de centros.
    async function dvCamposResueltos(cfg) {
      const campos = cfg.campos.map((c) => Object.assign({}, c));
      for (const c of campos) {
        if (c.tipo !== 'ref') continue;
        c.tipo = 'opcion';
        c.numerico = true;
        c.opcionesValor = await dvCentros();
      }
      return campos;
    }

    function dvCampoHtml(campo, valor) {
      const id = 'dvc-' + campo.id;
      const v = valor == null ? '' : String(valor);
      if (campo.tipo === 'opcion') {
        const pares = campo.opcionesValor
          ? campo.opcionesValor.map((o) => [String(o.id), String(o.nombre)])
          : (campo.opciones || []).map((o) => [o, o]);
        const ops = pares.map(([val, lab]) =>
          `<option value="${e(val)}"${val === v ? ' selected' : ''}>${e(lab)}</option>`).join('');
        return `<div class="field"><label for="${id}">${e(campo.etiqueta)}</label><select id="${id}">${ops}</select></div>`;
      }
      if (campo.tipo === 'booleano') {
        return `<div class="field"><label class="check-inline"><input id="${id}" type="checkbox"${v === 'true' ? ' checked' : ''} /> ${e(campo.etiqueta)}</label></div>`;
      }
      if (campo.tipo === 'texto-largo') {
        return `<div class="field full"><label for="${id}">${e(campo.etiqueta)}</label><textarea id="${id}" rows="3">${e(v)}</textarea></div>`;
      }
      const tipoHtml = campo.tipo === 'numero' || campo.tipo === 'coord' ? 'number'
        : campo.tipo === 'email' ? 'email' : campo.tipo === 'telefono' ? 'tel' : 'text';
      const paso = campo.tipo === 'coord' ? ' step="any"' : '';
      return `<div class="field"><label for="${id}">${e(campo.etiqueta)}</label><input id="${id}" type="${tipoHtml}"${paso} value="${e(v)}" /></div>`;
    }

    function dvLeerCampos(campos) {
      const datos = {};
      for (const c of campos) {
        const el = $('#dvc-' + c.id);
        if (!el) continue;
        if (c.tipo === 'booleano') datos[c.id] = el.checked;
        else if (c.numerico) datos[c.id] = Number(el.value);
        else if (c.tipo === 'numero' || c.tipo === 'coord') datos[c.id] = el.value === '' ? '' : Number(el.value);
        else datos[c.id] = el.value.trim();
      }
      return datos;
    }

    // ---- Lista ----
    async function dvDatosLista(cfg) {
      dvLista = { entidad: cfg.entidad, pagina: 1, busca: '', total: 0, filas: [] };
      $('#admin-console').innerHTML = marcoGestion(cfg.titulo, `
        <div class="datos-barra">
          <div class="field">
            <label for="datos-busca">${e(dvTexto('search'))}</label>
            <input id="datos-busca" type="search" placeholder="${e(dvTexto('searchPh'))}" />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" id="datos-nuevo">${e(dvTexto('new'))}</button>
            <button class="btn btn-soft btn-small" type="button" id="datos-dups">${e(dvTexto('dupPanel'))}</button>
          </div>
        </div>
        <div id="datos-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>
        <div class="datos-pag">
          <button class="btn btn-soft btn-small" type="button" id="datos-prev">${e(dvTexto('prev'))}</button>
          <span class="meta" id="datos-cuenta"></span>
          <button class="btn btn-soft btn-small" type="button" id="datos-next">${e(dvTexto('next'))}</button>
        </div>`);
      bindGestMenu();
      $('#datos-nuevo').addEventListener('click', () => dvDatosNuevo(cfg));
      $('#datos-dups').addEventListener('click', () => dvPanelDuplicados(cfg));
      $('#datos-prev').addEventListener('click', () => {
        if (dvLista.pagina > 1) { dvLista.pagina--; dvPintarFilas(cfg); }
      });
      $('#datos-next').addEventListener('click', () => {
        if (dvLista.pagina * DV_POR_PAGINA < dvLista.total) { dvLista.pagina++; dvPintarFilas(cfg); }
      });
      // El buscador consulta al SERVIDOR: la lista puede ser mucho más larga que la
      // página que se está viendo, así que filtrar en el navegador mentiría.
      let temporizador = null;
      $('#datos-busca').addEventListener('input', (ev) => {
        const valor = ev.target.value;
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
          dvLista.busca = valor; dvLista.pagina = 1; dvPintarFilas(cfg);
        }, 300);
      });
      await dvPintarFilas(cfg);
    }

    async function dvPintarFilas(cfg) {
      const cont = $('#datos-filas');
      if (!cont) return;
      cont.innerHTML = `<p class="empty-state">${e(dvTexto('loading'))}</p>`;
      try {
        const r = await postAdmin({ accion: 'admin_datos_listar', entidad: cfg.entidad,
          busca: dvLista.busca, pagina: dvLista.pagina, porPagina: DV_POR_PAGINA });
        dvLista.filas = r.filas || [];
        dvLista.total = r.total || 0;
      } catch (err) { dvError(err); return; }
      const pk = cfg.pk || 'id';
      cont.innerHTML = dvLista.filas.map((item) =>
        `<button class="admin-record" type="button" data-datos-id="${e(String(item[pk]))}">${cfg.fila(item)}</button>`
      ).join('') || `<p class="empty-state">${e(dvTexto('empty'))}</p>`;
      $$('#datos-filas [data-datos-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.datosId)));
      const desde = dvLista.total ? (dvLista.pagina - 1) * DV_POR_PAGINA + 1 : 0;
      const hasta = Math.min(dvLista.pagina * DV_POR_PAGINA, dvLista.total);
      $('#datos-cuenta').textContent = dvTexto('showing', { desde, hasta, total: dvLista.total });
    }

    // ---- Ficha ----
    async function dvDatosFicha(cfg, id) {
      try {
        const res = await postAdmin({ accion: 'admin_datos_ficha', entidad: cfg.entidad, id });
        await dvPintarFicha(cfg, res.fila || {}, res.fotos || [], res.dependientes || [], id);
      } catch (err) { dvError(err); }
    }

    async function dvDatosNuevo(cfg) { await dvPintarFicha(cfg, {}, [], [], null); }

    async function dvPintarFicha(cfg, fila, fotos, dependientes, id) {
      const campos = await dvCamposResueltos(cfg);
      const etiqueta = cfg.etiqueta || 'nombre';
      const fotosHtml = fotos.length ? `
        <div class="datos-fotos">
          <h4>${e(dvTexto('photos'))}</h4>
          ${fotos.map((f) => `<a class="btn btn-soft btn-small" target="_blank" rel="noopener" href="${e(f.url)}">${e(dvTexto('photoOpen'))} · ${e(f.campo)}</a>`).join('')}
        </div>` : '';
      const titulo = id ? `${cfg.titulo} · ${String(fila[etiqueta] || '')}` : `${cfg.titulo} · ${dvTexto('new')}`;
      $('#admin-console').innerHTML = marcoGestion(titulo, `
        <div class="admin-form-card">
          ${cfg.extras ? cfg.extras(fila, dependientes) : ''}
          <div class="form-grid">${campos.map((c) => dvCampoHtml(c, fila[c.id])).join('')}</div>
          ${fotosHtml}
          <div id="datos-dup" class="form-message"></div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" id="datos-guardar">${e(dvTexto('save'))}</button>
            <button class="btn btn-ghost" type="button" id="datos-volver">${e(dvTexto('cancel'))}</button>
            ${id ? `<button class="btn btn-danger" type="button" id="datos-borrar">${e(dvTexto('delete'))}</button>` : ''}
          </div>
        </div>`);
      bindGestMenu();
      $('#datos-volver').addEventListener('click', () => dvDatosLista(cfg));
      $('#datos-guardar').addEventListener('click', () => dvGuardar(cfg, campos, id, false));
      if (id) $('#datos-borrar').addEventListener('click', () => dvBorrar(cfg, fila, dependientes, id));
      if (cfg.alPintar) cfg.alPintar(fila, id);
    }

    async function dvGuardar(cfg, campos, id, forzar) {
      const datos = dvLeerCampos(campos);
      const boton = $('#datos-guardar');
      boton.disabled = true;
      mensajeAdmin('#gest-msg', 'info', dvTexto('loading'));
      try {
        const res = await postAdmin(id
          ? { accion: 'admin_datos_editar', entidad: cfg.entidad, id, campos: datos, forzar }
          : { accion: 'admin_datos_crear', entidad: cfg.entidad, campos: datos, forzar });
        if (res.duplicados && res.duplicados.length) {
          boton.disabled = false;
          dvAvisoDuplicados(cfg, res.duplicados, () => dvGuardar(cfg, campos, id, true));
          return;
        }
        toast(id ? dvTexto('saved') : dvTexto('created'));
        dvCentrosCache = null; // por si se tocó un centro
        await dvDatosLista(cfg);
        if (id && res.cambiados) {
          mensajeAdmin('#gest-msg', 'info', dvTexto('changedFields', { campos: res.cambiados.join(', ') }));
        }
      } catch (err) { boton.disabled = false; dvError(err); }
    }

    function dvAvisoDuplicados(cfg, dups, alForzar) {
      const caja = $('#datos-dup');
      caja.className = 'form-message visible error';
      caja.innerHTML = `
        <strong>${e(dvTexto('dupTitle'))}</strong>
        <ul>${dups.map((d) => `<li>${e(d.etiqueta)} — ${e(dvTexto('dupBecause', { campos: d.porque }))}
          <button class="link-btn" type="button" data-dup-abrir="${e(String(d.id))}">${e(dvTexto('dupOpen'))}</button></li>`).join('')}</ul>
        <button class="btn btn-soft btn-small" type="button" id="dup-forzar">${e(dvTexto('dupForce'))}</button>`;
      $$('#datos-dup [data-dup-abrir]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.dupAbrir)));
      $('#dup-forzar').addEventListener('click', alForzar);
    }

    // ---- Borrado ----
    // Hay que ESCRIBIR el nombre. Un «¿seguro?» se acepta sin leerlo; teclear el
    // nombre obliga a mirar qué se está borrando. El servidor lo vuelve a exigir.
    function dvBorrar(cfg, fila, dependientes, id) {
      const nombre = String(fila[cfg.etiqueta || 'nombre'] || '');
      const aviso = (dependientes || []).map((d) => d.modo === 'cascade'
        ? dvTexto('confirmCascade', { cuantos: d.cuantos, cosa: d.etiqueta })
        : dvTexto('confirmOrphan', { cuantos: d.cuantos, cosa: d.etiqueta })).join(' ');
      abrirModal(dvTexto('confirmTitle', { nombre }), `
        ${aviso ? `<p class="section-copy">${e(aviso)}</p>` : ''}
        <div class="field">
          <label for="dv-confirmar">${e(dvTexto('confirmType', { nombre }))}</label>
          <input id="dv-confirmar" autocomplete="off" />
        </div>
        <div id="dv-borrar-msg" class="form-message"></div>
        <div class="form-actions">
          <button class="btn btn-danger" type="button" id="dv-borrar-ok">${e(dvTexto('delete'))}</button>
        </div>`);
      $('#dv-borrar-ok').addEventListener('click', async () => {
        try {
          await postAdmin({ accion: 'admin_datos_borrar', entidad: cfg.entidad, id,
            confirmar: $('#dv-confirmar').value });
          const dialog = $('#modal-root dialog');
          if (dialog) dialog.close();
          toast(dvTexto('deleted'));
          dvCentrosCache = null;
          await dvDatosLista(cfg);
        } catch (err) {
          mensajeAdmin('#dv-borrar-msg', 'error', String((err && err.message) || ''));
        }
      });
    }

    // ---- Duplicados ----
    async function dvPanelDuplicados(cfg) {
      $('#admin-console').innerHTML = marcoGestion(`${cfg.titulo} · ${dvTexto('dupPanel')}`, `
        <div id="dup-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>`);
      bindGestMenu();
      let res;
      try { res = await postAdmin({ accion: 'admin_datos_duplicados', entidad: cfg.entidad }); }
      catch (err) { dvError(err); return; }
      $('#dup-filas').innerHTML = (res.grupos || []).map((g) => `
        <article class="admin-private-card">
          <p class="meta">${e(dvTexto('dupBecause', { campos: g.porque }))}</p>
          ${g.filas.map((f) => `<button class="admin-record" type="button" data-dup-id="${e(String(f.id))}">
            <span class="admin-record-main"><strong>${e(f.etiqueta)}</strong></span></button>`).join('')}
        </article>`).join('') || `<p class="empty-state">${e(dvTexto('dupNone'))}</p>`;
      $$('#dup-filas [data-dup-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.dupId)));
    }

    // ---- Bitácora ----
    async function dvPanelBitacora(entidad) {
      $('#admin-console').innerHTML = marcoGestion(dvTexto('logTitle'), `
        <p class="meta">${e(dvTexto('logIntro'))}</p>
        <div id="log-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>`);
      bindGestMenu();
      let res;
      try { res = await postAdmin({ accion: 'admin_bitacora', entidad: entidad || '' }); }
      catch (err) { dvError(err); return; }
      $('#log-filas').innerHTML = (res.cambios || []).map((c) => {
        const clave = 'action' + String(c.accion).charAt(0).toUpperCase() + String(c.accion).slice(1);
        const despues = c.despues || {};
        const antes = c.antes || {};
        const nombre = despues.nombre || antes.nombre || (antes.fila && antes.fila.nombre) || c.fila_id;
        return `<article class="admin-private-card">
          <div class="supply-line">
            <strong>${e(dvTexto(clave))} ${e(String(nombre))}</strong>
            <span class="badge gray">${e(String(c.entidad))}</span>
          </div>
          <p class="meta">${e(fechaRelativa(c.fecha))} · ${e(String(c.ip))}</p>
          ${c.accion === 'editar' ? `<div class="card-actions">
            <button class="btn btn-soft btn-small" type="button" data-log-undo="${e(String(c.id))}">${e(dvTexto('logUndo'))}</button>
          </div>` : ''}
        </article>`;
      }).join('') || `<p class="empty-state">${e(dvTexto('logEmpty'))}</p>`;
      $$('#log-filas [data-log-undo]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await postAdmin({ accion: 'admin_datos_deshacer', auditoriaId: Number(b.dataset.logUndo) });
          toast(dvTexto('logUndone'));
          dvPanelBitacora(entidad);
        } catch (err) { b.disabled = false; dvError(err); }
      }));
    }
```

- [ ] **Step 3: Declarar el archivo nuevo en las dos páginas**

`js/admin-datos.js` debe cargarse **después** de `js/admin.js` (usa `marcoGestion`,
`bindGestMenu` y `postAdmin`, que se declaran allí).

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
viejo = '<script src="js/admin.js?v=95" defer></script>'
nuevo = ('<script src="js/admin.js?v=95" defer></script>\n'
         '    <script src="js/admin-datos.js?v=96" defer></script>')
for f in ('index.html', 'ventana.html'):
    s = open(f, encoding='utf-8').read()
    assert s.count(viejo) == 1, (f, s.count(viejo))
    open(f, 'w', encoding='utf-8').write(s.replace(viejo, nuevo))
    print('ok', f)
PY
grep -n "admin-datos.js" index.html ventana.html
```

Esperado: una línea por archivo. Si el `assert` falla, mirar cómo está escrita la
etiqueta de `admin.js` en ese HTML (puede llevar otro `?v=`) y ajustar el literal.

- [ ] **Step 4: Añadir el grupo «Datos» al menú del admin**

En `js/admin.js`, dentro de `irAMenu()`, **justo después** de la línea que construye
`gestionRows` (la que termina en `</button>`).join('');`), añadir:

```js
      // Grupo «Datos»: una fila por pantalla registrada en DV_DATOS_PANELES
      // (js/admin-datos.js + las pantallas a medida) y la bitácora al final.
      const datosRows = Object.keys(DV_DATOS_PANELES).map((id) => {
        const d = DV_DATOS_PANELES[id];
        return `
        <button class="admin-manage-row" type="button" data-admin-datos="${e(id)}">
          <span class="admin-manage-icon" aria-hidden="true">${d.icono}</span>
          <span class="admin-manage-title">${e(d.titulo())}</span>
          <span class="admin-launch-go" aria-hidden="true">→</span>
        </button>`;
      }).join('') + `
        <button class="admin-manage-row" type="button" data-admin-datos="__bitacora">
          <span class="admin-manage-icon" aria-hidden="true">🕘</span>
          <span class="admin-manage-title">${e(t('datos.logTitle'))}</span>
          <span class="admin-launch-go" aria-hidden="true">→</span>
        </button>`;
```

En el mismo archivo, **justo después** del bloque
`<section class="admin-group"> … ${gestionRows} … </section>`, añadir dentro de la
plantilla:

```js
        <section class="admin-group">
          <h3 class="admin-group-title">${e(t('datos.groupTitle'))}</h3>
          <p class="meta">${e(t('datos.groupIntro'))}</p>
          <div class="admin-manage-list">${datosRows}</div>
        </section>`;
```

Y **justo después** de la línea
`$$('#admin-console [data-admin-gestion]').forEach(…)`, añadir el enrutado:

```js
      $$('#admin-console [data-admin-datos]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.adminDatos;
        if (id === '__bitacora') { dvPanelBitacora(''); return; }
        const panel = DV_DATOS_PANELES[id];
        if (panel) panel.abrir();
      }));
```

- [ ] **Step 5: Comprobar sintaxis e idiomas**

```bash
cd /root/donaciones-venezuela && node --check js/admin-datos.js && node --check js/admin.js \
  && python3 scripts/verificar-idioma.py
```

Esperado: sin salida de `node --check` (silencio = correcto) y
`Idioma OK: … claves paralelas en es/en, sin texto cableado en el JS.`

- [ ] **Step 6: Comprobar en el navegador que el menú sale y no rompe nada**

```bash
cd /root/donaciones-venezuela && python3 -m http.server 8141 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8141/ventana.html?v=admin&nocache=1`, escribir la ADMIN_KEY y
comprobar:

- Aparece el grupo **«Datos»** debajo de «Gestionar», por ahora **solo con la fila de la
  bitácora** (las 8 pantallas llegan en las tareas 6 y 7).
- Al pulsar la bitácora se abre el panel y dice «Todavía no hay cambios registrados» o
  lista los cambios de las pruebas del backend.
- **La consola del navegador no muestra ningún error.** Un `SyntaxError` aquí casi
  siempre significa que un `const` de nivel superior está declarado dos veces entre
  `admin.js` y `admin-datos.js`.

Detener el servidor al terminar:

```bash
pkill -f "http.server 8141"
```

*(Ese `pkill` devuelve código 144 en este entorno; no encadenarlo con `&&`.)*

- [ ] **Step 7: Commit**

```bash
git add js/admin-datos.js js/admin.js index.html ventana.html locales/es.json locales/en.json
git commit -m "feat(admin): fontanería de la consola de datos y grupo «Datos» en el menú

Lista con buscador contra el servidor y paginación, ficha genérica, guardado con
aviso de duplicados, borrado que exige escribir el nombre, panel de duplicados y
bitácora con deshacer. Las pantallas a medida se registran en DV_DATOS_PANELES."
```

---

## Task 6: Las cuatro pantallas de personas

**Files:**
- Create: `js/admin-personas.js`
- Modify: `index.html`, `ventana.html` (declarar el archivo nuevo)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: de la Tarea 5 — `DV_DATOS_PANELES`, `dvDatosLista(cfg)`, `dvTexto(clave, params)`.
  Globales previas: `e()`, `t()`, `fechaRelativa()`.
- Produces: registra `DV_DATOS_PANELES.voluntarios`, `.motorizados`, `.rescatistas` y
  `.personas`, y declara dos ayudantes que **también usa la Tarea 7**:
  - `dvpFila(titulo, secundario, badge) → html` — el resumen de una fila de lista.
  - `dvpUnidos(partes) → string` — junta con « · » descartando lo vacío.

- [ ] **Step 1: Añadir las etiquetas de campo a los dos idiomas**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
import json, collections

def add(path, nuevas):
    with open(path, encoding='utf-8') as f:
        d = json.load(f, object_pairs_hook=collections.OrderedDict)
    for k, v in nuevas.items():
        d['datos'][k] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')

add('locales/es.json', {
  "fName": "Nombre", "fLastName": "Apellido", "fEmail": "Correo", "fPhone": "Teléfono",
  "fState": "Estado", "fCity": "Ciudad", "fProfession": "Profesión",
  "fAvailability": "Disponibilidad", "fTransport": "Medio de transporte",
  "fNotes": "Observaciones", "fOrg": "Organización", "fSpecialty": "Especialidad",
  "fEquipment": "Equipo disponible", "fCapacity": "Capacidad operativa",
  "fVehicle": "Tipo de vehículo", "fZone": "Zona de operación", "fPlate": "Placa",
  "fCedula": "Cédula", "fLocation": "Ubicación", "fContact": "Contacto",
  "fSource": "Fuente", "fReportedBy": "Reportado por", "fVerified": "Verificada",
  "hasId": "Con cédula", "noId": "Sin cédula",
  "titleDrivers": "Transportistas", "titlePeople": "Personas buscadas",
})

add('locales/en.json', {
  "fName": "First name", "fLastName": "Last name", "fEmail": "Email", "fPhone": "Phone",
  "fState": "State", "fCity": "City", "fProfession": "Profession",
  "fAvailability": "Availability", "fTransport": "Means of transport",
  "fNotes": "Notes", "fOrg": "Organisation", "fSpecialty": "Speciality",
  "fEquipment": "Available equipment", "fCapacity": "Operating capacity",
  "fVehicle": "Vehicle type", "fZone": "Operating area", "fPlate": "Plate",
  "fCedula": "ID number", "fLocation": "Location", "fContact": "Contact",
  "fSource": "Source", "fReportedBy": "Reported by", "fVerified": "Verified",
  "hasId": "ID on file", "noId": "No ID",
  "titleDrivers": "Drivers", "titlePeople": "Missing people",
})
print('ok')
PY
python3 scripts/verificar-idioma.py
```

Esperado: `Idioma OK: …` y salida `0`.

- [ ] **Step 2: Crear `js/admin-personas.js`**

```js
// Consola de datos del admin — pantallas de personas.
// Voluntarios, transportistas, rescatistas y personas buscadas. Cada pantalla decide
// QUÉ enseña de cada ficha; el listar / buscar / editar / borrar lo pone admin-datos.js.
'use strict';

    // Resumen de una fila: título a la izquierda, datos secundarios debajo, distintivo
    // a la derecha. Es la forma que ya usan los demás paneles del admin.
    function dvpFila(titulo, secundario, badge) {
      return `
        <span class="admin-record-main">
          <strong>${e(titulo)}</strong>
          <span class="meta">${e(secundario)}</span>
        </span>
        <span class="admin-record-side">${badge}</span>`;
    }

    const dvpUnidos = (partes) => partes.filter(Boolean).join(' · ');

    // ---- Voluntarios ----
    DV_DATOS_PANELES.voluntarios = {
      icono: '🙌',
      titulo: () => t('admin.manageVolunteers'),
      abrir: () => dvDatosLista({
        entidad: 'voluntarios', pk: 'id', etiqueta: 'nombre',
        titulo: t('admin.manageVolunteers'),
        // La cédula a la vista es la palanca contra los registros falsos: el distintivo
        // dice de un vistazo quién tiene documento subido y quién no.
        fila: (v) => dvpFila(
          `${v.nombre || ''} ${v.apellido || ''}`.trim(),
          dvpUnidos([v.ciudad, v.profesion, v.telefono, v.email]),
          v.foto_cedula
            ? `<span class="badge green">${e(dvTexto('hasId'))}</span>`
            : `<span class="badge red">${e(dvTexto('noId'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'apellido', etiqueta: dvTexto('fLastName'), tipo: 'texto' },
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'ciudad', etiqueta: dvTexto('fCity'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'profesion', etiqueta: dvTexto('fProfession'), tipo: 'texto' },
          { id: 'disponibilidad', etiqueta: dvTexto('fAvailability'), tipo: 'texto' },
          { id: 'medio_transporte', etiqueta: dvTexto('fTransport'), tipo: 'texto' },
          { id: 'observaciones', etiqueta: dvTexto('fNotes'), tipo: 'texto-largo' },
        ],
      }),
    };

    // ---- Transportistas ----
    DV_DATOS_PANELES.motorizados = {
      icono: '🛵',
      titulo: () => dvTexto('titleDrivers'),
      abrir: () => dvDatosLista({
        entidad: 'motorizados', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titleDrivers'),
        fila: (m) => dvpFila(
          m.nombre || '',
          dvpUnidos([m.tipo_vehiculo, m.placa, m.zona_operacion, m.telefono]),
          m.foto_cedula && m.foto_placa && m.foto_vehiculo
            ? `<span class="badge green">${e(dvTexto('hasId'))}</span>`
            : `<span class="badge red">${e(dvTexto('noId'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'tipo_vehiculo', etiqueta: dvTexto('fVehicle'), tipo: 'opcion',
            opciones: ['Moto', 'Carro', 'Bicicleta', 'Camión', 'Triciclo motorizado'] },
          { id: 'placa', etiqueta: dvTexto('fPlate'), tipo: 'texto' },
          { id: 'zona_operacion', etiqueta: dvTexto('fZone'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
        ],
        // Cuántos trayectos y aportes tiene: lo calcula el servidor como
        // «dependientes» y aquí sirve para saber si el registro está vivo o vacío.
        extras: (m, dep) => (dep && dep.length)
          ? `<p class="meta">${e(dep.map((d) => `${d.cuantos} ${d.etiqueta}`).join(' · '))}</p>`
          : '',
      }),
    };

    // ---- Rescatistas ----
    DV_DATOS_PANELES.rescatistas = {
      icono: '🚑',
      titulo: () => t('admin.manageRescuers'),
      abrir: () => dvDatosLista({
        entidad: 'rescatistas', pk: 'id', etiqueta: 'nombre',
        titulo: t('admin.manageRescuers'),
        fila: (r) => dvpFila(
          r.nombre || '',
          dvpUnidos([r.organizacion, r.especialidad, r.ciudad, r.telefono]),
          r.capacidad_operativa ? `<span class="badge gray">${e(r.capacidad_operativa)}</span>` : ''),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'organizacion', etiqueta: dvTexto('fOrg'), tipo: 'texto' },
          { id: 'especialidad', etiqueta: dvTexto('fSpecialty'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'ciudad', etiqueta: dvTexto('fCity'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'disponibilidad', etiqueta: dvTexto('fAvailability'), tipo: 'texto' },
          { id: 'equipo_disponible', etiqueta: dvTexto('fEquipment'), tipo: 'texto-largo' },
          { id: 'capacidad_operativa', etiqueta: dvTexto('fCapacity'), tipo: 'texto' },
          { id: 'observaciones', etiqueta: dvTexto('fNotes'), tipo: 'texto-largo' },
        ],
      }),
    };

    // ---- Personas buscadas ----
    DV_DATOS_PANELES.personas = {
      icono: '🔎',
      titulo: () => dvTexto('titlePeople'),
      abrir: () => dvDatosLista({
        entidad: 'personas', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titlePeople'),
        fila: (p) => dvpFila(
          p.nombre || '',
          dvpUnidos([p.cedula, p.ubicacion, p.contacto, fechaRelativa(p.fecha)]),
          p.verificada
            ? `<span class="badge green">${e(dvTexto('fVerified'))}</span>`
            : `<span class="badge yellow">${e(t('common.pending'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'cedula', etiqueta: dvTexto('fCedula'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'ubicacion', etiqueta: dvTexto('fLocation'), tipo: 'texto' },
          { id: 'contacto', etiqueta: dvTexto('fContact'), tipo: 'texto' },
          { id: 'fuente', etiqueta: dvTexto('fSource'), tipo: 'texto' },
          { id: 'reportado_por', etiqueta: dvTexto('fReportedBy'), tipo: 'texto' },
          { id: 'verificada', etiqueta: dvTexto('fVerified'), tipo: 'booleano' },
        ],
      }),
    };
```

- [ ] **Step 3: Declarar el archivo en las dos páginas**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
viejo = '<script src="js/admin-datos.js?v=96" defer></script>'
nuevo = ('<script src="js/admin-datos.js?v=96" defer></script>\n'
         '    <script src="js/admin-personas.js?v=96" defer></script>')
for f in ('index.html', 'ventana.html'):
    s = open(f, encoding='utf-8').read()
    assert s.count(viejo) == 1, (f, s.count(viejo))
    open(f, 'w', encoding='utf-8').write(s.replace(viejo, nuevo))
    print('ok', f)
PY
node --check js/admin-personas.js && python3 scripts/verificar-idioma.py
```

Esperado: `ok index.html`, `ok ventana.html`, silencio de `node --check` y `Idioma OK: …`.

- [ ] **Step 4: Comprobar las cuatro pantallas en el navegador**

```bash
cd /root/donaciones-venezuela && python3 -m http.server 8141 --bind 127.0.0.1
```

En `http://127.0.0.1:8141/ventana.html?v=admin&nocache=2`, entrar con la ADMIN_KEY y,
en el grupo «Datos», comprobar **una por una** las cuatro filas nuevas:

- **Voluntarios**: la lista sale, el buscador filtra al escribir, la ficha abre con los
  campos rellenos y el enlace **«Ver documento»** abre la foto de la cédula.
- **Transportistas**: se ven las tres fotos en la ficha (placa, vehículo, cédula).
- **Rescatistas**: la lista sale y la ficha guarda un cambio de ciudad.
- **Personas buscadas**: la casilla «Verificada» se marca y se guarda.

Además, en Voluntarios: pulsar **«Nuevo»**, poner el nombre y el correo de un voluntario
que ya exista, y comprobar que aparece el aviso **«Ya existe algo muy parecido»** con el
botón de abrir el existente.

**La consola del navegador no debe mostrar ningún error.**

```bash
pkill -f "http.server 8141"
```

- [ ] **Step 5: Commit**

```bash
git add js/admin-personas.js index.html ventana.html locales/es.json locales/en.json
git commit -m "feat(admin): pantallas de voluntarios, transportistas, rescatistas y personas

Cada una enseña lo suyo: la cédula subida como distintivo de registro real, la
placa y la zona del transportista, la capacidad del rescatista, el estado de
verificación de la persona buscada."
```

---

## Task 7: Las cuatro pantallas de centros

**Files:**
- Create: `js/admin-centros.js`
- Modify: `index.html`, `ventana.html` (declarar el archivo nuevo)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: de la Tarea 5 — `DV_DATOS_PANELES`, `dvDatosLista(cfg)`, `dvDatosFicha(cfg, id)`,
  `dvTexto(clave, params)`, `dvCentros()`. De la Tarea 6 — `dvpFila(titulo, secundario, badge)`
  y `dvpUnidos(partes)`, que se declaran en `js/admin-personas.js` y aquí solo se usan.
  Globales previas: `e()`, `t()`, `postAdmin()`, `toast()`, `fechaRelativa()`.
- Produces: registra `DV_DATOS_PANELES.lugares`, `.insumos`, `.centros_panel` y
  `.vacantes_voluntarios`. No exporta funciones nuevas.

> **Orden de carga:** `js/admin-centros.js` va **después** de `js/admin-personas.js` en
> el HTML, porque usa `dvpFila` y `dvpUnidos`. Como solo se llaman dentro de callbacks
> (nunca al cargar el archivo), el orden no rompería nada, pero mantenerlo evita
> sorpresas si mañana alguien las usa al inicializar.

- [ ] **Step 1: Añadir las etiquetas de campo a los dos idiomas**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
import json, collections

def add(path, nuevas):
    with open(path, encoding='utf-8') as f:
        d = json.load(f, object_pairs_hook=collections.OrderedDict)
    for k, v in nuevas.items():
        d['datos'][k] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')

add('locales/es.json', {
  "fType": "Tipo", "fAddress": "Dirección de referencia", "fLat": "Latitud", "fLng": "Longitud",
  "fCategory": "Categoría", "fNeeded": "Cantidad necesaria", "fReceived": "Cantidad recibida",
  "fUrgency": "Urgencia", "fUnit": "Unidad", "fCenter": "Centro",
  "fPlaceType": "Tipo de lugar", "fPlaceName": "Nombre del lugar", "fRole": "Rol",
  "fDescription": "Descripción", "fShift": "Turno", "fVacancyState": "Estado de la vacante",
  "titlePlaces": "Centros de acopio", "titleSupplies": "Insumos",
  "titleAccess": "Accesos de centro", "titleVacancies": "Vacantes",
  "managed": "Con panel", "notManaged": "Sin panel",
  "coverage": "{cubierta} de {necesaria}",
  "accessRegen": "Regenerar acceso", "accessRegenDone": "Acceso nuevo generado",
  "accessOf": "Centro #{id}",
  "mapSet": "Punto fijado en {lat}, {lng}",
})

add('locales/en.json', {
  "fType": "Type", "fAddress": "Reference address", "fLat": "Latitude", "fLng": "Longitude",
  "fCategory": "Category", "fNeeded": "Quantity needed", "fReceived": "Quantity received",
  "fUrgency": "Urgency", "fUnit": "Unit", "fCenter": "Centre",
  "fPlaceType": "Place type", "fPlaceName": "Place name", "fRole": "Role",
  "fDescription": "Description", "fShift": "Shift", "fVacancyState": "Vacancy status",
  "titlePlaces": "Collection centres", "titleSupplies": "Supplies",
  "titleAccess": "Centre access", "titleVacancies": "Vacancies",
  "managed": "Has panel", "notManaged": "No panel",
  "coverage": "{cubierta} of {necesaria}",
  "accessRegen": "Regenerate access", "accessRegenDone": "New access generated",
  "accessOf": "Centre #{id}",
  "mapSet": "Point set at {lat}, {lng}",
})
print('ok')
PY
python3 scripts/verificar-idioma.py
```

Esperado: `Idioma OK: …` y salida `0`.

- [ ] **Step 2: Crear `js/admin-centros.js`**

```js
// Consola de datos del admin — pantallas de centros.
// Centros de acopio, sus insumos, sus accesos de panel y las vacantes de voluntariado.
// Usa dvpFila/dvpUnidos de admin-personas.js y la fontanería de admin-datos.js.
'use strict';

    // ---- Centros de acopio ----
    // Un centro arrastra en CASCADE sus insumos y su acceso al panel; el aviso de
    // borrado lo calcula el servidor y lo enseña dvBorrar antes de confirmar.
    let dvcConPanel = null; // Set de lugar_id que ya tienen acceso de panel

    async function dvcCargarPaneles() {
      if (dvcConPanel) return dvcConPanel;
      const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'centros_panel', porPagina: 100 });
      dvcConPanel = new Set((r.filas || []).map((c) => String(c.lugar_id)));
      return dvcConPanel;
    }

    // La configuración de insumos se devuelve desde una función (no una constante)
    // para que t() se evalúe en el idioma actual, y porque se usa desde DOS sitios:
    // su propia pantalla y la lista anidada dentro de la ficha de un centro.
    function dvcCfgInsumos() {
      return {
        entidad: 'insumos', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titleSupplies'),
        fila: (i) => dvpFila(
          i.nombre || '',
          dvpUnidos([i.categoria, i.unidad,
                     dvTexto('coverage', { cubierta: i.cantidad_recibida, necesaria: i.cantidad_necesaria })]),
          `<span class="badge ${i.urgencia === 'Alta' ? 'red' : 'gray'}">${e(String(i.urgencia || ''))}</span>`),
        campos: [
          { id: 'lugar_id', etiqueta: dvTexto('fCenter'), tipo: 'ref' },
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'categoria', etiqueta: dvTexto('fCategory'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'opcion',
            opciones: ['Necesita', 'Disponible', 'Cubierto'] },
          { id: 'cantidad_necesaria', etiqueta: dvTexto('fNeeded'), tipo: 'numero' },
          { id: 'cantidad_recibida', etiqueta: dvTexto('fReceived'), tipo: 'numero' },
          { id: 'urgencia', etiqueta: dvTexto('fUrgency'), tipo: 'opcion',
            opciones: ['Alta', 'Normal', 'Baja'] },
          { id: 'unidad', etiqueta: dvTexto('fUnit'), tipo: 'texto' },
        ],
      };
    }

    function dvcCfgLugares() {
      return {
        entidad: 'lugares', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titlePlaces'),
        fila: (l) => dvpFila(
          l.nombre || '',
          dvpUnidos([l.tipo, l.ubicacion, l.telefono]),
          (dvcConPanel && dvcConPanel.has(String(l.id)))
            ? `<span class="badge green">${e(dvTexto('managed'))}</span>`
            : `<span class="badge gray">${e(dvTexto('notManaged'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'tipo', etiqueta: dvTexto('fType'), tipo: 'opcion',
            opciones: ['Centro', 'Hospital', 'Refugio'] },
          { id: 'ubicacion', etiqueta: dvTexto('fAddress'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'lat', etiqueta: dvTexto('fLat'), tipo: 'coord' },
          { id: 'lng', etiqueta: dvTexto('fLng'), tipo: 'coord' },
        ],
        // El mapa y los insumos anidados son lo que distingue esta ficha de un
        // formulario cualquiera: el centro se ve donde está y qué está pidiendo.
        extras: () => `
          <div id="dvc-mapa" class="of-mapa" style="height:240px"></div>
          <p class="meta" id="dvc-mapa-info"></p>
          <div id="dvc-insumos" class="admin-records"></div>`,
        alPintar: (l, id) => { dvcMapaCentro(l); if (id) dvcInsumosDe(id); },
      };
    }

    DV_DATOS_PANELES.lugares = {
      icono: '🏥',
      titulo: () => dvTexto('titlePlaces'),
      abrir: async () => { await dvcCargarPaneles(); dvDatosLista(dvcCfgLugares()); },
    };

    // Un clic en el mapa clava el punto y rellena los dos recuadros de coordenadas:
    // teclear latitud y longitud a mano es donde más se equivoca cualquiera.
    // Mismo patrón de Leaflet que ya usa el asistente de presupuestos (admin.js).
    function dvcMapaCentro(l) {
      if (!window.L || !$('#dvc-mapa')) return;
      const tienePunto = l.lat != null && l.lng != null;
      const inicio = tienePunto ? [Number(l.lat), Number(l.lng)] : [10.4806, -66.9036];
      const mapa = L.map('dvc-mapa').setView(inicio, tienePunto ? 15 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
      let marcador = tienePunto ? L.marker(inicio).addTo(mapa) : null;
      mapa.on('click', (ev) => {
        const lat = ev.latlng.lat, lng = ev.latlng.lng;
        if (marcador) marcador.setLatLng(ev.latlng); else marcador = L.marker(ev.latlng).addTo(mapa);
        $('#dvc-lat').value = lat.toFixed(6);
        $('#dvc-lng').value = lng.toFixed(6);
        $('#dvc-mapa-info').textContent = dvTexto('mapSet', { lat: lat.toFixed(5), lng: lng.toFixed(5) });
      });
      setTimeout(() => mapa.invalidateSize(), 80);
    }

    // Los insumos del centro, ahí mismo: el admin ve qué pide sin salir de la ficha,
    // y cada uno abre su propia ficha para corregirlo.
    async function dvcInsumosDe(lugarId) {
      const caja = $('#dvc-insumos');
      if (!caja) return;
      let filas = [];
      try {
        const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'insumos', porPagina: 100 });
        filas = (r.filas || []).filter((i) => String(i.lugar_id) === String(lugarId));
      } catch (err) { return; }
      caja.innerHTML = `<h4>${e(dvTexto('titleSupplies'))}</h4>` + (filas.map((i) => `
        <button class="admin-record" type="button" data-ins-id="${e(String(i.id))}">
          <span class="admin-record-main"><strong>${e(i.nombre)}</strong>
            <span class="meta">${e(dvTexto('coverage', { cubierta: i.cantidad_recibida, necesaria: i.cantidad_necesaria }))} ${e(i.unidad || '')}</span></span>
          <span class="admin-record-side"><span class="badge ${i.urgencia === 'Alta' ? 'red' : 'gray'}">${e(String(i.urgencia || ''))}</span></span>
        </button>`).join('') || `<p class="empty-state">${e(dvTexto('empty'))}</p>`);
      $$('#dvc-insumos [data-ins-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(dvcCfgInsumos(), b.dataset.insId)));
    }

    // ---- Insumos ----
    DV_DATOS_PANELES.insumos = {
      icono: '📦',
      titulo: () => dvTexto('titleSupplies'),
      abrir: () => dvDatosLista(dvcCfgInsumos()),
    };

    // ---- Accesos de centro ----
    // Aquí NO se edita la credencial: el token y el PIN no son editables ni siquiera
    // por el admin. Se REGENERAN con la acción que ya existía, o se REVOCAN borrando
    // la fila. Lo único editable es el correo al que se asoció el acceso.
    DV_DATOS_PANELES.centros_panel = {
      icono: '🔑',
      titulo: () => dvTexto('titleAccess'),
      abrir: () => dvDatosLista({
        entidad: 'centros_panel', pk: 'id', etiqueta: 'token_centro',
        titulo: dvTexto('titleAccess'),
        fila: (c) => dvpFila(
          c.token_centro || '',
          dvpUnidos([dvTexto('accessOf', { id: c.lugar_id }), c.email, fechaRelativa(c.creado)]),
          `<span class="badge green">${e(dvTexto('managed'))}</span>`),
        campos: [
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
        ],
        // El botón de regenerar vive en la ficha, junto al acceso que va a cambiar.
        extras: (c) => c.id ? `
          <div class="card-actions">
            <button class="btn btn-soft btn-small" type="button" id="acc-regen"
                    data-lugar="${e(String(c.lugar_id || ''))}">${e(dvTexto('accessRegen'))}</button>
          </div>
          <div id="acc-regen-out"></div>` : '',
        alPintar: async (fila, id) => {
          const boton = $('#acc-regen');
          if (!boton || !id) return;
          boton.addEventListener('click', async () => {
            boton.disabled = true;
            try {
              // admin_regenerar_panel identifica el centro por NOMBRE, no por id.
              const centros = await dvCentros();
              const centro = centros.find((c) => String(c.id) === String(fila.lugar_id));
              if (!centro) throw new Error(dvTexto('empty'));
              const r = await postAdmin({ accion: 'admin_regenerar_panel', nombre: centro.nombre });
              $('#acc-regen-out').innerHTML = `
                <div class="recibo">
                  <div class="recibo-row"><span class="meta">${e(t('access.centerTitle'))}</span>
                    <span class="token-value"><strong>${e(r.token)}</strong></span></div>
                  <div class="recibo-row"><span class="meta">PIN</span>
                    <span class="token-value"><strong>${e(r.pin)}</strong></span></div>
                  <p class="meta">${e(t('admin.tokenHint'))}</p>
                </div>`;
              toast(dvTexto('accessRegenDone'));
            } catch (err) {
              boton.disabled = false;
              mensajeAdmin('#gest-msg', 'error', String((err && err.message) || ''));
            }
          });
        },
      }),
    };

    // ---- Vacantes de voluntariado ----
    DV_DATOS_PANELES.vacantes_voluntarios = {
      icono: '📋',
      titulo: () => dvTexto('titleVacancies'),
      abrir: () => dvDatosLista({
        entidad: 'vacantes_voluntarios', pk: 'id', etiqueta: 'rol',
        titulo: dvTexto('titleVacancies'),
        fila: (v) => dvpFila(
          v.rol || '',
          dvpUnidos([v.lugar_nombre, v.turno,
                     dvTexto('coverage', { cubierta: v.cantidad_cubierta, necesaria: v.cantidad_necesaria })]),
          `<span class="badge ${v.estado === 'Abierta' ? 'green' : 'gray'}">${e(String(v.estado || ''))}</span>`),
        campos: [
          { id: 'rol', etiqueta: dvTexto('fRole'), tipo: 'texto' },
          { id: 'lugar_tipo', etiqueta: dvTexto('fPlaceType'), tipo: 'opcion',
            opciones: ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'] },
          { id: 'lugar_nombre', etiqueta: dvTexto('fPlaceName'), tipo: 'texto' },
          { id: 'ubicacion', etiqueta: dvTexto('fAddress'), tipo: 'texto' },
          { id: 'descripcion', etiqueta: dvTexto('fDescription'), tipo: 'texto-largo' },
          { id: 'cantidad_necesaria', etiqueta: dvTexto('fNeeded'), tipo: 'numero' },
          { id: 'cantidad_cubierta', etiqueta: dvTexto('fReceived'), tipo: 'numero' },
          { id: 'urgencia', etiqueta: dvTexto('fUrgency'), tipo: 'opcion',
            opciones: ['Alta', 'Normal', 'Baja'] },
          { id: 'turno', etiqueta: dvTexto('fShift'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'estado', etiqueta: dvTexto('fVacancyState'), tipo: 'opcion',
            opciones: ['Abierta', 'Cubierta', 'Cerrada'] },
        ],
      }),
    };
```

- [ ] **Step 3: Declarar el archivo en las dos páginas**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
viejo = '<script src="js/admin-personas.js?v=96" defer></script>'
nuevo = ('<script src="js/admin-personas.js?v=96" defer></script>\n'
         '    <script src="js/admin-centros.js?v=96" defer></script>')
for f in ('index.html', 'ventana.html'):
    s = open(f, encoding='utf-8').read()
    assert s.count(viejo) == 1, (f, s.count(viejo))
    open(f, 'w', encoding='utf-8').write(s.replace(viejo, nuevo))
    print('ok', f)
PY
node --check js/admin-centros.js && python3 scripts/verificar-idioma.py
```

Esperado: `ok index.html`, `ok ventana.html`, silencio de `node --check` y `Idioma OK: …`.

- [ ] **Step 4: Comprobar las cuatro pantallas en el navegador**

```bash
cd /root/donaciones-venezuela && python3 -m http.server 8141 --bind 127.0.0.1
```

En `http://127.0.0.1:8141/ventana.html?v=admin&nocache=3`, con la ADMIN_KEY:

- **Centros de acopio**: la lista sale con los 10 centros; abrir uno, cambiar el
  teléfono y guardar; volver a entrar y comprobar que el cambio está.
- **Insumos**: el desplegable **«Centro»** trae los centros por nombre (no ids sueltos);
  la fila muestra «recibido de necesario».
- **Accesos de centro**: sale una fila por centro con panel; el botón
  **«Regenerar acceso»** devuelve un token `CTR-…` y un PIN nuevos.
  ⚠️ Regenerar **invalida el acceso anterior del centro**: hacerlo solo con el centro
  de prueba `DEMO Centro de Acopio (prueba)`, nunca con uno real.
- **Vacantes**: cambiar el estado de una vacante a «Cubierta» y comprobar que se guarda.

**La consola del navegador no debe mostrar ningún error.**

```bash
pkill -f "http.server 8141"
```

- [ ] **Step 5: Commit**

```bash
git add js/admin-centros.js index.html ventana.html locales/es.json locales/en.json
git commit -m "feat(admin): pantallas de centros, insumos, accesos y vacantes

El centro se edita con sus coordenadas; el insumo elige su centro por nombre y
enseña cuánto lleva cubierto; el acceso de panel no se edita (se regenera o se
revoca) y la vacante muestra su cobertura."
```

---

## Task 8: Cierre — versión, prueba completa y despliegue

**Files:**
- Modify: `index.html`, `ventana.html`, `sw.js` (versión PWA 95 → 96)
- Modify: `/root/compartido/credenciales-prueba-donaciones.md` (nota de la consola nueva)
- Modify: `/root/.claude/projects/-root/memory/project-donaciones-venezuela.md` y `MEMORY.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código. Deja la consola desplegada y verificada en producción.

- [ ] **Step 1: Subir la versión PWA de 95 a 96**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
s = open('sw.js').read().replace("const VERSION = '95';", "const VERSION = '96';", 1)
open('sw.js', 'w').write(s)
for f in ('index.html', 'ventana.html'):
    t = open(f).read().replace('v=95', 'v=96')
    open(f, 'w').write(t)
print('listo')
PY
grep -n "VERSION = " sw.js
grep -c "v=95" index.html ventana.html sw.js
grep -o 'js/admin[a-z-]*\.js?v=[0-9]*' index.html
```

Esperado: `const VERSION = '96';`, **cero** ocurrencias de `v=95` en los tres archivos, y
los cuatro `admin*.js` de `index.html` todos en `?v=96`.

- [ ] **Step 2: Comprobar sintaxis e idiomas por última vez**

```bash
cd /root/donaciones-venezuela && for f in js/admin.js js/admin-datos.js js/admin-personas.js js/admin-centros.js sw.js; do
  node --check "$f" && echo "OK  $f" || echo "FALLA $f"
done
python3 scripts/verificar-idioma.py
```

Esperado: `OK` en los cinco y `Idioma OK: …` con salida `0`.

- [ ] **Step 3: Correr la prueba completa del backend**

```bash
cd /root/donaciones-venezuela && ANON="sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
ADMINKEY="<LA_CLAVE_DE_ADMIN_DE_LUIS>" node scripts/verificar-admin-datos.mjs
```

Esperado: las 30 pruebas en ✅ y salida `0`.

- [ ] **Step 4: Comprobar que ninguna acción de datos quedó abierta al público**

La red de seguridad de todo el plan es el prefijo `admin_`. Esto lo verifica de verdad:

```bash
cd /root/donaciones-venezuela && grep -o "case '[a-z_]*datos[a-z_]*'" supabase/functions/api/index.ts | sort -u
```

Esperado: **todas** las líneas empiezan por `case 'admin_datos_`. Si aparece alguna sin
el prefijo `admin_`, esa acción es pública: hay que renombrarla antes de desplegar.

Y contra el servidor ya desplegado, sin clave:

```bash
for a in admin_datos_listar admin_datos_crear admin_datos_editar admin_datos_borrar \
         admin_datos_ficha admin_datos_duplicados admin_datos_deshacer admin_bitacora; do
  printf '%s → ' "$a"
  curl -s -X POST "https://zryfwbjvlacorryzdaod.supabase.co/functions/v1/api" \
    -H "apikey: sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56" \
    -H "Content-Type: application/json" \
    -d "{\"accion\":\"$a\",\"entidad\":\"voluntarios\"}" | head -c 90; echo
done
```

Esperado: las ocho responden `{"success":false,...}` con un error de clave admin.
Ninguna debe devolver datos.

- [ ] **Step 5: Recorrido final en el navegador**

```bash
cd /root/donaciones-venezuela && python3 -m http.server 8141 --bind 127.0.0.1
```

En `http://127.0.0.1:8141/ventana.html?v=admin&nocache=4`, con la ADMIN_KEY, recorrer el
grupo «Datos» entero: las **8 pantallas** abren, el buscador funciona en cada una, y la
**bitácora** muestra los cambios hechos durante las tareas 6 y 7 con su botón de
deshacer. Comprobar además que el resto de la consola (Crear, Gestionar) sigue igual.

**Cero errores en la consola del navegador.**

```bash
pkill -f "http.server 8141"
```

- [ ] **Step 6: Commit y despliegue**

```bash
cd /root/donaciones-venezuela
git add index.html ventana.html sw.js
git commit -m "chore(admin): PWA v95 -> v96 con la consola de datos completa

8 pantallas del Grupo A (centros, insumos, voluntarios, rescatistas,
transportistas, accesos, vacantes y personas) + bitácora con deshacer."
git push origin main
```

Esperado: Vercel despliega en ~1 min.

- [ ] **Step 7: Verificar producción**

```bash
curl -s https://donacionesvenezuela.vercel.app/ventana.html | grep -o "js/admin[a-z-]*\.js?v=[0-9]*"
curl -s https://donacionesvenezuela.vercel.app/sw.js | grep -o "VERSION = '[0-9]*'"
```

Esperado: los cuatro `admin*.js` en `?v=96` y `VERSION = '96'`.

- [ ] **Step 8: Dejar la base sin rastro de las pruebas**

```sql
select (select count(*) from lugares where nombre like 'ZZTEST%')       as lugares_zztest,
       (select count(*) from insumos where nombre like 'ZZTEST%')       as insumos_zztest,
       (select count(*) from voluntarios where nombre like 'ZZTEST%')   as vol_zztest,
       (select count(*) from auditoria_admin
          where antes::text like '%ZZTEST%' or despues::text like '%ZZTEST%') as bitacora_zztest;
```

Esperado: los cuatro en `0`. Si alguno no lo está, repetir la limpieza del paso 6 de la
Tarea 4.

- [ ] **Step 9: Actualizar el archivo de credenciales de prueba**

En `/root/compartido/credenciales-prueba-donaciones.md`, al final de la sección
`### 1. Admin`, añadir tal cual:

```markdown
**Nuevo (2026-07-25) — grupo «Datos» en la consola.** Debajo de «Crear» y «Gestionar»
aparece **«Datos»**, con ocho pantallas para revisar y corregir el padrón: centros de
acopio, insumos, voluntarios, rescatistas, transportistas, accesos de centro, vacantes
y personas buscadas. En cada una puedes buscar, abrir una ficha, corregirla, crear una
nueva y eliminarla.

- **Eliminar exige escribir el nombre del registro**, no un «¿seguro?». Si eliminas un
  centro, antes te dice cuántos insumos se lleva por delante.
- Si creas algo que ya existe (mismo correo, teléfono o cédula), te avisa y te ofrece
  abrir el que ya está. Puedes crearlo igualmente si de verdad son dos personas.
- La fila **«Bitácora de cambios»** guarda todo lo que se ha creado, corregido o
  eliminado, y deja **deshacer** cualquier corrección.
- Las fotos de cédula se **ven** (botón «Ver documento») pero no se pueden sustituir.
```

- [ ] **Step 10: Actualizar la memoria del proyecto**

Añadir al final de `/root/.claude/projects/-root/memory/project-donaciones-venezuela.md`
una entrada `2026-07-25 · CONSOLA DE DATOS DEL ADMIN` con: el registro con lista blanca
como pieza de seguridad central, las 8 acciones `admin_datos_*`, la bitácora con
deshacer, el borrado que exige escribir el nombre, el detector de duplicados por claves
naturales (y el hallazgo de que **voluntarios, motorizados, rescatistas y personas no
tienen ninguna restricción de unicidad**), los 3 archivos JS nuevos, y que el **Plan 2**
(Grupo B + archivado + fusión de lugares) queda pendiente. Actualizar la línea del índice
en `MEMORY.md`.

---

## Verificación final del Plan 1

- [ ] Las 30 pruebas del backend pasan seguidas y la base queda sin datos `ZZTEST`.
- [ ] Las 8 pantallas abren en producción sin errores de consola.
- [ ] Ninguna acción `*datos*` existe sin el prefijo `admin_`.
- [ ] `python3 scripts/verificar-idioma.py` termina en `0`.
- [ ] `index.html`, `ventana.html` y `sw.js` están los tres en la versión **96**.
- [ ] Queda escrito en la memoria que falta el **Plan 2**: Grupo B (11 entidades),
      `archivado_at`, filtrado de las 8 vistas públicas y del RPC `seguimiento_factura`,
      papelera y fusión de lugares.

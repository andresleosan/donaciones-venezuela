-- =====================================================================
-- Esquema base de Donaciones Venezuela
--
-- Reconstruido por introspección del proyecto de producción
-- `zryfwbjvlacorryzdaod` el 2026-07-30, porque el repositorio NO tenía
-- ningún archivo capaz de recrear la base: las 8 migraciones existentes
-- son parches incrementales sobre un esquema que solo vivía dentro de
-- Supabase. Si ese proyecto se hubiera perdido, la estructura de la app
-- se perdía con él.
--
-- Parte 1 de 2: extensiones, tipos, secuencias, tablas y restricciones.
-- Parte 2 (`20260101000001_esquema_vistas.sql`): índices, vistas,
-- funciones, RLS, permisos y buckets.
--
-- Sin datos: aquí no hay ni una fila de producción.
-- =====================================================================

-- --- Extensiones ------------------------------------------------------
-- postgis, pg_trgm, unaccent y pg_net viven en `public` en producción
-- (hallazgo V18 del escaneo de seguridad). Se replica tal cual para que
-- el clon se comporte igual, no para bendecir la decisión.
create schema if not exists extensions;

do $$
begin
  -- postgis RETIRADO el 2026-08-04 (decisión D8): traía public.spatial_ref_sys,
  -- escribible por anon, y la app no la usaba (0 columnas geometry). Si algún día
  -- hace falta: `create extension postgis schema extensions;` — nunca en public.
  -- create extension if not exists postgis with schema public;
exception when others then
  raise notice 'postgis no disponible: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_trgm with schema public;
  create extension if not exists unaccent with schema public;
exception when others then
  raise notice 'pg_trgm/unaccent no disponibles: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net with schema public;
exception when others then
  raise notice 'pg_net no disponible: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists "uuid-ossp" with schema extensions;
exception when others then
  raise notice 'pgcrypto/uuid-ossp no disponibles: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron no disponible (el vigilante de viajes no correra): %', sqlerrm;
end $$;

-- --- Tipos enumerados -------------------------------------------------
-- Ojo: estos tres enums no los usa ninguna tabla de esta app. Vienen de
-- otro proyecto que compartio el mismo proyecto de Supabase. Se replican
-- para que el clon sea fiel; son candidatos a limpieza.
do $$
begin
  create type public.hub_status as enum ('pendiente','aprobado','suspendido');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.need_status as enum ('reportada','verificada','reclamada','en_camino','atendida','cerrada','duplicada','invalida','escalada');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.user_role as enum ('admin','coordinador','hub_miembro');
exception when duplicate_object then null;
end $$;

-- --- Secuencia independiente ------------------------------------------
-- Las otras 14 secuencias las crea `generated always as identity`.
create sequence if not exists public.factura_numero_seq;

-- --- Tablas -----------------------------------------------------------

create table if not exists public.config (
  clave text not null,
  valor text not null
);

create table if not exists public.rate_limit (
  ip text not null,
  ventana timestamp with time zone not null,
  contador integer default 0 not null,
  cubo text default 'publico'::text not null
);

create table if not exists public.lugares (
  id bigint generated always as identity not null,
  tipo text default 'Centro'::text not null,
  nombre text not null,
  ubicacion text default ''::text,
  telefono text default ''::text,
  lat double precision,
  lng double precision,
  actualizado timestamp with time zone default now() not null
);

create table if not exists public.insumos (
  id bigint generated always as identity not null,
  lugar_id bigint not null,
  nombre text not null,
  categoria text default 'General'::text not null,
  estado text default 'Necesita'::text not null,
  cantidad_necesaria numeric default 1 not null,
  cantidad_recibida numeric default 0 not null,
  urgencia text default 'Normal'::text not null,
  unidad text default 'unidades'::text not null,
  actualizado timestamp with time zone default now() not null
);

create table if not exists public.centros_panel (
  id bigint generated always as identity not null,
  lugar_id bigint not null,
  token_centro text not null,
  pin_hash text not null,
  pin_salt text not null,
  creado timestamp with time zone default now() not null,
  email text,
  foto_cedula text,
  foto_sitio text
);

create table if not exists public.voluntarios (
  id text not null,
  nombre text not null,
  apellido text default ''::text,
  telefono text default ''::text,
  estado text default ''::text,
  ciudad text default ''::text,
  profesion text default ''::text,
  disponibilidad text default ''::text,
  medio_transporte text default ''::text,
  observaciones text default ''::text,
  fecha_registro timestamp with time zone default now() not null,
  email text,
  foto_cedula text
);

create table if not exists public.rescatistas (
  id text not null,
  nombre text not null,
  organizacion text default ''::text,
  telefono text default ''::text,
  especialidad text default ''::text,
  estado text default ''::text,
  ciudad text default ''::text,
  disponibilidad text default ''::text,
  equipo_disponible text default ''::text,
  capacidad_operativa text default ''::text,
  observaciones text default ''::text,
  fecha_registro timestamp with time zone default now() not null
);

create table if not exists public.motorizados (
  id text not null,
  nombre text not null,
  tipo_vehiculo text default 'Moto'::text not null,
  telefono text default ''::text,
  zona_operacion text default ''::text,
  placa text default ''::text,
  fecha_registro timestamp with time zone default now() not null,
  foto_placa text default ''::text not null,
  foto_vehiculo text default ''::text not null,
  foto_cedula text default ''::text not null,
  email text
);

create table if not exists public.personas (
  id bigint generated always as identity not null,
  nombre text not null,
  estado text default ''::text,
  ubicacion text default ''::text,
  contacto text default ''::text,
  reportado_por text default ''::text,
  fecha timestamp with time zone default now() not null,
  cedula text default ''::text not null,
  fuente text default ''::text not null,
  verificada boolean default false not null
);

create table if not exists public.vacantes_voluntarios (
  id bigint generated always as identity not null,
  lugar_tipo text default 'Centro'::text not null,
  lugar_nombre text not null,
  ubicacion text default ''::text not null,
  rol text not null,
  descripcion text default ''::text not null,
  cantidad_necesaria numeric default 1 not null,
  cantidad_cubierta numeric default 0 not null,
  urgencia text default 'Normal'::text not null,
  turno text default ''::text not null,
  telefono text default ''::text not null,
  estado text default 'Abierta'::text not null,
  fecha_creacion timestamp with time zone default now() not null,
  actualizado timestamp with time zone default now() not null
);

create table if not exists public.facturas (
  id bigint generated always as identity not null,
  numero_factura text not null,
  token_publico text not null,
  objetivo text not null,
  descripcion text default ''::text,
  monto_requerido numeric default 0 not null,
  monto_recaudado numeric default 0 not null,
  estado text default 'Abierta'::text not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_cierre timestamp with time zone,
  archivado_at timestamp with time zone
);

create table if not exists public.donaciones (
  id bigint generated always as identity not null,
  factura_id bigint not null,
  nombre_donante text default 'Anónimo'::text,
  monto numeric default 0 not null,
  referencia_pago text default ''::text,
  fecha timestamp with time zone default now() not null,
  estado text default 'Registrada'::text not null,
  monto_usd numeric,
  tasa numeric,
  comprobante text default ''::text not null,
  archivado_at timestamp with time zone
);

create table if not exists public.movimientos_factura (
  id bigint generated always as identity not null,
  factura_id bigint not null,
  tipo text default 'Ingreso'::text not null,
  descripcion text default ''::text,
  monto numeric default 0 not null,
  fecha timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.evidencias (
  id bigint generated always as identity not null,
  factura_id bigint not null,
  archivo text default ''::text,
  descripcion text default ''::text,
  publica boolean default true not null,
  fecha timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.viajes (
  id uuid default gen_random_uuid() not null,
  factura_id bigint not null,
  transportista text not null,
  email text,
  eta_minutos integer not null,
  paso1_ts timestamp with time zone,
  paso1_lat double precision,
  paso1_lng double precision,
  paso2_ts timestamp with time zone,
  paso2_lat double precision,
  paso2_lng double precision,
  paso3_ts timestamp with time zone,
  paso3_lat double precision,
  paso3_lng double precision,
  km_tramo1 numeric(7,1),
  km_tramo2 numeric(7,1),
  alertado_at timestamp with time zone,
  resuelto boolean default false not null,
  creado_at timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.trayectos (
  id bigint generated always as identity not null,
  motorizado_id text,
  nombre_motorizado text default ''::text,
  origen text not null,
  destino text not null,
  km numeric default 0,
  insumo text default 'Varios'::text,
  fecha timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.entregas (
  id text not null,
  motorizado_id text not null,
  motorizado_nombre text default ''::text not null,
  lugar text not null,
  insumo text default ''::text not null,
  receptor_nombre text not null,
  foto_receptor text not null,
  foto_entrega text default ''::text not null,
  fecha timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.donaciones_motorizados (
  id bigint generated always as identity not null,
  motorizado_id text,
  nombre_motorizado text default ''::text,
  monto numeric default 0 not null,
  tipo text default ''::text,
  donante text default 'Anónimo'::text,
  ciudad text default ''::text,
  fecha timestamp with time zone default now() not null,
  archivado_at timestamp with time zone
);

create table if not exists public.historial_movimientos (
  id bigint generated always as identity not null,
  lugar text not null,
  insumo text default ''::text,
  cantidad numeric default 0,
  descripcion text default ''::text,
  fecha timestamp with time zone default now() not null,
  origen text default 'publico'::text not null,
  archivado_at timestamp with time zone
);

create table if not exists public.familias_damnificadas (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  created_at timestamp with time zone default now() not null,
  estado text default 'nuevo'::text not null,
  responsable_nombre text default ''::text not null,
  responsable_telefono text default ''::text not null,
  responsable_email text default ''::text not null,
  alojamiento text default ''::text not null,
  municipio text default ''::text not null,
  estado_geo text default ''::text not null,
  gps_lat double precision,
  gps_lng double precision,
  num_personas integer default 0 not null,
  num_menores integer default 0 not null,
  integrantes jsonb default '[]'::jsonb not null,
  fallecidos integer default 0 not null,
  fallecidos_detalle text default ''::text not null,
  perdio_casa boolean default true not null,
  perdio_vehiculo boolean default false not null,
  vehiculos_detalle text default ''::text not null,
  sustento_principal text default ''::text not null,
  bienes_perdidos text default ''::text not null,
  fotos jsonb default '[]'::jsonb not null,
  notas text default ''::text not null,
  archivado_at timestamp with time zone,
  insumos_necesarios text default ''::text not null
);

create table if not exists public.denuncias (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  email text not null,
  nombre text,
  rol text,
  tipo text default 'Otro'::text not null,
  gps_lat double precision,
  gps_lng double precision,
  gps_precision real,
  video_path text,
  duracion_s integer,
  texto text,
  factura_token text,
  origen text default 'usuario'::text not null,
  estado text default 'Recibida'::text not null,
  archivado_at timestamp with time zone
);

create table if not exists public.tasas (
  id bigint generated always as identity not null,
  fuente text not null,
  efectiva numeric not null,
  diaria numeric,
  capturado_en timestamp with time zone default now() not null
);

create table if not exists public.auditoria_admin (
  id bigint generated always as identity not null,
  fecha timestamp with time zone default now() not null,
  ip text default ''::text not null,
  accion text not null,
  entidad text not null,
  fila_id text default ''::text not null,
  antes jsonb,
  despues jsonb
);

-- --- Claves primarias -------------------------------------------------
alter table public.auditoria_admin       add constraint auditoria_admin_pkey        primary key (id);
alter table public.centros_panel         add constraint centros_panel_pkey          primary key (id);
alter table public.config                add constraint config_pkey                 primary key (clave);
alter table public.denuncias             add constraint denuncias_pkey              primary key (id);
alter table public.donaciones            add constraint donaciones_pkey             primary key (id);
alter table public.donaciones_motorizados add constraint donaciones_motorizados_pkey primary key (id);
alter table public.entregas              add constraint entregas_pkey               primary key (id);
alter table public.evidencias            add constraint evidencias_pkey             primary key (id);
alter table public.facturas              add constraint facturas_pkey               primary key (id);
alter table public.familias_damnificadas add constraint familias_damnificadas_pkey  primary key (id);
alter table public.historial_movimientos add constraint historial_movimientos_pkey  primary key (id);
alter table public.insumos               add constraint insumos_pkey                primary key (id);
alter table public.lugares               add constraint lugares_pkey                primary key (id);
alter table public.motorizados           add constraint motorizados_pkey            primary key (id);
alter table public.movimientos_factura   add constraint movimientos_factura_pkey    primary key (id);
alter table public.personas              add constraint personas_pkey               primary key (id);
alter table public.rate_limit            add constraint rate_limit_pkey             primary key (ip, cubo, ventana);
alter table public.rescatistas           add constraint rescatistas_pkey            primary key (id);
alter table public.tasas                 add constraint tasas_pkey                  primary key (id);
alter table public.trayectos             add constraint trayectos_pkey              primary key (id);
alter table public.vacantes_voluntarios  add constraint vacantes_voluntarios_pkey   primary key (id);
alter table public.viajes                add constraint viajes_pkey                 primary key (id);
alter table public.voluntarios           add constraint voluntarios_pkey            primary key (id);

-- --- Claves únicas ----------------------------------------------------
alter table public.centros_panel         add constraint centros_panel_lugar_id_key      unique (lugar_id);
alter table public.centros_panel         add constraint centros_panel_token_centro_key  unique (token_centro);
alter table public.facturas              add constraint facturas_numero_factura_key     unique (numero_factura);
alter table public.facturas              add constraint facturas_token_publico_key      unique (token_publico);
alter table public.familias_damnificadas add constraint familias_damnificadas_codigo_key unique (codigo);
alter table public.insumos               add constraint insumos_lugar_id_nombre_key     unique (lugar_id, nombre);
alter table public.lugares               add constraint lugares_nombre_key              unique (nombre);

-- --- Comprobaciones ---------------------------------------------------
alter table public.insumos add constraint insumos_estado_check
  check ((estado = any (array['Necesita'::text, 'Disponible'::text, 'Cubierto'::text])));

alter table public.vacantes_voluntarios add constraint vacantes_voluntarios_cantidad_cubierta_check
  check ((cantidad_cubierta >= (0)::numeric));
alter table public.vacantes_voluntarios add constraint vacantes_voluntarios_cantidad_necesaria_check
  check ((cantidad_necesaria > (0)::numeric));
alter table public.vacantes_voluntarios add constraint vacantes_voluntarios_estado_check
  check ((estado = any (array['Abierta'::text, 'Cubierta'::text, 'Cerrada'::text])));
alter table public.vacantes_voluntarios add constraint vacantes_voluntarios_lugar_tipo_check
  check ((lugar_tipo = any (array['Centro'::text, 'Hospital'::text, 'Refugio'::text, 'Zona de derrumbe'::text])));
alter table public.vacantes_voluntarios add constraint vacantes_voluntarios_urgencia_check
  check ((urgencia = any (array['Alta'::text, 'Normal'::text, 'Baja'::text])));

-- --- Claves ajenas ----------------------------------------------------
alter table public.centros_panel add constraint centros_panel_lugar_id_fkey
  foreign key (lugar_id) references public.lugares(id) on delete cascade;
alter table public.donaciones add constraint donaciones_factura_id_fkey
  foreign key (factura_id) references public.facturas(id) on delete cascade;
alter table public.donaciones_motorizados add constraint donaciones_motorizados_motorizado_id_fkey
  foreign key (motorizado_id) references public.motorizados(id) on delete set null;
alter table public.evidencias add constraint evidencias_factura_id_fkey
  foreign key (factura_id) references public.facturas(id) on delete cascade;
alter table public.insumos add constraint insumos_lugar_id_fkey
  foreign key (lugar_id) references public.lugares(id) on delete cascade;
alter table public.movimientos_factura add constraint movimientos_factura_factura_id_fkey
  foreign key (factura_id) references public.facturas(id) on delete cascade;
alter table public.trayectos add constraint trayectos_motorizado_id_fkey
  foreign key (motorizado_id) references public.motorizados(id) on delete set null;

-- NO ACTION deliberado: Postgres impide borrar una factura mientras tenga
-- viajes. Por eso el Grupo B se archiva en vez de borrarse.
alter table public.viajes add constraint viajes_factura_id_fkey
  foreign key (factura_id) references public.facturas(id);

-- =====================================================================
-- Esquema base de Donaciones Venezuela · Parte 2 de 2
--
-- Funciones, indices, vistas, disparador, RLS, permisos y buckets.
-- Reconstruido por introspeccion de `zryfwbjvlacorryzdaod` el 2026-07-30.
--
-- ORDEN OBLIGATORIO: las funciones van primero porque
--   - `insumos_norm_nombre_idx` depende de norm_insumo()
--   - `lugares_directorio`      depende de norm_insumo()
--   - `familias_public`         depende de es_condicion_real()
--   - `traslados_sugeridos`     depende de unaccent()
--   - el disparador de donaciones depende de recalcular_recaudado()
--
-- FIDELIDAD, NO IDEAL: este archivo replica produccion tal como esta,
-- incluidos sus defectos, para que el agente diagnostique la realidad.
-- En particular `rescatistas_public` queda legible por `anon` igual que
-- en produccion, aunque la migracion 20260712 diga lo contrario: se
-- comprobo el 2026-07-30 que esa revocacion nunca se aplico.
--
-- LO QUE NO ESTA AQUI, a proposito:
--   - Datos. Ni una fila de produccion. La semilla va aparte.
--   - Secretos. La tabla `config` se crea vacia; el clon genera su
--     propia ADMIN_KEY y sus propias llaves.
--   - Trabajos de pg_cron (el vigilante de viajes). No se capturaron;
--     no hacen falta para evaluar la app y se anotan como pendiente.
-- =====================================================================

-- --- Funciones --------------------------------------------------------

-- Dos argumentos en unaccent() a proposito: es la forma que fija el
-- diccionario y permite marcar la funcion IMMUTABLE, requisito para
-- poder indexarla.
create or replace function public.norm_insumo(t text)
 returns text
 language sql
 immutable parallel safe
as $function$
  select lower(public.unaccent('public.unaccent', trim(coalesce(t, ''))));
$function$;

-- Filtra las respuestas basura del campo de condicion medica para que
-- "Ninguna" no cuente como necesidad medica ni se publique.
create or replace function public.es_condicion_real(txt text)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(txt, '') <> ''
     and lower(unaccent(trim(txt))) not in
         ('ninguna', 'ninguno', 'nada', 'no', 'n/a', 'na', '-', '--', 'none', 'sin condicion',
          'sin condiciones', 'sin condicion medica', 'ninguna condicion', 'nignuna');
$function$;

create or replace function public.buscar_familiar(q text)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(json_agg(json_build_object(
    'nombre', p.nombre, 'cedula', p.cedula, 'estado', p.estado,
    'ubicacion', p.ubicacion, 'fuente', p.fuente, 'actualizado', p.fecha,
    'verificada', p.verificada)), '[]'::json)
  from (select * from personas
        where length(trim(q)) >= 3
          and (nombre ilike '%' || trim(q) || '%' or cedula = trim(q))
        order by fecha desc limit 25) p;
$function$;

create or replace function public.estadisticas()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'centrosRegistrados', (select count(*) from lugares where tipo <> 'Hospital'),
    'hospitalesRegistrados', (select count(*) from lugares where tipo = 'Hospital'),
    'voluntariosActivos', (select count(*) from voluntarios),
    'rescatistasRegistrados', (select count(*) from rescatistas),
    'motorizadosRegistrados', (select count(*) from motorizados),
    'personasLocalizadas', (select count(*) from personas where estado ilike 'localiz%' or estado ilike 'hospital%'),
    'personasReportadas', (select count(*) from personas),
    'donacionesRegistradas', (select count(*) from donaciones) + (select count(*) from donaciones_motorizados),
    'facturasAbiertas', (select count(*) from facturas where estado = 'Abierta'),
    'montoRecaudadoTotal', (select coalesce(sum(monto_recaudado), 0) from facturas),
    'actualizado', (select max(actualizado) from lugares)
  );
$function$;

create or replace function public.factura_numero_siguiente()
 returns bigint
 language sql
 security definer
 set search_path to 'public'
as $function$
  select nextval('factura_numero_seq');
$function$;

-- OJO: esta version de dos argumentos esta ROTA. Su `on conflict
-- (ip, ventana)` no corresponde a ninguna clave unica desde que la clave
-- primaria de rate_limit paso a ser (ip, cubo, ventana). Se replica
-- porque existe en produccion; nadie deberia llamarla. La buena es la de
-- cuatro argumentos, que es la que usa la edge function.
create or replace function public.rate_hit(p_ip text, p_ventana timestamp with time zone)
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into rate_limit (ip, ventana, contador) values (p_ip, p_ventana, 1)
  on conflict (ip, ventana) do update set contador = rate_limit.contador + 1
  returning contador;
$function$;

create or replace function public.rate_hit(p_ip text, p_ventana timestamp with time zone, p_cubo text, p_limite integer)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into rate_limit (ip, cubo, ventana, contador) values (p_ip, p_cubo, p_ventana, 1)
  on conflict (ip, cubo, ventana) do update set contador = rate_limit.contador + 1
  returning contador <= p_limite;
$function$;

create or replace function public.recalcular_recaudado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare fid bigint;
begin
  fid := coalesce(new.factura_id, old.factura_id);
  update facturas set monto_recaudado = coalesce(
    (select sum(monto) from donaciones where factura_id = fid and estado = 'Confirmada'), 0)
  where id = fid;
  return coalesce(new, old);
end;
$function$;

create or replace function public.seguimiento_donaciones(p_token text)
 returns table(monto_usd numeric, monto numeric, tasa numeric, creado timestamp with time zone)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select d.monto_usd, d.monto, d.tasa, d.fecha
  from public.donaciones d
  join public.facturas f on f.id = d.factura_id
  where f.token_publico = p_token and d.estado = 'Confirmada'
    and d.archivado_at is null and f.archivado_at is null
  order by d.fecha desc
  limit 200
$function$;

create or replace function public.seguimiento_factura(tok text)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when f.id is null then null else json_build_object(
    'factura', json_build_object(
      'numero_factura', f.numero_factura, 'objetivo', f.objetivo, 'descripcion', f.descripcion,
      'monto_requerido', f.monto_requerido, 'monto_recaudado', f.monto_recaudado,
      'porcentaje', case when f.monto_requerido > 0 then round(100 * f.monto_recaudado / f.monto_requerido) else 0 end,
      'estado', f.estado, 'fecha_creacion', f.fecha_creacion, 'fecha_cierre', f.fecha_cierre),
    'movimientos', coalesce((select json_agg(json_build_object(
        'tipo', m.tipo, 'descripcion', m.descripcion, 'monto', m.monto, 'fecha', m.fecha)
        order by m.fecha) from movimientos_factura m
        where m.factura_id = f.id and m.archivado_at is null), '[]'::json),
    'evidencias', coalesce((select json_agg(json_build_object(
        'archivo', e.archivo, 'descripcion', e.descripcion, 'fecha', e.fecha)
        order by e.fecha) from evidencias e
        where e.factura_id = f.id and e.publica and e.archivado_at is null), '[]'::json)
  ) end
  from (select * from facturas where token_publico = trim(tok) and archivado_at is null) f;
$function$;

-- --- Disparador -------------------------------------------------------
drop trigger if exists trg_recalcular_recaudado on public.donaciones;
create trigger trg_recalcular_recaudado
  after insert or delete or update on public.donaciones
  for each row execute function public.recalcular_recaudado();

-- --- Indices ----------------------------------------------------------
create index if not exists auditoria_admin_fecha_idx on public.auditoria_admin using btree (fecha desc);
create index if not exists auditoria_admin_fila_idx on public.auditoria_admin using btree (entidad, fila_id);
create index if not exists centros_panel_email_idx on public.centros_panel using btree (email);
create index if not exists denuncias_archivado_idx on public.denuncias using btree (archivado_at) where (archivado_at is not null);
create index if not exists denuncias_created on public.denuncias using btree (created_at desc);
create index if not exists facturas_archivado_idx on public.facturas using btree (archivado_at) where (archivado_at is not null);
create index if not exists familias_damnificadas_estado_idx on public.familias_damnificadas using btree (estado, created_at desc);
create index if not exists insumos_estado_idx on public.insumos using btree (estado);
create index if not exists insumos_norm_nombre_idx on public.insumos using btree (public.norm_insumo(nombre));
create index if not exists motorizados_email_idx on public.motorizados using btree (email);
create index if not exists tasas_capturado_idx on public.tasas using btree (capturado_en desc);
create index if not exists viajes_factura on public.viajes using btree (factura_id);
create index if not exists viajes_vigente on public.viajes using btree (factura_id, paso3_ts);
create index if not exists voluntarios_email_idx on public.voluntarios using btree (email);

-- --- Vistas -----------------------------------------------------------

create or replace view public.lugares_directorio as
 select tipo, nombre, ubicacion, telefono, lat, lng, actualizado,
    (exists ( select 1 from centros_panel cp where cp.lugar_id = l.id)) as gestionado,
    coalesce(( select json_agg(json_build_object('nombre', i.nombre, 'categoria', i.categoria, 'estado', i.estado, 'cantidadNecesaria', i.cantidad_necesaria, 'cantidadRecibida', i.cantidad_recibida, 'porcentaje',
                case
                    when i.cantidad_necesaria > 0::numeric then round(100::numeric * i.cantidad_recibida / i.cantidad_necesaria)
                    else 0::numeric
                end, 'urgencia', i.urgencia, 'unidad', i.unidad, 'yaCubierto', i.cantidad_necesaria > 0::numeric and i.cantidad_recibida >= i.cantidad_necesaria, 'coincidencias', coalesce(( select json_agg(json_build_object('nombre_lugar', l2.nombre, 'tipo', l2.tipo, 'ubicacion', l2.ubicacion, 'telefono', l2.telefono)) as json_agg
                   from insumos i2
                     join lugares l2 on l2.id = i2.lugar_id
                  where i2.estado = 'Disponible'::text and i2.lugar_id <> l.id and norm_insumo(i2.nombre) = norm_insumo(i.nombre)), '[]'::json)) order by (i.urgencia = 'Alta'::text) desc, i.nombre) as json_agg
           from insumos i
          where i.lugar_id = l.id and i.estado = 'Necesita'::text), '[]'::json) as necesita,
    coalesce(( select json_agg(json_build_object('nombre', i.nombre, 'categoria', i.categoria)) as json_agg
           from insumos i
          where i.lugar_id = l.id and i.estado = 'Cubierto'::text), '[]'::json) as cubiertos,
    coalesce(( select json_agg(json_build_object('nombre', i.nombre, 'categoria', i.categoria)) as json_agg
           from insumos i
          where i.lugar_id = l.id and i.estado = 'Disponible'::text), '[]'::json) as tiene_disponible
   from lugares l;

create or replace view public.traslados_sugeridos as
 select d.nombre as insumo, d.categoria, n.urgencia,
    lo.nombre as origen, lo.ubicacion as origen_ubicacion, lo.lat as origen_lat, lo.lng as origen_lng,
    ln.nombre as destino, ln.ubicacion as destino_ubicacion, ln.lat as destino_lat, ln.lng as destino_lng,
    ln.tipo as destino_tipo,
    greatest(d.actualizado, n.actualizado) as actualizado
   from insumos d
     join insumos n on d.lugar_id <> n.lugar_id and lower(unaccent(d.nombre)) = lower(unaccent(n.nombre))
     join lugares lo on lo.id = d.lugar_id
     join lugares ln on ln.id = n.lugar_id
  where d.estado = 'Disponible'::text and n.estado = 'Necesita'::text;

create or replace view public.facturas_public as
 select id, numero_factura, objetivo, descripcion, monto_requerido, monto_recaudado,
    estado, fecha_creacion, fecha_cierre
   from facturas
  where archivado_at is null;

create or replace view public.historial_public as
 select id, lugar, insumo, cantidad, descripcion, origen, fecha
   from historial_movimientos
  where archivado_at is null;

create or replace view public.entregas_public as
 select id, motorizado_id, motorizado_nombre, lugar, insumo, fecha
   from entregas
  where archivado_at is null
  order by fecha desc;

create or replace view public.trayectos_public as
 select id, motorizado_id, nombre_motorizado, origen, destino, km, insumo, fecha
   from trayectos
  where archivado_at is null;

create or replace view public.donaciones_motorizados_public as
 select id, motorizado_id, nombre_motorizado, monto, tipo, donante, ciudad, fecha
   from donaciones_motorizados
  where archivado_at is null;

create or replace view public.denuncias_public as
 select id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado
   from denuncias
  where archivado_at is null;

create or replace view public.motorizados_public as
 select id, nombre, tipo_vehiculo, telefono, zona_operacion, placa, fecha_registro
   from motorizados;

-- Sin telefono: se movio a la accion admin_listar_voluntarios (arreglo S2).
create or replace view public.voluntarios_public
  with (security_invoker = off) as
 select id, nombre, apellido, estado, ciudad, profesion, disponibilidad,
    medio_transporte, observaciones, fecha_registro
   from voluntarios;

-- Replicada tal cual: en produccion SI expone telefono y SI es legible
-- por anon, pese a la migracion 20260712 que dice revocarla.
create or replace view public.rescatistas_public as
 select id, nombre, organizacion, telefono, especialidad, estado, ciudad,
    disponibilidad, equipo_disponible, capacidad_operativa, observaciones, fecha_registro
   from rescatistas;

create or replace view public.vacantes_public
  with (security_invoker = false) as
 select id, lugar_tipo, lugar_nombre, ubicacion, rol, descripcion,
    cantidad_necesaria, cantidad_cubierta,
    greatest(0::numeric, cantidad_necesaria - cantidad_cubierta) as cupos_faltantes,
    urgencia, turno, telefono, estado, fecha_creacion, actualizado
   from vacantes_voluntarios
  where estado = 'Abierta'::text;

create or replace view public.familias_public as
 select codigo, municipio, estado_geo, num_personas, num_menores,
    perdio_casa, perdio_vehiculo,
    fallecidos > 0 as perdio_familiar,
    (exists ( select 1
           from jsonb_array_elements(coalesce(f.integrantes, '[]'::jsonb)) m(value)
          where es_condicion_real(m.value ->> 'condicion_medica'::text))) as necesidad_medica,
    estado, created_at, insumos_necesarios,
    coalesce(( select json_agg(x.edad order by x.edad desc) as json_agg
           from ( select (m.value ->> 'edad'::text)::integer as edad
                   from jsonb_array_elements(coalesce(f.integrantes, '[]'::jsonb)) m(value)
                  where coalesce(m.value ->> 'edad'::text, ''::text) ~ '^[0-9]+$'::text) x), '[]'::json) as edades,
    coalesce(( select json_agg(x.cond) as json_agg
           from ( select trim(both from m.value ->> 'condicion_medica'::text) as cond
                   from jsonb_array_elements(coalesce(f.integrantes, '[]'::jsonb)) m(value)
                  where es_condicion_real(m.value ->> 'condicion_medica'::text)) x), '[]'::json) as condiciones
   from familias_damnificadas f
  where archivado_at is null;

-- Umbral calculado al leer: tramo 1 = ETA + 120 min, tramo 2 = 2 h sin entregar.
create or replace view public.viajes_atrasados as
 select v.id, v.factura_id, v.transportista, v.email, v.eta_minutos,
    v.paso1_ts, v.paso2_ts, f.token_publico, f.objetivo,
        case
            when v.paso2_ts is null then 1
            else 2
        end as tramo,
    floor(extract(epoch from now() - coalesce(v.paso2_ts, v.paso1_ts)) / 60::numeric)::integer as transcurrido_min
   from viajes v
     join facturas f on f.id = v.factura_id
  where v.resuelto = false and v.paso3_ts is null and v.archivado_at is null and f.archivado_at is null
    and (v.paso2_ts is null and now() > (v.paso1_ts + make_interval(mins => v.eta_minutos + 120))
      or v.paso2_ts is not null and now() > (v.paso2_ts + '02:00:00'::interval));

-- --- RLS: activada sin politicas = deniega por defecto ----------------
-- Es la defensa central de la app: las escrituras solo pasan por la edge
-- function con service_role. Los permisos de abajo son amplios (el
-- `grant all` por defecto de Supabase) y solo son inocuos por esto.
alter table public.auditoria_admin       enable row level security;
alter table public.centros_panel         enable row level security;
alter table public.config                enable row level security;
alter table public.denuncias             enable row level security;
alter table public.donaciones            enable row level security;
alter table public.donaciones_motorizados enable row level security;
alter table public.entregas              enable row level security;
alter table public.evidencias            enable row level security;
alter table public.facturas              enable row level security;
alter table public.familias_damnificadas enable row level security;
alter table public.historial_movimientos enable row level security;
alter table public.insumos               enable row level security;
alter table public.lugares               enable row level security;
alter table public.motorizados           enable row level security;
alter table public.movimientos_factura   enable row level security;
alter table public.personas              enable row level security;
alter table public.rate_limit            enable row level security;
alter table public.rescatistas           enable row level security;
alter table public.tasas                 enable row level security;
alter table public.trayectos             enable row level security;
alter table public.vacantes_voluntarios  enable row level security;
alter table public.viajes                enable row level security;
alter table public.voluntarios           enable row level security;

-- --- Permisos ---------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Y ahora las revocaciones que SI estan vivas en produccion.
revoke all on table public.auditoria_admin       from anon, authenticated;
revoke all on table public.familias_damnificadas from anon, authenticated;
revoke all on table public.tasas                 from anon, authenticated;
revoke all on table public.viajes_atrasados      from anon, authenticated;

-- --- Buckets de almacenamiento ----------------------------------------
-- `presupuestos` es publico a proposito: el donante tiene que poder ver
-- la proforma que justifica su donacion. Los otros cuatro son privados y
-- se sirven por URL firmada.
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false),
       ('damnificados', 'damnificados', false),
       ('denuncias', 'denuncias', false),
       ('presupuestos', 'presupuestos', true),
       ('registro-transportistas', 'registro-transportistas', false)
on conflict (id) do update set public = excluded.public;

-- Plan 01 — Denuncias con video. Tabla propia (otra vida, otra visibilidad que
-- facturas). El público ve solo video+fecha+hora+coords+estado; identidad/rol/
-- texto/GPS-precisión son solo-admin. RLS sin políticas => solo la edge function
-- (service role) escribe y lee todo; el público pasa por la vista denuncias_public.

create table if not exists public.denuncias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,                       -- solo admin
  nombre text,                               -- solo admin
  rol text,                                  -- solo admin: transportista|voluntario|centro|donante
  tipo text not null default 'Otro',         -- canónico es: 'Retención de insumos' | 'Otro'
  gps_lat double precision, gps_lng double precision, gps_precision real,
  video_path text, duracion_s int,
  texto text,                                -- opcional «¿qué pasó?»
  factura_token text,                        -- si el denunciante iba en tránsito (plan 07)
  origen text not null default 'usuario',    -- 'usuario' | 'admin' (plan 07 T5)
  estado text not null default 'Recibida'    -- 'Recibida' | 'En revisión' | 'Atendida'
);

alter table public.denuncias enable row level security; -- sin policies: solo service role

create index if not exists denuncias_created on public.denuncias (created_at desc);

-- Vista pública: JAMÁS email/nombre/rol/texto/precisión ni factura_token.
create or replace view public.denuncias_public as
  select id, created_at, tipo, gps_lat, gps_lng, video_path, duracion_s, estado
  from public.denuncias;

-- Bucket PRIVADO: el público VE el video por URL firmada de 1 h que entrega la
-- edge fn; nadie puede LISTAR ni enlazar permanente.
insert into storage.buckets (id, name, public)
values ('denuncias', 'denuncias', false)
on conflict (id) do nothing;

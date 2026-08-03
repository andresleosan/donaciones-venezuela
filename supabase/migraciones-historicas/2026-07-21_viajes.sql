-- Viajes del transportista sobre un insumo comprado (plan 06, paso 1→3).
-- Cada fila es un INTENTO de viaje: una factura puede tener varios; el vigente
-- es el último sin paso3_ts. Los pasos 2 y 3 (y los km) los rellenan 6.2/6.3.
create table if not exists public.viajes (
  id uuid primary key default gen_random_uuid(),
  factura_id bigint not null references public.facturas(id),
  transportista text not null,
  email text,
  eta_minutos int not null,
  paso1_ts timestamptz, paso1_lat double precision, paso1_lng double precision,
  paso2_ts timestamptz, paso2_lat double precision, paso2_lng double precision,
  paso3_ts timestamptz, paso3_lat double precision, paso3_lng double precision,
  km_tramo1 numeric(7,1), km_tramo2 numeric(7,1),
  alertado_at timestamptz,               -- lo usa el plan 07 (vigilancia)
  resuelto boolean not null default false,
  creado_at timestamptz not null default now()
);

create index if not exists viajes_factura on public.viajes(factura_id);
-- El viaje vigente de una factura = el último sin paso3_ts.
create index if not exists viajes_vigente on public.viajes(factura_id, paso3_ts);

-- Solo la edge function (service role) toca esta tabla: RLS habilitada y SIN
-- políticas, así que anon/authenticated no pueden leer ni escribir.
alter table public.viajes enable row level security;

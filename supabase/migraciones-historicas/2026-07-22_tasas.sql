-- Tasa de cambio USD→Bs para la donación en dinero a presupuestos.
-- El bot nocturno (acción cron_tasa) inserta una fila; el resto se lee por
-- service-role desde la edge function. El navegador nunca la lee directo.
create table if not exists public.tasas (
  id bigint generated always as identity primary key,
  fuente text not null,                 -- 'remitly' | 'bcv'
  efectiva numeric not null,            -- Bs por 1 USD (lo que el donante ve)
  diaria numeric,                       -- tasa estándar/everyday (referencia)
  capturado_en timestamptz not null default now()
);
alter table public.tasas enable row level security;
revoke all on public.tasas from anon, authenticated;
create index if not exists tasas_capturado_idx on public.tasas (capturado_en desc);

-- La donación conserva el USD original y la tasa usada (auditoría + recibo).
alter table public.donaciones add column if not exists monto_usd numeric;
alter table public.donaciones add column if not exists tasa numeric;

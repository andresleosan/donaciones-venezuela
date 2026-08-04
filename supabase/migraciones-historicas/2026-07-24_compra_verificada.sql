-- Compra verificada de presupuestos.
-- Comprobante de transferencia del donante (ruta en bucket PRIVADO).
alter table public.donaciones add column if not exists comprobante text not null default '';

-- Bucket PRIVADO para los comprobantes de los donantes (solo el admin, URL firmada).
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- Llaves de Telegram (vacías: el notificador queda apagado hasta configurarlas).
insert into public.config (clave, valor) values
  ('telegram_bot_token', ''), ('telegram_chat_id', '')
on conflict (clave) do nothing;

-- Desglose ANÓNIMO de donaciones para el seguimiento público: monto + fecha,
-- SIN nombre, referencia ni comprobante. SECURITY DEFINER para saltar RLS y
-- exponer solo estas columnas seguras.
create or replace function public.seguimiento_donaciones(p_token text)
returns table (monto_usd numeric, monto numeric, tasa numeric, creado timestamptz)
language sql security definer set search_path = public as $$
  select d.monto_usd, d.monto, d.tasa, d.fecha
  from public.donaciones d
  join public.facturas f on f.id = d.factura_id
  where f.token_publico = p_token and d.estado = 'Confirmada'
  order by d.fecha desc
  limit 200
$$;
revoke all on function public.seguimiento_donaciones(text) from public;
grant execute on function public.seguimiento_donaciones(text) to anon, authenticated;

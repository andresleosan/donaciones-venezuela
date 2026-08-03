-- Vigilancia de atrasos (plan 07 T4, SOLO panel admin — sin correo).
-- Un viaje está atrasado si su tramo vigente supera su umbral por >2 h:
--   tramo 1: no reportó recogida 2 h después del ETA (paso1_ts + eta + 120 min)
--   tramo 2: recogió (paso2_ts) y lleva >2 h sin entregar.
-- Cero infraestructura: se calcula al leer.
--
-- SEGURIDAD: la vista expone el correo del transportista, así que NO debe ser
-- legible por anon/authenticated. security_invoker=on hace que respete la RLS de
-- 'viajes' (sin políticas → anon no ve filas); además se revoca explícitamente.
-- La edge function (service_role) sí lee todo porque bypassa RLS.
create or replace view public.viajes_atrasados
with (security_invoker = on) as
select
  v.id, v.factura_id, v.transportista, v.email, v.eta_minutos,
  v.paso1_ts, v.paso2_ts,
  f.token_publico, f.objetivo,
  case when v.paso2_ts is null then 1 else 2 end as tramo,
  floor(extract(epoch from (now() - coalesce(v.paso2_ts, v.paso1_ts))) / 60)::int as transcurrido_min
from public.viajes v
join public.facturas f on f.id = v.factura_id
where v.resuelto = false and v.paso3_ts is null and (
  (v.paso2_ts is null and now() > v.paso1_ts + make_interval(mins => v.eta_minutos + 120))
  or
  (v.paso2_ts is not null and now() > v.paso2_ts + interval '2 hours')
);

revoke all on public.viajes_atrasados from anon, authenticated;

-- Plan 08 T3.3 — Adjunto del presupuesto (factura proforma, PDF de la farmacia…).
-- A DIFERENCIA de la evidencia de campo (privada), esto es un documento que el
-- admin publica para que el DONANTE lo vea y se motive a donar: bucket de
-- LECTURA PÚBLICA. Cualquier tipo de archivo, ≤5 MB (lo valida la edge fn).
-- Excepción consciente y acotada al «solo cámara / todo privado» del resto.
insert into storage.buckets (id, name, public)
values ('presupuestos', 'presupuestos', true)
on conflict (id) do nothing;

-- Foto del sitio (edificio/local) del centro, tomada en crear-centro.
-- Ruta en el bucket privado registro-transportistas: centros/<lugar_id>/sitio.<ext>
alter table public.centros_panel add column if not exists foto_sitio text;

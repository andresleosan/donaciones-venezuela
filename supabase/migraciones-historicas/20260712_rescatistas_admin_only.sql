-- Los perfiles de rescatistas contienen teléfonos, ubicación y capacidad operativa.
-- No deben estar disponibles en la vista pública de PostgREST.
revoke select on table public.rescatistas_public from anon, authenticated;
revoke select on table public.rescatistas from anon, authenticated;

-- La Edge Function usa service_role para registrar y leer estos perfiles.
-- El acceso administrativo pasa exclusivamente por admin_listar_rescatistas,
-- protegido por autenticarAdmin.

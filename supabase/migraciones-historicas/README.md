# Migraciones históricas

Estos 8 archivos son los que había en `supabase/migrations/` antes del
2026-07-30. Se apartaron por dos razones:

1. **Siete no se aplicaban nunca.** Sus nombres (`2026-07-21_denuncias.sql`)
   no cumplen el patrón `<timestamp>_nombre.sql` que exige el CLI de
   Supabase, así que los saltaba en silencio.

2. **La octava (`20260712_rescatistas_admin_only.sql`) sí se aplicaría, y
   no debe.** Revoca el acceso público a `rescatistas_public`, pero se
   comprobó el 2026-07-30 que esa revocación **nunca llegó a producción**:
   la vista sigue siendo legible por `anon`, teléfono incluido. Aplicarla
   en el clon lo haría distinto del original.

El efecto de las ocho ya está dentro de `20260101000000_esquema_base.sql` y
`20260101000001_esquema_vistas.sql`, que se reconstruyeron por
introspección del estado real de producción.

Se conservan como historia. No las borres sin leer esto.

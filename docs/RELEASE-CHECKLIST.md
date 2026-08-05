# Checklist de release v106

## Alcance

- Commit candidato: `cc88f58`.
- Cambios: versionado de assets a `v106`, areas tactiles de 44 px, nuevas claves de categorias y precache de los modulos de admin.
- No incluye migraciones de datos ni cambios de backend.

## Evidencia previa

- `python scripts/verificar-idioma.py`: OK, 1499 claves paralelas.
- `node --check`: OK, 19 archivos JavaScript.
- `git diff --check origin/main..HEAD`: OK.
- QA navegador local con Chrome: OK en 390 px y 1440 px; cambio de idioma en caliente sin hallazgos; cero errores de consola.
- Lectura publica de Supabase: HTTP 200, JSON valido.

## Seguridad

- El diff no agrega endpoints, secretos, permisos ni migraciones.
- No se detectan hallazgos criticos nuevos en el alcance de este release.
- Los riesgos historicos S1 y S4 permanecen documentados en `security_best_practices_report.md` y no forman parte de este cambio estatico.

## Rollback

Si la release estatica presenta regresion, volver al commit anterior desplegable `e7a8137` mediante el historial de despliegues de Vercel. Como rollback versionado, revertir en orden inverso `cc88f58` y `44bc05c`, verificar nuevamente sintaxis/idioma y publicar el resultado.

No se requiere rollback de base de datos porque esta release no modifica Supabase.

## Estado

Esta checklist registra la evidencia previa al push. La confirmacion de produccion se completa despues de verificar que Vercel sirve `v106` y que las cabeceras de seguridad permanecen activas.

# Gates de producción: consentimiento público de voluntarios

Versión técnica: `volunteer-public-v1`

Todas las casillas son obligatorias antes de cualquier habilitación:

[ ] Revisión legal del borrador y aprobación de la versión publicada.
[ ] Canal de contacto real aprobado y probado.
[ ] Texto de retiro y revocación probado manualmente.
[ ] App Check configurado para clientes reales y enforcement aprobado.
[ ] Rate limits, alertas y métricas configurados.
[ ] Backup y restauración verificados; rollback ensayado.
[ ] Node runtime de Functions alineado con Node 22 en CI.
[ ] npm audit revisado y decisión documentada para moderates.
[ ] Pruebas unitarias, Functions y Emulator Suite verdes.
[ ] Revisión de seguridad sin hallazgos críticos.
[ ] Prueba manual de activar, revocar y verificar ausencia pública.
[ ] Confirmación explícita del operador para desplegar.

## Bloqueo operativo

Cualquier casilla pendiente bloquea producción, staging, Blaze y la publicación
real. Este documento no autoriza despliegues, activación de App Check enforced,
uso de datos reales ni cambios remotos.

## Rollback

Ante un fallo o una revocación, el rollback se realiza revirtiendo el código y
las reglas a la versión anterior y verificando la ausencia pública. El rollback
no borra perfiles privados ni auditoría. La conservación y eliminación de esos
datos siguen `DATA_RETENTION_POLICY.md` y los procedimientos aprobados.

# Runbook: Consentimiento público de voluntarios

Proyecto de pruebas: `demo-donaciones-venezuela`

Comando local: `npm.cmd run test:emulators`

Acción: `setVolunteerPublicConsent`

Versión: `volunteer-public-v1`

Datos permitidos: fixtures sintéticos en Emulator Suite

Datos prohibidos: perfiles reales, PII, fotos, tokens y seeds remotos

Rollback: revertir Function/reglas; conservar perfil privado y auditoría

Producción: bloqueada hasta textos legales, rate limiting/App Check y revisión operativa

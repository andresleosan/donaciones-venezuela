# Runbook: Consentimiento público de voluntarios

Proyecto de pruebas: `demo-donaciones-venezuela`

Comando local: `npm.cmd run test:emulators`

Acción: `setVolunteerPublicConsent`

Versión: `volunteer-public-v1`

Datos permitidos: fixtures sintéticos en Emulator Suite

Datos prohibidos: perfiles reales, PII, fotos, tokens y seeds remotos

Rollback: revertir Function/reglas; conservar perfil privado y auditoría

Producción: bloqueada hasta textos legales, rate limiting/App Check y revisión operativa

Borrador legal: docs/legal/volunteer-public-consent-draft.md
Gates de producción: docs/runbooks/volunteer-consent-production-gates.md
Estado: producción bloqueada; App Check enforced no activado remotamente.

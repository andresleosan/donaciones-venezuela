# Runbook: lecturas publicas Firebase

Proyecto de pruebas: demo-donaciones-venezuela
Comando de reglas: npm.cmd run test:rules
Comando completo: npm.cmd run verify
Datos permitidos: fixtures sinteticos dentro de Emulator Suite
Datos prohibidos: usuarios reales, PII, tokens, archivos y seeds remotos
Rollback: revertir el commit que modifica firestore.rules e índices; restaurar deny-by-default
Fuera de alcance: deploy, Blaze, services/api.js y colecciones privadas

## Operacion local

Las lecturas anonimas solo estan habilitadas para `lugaresPublicos` y
`vacantesPublicas`. Las consultas `list` deben enviar un limite entre 1 y 50.
Las escrituras permanecen denegadas, igual que la lectura de cualquier coleccion
privada o ruta no incluida explicitamente.

Un documento publico debe ser generado por Functions/Admin SDK usando
`sanitizePublicProjection`. Ningun cliente puede escribir documentos publicos.
La publicacion futura debe conservar las allowlists y la denylist recursiva del
sanitizer; este runbook no habilita un publicador ni datos remotos.

La ausencia de documentos en el proyecto greenfield es correcta. No autoriza a
inventar datos ni a usar usuarios reales, PII, tokens, archivos o seeds remotos.
Para las pruebas locales se permiten unicamente fixtures sinteticos dentro de
Emulator Suite.

## Verificacion

Ejecutar desde la raiz del proyecto y en este orden:

```text
npm.cmd run test:unit
npm.cmd run test:rules
npm.cmd run test:emulators
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd --prefix functions audit --audit-level=high
python scripts/verificar-idioma.py
```

Todas las pruebas deben pasar. Las auditorias no deben reportar vulnerabilidades
`high` ni `critical`. Si se observa una vulnerabilidad `moderate`, documentarla
como observacion actual sin afirmar una antiguedad o procedencia historica que no
este demostrada.

## Rollback

Revertir el commit que modifica `firestore.rules` e indices; restaurar
deny-by-default. No ejecutar deploy, activar Blaze ni escribir en proyectos
remotos como parte de este procedimiento.

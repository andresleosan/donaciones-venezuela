# Tareas de migración Supabase → Firebase

Estados: `completada`, `en curso`, `pendiente`, `bloqueada`.

| ID | Estado | Tarea | Dependencias | Evidencia de salida |
|---|---|---|---|---|
| T00 | completada | Auditoría completa e inventario Supabase | — | `AUDITORIA.md` |
| T01 | bloqueada | Plan, esquema Firestore y auditoría de seguridad | T00 | Crítico: `buscar_familiar` expone PII por RPC público y snapshots sin TTL; además `npm run verify` no completa por puertos de otro Emulator Suite |
| T02 | completada | Configuración local Firebase y reglas deny-by-default | T01 | `firebase.json`, `.firebaserc`, reglas parseables |
| T03 | completada | Scaffold Vite y adaptadores SDK separados | T02 | `src/firebase/`, `package.json`, build correcto |
| T04 | completada | Migrar Auth, persistencia y sesión del frontend | T03 | `npm.cmd run test:unit`: 11 archivos, 172 tests OK; `npm.cmd run test:functions`: build de Functions y 23 tests OK en 6 archivos tras repetir un primer arranque transitorio fallido; `npm.cmd run build`: OK; `python scripts/verificar-idioma.py`: OK; auditoría actual: 5 moderadas observadas en raíz, 0 high/critical; este plan no modificó manifests ni versiones de dependencias |
| T05 | completada | Verificador de ID token y roles en Cloud Functions | T04 | `npm.cmd run test:functions`: contrato HTTP, roles y Emulator Suite OK; `npm.cmd --prefix functions audit --audit-level=high`: 7 moderadas observadas en Functions, 0 high/critical; este plan no modificó manifests ni versiones de dependencias; revisión manual: sin endpoint de bootstrap, sin claims en cliente, respuesta de sesión minimizada y reglas deny-by-default |
| T06 | completada | Repositorios Firestore para lecturas públicas | T05 | Reglas e índices para `lugaresPublicos` y `vacantesPublicas`; repositorios `listPublicPlaces`/`listPublicVacancies` con límite 50, paginación y cursor; `npm.cmd run test:unit` (12 archivos, 190 tests OK), `npm.cmd run test:rules` (3 archivos, 18 tests OK), `npm.cmd run test:emulators` (9 archivos, 41 tests OK), `npm.cmd run build` OK, `npm.cmd audit --audit-level=high` (5 moderate observadas, 0 high/critical), `npm.cmd --prefix functions audit --audit-level=high` (7 moderate observadas, 0 high/critical), `python scripts/verificar-idioma.py` OK y `npm.cmd run verify` OK; observaciones de auditoría actuales, sin atribuir antigüedad no demostrada. |
| T07 | en curso | Migrar Storage y URLs temporales | T05 | Tasks 1–3 del plan 2026-08-12 implementadas (Task 3 sin commit); falta Task 4 `tests/emulators/storage.integration.test.ts` → se cierra en la Task 0.5 del plan 2026-09-06 |
| T08 | pendiente | Portar acciones backend por dominio | T05,T06,T07 | 65 acciones con pruebas de contrato |
| T09 | pendiente | Exportación, transformación y reconciliación de datos | T06,T08 | backup restaurable, conteos y totales coincidentes |
| T10 | pendiente | Rules, índices, rate limits y Emulator Suite | T05,T06,T07,T08 | suite de seguridad sin accesos indebidos |
| T11 | pendiente | Vercel build, CSP y verificación manual | T03,T08 | build limpio y flujos principales operativos |
| T12 | pendiente | Eliminar Supabase y generar informe final | T09,T10,T11 | búsqueda global limpia y `MIGRATION_REPORT.md` |
| T13 | en curso | Reconstrucción greenfield sobre Firebase con la lógica legada + rediseño visual (sustituye a T08/T09: no hay datos que migrar) | T05,T06,T07 | Plan `docs/superpowers/plans/2026-09-06-reconstruccion-firebase-y-rediseno-visual.md`; diseño `docs/superpowers/specs/2026-09-06-reconstruccion-firebase-y-rediseno-visual-design.md`; evidencia 2026-09-06: `test:unit` 335 OK, `test:rules` 38 OK, `test:emulators` 170 OK tras arreglar JDK 21, TTL de `rateLimits`, índice inválido, CORS, `predeploy`, barrel y reglas de Storage |

## Criterio de no avance

No se abre Firestore/Storage, no se eliminan migraciones SQL y no se despliega producción mientras una tarea de seguridad, backup, contrato o prueba esté pendiente.

La validación Cronos del 2026-08-06 bloquea además el inicio de `T04` hasta cerrar el gate de `MIGRATION_VALIDATION.md`. `T02` y `T03` están verificados solo como preparación local aislada y no constituyen una migración funcional.

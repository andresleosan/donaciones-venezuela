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
| T07 | completada | Migrar Storage y URLs temporales | T05 | Bucle de acceso privado cerrado (commit `955f59d`) y categoría nueva `centers` para la cédula del responsable y la foto del sitio, la única que el rol `panel` no puede leer (Task 3.1 del plan 2026-09-06). `tests/functions/private-file-access.test.ts` 32 pruebas, `tests/rules/storage.rules.test.ts` OK |
| T08 | pendiente | Portar acciones backend por dominio | T05,T06,T07 | 65 acciones con pruebas de contrato |
| T09 | pendiente | Exportación, transformación y reconciliación de datos | T06,T08 | backup restaurable, conteos y totales coincidentes |
| T10 | pendiente | Rules, índices, rate limits y Emulator Suite | T05,T06,T07,T08 | suite de seguridad sin accesos indebidos |
| T11 | pendiente | Vercel build, CSP y verificación manual | T03,T08 | build limpio y flujos principales operativos |
| T12 | pendiente | Eliminar Supabase y generar informe final | T09,T10,T11 | búsqueda global limpia y `MIGRATION_REPORT.md` |
| T13 | en curso | Reconstrucción greenfield sobre Firebase con la lógica legada + rediseño visual (sustituye a T08/T09: no hay datos que migrar) | T05,T06,T07 | Plan `docs/superpowers/plans/2026-09-06-reconstruccion-firebase-y-rediseno-visual.md`; diseño `docs/superpowers/specs/2026-09-06-reconstruccion-firebase-y-rediseno-visual-design.md`; Fases 0, 1 y 2 completas y **Fase 3 iniciada**: Task 3.1 (lugares, insumos, historial y panel de centro, 8 acciones) cerrada en `79edb3b`. Siguiente: Task 3.2 (personas: voluntarios, rescatistas, transportistas, reportes y búsqueda familiar). Evidencia 2026-09-06 al cerrar la Task 3.1: `test:unit` 31 archivos / 571 OK, `test:emulators` 26 archivos / 396 OK, ambos `build` OK, `seed:emulador` OK, `verificar-idioma.py` 1499 claves OK. Decisiones del operador aplicadas el 2026-09-06: CSP de `vercel.json` migrada a Firebase (`connect-src` con `*.googleapis.com`, `*.cloudfunctions.net`, `*.run.app` y `wss://*.firebaseio.com`; sin `*.supabase.co`) y `registrar_lugar` endurecido (un anónimo da de alta insumos nuevos, pero ya no cambia el `estado` ni la `categoria` de uno existente). Sigue pendiente de operador la comprobación manual en navegador (Task 2.2, Step 3) y el resto del gate G3 (`buildCommand`/`outputDirectory` de Vercel y las variables `VITE_*`), que ya es despliegue |

## Criterio de no avance

No se abre Firestore/Storage, no se eliminan migraciones SQL y no se despliega producción mientras una tarea de seguridad, backup, contrato o prueba esté pendiente.

La validación Cronos del 2026-08-06 bloquea además el inicio de `T04` hasta cerrar el gate de `MIGRATION_VALIDATION.md`. `T02` y `T03` están verificados solo como preparación local aislada y no constituyen una migración funcional.

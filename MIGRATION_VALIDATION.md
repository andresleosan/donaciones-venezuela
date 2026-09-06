# Validación Cronos — cierre local del gate T01

**Fecha:** 2026-08-06  
**Alcance:** cierre de arquitectura, privacidad, rollback, costos y QA local antes de `T04`.  
**Veredicto:** **fase bloqueada por un hallazgo crítico de privacidad**. Además, la verificación integrada no terminó porque otro proyecto mantiene ocupados los puertos contractuales de Emulator Suite, incluido Functions `5001`.

## Hallazgo crítico

`public.buscar_familiar(q text)` está declarado `SECURITY DEFINER`, no revoca el permiso `EXECUTE` público y devuelve nombre, cédula, estado, ubicación y metadata de hasta 25 personas con una búsqueda mínima de tres caracteres. `services/api.js` lo consume con la clave publicable y guarda el resultado en IndexedDB sin TTL. Esto permite enumeración de personas vulnerables, exposición posterior en dispositivos compartidos y contradice `DATA_RETENTION_POLICY.md`, que prohíbe publicar nombres completos, documentos y ubicaciones familiares sin autorización específica.

El informe histórico `security_best_practices_report.md` lo marcó como intencional, pero no documenta una aceptación humana compatible con la política vigente ni controles de autorización. Resolverlo requiere decidir entre retirar la búsqueda pública o convertirla en un flujo autenticado/autorizado con respuesta minimizada y sin cache sensible. La revocación o modificación remota exige una migración y confirmación explícita; no se aplicó en esta fase.

## Estado comprobado

| Elemento | Resultado | Evidencia |
|---|---|---|
| Gobernanza | Corregido localmente | `docs/adr/ADR-001-migracion-supabase-firebase.md` acepta migración incremental y mantiene Supabase productivo hasta el corte |
| Entornos y costos | Corregido documentalmente | Desarrollo, demo local, staging/prod separados, `us-east1`, rangos de costo y alertas futuras en `STACK.md` |
| Backup y reversión | Plan documentado, ejecución pendiente | `BACKUP_RESTORE_PLAN.md`; ensayo restaurable sigue como gate previo a `T06` |
| Frontera pública/privada | Corregida localmente | Ocho allowlists en `functions/src/public-projections.ts`, pruebas y `FIRESTORE_SCHEMA.md` |
| Storage privado | Corregido localmente | El cliente devuelve solo path; TTL máximo 15 minutos y validación de path cubiertos por pruebas |
| Cola offline | Corregida localmente | Deny-by-default, ninguna acción habilitada, TTL 24 h, 3 intentos, idempotencia y purgas probadas |
| Rules cerradas | Conforme | 8 pruebas de Firestore/Storage pasaron para anónimo, usuario, panel y admin en una ejecución de Emulator Suite |
| Functions `health` | Unidad y compilación conformes; integración pendiente | 2 pruebas unitarias y TypeScript pasan; el emulador no pudo tomar `127.0.0.1:5001` |
| Migración funcional | No iniciada | UI, Auth, REST, RPC, Edge Function y CSP siguen apuntando a Supabase |
| Datos/Firebase remoto | No accedidos | No hubo exportación, migración, despliegue, activación de Blaze ni cambios remotos |

## Evidencia fresca

| Comando | Resultado |
|---|---|
| `npm.cmd run test:unit` | Código 0; 6 archivos y 22 pruebas pasaron |
| `npm.cmd run test:rules` | Código 0 en la ejecución disponible; 2 archivos y 8 pruebas pasaron |
| `npx.cmd vitest run tests/functions/health.test.ts` | Código 0; 2 pruebas pasaron |
| `npm.cmd run build --prefix functions` | Código 0 |
| `npm.cmd run build` | Código 0; conserva advertencias conocidas por scripts legacy clásicos |
| `npm.cmd audit --audit-level=high` | Código 0; 5 vulnerabilidades moderadas transitivas, ninguna alta |
| `npm.cmd audit --prefix functions --audit-level=high` | Código 0; 7 vulnerabilidades moderadas transitivas, ninguna alta |
| `python scripts/verificar-idioma.py` | Código 0; 1499 claves paralelas |
| `npm.cmd run test:functions` | No completó: otro proyecto ocupa `127.0.0.1:5001` |
| `npm.cmd run verify` | No completó: 22 unitarias pasaron y luego Emulator Suite no pudo tomar `9099` ni `8080`, ocupados por `hachi-greciaspa`; `5001` también está ocupado por ese proyecto |

## Seguridad

- No se detectó un hallazgo crítico nuevo.
- Rules siguen deny-by-default; no se abrió ninguna ruta funcional.
- El sanitizador público construye objetos desde allowlists y revisa campos prohibidos anidados.
- `src/firebase` no conserva `getDownloadURL` ni `downloadUrl`.
- La cola offline no tiene acciones habilitadas y elimina entradas legacy no conformes.
- `health` no devuelve secretos, variables, IDs de proyecto, tokens ni configuración.
- Las credenciales compartidas previamente siguen sin evidencia de rotación; `T04` no debe usar esas credenciales.

## Gates operativos que permanecen abiertos

Estos puntos no invalidan la preparación local, pero siguen bloqueando sus fases correspondientes:

1. Repetir `npm.cmd run verify` con los puertos contractuales 5001, 8080, 9099 y 9199 disponibles para esta suite.
2. Rotar credenciales legacy antes de pruebas de Auth.
3. Crear staging y producción solo con autorización explícita y como proyectos separados.
4. Ejecutar y aprobar el ensayo de backup/restore antes de `T06`.
5. Autorizar Blaze antes de cualquier Function remota y configurar alertas de facturación.
6. Completar Auth/claims, reglas funcionales, 65 contratos, CSP y reconciliación en sus tareas posteriores.

## Decisión de avance

`T01` permanece `bloqueada` hasta resolver el hallazgo crítico y hasta que `npm.cmd run verify` termine con código 0 y se registre el conteo real de la suite integrada. `T04` no cambia de estado dentro de este cierre.

Esta validación no autoriza despliegue, gasto, migración de datos, acceso productivo, apertura de Rules ni eliminación de Supabase.

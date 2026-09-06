# ADR-001: Migrar Supabase a Firebase de forma incremental

Fecha: 2026-08-06
Estado: aceptada

## Contexto

La aplicacion concentra 65 acciones, datos personales, archivos privados y reglas transaccionales en Supabase. La decision aprobada busca Firebase Auth, Firestore, Storage y Functions sin un reemplazo big-bang.

## Decision

Migrar por contratos y dominios. Supabase seguira como fuente productiva hasta reconciliacion y corte. `donaciones-venezuela-4fc29` sera solo desarrollo; staging y produccion seran proyectos separados. Functions usara `us-east1`. No se activara Blaze ni se desplegara sin confirmacion posterior.

## Alternativas consideradas

- Mantener Supabase: menor costo de migracion, pero no cumple la decision operativa de estandarizar en Firebase.
- Reemplazo big-bang: reduce convivencia temporal, pero eleva el riesgo de regresion sobre 65 acciones y datos sensibles.
- Firebase incremental: elegido porque permite doble lectura, rollback por dominio y pruebas de contrato.

## Consecuencias

Se gana integracion con Firebase Auth, Rules y Emulator Suite. Se acepta lock-in documental, ausencia de joins SQL, necesidad de proyecciones publicas, control explicito de costos por operacion y una salida mas costosa hacia otro proveedor.

Supabase y Firebase conviviran durante la migracion. Esta convivencia exige contratos equivalentes, reconciliacion por dominio y mantener Supabase disponible durante la ventana de reversion. La aceptacion de este ADR no autoriza despliegue, activacion de Blaze, acceso a datos productivos ni creacion de staging o produccion.

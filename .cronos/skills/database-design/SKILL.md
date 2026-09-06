---
name: database-design
description: Usar al diseñar o modificar el esquema de datos, índices o migraciones, en cualquier nivel de proyecto. Cubre normalización, rollback de migraciones y backup antes de cambios destructivos — la disciplina que antes vivía en la plantilla del Titán Tetis.
---

# Database Design

## Cuándo se activa
Cada vez que Cronos diseña o modifica un esquema de datos, agrega una migración, o define un índice — antes de que el backend (`backend-patterns`) dé por cerrado su contrato de datos.

## Disciplina no negociable
- Normaliza por defecto; solo desnormaliza con una justificación concreta y medida (ver `performance-baseline` — nunca desnormalices de forma especulativa).
- Toda migración lleva su reversión (rollback/down) definida antes de aplicarse. Si el motor no soporta rollback nativo, documenta el procedimiento manual de reversión junto a la migración.
- Antes de aplicar cualquier migración en producción, verifica que exista un backup reciente. Ninguna migración destructiva (DROP, TRUNCATE, cambio de tipo con pérdida de datos) se aplica sin ese respaldo confirmado y sin la confirmación explícita del operador — ver `deploy-checklist`.
- Define permisos de acceso a nivel de fila/columna si el motor lo soporta y el dato lo justifica (por ejemplo, datos multi-tenant).
- Documenta el contrato de datos que el backend necesita, para no descubrir el desajuste a mitad de la implementación.

## Preguntas antes de aplicar una migración
- ¿Existe un backup verificado de los datos que esta migración va a tocar?
- ¿El rollback está documentado y probado, no solo escrito?
- Si esto falla a mitad de camino, ¿el sistema queda en un estado consistente?

## Lo que esta skill NO decide
- Seguridad de autenticación (eso es `security-baseline`) — esta skill solo cubre permisos a nivel de datos.
- Producto ni alcance — eso viene ya definido en `BRIEF.md`/`STACK.md`.

## Entregable
Esquema/migraciones + documentación del modelo de datos + plan de rollback de cada migración, antes de pasar por el ciclo de autocrítica de `self-critique-loop`.

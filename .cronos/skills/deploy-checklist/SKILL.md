---
name: deploy-checklist
description: Usar antes de cualquier despliegue a producción o aplicación de migración en producción, en cualquier nivel de proyecto. Las condiciones son innegociables — la disciplina que antes vivía en la plantilla del Titán Jápeto.
---

# Deploy Checklist

## Cuándo se activa
Cada vez que una tarea llega al punto de desplegarse, o de aplicar una migración en producción — el último paso, nunca el primero en decidir si algo está listo.

## Condición de despliegue (innegociable)
Solo se despliega si:
1. La fase de seguridad del ciclo de autocrítica (`security-baseline`) no tiene hallazgos críticos abiertos.
2. La fase de pruebas del ciclo de autocrítica marcó la tarea como "aprobada", con evidencia verificable.
3. Si el release incluye migraciones de datos, existe backup verificado y procedimiento de rollback documentado (ver `database-design`).
4. El operador confirmó explícitamente el despliegue a producción — no a staging, y no por inercia porque "ya se probó antes".
5. Si el proyecto tiene UI web y quedó clasificado Nivel 2/3, existe reporte de `browser-qa-e2e` de la última corrida con resultado limpio (o hallazgos ya resueltos con evidencia) — ver `skills-custom/browser-qa-e2e/SKILL.md`. No aplica a proyectos Nivel 1 ni a proyectos sin UI web (APIs puras, scripts).

Ninguna de estas cinco se salta, sin importar la urgencia. Nunca se despliega "para probar en producción".

## Responsabilidades
- Mantener el pipeline de CI/CD.
- Tener siempre un plan de rollback antes de desplegar, no improvisado en el momento si algo falla.
- Documentar cada release: qué cambió y cómo revertir si algo falla.

## Entregable
Deploy exitoso + notas de release + plan de rollback documentado.

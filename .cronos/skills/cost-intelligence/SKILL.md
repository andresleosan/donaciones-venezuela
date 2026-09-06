---
name: cost-intelligence
description: Usar en proyectos Nivel 2/3, o en cualquier nivel al integrar un servicio de pago (API de IA, hosting con facturación por uso, base de datos gestionada, envío de emails/SMS transaccional). Estima el costo mensual aproximado antes de comprometerse, lo documenta en STACK.md, y señala si falta un límite de gasto o alerta de facturación configurado.
---

# Cost Intelligence

## Cuándo se activa
- Nivel 2/3: parte del flujo normal al documentar `STACK.md` (A2/B3 de `MASTER_PROMPT.md`) y en cada integración externa nueva (fase de Integraciones, `external-integrations`).
- Cualquier nivel, específicamente cuando se agrega un servicio de pago — no espera al nivel del proyecto para eso, un landing page Nivel 1 con un API de IA facturada por uso igual necesita esta estimación puntual.
- En Modo Auditoría (Flujo B), como parte de `AUDITORIA.md`: revisa si un proyecto existente ya tiene servicios de pago sin límite conocido.

## Qué cubre
- Estima el costo mensual aproximado de cada servicio de pago **antes** de integrarlo, no después de que ya está en producción generando facturación.
- Verifica si el servicio tiene límite de gasto o alerta de facturación configurable (la mayoría de proveedores de IA, hosting y bases de datos gestionadas lo ofrecen) y trata la ausencia de esa configuración como un hallazgo — mismo formato que un hallazgo de `security-baseline` (qué, severidad, impacto si no se corrige), pero de costo, no de seguridad.
- En Modo Auditoría, revisa integraciones ya existentes con el mismo criterio: ¿hay algún servicio de pago sin límite ni alerta configurados?

## Severidad de un hallazgo de costo
A diferencia de `security-baseline`, un hallazgo de costo **no bloquea el despliegue por sí solo** — es información para que el operador decida, no un veto técnico. Repórtalo con la misma estructura de severidad (crítica/alta/media/baja según cuánto podría escalar sin control) pero nunca lo trates como condición de la Regla de oro de `AGENCY.md` sobre despliegue.

## Qué NO hacer
- No conviertas esto en un ejercicio de contabilidad exhaustiva — es una estimación de orden de magnitud (rango razonable, no una cifra exacta), suficiente para que el operador decida con información real.
- No bloquees ninguna tarea ni el despliegue por un hallazgo de costo — repórtalo y sigue, a menos que el operador decida detenerse él mismo.
- No lo apliques a servicios ya cubiertos por el free tier sin proyección de crecimiento — si el proyecto es Nivel 1 y va a seguir siendo pequeño, decir "dentro del free tier de X" alcanza, no hace falta proyectar escenarios.

## Entregable
Sección "Costo" en `STACK.md` (servicios de pago, estimación mensual, ¿alerta de facturación configurada? sí/no) para proyectos nuevos; misma sección dentro de `AUDITORIA.md` (ver `AUDITORIA.example.md`) para proyectos existentes.

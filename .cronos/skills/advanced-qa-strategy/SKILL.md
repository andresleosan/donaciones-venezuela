---
name: advanced-qa-strategy
description: Usar en proyectos Nivel 3 para diseñar pruebas más allá de lo funcional - carga, contratos entre servicios, casos límite de seguridad. Complementa (no reemplaza) el testing funcional que Cronos ya hace con Playwright MCP en el paso de QA del self-critique-loop.
---

# Advanced QA Strategy

## Cuándo se activa
En proyectos Nivel 3, antes de una release importante o cuando el sistema tiene múltiples servicios/integraciones que dependen entre sí.

## Capas de prueba a considerar (más allá de E2E funcional)
- **Pruebas de contrato**: si dos servicios/módulos se comunican por API interna, verificar que el contrato de datos no se rompió, no solo que "la pantalla carga".
- **Pruebas de carga**: identificar el punto de quiebre real (¿cuántos usuarios concurrentes aguanta el flujo crítico?), no asumirlo.
- **Casos límite de seguridad**: probar qué pasa con entradas maliciosas o inesperadas en los puntos que `security-baseline` marcó como sensibles, no solo el camino feliz.

## Cuándo NO aplica
En proyectos Nivel 1 o 2 sin múltiples servicios, esto es sobre-ingeniería - el testing funcional del paso de QA en `self-critique-loop` es suficiente.

## Salida esperada
Sección adicional en el reporte de pruebas del ciclo de autocrítica: "Pruebas avanzadas" con resultados de las capas anteriores que aplicaron.

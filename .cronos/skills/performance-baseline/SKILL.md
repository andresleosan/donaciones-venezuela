---
name: performance-baseline
description: Usar como sombrero de rendimiento dentro del self-critique-loop, antes de una release grande (no en cada tarea chica), en cualquier nivel de proyecto. Mide antes de optimizar — la disciplina que antes vivía en la plantilla del Titán Hiperión. En Nivel 3, si la medición revela un cuello de botella real, continúa con scalability-patterns.
---

# Performance Baseline

## Cuándo se activa
En el paso 4 de `self-critique-loop`, antes de una release grande — no en cada commit chico, sería fricción innecesaria. También cuando algo se siente lento de forma perceptible y hace falta confirmar si es real antes de tocar nada.

## Disciplina no negociable
- Mide performance real (tiempos de carga, tamaño de bundle, queries lentas) antes de proponer cualquier cambio — nunca optimización especulativa ("esto probablemente es más rápido").
- Detecta patrones concretos: N+1 queries, renders innecesarios, assets sin comprimir.
- Todo cambio de optimización lleva su "antes/después" medido, no solo la intuición de que mejoró.
- No cambies lógica de negocio para optimizar — solo estructura, queries, o assets. Si la optimización requiere cambiar el comportamiento, es una decisión de producto, no de rendimiento, y se escala como tal.

## Orden de las soluciones (de menor a mayor complejidad)
Si la medición revela un cuello de botella real en un proyecto Nivel 3, sigue este orden antes de escalar a `scalability-patterns`:
1. Optimizar la query/consulta o el índice.
2. Caché para lecturas repetidas.
3. Recién ahí, si no alcanza, considerar separar lecturas de escrituras o particionar datos — ver `scalability-patterns` para el detalle completo de esta escalera.

## Entregable
Reporte breve de performance (qué se midió, con qué herramienta, qué número salió) + los cambios puntuales de optimización aplicados, cada uno con su medición de antes/después.

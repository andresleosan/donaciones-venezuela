---
name: scalability-patterns
description: Usar cuando un proyecto Nivel 3 necesita soportar más carga, datos o usuarios de los que soporta hoy. Continúa a performance-baseline cuando la medición confirma un cuello de botella real, siempre después de medir, nunca antes.
---

# Scalability Patterns

## Cuándo se activa
Cuando `performance-baseline` mide un cuello de botella real (no una sospecha) en un proyecto Nivel 3, o cuando el crecimiento esperado de usuarios/datos (definido en `BRIEF.md` o `STACK.md`) ya se sabe que el diseño actual no va a soportar.

## Orden de las soluciones (de menor a mayor complejidad - no saltarse pasos)
1. Optimizar la query/consulta o el índice antes de agregar infraestructura.
2. Caché para lecturas repetidas antes de escalar la base de datos.
3. Separar lecturas de escrituras (réplicas) antes de particionar datos.
4. Particionar/sharding de datos solo cuando el volumen ya no cabe en una instancia razonable.
5. Colas para desacoplar procesos pesados del camino de respuesta al usuario.

## Señal de alarma
Si se está considerando el paso 4 o 5 sin haber medido que los pasos 1-3 no alcanzan, es probable que se esté resolviendo un problema que todavía no existe.

## Salida esperada
Reporte de Hiperión con: medición actual, cuello de botella identificado, y cuál de los 5 pasos se aplica y por qué (no el más avanzado, el más simple que resuelve el problema medido).

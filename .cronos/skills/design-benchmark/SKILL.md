---
name: design-benchmark
description: Usar antes de frontend-craft, la primera vez que un proyecto define su identidad visual (cualquier nivel con frontend visible al usuario final). Recolecta referencias reales de productos del mismo rubro antes de proponer un diseño, para no caer en el default genérico de un framework. Produce un Design DNA breve (paleta, tipografía, tono, referencias) que frontend-craft usa como punto de partida cualitativo.
---

# Design Benchmark

## Cuándo se activa
La primera vez que un proyecto necesita definir su identidad visual — normalmente en A2/B3 de `MASTER_PROMPT.md`, antes de que `frontend-craft` empiece a construir componentes. No se repite en cada tarea de frontend, solo cuando la identidad visual todavía no está definida en `STACK.md`. En Nivel 1 es opcional y liviano (2-3 referencias, sin más ceremonia); en Nivel 2/3 es parte del flujo normal.

## Proceso
1. **Identifica 2-3 referencias reales** del mismo rubro o categoría (usa búsqueda web si tienes la herramienta disponible) — productos que un usuario del proyecto reconocería o con los que lo compararía.
2. **Detecta patrones comunes** entre esas referencias: qué convenciones de layout, tipografía o interacción se repiten.
3. **Detecta qué las diferencia entre sí** — el objetivo no es clonar una sola referencia, es entender el espacio de diseño de la categoría.
4. **Produce un Design DNA breve**: paleta (2-4 colores con su rol), tipografía (familia y por qué), tono (1-2 adjetivos: "serio", "juguetón", "técnico"), y explícitamente 1-2 defaults genéricos que este proyecto va a evitar (el mismo criterio que ya exige `frontend-craft` contra el "default genérico de cualquier framework").
5. Muestra el Design DNA al operador antes de que `frontend-craft` construya el primer componente visual — no es un checkpoint bloqueante como A2.1, pero sí conviene alinearlo temprano para no rehacer trabajo.

## Qué NO hacer
- No reproduzcas ni describas assets, copy textual o layouts protegidos de un competidor específico — extrae únicamente patrones estructurales y convenciones de UX, nunca contenido literal.
- No lo apliques como paso bloqueante en Nivel 1 si el operador prefiere saltarlo — es la capa más liviana de todo el kit, y forzarla ahí sería la misma fricción innecesaria que ya evita `AGENCY.md` con Superpowers completo en Nivel 1.
- No repitas el benchmark en cada tarea de frontend nueva — una vez que el Design DNA está en `STACK.md`, `frontend-craft` lo usa como referencia fija hasta que el proyecto cambie de dirección visual.

## Relación con `frontend-craft`
`frontend-craft` ya describe un proceso de tres capas: sistema cuantitativo (`ui-ux-pro-max` si está disponible), criterio cualitativo propio, y referencia visual real. `design-benchmark` es específicamente cómo se produce esa tercera capa — no es una capa nueva en paralelo, es el mecanismo concreto para una capa que ya estaba nombrada en `frontend-craft` pero sin un proceso propio que la generara.

## Entregable
Sección "Identidad visual" en `STACK.md` (ver `STACK.example.md`) con el Design DNA: referencias consultadas, paleta, tipografía, tono, y qué se evita explícitamente.

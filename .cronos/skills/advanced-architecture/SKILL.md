---
name: advanced-architecture
description: Usar en proyectos Nivel 3 (ERP, SaaS, marketplace, sistemas financieros) al decidir entre monolito y servicios separados, patrones de comunicación entre módulos, o cómo estructurar un sistema multi-módulo. Aplica en la fase de arquitectura y stack.
---

# Advanced Architecture

## Cuándo se activa
Cuando Cronos clasifica el proyecto como Nivel 3, o cuando un proyecto Nivel 2 muestra señales de necesitar separación de responsabilidades (múltiples equipos, ritmos de despliegue distintos, módulos con ciclos de vida muy diferentes).

## Preguntas antes de separar en servicios
- ¿Este módulo necesita escalar o desplegarse independientemente del resto?
- ¿Lo mantiene o lo usará un equipo distinto?
- ¿La complejidad de coordinar servicios separados es menor que el dolor de mantenerlos juntos?

Si las tres respuestas no son claramente "sí", empezar con monolito bien modularizado. Separar servicios demasiado pronto es la causa más común de sobre-ingeniería.

## Patrones a considerar (solo si aplican)
- Comunicación asíncrona (colas) para desacoplar procesos lentos o no críticos en el camino feliz.
- Event-driven solo si hay múltiples consumidores reales de un mismo evento, no "por si acaso".
- Monorepo con módulos bien delimitados como paso intermedio antes de separar en repos/servicios.

## Salida esperada
Sección "Decisiones de arquitectura" en `STACK.md`, cada una con: decisión, alternativas consideradas, por qué se descartaron.

---
name: product-strategy
description: Usar al definir o ajustar el rumbo de un producto - qué construir primero, qué NO construir todavía, y cómo defender esa priorización. Aplica en proyectos Nivel 2 y 3, en la fase de producto y alcance.
---

# Product Strategy

## Cuándo se activa
Cuando Cronos necesita priorizar un backlog, decidir entre dos features que compiten por el mismo tiempo, o justificar por qué algo NO entra en esta versión.

## Preguntas obligatorias antes de priorizar
- ¿Quién es el usuario que más sufre sin esto?
- ¿Qué pasa si esto no se construye en 3 meses?
- ¿Esto mueve una métrica de negocio real o solo "se ve bien"?

## Marco de priorización (RICE simplificado)
Para cada feature candidata, puntuar del 1 al 5:
- **Alcance**: ¿a cuántos usuarios afecta?
- **Impacto**: ¿qué tanto mejora su experiencia o el negocio?
- **Confianza**: ¿qué tan seguros estamos de esa estimación?
- **Esfuerzo**: ¿cuánto trabajo real implica? (puntuar al revés: 5 = poco esfuerzo)

Puntaje = (Alcance + Impacto + Confianza + Esfuerzo) / 4. Ordenar de mayor a menor.

## Salida esperada
Una sección en `BRIEF.md` con el backlog ordenado y, para cada feature descartada de esta versión, una línea explicando por qué.

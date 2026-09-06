---
name: self-critique-loop
description: Usar después de implementar cualquier tarea con impacto en código, antes de marcarla como lista en tasks.md. Define el orden de las fases de autocrítica (seguridad, pruebas, rendimiento), el criterio de corte del loop, y qué hacer si un hallazgo no converge. Es el mecanismo central que reemplaza la coordinación entre Titanes separados de versiones anteriores de la agencia.
---

# Self-Critique Loop

## Cuándo se activa
Siempre que Cronos termina de implementar una tarea de `tasks.md` que toca código (no aplica a tareas puramente documentales, como escribir `BRIEF.md`). Nunca se salta, sin importar cuán simple parezca la tarea — lo que cambia con el nivel del proyecto es cuánto más allá del mínimo se hace, no si se hace.

## El loop, paso a paso
1. **Implementa** la tarea (fase de arquitectura/backend/frontend/datos/integraciones que corresponda).
2. **Sombrero de seguridad.** Aplica el checklist de `security-baseline` sobre el código recién escrito, no sobre el proyecto en general — el foco es lo que acabas de tocar. Cualquier hallazgo crítico interrumpe el loop y vuelve al paso 1.
3. **Sombrero de QA.** Corre las pruebas relevantes y exige evidencia real (el comando de verificación corrido, con su resultado real a la vista) — nunca "probablemente funciona". Si algo falla, vuelve al paso 1.
4. **Sombrero de rendimiento** (solo antes de una release grande, no en cada tarea chica). Mide con `performance-baseline` antes de optimizar cualquier cosa.
5. Si los pasos 2-4 (los que apliquen) pasan limpio, la tarea puede pasar a "revisión" o "aprobada" en `tasks.md`.
6. **Chequeo de gap, de diez segundos (solo Nivel 2/3, nuevo en v4.1.0)**: ¿esta tarea necesitó resolver algo que ninguna skill ni criterio existente cubría bien? Si no, sigue. Si sí, una línea en `.cronos/gaps-detectados.md` (créalo si no existe — formato en `capability-gap-analysis`) con fecha y una frase del gap. Antes de agregarla, mira si ya hay una entrada parecida ahí: si esta es la segunda, es la señal de activar `capability-gap-analysis` dentro del proyecto — no hace falta esperar al cierre (ver esa skill, "Cuándo se activa").

## Criterio de corte (cuándo dejar de iterar)
- **Dos vueltas completas del loop con el mismo hallazgo sin resolver** → detente y explícaselo al operador en vez de intentar una tercera vez esperando un resultado distinto. Es preferible avisar que seguir iterando sin rumbo.
- **Un hallazgo que toca las reglas de oro de `AGENCY.md`** (desplegar, migración destructiva, hallazgo crítico de seguridad) → el loop no lo puede cerrar solo, sin importar cuántas vueltas dé. Esos puntos siempre requieren confirmación explícita del operador.
- **Si la tarea, tal como está escrita en `tasks.md`, no alcanza para completarse** (el alcance quedó corto) → dilo explícitamente, no fuerces un cierre artificial.

## Por qué esto no es "autoaprobarse"
El punto entero del loop es que el mismo agente se detenga ante evidencia contraria, exactamente igual que un auditor externo lo haría — la diferencia con la v2.0.1 de la agencia (10 Titanes separados) es quién lo hace, no qué tan exigente es el criterio. Si en algún punto el resultado de la autocrítica se siente como una formalidad en vez de una revisión real, es la señal de que el loop se está saltando, no de que ya no hace falta.

## Mitigación de la falta de una segunda mirada independiente
Un mismo modelo revisando su propio trabajo puede repetir el mismo punto ciego con el que escribió el código. Cuando el proyecto es Nivel 2/3, o cuando una tarea toca algo sensible (auth, pagos, datos personales), considera recomendar explícitamente un modelo distinto (o más fuerte en razonamiento) específicamente para el paso 2 del loop — ver `MODELOS.md`. No reemplaza el juicio humano, pero reduce la correlación entre "quién escribió el código" y "quién lo audita".

## Entregable
Estado de la tarea actualizado en `tasks.md`, con la evidencia del paso 3 (comando + resultado) y, si hubo hallazgos en el camino, un resumen breve de qué se encontró y cómo se corrigió.

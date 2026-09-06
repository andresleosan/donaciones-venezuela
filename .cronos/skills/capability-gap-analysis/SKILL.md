---
name: capability-gap-analysis
description: Usar al cerrar cualquier proyecto Nivel 2/3 (la última tarea de tasks.md pasa a "desplegada"), o apenas .cronos/gaps-detectados.md muestra una segunda entrada parecida en el mismo proyecto (ver self-critique-loop, paso 6). Detecta qué faltó y qué se repitió, registra la lección en LECCIONES.md, y solo propone una skill nueva al operador cuando el gap es real y recurrente — nunca instala ni promueve nada sin confirmación explícita.
---

# Capability Gap Analysis

## Cuándo se activa
- Al cerrar un proyecto Nivel 2/3 (última tarea de `tasks.md` → `desplegada`), como paso 7.5 de `MASTER_PROMPT.md`.
- Apenas `.cronos/gaps-detectados.md` tiene una segunda entrada parecida a una anterior, dentro del mismo proyecto (ver `self-critique-loop`, paso 6, nuevo en v4.1.0) — no hace falta esperar al cierre para esto.
- No se activa en Nivel 1: el overhead no se justifica en proyectos simples, mismo criterio que ya aplica el kit a Superpowers completo y al ciclo de autocrítica completo.

## Las preguntas del análisis
1. ¿Qué faltó? — algo que hubiera ayudado y no existía en `SKILLS.md` ni en `skills-custom/`.
2. ¿Qué se repitió? — un patrón, una investigación, o una decisión que ya se había tomado antes en otro proyecto y hubo que rehacer desde cero.
3. ¿Qué automatizaría? — de lo anterior, qué vale la pena convertir en skill o script reutilizable.
4. ¿Qué MCP o herramienta externa hubiera evitado construir algo a mano? — antes de proponer una skill nueva, aplica el criterio de `AGENCY.md`/Master Task: comprar/integrar antes que construir. Si existe un MCP o servicio que cubre el gap, la propuesta es usar ese, no escribir una skill.

## Si el gap es real (aparece 2+ veces, o representa fricción significativa en un solo proyecto)

**Primero, un chequeo contra `~/.cronos/LECCIONES.md` (nuevo en v4.1.0, ver `adr/ADR-012`):** ¿el mismo tipo de gap ya quedó registrado ahí, de un proyecto *distinto* al actual? Esto es posible porque `MASTER_PROMPT.md` ahora lee ese archivo al arrancar cualquier proyecto — debería ya estar en contexto, pero si no, léelo antes de decidir qué proponer.

- **Sin esa evidencia cross-proyecto todavía** → la propuesta es una skill **local a este proyecto**. Sigue en la sección de abajo tal cual.
- **Con esa evidencia** (el mismo gap ya apareció en otro proyecto) → la propuesta es directamente una skill **global**, porque ya demostró que no es una necesidad de un solo proyecto. Salta a "Promoción a skill global" más abajo.

Genera una propuesta breve — no la instales sola:
- Problema concreto que resolvería.
- 1-2 casos de uso reales donde hubiera ayudado (de este proyecto o de `LECCIONES.md`).
- Por qué ninguna skill existente de `SKILLS.md` alcanza.
- Esbozo de contenido (2-3 líneas, no la skill completa todavía).

Pregunta explícitamente: **"Detecté una capacidad que falta. ¿la incorporamos como skill nueva de este proyecto?"** — si el operador confirma, se escribe el `SKILL.md` completo en `.cronos/skills/<nombre>/` de este proyecto únicamente. No toca `skills-custom/` del kit ni `SKILLS.md` — esa skill vive y se usa solo acá hasta que se promueva (ver abajo).

## Promoción a skill global
Se activa en dos casos: (a) el chequeo cross-proyecto de arriba ya encontró evidencia de un segundo proyecto al proponer, o (b) una skill que ya es local a un proyecto anterior resulta útil de nuevo acá — en ambos, es la misma pregunta.

Pregunta explícitamente: **"Esta capacidad ya se necesitó en [proyecto anterior] y acá también. ¿la promuevo a skill global, disponible en todos los proyectos?"** Si el operador confirma:
1. Relee el `SKILL.md` local antes de promoverlo — ¿la `description` es lo bastante precisa para que la plataforma la active en el contexto correcto y no en otros? Una skill escrita rápido, a mitad de una tarea concreta, no siempre queda bien redactada para el catálogo general. Ajústala si hace falta, con el operador, antes del paso 2.
2. Ejecuta (o pide al operador que ejecute, si no tienes acceso confiable a la ruta del kit fuente — ver `RIESGOS.md` R-012) `scripts/promover-skill.sh <ruta-a-la-skill-local>`.
3. Deja registrada la promoción en `~/.cronos/LECCIONES.md` de inmediato, no esperes al cierre del proyecto.

Nunca promuevas ni instales nada de forma global sin este paso de confirmación explícita — es la misma mitigación que ya exige `RIESGOS.md` R-016 desde `ADR-008`, aplicada ahora también acá.

## Registro en `LECCIONES.md` (siempre, haya o no propuesta de skill)
Cada cierre agrega una entrada con: fecha, proyecto, categoría (skill faltante / MCP faltante / lección de arquitectura / lección de seguridad / otra), qué pasó, y qué se haría distinto la próxima vez. Ver formato en `LECCIONES.example.md`. El archivo real vive en `~/.cronos/LECCIONES.md` — ruta absoluta y compartida entre las 3 plataformas soportadas (ver `AGENCY.md`, tabla de componentes globales), no dentro de este proyecto ni de `.cronos/` local. Cuando el gap se detecta y se propone antes del cierre (activación proactiva), registralo en el momento, no esperes al 7.5 para dejar constancia.

## Por qué esto no es lo mismo que `RIESGOS.md` o `ROADMAP.md`
Esos dos son gobierno del kit mismo — no se cargan en sesión (ver tabla de componentes en `AGENCY.md`). `LECCIONES.md` es memoria operativa de los proyectos que Cronos construye: sí se lee en sesión (incluido al arrancar cada proyecto nuevo, desde v4.1.0), y alimenta al kit indirectamente (una lección repetida varias veces es evidencia fuerte para justificar un cambio en `RIESGOS.md` o `ROADMAP.md`, pero el registro en sí no es gobierno).

## Qué NO hacer
- No propongas una skill nueva por un gap que apareció una sola vez y no fue significativo — eso es ruido, no una lección (mismo criterio de calibración que ya aplica el kit: no generalizar de una sola observación).
- No escribas la skill local, ni la promuevas a global, sin la confirmación explícita del operador en cada uno de los dos pasos por separado — confirmar lo local no confirma automáticamente la promoción después, son dos decisiones distintas con dueños distintos (ver `GOBERNANZA.md`, matriz RACI).
- No saltees el registro en `LECCIONES.md` "porque no hubo gap" — si no hubo nada que registrar, igual déjalo explícito en el cierre del proyecto en vez de omitir el paso en silencio.

## Entregable
Entrada nueva en `LECCIONES.md` y, si aplica, una propuesta breve de skill (local o de promoción) esperando confirmación (no un `SKILL.md` ya escrito sin confirmar, ni una promoción ya aplicada sin confirmar).

---
name: browser-qa-e2e
description: Usar en proyectos Nivel 2/3 con UI web, cuando el proyecto tiene Playwright MCP habilitado (`STACK.md`). Cubre pruebas funcionales end-to-end estructuradas — login, navegación entre módulos, CRUD, formularios, tablas — con captura de errores, capturas de pantalla y reporte HTML. Es el diseño real de lo que `AGENCY.md` ya menciona como "E2E con Playwright MCP" en el paso de QA del `self-critique-loop`, y lo que `advanced-qa-strategy` ya da por hecho que existe. Nueva en v3.3.0 (`ADR-010`).
---

# Browser QA E2E

## Cuándo se activa

Cuando el proyecto está clasificado Nivel 2 o 3, tiene una UI web alcanzable por navegador, y `STACK.md` tiene `¿Playwright MCP habilitado?: sí`. En Nivel 1 no se activa — sería la misma fricción innecesaria que ya evita Superpowers completo en ese nivel (ver `AGENCY.md`, Clasificación de proyectos).

No reemplaza el paso de QA del `self-critique-loop` — es cómo se ejecuta esa parte cuando el proyecto tiene UI web. Si el proyecto no tiene frontend (una API pura, un script), esta skill no aplica y el paso de QA sigue con pruebas unitarias/de integración normales.

## Qué cubre (Fase 1, alcance completo)

- **Login automático** — si el proyecto tiene autenticación, la suite entra con credenciales de un entorno de prueba dedicado, nunca con las de producción (coordina con `security-baseline` el mismo tratamiento que cualquier otra credencial; ver también `external-integrations` para servicios como Firebase/Supabase).
- **Navegación entre módulos** — recorre las rutas/pantallas principales definidas en `STACK.md`/`tasks.md`, no solo la pantalla que acaba de tocar la tarea actual.
- **Pruebas CRUD** — crear, leer, actualizar, eliminar sobre las entidades principales del proyecto, verificando que el estado persistido coincide con lo esperado (no solo que "la pantalla no tira error").
- **Validaciones de formularios** — casos válidos e inválidos (campos requeridos, formatos, límites) sobre los formularios que la tarea tocó.
- **Verificación de tablas** — de listados/grillas: paginación, orden, filtros si el proyecto los tiene.
- **Captura automática de errores** — cualquier fallo de la suite queda con capturas de pantalla del momento del fallo, no solo el mensaje de la aserción.
- **Reporte HTML** — generado por cada corrida (`@playwright/test` lo hace de fábrica); vive en `qa/reports/` del proyecto, no se versiona (ver `gitignore.template`).

## Cómo se ejecuta

- **Desde Cronos, dentro de su propio turno** — Cronos usa Playwright MCP como herramienta durante el paso 3 (sombrero de QA) del `self-critique-loop`, exactamente igual que ya usa los subagentes de ejecución de Superpowers "como herramienta... no como agentes de la agencia" (`SKILLS.md`). Cronos no delega esto a un agente separado.
- **Manual** — `npx playwright test` desde `qa/` del proyecto, fuera de una sesión de Cronos, para quien prefiera correrla a mano.
- **Desde CI/CD** — mismo comando que el manual, corrido por el pipeline (GitHub Actions u equivalente) en cada push/PR. Ver el pendiente de `ROADMAP.md` ("CI real corriendo `verificar-kit.sh`") — ese ítem cubre el kit mismo; correr la suite de `browser-qa-e2e` en CI es un pendiente separado, del proyecto, documentado en `STACK.md` (campo "CI/CD" de la sección Hosting/Despliegue) cuando el proyecto lo adopte.

## Disciplina no negociable

- Nunca reporta una tarea de UI como aprobada sin la evidencia real de esta skill (comando corrido + resultado, Principio 8 de `AGENCY.md`, "Nada de humo") cuando la skill aplica.
- Nunca usa credenciales de producción para el login automático — siempre un entorno/usuario de prueba dedicado.
- Un fallo de la suite es un hallazgo del paso 3 del `self-critique-loop`: vuelve al paso 1 (implementar), igual que cualquier otro hallazgo de QA — no se "reintenta hasta que pase" sin entender por qué falló.
- Si el mismo fallo persiste después de dos vueltas del loop, se detiene y se explica al operador — mismo criterio de corte que ya define `self-critique-loop`.

## Qué NO cubre (ver `advanced-qa-strategy` y roadmap)

- Exploración autónoma guiada por una instrucción de alto nivel ("verifica que X funcione correctamente" sin especificar los pasos) — capa planeada para `advanced-qa-strategy` en una versión posterior (ver `docs/PROPUESTA-QA-BROWSER-INTELLIGENCE.md`).
- Comparación visual / detección de regresión visual — misma nota, capa planeada aparte.
- Autocorrección de tests rotos por cambios de UI — planeada, acotada a "propone, nunca aplica sola", en una versión posterior.

## Entregable

Suite de pruebas E2E en `qa/tests/` del proyecto + reporte HTML de la corrida más reciente en `qa/reports/` (no versionado) +, si hubo hallazgos, resumen breve de qué falló y cómo se corrigió, igual que el resto del `self-critique-loop`.

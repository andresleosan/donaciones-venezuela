# SKILLS.md — Catálogo de skills de Cronos

Las skills definen el criterio y la disciplina de Cronos, con o sin delegación. Los subagentes temporales ejecutan unidades acotadas, pero no reemplazan skills ni restauran los 10 `titanes/*.template.md`: Cronos carga el criterio aplicable, lo incluye en el encargo y conserva la revisión final.

## Cómo funcionan (mecanismo, no listado a mano)
- El formato `SKILL.md` de estas skills es el estándar abierto "Agent Skills" — no es una convención propia de OpenCode: Codex CLI y VS Code/Copilot lo descubren y cargan con el mismo mecanismo (verificado por documentación al 2026-08-03, ver `adr/ADR-011`; en VS Code/Copilot el soporte es más nuevo y sin comandos con `$nombre-skill` todavía — verifica en tu propia instalación antes de asumir paridad total con las otras dos). En las 3, Cronos no las invoca "a mano" citando el nombre, pero sí debe saber que existen y verificar, antes de dar una tarea por terminada, que aplicó la que correspondía. Si una tarea de frontend salió y Cronos no puede señalar qué dijo `frontend-craft` al respecto, es señal de que no la aplicó de verdad, no de que no hacía falta.
- `npx autoskills` es un mecanismo aparte, también agnóstico de plataforma: detecta el stack técnico de cada proyecto (React, Django, etc.) e instala skills específicas de ese stack. Las de este catálogo son skills de **criterio y disciplina**, no de sintaxis de un framework — se complementan, no compiten.
- Todas viven en `skills-custom/` en el kit fuente. Se copian a `~/.config/opencode/skills/` y `~/.codex/skills/` con `scripts/instalar-global.sh`, y a `.cronos/skills/` de cada proyecto con `scripts/nuevo-proyecto.sh`/`adoptar-proyecto.sh` (necesario para VS Code, que no tiene instalación global — ver `adapters/vscode/README.md`).

## Skills base — se aplican en cualquier nivel de proyecto (1, 2 o 3)
Reemplazan el checklist "no negociable" que antes vivía embebido en cada plantilla de Titán como "Reglas de oro" y "Responsabilidades continuas".

| Skill | Reemplaza a (v2.0.1) | Qué cubre |
|---|---|---|
| **`self-critique-loop`** | El mecanismo mismo de coordinación entre Titanes | Cómo y cuándo correr el ciclo de autocrítica del Paso 7 de `MASTER_PROMPT.md`: orden de las fases, criterio de corte, qué hacer si un hallazgo no converge. |
| **`security-baseline`** | Crío (checklist mínimo) | Autenticación/autorización, datos sensibles expuestos, secretos hardcodeados, `.gitignore`, validación de entradas, dependencias vulnerables, rate-limiting. |
| **`backend-patterns`** | Prometeo | Validación y sanitización de entradas, manejo de errores, contratos de API, gestión de secretos vía variables de entorno — nunca hardcodeados. |
| **`database-design`** | Tetis | Normalización por defecto, migraciones con rollback documentado, backup verificado antes de una migración destructiva. |
| **`frontend-craft`** | Hefesto (proceso de diseño) | Evitar el default genérico de cualquier framework; proceso de tres capas (sistema de diseño cuantitativo si hay `ui-ux-pro-max`, criterio cualitativo propio, referencia visual real). |
| **`performance-baseline`** | Hiperión | Medir antes de optimizar; detectar N+1 queries, renders innecesarios, assets sin comprimir; nunca optimización especulativa. |
| **`deploy-checklist`** | Jápeto | Las condiciones de despliegue innegociables, plan de rollback, documentación de cada release. |
| **`external-integrations`** | Océano | Clientes de API externos, rate limits y reintentos con criterio, manejo seguro de credenciales de terceros. |
| **`design-benchmark`** | Nada — capacidad nueva en v3.1.0 (Cronos Omega) | Recolecta 2-3 referencias visuales reales del mismo rubro antes de diseñar frontend; produce un Design DNA (paleta, tipografía, tono) que `frontend-craft` usa como punto de partida cualitativo. Se activa una vez por proyecto, no en cada tarea. |
| **`browser-qa-e2e`** *(nueva en v3.3.0)* | Nada — hueco real detectado en `docs/PROPUESTA-QA-BROWSER-INTELLIGENCE.md` | Pruebas E2E reales con Playwright MCP: login, navegación, CRUD, formularios, tablas, captura de errores con pantallazo, reporte HTML. Se activa en Nivel 2/3 con UI web, cuando `STACK.md` declara Playwright MCP habilitado — condición nueva de `deploy-checklist`. |

## Skills avanzadas — se activan según el nivel del proyecto (mayormente 2 y 3)
Heredadas de v2.0.1 sin cambios de fondo — solo se actualizó la referencia de "rol de [Titán]" a "Cronos las aplica cuando...", porque ya no hay un Titán separado que las use.

| Skill | Cuándo se activa |
|---|---|
| **`product-strategy`** | Al priorizar backlog o decidir qué NO construir todavía. |
| **`mvp-roadmap-planning`** | Al cortar un producto en versiones (MVP, v2, v3). |
| **`advanced-architecture`** | Nivel 3: monolito vs. servicios separados, patrones de comunicación entre módulos. |
| **`advanced-qa-strategy`** | Nivel 3: pruebas de contrato, de carga, casos límite de seguridad — más allá del testing funcional de `security-baseline`. |
| **`scalability-patterns`** | Nivel 3, después de medir un cuello de botella real con `performance-baseline`. |
| **`technical-governance`** | Al documentar una decisión técnica costosa de revertir (ADR). |
| **`cost-intelligence`** *(nueva en v3.1.0)* | Nivel 2/3, o en cualquier nivel al integrar un servicio de pago (IA, hosting por uso, base de datos gestionada). |
| **`capability-gap-analysis`** *(nueva en v3.1.0, proactiva desde v4.1.0)* | Al cerrar un proyecto Nivel 2/3, o apenas `.cronos/gaps-detectados.md` muestra el mismo gap dos veces dentro del mismo proyecto — no hace falta esperar al cierre (ver `adr/ADR-012`). Nunca instala una skill nueva ni la promueve a global sin confirmación explícita del operador, en cada uno de los dos pasos por separado. |

## Skills promovidas, pendientes de revisión curada
`scripts/promover-skill.sh` agrega una fila acá cada vez que una skill pasa de local a global (ver
`skills-custom/capability-gap-analysis/SKILL.md`, "Promoción a skill global") — demostraron servir
en 2+ proyectos reales, pero todavía no tuvieron la misma pasada de curación que las skills de las
tablas de arriba (una `description` bien escrita importa para que la plataforma la active en el
contexto correcto, no en cualquiera). Revísalas cuando puedas; cuando le tengas una descripción
curada a una, muévela a la tabla que corresponda arriba y borra la fila de acá.

| Skill | Promovida desde | Fecha |
|---|---|---|
<!-- scripts/promover-skill.sh agrega filas nuevas debajo de esta línea, no la borres -->

## Componentes externos que complementan a estas skills
- **Superpowers** (`obra/superpowers`): metodología completa de desarrollo — TDD, git worktrees, subagentes de ejecución (usados como *herramienta* dentro del propio turno de Cronos, no como agentes de la agencia), code review. Se activa sola según el nivel.
- **`ui-ux-pro-max`** (opcional, de terceros): generador cuantitativo de sistemas de diseño, consultado por `frontend-craft` como punto de partida.

## Qué NO hacer con las skills
- No las cites de memoria ni improvises su contenido — si el `skill` tool las cargó, usa lo que dicen; si no se cargaron y la tarea las necesita, dilo explícitamente en vez de seguir sin ellas.
- No saltees `security-baseline` "porque es Nivel 1 y parece simple" — el checklist mínimo de seguridad aplica en cualquier nivel; lo que cambia con el nivel es cuánto más allá de ese mínimo se hace (`advanced-qa-strategy`, `scalability-patterns`).
- No uses una skill avanzada de Nivel 3 en un proyecto Nivel 1 solo porque está disponible — es fricción innecesaria, mismo criterio que ya aplica a Superpowers completo.

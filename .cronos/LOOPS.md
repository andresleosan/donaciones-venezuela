# LOOPS.md — Ejecución continua: qué son /loop y /goal, y cómo se usan en la agencia

Investigado y verificado el 2026-07-10 contra el estado público de OpenCode, su tracker de
issues, y el ecosistema de plugins de la comunidad. **Ninguna prueba de este archivo se corrió
contra una sesión real de OpenCode con credenciales de modelo** — a diferencia de la verificación
de `permission`/`tools` que sí se corrió empíricamente para `AGENCY.md` (`opencode debug agent`),
esto es investigación de documentación pública y repos. Trátalo con el mismo criterio que ya pide
`AGENCY.md` para todo lo demás: verifica contra tu propia instalación antes de confiar a ciegas,
sobre todo porque este es, de lejos, el terreno más nuevo y más cambiante de todo el kit.

> **Nota v1.5.0:** una segunda pasada, independiente, repitió esta misma investigación el mismo día
> y llegó a los mismos resultados — repos, issues (incluidos los números exactos) y plugins
> citados abajo se confirmaron uno por uno contra la fuente real. Lo que faltaba no era corregir
> este archivo, sino conectarlo con el resto del kit: los checkpoints A4.1/B3.1 y la sección
> "Ejecución continua" que este archivo ya daba por hechos en la sección "Cómo se usa" (al final)
> no existían todavía en `MASTER_PROMPT.md` ni en `titanes/*.template.md` — ya existen desde esta
> versión (ver `CHANGELOG.md`). También se corrigió que `scripts/instalar-global.sh` nunca copiaba
> los comandos de Capa 1 pese a que este archivo ya lo daba por hecho, y se renombró `command/` a
> `commands/` (la convención vigente confirmada contra `opencode.ai/docs`).

## Punto de partida honesto: /loop y /goal NO son nativos de OpenCode

A julio de 2026, OpenCode no trae un comando `/loop` ni `/goal` de fábrica:

- El pedido más directo de un `/goal` nativo (`anomalyco/opencode` issue #29721, "matching Claude
  Code's feature") **fue cerrado como "not planned"** por el equipo del proyecto (28 de mayo de
  2026).
- Hay una propuesta más ambiciosa y todavía viva rondando el tracker (issues #27167/#27162, y un
  PRD detallado en #27339 — "Goal Mode plugin pair and TUI plugin runtime") que plantea un modo de
  objetivos persistente de verdad, con runtime, persistencia y UI propia — pero explícitamente
  como un **par de plugins oficiales más un runtime de plugins de TUI**, no como algo ya
  incorporado al core. No hay confirmación de que esto haya enviado nada usable todavía. Si en el
  momento de leer esto ya existe, sería la opción a preferir sobre todo lo que sigue en este
  archivo — confírmalo con `opencode --version` y con `opencode.ai/docs` antes que nada.
- Lo que sí existe, confirmado y estable: OpenCode tiene comandos personalizados nativos (archivos
  `.md` en un directorio `commands/`, ver más abajo) — pero un comando personalizado es una
  plantilla de prompt que se dispara una vez al invocarla, no un mecanismo de reintento/loop en
  segundo plano. Un issue del propio tracker de OpenCode lo dice de forma explícita: "esto no es
  implementable como plantilla de comando porque necesita persistencia, continuación en runtime,
  contabilidad de uso y superficies de estado sincronizadas con el cliente."

Todo lo que hoy se llama "`/loop`" o "`/goal`" en el ecosistema de OpenCode es, en consecuencia,
**un plugin de terceros** (no oficial, no mantenido por el equipo de OpenCode) que engancha los
hooks de plugin de OpenCode (`session.idle`, `experimental.session.compacting`, etc.) para
reinyectar un prompt de continuación cada vez que la sesión queda inactiva. Existen varios,
independientes entre sí, resolviendo el mismo problema de formas distintas — ver la tabla más
abajo.

## Dos capas, no una

### Capa 1 — Comandos nativos (sin dependencias, disponible siempre)

OpenCode carga comandos personalizados desde archivos Markdown en `commands/` (global:
`~/.config/opencode/commands/`; por proyecto: `.opencode/commands/`) — confirmado contra la
documentación oficial vigente (`opencode.ai/docs/commands`). Nota: alguna documentación/espejo más
vieja usa `command/` en singular — si tus comandos no aparecen al escribir `/`, confirma el nombre
exacto de la carpeta contra `opencode.ai/docs/commands` en tu versión instalada antes de asumir que
algo está roto.

Esta agencia instala dos comandos globales de este tipo (`scripts/instalar-global.sh` los copia a
`~/.config/opencode/commands/`, igual que ya hace con `skills/`):

- **`/cronos-continuar`** — reanuda a Cronos sobre la tarea actual de `tasks.md` sin que
  tengas que reescribir el contexto a mano. No crea un loop de verdad (sigue siendo un solo turno:
  el modelo debe decidir, dentro de su propia secuencia de llamadas a herramientas, seguir
  trabajando en vez de parar) — pero es exactamente lo que ya hacías a mano en cada vuelta del
  Paso 7 de `MASTER_PROMPT.md`, ahora reutilizable con un solo comando.
- **`/cronos-verificar-objetivo <condición> --comando "<verificación>"`** — variante orientada a
  objetivo: le pide a Cronos que no reporte la tarea como terminada sin evidencia
  verificable (correr `<verificación>` y mostrar el resultado), en línea directa con el Principio 8
  de `AGENCY.md` ("Nada de humo") y con el paso de QA del `self-critique-loop`.

Esta capa no reemplaza tu supervisión: si el modelo decide parar y pedir tu confirmación a mitad de
camino, sigue pudiendo hacerlo — un comando personalizado no puede forzarlo a lo contrario, y por
las reglas de oro de esta agencia (ver más abajo), en varios puntos es exactamente lo que
*debería* hacer.

### Capa 2 — Plugin de continuación automática (opcional, Nivel 2/3, con la misma disciplina que Superpowers)

Para un loop de verdad — que OpenCode retome solo cuando la sesión queda inactiva, sin que nadie
vuelva a escribir nada — hace falta un plugin de terceros. **No se instala por script ni viene
activado por defecto en `adapters/opencode/opencode.template.json`**, por el mismo motivo que Superpowers tampoco: es
código de un tercero que hoy en día cambia de semana a semana, así que se instala a propósito, con
versión fijada, y documentado en `STACK.md` — nunca por inercia.

#### Paso 1 — Descubrir el estado actual (esta tabla va a quedar vieja; no la copies sin revisar)

Antes de elegir, repite una búsqueda rápida del ecosistema (`opencode goal plugin`, `opencode loop
plugin`) — es un espacio con más de media docena de proyectos independientes resolviendo lo mismo,
y aparecen/desaparecen mantenedores seguido. Esto es lo que se encontró y verificó por
documentación el 2026-07-10:

| Proyecto | Qué ofrece | Con qué se queda esta agencia (a julio de 2026) |
|---|---|---|
| `ByBrawe/opencode-loop` (npm `@bybrawe/opencode-loop`) | `/loop`, `/loop-ask`, `/loop-command` (continuación por temporizador, estilo "auto-continue"), más un `/loop-goal` **experimental** que fusiona temporizador + condición de objetivo. Trae controles de seguridad reales: `--safe`, `--stop-file`, `--branch` (aísla el trabajo en una rama), `/loop-pause`/`/loop-resume`/`/loop-remove`, y `/loop-doctor` para diagnóstico. Es "idle-safe": no dispara un turno nuevo mientras OpenCode sigue ocupado. | Es el único que cubre `/loop` Y una variante de `/goal` en un solo paquete, y su set de controles de seguridad es el que mejor encaja con la cultura de checkpoints de esta agencia. **Candidato principal a evaluar primero.** |
| `mirsella/opencode-goal` (npm `opencode-goal`) | El más citado como "el original" por los demás proyectos de esta tabla. `/goal <objetivo>`, continuación automática al quedar inactivo, estado persistido en disco, expone `update_goal({status:"complete"})` para que el propio modelo cierre el loop solo tras verificar. Paquete chico (3 dependencias), mantenimiento activo. | Buena opción si se prefiere algo minimalista sobre el `/loop-goal` más nuevo/experimental de arriba. |
| `prevalentWare/opencode-goal-plugin` | Hardening explícito sobre `willytop8/OpenCode-goal-plugin` (ver abajo): historial de ciclo de vida, checkpoints, indicador visual de objetivo en la TUI, y — el dato más relevante para esta agencia — **`restricted_agents` excluye por defecto al agente `plan` de poder ejecutar un objetivo sin pasar por confirmación**, con `allow_goal_execution_from_plan` en `false` por defecto. Ese default de seguridad es exactamente la filosofía de "aprobación humana en lo crítico" de esta agencia, ya incorporada de fábrica en el plugin. | Candidato fuerte específicamente para las fases de seguridad y QA del `self-critique-loop`, donde el cierre de un objetivo debería exigir evidencia, nunca autoconfirmarse. |
| `willytop8/OpenCode-goal-plugin` | Muy documentado, con tests y una sección de límites honesta. **Dato puntual importante: su propio README documenta que en OpenCode v1.17.15 — la misma versión exacta contra la que está verificado el resto de este kit — el texto de salida del hook no se renderiza en la TUI** (el comando igual funciona a nivel de estado, solo no se ve bien en pantalla). Antes de adoptar este plugin puntual, confirma si ese detalle sigue vigente en tu versión instalada. | Se documenta por transparencia, no se descarta — pero ese hallazgo puntual es motivo suficiente para probarlo a fondo antes de confiar, más todavía porque coincide con la versión de OpenCode que ya usa esta agencia. |
| `VerbalChainsaw/opencode-autogoal` | El más conversacional: además del comando, expone herramientas para que el propio modelo fije/gestione el objetivo a partir de lenguaje natural ("sigue hasta que pasen los tests"), más un CLI standalone (`opencode-autogoal`) para manejarlo desde afuera de OpenCode (CI, cron). Requiere OpenCode ≥ 1.16 (compatible con la v1.17.15 de esta agencia). | Interesante si se quiere disparar el loop desde CI/CD (posible punto de contacto futuro con `deploy-checklist`) — pero suma más superficie (más herramientas, más dependencias) que las opciones de arriba. |
| `oh-my-goal` (npm) | El más liviano: sin herramientas conversacionales, sin CLI — solo continuación por `session.idle` y detección de cierre por marcadores de texto (`GOAL_ACHIEVED:`/`GOAL_BLOCKED:`). "No hace orquestación de modelos" por diseño. | Opción de bajo compromiso si algo de lo anterior resulta demasiado para el proyecto. |

Ningún nombre de esta tabla es una recomendación cerrada — es, literalmente, el mismo tipo de
tabla "ilustrativa" que ya usa `MODELOS.md` para modelos: el criterio de elegir importa más que la
lista, porque la lista va a estar vieja en semanas.

#### Paso 2 — Antes de confiar en cualquiera de estos, en producción

Misma exigencia que ya aplica hoy a Superpowers (`README.md`) y a los modelos (`MODELOS.md`):

1. Instalar con una **versión exacta fijada** (`npm install -g <paquete>@X.Y.Z`, nunca `@latest` a
   ciegas — la mayoría de estos paquetes son semver real vía npm, más simple de fijar que el
   `git+...#TAG` que exige Superpowers).
2. Correr `opencode debug agent cronos` antes y después de instalarlo, igual que ya se hace en la
   sección "Verificación recomendada" de `README.md` — confirmar que el plugin no cambia
   silenciosamente los `permission` ya definidos en `opencode.json` para Cronos.
3. Probarlo primero en una tarea de bajo riesgo (una sola tarea de `tasks.md`, en una rama aparte
   si el plugin lo soporta) antes de dejarlo correr sobre una tarea grande sin supervisión.
4. Registrar en `STACK.md` qué plugin y qué versión se instaló — mismo campo que ya existe para
   Superpowers.
5. Recordar el precedente ya documentado en `MODELOS.md` sobre plugins de fallback de modelos que
   se quedan reintentando sin saltar de verdad al alterno: la lección — "un plugin de terceros que
   promete automatizar algo crítico se prueba a fondo antes de confiar, no se asume que hace lo que
   dice el README" — aplica exactamente igual acá.

## Reglas de oro para /loop y /goal en esta agencia (no negociables)

Ni la Capa 1 ni la Capa 2 pueden usarse para automatizar lo que `AGENCY.md` ya protege con
aprobación humana explícita. Un loop o un objetivo:

- **Nunca** se configura con una condición de éxito que incluya desplegar a producción, aplicar una
  migración destructiva, o resolver un hallazgo crítico de seguridad. Esas decisiones siguen siendo
  siempre manuales, con o sin loop activo — ver Principio 12 en `AGENCY.md`. En los plugins
  de la Capa 2 que soportan un campo `constraints`/restricciones (varios de la tabla de arriba lo
  traen), escribe ahí explícitamente lo que el objetivo NO puede tocar — no confíes solo en que el
  modelo lo va a recordar del contexto general.
- Se aplica **a una sola tarea de `tasks.md` por vez**, no al proyecto entero de punta a punta. Un
  objetivo del tipo "termina todo el proyecto" es exactamente el tipo de alcance difuso que hasta
  la documentación de estas herramientas recomienda evitar.
- El cierre de un objetivo exige evidencia verificable (correr los tests, mostrar el resultado) —
  igual que ya exige el paso de QA del `self-critique-loop`. Si el plugin elegido tiene un modo "el
  modelo decide solo si terminó" sin evidencia, no lo uses así en esta agencia.
- Llegar a un punto que las reglas de oro de `AGENCY.md` reservan para el operador (deploy, migración
  destructiva, hallazgo crítico sin resolver) **siempre pausa el loop**, aunque el plugin
  técnicamente pudiera seguir. Es responsabilidad de Cronos reconocer ese punto y detenerse, no
  del plugin.
- Nivel 1: sin loop/goal, es fricción innecesaria — mismo criterio de proporcionalidad que ya
  aplica a Superpowers.

## Cómo se usa

- **Cronos** ofrece la Capa 2 como paso opcional (A3.1/B3.1 en `MASTER_PROMPT.md`) solo en
  proyectos Nivel 2/3, después de recomendar modelo y antes de construir — nunca la activa sin que
  el operador la confirme explícitamente.
- **Cronos** puede usar `/cronos-continuar` (Capa 1) libremente en cualquier nivel del Paso 7 — no
  requiere confirmación porque no automatiza nada que antes no hiciera un humano reescribiendo el
  mismo prompt.
- Ni la Capa 1 ni la Capa 2 dispensan del `self-critique-loop`: un loop que retoma solo, sin pasar
  por el ciclo de autocrítica antes de marcar una tarea como lista, no es un loop más eficiente —
  es uno que se saltó la parte que sostiene la calidad de todo el kit.

## Nota de alcance: Codex CLI y VS Code (v4.0.0)

Todo lo de arriba — Capa 1 y Capa 2, con sus comandos y plugins concretos — es investigación
específica del ecosistema de OpenCode (ver `AGENCY.md`, "Versión y compatibilidad", para las
fuentes y la fecha). No se investigó a la misma profundidad un equivalente para Codex CLI o VS Code
en la ronda que trajo soporte multiplataforma (`adr/ADR-011`) — hacerlo hubiera significado repetir
esta misma investigación completa para dos ecosistemas más, y el pedido que originó esa ronda era
específicamente sobre plataformas y modelos, no sobre paridad de automatización de continuación.

Lo que sí se sabe, a nivel de mecánica general (no verificado con el mismo rigor que arriba):
- **Codex CLI** tiene `codex exec` para correr una tarea de forma no interactiva/scripteada, y
  persistencia de sesión nativa — un punto de partida razonable si se quiere investigar un
  equivalente de Capa 2, pero no es lo mismo que un plugin de retomado automático.
- **VS Code/Copilot** tiene "custom chat modes" y hooks de agente (`before`/`after` tool use) que
  podrían jugar un rol similar al de los plugins de Capa 2, sin haberse investigado en profundidad.

Hasta que alguien haga esa investigación (ver `ROADMAP.md`), el criterio en Codex CLI y VS Code es
más simple: la Capa 1 se reemplaza pidiéndole a Cronos, directamente en lenguaje natural, lo mismo
que dice `commands/cronos-continuar.md`/`commands/cronos-verificar-objetivo.md` (pegar el texto tal
cual funciona en las 3 plataformas), y la Capa 2 directamente no se ofrece como checkpoint en A3.1/B3.1
de `MASTER_PROMPT.md` para estas dos plataformas — no porque esté descartada, sino porque no hay
nada concreto y verificado que ofrecer todavía.

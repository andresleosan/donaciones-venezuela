# Diseño de subagentes controlados para Cronos

**Fecha:** 2026-08-06  
**Estado:** aprobado en conversación; pendiente de plan de implementación  
**Alcance:** núcleo global de Cronos, plantillas multiplataforma y copia del proyecto actual  
**Objetivo:** permitir delegación selectiva sin transferir la autoridad, los checkpoints ni las reglas de oro de Cronos

## 1. Decisión

Cronos seguirá siendo el único agente primario, interlocutor del operador y autoridad final. Podrá crear subagentes temporales para investigación, implementación, pruebas o revisión independiente cuando la delegación reduzca tiempo o puntos ciegos.

No se restaurará la arquitectura de Titanes permanentes. La especialización será dinámica y acotada a cada tarea para evitar coordinación innecesaria y consumo elevado de tokens.

## 2. Responsabilidad de Cronos

Cronos conserva de forma exclusiva:

- decisiones de producto y priorización;
- decisiones arquitectónicas costosas de revertir;
- clasificación de severidad y cierre de hallazgos críticos;
- checkpoints y confirmaciones humanas;
- aprobación y estado final de tareas;
- commits, PR, releases, migraciones y despliegues;
- verificación final de seguridad, pruebas y rendimiento.

Un reporte de subagente nunca constituye evidencia suficiente por sí solo. Cronos inspeccionará los archivos/diff y repetirá las verificaciones relevantes antes de aceptar el resultado.

## 3. Capacidades delegables

Los subagentes podrán:

- explorar archivos y relaciones del código;
- investigar documentación pública;
- implementar una unidad de trabajo con archivos delimitados;
- escribir y ejecutar pruebas locales;
- revisar código con foco técnico específico;
- diagnosticar una falla reproducible sin modificar producción.

Cada delegación deberá declarar:

- objetivo y criterio de éxito;
- archivos permitidos;
- archivos o áreas prohibidas;
- restricciones de seguridad y operación;
- comandos de verificación requeridos;
- formato conciso de entrega: hallazgos, archivos, comandos y resultados.

## 4. Prohibiciones de subagentes

Un subagente no podrá:

- crear otros subagentes ni ampliar su propio alcance;
- leer `.env`, credenciales, historiales de shell o gestores de secretos;
- hacer commit, amend, push, PR, release o cambios de configuración Git;
- desplegar o modificar infraestructura remota;
- activar servicios facturables o generar gasto nuevo;
- ejecutar migraciones productivas o destructivas;
- borrar datos, restaurar backups o acceder a credenciales reales;
- modificar archivos fuera del conjunto asignado;
- aprobar tareas ni cambiar estados finales en `tasks.md`;
- ocultar una prueba fallida o afirmar éxito sin evidencia real.

Si detecta un hallazgo crítico de seguridad, una posible acción destructiva o una tensión que exige criterio del operador, detendrá su tarea y devolverá el control a Cronos.

## 5. Política de despacho

Cronos delegará cuando exista al menos una de estas condiciones:

1. Dos o más tareas independientes pueden ejecutarse sin compartir estado.
2. Una búsqueda amplia puede resolverse en paralelo por áreas no superpuestas.
3. Una segunda revisión especializada reduce un punto ciego relevante.
4. Una unidad del plan tiene contrato, archivos y pruebas suficientemente aislados.

Cronos no delegará:

- cambios triviales que resuelve más barato en un solo contexto;
- decisiones irreversibles o checkpoints humanos;
- tareas que requieran secretos o acceso productivo;
- trabajo cuya frontera no pueda describirse con precisión;
- una corrección que dependa de cambios aún no revisados de otro subagente.

## 6. Tipos y concurrencia

- `explore`: investigación y lectura; no modifica archivos.
- `general`: implementación o pruebas dentro de archivos asignados.
- Máximo tres subagentes simultáneos por defecto.
- La concurrencia menor prevalece cuando hay riesgo de solapamiento o consumo innecesario.
- No existe delegación anidada.

Cuando una corrección depende directamente de una tarea ya delegada, Cronos reanudará la misma sesión del subagente para evitar recargar contexto. No repetirá por su cuenta el trabajo delegado mientras está en curso.

## 7. Control de tokens

- El prompt incluye solo contexto necesario y referencias precisas a archivos.
- Las búsquedas se dividen por áreas independientes, no por agentes redundantes.
- La respuesta del subagente será breve y estructurada.
- Cronos evita reenviar el historial completo y reutiliza `task_id` cuando corresponde.
- No se convocan agentes permanentes por especialidad.
- El máximo de tres es un techo, no un objetivo de utilización.

## 8. Propagación de reglas

Cada prompt delegado incluirá explícitamente, aun si la plataforma hereda instrucciones globales:

1. Un hallazgo crítico de seguridad bloquea la tarea.
2. No hay aprobación sin pruebas reales.
3. No hay despliegue, migración destructiva ni gasto nuevo.
4. No se leen secretos ni se modifica Git.
5. Solo se modifican archivos asignados.
6. El subagente no delega.
7. Cambios inesperados de terceros no se revierten.
8. El resultado vuelve a Cronos para revisión independiente.

Esta repetición es defensa en profundidad frente a runtimes que no garanticen herencia completa del prompt primario.

## 9. Plataformas

### OpenCode

- `agent.cronos.permission.task` quedará en `"allow"` explícitamente en `~/.config/opencode/opencode.json`, `~/.config/opencode/cronos/opencode.template.json` y el `opencode.json` del proyecto actual.
- `subagent_depth` quedará fijado en `1`, límite nativo que impide delegación anidada.
- El agente no declarará permisos amplios de `bash`/`edit`: heredará los patrones globales para no anular reglas `deny`/`ask` por orden de evaluación.
- Cronos usará tipos `explore` y `general` disponibles en el runtime.
- Los permisos destructivos y de secretos seguirán en `deny`/`ask` según la configuración vigente.

### Codex CLI y VS Code

- La política será la misma cuando el runtime disponga de delegación/subagentes.
- Si la plataforma no ofrece el mecanismo, Cronos ejecutará inline sin simular una delegación inexistente.
- Los adaptadores no reinterpretarán ni debilitarán las reglas de fondo.

## 10. Archivos afectados

Núcleo global:

- `~/.config/opencode/AGENTS.md`
- `~/.config/opencode/cronos/AGENCY.md`
- `~/.config/opencode/cronos/MASTER_PROMPT.md`
- `~/.config/opencode/cronos/SKILLS.md`
- `~/.config/opencode/cronos/MODELOS.md`
- `~/.config/opencode/cronos/opencode.template.json`
- `~/.config/opencode/cronos/VERSION`
- `~/.config/opencode/cronos/CHANGELOG.md`
- `~/.config/opencode/opencode.json`

Proyecto actual:

- `AGENTS.md`
- `.cronos/AGENCY.md`
- `.cronos/MASTER_PROMPT.md`
- `.cronos/SKILLS.md`
- `.cronos/MODELOS.md`
- `.agencia-version`
- `opencode.json`

La implementación debe mantener sincronizado el núcleo local con el global sin sobrescribir reglas específicas del proyecto no relacionadas con delegación.

El cambio incrementará el núcleo de `4.1.0` a `4.2.0`; `VERSION`, `.agencia-version` y `CHANGELOG.md` registrarán la misma versión.

## 11. Verificación

### Configuración

- Ambos JSON deben parsear.
- `agent.cronos.permission.task` debe resolver como `allow` y `subagent_depth` como `1`.
- Las protecciones de secretos, migraciones y producción deben permanecer vigentes.

### Canary de herencia

Cronos invocará un subagente `explore` de solo lectura limitado a `README.md`. El canary deberá devolver, sin leer secretos:

- las ocho reglas de delegación recibidas;
- confirmación de que no puede delegar;
- el primer encabezado y un resumen de dos frases de `README.md`.

Si omite o contradice una regla, la habilitación general queda bloqueada hasta corregir el prompt/configuración.

### Canary de ejecución

Después del canary de herencia, un subagente `general` podrá crear únicamente `docs/superpowers/canary-subagent.tmp.md` con el contenido exacto `canary-subagent-ok`, verificarlo y reportarlo. Cronos verificará:

- que no tocó otros archivos;
- que reportó comandos y resultados reales;
- que no hizo commit ni operación remota;
- que el cambio pasa la verificación repetida por Cronos.

Cronos eliminará el archivo canary después de verificarlo; no formará parte del producto ni de un commit.

## 12. Rollback

Antes de editar, se conservará una copia de los archivos globales afectados en `C:\Users\USER\AppData\Local\Temp\opencode\cronos-subagents-backup-20260806`. El rollback consiste en:

1. Restaurar núcleo y plantilla global previos.
2. Restaurar copia local previa del proyecto.
3. Eliminar o cambiar a `deny` `agent.cronos.permission.task`.
4. Repetir parseo/configuración.
5. Confirmar que Cronos vuelve a ejecución inline.

No se hará commit, despliegue ni cambio remoto como parte de esta configuración salvo solicitud explícita posterior.

## 13. Criterios de aceptación

1. La documentación global y local describe a Cronos como agente primario con delegación controlada, sin contradicciones de “nunca delega”.
2. La herramienta `task` está habilitada explícitamente con `permission.task = allow` y `subagent_depth = 1`.
3. Las reglas de oro y prohibiciones se incluyen en cada prompt delegado.
4. La concurrencia por defecto no supera tres subagentes.
5. Canary de herencia y canary de ejecución pasan.
6. Cronos repite las verificaciones y conserva la aprobación final.
7. Las protecciones de secretos, producción, migraciones y gasto no se debilitan.
8. Existe rollback verificable.

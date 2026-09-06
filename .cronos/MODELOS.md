# MODELOS.md — Cómo Cronos descubre y recomienda qué modelo usar en cada fase

Este archivo no es un catálogo fijo de modelos. Los proveedores, los modelos gratuitos y sus catálogos cambian todo el tiempo — lo que tenía sentido hardcodear en julio de 2026 puede no existir en un mes. Por eso describe un **proceso de descubrimiento y un criterio de recomendación por fase**, no una lista de nombres.

## Por qué "por fase" y no "por Titán" (cambio desde v3.0.0)
Hasta v2.0.1, cada uno de los 10 Titanes tenía su propio modelo asignado en `opencode.json`. Desde v3.0.0, Cronos usa un modelo primario activo por sesión y desde v4.2.0 puede crear subagentes temporales con lo que el runtime tenga disponible. Eso no restaura modelos fijos por Titán: Cronos sigue recomendando por fase y conserva la revisión final, especialmente en seguridad y QA.

Lo usa Cronos en A3/B3 de `MASTER_PROMPT.md` (al crear o auditar un proyecto) y en el paso 7.1 de cada tarea (al cambiar de fase), y `scripts/elegir-modelo.sh` para cambiarlo manualmente en cualquier momento.

## Paso 1 — Descubrir qué hay realmente disponible en esta máquina
El mecanismo de descubrimiento depende de la plataforma detectada en el Paso 0 de `MASTER_PROMPT.md` — el criterio de las fases (Paso 2) es idéntico en las tres, ninguna restringe qué proveedor o modelo se puede usar.

### OpenCode
- `opencode auth list` — qué proveedores están conectados ahora mismo.
- `opencode models` — el catálogo real y usable: siempre incluye los modelos gratuitos `opencode/*` (curados por OpenCode mismo, sin necesitar cuenta con otro proveedor), más los de cualquier proveedor que ya esté conectado.
- `opencode models <id> --verbose` — el detalle de un modelo puntual: costo por token, tamaño de contexto, y qué soporta (razonamiento extendido, tool-calling, adjuntos). Úsalo sobre los candidatos serios antes de decidir, no adivines las capacidades por el nombre.
- Si no hay ningún proveedor pago conectado, los modelos `opencode/*` gratuitos alcanzan para arrancar sin pedirle nada a nadie. Si el operador quiere algo más potente después, se conecta con `/connect` y se reasigna con `scripts/elegir-modelo.sh`.
- `adapters/opencode/opencode.template.json` no declara ningún modelo por defecto (ni en la raíz ni en `agent.cronos.model`) — a propósito, desde v4.0.2, para que nunca fuerce un valor que termine inválido en la cuenta/instalación de quien lo use (ver `CHANGELOG.md` [4.0.2]: un string de respaldo tipo `opencode/mimo-v2-5-free` puede dejar de existir o no estar disponible según el proveedor, y OpenCode lo rechaza con error en vez de ignorarlo). Sin ese campo, OpenCode usa el modelo que ya tengas seleccionado manualmente — nunca lo pises escribiendo un valor "por si acaso" en el template.

### Codex CLI
- Dentro de una sesión, `/model` abre un selector con todo lo disponible para la cuenta/proveedores configurados — úsalo en vez de asumir un nombre de memoria.
- `/status` muestra la configuración activa (modelo, proveedor, esfuerzo de razonamiento).
- Revisa `~/.codex/config.toml` y `.codex/config.toml` (si existe) por bloques `[model_providers.*]` ya declarados — Codex CLI no está limitado a modelos de OpenAI: cualquier proveedor compatible con su API (Anthropic, OpenRouter, Azure, un modelo local vía Ollama/LM Studio, etc.) se agrega ahí, ver `adapters/codex/config.toml.template`.
- Nunca asumas que el `model` de `adapters/codex/config.toml.template` está disponible — mismo criterio que el de OpenCode: es solo un respaldo para que el archivo sea TOML válido, no una recomendación.

### VS Code (GitHub Copilot)
- El selector de modelos vive en la propia vista de Chat de Copilot (ícono de modelo) — ahí aparecen los modelos incluidos en el plan de Copilot, más cualquier modelo agregado vía BYOK (Bring Your Own Key: Anthropic, Gemini, OpenAI, OpenRouter, Azure, Ollama/Foundry Local).
- No hay un archivo de proyecto que declare un modelo por defecto, a diferencia de `opencode.json`/`config.toml` — la elección es en vivo, por sesión, desde ese selector. Esto no es una restricción: de las tres plataformas, es la que menos fricción tiene para probar un modelo nuevo, porque no requiere editar ningún archivo.
- Si BYOK aparece deshabilitado, suele ser por política de organización (Copilot Business/Enterprise) — avísalo al operador, no es algo que Cronos pueda resolver desde el proyecto.

## Paso 2 — Qué conviene en cada fase (aplica esto a lo que exista HOY)
Esto es un criterio, no nombres de modelos — se aplica a lo que devuelva el Paso 1, sea lo que sea:

| Fase | Prioriza en el modelo disponible |
|---|---|
| Producto y alcance / arquitectura y stack | Razonamiento sostenido en contexto largo — decisiones de alcance y estructura, un error acá se propaga a todo el proyecto. |
| Backend | Generación de código fuerte y tool-calling confiable — se escriben y editan archivos todo el tiempo. |
| Frontend | Generación de código fuerte, con buen criterio de diseño si el modelo lo permite evaluar. |
| Datos (esquema, migraciones) | Razonamiento estructurado — un error de esquema es caro de revertir. |
| Integraciones externas | Contexto amplio para digerir documentación de APIs de terceros. |
| **Seguridad (autocrítica)** | El más exigente de todos: razonamiento fuerte + contexto grande. Es el paso con veto — no es el lugar para ahorrar con el modelo más débil disponible. Si el proyecto es Nivel 2/3, considera usar un modelo **distinto** al que escribió el código (ver `security-baseline` y `RIESGOS.md` R-015: reduce el punto ciego de que el mismo modelo audite su propio trabajo). |
| **QA (autocrítica)** | Sigue instrucciones de test al pie de la letra — prioriza instruction-following por sobre creatividad. |
| Rendimiento | Razonamiento analítico/cuantitativo (medir antes de optimizar). |
| DevOps / despliegue | Tool-calling confiable para tareas repetitivas; no necesita el modelo más potente de la lista — buen lugar para aprovechar algo más liviano o gratuito si el presupuesto importa. |

Regla práctica: las fases con veto (seguridad, QA) o que definen alcance/estructura (producto, arquitectura) van primero a lo que tenga mejor razonamiento y contexto entre lo disponible. Las fases de ejecución repetitiva (DevOps) pueden ir a algo más liviano sin perder mucho.

## Paso 3 — Recomendar, no decidir solo
- **Al crear o auditar un proyecto (A3/B3 de `MASTER_PROMPT.md`):** con el Paso 1 y el Paso 2, arma una recomendación para la fase que sigue, con el motivo, y muéstrasela al operador antes de escribir el archivo de configuración de la plataforma detectada (`opencode.json`, `.codex/config.toml` — VS Code no tiene archivo que escribir, ver Paso 1) — checkpoint como A2.1.
- **En cada transición de fase (paso 7.1 de `MASTER_PROMPT.md`):** dile al operador, en una línea, si el modelo activo sigue siendo el más adecuado para la fase que arranca o si convendría cambiarlo — sin bloquear el trabajo si prefiere seguir con el actual. No repitas la recomendación si la fase no cambió respecto a la tarea anterior.
- Si el operador prefiere elegir él mismo en vez de tu recomendación, se hace así.

## Paso 4 — Alterno ante caída de proveedor (sigue aplicando)
Cronos con un solo proveedor conectado no tiene a dónde saltar si ese proveedor cae o llega a su límite de cuota. Si hay más de un proveedor conectado, el alterno debería ser de uno DISTINTO al principal — prioridad especial en las fases de seguridad y arquitectura. Si solo hay un proveedor conectado en esta máquina, dilo explícitamente en `STACK.md` como limitación conocida, en vez de ignorarlo.

Si un proveedor cae en producción: en OpenCode, reemplaza el `model` en `opencode.json`; en Codex CLI, el `model`/`model_provider` en `.codex/config.toml`; en VS Code, simplemente cambia la selección en el selector de modelos del Chat. Reconecta el alterno (`/connect` en OpenCode, la clave correspondiente en Codex CLI/VS Code) si hace falta. Ninguna de las 3 plataformas salta de modelo sola ante una caída — ese cambio siempre es manual.

## Ejemplo ilustrativo (NO es una recomendación — es solo para entender el tipo de resultado esperado)
Así podría verse una secuencia real de recomendaciones a lo largo de un proyecto, con lo que el operador tenía conectado en ese momento (julio de 2026). Nombres de modelo así de específicos quedan viejos rápido — no los copies sin correr el Paso 1 tú mismo primero:

| Fase | Modelo recomendado en ese momento | Motivo |
|---|---|---|
| Arquitectura y stack | `glm/glm-5.2` | Generalista fuerte, buen razonamiento sostenido. |
| Backend / Frontend | `kimi/kimi-k2.7-code` | Especializado en generación de código. |
| Seguridad (autocrítica) | `deepseek/deepseek-v4-pro` | Modelo distinto al usado en implementación — reduce el punto ciego de autoauditoría; fuerte en análisis de código existente. |
| DevOps / despliegue | `deepseek/deepseek-v4-flash` | Tool-calling confiable, más liviano para tareas repetitivas. |

## Modelos locales (opcional)
Si hay inferencia local disponible (GPU propia), el Paso 1 no la va a mostrar en `opencode models` — hay que configurarla aparte según la documentación de OpenCode para el proveedor local que corresponda. Un modelo local no tiene "proveedor" que caiga, pero tampoco sirve como alterno si lo que falla es la propia máquina — documenta ese trade-off si se usa como alterno de la fase de seguridad.

## Sobre automatizar esto con un plugin de fallback (investigado para OpenCode)
Antes de reemplazar el cambio manual del Paso 4 por un plugin de terceros, pruébalo a fondo: reportes actuales muestran plugins de fallback que se quedan reintentando el mismo modelo en vez de saltar al alterno configurado (repo de terceros `code-yeongyu/oh-my-openagent`, issues #3937 y #1420: el fallback no se dispara ante rate-limit/caída y la sesión queda reintentando indefinidamente). El fallback nativo entre modelos *distintos* sigue siendo, a julio de 2026, un pedido de feature abierto en el núcleo de OpenCode (`anomalyco/opencode`, issues #7602, #8687, #8673, #20100, #25150) — no algo ya incorporado. Esta sección es específica del ecosistema de OpenCode; no se investigó un equivalente para Codex CLI o VS Code en esta ronda (ver `adr/ADR-011`).

## Cómo se usa
- **Al crear o auditar un proyecto (A3/B3 en `MASTER_PROMPT.md`):** Cronos corre el Paso 1 para la plataforma detectada, aplica el Paso 2, y recomienda (Paso 3) antes de escribir nada.
- **En cada transición de fase dentro del Paso 7:** recomendación breve, sin bloquear si el operador prefiere no cambiar.
- **Para cambiar el modelo en cualquier momento sin recrear el proyecto:** `scripts/elegir-modelo.sh` — detecta qué configuración de plataforma existe en el proyecto y muestra lo disponible en vivo antes de preguntar (en OpenCode, corriendo `opencode models`; en Codex CLI, mostrando el `model`/`model_provider` actual de `.codex/config.toml` para editarlo; en VS Code, recordando que el cambio se hace desde el selector de Copilot, no desde este script).
- **Ojo con `scripts/actualizar-proyecto.sh`:** trae la configuración de cada plataforma de vuelta al default de respaldo del core, así que pisa cualquier personalización de modelo que se haya hecho antes. Si ya se había elegido un modelo a medida, vuelve a correr `elegir-modelo.sh` después de actualizar.

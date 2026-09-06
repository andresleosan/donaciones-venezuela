# Controlled Cronos Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Tasks 1-2. Subagents are enabled only after those tasks pass; Task 3 is the controlled canary.

**Goal:** habilitar delegación temporal global en Cronos 4.2.0 sin transferir autoridad ni debilitar seguridad, pruebas o checkpoints humanos.

**Architecture:** Cronos permanece como agente primario. OpenCode habilita `task` con `agent.cronos.permission.task = allow` y limita anidación con `subagent_depth = 1`; el núcleo global y la copia local definen una política portable con máximo tres subagentes, prompts con reglas explícitas y verificación independiente por Cronos.

**Tech Stack:** Markdown de gobernanza, JSON OpenCode, PowerShell 5.1, `opencode debug config`, subagentes `explore`/`general`.

## Global Constraints

- Versión objetivo exacta: `4.2.0`.
- No commits, despliegues, migraciones, gasto, secretos ni operaciones remotas.
- Backup: `C:\Users\USER\AppData\Local\Temp\opencode\cronos-subagents-backup-20260806`.
- Máximo tres subagentes simultáneos; no delegación anidada.
- Los subagentes no aprueban tareas ni modifican Git.
- La copia del proyecto se sincroniza sin sobrescribir reglas no relacionadas.

---

### Task 1: Backup y núcleo global 4.2.0

**Files:**
- Backup: `C:\Users\USER\AppData\Local\Temp\opencode\cronos-subagents-backup-20260806\*`
- Modify: `C:\Users\USER\.config\opencode\AGENTS.md`
- Modify: `C:\Users\USER\.config\opencode\cronos\AGENCY.md`
- Modify: `C:\Users\USER\.config\opencode\cronos\MASTER_PROMPT.md`
- Modify: `C:\Users\USER\.config\opencode\cronos\SKILLS.md`
- Modify: `C:\Users\USER\.config\opencode\cronos\MODELOS.md`
- Modify: `C:\Users\USER\.config\opencode\cronos\opencode.template.json`
- Modify: `C:\Users\USER\.config\opencode\cronos\VERSION`
- Modify: `C:\Users\USER\.config\opencode\cronos\CHANGELOG.md`
- Modify: `C:\Users\USER\.config\opencode\opencode.json`

**Interfaces:**
- Produces: política global `Delegación controlada`, versión 4.2.0, `agent.cronos.permission.task = allow` y `subagent_depth = 1`.
- Preserves: reglas de oro y permisos existentes.

- [ ] **Step 1: verificar precondiciones y crear backup**

Verificar que existan `C:\Users\USER\AppData\Local\Temp\opencode` y `C:\Users\USER\.config\opencode\cronos`. Crear el directorio fechado y copiar los nueve archivos afectados conservando nombres y estructura `cronos/`.

Expected: backup contiene `AGENTS.md`, `opencode.json` y siete archivos bajo `cronos/` más `VERSION`/`CHANGELOG.md` según la lista.

- [ ] **Step 2: actualizar identidad global**

Cambiar “agente único que no delega” por “agente primario con delegación controlada”. Mantener explícito que Cronos es único interlocutor y autoridad final.

Agregar a `AGENCY.md` una sección `## Delegación controlada` con:

```markdown
- Delegar solo tareas acotadas de investigación, implementación, pruebas o revisión.
- Máximo tres subagentes simultáneos; no delegación anidada.
- `explore` es solo lectura; `general` puede editar únicamente archivos asignados.
- Cada prompt repite las ocho reglas de delegación.
- Subagentes no leen secretos, no modifican Git, no despliegan, no migran, no generan gasto y no aprueban tareas.
- Cronos inspecciona diff/archivos y repite pruebas antes de aceptar resultados.
```

- [ ] **Step 3: actualizar flujo y catálogo**

En `MASTER_PROMPT.md`, reemplazar la prohibición absoluta por política de despacho: delegar solo con frontera verificable; ejecutar inline si el runtime no soporta subagentes.

En `SKILLS.md`, explicar que las skills siguen definiendo criterio y que los subagentes son ejecución temporal, no Titanes permanentes.

En `MODELOS.md`, mantener un modelo primario por sesión y aclarar que un subagente puede usar el modelo disponible del runtime; seguridad/QA sigue requiriendo revisión final de Cronos.

- [ ] **Step 4: habilitar OpenCode global y plantilla**

En plantilla, cambiar descripción a:

```json
"description": "Cronos 4.2.0 — agente primario con delegación controlada: arquitectura, backend, frontend, datos, integraciones, seguridad, QA, rendimiento y despliegue"
```

Reemplazar el bloque deprecado `tools` del agente por el permiso mínimo:

```json
"permission": {
  "task": "allow"
}
```

En `~/.config/opencode/opencode.json`, añadir `"subagent_depth": 1` y bloque `agent.cronos` con `mode: primary` y `permission.task = "allow"`, sin alterar instructions, plugin, permisos ni proveedor.

- [ ] **Step 5: versionar núcleo y changelog sin Git**

Cambiar `VERSION` a `4.2.0`. Agregar al inicio de `CHANGELOG.md` una sección `## [4.2.0] — 2026-08-06` que documente delegación controlada, límite 3, prohibiciones, canaries y rollback.

- [ ] **Step 6: verificar global**

Parsear ambos JSON con `node -e`. Ejecutar `opencode debug config` y comprobar que no reporta errores. Buscar contradicciones activas `No delega en subagentes`/`no delega` fuera del changelog histórico.

---

### Task 2: Sincronización del proyecto actual

**Files:**
- Modify: `AGENTS.md`
- Modify: `.cronos/AGENCY.md`
- Modify: `.cronos/MASTER_PROMPT.md`
- Modify: `.cronos/SKILLS.md`
- Modify: `.cronos/MODELOS.md`
- Modify: `.agencia-version`
- Modify: `opencode.json`

**Interfaces:**
- Consumes: núcleo global verificado de Task 1.
- Produces: misma política 4.2.0 en el proyecto, conservando permisos y MCP específicos.

- [ ] **Step 1: sincronizar documentos**

Copiar contenido global 4.2.0 de los cinco documentos a sus equivalentes locales. Actualizar `AGENTS.md` local para permitir delegación controlada y mantener su resumen de reglas de oro.

- [ ] **Step 2: actualizar configuración local**

En `opencode.json`, cambiar descripción a 4.2.0, retirar `agent.cronos.tools`, declarar únicamente `agent.cronos.permission.task = allow`, y agregar `"subagent_depth": 1`. No declarar `bash/edit` a nivel del agente, ni cambiar los patrones bash globales o Playwright.

Cambiar `.agencia-version` a `4.2.0`.

- [ ] **Step 3: verificar sincronización**

Parsear `opencode.json`; comparar hashes global/local de `AGENCY.md`, `MASTER_PROMPT.md`, `SKILLS.md` y `MODELOS.md`. Expected: iguales. Confirmar que `AGENTS.md` conserva reglas específicas del proyecto.

---

### Task 3: Canaries y gate final

**Files:**
- Temporary create/delete: `docs/superpowers/canary-subagent.tmp.md`
- Verify: configuración global/local y documentos 4.2.0

**Interfaces:**
- Consumes: `task` habilitado y política de ocho reglas.
- Produces: evidencia real de herencia y ejecución controlada.

- [ ] **Step 1: canary `explore` de herencia**

Despachar un solo `explore` limitado a `README.md`. El prompt debe incluir las ocho reglas y pedir: repetirlas, confirmar que no delegará, devolver primer encabezado y resumen de dos frases. No puede escribir archivos.

Expected: 8/8 reglas, no delegación, lectura solo de `README.md`.

- [ ] **Step 2: canary `general` de escritura aislada**

Despachar un solo `general` autorizado únicamente a crear `docs/superpowers/canary-subagent.tmp.md` con contenido exacto `canary-subagent-ok`. Prohibir cualquier otro archivo/comando salvo verificación del contenido.

Expected: solo ese archivo nuevo, contenido exacto, sin commit ni operación remota.

- [ ] **Step 3: verificación independiente y limpieza**

Cronos lee el canary, inspecciona `git status --short`, confirma alcance y elimina el archivo temporal. Repetir JSON parse y `opencode debug config`.

- [ ] **Step 4: gate de seguridad**

Aplicar `security-baseline`: permisos de `.env`/secretos continúan, patrones de migración/producción siguen en `ask`, y ningún subagente recibió secretos.

- [ ] **Step 5: retomar Firebase**

Con canaries verdes, reanudar `docs/superpowers/plans/2026-08-06-cierre-gates-migracion-firebase.md` mediante `subagent-driven-development` para unidades independientes y revisión de Cronos entre tareas.

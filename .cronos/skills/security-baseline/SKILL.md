---
name: security-baseline
description: Usar como sombrero de auditor de seguridad dentro del self-critique-loop, sobre cualquier código recién escrito o modificado, en cualquier nivel de proyecto (1, 2 o 3). Checklist mínimo no negociable — no confundir con advanced-qa-strategy, que cubre casos límite de seguridad más profundos solo en Nivel 3.
---

# Security Baseline

## Cuándo se activa
En el paso 2 de `self-critique-loop`, siempre — sin importar el nivel del proyecto. Lo que cambia con el nivel es cuánto más allá de este checklist se hace (Nivel 3 suma `advanced-qa-strategy`), no si este checklist se corre.

## Checklist mínimo
- Endpoints sin autenticación/autorización verificada.
- Datos sensibles expuestos (identidad, ubicación, financieros) sin enmascarar — incluye logs y consola, no solo respuestas de API o base de datos.
- Secretos hardcodeados o mal gestionados.
- Existencia de un `.gitignore` apropiado y ausencia de secretos ya commiteados en el historial de git. Si algo se filtró, agregarlo al `.gitignore` no alcanza: hay que rotarlo (invalidar la credencial expuesta).
- Validación y sanitización de entradas — nunca confíes en lo que llega del frontend o de un cliente externo.
- Superficie de ataque de cualquier integración nueva (ver skill `external-integrations`).
- Dependencias con vulnerabilidades conocidas (`npm audit` u equivalente del stack).
- Rate-limiting / protección contra abuso en endpoints propios expuestos públicamente.

## Protecciones que ya da la plataforma (verifícalas, no las asumas — varían por plataforma)

**OpenCode** (verificado contra una sesión real, ver `docs/AUDITORIA-10-10-verificacion-R002.md`):
- Pide confirmación (`ask`) por defecto antes de leer archivos `.env`/`.env.*` (excepto `.env.example`) a nivel de la herramienta `read`, sin importar el `.gitignore`. Si en este proyecto puedes leerlos sin que se te pregunte, es señal de que `permission.read` fue sobrescrito en `opencode.json` — repórtalo como hallazgo.
- La misma protección existe a nivel del tool `bash` (`cat *.env*`, `cat *secret*`, `cat *credential*`, `env`, `printenv*`, `history` piden confirmación en `permission.bash`). Si detectas otro comando de `bash` que lea secretos sin disparar `ask` (variantes con `sed`/`awk`/`grep` que no calcen con los patrones actuales), repórtalo como hallazgo nuevo — estos patrones cubren los casos más comunes, no todos los posibles.

**Codex CLI y VS Code** (verificado solo por documentación pública al 2026-08-03, no contra una sesión real — ver `RIESGOS.md` R-019): ninguna de las dos tiene, confirmado, un mecanismo de patrón específico para archivos `.env` como el de OpenCode arriba. Lo que sí controlan es el acceso de archivo/comando en general: `sandbox_mode`/`approval_policy` en Codex CLI (`.codex/config.toml`), confirmación por herramienta en el chat de Copilot en VS Code. **No asumas que ninguna de las dos te va a frenar antes de leer un secreto** — en esas dos plataformas, este checklist mínimo es la protección real, no una capa extra sobre algo que la plataforma ya cubre. Si en tu instalación concreta encontrás un mecanismo de protección específico para `.env` en cualquiera de las dos, repórtalo para sumarlo acá con la misma precisión que tiene la sección de OpenCode.

## Entregables según el contexto
- Dentro del ciclo de autocrítica de una tarea puntual: hallazgos (si los hay) y su corrección, resumidos en el estado de la tarea.
- En Modo Auditoría (Flujo B de `MASTER_PROMPT.md`), sobre un proyecto entero: sección "Seguridad" de `AUDITORIA.md`, con hallazgos clasificados por severidad.

## Lo que esta skill NO cubre
- Pruebas de carga, de contrato entre servicios, o casos límite de seguridad más allá del checklist básico — eso es `advanced-qa-strategy`, solo en Nivel 3.
- Decisiones de arquitectura de seguridad (por ejemplo, elegir OAuth vs. sesión propia) — eso es una decisión de `STACK.md`, documentada con `technical-governance` si es costosa de revertir.

## Regla de oro
Un hallazgo crítico de esta checklist bloquea el avance de la tarea, sin excepciones y sin importar la urgencia — mismo peso que tenía el veto de Crío en versiones anteriores de la agencia.

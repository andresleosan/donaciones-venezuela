---
name: pragmatic-path-selection
description: Use when a task has multiple implementation paths, requires user setup, credentials, browser interaction, or an external integration, and a simpler reversible route may exist.
---

# Pragmatic Path Selection

## Principio

El objetivo es resolver el problema real con la menor friccion segura, no ejecutar
la ruta mas tecnica por inercia. Una sugerencia simple del usuario es una opcion
de primera clase y debe evaluarse antes de pedir configuracion permanente.

## Receta de decision

1. Define el resultado, los datos sensibles y las acciones prohibidas.
2. Inventaria accesos y herramientas ya disponibles: sesion interactiva, ventana
   del navegador, MCP/CDP, exportacion, API y fixtures.
3. Compara como maximo tres rutas:
   - **Interactiva y reversible:** el usuario inicia sesion manualmente y el
     asistente reutiliza una ventana aislada.
   - **Interfaz oficial:** exportacion o API documentada, preferida para cargas
     repetibles y grandes.
   - **Automatizada y persistente:** variables/gestor de secretos, adapter o
     runner; se construye solo cuando la repeticion lo justifica.
4. Puntua cada ruta por friccion del usuario, seguridad, reversibilidad,
   repetibilidad y evidencia disponible.
5. Elige la minima ruta que satisface el objetivo. Explica en una frase por que
   se descartan las otras.
6. Pide al usuario una sola accion concreta solamente cuando exista un bloqueo
   real. No pidas variables, archivos o credenciales si una ventana o sesion
   manual puede resolver el paso actual.
7. Tras una solucion puntual, pregunta si el proceso sera recurrente antes de
   convertirlo en adapter o configuracion permanente.

## Gates obligatorios

- **Gate de interfaz oficial:** para cargas masivas o repetibles, comprueba si
  existe exportacion/API oficial antes de pedir credenciales, dumps o archivos.
- **Gate de sesion:** una ventana abierta no prueba reutilizacion. Exige handshake
  CDP o conexion al mismo proceso, listado de target/contexto y una accion
  read-only exitosa antes de afirmar que la sesion esta disponible.
- **Gate de datos:** antes de extraer datos reales define destino, redaccion,
  alcance, retencion y rollback. Si falta uno, solo ejecuta discovery metadata o
  fixtures sinteticos.
- **Gate de secretos:** el mecanismo local debe tener minimo privilegio, alcance
  temporal, no aparecer en logs/historial y poder revocarse o eliminarse despues.

## Datos externos y secretos

- Para discovery puntual, prioriza una ventana aislada con login manual cuando
  el usuario la propone y el entorno puede reutilizarla.
- Para importacion repetible o masiva, prioriza API/exportacion oficial y minimo
  alcance; usa browser como fallback.
- Nunca uses, repitas ni guardes contrasenas pegadas en el chat.
- Nunca guardes cookies, storage state, filas, documentos o pagos crudos en Git,
  logs, memoria o fixtures versionados.
- Si la sesion interactiva no es conectable desde el entorno actual, dilo de
  inmediato y ofrece CDP, el mismo proceso Playwright o un mecanismo local de
  secretos. No simules que la sesion es reutilizable.

## Formato de salida

Toda decision debe terminar con:

- **Ruta elegida:** una opcion y su alcance.
- **Motivo:** seguridad y friccion comparadas.
- **Accion del usuario:** solo si es imprescindible, exacta y sin secretos.
- **Evidencia:** comando, ventana o prueba que confirma el paso.
- **Siguiente bifurcacion:** cuando pasar de ruta puntual a automatizacion.

## Red flags

- Pedir `ENV_VAR`, `.env` o archivo secreto antes de comprobar una sesion manual.
- Implementar un adapter antes de confirmar que el flujo externo existe.
- Rechazar una ruta interactiva solo porque no es la mas automatizada.
- Confundir una ventana abierta con una sesion conectable sin probarlo.
- Extraer datos reales antes de definir destino, redaccion y rollback.

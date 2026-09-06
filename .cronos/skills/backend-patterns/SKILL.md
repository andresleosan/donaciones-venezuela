---
name: backend-patterns
description: Usar al implementar lógica de negocio, endpoints o capa de API/datos, en cualquier nivel de proyecto. Cubre validación de entradas, manejo de errores, contratos de API y gestión de secretos — la disciplina básica de backend que antes vivía en la plantilla del Titán Prometeo.
---

# Backend Patterns

## Cuándo se activa
Cada vez que Cronos implementa o modifica lógica de negocio, endpoints, o la capa de datos del backend — antes de pasar al paso de autocrítica de `self-critique-loop`.

## Disciplina no negociable
- Valida y sanitiza toda entrada externa — nunca confíes en lo que llega del frontend, de un webhook, o de una integración externa.
- Nunca hardcodees secretos — usa el mecanismo de variables de entorno / gestor de credenciales ya definido en `STACK.md`.
- Define el contrato de datos (forma de request/response) antes de que el frontend lo consuma — no lo inventes sobre la marcha ni dejes que el frontend imponga la forma de los datos.
- Maneja errores de forma explícita: qué código de estado, qué mensaje, qué se loguea (sin filtrar datos sensibles — ver `security-baseline`) y qué no.
- Si la tarea toca el esquema de datos, resuelve el modelo con `database-design` antes de dar el backend por terminado — el backend sigue al esquema, no al revés.
- Si la tarea requiere un servicio externo, coordina con `external-integrations` el manejo de credenciales y reintentos antes de integrarlo.

## Preguntas antes de dar un endpoint por terminado
- ¿Qué pasa si la entrada viene vacía, con tipo incorrecto, o maliciosamente formada?
- ¿Este endpoint necesita autenticación/autorización, y está verificada (no solo asumida)?
- ¿El error que devuelve es útil para quien consume la API sin filtrar información interna sensible?

## Entregable
Código funcional + actualización del estado de la tarea en `tasks.md` a "revisión" — antes de pasar por el ciclo de autocrítica de `self-critique-loop`.

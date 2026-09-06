---
name: external-integrations
description: Usar al implementar o mantener clientes de APIs externas, webhooks, mensajería o pasarelas de pago, en cualquier nivel de proyecto donde el stack lo requiera. Cubre rate limits, reintentos con criterio y manejo seguro de credenciales de terceros — la disciplina que antes vivía en la plantilla del Titán Océano.
---

# External Integrations

## Cuándo se activa
Cada vez que el proyecto necesita conectarse con un servicio externo: API de terceros, webhook entrante o saliente, mensajería, pasarela de pago.

## Disciplina no negociable
- Maneja rate limits, reintentos y fallbacks con criterio — nunca reintentos infinitos sin backoff.
- Documenta cada integración: qué hace, qué credenciales necesita, qué pasa si falla (degradación esperada, no un error silencioso).
- Nunca expongas credenciales de terceros en código ni en logs — coordina con `security-baseline` el manejo seguro (variables de entorno, gestor de secretos).
- No decidas lógica de negocio interna dentro del cliente de integración — el cliente solo traduce el contrato externo, la lógica vive en el backend (`backend-patterns`).

## Preguntas antes de dar una integración por terminada
- ¿Qué pasa si el servicio externo está caído o responde lento? ¿El resto del sistema se degrada de forma controlada o se cae con él?
- ¿Las credenciales de este servicio están en el mismo lugar que las demás, con el mismo nivel de protección?
- ¿Hay un límite de reintentos, o el sistema puede quedar reintentando indefinidamente ante una falla persistente?

## Entregable
Cliente de integración funcional + documentación de la integración (qué hace, credenciales, comportamiento ante falla).

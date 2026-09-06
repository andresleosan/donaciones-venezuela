---
name: frontend-craft
description: Usar al construir o rediseñar una interfaz, para que el resultado no sea el default genérico que cualquier proyecto del mismo rubro produciría. Complementa (no reemplaza) a `ui-ux-pro-max` si está instalada — esa skill de terceros genera el sistema de diseño; esta aporta el criterio sobre qué hacer con él. Aplica en cualquier nivel de proyecto.
---

# Frontend Craft

## Cuándo se activa
Cada vez que Cronos arranca una interfaz nueva o rediseña una existente — antes de escribir el primer componente, no después. También si un sistema de diseño ya generado (por `ui-ux-pro-max` o cualquier otro método) se siente intercambiable con el de cualquier otro proyecto del mismo rubro.

## La pregunta antes de cualquier decisión visual
¿Esta elección sale de algo concreto en `BRIEF.md`, o es lo que cualquier agente produciría para "una app de [rubro]" en general? Si no puedes señalar el motivo puntual, es un default, no una decisión — y un default no está mal por default, pero hay que saber que lo es.

## Tres defaults frecuentes que hoy se notan como "hechos por IA"
- Fondo crema/beige con acento terracota y una serif de alto contraste.
- Fondo casi negro con un único acento flúo (verde ácido, magenta).
- Grillas tipo "bento" con numeración 01/02/03 decorando contenido que no es en realidad una secuencia.

Ninguno está prohibido — son válidos si el brief los pide. La señal de alarma es elegirlos porque "quedan bien" en cualquier proyecto, no porque este proyecto puntual los necesite.

## Proceso — dos pasadas, no una
1. **Define antes de construir.** Paleta (4-6 colores con motivo cada uno, no solo el hex), tipografía (roles: display / texto / datos-caption, pares deliberados en vez de la fuente por defecto del framework), un concepto de layout en una frase, y un elemento "firma": lo único que hace que esta pantalla se recuerde. Si `ui-ux-pro-max` está disponible, genera esto con ella primero — es un piso razonable del que partir, no el resultado final.
2. **Revisa contra el brief antes de programar.** Por cada decisión de la pasada 1: ¿es específica de este proyecto, o serviría igual para el proyecto de otro cliente en el mismo rubro? Lo que no pase esta prueba, se reemplaza — sin ese filtro, hasta un sistema de diseño técnicamente correcto queda genérico.

Recién ahí se escribe código, siguiendo lo ya decidido — no al revés, no improvisando estilo componente por componente.

## Piso de calidad — no negociable, independiente de cuánto riesgo se tome arriba
- Responsive hasta mobile, foco de teclado visible, `prefers-reduced-motion` respetado.
- Sin emojis como íconos (SVG). Estados de hover con transición. Contraste de texto 4.5:1 mínimo en modo claro.
- El texto de la interfaz nombra lo que la persona controla, nunca cómo está construido el sistema por detrás ("notificaciones", no "webhooks"). Una acción mantiene el mismo verbo de punta a punta: un botón "Guardar" produce un mensaje "Guardado".

## Sobre Mobbin como referencia
`mobbin.com/discover/sites/latest` es una librería curada de capturas de sitios/apps reales — útil para calibrar contra el estado del arte del rubro. Bloquea acceso automatizado, así que no es algo que un Titán pueda "traer" por su cuenta: si el brief lo justifica, es el operador quien la navega y trae puntos de referencia concretos a la conversación.

## Cuándo bajar el rigor
En Nivel 1 (landing simple, portafolio), aplica el criterio de "¿es específico de este brief?" igual, pero sin las dos pasadas formales — sería fricción desproporcionada para el alcance. El piso de calidad (responsive + accesibilidad básica) no se negocia ni ahí.

## Salida esperada
El sistema de diseño (paleta, tipografía, layout, elemento firma) documentado en `STACK.md` o `design-system.md` antes del primer componente, con una línea de justificación por decisión — mismo estándar que ya pide `technical-governance` para decisiones técnicas.

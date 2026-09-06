---
name: technical-governance
description: Usar para documentar decisiones técnicas irreversibles o costosas de revertir (elegir un proveedor, una base de datos, un lenguaje) de forma que quede claro por qué se tomaron. Aplica en proyectos Nivel 2 y 3.
---

# Technical Governance

## Cuándo se activa
Cada vez que Cronos toma una decisión que sería costosa de revertir después (elegir base de datos, proveedor de hosting, lenguaje principal, librería core) - no para decisiones triviales del día a día.

## Formato de un ADR (Architecture Decision Record)
```
# ADR-N: [título corto de la decisión]
Fecha:
Estado: propuesta / aceptada / reemplazada por ADR-M

## Contexto
¿Qué problema obliga a decidir esto?

## Decisión
¿Qué se decidió, en una frase?

## Alternativas consideradas
- Alternativa A - por qué se descartó
- Alternativa B - por qué se descartó

## Consecuencias
¿Qué se gana y qué se sacrifica con esta decisión?
```

## Checklist antes de adoptar una tecnología nueva
- ¿Resuelve un problema que ya tenemos, o es especulativo?
- ¿Alguien del equipo puede darle mantenimiento si el operador no está disponible?
- ¿Qué tan difícil es salir de esto si en 6 meses fue un error?

## Salida esperada
Carpeta `docs/adr/` en el proyecto con un archivo por decisión relevante, numerados en orden.

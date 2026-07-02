# Diseño — Panel interno por centro de acopio

> Documento de diseño. **No implementado aún.** Recoge las decisiones tomadas
> antes de codificar, para retomarlas cuando el JS esté modularizado (Fase 2).

## Objetivo

Que cada centro de acopio / hospital gestione en vivo lo que **necesita** y lo
que **ya tiene**, sin depender de un administrador central. Descongestiona el
sistema al distribuir la carga de actualización.

## Restricción de arquitectura

La app es **estática, sin backend de sesiones** (ver `AGENTS.md`). Por eso NO se
usa login con usuario/contraseña clásico, sino **acceso por token-link + PIN**,
reutilizando el patrón de tokens que ya existe para las facturas.

---

## Decisiones tomadas

### 1. Acceso: Token (en la URL) + PIN (aparte)

- El **token** viaja en la URL: `#centro/CTR-a1b2-c3d4-e5f6` (como `#seguimiento/`).
- El **PIN** NO viaja en la URL: se escribe al entrar. Segunda barrera.
- Hay que acertar **ambos** para entrar.

**Regla no-negociable de seguridad:** el PIN se guarda **hasheado**, nunca en
texto plano. Se usa `Utilities.computeDigest()` de Apps Script (nativo, sin
dependencias) con SHA-256 + salt. Al entrar se recalcula el hash y se compara.

**Límite conocido:** un PIN corto es adivinable por fuerza bruta y Apps Script no
tiene rate-limiting fácil. Mitigado por el token largo (primera barrera).
Suficiente para un fork de experimentación; para producción real haría falta
bloqueo tras N intentos.

### 2. Identidad: ID interno + nombre

- Cada centro tiene un `id_centro` único, independiente del nombre.
- Evita que dos centros con el mismo nombre (ej. dos "Cruz Roja") se mezclen.

**Sub-decisión de vínculo con la hoja `lugares`:**
- La hoja `lugares` hoy solo vincula por `Nombre` (no tiene `IdCentro`).
- **Empezar** vinculando por nombre único (sin tocar `lugares`).
- **A futuro** (paso separado): añadir columna `IdCentro` a `lugares` y migrar.

---

## Estructura de datos

### Hoja NUEVA: `centros_panel`

| Columna       | Descripción                                  |
|---------------|----------------------------------------------|
| id_centro     | ID interno único (ej. `C-000001`)            |
| token_centro  | Token público largo (ej. `CTR-a1b2-c3d4-...`)|
| pin_hash      | Hash SHA-256 del PIN (NUNCA el PIN en claro) |
| nombre        | Nombre del centro (único al registrar)       |
| tipo          | Hospital / Centro / etc.                     |
| telefono      | Contacto                                     |
| creado        | Fecha de alta                                |

### Hoja `lugares` (SIN CAMBIOS por ahora)

Sigue con: `Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado`.
El panel filtra sus filas por `Nombre`.

---

## Endpoints del backend (`apps-script/codigo.gs`)

| Acción                    | Qué hace                                              |
|---------------------------|-------------------------------------------------------|
| `registrar_centro_panel`  | Crea centro, genera id + token, guarda pin_hash, devuelve URL |
| `panel_centro`            | Valida token + PIN → devuelve datos del centro        |
| `actualizar_centro`       | Valida token + PIN → edita SOLO filas de ese centro   |

Reutiliza: `generarTokenPublico()`, patrón de `tokenFacturaValido()`, `textoPublico()`.

---

## Flujo de seguridad (dos barreras)

```
   URL con token          PIN aparte
      │                      │
      ▼                      ▼
  ¿token existe?    y    ¿hash del PIN coincide?   → acceso concedido
   (barrera 1)            (barrera 2)
```

Regla de aislamiento: `actualizar_centro` modifica **solo** filas cuyo centro
coincide con el token. Un bug aquí dejaría a un centro editar datos de otro — es
el punto que MÁS hay que testear.

---

## Plan de construcción incremental

- **Paso A** — Hoja `centros_panel` + `registrar_centro_panel` (token + pin_hash).
  Se prueba con `curl`, sin UI. Verificar que el PIN queda hasheado.
- **Paso B** — `panel_centro` + pantalla de PIN + vista de SOLO LECTURA.
  El centro entra con URL + PIN y VE sus datos.
- **Paso C** — `actualizar_centro` + edición (agregar/editar/quitar).
  El centro EDITA, con aislamiento estricto.
- **Paso D** (futuro, separado) — migrar a columna `IdCentro` en `lugares`.

Cada paso es funcional y mergeable por separado. Se puede parar en el B.

---

## Prerrequisito recomendado

Hacer la **Fase 2** (extraer el JS de `index.html` a módulos) ANTES de este
panel. Así el panel entra como un módulo nuevo y aislado (`js/panel-centro.js`)
en vez de engordar el `index.html`, y la lógica sensible (hash, aislamiento)
queda en archivos pequeños y testeables.

# Plan 02 — «Iniciar sesión» en la barra superior (problema 2)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 2026-07-15.
> Orden de ejecución: **1º** (todo lo demás que necesita sesión depende de esto).

**Meta:** un botón centrado en la barra superior que diga «Iniciar sesión»; con
sesión iniciada muestra el **nombre del usuario** y abre un menú (mis roles,
registrarme como…, cerrar sesión). Desde ahí se puede registrar **cualquier**
tipo de usuario o centro.

## Estado actual (verificado 2026-07-15)

- El login OTP **ya funciona**: `#acceso` pide el código con `/auth/v1/otp`,
  lo canjea con `/auth/v1/verify` y llama `acceso_perfil` (edge fn
  `supabase/functions/api/index.ts:570`) que devuelve `{email, roles[]}` con
  roles de `motorizados`, `voluntarios` y `centros_panel` por email.
- Cliente: `js/admin.js:1164-1240` (`#acceso-enviar-btn`, `#acceso-codigo`).
- **No hay persistencia**: la sesión vive en variables locales; al recargar se
  pierde. No hay nada en la barra superior.

## Tareas

### T1 — Persistir la sesión
- `js/core.js`: módulo de sesión. Guardar en `localStorage['dv-sesion']`:
  `{access_token, refresh_token, expires_at, email, nombre, roles}` justo
  después del `verify` exitoso (en `js/admin.js` donde hoy ya se tiene
  `sesion.access_token`, línea ~1228).
- Exponer `window.sesionActual()` → objeto o `null` (valida `expires_at`;
  si venció, intenta refresh con `/auth/v1/token?grant_type=refresh_token`;
  si falla, borra y devuelve `null`).
- Exponer `window.cerrarSesion()` (borra la clave + repinta la barra).
- ⚠️ Excepción consciente a la nota de CLAUDE.md sobre almacenamiento del
  navegador: esa regla es para *listados/datos*; una credencial de sesión es
  exactamente para lo que sirve `localStorage`. Nunca guardar el PIN de centro.

### T2 — Botón en la barra
- `index.html` (header, entre logo y selector de idioma): `<button id="btn-sesion"
  class="btn btn-soft">…</button>` centrado (el header es flex; usar
  `margin-inline:auto`, no valores mágicos — R4.2).
- Sin sesión: texto `t('session.login')` = «Iniciar sesión» / «Log in» → navega
  a `#acceso` y hace scroll al bloque del correo.
- Con sesión: muestra `nombre` (o el email si no hay nombre) + chevron; al
  tocar abre un `<dialog>` con `abrirModal()`: lista de roles (badge por tipo),
  enlaces «Registrar voluntario» (#voluntarios), «Registrar transportista»
  (flujo existente en #acceso), «Crear centro» (/crear-centro), y «Cerrar
  sesión». Así cumple «permita registrar cualquier tipo de usuario o centro».
- Repintar el botón en: carga, login, logout y `cambiarIdioma()` (R1.3).
  El modal usa `recordarModal()` para sobrevivir el cambio de idioma (R1.4).

### T3 — Al iniciar sesión desde #acceso, subir el nombre
- Tras `acceso_perfil`, elegir `nombre` = primer rol con nombre; guardarlo en
  la sesión (T1) y repintar la barra.
- Si el email no tiene ningún rol: el modal ofrece directamente los tres
  registros (es el caso «donante»: sesión válida sin rol, suficiente para
  denunciar — plan 01).

### T4 — i18n + versión
- Claves nuevas `session.*` en `locales/es.json` **y** `en.json` (R1.2).
- Subir `?v=` + `VERSION` (R5.4). Commit Luismadef45 (R5.5).

## Reglas para /reglas-loop (F2)

1. `external`: `python3 scripts/verificar-idioma.py` → exit 0.
2. `external`: `grep -c "sesionActual" js/core.js` ≥ 1 y
   `grep -rn "localStorage\['dv-sesion'\]\|dv-sesion" js/core.js` ≥ 1.
3. `self` (Playwright): sin sesión el header muestra «Iniciar sesión» en es y
   «Log in» en en; simular sesión escribiendo `dv-sesion` de prueba en
   localStorage + reload → el header muestra el nombre; área táctil ≥44px a
   390px; cero errores de consola. **No** enviar OTP reales en el loop (límite
   de correos): probar el pintado con sesión inyectada.
4. `self`: cambiar idioma con el modal de sesión abierto → no se cierra ni se
   vacía (R1.3/R1.4).

## Verificación final
Playwright a 390px y 1440px, es/en, cambio de idioma en caliente, consola
limpia, `?v=` nuevo en producción.

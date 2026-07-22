# Diseño — Reemplazar el OTP por correo + contraseña (Supabase Auth)

**Fecha:** 2026-07-22
**Estado:** aprobado por Luis (diseño). Pendiente: spec review → build.

## Contexto

Hoy el inicio de sesión (#acceso) usa **Supabase Auth OTP**: la persona pide un
código de 6 dígitos al correo (`/auth/v1/otp`) y lo teclea (`/auth/v1/verify`).
El código por correo es lento y va muy rate-limiteado (~2-4/hora) sin SMTP
propio. Luis quiere, **por ahora**, quitar esa "doble autenticación por correo"
y que los usuarios entren con **correo + contraseña normal**, más unas medidas
básicas de ciberseguridad.

Estado real verificado: **solo existe 1 usuario en `auth.users`** (ya con
contraseña) → la migración es nula. El cliente ya hace `authPost('otp'|'verify')`
en `services/api.js`; `acceso_perfil` (edge fn) valida el JWT y devuelve los
roles por correo. El limitador `rate_hit(ip, ventana, cubo, limite)→bool` ya
existe y sirve para ráfagas por segundo (basta truncar la ventana al segundo).

## Decisiones (trazable)

| # | Decisión | Valor | Origen |
|---|---|---|---|
| D1 | Mecanismo de login | Supabase Auth **correo + contraseña** (bcrypt de Supabase, sin cripto propia) | Luis: "registrarse con una contraseña normal y su correo" |
| D2 | Alcance | **Reemplazar el OTP para todos**: una cuenta con contraseña; los roles se enganchan por correo | AskUserQuestion 2026-07-22 |
| D3 | Teléfono | **Fuera de alcance por ahora** (necesita SMS); solo correo entra | AskUserQuestion (opción "Correo con confirmación de 1 clic") |
| D4 | Verificación | Soporte para **confirmación de 1 clic** (interruptor de Supabase), pero **APAGADA por ahora** (registro instantáneo, sin correo) hasta conectar SES (plan 05) | Luis 2026-07-22: "confirmación apagada por ahora" |
| D5 | Límite de ráfaga | **12 req/s por IP** en la edge function (5/s literal rompería las cargas multi-llamada de la app) | Luis 2026-07-22: "12/s" |
| D6 | Registros de rol | Sin cambios (siguen pidiendo correo+teléfono+cédula, sin contraseña). La cuenta se crea en #acceso con el mismo correo | Diseño; simplicidad "por ahora" |
| D7 | Anti-bots | Conservar honeypot + freno de 60 s (plan 05) en los formularios de auth | Diseño |

## Modelo de auth (D1, D2)

- **Registrarse**: `POST /auth/v1/signup` con `{email, password}` + apikey publishable.
  Con confirmación apagada (D4) devuelve sesión al instante.
- **Entrar**: `POST /auth/v1/token?grant_type=password` con `{email, password}`
  → sesión (`access_token`, `refresh_token`, …). Se guarda en `sessionStorage`
  `dv-acceso` (igual que hoy) y se llama `acceso_perfil` con el JWT.
- **Se elimina**: el paso del código de 6 dígitos y los helpers
  `solicitarCodigo`/`verificarCodigo`. `refrescarSesion` (refresh_token) se
  conserva. `acceso_perfil` **no cambia** (valida JWT, devuelve roles por correo).

## Frontend (#acceso)

- Dos modos en la misma vista: **Crear cuenta** y **Entrar** (toggle).
  - Crear cuenta: `correo`, `contraseña`, `repetir contraseña`. Mínimo **8
    caracteres** (validación cliente). Botón mostrar/ocultar contraseña.
  - Entrar: `correo`, `contraseña`. Enlace "¿Olvidaste tu contraseña?" queda
    **deshabilitado/oculto por ahora** (recuperación necesita SES).
- Conservar honeypot `#acceso-web` + freno de 60 s (D7) en ambos formularios.
- El perfil tras entrar (`pintarPerfilAcceso`) y `acceso_perfil` **no cambian**.
- i18n es/en de todo texto nuevo; bump de versión de assets.

## Backend (edge function `api`)

- **Límite de ráfaga (D5)**: primera comprobación de `handle()` —
  `rate_hit(ip, date_trunc('second', now()), 'burst', 12)`. Si falla →
  "Demasiadas solicitudes, baja el ritmo". Reutiliza `rate_limit` + `rate_hit`
  (no hay RPC nuevo). Va ANTES de la lógica por hora; `cron_tasa` (que corre por
  pg_cron, no por IP de usuario) queda exento.
- Nada más del backend cambia para el login (Supabase Auth maneja `/auth/v1/*`
  directo; el 5-→12/s cubre el backend de datos, no `/auth`).

## Seguridad "por ahora" (D5, D7)

1. Ráfaga 12 req/s por IP (D5) + límites por hora existentes (30/h público,
   240/h lectura, etc.) intactos.
2. Contraseñas hasheadas por Supabase (bcrypt). Mínimo 8 caracteres.
3. Honeypot + freno 60 s en los formularios de auth.
4. Fuerza bruta de login: lo cubre el rate-limit propio de Supabase Auth en
   `/token` (documentar que esté activo en el dashboard).
5. Sin enumeración de usuarios: mensajes de error genéricos.
6. Ya presente: HTTPS, CSP, security headers, sesión en `sessionStorage`.

## Confirmación de 1 clic (D4) — dependencia SES

El "Confirm email" de Supabase manda un enlace de un clic al registrarse. Su
correo va rate-limiteado (~2-4/h) hasta conectar **SES (plan 05)**. Por eso:
- El frontend/registro **soporta** ambos casos (con y sin confirmación).
- **Se lanza con la confirmación APAGADA** (registro instantáneo). Cuando Luis
  active SES, la enciende en el dashboard con un clic — sin cambios de código.

## Fuera de alcance (por ahora)

- Teléfono como forma de entrar (necesita SMS).
- Recuperación de contraseña por correo (necesita SES).
- Que los registros de rol creen la cuenta automáticamente.

## Migración

1 usuario existente ya con contraseña → sin acción. Usuarios OTP antiguos
(ninguno relevante) podrían usar recuperación cuando exista.

## Criterios de aceptación (para las reglas del loop)

1. i18n es/en paridad (verificar-idioma.py exit 0).
2. Backend: `handle()` tiene el límite de ráfaga 12/s por IP con `rate_hit`
   ventana-segundo, cubo 'burst'; `cron_tasa` exento; se conserva verify_jwt=false.
3. Frontend: #acceso con Crear cuenta / Entrar (correo+contraseña, min 8, ver
   contraseña); sin paso de código; `signup`/`token?grant_type=password` en
   services/api.js; helpers OTP eliminados; honeypot+freno conservados; bump de
   versión.
4. Playwright: crear cuenta (signup mockeado) → sesión + perfil; entrar
   (password mockeado) → sesión + roles vía acceso_perfil; contraseñas que no
   coinciden / cortas se rechazan; honeypot lleno no llama a /auth; ráfaga
   demostrable (mock) corta a la 13ª llamada en 1 s.
5. E2E prod: signup real + login real de una cuenta de prueba (borrada tras
   verificar); el límite 12/s no rompe la carga normal de una vista.

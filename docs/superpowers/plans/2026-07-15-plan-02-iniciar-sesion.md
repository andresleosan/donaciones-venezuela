# Plan 02 — «Iniciar sesión» en la barra superior (problema 2)

> **Para /build-loop:** materiales = este plan + `REGLAS.md` + roadmap 2026-07-15.
> Orden: **1º** — planes 01 y 07 dependen de la sesión que se construye aquí.

## El problema, literal (del .txt)

> «Toda la sección de registrar usuario debería estar en un botón en la parte
> superior de la barra, en el centro, donde diga "Iniciar sesión". Luego, cuando
> la sesión ya esté iniciada, aparece en el mismo lugar el nombre del usuario que
> ha iniciado sesión. Intenta que toda esta interfaz permita registrar cualquier
> tipo de usuario o centro para que podamos usar la app sin problemas.»

Y del contexto transversal: cualquier usuario **incluido el donante** debe poder
tener sesión (el donante no tiene rol registrado — hoy el sistema lo rechaza).

## Trazabilidad requisito → tarea

| Requisito del .txt | Tarea |
|---|---|
| Botón arriba, en el centro de la barra, «Iniciar sesión» | T2 |
| Con sesión iniciada, el nombre del usuario en el mismo lugar | T2 + T3 |
| Desde esa interfaz se registra cualquier tipo de usuario o centro | T2 (menú) |
| «Usar la app sin problemas» → la sesión no se pierde al recargar/cerrar | T1 |
| Donante = sesión válida sin rol (contexto + plan 01) | T3 |

## Estado actual (verificado 2026-07-17, anclas exactas)

- **El login OTP ya funciona completo**: `bindAcceso()` en `js/admin.js:1191-1250`
  — `SheetsService.solicitarCodigo(correo)` (`/auth/v1/otp`),
  `verificarCodigo(correo, codigo)` (`/auth/v1/verify` → devuelve `sesion` con
  `access_token`), y `acceso_perfil` (edge fn `index.ts:570`) devuelve
  `{email, roles[]}` con roles de `motorizados`, `voluntarios`, `centros_panel`.
- **La sesión SÍ se guarda hoy, pero mal para lo que pide el .txt**:
  `sessionStorage[ACCESO_SS]` con solo `{email, roles}` (admin.js:1233) —
  muere al cerrar la pestaña, **no guarda tokens** (no sirve para autenticar
  denuncias del plan 01) y no alimenta ninguna barra.
- **Rechaza al donante**: admin.js:1229 — `if (!data.roles.length)` → error
  `access.noRoles`. El .txt exige lo contrario.
- **El header** (`index.html:60-90 aprox`): `.app-header > .header-inner` con
  `.brand` a la izquierda y `.header-actions` (btn-volver + selector de idioma)
  a la derecha. No hay nada en el centro.
- `pintarPerfilAcceso()` (admin.js:1160-1188) ya pinta la lista de roles con
  enlaces por tipo (transportista→#transporte, voluntario→#voluntarios,
  centro→/panel-centro?token=…) — **ese mismo patrón de filas se reusa en el
  menú de la barra**, no se reinventa.

## Tareas

### T1 — Sesión persistente y con tokens (`js/core.js`)

Sustituir el `sessionStorage[ACCESO_SS]` por `localStorage['dv-sesion']`:

```js
// js/core.js — módulo de sesión (antes de cambiarIdioma para poder repintar)
const SESION_KEY = 'dv-sesion';
function guardarSesion(datos) { // {access_token, refresh_token, expires_at, email, nombre, roles}
  try { localStorage.setItem(SESION_KEY, JSON.stringify(datos)); } catch (_) { /* modo privado */ }
  pintarBotonSesion();
}
function sesionActual() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); } catch (_) { return null; }
  if (!s || !s.access_token) return null;
  return s; // la caducidad la maneja sesionValida() al usarla
}
async function sesionValida() { // úsala antes de acciones autenticadas (plan 01)
  const s = sesionActual();
  if (!s) return null;
  if (Date.now() / 1000 < (s.expires_at || 0) - 60) return s;
  try { // refresh silencioso
    const nueva = await window.SheetsService.refrescarSesion(s.refresh_token);
    guardarSesion(Object.assign({}, s, nueva)); return sesionActual();
  } catch (_) { cerrarSesion(); return null; }
}
function cerrarSesion() {
  try { localStorage.removeItem(SESION_KEY); } catch (_) {}
  pintarBotonSesion();
}
window.sesionActual = sesionActual; window.sesionValida = sesionValida;
window.guardarSesion = guardarSesion; window.cerrarSesion = cerrarSesion;
```

- `services/api.js`: añadir `refrescarSesion(refresh_token)` →
  `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token` con la anon key
  (mismos headers que `verificarCodigo`); devuelve
  `{access_token, refresh_token, expires_at}`.
- En `bindAcceso()` (admin.js:1226-1234): tras `verificarCodigo` +
  `acceso_perfil`, llamar `guardarSesion({access_token: sesion.access_token,
  refresh_token: sesion.refresh_token, expires_at: sesion.expires_at, email:
  data.email, nombre: <T3>, roles: data.roles})`. `sesionAcceso()`/
  `pintarPerfilAcceso()` pasan a leer de `sesionActual()` (compat: si existe el
  viejo `ACCESO_SS`, migrarlo una vez y borrarlo).
- ⚠️ Nota consciente sobre CLAUDE.md («no almacenamiento persistente del
  navegador»): esa regla es para *listados/datos*; una credencial de sesión es
  el uso legítimo de `localStorage`. **Nunca** guardar PIN de centro ni el
  código OTP.

### T2 — Botón centrado en la barra + menú

- `index.html`, dentro de `.header-inner`, **entre** `.brand` y
  `.header-actions`:

```html
<button class="btn btn-soft" id="btn-sesion" type="button" aria-haspopup="dialog"></button>
```

- CSS (`css/app.css`): `.header-inner{...}` ya es flex; `#btn-sesion{
  margin-inline:auto; min-height:44px; max-width:40vw; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;}` (R4.2/R4.3; en 390px el nombre
  largo se recorta con elipsis, sin desborde). En `ventana.html` no hay barra
  de vistas: este botón es solo de `index.html`.
- `pintarBotonSesion()` (core.js): sin sesión → `t('session.login')`
  («Iniciar sesión»/«Log in») y al tocar navega `location.hash='#acceso'` +
  scroll a `#acceso-login-card` (ya existe: admin.js:1246). Con sesión →
  texto = `nombre || email`; al tocar abre el **menú de sesión**.
- Menú de sesión = `abrirModal()` (patrón de `js/vistas.js`) con:
  1. Encabezado `t('session.signedInAs', {email})` (reusar clave
     `access.signedInAs` si encaja).
  2. **Mis roles**: las mismas filas que `pintarPerfilAcceso()` (transportista
     →#transporte, voluntario→#voluntarios, centro→panel con token). Si no hay
     roles: `t('session.noRoles')` («Aún no tienes registros — elige abajo»).
  3. **Registrarme como…** (cumple «registrar cualquier tipo de usuario o
     centro»): `session.registerVolunteer`→#voluntarios,
     `session.registerDriver`→#acceso (tarjeta transportista),
     `session.createCenter`→/crear-centro, `session.reportPerson`→#familiar.
  4. `session.logout` → `cerrarSesion()` + toast + cerrar modal.
- `recordarModal(() => abrirMenuSesion())` antes de pintar (R1.3/R1.4) y
  repintar `#btn-sesion` dentro de `cambiarIdioma()`.
- Pintar al cargar (init de core.js), tras login (T1) y tras logout.

### T3 — El nombre del usuario y el caso donante

- `nombre` = primer rol con nombre (`roles.find(r => r.nombre)`), si no, la
  parte local del email (`email.split('@')[0]`).
- **Quitar el rechazo sin roles** (admin.js:1229): con 0 roles la sesión se
  guarda igual (es el donante del plan 01); `#acceso-perfil` muestra
  `t('access.noRolesYet')` con los enlaces de registro en lugar del error.
  La clave vieja `access.noRoles` se reutiliza o se sustituye — en ambos
  idiomas (R1.2).

### T4 — i18n + versión + commit

- Claves nuevas (es **y** en, mismo commit — R1.2): `session.login`,
  `session.menuTitle`, `session.noRoles`, `session.registerVolunteer`,
  `session.registerDriver`, `session.createCenter`, `session.reportPerson`,
  `session.logout`, `access.noRolesYet`.
- Subir `?v=` en `index.html` + `ventana.html` y `VERSION` en `sw.js`, mismo
  commit (R5.4). Commit como Luismadef45 y push a origin (R5.5).

## Qué NO se hace (límites)

- No se crea tabla de usuarios nueva: los «usuarios» son los roles existentes
  + Supabase Auth. No se toca el PIN de centros.
- No se manda ningún OTP real en tests (límite de correos del SMTP integrado
  hasta que el plan 05 esté hecho): las pruebas inyectan `dv-sesion`.

## Reglas para /reglas-loop (F2) — ya escritas y validadas

Las 5 reglas están en
`/root/build-loop/proyectos/implementar-el-plan-02-iniciar-sesion-en-la-barra-superior-s/.build-loop/reglas.json`
(r01 verificar-idioma exit 0 · r02 sesionActual+dv-sesion en core.js ·
r03 claves session.* en ambos locales + #btn-sesion en index.html ·
r04 versión coherente y subida · r05 Playwright 390px: es/en, sesión
inyectada muestra nombre y menú, ≥44px, consola limpia, idioma en caliente
con el menú abierto). Pendiente solo la aprobación de Luis para F3.

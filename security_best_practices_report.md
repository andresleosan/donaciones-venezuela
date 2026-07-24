# Informe de seguridad · Donaciones Venezuela

**Fecha:** 2026-07-24 · **App:** https://donacionesvenezuela.vercel.app
**Arquitectura:** frontend estático (HTML/CSS/JS vanilla en Vercel) + Supabase
(lecturas por vistas `*_public`/RPC en PostgREST; escrituras por la edge function
`api` con `service_role`; Postgres con RLS).

## Resumen ejecutivo

La app **ya está bien endurecida**: suite completa de cabeceras de seguridad + CSP
real, TLS en todo (Vercel + Supabase), todas las escrituras pasan por la edge
function (nunca escritura directa del cliente), tablas base con RLS *deny-by-default*,
autenticación de admin y de panel **del lado del servidor** con hash + rate-limit +
bloqueo por fuerza bruta, y aislamiento de PII sensible (correo, foto de cédula y
datos de familias nunca salen en vistas públicas).

No se encontró ninguna vulnerabilidad **crítica** (acceso no autenticado a datos
sensibles, inyección, o bypass de admin). Los hallazgos son de refuerzo. Dos ya se
corrigieron en esta pasada (S5, S6). El punto de mayor valor pendiente es **S1**:
el panel admin usa una **clave compartida de larga vida** en vez de una sesión con
token que expira — que es justo lo que pediste ("usa un JWT").

> Sobre "certificados de validación": **TLS ya está activo** en producción (certificados
> gestionados por Vercel y por Supabase). Para un sitio estático de navegador no aplica
> ni se recomienda el *certificate pinning*. No hay nada que instalar aquí.

---

## Lo que ya está bien (mantener)

- **Cabeceras + CSP** (`vercel.json`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS, y CSP con `default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `connect-src` limitado al proyecto Supabase.
- **Todas las escrituras** pasan por la edge function `api` con `service_role`. El cliente
  nunca escribe directo en tablas.
- **Tablas base con RLS activo y sin políticas** = *deny-by-default*: anon/authenticated no
  leen nada directo; solo ven las vistas `*_public` curadas y las RPC previstas.
- **Admin** (`autenticarAdmin`, edge fn): la clave se guarda **hasheada** (`config.admin_key_hash`),
  con rate-limit por IP (60/h) y **bloqueo tras 10 intentos fallidos**; *fail-closed* si no está configurada.
- **Panel de centro** (`autenticarPanel`): token `CTR-…` + **PIN con SHA-256 + salt**, rate-limit,
  y no permite reclamar el panel de un centro ya existente (anti-secuestro).
- **Aislamiento de PII**: `familias_damnificadas` con RLS + fotos en bucket **privado**;
  `familias_public` **anonimizada** (solo zona y conteos). Correo y foto de cédula **no** están
  en ninguna vista pública.
- **Salida escapada**: todo valor externo interpolado pasa por `e()`. **No** hay `<script>` inline,
  handlers `on*` inline ni URIs `javascript:`.
- **Secretos** no viven en el repo; la clave del cliente es la *publishable* (anónima), segura por diseño.

---

## Hallazgos por severidad

### ALTA

**S1 · El panel admin usa una clave compartida de larga vida (no una sesión con expiración).**
*Impacto: si la ADMIN_KEY se filtra (XSS, mirar por encima del hombro, equipo comprometido), se obtiene control total del admin hasta rotarla a mano.*
- La clave se guarda en `sessionStorage` (`js/admin.js:15`) y se **envía en cada** petición admin (`js/admin.js:16-17`).
- El hash almacenado es SHA-256 simple (rápido); si la tabla `config` se filtrara y la clave fuera débil, es crackeable.
- **Recomendación (tu pedido de "usa un JWT"):** añadir `admin_login(clave)` en la edge fn que verifique la clave **una vez** y devuelva un **JWT firmado (HS256) de vida corta** (ej. 2 h) con un secreto de servidor (env de la función). Las acciones admin envían el JWT; `autenticarAdmin` verifica firma+expiración en vez de la clave cruda. Compatible hacia atrás (la clave sigue sirviendo para obtener el token). Reduce la ventana de exposición y permite revocar rotando el secreto.
- *Cambio de riesgo medio (redepliega la edge fn de producción). Listo para implementar con tu visto bueno; lo pruebo antes de dejarlo como único camino para no bloquearte el admin.*

### MEDIA

**S2 · Datos de contacto de voluntarios/transportistas/rescatistas son legibles por cualquiera.**
- `voluntarios_public` expone **nombre + apellido + teléfono**; `motorizados_public` expone **teléfono + placa**; `rescatistas_public` expone **teléfono**. Cualquiera puede leerlos directo en `/rest/v1/voluntarios_public` (sin login).
- Es coherente con "listas de coordinación", así que **puede ser intencional**. Si no quieres que el teléfono de los voluntarios sea público, se restringe (quitar `telefono` de la vista, o servirlo solo a admin/centro). **Decisión tuya.**

**S3 · Las denuncias exponen GPS exacto + ruta del video a cualquiera.**
- `denuncias_public` incluye `gps_lat`, `gps_lng` y `video_path` sin login. Publicar la ubicación exacta + video de quien denuncia puede ponerlo en riesgo.
- Según `CLAUDE.md` esto es por diseño ("el público ve video+fecha+coords+estado"). Si quieres proteger al denunciante, se puede **redondear** el GPS (p. ej. 2 decimales ≈ 1 km) y/o servir el video solo por URL firmada. **Decisión tuya.**

**S4 · Protección contra contraseñas filtradas: DESACTIVADA.**
*Impacto: los usuarios pueden elegir contraseñas ya comprometidas en filtraciones conocidas.*
- Supabase Auth puede validar contra HaveIBeenPwned. Está apagado.
- **Acción tuya (1 clic):** Panel de Supabase → Authentication → Policies/Password → activar "Leaked password protection". (No se puede activar por SQL.)

**S5 · `recalcular_recaudado()` era invocable por anon vía RPC. → CORREGIDO.**
- Era una función de *trigger* pero tenía `EXECUTE` para anon/authenticated, permitiendo dispararla por `/rest/v1/rpc`. Revocado en esta pasada (el trigger sigue funcionando; el front nunca la llamaba).

### BAJA (refuerzo)

**S6 · CSP con `script-src 'unsafe-inline'`. → CORREGIDO.**
- Se endureció a `script-src 'self'` (verificado: no hay scripts ni handlers inline). Elimina el principal punto de apoyo de un XSS. *(Se activa al desplegar `vercel.json`; conviene revisar la consola en producción tras el deploy por si algo inesperado usaba inline.)*

**S7 · Los tokens de sesión (access+refresh JWT) viven en `localStorage`** (`js/core.js:531`).
- Legibles por un XSS. Es el compromiso estándar de una SPA estática (Supabase no ofrece cookies httpOnly sin un backend propio). Mitigado por el CSP endurecido (S6). Prioridad baja.

**S8 · 15 vistas `*_public` son `SECURITY DEFINER`.**
- Es el patrón estándar de Supabase para vistas públicas; las columnas están curadas. Aceptable. Si se quiere seguir la recomendación nueva de Supabase (vistas `security_invoker` + políticas RLS de solo-lectura para anon), es un trabajo mayor y arriesgado; no urge.

**S9 · `buscar_familiar` devuelve PII de personas reportadas a anon.** Es la función de "buscar a un familiar" (mín. 3 caracteres, máx. 25 resultados): intencional. Se documenta.

**S10 · Higiene de base de datos (WARN del linter):** `norm_insumo` con `search_path` mutable; extensiones (`postgis`, `pg_trgm`, `unaccent`, `pg_net`) en el esquema `public`; `spatial_ref_sys` sin RLS. Riesgo real bajo (anon no puede crear objetos). No se tocó `norm_insumo` a propósito: lo usa la vista `lugares_directorio` (núcleo del directorio) y no vale arriesgarlo por un WARN.

---

## Acciones que solo puedes hacer tú (configuración)

1. **Activar "Leaked password protection"** en el panel de Supabase (S4).
2. **Decidir S2/S3**: ¿el teléfono de voluntarios y el GPS/video de denuncias deben ser públicos? Dime y lo ajusto.
3. **ADMIN_KEY**: si quieres, la rotamos y adoptamos el esquema JWT (S1).

## Próximos pasos recomendados (en orden)

1. **S1 — JWT de sesión admin** (con tu visto bueno; es el cambio de más valor y el que pediste).
2. **S4 — activar leaked-password protection** (1 clic tuyo).
3. **S2/S3 — confirmar intención** de exposición de contacto/ubicación y ajustar si procede.

*Ya aplicado en esta pasada: S5 (revocado recalcular_recaudado) y S6 (CSP endurecido).*

# Runbook de App Check

App Check comprueba que quien llama a las Cloud Functions es la aplicación web
real y no un script. No sustituye a la autenticación ni a los límites de tasa:
es una capa más, y por eso se activa en tres modos.

## Modos

| Modo | Comportamiento | Cuándo |
|---|---|---|
| `disabled` | No se pide ni se verifica el token | Emulator Suite y pruebas unitarias |
| `log-only` | Se verifica si viene, no se rechaza si falta | Primer despliegue, mientras se mide el tráfico legítimo |
| `enforced` | Sin token válido se responde `403 app-check-required` | Estado objetivo en producción |

El código **falla cerrado**: si `APP_CHECK_MODE` no está definida o trae un valor
desconocido, el modo efectivo es `enforced`. La única excepción es Emulator Suite
(`FUNCTIONS_EMULATOR=true`), donde no existe proveedor de atestación y exigirla
dejaría la suite sin poder llamar a ninguna Function.

Configuración por proyecto, en archivos que Firebase carga solo:

- `functions/.env.demo-donaciones-venezuela` → `APP_CHECK_MODE=disabled`
- `functions/.env.donaciones-venezuela-4fc29` → `APP_CHECK_MODE=log-only`

## Alcance actual

Pasan por App Check: `authSession`, `setVolunteerPublicConsent`,
`getPrivateFileUrl` y `deletePrivateFile`. `health` queda fuera a propósito: es
una comprobación de disponibilidad y no devuelve datos.

## Activación en el proyecto de desarrollo

1. En la consola de Firebase, **Compilación → App Check → Aplicaciones**, elegir
   la app web y registrar el proveedor **reCAPTCHA v3**. Copiar la clave de sitio
   que genera Google.
2. Definir la clave en el entorno de build del frontend, junto a las demás
   variables públicas: `VITE_APPCHECK_SITE_KEY=<clave de sitio>`.
3. En el arranque del cliente, después de `initializeApp` y **antes** de la
   primera llamada a una Function:

   ```js
   const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
   initializeAppCheck(app, {
     provider: new ReCaptchaV3Provider(import.meta.env.VITE_APPCHECK_SITE_KEY),
     isTokenAutoRefreshEnabled: true,
   });
   ```

   El SDK adjunta la cabecera `X-Firebase-AppCheck` a las llamadas a Functions.
4. Desplegar con `APP_CHECK_MODE=log-only` y dejarlo así al menos 48 horas.

## Paso a `enforced`

Antes de cambiar el modo, comprobar en los registros de Cloud Functions que no
haya llamadas legítimas sin token. Solo entonces:

1. Cambiar `APP_CHECK_MODE=enforced` en `functions/.env.donaciones-venezuela-4fc29`.
2. `npx.cmd firebase deploy --only functions --project donaciones-venezuela-4fc29`.
3. Verificar un flujo real de la aplicación desde el navegador.

## Reversión

Volver a `log-only` y desplegar. La reversión es inmediata y no pierde datos: el
modo solo decide si una petición sin token se rechaza o se registra.

## Qué no hacer

- No enviar el token de App Check desde el servidor ni desde scripts: si algo
  necesita acceso programático, se resuelve con una cuenta de servicio, no
  debilitando App Check.
- No pasar a `enforced` sin haber medido antes en `log-only`: la aplicación deja
  de funcionar para cualquier navegador que falle la atestación.
- No usar la clave de sitio de reCAPTCHA como si fuera un secreto (es pública),
  ni confundirla con la clave secreta de reCAPTCHA (esa nunca va al repositorio).

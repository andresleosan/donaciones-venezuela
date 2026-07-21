# Guía — Configurar AWS SES para los códigos de acceso

**Qué vas a lograr:** que los códigos de inicio de sesión (los 6 dígitos que
pide `#acceso`) los envíe Amazon SES en lugar del correo compartido de Supabase,
para quitar el límite de ~2-4 correos/hora y poder subirlo a 100/h. Es **lo más
barato posible**: SES cuesta **$0.10 por cada 1.000 correos**, sin costo fijo, y
el primer año AWS regala 3.000 correos/mes.

**Cuántos pasos:** 7 (los pasos 1-6 se hacen una sola vez; el 7 es la
verificación final).

**Requisitos antes de empezar:**
- Una cuenta de AWS (sirve una nueva; **no** hace falta dominio propio).
- Acceso al proyecto de Supabase `zryfwbjvlacorryzdaod`.
- Un correo remitente al que puedas entrar (puede ser un Gmail) para confirmar
  el enlace de verificación.

> **Importante:** los códigos **ya los envía Supabase Auth**. Aquí NO montamos un
> sistema de correos: solo le decimos a Supabase que use SES como su servidor
> SMTP. Las credenciales SMTP que saques en el paso 3 son las mismas que reusa el
> correo de alerta de extravío (plan 07).

---

## Paso 1 — Verificar el correo remitente en SES

📍 **Consola AWS → servicio SES → región `us-east-1` (N. Virginia)** → menú
**Verified identities** → botón **Create identity**.

1. Elige **Email address**.
2. Escribe el correo remitente `<TU-CORREO>` (el que verán los usuarios como
   remitente; puede ser un Gmail tuyo).
3. Clic en **Create identity**.

*Qué hace:* registra ese correo como remitente autorizado. SES no deja enviar
desde direcciones sin verificar.

**Salida esperada:** el estado aparece como **«Verification pending»** y llega un
correo de AWS a esa bandeja. Abre ese correo y haz clic en el enlace de
confirmación → el estado cambia a **«Verified»**.
*Si no llega:* revisa spam; puedes pulsar **Resend** en la misma pantalla.

---

## Paso 2 — Pedir el «production access» (hazlo YA, tarda ~24 h)

📍 **SES → Account dashboard → botón Request production access.**

1. **Mail type:** `Transactional`.
2. **Website URL:** `https://donacionesvenezuela.vercel.app`
3. **Use case description** (pégalo tal cual):
   `One-time login codes for a humanitarian donations platform (Venezuela
   earthquake response); double opt-in by nature (the user requests the code).`
4. Acepta los términos y envía.

*Qué hace:* saca tu cuenta del modo «sandbox». En sandbox **solo puedes enviar a
direcciones verificadas por ti** — sirve para probar con tu propio correo, pero
no para usuarios reales.

**Salida esperada:** un caso de soporte abierto; la aprobación tarda
**~24 horas**. Por eso este paso va de segundo: para que el tiempo corra
mientras haces el resto.

> ⚠️ **Mientras estés en sandbox**, cualquier correo a una dirección **no**
> verificada será rechazado silenciosamente. Para probar el flujo completo antes
> de la aprobación, verifica también tu correo de prueba (repite el paso 1 con
> él) o espera a que aprueben el production access.

---

## Paso 3 — Crear las credenciales SMTP

📍 **SES → menú SMTP settings → botón Create SMTP credentials.**

1. Deja el nombre de usuario IAM que propone (o pon `ses-smtp-donaciones`).
2. Clic en **Create** → **Download credentials** o cópialas a mano.
3. Anota el **SMTP user name** y el **SMTP password**.

*Qué hace:* genera un usuario IAM restringido a `ses:SendRawEmail` (mínimo
privilegio) y traduce sus llaves a un usuario/contraseña de SMTP.

**Salida esperada:** dos valores en pantalla: `SMTP username` y `SMTP password`.

> ⚠️ **La contraseña SMTP se muestra UNA sola vez.** Si cierras la pantalla sin
> copiarla, no se puede recuperar: tendrías que borrar el usuario y crear otro.
> Guárdala en tu gestor de contraseñas antes de continuar.

---

## Paso 4 — Conectar SES como SMTP de Supabase

📍 **Supabase → proyecto `zryfwbjvlacorryzdaod` → Authentication → Emails →
pestaña SMTP Settings** → activa **Enable Custom SMTP**.

Rellena:

- **Host:** `email-smtp.us-east-1.amazonaws.com`
- **Port:** `465`
- **Username:** el `SMTP username` del paso 3.
- **Password:** el `SMTP password` del paso 3.
- **Sender email:** el correo verificado en el paso 1.
- **Sender name:** `Donaciones Venezuela`

Clic en **Save**.

*Qué hace:* a partir de ahora Supabase Auth envía todos sus correos (incluidos
los códigos OTP) a través de SES.

**Salida esperada:** banner verde de guardado. Supabase manda un correo de
prueba al guardar; debería llegarte en segundos desde el nuevo remitente.
*Si da error de autenticación:* revisa que el usuario/contraseña sean los de
**SMTP** (paso 3) y no las llaves de acceso de la cuenta AWS.

---

## Paso 5 — Subir el límite de envío (defensa anti-bots del servidor)

📍 **Supabase → Authentication → Rate Limits.**

1. Busca **«Rate limit for sending emails»**.
2. Súbelo de `2` (por hora) a **`100`** por hora.

*Qué hace:* con SMTP propio Supabase permite un límite mucho mayor. Este límite,
junto con el límite por IP que aplica GoTrue, es la **defensa real anti-bots**
del servidor (el honeypot y la cuenta atrás del cliente solo frenan a los bots
tontos).

**Salida esperada:** el nuevo valor `100` queda guardado. Anótalo: es parte de
la defensa documentada del plan.

---

## Paso 6 — Dejar bilingüe la plantilla del código

📍 **Supabase → Authentication → Emails → plantilla «Magic Link» / «OTP».**

- **Asunto:** `Tu código / Your code: {{ .Token }}`
- **Cuerpo** (texto plano, español primero y luego inglés), con `{{ .Token }}`
  bien visible y una línea final del tipo:
  «Si no pediste este código, ignora este correo / If you didn't request this
  code, ignore this email.»

*Qué hace:* el usuario ve el código directo en el correo, en su idioma.

**Salida esperada:** la vista previa muestra el asunto y el cuerpo con el token
interpolado.

---

## Paso 7 — Verificación final

📍 **Producción → `https://donacionesvenezuela.vercel.app/#acceso`.**

1. Escribe tu correo y pulsa **Enviarme el código**.
2. El correo debe llegar **en segundos**, con el nuevo remitente.
3. Abre el correo → **Mostrar original / Ver cabeceras** y confirma que aparece
   `via amazonses.com` (o `Received: from ... amazonses.com`).

**Salida esperada:** código recibido rápido, remitente nuevo y cabecera
`amazonses.com` presente → SES está enviando de verdad.
*Si no llega:* **Supabase → Logs → Auth** para ver el error exacto (suele ser
credenciales SMTP mal copiadas o, si sigues en sandbox, un destino no
verificado).

---

## Costo total
- **SES:** $0.10 por 1.000 correos, sin costo fijo (+ 3.000 gratis/mes el primer
  año).
- **Supabase:** sin cambio de plan.

No hay forma más barata sin volver al límite de 2-4 correos/hora.

# Activar las notificaciones de Telegram (presupuesto recaudado)

Cuando un presupuesto **cubre toda su meta**, la app puede avisarte por Telegram
("✅ Se recaudó todo para X — toca comprar"). El código ya está listo y **apagado**:
solo se enciende cuando guardes el token del bot y tu chat id. Son **4 pasos**
(~5 min). Requisito: tener la app de Telegram.

---

## Paso 1 — Crear el bot

📍 **En tu teléfono, dentro de Telegram.**

1. Busca el usuario **@BotFather** y abre el chat.
2. Envía este mensaje:
```
/newbot
```
3. BotFather te pedirá un **nombre** (ej. `Avisos Donaciones VE`) y luego un
   **usuario** que debe terminar en `bot` (ej. `donaciones_ve_avisos_bot`).

**Salida esperada:** BotFather responde con un texto que incluye una línea como:
`Use this token to access the HTTP API:` seguida del **token** (algo como
`8123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).

⚠️ **Ese token es un secreto**: cualquiera con él puede enviar mensajes como tu
bot. No lo pegues en el repo, ni en chats públicos, ni en capturas.

---

## Paso 2 — Empezar el chat con tu bot

📍 **En Telegram.**

1. Abre el chat de tu bot nuevo (toca su nombre en el mensaje de BotFather, o
   búscalo por el `@usuario` que le pusiste).
2. Toca **Iniciar / Start** (o envíale cualquier mensaje, ej. `hola`).

Esto es necesario: Telegram no deja que un bot te escriba si tú no le hablaste primero.

---

## Paso 3 — Obtener tu chat id

📍 **En el navegador de tu computadora o teléfono.**

Pega esta URL cambiando `<TOKEN>` por el token del Paso 1:
```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

**Salida esperada:** un texto JSON. Busca dentro `"chat":{"id":NUMERO,`. Ese
**NUMERO** (puede ser negativo) es tu **chat id**. Ejemplo: `"chat":{"id":123456789,`
→ tu chat id es `123456789`.

- Si sale `{"ok":true,"result":[]}` (vacío), vuelve al Paso 2 y envíale un mensaje
  al bot; luego recarga la URL.

---

## Paso 4 — Guardar el token y el chat id (encender las notificaciones)

Tienes **dos opciones**. En ambas, el token nunca se imprime.

### Opción A (recomendada): dímelo a Claude

Escríbeme (a Claude Code) algo como:
> "Guarda el token de Telegram `<TOKEN>` y el chat id `<CHATID>`."

Yo los guardo en la tabla `config` con `execute_sql` (sin imprimirlos) y hago una
prueba. Listo.

### Opción B: tú mismo, en el panel de Supabase

📍 **En [supabase.com](https://supabase.com) → tu proyecto `zryfwbjvlacorryzdaod` → SQL Editor.**

Pega esto cambiando los dos valores `<...>` y ejecútalo:
```sql
update public.config set valor = '<TOKEN>'  where clave = 'telegram_bot_token';
update public.config set valor = '<CHATID>' where clave = 'telegram_chat_id';
```

**Salida esperada:** `UPDATE 1` en cada línea.

---

## Verificación final

📍 **En la app.**

1. Crea un presupuesto de prueba con una meta baja (o usa uno abierto).
2. Dona lo suficiente para **cubrir la meta**.

**Salida esperada:** te llega un mensaje de tu bot en Telegram: *"✅ Se recaudó
todo para … — toca transferir y comprar."* Si no llega, revisa que el token y el
chat id estén bien guardados (Paso 4) y que hayas hablado con el bot (Paso 2).

## Para apagarlas otra vez

Deja ambos valores vacíos (Opción A: pídemelo; Opción B: `update public.config set
valor = '' where clave in ('telegram_bot_token','telegram_chat_id');`). El código
detecta que no hay llaves y no envía nada.

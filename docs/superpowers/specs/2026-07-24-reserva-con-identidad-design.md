# Reserva con identidad — diseño

**Fecha:** 2026-07-24
**Cierra:** V01 (crítico), V02 (alto) y V03 (alto) del escaneo de vulnerabilidades
(`/root/compartido/vulnerabilidades-donaciones-venezuela.html`).

## Problema

Tres agujeros que comparten una misma raíz: **la app confía en datos que cualquiera
puede conseguir o inventar**.

- **V01 — Secuestro del ciclo logístico.** Las cuatro acciones que mueven un insumo en
  el mundo real (`viaje_iniciar`, `registrar_recogida`, `recoger_oferta`,
  `registrar_entrega_final`) no piden ninguna credencial: basta conocer el token
  `DV-…` de la factura. Y ese token no es secreto: `listar_comprados` se lo entrega a
  cualquier anónimo. Cualquiera puede marcar insumos como entregados sin entregarlos,
  bloquear al transportista real e inyectar GPS, nombres y fotos falsos.
- **V02 — Escalada al panel de un centro.** La confirmación de correo está desactivada,
  así que cualquiera crea una cuenta con un correo ajeno; `acceso_perfil` asigna roles
  comparando solo el texto del correo y **devuelve el `token_centro`**.
- **V03 — Contacto y GPS de donantes, públicos.** `listar_ofertas` devuelve a cualquier
  anónimo nombre, teléfono, dirección de referencia y coordenadas exactas de quien
  ofrece insumos desde su casa.

**Restricción que manda sobre todo lo demás:** la app existe para funcionar en una
emergencia. Cualquier arreglo que añada fricción real al donante o que meta un cuello
de botella humano en la logística está descartado. `PRODUCT.md` lista como
anti-referencia «cualquier fricción de registro innecesaria».

## Idea central: el viaje es la llave

La tabla `viajes` ya guarda **quién** hace cada viaje (`email`), **cuándo** empezó
(`paso1_ts`), **cuánto** dijo que tardaría (`eta_minutos`) y el estado de supervisión
del admin (`alertado_at`, `resuelto`). Es decir: **la reserva ya existe en el modelo de
datos. Nadie la hace cumplir.**

El arreglo no inventa arquitectura nueva: convierte esa fila en el permiso.

> **Regla única: para tocar un insumo hay que tener la reserva viva de ese insumo.**

Esto no requiere ningún cambio de esquema para V01.

### Por qué NO se esconden los tokens

Tentación descartada: «que `listar_comprados` deje de devolver el token». Los tokens
`DV-…` **deben seguir siendo públicos**: son los que usa el donante para seguir su
donación, que es la promesa central del producto. La corrección correcta no es esconder
el token, es que **conocerlo deje de dar poder**.

## Enfoques considerados

| Enfoque | Veredicto |
|---|---|
| **A. El viaje es la llave** — la fila de `viajes` pasa de registro pasivo a permiso | **Elegido.** Cero cambios de esquema; reusa el tooling de admin que ya existe (`admin_viajes_atrasados`, `admin_viaje_resolver`). |
| **B. Tabla `reservas` nueva** con su propia máquina de estados | Rechazado por YAGNI: duplica lo que `viajes` ya hace y obliga a mantener dos cosas sincronizadas. |
| **C. Código secreto por trabajo**, sin login | Rechazado: `viaje_iniciar` seguiría abierto (el primero que llega se lo lleva) e inventa un sistema de credenciales paralelo al que ya existe. |

## Decisiones tomadas (trazables)

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | **Reserva con identidad**, sin aprobación previa del admin | Admin aprueba transportistas; modelo mixto | Un portero humano frena la logística justo cuando más prisa hay. La atribución + poder revertir dan el 90 % del beneficio con 0 % de bloqueo. |
| D2 | Antes de reservar se ve **zona + distancia** | Punto aproximado en mapa; nada hasta reservar | El transportista necesita decidir «me queda de camino» sin que se publique la casa de nadie. |
| D3 | **Confirmación de correo + dejar de devolver el token del panel** (las dos) | Solo una de las dos | Dos barreras independientes. Sin confirmación de correo, la «identidad» de D1 es un correo desechable. |
| D4 | Los tokens `DV-…` siguen siendo públicos | Ocultarlos de las listas | Son la trazabilidad del donante. Se quita el poder, no la visibilidad. |
| D5 | El email de la reserva sale **del JWT verificado** | Del campo `email` que manda el cliente | El cliente puede mentir; el JWT no. |
| D6 | Caducidad: `paso1_ts + eta_minutos + 60 min` de gracia | Sin caducidad; caducidad fija | Evita que un atacante (o un despistado) acapare trabajos para siempre, sin castigar un retraso normal. |
| D7 | El token del centro se recuerda en `localStorage` del dispositivo | Que el centro lo escriba siempre | Conserva la comodidad del centro legítimo en su equipo de siempre, sin que el servidor lo entregue por un correo que coincide. |
| D8 | `zona` es un campo **opcional nuevo** en el formulario de ofrecer | Derivarla por geocodificación | Una línea opcional para el donante es más barato y honesto que geocodificar. |

## Diseño

### Pieza 1 — V01: autorización del ciclo logístico

**Reservar (`viaje_iniciar`)**
- Exige `accessToken` de sesión, validado con `identidadSesion()` (mismo patrón que ya
  usa correctamente `denuncia_crear`).
- `email` y `nombre` se toman **de la identidad del JWT**, no de los campos del cliente.
  `nombreTransportista` deja de ser confiable como fuente de verdad.
- Si ya existe una reserva **viva** para esa factura → error *«Este trabajo ya lo reservó
  otra persona»*.
- Devuelve, además de lo actual, el bloque de contacto completo del trabajo (ver Pieza 3).

**Avanzar (`registrar_recogida`, `recoger_oferta`, `registrar_entrega_final`)**
- Exigen `accessToken`.
- Buscan la reserva viva de esa factura y exigen `viaje.email === identidad.email`.
- Si no coincide → *«Este trabajo está reservado por otra persona»*.

**Reserva viva** = fila de `viajes` de esa factura con `paso3_ts IS NULL`,
`resuelto = false`, y `now() < paso1_ts + (eta_minutos + 60) minutos`.
Si la última reserva no está viva, la factura queda libre para reservar de nuevo.

**Qué hace exactamente la caducidad (para que no quede ambiguo):** solo permite
**volver a reservar** un trabajo que aún no se recogió, es decir mientras la factura
sigue en un estado reservable (`Comprada` para una compra, `Ofrecida` para una oferta).
Si el transportista ya recogió y luego desaparece, la factura está en `EnTransito` o
`Recogida` y **la caducidad no la libera sola**: ese caso lo resuelve el admin con
`admin_viaje_resolver`, que es justo para lo que existe. Caducar no revierte estados ni
borra evidencia.

**Supervisión:** sin cambios. `admin_viajes_atrasados` y `admin_viaje_resolver` ya
existen y siguen sirviendo para intervenir un viaje trabado.

**Modo simulación** (`simularViaje` en `js/viaje.js`, botón de desarrollo): pasa a
requerir sesión iniciada. Ya lee la sesión; lo que deja de funcionar es el respaldo
`nombre = 'SIM'` sin cuenta. Aceptado: es una herramienta de desarrollo.

### Pieza 2 — V02: identidad y token del panel

- **Activar «Confirm email»** en Supabase Auth. *Verificado:* las 5 cuentas existentes
  ya tienen `email_confirmed_at` (Supabase las auto-confirma con la opción apagada), así
  que **no hace falta backfill y nadie queda fuera**; solo aplica a cuentas nuevas.
- **`acceso_perfil` deja de devolver `token`** en los roles de tipo centro. Sigue
  diciendo «eres el centro X».
- **Frontend:** el enlace prellenado `/panel-centro?token=…` se construye ahora desde el
  token guardado en `localStorage` del dispositivo (clave `dv-token-centro`), que se
  escribe cuando el centro crea su panel (`panel_crear` ya devuelve el token) o cuando
  entra a mano una vez. Si no hay token guardado, el enlace lleva al panel sin
  prellenar y el centro escribe token + PIN.
- **Ojo:** esa línea está **duplicada** en `js/core.js:572` y `js/admin.js:1499`. Hay que
  cambiar las dos.

### Pieza 3 — V03: contacto del donante

**Lista pública (`listar_ofertas`)** deja de devolver `telefono`, `nombreDonante`,
`ubicacion` (referencia exacta) y `coords` exactas. Pasa a devolver:
- `insumo`, `cantidad`, `unidad`, `estado`, `token`
- `zona` — municipio o sector, campo opcional nuevo del formulario de ofrecer
- `coordsAprox` — coordenadas redondeadas a **2 decimales** (≈1 km), suficientes para
  calcular distancia e inútiles para localizar una casa

**Acción nueva `reserva_detalle(token)`** — autenticada. Devuelve `nombreDonante`,
`telefono`, `ubicacion` exacta y `coords` reales **solo si quien pregunta tiene la
reserva viva** de ese trabajo. Sirve para volver al trabajo si se cerró la app.

Aplica **a las ofertas**, que son las que llevan datos de una persona en su casa. Para
un presupuesto (compra en tienda) devuelve los datos de la tienda, que ya son públicos y
no son PII: se mantiene la misma acción para no tener dos caminos distintos en el
cliente.

`listar_comprados` no cambia: la dirección que expone es la de la **tienda**, no la casa
de nadie.

### UX

- **Donante que dona dinero:** no cambia nada. `donar_dinero` sigue siendo público y sin
  cuenta.
- **Donante que ofrece un insumo:** una línea opcional más (zona). A cambio, su teléfono
  y su casa dejan de ser públicos.
- **Transportista con cuenta:** no cambia nada visible. El frontend ya rellenaba su
  nombre desde la sesión (`js/viaje.js:105-107`).
- **Transportista sin sesión:** donde hoy hay un campo de nombre en texto libre, aparece
  *«Entra para reservar este trabajo»* con enlace a `/acceso`. El regreso automático ya
  está construido (`sessionStorage['dv-retorno']`).
- **Centro:** en su dispositivo de siempre, igual que hoy (token prellenado, escribe el
  PIN). En un dispositivo nuevo, escribe token + PIN.

### Errores

| Situación | Mensaje |
|---|---|
| Sin sesión al reservar | «Entra con tu cuenta para reservar este trabajo» + enlace |
| Ya reservado por otro | «Este trabajo ya lo reservó otra persona» |
| Avanzar sin ser el dueño | «Este trabajo está reservado por otra persona» |
| Reserva caducada | «Tu reserva venció; vuelve a reservarla» |

Todos los textos van en `locales/es.json` y `locales/en.json`
(`scripts/verificar-idioma.py` debe seguir dando salida 0).

### Pruebas

Cada una debe **fallar antes** del arreglo y pasar después:

1. `viaje_iniciar` sin sesión → rechazado
2. Transportista B intenta avanzar el trabajo reservado por A → rechazado
3. A avanza su propio trabajo → funciona
4. `listar_ofertas` anónimo → sin `telefono`, `nombreDonante` ni coords exactas
5. `reserva_detalle` sin la reserva → rechazado; con la reserva → contacto completo
6. `acceso_perfil` → sin `token` en el rol de centro
7. Reserva caducada → otro transportista puede reservar

## Alcance y orden

Tres piezas independientes, cada una desplegable y verificable por separado:

1. **Pieza 1 (V01)** — la más urgente; edge function + `js/viaje.js`.
2. **Pieza 2 (V02)** — edge function + `js/core.js` + `js/admin.js` + un ajuste de
   configuración en Supabase que hace Luis.
3. **Pieza 3 (V03)** — edge function + `js/vistas.js` + formulario de ofrecer + locales.

El orden importa poco entre ellas, pero la Pieza 1 es la que cierra el agujero crítico.

## Fuera de alcance

Del escaneo quedan pendientes y **no** entran aquí: V04 (PIN débil), V05 (hash de la
clave admin), V06 (cédulas en `buscar_familiar`), V07 (`p.id` como ruta de storage),
V08 (GPS de denuncias) y V09-V18. Se tratarán aparte.

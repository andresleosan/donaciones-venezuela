# Reserva con identidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar V01 (secuestro del ciclo logístico), V02 (escalada al panel de centro) y V03 (contacto y GPS de donantes públicos) sin añadir fricción al donante ni un portero humano a la logística.

**Architecture:** La fila de `viajes` ya guarda quién hace el viaje (`email`), cuándo empezó (`paso1_ts`) y su plazo (`eta_minutos`). Se convierte esa fila en **el permiso**: para tocar un insumo hay que tener su *reserva viva*. Cero cambios de esquema para V01. V02 quita la fuga del `token_centro` y activa la confirmación de correo. V03 saca la PII del listado público y la entrega solo a quien tiene la reserva.

**Tech Stack:** Frontend estático vanilla (HTML/CSS/JS, sin dependencias ni build). Backend: Supabase Edge Function `api` (Deno/TypeScript, `verify_jwt=false`) con `service_role`. Postgres con RLS deny-by-default. Despliegue: Vercel (frontend, por `git push`) y Supabase (edge function).

**Spec:** `docs/superpowers/specs/2026-07-24-reserva-con-identidad-design.md`

## Global Constraints

- Proyecto **sin dependencias ni build**: no añadir npm, frameworks ni paquetes.
- Todo valor externo interpolado en `innerHTML` pasa por `e()`.
- **i18n obligatorio:** cada texto visible vive en `locales/es.json` **y** `locales/en.json`. `python3 scripts/verificar-idioma.py` debe terminar con salida `0` (claves paralelas y sin texto español cableado en `js/`).
- **Versión PWA:** al tocar cualquier asset estático hay que subir `?v=N` en `index.html` y `ventana.html` **y** `const VERSION = 'N'` en `sw.js`, los tres al mismo número. Hoy están en **89**.
- La edge function se edita en `supabase/functions/api/index.ts` (fuente de verdad versionada) y se despliega aparte a Supabase; el repo y el despliegue deben quedar iguales.
- **Los tokens `DV-…` siguen siendo públicos**: son la trazabilidad del donante. Nunca ocultarlos como “arreglo”.
- El email de una reserva sale **siempre del JWT verificado**, nunca de un campo que manda el cliente.
- No hay entorno de staging: las pruebas corren contra producción con datos marcados `ZZTEST` y **se limpian al final de cada tarea**.
- Proyecto Supabase: `zryfwbjvlacorryzdaod`. App: `https://donacionesvenezuela.vercel.app`.

---

## File Structure

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `supabase/functions/api/index.ts` | Toda la autorización del servidor: helpers de reserva, las 4 acciones logísticas, `acceso_perfil`, `listar_ofertas`, `reserva_detalle`, `ofrecer_insumo` | 1, 3, 4 |
| `js/viaje.js` | Flujo del transportista: manda el `accessToken`, muestra la puerta de acceso si no hay sesión | 2 |
| `js/core.js` | Enlace del panel de centro en el perfil de sesión (línea 572) | 3 |
| `js/admin.js` | **La misma línea duplicada** del enlace del panel (línea 1499) | 3 |
| `js/panel.js` | Guarda el token del centro en `localStorage` al entrar | 3 |
| `js/vistas.js` | Render de la lista de ofertas (sin PII, con zona y distancia) | 4 |
| `locales/es.json`, `locales/en.json` | Todos los textos nuevos | 2, 3, 4 |
| `scripts/verificar-v01-reserva.mjs` | Prueba ejecutable de la Tarea 1 | 1 |
| `scripts/verificar-v02-identidad.mjs` | Prueba ejecutable de la Tarea 3 | 3 |
| `scripts/verificar-v03-contacto.mjs` | Prueba ejecutable de la Tarea 4 | 4 |

**Nota sobre las pruebas:** el proyecto no tiene framework de tests. Las pruebas son scripts de Node (sin dependencias, usando `fetch` nativo) que golpean la API real y **fallan antes del arreglo**. Se ejecutan con variables de entorno para no escribir secretos en el repo.

Las tres tareas son independientes y desplegables por separado. La **Tarea 1 + 2** van juntas (la 1 rompe el flujo anónimo que la 2 sustituye) y son las que cierran el agujero crítico.

---

## Task 1: Backend — la reserva viva autoriza el ciclo logístico (V01)

**Files:**
- Modify: `supabase/functions/api/index.ts:93-99` (ampliar `viajeVigente`)
- Modify: `supabase/functions/api/index.ts` (helpers nuevos tras `viajeVigente`)
- Modify: `supabase/functions/api/index.ts:687` (`viaje_iniciar`), `:722` (`registrar_recogida`), `:774` (`registrar_entrega_final`), `:895` (`recoger_oferta`)
- Create: `scripts/verificar-v01-reserva.mjs`

**Interfaces:**
- Consumes: `identidadSesion(jwt) → {email, nombre, rol}` (ya existe, línea 193); `s()`, `n()` (ya existen).
- Produces (las usan las Tareas 3 y 4):
  - `exigirSesion(p) → Promise<{email, nombre, rol}>` — lanza si no hay `p.accessToken` válido.
  - `reservaViva(facturaId: number) → Promise<viaje | null>`
  - `exigirDuenoReserva(facturaId: number, email: string) → Promise<viaje>` — lanza si no eres el dueño.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/verificar-v01-reserva.mjs`:

```js
#!/usr/bin/env node
// Prueba V01: solo el dueño de la reserva viva puede mover el insumo.
// Uso: ANON=... ADMINKEY=... EMAIL_A=... PASS_A=... EMAIL_B=... PASS_B=... node scripts/verificar-v01-reserva.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, ADMINKEY, EMAIL_A, PASS_A, EMAIL_B, PASS_B } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

async function api(payload) {
  const r = await fetch(`${BASE}/functions/v1/api`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}
async function login(email, password) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falló para ${email}`);
  return j.access_token;
}

// Imagen mínima válida (JPEG 1x1) para las fotos obligatorias.
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/aAAgBAQAAPwA/8H//2Q==';

const fallos = [];
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? ' — ' + extra : ''}`);
  if (!cond) fallos.push(nombre);
};

const tokenA = await login(EMAIL_A, PASS_A);
const tokenB = await login(EMAIL_B, PASS_B);

// --- Montar un presupuesto ZZTEST hasta el estado "Comprada" ---
const cre = await api({ accion: 'admin_crear_presupuesto', adminKey: ADMINKEY,
  centro: 'Comunidad El Hatillo', insumo: 'ZZTEST reserva V01', tienda: 'ZZTEST tienda',
  direccion: 'Av prueba', cantidad: 1, precio: 100, tiendaLat: 10.44, tiendaLng: -66.82 });
const tk = cre.body.token;
await api({ accion: 'donar_dinero', token: tk, montoUsd: 1, comprobante: FOTO, nombreDonante: 'ZZTEST' });
await api({ accion: 'admin_presupuesto_transferido', adminKey: ADMINKEY, token: tk, consolidado: FOTO });
await api({ accion: 'admin_presupuesto_comprado', adminKey: ADMINKEY, token: tk, factura: FOTO });

// 1) Reservar SIN sesión debe fallar
const sinSesion = await api({ accion: 'viaje_iniciar', token: tk, nombreTransportista: 'Intruso',
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('1. viaje_iniciar sin sesión es rechazado', sinSesion.body?.success === false, sinSesion.body?.error);

// 2) A reserva con sesión
const reservaA = await api({ accion: 'viaje_iniciar', token: tk, accessToken: tokenA,
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('2. A reserva con sesión', reservaA.body?.success !== false, reservaA.body?.error);

// 3) B no puede reservar lo ya reservado
const reservaB = await api({ accion: 'viaje_iniciar', token: tk, accessToken: tokenB,
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('3. B no puede reservar lo de A', reservaB.body?.success === false, reservaB.body?.error);

// 4) B no puede avanzar el trabajo de A
const recogeB = await api({ accion: 'registrar_recogida', token: tk, accessToken: tokenB,
  fotoSitio: FOTO, fotoInsumo: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('4. B no puede recoger el trabajo de A', recogeB.body?.success === false, recogeB.body?.error);

// 5) A sí puede avanzar el suyo
const recogeA = await api({ accion: 'registrar_recogida', token: tk, accessToken: tokenA,
  fotoSitio: FOTO, fotoInsumo: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('5. A sí puede recoger el suyo', recogeA.body?.success !== false, recogeA.body?.error);

// 6) B no puede cerrar la entrega de A
const entregaB = await api({ accion: 'registrar_entrega_final', token: tk, accessToken: tokenB,
  nombreReceptor: 'ZZTEST receptor', fotoCentro: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('6. B no puede entregar el trabajo de A', entregaB.body?.success === false, entregaB.body?.error);

console.log(`\nTOKEN_LIMPIAR=${tk}`);
console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que FALLA**

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" ADMINKEY="<TU_ADMIN_KEY>" \
EMAIL_A="luismadef45+transportista@gmail.com" PASS_A="DemoRoles2026!" \
EMAIL_B="luismadef45+voluntario@gmail.com" PASS_B="DemoRoles2026!" \
node scripts/verificar-v01-reserva.mjs
```

Esperado **antes** del arreglo: fallan las pruebas 1, 3, 4 y 6 (hoy cualquiera puede hacer todo). Salida distinta de 0.

- [ ] **Step 3: Ampliar `viajeVigente` para que traiga los datos de la reserva**

En `supabase/functions/api/index.ts`, reemplazar la función de la línea 93:

```ts
// Viaje vigente de una factura = el último intento que aún no llegó al paso 3.
async function viajeVigente(facturaId: number) {
  const { data } = await supa.from('viajes')
    .select('id, email, eta_minutos, paso1_ts, resuelto, paso1_lat, paso1_lng, paso2_lat, paso2_lng, km_tramo1')
    .eq('factura_id', facturaId).is('paso3_ts', null)
    .order('creado_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}
```

- [ ] **Step 4: Añadir los tres helpers de autorización**

Inmediatamente **después** de `viajeVigente`, añadir:

```ts
// ===== La reserva del viaje ES el permiso del ciclo logístico (V01) =====
// Un insumo solo lo mueve quien lo reservó. La reserva vive en la fila de `viajes`:
// quién (email del JWT), cuándo empezó (paso1_ts) y hasta cuándo vale (eta + gracia).
const GRACIA_RESERVA_MIN = 60;

// Reserva viva = viaje sin cerrar, no resuelto por el admin y dentro de su plazo.
// Fuera de plazo devuelve null → el trabajo queda libre para que lo tome otro.
async function reservaViva(facturaId: number) {
  const v = await viajeVigente(facturaId);
  if (!v || v.resuelto) return null;
  const inicio = v.paso1_ts ? new Date(String(v.paso1_ts)).getTime() : 0;
  if (!inicio) return null;
  const vence = inicio + ((Number(v.eta_minutos) || 0) + GRACIA_RESERVA_MIN) * 60_000;
  return Date.now() < vence ? v : null;
}

// Exige sesión iniciada y devuelve la identidad VERIFICADA del JWT. El correo nunca
// se toma del cuerpo de la petición: el cliente puede mentir, el JWT no.
async function exigirSesion(p: Record<string, unknown>) {
  const jwt = s(p.accessToken, 4000);
  if (!jwt) throw new Error('Entra con tu cuenta para reservar este trabajo');
  return await identidadSesion(jwt);
}

// Para avanzar un trabajo hay que ser el dueño de su reserva viva.
async function exigirDuenoReserva(facturaId: number, email: string) {
  const v = await reservaViva(facturaId);
  if (!v) throw new Error('Tu reserva venció; vuelve a reservarla');
  if (String(v.email || '').toLowerCase() !== email.toLowerCase()) {
    throw new Error('Este trabajo está reservado por otra persona');
  }
  return v;
}
```

- [ ] **Step 5: Exigir sesión y reserva libre en `viaje_iniciar`**

En el `case 'viaje_iniciar'` (línea ~687), reemplazar las dos primeras líneas del cuerpo:

```ts
      const nombre = s(p.nombreTransportista, 120);
      if (!nombre) throw new Error('nombre del transportista requerido');
```

por:

```ts
      // V01: reservar exige sesión. El nombre sale de la identidad, no del cliente.
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
```

Y justo **después** del bloque que valida el estado de la factura (tras el
`} else if (f.estado !== 'Ofrecida') { throw ... }`), antes del `insert` en `viajes`, añadir:

```ts
      // Si ya hay una reserva viva de OTRA persona, este trabajo no está libre.
      // Si es tuya, no se duplica la fila: sigues con la que ya tenías.
      const reservaPrevia = await reservaViva(f.id);
      if (reservaPrevia) {
        if (String(reservaPrevia.email || '').toLowerCase() !== ident.email.toLowerCase()) {
          throw new Error('Este trabajo ya lo reservó otra persona');
        }
        return { ok: true, yaReservado: true, viajeId: reservaPrevia.id };
      }
```

Por último, en el `insert` de `viajes`, cambiar el email para que venga de la identidad:

```ts
      const { error } = await supa.from('viajes').insert({
        factura_id: f.id, transportista: nombre, email: ident.email,
        eta_minutos: eta, paso1_ts: new Date().toISOString(), paso1_lat: gps.lat, paso1_lng: gps.lng });
```

- [ ] **Step 6: Exigir ser el dueño en `registrar_recogida`**

En el `case 'registrar_recogida'` (línea ~722), reemplazar:

```ts
      const nombre = s(p.nombreTransportista, 120);
      if (!nombre) throw new Error('nombre del transportista requerido');
```

por:

```ts
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
```

Y justo **después** de la línea `if (f.estado !== 'Comprada') throw new Error('Este insumo no está listo para recoger');`, añadir:

```ts
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
```

- [ ] **Step 7: Exigir ser el dueño en `recoger_oferta`**

En el `case 'recoger_oferta'` (línea ~895), reemplazar:

```ts
      const nombre = s(p.nombreTransportista, 120);
      if (!nombre) throw new Error('nombre del transportista requerido');
```

por:

```ts
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
```

Y justo **después** de `if (f.estado !== 'EnCamino' && f.estado !== 'Ofrecida') throw new Error('Esta donación ya fue recogida');`, añadir:

```ts
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
```

- [ ] **Step 8: Exigir ser el dueño en `registrar_entrega_final`**

En el `case 'registrar_entrega_final'` (línea ~774), justo **después** de:

```ts
      const receptor = s(p.nombreReceptor, 120);
      if (!receptor) throw new Error('nombre de quien recibe requerido');
```

añadir:

```ts
      const ident = await exigirSesion(p); // V01: entregar exige sesión
```

Y justo **después** del bloque que valida el estado
(`} else if (f.estado !== 'Recogida') { throw ... }`), añadir:

```ts
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
```

- [ ] **Step 9: Desplegar la edge function**

Desplegar `supabase/functions/api/index.ts` al proyecto `zryfwbjvlacorryzdaod` (función `api`, `verify_jwt` sigue en `false`). Anotar el número de versión nuevo.

- [ ] **Step 10: Ejecutar la prueba y confirmar que PASA**

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" ADMINKEY="<TU_ADMIN_KEY>" \
EMAIL_A="luismadef45+transportista@gmail.com" PASS_A="DemoRoles2026!" \
EMAIL_B="luismadef45+voluntario@gmail.com" PASS_B="DemoRoles2026!" \
node scripts/verificar-v01-reserva.mjs
```

Esperado: las 6 pruebas en ✅ y salida `0`.

- [ ] **Step 11: Comprobar que una reserva caducada libera el trabajo**

Esta es la prueba 7 del spec y necesita un presupuesto **sin recoger** (la caducidad
solo libera trabajos que todavía no se recogieron; los ya recogidos los resuelve el
admin). Crear uno nuevo y dejarlo reservado por A:

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" ADMINKEY="<TU_ADMIN_KEY>" \
EMAIL_A="luismadef45+transportista@gmail.com" PASS_A="DemoRoles2026!" node - <<'JS'
const BASE='https://zryfwbjvlacorryzdaod.supabase.co';
const {ANON,ADMINKEY,EMAIL_A,PASS_A}=process.env;
const H={'Content-Type':'application/json',apikey:ANON,Authorization:`Bearer ${ANON}`};
const api=async(b)=>(await fetch(`${BASE}/functions/v1/api`,{method:'POST',headers:H,body:JSON.stringify(b)})).json();
const FOTO='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/aAAgBAQAAPwA/8H//2Q==';
const j=await(await fetch(`${BASE}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON},body:JSON.stringify({email:EMAIL_A,password:PASS_A})})).json();
const c=await api({accion:'admin_crear_presupuesto',adminKey:ADMINKEY,centro:'Comunidad El Hatillo',insumo:'ZZTEST caducidad',tienda:'ZZTEST tienda',direccion:'Av prueba',cantidad:1,precio:100,tiendaLat:10.44,tiendaLng:-66.82});
await api({accion:'donar_dinero',token:c.token,montoUsd:1,comprobante:FOTO,nombreDonante:'ZZTEST'});
await api({accion:'admin_presupuesto_transferido',adminKey:ADMINKEY,token:c.token,consolidado:FOTO});
await api({accion:'admin_presupuesto_comprado',adminKey:ADMINKEY,token:c.token,factura:FOTO});
console.log('reserva A:',JSON.stringify(await api({accion:'viaje_iniciar',token:c.token,accessToken:j.access_token,etaMinutos:60,gps:{lat:10.48,lng:-66.90}})));
console.log('TOKEN_CADUCIDAD='+c.token);
JS
```

Envejecer esa reserva en Supabase para que venza (60 min de ETA + 60 de gracia):

```sql
update viajes set paso1_ts = now() - interval '10 hours'
where factura_id = (select id from facturas where token_publico = '<TOKEN_CADUCIDAD>');
```

Ahora B debe poder reservarla:

```bash
ANON="<CLAVE_PUBLISHABLE>" EMAIL_B="luismadef45+voluntario@gmail.com" PASS_B="DemoRoles2026!" \
TOKEN="<TOKEN_CADUCIDAD>" node - <<'JS'
const BASE='https://zryfwbjvlacorryzdaod.supabase.co';
const {ANON,EMAIL_B,PASS_B,TOKEN}=process.env;
const H={'Content-Type':'application/json',apikey:ANON,Authorization:`Bearer ${ANON}`};
const j=await(await fetch(`${BASE}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON},body:JSON.stringify({email:EMAIL_B,password:PASS_B})})).json();
const r=await(await fetch(`${BASE}/functions/v1/api`,{method:'POST',headers:H,body:JSON.stringify({accion:'viaje_iniciar',token:TOKEN,accessToken:j.access_token,etaMinutos:60,gps:{lat:10.48,lng:-66.90}})})).json();
console.log(r.success===false ? '❌ B NO pudo reservar: '+r.error : '✅ 7. Reserva caducada: B pudo reservarla');
JS
```

Esperado: `✅ 7. Reserva caducada: B pudo reservarla`. Añadir `<TOKEN_CADUCIDAD>` a la
limpieza del paso siguiente.

- [ ] **Step 12: Limpiar los datos de prueba**

Con los dos tokens que imprimieron los scripts (`TOKEN_LIMPIAR` del paso 10 y
`TOKEN_CADUCIDAD` del paso 11), ejecutar en Supabase:

```sql
with objetivo as (
  select id from facturas where token_publico in ('<TOKEN_LIMPIAR>', '<TOKEN_CADUCIDAD>')
)
delete from evidencias where factura_id in (select id from objetivo);
with objetivo as (
  select id from facturas where token_publico in ('<TOKEN_LIMPIAR>', '<TOKEN_CADUCIDAD>')
)
delete from viajes where factura_id in (select id from objetivo);
with objetivo as (
  select id from facturas where token_publico in ('<TOKEN_LIMPIAR>', '<TOKEN_CADUCIDAD>')
)
delete from movimientos_factura where factura_id in (select id from objetivo);
with objetivo as (
  select id from facturas where token_publico in ('<TOKEN_LIMPIAR>', '<TOKEN_CADUCIDAD>')
)
delete from donaciones where factura_id in (select id from objetivo);
delete from facturas where token_publico in ('<TOKEN_LIMPIAR>', '<TOKEN_CADUCIDAD>');
delete from historial_movimientos where insumo like 'ZZTEST%';
```

⚠️ Los archivos subidos por las pruebas (comprobante y facturas) quedan en storage.
Borrarlos también:

```sql
set session_replication_role = replica;
delete from storage.objects where bucket_id in ('comprobantes','presupuestos')
  and (name like 'don/%' or name like 'pres/%')
  and created_at > now() - interval '2 hours';
set session_replication_role = default;
```

Verificar que queda en cero:

```sql
select count(*) as quedan from facturas where descripcion like '%ZZTEST%';
```

- [ ] **Step 13: Commit**

```bash
git add supabase/functions/api/index.ts scripts/verificar-v01-reserva.mjs
git commit -m "security(V01): la reserva del viaje autoriza el ciclo logístico

Las 4 acciones logísticas exigen sesión y ser el dueño de la reserva viva.
El email sale del JWT verificado, nunca del cuerpo. Conocer el token DV- deja
de dar poder (y los tokens siguen públicos para la trazabilidad del donante)."
```

---

## Task 2: Frontend — el transportista manda su sesión y entra si no la tiene (V01)

**Files:**
- Modify: `js/viaje.js:56-75` (simulación), `:105-111` (campo de nombre), `:245-250` y `:356-358` (envíos reales)
- Modify: `locales/es.json`, `locales/en.json`
- Modify: `index.html`, `ventana.html`, `sw.js` (versión PWA 89 → 90)

**Interfaces:**
- Consumes: `sesionActual() → {access_token, email, nombre, roles} | null` (ya existe, `js/core.js`); las acciones de la Tarea 1, que ahora exigen `accessToken`.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Añadir los textos nuevos a los dos idiomas**

En `locales/es.json`, dentro del objeto `"trip"`:

```json
    "loginRequired": "Entra con tu cuenta para reservar este trabajo",
    "loginCta": "Entrar y reservar",
    "takenByOther": "Este trabajo ya lo reservó otra persona"
```

En `locales/en.json`, dentro del objeto `"trip"`:

```json
    "loginRequired": "Sign in to reserve this job",
    "loginCta": "Sign in and reserve",
    "takenByOther": "Someone else already reserved this job"
```

- [ ] **Step 2: Verificar la paridad de idiomas**

```bash
cd /root/donaciones-venezuela && python3 scripts/verificar-idioma.py
```
Esperado: `Idioma OK: … claves paralelas en es/en, sin texto cableado en el JS.` y salida `0`.

- [ ] **Step 3: Sustituir el campo de nombre libre por la puerta de acceso**

En `js/viaje.js`, reemplazar el bloque de las líneas 105-111:

```js
        ${nombreSesion
          ? `<p class="meta"><strong>${e(t('cycle.driverName'))}:</strong> ${e(nombreSesion)}</p>
             <input id="viaje-nombre" type="hidden" value="${e(nombreSesion)}" />`
          : `<div class="field full">
               <label for="viaje-nombre">${e(t('cycle.driverName'))}</label>
               <input id="viaje-nombre" required autocomplete="name" value="" />
             </div>`}
```

por:

```js
        ${nombreSesion
          ? `<p class="meta"><strong>${e(t('cycle.driverName'))}:</strong> ${e(nombreSesion)}</p>
             <input id="viaje-nombre" type="hidden" value="${e(nombreSesion)}" />`
          : `<div class="field full">
               <p class="form-message visible info">${e(t('trip.loginRequired'))}</p>
               <a class="btn btn-primary" id="viaje-entrar" href="/#acceso">${e(t('trip.loginCta'))}</a>
             </div>`}
```

- [ ] **Step 4: Recordar el trabajo para volver tras entrar**

En `js/viaje.js`, justo **después** de la línea `const sesion = (typeof sesionActual === 'function' && sesionActual()) || null;` (línea 84), añadir:

```js
      // Sin sesión: al entrar, el usuario vuelve solo a este trabajo (dv-retorno ya
      // lo gestiona el flujo de acceso).
      if (!sesion) {
        try { sessionStorage.setItem('dv-retorno', '#viaje'); } catch (err) { /* modo privado */ }
      }
```

- [ ] **Step 5: Mandar el `accessToken` en el arranque del viaje**

En `js/viaje.js`, en el envío de `viaje_iniciar` (línea ~356), añadir el campo `accessToken`:

```js
            nombreTransportista: nombre, etaMinutos: eta,
            accessToken: (sesion && sesion.access_token) || '',
            email: (sesion && sesion.email) || ''
```

- [ ] **Step 6: Mandar el `accessToken` en recogida y entrega**

En `js/viaje.js`, en el bloque de los envíos reales (línea ~245), añadir `accessToken` a las dos ramas:

```js
              ? { accion: 'recoger_oferta', token: pr.token, nombreTransportista: nombre,
                  accessToken: (sesion && sesion.access_token) || '',
```

```js
              : { accion: 'registrar_recogida', token: pr.token, nombreTransportista: nombre,
                  accessToken: (sesion && sesion.access_token) || '',
```

Y en el envío de `registrar_entrega_final` del mismo archivo, añadir igualmente:

```js
                accessToken: (sesion && sesion.access_token) || '',
```

- [ ] **Step 7: Arreglar el modo simulación (botón de desarrollo)**

En `js/viaje.js`, dentro de `simularViaje` (línea ~56), reemplazar:

```js
      const sesion = (typeof sesionActual === 'function' && sesionActual()) || {};
      const nombre = sesion.nombre || 'SIM';
```

por:

```js
      const sesion = (typeof sesionActual === 'function' && sesionActual()) || {};
      const nombre = sesion.nombre || 'SIM';
      // La simulación recorre las acciones REALES, que ahora exigen sesión (V01).
      if (!sesion.access_token) { toast(t('trip.loginRequired')); return; }
```

Y añadir `accessToken: sesion.access_token` a los tres envíos de `simularViaje`
(`viaje_iniciar`, `recoger_oferta`/`registrar_recogida`, `registrar_entrega_final`).

- [ ] **Step 8: Subir la versión PWA 89 → 90**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
s = open('sw.js').read().replace("const VERSION = '89';", "const VERSION = '90';", 1)
open('sw.js', 'w').write(s)
for f in ('index.html', 'ventana.html'):
    t = open(f).read().replace('v=89', 'v=90')
    open(f, 'w').write(t)
print('listo')
PY
grep -n "VERSION = " sw.js; grep -c "v=89" index.html ventana.html sw.js
```

Esperado: `const VERSION = '90';` y `0` ocurrencias de `v=89` en los tres archivos.

- [ ] **Step 9: Comprobar en el navegador que el flujo sigue vivo**

Servir el proyecto en local y abrir la vista del transportista:

```bash
cd /root/donaciones-venezuela && python3 -m http.server 8140 --bind 127.0.0.1
```

Con el navegador en `http://127.0.0.1:8140/`, entrar a la puerta «Soy transportista»,
abrir un insumo por recoger y comprobar **sin sesión iniciada**:
- Aparece el mensaje «Entra con tu cuenta para reservar este trabajo» y el botón.
- **No** aparece el campo de nombre en texto libre.
- La consola del navegador no muestra errores.

Después, iniciar sesión con `luismadef45+transportista@gmail.com` / `DemoRoles2026!` y
comprobar que el nombre sale relleno y el botón de reservar funciona.

- [ ] **Step 10: Commit y despliegue**

```bash
git add js/viaje.js locales/es.json locales/en.json index.html ventana.html sw.js
git commit -m "security(V01): el transportista manda su sesión; puerta de acceso si no la tiene

Sustituye el campo de nombre en texto libre por 'entra para reservar' (el regreso
automático ya lo hace dv-retorno). Añade accessToken a los envíos del ciclo y a la
simulación de desarrollo. PWA v89 -> v90."
git push origin main
```

Esperado: Vercel despliega en ~1 min. Confirmar con
`curl -s https://donacionesvenezuela.vercel.app/ventana.html | grep -o "viaje.js?v=[0-9]*"` → `viaje.js?v=90`.

---

## Task 3: Identidad y token del panel (V02)

**Files:**
- Modify: `supabase/functions/api/index.ts:958-961` (`acceso_perfil`)
- Modify: `js/core.js:572` y `js/admin.js:1499` (**la misma línea duplicada**)
- Modify: `js/panel.js` (guardar el token al entrar)
- Modify: `locales/es.json`, `locales/en.json`
- Modify: `index.html`, `ventana.html`, `sw.js` (versión PWA 90 → 91)
- Create: `scripts/verificar-v02-identidad.mjs`

**Interfaces:**
- Consumes: `acceso_perfil` (ya existe); `sesionActual()` (ya existe).
- Produces: clave de `localStorage` **`dv-token-centro`** (string con el token `CTR-…` del centro en ese dispositivo). La leen `js/core.js` y `js/admin.js`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/verificar-v02-identidad.mjs`:

```js
#!/usr/bin/env node
// Prueba V02: acceso_perfil NO debe entregar el token del panel de un centro.
// Uso: ANON=... EMAIL_C=... PASS_C=... node scripts/verificar-v02-identidad.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, EMAIL_C, PASS_C } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL_C, password: PASS_C }) });
const sesion = await r.json();
if (!sesion.access_token) throw new Error('login falló');

const perfil = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ accion: 'acceso_perfil', accessToken: sesion.access_token }) })).json();

const roles = perfil.roles || [];
const centro = roles.find((x) => x.tipo === 'centro');
const fallos = [];
const ok = (n, c, extra = '') => { console.log(`${c ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); if (!c) fallos.push(n); };

ok('1. Sigue reconociendo el rol de centro', !!centro, centro ? centro.nombre : 'sin rol centro');
ok('2. NO devuelve el token del panel', !!centro && !centro.token,
   centro && centro.token ? `FUGA: ${centro.token}` : 'sin token');

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que FALLA**

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" \
EMAIL_C="luismadef45+centro@gmail.com" PASS_C="DemoRoles2026!" \
node scripts/verificar-v02-identidad.mjs
```

Esperado **antes** del arreglo: la prueba 2 falla con `FUGA: CTR-…`. Salida distinta de 0.

- [ ] **Step 3: Dejar de devolver el token en `acceso_perfil`**

En `supabase/functions/api/index.ts`, reemplazar el bloque de la línea 958:

```ts
      const { data: pans } = await supa.from('centros_panel').select('token_centro, lugares(nombre)').eq('email', email);
      for (const c of pans || []) {
        roles.push({ tipo: 'centro', nombre: (c as { lugares?: { nombre?: string } }).lugares?.nombre || 'Centro', token: c.token_centro });
      }
```

por:

```ts
      // V02: NO se devuelve token_centro. Tener un correo que coincide no puede
      // entregar la credencial del panel; el centro sigue entrando con token + PIN.
      const { data: pans } = await supa.from('centros_panel').select('lugares(nombre)').eq('email', email);
      for (const c of pans || []) {
        roles.push({ tipo: 'centro', nombre: (c as { lugares?: { nombre?: string } }).lugares?.nombre || 'Centro' });
      }
```

- [ ] **Step 4: Desplegar la edge function y confirmar que la prueba PASA**

Desplegar `supabase/functions/api/index.ts` y volver a ejecutar:

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" \
EMAIL_C="luismadef45+centro@gmail.com" PASS_C="DemoRoles2026!" \
node scripts/verificar-v02-identidad.mjs
```

Esperado: las 2 pruebas en ✅ y salida `0`.

- [ ] **Step 5: Guardar el token del centro en el dispositivo al entrar al panel**

En `js/panel.js`, localizar la función que autentica el panel (la que envía
`accion: 'panel_ver'` con token y PIN) y, justo después de que la respuesta llegue sin
error, añadir:

```js
      // El token queda en ESTE dispositivo para que el centro no lo reescriba cada vez.
      // El servidor ya no lo entrega por correo (V02); esta copia es local y del dueño.
      try { localStorage.setItem('dv-token-centro', tokenCentro); } catch (err) { /* modo privado */ }
```

donde `tokenCentro` es la variable que ya contiene el token `CTR-…` introducido.

- [ ] **Step 6: Construir el enlace del panel desde el token local**

En `js/core.js`, reemplazar la línea 572:

```js
      return `<li><strong>${e(t('access.centerTitle'))}</strong> · ${e(r.nombre)} — <a href="/panel-centro?token=${e(encodeURIComponent(r.token || ''))}">${e(t('access.goCenter'))}</a></li>`;
```

por:

```js
      // V02: el token ya no viaja desde el servidor. Si este dispositivo lo tiene
      // guardado, se prellena; si no, el centro lo escribe en el panel.
      const tokLocal = (function () { try { return localStorage.getItem('dv-token-centro') || ''; } catch (err) { return ''; } })();
      const hrefCentro = tokLocal ? `/panel-centro?token=${encodeURIComponent(tokLocal)}` : '/panel-centro';
      return `<li><strong>${e(t('access.centerTitle'))}</strong> · ${e(r.nombre)} — <a href="${e(hrefCentro)}">${e(t('access.goCenter'))}</a></li>`;
```

- [ ] **Step 7: Aplicar el mismo cambio en la copia duplicada**

En `js/admin.js`, la línea 1499 es **idéntica**. Reemplazarla por el mismo bloque del
paso anterior. Verificar que no queda ninguna otra copia:

```bash
cd /root/donaciones-venezuela && grep -rn "panel-centro?token=\${" js/
```
Esperado: sin resultados (las dos ocurrencias ya usan `hrefCentro`).

- [ ] **Step 8: Subir la versión PWA 90 → 91 y verificar idiomas**

```bash
cd /root/donaciones-venezuela && python3 - <<'PY'
s = open('sw.js').read().replace("const VERSION = '90';", "const VERSION = '91';", 1)
open('sw.js', 'w').write(s)
for f in ('index.html', 'ventana.html'):
    t = open(f).read().replace('v=90', 'v=91')
    open(f, 'w').write(t)
print('listo')
PY
python3 scripts/verificar-idioma.py
```

Esperado: `const VERSION = '91';` y `Idioma OK: …` con salida `0`.
*(Esta tarea no añade textos nuevos; la verificación es para confirmar que nada se rompió.)*

- [ ] **Step 9: Activar la confirmación de correo en Supabase**

⚠️ Esto lo hace **Luis** en el panel de Supabase (no se puede por SQL ni por código):

📍 **En [supabase.com](https://supabase.com) → proyecto `zryfwbjvlacorryzdaod` → Authentication → Sign In / Providers → Email**

1. Activar **«Confirm email»**.
2. Guardar.

**Salida esperada:** las cuentas nuevas reciben un correo y no pueden entrar hasta
confirmarlo. *Ya verificado: las 5 cuentas existentes tienen `email_confirmed_at`
relleno (Supabase las auto-confirmó mientras la opción estaba apagada), así que
**nadie queda fuera** y no hace falta ningún backfill.*

Comprobar que las cuentas viejas siguen entrando:

```bash
curl -s -X POST "https://zryfwbjvlacorryzdaod.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <CLAVE_PUBLISHABLE>" -H "Content-Type: application/json" \
  -d '{"email":"luismadef45+centro@gmail.com","password":"DemoRoles2026!"}' \
  | head -c 80
```
Esperado: una respuesta que empieza por `{"access_token":`.

- [ ] **Step 10: Comprobar el panel del centro en el navegador**

Servir en local, entrar como centro con token `CTR-DEMO-2026-TEST` y PIN `2468`,
y comprobar:
- El panel abre con normalidad.
- Tras entrar una vez, recargar `/#acceso`: el enlace «ir a mi centro» aparece
  **prellenado** (el token ya está en `localStorage`).
- En una ventana de incógnito (sin `localStorage`), el enlace lleva al panel **sin**
  token prellenado y el centro puede escribirlo a mano.

- [ ] **Step 11: Commit y despliegue**

```bash
git add supabase/functions/api/index.ts js/core.js js/admin.js js/panel.js \
        index.html ventana.html sw.js scripts/verificar-v02-identidad.mjs
git commit -m "security(V02): acceso_perfil deja de entregar el token del panel

Tener un correo que coincide con el de un centro ya no entrega su credencial.
El token se recuerda en localStorage del dispositivo para no perder la comodidad
del centro legítimo. PWA v90 -> v91."
git push origin main
```

---

## Task 4: Contacto del donante solo para quien tiene la reserva (V03)

**Files:**
- Modify: `supabase/functions/api/index.ts:348-357` (`ofertaUI`), `:623` (zona en `ofrecer_insumo`), `:877` (JSON de la oferta), `listar_ofertas`, `esLectura`
- Modify: `js/vistas.js:605-612` (render de ofertas)
- Modify: `js/core.js` (campo «zona» en el formulario de ofrecer)
- Modify: `locales/es.json`, `locales/en.json`
- Modify: `index.html`, `ventana.html`, `sw.js` (versión PWA 91 → 92)
- Create: `scripts/verificar-v03-contacto.mjs`

**Interfaces:**
- Consumes: `exigirSesion(p)` y `reservaViva(facturaId)` de la **Tarea 1**.
- Produces: acción `reserva_detalle` → `{ token, insumo, cantidad, unidad, nombreDonante, telefono, ubicacion, coords }` (contacto completo, solo para el dueño de la reserva).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/verificar-v03-contacto.mjs`:

```js
#!/usr/bin/env node
// Prueba V03: la lista pública de ofertas no puede exponer PII del donante.
// Uso: ANON=... node scripts/verificar-v03-contacto.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

const res = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H, body: JSON.stringify({ accion: 'listar_ofertas' }) })).json();
const ofertas = res.ofertas || [];

const fallos = [];
const ok = (n, c, extra = '') => { console.log(`${c ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); if (!c) fallos.push(n); };

ok('0. Hay al menos una oferta para revisar', ofertas.length > 0, `${ofertas.length} ofertas`);
const conTel   = ofertas.filter((o) => o.telefono);
const conNom   = ofertas.filter((o) => o.nombreDonante);
const conCoord = ofertas.filter((o) => o.coords);

ok('1. Ninguna oferta expone teléfono', conTel.length === 0, `${conTel.length} con teléfono`);
ok('2. Ninguna oferta expone el nombre del donante', conNom.length === 0, `${conNom.length} con nombre`);
ok('3. Ninguna oferta expone coordenadas exactas', conCoord.length === 0, `${conCoord.length} con coords`);

// Las coords aproximadas sí deben venir, con 2 decimales como máximo.
const aprox = ofertas.filter((o) => o.coordsAprox);
const bienRedondeadas = aprox.every((o) =>
  Math.abs(o.coordsAprox.lat * 100 - Math.round(o.coordsAprox.lat * 100)) < 1e-9 &&
  Math.abs(o.coordsAprox.lng * 100 - Math.round(o.coordsAprox.lng * 100)) < 1e-9);
ok('4. coordsAprox viene redondeada a 2 decimales', aprox.length > 0 && bienRedondeadas,
   `${aprox.length} con coordsAprox`);

// reserva_detalle sin sesión debe rechazar.
const sinSesion = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ accion: 'reserva_detalle', token: ofertas[0]?.token || 'DV-XXXX-XXXX-XXXX' }) })).json();
ok('5. reserva_detalle sin sesión es rechazado', sinSesion?.success === false, sinSesion?.error);

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que FALLA**

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" node scripts/verificar-v03-contacto.mjs
```

Esperado **antes** del arreglo: fallan 1, 2, 3, 4 y 5 (hoy la lista devuelve teléfono,
nombre y coords exactas, y `reserva_detalle` no existe).

- [ ] **Step 3: Separar la vista pública de la privada en `ofertaUI`**

En `supabase/functions/api/index.ts`, reemplazar la función de la línea 348:

```ts
function ofertaUI(f: Record<string, unknown>) {
  const m = metaOferta(String(f.descripcion ?? ''));
  if (!m) return null;
  return {
    token: f.token_publico, estado: f.estado,
    insumo: m.insumo, cantidad: m.cantidad, unidad: m.unidad,
    ubicacion: m.ubicacion, telefono: m.telefono, nombreDonante: m.nombreDonante, centro: m.centro,
    coords: m.coords ?? null,
  };
}
```

por:

```ts
// Vista PRIVADA de una oferta: contacto completo. Solo para quien tiene su reserva.
function ofertaUI(f: Record<string, unknown>) {
  const m = metaOferta(String(f.descripcion ?? ''));
  if (!m) return null;
  return {
    token: f.token_publico, estado: f.estado,
    insumo: m.insumo, cantidad: m.cantidad, unidad: m.unidad,
    ubicacion: m.ubicacion, telefono: m.telefono, nombreDonante: m.nombreDonante, centro: m.centro,
    coords: m.coords ?? null,
  };
}

// V03 — Vista PÚBLICA de una oferta: ni nombre, ni teléfono, ni dirección exacta.
// Solo la zona y unas coordenadas redondeadas a ~1 km, que bastan para calcular
// «cuánto me queda de camino» y no sirven para localizar la casa de nadie.
function ofertaPublicaUI(f: Record<string, unknown>) {
  const m = metaOferta(String(f.descripcion ?? ''));
  if (!m) return null;
  const c = m.coords as { lat?: number; lng?: number } | null;
  const aprox = (c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)))
    ? { lat: Math.round(Number(c.lat) * 100) / 100, lng: Math.round(Number(c.lng) * 100) / 100 }
    : null;
  return {
    token: f.token_publico, estado: f.estado,
    insumo: m.insumo, cantidad: m.cantidad, unidad: m.unidad,
    zona: m.zona || '', centro: m.centro,
    coordsAprox: aprox,
  };
}
```

- [ ] **Step 4: Servir la lista pública con la vista pública**

En el `case 'listar_ofertas'`, cambiar la última línea:

```ts
      return { ofertas: (data || []).map(ofertaUI).filter(Boolean) };
```

por:

```ts
      return { ofertas: (data || []).map(ofertaPublicaUI).filter(Boolean) };
```

- [ ] **Step 5: Guardar la zona al crear la oferta**

En `ofrecer_insumo`, junto a las otras lecturas de campos (cerca de la línea 623), añadir:

```ts
      const zona = s(p.zona, 80); // municipio o sector: contexto público sin señalar la casa
```

Y en el `JSON.stringify` de la descripción (línea ~877), añadir `zona` al objeto:

```ts
        descripcion: JSON.stringify({ k: 'oferta', insumo, cantidad, unidad, ubicacion, telefono, nombreDonante, zona,
```

- [ ] **Step 6: Añadir la acción `reserva_detalle`**

En `supabase/functions/api/index.ts`, justo **antes** del `case 'recoger_oferta'`, añadir:

```ts
    // V03: el contacto del donante solo lo ve quien tiene la reserva viva del trabajo.
    case 'reserva_detalle': {
      const ident = await exigirSesion(p);
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, token_publico, descripcion, estado').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('Trabajo no encontrado');
      await exigirDuenoReserva(f.id, ident.email);
      const oferta = ofertaUI(f);
      if (oferta) return { detalle: oferta };
      const pres = presupuestoUI(f);
      if (pres) return { detalle: pres };
      throw new Error('Trabajo no encontrado');
    }
```

- [ ] **Step 7: Que `reserva_detalle` no gaste el cupo de escrituras**

En la función `handle`, añadir la acción a la lista de lecturas (línea ~444):

```ts
  const esLectura = ['listar_presupuestos', 'listar_comprados', 'listar_ofertas', 'acceso_perfil', 'denuncias_listar', 'reserva_detalle'].includes(accion);
```

- [ ] **Step 8: Devolver el contacto al reservar**

En el `case 'viaje_iniciar'`, sustituir su última línea, que hoy es exactamente:

```ts
      return { ok: true, etaMinutos: eta };
```

por:

```ts
      // El que acaba de reservar ya puede ver el contacto (V03).
      return { ok: true, etaMinutos: eta, detalle: ofertaUI(f) || presupuestoUI(f) };
```

- [ ] **Step 9: Añadir los textos nuevos a los dos idiomas**

En `locales/es.json`, dentro del objeto `"offer"`:

```json
    "zoneLabel": "Municipio o sector (opcional)",
    "zonePh": "Chacao, El Hatillo, Petare…",
    "zoneHelp": "Ayuda al transportista a saber si le queda de camino. Tu dirección exacta y tu teléfono solo los ve quien reserve la recogida.",
    "zoneUnknown": "Zona no indicada",
    "distanceAway": "a ~{km} km de ti"
```

En `locales/en.json`, dentro del objeto `"offer"`:

```json
    "zoneLabel": "Municipality or area (optional)",
    "zonePh": "Chacao, El Hatillo, Petare…",
    "zoneHelp": "Helps the driver know if it is on their way. Your exact address and phone are only shown to whoever reserves the pickup.",
    "zoneUnknown": "Area not given",
    "distanceAway": "~{km} km from you"
```

- [ ] **Step 10: Añadir el campo «zona» al formulario de ofrecer**

En `js/core.js`, en el formulario de ofrecer insumo, junto al campo de `ubicacion`,
añadir el paso nuevo del asistente:

```js
        <div data-wiz-step class="field full">
          <label for="of-zona">${e(t('offer.zoneLabel'))}</label>
          <input id="of-zona" maxlength="80" placeholder="${e(t('offer.zonePh'))}" />
          <p class="field-help">${e(t('offer.zoneHelp'))}</p>
        </div>
```

Y en el envío de `ofrecer_insumo`, añadir el campo:

```js
          zona: ($('#of-zona') || {}).value ? $('#of-zona').value.trim() : '',
```

- [ ] **Step 11: Render de la lista de ofertas sin PII**

En `js/vistas.js` (línea ~605), reemplazar la línea del resumen:

```js
              <span class="meta">${e(of.ubicacion)}</span>
```

por:

```js
              <span class="meta">${e(of.zona || t('offer.zoneUnknown'))}</span>
```

Y dentro del cuerpo desplegable de la tarjeta, sustituir cualquier uso de
`of.telefono`, `of.nombreDonante` o `of.coords` por el aviso de que el contacto aparece
al reservar. Comprobar que no queda ninguno:

```bash
cd /root/donaciones-venezuela && grep -n "of\.telefono\|of\.nombreDonante\|of\.coords\b" js/vistas.js
```
Esperado: sin resultados.

- [ ] **Step 12: Desplegar, verificar idiomas y subir versión PWA 91 → 92**

Desplegar la edge function. Después:

```bash
cd /root/donaciones-venezuela && python3 scripts/verificar-idioma.py && python3 - <<'PY'
s = open('sw.js').read().replace("const VERSION = '91';", "const VERSION = '92';", 1)
open('sw.js', 'w').write(s)
for f in ('index.html', 'ventana.html'):
    t = open(f).read().replace('v=91', 'v=92')
    open(f, 'w').write(t)
print('listo')
PY
```

Esperado: `Idioma OK: …` y `const VERSION = '92';`.

- [ ] **Step 13: Ejecutar la prueba y confirmar que PASA**

```bash
cd /root/donaciones-venezuela && ANON="<CLAVE_PUBLISHABLE>" node scripts/verificar-v03-contacto.mjs
```

Esperado: las 6 pruebas en ✅ y salida `0`.

*Si la prueba 0 falla por no haber ofertas, crear una de prueba con
`ofrecer_insumo` (insumo `ZZTEST oferta V03`) y borrarla al terminar con el mismo SQL
de limpieza de la Tarea 1.*

- [ ] **Step 14: Commit y despliegue**

```bash
git add supabase/functions/api/index.ts js/vistas.js js/core.js \
        locales/es.json locales/en.json index.html ventana.html sw.js \
        scripts/verificar-v03-contacto.mjs
git commit -m "security(V03): el contacto del donante solo para quien tiene la reserva

La lista pública de ofertas deja de exponer nombre, teléfono y coordenadas exactas:
ahora muestra zona y coordenadas redondeadas a ~1 km. El contacto completo se sirve
por reserva_detalle, que exige ser el dueño de la reserva viva. PWA v91 -> v92."
git push origin main
```

---

## Verificación final (después de las cuatro tareas)

- [ ] Las tres pruebas pasan seguidas:

```bash
cd /root/donaciones-venezuela
ANON="<CLAVE_PUBLISHABLE>" ADMINKEY="<TU_ADMIN_KEY>" \
EMAIL_A="luismadef45+transportista@gmail.com" PASS_A="DemoRoles2026!" \
EMAIL_B="luismadef45+voluntario@gmail.com" PASS_B="DemoRoles2026!" \
node scripts/verificar-v01-reserva.mjs && \
ANON="<CLAVE_PUBLISHABLE>" EMAIL_C="luismadef45+centro@gmail.com" PASS_C="DemoRoles2026!" \
node scripts/verificar-v02-identidad.mjs && \
ANON="<CLAVE_PUBLISHABLE>" node scripts/verificar-v03-contacto.mjs
```

- [ ] No queda basura de prueba:

```sql
select
  (select count(*) from facturas where descripcion like '%ZZTEST%') as facturas_zztest,
  (select count(*) from historial_movimientos where insumo like 'ZZTEST%') as historial_zztest;
```
Esperado: ambos en `0`.

- [ ] La app en producción sirve la versión nueva y el flujo del donante sigue intacto
  (donar no pide cuenta):

```bash
curl -s https://donacionesvenezuela.vercel.app/index.html | grep -o "core.js?v=[0-9]*" | head -1
```
Esperado: `core.js?v=92`.

- [ ] Actualizar la memoria del proyecto y el informe de vulnerabilidades marcando
  V01, V02 y V03 como corregidos.

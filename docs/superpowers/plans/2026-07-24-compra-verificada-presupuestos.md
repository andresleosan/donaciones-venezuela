# Compra verificada de presupuestos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un presupuesto no salte automático a "Comprada" al cubrirse la meta, sino que pase por un ciclo de compra controlado por el admin (con prueba del donante, verificación, transferencia USD→Bs y factura de compra), y que el avance sea transparente y anónimo para el público.

**Architecture:** App estática vanilla (index/ventana + `js/*.js` en scope global compartido, sin bundler) que lee Supabase por PostgREST (vistas/RPC `*_public`) y escribe por la edge function `api` (Deno, `verify_jwt=false`). Este plan cambia: (1) la acción `donar_dinero` para exigir comprobante y frenar el auto-"Comprada"; (2) nuevas acciones admin para el ciclo de compra; (3) el seguimiento público para mostrar estados nuevos + desglose anónimo; (4) el wizard de donar (frontend) y el panel admin; (5) un notificador de Telegram apagado hasta configurar.

**Tech Stack:** HTML/CSS/JS vanilla, Service Worker (PWA), Supabase (Postgres + Storage + Edge Functions Deno/TypeScript), PostgREST, Playwright (verificación E2E), Vercel (deploy desde `main`).

## Global Constraints

- **No persistir el token de GitHub en disco.** Push con token efímero enmascarado: `git push "https://Luismadef45:$(awk '/oauth_token:/{print $2; exit}' /root/.config/gh/hosts.yml)@github.com/andresleosan/donaciones-venezuela.git" HEAD:main 2>&1 | sed -E 's#https://[^@]*@#https://***@#g'`.
- **Commits** autoría `Luismadef45 <luismadef45@gmail.com>` vía `git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit`, con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **El deploy de la edge fn DEBE preservar `verify_jwt=false`.** Delegar el deploy al subagente `agente-solucionador-vps` (lee el `index.ts` verbatim y despliega).
- **NUNCA** guardar la ADMIN_KEY en claro (`dv-adm-…`) en repo/memoria; solo el hash vive en `config.admin_key_hash`.
- **NUNCA** imprimir `config.cron_secret`, `config.telegram_bot_token` ni `config.telegram_chat_id`.
- **Todo valor externo interpolado en `innerHTML` pasa por `e()`.**
- **Al cambiar estáticos, subir `?v=`** en `index.html`, `ventana.html` y `sw.js` (+ `const VERSION`), manteniéndolos sincronizados (v85 → v86).
- **Paridad i18n es/en**: `python3 scripts/verificar-idioma.py` debe salir 0 (sin español incrustado en `js/`).
- **Deploy prod autorizado**; no dejar filas/objetos basura tras las pruebas (limpiar toda fila `ZZTEST`/prueba). El bucket de storage bloquea `delete` SQL directo → usar `set session_replication_role = replica;` en la misma sentencia para borrar objetos huérfanos.
- **Vercel auto-despliega desde `main`**; si se atasca (>5 min), empujar un commit vacío de nudge.

## Diseño de referencia (contexto para todas las tareas)

**Estados de `facturas.estado`** (valores canónicos en español, se traducen con `tValue('invoiceState', …)`):
```
Abierta ─(meta cubierta)→ PorComprar ─(admin: sube consolidado + "transferido")→ Transferida
   └→ (admin sube factura de compra) → Comprada → [visible a transportistas] → EnCamino/EnTransito → Recogida → Entregada → Cerrada
```
- `PorComprar` — "En espera de compra". La meta se cubrió; el admin debe actuar. NO visible a transportistas.
- `Transferida` — "Dinero transferido, comprando". El admin ya movió USD→Bs y subió el consolidado (público, anónimo) de transferencias recibidas.
- `Comprada` — solo al subir la factura pagada al proveedor. Recién aquí entra al ciclo del transportista (gate existente en `viaje_iniciar`/`listar_comprados`, NO se cambia).

**Archivos:**
- Comprobante del **donante** → PRIVADO (bucket `comprobantes`), columna `donaciones.comprobante`; el admin lo ve por URL firmada.
- Consolidado de transferencias (lo sube el admin, ya anonimizado por él) y factura de compra → PÚBLICOS (bucket `presupuestos` vía `guardarAdjunto`) como `evidencias` con `publica=true` (el seguimiento ya las muestra).
- **Desglose anónimo automático**: RPC público `seguimiento_donaciones(token)` que devuelve monto_usd + monto (Bs) + fecha de cada donación `Confirmada`, SIN nombre/referencia/comprobante.

**Anular donación falsa:** acción admin que marca la donación `Anulada` (el trigger de `monto_recaudado` deja de sumarla); si el recaudado cae por debajo de la meta y el estado era `PorComprar`/`Transferida`, el presupuesto vuelve a `Abierta`.

**Telegram:** la edge fn envía a `https://api.telegram.org/bot<token>/sendMessage` SOLO si `config.telegram_bot_token` y `config.telegram_chat_id` existen; si no, no hace nada. Se dispara cuando un presupuesto entra a `PorComprar`.

---

## File Structure

- `supabase/migrations/2026-07-24_compra_verificada.sql` (nuevo) — columna, bucket, config keys, RPC.
- `supabase/functions/api/index.ts` (modificar) — `donar_dinero`, `notificarTelegram`, `guardarComprobante`, acciones admin, `seguimiento_donaciones` no (RPC vive en SQL).
- `services/api.js` (modificar) — `donarDinero` pasa `comprobante`; nuevos wrappers de lectura pública (`getDesgloseDonaciones`) y de admin.
- `js/admin.js` (modificar) — wizard donar dinero (paso comprobante), alerta "en espera de compra", panel de gestión de compra.
- `js/vistas.js` (modificar) — seguimiento público: estados nuevos + desglose anónimo.
- `locales/es.json`, `locales/en.json` (modificar) — estados nuevos + textos.
- `index.html`, `ventana.html`, `sw.js` (modificar) — bump v85→v86.
- `docs/guia-telegram-notificaciones.md` (nuevo) — guía para activar Telegram después.

---

### Task 1: Migración de base de datos

**Files:**
- Create: `supabase/migrations/2026-07-24_compra_verificada.sql`

**Interfaces:**
- Produces: columna `donaciones.comprobante text`; bucket privado `comprobantes`; filas `config` `telegram_bot_token`/`telegram_chat_id` (valor `''`); RPC `public.seguimiento_donaciones(p_token text)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Comprobante de transferencia del donante (ruta en bucket PRIVADO).
alter table public.donaciones add column if not exists comprobante text not null default '';

-- Bucket PRIVADO para los comprobantes de los donantes.
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- Llaves de Telegram (vacías: el notificador queda apagado hasta configurarlas).
insert into public.config (clave, valor) values
  ('telegram_bot_token', ''), ('telegram_chat_id', '')
on conflict (clave) do nothing;

-- Desglose ANÓNIMO de donaciones para el seguimiento público: monto + fecha,
-- SIN nombre, referencia ni comprobante. SECURITY DEFINER para saltar RLS y
-- exponer solo estas columnas seguras.
create or replace function public.seguimiento_donaciones(p_token text)
returns table (monto_usd numeric, monto numeric, tasa numeric, creado timestamptz)
language sql security definer set search_path = public as $$
  select d.monto_usd, d.monto, d.tasa, d.created_at
  from public.donaciones d
  join public.facturas f on f.id = d.factura_id
  where f.token_publico = p_token and d.estado = 'Confirmada'
  order by d.created_at desc
  limit 200
$$;
revoke all on function public.seguimiento_donaciones(text) from public;
grant execute on function public.seguimiento_donaciones(text) to anon, authenticated;
```

- [ ] **Step 2: Aplicar la migración** con la herramienta MCP `apply_migration` (project_id `zryfwbjvlacorryzdaod`, name `compra_verificada`, query = el SQL de arriba).

- [ ] **Step 3: Verificar** con `execute_sql`:

```sql
select column_name from information_schema.columns
 where table_name='donaciones' and column_name='comprobante';
select id, public from storage.buckets where id='comprobantes';
select clave from public.config where clave in ('telegram_bot_token','telegram_chat_id');
select * from public.seguimiento_donaciones('__inexistente__'); -- 0 filas, sin error
```
Expected: 1 columna, bucket `comprobantes` public=false, 2 filas config, RPC responde vacío.

- [ ] **Step 4: Commit** (la migración es un archivo versionado):

```bash
git add supabase/migrations/2026-07-24_compra_verificada.sql
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (1/8): migracion (comprobante, bucket, config telegram, RPC desglose)"
```

---

### Task 2: Edge fn — donar_dinero con comprobante + freno del auto-Comprada + Telegram

**Files:**
- Modify: `supabase/functions/api/index.ts` (helpers nuevos + `case 'donar_dinero'` ~607-646)

**Interfaces:**
- Consumes: `guardarFoto(dataUrl, carpeta, nombre, bucket, maxBytes)`, `guardarAdjunto`, `s()`, `n()`, `tokenAlfa()`, `tasaActual()`, `supa`.
- Produces: helpers `guardarComprobante(dataUrl, carpeta, nombre): Promise<string>` (privado, acepta imagen o PDF, ≤5 MB) y `notificarTelegram(texto: string): Promise<void>`; `donar_dinero` exige `p.comprobante`, deja el estado en `PorComprar` al cubrir la meta y dispara Telegram.

- [ ] **Step 1: Añadir el helper de comprobante privado** (tras `guardarAdjunto`, ~línea 158). Acepta imagen o PDF y sube al bucket PRIVADO `comprobantes` (no genera URL pública; devuelve la ruta):

```ts
// Comprobante de transferencia del donante: imagen o PDF, ≤5 MB, bucket PRIVADO.
async function guardarComprobante(dataUrl: unknown, carpeta: string, nombre: string): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('comprobante inválido (se espera imagen JPEG/PNG o PDF)');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 200) throw new Error('comprobante vacío');
  if (bytes.length > 5_000_000) throw new Error('comprobante demasiado grande (máx 5 MB)');
  const ext = m[1] === 'application/pdf' ? 'pdf' : m[1].split('/')[1] === 'jpeg' ? 'jpg' : m[1].split('/')[1];
  const ruta = `${carpeta}/${nombre}.${ext}`;
  const { error } = await supa.storage.from('comprobantes').upload(ruta, bytes, { contentType: m[1], upsert: false });
  if (error) throw new Error('no se pudo guardar el comprobante');
  return ruta;
}
```

- [ ] **Step 2: Añadir el notificador de Telegram** (junto a los helpers de presupuestos, ~línea 300). Apagado si faltan las llaves; nunca rompe el flujo:

```ts
// Notificación a Telegram (apagada hasta que config tenga token + chat_id).
async function notificarTelegram(texto: string): Promise<void> {
  const { data } = await supa.from('config').select('clave, valor')
    .in('clave', ['telegram_bot_token', 'telegram_chat_id']);
  const cfg: Record<string, string> = {};
  for (const r of data || []) cfg[r.clave as string] = String(r.valor || '');
  if (!cfg.telegram_bot_token || !cfg.telegram_chat_id) return; // apagado
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: texto, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (_) { /* la notificación no debe tumbar la donación */ }
}
```

- [ ] **Step 3: Modificar `case 'donar_dinero'`** (~607-646): exigir comprobante, guardarlo en la donación, y al cubrir la meta dejar el estado en `PorComprar` (no `Comprada`) + movimiento `Recaudado` + Telegram. Reemplazar el bloque:

```ts
      // (dentro de donar_dinero, ANTES del insert de la donación)
      if (!p.comprobante) throw new Error('Adjunta el comprobante de tu transferencia');
      const comprobante = await guardarComprobante(p.comprobante, `don/${f.id}`, tokenAlfa('C'));
      // ...en el insert de la donación añadir:  comprobante,
      // ...tras recalcular el recaudado, reemplazar el bloque "Comprada":
      if (tras && Number(tras.monto_recaudado) >= Number(tras.monto_requerido) && tras.estado === 'Abierta') {
        estadoFinal = 'PorComprar';
        await supa.from('facturas').update({ estado: 'PorComprar' }).eq('id', f.id);
        await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recaudado',
          descripcion: mov('metaCubierta', {}), monto: 0 });
        await notificarTelegram(`✅ Se recaudó todo para <b>${f.objetivo || f.numero_factura}</b>.\nToca transferir y comprar. Token: ${f.token_publico}`);
      }
```
(Nota: `mov('metaCubierta', {})` requiere una entrada `metaCubierta` en el diccionario `MOV` de movimientos dentro de `index.ts`; añadirla es/en: "Meta cubierta, en espera de compra" / "Goal reached, awaiting purchase".)

- [ ] **Step 4: Verificar por deploy + curl E2E.** Desplegar con el subagente `agente-solucionador-vps` (preservando `verify_jwt=false`). Luego, con un presupuesto de prueba en Bs cuyo `monto_requerido` sea bajo, donar con comprobante (dataURL de imagen ≥1 KB) vía la edge fn:

Run (script en scratchpad, ANON = publishable key):
```
POST damnificado... no: POST { accion:'admin_crear_presupuesto', adminKey, centro, insumo, tienda, cantidad:1, precio:100 }  # crea presupuesto
POST { accion:'donar_dinero', token, montoUsd: <cubre la meta>, comprobante:'data:image/jpeg;base64,...' }
```
Expected: la respuesta trae `estado: "PorComprar"`; en la DB `facturas.estado='PorComprar'` y `donaciones.comprobante` no vacío; sin comprobante → error "Adjunta el comprobante".

- [ ] **Step 5: Commit.**
```bash
git add supabase/functions/api/index.ts
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (2/8): donar_dinero exige comprobante + PorComprar + Telegram"
```

---

### Task 3: Edge fn — acciones admin del ciclo de compra

**Files:**
- Modify: `supabase/functions/api/index.ts` (nuevos `case` admin, junto a los demás `admin_*`)

**Interfaces:**
- Consumes: `autenticarAdmin` (gate automático por `accion.startsWith('admin_')`), `guardarAdjunto` (público), `supa`, `s()`.
- Produces: `admin_donaciones_presupuesto`, `admin_donacion_anular`, `admin_presupuesto_transferido`, `admin_presupuesto_comprado`.

- [ ] **Step 1: `admin_donaciones_presupuesto`** — lista las donaciones de un presupuesto con URL firmada del comprobante (para verificar):

```ts
    case 'admin_donaciones_presupuesto': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      const { data } = await supa.from('donaciones')
        .select('id, nombre_donante, monto, monto_usd, tasa, referencia_pago, estado, comprobante, created_at')
        .eq('factura_id', f.id).order('created_at', { ascending: false });
      const filas: Record<string, unknown>[] = [];
      for (const d of data || []) {
        let url = '';
        if (d.comprobante) {
          const { data: signed } = await supa.storage.from('comprobantes').createSignedUrl(d.comprobante as string, 3600);
          url = signed?.signedUrl || '';
        }
        filas.push({ ...d, comprobante_url: url });
      }
      return { donaciones: filas };
    }
```

- [ ] **Step 2: `admin_donacion_anular`** — anula una donación y reabre el presupuesto si cae bajo la meta:

```ts
    case 'admin_donacion_anular': {
      const id = s(p.id, 40);
      const { data: d } = await supa.from('donaciones').select('id, factura_id').eq('id', id).maybeSingle();
      if (!d) throw new Error('donación no encontrada');
      await supa.from('donaciones').update({ estado: 'Anulada' }).eq('id', id); // el trigger deja de sumarla
      const { data: f } = await supa.from('facturas')
        .select('id, monto_recaudado, monto_requerido, estado').eq('id', d.factura_id).single();
      if (f && ['PorComprar', 'Transferida'].includes(f.estado as string)
            && Number(f.monto_recaudado) < Number(f.monto_requerido)) {
        await supa.from('facturas').update({ estado: 'Abierta' }).eq('id', f.id);
        await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Reapertura',
          descripcion: mov('reabiertoPorAnulacion', {}), monto: 0 });
      }
      return { estado: f?.estado, recaudado: Number(f?.monto_recaudado) || 0 };
    }
```

- [ ] **Step 3: `admin_presupuesto_transferido`** — marca USD→Bs transferido + sube el consolidado (PÚBLICO, anonimizado por el admin) → `Transferida`:

```ts
    case 'admin_presupuesto_transferido': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id, estado').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      if (f.estado !== 'PorComprar') throw new Error('El presupuesto no está en espera de compra');
      if (!p.consolidado) throw new Error('Sube el archivo consolidado de transferencias recibidas');
      const url = await guardarAdjunto(p.consolidado, `presup/${f.id}`, `transferencias-${Date.now()}`);
      await supa.from('evidencias').insert({ factura_id: f.id, archivo: url,
        descripcion: 'Transferencias recibidas (consolidado)', publica: true });
      await supa.from('facturas').update({ estado: 'Transferida' }).eq('id', f.id);
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Transferencia',
        descripcion: mov('transferidoABs', {}), monto: 0 });
      return { estado: 'Transferida' };
    }
```
(`Date.now()` está disponible en Deno; solo está prohibido en los scripts de build-loop, no en la edge fn.)

- [ ] **Step 4: `admin_presupuesto_comprado`** — sube la factura de compra (PÚBLICA) → `Comprada`:

```ts
    case 'admin_presupuesto_comprado': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id, estado').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      if (!['PorComprar', 'Transferida'].includes(f.estado as string)) throw new Error('El presupuesto no está listo para comprar');
      if (!p.factura) throw new Error('Sube la factura pagada al proveedor');
      const url = await guardarAdjunto(p.factura, `presup/${f.id}`, `factura-compra-${Date.now()}`);
      await supa.from('evidencias').insert({ factura_id: f.id, archivo: url,
        descripcion: 'Factura de compra pagada al proveedor', publica: true });
      await supa.from('facturas').update({ estado: 'Comprada' }).eq('id', f.id);
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Compra',
        descripcion: mov('compraConfirmada', {}), monto: 0 });
      return { estado: 'Comprada' };
    }
```

- [ ] **Step 5: Añadir las claves de `mov`** (`metaCubierta`, `reabiertoPorAnulacion`, `transferidoABs`, `compraConfirmada`) al diccionario `MOV` es/en dentro de `index.ts`.

- [ ] **Step 6: Verificar** (deploy vía subagente + curl E2E con adminKey): sobre el presupuesto de prueba en `PorComprar`, correr `admin_donaciones_presupuesto` (trae la donación + `comprobante_url` firmada), `admin_presupuesto_transferido` (con un dataURL) → `Transferida`, `admin_presupuesto_comprado` (con un dataURL) → `Comprada`; y en otro presupuesto probar `admin_donacion_anular` bajando de la meta → vuelve a `Abierta`. Confirmar en DB.

- [ ] **Step 7: Commit.**
```bash
git add supabase/functions/api/index.ts
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (3/8): acciones admin (ver/anular donaciones, transferido, comprado)"
```

---

### Task 4: Seguimiento público — estados nuevos + desglose anónimo

**Files:**
- Modify: `services/api.js` (wrapper `getDesgloseDonaciones`)
- Modify: `js/vistas.js` (render del seguimiento: estados + desglose)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: RPC `seguimiento_donaciones` (Task 1), `rpc()` de services/api.js.
- Produces: `SheetsService.getDesgloseDonaciones(token)`; el seguimiento muestra `values.invoiceState.PorComprar|Transferida` y una lista "Aportes recibidos" anónima.

- [ ] **Step 1: Wrapper en `services/api.js`** (junto a los demás): `getDesgloseDonaciones: (token) => rpc('seguimiento_donaciones', { p_token: token })`.

- [ ] **Step 2: En `js/vistas.js`**, donde se pinta el seguimiento por token, tras cargar la factura llamar a `getDesgloseDonaciones(token)` y pintar una sección "Aportes recibidos": por fila `≈ $${usd} · ${Bs} Bs · ${fecha}` (todo por `e()`), sin nombre. Mostrar el total y el conteo. Los estados `PorComprar`/`Transferida` se traducen con `tValue('invoiceState', estado)` (ya existente).

- [ ] **Step 3: i18n** — añadir a `values.invoiceState`: es `PorComprar`:"En espera de compra", `Transferida`:"Dinero transferido, comprando"; en `PorComprar`:"Awaiting purchase", `Transferida`:"Funds transferred, purchasing". Más `tracking.contributions`:"Aportes recibidos"/"Contributions received" y `tracking.anonNote`:"Mostramos montos y fechas, nunca la identidad de quien dona."/"We show amounts and dates, never the donor's identity.".

- [ ] **Step 4: Verificar (Playwright, local contra prod).** Con un presupuesto en `PorComprar` con 1 donación: abrir `/#seguimiento/<token>`, confirmar que el estado muestra "En espera de compra" y que la sección de aportes lista el monto+fecha SIN ningún nombre (grep del DOM: el `nombre_donante` NO aparece). exit i18n 0.

- [ ] **Step 5: Commit.**
```bash
git add services/api.js js/vistas.js locales/es.json locales/en.json
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (4/8): seguimiento con estados nuevos + desglose anonimo"
```

---

### Task 5: Frontend donante — paso de comprobante en el wizard de donar dinero

**Files:**
- Modify: `js/admin.js` (`abrirDonarDinero` / el wizard de donación monetaria)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: `famComprimir`-style no aplica (aquí puede ser imagen O PDF); usar un `FileReader` a dataURL directo (sin recomprimir el PDF).
- Produces: el submit de donar dinero envía `comprobante` (dataURL) junto a `montoUsd`.

- [ ] **Step 1:** En el formulario de donar dinero, añadir un paso/`.field` "Comprobante de tu transferencia" con `<input type="file" accept="image/*,application/pdf" required>` y una nota "Sube la captura o PDF de tu transferencia. Solo lo ve el equipo, para confirmar el aporte." Leer el archivo a dataURL con `FileReader.readAsDataURL` (guardado en una variable del closure). Si es imagen grande, recomprimir con canvas (reusar el patrón de `famComprimir`); si es PDF, enviar el dataURL tal cual.

- [ ] **Step 2:** En el submit, incluir `comprobante` en el payload de `donar_dinero`; bloquear el envío si no hay archivo (mensaje `t('money.proofRequired')`).

- [ ] **Step 3: i18n** — `money.proofLabel`, `money.proofHelp`, `money.proofRequired` (es/en).

- [ ] **Step 4: Verificar (Playwright móvil 390px):** el paso de comprobante aparece, sin archivo no deja enviar; con un archivo de prueba, el submit manda `comprobante` (interceptar `SheetsService.post` para confirmar el campo). exit i18n 0, `node --check js/admin.js` OK.

- [ ] **Step 5: Commit.**
```bash
git add js/admin.js locales/es.json locales/en.json
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (5/8): wizard donar dinero pide comprobante"
```

---

### Task 6: Frontend admin — alerta + gestión de compra

**Files:**
- Modify: `js/admin.js` (`cargarAdminData`, `irAMenu` alerta, nuevo panel `panelCompra`)
- Modify: `locales/es.json`, `locales/en.json`

**Interfaces:**
- Consumes: `postAdmin`, `admin_donaciones_presupuesto`, `admin_donacion_anular`, `admin_presupuesto_transferido`, `admin_presupuesto_comprado`.
- Produces: alerta "Presupuestos en espera de compra" en el menú admin + panel de gestión.

- [ ] **Step 1:** En `cargarAdminData`, cargar `adminData.porComprar = await opcional('admin_listar_presupuestos','presupuestos')` filtrando estados `PorComprar`/`Transferida` — o añadir una acción `admin_presupuestos_por_comprar` dedicada (más limpio; devuelve las facturas en esos estados con objetivo/recaudado/token). Preferir la acción dedicada.

- [ ] **Step 2:** En `irAMenu`, añadir un bloque `alertaCompra` (mismo patrón que `alertaHtml` de atrasos): título "⏳ En espera de compra (N)" + tarjeta por presupuesto (objetivo, recaudado/meta, token) con botón "Gestionar compra" → `panelCompra(token)`.

- [ ] **Step 3:** `panelCompra(token)`: (a) lista las donaciones (`admin_donaciones_presupuesto`) con enlace al `comprobante_url` (abrir en pestaña) + botón "Anular" (`admin_donacion_anular` con confirmación); (b) si estado `PorComprar`: input file (imagen/PDF) "Consolidado de transferencias (ANONIMÍZALO antes de subir)" + botón "Marcar transferido" (`admin_presupuesto_transferido`); (c) input file "Factura de compra" + botón "Confirmar compra" (`admin_presupuesto_comprado`). Tras cada acción, `refrescarAdminData()` + repintar. Toda interpolación por `e()`.

- [ ] **Step 4: i18n** de todos los textos del panel (es/en) bajo `admin.purchase.*`.

- [ ] **Step 5: Verificar (Playwright + E2E):** con adminKey de prueba, abrir el panel admin (`ventana.html?v=admin`), autenticar, ver la alerta con el presupuesto de prueba en `PorComprar`, abrir `panelCompra`, ver la donación + su comprobante (URL firmada 200), marcar transferido (sube dataURL) → estado Transferida, confirmar compra (sube dataURL) → estado Comprada; verificar en DB que ambas evidencias quedaron `publica=true`. `node --check`, i18n 0.

- [ ] **Step 6: Commit.**
```bash
git add js/admin.js locales/es.json locales/en.json
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (6/8): panel admin (alerta + gestion de compra)"
```

---

### Task 7: Versionado PWA + verificación integral

**Files:**
- Modify: `index.html`, `ventana.html`, `sw.js`

- [ ] **Step 1:** `sed` v85→v86 en `index.html`/`ventana.html`; `const VERSION = '86'` en `sw.js`.
- [ ] **Step 2:** `python3 scripts/verificar-idioma.py` → exit 0; `node --check` de los js tocados.
- [ ] **Step 3: E2E de humo end-to-end en prod** (tras deploy): crear presupuesto de prueba (Bs bajo) → donar con comprobante hasta cubrir → estado `PorComprar` + (si Telegram configurado) mensaje; panel admin transferido→comprada; el insumo aparece en `listar_comprados`; el seguimiento muestra estados + desglose anónimo. **Limpiar toda fila/evidencia/objeto de prueba** (facturas/donaciones/evidencias + objetos de storage con `set session_replication_role = replica`).
- [ ] **Step 4: Commit + push + verificar prod v86** (nudge si Vercel se atasca).
```bash
git add index.html ventana.html sw.js
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (7/8): bump PWA v86 + verificacion integral"
```

---

### Task 8: Guía de Telegram (para activar después) — apagado por defecto

**Files:**
- Create: `docs/guia-telegram-notificaciones.md`

- [ ] **Step 1:** Escribir la guía regla-de-oro (español, un archivo, pasos copy-paste, dónde se ejecuta cada cosa, salida esperada):
  1. Crear el bot con **@BotFather** en Telegram (`/newbot`) → copiar el **token**.
  2. Escribirle algo al bot; obtener tu **chat id** con `https://api.telegram.org/bot<TOKEN>/getUpdates` (campo `chat.id`).
  3. Guardar ambos en `config` (vía `execute_sql`, sin imprimirlos): `update config set valor='<TOKEN>' where clave='telegram_bot_token'; update config set valor='<CHATID>' where clave='telegram_chat_id';`
  4. Verificar: donar hasta cubrir una meta de prueba → debe llegar el mensaje. ⚠️ El token es un secreto: no lo pegues en el repo ni en chats.
- [ ] **Step 2: Commit.**
```bash
git add docs/guia-telegram-notificaciones.md
git -c user.name=Luismadef45 -c user.email=luismadef45@gmail.com commit -q -m "compra verificada (8/8): guia para activar Telegram"
```

---

## Self-Review

- **Cobertura del spec:** prueba del donante → Task 2/5; freno del auto-Comprada + estado nuevo → Task 2; notificación panel → Task 6, Telegram → Task 2/8; transferencia USD→Bs como paso propio → Task 3/6 (`Transferida`); factura de compra → estado Comprada → Task 3/6; visible a transportistas solo tras Comprada → sin cambios (gate existente); desglose anónimo automático → Task 1/4; consolidado público que sube el admin → Task 3/6; anular donación falsa → Task 3/6. ✔ Todo cubierto.
- **Placeholders:** los `case` traen código real; los pasos de frontend describen selectores/acciones concretas (no "manejar errores" genérico). ✔
- **Consistencia de tipos/nombres:** estados `PorComprar`/`Transferida`/`Comprada` y acciones `admin_donaciones_presupuesto`/`admin_donacion_anular`/`admin_presupuesto_transferido`/`admin_presupuesto_comprado` usados idénticos en todas las tareas. ✔

## Riesgos / notas
- Verificar que **no exista un trigger de DB** que ponga `Comprada` al cubrir la meta (hoy el salto vive en `donar_dinero`, no en trigger). Si existiera, ajustarlo en la Task 1.
- El comprobante del donante puede ser PDF: el visor del admin lo abre por URL firmada en pestaña nueva (no se incrusta).
- El consolidado de transferencias lo anonimiza **el admin** antes de subirlo; la UI se lo recuerda. La app no puede garantizar la anonimización de un archivo que sube el humano.

// API de escrituras de donaciones-venezuela. verify_jwt=false: formulario público anónimo;
// protección = rate-limit por cubo + validación estricta por acción + clave admin hasheada en config.
// Fuente de verdad versionada; el deploy vive en Supabase (proyecto zryfwbjvlacorryzdaod, función api).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// Correo normalizado (minúsculas) o '' si no es válido. Se guarda normalizado
// para que la búsqueda por igualdad en acceso_perfil siempre coincida.
function emailNorm(v: unknown): string {
  const x = s(v, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x) ? x : '';
}

function ipDe(req: Request): string {
  return s(req.headers.get('x-forwarded-for')?.split(',')[0] || 'desconocida', 64);
}

function ventanaActual(): string {
  return new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
}

async function rateHit(clave: string, cubo: string, limite: number): Promise<boolean> {
  const { data, error } = await supa.rpc('rate_hit', { p_ip: clave, p_ventana: ventanaActual(), p_cubo: cubo, p_limite: limite });
  if (error) { console.error('rate_hit', error.message); return true; }
  return data as boolean;
}

// Anti-ráfaga: máx N solicitudes por IP en la MISMA ventana de 1 segundo (misma
// tabla/RPC, solo cambia la granularidad de la ventana). Protege el backend de
// datos ante floods; los endpoints de /auth los limita Supabase Auth aparte.
async function rateHitRafaga(clave: string, limite: number): Promise<boolean> {
  const ventanaSeg = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const { data, error } = await supa.rpc('rate_hit', { p_ip: clave, p_ventana: ventanaSeg, p_cubo: 'burst', p_limite: limite });
  if (error) { console.error('rate_hit burst', error.message); return true; }
  return data as boolean;
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparacion en tiempo constante de dos digest hex de igual longitud: no revela
// por timing cuantos caracteres coinciden (evita ataques de temporizacion sobre
// el hash de la clave admin y del PIN del panel).
function hashIguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function tokenAlfa(prefijo: string): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const cuerpo = Array.from(rnd).map((b) => abc[b % abc.length]).join('');
  return `${prefijo}-${cuerpo.slice(0, 4)}-${cuerpo.slice(4, 8)}-${cuerpo.slice(8, 12)}`;
}

function geoValida(p: Record<string, unknown>): { lat: number | null; lng: number | null } {
  const lat = Number(p.lat), lng = Number(p.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -4 && lat <= 13 && lng >= -74 && lng <= -59) {
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

// Distancia entre dos puntos de paso del viaje, en km con 1 decimal.
// ponytail: es línea recta (haversine) entre los puntos de cada tramo, no la ruta
// real de carretera; se eligió así para no rastrear al transportista en continuo
// (batería + permisos). Si algún día hacen falta km de carretera: OSRM público.
function kmEntre(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => x * Math.PI / 180, R = 6371;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// Viaje vigente de una factura = el último intento que aún no llegó al paso 3.
async function viajeVigente(facturaId: number) {
  const { data } = await supa.from('viajes')
    .select('id, email, eta_minutos, paso1_ts, resuelto, paso1_lat, paso1_lng, paso2_lat, paso2_lng, km_tramo1')
    .eq('factura_id', facturaId).is('paso3_ts', null)
    .order('creado_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

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

// Guarda una foto (data URL JPEG/PNG/WebP, máx ~1.8MB decodificada) en el bucket
// PRIVADO registro-transportistas. Solo el service role accede; nada es público.
async function guardarFoto(dataUrl: unknown, carpeta: string, nombre: string,
    bucket = 'registro-transportistas', maxBytes = 1_800_000): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error(`foto de ${nombre} inválida (se espera imagen JPEG/PNG)`);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 1000) throw new Error(`foto de ${nombre} vacía`);
  if (bytes.length > maxBytes) throw new Error(`foto de ${nombre} demasiado grande`);
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const ruta = `${carpeta}/${nombre}.${ext}`;
  const { error } = await supa.storage.from(bucket)
    .upload(ruta, bytes, { contentType: `image/${m[1]}`, upsert: false });
  if (error) throw new Error(`no se pudo guardar la foto de ${nombre}`);
  return ruta;
}

// Guarda un video de denuncia (data URL webm/mp4) en el bucket PRIVADO
// `denuncias`. upsert=true para el guardado progresivo (mismo objeto cada 5 s).
// Tope ~30MB decodificados (90 s a 1.5 Mbps ≈ 17MB; margen para mp4/Safari).
// ponytail: se resube el archivo COMPLETO en cada parcial (O(n²) de banda) porque
// el .txt exige «guardar toda la info posible cada 5 s» y así el objeto servidor
// siempre es reproducible ante un accidente; si el ancho de banda importa, subir
// por rangos/multipart. El cliente ya salta si el envío previo sigue en vuelo.
async function guardarVideo(dataUrl: unknown, carpeta: string, nombre: string, upsert = false): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:video\/(webm|mp4);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('video inválido (se espera webm o mp4)');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 1000) throw new Error('video vacío');
  if (bytes.length > 30_000_000) throw new Error('video demasiado grande');
  const ruta = `${carpeta}/${nombre}.${m[1]}`;
  const { error } = await supa.storage.from('denuncias')
    .upload(ruta, bytes, { contentType: `video/${m[1]}`, upsert });
  if (error) throw new Error('no se pudo guardar el video');
  return ruta;
}

// Adjunto del presupuesto (plan 08 T3.3): CUALQUIER tipo de archivo, ≤5 MB, a
// bucket PÚBLICO 'presupuestos'. Devuelve la URL pública (el donante la abre).
async function guardarAdjunto(dataUrl: unknown, carpeta: string, nombre: string): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('adjunto inválido');
  const mime = m[1];
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 100) throw new Error('adjunto vacío');
  if (bytes.length > 5_000_000) throw new Error('adjunto demasiado grande (máx 5 MB)');
  const extMap: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = extMap[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const ruta = `${carpeta}/${nombre}.${ext}`;
  // SEGURIDAD: bucket PÚBLICO. Solo se sirve inline un allowlist seguro; cualquier
  // otro tipo (html, svg, xml, js…) se guarda como octet-stream → el navegador lo
  // DESCARGA en vez de ejecutarlo (evita XSS/phishing alojado en el dominio de storage).
  const inlineSeguro = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  const contentType = inlineSeguro.has(mime) ? mime : 'application/octet-stream';
  const { error } = await supa.storage.from('presupuestos').upload(ruta, bytes, { contentType, upsert: true });
  if (error) throw new Error('no se pudo guardar el adjunto');
  return supa.storage.from('presupuestos').getPublicUrl(ruta).data.publicUrl;
}

// Comprobante de transferencia del donante: imagen o PDF, ≤5 MB, bucket PRIVADO
// 'comprobantes'. No genera URL pública; devuelve la ruta (el admin la abre firmada).
async function guardarComprobante(dataUrl: unknown, carpeta: string, nombre: string): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('comprobante inválido (se espera imagen JPEG/PNG o PDF)');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 200) throw new Error('comprobante vacío');
  if (bytes.length > 5_000_000) throw new Error('comprobante demasiado grande (máx 5 MB)');
  const ext = m[1] === 'application/pdf' ? 'pdf' : (m[1].split('/')[1] === 'jpeg' ? 'jpg' : m[1].split('/')[1]);
  const ruta = `${carpeta}/${nombre}.${ext}`;
  const { error } = await supa.storage.from('comprobantes').upload(ruta, bytes, { contentType: m[1], upsert: false });
  if (error) throw new Error('no se pudo guardar el comprobante');
  return ruta;
}

// Notificación a Telegram (APAGADA hasta que config tenga token + chat_id). Nunca
// rompe el flujo que la llama; si la API falla, se ignora.
async function notificarTelegram(texto: string): Promise<void> {
  const { data } = await supa.from('config').select('clave, valor')
    .in('clave', ['telegram_bot_token', 'telegram_chat_id']);
  const cfg: Record<string, string> = {};
  for (const r of data || []) cfg[r.clave as string] = String(r.valor || '');
  if (!cfg.telegram_bot_token || !cfg.telegram_chat_id) return; // apagado
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) { /* la notificación no debe tumbar la operación */ }
}

// Identidad del denunciante a partir del JWT de la sesión (mismo patrón que
// acceso_perfil): email + nombre + rol. El donante sin rol vale (rol='donante').
async function identidadSesion(jwt: string): Promise<{ email: string; nombre: string; rol: string }> {
  const { data: udata, error: eU } = await supa.auth.getUser(jwt);
  const email = udata?.user?.email?.toLowerCase() || '';
  if (eU || !email) throw new Error('Sesión inválida o vencida, vuelve a pedir un código');
  const { data: mots } = await supa.from('motorizados').select('nombre').eq('email', email).limit(1);
  if (mots?.[0]) return { email, nombre: String(mots[0].nombre || ''), rol: 'transportista' };
  const { data: vols } = await supa.from('voluntarios').select('nombre, apellido').eq('email', email).limit(1);
  if (vols?.[0]) return { email, nombre: `${vols[0].nombre} ${vols[0].apellido || ''}`.trim(), rol: 'voluntario' };
  const { data: pans } = await supa.from('centros_panel').select('lugares(nombre)').eq('email', email).limit(1);
  if (pans?.[0]) return { email, nombre: (pans[0] as { lugares?: { nombre?: string } }).lugares?.nombre || 'Centro', rol: 'centro' };
  return { email, nombre: email.split('@')[0], rol: 'donante' };
}

// Los movimientos que ve el público NO se guardan como frase en español: se
// guardan como código + datos y el cliente los redacta en el idioma del usuario
// (regla R1.5). Las filas viejas siguen siendo texto plano y se muestran tal cual.
function mov(codigo: string, datos: Record<string, unknown>): string {
  return JSON.stringify({ k: 'mov', c: codigo, ...datos });
}

async function historial(lugar: string, insumo: string, descripcion: string, origen: string, cantidad = 0) {
  await supa.from('historial_movimientos').insert({ lugar, insumo, descripcion, origen, cantidad });
}

// Obtiene el lugar por nombre. Si NO existe, lo crea con los datos aportados.
// Si YA existe, lo devuelve SIN modificar su ficha (tipo/ubicacion/telefono/geo).
// SEGURIDAD: las unicas rutas que llaman aqui — registrar_lugar y panel_crear —
// son PUBLICAS/anonimas. Sobrescribir un centro existente permitiria a cualquiera
// alterar el telefono o la ubicacion de un hospital ya listado (spoofing / IDOR).
// La edicion de un centro existente solo ocurre autenticada: panel_actualizar_lugar
// (token+PIN) o las acciones admin.
async function obtenerOCrearLugar(p: Record<string, unknown>): Promise<{ id: number }> {
  const nombre = s(p.nombre, 120);
  if (!nombre) throw new Error('nombre requerido');
  const { data: existente } = await supa.from('lugares').select('id').eq('nombre', nombre).maybeSingle();
  if (existente) return existente; // no se toca la ficha de un centro ya registrado
  const campos: Record<string, unknown> = {
    tipo: s(p.tipo, 40) || 'Centro', nombre,
    ubicacion: s(p.ubicacion), telefono: s(p.telefono, 40),
    actualizado: new Date().toISOString(),
  };
  const geo = geoValida(p);
  if (geo.lat !== null) { campos.lat = geo.lat; campos.lng = geo.lng; }
  const { data: lugar, error } = await supa.from('lugares').insert(campos).select('id').single();
  if (error) throw error;
  return lugar;
}

async function autenticarPanel(p: Record<string, unknown>) {
  const token = s(p.token, 24).toUpperCase();
  const pin = s(p.pin, 12);
  if (!/^CTR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(token) || pin.length < 4) {
    throw new Error('Token o PIN inválido');
  }
  if (!(await rateHit(token, 'panel', 120))) throw new Error('Demasiadas solicitudes del panel, intenta en una hora');
  const { data: panel } = await supa.from('centros_panel')
    .select('id, lugar_id, pin_hash, pin_salt').eq('token_centro', token).maybeSingle();
  if (!panel) throw new Error('Token o PIN inválido');
  const hash = await sha256Hex(panel.pin_salt + pin);
  if (!hashIguales(hash, panel.pin_hash)) throw new Error('Token o PIN inválido');
  return panel;
}

// ===== Admin: clave hasheada en config (fail-closed) + anti fuerza bruta =====
async function autenticarAdmin(p: Record<string, unknown>, req: Request) {
  const ip = ipDe(req);
  if (!(await rateHit(ip, 'admin', 60))) throw new Error('Demasiadas solicitudes admin, intenta en una hora');
  const { data: fallos } = await supa.from('rate_limit').select('contador')
    .eq('ip', ip).eq('cubo', 'admin_fallos').eq('ventana', ventanaActual()).maybeSingle();
  if ((fallos?.contador || 0) >= 10) throw new Error('Demasiadas claves incorrectas, espera una hora');
  const { data: cfg } = await supa.from('config').select('valor').eq('clave', 'admin_key_hash').maybeSingle();
  if (!cfg?.valor) throw new Error('Módulo admin no configurado'); // fail-closed
  const hash = await sha256Hex(s(p.adminKey, 64));
  if (!hashIguales(hash, cfg.valor)) {
    await rateHit(ip, 'admin_fallos', 999999);
    throw new Error('Clave admin incorrecta');
  }
}

async function facturaPor(p: Record<string, unknown>) {
  const token = s(p.token, 24).toUpperCase();
  const numero = s(p.numeroFactura, 24).toUpperCase();
  let q = supa.from('facturas').select('id, numero_factura, token_publico, estado');
  if (token) q = q.eq('token_publico', token);
  else if (numero) q = q.eq('numero_factura', numero);
  else throw new Error('token o numeroFactura requerido');
  const { data: f } = await q.maybeSingle();
  if (!f) throw new Error('Factura no encontrada');
  return f;
}

// ===== Donación pública a UNA necesidad concreta =====
// La necesidad se identifica por su objetivo textual «insumo → centro»: ese es
// el hilo público de trazabilidad que comparten todos los donantes del mismo
// insumo en el mismo centro. No se guarda ningún dato del donante en la factura
// ni en sus movimientos (seguimiento_factura es público).
function objetivoNecesidad(insumo: string, centro: string): string {
  return `${insumo} → ${centro}`;
}

async function facturaAbiertaDe(objetivo: string) {
  const { data } = await supa.from('facturas')
    .select('id, numero_factura, token_publico')
    .eq('objetivo', objetivo).eq('estado', 'Abierta')
    .order('fecha_creacion').limit(1);
  return data?.[0] ?? null;
}

// Reusa la factura viva de la necesidad; si no hay, abre una con token nuevo.
async function facturaDeNecesidad(objetivo: string, descripcion: string, montoRequerido: number) {
  const abierta = await facturaAbiertaDe(objetivo);
  if (abierta) return abierta;
  const { data: seq, error: eSeq } = await supa.rpc('factura_numero_siguiente');
  if (eSeq) throw eSeq;
  const numero = `FAC-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
  const { data, error } = await supa.from('facturas').insert({
    numero_factura: numero, token_publico: tokenAlfa('DV'), objetivo,
    descripcion, monto_requerido: montoRequerido,
  }).select('id, numero_factura, token_publico').single();
  if (error) throw error;
  return data;
}

// El centro confirma recepción desde su panel → el donante lo ve en su token.
async function registrarEntrega(centro: string, insumo: string, unidad: string,
                                delta: number, recibida: number, necesaria: number) {
  const f = await facturaAbiertaDe(objetivoNecesidad(insumo, centro));
  if (!f) return;
  if (delta > 0) {
    await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Entrega',
      descripcion: mov('recepcionConfirmada', { delta, unidad }), monto: delta });
  }
  if (necesaria > 0 && recibida >= necesaria) {
    await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Entrega',
      descripcion: mov('necesidadCubierta', {}), monto: 0 });
    await supa.from('facturas').update({ estado: 'Cerrada', fecha_cierre: new Date().toISOString() }).eq('id', f.id);
  }
}

// ===== Presupuestos + ciclo logístico (reusan facturas/donaciones/movimientos/evidencias) =====
// Un PRESUPUESTO es una factura cuya `descripcion` lleva metadatos JSON de la
// cotización (tienda, dirección, cantidad, presentación) y su precio en
// `monto_requerido`. Los donantes aportan DINERO; al cubrir el precio pasa a
// 'Comprada' y entra al ciclo del transportista: 'EnTransito' → 'Entregada'.
function metaPresupuesto(descripcion: string): Record<string, unknown> | null {
  try { const o = JSON.parse(descripcion); return o && o.k === 'pres' ? o : null; } catch { return null; }
}

// Una OFERTA es una factura cuya descripcion lleva el JSON de un insumo que un
// donante YA TIENE (cantidad, ubicación y teléfono para coordinar): el
// transportista la ve localizada y la recoge para llevarla a un centro.
function metaOferta(descripcion: string): Record<string, unknown> | null {
  try { const o = JSON.parse(descripcion); return o && o.k === 'oferta' ? o : null; } catch { return null; }
}

// Vista PRIVADA de una oferta: contacto completo. Solo para quien tiene su reserva.
function ofertaUI(f: Record<string, unknown>) {
  const m = metaOferta(String(f.descripcion ?? ''));
  if (!m) return null;
  return {
    token: f.token_publico, estado: f.estado,
    insumo: m.insumo, cantidad: m.cantidad, unidad: m.unidad,
    ubicacion: m.ubicacion, telefono: m.telefono, nombreDonante: m.nombreDonante, centro: m.centro,
    zona: m.zona || '', coords: m.coords ?? null,
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

function presupuestoUI(f: Record<string, unknown>) {
  const m = metaPresupuesto(String(f.descripcion ?? ''));
  if (!m) return null;
  return {
    token: f.token_publico, objetivo: f.objetivo, estado: f.estado,
    centro: m.centro, insumo: m.insumo, tienda: m.tienda, direccion: m.direccion,
    cantidad: m.cantidad, presentacion: m.presentacion, moneda: m.moneda || 'VES',
    precio: Number(f.monto_requerido) || 0, recaudado: Number(f.monto_recaudado) || 0,
  };
}

// ===== Tasa de cambio USD→Bs (bot nocturno) =====
// El donante está en EE.UU. (USD) pero la compra en la farmacia es en bolívares.
// El bot guarda cada noche la tasa EFECTIVA de Remitly (lo que realmente recibe
// quien envía); si Remitly falla, cae a la tasa OFICIAL del BCV. El navegador
// nunca llama afuera: lee la tasa que ya dejó el backend.
async function tasaActual(): Promise<{ efectiva: number; diaria: number; fuente: string; fecha: string } | null> {
  const { data } = await supa.from('tasas')
    .select('efectiva, diaria, fuente, capturado_en')
    .order('capturado_en', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    efectiva: Number(data.efectiva), diaria: Number(data.diaria) || Number(data.efectiva),
    fuente: String(data.fuente), fecha: String(data.capturado_en),
  };
}

const UA_TASA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };
function numDe(html: string, re: RegExp): number | null { const m = html.match(re); return m ? Number(m[1]) : null; }
const tasaPlausible = (x: number | null): x is number => x !== null && x > 200 && x < 5000;

// Lo corre el cron nocturno: lee Remitly del HTML crudo (efectiva/everyday) y,
// si falla o da algo raro, la tasa oficial del BCV. Inserta una fila en `tasas`.
async function actualizarTasa() {
  let efectiva: number | null = null, diaria: number | null = null, fuente = 'remitly';
  try {
    const r = await fetch('https://www.remitly.com/us/en/currency-converter/usd-to-ves-rate', { headers: UA_TASA });
    const html = await r.text();
    efectiva = numDe(html, /"effectiveRateAsLowAs"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
    diaria = numDe(html, /"everydayRateAsLowAs"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
  } catch { /* cae al fallback del BCV */ }
  if (!tasaPlausible(efectiva)) {
    const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { headers: UA_TASA });
    const j = await r.json();
    efectiva = Number(j.promedio) || null;
    diaria = efectiva;
    fuente = 'bcv';
    if (!tasaPlausible(efectiva)) throw new Error('no se pudo obtener la tasa');
  }
  if (!tasaPlausible(diaria)) diaria = efectiva;
  const { error } = await supa.from('tasas').insert({ fuente, efectiva, diaria });
  if (error) throw error;
  return { fuente, efectiva, diaria };
}

async function verPanel(lugarId: number) {
  const { data: lugar, error } = await supa.from('lugares')
    .select('id, tipo, nombre, ubicacion, telefono, lat, lng, actualizado').eq('id', lugarId).single();
  if (error) throw error;
  const { data: insumos } = await supa.from('insumos')
    .select('id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad')
    .eq('lugar_id', lugarId).order('nombre');
  return { lugar, insumos: insumos || [] };
}

async function nombreDeLugar(lugarId: number): Promise<string> {
  const { data } = await supa.from('lugares').select('nombre').eq('id', lugarId).single();
  return data?.nombre || '';
}

async function handle(accion: string, p: Record<string, unknown>, req: Request) {
  // Bot nocturno de la tasa: lo dispara pg_cron con un secreto compartido
  // (config.cron_secret). No es admin ni gasta cupo público.
  if (accion === 'cron_tasa') {
    const secret = s(req.headers.get('x-cron-secret') || '', 128);
    const { data: cfg } = await supa.from('config').select('valor').eq('clave', 'cron_secret').maybeSingle();
    if (!cfg || !cfg.valor || secret !== String(cfg.valor)) throw new Error('no autorizado');
    return await actualizarTasa();
  }
  // Anti-ráfaga por IP: máx 12 solicitudes/segundo (cron_tasa queda exento arriba).
  if (!(await rateHitRafaga(ipDe(req), 12))) throw new Error('Demasiadas solicitudes, baja el ritmo');
  const esPanel = accion.startsWith('panel_') && accion !== 'panel_crear';
  const esAdmin = accion.startsWith('admin_');
  // Las lecturas públicas no gastan el cupo de escrituras (30/h): navegar los
  // presupuestos o la lista de recogidas no debe bloquear el poder donar.
  const esLectura = ['listar_presupuestos', 'listar_comprados', 'listar_ofertas', 'acceso_perfil', 'denuncias_listar', 'reserva_detalle'].includes(accion);
  // Una denuncia manda ~18 parciales (cada 5 s durante 90 s) + el cierre: cubo
  // propio y generoso para no chocar con el límite público de 30/h.
  const esDenuncia = accion === 'denuncia_crear' || accion === 'denuncia_parcial';
  if (esAdmin) await autenticarAdmin(p, req);
  else if (esLectura) {
    if (!(await rateHit(ipDe(req), 'lectura', 240))) throw new Error('Demasiadas solicitudes, intenta en una hora');
  } else if (esDenuncia) {
    if (!(await rateHit(ipDe(req), 'denuncia', 400))) throw new Error('Demasiadas solicitudes, intenta en una hora');
  } else if (!esPanel && !(await rateHit(ipDe(req), 'publico', 30))) {
    throw new Error('Demasiadas solicitudes, intenta en una hora');
  }

  switch (accion) {
    case 'registrar_lugar': {
      const lugar = await obtenerOCrearLugar(p);
      const insumo = s(p.insumo, 120);
      if (insumo) {
        const estado = ['Necesita', 'Disponible', 'Cubierto'].includes(s(p.estado, 20)) ? s(p.estado, 20) : 'Necesita';
        const { error: e2 } = await supa.from('insumos')
          .upsert({ lugar_id: lugar.id, nombre: insumo, categoria: s(p.categoria, 60) || 'General',
                    estado, actualizado: new Date().toISOString() }, { onConflict: 'lugar_id,nombre' });
        if (e2) throw e2;
        await historial(s(p.nombre, 120), insumo, `Reporte: ${insumo} (${estado})`, 'publico');
      }
      return {};
    }
    case 'registrar_voluntario': {
      if (!s(p.nombre)) throw new Error('nombre requerido');
      const email = emailNorm(p.email);
      if (!email) throw new Error('correo electrónico válido requerido');
      if (s(p.telefono, 40).replace(/[^0-9]/g, '').length < 7) throw new Error('teléfono requerido');
      if (!p.fotoCedula) throw new Error('Falta la foto de la cédula');
      const id = s(p.id, 40) || 'VOL' + crypto.randomUUID().slice(0, 8);
      const foto_cedula = await guardarFoto(p.fotoCedula, `voluntarios/${id}`, 'cedula');
      const { error } = await supa.from('voluntarios').insert({
        id, email, foto_cedula,
        nombre: s(p.nombre, 120), apellido: s(p.apellido, 120), telefono: s(p.telefono, 40),
        estado: s(p.estado, 60), ciudad: s(p.ciudad, 80), profesion: s(p.profesion, 80),
        disponibilidad: s(p.disponibilidad, 120),
        medio_transporte: s(p.medioTransporte ?? p.medio_transporte, 60),
        observaciones: s(p.observaciones, 500) });
      if (error) throw error;
      return {};
    }
    case 'registrar_rescatista': {
      if (!s(p.nombre)) throw new Error('nombre requerido');
      const { error } = await supa.from('rescatistas').insert({
        id: s(p.id, 40) || 'RES' + crypto.randomUUID().slice(0, 8),
        nombre: s(p.nombre, 120), organizacion: s(p.organizacion, 120), telefono: s(p.telefono, 40),
        especialidad: s(p.especialidad, 80), estado: s(p.estado, 60), ciudad: s(p.ciudad, 80),
        disponibilidad: s(p.disponibilidad, 120),
        equipo_disponible: s(p.equipoDisponible ?? p.equipo_disponible, 300),
        capacidad_operativa: s(p.capacidadOperativa ?? p.capacidad_operativa, 120),
        observaciones: s(p.observaciones, 500) });
      if (error) throw error;
      return {};
    }
    case 'registrar_motorizado': {
      if (!s(p.nombre)) throw new Error('nombre requerido');
      const email = emailNorm(p.email);
      if (!email) throw new Error('correo electrónico válido requerido');
      if (s(p.telefono, 40).replace(/[^0-9]/g, '').length < 7) throw new Error('teléfono requerido');
      if (!p.fotoPlaca || !p.fotoVehiculo || !p.fotoCedula) {
        throw new Error('Faltan fotos: placa, vehículo y cédula son obligatorias');
      }
      const id = s(p.id, 40) || 'MOT' + crypto.randomUUID().slice(0, 8);
      const foto_placa = await guardarFoto(p.fotoPlaca, id, 'placa');
      const foto_vehiculo = await guardarFoto(p.fotoVehiculo, id, 'vehiculo');
      const foto_cedula = await guardarFoto(p.fotoCedula, id, 'cedula');
      const { error } = await supa.from('motorizados').insert({
        id, email, nombre: s(p.nombre, 120), tipo_vehiculo: s(p.tipoVehiculo ?? p.tipo_vehiculo, 40) || 'Moto',
        telefono: s(p.telefono, 40), zona_operacion: s(p.zonaOperacion ?? p.operaEn, 120),
        placa: s(p.placa, 20), foto_placa, foto_vehiculo, foto_cedula });
      if (error) throw error;
      return {};
    }
    // ===== Auto-registro de damnificados (público → PRIVADO solo-admin) =====
    // Una familia se registra a sí misma. PII sensible: va a familias_damnificadas
    // (RLS, revoke anon) y las fotos al bucket privado 'damnificados'. Nada público.
    case 'damnificado_registrar': {
      // Honeypot: un bot rellena el campo oculto → fingimos éxito sin escribir.
      if (s(p.web, 100)) return { codigo: 'FAM-000000', ok: true };
      const nombre = s(p.responsableNombre, 120);
      if (!nombre) throw new Error('Falta el nombre de quien registra a la familia');
      const codigo = 'FAM-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      // Integrantes (máx 20): se limpia cada campo; «menor» derivado de la edad.
      const crudos = Array.isArray(p.integrantes) ? (p.integrantes as unknown[]).slice(0, 20) : [];
      const integrantes = crudos.map((x) => {
        const it = (x || {}) as Record<string, unknown>;
        const edad = Math.max(0, Math.min(120, Math.round(n(it.edad))));
        const menor = it.menor === true || (edad > 0 && edad < 18);
        return {
          nombre: s(it.nombre, 120), parentesco: s(it.parentesco, 60), edad,
          menor, ocupacion: s(it.ocupacion, 160),
          condicion_medica: s(it.condicionMedica ?? it.condicion_medica, 400), notas: s(it.notas, 400)
        };
      }).filter((it) => it.nombre || it.parentesco || it.edad);
      const numMenores = integrantes.filter((it) => it.menor).length;
      // Fotos antiguas de lo perdido (máx 12) al bucket PRIVADO. Una foto inválida
      // se omite en vez de tumbar el registro (no perder los datos ya escritos).
      const fotosIn = Array.isArray(p.fotos) ? (p.fotos as unknown[]).slice(0, 12) : [];
      const fotos: string[] = [];
      for (let i = 0; i < fotosIn.length; i++) {
        try { fotos.push(await guardarFoto(fotosIn[i], codigo, 'p' + i, 'damnificados', 2_500_000)); }
        catch (_) { /* foto inválida/grande: se omite */ }
      }
      const gps = (p.gps || {}) as Record<string, unknown>;
      const { error } = await supa.from('familias_damnificadas').insert({
        codigo,
        responsable_nombre: nombre,
        responsable_telefono: s(p.responsableTelefono, 40),
        responsable_email: s(p.responsableEmail, 120),
        alojamiento: s(p.alojamiento, 500),
        municipio: s(p.municipio, 120),
        estado_geo: s(p.estadoGeo, 120),
        gps_lat: gps.lat != null ? n(gps.lat) : null,
        gps_lng: gps.lng != null ? n(gps.lng) : null,
        num_personas: integrantes.length,
        num_menores: numMenores,
        integrantes,
        fallecidos: Math.max(0, Math.min(99, Math.round(n(p.fallecidos)))),
        fallecidos_detalle: s(p.fallecidosDetalle, 500),
        perdio_casa: p.perdioCasa !== false,
        perdio_vehiculo: p.perdioVehiculo === true,
        vehiculos_detalle: s(p.vehiculosDetalle, 400),
        sustento_principal: s(p.sustentoPrincipal, 400),
        bienes_perdidos: s(p.bienesPerdidos, 2000),
        notas: s(p.notas, 1000),
        fotos
      });
      if (error) throw error;
      return { codigo, numPersonas: integrantes.length, numMenores };
    }
    case 'registrar_trayecto': {
      if (!s(p.origen) || !s(p.destino)) throw new Error('origen y destino requeridos');
      const { error } = await supa.from('trayectos').insert({
        motorizado_id: s(p.idMotorizado, 40) || null, nombre_motorizado: s(p.nombreMotorizado, 120),
        origen: s(p.origen, 160), destino: s(p.destino, 160), km: n(p.km),
        insumo: s(p.insumo, 120) || 'Varios' });
      if (error) throw error;
      return {};
    }
    case 'donar_motorizado': {
      const { error } = await supa.from('donaciones_motorizados').insert({
        motorizado_id: s(p.idMotorizado, 40) || null, nombre_motorizado: s(p.nombreMotorizado, 120),
        monto: n(p.monto), tipo: s(p.tipo, 60), donante: s(p.donanteName ?? p.donante, 120) || 'Anónimo',
        ciudad: s(p.ciudad, 80) });
      if (error) throw error;
      return {};
    }
    case 'donar_necesidad': {
      const centro = s(p.centro, 120);
      const insumo = s(p.insumo, 120);
      const cantidad = n(p.cantidad);
      if (!centro || !insumo) throw new Error('centro e insumo requeridos');
      if (cantidad <= 0 || cantidad > 1_000_000) throw new Error('cantidad inválida');
      const { data: lugar } = await supa.from('lugares').select('id, nombre').eq('nombre', centro).maybeSingle();
      if (!lugar) throw new Error('Centro no encontrado');
      const { data: item } = await supa.from('insumos')
        .select('nombre, unidad, cantidad_necesaria')
        .eq('lugar_id', lugar.id).eq('nombre', insumo).maybeSingle();
      if (!item) throw new Error('Necesidad no encontrada');
      const unidad = item.unidad || 'unidades';
      const objetivo = objetivoNecesidad(item.nombre, lugar.nombre);
      const f = await facturaDeNecesidad(objetivo,
        `Necesidad publicada por ${lugar.nombre}`,
        Math.max(Number(item.cantidad_necesaria) || 0, cantidad));
      const { error } = await supa.from('donaciones').insert({
        factura_id: f.id, nombre_donante: s(p.nombreDonante, 120) || 'Anónimo',
        monto: cantidad, referencia_pago: s(p.referencia, 80), estado: 'Registrada' });
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Ingreso',
        descripcion: mov('donacionRegistrada', { cantidad, unidad, insumo: item.nombre }), monto: cantidad });
      await historial(lugar.nombre, item.nombre, `Donación registrada: ${cantidad} ${unidad}`, 'publico', cantidad);
      return { token: f.token_publico, numeroFactura: f.numero_factura, objetivo };
    }

    // ===== Presupuestos: donación en DINERO + ciclo logístico =====
    case 'listar_presupuestos': {
      const { data } = await supa.from('facturas')
        .select('token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .like('descripcion', '{"k":"pres"%')
        .order('fecha_creacion', { ascending: false }).limit(200);
      return { presupuestos: (data || []).map(presupuestoUI).filter(Boolean), tasa: await tasaActual() };
    }
    case 'listar_comprados': {
      const { data } = await supa.from('facturas')
        .select('numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .like('descripcion', '{"k":"pres"%')
        .in('estado', ['Comprada', 'EnTransito'])
        .order('fecha_creacion').limit(100);
      return { comprados: (data || []).map(presupuestoUI).filter(Boolean) };
    }
    case 'donar_dinero': {
      // El donante aporta en USD (está en EE.UU.); la compra en la farmacia es
      // en Bs. Convertimos USD→Bs a la tasa vigente y CONGELAMOS esos bolívares
      // en la donación, para que la meta (en Bs) no se mueva si la tasa cambia
      // mañana. La referencia la genera el sistema (simulación); cuando exista la
      // cuenta real, vendrá del pago y entrará por este mismo camino.
      const montoUsd = n(p.montoUsd ?? p.monto);
      if (montoUsd <= 0 || montoUsd > 100_000) throw new Error('monto inválido');
      const tasa = await tasaActual();
      if (!tasa || !(tasa.efectiva > 0)) throw new Error('tasa de cambio no disponible, intenta más tarde');
      const montoBs = Math.round(montoUsd * tasa.efectiva);
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, token_publico, descripcion, monto_requerido, monto_recaudado, estado')
        .eq('token_publico', token).maybeSingle();
      const m = f && metaPresupuesto(String(f.descripcion));
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (f.estado !== 'Abierta') throw new Error('Este presupuesto ya está financiado');
      // Prueba obligatoria: el donante adjunta su comprobante (imagen/PDF) → bucket
      // PRIVADO. El admin lo revisa antes de comprar; el donante nunca lo expone.
      if (!p.comprobante) throw new Error('Adjunta el comprobante de tu transferencia');
      const comprobante = await guardarComprobante(p.comprobante, `don/${f.id}`, tokenAlfa('C'));
      const referencia = tokenAlfa('REF');
      const { error } = await supa.from('donaciones').insert({
        factura_id: f.id, nombre_donante: s(p.nombreDonante, 120) || 'Anónimo',
        monto: montoBs, monto_usd: montoUsd, tasa: tasa.efectiva, comprobante,
        referencia_pago: referencia, estado: 'Confirmada' }); // Confirmada: el trigger suma al recaudado en vivo (en Bs)
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Ingreso',
        descripcion: mov('dineroRecibido', { referencia }), monto: montoBs });
      // ¿Se completó la meta (en Bs)? → el insumo queda Comprado y entra al ciclo logístico.
      const { data: tras } = await supa.from('facturas')
        .select('monto_recaudado, monto_requerido, estado').eq('id', f.id).single();
      let estadoFinal = tras?.estado || 'Abierta';
      // Al cubrir la meta NO se compra solo: pasa a 'PorComprar' (en espera de que el
      // admin transfiera USD→Bs y compre). El insumo NO entra aún al ciclo del
      // transportista (eso ocurre solo al llegar a 'Comprada' con la factura).
      if (tras && Number(tras.monto_recaudado) >= Number(tras.monto_requerido) && tras.estado === 'Abierta') {
        estadoFinal = 'PorComprar';
        await supa.from('facturas').update({ estado: 'PorComprar' }).eq('id', f.id);
        await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recaudado',
          descripcion: mov('metaCubierta', { insumo: m.insumo, tienda: m.tienda }), monto: 0 });
        await notificarTelegram(`✅ Se recaudó todo para <b>${m.insumo}</b> (${m.centro}). Toca transferir y comprar. Token: ${f.token_publico}`);
      }
      await historial(String(m.centro), String(m.insumo), `Donación de ${montoUsd} USD (${montoBs} Bs, ref ${referencia})`, 'publico', montoBs);
      return { referencia, token: f.token_publico, numeroFactura: f.numero_factura,
               recaudado: Number(tras?.monto_recaudado) || 0, precio: Number(f.monto_requerido) || 0,
               montoUsd, montoBs, tasa: tasa.efectiva, estado: estadoFinal };
    }
    case 'viaje_iniciar': {
      // Paso 1 del ciclo: el transportista declara que va en camino. Se guardan
      // GPS y hora de salida + el tiempo estimado de llegada. Sin GPS válido no
      // se inicia: ese punto es el origen de los km y de la vigilancia (plan 07).
      // V01: reservar exige sesión. El nombre sale de la identidad, no del cliente.
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
      const eta = Math.round(n(p.etaMinutos));
      if (eta < 5 || eta > 480) throw new Error('Tiempo estimado inválido (5 a 480 minutos)');
      const gps = geoValida((p.gps ?? {}) as Record<string, unknown>);
      if (gps.lat === null || gps.lng === null) throw new Error('Se necesita tu ubicación GPS para iniciar el viaje');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, token_publico, objetivo, descripcion, estado, monto_requerido, monto_recaudado')
        .eq('token_publico', token).maybeSingle();
      // Polimórfico: una compra (metaPresupuesto, estado Comprada) o una OFERTA
      // (metaOferta, estado Ofrecida). El «voy a recogerla» del plan 07 arranca el
      // mismo viaje para ambas; solo la oferta cambia de estado (Ofrecida->EnCamino).
      const mp = f && metaPresupuesto(String(f.descripcion));
      const mo = f && metaOferta(String(f.descripcion));
      const m = mp || mo;
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (mp) {
        if (f.estado !== 'Comprada') throw new Error('Este insumo no está listo para recoger');
      } else if (f.estado !== 'Ofrecida') {
        throw new Error('Esta donación ya está en camino o fue recogida');
      }
      // Si ya hay una reserva viva de OTRA persona, este trabajo no está libre.
      // Si es tuya, no se duplica la fila: sigues con la que ya tenías.
      const reservaPrevia = await reservaViva(f.id);
      if (reservaPrevia) {
        if (String(reservaPrevia.email || '').toLowerCase() !== ident.email.toLowerCase()) {
          throw new Error('Este trabajo ya lo reservó otra persona');
        }
        return { ok: true, yaReservado: true, viajeId: reservaPrevia.id, detalle: ofertaUI(f) || presupuestoUI(f) };
      }
      const { error } = await supa.from('viajes').insert({
        factura_id: f.id, transportista: nombre, email: ident.email,
        eta_minutos: eta, paso1_ts: new Date().toISOString(), paso1_lat: gps.lat, paso1_lng: gps.lng });
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Viaje',
        descripcion: mov('viajeIniciado', { nombre, eta }), monto: 0 });
      if (mo) await supa.from('facturas').update({ estado: 'EnCamino' }).eq('id', f.id);
      await historial(String(m.centro), String(m.insumo), `Transportista ${nombre} va en camino a recoger el insumo (llega en ~${eta} min)`, 'publico');
      // El que acaba de reservar ya puede ver el contacto (V03).
      return { ok: true, etaMinutos: eta, detalle: ofertaUI(f) || presupuestoUI(f) };
    }
    case 'registrar_recogida': {
      // El transportista retira el insumo comprado en la tienda: fotos del
      // sitio y del insumo (bucket privado) + movimiento público con el relato.
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
      if (!p.fotoSitio || !p.fotoInsumo) throw new Error('Faltan fotos: sitio de recogida e insumo son obligatorias');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, descripcion, estado').eq('token_publico', token).maybeSingle();
      const m = f && metaPresupuesto(String(f.descripcion));
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (f.estado !== 'Comprada') throw new Error('Este insumo no está listo para recoger');
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
      const carpeta = `ciclo/${f.numero_factura}`;
      const marca = crypto.randomUUID().slice(0, 8);
      const fotoSitio = await guardarFoto(p.fotoSitio, carpeta, `recogida-sitio-${marca}`);
      const fotoInsumo = await guardarFoto(p.fotoInsumo, carpeta, `recogida-insumo-${marca}`);
      const evidencias = [
        { factura_id: f.id, archivo: fotoSitio, descripcion: `Foto del sitio de recogida (${m.tienda})`, publica: false },
        { factura_id: f.id, archivo: fotoInsumo, descripcion: 'Foto del insumo comprado', publica: false }];
      // Foto de QUIEN ENTREGA el insumo. Opcional en el backend para no romper a
      // un cliente viejo cacheado; el cliente actual la exige (lo pide el .txt).
      if (p.fotoPersona) {
        const fotoPersona = await guardarFoto(p.fotoPersona, carpeta, `recogida-persona-${marca}`);
        evidencias.push({ factura_id: f.id, archivo: fotoPersona, descripcion: 'Foto de quien entrega el insumo', publica: false });
      }
      await supa.from('evidencias').insert(evidencias);
      // GPS + hora de la recogida: cierran el primer tramo del viaje y sus km.
      // Si no hay viaje vigente (factura anterior al paso 1) se omite sin fallar.
      let km: number | null = null;
      const gps = geoValida((p.gps ?? {}) as Record<string, unknown>);
      if (gps.lat !== null && gps.lng !== null) {
        const viaje = await viajeVigente(f.id);
        if (viaje) {
          const tramo1 = (viaje.paso1_lat !== null && viaje.paso1_lng !== null)
            ? kmEntre(Number(viaje.paso1_lat), Number(viaje.paso1_lng), gps.lat, gps.lng)
            : null;
          await supa.from('viajes').update({
            paso2_ts: new Date().toISOString(), paso2_lat: gps.lat, paso2_lng: gps.lng,
            km_tramo1: tramo1 }).eq('id', viaje.id);
          km = tramo1;
        }
      }
      const notas = s(p.notas, 300);
      const datosMov: Record<string, unknown> = { nombre, tienda: m.tienda, direccion: m.direccion, notas };
      if (km !== null) datosMov.km = km;
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recogida',
        descripcion: mov(notas ? 'insumoRecogidoConNota' : 'insumoRecogido', datosMov), monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'EnTransito' }).eq('id', f.id);
      await historial(String(m.centro), String(m.insumo), `Transportista ${nombre} recogió el insumo comprado en ${m.tienda}`, 'publico');
      return { estado: 'EnTransito', km };
    }
    case 'registrar_entrega_final': {
      // Cierre del ciclo: el transportista entrega en el centro. Registra a la
      // persona que recibe + foto de la entrega en el centro + foto de quien
      // recibe (todas por camara). GPS+hora cierran el paso 3 y el km_tramo2.
      const receptor = s(p.nombreReceptor, 120);
      if (!receptor) throw new Error('nombre de quien recibe requerido');
      const ident = await exigirSesion(p); // V01: entregar exige sesión
      // fotoCentro es la nueva foto principal; fotoEntrega es el alias viejo (un
      // cliente cacheado sigue funcionando). fotoEncargado (quien recibe) es la
      // segunda foto que exige el .txt del ciclo.
      const fotoCentro = p.fotoCentro ?? p.fotoEntrega;
      if (!fotoCentro) throw new Error('Falta la foto de la entrega en el centro');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, descripcion, estado').eq('token_publico', token).maybeSingle();
      // Polimórfico: entrega de una compra (EnTransito) o de una OFERTA (Recogida).
      const mp = f && metaPresupuesto(String(f.descripcion));
      const mo = f && metaOferta(String(f.descripcion));
      const m = mp || mo;
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (mp) {
        if (f.estado !== 'EnTransito') throw new Error('Este insumo no está en tránsito');
      } else if (f.estado !== 'Recogida') {
        throw new Error('Esta donación no está lista para entregar');
      }
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
      const carpeta = `ciclo/${f.numero_factura}`;
      const marca = crypto.randomUUID().slice(0, 8);
      const foto = await guardarFoto(fotoCentro, carpeta, `entrega-centro-${marca}`);
      const evidencias = [
        { factura_id: f.id, archivo: foto, descripcion: `Foto de la entrega en ${m.centro}`, publica: false }];
      if (p.fotoEncargado) {
        const fotoEnc = await guardarFoto(p.fotoEncargado, carpeta, `entrega-encargado-${marca}`);
        evidencias.push({ factura_id: f.id, archivo: fotoEnc, descripcion: `Foto de quien recibe en ${m.centro}`, publica: false });
      }
      await supa.from('evidencias').insert(evidencias);
      // GPS + hora del paso 3: cierran el segundo tramo del viaje. El km total es
      // km_tramo1 (recogida) + km_tramo2 (entrega). Si no hay viaje vigente se
      // omite sin fallar (factura anterior al paso 1).
      let kmTramo2: number | null = null, kmTotal: number | null = null;
      const gps = geoValida((p.gps ?? {}) as Record<string, unknown>);
      if (gps.lat !== null && gps.lng !== null) {
        const viaje = await viajeVigente(f.id);
        if (viaje) {
          kmTramo2 = (viaje.paso2_lat !== null && viaje.paso2_lng !== null)
            ? kmEntre(Number(viaje.paso2_lat), Number(viaje.paso2_lng), gps.lat, gps.lng)
            : null;
          await supa.from('viajes').update({
            paso3_ts: new Date().toISOString(), paso3_lat: gps.lat, paso3_lng: gps.lng,
            km_tramo2: kmTramo2 }).eq('id', viaje.id);
          const t1 = viaje.km_tramo1 !== null ? Number(viaje.km_tramo1) : 0;
          kmTotal = Math.round((t1 + (kmTramo2 ?? 0)) * 10) / 10;
        }
      }
      const cargo = s(p.cargoReceptor, 80);
      const datosMov: Record<string, unknown> = { centro: m.centro, receptor, cargo };
      if (kmTotal !== null) datosMov.km = kmTotal;
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Entrega',
        descripcion: mov(cargo ? 'entregadoConCargo' : 'entregado', datosMov), monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'Entregada', fecha_cierre: new Date().toISOString() }).eq('id', f.id);
      await historial(String(m.centro), String(m.insumo), `Insumo comprado entregado en el centro. Recibió ${receptor}`, 'publico');
      return { estado: 'Entregada', km: kmTotal };
    }
    // ===== Ofertas: un donante YA TIENE el insumo; el transportista lo recoge =====
    case 'ofrecer_insumo': {
      const insumo = s(p.insumo, 120);
      const cantidad = n(p.cantidad);
      const unidad = s(p.unidad, 30) || 'unidades';
      // `ubicacion` es el NOMBRE DE REFERENCIA del sitio (portón azul, casa 12):
      // la dirección exacta la dan las coordenadas del mapa, no texto libre.
      const ubicacion = s(p.ubicacion, 160);
      const telefono = s(p.telefono, 40);
      const nombreDonante = s(p.nombreDonante, 120);
      const fotoInsumo = s(p.fotoInsumo, 2_500_000);
      // Hasta 20 fotos del insumo (array); fotoInsumo suelto queda por compatibilidad
      const fotosCrudas = Array.isArray(p.fotosInsumo) ? p.fotosInsumo.slice(0, 20) : [];
      const fotoCedula = s(p.fotoCedula, 2_500_000);
      const fotoLugar = s(p.fotoLugar, 2_500_000); // foto del sitio exacto de recogida
      const lat = Number(p.lat), lng = Number(p.lng);
      const coordsOk = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      const centro = s(p.centro, 120); // destino sugerido (opcional)
      const zona = s(p.zona, 80); // municipio o sector: contexto público sin señalar la casa
      if (!insumo) throw new Error('insumo requerido');
      if (cantidad <= 0 || cantidad > 1_000_000) throw new Error('cantidad inválida');
      if (!ubicacion) throw new Error('nombre de referencia del sitio requerido');
      if (telefono.replace(/[^0-9]/g, '').length < 7) throw new Error('teléfono requerido para coordinar la recogida');
      if (!nombreDonante) throw new Error('nombre de contacto requerido');
      if (!fotoInsumo && !fotosCrudas.length) throw new Error('foto del insumo requerida');
      const { data: seq3, error: eSeq3 } = await supa.rpc('factura_numero_siguiente');
      if (eSeq3) throw eSeq3;
      const numero = `FAC-${new Date().getFullYear()}-${String(seq3).padStart(6, '0')}`;
      const token = tokenAlfa('DV');
      const rutas: string[] = [];
      if (fotosCrudas.length) {
        for (let i = 0; i < fotosCrudas.length; i++) {
          rutas.push(await guardarFoto(fotosCrudas[i], `ofertas/${token}`, `insumo-${i + 1}`));
        }
      } else {
        rutas.push(await guardarFoto(fotoInsumo, `ofertas/${token}`, 'insumo'));
      }
      const rutaCedula = fotoCedula ? await guardarFoto(fotoCedula, `ofertas/${token}`, 'cedula') : '';
      const rutaLugar = fotoLugar ? await guardarFoto(fotoLugar, `ofertas/${token}`, 'lugar') : '';
      const { data: fila, error } = await supa.from('facturas').insert({
        numero_factura: numero, token_publico: token,
        objetivo: s(`Oferta: ${insumo} (${ubicacion})`, 200),
        descripcion: JSON.stringify({ k: 'oferta', insumo, cantidad, unidad, ubicacion, telefono, nombreDonante, zona,
          fotoInsumo: rutas[0], fotos: rutas, fotoCedula: rutaCedula, fotoLugar: rutaLugar,
          coords: coordsOk ? { lat, lng } : null, centro }),
        monto_requerido: cantidad, estado: 'Ofrecida' }).select('id').single();
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: fila.id, tipo: 'Oferta',
        descripcion: mov('donacionOfrecida', { cantidad, unidad, insumo, ubicacion }), monto: cantidad });
      await historial(centro || 'Donaciones ofrecidas', insumo, `Oferta de ${cantidad} ${unidad} en ${ubicacion}`, 'publico', cantidad);
      return { token, numeroFactura: numero };
    }
    case 'listar_ofertas': {
      const { data } = await supa.from('facturas')
        .select('token_publico, descripcion, estado, fecha_creacion')
        .like('descripcion', '{"k":"oferta"%')
        .in('estado', ['Ofrecida', 'EnCamino'])
        .order('fecha_creacion').limit(100);
      return { ofertas: (data || []).map(ofertaPublicaUI).filter(Boolean) };
    }
    // V03: el contacto del donante solo lo ve quien tiene la reserva viva del trabajo.
    case 'reserva_detalle': {
      const ident = await exigirSesion(p);
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, token_publico, objetivo, descripcion, estado, monto_requerido, monto_recaudado')
        .eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('Trabajo no encontrado');
      await exigirDuenoReserva(f.id, ident.email);
      const detalle = ofertaUI(f) || presupuestoUI(f);
      if (!detalle) throw new Error('Trabajo no encontrado');
      return { detalle };
    }
    case 'recoger_oferta': {
      // Paso 2 del ciclo de la oferta: el transportista YA recogió la donación en
      // casa del donante. NO cierra la factura (fecha_cierre) — todavía falta la
      // entrega en el centro (paso 3). Cierra el tramo 1 del viaje (GPS + km).
      const ident = await exigirSesion(p);
      const nombre = ident.nombre || s(p.nombreTransportista, 120) || ident.email;
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, descripcion, estado').eq('token_publico', token).maybeSingle();
      const m = f && metaOferta(String(f.descripcion));
      if (!f || !m) throw new Error('Oferta no encontrada');
      if (f.estado !== 'EnCamino' && f.estado !== 'Ofrecida') throw new Error('Esta donación ya fue recogida');
      await exigirDuenoReserva(f.id, ident.email); // V01: solo el dueño de la reserva
      const centroDestino = s(p.centroDestino, 120) || String(m.centro || '');
      if (!centroDestino) throw new Error('centro de destino requerido');
      // Fotos del paso 2 (opcionales para no romper clientes viejos): sitio, insumo
      // y persona que entrega — evidencia privada, igual que el ciclo de compras.
      const carpeta = `ofertas/${token}`;
      const marca = crypto.randomUUID().slice(0, 8);
      const evidencias: Record<string, unknown>[] = [];
      if (p.fotoSitio) evidencias.push({ factura_id: f.id, archivo: await guardarFoto(p.fotoSitio, carpeta, `recogida-sitio-${marca}`), descripcion: 'Foto del sitio de recogida de la oferta', publica: false });
      if (p.fotoInsumo) evidencias.push({ factura_id: f.id, archivo: await guardarFoto(p.fotoInsumo, carpeta, `recogida-insumo-${marca}`), descripcion: 'Foto de la donación recogida', publica: false });
      if (p.fotoPersona) evidencias.push({ factura_id: f.id, archivo: await guardarFoto(p.fotoPersona, carpeta, `recogida-persona-${marca}`), descripcion: 'Foto de quien entrega la donación', publica: false });
      if (evidencias.length) await supa.from('evidencias').insert(evidencias);
      // GPS + hora → cierran el tramo 1 del viaje vigente y sus km.
      let km: number | null = null;
      const gps = geoValida((p.gps ?? {}) as Record<string, unknown>);
      if (gps.lat !== null && gps.lng !== null) {
        const viaje = await viajeVigente(f.id);
        if (viaje) {
          const tramo1 = (viaje.paso1_lat !== null && viaje.paso1_lng !== null)
            ? kmEntre(Number(viaje.paso1_lat), Number(viaje.paso1_lng), gps.lat, gps.lng) : null;
          await supa.from('viajes').update({
            paso2_ts: new Date().toISOString(), paso2_lat: gps.lat, paso2_lng: gps.lng,
            km_tramo1: tramo1 }).eq('id', viaje.id);
          km = tramo1;
        }
      }
      const datosMov: Record<string, unknown> = { nombre, ubicacion: m.ubicacion, centro: centroDestino };
      if (km !== null) datosMov.km = km;
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recogida',
        descripcion: mov('donacionRecogida', datosMov), monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'Recogida' }).eq('id', f.id); // SIN fecha_cierre: falta la entrega
      await historial(centroDestino, String(m.insumo), `Transportista ${nombre} recogió la donación ofrecida (${m.cantidad} ${m.unidad})`, 'publico', n(m.cantidad));
      return { estado: 'Recogida', km };
    }
    // ===== Acceso por correo (OTP de Supabase Auth) =====
    // El frontend pide el código con /auth/v1/otp y lo canjea con /auth/v1/verify;
    // aquí llega el access_token resultante. Se valida contra Auth y se devuelven
    // los roles registrados con ese correo. El token del panel del centro NO se
    // entrega nunca (V02): el centro entra siempre con token + PIN.
    case 'acceso_perfil': {
      const jwt = s(p.accessToken, 4000);
      if (!jwt) throw new Error('sesión requerida');
      const { data: udata, error: eU } = await supa.auth.getUser(jwt);
      const email = udata?.user?.email?.toLowerCase() || '';
      if (eU || !email) throw new Error('Sesión inválida o vencida, vuelve a pedir un código');
      const roles: Record<string, unknown>[] = [];
      const { data: mots } = await supa.from('motorizados').select('nombre').eq('email', email);
      for (const m of mots || []) roles.push({ tipo: 'transportista', nombre: m.nombre });
      const { data: vols } = await supa.from('voluntarios').select('nombre, apellido').eq('email', email);
      for (const v of vols || []) roles.push({ tipo: 'voluntario', nombre: `${v.nombre} ${v.apellido || ''}`.trim() });
      // V02: NO se devuelve token_centro. Tener un correo que coincide no puede
      // entregar la credencial del panel; el centro sigue entrando con token + PIN.
      const { data: pans } = await supa.from('centros_panel').select('lugares(nombre)').eq('email', email);
      for (const c of pans || []) {
        roles.push({ tipo: 'centro', nombre: (c as { lugares?: { nombre?: string } }).lugares?.nombre || 'Centro' });
      }
      return { email, roles };
    }
    case 'reportar_persona': {
      if (!s(p.nombre)) throw new Error('nombre requerido');
      const { error } = await supa.from('personas').insert({
        nombre: s(p.nombre, 160), cedula: s(p.cedula, 20), estado: s(p.estado ?? p.estadoSalud, 120),
        ubicacion: s(p.ubicacion, 200), contacto: s(p.contacto, 120), fuente: s(p.fuente, 120),
        reportado_por: s(p.reportadoPor ?? p.reportado_por, 120), verificada: false });
      if (error) throw error;
      return {};
    }

    // ===== Denuncias con video (plan 01) =====
    // Cualquier sesión iniciada puede denunciar (incluido el donante sin rol).
    // El público solo ve video+fecha+coords+estado (vista denuncias_public);
    // identidad/rol/texto/GPS-precisión = solo admin.
    case 'denuncia_parcial': {
      // Guardado progresivo cada 5 s: crea la fila en el primer fragmento y
      // resube el objeto de video (upsert) para que siempre haya algo recuperable.
      const jwt = s(p.accessToken, 4000);
      if (!jwt) throw new Error('sesión requerida');
      if (!p.videoBase64) throw new Error('Falta el fragmento de video');
      const ident = await identidadSesion(jwt);
      const duracion = Math.max(0, Math.min(600, Math.round(n(p.duracionS))));
      let id = s(p.denunciaId, 40);
      if (id) {
        const { data: fila } = await supa.from('denuncias').select('id, email').eq('id', id).maybeSingle();
        if (!fila || fila.email !== ident.email) throw new Error('Denuncia no encontrada');
      } else {
        const tipo = s(p.tipo, 40) === 'Retención de insumos' ? 'Retención de insumos' : 'Otro';
        const g = geoValida((p.gps ?? {}) as Record<string, unknown>);
        const prec = Number((p.gps as Record<string, unknown> | undefined)?.precision);
        const facturaToken = s(p.facturaToken, 24).toUpperCase();
        const { data: nueva, error: eIns } = await supa.from('denuncias').insert({
          email: ident.email, nombre: ident.nombre, rol: ident.rol, tipo,
          gps_lat: g.lat, gps_lng: g.lng, gps_precision: Number.isFinite(prec) ? prec : null,
          factura_token: facturaToken || null, origen: 'usuario', estado: 'Recibida' }).select('id').single();
        if (eIns) throw eIns;
        id = nueva.id;
      }
      const ruta = await guardarVideo(p.videoBase64, `denuncias/${id}`, 'video', true);
      await supa.from('denuncias').update({ video_path: ruta, duracion_s: duracion }).eq('id', id);
      return { id };
    }
    case 'denuncia_crear': {
      // Cierre de la denuncia: ensambla el video final y sella los datos.
      const jwt = s(p.accessToken, 4000);
      if (!jwt) throw new Error('sesión requerida');
      if (!p.videoBase64) throw new Error('Falta el video de la denuncia');
      const ident = await identidadSesion(jwt);
      const tipo = s(p.tipo, 40) === 'Retención de insumos' ? 'Retención de insumos' : 'Otro';
      const g = geoValida((p.gps ?? {}) as Record<string, unknown>);
      const prec = Number((p.gps as Record<string, unknown> | undefined)?.precision);
      const duracion = Math.max(0, Math.min(600, Math.round(n(p.duracionS))));
      const texto = s(p.texto, 1000);
      const facturaToken = s(p.facturaToken, 24).toUpperCase();
      let id = s(p.denunciaId, 40);
      if (id) {
        const { data: fila } = await supa.from('denuncias').select('id, email').eq('id', id).maybeSingle();
        if (!fila || fila.email !== ident.email) throw new Error('Denuncia no encontrada');
      } else {
        const { data: nueva, error: eIns } = await supa.from('denuncias').insert({
          email: ident.email, nombre: ident.nombre, rol: ident.rol, tipo,
          gps_lat: g.lat, gps_lng: g.lng, gps_precision: Number.isFinite(prec) ? prec : null,
          texto, factura_token: facturaToken || null, origen: 'usuario', estado: 'Recibida' }).select('id').single();
        if (eIns) throw eIns;
        id = nueva.id;
      }
      const ruta = await guardarVideo(p.videoBase64, `denuncias/${id}`, 'video', true);
      const { error } = await supa.from('denuncias').update({
        video_path: ruta, duracion_s: duracion, tipo, texto,
        gps_lat: g.lat, gps_lng: g.lng, gps_precision: Number.isFinite(prec) ? prec : null }).eq('id', id);
      if (error) throw error;
      if (facturaToken) {
        const { data: f } = await supa.from('facturas').select('id').eq('token_publico', facturaToken).maybeSingle();
        if (f) await supa.from('movimientos_factura').insert({
          factura_id: f.id, tipo: 'Denuncia', descripcion: mov('denunciaRegistrada', {}), monto: 0 });
      }
      return { id, estado: 'Recibida' };
    }
    case 'denuncias_listar': {
      const { data } = await supa.from('denuncias_public')
        .select('*').order('created_at', { ascending: false }).limit(50);
      const filas: Record<string, unknown>[] = [];
      for (const d of data || []) {
        let url = '';
        if (d.video_path) {
          const { data: signed } = await supa.storage.from('denuncias').createSignedUrl(d.video_path as string, 3600);
          url = signed?.signedUrl || '';
        }
        filas.push({ ...d, video_url: url });
      }
      return { denuncias: filas };
    }
    case 'admin_denuncias': {
      const { data } = await supa.from('denuncias')
        .select('*').order('created_at', { ascending: false }).limit(100);
      const filas: Record<string, unknown>[] = [];
      for (const d of data || []) {
        let url = '';
        if (d.video_path) {
          const { data: signed } = await supa.storage.from('denuncias').createSignedUrl(d.video_path as string, 3600);
          url = signed?.signedUrl || '';
        }
        filas.push({ ...d, video_url: url });
      }
      return { denuncias: filas };
    }
    case 'admin_denuncia_estado': {
      const id = s(p.id, 40);
      const estado = ['Recibida', 'En revisión', 'Atendida'].includes(s(p.estado, 20)) ? s(p.estado, 20) : 'Recibida';
      const { error } = await supa.from('denuncias').update({ estado }).eq('id', id);
      if (error) throw error;
      return { estado };
    }
    // ===== Familias damnificadas: solo el admin las ve (fotos con URL firmada) =====
    case 'admin_damnificados': {
      const { data } = await supa.from('familias_damnificadas')
        .select('*').order('created_at', { ascending: false }).limit(300);
      const filas: Record<string, unknown>[] = [];
      for (const f of data || []) {
        const urls: string[] = [];
        for (const ruta of (Array.isArray(f.fotos) ? f.fotos : [])) {
          const { data: signed } = await supa.storage.from('damnificados').createSignedUrl(ruta as string, 3600);
          if (signed?.signedUrl) urls.push(signed.signedUrl);
        }
        filas.push({ ...f, fotos_urls: urls });
      }
      return { familias: filas };
    }
    case 'admin_damnificado_estado': {
      const id = s(p.id, 40);
      const estado = ['nuevo', 'contactado', 'atendido'].includes(s(p.estado, 20)) ? s(p.estado, 20) : 'nuevo';
      const { error } = await supa.from('familias_damnificadas').update({ estado }).eq('id', id);
      if (error) throw error;
      return { estado };
    }
    // ===== Vigilancia de atrasos (plan 07 T4, solo panel) =====
    case 'admin_viajes_atrasados': {
      const { data } = await supa.from('viajes_atrasados')
        .select('id, transportista, email, eta_minutos, token_publico, objetivo, tramo, transcurrido_min')
        .order('transcurrido_min', { ascending: false }).limit(100);
      return { viajes: data || [] };
    }
    case 'admin_viaje_resolver': {
      const id = s(p.id, 40);
      if (!id) throw new Error('id requerido');
      const { error } = await supa.from('viajes').update({ resuelto: true }).eq('id', id);
      if (error) throw error;
      return { resuelto: true };
    }
    // Denuncia generada por administración (plan 07 T5): sobre la tabla del plan
    // 01, origen 'admin', sin video, texto automático. El texto se compone aquí
    // (español canónico, solo-admin) para no cablear español en el JS.
    case 'admin_denuncia_crear': {
      const facturaToken = s(p.facturaToken, 24).toUpperCase();
      const transportista = s(p.transportista, 120) || 'desconocido';
      const horas = Math.max(0, Math.min(999, Math.round(n(p.horas))));
      const tramo = n(p.tramo) === 2 ? 2 : 1;
      const texto = `Generada por administración: el transportista ${transportista} no se reportó; retraso de ${horas} h en el tramo ${tramo}.`;
      const { data: nueva, error } = await supa.from('denuncias').insert({
        email: 'administracion@sistema.local', nombre: 'Administración', rol: 'admin',
        tipo: 'Retención de insumos', texto, factura_token: facturaToken || null,
        origen: 'admin', estado: 'Recibida' }).select('id').single();
      if (error) throw error;
      if (facturaToken) {
        const { data: f } = await supa.from('facturas').select('id').eq('token_publico', facturaToken).maybeSingle();
        if (f) await supa.from('movimientos_factura').insert({
          factura_id: f.id, tipo: 'Denuncia', descripcion: mov('denunciaRegistrada', {}), monto: 0 });
      }
      return { id: nueva.id, estado: 'Recibida' };
    }

    // ===== Panel interno por centro =====
    case 'panel_crear': {
      const pin = s(p.pin, 12);
      if (!/^[0-9]{4,8}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 8 dígitos');
      const nombre = s(p.nombre, 120);
      if (!nombre) throw new Error('nombre requerido');
      const email = emailNorm(p.email);
      if (!email) throw new Error('correo electrónico válido requerido');
      if (s(p.telefono, 40).replace(/[^0-9]/g, '').length < 7) throw new Error('teléfono requerido');
      if (!p.fotoCedula) throw new Error('Falta la foto de la cédula de la persona responsable');
      if (!p.fotoSitio) throw new Error('Falta la foto del sitio del centro');
      // SEGURIDAD: solo se puede auto-crear el panel de un centro NUEVO. Reclamar de
      // forma anonima el panel de un centro ya listado permitiria secuestrar un
      // hospital conocido y sabotear sus necesidades. Para un centro existente, el
      // acceso lo provisiona un admin (admin_regenerar_panel) y lo entrega al centro.
      const { data: yaExiste } = await supa.from('lugares').select('id').eq('nombre', nombre).maybeSingle();
      if (yaExiste) {
        throw new Error('Este centro ya está registrado. Pide al administrador que genere el acceso del panel.');
      }
      const lugar = await obtenerOCrearLugar(p); // crea el centro nuevo
      const foto_cedula = await guardarFoto(p.fotoCedula, `centros/${lugar.id}`, 'cedula');
      const foto_sitio = await guardarFoto(p.fotoSitio, `centros/${lugar.id}`, 'sitio');
      const token = tokenAlfa('CTR');
      const salt = crypto.randomUUID();
      const { error: e2 } = await supa.from('centros_panel').insert({
        lugar_id: lugar.id, token_centro: token, pin_hash: await sha256Hex(salt + pin), pin_salt: salt,
        email, foto_cedula, foto_sitio });
      if (e2) throw e2;
      await historial(nombre, '', 'Panel de centro creado', 'panel');
      return { token };
    }
    case 'panel_ver': {
      const panel = await autenticarPanel(p);
      return await verPanel(panel.lugar_id);
    }
    case 'panel_actualizar_lugar': {
      const panel = await autenticarPanel(p);
      const campos: Record<string, unknown> = { actualizado: new Date().toISOString() };
      if (['Centro', 'Hospital', 'Refugio'].includes(s(p.tipo, 40))) campos.tipo = s(p.tipo, 40);
      if (s(p.ubicacion)) campos.ubicacion = s(p.ubicacion);
      if (s(p.telefono, 40)) campos.telefono = s(p.telefono, 40);
      const geo = geoValida(p);
      if (geo.lat !== null) { campos.lat = geo.lat; campos.lng = geo.lng; }
      const { error } = await supa.from('lugares').update(campos).eq('id', panel.lugar_id);
      if (error) throw error;
      await historial(await nombreDeLugar(panel.lugar_id), '', 'Datos del centro actualizados desde el panel', 'panel');
      return await verPanel(panel.lugar_id);
    }
    case 'panel_insumo': {
      const panel = await autenticarPanel(p);
      const nombre = s(p.insumoNombre, 120);
      if (!nombre) throw new Error('insumo requerido');
      const estado = ['Necesita', 'Disponible', 'Cubierto'].includes(s(p.estado, 20)) ? s(p.estado, 20) : 'Necesita';
      const necesaria = Math.max(0, n(p.cantidadNecesaria)) || 1;
      const recibida = Math.max(0, n(p.cantidadRecibida));
      const unidad = s(p.unidad, 30) || 'unidades';
      const { data: previo } = await supa.from('insumos').select('cantidad_recibida')
        .eq('lugar_id', panel.lugar_id).eq('nombre', nombre).maybeSingle();
      const { error } = await supa.from('insumos').upsert({
        lugar_id: panel.lugar_id, nombre, categoria: s(p.categoria, 60) || 'General', estado,
        cantidad_necesaria: necesaria, cantidad_recibida: recibida,
        urgencia: ['Alta', 'Normal', 'Baja'].includes(s(p.urgencia, 12)) ? s(p.urgencia, 12) : 'Normal',
        unidad,
        actualizado: new Date().toISOString() }, { onConflict: 'lugar_id,nombre' });
      if (error) throw error;
      await supa.from('lugares').update({ actualizado: new Date().toISOString() }).eq('id', panel.lugar_id);
      const centro = await nombreDeLugar(panel.lugar_id);
      await historial(centro, nombre, `Panel: ${nombre} (${estado}, ${recibida} de ${necesaria})`, 'panel', recibida);
      // Cierra el círculo del donante: su token muestra que el centro ya recibió.
      await registrarEntrega(centro, nombre, unidad, recibida - (Number(previo?.cantidad_recibida) || 0), recibida, necesaria);
      return await verPanel(panel.lugar_id);
    }
    case 'panel_insumo_borrar': {
      const panel = await autenticarPanel(p);
      const nombre = s(p.insumoNombre, 120);
      const { error } = await supa.from('insumos')
        .delete().eq('lugar_id', panel.lugar_id).eq('nombre', nombre);
      if (error) throw error;
      await historial(await nombreDeLugar(panel.lugar_id), nombre, `Panel: insumo ${nombre} retirado`, 'panel');
      return await verPanel(panel.lugar_id);
    }

    // ===== Admin: trazabilidad de facturas + verificación + regeneración de paneles =====
    case 'admin_crear_factura': {
      const objetivo = s(p.objetivo, 200);
      if (!objetivo) throw new Error('objetivo requerido');
      const montoReq = n(p.montoRequerido);
      if (montoReq <= 0) throw new Error('montoRequerido debe ser mayor que 0');
      const { data: seq, error: eSeq } = await supa.rpc('factura_numero_siguiente');
      if (eSeq) throw eSeq;
      const numero = `FAC-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
      const token = tokenAlfa('DV');
      const { error } = await supa.from('facturas').insert({
        numero_factura: numero, token_publico: token, objetivo,
        descripcion: s(p.descripcion, 500), monto_requerido: montoReq });
      if (error) throw error;
      await historial('Administración', '', `Factura ${numero} creada: ${objetivo}`, 'admin');
      return { numeroFactura: numero, token };
    }
    case 'admin_crear_vacante': {
      // Vacante de voluntariado: qué perfil se necesita, cuántos y dónde
      // (centro/hospital/refugio o zona de derrumbe con dirección libre).
      const lugarTipo = ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'].includes(s(p.lugarTipo, 40))
        ? s(p.lugarTipo, 40) : 'Centro';
      const lugarNombre = s(p.lugarNombre, 120);
      const rol = s(p.rol, 80);
      const cantidad = n(p.cantidad);
      if (!lugarNombre) throw new Error('nombre del lugar o zona requerido');
      if (!rol) throw new Error('tipo de voluntario requerido');
      if (cantidad <= 0 || cantidad > 10_000) throw new Error('cantidad inválida');
      const { data: fila, error } = await supa.from('vacantes_voluntarios').insert({
        lugar_tipo: lugarTipo, lugar_nombre: lugarNombre, ubicacion: s(p.ubicacion, 160),
        rol, descripcion: s(p.descripcion, 400), cantidad_necesaria: cantidad,
        urgencia: ['Alta', 'Normal', 'Baja'].includes(s(p.urgencia, 12)) ? s(p.urgencia, 12) : 'Normal',
        turno: s(p.turno, 80), telefono: s(p.telefono, 40) }).select('id').single();
      if (error) throw error;
      await historial(lugarNombre, '', `Vacante de voluntariado: ${cantidad} × ${rol} (${lugarTipo})`, 'admin', cantidad);
      return { id: fila.id };
    }
    case 'admin_actualizar_vacante': {
      // Actualiza cupos cubiertos y/o estado de una vacante existente.
      const id = n(p.id);
      if (id <= 0) throw new Error('id requerido');
      const campos: Record<string, unknown> = { actualizado: new Date().toISOString() };
      if (p.cantidadCubierta != null) campos.cantidad_cubierta = Math.max(0, n(p.cantidadCubierta));
      if (['Abierta', 'Cubierta', 'Cerrada'].includes(s(p.estado, 20))) campos.estado = s(p.estado, 20);
      const { data: fila, error } = await supa.from('vacantes_voluntarios')
        .update(campos).eq('id', id).select('id, lugar_nombre, rol, estado, cantidad_cubierta').single();
      if (error) throw error;
      await historial(fila.lugar_nombre, '', `Vacante ${fila.rol}: ${fila.estado}, ${fila.cantidad_cubierta} cubiertos`, 'admin');
      return {};
    }
    case 'admin_listar_vacantes': {
      const { data } = await supa.from('vacantes_voluntarios')
        .select('id, lugar_tipo, lugar_nombre, ubicacion, rol, cantidad_necesaria, cantidad_cubierta, urgencia, turno, estado')
        .order('fecha_creacion', { ascending: false }).limit(100);
      return { vacantes: data || [] };
    }
    case 'admin_listar_rescatistas': {
      const { data, error } = await supa.from('rescatistas')
        .select('id, nombre, organizacion, telefono, especialidad, estado, ciudad, disponibilidad, equipo_disponible, capacidad_operativa, observaciones, fecha_registro')
        .order('fecha_registro', { ascending: false }).limit(100);
      if (error) throw error;
      return { rescatistas: data || [] };
    }
    case 'admin_listar_voluntarios': {
      // El teléfono/correo de voluntarios NO está en la vista pública (S2); el equipo
      // de coordinación los consulta aquí, ya autenticado como admin.
      const { data, error } = await supa.from('voluntarios')
        .select('id, nombre, apellido, email, telefono, estado, ciudad, profesion, disponibilidad, medio_transporte, observaciones, fecha_registro')
        .order('fecha_registro', { ascending: false }).limit(200);
      if (error) throw error;
      return { voluntarios: data || [] };
    }
    case 'admin_crear_presupuesto': {
      // Cotización de un insumo necesitado en una tienda concreta. Puede haber
      // varios presupuestos por insumo (una farmacia tiene 200, otra 1000…):
      // cada uno es su propia factura con su meta de dinero y su token.
      const centro = s(p.centro, 120);
      const insumo = s(p.insumo, 120);
      const tienda = s(p.tienda, 100);
      const direccion = s(p.direccion, 160);
      const cantidad = n(p.cantidad);
      const presentacion = s(p.presentacion, 140);
      const precio = n(p.precio);
      // Plan 08 T3: destino enlazado a la necesidad real, tienda clavada en el
      // mapa (fuente de verdad; la dirección es texto de referencia), URL y
      // adjunto opcionales. Los nombres viejos se conservan (R2.3).
      const necesidadId = s(p.necesidadId, 40);
      const tiendaLat = Number(p.tiendaLat), tiendaLng = Number(p.tiendaLng);
      const tiendaUrl = s(p.tiendaUrl, 300);
      if (!centro || !insumo || !tienda) throw new Error('centro, insumo y tienda requeridos');
      if (cantidad <= 0) throw new Error('cantidad debe ser mayor que 0');
      if (precio <= 0 || precio > 100_000_000) throw new Error('precio inválido');
      if (!(Number.isFinite(tiendaLat) && Number.isFinite(tiendaLng) && Math.abs(tiendaLat) <= 90 && Math.abs(tiendaLng) <= 180)) {
        throw new Error('marca la tienda en el mapa');
      }
      if (tiendaUrl && !/^https?:\/\//i.test(tiendaUrl)) throw new Error('la URL de la tienda debe empezar por http(s)://');
      const { data: lugar } = await supa.from('lugares').select('id').eq('nombre', centro).maybeSingle();
      if (!lugar) throw new Error('Centro no encontrado');
      const { data: seq2, error: eSeq2 } = await supa.rpc('factura_numero_siguiente');
      if (eSeq2) throw eSeq2;
      const numero = `FAC-${new Date().getFullYear()}-${String(seq2).padStart(6, '0')}`;
      const token = tokenAlfa('DV');
      const adjunto = p.adjunto ? await guardarAdjunto(p.adjunto, `presupuestos/${token}`, 'presupuesto') : '';
      const { error } = await supa.from('facturas').insert({
        numero_factura: numero, token_publico: token,
        objetivo: s(`${insumo} → ${centro} · ${tienda}`, 200),
        descripcion: JSON.stringify({ k: 'pres', moneda: 'VES', centro, insumo, tienda, direccion, cantidad, presentacion,
          necesidadId: necesidadId || null, tiendaLat, tiendaLng, tiendaUrl: tiendaUrl || null, adjunto: adjunto || null }),
        monto_requerido: precio });
      if (error) throw error;
      await historial(centro, insumo, `Presupuesto ${numero}: ${cantidad} × ${insumo} en ${tienda} por ${precio}`, 'admin', cantidad);
      return { numeroFactura: numero, token };
    }
    // ===== Ciclo de compra verificada (admin) =====
    // Presupuestos que ya cubrieron la meta y esperan la compra del admin.
    case 'admin_presupuestos_por_comprar': {
      const { data } = await supa.from('facturas')
        .select('numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .in('estado', ['PorComprar', 'Transferida'])
        .order('fecha_creacion', { ascending: true });
      return { presupuestos: (data || []).map(presupuestoUI).filter(Boolean) };
    }
    // Donaciones de un presupuesto + URL firmada del comprobante (para verificar).
    case 'admin_donaciones_presupuesto': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      const { data } = await supa.from('donaciones')
        .select('id, nombre_donante, monto, monto_usd, tasa, referencia_pago, estado, comprobante, fecha')
        .eq('factura_id', f.id).order('fecha', { ascending: false });
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
    // Anula una donación no verificada; si el recaudado cae bajo la meta, reabre.
    case 'admin_donacion_anular': {
      const id = s(p.id, 40);
      const { data: d } = await supa.from('donaciones').select('id, factura_id').eq('id', id).maybeSingle();
      if (!d) throw new Error('donación no encontrada');
      await supa.from('donaciones').update({ estado: 'Anulada' }).eq('id', id); // el trigger deja de sumarla
      const { data: f } = await supa.from('facturas')
        .select('id, monto_recaudado, monto_requerido, estado').eq('id', d.factura_id).single();
      let estadoFin = f?.estado as string | undefined;
      if (f && ['PorComprar', 'Transferida'].includes(f.estado as string)
            && Number(f.monto_recaudado) < Number(f.monto_requerido)) {
        await supa.from('facturas').update({ estado: 'Abierta' }).eq('id', f.id);
        await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Reapertura',
          descripcion: mov('reabiertoPorAnulacion', {}), monto: 0 });
        estadoFin = 'Abierta';
      }
      return { estado: estadoFin, recaudado: Number(f?.monto_recaudado) || 0 };
    }
    // El admin marca USD→Bs transferido y sube el consolidado PÚBLICO (ya anonimizado
    // por él) de las transferencias recibidas → estado Transferida.
    case 'admin_presupuesto_transferido': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id, estado').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      if (f.estado !== 'PorComprar') throw new Error('El presupuesto no está en espera de compra');
      if (!p.consolidado) throw new Error('Sube el archivo consolidado de transferencias recibidas');
      const url = await guardarAdjunto(p.consolidado, `presupuestos/${token}`, `transferencias-${Date.now()}`);
      await supa.from('evidencias').insert({ factura_id: f.id, archivo: url,
        descripcion: 'Transferencias recibidas (consolidado)', publica: true });
      await supa.from('facturas').update({ estado: 'Transferida' }).eq('id', f.id);
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Transferencia',
        descripcion: mov('transferidoABs', {}), monto: 0 });
      return { estado: 'Transferida' };
    }
    // El admin sube la factura pagada al proveedor (PÚBLICA) → estado Comprada. Recién
    // aquí el insumo entra al ciclo del transportista.
    case 'admin_presupuesto_comprado': {
      const token = s(p.token, 40);
      const { data: f } = await supa.from('facturas').select('id, estado').eq('token_publico', token).maybeSingle();
      if (!f) throw new Error('presupuesto no encontrado');
      if (!['PorComprar', 'Transferida'].includes(f.estado as string)) throw new Error('El presupuesto no está listo para comprar');
      if (!p.factura) throw new Error('Sube la factura pagada al proveedor');
      const url = await guardarAdjunto(p.factura, `presupuestos/${token}`, `factura-compra-${Date.now()}`);
      await supa.from('evidencias').insert({ factura_id: f.id, archivo: url,
        descripcion: 'Factura de compra pagada al proveedor', publica: true });
      await supa.from('facturas').update({ estado: 'Comprada' }).eq('id', f.id);
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Compra',
        descripcion: mov('compraConfirmada', {}), monto: 0 });
      return { estado: 'Comprada' };
    }
    // Plan 08 T3: centros con necesidades ABIERTAS + sus insumos, para los selects
    // dependientes del wizard de presupuesto (el panel admin no carga la data
    // pública: cargarTodo es no-op en ventana.html).
    case 'admin_listar_necesidades': {
      const { data: ins } = await supa.from('insumos')
        .select('id, nombre, unidad, cantidad_necesaria, cantidad_recibida, urgencia, lugar_id')
        .eq('estado', 'Necesita');
      const ids = [...new Set((ins || []).map((i) => i.lugar_id))];
      const { data: lugs } = ids.length
        ? await supa.from('lugares').select('id, nombre').in('id', ids)
        : { data: [] as { id: number; nombre: string }[] };
      const nombrePorId: Record<string, string> = {};
      for (const l of lugs || []) nombrePorId[String(l.id)] = l.nombre as string;
      const porCentro: Record<string, { centro: string; insumos: unknown[] }> = {};
      for (const i of ins || []) {
        const cn = nombrePorId[String(i.lugar_id)];
        if (!cn) continue;
        const pend = Math.max(0, (Number(i.cantidad_necesaria) || 0) - (Number(i.cantidad_recibida) || 0));
        if (pend <= 0) continue;
        (porCentro[cn] = porCentro[cn] || { centro: cn, insumos: [] }).insumos.push({
          id: i.id, nombre: i.nombre, unidad: i.unidad || 'unidades', pendiente: pend, urgencia: i.urgencia });
      }
      return { centros: Object.values(porCentro).filter((c) => c.insumos.length) };
    }
    case 'admin_listar_facturas': {
      const { data } = await supa.from('facturas')
        .select('id, numero_factura, token_publico, objetivo, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .order('fecha_creacion', { ascending: false }).limit(100);
      const filas = data || [];
      // Última actualización = fecha del último movimiento de cada factura (el
      // «hace X» de Track Donation, plan 08). Un solo query, se cruza en memoria.
      const ids = filas.map((f) => f.id);
      const ult: Record<string, string> = {};
      if (ids.length) {
        const { data: movs } = await supa.from('movimientos_factura')
          .select('factura_id, fecha').in('factura_id', ids).order('fecha', { ascending: false });
        for (const m of movs || []) { const k = String(m.factura_id); if (!ult[k]) ult[k] = m.fecha as string; }
      }
      return { facturas: filas.map((f) => ({ ...f, ultima_actualizacion: ult[String(f.id)] || f.fecha_creacion })) };
    }
    case 'admin_registrar_donacion': {
      const f = await facturaPor(p);
      const monto = n(p.monto);
      if (monto <= 0) throw new Error('monto debe ser mayor que 0');
      const estado = ['Registrada', 'Confirmada'].includes(s(p.estado, 20)) ? s(p.estado, 20) : 'Registrada';
      const { error } = await supa.from('donaciones').insert({
        factura_id: f.id, nombre_donante: s(p.nombreDonante, 120) || 'Anónimo',
        monto, referencia_pago: s(p.referencia, 80), estado });
      if (error) throw error;
      await historial('Administración', '', `Donación ${estado.toLowerCase()} de ${monto} a ${f.numero_factura}`, 'admin', monto);
      return {};
    }
    case 'admin_registrar_movimiento': {
      const f = await facturaPor(p);
      const tipo = ['Ingreso', 'Egreso', 'Compra', 'Entrega'].includes(s(p.tipo, 20)) ? s(p.tipo, 20) : 'Ingreso';
      const { error } = await supa.from('movimientos_factura').insert({
        factura_id: f.id, tipo, descripcion: s(p.descripcion, 300), monto: n(p.monto) });
      if (error) throw error;
      await historial('Administración', '', `Movimiento ${tipo} en ${f.numero_factura}: ${s(p.descripcion, 80)}`, 'admin', n(p.monto));
      return {};
    }
    case 'admin_registrar_evidencia': {
      const f = await facturaPor(p);
      const archivo = s(p.archivo, 400);
      if (!/^https:\/\//.test(archivo)) throw new Error('archivo debe ser una URL https');
      const { error } = await supa.from('evidencias').insert({
        factura_id: f.id, archivo, descripcion: s(p.descripcion, 300), publica: p.publica !== false });
      if (error) throw error;
      await historial('Administración', '', `Evidencia registrada en ${f.numero_factura}`, 'admin');
      return {};
    }
    case 'admin_cerrar_factura': {
      const f = await facturaPor(p);
      const { error } = await supa.from('facturas')
        .update({ estado: 'Cerrada', fecha_cierre: new Date().toISOString() }).eq('id', f.id);
      if (error) throw error;
      await historial('Administración', '', `Factura ${f.numero_factura} cerrada`, 'admin');
      return {};
    }
    case 'admin_listar_personas': {
      const { data } = await supa.from('personas')
        .select('id, nombre, cedula, estado, ubicacion, contacto, fuente, fecha')
        .eq('verificada', false).order('fecha', { ascending: false }).limit(100);
      return { personas: data || [] };
    }
    case 'admin_verificar_persona': {
      const id = n(p.id);
      if (id <= 0) throw new Error('id requerido');
      const { error } = await supa.from('personas').update({ verificada: true }).eq('id', id);
      if (error) throw error;
      await historial('Administración', '', `Persona ${id} verificada`, 'admin');
      return {};
    }
    case 'admin_regenerar_panel': {
      const nombre = s(p.nombre, 120);
      if (!nombre) throw new Error('nombre del centro requerido');
      const { data: lugar } = await supa.from('lugares').select('id').eq('nombre', nombre).maybeSingle();
      if (!lugar) throw new Error('Centro no encontrado');
      const token = tokenAlfa('CTR');
      const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
      const salt = crypto.randomUUID();
      const fila = { lugar_id: lugar.id, token_centro: token, pin_hash: await sha256Hex(salt + pin), pin_salt: salt };
      const { error } = await supa.from('centros_panel').upsert(fila, { onConflict: 'lugar_id' });
      if (error) throw error;
      await historial(nombre, '', 'Panel regenerado por administración', 'admin');
      return { token, pin };
    }
    default:
      throw new Error('accion desconocida');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'solo POST' }), { status: 405, headers: CORS });
  }
  try {
    const body = await req.json();
    const accion = s(body?.accion, 40);
    const extra = await handle(accion, body || {}, req);
    return new Response(JSON.stringify({ success: true, ...extra }), { headers: CORS });
  } catch (err) {
    const msg = s((err as Error).message, 200);
    const status = /demasiadas/i.test(msg) ? 429 : /clave admin|no configurado/i.test(msg) ? 401 : 400;
    return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: CORS });
  }
});

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

// Guarda una foto (data URL JPEG/PNG/WebP, máx ~1.8MB decodificada) en el bucket
// PRIVADO registro-transportistas. Solo el service role accede; nada es público.
async function guardarFoto(dataUrl: unknown, carpeta: string, nombre: string): Promise<string> {
  const m = String(dataUrl ?? '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error(`foto de ${nombre} inválida (se espera imagen JPEG/PNG)`);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 1000) throw new Error(`foto de ${nombre} vacía`);
  if (bytes.length > 1_800_000) throw new Error(`foto de ${nombre} demasiado grande`);
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const ruta = `${carpeta}/${nombre}.${ext}`;
  const { error } = await supa.storage.from('registro-transportistas')
    .upload(ruta, bytes, { contentType: `image/${m[1]}`, upsert: false });
  if (error) throw new Error(`no se pudo guardar la foto de ${nombre}`);
  return ruta;
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
      descripcion: `El centro confirmó la recepción de ${delta} ${unidad}`, monto: delta });
  }
  if (necesaria > 0 && recibida >= necesaria) {
    await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Entrega',
      descripcion: 'Necesidad cubierta: el centro ya recibió todo lo solicitado', monto: 0 });
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

function presupuestoUI(f: Record<string, unknown>) {
  const m = metaPresupuesto(String(f.descripcion ?? ''));
  if (!m) return null;
  return {
    token: f.token_publico, objetivo: f.objetivo, estado: f.estado,
    centro: m.centro, insumo: m.insumo, tienda: m.tienda, direccion: m.direccion,
    cantidad: m.cantidad, presentacion: m.presentacion,
    precio: Number(f.monto_requerido) || 0, recaudado: Number(f.monto_recaudado) || 0,
  };
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
  const esPanel = accion.startsWith('panel_') && accion !== 'panel_crear';
  const esAdmin = accion.startsWith('admin_');
  // Las lecturas públicas no gastan el cupo de escrituras (30/h): navegar los
  // presupuestos o la lista de recogidas no debe bloquear el poder donar.
  const esLectura = ['listar_presupuestos', 'listar_comprados', 'listar_ofertas', 'acceso_perfil'].includes(accion);
  if (esAdmin) await autenticarAdmin(p, req);
  else if (esLectura) {
    if (!(await rateHit(ipDe(req), 'lectura', 240))) throw new Error('Demasiadas solicitudes, intenta en una hora');
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
        descripcion: `Donación registrada: ${cantidad} ${unidad} de ${item.nombre}`, monto: cantidad });
      await historial(lugar.nombre, item.nombre, `Donación registrada: ${cantidad} ${unidad}`, 'publico', cantidad);
      return { token: f.token_publico, numeroFactura: f.numero_factura, objetivo };
    }

    // ===== Presupuestos: donación en DINERO + ciclo logístico =====
    case 'listar_presupuestos': {
      const { data } = await supa.from('facturas')
        .select('token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .like('descripcion', '{"k":"pres"%')
        .order('fecha_creacion', { ascending: false }).limit(200);
      return { presupuestos: (data || []).map(presupuestoUI).filter(Boolean) };
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
      // Aporte monetario a UN presupuesto. Simulación por ahora: el sistema
      // genera la referencia de transacción; cuando exista la cuenta real, la
      // referencia vendrá del pago y entrará por este mismo camino.
      const monto = n(p.monto);
      if (monto <= 0 || monto > 10_000_000) throw new Error('monto inválido');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, token_publico, descripcion, monto_requerido, monto_recaudado, estado')
        .eq('token_publico', token).maybeSingle();
      const m = f && metaPresupuesto(String(f.descripcion));
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (f.estado !== 'Abierta') throw new Error('Este presupuesto ya está financiado');
      const referencia = tokenAlfa('REF');
      const { error } = await supa.from('donaciones').insert({
        factura_id: f.id, nombre_donante: s(p.nombreDonante, 120) || 'Anónimo',
        monto, referencia_pago: referencia, estado: 'Confirmada' }); // Confirmada: el trigger suma al recaudado en vivo
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Ingreso',
        descripcion: `Donación de dinero recibida (ref ${referencia})`, monto });
      // ¿Se completó la meta? → el insumo queda Comprado y entra al ciclo logístico.
      const { data: tras } = await supa.from('facturas')
        .select('monto_recaudado, monto_requerido, estado').eq('id', f.id).single();
      let estadoFinal = tras?.estado || 'Abierta';
      if (tras && Number(tras.monto_recaudado) >= Number(tras.monto_requerido) && tras.estado === 'Abierta') {
        estadoFinal = 'Comprada';
        await supa.from('facturas').update({ estado: 'Comprada' }).eq('id', f.id);
        await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Compra',
          descripcion: `Meta alcanzada: fondos completos para ${m.insumo} en ${m.tienda}. Un transportista ya puede retirarlo.`, monto: 0 });
      }
      await historial(String(m.centro), String(m.insumo), `Donación en dinero de ${monto} (ref ${referencia})`, 'publico', monto);
      return { referencia, token: f.token_publico, numeroFactura: f.numero_factura,
               recaudado: Number(tras?.monto_recaudado) || 0, precio: Number(f.monto_requerido) || 0, estado: estadoFinal };
    }
    case 'registrar_recogida': {
      // El transportista retira el insumo comprado en la tienda: fotos del
      // sitio y del insumo (bucket privado) + movimiento público con el relato.
      const nombre = s(p.nombreTransportista, 120);
      if (!nombre) throw new Error('nombre del transportista requerido');
      if (!p.fotoSitio || !p.fotoInsumo) throw new Error('Faltan fotos: sitio de recogida e insumo son obligatorias');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, descripcion, estado').eq('token_publico', token).maybeSingle();
      const m = f && metaPresupuesto(String(f.descripcion));
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (f.estado !== 'Comprada') throw new Error('Este insumo no está listo para recoger');
      const carpeta = `ciclo/${f.numero_factura}`;
      const marca = crypto.randomUUID().slice(0, 8);
      const fotoSitio = await guardarFoto(p.fotoSitio, carpeta, `recogida-sitio-${marca}`);
      const fotoInsumo = await guardarFoto(p.fotoInsumo, carpeta, `recogida-insumo-${marca}`);
      await supa.from('evidencias').insert([
        { factura_id: f.id, archivo: fotoSitio, descripcion: `Foto del sitio de recogida (${m.tienda})`, publica: false },
        { factura_id: f.id, archivo: fotoInsumo, descripcion: 'Foto del insumo comprado', publica: false }]);
      const notas = s(p.notas, 300);
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recogida',
        descripcion: `${nombre} recogió el insumo en ${m.tienda} (${m.direccion}). Fotos del sitio y del insumo registradas.${notas ? ' Nota: ' + notas : ''}`, monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'EnTransito' }).eq('id', f.id);
      await historial(String(m.centro), String(m.insumo), `Transportista ${nombre} recogió el insumo comprado en ${m.tienda}`, 'publico');
      return { estado: 'EnTransito' };
    }
    case 'registrar_entrega_final': {
      // Cierre del ciclo: el transportista entrega en el centro, registra a la
      // persona que recibe + foto de los insumos. El donante lo ve en su token.
      const receptor = s(p.nombreReceptor, 120);
      if (!receptor) throw new Error('nombre de quien recibe requerido');
      if (!p.fotoEntrega) throw new Error('Falta la foto de los insumos entregados');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, numero_factura, descripcion, estado').eq('token_publico', token).maybeSingle();
      const m = f && metaPresupuesto(String(f.descripcion));
      if (!f || !m) throw new Error('Presupuesto no encontrado');
      if (f.estado !== 'EnTransito') throw new Error('Este insumo no está en tránsito');
      const foto = await guardarFoto(p.fotoEntrega, `ciclo/${f.numero_factura}`, `entrega-${crypto.randomUUID().slice(0, 8)}`);
      await supa.from('evidencias').insert({
        factura_id: f.id, archivo: foto, descripcion: `Foto de los insumos entregados en ${m.centro}`, publica: false });
      const cargo = s(p.cargoReceptor, 80);
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Entrega',
        descripcion: `Entregado en ${m.centro}. Recibió: ${receptor}${cargo ? ' (' + cargo + ')' : ''}. Foto de los insumos registrada.`, monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'Entregada', fecha_cierre: new Date().toISOString() }).eq('id', f.id);
      await historial(String(m.centro), String(m.insumo), `Insumo comprado entregado en el centro. Recibió ${receptor}`, 'publico');
      return { estado: 'Entregada' };
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
        descripcion: JSON.stringify({ k: 'oferta', insumo, cantidad, unidad, ubicacion, telefono, nombreDonante,
          fotoInsumo: rutas[0], fotos: rutas, fotoCedula: rutaCedula, fotoLugar: rutaLugar,
          coords: coordsOk ? { lat, lng } : null, centro }),
        monto_requerido: cantidad, estado: 'Ofrecida' }).select('id').single();
      if (error) throw error;
      await supa.from('movimientos_factura').insert({ factura_id: fila.id, tipo: 'Oferta',
        descripcion: `Donación ofrecida: ${cantidad} ${unidad} de ${insumo} en ${ubicacion}. Esperando transportista.`, monto: cantidad });
      await historial(centro || 'Donaciones ofrecidas', insumo, `Oferta de ${cantidad} ${unidad} en ${ubicacion}`, 'publico', cantidad);
      return { token, numeroFactura: numero };
    }
    case 'listar_ofertas': {
      const { data } = await supa.from('facturas')
        .select('token_publico, descripcion, estado, fecha_creacion')
        .like('descripcion', '{"k":"oferta"%')
        .eq('estado', 'Ofrecida')
        .order('fecha_creacion').limit(100);
      return { ofertas: (data || []).map(ofertaUI).filter(Boolean) };
    }
    case 'recoger_oferta': {
      const nombre = s(p.nombreTransportista, 120);
      const centroDestino = s(p.centroDestino, 120);
      if (!nombre) throw new Error('nombre del transportista requerido');
      if (!centroDestino) throw new Error('centro de destino requerido');
      const token = s(p.token, 24).toUpperCase();
      const { data: f } = await supa.from('facturas')
        .select('id, descripcion, estado').eq('token_publico', token).maybeSingle();
      const m = f && metaOferta(String(f.descripcion));
      if (!f || !m) throw new Error('Oferta no encontrada');
      if (f.estado !== 'Ofrecida') throw new Error('Esta donación ya fue recogida');
      const { error } = await supa.from('movimientos_factura').insert({ factura_id: f.id, tipo: 'Recogida',
        descripcion: `${nombre} recogió la donación en ${m.ubicacion} para llevarla a ${centroDestino}.`, monto: 0 });
      if (error) throw error;
      await supa.from('facturas').update({ estado: 'Recogida', fecha_cierre: new Date().toISOString() }).eq('id', f.id);
      await historial(centroDestino, String(m.insumo), `Transportista ${nombre} recogió la donación ofrecida (${m.cantidad} ${m.unidad})`, 'publico', n(m.cantidad));
      return { estado: 'Recogida' };
    }
    // ===== Acceso por correo (OTP de Supabase Auth) =====
    // El frontend pide el código con /auth/v1/otp y lo canjea con /auth/v1/verify;
    // aquí llega el access_token resultante. Se valida contra Auth y se devuelven
    // los roles registrados con ese correo. El token del panel del centro solo se
    // entrega a quien demostró (vía OTP) controlar el correo del registro; el PIN
    // sigue siendo obligatorio para actuar.
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
      const { data: pans } = await supa.from('centros_panel').select('token_centro, lugares(nombre)').eq('email', email);
      for (const c of pans || []) {
        roles.push({ tipo: 'centro', nombre: (c as { lugares?: { nombre?: string } }).lugares?.nombre || 'Centro', token: c.token_centro });
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
      const token = tokenAlfa('CTR');
      const salt = crypto.randomUUID();
      const { error: e2 } = await supa.from('centros_panel').insert({
        lugar_id: lugar.id, token_centro: token, pin_hash: await sha256Hex(salt + pin), pin_salt: salt,
        email, foto_cedula });
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
      if (!centro || !insumo || !tienda) throw new Error('centro, insumo y tienda requeridos');
      if (cantidad <= 0) throw new Error('cantidad debe ser mayor que 0');
      if (precio <= 0 || precio > 100_000_000) throw new Error('precio inválido');
      const { data: lugar } = await supa.from('lugares').select('id').eq('nombre', centro).maybeSingle();
      if (!lugar) throw new Error('Centro no encontrado');
      const { data: seq2, error: eSeq2 } = await supa.rpc('factura_numero_siguiente');
      if (eSeq2) throw eSeq2;
      const numero = `FAC-${new Date().getFullYear()}-${String(seq2).padStart(6, '0')}`;
      const token = tokenAlfa('DV');
      const { error } = await supa.from('facturas').insert({
        numero_factura: numero, token_publico: token,
        objetivo: s(`${insumo} → ${centro} · ${tienda}`, 200),
        descripcion: JSON.stringify({ k: 'pres', centro, insumo, tienda, direccion, cantidad, presentacion }),
        monto_requerido: precio });
      if (error) throw error;
      await historial(centro, insumo, `Presupuesto ${numero}: ${cantidad} × ${insumo} en ${tienda} por ${precio}`, 'admin', cantidad);
      return { numeroFactura: numero, token };
    }
    case 'admin_listar_facturas': {
      const { data } = await supa.from('facturas')
        .select('id, numero_factura, token_publico, objetivo, monto_requerido, monto_recaudado, estado, fecha_creacion')
        .order('fecha_creacion', { ascending: false }).limit(100);
      return { facturas: data || [] };
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

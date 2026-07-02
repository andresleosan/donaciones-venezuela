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
  if (esAdmin) await autenticarAdmin(p, req);
  else if (!esPanel && !(await rateHit(ipDe(req), 'publico', 30))) {
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
      const { error } = await supa.from('voluntarios').insert({
        id: s(p.id, 40) || 'VOL' + crypto.randomUUID().slice(0, 8),
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
      if (!p.fotoPlaca || !p.fotoVehiculo || !p.fotoCedula) {
        throw new Error('Faltan fotos: placa, vehículo y cédula son obligatorias');
      }
      const id = s(p.id, 40) || 'MOT' + crypto.randomUUID().slice(0, 8);
      const foto_placa = await guardarFoto(p.fotoPlaca, id, 'placa');
      const foto_vehiculo = await guardarFoto(p.fotoVehiculo, id, 'vehiculo');
      const foto_cedula = await guardarFoto(p.fotoCedula, id, 'cedula');
      const { error } = await supa.from('motorizados').insert({
        id, nombre: s(p.nombre, 120), tipo_vehiculo: s(p.tipoVehiculo ?? p.tipo_vehiculo, 40) || 'Moto',
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
      // SEGURIDAD: solo se puede auto-crear el panel de un centro NUEVO. Reclamar de
      // forma anonima el panel de un centro ya listado permitiria secuestrar un
      // hospital conocido y sabotear sus necesidades. Para un centro existente, el
      // acceso lo provisiona un admin (admin_regenerar_panel) y lo entrega al centro.
      const { data: yaExiste } = await supa.from('lugares').select('id').eq('nombre', nombre).maybeSingle();
      if (yaExiste) {
        throw new Error('Este centro ya está registrado. Pide al administrador que genere el acceso del panel.');
      }
      const lugar = await obtenerOCrearLugar(p); // crea el centro nuevo
      const token = tokenAlfa('CTR');
      const salt = crypto.randomUUID();
      const { error: e2 } = await supa.from('centros_panel').insert({
        lugar_id: lugar.id, token_centro: token, pin_hash: await sha256Hex(salt + pin), pin_salt: salt });
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
      const { error } = await supa.from('insumos').upsert({
        lugar_id: panel.lugar_id, nombre, categoria: s(p.categoria, 60) || 'General', estado,
        cantidad_necesaria: necesaria, cantidad_recibida: recibida,
        urgencia: ['Alta', 'Normal', 'Baja'].includes(s(p.urgencia, 12)) ? s(p.urgencia, 12) : 'Normal',
        unidad: s(p.unidad, 30) || 'unidades',
        actualizado: new Date().toISOString() }, { onConflict: 'lugar_id,nombre' });
      if (error) throw error;
      await supa.from('lugares').update({ actualizado: new Date().toISOString() }).eq('id', panel.lugar_id);
      await historial(await nombreDeLugar(panel.lugar_id), nombre,
        `Panel: ${nombre} (${estado}, ${recibida} de ${necesaria})`, 'panel', recibida);
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

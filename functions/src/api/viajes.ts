import {
  ApiError,
  geoValida,
  idEntidad,
  kmEntre,
  mov,
  n,
  s,
} from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar, historial } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { ajustarContadores } from './estadisticas.js';
import { publicar } from './publicar.js';
import { defineAction } from './registry.js';
import {
  COLECCION_MOTORIZADOS,
  documentoPublicoMotorizado,
  PROYECCION_MOTORIZADOS,
} from './personas.js';
import {
  agregarEvidencia,
  agregarMovimiento,
  aplicarTransicion,
  cargarFacturaPorToken,
  comoFecha,
  guardarFactura,
  instantanea,
  tokenNormalizado,
} from './facturas.js';
import type { Factura, FacturaCargada, FirestoreFacturas } from './facturas.js';
import {
  comoMeta as comoMetaPresupuesto,
  republicar as republicarPresupuesto,
} from './presupuestos.js';
import {
  cargarContacto,
  comoMeta as comoMetaOferta,
  conectarReservaDeViaje,
  detallePrivado,
  republicar as republicarOferta,
  SIN_RESERVA,
} from './ofertas.js';
import type { ReservaViva } from './ofertas.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: transporte. El ciclo logistico de tres pasos que lleva un insumo
// comprado (o una donacion ofrecida) hasta el centro, mas los dos registros de
// apoyo a transportistas que el legado guardaba sueltos.
//
// Modelo:
//   viajes/{VIA-XXXXXXXX}                  canonico, privado (GPS exacto)
//   facturas/{FCT-…}.viajeVigenteId        el UNICO viaje abierto de la factura
//   trayectos/{TRY-…}                      -> trayectosPublicos/{TRY-…}
//   donacionesMotorizados/{DMO-…}          -> donacionesMotorizadosPublicos/{…}
//
// «La reserva es el permiso» (contrato §1.7): quien inicia el viaje se queda el
// trabajo hasta que caduca, y solo esa persona puede registrar la recogida y la
// entrega. El legado guardaba esa identidad como el CORREO de la sesion y
// buscaba la reserva con una consulta ordenada por fecha; aqui la identidad es
// el `uid` y el viaje vigente lo apunta la propia factura, asi que la reserva se
// resuelve con una lectura por id dentro de la transaccion y dos transportistas
// no pueden reservar a la vez.

export const PREFIJO_VIAJE = 'VIA';
export const PREFIJO_TRAYECTO = 'TRY';
export const PREFIJO_APORTE = 'DMO';

export const COLECCION_VIAJES = 'viajes';
export const COLECCION_TRAYECTOS = 'trayectos';
export const COLECCION_APORTES = 'donacionesMotorizados';
export const PROYECCION_TRAYECTOS = 'trayectosPublicos';
export const PROYECCION_APORTES = 'donacionesMotorizadosPublicos';

// Contrato §1.7: la reserva vive `eta + 60 min` desde el paso 1.
export const GRACIA_RESERVA_MIN = 60;
// Contrato §1.19: un tramo se considera atrasado 120 min despues de lo previsto.
export const ALERTA_TRAMO_MIN = 120;

export const ETA_MIN = 5;
export const ETA_MAX = 480;

export const TOPE_ATRASADOS = 100;
export const MAX_KM = 5_000;
export const MAX_APORTE = 1_000_000;

export const MINUTO_MS = 60_000;

// Mensajes del legado, palabra por palabra.
export const AJENA = 'Este trabajo está reservado por otra persona';
export const YA_RESERVADO = 'Este trabajo ya lo reservó otra persona';

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string; get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> };

type Consulta = {
  where(campo: string, operador: string, valor: unknown): Consulta;
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionViajes = Consulta & { doc(id?: string): Referencia };

export type FirestoreViajes = {
  collection(nombre: string): ColeccionViajes;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreViajes {
  return ctx.db as unknown as FirestoreViajes;
}

function contextoMinimo(ctx: ActionContext): ContextoMinimo {
  return {
    uid: ctx.uid,
    role: ctx.role,
    ip: ctx.ip,
    now: ctx.now,
    db: ctx.db as unknown as FirestoreMinimo,
  };
}

function base(ctx: ContextoMinimo): FirestoreViajes {
  return ctx.db as unknown as FirestoreViajes;
}

// --- Modelo -------------------------------------------------------------------

export type Paso = { ts: Date | null; lat: number | null; lng: number | null };

export const PASO_VACIO: Paso = { ts: null, lat: null, lng: null };

export type Viaje = {
  facturaId: string;
  facturaToken: string;
  numeroFactura: string;
  objetivo: string;
  // Identidad del transportista. El legado usaba el correo de la sesion; el uid
  // no se puede escribir a mano en el cuerpo de la peticion.
  uid: string;
  transportista: string;
  etaMinutos: number;
  paso1: Paso;
  paso2: Paso;
  paso3: Paso;
  kmTramo1: number | null;
  kmTramo2: number | null;
  // El admin lo libera sin tocar el estado de la factura (contrato §1.7).
  resuelto: boolean;
  // Ni cerrado ni resuelto. Es el campo que hace consultable «lo que sigue en la
  // calle»: sin el, `venceAlerta <= now` tendria que convivir con los nulos de
  // los viajes cerrados, y en Firestore `null` ordena ANTES que cualquier fecha,
  // asi que todos los viajes terminados saldrian como atrasados.
  abierto: boolean;
  // `paso1.ts + (eta + 60) min`. Precalculado para no repetir la aritmetica del
  // legado en cada lectura.
  venceReserva: Date | null;
  // Tramo 1: `paso1.ts + (eta + 120) min`. Tramo 2: `paso2.ts + 120 min`.
  // Precalcularlo convierte la vista `viajes_atrasados` del legado en una
  // consulta de dos campos en vez de un recorrido de la tabla.
  venceAlerta: Date | null;
  createdAt: Date;
  actualizado: Date;
};

function comoPaso(valor: unknown): Paso {
  const paso = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const lat = Number(paso.lat);
  const lng = Number(paso.lng);
  return {
    ts: comoFecha(paso.ts),
    lat: paso.lat === null || paso.lat === undefined || !Number.isFinite(lat) ? null : lat,
    lng: paso.lng === null || paso.lng === undefined || !Number.isFinite(lng) ? null : lng,
  };
}

function comoKm(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 10) / 10 : null;
}

export function comoViaje(datos: Record<string, unknown>): Viaje {
  return {
    facturaId: s(datos.facturaId, 40),
    facturaToken: s(datos.facturaToken, 40),
    numeroFactura: s(datos.numeroFactura, 40),
    objetivo: s(datos.objetivo, 200),
    uid: s(datos.uid, 128),
    transportista: s(datos.transportista, 120),
    etaMinutos: Math.max(0, Math.trunc(n(datos.etaMinutos))),
    paso1: comoPaso(datos.paso1),
    paso2: comoPaso(datos.paso2),
    paso3: comoPaso(datos.paso3),
    kmTramo1: comoKm(datos.kmTramo1),
    kmTramo2: comoKm(datos.kmTramo2),
    resuelto: datos.resuelto === true,
    abierto: datos.abierto !== false,
    venceReserva: comoFecha(datos.venceReserva),
    venceAlerta: comoFecha(datos.venceAlerta),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? comoFecha(datos.createdAt) ?? new Date(0),
  };
}

export type ViajeCargado = { id: string; datos: Viaje };

export function refViaje(db: FirestoreViajes, viajeId: string): Referencia {
  return db.collection(COLECCION_VIAJES).doc(viajeId);
}

// Tramo en curso: 1 mientras no se haya recogido, 2 despues.
export function tramoDe(viaje: Pick<Viaje, 'paso2'>): 1 | 2 {
  return viaje.paso2.ts ? 2 : 1;
}

// Cuando deja de valer la reserva (contrato §1.7, paso 3).
export function calcularVenceReserva(paso1: Paso, etaMinutos: number): Date | null {
  if (!paso1.ts) return null;
  return new Date(paso1.ts.getTime() + (etaMinutos + GRACIA_RESERVA_MIN) * MINUTO_MS);
}

// Cuando el viaje empieza a aparecer en la alerta del admin (contrato §1.19).
export function calcularVenceAlerta(viaje: Pick<Viaje, 'paso1' | 'paso2' | 'etaMinutos'>): Date | null {
  if (viaje.paso2.ts) return new Date(viaje.paso2.ts.getTime() + ALERTA_TRAMO_MIN * MINUTO_MS);
  if (viaje.paso1.ts) {
    return new Date(viaje.paso1.ts.getTime() + (viaje.etaMinutos + ALERTA_TRAMO_MIN) * MINUTO_MS);
  }
  return null;
}

// `reservaViva` del legado: el viaje vigente que ni se resolvio, ni se cerro, ni
// caduco. Un viaje caducado NO se borra: deja de dar permiso y el trabajo vuelve
// a estar libre.
export function reservaEstaViva(viaje: Viaje, ahora: Date): boolean {
  if (viaje.resuelto || !viaje.abierto) return false;
  if (viaje.paso3.ts) return false;
  if (!viaje.venceReserva) return false;
  return ahora.getTime() < viaje.venceReserva.getTime();
}

// --- Reserva ------------------------------------------------------------------

// Lee el viaje que apunta la factura. Devuelve `null` si no hay ninguno, si el
// documento desaparecio o si ya no da permiso.
async function leerReservaViva(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  factura: Pick<Factura, 'viajeVigenteId'>,
): Promise<ViajeCargado | null> {
  const viajeId = factura.viajeVigenteId;
  if (!viajeId) return null;
  const documento = await tx.get(refViaje(base(ctx), viajeId));
  if (!documento.exists) return null;
  const datos = comoViaje((documento.data() ?? {}) as Record<string, unknown>);
  return reservaEstaViva(datos, ctx.now) ? { id: viajeId, datos } : null;
}

// La reserva convertida en lo que las acciones necesitan saber de ella. El
// `origen` viaja dentro porque `registrarRecogida` calcula los km del tramo
// DESPUES de las primeras escrituras, y Firestore prohibe leer despues de
// escribir: sin llevarlo aqui habria que volver a leer el viaje.
function comoReservaViva(cargado: ViajeCargado): ReservaViva {
  return {
    viajeId: cargado.id,
    uid: cargado.datos.uid,
    nombre: cargado.datos.transportista,
    origen: { lat: cargado.datos.paso1.lat, lng: cargado.datos.paso1.lng },
  };
}

// «La reserva es el permiso»: sin reserva viva no se puede avanzar el ciclo, y
// una reserva de otra persona tampoco sirve.
export async function exigirDuenoReserva(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  factura: Pick<Factura, 'viajeVigenteId'>,
  uid: string,
): Promise<ReservaViva> {
  const cargado = await leerReservaViva(tx, ctx, factura);
  if (!cargado) throw new ApiError(SIN_RESERVA, 403);
  if (!uid || cargado.datos.uid !== uid) throw new ApiError(AJENA, 403);
  return comoReservaViva(cargado);
}

// --- Escritura de pasos -------------------------------------------------------

function gpsDelPayload(valor: unknown): { lat: number | null; lng: number | null } {
  const gps = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  return geoValida({ lat: gps.lat, lng: gps.lng });
}

function kmEntrePuntos(
  origen: { lat: number | null; lng: number | null } | undefined,
  destino: { lat: number | null; lng: number | null },
): number | null {
  if (!origen || origen.lat === null || origen.lng === null) return null;
  if (destino.lat === null || destino.lng === null) return null;
  return kmEntre(origen.lat, origen.lng, destino.lat, destino.lng);
}

// Sella el paso 2 (recogida) y devuelve los km del primer tramo. La alerta del
// admin se recalcula aqui: a partir de ahora el reloj corre sobre el tramo 2.
export function sellarRecogida(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  reserva: ReservaViva,
  gps: { lat: number | null; lng: number | null },
): { km: number | null } {
  const km = kmEntrePuntos(reserva.origen, gps);
  const paso2: Paso = { ts: ctx.now, lat: gps.lat, lng: gps.lng };

  tx.set(refViaje(base(ctx), reserva.viajeId), {
    paso2,
    kmTramo1: km,
    venceAlerta: new Date(ctx.now.getTime() + ALERTA_TRAMO_MIN * MINUTO_MS),
    actualizado: ctx.now,
  }, { merge: true });

  return { km };
}

// --- Datos logisticos de la factura -------------------------------------------

type Logistica = {
  centro: string;
  insumo: string;
  tienda: string;
  direccion: string;
  cantidad: number;
  unidad: string;
};

// Un presupuesto y una oferta guardan su meta con formas distintas; el ciclo del
// transportista es el mismo para los dos y solo necesita estos seis datos.
export function logisticaDe(factura: Factura): Logistica {
  if (factura.tipo === 'oferta') {
    const meta = comoMetaOferta(factura.meta);
    return {
      centro: meta.centro,
      insumo: meta.insumo,
      // Una oferta no tiene tienda: el punto de recogida es la ZONA, nunca el
      // sitio exacto (§1.14), porque el movimiento que la nombra es publico.
      tienda: meta.zona,
      direccion: meta.zona,
      cantidad: meta.cantidad,
      unidad: meta.unidad,
    };
  }
  const meta = comoMetaPresupuesto(factura.meta);
  return {
    centro: meta.centro,
    insumo: meta.insumo,
    tienda: meta.tienda,
    direccion: meta.direccion,
    cantidad: meta.cantidad,
    unidad: meta.presentacion,
  };
}

function republicarVista(tx: TransaccionMinima, ctx: ContextoMinimo, cargada: FacturaCargada): void {
  if (cargada.factura.tipo === 'presupuesto') republicarPresupuesto(tx, ctx, cargada);
  else if (cargada.factura.tipo === 'oferta') republicarOferta(tx, ctx, cargada);
}

// --- Fotos --------------------------------------------------------------------

// Categoria propia: las fotos del ciclo retratan un local, un cargamento y a la
// persona que recibe en el centro. Cerrada como `offers` (ni el rol `panel`).
export function rutaDelCiclo(uid: string, valor: unknown): string {
  const ruta = s(valor, 300);
  return ruta && uid && ruta.startsWith(`private/${uid}/deliveries/`) ? ruta : '';
}

// --- Acciones: apoyo a transportistas -----------------------------------------

// Lee el transportista y devuelve su documento para actualizar los acumulados.
// Un id vacio es un registro anonimo (el legado guardaba `motorizado_id = null`).
async function leerMotorizado(
  tx: TransaccionMinima,
  db: FirestoreViajes,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const documento = await tx.get(db.collection(COLECCION_MOTORIZADOS).doc(id));
  // El legado tenia una clave foranea y dejaba escapar el error crudo `23503`
  // hasta la UI. Aqui es un 404 con un mensaje que se puede enseñar.
  if (!documento.exists) throw new ApiError('Transportista no encontrado', 404);
  return (documento.data() ?? {}) as Record<string, unknown>;
}

// Los cuatro acumulados de la tarjeta publica de un transportista. Se escriben
// como numeros ya calculados, no como incrementos atomicos: `publicar` filtra
// por allowlist y un centinela de Firestore no pasa por ese filtro.
function actualizarAcumulados(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  id: string,
  motorizado: Record<string, unknown>,
  delta: { trayectos?: number; km?: number; aporte?: number; ultimoTrayecto?: Date },
): void {
  const db = base(ctx);
  const totalTrayectos = Math.max(0, n(motorizado.totalTrayectos)) + (delta.trayectos ?? 0);
  const totalKm = Math.round((Math.max(0, n(motorizado.totalKm)) + (delta.km ?? 0)) * 10) / 10;
  const aporteDonado = Math.max(0, n(motorizado.aporteDonado)) + (delta.aporte ?? 0);
  const ultimoTrayecto = delta.ultimoTrayecto ?? comoFecha(motorizado.ultimoTrayecto);

  const acumulados = { totalTrayectos, totalKm, aporteDonado, ultimoTrayecto };

  tx.set(db.collection(COLECCION_MOTORIZADOS).doc(id), { ...acumulados, actualizado: ctx.now }, { merge: true });

  // `motorizadosPublicos` exige `createdAt` (se consulta ordenada por el), asi
  // que se republica el perfil entero con los acumulados encima.
  publicar(tx, ctx.db, PROYECCION_MOTORIZADOS, id, {
    ...documentoPublicoMotorizado({
      nombre: s(motorizado.nombre, 120),
      tipoVehiculo: s(motorizado.tipoVehiculo, 40) || 'Moto',
      zonaOperacion: s(motorizado.zonaOperacion, 120),
      telefono: s(motorizado.telefono, 40),
      activo: motorizado.activo !== false,
      createdAt: motorizado.createdAt,
    }),
    ...acumulados,
  });
}

defineAction({
  nombre: 'registrar_trayecto',
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const origen = s(payload.origen, 160);
    const destino = s(payload.destino, 160);
    if (!origen || !destino) throw new ApiError('origen y destino requeridos');

    const km = n(payload.km);
    // El legado no validaba el signo: `n()` acepta negativos y el total de un
    // transportista podia bajar registrando un trayecto de -500 km.
    if (km < 0 || km > MAX_KM) throw new ApiError('kilómetros inválidos');

    const idMotorizado = s(payload.idMotorizado, 40);
    const insumo = s(payload.insumo, 120) || 'Varios';
    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_TRAYECTO);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const motorizado = await leerMotorizado(tx, db, idMotorizado);

      const trayecto = {
        motorizadoId: idMotorizado,
        nombreMotorizado: s(payload.nombreMotorizado, 120) || s(motorizado?.nombre, 120),
        origen,
        destino,
        kmRecorridos: km,
        insumo,
        insumoTransportado: '',
        createdAt: ctx.now,
      };

      tx.set(db.collection(COLECCION_TRAYECTOS).doc(id), { ...trayecto });
      publicar(tx, ctxMin.db, PROYECCION_TRAYECTOS, id, trayecto);

      if (motorizado && idMotorizado) {
        actualizarAcumulados(tx, ctxMin, idMotorizado, motorizado, {
          trayectos: 1,
          km,
          ultimoTrayecto: ctx.now,
        });
      }

      return { id };
    });
  },
});

defineAction({
  nombre: 'donar_motorizado',
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const monto = n(payload.monto);
    // El legado no validaba nada: un aporte de -1000 restaba del acumulado
    // publico de un transportista y quedaba listado como donacion.
    if (monto <= 0 || monto > MAX_APORTE) throw new ApiError('monto inválido');

    const idMotorizado = s(payload.idMotorizado, 40);
    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_APORTE);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const motorizado = await leerMotorizado(tx, db, idMotorizado);

      const aporte = {
        motorizadoId: idMotorizado,
        nombreMotorizado: s(payload.nombreMotorizado, 120) || s(motorizado?.nombre, 120),
        monto,
        tipo: s(payload.tipo, 60),
        // El nombre de quien aporta es lo unico que se publica de esa persona, y
        // solo porque lo escribe ella misma en el formulario.
        donante: s(payload.donanteName ?? payload.donante, 120) || 'Anónimo',
        ciudad: s(payload.ciudad, 80),
        createdAt: ctx.now,
      };

      tx.set(db.collection(COLECCION_APORTES).doc(id), { ...aporte });
      publicar(tx, ctxMin.db, PROYECCION_APORTES, id, aporte);
      ajustarContadores(tx, ctxMin.db, { donacionesRegistradas: 1 });

      if (motorizado && idMotorizado) {
        actualizarAcumulados(tx, ctxMin, idMotorizado, motorizado, { aporte: monto });
      }

      return { id };
    });
  },
});

// --- Acciones: ciclo del transportista ----------------------------------------

// Estados desde los que se puede reservar. Una oferta `EnCamino` cuya reserva
// vencio SI se puede volver a reservar: en el legado quedaba bloqueada para
// siempre (`viaje_iniciar` exigia `Ofrecida` y `recoger_oferta` exigia reserva
// viva), y el propio catalogo señala el arreglo (§1.15).
function exigirEstadoReservable(factura: Factura): void {
  if (factura.tipo === 'presupuesto') {
    if (factura.estado !== 'Comprada') throw new ApiError('Este insumo no está listo para recoger', 409);
    return;
  }
  if (factura.tipo === 'oferta') {
    if (factura.estado !== 'Ofrecida' && factura.estado !== 'EnCamino') {
      throw new ApiError('Esta donación ya está en camino o fue recogida', 409);
    }
    return;
  }
  throw new ApiError('Presupuesto no encontrado', 404);
}

defineAction({
  nombre: 'viaje_iniciar',
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const eta = Math.round(n(payload.etaMinutos));
    if (eta < ETA_MIN || eta > ETA_MAX) throw new ApiError('Tiempo estimado inválido (5 a 480 minutos)');

    const gps = gpsDelPayload(payload.gps);
    if (gps.lat === null || gps.lng === null) {
      throw new ApiError('Se necesita tu ubicación GPS para iniciar el viaje');
    }

    const token = tokenNormalizado(payload.token);
    const uid = ctx.uid ?? '';
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada) throw new ApiError('Presupuesto no encontrado', 404);

      exigirEstadoReservable(cargada.factura);

      // El contacto de una oferta se lee ANTES de escribir nada: Firestore
      // rechaza leer despues de escribir dentro de una transaccion.
      const contacto = cargada.factura.tipo === 'oferta'
        ? await cargarContacto(tx, ctxMin, cargada.id)
        : null;

      const detalle = (): Record<string, unknown> => (contacto
        ? detallePrivado(cargada.factura, contacto)
        : { ...logisticaDe(cargada.factura), token, estado: cargada.factura.estado });

      const viva = await leerReservaViva(tx, ctxMin, cargada.factura);
      if (viva) {
        // Reserva propia: se responde sin escribir, igual que el legado, para
        // que recargar la pantalla del viaje no reinicie el reloj.
        if (viva.datos.uid === uid) {
          return {
            ok: true,
            yaReservado: true,
            viajeId: viva.id,
            etaMinutos: viva.datos.etaMinutos,
            detalle: detalle(),
          };
        }
        throw new ApiError(YA_RESERVADO, 409);
      }

      const previo = instantanea(cargada.factura);
      const nombre = s(payload.nombreTransportista, 120) || 'Transportista';
      const paso1: Paso = { ts: ctx.now, lat: gps.lat, lng: gps.lng };
      const viajeId = idEntidad(PREFIJO_VIAJE);

      const viaje: Viaje = {
        facturaId: cargada.id,
        facturaToken: cargada.factura.tokenPublico,
        numeroFactura: cargada.factura.numeroFactura,
        objetivo: cargada.factura.objetivo,
        uid,
        transportista: nombre,
        etaMinutos: eta,
        paso1,
        paso2: { ...PASO_VACIO },
        paso3: { ...PASO_VACIO },
        kmTramo1: null,
        kmTramo2: null,
        resuelto: false,
        abierto: true,
        venceReserva: calcularVenceReserva(paso1, eta),
        venceAlerta: calcularVenceAlerta({ paso1, paso2: { ...PASO_VACIO }, etaMinutos: eta }),
        createdAt: ctx.now,
        actualizado: ctx.now,
      };

      tx.set(refViaje(db, viajeId), { ...viaje });

      // Un solo viaje abierto por factura, y lo decide la propia factura dentro
      // de la transaccion: dos transportistas que reserven a la vez chocan en
      // este documento y Firestore reintenta al perdedor, que ya vera la
      // reserva del otro. El legado comprobaba y escribia sin atomicidad, y
      // «la fila mas reciente ganaba».
      cargada.factura.viajeVigenteId = viajeId;
      // `Ofrecida` pasa a `EnCamino`; re-reservar una `EnCamino` caducada no
      // cambia el estado, que ya es el correcto.
      if (cargada.factura.estado === 'Ofrecida') aplicarTransicion(cargada, ctxMin, 'reservarOferta');

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Viaje',
        descripcion: mov('viajeIniciado', { nombre, eta }),
        monto: 0,
      });

      guardarFactura(tx, ctxMin, cargada, previo);
      republicarVista(tx, ctxMin, cargada);

      const logistica = logisticaDe(cargada.factura);
      historial(tx, ctxMin, {
        lugarNombre: logistica.centro || 'Donaciones ofrecidas',
        insumo: logistica.insumo,
        descripcion: `Transportista ${nombre} va en camino a recoger el insumo (llega en ~${eta} min)`,
        origen: 'publico',
        tipo: 'Viaje',
      });

      return { ok: true, viajeId, etaMinutos: eta, detalle: detalle() };
    });
  },
});

defineAction({
  nombre: 'registrar_recogida',
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const uid = ctx.uid ?? '';
    const fotoSitio = rutaDelCiclo(uid, payload.fotoSitioPath ?? payload.fotoSitio);
    const fotoInsumo = rutaDelCiclo(uid, payload.fotoInsumoPath ?? payload.fotoInsumo);
    if (!fotoSitio || !fotoInsumo) {
      throw new ApiError('Faltan fotos: sitio de recogida e insumo son obligatorias');
    }

    const token = tokenNormalizado(payload.token);
    const notas = s(payload.notas, 300);
    const gps = gpsDelPayload(payload.gps);
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      // Solo presupuestos: una oferta se recoge con `recoger_oferta`, que ademas
      // elige el centro de destino.
      if (!cargada || cargada.factura.tipo !== 'presupuesto') {
        throw new ApiError('Presupuesto no encontrado', 404);
      }

      const previo = instantanea(cargada.factura);
      const logistica = logisticaDe(cargada.factura);

      // Orden del catalogo: estado, dueño de la reserva, y despues los efectos.
      aplicarTransicion(cargada, ctxMin, 'recogerCompra', 'Este insumo no está listo para recoger');
      const reserva = await exigirDuenoReserva(tx, ctxMin, cargada.factura, uid);

      const evidencias: Array<[string, string]> = [
        [fotoSitio, `Foto del sitio de recogida (${logistica.tienda})`],
        [fotoInsumo, 'Foto del insumo comprado'],
      ];
      const fotoPersona = rutaDelCiclo(uid, payload.fotoPersonaPath ?? payload.fotoPersona);
      if (fotoPersona) evidencias.push([fotoPersona, 'Foto de quien entrega el insumo']);

      for (const [archivoPath, descripcion] of evidencias) {
        // Privadas: retratan un local y a personas concretas. No salen por el
        // seguimiento publico; solo el admin y quien las subio.
        agregarEvidencia(tx, ctxMin, cargada, { archivoPath, descripcion, publica: false });
      }

      const { km } = sellarRecogida(tx, ctxMin, reserva, gps);
      const nombre = s(payload.nombreTransportista, 120) || reserva.nombre;

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Recogida',
        descripcion: mov(notas ? 'insumoRecogidoConNota' : 'insumoRecogido', {
          nombre,
          tienda: logistica.tienda,
          direccion: logistica.direccion,
          notas,
          ...(km === null ? {} : { km }),
        }),
        monto: 0,
      });

      guardarFactura(tx, ctxMin, cargada, previo);
      republicarVista(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarNombre: logistica.centro || 'Administración',
        insumo: logistica.insumo,
        descripcion: `Transportista ${nombre} recogió el insumo comprado en ${logistica.tienda}`,
        origen: 'publico',
        tipo: 'Recogida',
      });

      return { estado: cargada.factura.estado, km };
    });
  },
});

defineAction({
  nombre: 'registrar_entrega_final',
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const receptor = s(payload.nombreReceptor, 120);
    if (!receptor) throw new ApiError('nombre de quien recibe requerido');

    const uid = ctx.uid ?? '';
    // `fotoEntrega` es el nombre antiguo del mismo campo.
    const fotoCentro = rutaDelCiclo(
      uid,
      payload.fotoCentroPath ?? payload.fotoCentro ?? payload.fotoEntregaPath ?? payload.fotoEntrega,
    );
    if (!fotoCentro) throw new ApiError('Falta la foto de la entrega en el centro');

    const token = tokenNormalizado(payload.token);
    const cargo = s(payload.cargoReceptor, 80);
    const gps = gpsDelPayload(payload.gps);
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada || (cargada.factura.tipo !== 'presupuesto' && cargada.factura.tipo !== 'oferta')) {
        throw new ApiError('Presupuesto no encontrado', 404);
      }

      const previo = instantanea(cargada.factura);
      const logistica = logisticaDe(cargada.factura);
      const esOferta = cargada.factura.tipo === 'oferta';

      if (esOferta) {
        aplicarTransicion(cargada, ctxMin, 'entregarOferta', 'Esta donación no está lista para entregar');
      } else {
        aplicarTransicion(cargada, ctxMin, 'entregarCompra', 'Este insumo no está en tránsito');
      }

      const reserva = await exigirDuenoReserva(tx, ctxMin, cargada.factura, uid);
      // Se lee entero porque hacen falta `paso2` y `kmTramo1` para el total, y la
      // reserva solo lleva el origen del tramo en curso.
      const documento = await tx.get(refViaje(db, reserva.viajeId));
      const viaje = comoViaje((documento.data() ?? {}) as Record<string, unknown>);

      const evidencias: Array<[string, string]> = [
        [fotoCentro, `Foto de la entrega en ${logistica.centro}`],
      ];
      const fotoEncargado = rutaDelCiclo(uid, payload.fotoEncargadoPath ?? payload.fotoEncargado);
      if (fotoEncargado) evidencias.push([fotoEncargado, `Foto de quien recibe en ${logistica.centro}`]);

      for (const [archivoPath, descripcion] of evidencias) {
        agregarEvidencia(tx, ctxMin, cargada, { archivoPath, descripcion, publica: false });
      }

      const kmTramo2 = kmEntrePuntos(viaje.paso2, gps);
      const km = kmTramo2 === null && viaje.kmTramo1 === null
        ? null
        : Math.round(((viaje.kmTramo1 ?? 0) + (kmTramo2 ?? 0)) * 10) / 10;

      // El viaje se cierra SIEMPRE, con GPS o sin el. En el legado, entregar sin
      // GPS dejaba `paso3_ts` nulo y el viaje seguia saliendo en la alerta de
      // atrasados aunque la factura ya estuviera `Entregada`.
      tx.set(refViaje(db, reserva.viajeId), {
        paso3: { ts: ctx.now, lat: gps.lat, lng: gps.lng },
        kmTramo2,
        abierto: false,
        venceAlerta: null,
        actualizado: ctx.now,
      }, { merge: true });

      cargada.factura.viajeVigenteId = null;

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Entrega',
        descripcion: mov(cargo ? 'entregadoConCargo' : 'entregado', {
          centro: logistica.centro,
          receptor,
          cargo,
          ...(km === null ? {} : { km }),
        }),
        monto: 0,
      });

      guardarFactura(tx, ctxMin, cargada, previo);
      republicarVista(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarNombre: logistica.centro || 'Administración',
        insumo: logistica.insumo,
        descripcion: `${esOferta ? 'Donación ofrecida entregada' : 'Insumo comprado entregado'} en el centro. Recibió ${receptor}`,
        origen: 'publico',
        tipo: 'Entrega',
      });

      return { estado: cargada.factura.estado, km };
    });
  },
});

// --- Acciones del admin -------------------------------------------------------

defineAction({
  nombre: 'admin_viajes_atrasados',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // La vista `viajes_atrasados` del legado recorria la tabla entera aplicando
    // aritmetica de fechas en cada lectura. `venceAlerta` la deja resuelta con
    // una consulta de dos campos, y `abierto` mantiene fuera todo lo cerrado o
    // resuelto (en Firestore `null` ordena antes que cualquier fecha, asi que
    // sin ese filtro los viajes terminados saldrian como los mas atrasados).
    const { docs } = await firestore(ctx).collection(COLECCION_VIAJES)
      .where('abierto', '==', true)
      .where('venceAlerta', '<=', ctx.now)
      .orderBy('venceAlerta', 'asc')
      .limit(TOPE_ATRASADOS)
      .get();

    return {
      viajes: docs.map((documento) => {
        const viaje = comoViaje((documento.data() ?? {}) as Record<string, unknown>);
        const desde = viaje.paso2.ts ?? viaje.paso1.ts;
        const transcurrido = desde ? Math.floor((ctx.now.getTime() - desde.getTime()) / MINUTO_MS) : 0;
        // Claves snake_case: son las que lee `js/admin.js:143-155`.
        return {
          id: documento.id,
          transportista: viaje.transportista,
          // Sin `email`: la identidad de la reserva es el uid, y el correo que el
          // legado guardaba venia del cuerpo de la peticion, sin verificar. Para
          // localizar al transportista esta `contactar_motorizado`.
          uid: viaje.uid,
          eta_minutos: viaje.etaMinutos,
          token_publico: viaje.facturaToken,
          objetivo: viaje.objetivo,
          tramo: tramoDe(viaje),
          transcurrido_min: Math.max(0, transcurrido),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'admin_viaje_resolver',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const documento = await tx.get(refViaje(db, id));
      if (!documento.exists) throw new ApiError('Viaje no encontrado', 404);

      const viaje = comoViaje((documento.data() ?? {}) as Record<string, unknown>);
      const factura = viaje.facturaId
        ? await tx.get((db as unknown as FirestoreFacturas).collection('facturas').doc(viaje.facturaId))
        : null;

      tx.set(refViaje(db, id), {
        resuelto: true,
        abierto: false,
        venceAlerta: null,
        actualizado: ctx.now,
      }, { merge: true });

      // Libera el trabajo tambien en la factura. Con `resuelto` bastaria para que
      // la reserva deje de valer, pero dejar el puntero colgando obligaria a leer
      // el viaje resuelto en cada intento de reservar.
      const datosFactura = (factura?.data() ?? {}) as Record<string, unknown>;
      if (factura?.exists && s(datosFactura.viajeVigenteId, 80) === id) {
        tx.set((db as unknown as FirestoreFacturas).collection('facturas').doc(viaje.facturaId), {
          viajeVigenteId: null,
          actualizado: ctx.now,
        }, { merge: true });
      }

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION_VIAJES,
        entidadId: id,
        antes: { resuelto: viaje.resuelto, abierto: viaje.abierto },
        despues: { resuelto: true, abierto: false },
      });

      // No cambia el estado de la factura (contrato §1.7): el trabajo vuelve a
      // estar libre, pero lo que ya se compro sigue comprado.
      return { resuelto: true };
    });
  },
});

// --- Costura de la Task 3.4 ---------------------------------------------------

// `reserva_detalle` y `recoger_oferta` viven en `ofertas.ts` y dependen de la
// reserva; la Task 3.4 dejo el enganche preparado y aqui se rellena. Es el mismo
// patron que `conectarRegistroDeEntregas` (Task 3.1): el dominio de arriba no
// importa al de abajo, asi que no hay ciclo.
conectarReservaDeViaje({
  async exigirDueno(tx, ctx, facturaId, uid) {
    const documento = await tx.get((base(ctx) as unknown as FirestoreFacturas).collection('facturas').doc(facturaId));
    const factura = (documento.data() ?? {}) as Record<string, unknown>;
    const viajeVigenteId = factura.viajeVigenteId ? s(factura.viajeVigenteId, 80) : null;
    return exigirDuenoReserva(tx, ctx, { viajeVigenteId }, uid);
  },
  async registrarRecogida(tx, ctx, reserva, gps) {
    return sellarRecogida(tx, ctx, reserva, gps);
  },
});

// --- Fuentes del reconciliador -------------------------------------------------

registrarFuente({
  coleccion: COLECCION_TRAYECTOS,
  proyeccion: PROYECCION_TRAYECTOS,
  mapear: ({ datos }) => ({
    motorizadoId: s(datos.motorizadoId, 40),
    nombreMotorizado: s(datos.nombreMotorizado, 120),
    origen: s(datos.origen, 160),
    destino: s(datos.destino, 160),
    kmRecorridos: n(datos.kmRecorridos),
    insumo: s(datos.insumo, 120),
    insumoTransportado: s(datos.insumoTransportado, 200),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  }),
});

registrarFuente({
  coleccion: COLECCION_APORTES,
  proyeccion: PROYECCION_APORTES,
  mapear: ({ datos }) => ({
    motorizadoId: s(datos.motorizadoId, 40),
    nombreMotorizado: s(datos.nombreMotorizado, 120),
    monto: n(datos.monto),
    tipo: s(datos.tipo, 60),
    donante: s(datos.donante, 120) || 'Anónimo',
    ciudad: s(datos.ciudad, 80),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  }),
  contadores: () => ({ donacionesRegistradas: 1 }),
});

// `viajes` NO se declara como fuente: no tiene proyeccion publica (lleva el GPS
// exacto de una persona y de un local) y no alimenta ningun contador del
// tablero. Declararla seria abrir la puerta a que algun dia alguien le ponga un
// `mapear`.

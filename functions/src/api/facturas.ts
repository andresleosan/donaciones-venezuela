import {
  ApiError,
  ESTADOS_DONACION,
  ESTADOS_FACTURA,
  idEntidad,
  mov,
  n,
  normalizar,
  objetivoNecesidad,
  opcion,
  s,
  tokenAlfa,
} from './contract.js';
import type { ActionContext, ActionPayload, ActionResult, EstadoFactura } from './contract.js';
import { auditar, claveIndice, historial, referenciaIndice, siguienteNumeroFactura } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, NombreIndice, TransaccionMinima } from './db.js';
import { ajustarContadores } from './estadisticas.js';
import type { Deltas } from './estadisticas.js';
import { publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { normalizarTasa } from './tasas.js';
import type { Tasa } from './tasas.js';
import { conectarRegistroDeEntregas, claveInsumo, leerInsumo, leerLugar, lugarIdPorNombre } from './lugares.js';
import type { FirestoreLugares } from './lugares.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: facturas. El hilo publico de trazabilidad de cada operacion.
//
// Modelo (plan 2026-09-06, Task 3.4):
//   facturas/{facturaId}                          canonico, privado
//   facturas/{facturaId}/donaciones/{DON-…}        quien aporto y cuanto
//   facturas/{facturaId}/movimientos/{MOV-…}       bitacora publica de la factura
//   facturas/{facturaId}/evidencias/{EVI-…}        archivos y enlaces
//   facturasContacto/{facturaId}                   contacto de una oferta (Task 3.4, ofertas.ts)
//   facturasPublicas/{tokenPublico}                proyeccion publica por token
//   indices/facturasPorToken/claves/{token}        token -> facturaId
//   indices/facturasAbiertasPorObjetivo/claves/{…} objetivo -> factura Abierta
//
// Dos ids a proposito. El `facturaId` (`FCT-XXXXXXXX`) es la identidad interna y
// no cambia nunca; el `tokenPublico` (`DV-…`) es una CAPACIDAD: quien lo tiene
// lee la factura entera sin identificarse. Separarlos deja rotar un token
// filtrado (un cartel fotografiado, un token pegado en un grupo) sin mover
// documentos ni romper las referencias de los viajes (Task 3.5).
//
// El sabor de la factura ya no se deduce parseando `descripcion` (asi lo hacia
// el legado, con `like '{"k":"pres"%'` en las listas publicas): es la columna
// `tipo`. Los campos del catalogo siguen existiendo, agrupados en `meta`.
//
// FUGA DEL LEGADO QUE AQUI NO SE REPITE: `seguimiento_factura` devolvia la
// `descripcion` integra, asi que con el token de una oferta cualquiera veia el
// telefono, el nombre y las coordenadas exactas del donante (contrato §1.14).
// Aqui la proyeccion publica se construye campo a campo con `descripcionPublica`
// y el contacto vive en OTRA coleccion, `facturasContacto`, que ninguna funcion
// de proyeccion sabe leer.

export const PREFIJO_FACTURA = 'FCT';
export const PREFIJO_DONACION = 'DON';
export const PREFIJO_MOVIMIENTO = 'MOV';
export const PREFIJO_EVIDENCIA = 'EVI';

export const COLECCION = 'facturas';
export const COLECCION_CONTACTO = 'facturasContacto';
export const SUB_DONACIONES = 'donaciones';
export const SUB_MOVIMIENTOS = 'movimientos';
export const SUB_EVIDENCIAS = 'evidencias';
export const PROYECCION = 'facturasPublicas';
export const INDICE_TOKEN: NombreIndice = 'facturasPorToken';
export const INDICE_OBJETIVO: NombreIndice = 'facturasAbiertasPorObjetivo';

// Topes del documento publico. Firestore corta en 1 MiB por documento y el
// legado ya limitaba el desglose a 200 donaciones; una factura muy movida no
// puede dejar la pantalla de seguimiento sin poder leerse.
export const TOPE_MOVIMIENTOS_PUBLICOS = 200;
export const TOPE_DONACIONES_PUBLICAS = 200;
export const TOPE_EVIDENCIAS_PUBLICAS = 100;

export const TOPE_FACTURAS_ADMIN = 100;

export const TIPOS_FACTURA = ['dinero', 'especie', 'oferta', 'presupuesto'] as const;
export type TipoFactura = typeof TIPOS_FACTURA[number];

// `unidades` no es una moneda: es lo que mide una necesidad (12 colchonetas) o
// una oferta. Tenerla explicita evita sumar bolivares con colchonetas en el
// tablero, que es lo que hacia el legado.
export const MONEDAS = ['VES', 'USD', 'unidades'] as const;
export type Moneda = typeof MONEDAS[number];

export const TIPOS_MOVIMIENTO = [
  'Ingreso', 'Egreso', 'Compra', 'Entrega', 'Recaudado', 'Viaje', 'Recogida',
  'Oferta', 'Denuncia', 'Reapertura', 'Transferencia',
] as const;
export type TipoMovimiento = typeof TIPOS_MOVIMIENTO[number];

// Los cuatro que admite `admin_registrar_movimiento` (contrato §admin_registrar_movimiento).
export const TIPOS_MOVIMIENTO_ADMIN = ['Ingreso', 'Egreso', 'Compra', 'Entrega'] as const;

export const MAX_MONTO_USD = 100_000;
export const MAX_CANTIDAD = 1_000_000;

// --- Maquina de estados (contrato §1.15) -------------------------------------

export type Transicion = {
  desde: readonly EstadoFactura[] | null;
  hacia: EstadoFactura;
  // Estado terminal: fija `fechaCierre`.
  cierra?: boolean;
  // Mensaje publico cuando el estado previo no encaja. Son los del legado.
  error: string;
};

export const TRANSICIONES = {
  // `donar_dinero` cubre la meta del presupuesto.
  metaCubierta: { desde: ['Abierta'], hacia: 'PorComprar', error: 'Este presupuesto ya está financiado' },
  transferir: { desde: ['PorComprar'], hacia: 'Transferida', error: 'El presupuesto no está en espera de compra' },
  comprar: { desde: ['PorComprar', 'Transferida'], hacia: 'Comprada', error: 'El presupuesto no está listo para comprar' },
  // Anular una donacion que hacia caer el recaudado por debajo de la meta.
  reabrir: { desde: ['PorComprar', 'Transferida'], hacia: 'Abierta', error: 'El presupuesto no se puede reabrir' },
  // Ciclo del transportista sobre un presupuesto (Task 3.5).
  recogerCompra: { desde: ['Comprada'], hacia: 'EnTransito', error: 'Este presupuesto no está listo para recoger' },
  entregarCompra: { desde: ['EnTransito'], hacia: 'Entregada', cierra: true, error: 'Este presupuesto no está en tránsito' },
  // Ciclo de una oferta.
  reservarOferta: { desde: ['Ofrecida'], hacia: 'EnCamino', error: 'Esta donación ya fue reservada' },
  recogerOferta: { desde: ['Ofrecida', 'EnCamino'], hacia: 'Recogida', error: 'Esta donación ya fue recogida' },
  entregarOferta: { desde: ['Recogida'], hacia: 'Entregada', cierra: true, error: 'Esta donación todavía no se ha recogido' },
  // El centro confirma que recibio lo que necesitaba.
  cubrirNecesidad: { desde: ['Abierta'], hacia: 'Cerrada', cierra: true, error: 'Esta necesidad ya no está abierta' },
  // La unica sin comprobacion de estado, igual que en el legado.
  cerrarAdmin: { desde: null, hacia: 'Cerrada', cierra: true, error: 'La factura no se puede cerrar' },
} as const satisfies Record<string, Transicion>;

export type NombreTransicion = keyof typeof TRANSICIONES;

export function puedeTransitar(estado: EstadoFactura, nombre: NombreTransicion): boolean {
  const transicion: Transicion = TRANSICIONES[nombre];
  return transicion.desde === null || transicion.desde.includes(estado);
}

// Devuelve el estado destino o lanza el error publico del legado. `mensaje`
// permite a una accion concreta afinar el texto sin duplicar la tabla.
export function transitar(
  estado: EstadoFactura,
  nombre: NombreTransicion,
  mensaje?: string,
): { estado: EstadoFactura; cierra: boolean } {
  const transicion: Transicion = TRANSICIONES[nombre];
  if (!puedeTransitar(estado, nombre)) throw new ApiError(mensaje ?? transicion.error, 409);
  return { estado: transicion.hacia, cierra: transicion.cierra === true };
}

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type ConsultaSnapshot = { docs: Snapshot[] };
type Referencia = { path?: string; id?: string };

type Consulta = {
  where(campo: string, operador: string, valor: unknown): Consulta;
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<ConsultaSnapshot>;
};

type Subcoleccion = Consulta & { doc(id?: string): Referencia };
type DocumentoFactura = Referencia & { collection(nombre: string): Subcoleccion };
type ColeccionFacturas = Consulta & { doc(id?: string): DocumentoFactura };

export type FirestoreFacturas = {
  collection(nombre: string): ColeccionFacturas;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

// Misma costura que en `lugares.ts`: la `Transaction` real sobrecarga `get` para
// documentos y para consultas, y `TransaccionMinima` solo declara la primera.
async function leerSubcoleccion(tx: TransaccionMinima, sub: Subcoleccion): Promise<ConsultaSnapshot> {
  const consulta = tx as unknown as { get(referencia: Subcoleccion): Promise<ConsultaSnapshot> };
  return consulta.get(sub);
}

function firestore(ctx: ActionContext): FirestoreFacturas {
  return ctx.db as unknown as FirestoreFacturas;
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

function datosDe(snapshot: { data(): unknown }): Record<string, unknown> {
  return (snapshot.data() ?? {}) as Record<string, unknown>;
}

// --- Lectura de campos --------------------------------------------------------

type ConFecha = { toDate(): Date };

function esFecha(valor: unknown): valor is ConFecha {
  return Boolean(valor) && typeof (valor as ConFecha).toDate === 'function';
}

// Firestore devuelve `Timestamp`, no `Date`: sin esto toda fecha releida
// volveria como epoch y el seguimiento diria «creada en 1970».
export function comoFecha(valor: unknown): Date | null {
  if (valor instanceof Date) return valor;
  if (esFecha(valor)) return valor.toDate();
  if (typeof valor === 'string' || typeof valor === 'number') {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  return null;
}

function iso(valor: unknown): string {
  return comoFecha(valor)?.toISOString() ?? '';
}

// --- Modelo -------------------------------------------------------------------

export type Factura = {
  numeroFactura: string;
  tokenPublico: string;
  tipo: TipoFactura;
  moneda: Moneda;
  objetivo: string;
  objetivoNorm: string;
  descripcion: string;
  meta: Record<string, unknown> | null;
  montoRequerido: number;
  montoRecaudado: number;
  estado: EstadoFactura;
  viajeVigenteId: string | null;
  numDonaciones: number;
  numMovimientos: number;
  numEvidencias: number;
  createdAt: Date;
  actualizado: Date;
  fechaCierre: Date | null;
};

export type Donacion = {
  nombreDonante: string;
  monto: number;
  montoUsd: number | null;
  tasa: number | null;
  comprobantePath: string;
  referenciaPago: string;
  estado: 'Registrada' | 'Confirmada' | 'Anulada';
  secuencia: number;
  createdAt: Date;
};

export type Movimiento = {
  tipo: TipoMovimiento;
  descripcion: string;
  monto: number;
  secuencia: number;
  createdAt: Date;
};

export type Evidencia = {
  archivo: string;
  archivoPath: string;
  descripcion: string;
  publica: boolean;
  secuencia: number;
  createdAt: Date;
};

export type FacturaCargada = {
  id: string;
  factura: Factura;
  donaciones: Array<{ id: string; datos: Donacion }>;
  movimientos: Array<{ id: string; datos: Movimiento }>;
  evidencias: Array<{ id: string; datos: Evidencia }>;
};

export function tipoFactura(valor: unknown): TipoFactura {
  return opcion(valor, TIPOS_FACTURA, 'dinero');
}

export function monedaFactura(valor: unknown): Moneda {
  return opcion(valor, MONEDAS, 'VES');
}

export function estadoFactura(valor: unknown): EstadoFactura {
  return opcion(valor, ESTADOS_FACTURA, 'Abierta');
}

function metaDe(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

export function comoFactura(datos: Record<string, unknown>): Factura {
  const objetivo = s(datos.objetivo, 200);
  return {
    numeroFactura: s(datos.numeroFactura, 40),
    tokenPublico: s(datos.tokenPublico, 40),
    tipo: tipoFactura(datos.tipo),
    moneda: monedaFactura(datos.moneda),
    objetivo,
    objetivoNorm: s(datos.objetivoNorm, 200) || normalizar(objetivo),
    descripcion: s(datos.descripcion, 500),
    meta: metaDe(datos.meta),
    montoRequerido: n(datos.montoRequerido),
    montoRecaudado: n(datos.montoRecaudado),
    estado: estadoFactura(datos.estado),
    viajeVigenteId: datos.viajeVigenteId ? s(datos.viajeVigenteId, 80) : null,
    numDonaciones: Math.max(0, n(datos.numDonaciones)),
    numMovimientos: Math.max(0, n(datos.numMovimientos)),
    numEvidencias: Math.max(0, n(datos.numEvidencias)),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? comoFecha(datos.createdAt) ?? new Date(0),
    fechaCierre: comoFecha(datos.fechaCierre),
  };
}

export function comoDonacion(datos: Record<string, unknown>): Donacion {
  const montoUsd = datos.montoUsd === null || datos.montoUsd === undefined || datos.montoUsd === ''
    ? null
    : n(datos.montoUsd);
  const tasa = datos.tasa === null || datos.tasa === undefined || datos.tasa === ''
    ? null
    : n(datos.tasa);
  return {
    nombreDonante: s(datos.nombreDonante, 120) || 'Anónimo',
    monto: n(datos.monto),
    montoUsd,
    tasa,
    comprobantePath: s(datos.comprobantePath, 300),
    referenciaPago: s(datos.referenciaPago, 80),
    estado: opcion(datos.estado, ESTADOS_DONACION, 'Registrada'),
    secuencia: n(datos.secuencia),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  };
}

export function comoMovimiento(datos: Record<string, unknown>): Movimiento {
  return {
    tipo: opcion(datos.tipo, TIPOS_MOVIMIENTO, 'Ingreso'),
    descripcion: s(datos.descripcion, 300),
    monto: n(datos.monto),
    secuencia: n(datos.secuencia),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  };
}

export function comoEvidencia(datos: Record<string, unknown>): Evidencia {
  return {
    archivo: s(datos.archivo, 400),
    archivoPath: s(datos.archivoPath, 300),
    descripcion: s(datos.descripcion, 300),
    publica: datos.publica === true,
    secuencia: n(datos.secuencia),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  };
}

// --- Referencias --------------------------------------------------------------

export function refFactura(db: FirestoreFacturas, facturaId: string): DocumentoFactura {
  return db.collection(COLECCION).doc(facturaId);
}

function refSub(db: FirestoreFacturas, facturaId: string, sub: string): Subcoleccion {
  return refFactura(db, facturaId).collection(sub);
}

// --- Indices ------------------------------------------------------------------

// El token viaja en mayusculas por todas las pantallas; la clave del indice se
// normaliza igual que las demas (`claveIndice` baja a minusculas), asi que un
// token tecleado en minusculas SI encuentra su factura. El legado no: comparaba
// `token_publico` literal y un token en minusculas daba «no encontrada».
export function tokenNormalizado(valor: unknown): string {
  return s(valor, 24).toUpperCase();
}

async function leerIndice(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  indice: NombreIndice,
  claveCruda: unknown,
): Promise<string | null> {
  const clave = normalizar(claveCruda).replace(/\//g, '-').slice(0, 200);
  if (!clave) return null;
  const snapshot = await tx.get(referenciaIndice(ctx.db, indice, clave));
  if (!snapshot.exists) return null;
  const valor = (snapshot.data() as { valor?: unknown } | undefined)?.valor;
  return valor ? String(valor) : null;
}

function fijarIndice(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  indice: NombreIndice,
  claveCruda: unknown,
  valor: string,
): void {
  tx.set(referenciaIndice(ctx.db, indice, claveIndice(indice, claveCruda)), { valor, createdAt: ctx.now });
}

function soltarIndice(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  indice: NombreIndice,
  claveCruda: unknown,
): void {
  const clave = normalizar(claveCruda).replace(/\//g, '-').slice(0, 200);
  if (!clave) return;
  tx.delete(referenciaIndice(ctx.db, indice, clave));
}

// --- Carga --------------------------------------------------------------------

export async function cargarFactura(
  tx: TransaccionMinima,
  db: FirestoreFacturas,
  facturaId: string,
): Promise<FacturaCargada | null> {
  const snapshot = await tx.get(refFactura(db, facturaId));
  if (!snapshot.exists) return null;

  const donaciones = await leerSubcoleccion(tx, refSub(db, facturaId, SUB_DONACIONES));
  const movimientos = await leerSubcoleccion(tx, refSub(db, facturaId, SUB_MOVIMIENTOS));
  const evidencias = await leerSubcoleccion(tx, refSub(db, facturaId, SUB_EVIDENCIAS));

  const porSecuencia = <T extends { secuencia: number }>(
    a: { datos: T },
    b: { datos: T },
  ) => a.datos.secuencia - b.datos.secuencia;

  return {
    id: facturaId,
    factura: comoFactura(datosDe(snapshot)),
    donaciones: donaciones.docs
      .map((doc) => ({ id: doc.id, datos: comoDonacion(doc.data() ?? {}) }))
      .sort(porSecuencia),
    movimientos: movimientos.docs
      .map((doc) => ({ id: doc.id, datos: comoMovimiento(doc.data() ?? {}) }))
      .sort(porSecuencia),
    evidencias: evidencias.docs
      .map((doc) => ({ id: doc.id, datos: comoEvidencia(doc.data() ?? {}) }))
      .sort(porSecuencia),
  };
}

// Resuelve el token publico a su factura. Devuelve `null` si el token no existe.
export async function cargarFacturaPorToken(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  token: string,
): Promise<FacturaCargada | null> {
  const facturaId = await leerIndice(tx, ctx, INDICE_TOKEN, token);
  if (!facturaId) return null;
  return cargarFactura(tx, ctx.db as unknown as FirestoreFacturas, facturaId);
}

// --- Proyeccion publica -------------------------------------------------------

// La descripcion que ve cualquiera con el token. Para un presupuesto es el JSON
// `{k:'pres'}` que la UI sabe redactar (contrato de datos §6.3) SIN
// `necesidadId`, `tiendaLat/Lng` ni `tiendaUrl`; para una oferta, el JSON
// `{k:'oferta'}` SIN telefono, sin nombre del donante, sin coordenadas y con la
// ZONA en lugar del nombre de referencia del sitio. Todo lo demas es texto
// libre y sale tal cual.
export function descripcionPublica(factura: Factura): string {
  const meta = factura.meta ?? {};
  if (factura.tipo === 'presupuesto') {
    return JSON.stringify({
      k: 'pres',
      moneda: factura.moneda,
      centro: s(meta.centro, 120),
      insumo: s(meta.insumo, 120),
      tienda: s(meta.tienda, 100),
      direccion: s(meta.direccion, 160),
      cantidad: n(meta.cantidad),
      presentacion: s(meta.presentacion, 140),
      adjunto: s(meta.adjunto, 400),
    });
  }
  if (factura.tipo === 'oferta') {
    return JSON.stringify({
      k: 'oferta',
      insumo: s(meta.insumo, 120),
      cantidad: n(meta.cantidad),
      unidad: s(meta.unidad, 30) || 'unidades',
      // La `ubicacion` del legado era el nombre de referencia del sitio, que
      // señala la casa del donante. Publica es la zona; el sitio exacto se
      // entrega solo a quien reserva la recogida (`reserva_detalle`).
      ubicacion: s(meta.zona, 80),
      centro: s(meta.centro, 120),
    });
  }
  return factura.descripcion;
}

export function porcentajeFactura(factura: { montoRequerido: number; montoRecaudado: number }): number {
  if (!(factura.montoRequerido > 0)) return 0;
  const bruto = Math.round((100 * factura.montoRecaudado) / factura.montoRequerido);
  return Math.max(0, Math.min(100, bruto));
}

export function documentoPublico(cargada: FacturaCargada): Record<string, unknown> {
  const { factura } = cargada;
  const porcentaje = porcentajeFactura(factura);

  return {
    factura: {
      numero_factura: factura.numeroFactura,
      token_publico: factura.tokenPublico,
      objetivo: factura.objetivo,
      descripcion: descripcionPublica(factura),
      estado: factura.estado,
      moneda: factura.moneda,
      monto_requerido: factura.montoRequerido,
      monto_recaudado: factura.montoRecaudado,
      porcentaje,
      porcentaje_completado: porcentaje,
      fecha_creacion: factura.createdAt.toISOString(),
      fecha_cierre: factura.fechaCierre ? factura.fechaCierre.toISOString() : '',
    },
    movimientos: cargada.movimientos.slice(-TOPE_MOVIMIENTOS_PUBLICOS).map(({ datos }) => ({
      tipo: datos.tipo,
      monto: datos.monto,
      descripcion: datos.descripcion,
      fecha: datos.createdAt.toISOString(),
    })),
    evidencias: cargada.evidencias
      .filter(({ datos }) => datos.publica)
      .slice(-TOPE_EVIDENCIAS_PUBLICAS)
      .map(({ datos }) => ({
        // Solo una URL https se publica como enlace. Un archivo privado de
        // Storage se anuncia por su descripcion: la ruta no sirve sin firmar y
        // publicarla solo diria a quien pertenece.
        archivo: /^https:\/\//.test(datos.archivo) ? datos.archivo : '',
        descripcion: datos.descripcion,
        fecha: datos.createdAt.toISOString(),
      })),
    // Desglose anonimo: monto y fecha, nunca el nombre, la referencia ni el
    // comprobante. Solo cuentan las confirmadas, igual que el recaudado.
    donacionesPublicas: cargada.donaciones
      .filter(({ datos }) => datos.estado === 'Confirmada')
      .slice(-TOPE_DONACIONES_PUBLICAS)
      .map(({ datos }) => ({
        monto_usd: datos.montoUsd,
        monto: datos.monto,
        tasa: datos.tasa,
        creado: datos.createdAt.toISOString(),
      }))
      .reverse(),
    numero: factura.numeroFactura,
    tokenPublico: factura.tokenPublico,
    estado: factura.estado,
    moneda: factura.moneda,
    montoObjetivo: factura.montoRequerido,
    recaudado: factura.montoRecaudado,
    createdAt: factura.createdAt,
  };
}

export function republicarFactura(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  cargada: FacturaCargada,
): void {
  publicar(tx, ctx.db, PROYECCION, cargada.factura.tokenPublico, documentoPublico(cargada));
}

// --- Contadores del tablero ---------------------------------------------------

// `facturasAbiertas` cuenta literalmente el estado `Abierta`: es lo que nombra,
// y es el mismo criterio del indice `facturasAbiertasPorObjetivo`.
export function esAbierta(estado: EstadoFactura): boolean {
  return estado === 'Abierta';
}

// Una necesidad se mide en colchonetas y un presupuesto en bolivares: sumarlos
// da un numero sin significado. El total solo agrega el dinero.
export function cuentaEnDinero(factura: { moneda: Moneda }): boolean {
  return factura.moneda !== 'unidades';
}

export function deltaEstado(anterior: EstadoFactura | null, nuevo: EstadoFactura | null): Deltas {
  const antes = anterior !== null && esAbierta(anterior) ? 1 : 0;
  const despues = nuevo !== null && esAbierta(nuevo) ? 1 : 0;
  return antes === despues ? {} : { facturasAbiertas: despues - antes };
}

// --- Escritura ----------------------------------------------------------------

export type NuevaFactura = {
  tipo: TipoFactura;
  moneda: Moneda;
  objetivo: string;
  descripcion?: string;
  meta?: Record<string, unknown> | null;
  montoRequerido: number;
  estado?: EstadoFactura;
};

// Crea la factura, su numero, su token y las entradas de indice, todo dentro de
// la transaccion de quien llama. `reservarObjetivo` decide si dos facturas
// abiertas pueden compartir objetivo (el legado dejaba que si: dos donaciones
// simultaneas a la misma necesidad creaban dos hilos publicos distintos).
export async function crearFactura(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  datos: NuevaFactura,
  token: string,
): Promise<FacturaCargada> {
  const db = ctx.db as unknown as FirestoreFacturas;
  const facturaId = idEntidad(PREFIJO_FACTURA);
  const estado = datos.estado ?? 'Abierta';
  const objetivo = s(datos.objetivo, 200);

  // TODAS las lecturas van juntas y antes de cualquier escritura: Firestore
  // rechaza leer despues de escribir dentro de una transaccion. Por eso el
  // token no pasa por `reservarClaveUnica` (que lee Y escribe): la colision se
  // comprueba aqui y la entrada se escribe con el resto, mas abajo. Leer el
  // documento del indice es lo que hace de `unique` de SQL sobre
  // `token_publico`: si otra transaccion lo escribe mientras tanto, Firestore
  // aborta esta y la reintenta.
  const tokenTomado = await leerIndice(tx, ctx, INDICE_TOKEN, token);
  if (tokenTomado && tokenTomado !== facturaId) {
    throw new ApiError('no se pudo generar el token, intenta de nuevo', 409);
  }
  const { numero } = await siguienteNumeroFactura(tx, ctx);

  const factura: Factura = {
    numeroFactura: numero,
    tokenPublico: token,
    tipo: datos.tipo,
    moneda: datos.moneda,
    objetivo,
    objetivoNorm: normalizar(objetivo),
    descripcion: s(datos.descripcion, 500),
    meta: datos.meta ?? null,
    montoRequerido: datos.montoRequerido,
    montoRecaudado: 0,
    estado,
    viajeVigenteId: null,
    numDonaciones: 0,
    numMovimientos: 0,
    numEvidencias: 0,
    createdAt: ctx.now,
    actualizado: ctx.now,
    fechaCierre: null,
  };

  tx.set(refFactura(db, facturaId), { ...factura });
  fijarIndice(tx, ctx, INDICE_TOKEN, token, facturaId);
  if (esAbierta(estado)) fijarIndice(tx, ctx, INDICE_OBJETIVO, objetivo, facturaId);
  ajustarContadores(tx, ctx.db, deltaEstado(null, estado));

  return { id: facturaId, factura, donaciones: [], movimientos: [], evidencias: [] };
}

// Anade un movimiento a la factura cargada (en memoria y en Firestore). No
// republica: quien llama lo hace una sola vez al final, con todo aplicado.
export function agregarMovimiento(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  cargada: FacturaCargada,
  entrada: { tipo: TipoMovimiento; descripcion: string; monto?: number },
): void {
  const db = ctx.db as unknown as FirestoreFacturas;
  const secuencia = cargada.factura.numMovimientos + 1;
  const datos: Movimiento = {
    tipo: entrada.tipo,
    descripcion: s(entrada.descripcion, 300),
    monto: n(entrada.monto),
    secuencia,
    createdAt: ctx.now,
  };
  const id = idEntidad(PREFIJO_MOVIMIENTO);

  tx.set(refSub(db, cargada.id, SUB_MOVIMIENTOS).doc(id), { ...datos });
  cargada.factura.numMovimientos = secuencia;
  cargada.movimientos.push({ id, datos });
}

export function agregarEvidencia(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  cargada: FacturaCargada,
  entrada: { archivo?: string; archivoPath?: string; descripcion: string; publica: boolean },
): void {
  const db = ctx.db as unknown as FirestoreFacturas;
  const secuencia = cargada.factura.numEvidencias + 1;
  const datos: Evidencia = {
    archivo: s(entrada.archivo, 400),
    archivoPath: s(entrada.archivoPath, 300),
    descripcion: s(entrada.descripcion, 300),
    publica: entrada.publica,
    secuencia,
    createdAt: ctx.now,
  };
  const id = idEntidad(PREFIJO_EVIDENCIA);

  tx.set(refSub(db, cargada.id, SUB_EVIDENCIAS).doc(id), { ...datos });
  cargada.factura.numEvidencias = secuencia;
  cargada.evidencias.push({ id, datos });
}

export function agregarDonacion(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  cargada: FacturaCargada,
  entrada: {
    nombreDonante: string;
    monto: number;
    montoUsd?: number | null;
    tasa?: number | null;
    comprobantePath?: string;
    referenciaPago?: string;
    estado: Donacion['estado'];
  },
): { id: string; datos: Donacion } {
  const db = ctx.db as unknown as FirestoreFacturas;
  const secuencia = cargada.factura.numDonaciones + 1;
  const datos: Donacion = {
    nombreDonante: s(entrada.nombreDonante, 120) || 'Anónimo',
    monto: n(entrada.monto),
    montoUsd: entrada.montoUsd ?? null,
    tasa: entrada.tasa ?? null,
    comprobantePath: s(entrada.comprobantePath, 300),
    referenciaPago: s(entrada.referenciaPago, 80),
    estado: entrada.estado,
    secuencia,
    createdAt: ctx.now,
  };
  const id = idEntidad(PREFIJO_DONACION);

  tx.set(refSub(db, cargada.id, SUB_DONACIONES).doc(id), { ...datos });
  cargada.factura.numDonaciones = secuencia;
  cargada.donaciones.push({ id, datos });
  ajustarContadores(tx, ctx.db, { donacionesRegistradas: 1 });
  return { id, datos };
}

// Firestore no tiene el disparador `trg_recalcular_recaudado` del legado: el
// recaudado se recompone aqui, en la misma transaccion que toca las donaciones.
// Solo suman las `Confirmada`, como en SQL.
export function recalcularRecaudado(cargada: FacturaCargada): number {
  return cargada.donaciones
    .filter(({ datos }) => datos.estado === 'Confirmada')
    .reduce((total, { datos }) => total + datos.monto, 0);
}

// Una necesidad en especie NO se mide por lo prometido, sino por lo que el
// centro dice haber recibido: la donacion nace `Registrada` (nadie ha visto
// llegar las colchonetas) y nunca pasa a `Confirmada`, asi que el legado dejaba
// `monto_recaudado = 0` y la pantalla de seguimiento mostraba 0 % desde la
// primera donacion hasta el cierre, aunque el centro ya hubiera recibido la
// mitad. Aqui ese recaudado lo lleva `registrarEntrega`, que es el unico dato
// que alguien ha comprobado de verdad.
export function recaudadoLoLlevanLasDonaciones(factura: { tipo: TipoFactura }): boolean {
  return factura.tipo !== 'especie';
}

export function sincronizarRecaudado(cargada: FacturaCargada): number {
  if (!recaudadoLoLlevanLasDonaciones(cargada.factura)) return cargada.factura.montoRecaudado;
  cargada.factura.montoRecaudado = recalcularRecaudado(cargada);
  return cargada.factura.montoRecaudado;
}

// Guarda la factura, ajusta los contadores del tablero, mantiene el indice de
// objetivo abierto y republica la proyeccion. Es el unico camino de escritura de
// la cabecera: ninguna accion toca `facturas/{id}` por su cuenta.
export function guardarFactura(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  cargada: FacturaCargada,
  previo: { estado: EstadoFactura; montoRecaudado: number },
): void {
  const db = ctx.db as unknown as FirestoreFacturas;
  const { factura } = cargada;
  factura.actualizado = ctx.now;

  tx.set(refFactura(db, cargada.id), { ...factura });

  if (previo.estado !== factura.estado) {
    if (esAbierta(previo.estado)) soltarIndice(tx, ctx, INDICE_OBJETIVO, factura.objetivo);
    if (esAbierta(factura.estado)) fijarIndice(tx, ctx, INDICE_OBJETIVO, factura.objetivo, cargada.id);
  }

  const deltas: Deltas = { ...deltaEstado(previo.estado, factura.estado) };
  if (cuentaEnDinero(factura) && factura.montoRecaudado !== previo.montoRecaudado) {
    deltas.montoRecaudadoTotal = factura.montoRecaudado - previo.montoRecaudado;
  }
  ajustarContadores(tx, ctx.db, deltas);

  republicarFactura(tx, ctx, cargada);
}

export function instantanea(factura: Factura): { estado: EstadoFactura; montoRecaudado: number } {
  return { estado: factura.estado, montoRecaudado: factura.montoRecaudado };
}

// Aplica una transicion sobre la factura cargada, fijando `fechaCierre` cuando
// el destino es terminal.
export function aplicarTransicion(
  cargada: FacturaCargada,
  ctx: ContextoMinimo,
  nombre: NombreTransicion,
  mensaje?: string,
): EstadoFactura {
  const { estado, cierra } = transitar(cargada.factura.estado, nombre, mensaje);
  cargada.factura.estado = estado;
  if (cierra) cargada.factura.fechaCierre = ctx.now;
  return estado;
}

// --- Costuras que rellenan otras tareas --------------------------------------

// Telegram es la Task 3.8. Aqui solo queda el punto de enganche, y se dispara
// SIEMPRE fuera de la transaccion: una transaccion de Firestore se reintenta, y
// un aviso enviado dentro se enviaria una vez por intento.
export type Notificador = (texto: string) => Promise<void> | void;

let notificador: Notificador | null = null;

export function conectarNotificador(fn: Notificador | null): void {
  notificador = fn;
}

async function avisar(texto: string): Promise<void> {
  if (!notificador || !texto) return;
  try {
    await notificador(texto);
  } catch {
    // Fail-soft, como `notificarTelegram` del legado: perder el aviso nunca
    // puede tumbar la donacion que ya esta escrita.
  }
}

// --- Enganche desde `panel_insumo` (Task 3.1) --------------------------------

// `registrarEntrega(centro, insumo, unidad, delta, recibida, necesaria)`: el
// centro confirma por su panel lo que ha recibido y eso cierra la factura de la
// necesidad. Corre ANTES de que `panel_insumo` escriba nada, porque lee.
conectarRegistroDeEntregas(async (tx, ctx, datos) => {
  const objetivo = objetivoNecesidad(datos.insumo, datos.centro);
  const facturaId = await leerIndice(tx, ctx, INDICE_OBJETIVO, objetivo);
  const cargada = facturaId
    ? await cargarFactura(tx, ctx.db as unknown as FirestoreFacturas, facturaId)
    : null;

  // Sin factura abierta de esa necesidad no hay nada que registrar, igual que
  // en el legado: el centro puede llevar su inventario sin que nadie done.
  if (!cargada) return;

  const previo = instantanea(cargada.factura);
  const unidad = s(datos.unidad, 30) || 'unidades';

  if (datos.delta > 0) {
    agregarMovimiento(tx, ctx, cargada, {
      tipo: 'Entrega',
      descripcion: mov('recepcionConfirmada', { delta: datos.delta, unidad }),
      monto: datos.delta,
    });
  }

  // Lo recibido ES el recaudado de una necesidad, y con el la barra de progreso
  // del seguimiento publico. Nunca por encima de la meta: el centro puede
  // apuntar mas de lo que pedia y un 340 % no dice nada util.
  if (!recaudadoLoLlevanLasDonaciones(cargada.factura)) {
    cargada.factura.montoRecaudado = Math.max(0, Math.min(datos.recibida, cargada.factura.montoRequerido));
  }

  if (datos.necesaria > 0 && datos.recibida >= datos.necesaria) {
    agregarMovimiento(tx, ctx, cargada, { tipo: 'Entrega', descripcion: mov('necesidadCubierta'), monto: 0 });
    aplicarTransicion(cargada, ctx, 'cubrirNecesidad');
  }

  guardarFactura(tx, ctx, cargada, previo);
});

// --- Acciones: donaciones publicas -------------------------------------------

defineAction({
  nombre: 'donar_necesidad',
  // Sigue siendo anonima: no lleva archivos, solo un nombre y una cantidad.
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const centro = s(payload.centro, 120);
    const insumoPedido = s(payload.insumo, 120);
    const cantidad = n(payload.cantidad);

    if (!centro || !insumoPedido) throw new ApiError('centro e insumo requeridos');
    if (cantidad <= 0 || cantidad > MAX_CANTIDAD) throw new ApiError('cantidad inválida');

    const db = firestore(ctx);
    const token = nuevoToken();

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const dbLugares = ctx.db as unknown as FirestoreLugares;

      const lugarId = await lugarIdPorNombre(tx, ctxMin, centro);
      if (!lugarId) throw new ApiError('Centro no encontrado', 404);
      const lugar = await leerLugar(tx, dbLugares, lugarId);
      if (!lugar) throw new ApiError('Centro no encontrado', 404);

      // Cualquier estado, como el legado: se puede donar contra un insumo que el
      // centro ya marco como cubierto o disponible.
      const insumo = await leerInsumo(tx, dbLugares, lugarId, claveInsumo(insumoPedido));
      if (!insumo) throw new ApiError('Necesidad no encontrada', 404);

      const unidad = insumo.unidad || 'unidades';
      const objetivo = objetivoNecesidad(insumo.nombre, lugar.nombre);

      // Una sola factura Abierta por objetivo. El legado no tenia restriccion:
      // dos donaciones simultaneas creaban dos hilos publicos para la misma
      // necesidad y ninguno mostraba el total real.
      const abiertaId = await leerIndice(tx, ctxMin, INDICE_OBJETIVO, objetivo);
      const cargada = abiertaId
        ? await cargarFactura(tx, db, abiertaId)
        : await crearFactura(tx, ctxMin, {
          tipo: 'especie',
          moneda: 'unidades',
          objetivo,
          descripcion: `Necesidad publicada por ${lugar.nombre}`,
          montoRequerido: Math.max(insumo.cantidadNecesaria, cantidad),
        }, token);

      // El indice apuntaba a una factura borrada: se trata como si no hubiera.
      if (!cargada) throw new ApiError('Necesidad no encontrada', 404);

      const previo = instantanea(cargada.factura);

      // `Registrada`, no `Confirmada`: nadie ha comprobado todavia que la
      // donacion en especie llegue. Por eso el recaudado sigue en cero hasta
      // que el centro lo confirme por su panel.
      agregarDonacion(tx, ctxMin, cargada, {
        nombreDonante: s(payload.nombreDonante, 120) || 'Anónimo',
        monto: cantidad,
        referenciaPago: s(payload.referencia, 80),
        estado: 'Registrada',
      });

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Ingreso',
        descripcion: mov('donacionRegistrada', { cantidad, unidad, insumo: insumo.nombre }),
        monto: cantidad,
      });

      // Para una necesidad el recaudado no lo llevan las donaciones: lo lleva el
      // centro al confirmar lo que recibe (`registrarEntrega`).
      sincronizarRecaudado(cargada);
      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        insumo: insumo.nombre,
        descripcion: `Donación registrada: ${cantidad} ${unidad}`,
        origen: 'publico',
        cantidad,
        unidad,
        tipo: 'Donación',
      });

      return {
        token: cargada.factura.tokenPublico,
        numeroFactura: cargada.factura.numeroFactura,
        objetivo,
      };
    });
  },
});

defineAction({
  nombre: 'donar_dinero',
  // El legado era anonimo y subia el comprobante desde el servidor como
  // dataURL. Ahora lo sube el cliente a `private/<uid>/receipts/`, y las reglas
  // de Storage exigen sesion para escribir ahi: sin cuenta no hay comprobante
  // que valga. Misma decision que `panel_crear` (3.1) y `registrar_voluntario`
  // (3.2).
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const montoUsd = n(payload.montoUsd ?? payload.monto);
    if (montoUsd <= 0 || montoUsd > MAX_MONTO_USD) throw new ApiError('monto inválido');

    const token = tokenNormalizado(payload.token);
    const comprobante = s(payload.comprobantePath ?? payload.comprobante, 300);
    const uid = ctx.uid ?? '';

    const db = firestore(ctx);
    const referencia = nuevaReferencia();

    const resultado = await db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      const tasa = await leerTasaEnTransaccion(tx, db);
      if (!tasa || !(tasa.efectiva > 0)) {
        throw new ApiError('tasa de cambio no disponible, intenta más tarde');
      }

      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada || cargada.factura.tipo !== 'presupuesto') {
        throw new ApiError('Presupuesto no encontrado', 404);
      }
      if (!puedeTransitar(cargada.factura.estado, 'metaCubierta')) {
        throw new ApiError(TRANSICIONES.metaCubierta.error);
      }
      if (!comprobante) throw new ApiError('Adjunta el comprobante de tu transferencia');
      if (!rutaPropia(uid, comprobante)) throw new ApiError('Adjunta el comprobante de tu transferencia');

      const previo = instantanea(cargada.factura);
      const montoBs = Math.round(montoUsd * tasa.efectiva);
      const meta = cargada.factura.meta ?? {};

      // `Confirmada` de inmediato, como el legado: la verificacion del admin es
      // posterior (`admin_donaciones_presupuesto` / `admin_donacion_anular`).
      agregarDonacion(tx, ctxMin, cargada, {
        nombreDonante: s(payload.nombreDonante, 120) || 'Anónimo',
        monto: montoBs,
        montoUsd,
        tasa: tasa.efectiva,
        comprobantePath: comprobante,
        referenciaPago: referencia,
        estado: 'Confirmada',
      });

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Ingreso',
        descripcion: mov('dineroRecibido', { referencia }),
        monto: montoBs,
      });

      sincronizarRecaudado(cargada);

      // La decision de cubrir la meta se toma DENTRO de la transaccion: con dos
      // donaciones concurrentes el legado podia escribir dos `metaCubierta` y
      // mandar dos avisos por el mismo presupuesto.
      let aviso = '';
      if (cargada.factura.montoRecaudado >= cargada.factura.montoRequerido) {
        aplicarTransicion(cargada, ctxMin, 'metaCubierta');
        agregarMovimiento(tx, ctxMin, cargada, {
          tipo: 'Recaudado',
          descripcion: mov('metaCubierta', { insumo: s(meta.insumo, 120), tienda: s(meta.tienda, 100) }),
          monto: 0,
        });
        aviso = `✅ Se recaudó todo para <b>${s(meta.insumo, 120)}</b> (${s(meta.centro, 120)}).`
          + ` Toca transferir y comprar. Token: ${cargada.factura.tokenPublico}`;
      }

      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarNombre: s(meta.centro, 120) || 'Donaciones en dinero',
        insumo: s(meta.insumo, 120),
        descripcion: `Donación de ${montoUsd} USD (${montoBs} Bs, ref ${referencia})`,
        origen: 'publico',
        cantidad: montoBs,
        unidad: 'Bs',
        tipo: 'Donación',
      });

      return {
        aviso,
        respuesta: {
          referencia,
          token: cargada.factura.tokenPublico,
          numeroFactura: cargada.factura.numeroFactura,
          recaudado: cargada.factura.montoRecaudado,
          precio: cargada.factura.montoRequerido,
          montoUsd,
          montoBs,
          tasa: tasa.efectiva,
          estado: cargada.factura.estado,
        },
      };
    });

    await avisar(resultado.aviso);
    return resultado.respuesta;
  },
});

// --- Acciones: admin ----------------------------------------------------------

defineAction({
  nombre: 'admin_crear_factura',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const objetivo = s(payload.objetivo, 200);
    const montoRequerido = n(payload.montoRequerido);

    if (!objetivo) throw new ApiError('objetivo requerido');
    if (montoRequerido <= 0) throw new ApiError('montoRequerido debe ser mayor que 0');

    const db = firestore(ctx);
    const token = nuevoToken();

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      // El legado no comprobaba duplicados: dos facturas manuales con el mismo
      // objetivo repartian las donaciones entre dos hilos y ninguna llegaba a
      // su meta. Aqui el indice de objetivos abiertos lo impide.
      const abiertaId = await leerIndice(tx, ctxMin, INDICE_OBJETIVO, objetivo);
      if (abiertaId) throw new ApiError('Ya hay una factura abierta con ese objetivo', 409);

      const cargada = await crearFactura(tx, ctxMin, {
        tipo: 'dinero',
        moneda: monedaFactura(payload.moneda),
        objetivo,
        descripcion: s(payload.descripcion, 500),
        montoRequerido,
      }, token);

      republicarFactura(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Factura ${cargada.factura.numeroFactura} creada: ${objetivo}`,
        origen: 'admin',
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: COLECCION,
        entidadId: cargada.id,
        despues: { objetivo, montoRequerido, token },
      });

      return { numeroFactura: cargada.factura.numeroFactura, token };
    });
  },
});

defineAction({
  nombre: 'admin_listar_facturas',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // El legado traia TODOS los movimientos de las 100 facturas solo para
    // quedarse con 100 fechas: era su lectura mas cara. `actualizado` se
    // mantiene en cada escritura y sale de la propia fila.
    const snapshot = await firestore(ctx).collection(COLECCION)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_FACTURAS_ADMIN)
      .get();

    return {
      facturas: snapshot.docs.map((documento) => {
        const factura = comoFactura(documento.data() ?? {});
        return {
          id: documento.id,
          numero_factura: factura.numeroFactura,
          token_publico: factura.tokenPublico,
          objetivo: factura.objetivo,
          tipo: factura.tipo,
          moneda: factura.moneda,
          monto_requerido: factura.montoRequerido,
          monto_recaudado: factura.montoRecaudado,
          estado: factura.estado,
          fecha_creacion: factura.createdAt.toISOString(),
          ultima_actualizacion: factura.actualizado.toISOString(),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'admin_registrar_donacion',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const monto = n(payload.monto);
    const estado = opcion(payload.estado, ['Registrada', 'Confirmada'] as const, 'Registrada');
    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await facturaPor(tx, ctxMin, payload);
      if (monto <= 0) throw new ApiError('monto debe ser mayor que 0');

      const previo = instantanea(cargada.factura);
      agregarDonacion(tx, ctxMin, cargada, {
        nombreDonante: s(payload.nombreDonante, 120) || 'Anónimo',
        monto,
        referenciaPago: s(payload.referencia, 80),
        estado,
      });

      sincronizarRecaudado(cargada);
      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Donación ${estado.toLowerCase()} de ${monto} a ${cargada.factura.numeroFactura}`,
        origen: 'admin',
        cantidad: monto,
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: `${COLECCION}/${SUB_DONACIONES}`,
        entidadId: cargada.id,
        despues: { monto, estado },
      });

      // El legado NO disparaba `PorComprar` por esta via: un presupuesto
      // financiado en efectivo se quedaba `Abierta` y habia que moverlo a mano.
      // Se conserva a proposito: aqui no hay comprobante que verificar.
      return { estado: cargada.factura.estado, recaudado: cargada.factura.montoRecaudado };
    });
  },
});

defineAction({
  nombre: 'admin_registrar_movimiento',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const tipo = opcion(payload.tipo, TIPOS_MOVIMIENTO_ADMIN, 'Ingreso');
    const descripcion = s(payload.descripcion, 300);
    const monto = n(payload.monto);
    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await facturaPor(tx, ctxMin, payload);
      const previo = instantanea(cargada.factura);

      // Texto plano, no el JSON de `mov()`: el cliente lo muestra tal cual, sin
      // traducir. Y es publico por el seguimiento, asi que se escribe pensando
      // en que lo lea cualquiera.
      agregarMovimiento(tx, ctxMin, cargada, { tipo, descripcion, monto });
      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Movimiento ${tipo} en ${cargada.factura.numeroFactura}: ${s(descripcion, 80)}`,
        origen: 'admin',
        cantidad: monto,
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: `${COLECCION}/${SUB_MOVIMIENTOS}`,
        entidadId: cargada.id,
        despues: { tipo, monto },
      });

      return {};
    });
  },
});

defineAction({
  nombre: 'admin_registrar_evidencia',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const archivo = s(payload.archivo, 400);
    // `https` obligatorio y sin la bandera `i`, igual que el legado: un enlace
    // `http://` en una pagina servida por https no cargaria de todos modos.
    if (!/^https:\/\//.test(archivo)) throw new ApiError('archivo debe ser una URL https');

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await facturaPor(tx, ctxMin, payload);
      const previo = instantanea(cargada.factura);

      // Por defecto publica: solo un `false` explicito la hace privada.
      agregarEvidencia(tx, ctxMin, cargada, {
        archivo,
        descripcion: s(payload.descripcion, 300),
        publica: payload.publica !== false,
      });
      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Evidencia registrada en ${cargada.factura.numeroFactura}`,
        origen: 'admin',
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: `${COLECCION}/${SUB_EVIDENCIAS}`,
        entidadId: cargada.id,
        despues: { archivo, publica: payload.publica !== false },
      });

      return {};
    });
  },
});

defineAction({
  nombre: 'admin_cerrar_factura',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await facturaPor(tx, ctxMin, payload);
      const previo = instantanea(cargada.factura);

      // Unica transicion sin comprobar el estado previo (contrato §1.15). Cerrar
      // dos veces es inocuo, pero se responde con el estado para que la consola
      // no tenga que recargar para verlo.
      aplicarTransicion(cargada, ctxMin, 'cerrarAdmin');
      guardarFactura(tx, ctxMin, cargada, previo);

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Factura ${cargada.factura.numeroFactura} cerrada`,
        origen: 'admin',
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION,
        entidadId: cargada.id,
        antes: { estado: previo.estado },
        despues: { estado: 'Cerrada' },
      });

      return { estado: cargada.factura.estado };
    });
  },
});

// --- Utilidades compartidas con `presupuestos.ts` y `ofertas.ts` -------------

// `facturaPor(p)` del legado: por `token` o por `numeroFactura`. Con token se
// resuelve por el indice; con numero, por una consulta de igualdad sobre un
// campo simple. Las dos son lecturas y van antes de cualquier escritura.
export async function facturaPor(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  payload: ActionPayload,
): Promise<FacturaCargada> {
  const token = tokenNormalizado(payload.token);
  const numero = s(payload.numeroFactura, 24).toUpperCase();
  if (!token && !numero) throw new ApiError('token o numeroFactura requerido');

  if (token) {
    const cargada = await cargarFacturaPorToken(tx, ctx, token);
    if (!cargada) throw new ApiError('Factura no encontrada', 404);
    return cargada;
  }

  const db = ctx.db as unknown as FirestoreFacturas;
  const encontradas = await db.collection(COLECCION)
    .where('numeroFactura', '==', numero)
    .limit(1)
    .get();
  const primera = encontradas.docs[0];
  if (!primera) throw new ApiError('Factura no encontrada', 404);

  const cargada = await cargarFactura(tx, db, primera.id);
  if (!cargada) throw new ApiError('Factura no encontrada', 404);
  return cargada;
}

// Generador de tokens con una costura para las pruebas: sin ella un caso no
// puede saber que token se acaba de acunar y tendria que sacarlo de la
// respuesta incluso para comprobar un rechazo.
let generadorToken: (prefijo: string) => string = (prefijo) => tokenAlfa(prefijo);

export function usarGeneradorDeTokens(fn: ((prefijo: string) => string) | null): void {
  generadorToken = fn ?? ((prefijo) => tokenAlfa(prefijo));
}

// Token publico nuevo (`DV-XXXX-XXXX-XXXX`).
export function nuevoToken(): string {
  return generadorToken('DV');
}

// Referencia de pago que ve el donante (`REF-XXXX-XXXX-XXXX`).
export function nuevaReferencia(): string {
  return generadorToken('REF');
}

// --- Tasa ---------------------------------------------------------------------

async function leerTasaEnTransaccion(
  tx: TransaccionMinima,
  db: FirestoreFacturas,
): Promise<Tasa | null> {
  const snapshot = await tx.get(db.collection('tasas').doc('actual'));
  if (!snapshot.exists) return null;
  return normalizarTasa((snapshot.data() ?? {}) as { efectiva: unknown });
}

// --- Comprobantes -------------------------------------------------------------

// El cliente sube el comprobante a Storage y manda el `path`. Se exige que sea
// SUYO y de la categoria `receipts`: si no, cualquiera podria colgar de su
// donacion el archivo privado de otra persona.
export function rutaPropia(uid: string, ruta: string): boolean {
  return Boolean(uid) && ruta.startsWith(`private/${uid}/receipts/`);
}

// --- Fuente del reconciliador -------------------------------------------------

// La proyeccion publica de una factura depende de sus tres subcolecciones, asi
// que `mapear` las relee. `contadores` sale de la cabecera: `numDonaciones` esta
// en la fila justamente porque el reconciliador solo recorre colecciones de
// primer nivel y nunca veria las donaciones.
registrarFuente({
  coleccion: COLECCION,
  proyeccion: PROYECCION,
  async mapear({ id, datos }, db) {
    const factura = comoFactura(datos);
    const referencia = db.collection(COLECCION).doc(id);
    const leer = async (sub: string): Promise<Snapshot[]> => {
      if (!referencia.collection) return [];
      const { docs } = await referencia.collection(sub).get();
      return docs;
    };

    const cargada: FacturaCargada = {
      id,
      factura,
      donaciones: (await leer(SUB_DONACIONES))
        .map((doc) => ({ id: doc.id, datos: comoDonacion(doc.data() ?? {}) }))
        .sort((a, b) => a.datos.secuencia - b.datos.secuencia),
      movimientos: (await leer(SUB_MOVIMIENTOS))
        .map((doc) => ({ id: doc.id, datos: comoMovimiento(doc.data() ?? {}) }))
        .sort((a, b) => a.datos.secuencia - b.datos.secuencia),
      evidencias: (await leer(SUB_EVIDENCIAS))
        .map((doc) => ({ id: doc.id, datos: comoEvidencia(doc.data() ?? {}) }))
        .sort((a, b) => a.datos.secuencia - b.datos.secuencia),
    };

    return documentoPublico(cargada);
  },
  // La proyeccion se indexa por TOKEN, no por el id del documento canonico:
  // `getSeguimiento(token)` hace un `get` directo con lo que teclea la persona.
  idProyeccion: ({ datos }) => s(datos.tokenPublico, 40),
  contadores: ({ datos }) => {
    const factura = comoFactura(datos);
    return {
      facturasAbiertas: esAbierta(factura.estado) ? 1 : 0,
      donacionesRegistradas: factura.numDonaciones,
      montoRecaudadoTotal: cuentaEnDinero(factura) ? factura.montoRecaudado : 0,
    };
  },
});

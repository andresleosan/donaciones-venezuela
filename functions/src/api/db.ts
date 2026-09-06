import { ApiError, normalizar, numeroFactura, s } from './contract.js';
import { marcaServidor, publicar } from './publicar.js';

// Utilidades de persistencia compartidas por las acciones de la API.
//
// REGLA DE USO: `siguienteNumeroFactura` y `reservarClaveUnica` LEEN, asi que
// deben llamarse antes de cualquier escritura de la transaccion (Firestore
// rechaza una lectura despues de una escritura). `auditar`, `historial` y
// `publicar` solo escriben y pueden ir al final.

type DocumentReference = { path?: string };
type DocumentSnapshot = { exists: boolean; data(): unknown };

type ColeccionMinima = {
  doc(id?: string): DocumentReference & { id?: string };
};

export type FirestoreMinimo = {
  collection(name: string): ColeccionMinima;
};

export type TransaccionMinima = {
  get(reference: DocumentReference): Promise<DocumentSnapshot>;
  set(reference: DocumentReference, data: Record<string, unknown>, options?: { merge: boolean }): void;
  delete(reference: DocumentReference): void;
};

export type ContextoMinimo = {
  uid: string | null;
  role: string;
  ip: string;
  now: Date;
  db: FirestoreMinimo;
};

// --- Auditoria del admin -----------------------------------------------------

export type AccionAuditada = 'crear' | 'editar' | 'deshacer' | 'borrar';

// Claves que nunca se copian a la bitacora, ni anidadas. `email` no se borra:
// se enmascara, porque identificar al actor es justo el objetivo de auditar.
const CLAVES_SECRETAS = /pin|token|hash|password|contrasena|secret|clave|refresh/i;
const CLAVES_CORREO = /email|correo/i;

export function enmascararCorreo(valor: unknown): string {
  const texto = s(valor, 254);
  const arroba = texto.indexOf('@');
  if (arroba < 1) return texto ? '***' : '';
  return `${texto[0]}***${texto.slice(arroba)}`;
}

export function redactar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 8) return null;
  if (Array.isArray(valor)) return valor.map((item) => redactar(item, profundidad + 1));
  if (!valor || typeof valor !== 'object') return valor;
  if (valor instanceof Date) return valor.toISOString();

  const salida: Record<string, unknown> = {};
  for (const [clave, hijo] of Object.entries(valor as Record<string, unknown>)) {
    if (CLAVES_SECRETAS.test(clave)) continue;
    salida[clave] = CLAVES_CORREO.test(clave) ? enmascararCorreo(hijo) : redactar(hijo, profundidad + 1);
  }
  return salida;
}

export function auditar(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  entrada: {
    accion: AccionAuditada;
    entidad: string;
    entidadId?: unknown;
    antes?: unknown;
    despues?: unknown;
    resultado?: string;
  },
): void {
  tx.set(ctx.db.collection('auditoriaAdmin').doc(), {
    accion: entrada.accion,
    entidad: s(entrada.entidad, 60),
    entidadId: s(entrada.entidadId, 200),
    actorUid: ctx.uid ?? '',
    actorRol: ctx.role,
    ip: ctx.ip,
    antes: redactar(entrada.antes ?? null),
    despues: redactar(entrada.despues ?? null),
    resultado: s(entrada.resultado ?? 'ok', 200),
    fecha: marcaServidor(),
  });
}

// --- Bitacora publica por centro --------------------------------------------

export const ORIGENES_HISTORIAL = ['publico', 'panel', 'admin'] as const;
export type OrigenHistorial = typeof ORIGENES_HISTORIAL[number];

export type EntradaHistorial = {
  lugarId?: string;
  lugarNombre: string;
  insumo?: string;
  descripcion?: string;
  origen: OrigenHistorial;
  cantidad?: number;
  unidad?: string;
  tipo?: string;
};

// Escribe el movimiento canonico y su proyeccion publica en la misma
// transaccion. `historialPublico.lugarId` lleva el NOMBRE NORMALIZADO del lugar
// porque la ventana `historial` solo conoce el nombre (ver Task 2.2 del plan).
export function historial(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  entrada: EntradaHistorial,
): string {
  const lugarNombre = s(entrada.lugarNombre, 120);
  if (!lugarNombre) throw new ApiError('nombre requerido');

  const referencia = ctx.db.collection('historialMovimientos').doc();
  const id = referencia.id ?? '';
  const canonico = {
    lugarId: s(entrada.lugarId, 120),
    lugar: lugarNombre,
    lugarNorm: normalizar(lugarNombre),
    insumo: s(entrada.insumo, 120),
    descripcion: s(entrada.descripcion, 300),
    origen: entrada.origen,
    cantidad: Number.isFinite(entrada.cantidad) ? Number(entrada.cantidad) : 0,
    unidad: s(entrada.unidad, 40),
    tipo: s(entrada.tipo, 40),
    createdAt: ctx.now,
  };

  tx.set(referencia, canonico);
  publicar(tx, ctx.db, 'historialPublico', id, { ...canonico, lugarId: canonico.lugarNorm });
  return id;
}

// --- Numeracion de facturas --------------------------------------------------

export const RUTA_CONTADORES = { coleccion: 'config', documento: 'contadores' } as const;

// Lee e incrementa `config/contadores.facturaSeq` dentro de la transaccion: dos
// facturas simultaneas nunca comparten numero. Si la transaccion se reintenta o
// se aborta, el contador se vuelve a leer: un numero que no llego a confirmarse
// queda libre, y uno confirmado nunca se repite.
export async function siguienteNumeroFactura(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
): Promise<{ numero: string; secuencia: number }> {
  const referencia = ctx.db.collection(RUTA_CONTADORES.coleccion).doc(RUTA_CONTADORES.documento);
  const snapshot = await tx.get(referencia);
  const datos = (snapshot.exists ? snapshot.data() : null) as { facturaSeq?: unknown } | null;
  const actual = Number(datos?.facturaSeq);
  const secuencia = (Number.isInteger(actual) && actual > 0 ? actual : 0) + 1;

  tx.set(referencia, { facturaSeq: secuencia }, { merge: true });
  return { numero: numeroFactura(ctx.now.getUTCFullYear(), secuencia), secuencia };
}

// --- Indices de unicidad -----------------------------------------------------

export const INDICES = [
  'lugaresPorNombre',
  'cuentasPorEmail',
  'facturasPorToken',
  'facturasAbiertasPorObjetivo',
] as const;
export type NombreIndice = typeof INDICES[number];

// `indices/<indice>/claves/<clave>`: cuatro segmentos porque tres serian una
// coleccion, no un documento. Las reglas deniegan todo el arbol `indices/`.
export function referenciaIndice(
  db: FirestoreMinimo,
  indice: NombreIndice,
  clave: string,
): DocumentReference {
  return db.collection(`indices/${indice}/claves`).doc(clave);
}

export function claveIndice(indice: NombreIndice, valor: unknown): string {
  const clave = normalizar(valor).replace(/\//g, '-').slice(0, 200);
  if (!clave) throw new ApiError(`clave de ${indice} requerida`);
  return clave;
}

// Reserva atomica: si la clave ya esta tomada por otro documento, 409 con el
// mensaje en espanol que espera la UI.
export async function reservarClaveUnica(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  indice: NombreIndice,
  claveCruda: unknown,
  valor: string,
  mensajeDuplicado: string,
): Promise<string> {
  const clave = claveIndice(indice, claveCruda);
  const referencia = referenciaIndice(ctx.db, indice, clave);
  const snapshot = await tx.get(referencia);

  if (snapshot.exists) {
    const actual = (snapshot.data() as { valor?: unknown } | undefined)?.valor;
    if (String(actual ?? '') !== valor) throw new ApiError(mensajeDuplicado, 409);
  }

  tx.set(referencia, { valor, createdAt: ctx.now });
  return clave;
}

export function liberarClaveUnica(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  indice: NombreIndice,
  claveCruda: unknown,
): void {
  tx.delete(referenciaIndice(ctx.db, indice, claveIndice(indice, claveCruda)));
}

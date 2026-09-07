import {
  ApiError,
  URGENCIAS,
  idEntidad,
  n,
  normalizar,
  opcion,
  s,
  soloDigitos,
} from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar, historial } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { despublicar, publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: vacantes de voluntariado.
//
// Modelo (plan 2026-09-06, Task 3.3):
//   vacantes/{VAC-XXXXXXXX}         canonico, privado (lleva el telefono)
//   vacantesPublicas/{VAC-…}         proyeccion (misma transaccion), sin telefono
//
// `lugarNombre` es texto libre y NO una referencia a `lugares`: una vacante
// puede apuntar a una zona de derrumbe, que no es un centro. Por eso el tipo
// admite un cuarto valor que no esta en `TIPOS_LUGAR`.

export const PREFIJO_VACANTE = 'VAC';
export const COLECCION = 'vacantes';
export const PROYECCION = 'vacantesPublicas';

export const TOPE_VACANTES = 100;
export const MAX_CUPOS = 10_000;

export const TIPOS_LUGAR_VACANTE = ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'] as const;
export const ESTADOS_VACANTE = ['Abierta', 'Cubierta', 'Cerrada'] as const;

// --- Superficie minima de Firestore ------------------------------------------

type Lectura = { exists: boolean; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string; get(): Promise<Lectura> };
type Snapshot = { id: string; data(): Record<string, unknown> | undefined };

type Consulta = {
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionVacantes = Consulta & { doc(id?: string): Referencia };

export type FirestoreVacantes = {
  collection(nombre: string): ColeccionVacantes;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreVacantes {
  return ctx.db as unknown as FirestoreVacantes;
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

// --- Lectura de campos --------------------------------------------------------

type ConFecha = { toDate(): Date };

function comoFecha(valor: unknown): Date | null {
  if (valor instanceof Date) return valor;
  if (valor && typeof (valor as ConFecha).toDate === 'function') return (valor as ConFecha).toDate();
  if (typeof valor === 'string' || typeof valor === 'number') {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  return null;
}

function iso(valor: unknown): string {
  return comoFecha(valor)?.toISOString() ?? '';
}

export type Vacante = {
  lugarTipo: string;
  lugarNombre: string;
  lugarNombreNorm: string;
  ubicacion: string;
  rol: string;
  descripcion: string;
  cantidadNecesaria: number;
  cantidadCubierta: number;
  urgencia: string;
  turno: string;
  telefono: string;
  estado: string;
  createdAt: Date;
  actualizado: Date;
};

export function comoVacante(datos: Record<string, unknown>): Vacante {
  const lugarNombre = s(datos.lugarNombre, 120);
  return {
    lugarTipo: opcion(datos.lugarTipo, TIPOS_LUGAR_VACANTE, 'Centro'),
    lugarNombre,
    lugarNombreNorm: s(datos.lugarNombreNorm, 200) || normalizar(lugarNombre),
    ubicacion: s(datos.ubicacion, 160),
    rol: s(datos.rol, 80),
    descripcion: s(datos.descripcion, 400),
    cantidadNecesaria: Math.max(0, Math.trunc(n(datos.cantidadNecesaria))),
    cantidadCubierta: Math.max(0, Math.trunc(n(datos.cantidadCubierta))),
    urgencia: opcion(datos.urgencia, URGENCIAS, 'Normal'),
    turno: s(datos.turno, 80),
    telefono: s(datos.telefono, 40),
    estado: opcion(datos.estado, ESTADOS_VACANTE, 'Abierta'),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? comoFecha(datos.createdAt) ?? new Date(0),
  };
}

export function cuposFaltantes(vacante: Pick<Vacante, 'cantidadNecesaria' | 'cantidadCubierta'>): number {
  return Math.max(0, vacante.cantidadNecesaria - vacante.cantidadCubierta);
}

// La tarjeta publica no lleva telefono: solo dice que hay forma de contactar, y
// el numero se pide con `contactar_vacante`, que exige sesion. Los nombres son
// los que espera `vacanteUI` de la fachada.
export function documentoPublico(vacante: Vacante): Record<string, unknown> {
  return {
    rol: vacante.rol,
    lugarNombre: vacante.lugarNombre,
    lugarTipo: vacante.lugarTipo,
    ubicacion: vacante.ubicacion,
    descripcion: vacante.descripcion,
    urgencia: vacante.urgencia,
    cantidadNecesaria: vacante.cantidadNecesaria,
    cantidadCubierta: vacante.cantidadCubierta,
    cuposFaltantes: cuposFaltantes(vacante),
    turno: vacante.turno,
    tieneContacto: soloDigitos(vacante.telefono).length >= 7,
    estado: vacante.estado,
    createdAt: vacante.createdAt,
  };
}

// Solo se publican las abiertas: los KPIs de la UI cuentan «todas las abiertas»
// y una vacante cubierta o cerrada en el directorio seria una llamada a un
// puesto que ya no existe.
export function debePublicarse(vacante: Pick<Vacante, 'estado'>): boolean {
  return vacante.estado === 'Abierta';
}

function sincronizarProyeccion(
  tx: TransaccionMinima,
  ctxMin: ContextoMinimo,
  id: string,
  vacante: Vacante,
): void {
  if (debePublicarse(vacante)) publicar(tx, ctxMin.db, PROYECCION, id, documentoPublico(vacante));
  else despublicar(tx, ctxMin.db, PROYECCION, id);
}

// --- Acciones -----------------------------------------------------------------

defineAction({
  nombre: 'admin_crear_vacante',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const lugarNombre = s(payload.lugarNombre, 120);
    const rol = s(payload.rol, 80);
    const cantidad = Math.trunc(n(payload.cantidad));

    if (!lugarNombre) throw new ApiError('nombre del lugar o zona requerido');
    if (!rol) throw new ApiError('tipo de voluntario requerido');
    if (cantidad <= 0 || cantidad > MAX_CUPOS) throw new ApiError('cantidad inválida');

    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_VACANTE);
    // Fuera de lista NO es error: cae al valor por defecto, igual que el legado.
    const lugarTipo = opcion(payload.lugarTipo, TIPOS_LUGAR_VACANTE, 'Centro');

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const vacante: Vacante = {
        lugarTipo,
        lugarNombre,
        lugarNombreNorm: normalizar(lugarNombre),
        ubicacion: s(payload.ubicacion, 160),
        rol,
        descripcion: s(payload.descripcion, 400),
        cantidadNecesaria: cantidad,
        cantidadCubierta: 0,
        urgencia: opcion(payload.urgencia, URGENCIAS, 'Normal'),
        turno: s(payload.turno, 80),
        telefono: s(payload.telefono, 40),
        estado: 'Abierta',
        createdAt: ctx.now,
        actualizado: ctx.now,
      };

      tx.set(db.collection(COLECCION).doc(id), { ...vacante });
      sincronizarProyeccion(tx, ctxMin, id, vacante);

      historial(tx, ctxMin, {
        lugarNombre,
        // El separador es `×` (U+00D7), como en el legado.
        descripcion: `Vacante de voluntariado: ${cantidad} × ${rol} (${lugarTipo})`,
        origen: 'admin',
        cantidad,
        tipo: 'Vacante',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: COLECCION,
        entidadId: id,
        despues: { lugarNombre, rol, cantidadNecesaria: cantidad, urgencia: vacante.urgencia },
      });

      return { id };
    });
  },
});

defineAction({
  nombre: 'admin_actualizar_vacante',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');

    // `cantidadCubierta: 0` SI se aplica: la comprobacion del legado es
    // `!= null`, no la veracidad del valor. Ausente o `null` no toca nada.
    const tocaCubierta = payload.cantidadCubierta !== undefined && payload.cantidadCubierta !== null;
    const cubiertaPedida = tocaCubierta ? Math.max(0, Math.trunc(n(payload.cantidadCubierta))) : null;
    // Un estado fuera de lista no cambia nada, igual que el legado.
    const estadoPedido = (ESTADOS_VACANTE as readonly string[]).includes(s(payload.estado, 20))
      ? s(payload.estado, 20)
      : null;

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = db.collection(COLECCION).doc(id);
      const documento = await tx.get(referencia);

      // El legado dejaba escapar el error crudo de PostgREST ("JSON object
      // requested, multiple (or no) rows returned") hasta la UI. Aqui es un 404
      // con un mensaje que se puede enseñar.
      if (!documento.exists) throw new ApiError('Vacante no encontrada', 404);

      const previa = comoVacante((documento.data() ?? {}) as Record<string, unknown>);

      // El legado no comprobaba nada de esto: se podian registrar 30 cubiertos
      // en una vacante de 4, y la vacante seguia anunciandose como abierta para
      // siempre porque el cierre era manual.
      const cantidadCubierta = Math.min(
        cubiertaPedida ?? previa.cantidadCubierta,
        previa.cantidadNecesaria,
      );
      const estadoBase = estadoPedido ?? previa.estado;
      const estado = estadoBase === 'Abierta' && cantidadCubierta >= previa.cantidadNecesaria
        ? 'Cubierta'
        : estadoBase;

      const vacante: Vacante = { ...previa, cantidadCubierta, estado, actualizado: ctx.now };

      // `actualizado` se toca siempre, aunque no cambie nada mas (paridad).
      tx.set(referencia, { ...vacante });
      sincronizarProyeccion(tx, ctxMin, id, vacante);

      historial(tx, ctxMin, {
        lugarNombre: previa.lugarNombre,
        descripcion: `Vacante ${previa.rol}: ${estado}, ${cantidadCubierta} cubiertos`,
        origen: 'admin',
        cantidad: cantidadCubierta,
        tipo: 'Vacante',
      });

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION,
        entidadId: id,
        antes: { estado: previa.estado, cantidadCubierta: previa.cantidadCubierta },
        despues: { estado, cantidadCubierta },
      });

      // El legado respondia `{}`. Devolver el estado resultante es lo que deja
      // ver a la UI que el cierre automatico ocurrio sin tener que recargar.
      return { id, estado, cantidadCubierta, cuposFaltantes: cuposFaltantes(vacante) };
    });
  },
});

defineAction({
  nombre: 'admin_listar_vacantes',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // El legado no comprobaba el error de PostgREST y devolvia `{ vacantes: [] }`
    // con `success: true`: una consola vacia por un fallo de lectura se veia
    // igual que una sin vacantes. Aqui el fallo sube y el despachador responde
    // 500, que es informacion y no un silencio.
    const snapshot = await firestore(ctx).collection(COLECCION)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_VACANTES)
      .get();

    return {
      vacantes: snapshot.docs.map((documento) => {
        const vacante = comoVacante((documento.data() ?? {}) as Record<string, unknown>);
        // Claves snake_case: son las que lee `js/admin.js:829-838`.
        return {
          id: documento.id,
          lugar_tipo: vacante.lugarTipo,
          lugar_nombre: vacante.lugarNombre,
          ubicacion: vacante.ubicacion,
          rol: vacante.rol,
          descripcion: vacante.descripcion,
          cantidad_necesaria: vacante.cantidadNecesaria,
          cantidad_cubierta: vacante.cantidadCubierta,
          urgencia: vacante.urgencia,
          turno: vacante.turno,
          estado: vacante.estado,
          // A diferencia de la tarjeta publica, el admin SI ve el telefono.
          telefono: vacante.telefono,
          fecha_creacion: iso(vacante.createdAt),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'contactar_vacante',
  // Igual que `contactar_motorizado` (Task 3.2): el telefono salio de la
  // proyeccion publica para que no se pueda recolectar en bloque, y se entrega
  // de uno en uno con sesion y con el cubo `contacto` (30/h por uid).
  auth: 'user',
  cubo: 'contacto',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');

    const documento = await firestore(ctx).collection(COLECCION).doc(id).get();
    if (!documento.exists) throw new ApiError('Vacante no encontrada', 404);

    const vacante = comoVacante((documento.data() ?? {}) as Record<string, unknown>);
    // Una vacante cerrada o ya cubierta no reparte contactos: el puesto no
    // existe, y responder el telefono seria mandar gente a un sitio lleno.
    if (!debePublicarse(vacante)) throw new ApiError('Vacante no encontrada', 404);

    return { id, rol: vacante.rol, lugarNombre: vacante.lugarNombre, telefono: vacante.telefono };
  },
});

// --- Fuente del reconciliador -------------------------------------------------

registrarFuente({
  coleccion: COLECCION,
  proyeccion: PROYECCION,
  incluir: ({ datos }) => debePublicarse(comoVacante(datos)),
  mapear: ({ datos }) => documentoPublico(comoVacante(datos)),
});

import { ApiError, idEntidad, n, normalizar, s, soloDigitos } from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar, liberarClaveUnica, reservarClaveUnica } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { ajustarContadores, type Deltas } from './estadisticas.js';
import { despublicar, publicar } from './publicar.js';
import { defineAction } from './registry.js';
import {
  ENTIDADES,
  MENSAJE_FUERA,
  aCanonico,
  camposValidados,
  entidadDe,
  normaClave,
} from './consola-entidades.js';
import type { Entidad } from './consola-entidades.js';
import {
  COLECCION_PANEL,
  INDICE_NOMBRE,
  borrarLugarEnCascada,
  claveInsumo,
  comoInsumo,
  comoLugar,
  crearLugar,
  deltaTipo,
  documentoPublico as documentoPublicoLugar,
  leerInsumos,
  leerLugar,
} from './lugares.js';
import type { FirestoreLugares, Insumo, Lugar } from './lugares.js';
import {
  COLECCION_MOTORIZADOS,
  PROYECCION_MOTORIZADOS,
  consentimientoActivo,
  documentoPublicoMotorizado,
  personaLocalizada,
} from './personas.js';
import {
  PROYECCION as PROYECCION_VACANTES,
  comoVacante,
  debePublicarse,
  documentoPublico as vacantePublica,
} from './vacantes.js';

// Consola de datos del admin y bitacora (contrato §1.18 y §1.12).
//
// Es la unica superficie del sistema que escribe colecciones canonicas ajenas a
// su dominio, asi que todo lo que hace pasa por dos filtros:
//
//   1. La lista blanca `ENTIDADES` (`consola-entidades.ts`): que se puede tocar,
//      con que tipo, con que limites y con que nombre canonico.
//   2. `sincronizar()`, aqui: despues de tocar una fila hay que dejar su
//      proyeccion publica y los contadores del tablero como los dejaria la
//      accion de dominio. Sin eso, editar un centro desde la consola lo dejaria
//      con un nombre en la ficha y otro en el directorio, que es exactamente lo
//      que la regla D3 existe para impedir.

export const COLECCION_AUDITORIA = 'auditoriaAdmin';

// El legado leia la tabla entera con `ilike` y paginaba en PostgREST. Firestore
// no tiene `LIKE`, asi que la busqueda es un filtro en memoria sobre una ventana
// acotada: 500 documentos es el tope que el plan fija.
export const TOPE_ESCANEO = 500;
export const POR_PAGINA_MIN = 5;
export const POR_PAGINA_MAX = 100;
export const POR_PAGINA_DEFECTO = 25;
export const TOPE_BITACORA = 40;
export const TOPE_HIJOS = 200;
export const TOPE_DUPLICADOS = 2000;

export const NO_ENCONTRADO = 'No se encontró ese registro';
export const CONFIRMA_BORRADO = 'Escribe el nombre del registro para confirmar el borrado';

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Lectura = { exists: boolean; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string; get(): Promise<Lectura> };

type Consulta = {
  where(campo: string, operador: string, valor: unknown): Consulta;
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionConsola = Consulta & { doc(id?: string): Referencia & { collection(nombre: string): ColeccionConsola } };

export type FirestoreConsola = {
  collection(nombre: string): ColeccionConsola;
  collectionGroup?(nombre: string): Consulta;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreConsola {
  return ctx.db as unknown as FirestoreConsola;
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

function base(ctx: ContextoMinimo): FirestoreConsola {
  return ctx.db as unknown as FirestoreConsola;
}

// Lee una coleccion como consulta: la `Transaction` real sobrecarga `get`.
async function leerConsulta(tx: TransaccionMinima, consulta: Consulta): Promise<{ docs: Snapshot[] }> {
  const via = tx as unknown as { get(referencia: Consulta): Promise<{ docs: Snapshot[] }> };
  return via.get(consulta);
}

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

// --- Direccionamiento de una fila ---------------------------------------------

// Un insumo vive en `lugares/{LUG-…}/insumos/{clave}`, asi que su id solo lo
// direcciona con las dos mitades. El resto de entidades son de primer nivel.
export type Direccion = { padre: string; propio: string };

export function direccionDe(entidad: Entidad, id: unknown): Direccion {
  const texto = s(id, 130);
  if (!texto) throw new ApiError(NO_ENCONTRADO, 404);
  if (!entidad.subcoleccionDe) return { padre: '', propio: texto };
  const corte = texto.indexOf('/');
  if (corte < 1) throw new ApiError(NO_ENCONTRADO, 404);
  return { padre: texto.slice(0, corte), propio: texto.slice(corte + 1) };
}

export function idDe(entidad: Entidad, direccion: Direccion): string {
  return entidad.subcoleccionDe ? `${direccion.padre}/${direccion.propio}` : direccion.propio;
}

function referenciaDe(db: FirestoreConsola, entidad: Entidad, direccion: Direccion): Referencia {
  if (entidad.subcoleccionDe) {
    return db.collection(entidad.subcoleccionDe).doc(direccion.padre)
      .collection(entidad.coleccion).doc(direccion.propio);
  }
  return db.collection(entidad.coleccion).doc(direccion.propio);
}

// --- Fila en el vocabulario del legado -----------------------------------------

// Traduce el documento canonico a las columnas de `lectura`. Las fechas salen en
// ISO, y las rutas de foto salen como RUTAS: la consola pide la firma de la que
// va a abrir, en vez de recibir una URL de una hora por cada fila.
export function aFila(entidad: Entidad, id: string, datos: Record<string, unknown>): Record<string, unknown> {
  const fila: Record<string, unknown> = { id };
  for (const columna of entidad.lectura) {
    if (columna === 'id') continue;
    fila[columna] = valorDeColumna(entidad, columna, id, datos);
  }
  return fila;
}

// Columnas que son una fecha y salen en ISO.
const FECHAS = new Set(['actualizado', 'fecha_registro', 'fecha_creacion', 'fecha', 'creado']);

// El campo canonico de una columna sale de la propia entidad: de su `ColDef` si
// es editable, y si no de `lecturaCampos`. No hay mapa global a proposito: en
// `voluntarios` la columna `email` es `emailNorm`, y en `centros_panel` es
// literalmente `email`.
function campoDe(entidad: Entidad, columna: string): string {
  const editable = entidad.editables.find((col) => col.id === columna);
  if (editable) return editable.campo ?? editable.id;
  return entidad.lecturaCampos?.[columna] ?? columna;
}

function valorDeColumna(
  entidad: Entidad,
  columna: string,
  id: string,
  datos: Record<string, unknown>,
): unknown {
  // `lugar_id` de un insumo es la primera mitad de su id; el de un acceso de
  // panel ES su id, porque `centrosPanel/{lugarId}`.
  if (columna === 'lugar_id') {
    if (entidad.id === 'insumos') return id.split('/')[0] ?? '';
    if (entidad.id === 'centros_panel') return id;
    return s(datos.lugarId, 128);
  }
  const valor = datos[campoDe(entidad, columna)];
  if (FECHAS.has(columna)) return iso(valor);
  if (valor === undefined) return null;
  return valor instanceof Date ? valor.toISOString() : valor;
}

// --- Sincronizacion con proyecciones y contadores ------------------------------

// Estado que la sincronizacion necesita LEER, y que por tanto hay que tener en
// la mano antes de la primera escritura: Firestore rechaza leer despues de
// escribir dentro de una transaccion. Es el mismo orden que impone `crearFactura`
// (Task 3.4) y por el que la reserva de un viaje carga su origen (Task 3.5).
export type EstadoPrevio = {
  lugar: Lugar | null;
  insumos: Array<{ id: string; datos: Insumo }>;
};

// Fase 1: todas las lecturas.
async function prepararSincronizacion(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  entidad: Entidad,
  direccion: Direccion,
): Promise<EstadoPrevio> {
  const vacio: EstadoPrevio = { lugar: null, insumos: [] };
  const db = ctx.db as unknown as FirestoreLugares;

  // La vista publica de un centro incluye sus insumos, asi que tocar cualquiera
  // de los dos obliga a rehacerla entera.
  const lugarId = entidad.id === 'lugares' || entidad.id === 'centros_panel'
    ? direccion.propio
    : entidad.id === 'insumos' ? direccion.padre : '';
  if (!lugarId) return vacio;

  const lugar = await leerLugar(tx, db, lugarId);
  if (!lugar) return vacio;
  return { lugar, insumos: await leerInsumos(tx, db, lugarId) };
}

// Fase 2: solo escrituras. Deja la vista publica y el tablero como los dejaria
// la accion de dominio; sin esto, editar un centro desde la consola lo dejaria
// con un nombre en la ficha y otro en el directorio.
function sincronizar(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  entidad: Entidad,
  direccion: Direccion,
  previo: EstadoPrevio,
  despues: Record<string, unknown> | null,
  antes: Record<string, unknown> | null,
): void {
  const id = idDe(entidad, direccion);

  if (entidad.id === 'lugares') {
    if (!previo.lugar) return;
    // El borrado en cascada ya despublica; aqui solo se republica lo vivo.
    if (despues) {
      publicar(tx, ctx.db, 'lugaresPublicos', direccion.propio,
        documentoPublicoLugar(comoLugar(despues), previo.insumos.map(({ datos }) => datos)));
      ajustarContadores(tx, ctx.db, deltaTipo(s(previo.lugar.tipo, 20), s(despues.tipo, 20)));
    }
    return;
  }

  if (entidad.id === 'insumos') {
    if (!previo.lugar) return;
    // Se recompone la lista en memoria: el insumo tocado sustituye al de antes,
    // o desaparece si se borro.
    const insumos = previo.insumos
      .filter(({ id: clave }) => clave !== direccion.propio)
      .map(({ datos }) => datos);
    if (despues) insumos.push(comoInsumo(despues));
    publicar(tx, ctx.db, 'lugaresPublicos', direccion.padre,
      documentoPublicoLugar(previo.lugar, insumos));
    return;
  }

  if (entidad.id === 'motorizados') {
    if (!despues) {
      despublicar(tx, ctx.db, PROYECCION_MOTORIZADOS, id);
      ajustarContadores(tx, ctx.db, { motorizadosRegistrados: -1 });
      return;
    }
    publicar(tx, ctx.db, PROYECCION_MOTORIZADOS, id, {
      ...documentoPublicoMotorizado({
        nombre: s(despues.nombre, 120),
        tipoVehiculo: s(despues.tipoVehiculo, 40) || 'Moto',
        zonaOperacion: s(despues.zonaOperacion, 120),
        telefono: s(despues.telefono, 40),
        activo: despues.activo !== false,
        createdAt: despues.createdAt,
      }),
      totalTrayectos: n(despues.totalTrayectos),
      totalKm: n(despues.totalKm),
      aporteDonado: n(despues.aporteDonado),
      ultimoTrayecto: comoFecha(despues.ultimoTrayecto),
    });
    if (!antes) ajustarContadores(tx, ctx.db, { motorizadosRegistrados: 1 });
    return;
  }

  if (entidad.id === 'voluntarios') {
    // El perfil publico de un voluntario existe SOLO con su consentimiento: la
    // consola no lo concede ni lo revoca, solo mantiene lo que ya haya.
    if (!despues) {
      despublicar(tx, ctx.db, 'voluntariosPublicos', id);
      ajustarContadores(tx, ctx.db, { voluntariosActivos: -1 });
      return;
    }
    if (consentimientoActivo(despues)) {
      publicar(tx, ctx.db, 'voluntariosPublicos', id, {
        nombre: s(despues.nombre, 120),
        zona: s(despues.ciudad, 80),
        habilidades: s(despues.profesion, 80),
        activo: despues.activo !== false,
        createdAt: comoFecha(despues.createdAt) ?? new Date(0),
      });
    }
    if (!antes) ajustarContadores(tx, ctx.db, { voluntariosActivos: 1 });
    return;
  }

  if (entidad.id === 'vacantes_voluntarios') {
    if (!despues) {
      despublicar(tx, ctx.db, PROYECCION_VACANTES, id);
      return;
    }
    const vacante = comoVacante(despues);
    if (debePublicarse(vacante)) publicar(tx, ctx.db, PROYECCION_VACANTES, id, vacantePublica(vacante));
    else despublicar(tx, ctx.db, PROYECCION_VACANTES, id);
    return;
  }

  if (entidad.id === 'personas') {
    // `personasLocalizadas` cuenta por estado, asi que editar el estado de una
    // persona reportada mueve el tablero aunque no cree ni borre nada.
    const deltas: Deltas = {};
    const eraLocalizada = antes ? personaLocalizada(antes.estado) : false;
    const esLocalizada = despues ? personaLocalizada(despues.estado) : false;
    if (!antes && despues) deltas.personasReportadas = 1;
    if (antes && !despues) deltas.personasReportadas = -1;
    if (eraLocalizada !== esLocalizada) deltas.personasLocalizadas = esLocalizada ? 1 : -1;
    if (Object.keys(deltas).length) ajustarContadores(tx, ctx.db, deltas);
    return;
  }

  if (entidad.id === 'centros_panel' && !despues && previo.lugar) {
    // Revocar el acceso deja al centro sin gestor: hay que reflejarlo en su
    // vista publica (`gestionado`), no solo borrar la credencial.
    const sinGestor: Lugar = { ...previo.lugar, panelUid: null, actualizado: ctx.now };
    tx.set(base(ctx).collection('lugares').doc(direccion.propio) as unknown as { path?: string },
      { panelUid: null, actualizado: ctx.now }, { merge: true });
    publicar(tx, ctx.db, 'lugaresPublicos', direccion.propio,
      documentoPublicoLugar(sinGestor, previo.insumos.map(({ datos }) => datos)));
  }
}

// --- Duplicados ----------------------------------------------------------------

export type Duplicado = { id: string; etiqueta: string; porque: string };

function clavesNaturalesDe(
  entidad: Entidad,
  fila: Record<string, unknown>,
): Array<{ porque: string; clave: string }> {
  const salida: Array<{ porque: string; clave: string }> = [];
  for (const natural of entidad.naturales) {
    const partes = natural.campos.map((campo) => normaClave(fila[campo], natural.norma));
    // Una parte vacia invalida la clave entera: dos filas sin telefono no son
    // duplicados por telefono.
    if (partes.some((parte) => !parte)) continue;
    salida.push({ porque: natural.campos.join(' + '), clave: partes.join('|') });
  }
  return salida;
}

// Escanea la ventana acotada y compara claves naturales. Como el legado, informa;
// no fusiona ni borra.
async function buscarDuplicados(
  ctx: ActionContext,
  entidad: Entidad,
  fila: Record<string, unknown>,
  excluir: string | null,
): Promise<Duplicado[]> {
  const claves = clavesNaturalesDe(entidad, fila);
  if (!claves.length) return [];

  const filas = await escanear(ctx, entidad, TOPE_DUPLICADOS);
  const salida: Duplicado[] = [];
  for (const candidata of filas) {
    const id = String(candidata.id);
    if (excluir !== null && id === excluir) continue;
    for (const { porque, clave } of claves) {
      if (clavesNaturalesDe(entidad, candidata).some((otra) => otra.porque === porque && otra.clave === clave)) {
        salida.push({ id, etiqueta: String(candidata[entidad.etiqueta] ?? id), porque });
        break;
      }
    }
  }
  return salida;
}

// --- Lectura de la ventana -----------------------------------------------------

// Una sola lectura acotada por accion: `admin_datos_listar`, `duplicados` y el
// recuento de dependientes trabajan sobre ella. Un insumo vive en la
// subcoleccion de su centro, asi que se lee por grupo de colecciones.
async function escanear(
  ctx: ActionContext,
  entidad: Entidad,
  tope: number,
): Promise<Array<Record<string, unknown>>> {
  const db = firestore(ctx);

  if (entidad.subcoleccionDe) {
    const grupo = db.collectionGroup?.(entidad.coleccion);
    if (!grupo) return [];
    const { docs } = await grupo.limit(tope).get();
    return docs.map((documento) => {
      const datos = (documento.data() ?? {}) as Record<string, unknown>;
      // `path` es `lugares/<LUG-…>/insumos/<clave>`: de ahi sale el id compuesto.
      const partes = String((documento as unknown as { ref?: { path?: string } }).ref?.path ?? '').split('/');
      const lugarId = partes.length >= 2 ? partes[1]! : s(datos.lugarId, 128);
      return aFila(entidad, `${lugarId}/${documento.id}`, datos);
    }).sort((a, b) => String(a[entidad.etiqueta] ?? '').localeCompare(String(b[entidad.etiqueta] ?? '')));
  }

  const { docs } = await db.collection(entidad.coleccion)
    .orderBy(entidad.orden, entidad.ordenAsc ? 'asc' : 'desc')
    .limit(tope)
    .get();
  return docs.map((documento) => aFila(entidad, documento.id, (documento.data() ?? {}) as Record<string, unknown>));
}

function coincide(entidad: Entidad, fila: Record<string, unknown>, busca: string): boolean {
  if (!busca) return true;
  const aguja = normaClave(busca, 'texto');
  return entidad.buscar.some((columna) => normaClave(fila[columna], 'texto').includes(aguja));
}

// --- Dependientes ---------------------------------------------------------------

export type Dependiente = { etiqueta: string; cuantos: number; modo: 'cascade' | 'null' };

async function contarDependientes(
  ctx: ActionContext,
  entidad: Entidad,
  direccion: Direccion,
): Promise<Dependiente[]> {
  const db = firestore(ctx);
  const salida: Dependiente[] = [];

  if (entidad.id === 'lugares') {
    const insumos = await db.collection('lugares').doc(direccion.propio)
      .collection('insumos').limit(TOPE_HIJOS).get();
    if (insumos.docs.length) salida.push({ etiqueta: 'insumos', cuantos: insumos.docs.length, modo: 'cascade' });
    const panel = await db.collection(COLECCION_PANEL).doc(direccion.propio).get();
    if (panel.exists) salida.push({ etiqueta: 'accesos de panel', cuantos: 1, modo: 'cascade' });
    return salida;
  }

  if (entidad.id === 'motorizados') {
    for (const [coleccion, etiqueta] of [['trayectos', 'trayectos'], ['donacionesMotorizados', 'aportes recibidos']] as const) {
      const { docs } = await db.collection(coleccion)
        .where('motorizadoId', '==', direccion.propio)
        .limit(TOPE_HIJOS)
        .get();
      if (docs.length) salida.push({ etiqueta, cuantos: docs.length, modo: 'null' });
    }
  }

  return salida;
}

// --- Escritura -----------------------------------------------------------------

// Comprueba que el centro al que apunta un `refLugar` existe de verdad.
async function exigirCentros(tx: TransaccionMinima, ctx: ContextoMinimo, ids: string[]): Promise<void> {
  for (const lugarId of ids) {
    const documento = await tx.get(base(ctx).collection('lugares').doc(lugarId));
    if (!documento.exists) throw new ApiError('lugar_id: ese centro no existe');
  }
}

// Campos que la consola nunca escribe pero que el documento necesita para seguir
// siendo valido: se derivan de lo que si se edita.
function derivados(entidad: Entidad, canonico: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (typeof canonico.nombre === 'string') {
    if (entidad.id === 'lugares' || entidad.id === 'personas') extra.nombreNorm = normalizar(canonico.nombre);
    if (entidad.id === 'vacantes_voluntarios') extra.lugarNombreNorm = normalizar(canonico.lugarNombre);
  }
  if (entidad.id === 'vacantes_voluntarios' && typeof canonico.lugarNombre === 'string') {
    extra.lugarNombreNorm = normalizar(canonico.lugarNombre);
  }
  // La cedula solo se compara por igualdad, nunca se devuelve: su forma
  // normalizada es la que usa `buscar_familiar`.
  if (entidad.id === 'personas' && typeof canonico.cedula === 'string') {
    extra.cedulaNorm = soloDigitos(canonico.cedula);
  }
  return extra;
}

// --- Acciones -------------------------------------------------------------------

defineAction({
  nombre: 'admin_datos_entidades',
  auth: 'admin',
  cubo: 'adminLectura',
  async handler(): Promise<ActionResult> {
    // Solo lee la constante: es el catalogo con el que el cliente pinta el
    // formulario y valida antes de enviar.
    return {
      entidades: ENTIDADES.map((entidad) => ({
        id: entidad.id,
        etiqueta: entidad.etiqueta,
        pk: 'id',
        borrado: 'fisico',
        columnas: entidad.editables.map((col) => ({
          id: col.id,
          tipo: col.tipo,
          ...(col.max === undefined ? {} : { max: col.max }),
          ...(col.opciones === undefined ? {} : { opciones: [...col.opciones] }),
          ...(col.requerido === undefined ? {} : { requerido: col.requerido }),
          ...(col.minNum === undefined ? {} : { minNum: col.minNum }),
          ...(col.maxNum === undefined ? {} : { maxNum: col.maxNum }),
        })),
        fotos: [...entidad.fotos],
        hijos: entidad.hijos.map((hijo) => ({ ...hijo })),
      })),
    };
  },
});

defineAction({
  nombre: 'admin_datos_listar',
  auth: 'admin',
  cubo: 'adminLectura',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    const porPagina = Math.min(POR_PAGINA_MAX, Math.max(POR_PAGINA_MIN, Math.round(n(payload.porPagina)) || POR_PAGINA_DEFECTO));
    const pagina = Math.max(1, Math.round(n(payload.pagina)) || 1);
    const busca = s(payload.busca, 80);

    // El legado mandaba el texto del usuario al `ilike` de PostgREST: `%` y `_`
    // llegaban como comodines (buscar `%` listaba la tabla entera) y `(`, `)`,
    // `,` y `*` se borraban para que no rompieran la sintaxis del filtro. Aqui
    // no hay lenguaje de patrones que romper: el texto se normaliza igual que
    // una clave natural y se compara como subcadena.
    const filas = await escanear(ctx, entidad, TOPE_ESCANEO);
    const filtradas = busca ? filas.filter((fila) => coincide(entidad, fila, busca)) : filas;
    const desde = (pagina - 1) * porPagina;

    return {
      filas: filtradas.slice(desde, desde + porPagina),
      total: filtradas.length,
      pagina,
      porPagina,
      // Honestidad sobre el tope: sin esto, «250 de 250» en una coleccion de
      // 900 pareceria la cuenta real.
      truncado: filas.length >= TOPE_ESCANEO,
    };
  },
});

defineAction({
  nombre: 'admin_datos_ficha',
  auth: 'admin',
  cubo: 'adminLectura',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    const direccion = direccionDe(entidad, payload.id);
    const db = firestore(ctx);

    const documento = await referenciaDe(db, entidad, direccion).get();
    if (!documento.exists) throw new ApiError(NO_ENCONTRADO, 404);

    const fila = aFila(entidad, idDe(entidad, direccion), (documento.data() ?? {}) as Record<string, unknown>);
    const dependientes = await contarDependientes(ctx, entidad, direccion);

    return {
      fila,
      // RUTAS, no URLs firmadas: el legado firmaba una URL de una hora por cada
      // foto en cada apertura de la ficha. La consola pide la firma de la que va
      // a abrir, con el endpoint de archivos privados.
      fotos: entidad.fotos
        .map((campo) => ({ campo, path: s(fila[campo], 300) }))
        .filter((foto) => foto.path),
      dependientes,
    };
  },
});

defineAction({
  nombre: 'admin_datos_crear',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    const validados = camposValidados(entidad, (payload.campos ?? {}) as Record<string, unknown>, false);
    const canonico = aCanonico(entidad, validados);
    const forzar = payload.forzar === true;

    // Los duplicados se comprueban ANTES de escribir y fuera de la transaccion:
    // es un escaneo de hasta 2000 filas, y meterlo dentro la haria fallar por
    // tamano en cuanto la coleccion creciera.
    const comoLegado = Object.fromEntries(validados.porColumna);
    const duplicados = await buscarDuplicados(ctx, entidad, comoLegado, null);
    if (duplicados.length && !forzar) return { duplicados };

    // `centros_panel` no se crea desde aqui: su credencial es un claim de Auth
    // que concede `panel_crear`, no una fila que se pueda teclear.
    if (entidad.id === 'centros_panel') throw new ApiError(MENSAJE_FUERA);

    const db = firestore(ctx);

    return (db as unknown as FirestoreConsola).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      await exigirCentros(tx, ctxMin, validados.refsLugar);

      // Un centro se crea por el mismo camino que `registrar_lugar`: reserva su
      // nombre en el indice de unicidad y publica su proyeccion.
      if (entidad.id === 'lugares') {
        const { lugarId, lugar } = await crearLugar(tx, ctx, {
          nombre: s(canonico.nombre, 120),
          tipo: s(canonico.tipo, 20),
          ubicacion: s(canonico.ubicacion, 300),
          telefono: s(canonico.telefono, 40),
          lat: canonico.lat === null || canonico.lat === undefined ? null : Number(canonico.lat),
          lng: canonico.lng === null || canonico.lng === undefined ? null : Number(canonico.lng),
          panelUid: null,
        }, 'Ya existe un registro con ese valor único');

        const fila = aFila(entidad, lugarId, { ...lugar });
        auditar(tx, ctxMin, { accion: 'crear', entidad: entidad.id, entidadId: lugarId, despues: fila });
        return { fila, duplicados: [] };
      }

      const direccion: Direccion = entidad.subcoleccionDe
        ? { padre: s(canonico.lugarId, 128), propio: claveInsumo(canonico.nombre) }
        : { padre: '', propio: idEntidad(entidad.prefijoId ?? 'REG') };

      const documento: Record<string, unknown> = {
        ...canonico,
        ...derivados(entidad, canonico),
        activo: true,
        createdAt: ctx.now,
        actualizado: ctx.now,
      };
      // Un insumo se direcciona por su clave; guardar ademas el id del centro
      // seria un segundo sitio donde equivocarse.
      delete documento.lugarId;

      const previo = await prepararSincronizacion(tx, ctxMin, entidad, direccion);
      tx.set(referenciaDe(db, entidad, direccion) as unknown as { path?: string }, documento);
      sincronizar(tx, ctxMin, entidad, direccion, previo, documento, null);

      const id = idDe(entidad, direccion);
      const fila = aFila(entidad, id, documento);
      auditar(tx, ctxMin, { accion: 'crear', entidad: entidad.id, entidadId: id, despues: fila });
      return { fila, duplicados: [] };
    });
  },
});

defineAction({
  nombre: 'admin_datos_editar',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    const direccion = direccionDe(entidad, payload.id);
    const id = idDe(entidad, direccion);
    const validados = camposValidados(entidad, (payload.campos ?? {}) as Record<string, unknown>, true);
    const canonico = aCanonico(entidad, validados);
    const forzar = payload.forzar === true;

    const db = firestore(ctx);
    const previo = await referenciaDe(db, entidad, direccion).get();
    if (!previo.exists) throw new ApiError(NO_ENCONTRADO, 404);
    const datosPrevios = (previo.data() ?? {}) as Record<string, unknown>;
    const filaPrevia = aFila(entidad, id, datosPrevios);

    // Se compara la fila RESULTANTE, excluyendose a si misma.
    const resultante = { ...filaPrevia, ...Object.fromEntries(validados.porColumna) };
    const duplicados = await buscarDuplicados(ctx, entidad, resultante, id);
    if (duplicados.length && !forzar) return { duplicados };

    return (db as unknown as FirestoreConsola).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      await exigirCentros(tx, ctxMin, validados.refsLugar);

      const referencia = referenciaDe(db, entidad, direccion);
      const actual = await tx.get(referencia);
      if (!actual.exists) throw new ApiError(NO_ENCONTRADO, 404);
      const antes = (actual.data() ?? {}) as Record<string, unknown>;
      const previo = await prepararSincronizacion(tx, ctxMin, entidad, direccion);

      // Renombrar un centro mueve su reserva en el indice de unicidad. Sin esto
      // el nombre viejo quedaria tomado para siempre y el nuevo, libre para que
      // otro centro se lo llevara.
      if (entidad.id === 'lugares' && typeof canonico.nombre === 'string') {
        const nombreNuevo = s(canonico.nombre, 120);
        const nombreViejo = s(antes.nombre, 120);
        if (normalizar(nombreNuevo) !== normalizar(nombreViejo)) {
          await reservarClaveUnica(
            tx, ctxMin, INDICE_NOMBRE, nombreNuevo, direccion.propio,
            'Ya existe un registro con ese valor único',
          );
          liberarClaveUnica(tx, ctxMin, INDICE_NOMBRE, nombreViejo);
        }
      }

      const despues: Record<string, unknown> = {
        ...antes, ...canonico, ...derivados(entidad, { ...antes, ...canonico }), actualizado: ctx.now,
      };
      delete despues.lugarId;

      tx.set(referencia as unknown as { path?: string }, despues);
      sincronizar(tx, ctxMin, entidad, direccion, previo, despues, antes);

      const fila = aFila(entidad, id, despues);
      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: entidad.id,
        entidadId: id,
        antes: aFila(entidad, id, antes),
        despues: fila,
      });

      // `cambiados` son las columnas ENVIADAS y validadas, no las que de verdad
      // cambiaron de valor: es lo que el legado devolvia y lo que la consola
      // enseña como «se guardaron estos campos».
      return { fila, cambiados: [...validados.porColumna.keys()] };
    });
  },
});

defineAction({
  nombre: 'admin_datos_duplicados',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    if (!entidad.naturales.length) return { grupos: [] };

    const filas = await escanear(ctx, entidad, TOPE_DUPLICADOS);
    const grupos = new Map<string, { porque: string; clave: string; filas: Array<{ id: string; etiqueta: string }> }>();

    for (const fila of filas) {
      const id = String(fila.id);
      for (const { porque, clave } of clavesNaturalesDe(entidad, fila)) {
        const llave = `${porque}::${clave}`;
        const grupo = grupos.get(llave) ?? { porque, clave, filas: [] };
        grupo.filas.push({ id, etiqueta: String(fila[entidad.etiqueta] ?? id) });
        grupos.set(llave, grupo);
      }
    }

    return { grupos: [...grupos.values()].filter((grupo) => grupo.filas.length > 1) };
  },
});

defineAction({
  nombre: 'admin_datos_borrar',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const entidad = entidadDe(payload.entidad);
    const direccion = direccionDe(entidad, payload.id);
    const id = idDe(entidad, direccion);
    const db = firestore(ctx);

    const previo = await referenciaDe(db, entidad, direccion).get();
    if (!previo.exists) throw new ApiError(NO_ENCONTRADO, 404);
    const antes = aFila(entidad, id, (previo.data() ?? {}) as Record<string, unknown>);

    // Hay que ESCRIBIR la etiqueta. Un «¿seguro?» se acepta sin leerlo; teclear
    // el nombre obliga a mirar qué se está borrando. La comparación va sin
    // acentos, en minúsculas y con espacios colapsados.
    const esperado = normaClave(antes[entidad.etiqueta], 'texto');
    if (!esperado || normaClave(payload.confirmar, 'texto') !== esperado) {
      throw new ApiError(CONFIRMA_BORRADO);
    }

    // Se cuentan ANTES del borrado: después de la cascada ya no hay a quién contar.
    const dependientes = await contarDependientes(ctx, entidad, direccion);

    return (db as unknown as FirestoreConsola).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      if (entidad.id === 'lugares') {
        // Firestore no tiene `on delete cascade`: los insumos, el acceso de
        // panel, la proyección y la reserva del nombre se sueltan a mano.
        await borrarLugarEnCascada(tx, ctx, direccion.propio);
      } else {
        const referencia = referenciaDe(db, entidad, direccion);
        const actual = await tx.get(referencia);
        if (!actual.exists) throw new ApiError(NO_ENCONTRADO, 404);
        const datos = (actual.data() ?? {}) as Record<string, unknown>;
        const previo = await prepararSincronizacion(tx, ctxMin, entidad, direccion);
        tx.delete(referencia as unknown as { path?: string });
        sincronizar(tx, ctxMin, entidad, direccion, previo, null, datos);
      }

      // La bitácora guarda la fila entera y lo que se llevó por delante: es lo
      // único que queda de un borrado físico.
      auditar(tx, ctxMin, {
        accion: 'borrar',
        entidad: entidad.id,
        entidadId: id,
        antes: { fila: antes, dependientes },
      });

      return { borrado: true, dependientes };
    });
  },
});

defineAction({
  nombre: 'admin_bitacora',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const pagina = Math.max(1, Math.round(n(payload.pagina)) || 1);
    const filtro = s(payload.entidad, 40);
    const db = firestore(ctx);

    // Se lee la ventana entera y se pagina en memoria: `auditoriaAdmin` no tiene
    // indice compuesto por (entidad, fecha) y crearlo por una pantalla que casi
    // siempre mira la primera pagina no compensa.
    let consulta: Consulta = db.collection(COLECCION_AUDITORIA).orderBy('fecha', 'desc');
    if (filtro) consulta = db.collection(COLECCION_AUDITORIA).where('entidad', '==', filtro).orderBy('fecha', 'desc');
    const { docs } = await consulta.limit(TOPE_ESCANEO).get();

    const desde = (pagina - 1) * TOPE_BITACORA;
    return {
      cambios: docs.slice(desde, desde + TOPE_BITACORA).map((documento) => {
        const datos = (documento.data() ?? {}) as Record<string, unknown>;
        return {
          id: documento.id,
          fecha: iso(datos.fecha),
          ip: s(datos.ip, 60),
          accion: s(datos.accion, 20),
          entidad: s(datos.entidad, 60),
          fila_id: s(datos.entidadId, 200),
          // `actorUid` en vez de un correo: quien firmó el cambio es el uid del
          // ID token, y `auditar` ya enmascara los correos que caigan dentro.
          actor_uid: s(datos.actorUid, 128),
          antes: datos.antes ?? null,
          despues: datos.despues ?? null,
        };
      }),
      total: docs.length,
      pagina,
    };
  },
});

defineAction({
  nombre: 'admin_datos_deshacer',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    // En el legado era un entero autoincremental; en Firestore el id del
    // documento de bitácora es texto.
    const auditoriaId = s(payload.auditoriaId, 200);
    if (!auditoriaId) throw new ApiError('No se encontró ese cambio en la bitácora', 404);

    const db = firestore(ctx);
    const registro = await db.collection(COLECCION_AUDITORIA).doc(auditoriaId).get();
    if (!registro.exists) throw new ApiError('No se encontró ese cambio en la bitácora', 404);

    const cambio = (registro.data() ?? {}) as Record<string, unknown>;
    if (s(cambio.accion, 20) !== 'editar') throw new ApiError('Solo se puede deshacer una edición');

    // Protege contra una entidad retirada de la lista blanca después del cambio.
    const entidad = entidadDe(cambio.entidad);
    const direccion = direccionDe(entidad, cambio.entidadId);
    const id = idDe(entidad, direccion);

    // Se filtra por la lista blanca VIGENTE: deshacer nunca escribe una columna
    // que una edición normal no podría tocar hoy.
    //
    // Y NUNCA un correo: `auditar` los enmascara al escribir la bitácora
    // (`ana@x.local` queda como `a***@x.local`), así que restaurarlo desde ahí
    // machacaría el correo bueno del registro con la máscara —que además pasa
    // la validación de correo, así que fallaría en silencio—. Lo que la bitácora
    // no guarda no se puede deshacer: se deja como está.
    const antes = (cambio.antes && typeof cambio.antes === 'object' ? cambio.antes : {}) as Record<string, unknown>;
    const restaurables = new Map(entidad.editables.map((col) => [col.id, col]));
    const soloEditables: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(antes)) {
      const col = restaurables.get(clave);
      if (col && col.tipo !== 'email') soloEditables[clave] = valor;
    }

    // Revalida los valores viejos con las reglas de hoy: si se endurecieron, la
    // restauración falla con el mismo mensaje que una edición.
    const validados = camposValidados(entidad, soloEditables, true);
    const canonico = aCanonico(entidad, validados);

    return (db as unknown as FirestoreConsola).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = referenciaDe(db, entidad, direccion);
      const actual = await tx.get(referencia);
      if (!actual.exists) throw new ApiError('Ese registro ya no existe', 404);
      const datosActuales = (actual.data() ?? {}) as Record<string, unknown>;
      const previo = await prepararSincronizacion(tx, ctxMin, entidad, direccion);

      const despues: Record<string, unknown> = {
        ...datosActuales,
        ...canonico,
        ...derivados(entidad, { ...datosActuales, ...canonico }),
        actualizado: ctx.now,
      };
      delete despues.lugarId;

      tx.set(referencia as unknown as { path?: string }, despues);
      sincronizar(tx, ctxMin, entidad, direccion, previo, despues, datosActuales);

      const fila = aFila(entidad, id, despues);
      // El deshacer genera SU PROPIA entrada, y no es deshacible: su acción es
      // `deshacer`, y solo se deshacen las `editar`.
      auditar(tx, ctxMin, {
        accion: 'deshacer',
        entidad: entidad.id,
        entidadId: id,
        antes: aFila(entidad, id, datosActuales),
        despues: fila,
      });

      return { fila };
    });
  },
});

import { getAuth } from 'firebase-admin/auth';
import {
  ApiError,
  ESTADOS_INSUMO,
  TIPOS_LUGAR,
  URGENCIAS,
  coordsPublicas,
  emailNorm,
  geoValida,
  idEntidad,
  n,
  normalizar,
  opcion,
  s,
  soloDigitos,
} from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar, historial, liberarClaveUnica, reservarClaveUnica } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { ajustarContadores } from './estadisticas.js';
import { despublicar, publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: lugares, sus insumos, la bitacora por centro y el panel del centro.
//
// Modelo (plan 2026-09-06, Task 3.1):
//   lugares/{lugarId}                       canonico, privado
//   lugares/{lugarId}/insumos/{insumoNorm}  subcoleccion
//   lugaresPublicos/{lugarId}               proyeccion publica (misma transaccion)
//   centrosPanel/{lugarId}                  correo enmascarado + paths de las fotos
//   indices/lugaresPorNombre/claves/{norm}  unicidad del nombre
//
// El `lugarId` es un id opaco del servidor (`LUG-XXXXXXXX`), no deriva del
// nombre: renombrar un centro no obliga a mover documentos ni invalida el claim
// `panelLugarId` de un panel ya emitido. La busqueda por nombre pasa siempre por
// el indice de unicidad, que es lo unico que hay que mantener al renombrar.
//
// El acceso al panel ya no es `token CTR-… + PIN`: es Firebase Auth con claims
// `{ role: 'panel', panelLugarId }`. El PIN y el token desaparecen del sistema.

export const PREFIJO_LUGAR = 'LUG';
export const COLECCION = 'lugares';
export const SUBCOLECCION_INSUMOS = 'insumos';
export const COLECCION_PANEL = 'centrosPanel';
export const PROYECCION = 'lugaresPublicos';
export const INDICE_NOMBRE = 'lugaresPorNombre';

// Tope de la unica accion que barre toda la base. El legado no ponia limite,
// pero en Firestore eso es una lectura facturada por insumo en cada apertura del
// asistente de presupuestos. Se avisa con `truncado` en vez de callar el corte.
export const TOPE_NECESIDADES = 500;

// El formulario publico ofrece dos etiquetas que no estan en las enumeraciones
// canonicas. El legado degradaba 'Tiene disponible' a 'Necesita' en silencio, es
// decir: quien avisaba de que TENIA insumos quedaba publicado como que los
// NECESITABA. Aqui se mapean a lo que la persona quiso decir.
const ALIAS_TIPO: Record<string, string> = { 'punto de ayuda': 'Centro' };
const ALIAS_ESTADO: Record<string, string> = {
  'tiene disponible': 'Disponible',
  disponible: 'Disponible',
  cubierto: 'Cubierto',
  necesita: 'Necesita',
};

// --- Superficie minima de Firestore ------------------------------------------

type DocumentoSnapshot = { exists: boolean; data(): Record<string, unknown> | undefined };
type ConsultaSnapshot = { docs: Array<{ id: string; data(): Record<string, unknown> }> };
type Referencia = { path?: string };
type Subcoleccion = Referencia & { doc(id: string): Referencia };
type DocumentoLugar = Referencia & { collection(nombre: string): Subcoleccion };

// La `Transaction` real de Firestore sobrecarga `get` para documentos y para
// consultas; `TransaccionMinima` solo declara la de documentos, y una
// sobrecarga estructural aqui se resolveria siempre por la primera firma. La
// lectura de subcolecciones pasa por esta costura, con el molde a la vista.
export type TxLugares = TransaccionMinima;

async function leerSubcoleccion(tx: TxLugares, sub: Subcoleccion): Promise<ConsultaSnapshot> {
  const consulta = tx as unknown as { get(referencia: Subcoleccion): Promise<ConsultaSnapshot> };
  return consulta.get(sub);
}

// No intersecta con `FirestoreMinimo`: alli `collection().doc()` devuelve una
// referencia plana y la interseccion resolveria por esa firma, sin subcoleccion.
export type FirestoreLugares = {
  collection(nombre: string): { doc(id?: string): DocumentoLugar };
  runTransaction<T>(fn: (tx: TxLugares) => Promise<T>): Promise<T>;
};

// `TransaccionMinima.get` devuelve `data(): unknown` porque sirve a todos los
// dominios; aqui ya se sabe que es un documento con campos.
function datosDe(snapshot: { data(): unknown }): Record<string, unknown> {
  return (snapshot.data() ?? {}) as Record<string, unknown>;
}

export type Lugar = {
  tipo: string;
  nombre: string;
  nombreNorm: string;
  ubicacion: string;
  telefono: string;
  lat: number | null;
  lng: number | null;
  activo: boolean;
  panelUid: string | null;
  actualizado: Date;
};

export type Insumo = {
  nombre: string;
  categoria: string;
  estado: string;
  cantidadNecesaria: number;
  cantidadRecibida: number;
  urgencia: string;
  unidad: string;
  actualizado: Date;
};

// --- Costuras que rellenan otras tareas --------------------------------------

// `panel_insumo` cierra la factura de la necesidad cuando el centro registra lo
// recibido. Esa logica es de la Task 3.4 (facturas): aqui solo queda el punto de
// enganche, para no duplicar el modelo de facturas en este dominio.
export type RegistroDeEntrega = (
  tx: TxLugares,
  ctx: ContextoMinimo,
  datos: {
    centro: string;
    insumo: string;
    unidad: string;
    delta: number;
    recibida: number;
    necesaria: number;
  },
) => Promise<void> | void;

let registrarEntrega: RegistroDeEntrega | null = null;

export function conectarRegistroDeEntregas(fn: RegistroDeEntrega | null): void {
  registrarEntrega = fn;
}

// Los claims no se pueden escribir dentro de una transaccion de Firestore, asi
// que Auth entra por aqui y las pruebas lo sustituyen.
export type AuthAdmin = {
  getUserByEmail(email: string): Promise<{ uid: string }>;
  getUser(uid: string): Promise<{ uid: string; customClaims?: Record<string, unknown> | null }>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
};

let authAdmin: AuthAdmin | null = null;

export function usarAuthAdmin(auth: AuthAdmin | null): void {
  authAdmin = auth;
}

function obtenerAuthAdmin(): AuthAdmin {
  return authAdmin ?? (getAuth() as unknown as AuthAdmin);
}

// `setCustomUserClaims` REEMPLAZA el objeto entero, no fusiona. Escribir
// `{ role: 'panel', … }` a secas degradaria a un administrador que registre su
// propio centro, y no hay ninguna accion que le devuelva el rol.
async function asignarPanel(uid: string, lugarId: string): Promise<void> {
  const auth = obtenerAuthAdmin();
  let previos: Record<string, unknown> = {};
  try {
    previos = (await auth.getUser(uid)).customClaims ?? {};
  } catch {
    // Cuenta sin claims todavia: se parte de cero.
  }
  const rol = previos.role === 'admin' ? 'admin' : 'panel';
  await auth.setCustomUserClaims(uid, { ...previos, role: rol, panelLugarId: lugarId });
}

// Quitar el centro a quien lo administraba. Limpiar el claim no basta por si
// solo: un ID token ya emitido vive hasta una hora, asi que ademas se revocan
// sus tokens de refresco y `cargarPanel` comprueba la propiedad en cada accion.
async function revocarPanel(uid: string): Promise<void> {
  const auth = obtenerAuthAdmin();
  let previos: Record<string, unknown> = {};
  try {
    previos = (await auth.getUser(uid)).customClaims ?? {};
  } catch {
    return;
  }
  const { panelLugarId: _panel, ...resto } = previos;
  const rol = previos.role === 'admin' ? 'admin' : 'user';
  await auth.setCustomUserClaims(uid, { ...resto, role: rol });
  await auth.revokeRefreshTokens(uid);
}

// --- Saneamiento -------------------------------------------------------------

// Id de documento del insumo. Coincide con el que ya usa la semilla
// (`normalizar()`, con espacios) y ademas sustituye la barra, que `normalizar`
// no toca y Firestore no admite en un id.
// Referencia a la subcoleccion de insumos de un centro, para la consola.
export function refInsumosDe(db: FirestoreLugares, lugarId: string) {
  return refInsumos(db, lugarId);
}

export function claveInsumo(nombre: unknown): string {
  const clave = normalizar(nombre).replace(/\//g, '-').slice(0, 200);
  return clave === '.' || clave === '..' ? `_${clave}` : clave;
}

export function tipoLugar(valor: unknown): string {
  const texto = s(valor, 40);
  const alias = ALIAS_TIPO[normalizar(texto)];
  if (alias) return alias;
  return (TIPOS_LUGAR as readonly string[]).includes(texto) ? texto : 'Centro';
}

export function estadoInsumo(valor: unknown): string {
  const texto = s(valor, 40);
  if ((ESTADOS_INSUMO as readonly string[]).includes(texto)) return texto;
  return ALIAS_ESTADO[normalizar(texto)] ?? 'Necesita';
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

function firestore(ctx: ActionContext): FirestoreLugares {
  return ctx.db as unknown as FirestoreLugares;
}

// --- Lectura ------------------------------------------------------------------

function refLugar(db: FirestoreLugares, lugarId: string): DocumentoLugar {
  return db.collection(COLECCION).doc(lugarId);
}

function refInsumos(db: FirestoreLugares, lugarId: string): Subcoleccion {
  return refLugar(db, lugarId).collection(SUBCOLECCION_INSUMOS);
}

// Firestore devuelve las fechas como `Timestamp`, no como `Date`: sin esta
// conversion toda `actualizado` releida volveria como 1970 y el directorio
// mostraria «actualizado hace 56 anos» en cada centro.
function comoFecha(valor: unknown): Date {
  if (valor instanceof Date) return valor;
  const marca = valor as { toDate?: () => Date } | null;
  if (marca && typeof marca.toDate === 'function') return marca.toDate();
  return new Date(0);
}

// `Number(null)` es 0 y `Number.isFinite(0)` es cierto: sin descartar null y ''
// primero, un centro sin coordenadas se publicaria en 0,0 (golfo de Guinea).
function comoCoordenada(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export function comoLugar(datos: Record<string, unknown>): Lugar {
  return {
    tipo: s(datos.tipo, 40) || 'Centro',
    nombre: s(datos.nombre, 120),
    nombreNorm: s(datos.nombreNorm, 200) || normalizar(datos.nombre),
    ubicacion: s(datos.ubicacion, 300),
    telefono: s(datos.telefono, 40),
    lat: comoCoordenada(datos.lat),
    lng: comoCoordenada(datos.lng),
    activo: datos.activo !== false,
    panelUid: datos.panelUid ? s(datos.panelUid, 128) : null,
    actualizado: comoFecha(datos.actualizado),
  };
}

export function comoInsumo(datos: Record<string, unknown>): Insumo {
  return {
    nombre: s(datos.nombre, 120),
    categoria: s(datos.categoria, 60) || 'General',
    estado: estadoInsumo(datos.estado),
    cantidadNecesaria: n(datos.cantidadNecesaria),
    cantidadRecibida: n(datos.cantidadRecibida),
    urgencia: opcion(datos.urgencia, URGENCIAS, 'Normal'),
    unidad: s(datos.unidad, 30) || 'unidades',
    actualizado: comoFecha(datos.actualizado),
  };
}

export async function leerLugar(
  tx: TxLugares,
  db: FirestoreLugares,
  lugarId: string,
): Promise<Lugar | null> {
  const snapshot = await tx.get(refLugar(db, lugarId));
  return snapshot.exists ? comoLugar(datosDe(snapshot)) : null;
}

export async function leerInsumos(
  tx: TxLugares,
  db: FirestoreLugares,
  lugarId: string,
): Promise<Array<{ id: string; datos: Insumo }>> {
  const snapshot = await leerSubcoleccion(tx, refInsumos(db, lugarId));
  return snapshot.docs
    .map((doc) => ({ id: doc.id, datos: comoInsumo(doc.data()) }))
    .sort((a, b) => a.datos.nombre.localeCompare(b.datos.nombre));
}

// Un solo insumo por su clave. `donar_necesidad` (Task 3.4) solo necesita uno:
// leer la subcoleccion entera seria una lectura facturada por insumo del centro
// en cada donacion.
export async function leerInsumo(
  tx: TxLugares,
  db: FirestoreLugares,
  lugarId: string,
  clave: string,
): Promise<Insumo | null> {
  if (!clave) return null;
  const snapshot = await tx.get(refInsumos(db, lugarId).doc(clave));
  return snapshot.exists ? comoInsumo(datosDe(snapshot)) : null;
}

// Resuelve un nombre de centro a su id por el indice de unicidad. Es la unica
// via de busqueda por nombre: `lugares` no se consulta por `nombreNorm`.
export async function lugarIdPorNombre(
  tx: TxLugares,
  ctx: ContextoMinimo,
  nombre: unknown,
): Promise<string | null> {
  const clave = normalizar(nombre).replace(/\//g, '-').slice(0, 200);
  if (!clave) return null;
  const snapshot = await tx.get(
    (ctx.db as unknown as FirestoreLugares).collection(`indices/${INDICE_NOMBRE}/claves`).doc(clave),
  );
  if (!snapshot.exists) return null;
  const valor = datosDe(snapshot).valor;
  return valor ? String(valor) : null;
}

// --- Proyeccion ---------------------------------------------------------------

function insumoPublico(insumo: Insumo): Record<string, unknown> {
  const { cantidadNecesaria, cantidadRecibida } = insumo;
  return {
    nombre: insumo.nombre,
    categoria: insumo.categoria,
    cantidadNecesaria,
    cantidadRecibida,
    urgencia: insumo.urgencia,
    unidad: insumo.unidad,
    porcentaje: cantidadNecesaria > 0 ? Math.round((100 * cantidadRecibida) / cantidadNecesaria) : 0,
    yaCubierto: cantidadNecesaria > 0 && cantidadRecibida >= cantidadNecesaria,
  };
}

function porEstado(insumos: Insumo[], estado: string): Array<Record<string, unknown>> {
  return insumos.filter((insumo) => insumo.estado === estado).map(insumoPublico);
}

export function documentoPublico(lugar: Lugar, insumos: Insumo[]): Record<string, unknown> {
  const coords = lugar.lat !== null && lugar.lng !== null ? coordsPublicas(lugar.lat, lugar.lng) : null;
  return {
    nombre: lugar.nombre,
    nombreNorm: lugar.nombreNorm,
    tipo: lugar.tipo,
    ubicacionPublica: lugar.ubicacion,
    contactoPublico: lugar.telefono,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    // Derivado, no columna: un centro esta "gestionado" si alguien puede operar
    // su panel. Se recalcula en la misma transaccion que concede o revoca.
    gestionado: Boolean(lugar.panelUid),
    activo: lugar.activo,
    necesita: porEstado(insumos, 'Necesita'),
    tieneDisponible: porEstado(insumos, 'Disponible'),
    cubiertos: porEstado(insumos, 'Cubierto'),
  };
}

function republicar(
  tx: TxLugares,
  ctx: ContextoMinimo,
  lugarId: string,
  lugar: Lugar,
  insumos: Insumo[],
): void {
  publicar(tx, ctx.db, PROYECCION, lugarId, documentoPublico(lugar, insumos));
}

// Republica la proyeccion de un centro leyendo su estado canonico. La usa la
// consola de datos (Task 3.7) despues de tocar el centro o uno de sus insumos:
// la vista publica de un centro incluye sus insumos, asi que editar un insumo
// obliga a rehacerla entera.
export async function republicarLugar(
  tx: TxLugares,
  ctx: ContextoMinimo,
  lugarId: string,
): Promise<void> {
  const db = ctx.db as unknown as FirestoreLugares;
  const lugar = await leerLugar(tx, db, lugarId);
  if (!lugar) return;
  const insumos = await leerInsumos(tx, db, lugarId);
  republicar(tx, ctx, lugarId, lugar, insumos.map(({ datos }) => datos));
}

// --- Respuesta del panel ------------------------------------------------------

// Forma exacta que espera `js/panel.js` (snake_case en las cantidades).
export function respuestaPanel(
  lugarId: string,
  lugar: Lugar,
  insumos: Array<{ id: string; datos: Insumo }>,
): ActionResult {
  return {
    lugar: {
      id: lugarId,
      tipo: lugar.tipo,
      nombre: lugar.nombre,
      ubicacion: lugar.ubicacion,
      telefono: lugar.telefono,
      lat: lugar.lat,
      lng: lugar.lng,
      actualizado: lugar.actualizado.toISOString(),
    },
    insumos: insumos.map(({ id, datos }) => ({
      id,
      nombre: datos.nombre,
      categoria: datos.categoria,
      estado: datos.estado,
      cantidad_necesaria: datos.cantidadNecesaria,
      cantidad_recibida: datos.cantidadRecibida,
      urgencia: datos.urgencia,
      unidad: datos.unidad,
    })),
  };
}

// El claim manda para autorizar, pero un claim puede apuntar a un centro ya
// borrado: sin esta comprobacion la ruta se construiria con `null` y el operador
// veria un 500 generico. El admin llega aqui con `panelLugarId` nulo a proposito
// (el despachador le deja pasar), y recibe el mismo 403 que un panel sin centro.
function lugarDelPanel(ctx: ActionContext): string {
  const lugarId = ctx.panelLugarId ? s(ctx.panelLugarId, 128) : '';
  if (!lugarId) throw new ApiError('Tu cuenta no tiene un centro asignado', 403);
  return lugarId;
}

async function cargarPanel(
  tx: TxLugares,
  ctx: ActionContext,
): Promise<{ lugarId: string; lugar: Lugar; insumos: Array<{ id: string; datos: Insumo }> }> {
  const db = firestore(ctx);
  const lugarId = lugarDelPanel(ctx);
  const lugar = await leerLugar(tx, db, lugarId);
  if (!lugar) throw new ApiError('Centro no encontrado', 404);

  // La autorizacion no puede descansar solo en el claim: cuando el admin
  // traspasa un centro, el ID token de quien lo administraba antes sigue siendo
  // valido hasta una hora. El dato manda sobre el token.
  if (ctx.role === 'panel' && lugar.panelUid && lugar.panelUid !== ctx.uid) {
    throw new ApiError('Tu cuenta ya no administra este centro', 403);
  }

  const insumos = await leerInsumos(tx, db, lugarId);
  return { lugarId, lugar, insumos };
}

// --- Escritura ----------------------------------------------------------------

// Exportado para la consola de datos (Task 3.7): crear o borrar un centro desde
// ahi tiene que mover los mismos contadores del tablero que `registrar_lugar`.
export function deltaTipo(anterior: string | null, nuevo: string | null): Record<string, number> {
  const contador = (tipo: string) => (tipo === 'Hospital' ? 'hospitalesRegistrados' : 'centrosRegistrados');
  const deltas: Record<string, number> = {};
  if (anterior) deltas[contador(anterior)] = (deltas[contador(anterior)] ?? 0) - 1;
  if (nuevo) deltas[contador(nuevo)] = (deltas[contador(nuevo)] ?? 0) + 1;
  return deltas;
}

// Crea el lugar reservando el nombre en el mismo paso. La reserva es lo que
// sustituye al `unique` de SQL: dos altas simultaneas del mismo nombre no pueden
// crear dos centros.
// Exportada por la misma razon que `deltaTipo`: un centro creado desde la
// consola reserva su nombre en el indice de unicidad y publica su proyeccion
// exactamente igual que uno creado desde el formulario publico.
export async function crearLugar(
  tx: TxLugares,
  ctx: ActionContext,
  datos: {
    nombre: string;
    tipo: string;
    ubicacion: string;
    telefono: string;
    lat: number | null;
    lng: number | null;
    panelUid: string | null;
  },
  mensajeDuplicado: string,
): Promise<{ lugarId: string; lugar: Lugar }> {
  const db = firestore(ctx);
  const ctxMin = contextoMinimo(ctx);
  const lugarId = idEntidad(PREFIJO_LUGAR);
  const lugar: Lugar = {
    tipo: datos.tipo,
    nombre: datos.nombre,
    nombreNorm: normalizar(datos.nombre),
    ubicacion: datos.ubicacion,
    telefono: datos.telefono,
    lat: datos.lat,
    lng: datos.lng,
    activo: true,
    panelUid: datos.panelUid,
    actualizado: ctx.now,
  };

  await reservarClaveUnica(tx, ctxMin, INDICE_NOMBRE, datos.nombre, lugarId, mensajeDuplicado);
  tx.set(refLugar(db, lugarId), { ...lugar });
  republicar(tx, ctxMin, lugarId, lugar, []);
  ajustarContadores(tx, ctxMin.db, deltaTipo(null, lugar.tipo));
  return { lugarId, lugar };
}

// Firestore no tiene `on delete cascade`. Sin esto, borrar un centro dejaria sus
// insumos huerfanos, su proyeccion publicada y —lo peor— el nombre reservado
// para siempre en el indice de unicidad, con lo que nadie podria volver a
// registrarlo. Lo llama `admin_datos_borrar` (Task 3.7).
export async function borrarLugarEnCascada(
  tx: TxLugares,
  ctx: ActionContext,
  lugarId: string,
): Promise<{ insumosBorrados: number }> {
  const db = firestore(ctx);
  const ctxMin = contextoMinimo(ctx);
  const lugar = await leerLugar(tx, db, lugarId);
  if (!lugar) throw new ApiError('Centro no encontrado', 404);
  const insumos = await leerInsumos(tx, db, lugarId);

  for (const { id } of insumos) tx.delete(refInsumos(db, lugarId).doc(id));
  tx.delete(db.collection(COLECCION_PANEL).doc(lugarId));
  tx.delete(refLugar(db, lugarId));
  despublicar(tx, ctxMin.db, PROYECCION, lugarId);
  liberarClaveUnica(tx, ctxMin, INDICE_NOMBRE, lugar.nombre);
  ajustarContadores(tx, ctxMin.db, deltaTipo(lugar.tipo, null));
  return { insumosBorrados: insumos.length };
}

// --- Acciones -----------------------------------------------------------------

defineAction({
  nombre: 'registrar_lugar',
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    if (!nombre) throw new ApiError('nombre requerido');

    const geo = geoValida(payload);
    const insumoNombre = s(payload.insumo, 120);
    const estado = estadoInsumo(payload.estado);
    const categoria = s(payload.categoria, 60) || 'General';

    return firestore(ctx).runTransaction(async (tx) => {
      const db = firestore(ctx);
      const ctxMin = contextoMinimo(ctx);
      const clave = claveInsumo(insumoNombre);

      // Lecturas primero: Firestore rechaza leer despues de escribir.
      const existenteId = await lugarIdPorNombre(tx, ctxMin, nombre);
      let lugarId = existenteId;
      let lugar = existenteId ? await leerLugar(tx, db, existenteId) : null;
      const insumos = existenteId ? await leerInsumos(tx, db, existenteId) : [];

      if (!lugarId || !lugar) {
        const creado = await crearLugar(tx, ctx, {
          nombre,
          tipo: tipoLugar(payload.tipo),
          ubicacion: s(payload.ubicacion, 300),
          telefono: s(payload.telefono, 40),
          lat: geo.lat,
          lng: geo.lng,
          panelUid: null,
        }, 'Este centro ya está registrado. Pide al administrador que genere el acceso del panel.');
        lugarId = creado.lugarId;
        lugar = creado.lugar;
      }

      // Un centro que ya existe NO se sobrescribe: si no, cualquier anonimo
      // cambiaria el telefono o la ubicacion de un hospital ya listado.
      if (!clave) return {};

      const previo = insumos.find((item) => item.id === clave);

      // Endurecimiento (decision del operador, 2026-09-06). El legado dejaba
      // que cualquier anonimo cambiara el `estado` y la `categoria` de un
      // insumo que YA existe con solo acertar el nombre del centro: marcar
      // como `Cubierto` la necesidad critica de un hospital la borraba del
      // directorio. Ahora un reporte publico solo puede DAR DE ALTA un insumo
      // nuevo; sobre uno existente refresca `actualizado` y deja constancia en
      // el historial, pero el estado y la categoria solo los mueven el panel
      // del centro (`panel_insumo`) y el admin.
      const estadoEfectivo = previo ? previo.datos.estado : estado;
      const categoriaEfectiva = previo ? previo.datos.categoria : categoria;

      const insumo: Insumo = {
        nombre: insumoNombre,
        categoria: categoriaEfectiva,
        estado: estadoEfectivo,
        cantidadNecesaria: previo ? previo.datos.cantidadNecesaria : 1,
        cantidadRecibida: previo ? previo.datos.cantidadRecibida : 0,
        urgencia: previo ? previo.datos.urgencia : 'Normal',
        unidad: previo ? previo.datos.unidad : 'unidades',
        actualizado: ctx.now,
      };

      tx.set(refInsumos(db, lugarId).doc(clave), { ...insumo });
      const restantes = insumos.filter((item) => item.id !== clave).map((item) => item.datos);
      republicar(tx, ctxMin, lugarId, lugar, [...restantes, insumo]);

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        insumo: insumoNombre,
        descripcion: `Reporte: ${insumoNombre} (${estadoEfectivo})`,
        origen: 'publico',
        cantidad: 0,
        unidad: insumo.unidad,
        tipo: 'Reporte',
      });

      return {};
    });
  },
});

defineAction({
  nombre: 'panel_crear',
  // El legado era anonimo (token CTR-… + PIN elegidos en el formulario). Con
  // Firebase Auth el panel es la cuenta, asi que crear un centro exige sesion.
  // El cubo sigue siendo `publico` (30/h por IP, igual que el legado): `panel`
  // mezclaria la cuota de crear centros con la de operarlos.
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    const correo = emailNorm(payload.email);
    const telefono = s(payload.telefono, 40);
    const fotoCedula = s(payload.fotoCedulaPath ?? payload.fotoCedula, 300);
    const fotoSitio = s(payload.fotoSitioPath ?? payload.fotoSitio, 300);

    const uid = ctx.uid ?? '';
    // El cliente sube la foto y manda el `path`. Se exige que sea SUYO y de la
    // categoria `centers`: si no, cualquiera podria apuntar el expediente de su
    // centro al archivo privado de otra persona.
    const suya = (ruta: string) => ruta.startsWith(`private/${uid}/centers/`);

    if (!nombre) throw new ApiError('nombre requerido');
    if (!correo) throw new ApiError('correo electrónico válido requerido');
    if (soloDigitos(telefono).length < 7) throw new ApiError('teléfono requerido');
    if (!suya(fotoCedula)) throw new ApiError('Falta la foto de la cédula de la persona responsable');
    if (!suya(fotoSitio)) throw new ApiError('Falta la foto del sitio del centro');

    // Los claims solo admiten UN centro por cuenta (`panelLugarId` es un valor,
    // no una lista): crear un segundo dejaria el primero con `panelUid` puesto y
    // sin nadie que pudiera abrirlo.
    if (ctx.panelLugarId) {
      throw new ApiError('Tu cuenta ya administra un centro. Pide al administrador que te asigne otro.', 409);
    }

    const geo = geoValida(payload);
    const db = firestore(ctx);

    const resultado = await db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const existente = await lugarIdPorNombre(tx, ctxMin, nombre);
      if (existente) {
        throw new ApiError('Este centro ya está registrado. Pide al administrador que genere el acceso del panel.', 409);
      }

      const { lugarId, lugar } = await crearLugar(tx, ctx, {
        nombre,
        tipo: tipoLugar(payload.tipo),
        ubicacion: s(payload.ubicacion, 300),
        telefono,
        lat: geo.lat,
        lng: geo.lng,
        panelUid: uid,
      }, 'Este centro ya está registrado. Pide al administrador que genere el acceso del panel.');

      tx.set(db.collection(COLECCION_PANEL).doc(lugarId), {
        authUid: uid,
        email: correo,
        fotoCedulaPath: fotoCedula,
        fotoSitioPath: fotoSitio,
        creado: ctx.now,
      });

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: nombre,
        descripcion: 'Panel de centro creado',
        origen: 'panel',
        tipo: 'Panel',
      });

      return { lugarId, nombre: lugar.nombre };
    });

    // Los claims no caben en la transaccion. Si esto falla el centro queda
    // creado sin acceso: `admin_regenerar_panel` lo repara.
    await asignarPanel(uid, resultado.lugarId);

    return { ...resultado };
  },
});

defineAction({
  nombre: 'panel_ver',
  auth: 'panel',
  cubo: 'panel',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    return firestore(ctx).runTransaction(async (tx) => {
      const { lugarId, lugar, insumos } = await cargarPanel(tx, ctx);
      return respuestaPanel(lugarId, lugar, insumos);
    });
  },
});

defineAction({
  nombre: 'panel_actualizar_lugar',
  auth: 'panel',
  cubo: 'panel',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const db = firestore(ctx);
    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const { lugarId, lugar, insumos } = await cargarPanel(tx, ctx);

      // Campos vacios o invalidos se ignoran: el panel no puede vaciar datos ni
      // cambiar el nombre del centro.
      const tipo = s(payload.tipo, 40);
      const ubicacion = s(payload.ubicacion, 300);
      const telefono = s(payload.telefono, 40);
      const geo = geoValida(payload);

      const actualizado: Lugar = {
        ...lugar,
        tipo: (TIPOS_LUGAR as readonly string[]).includes(tipo) ? tipo : lugar.tipo,
        ubicacion: ubicacion || lugar.ubicacion,
        telefono: telefono || lugar.telefono,
        lat: geo.lat !== null ? geo.lat : lugar.lat,
        lng: geo.lng !== null ? geo.lng : lugar.lng,
        actualizado: ctx.now,
      };

      tx.set(refLugar(db, lugarId), { ...actualizado });
      republicar(tx, ctxMin, lugarId, actualizado, insumos.map((item) => item.datos));
      if (actualizado.tipo !== lugar.tipo) {
        ajustarContadores(tx, ctxMin.db, deltaTipo(lugar.tipo, actualizado.tipo));
      }

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: actualizado.nombre,
        descripcion: 'Datos del centro actualizados desde el panel',
        origen: 'panel',
        tipo: 'Panel',
      });

      return respuestaPanel(lugarId, actualizado, insumos);
    });
  },
});

defineAction({
  nombre: 'panel_insumo',
  auth: 'panel',
  cubo: 'panel',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const insumoNombre = s(payload.insumoNombre, 120);
    if (!insumoNombre) throw new ApiError('insumo requerido');

    const db = firestore(ctx);
    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const { lugarId, lugar, insumos } = await cargarPanel(tx, ctx);
      const clave = claveInsumo(insumoNombre);
      const previo = insumos.find((item) => item.id === clave);

      // `cantidadNecesaria` 0 o negativa vuelve a 1, como el legado: una
      // necesidad de cero unidades no se puede mostrar ni cubrir.
      const necesaria = Math.max(0, n(payload.cantidadNecesaria)) || 1;
      const recibida = Math.max(0, n(payload.cantidadRecibida));
      // La UI nunca envia `unidad`, y el upsert del legado la devolvia a
      // 'unidades' en cada toque. Aqui se conserva lo que ya habia.
      const unidad = s(payload.unidad, 30) || previo?.datos.unidad || 'unidades';

      const insumo: Insumo = {
        nombre: insumoNombre,
        categoria: s(payload.categoria, 60) || previo?.datos.categoria || 'General',
        estado: estadoInsumo(payload.estado),
        cantidadNecesaria: necesaria,
        cantidadRecibida: recibida,
        urgencia: opcion(payload.urgencia, URGENCIAS, 'Normal'),
        unidad,
        actualizado: ctx.now,
      };

      // El delta se calcula DENTRO de la transaccion: en el legado se leia
      // fuera y dos guardados simultaneos podian contar la misma entrega dos
      // veces o ninguna. Y se avisa a facturas ANTES de escribir: ese enganche
      // busca la factura abierta del objetivo, y Firestore prohibe leer despues
      // de escribir dentro de una transaccion.
      const delta = recibida - (previo?.datos.cantidadRecibida ?? 0);
      if (registrarEntrega) {
        await registrarEntrega(tx, ctxMin, {
          centro: lugar.nombre,
          insumo: insumoNombre,
          unidad,
          delta,
          recibida,
          necesaria,
        });
      }

      const lugarActualizado: Lugar = { ...lugar, actualizado: ctx.now };
      tx.set(refInsumos(db, lugarId).doc(clave), { ...insumo });
      tx.set(refLugar(db, lugarId), { ...lugarActualizado });

      const restantes = insumos.filter((item) => item.id !== clave);
      republicar(tx, ctxMin, lugarId, lugarActualizado, [...restantes.map((item) => item.datos), insumo]);

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        insumo: insumoNombre,
        descripcion: `Panel: ${insumoNombre} (${insumo.estado}, ${recibida} de ${necesaria})`,
        origen: 'panel',
        cantidad: recibida,
        unidad,
        tipo: 'Panel',
      });

      const lista = [...restantes, { id: clave, datos: insumo }]
        .sort((a, b) => a.datos.nombre.localeCompare(b.datos.nombre));
      return respuestaPanel(lugarId, lugarActualizado, lista);
    });
  },
});

defineAction({
  nombre: 'panel_insumo_borrar',
  auth: 'panel',
  cubo: 'panel',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const insumoNombre = s(payload.insumoNombre, 120);
    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const { lugarId, lugar, insumos } = await cargarPanel(tx, ctx);
      const clave = claveInsumo(insumoNombre);
      const previo = insumos.find((item) => item.id === clave);
      const restantes = insumos.filter((item) => item.id !== clave);

      if (clave) tx.delete(refInsumos(db, lugarId).doc(clave));
      republicar(tx, ctxMin, lugarId, lugar, restantes.map((item) => item.datos));

      // El legado escribe la entrada aunque el insumo no existiera.
      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        insumo: insumoNombre,
        descripcion: `Panel: insumo ${insumoNombre} retirado`,
        origen: 'panel',
        unidad: previo?.datos.unidad ?? '',
        tipo: 'Panel',
      });

      return respuestaPanel(lugarId, lugar, restantes);
    });
  },
});

defineAction({
  nombre: 'admin_listar_necesidades',
  auth: 'admin',
  // El catalogo la clasifica en `admin` (60/h), no en `adminLectura`, pese a ser
  // de solo lectura: es la consulta mas cara del sistema.
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const db = ctx.db as unknown as {
      collectionGroup(nombre: string): {
        where(campo: string, op: string, valor: unknown): {
          limit(cantidad: number): { get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown>; ref: { parent: { parent: { id: string } | null } } }> }> };
        };
      };
      getAll(...refs: Array<{ path?: string }>): Promise<Array<{ id: string; exists: boolean; data(): Record<string, unknown> | undefined }>>;
      collection(nombre: string): { doc(id: string): { path?: string } };
    };

    const snapshot = await db
      .collectionGroup(SUBCOLECCION_INSUMOS)
      .where('estado', '==', 'Necesita')
      .limit(TOPE_NECESIDADES + 1)
      .get();

    const truncado = snapshot.docs.length > TOPE_NECESIDADES;
    const filas = snapshot.docs.slice(0, TOPE_NECESIDADES).map((doc) => ({
      id: doc.id,
      lugarId: doc.ref.parent.parent?.id ?? '',
      datos: comoInsumo(doc.data()),
    })).filter((fila) => fila.lugarId);

    const ids = [...new Set(filas.map((fila) => fila.lugarId))];
    const lugares = ids.length
      ? await db.getAll(...ids.map((id) => db.collection(COLECCION).doc(id)))
      : [];
    const nombres = new Map<string, string>();
    for (const documento of lugares) {
      if (documento.exists) nombres.set(documento.id, s((documento.data() ?? {}).nombre, 120));
    }

    const centros = new Map<string, { centro: string; insumos: Array<Record<string, unknown>> }>();
    for (const fila of filas) {
      const centro = nombres.get(fila.lugarId);
      if (!centro) continue;
      const pendiente = Math.max(0, fila.datos.cantidadNecesaria - fila.datos.cantidadRecibida);
      if (pendiente <= 0) continue;
      const grupo = centros.get(centro) ?? { centro, insumos: [] };
      grupo.insumos.push({
        id: fila.id,
        // El id del insumo ya no es unico globalmente (vive bajo su centro):
        // quien cree un presupuesto necesita las dos mitades.
        lugarId: fila.lugarId,
        nombre: fila.datos.nombre,
        unidad: fila.datos.unidad || 'unidades',
        pendiente,
        urgencia: fila.datos.urgencia,
      });
      centros.set(centro, grupo);
    }

    return { centros: [...centros.values()], truncado };
  },
});

defineAction({
  nombre: 'admin_regenerar_panel',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    const correo = emailNorm(payload.email);
    if (!nombre) throw new ApiError('nombre del centro requerido');
    if (!correo) throw new ApiError('correo electrónico válido requerido');

    // El legado generaba token + PIN nuevos. Ahora el acceso ES una cuenta: se
    // busca a la persona por su correo y se le asigna el centro por claims.
    let usuario: { uid: string };
    try {
      usuario = await obtenerAuthAdmin().getUserByEmail(correo);
    } catch {
      throw new ApiError('Esa persona debe registrarse primero con ese correo', 404);
    }

    const db = firestore(ctx);
    const resultado = await db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const lugarId = await lugarIdPorNombre(tx, ctxMin, nombre);
      if (!lugarId) throw new ApiError('Centro no encontrado', 404);

      const lugar = await leerLugar(tx, db, lugarId);
      if (!lugar) throw new ApiError('Centro no encontrado', 404);
      const insumos = await leerInsumos(tx, db, lugarId);
      const panelPrevio = await tx.get(db.collection(COLECCION_PANEL).doc(lugarId));

      const titularPrevio = lugar.panelUid;
      const actualizado: Lugar = { ...lugar, panelUid: usuario.uid, actualizado: ctx.now };
      tx.set(refLugar(db, lugarId), { ...actualizado });
      // `merge`: conserva las fotos y el correo de un panel creado por
      // `panel_crear`, igual que el `upsert` de cuatro columnas del legado.
      tx.set(db.collection(COLECCION_PANEL).doc(lugarId), {
        authUid: usuario.uid,
        email: correo,
        regenerado: ctx.now,
      }, { merge: true });
      republicar(tx, ctxMin, lugarId, actualizado, insumos.map((item) => item.datos));

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        descripcion: 'Panel regenerado por administración',
        origen: 'admin',
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION_PANEL,
        entidadId: lugarId,
        antes: panelPrevio.exists ? datosDe(panelPrevio) : null,
        despues: { authUid: usuario.uid, email: correo },
      });

      return { lugarId, nombre: lugar.nombre, titularPrevio };
    });

    // Traspasar el centro es, sobre todo, QUITARSELO a quien lo tenia: en el
    // legado eso ocurria solo porque se rotaban el token y el PIN. Aqui hay que
    // hacerlo explicito o el titular anterior conserva el control para siempre.
    if (resultado.titularPrevio && resultado.titularPrevio !== usuario.uid) {
      await revocarPanel(resultado.titularPrevio);
    }
    await asignarPanel(usuario.uid, resultado.lugarId);

    return { lugarId: resultado.lugarId, nombre: resultado.nombre, email: correo };
  },
});

// El reconciliador reescribe `lugaresPublicos` desde `lugares` cuando la
// proyeccion se desincroniza. Lee tambien la subcoleccion de insumos: sin eso
// la reconstruccion publicaria cada centro con sus tres cubos vacios, es decir
// borraria del directorio publico todas las necesidades del pais.
registrarFuente({
  coleccion: COLECCION,
  proyeccion: PROYECCION,
  incluir: ({ datos }) => datos.activo !== false,
  async mapear({ id, datos }, db) {
    const referencia = db.collection(COLECCION).doc(id);
    const subcoleccion = referencia.collection?.(SUBCOLECCION_INSUMOS);
    const snapshot = subcoleccion ? await subcoleccion.get() : { docs: [] };
    const insumos = snapshot.docs.map((documento) => comoInsumo(documento.data() ?? {}));
    return documentoPublico(comoLugar(datos), insumos);
  },
  contadores: ({ datos }) => deltaTipo(null, comoLugar(datos).tipo),
});

import { getAuth } from 'firebase-admin/auth';
import {
  ApiError,
  emailNorm,
  idEntidad,
  normalizar,
  s,
  soloDigitos,
} from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar, claveIndice, historial, reservarClaveUnica } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { ajustarContadores } from './estadisticas.js';
import { despublicar, publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';
import {
  VOLUNTEER_PUBLIC_CONSENT_VERSION,
  assertConsentPermission,
  buildConsentMutation,
  parseConsentRequest,
} from '../volunteers/public-consent.js';
import { sanitizeVolunteerPublicProfile } from '../public-projections.js';

// Dominio: personas. Voluntarios, rescatistas, transportistas, reportes de
// personas buscadas y la busqueda familiar.
//
// Modelo (plan 2026-09-06, Task 3.2):
//   voluntarios/{VOL-XXXXXXXX}                  canonico, privado
//   rescatistas/{RES-XXXXXXXX}                  canonico, privado (nunca publico)
//   motorizados/{MOT-XXXXXXXX}                  canonico, privado
//   personas/{PER-XXXXXXXX}                     reportes de personas buscadas
//   motorizadosPublicos/{MOT-…}                 proyeccion (misma transaccion)
//   voluntariosPublicos/{VOL-…}                 SOLO con consentimiento v1
//   indices/cuentasPorEmail/claves/{emailNorm}  unicidad del correo
//
// Los ids los genera el servidor (`idEntidad`), nunca el cliente: el legado
// aceptaba `p.id` tal cual, asi que un `id` repetido reventaba por clave
// primaria DESPUES de subir las fotos y dejaba archivos huerfanos.
//
// Los rescatistas no tienen proyeccion publica. Su ficha es informacion
// operativa (telefono, capacidad, equipo) y `filtrarLista` de la UI busca sobre
// `Object.values(fila).join(' ')`: publicarla seria publicarlo todo.

export const PREFIJO_VOLUNTARIO = 'VOL';
export const PREFIJO_RESCATISTA = 'RES';
export const PREFIJO_MOTORIZADO = 'MOT';
export const PREFIJO_PERSONA = 'PER';

export const COLECCION_VOLUNTARIOS = 'voluntarios';
export const COLECCION_RESCATISTAS = 'rescatistas';
export const COLECCION_MOTORIZADOS = 'motorizados';
export const COLECCION_PERSONAS = 'personas';
export const PROYECCION_MOTORIZADOS = 'motorizadosPublicos';
export const PROYECCION_VOLUNTARIOS = 'voluntariosPublicos';
export const INDICE_EMAIL = 'cuentasPorEmail';

// Topes del catalogo, uno por listado del admin.
export const TOPE_VOLUNTARIOS = 200;
export const TOPE_RESCATISTAS = 100;
export const TOPE_PERSONAS = 100;

// `buscar_familiar`: el legado pedia 3 caracteres; el plan sube a 4 porque una
// consulta de 3 letras sobre nombres devuelve medio pais.
export const MIN_BUSQUEDA = 4;
export const MAX_FAMILIARES = 25;

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

type ColeccionPersonas = Consulta & { doc(id?: string): Referencia };

export type FirestorePersonas = {
  collection(nombre: string): ColeccionPersonas;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestorePersonas {
  return ctx.db as unknown as FirestorePersonas;
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

// --- Auth admin inyectable ---------------------------------------------------

export type AuthPersonas = {
  getUser(uid: string): Promise<{ uid: string; email?: string | null }>;
};

let authInyectada: AuthPersonas | null = null;

// Las pruebas de contrato no tienen `firebase-admin` inicializado; el codigo de
// produccion no pasa por aqui.
export function usarAuthPersonas(auth: AuthPersonas | null): void {
  authInyectada = auth;
}

function obtenerAuth(): AuthPersonas {
  return authInyectada ?? (getAuth() as unknown as AuthPersonas);
}

// --- Lectura de campos --------------------------------------------------------

type ConFecha = { toDate(): Date };

function esFecha(valor: unknown): valor is ConFecha {
  return Boolean(valor) && typeof (valor as ConFecha).toDate === 'function';
}

// Firestore devuelve `Timestamp`, no `Date`: sin esto todas las fechas releidas
// volvian como epoch y la UI pintaba «hace 56 años».
function comoFecha(valor: unknown): Date | null {
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

function texto(datos: Record<string, unknown>, campo: string, max = 300): string {
  return s(datos[campo], max);
}

// --- Indice de correos --------------------------------------------------------

export type TipoCuenta = 'voluntario' | 'transportista';

// `reservarClaveUnica` guarda un valor de texto, asi que el `{ tipo, id }` del
// plan viaja codificado como `tipo:id`. Un solo indice para las dos colecciones
// es justo lo que hace que un correo no pueda ser a la vez voluntario y
// transportista, que es lo que el catalogo documenta como agujero del legado.
export function valorCuenta(tipo: TipoCuenta, id: string): string {
  return `${tipo}:${id}`;
}

export function leerValorCuenta(valor: unknown): { tipo: TipoCuenta; id: string } | null {
  const crudo = s(valor, 240);
  const corte = crudo.indexOf(':');
  if (corte < 1) return null;
  const tipo = crudo.slice(0, corte);
  const id = crudo.slice(corte + 1);
  if (!id) return null;
  if (tipo !== 'voluntario' && tipo !== 'transportista') return null;
  return { tipo, id };
}

const CORREO_YA_USADO = 'Ese correo ya está registrado. Entra con tu cuenta.';

// --- Fotos privadas -----------------------------------------------------------

// El cliente sube el archivo a Storage y manda el `path`. Se exige que sea SUYO
// y de la categoria que le toca: si no, cualquiera podria apuntar su expediente
// al archivo privado de otra persona. Las reglas de Storage ya impiden escribir
// bajo el `private/<uid>/` ajeno; esto cierra el otro extremo.
function rutaPropia(uid: string, categoria: 'volunteers' | 'drivers', ruta: string): boolean {
  return Boolean(uid) && ruta.startsWith(`private/${uid}/${categoria}/`);
}

// --- Reportes de personas -----------------------------------------------------

// `personasLocalizadas` del tablero es, en el legado,
// `count(*) where estado ilike 'localiz%' or estado ilike 'hospital%'`.
export function personaLocalizada(estado: unknown): boolean {
  const clave = normalizar(estado);
  return clave.startsWith('localiz') || clave.startsWith('hospital');
}

// El consentimiento vive en el documento privado del voluntario. Solo `enabled`
// decide: una version antigua sigue siendo un consentimiento dado.
export function consentimientoActivo(datos: Record<string, unknown>): boolean {
  const consentimiento = datos.publicProfileConsent;
  return Boolean(consentimiento)
    && typeof consentimiento === 'object'
    && (consentimiento as { enabled?: unknown }).enabled === true;
}

function deltaPersona(estado: unknown): Record<string, number> {
  return personaLocalizada(estado)
    ? { personasReportadas: 1, personasLocalizadas: 1 }
    : { personasReportadas: 1 };
}

// --- Proyeccion publica de transportistas -------------------------------------

type Motorizado = {
  nombre: string;
  emailNorm: string;
  telefono: string;
  tipoVehiculo: string;
  zonaOperacion: string;
  placa: string;
  fotoPlacaPath: string;
  fotoVehiculoPath: string;
  fotoCedulaPath: string;
  authUid: string;
  activo: boolean;
  createdAt: Date;
};

export function documentoPublicoMotorizado(motorizado: {
  nombre: string;
  tipoVehiculo: string;
  zonaOperacion: string;
  telefono: string;
  activo: boolean;
  createdAt: unknown;
}): Record<string, unknown> {
  return {
    nombre: motorizado.nombre,
    zona: motorizado.zonaOperacion,
    tipoVehiculo: motorizado.tipoVehiculo,
    activo: motorizado.activo,
    // Ni `telefono` ni `placa`: la tarjeta solo sabe que HAY forma de contactar,
    // y el numero se pide de uno en uno con `contactar_motorizado`.
    tieneContacto: soloDigitos(motorizado.telefono).length >= 7,
    createdAt: comoFecha(motorizado.createdAt) ?? new Date(0),
  };
}

// --- Acciones: registros ------------------------------------------------------

defineAction({
  nombre: 'registrar_voluntario',
  // El legado era anonimo, pero pedia la foto de la cedula como dataURL y la
  // subia el servidor. Aqui la sube el cliente a `private/<uid>/volunteers/`, y
  // las reglas de Storage exigen sesion para escribir ahi: sin cuenta no hay
  // foto que valga. Misma decision que `panel_crear` en la Task 3.1.
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    const correo = emailNorm(payload.email);
    const telefono = s(payload.telefono, 40);
    const fotoCedula = s(payload.fotoCedulaPath ?? payload.fotoCedula, 300);
    const uid = ctx.uid ?? '';

    if (!nombre) throw new ApiError('nombre requerido');
    if (!correo) throw new ApiError('correo electrónico válido requerido');
    if (soloDigitos(telefono).length < 7) throw new ApiError('teléfono requerido');
    if (!rutaPropia(uid, 'volunteers', fotoCedula)) throw new ApiError('Falta la foto de la cédula');

    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_VOLUNTARIO);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      // Lectura antes de cualquier escritura: Firestore lo exige.
      await reservarClaveUnica(tx, ctxMin, INDICE_EMAIL, correo, valorCuenta('voluntario', id), CORREO_YA_USADO);

      tx.set(db.collection(COLECCION_VOLUNTARIOS).doc(id), {
        nombre,
        apellido: s(payload.apellido, 120),
        emailNorm: correo,
        telefono,
        estado: s(payload.estado, 60),
        ciudad: s(payload.ciudad, 80),
        profesion: s(payload.profesion, 80),
        disponibilidad: s(payload.disponibilidad, 120),
        medioTransporte: s(payload.medioTransporte ?? payload.medio_transporte, 60),
        observaciones: s(payload.observaciones, 500),
        fotoCedulaPath: fotoCedula,
        authUid: uid,
        activo: true,
        createdAt: ctx.now,
      });

      // Sin proyeccion publica: el perfil de un voluntario solo se publica con
      // `voluntario_consentimiento` (consentimiento v1), nunca al registrarse.
      ajustarContadores(tx, ctxMin.db, { voluntariosActivos: 1 });
      return { id };
    });
  },
});

defineAction({
  nombre: 'registrar_rescatista',
  // Sin fotos, sin correo: sigue siendo anonimo como en el legado.
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    if (!nombre) throw new ApiError('nombre requerido');

    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_RESCATISTA);

    return db.runTransaction(async (tx) => {
      tx.set(db.collection(COLECCION_RESCATISTAS).doc(id), {
        nombre,
        organizacion: s(payload.organizacion, 120),
        telefono: s(payload.telefono, 40),
        especialidad: s(payload.especialidad, 80),
        estado: s(payload.estado, 60),
        ciudad: s(payload.ciudad, 80),
        disponibilidad: s(payload.disponibilidad, 120),
        equipoDisponible: s(payload.equipoDisponible ?? payload.equipo_disponible, 300),
        capacidadOperativa: s(payload.capacidadOperativa ?? payload.capacidad_operativa, 120),
        observaciones: s(payload.observaciones, 500),
        activo: true,
        createdAt: ctx.now,
      });
      return { id };
    });
  },
});

defineAction({
  nombre: 'registrar_motorizado',
  // Igual que `registrar_voluntario`: tres fotos privadas, luego sesion.
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 120);
    const correo = emailNorm(payload.email);
    const telefono = s(payload.telefono, 40);
    const uid = ctx.uid ?? '';
    const fotoPlaca = s(payload.fotoPlacaPath ?? payload.fotoPlaca, 300);
    const fotoVehiculo = s(payload.fotoVehiculoPath ?? payload.fotoVehiculo, 300);
    const fotoCedula = s(payload.fotoCedulaPath ?? payload.fotoCedula, 300);

    if (!nombre) throw new ApiError('nombre requerido');
    if (!correo) throw new ApiError('correo electrónico válido requerido');
    if (soloDigitos(telefono).length < 7) throw new ApiError('teléfono requerido');
    if (![fotoPlaca, fotoVehiculo, fotoCedula].every((ruta) => rutaPropia(uid, 'drivers', ruta))) {
      throw new ApiError('Faltan fotos: placa, vehículo y cédula son obligatorias');
    }

    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_MOTORIZADO);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      await reservarClaveUnica(tx, ctxMin, INDICE_EMAIL, correo, valorCuenta('transportista', id), CORREO_YA_USADO);

      const motorizado: Motorizado = {
        nombre,
        emailNorm: correo,
        telefono,
        // El legado aceptaba cualquier texto aqui aunque la consola admin solo
        // permita cinco valores; se conserva tal cual para no rechazar altas.
        tipoVehiculo: s(payload.tipoVehiculo ?? payload.tipo_vehiculo, 40) || 'Moto',
        zonaOperacion: s(payload.zonaOperacion ?? payload.operaEn, 120),
        placa: s(payload.placa, 20),
        fotoPlacaPath: fotoPlaca,
        fotoVehiculoPath: fotoVehiculo,
        fotoCedulaPath: fotoCedula,
        authUid: uid,
        activo: true,
        createdAt: ctx.now,
      };

      tx.set(db.collection(COLECCION_MOTORIZADOS).doc(id), { ...motorizado });
      publicar(tx, ctxMin.db, PROYECCION_MOTORIZADOS, id, documentoPublicoMotorizado(motorizado));
      ajustarContadores(tx, ctxMin.db, { motorizadosRegistrados: 1 });
      return { id };
    });
  },
});

defineAction({
  nombre: 'reportar_persona',
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const nombre = s(payload.nombre, 160);
    if (!nombre) throw new ApiError('nombre requerido');

    const estado = s(payload.estado ?? payload.estadoSalud, 120);
    const cedula = s(payload.cedula, 20);
    const db = firestore(ctx);
    const id = idEntidad(PREFIJO_PERSONA);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      tx.set(db.collection(COLECCION_PERSONAS).doc(id), {
        nombre,
        // Clave de busqueda: `buscar_familiar` filtra por prefijo sobre esto.
        nombreNorm: normalizar(nombre),
        cedula,
        // La cedula solo se compara por igualdad, nunca se devuelve.
        cedulaNorm: soloDigitos(cedula),
        estado,
        ubicacion: s(payload.ubicacion, 200),
        contacto: s(payload.contacto, 120),
        fuente: s(payload.fuente, 120),
        reportadoPor: s(payload.reportadoPor ?? payload.reportado_por, 120),
        verificada: false,
        createdAt: ctx.now,
        actualizado: ctx.now,
      });

      // Sin proyeccion publica: `personas` no se lista, solo se busca por la
      // accion `buscar_familiar`, que exige sesion.
      ajustarContadores(tx, ctxMin.db, deltaPersona(estado));
      return { id };
    });
  },
});

// --- Acciones: sesion y contacto ---------------------------------------------

defineAction({
  nombre: 'acceso_perfil',
  // El legado recibia el `accessToken` en el cuerpo y lo validaba a mano. Ahora
  // el despachador ya autentico la peticion: el `accessToken` que sigue enviando
  // `js/admin.js:1593` se ignora, y el correo se lee de Admin Auth por uid, que
  // es la unica fuente que el cliente no puede falsear.
  auth: 'user',
  cubo: 'lectura',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const uid = ctx.uid ?? '';
    if (!uid) throw new ApiError('Entra con tu cuenta para continuar', 401);

    let correo = '';
    try {
      correo = emailNorm((await obtenerAuth().getUser(uid)).email);
    } catch {
      correo = '';
    }

    const db = firestore(ctx);
    const roles: Array<{ tipo: string; nombre: string }> = [];

    if (correo) {
      // Misma ruta y misma clave que `reservarClaveUnica`: si divergieran, el
      // indice se escribiria en un sitio y se leeria en otro.
      const clave = claveIndice(INDICE_EMAIL, correo);
      const indice = await db.collection(`indices/${INDICE_EMAIL}/claves`).doc(clave).get();
      const cuenta = leerValorCuenta((indice.data() as { valor?: unknown } | undefined)?.valor);

      if (cuenta) {
        const coleccion = cuenta.tipo === 'transportista' ? COLECCION_MOTORIZADOS : COLECCION_VOLUNTARIOS;
        const perfil = await db.collection(coleccion).doc(cuenta.id).get();
        const datos = perfil.data() ?? {};
        if (perfil.exists && texto(datos, 'nombre', 120)) {
          const nombre = cuenta.tipo === 'transportista'
            ? texto(datos, 'nombre', 120)
            : `${texto(datos, 'nombre', 120)} ${texto(datos, 'apellido', 120)}`.trim();
          roles.push({ tipo: cuenta.tipo, nombre });
        }
      }
    }

    // El centro no pasa por el indice de correos: es un claim de la cuenta
    // (`panelLugarId`), que es lo que de verdad da acceso al panel.
    if (ctx.panelLugarId) {
      const lugar = await db.collection('lugares').doc(ctx.panelLugarId).get();
      roles.push({ tipo: 'centro', nombre: texto(lugar.data() ?? {}, 'nombre', 120) || 'Centro' });
    }

    // Un donante sin roles NO se rechaza: `roles: []` es una respuesta valida.
    return { email: correo, roles };
  },
});

defineAction({
  nombre: 'contactar_motorizado',
  // Accion nueva (plan Task 3.2). El telefono salio de `motorizadosPublicos`
  // para que no se pueda recolectar en bloque; aqui se entrega de uno en uno,
  // con sesion y con el cubo `contacto` (30/h por uid).
  auth: 'user',
  cubo: 'contacto',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id ?? payload.idMotorizado, 40);
    if (!id) throw new ApiError('id requerido');

    const db = firestore(ctx);
    const documento = await db.collection(COLECCION_MOTORIZADOS).doc(id).get();
    const datos = documento.data() ?? {};

    // Un transportista dado de baja se comporta como inexistente: no se filtra
    // por la respuesta que ya no esta activo.
    if (!documento.exists || datos.activo === false || !texto(datos, 'nombre', 120)) {
      throw new ApiError('Transportista no encontrado', 404);
    }

    return {
      id,
      nombre: texto(datos, 'nombre', 120),
      telefono: texto(datos, 'telefono', 40),
    };
  },
});

defineAction({
  nombre: 'buscar_familiar',
  // El legado la exponia como RPC publico: cualquiera podia barrer el registro
  // de personas buscadas sin identificarse. Ahora exige sesion (auditoria T01).
  auth: 'user',
  cubo: 'lectura',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const consulta = s(payload.q ?? payload.query, 120).trim();
    if (consulta.length < MIN_BUSQUEDA) {
      throw new ApiError(`escribe al menos ${MIN_BUSQUEDA} caracteres`);
    }

    const db = firestore(ctx);
    const prefijo = normalizar(consulta);
    const cedula = soloDigitos(consulta);

    // Firestore no tiene `ilike '%q%'`: el equivalente practico de la busqueda
    // por nombre es un rango de prefijo sobre `nombreNorm`. `` es el
    // ultimo punto de codigo del plano basico, asi que cierra el rango.
    const porNombre = await db.collection(COLECCION_PERSONAS)
      .where('nombreNorm', '>=', prefijo)
      .where('nombreNorm', '<=', `${prefijo}`)
      .orderBy('nombreNorm')
      .limit(MAX_FAMILIARES)
      .get();

    // La cedula solo se compara por igualdad exacta, y nunca se devuelve.
    const porCedula = cedula.length >= 6
      ? await db.collection(COLECCION_PERSONAS)
        .where('cedulaNorm', '==', cedula)
        .limit(MAX_FAMILIARES)
        .get()
      : { docs: [] as Snapshot[] };

    const vistos = new Set<string>();
    const filas: Array<{ orden: number; persona: Record<string, unknown> }> = [];

    for (const documento of [...porNombre.docs, ...porCedula.docs]) {
      if (vistos.has(documento.id)) continue;
      vistos.add(documento.id);
      const datos = (documento.data() ?? {}) as Record<string, unknown>;
      const actualizado = comoFecha(datos.actualizado ?? datos.createdAt);
      filas.push({
        orden: actualizado?.getTime() ?? 0,
        persona: {
          // Solo estos cinco campos. Ni `cedula`, ni `ubicacion`, ni `contacto`,
          // ni `fuente`, ni `reportadoPor`: el registro de personas buscadas es
          // el dato mas sensible del sistema y esta accion es su unica salida.
          nombre: texto(datos, 'nombre', 160),
          estado: texto(datos, 'estado', 120),
          verificada: datos.verificada === true,
          actualizado: actualizado?.toISOString() ?? '',
          cedulaCoincide: Boolean(cedula) && s(datos.cedulaNorm, 20) === cedula,
        },
      });
    }

    // El legado ordenaba `by fecha desc` en la base. Con un filtro de rango
    // Firestore obliga a ordenar primero por `nombreNorm`, asi que la ordenacion
    // por recencia se hace aqui, sobre los 50 candidatos como mucho.
    filas.sort((a, b) => b.orden - a.orden);

    return { personas: filas.slice(0, MAX_FAMILIARES).map((fila) => fila.persona) };
  },
});

defineAction({
  nombre: 'voluntario_consentimiento',
  // Misma logica que la Function `setVolunteerPublicConsent` (que sigue
  // existiendo como endpoint propio): esto solo la expone por el despachador,
  // que es por donde habla la fachada. El nucleo del consentimiento no se
  // duplica, se importa.
  auth: 'user',
  cubo: 'uid',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    let entrada;
    try {
      entrada = parseConsentRequest({
        volunteerId: payload.volunteerId,
        enabled: payload.enabled,
        consentVersion: payload.consentVersion ?? VOLUNTEER_PUBLIC_CONSENT_VERSION,
      });
    } catch (error) {
      throw new ApiError(
        (error as Error).message === 'invalid-consent-version'
          ? 'versión de consentimiento no válida'
          : 'formato invalido',
      );
    }

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = db.collection(COLECCION_VOLUNTARIOS).doc(entrada.volunteerId);
      const documento = await tx.get(referencia);
      if (!documento.exists) throw new ApiError('Voluntario no encontrado', 404);

      const perfil = (documento.data() ?? {}) as Record<string, unknown>;
      try {
        assertConsentPermission(
          { uid: ctx.uid ?? '', role: ctx.role === 'anon' ? 'user' : ctx.role },
          perfil,
          entrada.enabled,
        );
      } catch (error) {
        throw new ApiError(
          (error as Error).message === 'volunteer-not-active'
            ? 'Tu perfil no está activo'
            : 'No tienes permiso para esta accion',
          403,
        );
      }

      const mutacion = buildConsentMutation(entrada, perfil, {
        now: ctx.now,
        actorUid: ctx.uid ?? '',
      });

      tx.set(referencia, mutacion.privatePatch, { merge: true });
      if (mutacion.publicDocument) {
        publicar(tx, ctxMin.db, PROYECCION_VOLUNTARIOS, entrada.volunteerId, {
          ...mutacion.publicDocument,
          createdAt: comoFecha(perfil.createdAt) ?? ctx.now,
        });
      } else {
        despublicar(tx, ctxMin.db, PROYECCION_VOLUNTARIOS, entrada.volunteerId);
      }

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION_VOLUNTARIOS,
        entidadId: entrada.volunteerId,
        despues: { publicProfileConsent: entrada.enabled },
      });

      return { volunteerId: entrada.volunteerId, enabled: mutacion.enabled };
    });
  },
});

// --- Acciones: consola del admin ---------------------------------------------

async function listarRecientes(
  ctx: ActionContext,
  coleccion: string,
  tope: number,
): Promise<Array<{ id: string; datos: Record<string, unknown> }>> {
  const snapshot = await firestore(ctx).collection(coleccion)
    .orderBy('createdAt', 'desc')
    .limit(tope)
    .get();
  return snapshot.docs.map((documento) => ({ id: documento.id, datos: documento.data() ?? {} }));
}

defineAction({
  nombre: 'admin_listar_voluntarios',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const filas = await listarRecientes(ctx, COLECCION_VOLUNTARIOS, TOPE_VOLUNTARIOS);
    // Las claves en snake_case son las que lee `js/admin.js:879-885`; cambiarlas
    // dejaria la ficha del admin con «pendiente» en transporte y en fecha.
    return {
      voluntarios: filas.map(({ id, datos }) => ({
        id,
        nombre: texto(datos, 'nombre', 120),
        apellido: texto(datos, 'apellido', 120),
        email: texto(datos, 'emailNorm', 254),
        telefono: texto(datos, 'telefono', 40),
        estado: texto(datos, 'estado', 60),
        ciudad: texto(datos, 'ciudad', 80),
        profesion: texto(datos, 'profesion', 80),
        disponibilidad: texto(datos, 'disponibilidad', 120),
        medio_transporte: texto(datos, 'medioTransporte', 60),
        observaciones: texto(datos, 'observaciones', 500),
        fecha_registro: iso(datos.createdAt),
      })),
    };
  },
});

defineAction({
  nombre: 'admin_listar_rescatistas',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const filas = await listarRecientes(ctx, COLECCION_RESCATISTAS, TOPE_RESCATISTAS);
    return {
      rescatistas: filas.map(({ id, datos }) => ({
        id,
        nombre: texto(datos, 'nombre', 120),
        organizacion: texto(datos, 'organizacion', 120),
        telefono: texto(datos, 'telefono', 40),
        especialidad: texto(datos, 'especialidad', 80),
        estado: texto(datos, 'estado', 60),
        ciudad: texto(datos, 'ciudad', 80),
        disponibilidad: texto(datos, 'disponibilidad', 120),
        equipo_disponible: texto(datos, 'equipoDisponible', 300),
        capacidad_operativa: texto(datos, 'capacidadOperativa', 120),
        observaciones: texto(datos, 'observaciones', 500),
        fecha_registro: iso(datos.createdAt),
      })),
    };
  },
});

defineAction({
  nombre: 'admin_listar_personas',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // Cola de moderacion: solo las que nadie ha verificado todavia.
    const snapshot = await firestore(ctx).collection(COLECCION_PERSONAS)
      .where('verificada', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_PERSONAS)
      .get();

    return {
      personas: snapshot.docs.map((documento) => {
        const datos = documento.data() ?? {};
        return {
          id: documento.id,
          nombre: texto(datos, 'nombre', 160),
          cedula: texto(datos, 'cedula', 20),
          estado: texto(datos, 'estado', 120),
          ubicacion: texto(datos, 'ubicacion', 200),
          contacto: texto(datos, 'contacto', 120),
          fuente: texto(datos, 'fuente', 120),
          fecha: iso(datos.createdAt),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'admin_verificar_persona',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = db.collection(COLECCION_PERSONAS).doc(id);
      const documento = await tx.get(referencia);

      // El legado hacia `update … where id` y un id inexistente no fallaba (0
      // filas). Aqui un `set` crearia un documento basura con solo `verificada`,
      // asi que se responde 404 en vez de inventar una persona.
      if (!documento.exists) throw new ApiError('Persona no encontrada', 404);
      const datos = (documento.data() ?? {}) as Record<string, unknown>;

      tx.set(referencia, { verificada: true, actualizado: ctx.now }, { merge: true });

      historial(tx, ctxMin, {
        lugarNombre: 'Administración',
        descripcion: `Persona ${id} verificada`,
        origen: 'admin',
        tipo: 'Administración',
      });

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION_PERSONAS,
        entidadId: id,
        antes: { verificada: datos.verificada === true },
        despues: { verificada: true },
      });

      return {};
    });
  },
});

// --- Fuentes del reconciliador ------------------------------------------------

// `motorizadosPublicos` se deriva de `motorizados`: el telefono y la placa se
// quedan fuera aqui igual que en la accion, porque el mapeo es el mismo.
registrarFuente({
  coleccion: COLECCION_MOTORIZADOS,
  proyeccion: PROYECCION_MOTORIZADOS,
  incluir: ({ datos }) => datos.activo !== false,
  mapear: ({ datos }) => documentoPublicoMotorizado({
    nombre: s(datos.nombre, 120),
    tipoVehiculo: s(datos.tipoVehiculo, 40) || 'Moto',
    zonaOperacion: s(datos.zonaOperacion, 120),
    telefono: s(datos.telefono, 40),
    activo: datos.activo !== false,
    createdAt: datos.createdAt,
  }),
  contadores: () => ({ motorizadosRegistrados: 1 }),
});

// `voluntariosPublicos` SI se puede reconstruir, pero solo con quien dio su
// consentimiento: la fuente filtra por `publicProfileConsent.enabled` y usa la
// misma allowlist reducida que el endpoint de consentimiento. Sin esto una
// desincronizacion de esa proyeccion no tendria reparacion; con el filtro mal
// puesto, la reconstruccion publicaria a quien nunca dio permiso.
registrarFuente({
  coleccion: COLECCION_VOLUNTARIOS,
  proyeccion: PROYECCION_VOLUNTARIOS,
  incluir: ({ datos }) => consentimientoActivo(datos) && datos.activo !== false,
  mapear: ({ datos }) => ({
    ...sanitizeVolunteerPublicProfile(datos),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  }),
});

// Voluntarios y personas reportadas alimentan el tablero sin proyeccion propia.
// Los voluntarios cuentan TODOS, hayan dado consentimiento o no, igual que el
// `count(*) from voluntarios` del legado; por eso el contador va en una fuente
// aparte y no en la de arriba, que solo recorre a quien consintio.
registrarFuente({
  coleccion: COLECCION_VOLUNTARIOS,
  contadores: () => ({ voluntariosActivos: 1 }),
});

registrarFuente({
  coleccion: COLECCION_PERSONAS,
  contadores: ({ datos }) => deltaPersona(datos.estado),
});

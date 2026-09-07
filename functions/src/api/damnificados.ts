import { ApiError, idEntidad, n, s } from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: familias damnificadas.
//
// Modelo:
//   familiasDamnificadas/{FAM-XXXXXXXX}   canonico, privado. Es la coleccion con
//                                         la PII mas sensible del sistema:
//                                         nombres y edades de menores, domicilio
//                                         de alojamiento, condiciones medicas,
//                                         personas fallecidas y fotos.
//   familiasPublicas/{FAM-…}              proyeccion (misma transaccion): el
//                                         codigo, el municipio y agregados. Ni
//                                         un nombre, ni un telefono, ni el GPS.
//
// El codigo ES el id del documento: es lo unico que la familia se lleva del
// formulario y lo unico con lo que la consola publica puede reconocerlas.

export const PREFIJO_FAMILIA = 'FAM';
export const COLECCION = 'familiasDamnificadas';
export const PROYECCION = 'familiasPublicas';

// Codigo que devuelve el honeypot: existe para que un bot crea que escribio.
export const CODIGO_TRAMPA = 'FAM-000000';

export const TOPE_FAMILIAS_ADMIN = 300;
export const MAX_INTEGRANTES = 20;
export const MAX_FOTOS = 12;
export const MAX_EDAD = 120;
export const MAX_FALLECIDOS = 99;

export const ESTADOS_FAMILIA = ['nuevo', 'contactado', 'atendido'] as const;
export type EstadoFamilia = typeof ESTADOS_FAMILIA[number];

// Rangos de edad de la vista publica. Son anchos a proposito: «3 personas de
// 0-5 en el municipio X» no senala a una familia concreta, «un nino de 4» si.
export const RANGOS_EDAD = ['0-5', '6-12', '13-17', '18-59', '60+'] as const;
export type RangoEdad = typeof RANGOS_EDAD[number];

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string };

type Consulta = {
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionFamilias = Consulta & { doc(id?: string): Referencia };

export type FirestoreFamilias = {
  collection(nombre: string): ColeccionFamilias;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreFamilias {
  return ctx.db as unknown as FirestoreFamilias;
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

export function comoFecha(valor: unknown): Date | null {
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

export function estadoFamilia(valor: unknown): EstadoFamilia {
  const clave = s(valor, 20);
  // Fuera de lista cae a `nuevo`, igual que el legado.
  return (ESTADOS_FAMILIA as readonly string[]).includes(clave) ? (clave as EstadoFamilia) : 'nuevo';
}

// `Number(null)` es 0 y `Number.isFinite(0)` es cierto: sin descartar `null` y
// la cadena vacia primero, una familia sin GPS quedaria marcada en el golfo de
// Guinea. Mismo criterio que en `lugares`, `presupuestos` y `ofertas`.
export function comoCoordenada(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export type Integrante = {
  nombre: string;
  parentesco: string;
  edad: number;
  menor: boolean;
  ocupacion: string;
  condicionMedica: string;
  notas: string;
};

export function comoIntegrante(valor: unknown): Integrante {
  const it = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const edad = Math.max(0, Math.min(MAX_EDAD, Math.round(n(it.edad))));
  return {
    nombre: s(it.nombre, 120),
    parentesco: s(it.parentesco, 60),
    edad,
    // El legado: `menor` explicito, o deducido de una edad conocida. Una edad
    // de 0 no cuenta porque 0 es tambien «no la dijeron».
    menor: it.menor === true || (edad > 0 && edad < 18),
    ocupacion: s(it.ocupacion, 160),
    condicionMedica: s(it.condicionMedica ?? it.condicion_medica, 400),
    notas: s(it.notas, 400),
  };
}

// Se descartan las filas del formulario que el usuario dejo en blanco.
export function integrantesDe(valor: unknown): Integrante[] {
  const crudos = Array.isArray(valor) ? valor.slice(0, MAX_INTEGRANTES) : [];
  return crudos
    .map(comoIntegrante)
    .filter((it) => it.nombre || it.parentesco || it.edad);
}

export function rangoDe(edad: number): RangoEdad | null {
  // Sin edad declarada no se inventa un rango: contarla como adulta falsearia
  // el agregado, que es lo unico que la vista publica ensena.
  if (!(edad > 0)) return null;
  if (edad <= 5) return '0-5';
  if (edad <= 12) return '6-12';
  if (edad <= 17) return '13-17';
  if (edad <= 59) return '18-59';
  return '60+';
}

export function rangosEdadDe(integrantes: readonly Integrante[]): Record<RangoEdad, number> {
  const cuenta = Object.fromEntries(RANGOS_EDAD.map((rango) => [rango, 0])) as Record<RangoEdad, number>;
  for (const integrante of integrantes) {
    const rango = rangoDe(integrante.edad);
    if (rango) cuenta[rango] += 1;
  }
  return cuenta;
}

export type Familia = {
  codigo: string;
  responsableNombre: string;
  responsableTelefono: string;
  responsableEmail: string;
  alojamiento: string;
  municipio: string;
  estadoGeo: string;
  gpsLat: number | null;
  gpsLng: number | null;
  numPersonas: number;
  numMenores: number;
  integrantes: Integrante[];
  fallecidos: number;
  fallecidosDetalle: string;
  perdioCasa: boolean;
  perdioVehiculo: boolean;
  vehiculosDetalle: string;
  sustentoPrincipal: string;
  bienesPerdidos: string;
  insumosNecesarios: string;
  notas: string;
  fotosPath: string[];
  authUid: string;
  estado: EstadoFamilia;
  createdAt: Date;
  actualizado: Date;
};

export function comoFamilia(datos: Record<string, unknown>): Familia {
  const integrantes = integrantesDe(datos.integrantes);
  return {
    codigo: s(datos.codigo, 40),
    responsableNombre: s(datos.responsableNombre, 120),
    responsableTelefono: s(datos.responsableTelefono, 40),
    responsableEmail: s(datos.responsableEmail, 120),
    alojamiento: s(datos.alojamiento, 500),
    municipio: s(datos.municipio, 120),
    estadoGeo: s(datos.estadoGeo, 120),
    gpsLat: comoCoordenada(datos.gpsLat),
    gpsLng: comoCoordenada(datos.gpsLng),
    numPersonas: Math.max(0, Math.trunc(n(datos.numPersonas))) || integrantes.length,
    numMenores: Math.max(0, Math.trunc(n(datos.numMenores))),
    integrantes,
    fallecidos: Math.max(0, Math.min(MAX_FALLECIDOS, Math.round(n(datos.fallecidos)))),
    fallecidosDetalle: s(datos.fallecidosDetalle, 500),
    perdioCasa: datos.perdioCasa !== false,
    perdioVehiculo: datos.perdioVehiculo === true,
    vehiculosDetalle: s(datos.vehiculosDetalle, 400),
    sustentoPrincipal: s(datos.sustentoPrincipal, 400),
    bienesPerdidos: s(datos.bienesPerdidos, 2000),
    insumosNecesarios: s(datos.insumosNecesarios, 500),
    notas: s(datos.notas, 1000),
    fotosPath: Array.isArray(datos.fotosPath)
      ? datos.fotosPath.map((ruta) => s(ruta, 300)).filter(Boolean).slice(0, MAX_FOTOS)
      : [],
    authUid: s(datos.authUid, 128),
    estado: estadoFamilia(datos.estado),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? comoFecha(datos.createdAt) ?? new Date(0),
  };
}

// --- Proyeccion publica -------------------------------------------------------

// Solo el codigo y agregados. Ni nombres, ni telefono, ni el alojamiento, ni el
// GPS, ni las fotos, ni las condiciones medicas de nadie: `necesidadMedica` es
// un booleano, y las edades salen en rangos anchos.
export function documentoPublico(familia: Familia): Record<string, unknown> {
  return {
    codigo: familia.codigo,
    municipio: familia.municipio,
    estadoGeo: familia.estadoGeo,
    numPersonas: familia.numPersonas,
    numMenores: familia.numMenores,
    perdioCasa: familia.perdioCasa,
    perdioVehiculo: familia.perdioVehiculo,
    // El legado no tenia esta columna: la vista `familias_public` la derivaba de
    // `fallecidos > 0`. Aqui se calcula igual, pero nunca sale el detalle.
    perdioFamiliar: familia.fallecidos > 0,
    necesidadMedica: familia.integrantes.some((it) => Boolean(it.condicionMedica)),
    rangosEdad: rangosEdadDe(familia.integrantes),
    insumosNecesarios: familia.insumosNecesarios,
    estado: familia.estado,
    createdAt: familia.createdAt,
  };
}

// --- Fotos --------------------------------------------------------------------

// Categoria propia y cerrada: retratan la casa destruida de una familia y a
// quienes viven en ella. Solo el admin y quien las subio.
export function rutaPropia(uid: string, ruta: string): boolean {
  return Boolean(uid) && ruta.startsWith(`private/${uid}/families/`);
}

function fotosPropias(uid: string, valor: unknown): string[] {
  const crudas = Array.isArray(valor) ? valor : [valor];
  return crudas
    .map((ruta) => s(ruta, 300))
    .filter((ruta) => ruta && rutaPropia(uid, ruta))
    .slice(0, MAX_FOTOS);
}

// --- Acciones -----------------------------------------------------------------

defineAction({
  nombre: 'damnificado_registrar',
  // Sigue siendo anonima. Es el unico formulario que rellena alguien que acaba
  // de perder su casa: pedirle que se cree una cuenta antes de poder pedir ayuda
  // costaria registros. Las fotos SI necesitan sesion (las reglas de Storage no
  // dejan escribir en `private/<uid>/…` sin ella), asi que son opcionales y solo
  // se aceptan cuando la hay: sin cuenta se registra igual, sin fotos.
  auth: 'anon',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    // Honeypot: un campo que ninguna persona ve y que los bots rellenan. Se
    // finge exito para no ensenarles que fueron detectados.
    if (s(payload.web, 100)) return { codigo: CODIGO_TRAMPA, ok: true };

    const responsableNombre = s(payload.responsableNombre, 120);
    if (!responsableNombre) throw new ApiError('Falta el nombre de quien registra a la familia');

    const uid = ctx.uid ?? '';
    const integrantes = integrantesDe(payload.integrantes);

    const gps = (payload.gps && typeof payload.gps === 'object' ? payload.gps : {}) as Record<string, unknown>;
    const lat = comoCoordenada(gps.lat);
    const lng = comoCoordenada(gps.lng);
    // Rango mundial, no la caja de Venezuela: una familia puede registrarse
    // desde donde la acogieron. Fuera de rango no es un error, se ignora.
    const conCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    const db = firestore(ctx);
    const codigo = idEntidad(PREFIJO_FAMILIA);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      const familia: Familia = {
        codigo,
        responsableNombre,
        responsableTelefono: s(payload.responsableTelefono, 40),
        responsableEmail: s(payload.responsableEmail, 120),
        alojamiento: s(payload.alojamiento, 500),
        municipio: s(payload.municipio, 120),
        estadoGeo: s(payload.estadoGeo, 120),
        gpsLat: conCoords ? lat : null,
        gpsLng: conCoords ? lng : null,
        numPersonas: integrantes.length,
        numMenores: integrantes.filter((it) => it.menor).length,
        integrantes,
        fallecidos: Math.max(0, Math.min(MAX_FALLECIDOS, Math.round(n(payload.fallecidos)))),
        fallecidosDetalle: s(payload.fallecidosDetalle, 500),
        perdioCasa: payload.perdioCasa !== false,
        perdioVehiculo: payload.perdioVehiculo === true,
        vehiculosDetalle: s(payload.vehiculosDetalle, 400),
        sustentoPrincipal: s(payload.sustentoPrincipal, 400),
        bienesPerdidos: s(payload.bienesPerdidos, 2000),
        insumosNecesarios: '',
        notas: s(payload.notas, 1000),
        fotosPath: fotosPropias(uid, payload.fotosPath ?? payload.fotos),
        authUid: uid,
        estado: 'nuevo',
        createdAt: ctx.now,
        actualizado: ctx.now,
      };

      // El id ES el codigo: es lo unico que la familia se lleva del formulario.
      tx.set(db.collection(COLECCION).doc(codigo), { ...familia });
      publicar(tx, ctxMin.db, PROYECCION, codigo, documentoPublico(familia));

      // Sin historial, igual que el legado: la bitacora publica por centro no es
      // el sitio para anunciar que una familia se registro.
      return { codigo, numPersonas: familia.numPersonas, numMenores: familia.numMenores };
    });
  },
});

defineAction({
  nombre: 'admin_damnificados',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const snapshot = await firestore(ctx).collection(COLECCION)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_FAMILIAS_ADMIN)
      .get();

    return {
      familias: snapshot.docs.map((documento) => {
        const familia = comoFamilia((documento.data() ?? {}) as Record<string, unknown>);
        // Claves snake_case: son las que lee `js/admin.js:655-676`.
        return {
          id: documento.id,
          codigo: familia.codigo,
          responsable_nombre: familia.responsableNombre,
          responsable_telefono: familia.responsableTelefono,
          responsable_email: familia.responsableEmail,
          alojamiento: familia.alojamiento,
          municipio: familia.municipio,
          estado_geo: familia.estadoGeo,
          gps_lat: familia.gpsLat,
          gps_lng: familia.gpsLng,
          num_personas: familia.numPersonas,
          num_menores: familia.numMenores,
          integrantes: familia.integrantes.map((it) => ({
            nombre: it.nombre,
            parentesco: it.parentesco,
            edad: it.edad,
            menor: it.menor,
            ocupacion: it.ocupacion,
            condicion_medica: it.condicionMedica,
            notas: it.notas,
          })),
          fallecidos: familia.fallecidos,
          fallecidos_detalle: familia.fallecidosDetalle,
          perdio_casa: familia.perdioCasa,
          perdio_vehiculo: familia.perdioVehiculo,
          vehiculos_detalle: familia.vehiculosDetalle,
          sustento_principal: familia.sustentoPrincipal,
          bienes_perdidos: familia.bienesPerdidos,
          insumos_necesarios: familia.insumosNecesarios,
          notas: familia.notas,
          // RUTAS, no URLs firmadas. El legado firmaba hasta 300 x 12 URLs de
          // una hora en cada apertura de la pantalla, mirase el admin las que
          // mirase; la consola pide la firma de la foto que va a abrir.
          fotos: familia.fotosPath,
          estado: familia.estado,
          created_at: iso(familia.createdAt),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'admin_damnificado_estado',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');
    const estado = estadoFamilia(payload.estado);

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = db.collection(COLECCION).doc(id);
      const documento = await tx.get(referencia);
      // El legado hacia un `update` de 0 filas y respondia exito: marcar como
      // atendida una familia que no existe parecia funcionar.
      if (!documento.exists) throw new ApiError('Familia no encontrada', 404);

      const previa = comoFamilia((documento.data() ?? {}) as Record<string, unknown>);
      const familia: Familia = { ...previa, estado, actualizado: ctx.now };

      tx.set(referencia, { ...familia });
      publicar(tx, ctxMin.db, PROYECCION, id, documentoPublico(familia));

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: COLECCION,
        entidadId: id,
        antes: { estado: previa.estado },
        despues: { estado },
      });

      return { estado };
    });
  },
});

// --- Fuente del reconciliador -------------------------------------------------

// `familiasPublicas` se deriva de `familiasDamnificadas` con el mismo mapeo que
// la accion: el filtro de PII vive en `documentoPublico` y en ningun otro sitio.
registrarFuente({
  coleccion: COLECCION,
  proyeccion: PROYECCION,
  mapear: ({ datos }) => documentoPublico(comoFamilia(datos)),
});

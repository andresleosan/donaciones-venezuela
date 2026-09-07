import { ApiError, coordsAproximadas, geoValida, idEntidad, mov, n, opcion, s } from './contract.js';
import type { ActionContext, ActionPayload, ActionResult } from './contract.js';
import { auditar } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { defineAction } from './registry.js';
import {
  agregarMovimiento,
  cargarFacturaPorToken,
  comoFecha,
  guardarFactura,
  instantanea,
  tokenNormalizado,
} from './facturas.js';
import type { FirestoreFacturas } from './facturas.js';

// Dominio: denuncias.
//
// Modelo:
//   denuncias/{DEN-XXXXXXXX}   canonico y privado ENTERO. No hay proyeccion
//                              publica: `denuncias_listar` la lee por la Function
//                              y filtra ahi, porque publicar una coleccion que el
//                              cliente pueda listar seria publicar el mapa de
//                              quien denuncio y desde donde.
//
// El video vive en `private/<uid>/reports/<id>.webm|mp4`, la unica categoria de
// Storage que admite video. Nunca se sirve por una URL fija: `denuncia_video`
// firma una de 120 s cuando alguien le da al play, y queda auditada.

export const PREFIJO_DENUNCIA = 'DEN';
export const COLECCION = 'denuncias';

export const TOPE_DENUNCIAS_PUBLICAS = 50;
export const TOPE_DENUNCIAS_ADMIN = 100;
export const MAX_DURACION_S = 600;
export const MAX_HORAS_ATRASO = 999;

// Contrato §1.19: cualquier otro valor cae a `Otro`.
export const TIPOS_DENUNCIA = ['Retención de insumos', 'Otro'] as const;
export const ESTADOS_DENUNCIA = ['Recibida', 'En revisión', 'Atendida'] as const;
export const ORIGENES_DENUNCIA = ['usuario', 'admin'] as const;

export type TipoDenuncia = typeof TIPOS_DENUNCIA[number];
export type EstadoDenuncia = typeof ESTADOS_DENUNCIA[number];
export type OrigenDenuncia = typeof ORIGENES_DENUNCIA[number];

// La URL del video se pide al pulsar play, no al pintar la lista: 120 s bastan
// para que el navegador empiece a descargarlo y no para reenviar el enlace.
export const TTL_VIDEO_MS = 120 * 1000;

export const AJENA = 'Denuncia no encontrada';

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string; get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }> };

type Consulta = {
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionDenuncias = Consulta & { doc(id?: string): Referencia };

export type FirestoreDenuncias = {
  collection(nombre: string): ColeccionDenuncias;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreDenuncias {
  return ctx.db as unknown as FirestoreDenuncias;
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

// --- Costura del firmado ------------------------------------------------------

// Firmar es lo unico de este dominio que sale de Firestore. Se inyecta para que
// las pruebas de contrato no necesiten un bucket, y para que el fallo de Storage
// no se confunda con un fallo de permisos.
export type FirmadorDeVideo = (ruta: string, expira: Date) => Promise<string>;

let firmador: FirmadorDeVideo | null = null;

export function conectarFirmadorDeVideo(fn: FirmadorDeVideo | null): void {
  firmador = fn;
}

async function firmarPorDefecto(ruta: string, expira: Date): Promise<string> {
  // Import dinamico: cargar el SDK de Storage al importar el modulo obligaria a
  // tener una app inicializada solo para registrar acciones.
  const { getStorage } = await import('firebase-admin/storage');
  const configurado = process.env.STORAGE_BUCKET?.trim();
  const bucket = configurado ? getStorage().bucket(configurado) : getStorage().bucket();
  const [url] = await bucket.file(ruta).getSignedUrl({ version: 'v4', action: 'read', expires: expira });
  return url;
}

async function firmar(ruta: string, expira: Date): Promise<string> {
  return (firmador ?? firmarPorDefecto)(ruta, expira);
}

// --- Modelo -------------------------------------------------------------------

export type Denuncia = {
  // Identidad de quien denuncia. El legado guardaba el correo que venia en el
  // cuerpo de la peticion; aqui es el uid del ID token y el rol de sus claims.
  uid: string;
  rol: string;
  tipo: TipoDenuncia;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsPrecision: number | null;
  texto: string;
  videoPath: string;
  duracionS: number;
  facturaToken: string;
  origen: OrigenDenuncia;
  estado: EstadoDenuncia;
  createdAt: Date;
  actualizado: Date;
};

export function tipoDenuncia(valor: unknown): TipoDenuncia {
  return opcion(valor, TIPOS_DENUNCIA, 'Otro');
}

export function estadoDenuncia(valor: unknown): EstadoDenuncia {
  return opcion(valor, ESTADOS_DENUNCIA, 'Recibida');
}

export function duracionValida(valor: unknown): number {
  return Math.max(0, Math.min(MAX_DURACION_S, Math.round(n(valor))));
}

export function comoDenuncia(datos: Record<string, unknown>): Denuncia {
  const lat = datos.gpsLat === null || datos.gpsLat === undefined ? null : Number(datos.gpsLat);
  const lng = datos.gpsLng === null || datos.gpsLng === undefined ? null : Number(datos.gpsLng);
  const precision = datos.gpsPrecision === null || datos.gpsPrecision === undefined
    ? null
    : Number(datos.gpsPrecision);
  return {
    uid: s(datos.uid, 128),
    rol: s(datos.rol, 20),
    tipo: tipoDenuncia(datos.tipo),
    gpsLat: Number.isFinite(lat) ? lat : null,
    gpsLng: Number.isFinite(lng) ? lng : null,
    gpsPrecision: Number.isFinite(precision) ? precision : null,
    texto: s(datos.texto, 1000),
    videoPath: s(datos.videoPath, 300),
    duracionS: duracionValida(datos.duracionS),
    facturaToken: s(datos.facturaToken, 40),
    origen: opcion(datos.origen, ORIGENES_DENUNCIA, 'usuario'),
    estado: estadoDenuncia(datos.estado),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? comoFecha(datos.createdAt) ?? new Date(0),
  };
}

function iso(valor: unknown): string {
  return comoFecha(valor)?.toISOString() ?? '';
}

// Lo que ve cualquiera con sesion. El legado devolvia el GPS EXACTO de quien
// grababa —el sitio desde donde denuncio— a cualquiera, sin sesion siquiera.
// Aqui va redondeado a 2 decimales (~1 km), como las coordenadas de una oferta,
// y sin identidad, sin rol, sin texto y sin la precision del GPS.
export function filaPublica(id: string, denuncia: Denuncia): Record<string, unknown> {
  const aprox = denuncia.gpsLat !== null && denuncia.gpsLng !== null
    ? coordsAproximadas(denuncia.gpsLat, denuncia.gpsLng)
    : null;
  return {
    id,
    created_at: iso(denuncia.createdAt),
    tipo: denuncia.tipo,
    gps_lat: aprox ? aprox.lat : null,
    gps_lng: aprox ? aprox.lng : null,
    duracion_s: denuncia.duracionS,
    estado: denuncia.estado,
    // Ni la ruta ni una URL: solo si hay algo que mirar. El enlace lo firma
    // `denuncia_video` cuando alguien pulsa play.
    tieneVideo: Boolean(denuncia.videoPath),
  };
}

// --- Video --------------------------------------------------------------------

// La unica categoria que admite video, y solo del uid que graba.
export function rutaDeVideo(uid: string, valor: unknown): string {
  const ruta = s(valor, 300);
  if (!uid || !ruta.startsWith(`private/${uid}/reports/`)) return '';
  return /\.(webm|mp4)$/.test(ruta) ? ruta : '';
}

// --- Acciones del denunciante -------------------------------------------------

function gpsDelPayload(valor: unknown): { lat: number | null; lng: number | null; precision: number | null } {
  const gps = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const { lat, lng } = geoValida({ lat: gps.lat, lng: gps.lng });
  const precision = Number(gps.precision);
  return { lat, lng, precision: Number.isFinite(precision) ? precision : null };
}

// Carga la denuncia que el cliente dice estar continuando y comprueba que es
// suya. Un id ajeno responde lo mismo que uno inexistente: quien lo prueba no
// aprende si existe.
async function cargarPropia(
  tx: TransaccionMinima,
  db: FirestoreDenuncias,
  id: string,
  uid: string,
): Promise<{ id: string; datos: Denuncia }> {
  const documento = await tx.get(db.collection(COLECCION).doc(id));
  if (!documento.exists) throw new ApiError(AJENA, 404);
  const datos = comoDenuncia((documento.data() ?? {}) as Record<string, unknown>);
  if (!uid || datos.uid !== uid) throw new ApiError(AJENA, 404);
  return { id, datos };
}

defineAction({
  nombre: 'denuncia_parcial',
  auth: 'user',
  cubo: 'denuncia',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const uid = ctx.uid ?? '';
    const id = s(payload.denunciaId, 40);
    const duracionS = duracionValida(payload.duracionS);
    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      // Continuar una grabacion: solo avanza el reloj. El legado RESUBIA el
      // video entero cada ~5 s (hasta 30 MB por parcial) para acabar
      // sustituyendolo otra vez al enviar; el cliente ya guarda los trozos en
      // IndexedDB, asi que aqui solo se anota que la grabacion sigue viva.
      if (id) {
        const previa = await cargarPropia(tx, db, id, uid);
        tx.set(db.collection(COLECCION).doc(id), {
          duracionS: Math.max(previa.datos.duracionS, duracionS),
          actualizado: ctx.now,
        }, { merge: true });
        return { id };
      }

      const gps = gpsDelPayload(payload.gps);
      const nueva: Denuncia = {
        uid,
        rol: ctx.role,
        tipo: tipoDenuncia(payload.tipo),
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        gpsPrecision: gps.precision,
        texto: '',
        videoPath: '',
        duracionS,
        facturaToken: tokenNormalizado(payload.facturaToken),
        origen: 'usuario',
        estado: 'Recibida',
        createdAt: ctx.now,
        actualizado: ctx.now,
      };

      const nuevoId = idEntidad(PREFIJO_DENUNCIA);
      tx.set(db.collection(COLECCION).doc(nuevoId), { ...nueva });
      return { id: nuevoId };
    });
  },
});

defineAction({
  nombre: 'denuncia_crear',
  auth: 'user',
  cubo: 'denuncia',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const uid = ctx.uid ?? '';
    const videoPath = rutaDeVideo(uid, payload.videoPath ?? payload.video);
    if (!videoPath) throw new ApiError('Falta el video de la denuncia');

    const id = s(payload.denunciaId, 40);
    const texto = s(payload.texto, 1000);
    const duracionS = duracionValida(payload.duracionS);
    // Un campo AUSENTE no es un campo vacio: al cerrar una denuncia que los
    // parciales ya abrieron, no mandar el tipo o el GPS no puede borrar lo que
    // se guardo al empezar a grabar. El legado los reescribia siempre, asi que
    // enviar sin `tipo` convertia una «Retención de insumos» en «Otro» y perdia
    // las coordenadas del sitio.
    const traeTipo = payload.tipo !== undefined && payload.tipo !== null;
    const traeGps = Boolean(payload.gps && typeof payload.gps === 'object');
    const gps = gpsDelPayload(payload.gps);
    const tipo = tipoDenuncia(payload.tipo);
    const facturaToken = tokenNormalizado(payload.facturaToken);
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      // TODAS las lecturas antes de la primera escritura.
      const previa = id ? await cargarPropia(tx, db, id, uid) : null;
      // El movimiento solo se anota si el token existe de verdad: el legado
      // guardaba `factura_token` apuntara a donde apuntara.
      const cargada = facturaToken ? await cargarFacturaPorToken(tx, ctxMin, facturaToken) : null;

      const denunciaId = previa?.id ?? idEntidad(PREFIJO_DENUNCIA);
      const denuncia: Denuncia = {
        uid,
        rol: previa?.datos.rol ?? ctx.role,
        tipo: traeTipo || !previa ? tipo : previa.datos.tipo,
        gpsLat: traeGps || !previa ? gps.lat : previa.datos.gpsLat,
        gpsLng: traeGps || !previa ? gps.lng : previa.datos.gpsLng,
        gpsPrecision: traeGps || !previa ? gps.precision : previa.datos.gpsPrecision,
        texto,
        videoPath,
        duracionS: Math.max(previa?.datos.duracionS ?? 0, duracionS),
        // Ni el estado ni la factura de una denuncia ya abierta se reescriben:
        // el admin pudo haberla puesto «En revisión» mientras se grababa.
        facturaToken: previa ? previa.datos.facturaToken : facturaToken,
        origen: previa?.datos.origen ?? 'usuario',
        estado: previa?.datos.estado ?? 'Recibida',
        createdAt: previa?.datos.createdAt ?? ctx.now,
        actualizado: ctx.now,
      };

      tx.set(db.collection(COLECCION).doc(denunciaId), { ...denuncia });

      // El movimiento SI es publico en el hilo del token, y por eso no lleva
      // datos: solo dice que hubo una denuncia sobre esa factura.
      if (cargada && !previa) {
        const antes = instantanea(cargada.factura);
        agregarMovimiento(tx, ctxMin, cargada, {
          tipo: 'Denuncia',
          descripcion: mov('denunciaRegistrada'),
          monto: 0,
        });
        guardarFactura(tx, ctxMin, cargada, antes);
      }

      return { id: denunciaId, estado: denuncia.estado };
    });
  },
});

defineAction({
  nombre: 'denuncias_listar',
  // El legado la servia ANONIMA, con el GPS exacto de quien grababa y una URL de
  // una hora por video. Exigir sesion es lo que decide el plan: la lista sigue
  // siendo la garantia publica de que las denuncias existen, pero no es un mapa
  // abierto de quien denuncio y desde donde.
  auth: 'user',
  cubo: 'lectura',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const { docs } = await firestore(ctx).collection(COLECCION)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_DENUNCIAS_PUBLICAS)
      .get();

    return {
      denuncias: docs.map((documento) => filaPublica(
        documento.id,
        comoDenuncia((documento.data() ?? {}) as Record<string, unknown>),
      )),
    };
  },
});

defineAction({
  nombre: 'denuncia_video',
  // Accion nueva. El legado firmaba una URL de UNA HORA por cada video en cada
  // apertura de la lista (50 firmas por visita, todas reenviables durante una
  // hora aunque nadie mirara el video). Aqui se firma una sola, de 120 s, cuando
  // alguien pulsa play, y queda auditada. Mismo patron que `contactar_motorizado`
  // (3.2) y el comprobante de una donacion (3.4): el dato caro y sensible sale de
  // uno en uno y con su propio cupo.
  auth: 'user',
  cubo: 'archivos',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');

    const documento = await firestore(ctx).collection(COLECCION).doc(id).get();
    if (!documento.exists) throw new ApiError(AJENA, 404);

    const denuncia = comoDenuncia((documento.data() ?? {}) as Record<string, unknown>);
    if (!denuncia.videoPath) throw new ApiError('Esta denuncia no tiene video', 404);

    const expira = new Date(ctx.now.getTime() + TTL_VIDEO_MS);
    const url = await firmar(denuncia.videoPath, expira);
    return { id, url, expiraEn: expira.toISOString() };
  },
});

// --- Acciones del admin -------------------------------------------------------

defineAction({
  nombre: 'admin_denuncias',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const { docs } = await firestore(ctx).collection(COLECCION)
      .orderBy('createdAt', 'desc')
      .limit(TOPE_DENUNCIAS_ADMIN)
      .get();

    return {
      denuncias: docs.map((documento) => {
        const denuncia = comoDenuncia((documento.data() ?? {}) as Record<string, unknown>);
        // Claves snake_case: son las que lee `js/admin.js:611-625`. El admin SI
        // ve el GPS exacto, el texto y el rol.
        return {
          id: documento.id,
          created_at: iso(denuncia.createdAt),
          uid: denuncia.uid,
          rol: denuncia.rol,
          tipo: denuncia.tipo,
          gps_lat: denuncia.gpsLat,
          gps_lng: denuncia.gpsLng,
          gps_precision: denuncia.gpsPrecision,
          duracion_s: denuncia.duracionS,
          texto: denuncia.texto,
          factura_token: denuncia.facturaToken,
          origen: denuncia.origen,
          estado: denuncia.estado,
          tieneVideo: Boolean(denuncia.videoPath),
        };
      }),
    };
  },
});

defineAction({
  nombre: 'admin_denuncia_estado',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const id = s(payload.id, 40);
    if (!id) throw new ApiError('id requerido');
    const estado = estadoDenuncia(payload.estado);

    const db = firestore(ctx);

    return db.runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const referencia = db.collection(COLECCION).doc(id);
      const documento = await tx.get(referencia);
      // El legado hacia un `update` de 0 filas y respondia exito.
      if (!documento.exists) throw new ApiError(AJENA, 404);

      const previa = comoDenuncia((documento.data() ?? {}) as Record<string, unknown>);
      tx.set(referencia, { estado, actualizado: ctx.now }, { merge: true });

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

defineAction({
  nombre: 'admin_denuncia_crear',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const facturaToken = tokenNormalizado(payload.facturaToken);
    const transportista = s(payload.transportista, 120) || 'desconocido';
    const horas = Math.max(0, Math.min(MAX_HORAS_ATRASO, Math.round(n(payload.horas))));
    const tramo = n(payload.tramo) === 2 ? 2 : 1;
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = facturaToken ? await cargarFacturaPorToken(tx, ctxMin, facturaToken) : null;

      const id = idEntidad(PREFIJO_DENUNCIA);
      const denuncia: Denuncia = {
        // El legado inventaba un correo, `administracion@sistema.local`. Aqui
        // queda el uid del admin que la genera, que es quien responde por ella.
        uid: ctx.uid ?? '',
        rol: 'admin',
        tipo: 'Retención de insumos',
        gpsLat: null,
        gpsLng: null,
        gpsPrecision: null,
        // Texto en español canonico, compuesto en el servidor: es solo-admin y
        // no pasa por el redactor de movimientos del cliente.
        texto: `Generada por administración: el transportista ${transportista} no se reportó; retraso de ${horas} h en el tramo ${tramo}.`,
        videoPath: '',
        duracionS: 0,
        facturaToken,
        origen: 'admin',
        estado: 'Recibida',
        createdAt: ctx.now,
        actualizado: ctx.now,
      };

      tx.set(db.collection(COLECCION).doc(id), { ...denuncia });

      if (cargada) {
        const antes = instantanea(cargada.factura);
        agregarMovimiento(tx, ctxMin, cargada, {
          tipo: 'Denuncia',
          descripcion: mov('denunciaRegistrada'),
          monto: 0,
        });
        guardarFactura(tx, ctxMin, cargada, antes);
      }

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: COLECCION,
        entidadId: id,
        despues: { origen: 'admin', facturaToken, transportista, horas, tramo },
      });

      return { id, estado: denuncia.estado };
    });
  },
});

// `denuncias` NO se declara como fuente del reconciliador: no tiene proyeccion
// publica que reconstruir ni contador del tablero que alimentar. La lista la
// arma `denuncias_listar` leyendo la canonica desde la Function.

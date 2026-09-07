import { ApiError, coordsAproximadas, mov, n, s, soloDigitos } from './contract.js';
import type { ActionContext, ActionPayload, ActionResult, EstadoFactura } from './contract.js';
import { historial } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { publicar } from './publicar.js';
import { defineAction } from './registry.js';
import {
  COLECCION as COLECCION_FACTURAS,
  agregarEvidencia,
  agregarMovimiento,
  aplicarTransicion,
  cargarFacturaPorToken,
  comoFecha,
  crearFactura,
  estadoFactura,
  guardarFactura,
  instantanea,
  nuevoToken,
  refFactura,
  tokenNormalizado,
} from './facturas.js';
import type { Factura, FacturaCargada, FirestoreFacturas } from './facturas.js';
import { comoCoordenada, documentoPublico as presupuestoPublico } from './presupuestos.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: ofertas. Quien YA TIENE el insumo y quiere que alguien lo recoja.
//
// Una oferta es una factura (`facturas/{FCT-…}` con `tipo: 'oferta'`) que nace en
// estado `Ofrecida`, mas dos documentos mas:
//
//   ofertasPublicas/{token}      lo que ve el directorio: insumo, cantidad,
//                                zona y un punto de ~1 km. Nada mas.
//   facturasContacto/{facturaId} telefono, nombre, el sitio exacto, las
//                                coordenadas finas y las fotos.
//
// Esa separacion es el arreglo de la fuga que documenta el contrato §1.14: el
// legado guardaba TODO eso dentro de `facturas.descripcion`, y
// `seguimiento_factura` devolvia la descripcion integra, asi que con el token de
// una oferta cualquiera obtenia el telefono, el nombre y las coordenadas
// exactas de quien donaba. Aqui el contacto no esta en `facturas`, no esta en
// ninguna proyeccion y no lo alcanza ninguna funcion de publicacion: la unica
// salida es `reserva_detalle`, con sesion y con la reserva viva del trabajo.

export const PROYECCION = 'ofertasPublicas';
export const COLECCION_CONTACTO = 'facturasContacto';
export const TIPO: Factura['tipo'] = 'oferta';

export const TOPE_OFERTAS = 100;
export const MAX_FOTOS = 20;
export const MAX_CANTIDAD = 1_000_000;

// Lo que el directorio anuncia como recogible.
export const ESTADOS_PUBLICADOS: readonly EstadoFactura[] = ['Ofrecida', 'EnCamino'];

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string };

type Consulta = {
  where(campo: string, operador: string, valor: unknown): Consulta;
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionOfertas = Consulta & { doc(id?: string): Referencia };

export type FirestoreOfertas = {
  collection(nombre: string): ColeccionOfertas;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestoreOfertas {
  return ctx.db as unknown as FirestoreOfertas;
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

// --- Costura de la reserva de viaje (Task 3.5) -------------------------------

// «La reserva es el permiso» (contrato §1.7): solo quien reservo el trabajo con
// `viaje_iniciar` puede pedir el contacto del donante y registrar la recogida.
// Los viajes son la Task 3.5, asi que aqui solo queda el punto de enganche, el
// mismo patron que `conectarRegistroDeEntregas` de la Task 3.1.
//
// Mientras nadie lo conecte, `reserva_detalle` y `recoger_oferta` responden 403
// con el mensaje del legado. No es un cabo suelto: sin viajes NO EXISTE ninguna
// reserva viva, asi que «no tienes la reserva» es la respuesta correcta, y
// fallar cerrado es lo unico aceptable para la accion que entrega un telefono.
export type ReservaViva = {
  viajeId: string;
  uid: string;
  nombre: string;
  // Punto donde empezo el tramo en curso. Viaja DENTRO de la reserva porque
  // `registrarRecogida` calcula los km despues de las primeras escrituras de la
  // accion, y Firestore prohibe leer despues de escribir: sin esto habria que
  // volver a leer el viaje justo cuando ya no se puede.
  origen?: { lat: number | null; lng: number | null };
};

export type ReservaDeViaje = {
  // Lanza `ApiError` si no hay reserva viva o si es de otra persona.
  exigirDueno(
    tx: TransaccionMinima,
    ctx: ContextoMinimo,
    facturaId: string,
    uid: string,
  ): Promise<ReservaViva>;
  // Sella el paso 2 del viaje con el GPS de la recogida y devuelve los km del
  // primer tramo, si se pudieron calcular.
  registrarRecogida(
    tx: TransaccionMinima,
    ctx: ContextoMinimo,
    reserva: ReservaViva,
    gps: { lat: number | null; lng: number | null },
  ): Promise<{ km: number | null }>;
};

export const SIN_RESERVA = 'Tu reserva venció; vuelve a reservarla';

let reservaDeViaje: ReservaDeViaje | null = null;

export function conectarReservaDeViaje(fn: ReservaDeViaje | null): void {
  reservaDeViaje = fn;
}

function exigirReserva(): ReservaDeViaje {
  if (!reservaDeViaje) throw new ApiError(SIN_RESERVA, 403);
  return reservaDeViaje;
}

// --- Modelo -------------------------------------------------------------------

// Lo que se puede contar en publico de una oferta. Todo lo que identifique a
// quien dona o diga donde vive va en `Contacto`, nunca aqui.
export type MetaOferta = {
  insumo: string;
  cantidad: number;
  unidad: string;
  zona: string;
  centro: string;
  latAprox: number | null;
  lngAprox: number | null;
};

// Fuera de `facturas` a proposito.
export type ContactoOferta = {
  telefono: string;
  nombreDonante: string;
  ubicacion: string;
  lat: number | null;
  lng: number | null;
  fotosInsumoPath: string[];
  fotoCedulaPath: string;
  fotoLugarPath: string;
  authUid: string;
  createdAt: Date;
};

export function comoMeta(valor: unknown): MetaOferta {
  const meta = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const latAprox = meta.latAprox === null || meta.latAprox === undefined ? null : Number(meta.latAprox);
  const lngAprox = meta.lngAprox === null || meta.lngAprox === undefined ? null : Number(meta.lngAprox);
  return {
    insumo: s(meta.insumo, 120),
    cantidad: n(meta.cantidad),
    unidad: s(meta.unidad, 30) || 'unidades',
    zona: s(meta.zona, 80),
    centro: s(meta.centro, 120),
    latAprox: Number.isFinite(latAprox) ? latAprox : null,
    lngAprox: Number.isFinite(lngAprox) ? lngAprox : null,
  };
}

export function comoContacto(datos: Record<string, unknown>): ContactoOferta {
  const lat = datos.lat === null || datos.lat === undefined ? null : Number(datos.lat);
  const lng = datos.lng === null || datos.lng === undefined ? null : Number(datos.lng);
  return {
    telefono: s(datos.telefono, 40),
    nombreDonante: s(datos.nombreDonante, 120),
    ubicacion: s(datos.ubicacion, 160),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    fotosInsumoPath: Array.isArray(datos.fotosInsumoPath)
      ? datos.fotosInsumoPath.map((ruta) => s(ruta, 300)).filter(Boolean)
      : [],
    fotoCedulaPath: s(datos.fotoCedulaPath, 300),
    fotoLugarPath: s(datos.fotoLugarPath, 300),
    authUid: s(datos.authUid, 128),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
  };
}

// `ofertaPublicaUI` del contrato §1.14: sin nombre, sin telefono y sin la
// direccion; las coordenadas van a 2 decimales (~1 km), que ubican el barrio
// pero no la casa.
export function documentoPublico(factura: Factura): Record<string, unknown> {
  const meta = comoMeta(factura.meta);
  return {
    token: factura.tokenPublico,
    estado: factura.estado,
    insumo: meta.insumo,
    cantidad: meta.cantidad,
    unidad: meta.unidad,
    zona: meta.zona,
    centro: meta.centro,
    coordsAprox: meta.latAprox !== null && meta.lngAprox !== null
      ? { lat: meta.latAprox, lng: meta.lngAprox }
      : null,
    createdAt: factura.createdAt,
  };
}

// Vista privada, solo para quien tiene la reserva viva (`ofertaUI` del §1.14).
export function detallePrivado(factura: Factura, contacto: ContactoOferta): Record<string, unknown> {
  const meta = comoMeta(factura.meta);
  return {
    token: factura.tokenPublico,
    estado: factura.estado,
    insumo: meta.insumo,
    cantidad: meta.cantidad,
    unidad: meta.unidad,
    zona: meta.zona,
    centro: meta.centro,
    ubicacion: contacto.ubicacion,
    telefono: contacto.telefono,
    nombreDonante: contacto.nombreDonante,
    coords: contacto.lat !== null && contacto.lng !== null
      ? { lat: contacto.lat, lng: contacto.lng }
      : null,
  };
}

function refContacto(db: FirestoreOfertas, facturaId: string): Referencia {
  return db.collection(COLECCION_CONTACTO).doc(facturaId);
}

// Unica lectura del contacto fuera de este modulo. La usa `viaje_iniciar`
// (Task 3.5) para devolverle el telefono a quien acaba de quedarse el trabajo,
// que es lo que hacia el legado; sigue exigiendo la reserva viva.
export async function cargarContacto(
  tx: TransaccionMinima,
  ctx: ContextoMinimo,
  facturaId: string,
): Promise<ContactoOferta> {
  const documento = await tx.get(refContacto(ctx.db as unknown as FirestoreOfertas, facturaId));
  return comoContacto((documento.data() ?? {}) as Record<string, unknown>);
}

export function republicar(tx: TransaccionMinima, ctx: ContextoMinimo, cargada: FacturaCargada): void {
  publicar(tx, ctx.db, PROYECCION, cargada.factura.tokenPublico, documentoPublico(cargada.factura));
}

// --- Fotos --------------------------------------------------------------------

// La categoria `offers` es cerrada: ni siquiera el rol `panel` la lee. Contiene
// la cedula de quien ofrece y una foto de su casa.
export function rutaPropia(uid: string, ruta: string): boolean {
  return Boolean(uid) && ruta.startsWith(`private/${uid}/offers/`);
}

function rutasPropias(uid: string, valor: unknown, tope: number): string[] {
  const crudas = Array.isArray(valor) ? valor : [valor];
  return crudas
    .map((ruta) => s(ruta, 300))
    .filter((ruta) => ruta && rutaPropia(uid, ruta))
    .slice(0, tope);
}

// --- Acciones -----------------------------------------------------------------

defineAction({
  nombre: 'ofrecer_insumo',
  // El legado era anonimo pero exigia la foto del insumo como dataURL y la
  // subia el servidor. Ahora la sube el cliente a `private/<uid>/offers/`, y las
  // reglas de Storage exigen sesion para escribir ahi. Misma decision que
  // `registrar_voluntario` (3.2) y `donar_dinero` (3.4).
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const insumo = s(payload.insumo, 120);
    const cantidad = n(payload.cantidad);
    const ubicacion = s(payload.ubicacion, 160);
    const telefono = s(payload.telefono, 40);
    const nombreDonante = s(payload.nombreDonante, 120);
    const uid = ctx.uid ?? '';

    if (!insumo) throw new ApiError('insumo requerido');
    if (cantidad <= 0 || cantidad > MAX_CANTIDAD) throw new ApiError('cantidad inválida');
    if (!ubicacion) throw new ApiError('nombre de referencia del sitio requerido');
    if (soloDigitos(telefono).length < 7) throw new ApiError('teléfono requerido para coordinar la recogida');
    if (!nombreDonante) throw new ApiError('nombre de contacto requerido');

    const fotos = rutasPropias(uid, payload.fotosInsumoPath ?? payload.fotoInsumoPath, MAX_FOTOS);
    if (!fotos.length) throw new ApiError('foto del insumo requerida');

    // Rango mundial, no la caja de Venezuela (contrato §1.4): quien ofrece puede
    // estar fuera del pais. Coordenadas invalidas no son un error, se ignoran.
    // `comoCoordenada` descarta `null` y la cadena vacia antes de convertir:
    // `Number(null)` es 0, y un 0 finito publicaria la oferta en el golfo de
    // Guinea en vez de dejarla sin punto en el mapa.
    const lat = comoCoordenada(payload.lat);
    const lng = comoCoordenada(payload.lng);
    const coords = lat !== null && lng !== null
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat, lng }
      : null;
    const aprox = coords ? coordsAproximadas(coords.lat, coords.lng) : null;

    const unidad = s(payload.unidad, 30) || 'unidades';
    const zona = s(payload.zona, 80);
    const centro = s(payload.centro, 120);
    const db = firestore(ctx);
    const token = nuevoToken();

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);

      const meta: MetaOferta = {
        insumo,
        cantidad,
        unidad,
        zona,
        centro,
        latAprox: aprox ? aprox.lat : null,
        lngAprox: aprox ? aprox.lng : null,
      };

      const cargada = await crearFactura(tx, ctxMin, {
        tipo: TIPO,
        moneda: 'unidades',
        objetivo: s(`Oferta: ${insumo} (${zona || ubicacion})`, 200),
        meta: { ...meta },
        montoRequerido: cantidad,
        estado: 'Ofrecida',
      }, token);

      // El contacto va a OTRA coleccion, no a `facturas`: ninguna proyeccion
      // puede alcanzarlo aunque alguien se equivoque al ampliar una allowlist.
      const contacto: ContactoOferta = {
        telefono,
        nombreDonante,
        ubicacion,
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        fotosInsumoPath: fotos,
        fotoCedulaPath: rutasPropias(uid, payload.fotoCedulaPath ?? payload.fotoCedula, 1)[0] ?? '',
        fotoLugarPath: rutasPropias(uid, payload.fotoLugarPath ?? payload.fotoLugar, 1)[0] ?? '',
        authUid: uid,
        createdAt: ctx.now,
      };
      tx.set(refContacto(db, cargada.id), { ...contacto });

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Oferta',
        // El legado publicaba aqui el nombre de referencia del sitio. Va la
        // zona: el movimiento es publico por el seguimiento.
        descripcion: mov('donacionOfrecida', { cantidad, unidad, insumo, ubicacion: zona }),
        monto: cantidad,
      });

      guardarFactura(tx, ctxMin, cargada, instantanea(cargada.factura));
      republicar(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarNombre: centro || 'Donaciones ofrecidas',
        insumo,
        descripcion: `Oferta de ${cantidad} ${unidad}${zona ? ` en ${zona}` : ''}`,
        origen: 'publico',
        cantidad,
        unidad,
        tipo: 'Oferta',
      });

      return { token, numeroFactura: cargada.factura.numeroFactura };
    });
  },
});

defineAction({
  nombre: 'listar_ofertas',
  auth: 'anon',
  cubo: 'lectura',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    const { docs } = await firestore(ctx).collection(PROYECCION)
      .where('estado', 'in', [...ESTADOS_PUBLICADOS])
      .orderBy('createdAt', 'asc')
      .limit(TOPE_OFERTAS)
      .get();

    return {
      ofertas: docs.map((documento) => {
        const { createdAt: _createdAt, updatedAt: _updatedAt, ...resto } = documento.data() ?? {};
        return { ...resto, token: s(resto.token, 40) || documento.id };
      }),
    };
  },
});

defineAction({
  nombre: 'reserva_detalle',
  // La unica via para obtener el telefono y la direccion de quien ofrece. Exige
  // sesion Y la reserva viva del trabajo (costura de la Task 3.5).
  auth: 'user',
  cubo: 'lectura',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const token = tokenNormalizado(payload.token);
    const reserva = exigirReserva();
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada) throw new ApiError('Trabajo no encontrado', 404);

      await reserva.exigirDueno(tx, ctxMin, cargada.id, ctx.uid ?? '');

      if (cargada.factura.tipo === 'presupuesto') {
        const { createdAt: _createdAt, ...detalle } = presupuestoPublico(cargada.factura);
        return { detalle };
      }
      if (cargada.factura.tipo !== TIPO) throw new ApiError('Trabajo no encontrado', 404);

      const contacto = await cargarContacto(tx, ctxMin, cargada.id);
      return { detalle: detallePrivado(cargada.factura, contacto) };
    });
  },
});

defineAction({
  nombre: 'recoger_oferta',
  auth: 'user',
  cubo: 'publico',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const token = tokenNormalizado(payload.token);
    const uid = ctx.uid ?? '';
    const reserva = exigirReserva();
    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada || cargada.factura.tipo !== TIPO) throw new ApiError('Oferta no encontrada', 404);

      const previo = instantanea(cargada.factura);
      const meta = comoMeta(cargada.factura.meta);

      // Orden del catalogo: primero el estado, luego el dueno de la reserva,
      // luego el destino y por ultimo los archivos.
      aplicarTransicion(cargada, ctxMin, 'recogerOferta');
      const viva = await reserva.exigirDueno(tx, ctxMin, cargada.id, uid);

      const centroDestino = s(payload.centroDestino, 120) || meta.centro;
      if (!centroDestino) throw new ApiError('centro de destino requerido');

      const evidencias: Array<[unknown, string]> = [
        [payload.fotoSitioPath ?? payload.fotoSitio, 'Foto del sitio de recogida de la oferta'],
        [payload.fotoInsumoPath ?? payload.fotoInsumo, 'Foto de la donación recogida'],
        [payload.fotoPersonaPath ?? payload.fotoPersona, 'Foto de quien entrega la donación'],
      ];
      for (const [valor, descripcion] of evidencias) {
        const ruta = rutasPropias(uid, valor, 1)[0];
        if (!ruta) continue;
        // Privadas: son la casa de una persona y su cara. Solo el admin y quien
        // las subio; nunca salen por el seguimiento publico.
        agregarEvidencia(tx, ctxMin, cargada, { archivoPath: ruta, descripcion, publica: false });
      }

      const gps = {
        lat: Number.isFinite(Number((payload.gps as { lat?: unknown } | undefined)?.lat))
          ? Number((payload.gps as { lat: unknown }).lat) : null,
        lng: Number.isFinite(Number((payload.gps as { lng?: unknown } | undefined)?.lng))
          ? Number((payload.gps as { lng: unknown }).lng) : null,
      };
      const { km } = await reserva.registrarRecogida(tx, ctxMin, viva, gps);

      const nombre = s(payload.nombreTransportista, 120) || viva.nombre;

      // El legado NO guardaba el destino en la factura: solo en el movimiento y
      // el historial, asi que la entrega posterior usaba el centro original de
      // la oferta. Aqui se persiste, que es lo que el catalogo pide.
      cargada.factura.meta = { ...meta, centro: centroDestino };

      agregarMovimiento(tx, ctxMin, cargada, {
        tipo: 'Recogida',
        descripcion: mov('donacionRecogida', {
          nombre,
          // Zona, no el nombre de referencia del sitio: el movimiento es
          // publico y ese nombre señala la casa de quien dona.
          ubicacion: meta.zona,
          centro: centroDestino,
          ...(km === null ? {} : { km }),
        }),
        monto: 0,
      });

      guardarFactura(tx, ctxMin, cargada, previo);
      republicar(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarNombre: centroDestino,
        insumo: meta.insumo,
        descripcion: `Transportista ${nombre} recogió la donación ofrecida (${meta.cantidad} ${meta.unidad})`,
        origen: 'publico',
        cantidad: meta.cantidad,
        unidad: meta.unidad,
        tipo: 'Recogida',
      });

      return { estado: cargada.factura.estado, km };
    });
  },
});

// --- Fuente del reconciliador -------------------------------------------------

function comoFacturaMinima(datos: Record<string, unknown>): Factura {
  return {
    numeroFactura: s(datos.numeroFactura, 40),
    tokenPublico: s(datos.tokenPublico, 40),
    tipo: TIPO,
    moneda: 'unidades',
    objetivo: s(datos.objetivo, 200),
    objetivoNorm: s(datos.objetivoNorm, 200),
    descripcion: s(datos.descripcion, 500),
    meta: (datos.meta && typeof datos.meta === 'object' ? datos.meta : null) as Record<string, unknown> | null,
    montoRequerido: n(datos.montoRequerido),
    montoRecaudado: n(datos.montoRecaudado),
    estado: estadoFactura(datos.estado),
    viajeVigenteId: null,
    numDonaciones: n(datos.numDonaciones),
    numMovimientos: n(datos.numMovimientos),
    numEvidencias: n(datos.numEvidencias),
    createdAt: comoFecha(datos.createdAt) ?? new Date(0),
    actualizado: comoFecha(datos.actualizado) ?? new Date(0),
    fechaCierre: comoFecha(datos.fechaCierre),
  };
}

// `facturasContacto` NO se declara como fuente: no tiene proyeccion publica y no
// alimenta el tablero. Declararla seria abrir la puerta a que algun dia alguien
// le ponga un `mapear`.
registrarFuente({
  coleccion: COLECCION_FACTURAS,
  proyeccion: PROYECCION,
  incluir: ({ datos }) => s(datos.tipo, 20) === TIPO && Boolean(s(datos.tokenPublico, 40)),
  idProyeccion: ({ datos }) => s(datos.tokenPublico, 40),
  mapear: ({ datos }) => documentoPublico(comoFacturaMinima(datos)),
});

// Se usa desde `recoger_oferta` para localizar la factura canonica; se exporta
// para que la Task 3.5 no tenga que reconstruir la ruta.
export { refFactura };

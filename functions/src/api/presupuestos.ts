import { ApiError, mov, n, normalizar, opcion, s } from './contract.js';
import type { ActionContext, ActionPayload, ActionResult, EstadoFactura } from './contract.js';
import { auditar, historial } from './db.js';
import type { ContextoMinimo, FirestoreMinimo, TransaccionMinima } from './db.js';
import { publicar } from './publicar.js';
import { defineAction } from './registry.js';
import { leerTasaActual } from './tasas.js';
import { leerLugar, lugarIdPorNombre } from './lugares.js';
import type { FirestoreLugares } from './lugares.js';
import {
  COLECCION as COLECCION_FACTURAS,
  SUB_DONACIONES,
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
  recalcularRecaudado,
  refFactura,
  tokenNormalizado,
} from './facturas.js';
import type { Factura, FacturaCargada, FirestoreFacturas } from './facturas.js';
import { registrarFuente } from '../jobs/reconciliar-proyecciones.js';

// Dominio: presupuestos. El ciclo de «compra verificada» de un presupuesto, que
// es la unica factura que se financia con dinero del publico.
//
// Un presupuesto es una factura (`facturas/{FCT-…}` con `tipo: 'presupuesto'`)
// mas una vista publica propia, `presupuestosPublicos/{token}`, que es la que
// pinta la pagina de necesidades y la lista de recogidas del transportista.
//
// Ciclo (contrato §1.15, y plan 2026-07-24 de compra verificada):
//   Abierta ──(donar_dinero cubre la meta)──> PorComprar
//   PorComprar ──(admin sube el consolidado)──> Transferida
//   PorComprar | Transferida ──(admin sube la factura del proveedor)──> Comprada
//   PorComprar | Transferida ──(anular una donacion falsa)──> Abierta
//   Comprada ──> EnTransito ──> Entregada   (Task 3.5, ciclo del transportista)
//
// El paso a `Comprada` es lo que abre el presupuesto al transportista: nada
// entra en `listar_comprados` antes de que exista la factura del proveedor.

export const PROYECCION = 'presupuestosPublicos';
export const TIPO: Factura['tipo'] = 'presupuesto';

// Topes del catalogo. El legado no ponia limite en las listas del admin: en
// Firestore eso es una lectura facturada por presupuesto en cada apertura.
export const TOPE_PRESUPUESTOS = 200;
export const TOPE_COMPRADOS = 100;
export const TOPE_POR_COMPRAR = 200;
export const TOPE_DONACIONES = 200;

export const MAX_PRECIO = 100_000_000;

// Estados que el transportista ve como «listo para recoger o en camino».
export const ESTADOS_COMPRADOS: readonly EstadoFactura[] = ['Comprada', 'EnTransito'];
export const ESTADOS_POR_COMPRAR: readonly EstadoFactura[] = ['PorComprar', 'Transferida'];

// --- Superficie minima de Firestore ------------------------------------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Referencia = { path?: string; id?: string };

type Consulta = {
  where(campo: string, operador: string, valor: unknown): Consulta;
  orderBy(campo: string, direccion?: 'asc' | 'desc'): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};

type ColeccionPresupuestos = Consulta & { doc(id?: string): Referencia & { collection(nombre: string): Consulta & { doc(id?: string): Referencia } } };

export type FirestorePresupuestos = {
  collection(nombre: string): ColeccionPresupuestos;
  runTransaction<T>(fn: (tx: TransaccionMinima) => Promise<T>): Promise<T>;
};

function firestore(ctx: ActionContext): FirestorePresupuestos {
  return ctx.db as unknown as FirestorePresupuestos;
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

// --- Meta del presupuesto -----------------------------------------------------

export type MetaPresupuesto = {
  centro: string;
  insumo: string;
  tienda: string;
  direccion: string;
  cantidad: number;
  presentacion: string;
  necesidadId: string;
  necesidadLugarId: string;
  tiendaLat: number | null;
  tiendaLng: number | null;
  tiendaUrl: string;
  // Ruta privada de Storage. El legado la subia a un bucket PUBLICO e
  // irrevocable y la publicaba en el seguimiento; aqui es un archivo privado
  // como cualquier otro y solo el admin (o quien lo subio) lo abre firmado.
  adjuntoPath: string;
};

export function comoMeta(valor: unknown): MetaPresupuesto {
  const meta = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  return {
    centro: s(meta.centro, 120),
    insumo: s(meta.insumo, 120),
    tienda: s(meta.tienda, 100),
    direccion: s(meta.direccion, 160),
    cantidad: n(meta.cantidad),
    presentacion: s(meta.presentacion, 140),
    necesidadId: s(meta.necesidadId, 200),
    necesidadLugarId: s(meta.necesidadLugarId, 128),
    tiendaLat: Number.isFinite(Number(meta.tiendaLat)) && meta.tiendaLat !== null ? Number(meta.tiendaLat) : null,
    tiendaLng: Number.isFinite(Number(meta.tiendaLng)) && meta.tiendaLng !== null ? Number(meta.tiendaLng) : null,
    tiendaUrl: s(meta.tiendaUrl, 300),
    adjuntoPath: s(meta.adjuntoPath ?? meta.adjunto, 300),
  };
}

// `presupuestoUI` del contrato §1.14: lo que ve cualquiera. Ni `necesidadId`, ni
// las coordenadas de la tienda, ni su URL, ni el adjunto privado.
export function documentoPublico(factura: Factura, token = factura.tokenPublico): Record<string, unknown> {
  const meta = comoMeta(factura.meta);
  return {
    token,
    objetivo: factura.objetivo,
    estado: factura.estado,
    centro: meta.centro,
    insumo: meta.insumo,
    tienda: meta.tienda,
    direccion: meta.direccion,
    cantidad: meta.cantidad,
    presentacion: meta.presentacion,
    moneda: factura.moneda,
    precio: factura.montoRequerido,
    recaudado: factura.montoRecaudado,
    createdAt: factura.createdAt,
  };
}

export function republicar(tx: TransaccionMinima, ctx: ContextoMinimo, cargada: FacturaCargada): void {
  publicar(tx, ctx.db, PROYECCION, cargada.factura.tokenPublico, documentoPublico(cargada.factura));
}

// --- Objetivo -----------------------------------------------------------------

// El separador es `→` (U+2192) entre espacios y `·` (U+00B7) antes de la tienda:
// el frontend y el indice de objetivos dependen de esa forma exacta.
export function objetivoPresupuesto(insumo: string, centro: string, tienda: string): string {
  return s(`${insumo} → ${centro} · ${tienda}`, 200);
}

// `Number(null)` es 0 y `Number.isFinite(0)` es cierto: sin descartar `null` y
// la cadena vacia primero, una tienda sin coordenadas se aceptaria y quedaria
// marcada en el golfo de Guinea. Mismo defecto que ya se corrigio en `lugares`.
export function comoCoordenada(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// --- Archivos del admin -------------------------------------------------------

// El admin sube el adjunto, el consolidado y la factura del proveedor a su
// propio `private/<uid>/receipts/`. El legado los ponia en un bucket publico e
// irrevocable y dejaba la anonimizacion del consolidado a su buen criterio; en
// Firebase no hay bucket publico y esos archivos se abren firmados.
export function rutaDelAdmin(uid: string, ruta: string): boolean {
  return Boolean(uid) && ruta.startsWith(`private/${uid}/receipts/`);
}

// --- Acciones publicas --------------------------------------------------------

// La UI no usa `createdAt` (ordena el servidor) y `updatedAt` es un centinela de
// Firestore que no sobrevive a `JSON.stringify`: se quedan fuera de la respuesta.
function comoFilaUI(datos: Record<string, unknown>, id: string): Record<string, unknown> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...resto } = datos;
  return { ...resto, token: s(datos.token, 40) || id };
}

async function listarProyeccion(
  ctx: ActionContext,
  filtro: { estados?: readonly EstadoFactura[]; direccion: 'asc' | 'desc'; tope: number },
): Promise<Array<Record<string, unknown>>> {
  let consulta: Consulta = firestore(ctx).collection(PROYECCION);
  if (filtro.estados) consulta = consulta.where('estado', 'in', [...filtro.estados]);
  const { docs } = await consulta.orderBy('createdAt', filtro.direccion).limit(filtro.tope).get();
  return docs.map((documento) => comoFilaUI(documento.data() ?? {}, documento.id));
}

defineAction({
  nombre: 'listar_presupuestos',
  auth: 'anon',
  cubo: 'lectura',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // Se lee la PROYECCION, no la coleccion canonica: es la misma vista que el
    // navegador puede leer por reglas, asi que no hay dos definiciones de «que
    // es publico» que puedan divergir.
    const presupuestos = await listarProyeccion(ctx, { direccion: 'desc', tope: TOPE_PRESUPUESTOS });
    // La tabla `tasas` esta cerrada al navegador salvo `tasas/actual`; el legado
    // la servia justo aqui y la UI la guarda en `estado.tasa`.
    const tasa = await leerTasaActual(ctx.db as unknown as Parameters<typeof leerTasaActual>[0]);
    return { presupuestos, tasa };
  },
});

defineAction({
  nombre: 'listar_comprados',
  auth: 'anon',
  cubo: 'lectura',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // Cola del transportista: lo mas antiguo primero, como el legado.
    const comprados = await listarProyeccion(ctx, {
      estados: ESTADOS_COMPRADOS, direccion: 'asc', tope: TOPE_COMPRADOS,
    });
    return { comprados };
  },
});

// --- Acciones del admin -------------------------------------------------------

defineAction({
  nombre: 'admin_crear_presupuesto',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const centro = s(payload.centro, 120);
    const insumo = s(payload.insumo, 120);
    const tienda = s(payload.tienda, 100);
    const cantidad = n(payload.cantidad);
    const precio = n(payload.precio);
    const tiendaLat = comoCoordenada(payload.tiendaLat);
    const tiendaLng = comoCoordenada(payload.tiendaLng);
    const tiendaUrl = s(payload.tiendaUrl, 300);
    const adjunto = s(payload.adjuntoPath ?? payload.adjunto, 300);
    const uid = ctx.uid ?? '';

    if (!centro || !insumo || !tienda) throw new ApiError('centro, insumo y tienda requeridos');
    if (cantidad <= 0) throw new ApiError('cantidad debe ser mayor que 0');
    if (precio <= 0 || precio > MAX_PRECIO) throw new ApiError('precio inválido');
    // Rango mundial, no la caja de Venezuela: una tienda puede estar al otro
    // lado de la frontera (contrato §1.4).
    if (
      tiendaLat === null || tiendaLng === null
      || Math.abs(tiendaLat) > 90 || Math.abs(tiendaLng) > 180
    ) {
      throw new ApiError('marca la tienda en el mapa');
    }
    if (tiendaUrl && !/^https?:\/\//i.test(tiendaUrl)) {
      throw new ApiError('la URL de la tienda debe empezar por http(s)://');
    }
    if (adjunto && !rutaDelAdmin(uid, adjunto)) throw new ApiError('adjunto inválido');

    const db = firestore(ctx);
    const token = nuevoToken();
    const objetivo = objetivoPresupuesto(insumo, centro, tienda);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const dbLugares = ctx.db as unknown as FirestoreLugares;

      const lugarId = await lugarIdPorNombre(tx, ctxMin, centro);
      if (!lugarId) throw new ApiError('Centro no encontrado', 404);
      const lugar = await leerLugar(tx, dbLugares, lugarId);
      if (!lugar) throw new ApiError('Centro no encontrado', 404);

      const meta: MetaPresupuesto = {
        centro: lugar.nombre,
        insumo,
        tienda,
        direccion: s(payload.direccion, 160),
        cantidad,
        presentacion: s(payload.presentacion, 140),
        necesidadId: s(payload.necesidadId, 200),
        necesidadLugarId: s(payload.necesidadLugarId, 128) || lugarId,
        tiendaLat,
        tiendaLng,
        tiendaUrl,
        adjuntoPath: adjunto,
      };

      const cargada = await crearFactura(tx, ctxMin, {
        tipo: TIPO,
        moneda: 'VES',
        objetivo,
        meta: { ...meta },
        montoRequerido: precio,
      }, token);

      // Varios presupuestos abiertos del mismo insumo y centro en TIENDAS
      // distintas conviven a proposito («una farmacia cotiza 200, otra 1000»):
      // el objetivo lleva la tienda, asi que no colisionan. Dos presupuestos
      // identicos en la misma tienda si, y eso lo corta `crearFactura`.
      guardarFactura(tx, ctxMin, cargada, instantanea(cargada.factura));
      republicar(tx, ctxMin, cargada);

      historial(tx, ctxMin, {
        lugarId,
        lugarNombre: lugar.nombre,
        insumo,
        descripcion: `Presupuesto ${cargada.factura.numeroFactura}: ${cantidad} × ${insumo} en ${tienda} por ${precio}`,
        origen: 'admin',
        cantidad,
        tipo: 'Presupuesto',
      });

      auditar(tx, ctxMin, {
        accion: 'crear',
        entidad: COLECCION_FACTURAS,
        entidadId: cargada.id,
        despues: { objetivo, precio, cantidad, tienda },
      });

      return { numeroFactura: cargada.factura.numeroFactura, token };
    });
  },
});

defineAction({
  nombre: 'admin_presupuestos_por_comprar',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext): Promise<ActionResult> {
    // Cola FIFO por fecha de creacion, sobre la coleccion canonica: la vista
    // publica no publica los estados `PorComprar` y `Transferida` de forma
    // distinta, pero el admin necesita la fila aunque la proyeccion falte.
    const { docs } = await firestore(ctx).collection(COLECCION_FACTURAS)
      .where('estado', 'in', [...ESTADOS_POR_COMPRAR])
      .orderBy('createdAt', 'asc')
      .limit(TOPE_POR_COMPRAR)
      .get();

    const presupuestos = docs
      .filter((documento) => s((documento.data() ?? {}).tipo, 20) === TIPO)
      .map((documento) => comoFilaUI(documentoPublico(comoFacturaMinima(documento.data() ?? {})), documento.id));

    return { presupuestos };
  },
});

defineAction({
  nombre: 'admin_donaciones_presupuesto',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const token = tokenNormalizado(payload.token);
    const db = firestore(ctx);

    const cargada = await (db as unknown as FirestoreFacturas).runTransaction(
      async (tx) => cargarFacturaPorToken(tx, contextoMinimo(ctx), token),
    );
    if (!cargada) throw new ApiError('presupuesto no encontrado', 404);

    // Todas las donaciones, incluidas las anuladas: es la pantalla en la que el
    // admin compara comprobante contra referencia antes de anular.
    return {
      donaciones: cargada.donaciones.slice(-TOPE_DONACIONES).reverse().map(({ id, datos }) => ({
        id,
        // El token viaja de vuelta porque las donaciones viven en una
        // subcoleccion: `admin_donacion_anular` necesita las dos mitades para
        // encontrar el documento (el legado tenia una tabla plana).
        token: cargada.factura.tokenPublico,
        nombre_donante: datos.nombreDonante,
        monto: datos.monto,
        monto_usd: datos.montoUsd,
        tasa: datos.tasa,
        referencia_pago: datos.referenciaPago,
        estado: datos.estado,
        // La RUTA privada, no una URL. El legado firmaba una URL de una hora por
        // cada donacion en cada apertura de la pantalla; aqui la consola pide la
        // firma de 15 minutos al endpoint de archivos privados, y solo del
        // comprobante que de verdad va a mirar.
        comprobante: datos.comprobantePath,
        comprobante_url: '',
        fecha: datos.createdAt.toISOString(),
      })),
    };
  },
});

defineAction({
  nombre: 'admin_donacion_anular',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
    const token = tokenNormalizado(payload.token);
    const id = s(payload.id, 60);
    if (!id) throw new ApiError('id requerido');
    if (!token) throw new ApiError('token requerido');

    const db = firestore(ctx);

    return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
      const ctxMin = contextoMinimo(ctx);
      const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
      if (!cargada) throw new ApiError('presupuesto no encontrado', 404);

      const donacion = cargada.donaciones.find((fila) => fila.id === id);
      if (!donacion) throw new ApiError('donación no encontrada', 404);
      // Idempotencia con aviso: anular dos veces no vuelve a mover el recaudado,
      // pero tampoco se responde «hecho» a algo que ya estaba hecho. El legado
      // no comprobaba el estado previo y anular dos veces pasaba por exito.
      if (donacion.datos.estado === 'Anulada') throw new ApiError('Esa donación ya estaba anulada', 409);

      const previo = instantanea(cargada.factura);
      donacion.datos.estado = 'Anulada';
      tx.set(
        refFactura(ctx.db as unknown as FirestoreFacturas, cargada.id)
          .collection(SUB_DONACIONES).doc(id),
        { estado: 'Anulada', anuladaAt: ctx.now },
        { merge: true },
      );

      cargada.factura.montoRecaudado = recalcularRecaudado(cargada);

      // Una factura ya `Comprada` NO se reabre aunque el recaudado caiga: el
      // dinero ya se gasto. Solo vuelven `PorComprar` y `Transferida`.
      if (
        ESTADOS_POR_COMPRAR.includes(cargada.factura.estado)
        && cargada.factura.montoRecaudado < cargada.factura.montoRequerido
      ) {
        aplicarTransicion(cargada, ctxMin, 'reabrir');
        agregarMovimiento(tx, ctxMin, cargada, {
          tipo: 'Reapertura',
          descripcion: mov('reabiertoPorAnulacion'),
          monto: 0,
        });
      }

      guardarFactura(tx, ctxMin, cargada, previo);
      republicar(tx, ctxMin, cargada);

      auditar(tx, ctxMin, {
        accion: 'editar',
        entidad: `${COLECCION_FACTURAS}/${SUB_DONACIONES}`,
        entidadId: `${cargada.id}/${id}`,
        antes: { estado: previo.estado, recaudado: previo.montoRecaudado },
        despues: { estado: cargada.factura.estado, recaudado: cargada.factura.montoRecaudado },
      });

      return { estado: cargada.factura.estado, recaudado: cargada.factura.montoRecaudado };
    });
  },
});

// `admin_presupuesto_transferido` y `admin_presupuesto_comprado` son el mismo
// gesto con distinto archivo y distinta transicion: subir la prueba, dejarla
// como evidencia publica, mover el estado y anotar el movimiento.
function pasoDeCompra(definicion: {
  nombre: string;
  campo: string;
  transicion: 'transferir' | 'comprar';
  faltaArchivo: string;
  descripcionEvidencia: string;
  codigoMovimiento: string;
  tipoMovimiento: 'Transferencia' | 'Compra';
}): void {
  defineAction({
    nombre: definicion.nombre,
    auth: 'admin',
    cubo: 'admin',
    async handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult> {
      const token = tokenNormalizado(payload.token);
      const archivo = s(payload[`${definicion.campo}Path`] ?? payload[definicion.campo], 300);
      const uid = ctx.uid ?? '';
      const db = firestore(ctx);

      return (db as unknown as FirestoreFacturas).runTransaction(async (tx) => {
        const ctxMin = contextoMinimo(ctx);
        const cargada = await cargarFacturaPorToken(tx, ctxMin, token);
        if (!cargada || cargada.factura.tipo !== TIPO) {
          throw new ApiError('presupuesto no encontrado', 404);
        }
        // El estado se comprueba ANTES de exigir el archivo, igual que el
        // legado: quien llega tarde no pierde el tiempo subiendo un PDF.
        const previo = instantanea(cargada.factura);
        aplicarTransicion(cargada, ctxMin, definicion.transicion);
        if (!archivo) throw new ApiError(definicion.faltaArchivo);
        if (!rutaDelAdmin(uid, archivo)) throw new ApiError(definicion.faltaArchivo);

        agregarEvidencia(tx, ctxMin, cargada, {
          archivoPath: archivo,
          descripcion: definicion.descripcionEvidencia,
          publica: true,
        });
        agregarMovimiento(tx, ctxMin, cargada, {
          tipo: definicion.tipoMovimiento,
          descripcion: mov(definicion.codigoMovimiento),
          monto: 0,
        });

        guardarFactura(tx, ctxMin, cargada, previo);
        republicar(tx, ctxMin, cargada);

        auditar(tx, ctxMin, {
          accion: 'editar',
          entidad: COLECCION_FACTURAS,
          entidadId: cargada.id,
          antes: { estado: previo.estado },
          despues: { estado: cargada.factura.estado },
        });

        return { estado: cargada.factura.estado };
      });
    },
  });
}

pasoDeCompra({
  nombre: 'admin_presupuesto_transferido',
  campo: 'consolidado',
  transicion: 'transferir',
  faltaArchivo: 'Sube el archivo consolidado de transferencias recibidas',
  descripcionEvidencia: 'Transferencias recibidas (consolidado)',
  codigoMovimiento: 'transferidoABs',
  tipoMovimiento: 'Transferencia',
});

pasoDeCompra({
  nombre: 'admin_presupuesto_comprado',
  campo: 'factura',
  transicion: 'comprar',
  faltaArchivo: 'Sube la factura pagada al proveedor',
  descripcionEvidencia: 'Factura de compra pagada al proveedor',
  codigoMovimiento: 'compraConfirmada',
  tipoMovimiento: 'Compra',
});

// --- Lectura suelta de una fila canonica --------------------------------------

// `admin_presupuestos_por_comprar` no carga las subcolecciones (no las usa), asi
// que arma solo la cabecera. Se aisla aqui para no exportar de `facturas.ts` un
// constructor a medias que invite a usarlo donde si hacen falta.
function comoFacturaMinima(datos: Record<string, unknown>): Factura {
  const objetivo = s(datos.objetivo, 200);
  return {
    numeroFactura: s(datos.numeroFactura, 40),
    tokenPublico: s(datos.tokenPublico, 40),
    tipo: TIPO,
    moneda: opcion(datos.moneda, ['VES', 'USD', 'unidades'] as const, 'VES'),
    objetivo,
    objetivoNorm: s(datos.objetivoNorm, 200) || normalizar(objetivo),
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

// --- Fuente del reconciliador -------------------------------------------------

// La vista publica de un presupuesto se deriva de la misma factura que la de
// seguimiento, pero se indexa por token y solo existe para `tipo:
// 'presupuesto'`. `incluir` la deja fuera para cualquier otro sabor; el barrido
// de huerfanos limpia lo que sobre.
registrarFuente({
  coleccion: COLECCION_FACTURAS,
  proyeccion: PROYECCION,
  incluir: ({ datos }) => s(datos.tipo, 20) === TIPO && Boolean(s(datos.tokenPublico, 40)),
  idProyeccion: ({ datos }) => s(datos.tokenPublico, 40),
  mapear: ({ datos }) => documentoPublico(comoFacturaMinima(datos)),
});

// La proyeccion NO se retira al cerrar un presupuesto: la UI sigue pintando la
// tarjeta de una compra ya entregada, y `listar_presupuestos` los devuelve en
// cualquier estado (el cliente filtra), igual que el legado.

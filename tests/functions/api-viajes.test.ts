import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import * as facturas from '../../functions/src/api/facturas.js';
import * as ofertas from '../../functions/src/api/ofertas.js';
// Importar el dominio registra sus acciones y, al hacerlo, rellena la costura
// `conectarReservaDeViaje` que la Task 3.4 dejo abierta en `ofertas.ts`.
import * as viajes from '../../functions/src/api/viajes.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const ADJUNTO = 'private/uid-admin/receipts/cotizacion.pdf';
const FACTURA_PROVEEDOR = 'private/uid-admin/receipts/factura.pdf';
const COMPROBANTE = 'private/uid-donante/receipts/C1.jpg';

// Fotos del ciclo: categoria `deliveries`, del uid del transportista.
const SITIO = 'private/uid-moto/deliveries/sitio.jpg';
const INSUMO = 'private/uid-moto/deliveries/insumo.jpg';
const PERSONA = 'private/uid-moto/deliveries/persona.jpg';
const CENTRO = 'private/uid-moto/deliveries/centro.jpg';
const ENCARGADO = 'private/uid-moto/deliveries/encargado.jpg';

// Las de la segunda persona: `rutaDelCiclo` solo acepta la carpeta de quien
// sube, asi que reutilizar las de arriba haria fallar la foto antes que la
// reserva, que es justo lo que esas pruebas quieren comprobar.
const SITIO_2 = 'private/uid-otra-moto/deliveries/sitio.jpg';
const INSUMO_2 = 'private/uid-otra-moto/deliveries/insumo.jpg';
const CENTRO_2 = 'private/uid-otra-moto/deliveries/centro.jpg';

// Fotos de la oferta (categoria `offers`), que es la que usa `recoger_oferta`.
const OFERTA_FOTO = 'private/uid-donante/offers/insumo-1.jpg';
const OFERTA_SITIO = 'private/uid-moto/offers/recogida-sitio.jpg';

// Caracas y un punto a ~3 km, ambos dentro de la caja de Venezuela.
const GPS_TIENDA = { lat: 10.5061, lng: -66.9146 };
const GPS_RECOGIDA = { lat: 10.5261, lng: -66.9346 };
const GPS_CENTRO = { lat: 10.4806, lng: -66.9036 };

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, uid: 'uid-admin', role: 'admin', ...extra });
}

const ANONIMO = (db: unknown) => contexto(db, { uid: null, role: 'anon' });
const DONANTE = (db: unknown) => contexto(db, { uid: 'uid-donante', role: 'user' });
const MOTO = (db: unknown, extra: Partial<ActionContext> = {}) =>
  contexto(db, { uid: 'uid-moto', role: 'user', ...extra });
const OTRA_MOTO = (db: unknown) => contexto(db, { uid: 'uid-otra-moto', role: 'user' });

let contadorToken = 0;

beforeEach(() => {
  contadorToken = 0;
  facturas.usarGeneradorDeTokens((prefijo) => {
    contadorToken += 1;
    return `${prefijo}-TEST-0000-${String(contadorToken).padStart(4, '0')}`;
  });
});

afterEach(() => {
  facturas.usarGeneradorDeTokens(null);
  facturas.conectarNotificador(null);
});

const PRESUPUESTO_OK = {
  centro: 'Hospital Vargas',
  insumo: 'Agua potable',
  tienda: 'Farmacia Sur',
  direccion: 'Av. Principal',
  cantidad: 500,
  presentacion: 'Bidón de 20 L',
  precio: 50_000,
  necesidadId: 'agua potable',
  tiendaLat: 10.6,
  tiendaLng: -66.93,
  adjuntoPath: ADJUNTO,
};

const OFERTA_OK = {
  insumo: 'Colchonetas',
  cantidad: 12,
  unidad: 'unidades',
  ubicacion: 'Casa de Ana, callejón El Rosal nº 4',
  telefono: '04141234567',
  nombreDonante: 'Ana Pérez',
  zona: 'Chacao',
  centro: 'Refugio Catia',
  lat: 10.4971,
  lng: -66.8534,
  fotosInsumoPath: [OFERTA_FOTO],
};

function baseConCentro(extra: Record<string, Documento> = {}) {
  return crearDb({
    'lugares/LUG-AAAA1111': {
      tipo: 'Hospital',
      nombre: 'Hospital Vargas',
      nombreNorm: 'hospital vargas',
      activo: true,
      actualizado: ANTES,
    },
    'indices/lugaresPorNombre/claves/hospital vargas': { valor: 'LUG-AAAA1111' },
    'tasas/actual': { efectiva: 250, diaria: 245, fuente: 'seed', fecha: ANTES.toISOString() },
    'motorizados/MOT-AAAA1111': {
      nombre: 'Luis Motorizado',
      tipoVehiculo: 'Moto',
      zonaOperacion: 'Caracas',
      telefono: '04149998877',
      placa: 'AB123CD',
      activo: true,
      createdAt: ANTES,
    },
    ...extra,
  });
}

// Presupuesto llevado hasta `Comprada`, que es lo unico que abre el ciclo del
// transportista.
async function conPresupuestoComprado() {
  const base = baseConCentro();
  const token = String((await ejecutar('admin_crear_presupuesto', contexto(base.db), PRESUPUESTO_OK)).token);
  await ejecutar('donar_dinero', DONANTE(base.db), {
    token, montoUsd: 300, comprobantePath: COMPROBANTE, nombreDonante: 'Ana',
  });
  await ejecutar('admin_presupuesto_comprado', contexto(base.db), { token, facturaPath: FACTURA_PROVEEDOR });
  return { ...base, token };
}

async function conOferta() {
  const base = baseConCentro();
  const token = String((await ejecutar('ofrecer_insumo', DONANTE(base.db), OFERTA_OK)).token);
  return { ...base, token };
}

function facturaDe(documentos: Record<string, Documento>): Documento {
  const ruta = Object.keys(documentos).find((clave) => /^facturas\/FCT-[^/]+$/.test(clave));
  return documentos[ruta!]!;
}

function viajeDe(documentos: Record<string, Documento>): Documento {
  const ruta = Object.keys(documentos).find((clave) => clave.startsWith('viajes/'));
  return documentos[ruta!]!;
}

// --- Helpers del modelo ---------------------------------------------------------

describe('reserva del viaje (contrato §1.7)', () => {
  const paso1 = { ts: AHORA, lat: 10.5, lng: -66.9 };

  function viaje(extra: Partial<viajes.Viaje> = {}): viajes.Viaje {
    return viajes.comoViaje({
      facturaId: 'FCT-1',
      uid: 'uid-moto',
      transportista: 'Luis',
      etaMinutos: 60,
      paso1,
      resuelto: false,
      abierto: true,
      venceReserva: viajes.calcularVenceReserva(paso1, 60),
      createdAt: AHORA,
      ...extra,
    } as Record<string, unknown>);
  }

  it('vence a los `eta + 60 min` del paso 1', () => {
    expect(viajes.calcularVenceReserva(paso1, 60)?.toISOString()).toBe('2026-09-07T14:00:00.000Z');
    expect(viajes.calcularVenceReserva(paso1, 5)?.toISOString()).toBe('2026-09-07T13:05:00.000Z');
  });

  it('sin paso 1 no hay reserva que pueda vencer', () => {
    expect(viajes.calcularVenceReserva({ ts: null, lat: null, lng: null }, 60)).toBeNull();
  });

  it('está viva antes del plazo y muerta después', () => {
    const v = viaje();
    expect(viajes.reservaEstaViva(v, new Date('2026-09-07T13:59:00.000Z'))).toBe(true);
    expect(viajes.reservaEstaViva(v, new Date('2026-09-07T14:00:01.000Z'))).toBe(false);
  });

  it('resolverla la mata aunque el plazo no haya vencido', () => {
    expect(viajes.reservaEstaViva(viaje({ resuelto: true }), AHORA)).toBe(false);
  });

  it('un viaje ya entregado deja de dar permiso', () => {
    const v = viaje({ paso3: { ts: AHORA, lat: 10.5, lng: -66.9 } } as Partial<viajes.Viaje>);
    expect(viajes.reservaEstaViva(v, AHORA)).toBe(false);
  });
});

describe('alerta de atrasos (contrato §1.19)', () => {
  it('tramo 1: `eta + 120 min` desde el paso 1', () => {
    const paso1 = { ts: AHORA, lat: 10.5, lng: -66.9 };
    const vence = viajes.calcularVenceAlerta({ paso1, paso2: viajes.PASO_VACIO, etaMinutos: 30 });
    expect(vence?.toISOString()).toBe('2026-09-07T14:30:00.000Z');
  });

  it('tramo 2: 120 min desde el paso 2, sin contar el eta', () => {
    const paso1 = { ts: ANTES, lat: 10.5, lng: -66.9 };
    const paso2 = { ts: AHORA, lat: 10.5, lng: -66.9 };
    const vence = viajes.calcularVenceAlerta({ paso1, paso2, etaMinutos: 300 });
    expect(vence?.toISOString()).toBe('2026-09-07T14:00:00.000Z');
    expect(viajes.tramoDe({ paso2 })).toBe(2);
  });

  it('sin paso 1 no hay nada que vigilar', () => {
    expect(viajes.calcularVenceAlerta({
      paso1: viajes.PASO_VACIO, paso2: viajes.PASO_VACIO, etaMinutos: 60,
    })).toBeNull();
  });
});

describe('datos logísticos según el sabor de la factura', () => {
  it('de una oferta se toma la ZONA como punto de recogida, nunca el sitio exacto', () => {
    const factura = facturas.comoFactura({
      tipo: 'oferta',
      moneda: 'unidades',
      meta: { insumo: 'Colchonetas', cantidad: 12, unidad: 'unidades', zona: 'Chacao', centro: 'Refugio Catia' },
    });
    expect(viajes.logisticaDe(factura)).toMatchObject({
      centro: 'Refugio Catia', insumo: 'Colchonetas', tienda: 'Chacao', direccion: 'Chacao',
    });
  });

  it('de un presupuesto se toman la tienda y su dirección', () => {
    const factura = facturas.comoFactura({
      tipo: 'presupuesto',
      moneda: 'VES',
      meta: { centro: 'Hospital Vargas', insumo: 'Agua', tienda: 'Farmacia Sur', direccion: 'Av. Principal' },
    });
    expect(viajes.logisticaDe(factura)).toMatchObject({ tienda: 'Farmacia Sur', direccion: 'Av. Principal' });
  });
});

describe('rutas de las fotos del ciclo', () => {
  it('solo acepta la carpeta `deliveries` de quien sube', () => {
    expect(viajes.rutaDelCiclo('uid-moto', SITIO)).toBe(SITIO);
    expect(viajes.rutaDelCiclo('uid-moto', 'private/uid-otra-moto/deliveries/sitio.jpg')).toBe('');
    expect(viajes.rutaDelCiclo('uid-moto', 'private/uid-moto/offers/sitio.jpg')).toBe('');
    expect(viajes.rutaDelCiclo('', SITIO)).toBe('');
  });
});

// --- registrar_trayecto ---------------------------------------------------------

describe('registrar_trayecto', () => {
  const TRAYECTO_OK = {
    idMotorizado: 'MOT-AAAA1111',
    nombreMotorizado: 'Luis Motorizado',
    origen: 'Catia',
    destino: 'Petare',
    km: 18.4,
    insumo: 'Agua potable',
  };

  it('exige origen y destino', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, origen: '' }))
      .rejects.toThrow('origen y destino requeridos');
    await expect(ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, destino: '  ' }))
      .rejects.toThrow('origen y destino requeridos');
  });

  it('rechaza kilómetros negativos: en el legado bajaban el total del transportista', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, km: -500 }))
      .rejects.toThrow('kilómetros inválidos');
    await expect(ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, km: 99_999 }))
      .rejects.toThrow('kilómetros inválidos');
  });

  it('un transportista inexistente es un 404, no el error crudo de la clave foránea', async () => {
    const { db } = baseConCentro();
    const error = await ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, idMotorizado: 'MOT-NADA' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe('Transportista no encontrado');
    expect((error as ApiError).status).toBe(404);
  });

  it('guarda el trayecto, lo publica y suma los acumulados del transportista', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('registrar_trayecto', ANONIMO(db), TRAYECTO_OK);

    expect(documentos[`trayectos/${id}`]).toMatchObject({
      motorizadoId: 'MOT-AAAA1111', origen: 'Catia', destino: 'Petare', kmRecorridos: 18.4,
      insumo: 'Agua potable',
    });
    expect(documentos[`trayectosPublicos/${id}`]).toMatchObject({
      origen: 'Catia', destino: 'Petare', kmRecorridos: 18.4,
    });

    expect(documentos['motorizados/MOT-AAAA1111']).toMatchObject({
      totalTrayectos: 1, totalKm: 18.4, ultimoTrayecto: AHORA,
    });
    // La tarjeta publica se republica entera: `motorizadosPublicos` se consulta
    // ordenada por `createdAt` y publicar solo los acumulados la dejaria fuera.
    expect(documentos['motorizadosPublicos/MOT-AAAA1111']).toMatchObject({
      nombre: 'Luis Motorizado', totalTrayectos: 1, totalKm: 18.4, tieneContacto: true, createdAt: ANTES,
    });
  });

  it('la tarjeta pública sigue sin teléfono ni placa después de acumular', async () => {
    const { db, documentos } = baseConCentro();
    await ejecutar('registrar_trayecto', ANONIMO(db), TRAYECTO_OK);
    const publico = documentos['motorizadosPublicos/MOT-AAAA1111']!;
    expect(publico.telefono).toBeUndefined();
    expect(publico.placa).toBeUndefined();
  });

  it('acumula sobre lo que ya había, con un decimal', async () => {
    const { db, documentos } = baseConCentro();
    await ejecutar('registrar_trayecto', ANONIMO(db), TRAYECTO_OK);
    await ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, km: 1.25 });
    expect(documentos['motorizados/MOT-AAAA1111']).toMatchObject({ totalTrayectos: 2, totalKm: 19.7 });
  });

  it('sin id de transportista se registra igual, sin tocar acumulados de nadie', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('registrar_trayecto', ANONIMO(db), {
      ...TRAYECTO_OK, idMotorizado: '', nombreMotorizado: 'Un vecino',
    });
    expect(documentos[`trayectos/${id}`]).toMatchObject({ motorizadoId: '', nombreMotorizado: 'Un vecino' });
    expect(documentos['motorizados/MOT-AAAA1111']!.totalTrayectos).toBeUndefined();
  });

  it('el insumo por defecto es «Varios», como el legado', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('registrar_trayecto', ANONIMO(db), { ...TRAYECTO_OK, insumo: '' });
    expect(documentos[`trayectos/${id}`]).toMatchObject({ insumo: 'Varios' });
  });
});

// --- donar_motorizado -----------------------------------------------------------

describe('donar_motorizado', () => {
  const APORTE_OK = {
    idMotorizado: 'MOT-AAAA1111',
    nombreMotorizado: 'Luis Motorizado',
    monto: 20,
    tipo: 'Gasolina',
    donanteName: 'Marta',
    ciudad: 'Caracas',
  };

  it('rechaza montos no positivos y desorbitados: el legado no validaba nada', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('donar_motorizado', ANONIMO(db), { ...APORTE_OK, monto: 0 }))
      .rejects.toThrow('monto inválido');
    await expect(ejecutar('donar_motorizado', ANONIMO(db), { ...APORTE_OK, monto: -1000 }))
      .rejects.toThrow('monto inválido');
    await expect(ejecutar('donar_motorizado', ANONIMO(db), { ...APORTE_OK, monto: 9_999_999 }))
      .rejects.toThrow('monto inválido');
  });

  it('guarda el aporte, lo publica, cuenta en el tablero y suma al transportista', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('donar_motorizado', ANONIMO(db), APORTE_OK);

    expect(documentos[`donacionesMotorizados/${id}`]).toMatchObject({
      motorizadoId: 'MOT-AAAA1111', monto: 20, tipo: 'Gasolina', donante: 'Marta', ciudad: 'Caracas',
    });
    expect(documentos[`donacionesMotorizadosPublicos/${id}`]).toMatchObject({ monto: 20, donante: 'Marta' });
    expect(documentos['estadisticas/global']).toMatchObject({ donacionesRegistradas: 1 });
    expect(documentos['motorizados/MOT-AAAA1111']).toMatchObject({ aporteDonado: 20 });
    expect(documentos['motorizadosPublicos/MOT-AAAA1111']).toMatchObject({ aporteDonado: 20 });
  });

  it('sin nombre de quien aporta queda «Anónimo»', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('donar_motorizado', ANONIMO(db), { ...APORTE_OK, donanteName: '' });
    expect(documentos[`donacionesMotorizados/${id}`]).toMatchObject({ donante: 'Anónimo' });
  });

  it('acepta el alias antiguo `donante`', async () => {
    const { db, documentos } = baseConCentro();
    const { id } = await ejecutar('donar_motorizado', ANONIMO(db), {
      ...APORTE_OK, donanteName: undefined, donante: 'Pedro',
    });
    expect(documentos[`donacionesMotorizados/${id}`]).toMatchObject({ donante: 'Pedro' });
  });
});

// --- viaje_iniciar --------------------------------------------------------------

describe('viaje_iniciar', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };

  it('valida el tiempo estimado antes que nada', async () => {
    const { db, token } = await conPresupuestoComprado();
    await expect(ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token, etaMinutos: 4 }))
      .rejects.toThrow('Tiempo estimado inválido (5 a 480 minutos)');
    await expect(ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token, etaMinutos: 481 }))
      .rejects.toThrow('Tiempo estimado inválido (5 a 480 minutos)');
  });

  it('exige GPS dentro de la caja de Venezuela', async () => {
    const { db, token } = await conPresupuestoComprado();
    await expect(ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token, gps: null }))
      .rejects.toThrow('Se necesita tu ubicación GPS para iniciar el viaje');
    await expect(ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token, gps: { lat: 40.4, lng: -3.7 } }))
      .rejects.toThrow('Se necesita tu ubicación GPS para iniciar el viaje');
  });

  it('un token desconocido es un 404', async () => {
    const { db } = await conPresupuestoComprado();
    const error = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token: 'DV-NADA-NADA-NADA' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('un presupuesto que aún no se ha comprado no se puede reservar', async () => {
    const base = baseConCentro();
    const token = String((await ejecutar('admin_crear_presupuesto', contexto(base.db), PRESUPUESTO_OK)).token);
    await expect(ejecutar('viaje_iniciar', MOTO(base.db), { ...RESERVA_OK, token }))
      .rejects.toThrow('Este insumo no está listo para recoger');
  });

  it('reserva un presupuesto comprado sin cambiarle el estado', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    const salida = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    expect(salida).toMatchObject({ ok: true, etaMinutos: 45 });
    const viaje = viajeDe(documentos);
    expect(viaje).toMatchObject({
      uid: 'uid-moto', transportista: 'Luis Motorizado', etaMinutos: 45, abierto: true, resuelto: false,
    });
    expect((viaje.paso1 as Documento).lat).toBe(GPS_TIENDA.lat);
    expect((viaje.venceReserva as Date).toISOString()).toBe('2026-09-07T13:45:00.000Z');
    // Tramo 1: eta + 120 min.
    expect((viaje.venceAlerta as Date).toISOString()).toBe('2026-09-07T14:45:00.000Z');

    const factura = facturaDe(documentos);
    expect(factura).toMatchObject({ estado: 'Comprada', viajeVigenteId: salida.viajeId });
  });

  it('anota el movimiento público `viajeIniciado` con el nombre y el eta', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    const movimientos = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => documentos[ruta]!);
    const iniciado = movimientos.find((m) => String(m.descripcion).includes('viajeIniciado'));
    expect(JSON.parse(String(iniciado!.descripcion)))
      .toEqual({ k: 'mov', c: 'viajeIniciado', nombre: 'Luis Motorizado', eta: 45 });
    expect(iniciado).toMatchObject({ tipo: 'Viaje', monto: 0 });
  });

  it('deja constancia en la bitácora del centro', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    const entradas = rutas(documentos, 'historialMovimientos/').map((ruta) => documentos[ruta]!);
    expect(entradas.some((e) => String(e.descripcion).includes('va en camino a recoger'))).toBe(true);
  });

  it('una oferta pasa de `Ofrecida` a `EnCamino` y devuelve el contacto de quien dona', async () => {
    const { db, documentos, token } = await conOferta();
    const salida = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    expect(facturaDe(documentos)).toMatchObject({ estado: 'EnCamino' });
    // El telefono y la direccion exacta solo salen con la reserva en la mano.
    expect(salida.detalle).toMatchObject({
      telefono: '04141234567',
      nombreDonante: 'Ana Pérez',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4',
    });
    // La proyeccion publica sigue sin contacto.
    expect(documentos[`ofertasPublicas/${token}`]!.telefono).toBeUndefined();
    expect(documentos[`ofertasPublicas/${token}`]).toMatchObject({ estado: 'EnCamino', zona: 'Chacao' });
  });

  it('el detalle de un presupuesto no lleva contacto de nadie', async () => {
    const { db, token } = await conPresupuestoComprado();
    const salida = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    expect(salida.detalle).toMatchObject({ tienda: 'Farmacia Sur', centro: 'Hospital Vargas' });
    expect((salida.detalle as Documento).telefono).toBeUndefined();
  });

  it('reservar dos veces seguidas no crea un segundo viaje ni reinicia el reloj', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    const primera = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    const segunda = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token, etaMinutos: 120 });

    expect(segunda).toMatchObject({ ok: true, yaReservado: true, viajeId: primera.viajeId, etaMinutos: 45 });
    expect(rutas(documentos, 'viajes/')).toHaveLength(1);
  });

  it('el trabajo reservado por otra persona no se puede tomar', async () => {
    const { db, token } = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    const error = await ejecutar('viaje_iniciar', OTRA_MOTO(db), { ...RESERVA_OK, token })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(viajes.YA_RESERVADO);
    expect((error as ApiError).status).toBe(409);
  });

  it('cuando la reserva vence, otra persona sí puede tomar el trabajo', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    // eta 45 + 60 de gracia = 105 min: dentro del plazo el trabajo esta tomado.
    await expect(ejecutar('viaje_iniciar', OTRA_MOTO(db), { ...RESERVA_OK, token }))
      .rejects.toThrow(viajes.YA_RESERVADO);

    const despues = new Date(AHORA.getTime() + 106 * 60_000);
    const segunda = await ejecutar(
      'viaje_iniciar',
      contexto(db, { uid: 'uid-otra-moto', role: 'user', now: despues }),
      { ...RESERVA_OK, token, nombreTransportista: 'Otra' },
    );

    expect(segunda).toMatchObject({ ok: true });
    expect(rutas(documentos, 'viajes/')).toHaveLength(2);
    // El viaje vigente pasa a ser el nuevo.
    expect(facturaDe(documentos).viajeVigenteId).toBe((segunda as Documento).viajeId);
  });

  it('una oferta `EnCamino` con la reserva vencida se puede volver a reservar (el legado la dejaba bloqueada)', async () => {
    const { db, documentos, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    expect(facturaDe(documentos)).toMatchObject({ estado: 'EnCamino' });

    const despues = new Date(AHORA.getTime() + 200 * 60_000);
    const segunda = await ejecutar(
      'viaje_iniciar',
      contexto(db, { uid: 'uid-otra-moto', role: 'user', now: despues }),
      { ...RESERVA_OK, token, nombreTransportista: 'Otra' },
    );

    expect(segunda).toMatchObject({ ok: true });
    expect(facturaDe(documentos)).toMatchObject({ estado: 'EnCamino' });
  });

  it('una oferta ya recogida no se reserva', async () => {
    const { db, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    await ejecutar('recoger_oferta', MOTO(db), {
      token, centroDestino: 'Refugio Catia', fotoSitioPath: OFERTA_SITIO, gps: GPS_RECOGIDA,
    });
    await expect(ejecutar('viaje_iniciar', OTRA_MOTO(db), { ...RESERVA_OK, token }))
      .rejects.toThrow('Esta donación ya está en camino o fue recogida');
  });
});

// --- registrar_recogida ---------------------------------------------------------

describe('registrar_recogida', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };
  const RECOGIDA_OK = { fotoSitioPath: SITIO, fotoInsumoPath: INSUMO, gps: GPS_RECOGIDA };

  async function reservado() {
    const base = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(base.db), { ...RESERVA_OK, token: base.token });
    return base;
  }

  it('las dos fotos obligatorias se comprueban antes de tocar la factura', async () => {
    const { db, token } = await reservado();
    await expect(ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token, fotoInsumoPath: '' }))
      .rejects.toThrow('Faltan fotos: sitio de recogida e insumo son obligatorias');
  });

  it('una foto de la carpeta de otra persona no cuenta como foto', async () => {
    const { db, token } = await reservado();
    await expect(ejecutar('registrar_recogida', MOTO(db), {
      ...RECOGIDA_OK, token, fotoSitioPath: 'private/uid-otra-moto/deliveries/sitio.jpg',
    })).rejects.toThrow('Faltan fotos: sitio de recogida e insumo son obligatorias');
  });

  it('una oferta no se recoge por aquí: para eso está `recoger_oferta`', async () => {
    const { db, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    const error = await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('sin reserva viva no se puede recoger, aunque el presupuesto esté comprado', async () => {
    const { db, token } = await conPresupuestoComprado();
    const error = await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(ofertas.SIN_RESERVA);
    expect((error as ApiError).status).toBe(403);
  });

  it('la reserva de otra persona tampoco sirve', async () => {
    const { db, token } = await reservado();
    const error = await ejecutar('registrar_recogida', OTRA_MOTO(db), {
      token, fotoSitioPath: SITIO_2, fotoInsumoPath: INSUMO_2, gps: GPS_RECOGIDA,
    }).catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(viajes.AJENA);
  });

  it('el estado se comprueba antes que la reserva', async () => {
    const { db, token } = await reservado();
    await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token });
    // Ya está `EnTransito`: el segundo intento choca con el estado, no con la reserva.
    await expect(ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token }))
      .rejects.toThrow('Este insumo no está listo para recoger');
  });

  it('sella el paso 2, calcula los km del tramo y deja el presupuesto `EnTransito`', async () => {
    const { db, documentos, token } = await reservado();
    const salida = await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token });

    expect(salida.estado).toBe('EnTransito');
    expect(salida.km).toBeCloseTo(3, 0);
    expect(facturaDe(documentos)).toMatchObject({ estado: 'EnTransito' });

    const viaje = viajeDe(documentos);
    expect((viaje.paso2 as Documento).lat).toBe(GPS_RECOGIDA.lat);
    expect(viaje.kmTramo1).toBe(salida.km);
    // El reloj de la alerta pasa al tramo 2: 120 min desde ahora, sin el eta.
    expect((viaje.venceAlerta as Date).toISOString()).toBe('2026-09-07T14:00:00.000Z');
  });

  it('sin GPS válido se recoge igual, pero sin kilómetros', async () => {
    const { db, documentos, token } = await reservado();
    const salida = await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token, gps: null });
    expect(salida).toMatchObject({ estado: 'EnTransito', km: null });
    expect(viajeDe(documentos).kmTramo1).toBeNull();
  });

  it('guarda las fotos como evidencias PRIVADAS, nunca en el seguimiento público', async () => {
    const { db, documentos, token } = await reservado();
    await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token, fotoPersonaPath: PERSONA });

    // La cuarta evidencia es la factura del proveedor, que dejo la compra.
    const evidencias = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/evidencias/'))
      .map((ruta) => documentos[ruta]!)
      .filter((e) => String(e.archivoPath).includes('/deliveries/'));
    expect(evidencias).toHaveLength(3);
    expect(evidencias.every((e) => e.publica === false)).toBe(true);
    expect(evidencias.map((e) => e.descripcion)).toContain('Foto del sitio de recogida (Farmacia Sur)');

    // El seguimiento solo enseña la factura del proveedor, que es publica por
    // transparencia; ninguna de las tres fotos del ciclo aparece ahi.
    const publicas = documentos[`facturasPublicas/${token}`]!.evidencias as Documento[];
    expect(publicas.map((e) => e.descripcion)).toEqual(['Factura de compra pagada al proveedor']);
  });

  it('la foto de la persona es opcional', async () => {
    const { db, documentos, token } = await reservado();
    await ejecutar('registrar_recogida', MOTO(db), { ...RECOGIDA_OK, token });
    const delCiclo = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/evidencias/'))
      .filter((ruta) => String(documentos[ruta]!.archivoPath).includes('/deliveries/'));
    expect(delCiclo).toHaveLength(2);
  });

  it('el movimiento cambia de código cuando hay notas', async () => {
    const conNotas = await reservado();
    await ejecutar('registrar_recogida', MOTO(conNotas.db), {
      ...RECOGIDA_OK, token: conNotas.token, notas: 'faltaban 3 bidones',
    });
    const movimiento = rutas(conNotas.documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => conNotas.documentos[ruta]!)
      .find((m) => String(m.descripcion).includes('Recogid'));
    const datos = JSON.parse(String(movimiento!.descripcion));
    expect(datos).toMatchObject({
      c: 'insumoRecogidoConNota', tienda: 'Farmacia Sur', direccion: 'Av. Principal',
      notas: 'faltaban 3 bidones',
    });
    expect(datos.km).toBeGreaterThan(0);

    const sinNotas = await reservado();
    await ejecutar('registrar_recogida', MOTO(sinNotas.db), { ...RECOGIDA_OK, token: sinNotas.token });
    const otro = rutas(sinNotas.documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => sinNotas.documentos[ruta]!)
      .find((m) => String(m.descripcion).includes('Recogid'));
    expect(JSON.parse(String(otro!.descripcion)).c).toBe('insumoRecogido');
  });
});

// --- registrar_entrega_final ----------------------------------------------------

describe('registrar_entrega_final', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };
  const ENTREGA_OK = { nombreReceptor: 'Sra. Rodríguez', fotoCentroPath: CENTRO, gps: GPS_CENTRO };

  async function enTransito() {
    const base = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(base.db), { ...RESERVA_OK, token: base.token });
    await ejecutar('registrar_recogida', MOTO(base.db), {
      token: base.token, fotoSitioPath: SITIO, fotoInsumoPath: INSUMO, gps: GPS_RECOGIDA,
    });
    return base;
  }

  async function ofertaRecogida() {
    const base = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(base.db), { ...RESERVA_OK, token: base.token });
    await ejecutar('recoger_oferta', MOTO(base.db), {
      token: base.token, centroDestino: 'Refugio Catia', fotoSitioPath: OFERTA_SITIO, gps: GPS_RECOGIDA,
    });
    return base;
  }

  it('el nombre de quien recibe es lo primero que se exige', async () => {
    const { db, token } = await enTransito();
    await expect(ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token, nombreReceptor: '' }))
      .rejects.toThrow('nombre de quien recibe requerido');
  });

  it('la foto de la entrega es obligatoria', async () => {
    const { db, token } = await enTransito();
    await expect(ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token, fotoCentroPath: '' }))
      .rejects.toThrow('Falta la foto de la entrega en el centro');
  });

  it('acepta el nombre antiguo del campo (`fotoEntrega`)', async () => {
    const { db, token } = await enTransito();
    const salida = await ejecutar('registrar_entrega_final', MOTO(db), {
      ...ENTREGA_OK, token, fotoCentroPath: undefined, fotoEntregaPath: CENTRO,
    });
    expect(salida.estado).toBe('Entregada');
  });

  it('un presupuesto que no está en tránsito no se entrega', async () => {
    const { db, token } = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    await expect(ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token }))
      .rejects.toThrow('Este insumo no está en tránsito');
  });

  it('una oferta que aún no se ha recogido no se entrega', async () => {
    const { db, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    await expect(ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token }))
      .rejects.toThrow('Esta donación no está lista para entregar');
  });

  it('cierra la factura, el viaje y suma los dos tramos', async () => {
    const { db, documentos, token } = await enTransito();
    const salida = await ejecutar('registrar_entrega_final', MOTO(db), {
      ...ENTREGA_OK, token, cargoReceptor: 'Coordinadora', fotoEncargadoPath: ENCARGADO,
    });

    expect(salida.estado).toBe('Entregada');
    const viaje = viajeDe(documentos);
    expect(salida.km).toBeCloseTo(Number(viaje.kmTramo1) + Number(viaje.kmTramo2), 1);

    expect(facturaDe(documentos)).toMatchObject({
      estado: 'Entregada', fechaCierre: AHORA, viajeVigenteId: null,
    });
    expect(viaje).toMatchObject({ abierto: false, venceAlerta: null });
    expect((viaje.paso3 as Documento).lat).toBe(GPS_CENTRO.lat);
  });

  it('el movimiento lleva el cargo cuando se indica', async () => {
    const { db, documentos, token } = await enTransito();
    await ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token, cargoReceptor: 'Coordinadora' });
    const movimiento = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => documentos[ruta]!)
      .find((m) => String(m.descripcion).includes('entregado'));
    expect(JSON.parse(String(movimiento!.descripcion))).toMatchObject({
      c: 'entregadoConCargo', centro: 'Hospital Vargas', receptor: 'Sra. Rodríguez', cargo: 'Coordinadora',
    });
  });

  it('sin GPS el viaje SE CIERRA igual: en el legado seguía saliendo como atrasado para siempre', async () => {
    const { db, documentos, token } = await enTransito();
    await ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token, gps: null });

    const viaje = viajeDe(documentos);
    expect(viaje).toMatchObject({ abierto: false, kmTramo2: null, venceAlerta: null });
    expect((viaje.paso3 as Documento).ts).toEqual(AHORA);

    const atrasados = (await ejecutar('admin_viajes_atrasados', contexto(db, {
      now: new Date(AHORA.getTime() + 48 * 60 * 60_000),
    }))).viajes as unknown[];
    expect(atrasados).toHaveLength(0);
  });

  it('cierra también el ciclo de una oferta recogida', async () => {
    const { db, documentos, token } = await ofertaRecogida();
    const salida = await ejecutar('registrar_entrega_final', MOTO(db), { ...ENTREGA_OK, token });

    expect(salida.estado).toBe('Entregada');
    expect(facturaDe(documentos)).toMatchObject({ estado: 'Entregada', fechaCierre: AHORA });
    expect(documentos[`ofertasPublicas/${token}`]).toMatchObject({ estado: 'Entregada' });
  });

  it('sin la reserva no se entrega, aunque el estado encaje', async () => {
    const { db, token } = await enTransito();
    const error = await ejecutar('registrar_entrega_final', OTRA_MOTO(db), {
      ...ENTREGA_OK, token, fotoCentroPath: CENTRO_2,
    }).catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(viajes.AJENA);
  });
});

// --- Costura con `ofertas.ts` ---------------------------------------------------

describe('la reserva conectada por esta tarea desbloquea las acciones de la Task 3.4', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };

  it('`reserva_detalle` entrega el contacto a quien tiene la reserva y a nadie más', async () => {
    const { db, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    const { detalle } = await ejecutar('reserva_detalle', MOTO(db), { token });
    expect(detalle).toMatchObject({ telefono: '04141234567', nombreDonante: 'Ana Pérez' });

    await expect(ejecutar('reserva_detalle', OTRA_MOTO(db), { token })).rejects.toThrow(viajes.AJENA);
  });

  it('`recoger_oferta` sella el paso 2 del viaje real y calcula los km', async () => {
    const { db, documentos, token } = await conOferta();
    await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    const salida = await ejecutar('recoger_oferta', MOTO(db), {
      token, centroDestino: 'Refugio Catia', fotoSitioPath: OFERTA_SITIO, gps: GPS_RECOGIDA,
    });

    expect(salida.estado).toBe('Recogida');
    expect(salida.km).toBeCloseTo(3, 0);
    const viaje = viajeDe(documentos);
    expect(viaje.kmTramo1).toBe(salida.km);
    expect((viaje.paso2 as Documento).lng).toBe(GPS_RECOGIDA.lng);
  });

  it('sin reserva viva `recoger_oferta` sigue fallando cerrada', async () => {
    const { db, token } = await conOferta();
    await expect(ejecutar('recoger_oferta', MOTO(db), {
      token, centroDestino: 'Refugio Catia', fotoSitioPath: OFERTA_SITIO,
    })).rejects.toThrow(ofertas.SIN_RESERVA);
  });
});

// --- Acciones del admin ---------------------------------------------------------

describe('admin_viajes_atrasados', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };

  async function reservado() {
    const base = await conPresupuestoComprado();
    await ejecutar('viaje_iniciar', MOTO(base.db), { ...RESERVA_OK, token: base.token });
    return base;
  }

  it('no lista un viaje dentro de plazo', async () => {
    const { db } = await reservado();
    const dentro = new Date(AHORA.getTime() + 100 * 60_000);
    const { viajes: filas } = await ejecutar('admin_viajes_atrasados', contexto(db, { now: dentro }));
    expect(filas).toHaveLength(0);
  });

  it('lista el tramo 1 pasados `eta + 120 min`, con el tiempo transcurrido', async () => {
    const { db, token } = await reservado();
    const tarde = new Date(AHORA.getTime() + 200 * 60_000);
    const { viajes: filas } = await ejecutar('admin_viajes_atrasados', contexto(db, { now: tarde }));

    expect(filas).toHaveLength(1);
    expect((filas as Documento[])[0]).toMatchObject({
      transportista: 'Luis Motorizado',
      uid: 'uid-moto',
      eta_minutos: 45,
      token_publico: token,
      tramo: 1,
      transcurrido_min: 200,
    });
  });

  it('no expone el correo: la identidad de la reserva es el uid', async () => {
    const { db } = await reservado();
    const tarde = new Date(AHORA.getTime() + 200 * 60_000);
    const { viajes: filas } = await ejecutar('admin_viajes_atrasados', contexto(db, { now: tarde }));
    expect((filas as Documento[])[0]!.email).toBeUndefined();
  });

  it('tras la recogida el reloj es el del tramo 2', async () => {
    const { db, token } = await reservado();
    await ejecutar('registrar_recogida', MOTO(db), {
      token, fotoSitioPath: SITIO, fotoInsumoPath: INSUMO, gps: GPS_RECOGIDA,
    });

    const justo = new Date(AHORA.getTime() + 119 * 60_000);
    expect((await ejecutar('admin_viajes_atrasados', contexto(db, { now: justo }))).viajes).toHaveLength(0);

    const tarde = new Date(AHORA.getTime() + 121 * 60_000);
    const { viajes: filas } = await ejecutar('admin_viajes_atrasados', contexto(db, { now: tarde }));
    expect((filas as Documento[])[0]).toMatchObject({ tramo: 2, transcurrido_min: 121 });
  });

  it('un viaje resuelto desaparece de la alerta', async () => {
    const { db, documentos } = await reservado();
    const viajeId = Object.keys(documentos).find((ruta) => ruta.startsWith('viajes/'))!.split('/')[1]!;
    await ejecutar('admin_viaje_resolver', contexto(db), { id: viajeId });

    const tarde = new Date(AHORA.getTime() + 300 * 60_000);
    expect((await ejecutar('admin_viajes_atrasados', contexto(db, { now: tarde }))).viajes).toHaveLength(0);
  });
});

describe('admin_viaje_resolver', () => {
  const RESERVA_OK = { etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'Luis Motorizado' };

  it('exige el id', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('admin_viaje_resolver', contexto(db), {})).rejects.toThrow('id requerido');
  });

  it('un viaje inexistente es un 404', async () => {
    const { db } = baseConCentro();
    const error = await ejecutar('admin_viaje_resolver', contexto(db), { id: 'VIA-NADA' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('libera el trabajo sin tocar el estado de la factura, y lo audita', async () => {
    const { db, documentos, token } = await conPresupuestoComprado();
    const { viajeId } = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });

    const salida = await ejecutar('admin_viaje_resolver', contexto(db), { id: String(viajeId) });
    expect(salida).toEqual({ resuelto: true });

    expect(documentos[`viajes/${viajeId}`]).toMatchObject({ resuelto: true, abierto: false, venceAlerta: null });
    // Lo comprado sigue comprado: resolver el viaje no deshace la compra.
    expect(facturaDe(documentos)).toMatchObject({ estado: 'Comprada', viajeVigenteId: null });
    expect(rutas(documentos, 'auditoriaAdmin/')).toHaveLength(1);
  });

  it('después de resolverlo, otra persona puede reservar el mismo trabajo', async () => {
    const { db, token } = await conPresupuestoComprado();
    const { viajeId } = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    await ejecutar('admin_viaje_resolver', contexto(db), { id: String(viajeId) });

    const segunda = await ejecutar('viaje_iniciar', OTRA_MOTO(db), { ...RESERVA_OK, token });
    expect(segunda).toMatchObject({ ok: true });
    expect(segunda.viajeId).not.toBe(viajeId);
  });

  it('y el transportista que la tenía deja de poder recoger', async () => {
    const { db, token } = await conPresupuestoComprado();
    const { viajeId } = await ejecutar('viaje_iniciar', MOTO(db), { ...RESERVA_OK, token });
    await ejecutar('admin_viaje_resolver', contexto(db), { id: String(viajeId) });

    await expect(ejecutar('registrar_recogida', MOTO(db), {
      token, fotoSitioPath: SITIO, fotoInsumoPath: INSUMO, gps: GPS_RECOGIDA,
    })).rejects.toThrow(ofertas.SIN_RESERVA);
  });
});

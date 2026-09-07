import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import * as facturas from '../../functions/src/api/facturas.js';
import * as ofertas from '../../functions/src/api/ofertas.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const FOTO_1 = 'private/uid-donante/offers/insumo-1.jpg';
const FOTO_2 = 'private/uid-donante/offers/insumo-2.jpg';
const CEDULA = 'private/uid-donante/offers/cedula.jpg';
const LUGAR = 'private/uid-donante/offers/lugar.jpg';

// El transportista sube sus propias fotos de la recogida.
const SITIO_TRANSPORTISTA = 'private/uid-moto/offers/recogida-sitio.jpg';
const INSUMO_TRANSPORTISTA = 'private/uid-moto/offers/recogida-insumo.jpg';

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, ...extra });
}

const ANONIMO = (db: unknown) => contexto(db, { uid: null, role: 'anon' });
const DONANTE = (db: unknown) => contexto(db, { uid: 'uid-donante', role: 'user' });
const TRANSPORTISTA = (db: unknown) => contexto(db, { uid: 'uid-moto', role: 'user' });

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
  fotosInsumoPath: [FOTO_1, FOTO_2],
  fotoCedulaPath: CEDULA,
  fotoLugarPath: LUGAR,
};

let contadorToken = 0;

// Reserva de viaje falsa: la Task 3.5 conectará la de verdad. Sin ella las dos
// acciones que dependen de la reserva fallan cerradas, que es lo correcto.
function reservaDe(uid: string, km: number | null = 3.2) {
  return {
    exigirDueno: vi.fn(async (_tx, _ctx, _facturaId: string, quien: string) => {
      if (quien !== uid) throw new ApiError('Este trabajo está reservado por otra persona', 403);
      return { viajeId: 'VIA-1', uid, nombre: 'Luis Motorizado' };
    }),
    registrarRecogida: vi.fn(async () => ({ km })),
  };
}

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
  ofertas.conectarReservaDeViaje(null);
});

function base(extra: Record<string, Documento> = {}) {
  return crearDb({ 'tasas/actual': { efectiva: 250, fuente: 'seed', fecha: ANTES.toISOString() }, ...extra });
}

async function ofrecer(db: unknown, extra: Record<string, unknown> = {}) {
  const salida = await ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, ...extra });
  return String(salida.token);
}

function facturaDe(documentos: Record<string, Documento>): { ruta: string; datos: Documento } {
  const encontradas = rutas(documentos, 'facturas/').filter((ruta) => ruta.split('/').length === 2);
  expect(encontradas).toHaveLength(1);
  return { ruta: encontradas[0]!, datos: documentos[encontradas[0]!]! };
}

// --- Helpers puros ---------------------------------------------------------------

describe('vistas de una oferta', () => {
  const factura = facturas.comoFactura({
    tokenPublico: 'DV-AAAA-BBBB-CCCC',
    tipo: 'oferta',
    moneda: 'unidades',
    estado: 'Ofrecida',
    montoRequerido: 12,
    createdAt: ANTES,
    meta: {
      insumo: 'Colchonetas', cantidad: 12, unidad: 'unidades',
      zona: 'Chacao', centro: 'Refugio Catia', latAprox: 10.5, lngAprox: -66.85,
    },
  });

  // Ésta es la fuga del contrato §1.14: con el token de una oferta cualquiera
  // obtenía teléfono, nombre y coordenadas exactas de quien donaba.
  it('la vista pública no lleva contacto, sitio exacto ni coordenadas finas', () => {
    const publico = ofertas.documentoPublico(factura);
    expect(publico).toMatchObject({
      token: 'DV-AAAA-BBBB-CCCC',
      estado: 'Ofrecida',
      insumo: 'Colchonetas',
      cantidad: 12,
      unidad: 'unidades',
      zona: 'Chacao',
      centro: 'Refugio Catia',
      coordsAprox: { lat: 10.5, lng: -66.85 },
    });
    const claves = Object.keys(publico);
    expect(claves).not.toContain('telefono');
    expect(claves).not.toContain('nombreDonante');
    expect(claves).not.toContain('ubicacion');
    expect(claves).not.toContain('coords');
  });

  it('sin coordenadas publica `coordsAprox` nula, no un punto en 0,0', () => {
    const sinCoords = facturas.comoFactura({
      tipo: 'oferta', moneda: 'unidades', createdAt: ANTES,
      meta: { insumo: 'X', cantidad: 1, latAprox: null, lngAprox: null },
    });
    expect(ofertas.documentoPublico(sinCoords).coordsAprox).toBeNull();
  });

  it('el detalle privado sí lleva el contacto completo', () => {
    const contacto = ofertas.comoContacto({
      telefono: '04141234567', nombreDonante: 'Ana Pérez',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4', lat: 10.4971, lng: -66.8534,
    });
    expect(ofertas.detallePrivado(factura, contacto)).toMatchObject({
      telefono: '04141234567',
      nombreDonante: 'Ana Pérez',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4',
      coords: { lat: 10.4971, lng: -66.8534 },
    });
  });
});

// --- ofrecer_insumo ---------------------------------------------------------------

describe('ofrecer_insumo', () => {
  it('valida en el orden del catálogo', async () => {
    const { db } = base();

    await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, insumo: ' ' }))
      .rejects.toThrow(new ApiError('insumo requerido'));
    for (const cantidad of [0, -1, 1_000_001]) {
      await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, cantidad }))
        .rejects.toThrow(new ApiError('cantidad inválida'));
    }
    await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, ubicacion: '' }))
      .rejects.toThrow(new ApiError('nombre de referencia del sitio requerido'));
    await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, telefono: '0414' }))
      .rejects.toThrow(new ApiError('teléfono requerido para coordinar la recogida'));
    await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, nombreDonante: '' }))
      .rejects.toThrow(new ApiError('nombre de contacto requerido'));
    await expect(ejecutar('ofrecer_insumo', DONANTE(db), { ...OFERTA_OK, fotosInsumoPath: [] }))
      .rejects.toThrow(new ApiError('foto del insumo requerida'));
  });

  it('rechaza fotos que no son del propio donante', async () => {
    const { db } = base();
    await expect(ejecutar('ofrecer_insumo', DONANTE(db), {
      ...OFERTA_OK, fotosInsumoPath: ['private/uid-otro/offers/insumo-1.jpg'],
    })).rejects.toThrow(new ApiError('foto del insumo requerida'));
  });

  it('crea la oferta con el contacto FUERA de la factura', async () => {
    const { db, documentos } = base();

    const salida = await ejecutar('ofrecer_insumo', DONANTE(db), OFERTA_OK);
    expect(salida).toEqual({ token: 'DV-TEST-0000-0001', numeroFactura: 'FAC-2026-000001' });

    const { ruta, datos } = facturaDe(documentos);
    expect(datos).toMatchObject({
      tipo: 'oferta', moneda: 'unidades', estado: 'Ofrecida', montoRequerido: 12,
      objetivo: 'Oferta: Colchonetas (Chacao)',
    });
    // Ni el teléfono, ni el nombre, ni el sitio exacto, ni las coordenadas finas
    // están en `facturas`: el legado las metía todas en `descripcion`.
    const comoTexto = JSON.stringify(datos);
    expect(comoTexto).not.toContain('04141234567');
    expect(comoTexto).not.toContain('Ana Pérez');
    expect(comoTexto).not.toContain('callejón El Rosal');
    expect(comoTexto).not.toContain('10.4971');
    // Solo la aproximación de ~1 km.
    expect((datos.meta as Record<string, unknown>)).toMatchObject({ latAprox: 10.5, lngAprox: -66.85 });

    const facturaId = ruta.split('/')[1]!;
    expect(documentos[`facturasContacto/${facturaId}`]).toMatchObject({
      telefono: '04141234567',
      nombreDonante: 'Ana Pérez',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4',
      lat: 10.4971,
      lng: -66.8534,
      fotosInsumoPath: [FOTO_1, FOTO_2],
      fotoCedulaPath: CEDULA,
      fotoLugarPath: LUGAR,
      authUid: 'uid-donante',
    });
  });

  it('ni la vista pública ni el hilo de seguimiento filtran el contacto', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db);

    const publico = documentos[`ofertasPublicas/${token}`]!;
    expect(publico).toMatchObject({ estado: 'Ofrecida', zona: 'Chacao', coordsAprox: { lat: 10.5, lng: -66.85 } });

    const seguimiento = documentos[`facturasPublicas/${token}`]!;
    const texto = JSON.stringify(seguimiento);
    expect(texto).not.toContain('04141234567');
    expect(texto).not.toContain('Ana Pérez');
    expect(texto).not.toContain('callejón El Rosal');

    // La descripción pública sí describe la oferta, con la zona en lugar del
    // sitio exacto (que es lo que redacta la UI, contrato de datos §6.3).
    const descripcion = JSON.parse(String((seguimiento.factura as Record<string, unknown>).descripcion));
    expect(descripcion).toEqual({
      k: 'oferta', insumo: 'Colchonetas', cantidad: 12, unidad: 'unidades',
      ubicacion: 'Chacao', centro: 'Refugio Catia',
    });

    // Y el movimiento público tampoco: el legado publicaba ahí el nombre de
    // referencia del sitio.
    const movimiento = JSON.parse(String((seguimiento.movimientos as Array<{ descripcion: string }>)[0]!.descripcion));
    expect(movimiento).toEqual({
      k: 'mov', c: 'donacionOfrecida', cantidad: 12, unidad: 'unidades',
      insumo: 'Colchonetas', ubicacion: 'Chacao',
    });
  });

  it('una oferta sin coordenadas válidas no se publica en 0,0', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db, { lat: null, lng: null });
    expect(documentos[`ofertasPublicas/${token}`]!.coordsAprox).toBeNull();
  });
});

// --- listar_ofertas ----------------------------------------------------------------

describe('listar_ofertas', () => {
  it('solo anuncia las ofrecidas y las que ya van en camino', async () => {
    const { db, documentos } = base();
    const primera = await ofrecer(db);
    const segunda = await ofrecer(db, { insumo: 'Agua', zona: 'Petare' });

    documentos[`ofertasPublicas/${segunda}`]!.estado = 'Recogida';
    const lista = (await ejecutar('listar_ofertas', ANONIMO(db))).ofertas as Array<Record<string, unknown>>;
    expect(lista.map((o) => o.token)).toEqual([primera]);
    expect(Object.keys(lista[0]!)).not.toContain('createdAt');
  });
});

// --- reserva_detalle ----------------------------------------------------------------

describe('reserva_detalle', () => {
  // Sin la Task 3.5 no existe ninguna reserva viva, así que «no tienes la
  // reserva» es la respuesta correcta. Fallar cerrado es lo único aceptable en
  // la acción que entrega un teléfono.
  it('sin la reserva de viaje conectada responde 403', async () => {
    const { db } = base();
    const token = await ofrecer(db);
    await expect(ejecutar('reserva_detalle', TRANSPORTISTA(db), { token }))
      .rejects.toThrow(new ApiError(ofertas.SIN_RESERVA, 403));
  });

  it('responde 404 con un token que no existe', async () => {
    const { db } = base();
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto'));
    await expect(ejecutar('reserva_detalle', TRANSPORTISTA(db), { token: 'DV-NO-0000-0001' }))
      .rejects.toThrow(new ApiError('Trabajo no encontrado', 404));
  });

  it('rechaza a quien no tiene la reserva', async () => {
    const { db } = base();
    const token = await ofrecer(db);
    ofertas.conectarReservaDeViaje(reservaDe('uid-otro-moto'));
    await expect(ejecutar('reserva_detalle', TRANSPORTISTA(db), { token }))
      .rejects.toThrow(new ApiError('Este trabajo está reservado por otra persona', 403));
  });

  it('entrega el contacto completo a quien sí la tiene', async () => {
    const { db } = base();
    const token = await ofrecer(db);
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto'));

    const { detalle } = await ejecutar('reserva_detalle', TRANSPORTISTA(db), { token });
    expect(detalle).toEqual({
      token,
      estado: 'Ofrecida',
      insumo: 'Colchonetas',
      cantidad: 12,
      unidad: 'unidades',
      zona: 'Chacao',
      centro: 'Refugio Catia',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4',
      telefono: '04141234567',
      nombreDonante: 'Ana Pérez',
      coords: { lat: 10.4971, lng: -66.8534 },
    });
  });
});

// --- recoger_oferta -----------------------------------------------------------------

describe('recoger_oferta', () => {
  it('sin la reserva de viaje conectada responde 403', async () => {
    const { db } = base();
    const token = await ofrecer(db);
    await expect(ejecutar('recoger_oferta', TRANSPORTISTA(db), { token }))
      .rejects.toThrow(new ApiError(ofertas.SIN_RESERVA, 403));
  });

  it('rechaza una oferta que ya fue recogida', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db);
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto'));
    facturaDe(documentos).datos.estado = 'Recogida';

    await expect(ejecutar('recoger_oferta', TRANSPORTISTA(db), { token }))
      .rejects.toThrow(new ApiError('Esta donación ya fue recogida', 409));
  });

  it('exige un centro de destino cuando la oferta no traía uno', async () => {
    const { db } = base();
    const token = await ofrecer(db, { centro: '' });
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto'));

    await expect(ejecutar('recoger_oferta', TRANSPORTISTA(db), { token }))
      .rejects.toThrow(new ApiError('centro de destino requerido'));
  });

  it('marca la recogida, guarda el destino y deja evidencias privadas', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db);
    const reserva = reservaDe('uid-moto');
    ofertas.conectarReservaDeViaje(reserva);

    const salida = await ejecutar('recoger_oferta', TRANSPORTISTA(db), {
      token,
      centroDestino: 'Hospital Vargas',
      nombreTransportista: 'Luis Motorizado',
      gps: { lat: 10.4972, lng: -66.8535 },
      fotoSitioPath: SITIO_TRANSPORTISTA,
      fotoInsumoPath: INSUMO_TRANSPORTISTA,
    });

    expect(salida).toEqual({ estado: 'Recogida', km: 3.2 });
    expect(reserva.registrarRecogida).toHaveBeenCalledTimes(1);

    const { datos } = facturaDe(documentos);
    expect(datos.estado).toBe('Recogida');
    // El legado NO guardaba el destino: la entrega posterior usaba el centro
    // original y la donación acababa en otro sitio.
    expect((datos.meta as Record<string, unknown>).centro).toBe('Hospital Vargas');
    // Recoger una oferta no la cierra (contrato §1.15).
    expect(datos.fechaCierre).toBeNull();

    const publico = documentos[`facturasPublicas/${token}`]!;
    const movimientos = (publico.movimientos as Array<{ descripcion: string }>).map((m) => JSON.parse(m.descripcion));
    expect(movimientos.map((m) => m.c)).toEqual(['donacionOfrecida', 'donacionRecogida']);
    expect(movimientos[1]).toEqual({
      k: 'mov', c: 'donacionRecogida', nombre: 'Luis Motorizado',
      // Zona, no la dirección de quien dona: el movimiento es público.
      ubicacion: 'Chacao', centro: 'Hospital Vargas', km: 3.2,
    });

    // Las dos evidencias son privadas: son la casa de una persona y su cara.
    expect(publico.evidencias).toEqual([]);
    const guardadas = rutas(documentos, 'facturas/').filter((r) => r.includes('/evidencias/'));
    expect(guardadas).toHaveLength(2);
    expect(guardadas.every((r) => documentos[r]!.publica === false)).toBe(true);

    // Y la lista pública deja de anunciarla.
    expect(documentos[`ofertasPublicas/${token}`]).toMatchObject({ estado: 'Recogida' });
  });

  it('omite los km del movimiento cuando no se pudieron calcular', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db);
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto', null));

    await expect(ejecutar('recoger_oferta', TRANSPORTISTA(db), { token, centroDestino: 'Hospital Vargas' }))
      .resolves.toEqual({ estado: 'Recogida', km: null });

    const publico = documentos[`facturasPublicas/${token}`]!;
    const ultimo = JSON.parse(String((publico.movimientos as Array<{ descripcion: string }>).at(-1)!.descripcion));
    expect(Object.keys(ultimo)).not.toContain('km');
  });

  it('ignora las fotos que no son de quien recoge', async () => {
    const { db, documentos } = base();
    const token = await ofrecer(db);
    ofertas.conectarReservaDeViaje(reservaDe('uid-moto'));

    await ejecutar('recoger_oferta', TRANSPORTISTA(db), {
      token,
      centroDestino: 'Hospital Vargas',
      // La foto de otra persona no se cuelga de esta recogida.
      fotoSitioPath: 'private/uid-donante/offers/lugar.jpg',
      fotoInsumoPath: INSUMO_TRANSPORTISTA,
    });

    const guardadas = rutas(documentos, 'facturas/').filter((r) => r.includes('/evidencias/'));
    expect(guardadas).toHaveLength(1);
    expect(documentos[guardadas[0]!]).toMatchObject({ archivoPath: INSUMO_TRANSPORTISTA });
  });
});

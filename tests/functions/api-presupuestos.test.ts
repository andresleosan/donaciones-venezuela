import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';
import * as facturas from '../../functions/src/api/facturas.js';
// Importar el dominio registra sus acciones (y, de paso, `facturas.ts`, del que
// depende: un presupuesto ES una factura con `tipo: 'presupuesto'`).
import * as presupuestos from '../../functions/src/api/presupuestos.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const ADJUNTO = 'private/uid-admin/receipts/cotizacion.pdf';
const CONSOLIDADO = 'private/uid-admin/receipts/consolidado.pdf';
const FACTURA_PROVEEDOR = 'private/uid-admin/receipts/factura.pdf';
const COMPROBANTE = 'private/uid-donante/receipts/C1.jpg';

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, uid: 'uid-admin', role: 'admin', ...extra });
}

const ANONIMO = (db: unknown) => contexto(db, { uid: null, role: 'anon' });
const DONANTE = (db: unknown) => contexto(db, { uid: 'uid-donante', role: 'user' });

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
  tiendaUrl: 'https://tienda.example/sur',
  adjuntoPath: ADJUNTO,
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
    ...extra,
  });
}

async function crearPresupuesto(db: unknown, extra: Record<string, unknown> = {}) {
  const salida = await ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, ...extra });
  return String(salida.token);
}

// --- Helpers puros --------------------------------------------------------------

describe('vista pública de un presupuesto', () => {
  const factura = facturas.comoFactura({
    tokenPublico: 'DV-AAAA-BBBB-CCCC',
    tipo: 'presupuesto',
    moneda: 'VES',
    objetivo: 'Agua potable → Hospital Vargas · Farmacia Sur',
    montoRequerido: 50_000,
    montoRecaudado: 1200,
    estado: 'PorComprar',
    createdAt: ANTES,
    meta: {
      centro: 'Hospital Vargas', insumo: 'Agua potable', tienda: 'Farmacia Sur',
      direccion: 'Av. Principal', cantidad: 500, presentacion: 'Bidón de 20 L',
      necesidadId: 'agua potable', tiendaLat: 10.6, tiendaLng: -66.93,
      tiendaUrl: 'https://tienda.example/sur', adjuntoPath: ADJUNTO,
    },
  });

  it('no expone la necesidad de origen, las coordenadas de la tienda, su URL ni el adjunto', () => {
    const publico = presupuestos.documentoPublico(factura);
    expect(publico).toMatchObject({
      token: 'DV-AAAA-BBBB-CCCC',
      estado: 'PorComprar',
      centro: 'Hospital Vargas',
      insumo: 'Agua potable',
      tienda: 'Farmacia Sur',
      direccion: 'Av. Principal',
      cantidad: 500,
      presentacion: 'Bidón de 20 L',
      moneda: 'VES',
      precio: 50_000,
      recaudado: 1200,
    });
    const claves = Object.keys(publico);
    expect(claves).not.toContain('necesidadId');
    expect(claves).not.toContain('tiendaLat');
    expect(claves).not.toContain('tiendaUrl');
    expect(claves).not.toContain('adjuntoPath');
    expect(JSON.stringify(publico)).not.toContain('receipts');
  });

  // El frontend parte el objetivo por esos separadores exactos.
  it('arma el objetivo con la flecha U+2192 y el punto medio U+00B7', () => {
    expect(presupuestos.objetivoPresupuesto('Agua', 'Hospital', 'Farmacia'))
      .toBe('Agua → Hospital · Farmacia');
  });
});

// --- admin_crear_presupuesto ------------------------------------------------------

describe('admin_crear_presupuesto', () => {
  it('valida en el orden del catálogo', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, tienda: ' ' }))
      .rejects.toThrow(new ApiError('centro, insumo y tienda requeridos'));
    await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, cantidad: 0 }))
      .rejects.toThrow(new ApiError('cantidad debe ser mayor que 0'));
    for (const precio of [0, -1, 100_000_001]) {
      await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, precio }))
        .rejects.toThrow(new ApiError('precio inválido'));
    }
    for (const coords of [{ tiendaLat: 'x' }, { tiendaLat: 91 }, { tiendaLng: 181 }, { tiendaLng: null }]) {
      await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, ...coords }))
        .rejects.toThrow(new ApiError('marca la tienda en el mapa'));
    }
    await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, tiendaUrl: 'tienda.example' }))
      .rejects.toThrow(new ApiError('la URL de la tienda debe empezar por http(s)://'));
  });

  // Rango mundial, no la caja de Venezuela: una tienda puede estar al otro lado
  // de la frontera (contrato §1.4).
  it('acepta una tienda fuera de Venezuela', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('admin_crear_presupuesto', contexto(db), {
      ...PRESUPUESTO_OK, tiendaLat: 4.7, tiendaLng: -74.07,
    })).resolves.toMatchObject({ token: 'DV-TEST-0000-0001' });
  });

  it('responde 404 si el centro no existe', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('admin_crear_presupuesto', contexto(db), { ...PRESUPUESTO_OK, centro: 'Centro Fantasma' }))
      .rejects.toThrow(new ApiError('Centro no encontrado', 404));
  });

  it('rechaza un adjunto que no es del propio admin', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('admin_crear_presupuesto', contexto(db), {
      ...PRESUPUESTO_OK, adjuntoPath: 'private/uid-otro/receipts/cotizacion.pdf',
    })).rejects.toThrow(new ApiError('adjunto inválido'));
  });

  it('crea la factura, su vista pública, la bitácora y la auditoría', async () => {
    const { db, documentos } = baseConCentro();

    const salida = await ejecutar('admin_crear_presupuesto', contexto(db), PRESUPUESTO_OK);
    expect(salida).toEqual({ numeroFactura: 'FAC-2026-000001', token: 'DV-TEST-0000-0001' });

    const [rutaFactura] = rutas(documentos, 'facturas/').filter((r) => r.split('/').length === 2);
    expect(documentos[rutaFactura!]).toMatchObject({
      tipo: 'presupuesto',
      moneda: 'VES',
      objetivo: 'Agua potable → Hospital Vargas · Farmacia Sur',
      montoRequerido: 50_000,
      montoRecaudado: 0,
      estado: 'Abierta',
    });

    const publico = documentos['presupuestosPublicos/DV-TEST-0000-0001']!;
    expect(publico).toMatchObject({ estado: 'Abierta', precio: 50_000, tienda: 'Farmacia Sur' });
    expect(JSON.stringify(publico)).not.toContain('receipts');
    // La factura también existe como hilo de seguimiento.
    expect(documentos['facturasPublicas/DV-TEST-0000-0001']).toBeDefined();

    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({ lugar: 'Hospital Vargas', origen: 'admin', cantidad: 500 });
    expect(Object.keys(documentos).some((r) => r.startsWith('auditoriaAdmin/'))).toBe(true);
  });

  // Es el diseño: «una farmacia cotiza 200, otra 1000». El objetivo lleva la
  // tienda, así que dos cotizaciones distintas no colisionan.
  it('deja convivir dos presupuestos del mismo insumo en tiendas distintas', async () => {
    const { db } = baseConCentro();
    await crearPresupuesto(db);
    await expect(crearPresupuesto(db, { tienda: 'Farmacia Norte' })).resolves.toBe('DV-TEST-0000-0002');
  });

  it('rechaza con 409 el mismo insumo, centro y tienda mientras siga abierto', async () => {
    const { db } = baseConCentro();
    await crearPresupuesto(db);
    await expect(crearPresupuesto(db))
      .rejects.toThrow(new ApiError('Ya hay una factura abierta con ese objetivo', 409));
  });
});

// --- listar_presupuestos / listar_comprados ---------------------------------------

describe('listados públicos', () => {
  it('devuelve los presupuestos con la tasa vigente y sin fechas internas', async () => {
    const { db } = baseConCentro();
    await crearPresupuesto(db);

    const salida = await ejecutar('listar_presupuestos', ANONIMO(db));
    const lista = salida.presupuestos as Array<Record<string, unknown>>;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ token: 'DV-TEST-0000-0001', estado: 'Abierta', precio: 50_000 });
    expect(Object.keys(lista[0]!)).not.toContain('createdAt');
    expect(salida.tasa).toMatchObject({ efectiva: 250, diaria: 245, fuente: 'seed' });
  });

  it('responde con tasa nula si todavía no hay ninguna capturada', async () => {
    const { db } = crearDb();
    await expect(ejecutar('listar_presupuestos', ANONIMO(db))).resolves.toEqual({ presupuestos: [], tasa: null });
  });

  // El presupuesto entra en la cola del transportista solo al estar comprado.
  it('`listar_comprados` solo trae Comprada y EnTransito', async () => {
    const { db, documentos } = baseConCentro();
    await crearPresupuesto(db);
    await crearPresupuesto(db, { tienda: 'Farmacia Norte' });

    expect((await ejecutar('listar_comprados', ANONIMO(db))).comprados).toEqual([]);

    documentos['presupuestosPublicos/DV-TEST-0000-0002']!.estado = 'Comprada';
    const comprados = (await ejecutar('listar_comprados', ANONIMO(db))).comprados as Array<Record<string, unknown>>;
    expect(comprados.map((c) => c.token)).toEqual(['DV-TEST-0000-0002']);
  });
});

// --- Ciclo de compra --------------------------------------------------------------

describe('ciclo de compra verificada', () => {
  async function conMetaCubierta() {
    const base = baseConCentro();
    const token = await crearPresupuesto(base.db);
    await ejecutar('donar_dinero', DONANTE(base.db), {
      token, montoUsd: 300, comprobantePath: COMPROBANTE, nombreDonante: 'Ana',
    });
    return { ...base, token };
  }

  it('la meta cubierta deja el presupuesto en la cola del admin', async () => {
    const { db, token } = await conMetaCubierta();

    const cola = (await ejecutar('admin_presupuestos_por_comprar', contexto(db))).presupuestos as Array<Record<string, unknown>>;
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ token, estado: 'PorComprar', precio: 50_000, recaudado: 75_000 });
  });

  it('la cola no cuela facturas de otros sabores en el mismo estado', async () => {
    const { db, documentos } = await conMetaCubierta();
    // Una factura manual metida a mano en PorComprar: `presupuestoUI` del legado
    // devolvía `null` para ella y se descartaba con `.filter(Boolean)`.
    documentos['facturas/FCT-MANUAL01'] = {
      tokenPublico: 'DV-MANU-0000-0001', tipo: 'dinero', moneda: 'VES',
      objetivo: 'Manual', estado: 'PorComprar', montoRequerido: 10, montoRecaudado: 10,
      createdAt: ANTES,
    };
    const cola = (await ejecutar('admin_presupuestos_por_comprar', contexto(db))).presupuestos as Array<Record<string, unknown>>;
    expect(cola.map((p) => p.token)).not.toContain('DV-MANU-0000-0001');
  });

  it('exige el estado antes que el archivo, y que el archivo sea del admin', async () => {
    const { db } = baseConCentro();
    const token = await crearPresupuesto(db);

    // Todavía Abierta: no está en espera de compra.
    await expect(ejecutar('admin_presupuesto_transferido', contexto(db), { token, consolidadoPath: CONSOLIDADO }))
      .rejects.toThrow(new ApiError('El presupuesto no está en espera de compra', 409));
  });

  it('transfiere, compra y deja evidencia pública y movimientos', async () => {
    const { db, documentos, token } = await conMetaCubierta();

    await expect(ejecutar('admin_presupuesto_transferido', contexto(db), { token, consolidadoPath: '' }))
      .rejects.toThrow(new ApiError('Sube el archivo consolidado de transferencias recibidas'));
    await expect(ejecutar('admin_presupuesto_transferido', contexto(db), {
      token, consolidadoPath: 'private/uid-otro/receipts/x.pdf',
    })).rejects.toThrow(new ApiError('Sube el archivo consolidado de transferencias recibidas'));

    await expect(ejecutar('admin_presupuesto_transferido', contexto(db), { token, consolidadoPath: CONSOLIDADO }))
      .resolves.toEqual({ estado: 'Transferida' });
    await expect(ejecutar('admin_presupuesto_comprado', contexto(db), { token, facturaPath: FACTURA_PROVEEDOR }))
      .resolves.toEqual({ estado: 'Comprada' });

    expect(documentos[`presupuestosPublicos/${token}`]).toMatchObject({ estado: 'Comprada' });

    const publico = documentos[`facturasPublicas/${token}`]!;
    const movimientos = publico.movimientos as Array<{ descripcion: string; tipo: string }>;
    expect(movimientos.map((m) => JSON.parse(m.descripcion).c))
      .toEqual(['dineroRecibido', 'metaCubierta', 'transferidoABs', 'compraConfirmada']);

    // Las dos evidencias son públicas, pero la ruta privada NO se publica: sin
    // firmar no sirve, y publicarla solo diría de quién es.
    const evidencias = publico.evidencias as Array<{ archivo: string; descripcion: string }>;
    expect(evidencias.map((e) => e.descripcion)).toEqual([
      'Transferencias recibidas (consolidado)',
      'Factura de compra pagada al proveedor',
    ]);
    expect(evidencias.every((e) => e.archivo === '')).toBe(true);
    expect(JSON.stringify(publico)).not.toContain('receipts');
  });

  it('se puede comprar saltándose la transferencia', async () => {
    const { db, token } = await conMetaCubierta();
    await expect(ejecutar('admin_presupuesto_comprado', contexto(db), { token, facturaPath: FACTURA_PROVEEDOR }))
      .resolves.toEqual({ estado: 'Comprada' });
  });

  it('una vez comprada no se vuelve a transferir ni a comprar', async () => {
    const { db, token } = await conMetaCubierta();
    await ejecutar('admin_presupuesto_comprado', contexto(db), { token, facturaPath: FACTURA_PROVEEDOR });
    await expect(ejecutar('admin_presupuesto_comprado', contexto(db), { token, facturaPath: FACTURA_PROVEEDOR }))
      .rejects.toThrow(new ApiError('El presupuesto no está listo para comprar', 409));
    await expect(ejecutar('admin_presupuesto_transferido', contexto(db), { token, consolidadoPath: CONSOLIDADO }))
      .rejects.toThrow(new ApiError('El presupuesto no está en espera de compra', 409));
  });
});

// --- Donaciones del presupuesto ---------------------------------------------------

describe('admin_donaciones_presupuesto', () => {
  it('responde 404 con un token que no existe', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('admin_donaciones_presupuesto', contexto(db), { token: 'DV-NO-0000-0001' }))
      .rejects.toThrow(new ApiError('presupuesto no encontrado', 404));
  });

  it('devuelve la ruta del comprobante, no una URL firmada', async () => {
    const { db } = baseConCentro();
    const token = await crearPresupuesto(db);
    await ejecutar('donar_dinero', DONANTE(db), { token, montoUsd: 10, comprobantePath: COMPROBANTE, nombreDonante: 'Ana' });

    const salida = await ejecutar('admin_donaciones_presupuesto', contexto(db), { token });
    const donaciones = salida.donaciones as Array<Record<string, unknown>>;
    expect(donaciones).toHaveLength(1);
    expect(donaciones[0]).toMatchObject({
      token,
      nombre_donante: 'Ana',
      monto: 2500,
      monto_usd: 10,
      tasa: 250,
      estado: 'Confirmada',
      comprobante: COMPROBANTE,
      comprobante_url: '',
    });
    // El id de la donación viaja junto al token: sin las dos mitades no se
    // encuentra el documento en la subcolección.
    expect(String(donaciones[0]!.id)).toMatch(/^DON-[0-9A-F]{8}$/);
  });
});

describe('admin_donacion_anular', () => {
  async function conDosDonaciones() {
    const base = baseConCentro();
    const token = await crearPresupuesto(base.db);
    await ejecutar('donar_dinero', DONANTE(base.db), { token, montoUsd: 300, comprobantePath: COMPROBANTE });
    const { donaciones } = await ejecutar('admin_donaciones_presupuesto', contexto(base.db), { token });
    return { ...base, token, id: String((donaciones as Array<Record<string, unknown>>)[0]!.id) };
  }

  it('exige el token y el id', async () => {
    const { db, token, id } = await conDosDonaciones();
    await expect(ejecutar('admin_donacion_anular', contexto(db), { token }))
      .rejects.toThrow(new ApiError('id requerido'));
    await expect(ejecutar('admin_donacion_anular', contexto(db), { id }))
      .rejects.toThrow(new ApiError('token requerido'));
  });

  it('responde 404 con una donación que no está en esa factura', async () => {
    const { db, token } = await conDosDonaciones();
    await expect(ejecutar('admin_donacion_anular', contexto(db), { token, id: 'DON-NOEXISTE' }))
      .rejects.toThrow(new ApiError('donación no encontrada', 404));
  });

  it('anula, recalcula el recaudado y reabre el presupuesto', async () => {
    const { db, documentos, token, id } = await conDosDonaciones();

    await expect(ejecutar('admin_donacion_anular', contexto(db), { token, id }))
      .resolves.toEqual({ estado: 'Abierta', recaudado: 0 });

    const publico = documentos[`facturasPublicas/${token}`]!;
    const codigos = (publico.movimientos as Array<{ descripcion: string }>)
      .map((m) => JSON.parse(m.descripcion).c);
    expect(codigos).toEqual(['dineroRecibido', 'metaCubierta', 'reabiertoPorAnulacion']);
    expect(publico.donacionesPublicas).toEqual([]);
    expect(documentos[`presupuestosPublicos/${token}`]).toMatchObject({ estado: 'Abierta', recaudado: 0 });
  });

  // El legado no comprobaba el estado previo: anular dos veces pasaba por éxito.
  it('anular dos veces responde 409', async () => {
    const { db, token, id } = await conDosDonaciones();
    await ejecutar('admin_donacion_anular', contexto(db), { token, id });
    await expect(ejecutar('admin_donacion_anular', contexto(db), { token, id }))
      .rejects.toThrow(new ApiError('Esa donación ya estaba anulada', 409));
  });

  // El dinero ya se gastó: una compra hecha no se deshace porque una donación
  // resulte falsa.
  it('no reabre un presupuesto ya comprado aunque el recaudado caiga', async () => {
    const { db, documentos, token, id } = await conDosDonaciones();
    await ejecutar('admin_presupuesto_comprado', contexto(db), { token, facturaPath: FACTURA_PROVEEDOR });

    await expect(ejecutar('admin_donacion_anular', contexto(db), { token, id }))
      .resolves.toEqual({ estado: 'Comprada', recaudado: 0 });
    expect(documentos[`presupuestosPublicos/${token}`]).toMatchObject({ estado: 'Comprada' });
  });
});

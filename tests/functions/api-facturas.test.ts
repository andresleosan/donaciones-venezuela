import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';
// Importar el dominio registra sus acciones. `facturas.ts` importa `lugares.ts`
// para resolver el centro de una necesidad, así que las ocho acciones de la
// Task 3.1 también quedan registradas: es lo que deja probar aquí el enganche
// `registrarEntrega` entrando por `panel_insumo`, que es su único llamador real.
import * as facturas from '../../functions/src/api/facturas.js';

type Documento = Record<string, unknown>;

// Firestore falso: transacción diferida, lectura de subcolección como consulta,
// `merge`, `FieldValue.increment` aplicado al confirmar y consultas con
// `where`/`orderBy`/`limit`. Rechaza leer después de escribir, igual que
// Firestore, que es la trampa que ya reventó una vez en esta fase.
function crearDb(inicial: Record<string, Documento> = {}) {
  const documentos: Record<string, Documento> = {};
  for (const [ruta, datos] of Object.entries(inicial)) documentos[ruta] = { ...datos };

  function aplicar(ruta: string, datos: Documento, merge: boolean) {
    const previo = merge ? { ...(documentos[ruta] ?? {}) } : {};
    for (const [clave, valor] of Object.entries(datos)) {
      const incremento = valor as { operand?: unknown } | null;
      if (incremento && typeof incremento === 'object' && typeof incremento.operand === 'number') {
        previo[clave] = Number(previo[clave] ?? 0) + incremento.operand;
      } else {
        previo[clave] = valor;
      }
    }
    documentos[ruta] = previo;
  }

  function hijosDe(prefijo: string): Array<{ id: string; data(): Documento }> {
    return Object.keys(documentos)
      .filter((ruta) => ruta.startsWith(`${prefijo}/`) && !ruta.slice(prefijo.length + 1).includes('/'))
      .sort()
      .map((ruta) => ({ id: ruta.slice(prefijo.length + 1), data: () => documentos[ruta]! }));
  }

  function ordenable(valor: unknown): number | string {
    if (valor instanceof Date) return valor.getTime();
    if (typeof valor === 'number') return valor;
    return String(valor ?? '');
  }

  type Filtro = { campo: string; valor: unknown };
  type Orden = { campo: string; direccion: 'asc' | 'desc' };

  function consulta(ruta: string, filtros: Filtro[], orden: Orden | null, tope: number): Documento {
    let auto = 0;
    return {
      path: ruta,
      doc: (id?: string) => referencia(`${ruta}/${id ?? `auto-${(auto += 1)}`}`),
      where: (campo: string, _op: string, valor: unknown) => consulta(ruta, [...filtros, { campo, valor }], orden, tope),
      orderBy: (campo: string, direccion: 'asc' | 'desc' = 'asc') => consulta(ruta, filtros, { campo, direccion }, tope),
      limit: (cantidad: number) => consulta(ruta, filtros, orden, cantidad),
      get: async () => {
        let filas = hijosDe(ruta).filter((fila) => filtros.every((f) => fila.data()[f.campo] === f.valor));
        if (orden) {
          filas = [...filas].sort((a, b) => {
            const x = ordenable(a.data()[orden.campo]);
            const y = ordenable(b.data()[orden.campo]);
            const signo = x < y ? -1 : x > y ? 1 : 0;
            return orden.direccion === 'desc' ? -signo : signo;
          });
        }
        return { docs: filas.slice(0, tope) };
      },
    };
  }

  function referencia(ruta: string): Documento {
    return {
      path: ruta,
      id: ruta.split('/').pop(),
      collection: (nombre: string) => coleccion(`${ruta}/${nombre}`),
    };
  }

  function coleccion(ruta: string): Documento {
    return consulta(ruta, [], null, Number.MAX_SAFE_INTEGER);
  }

  const db = {
    collection: coleccion,
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pendientes: Array<() => void> = [];
      let huboEscritura = false;
      const tx = {
        async get(ref: { path: string; doc?: unknown }) {
          if (huboEscritura) throw new Error('lectura despues de escritura');
          // Una referencia de colección se lee como consulta.
          if (typeof ref.doc === 'function') return { docs: hijosDe(ref.path) };
          const datos = documentos[ref.path];
          return { exists: datos !== undefined, data: () => datos };
        },
        set(ref: { path: string }, datos: Documento, opciones?: { merge: boolean }) {
          huboEscritura = true;
          pendientes.push(() => aplicar(ref.path, datos, Boolean(opciones?.merge)));
        },
        delete(ref: { path: string }) {
          huboEscritura = true;
          pendientes.push(() => { delete documentos[ref.path]; });
        },
      };
      const resultado = await fn(tx);
      for (const operacion of pendientes) operacion();
      return resultado;
    },
  };

  return { db, documentos };
}

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    uid: 'uid-admin',
    role: 'admin',
    panelLugarId: null,
    ip: '203.0.113.7',
    now: AHORA,
    db: db as ActionContext['db'],
    ...extra,
  } as ActionContext;
}

const ANONIMO = (db: unknown) => contexto(db, { uid: null, role: 'anon' });
const DONANTE = (db: unknown) => contexto(db, { uid: 'uid-donante', role: 'user' });

async function ejecutar(nombre: string, ctx: ActionContext, payload: Record<string, unknown> = {}) {
  const definicion = getAction(nombre);
  if (!definicion) throw new Error(`accion no registrada: ${nombre}`);
  return definicion.handler(ctx, payload);
}

function rutas(documentos: Record<string, Documento>, prefijo: string): string[] {
  return Object.keys(documentos).filter((ruta) => ruta.startsWith(prefijo)).sort();
}

// Cabecera de la unica factura escrita. Filtra por profundidad para no contar
// tambien sus subcolecciones (`facturas/FCT-…/donaciones/DON-…`).
function unicaFactura(documentos: Record<string, Documento>): { ruta: string; datos: Documento } {
  const encontradas = rutas(documentos, 'facturas/').filter((ruta) => ruta.split('/').length === 2);
  expect(encontradas).toHaveLength(1);
  return { ruta: encontradas[0]!, datos: documentos[encontradas[0]!]! };
}

// Token predecible: `reservarClaveUnica` rechazaría dos facturas con el mismo,
// así que el generador de prueba lleva su propio contador.
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

// --- Semillas ------------------------------------------------------------------

const COMPROBANTE = 'private/uid-donante/receipts/C1.jpg';

function baseConCentro(extra: Record<string, Documento> = {}) {
  return crearDb({
    'lugares/LUG-AAAA1111': {
      tipo: 'Hospital',
      nombre: 'Hospital Vargas',
      nombreNorm: 'hospital vargas',
      ubicacion: 'La Guaira',
      telefono: '04141234567',
      activo: true,
      panelUid: 'uid-panel',
      actualizado: ANTES,
    },
    'indices/lugaresPorNombre/claves/hospital vargas': { valor: 'LUG-AAAA1111' },
    'lugares/LUG-AAAA1111/insumos/agua potable': {
      nombre: 'Agua potable',
      categoria: 'Agua',
      estado: 'Necesita',
      cantidadNecesaria: 100,
      cantidadRecibida: 0,
      urgencia: 'Alta',
      unidad: 'litros',
      actualizado: ANTES,
    },
    'tasas/actual': { efectiva: 250, diaria: 245, fuente: 'seed', fecha: ANTES.toISOString() },
    ...extra,
  });
}

// Presupuesto ya creado, que es lo que necesita `donar_dinero`.
function presupuestoSembrado(estado = 'Abierta', montoRecaudado = 0) {
  return {
    'facturas/FCT-PRES0001': {
      numeroFactura: 'FAC-2026-000010',
      tokenPublico: 'DV-PRES-0000-0001',
      tipo: 'presupuesto',
      moneda: 'VES',
      objetivo: 'Agua potable → Hospital Vargas · Farmacia Sur',
      objetivoNorm: 'agua potable → hospital vargas · farmacia sur',
      descripcion: '',
      meta: {
        centro: 'Hospital Vargas',
        insumo: 'Agua potable',
        tienda: 'Farmacia Sur',
        direccion: 'Av. Principal',
        cantidad: 100,
        presentacion: 'Botellón 20 L',
        necesidadId: 'agua potable',
        tiendaLat: 10.5,
        tiendaLng: -66.9,
        tiendaUrl: 'https://tienda.example/sur',
        adjunto: '',
      },
      montoRequerido: 50_000,
      montoRecaudado,
      estado,
      viajeVigenteId: null,
      numDonaciones: 0,
      numMovimientos: 0,
      numEvidencias: 0,
      createdAt: ANTES,
      actualizado: ANTES,
      fechaCierre: null,
    },
    'indices/facturasPorToken/claves/dv-pres-0000-0001': { valor: 'FCT-PRES0001' },
    ...(estado === 'Abierta'
      ? { 'indices/facturasAbiertasPorObjetivo/claves/agua potable → hospital vargas · farmacia sur': { valor: 'FCT-PRES0001' } }
      : {}),
  };
}

// --- Helpers puros --------------------------------------------------------------

describe('máquina de estados (contrato §1.15)', () => {
  it('acepta solo los estados de origen de la tabla', () => {
    expect(facturas.puedeTransitar('Abierta', 'metaCubierta')).toBe(true);
    expect(facturas.puedeTransitar('PorComprar', 'metaCubierta')).toBe(false);
    expect(facturas.puedeTransitar('PorComprar', 'comprar')).toBe(true);
    expect(facturas.puedeTransitar('Transferida', 'comprar')).toBe(true);
    expect(facturas.puedeTransitar('Comprada', 'comprar')).toBe(false);
    expect(facturas.puedeTransitar('Ofrecida', 'recogerOferta')).toBe(true);
    expect(facturas.puedeTransitar('EnCamino', 'recogerOferta')).toBe(true);
  });

  it('`cerrarAdmin` es la única sin comprobación de estado', () => {
    for (const estado of ['Abierta', 'EnTransito', 'Ofrecida', 'Entregada', 'Cerrada'] as const) {
      expect(facturas.puedeTransitar(estado, 'cerrarAdmin')).toBe(true);
    }
  });

  it('lanza 409 con el mensaje del legado cuando el origen no encaja', () => {
    expect(() => facturas.transitar('Comprada', 'transferir'))
      .toThrow(new ApiError('El presupuesto no está en espera de compra', 409));
    expect(() => facturas.transitar('Recogida', 'recogerOferta'))
      .toThrow(new ApiError('Esta donación ya fue recogida', 409));
  });

  it('marca como terminales solo las transiciones que cierran', () => {
    expect(facturas.transitar('EnTransito', 'entregarCompra')).toEqual({ estado: 'Entregada', cierra: true });
    expect(facturas.transitar('Abierta', 'cubrirNecesidad')).toEqual({ estado: 'Cerrada', cierra: true });
    // El legado NO ponía fecha de cierre al recoger una oferta.
    expect(facturas.transitar('Ofrecida', 'recogerOferta')).toEqual({ estado: 'Recogida', cierra: false });
  });
});

describe('proyección pública', () => {
  const cargada = (extra: Partial<facturas.Factura> = {}): facturas.FacturaCargada => ({
    id: 'FCT-1',
    factura: facturas.comoFactura({
      numeroFactura: 'FAC-2026-000001',
      tokenPublico: 'DV-AAAA-BBBB-CCCC',
      tipo: 'dinero',
      moneda: 'VES',
      objetivo: 'Objetivo',
      descripcion: 'texto libre',
      montoRequerido: 100,
      montoRecaudado: 50,
      estado: 'Abierta',
      createdAt: ANTES,
      ...extra,
    }),
    donaciones: [],
    movimientos: [],
    evidencias: [],
  });

  it('recorta el porcentaje entre 0 y 100 y evita dividir por cero', () => {
    expect(facturas.porcentajeFactura({ montoRequerido: 0, montoRecaudado: 10 })).toBe(0);
    expect(facturas.porcentajeFactura({ montoRequerido: 100, montoRecaudado: 25 })).toBe(25);
    expect(facturas.porcentajeFactura({ montoRequerido: 100, montoRecaudado: 500 })).toBe(100);
  });

  it('publica la descripción de un presupuesto sin la ubicación exacta de la tienda', () => {
    const meta = {
      centro: 'Hospital Vargas', insumo: 'Agua potable', tienda: 'Farmacia Sur',
      direccion: 'Av. Principal', cantidad: 100, presentacion: 'Botellón 20 L',
      necesidadId: 'agua potable', tiendaLat: 10.5, tiendaLng: -66.9,
      tiendaUrl: 'https://tienda.example/sur', adjunto: '',
    };
    const texto = facturas.descripcionPublica(
      facturas.comoFactura({ tipo: 'presupuesto', moneda: 'VES', meta }),
    );

    expect(JSON.parse(texto)).toEqual({
      k: 'pres', moneda: 'VES', centro: 'Hospital Vargas', insumo: 'Agua potable',
      tienda: 'Farmacia Sur', direccion: 'Av. Principal', cantidad: 100,
      presentacion: 'Botellón 20 L', adjunto: '',
    });
    expect(texto).not.toContain('necesidadId');
    expect(texto).not.toContain('tiendaLat');
    expect(texto).not.toContain('tiendaUrl');
  });

  // Ésta es la fuga del legado (§1.14): `seguimiento_factura` devolvía la
  // `descripcion` íntegra, así que el token de una oferta entregaba el teléfono,
  // el nombre y las coordenadas exactas de quien donaba.
  it('publica la descripción de una oferta sin teléfono, nombre, coordenadas ni sitio exacto', () => {
    const meta = {
      insumo: 'Colchonetas', cantidad: 12, unidad: 'unidades',
      ubicacion: 'Casa de Ana, callejón El Rosal nº 4', zona: 'Chacao',
      centro: 'Refugio Catia',
    };
    const texto = facturas.descripcionPublica(
      facturas.comoFactura({ tipo: 'oferta', moneda: 'unidades', meta }),
    );

    expect(JSON.parse(texto)).toEqual({
      k: 'oferta', insumo: 'Colchonetas', cantidad: 12, unidad: 'unidades',
      ubicacion: 'Chacao', centro: 'Refugio Catia',
    });
    expect(texto).not.toContain('Casa de Ana');
  });

  it('deja pasar la descripción libre de una factura manual', () => {
    expect(facturas.descripcionPublica(cargada().factura)).toBe('texto libre');
  });

  it('solo publica las donaciones confirmadas, sin nombre ni comprobante', () => {
    const base = cargada();
    base.donaciones = [
      { id: 'D1', datos: facturas.comoDonacion({ nombreDonante: 'Ana', monto: 10, montoUsd: 1, tasa: 10, estado: 'Confirmada', comprobantePath: COMPROBANTE, referenciaPago: 'REF-1', secuencia: 1, createdAt: ANTES }) },
      { id: 'D2', datos: facturas.comoDonacion({ nombreDonante: 'Luis', monto: 20, estado: 'Registrada', secuencia: 2, createdAt: ANTES }) },
      { id: 'D3', datos: facturas.comoDonacion({ nombreDonante: 'Eva', monto: 30, estado: 'Anulada', secuencia: 3, createdAt: ANTES }) },
    ];

    const publico = facturas.documentoPublico(base);
    expect(publico.donacionesPublicas).toEqual([
      { monto_usd: 1, monto: 10, tasa: 10, creado: ANTES.toISOString() },
    ]);
    expect(JSON.stringify(publico)).not.toContain('Ana');
    expect(JSON.stringify(publico)).not.toContain('receipts');
    expect(JSON.stringify(publico)).not.toContain('REF-1');
  });

  it('publica solo las evidencias públicas y solo si son URL https', () => {
    const base = cargada();
    base.evidencias = [
      { id: 'E1', datos: facturas.comoEvidencia({ archivo: 'https://ejemplo/factura.pdf', descripcion: 'Factura', publica: true, secuencia: 1, createdAt: ANTES }) },
      { id: 'E2', datos: facturas.comoEvidencia({ archivo: 'https://ejemplo/interno.pdf', descripcion: 'Interna', publica: false, secuencia: 2, createdAt: ANTES }) },
      { id: 'E3', datos: facturas.comoEvidencia({ archivoPath: 'private/uid-admin/receipts/x.pdf', descripcion: 'Consolidado', publica: true, secuencia: 3, createdAt: ANTES }) },
    ];

    expect(facturas.documentoPublico(base).evidencias).toEqual([
      { archivo: 'https://ejemplo/factura.pdf', descripcion: 'Factura', fecha: ANTES.toISOString() },
      // La ruta privada no se publica: sin firmar no sirve, y publicarla solo
      // diría de quién es.
      { archivo: '', descripcion: 'Consolidado', fecha: ANTES.toISOString() },
    ]);
    expect(JSON.stringify(facturas.documentoPublico(base))).not.toContain('interno.pdf');
  });
});

describe('contadores del tablero', () => {
  it('`facturasAbiertas` cuenta literalmente el estado Abierta', () => {
    expect(facturas.esAbierta('Abierta')).toBe(true);
    expect(facturas.esAbierta('PorComprar')).toBe(false);
    expect(facturas.deltaEstado('Abierta', 'PorComprar')).toEqual({ facturasAbiertas: -1 });
    expect(facturas.deltaEstado('PorComprar', 'Abierta')).toEqual({ facturasAbiertas: 1 });
    expect(facturas.deltaEstado('Comprada', 'EnTransito')).toEqual({});
  });

  // Una necesidad se mide en colchonetas: sumarla al total en bolívares daría un
  // número sin significado, que es lo que hacía el legado.
  it('el total recaudado solo agrega lo que está en dinero', () => {
    expect(facturas.cuentaEnDinero({ moneda: 'VES' })).toBe(true);
    expect(facturas.cuentaEnDinero({ moneda: 'unidades' })).toBe(false);
  });
});

// --- donar_necesidad -------------------------------------------------------------

describe('donar_necesidad', () => {
  it('valida centro, insumo y cantidad en ese orden', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('donar_necesidad', ANONIMO(db), { centro: '', insumo: 'Agua potable', cantidad: 5 }))
      .rejects.toThrow(new ApiError('centro e insumo requeridos'));
    await expect(ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Hospital Vargas', insumo: ' ', cantidad: 5 }))
      .rejects.toThrow(new ApiError('centro e insumo requeridos'));
    for (const cantidad of [0, -3, 1_000_001, 'hola']) {
      await expect(ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Hospital Vargas', insumo: 'Agua potable', cantidad }))
        .rejects.toThrow(new ApiError('cantidad inválida'));
    }
  });

  it('responde 404 si el centro no existe', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Centro Fantasma', insumo: 'Agua potable', cantidad: 5 }))
      .rejects.toThrow(new ApiError('Centro no encontrado', 404));
  });

  it('responde 404 si el insumo no está en ese centro', async () => {
    const { db } = baseConCentro();
    await expect(ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Hospital Vargas', insumo: 'Antibióticos', cantidad: 5 }))
      .rejects.toThrow(new ApiError('Necesidad no encontrada', 404));
  });

  it('crea la factura, la donación, el movimiento, la bitácora y la proyección', async () => {
    const { db, documentos } = baseConCentro();

    const salida = await ejecutar('donar_necesidad', ANONIMO(db), {
      centro: 'Hospital Vargas', insumo: 'agua POTABLE', cantidad: 20, nombreDonante: 'Ana',
    });

    expect(salida).toEqual({
      token: 'DV-TEST-0000-0001',
      numeroFactura: 'FAC-2026-000001',
      objetivo: 'Agua potable → Hospital Vargas',
    });

    expect(unicaFactura(documentos).datos).toMatchObject({
      tipo: 'especie',
      moneda: 'unidades',
      objetivo: 'Agua potable → Hospital Vargas',
      // `max(cantidad_necesaria, cantidad donada)`, solo al crear.
      montoRequerido: 100,
      // Una donación `Registrada` no suma: nadie ha confirmado que llegara.
      montoRecaudado: 0,
      estado: 'Abierta',
      numDonaciones: 1,
      numMovimientos: 1,
    });

    const [rutaDonacion] = rutas(documentos, 'facturas/').filter((r) => r.includes('/donaciones/'));
    expect(documentos[rutaDonacion!]).toMatchObject({
      nombreDonante: 'Ana', monto: 20, estado: 'Registrada', secuencia: 1,
    });

    const [rutaMovimiento] = rutas(documentos, 'facturas/').filter((r) => r.includes('/movimientos/'));
    expect(documentos[rutaMovimiento!]).toMatchObject({ tipo: 'Ingreso', monto: 20 });
    expect(JSON.parse(String(documentos[rutaMovimiento!]!.descripcion))).toEqual({
      k: 'mov', c: 'donacionRegistrada', cantidad: 20, unidad: 'litros', insumo: 'Agua potable',
    });

    expect(documentos['facturasPublicas/DV-TEST-0000-0001']).toMatchObject({
      estado: 'Abierta', montoObjetivo: 100, recaudado: 0,
    });

    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({
      lugar: 'Hospital Vargas',
      insumo: 'Agua potable',
      descripcion: 'Donación registrada: 20 litros',
      origen: 'publico',
      cantidad: 20,
      unidad: 'litros',
    });

    expect(documentos['estadisticas/global']).toMatchObject({
      facturasAbiertas: 1, donacionesRegistradas: 1,
    });
    // La necesidad se mide en litros: no entra en el total en dinero.
    expect(documentos['estadisticas/global']!.montoRecaudadoTotal).toBeUndefined();
  });

  // El legado no tenía restricción: dos donaciones simultáneas creaban dos hilos
  // públicos para la misma necesidad y ninguno mostraba el total real.
  it('reutiliza la factura abierta del mismo objetivo en vez de crear otra', async () => {
    const { db, documentos } = baseConCentro();

    const primera = await ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Hospital Vargas', insumo: 'Agua potable', cantidad: 20 });
    const segunda = await ejecutar('donar_necesidad', ANONIMO(db), { centro: 'Hospital Vargas', insumo: 'Agua potable', cantidad: 5 });

    expect(segunda.token).toBe(primera.token);
    expect(unicaFactura(documentos).datos).toMatchObject({ estado: 'Abierta' });
    expect(rutas(documentos, 'facturas/').filter((r) => r.includes('/donaciones/'))).toHaveLength(2);
    expect(documentos['estadisticas/global']).toMatchObject({ facturasAbiertas: 1, donacionesRegistradas: 2 });
  });
});

// --- donar_dinero ----------------------------------------------------------------

describe('donar_dinero', () => {
  const pago = { token: 'DV-PRES-0000-0001', montoUsd: 10, comprobantePath: COMPROBANTE };

  it('valida el monto antes que nada', async () => {
    const { db } = baseConCentro(presupuestoSembrado());
    for (const montoUsd of [0, -1, 100_001]) {
      await expect(ejecutar('donar_dinero', DONANTE(db), { ...pago, montoUsd }))
        .rejects.toThrow(new ApiError('monto inválido'));
    }
  });

  it('exige una tasa de cambio vigente', async () => {
    const { db } = crearDb(presupuestoSembrado());
    await expect(ejecutar('donar_dinero', DONANTE(db), pago))
      .rejects.toThrow(new ApiError('tasa de cambio no disponible, intenta más tarde'));
  });

  it('responde 404 con un token que no es de un presupuesto', async () => {
    const { db } = baseConCentro(presupuestoSembrado());
    await expect(ejecutar('donar_dinero', DONANTE(db), { ...pago, token: 'DV-NO-EXISTE-0001' }))
      .rejects.toThrow(new ApiError('Presupuesto no encontrado', 404));

    const conNecesidad = baseConCentro({
      'facturas/FCT-NEC0001': { tokenPublico: 'DV-NEC0-0000-0001', tipo: 'especie', moneda: 'unidades', estado: 'Abierta', montoRequerido: 10, createdAt: ANTES },
      'indices/facturasPorToken/claves/dv-nec0-0000-0001': { valor: 'FCT-NEC0001' },
    });
    await expect(ejecutar('donar_dinero', DONANTE(conNecesidad.db), { ...pago, token: 'DV-NEC0-0000-0001' }))
      .rejects.toThrow(new ApiError('Presupuesto no encontrado', 404));
  });

  it('rechaza un presupuesto que ya no está abierto', async () => {
    const { db } = baseConCentro(presupuestoSembrado('PorComprar'));
    await expect(ejecutar('donar_dinero', DONANTE(db), pago))
      .rejects.toThrow(new ApiError('Este presupuesto ya está financiado'));
  });

  it('exige el comprobante y que sea del propio donante', async () => {
    const { db } = baseConCentro(presupuestoSembrado());
    await expect(ejecutar('donar_dinero', DONANTE(db), { ...pago, comprobantePath: '' }))
      .rejects.toThrow(new ApiError('Adjunta el comprobante de tu transferencia'));
    // Apuntar al archivo privado de otra persona no cuela.
    await expect(ejecutar('donar_dinero', DONANTE(db), { ...pago, comprobantePath: 'private/uid-otro/receipts/C1.jpg' }))
      .rejects.toThrow(new ApiError('Adjunta el comprobante de tu transferencia'));
  });

  it('registra la donación confirmada, el movimiento y el recaudado', async () => {
    const { db, documentos } = baseConCentro(presupuestoSembrado());

    const salida = await ejecutar('donar_dinero', DONANTE(db), { ...pago, nombreDonante: 'Ana' });

    expect(salida).toEqual({
      referencia: 'REF-TEST-0000-0001',
      token: 'DV-PRES-0000-0001',
      numeroFactura: 'FAC-2026-000010',
      recaudado: 2500,
      precio: 50_000,
      montoUsd: 10,
      montoBs: 2500,
      tasa: 250,
      estado: 'Abierta',
    });

    const [rutaDonacion] = rutas(documentos, 'facturas/FCT-PRES0001/donaciones/');
    expect(documentos[rutaDonacion!]).toMatchObject({
      nombreDonante: 'Ana', monto: 2500, montoUsd: 10, tasa: 250,
      estado: 'Confirmada', comprobantePath: COMPROBANTE, referenciaPago: 'REF-TEST-0000-0001',
    });

    expect(documentos['facturas/FCT-PRES0001']).toMatchObject({ montoRecaudado: 2500, estado: 'Abierta' });
    expect(documentos['estadisticas/global']).toMatchObject({
      donacionesRegistradas: 1, montoRecaudadoTotal: 2500,
    });

    // El desglose público existe y no lleva identidad.
    const publico = documentos['facturasPublicas/DV-PRES-0000-0001']!;
    expect(publico.donacionesPublicas).toEqual([
      { monto_usd: 10, monto: 2500, tasa: 250, creado: AHORA.toISOString() },
    ]);
    expect(JSON.stringify(publico)).not.toContain('Ana');
    expect(JSON.stringify(publico)).not.toContain('receipts');
  });

  it('al cubrir la meta pasa a PorComprar, escribe metaCubierta y avisa una sola vez', async () => {
    const { db, documentos } = baseConCentro(presupuestoSembrado('Abierta', 0));
    const avisos: string[] = [];
    facturas.conectarNotificador((texto) => { avisos.push(texto); });

    const salida = await ejecutar('donar_dinero', DONANTE(db), { ...pago, montoUsd: 300 });

    expect(salida).toMatchObject({ estado: 'PorComprar', recaudado: 75_000 });
    expect(documentos['facturas/FCT-PRES0001']).toMatchObject({ estado: 'PorComprar' });
    // Sale del índice de objetivos abiertos al dejar de estar Abierta.
    expect(documentos['indices/facturasAbiertasPorObjetivo/claves/agua potable → hospital vargas · farmacia sur']).toBeUndefined();

    // El orden lo fija `secuencia`, no el id del documento: se comprueba sobre
    // la proyeccion, que es lo que de verdad lee la pantalla de seguimiento.
    const publicos = (documentos['facturasPublicas/DV-PRES-0000-0001']!.movimientos as Array<{ descripcion: string; tipo: string }>);
    expect(publicos.map((m) => JSON.parse(m.descripcion).c)).toEqual(['dineroRecibido', 'metaCubierta']);
    expect(publicos.map((m) => m.tipo)).toEqual(['Ingreso', 'Recaudado']);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('DV-PRES-0000-0001');
  });

  it('no vuelve a cubrir la meta de un presupuesto ya financiado', async () => {
    const { db } = baseConCentro(presupuestoSembrado('PorComprar', 60_000));
    const avisos: string[] = [];
    facturas.conectarNotificador((texto) => { avisos.push(texto); });

    await expect(ejecutar('donar_dinero', DONANTE(db), pago)).rejects.toThrow(ApiError);
    expect(avisos).toHaveLength(0);
  });
});

// --- admin_crear_factura ---------------------------------------------------------

describe('admin_crear_factura', () => {
  it('valida objetivo y monto', async () => {
    const { db } = crearDb();
    await expect(ejecutar('admin_crear_factura', contexto(db), { objetivo: '  ', montoRequerido: 10 }))
      .rejects.toThrow(new ApiError('objetivo requerido'));
    for (const montoRequerido of [0, -5, 'x']) {
      await expect(ejecutar('admin_crear_factura', contexto(db), { objetivo: 'Compra de agua', montoRequerido }))
        .rejects.toThrow(new ApiError('montoRequerido debe ser mayor que 0'));
    }
  });

  it('crea la factura manual, la publica y la audita', async () => {
    const { db, documentos } = crearDb();

    const salida = await ejecutar('admin_crear_factura', contexto(db), {
      objetivo: 'Compra de agua', descripcion: 'Compra directa', montoRequerido: 900,
    });

    expect(salida).toEqual({ numeroFactura: 'FAC-2026-000001', token: 'DV-TEST-0000-0001' });
    expect(unicaFactura(documentos).datos).toMatchObject({
      tipo: 'dinero', moneda: 'VES', objetivo: 'Compra de agua',
      descripcion: 'Compra directa', montoRequerido: 900, estado: 'Abierta',
    });
    expect(documentos['facturasPublicas/DV-TEST-0000-0001']).toBeDefined();
    expect(documentos['indices/facturasPorToken/claves/dv-test-0000-0001']).toBeDefined();
    expect(Object.keys(documentos).some((r) => r.startsWith('auditoriaAdmin/'))).toBe(true);
  });

  // El legado no comprobaba duplicados: dos facturas con el mismo objetivo
  // repartían las donaciones y ninguna llegaba a su meta.
  it('rechaza con 409 un objetivo que ya tiene factura abierta', async () => {
    const { db } = crearDb();
    await ejecutar('admin_crear_factura', contexto(db), { objetivo: 'Compra de agua', montoRequerido: 900 });
    await expect(ejecutar('admin_crear_factura', contexto(db), { objetivo: 'compra de AGUA', montoRequerido: 100 }))
      .rejects.toThrow(new ApiError('Ya hay una factura abierta con ese objetivo', 409));
  });
});

// --- admin_listar_facturas -------------------------------------------------------

describe('admin_listar_facturas', () => {
  it('devuelve las claves snake_case que lee la consola, con la última actualización de la fila', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());
    documentos['facturas/FCT-PRES0001']!.actualizado = AHORA;

    const salida = await ejecutar('admin_listar_facturas', contexto(db));
    expect(salida.facturas).toEqual([{
      id: 'FCT-PRES0001',
      numero_factura: 'FAC-2026-000010',
      token_publico: 'DV-PRES-0000-0001',
      objetivo: 'Agua potable → Hospital Vargas · Farmacia Sur',
      tipo: 'presupuesto',
      moneda: 'VES',
      monto_requerido: 50_000,
      monto_recaudado: 0,
      estado: 'Abierta',
      fecha_creacion: ANTES.toISOString(),
      ultima_actualizacion: AHORA.toISOString(),
    }]);
  });
});

// --- admin_registrar_donacion ----------------------------------------------------

describe('admin_registrar_donacion', () => {
  it('exige token o numeroFactura y que la factura exista', async () => {
    const { db } = crearDb(presupuestoSembrado());
    await expect(ejecutar('admin_registrar_donacion', contexto(db), { monto: 10 }))
      .rejects.toThrow(new ApiError('token o numeroFactura requerido'));
    await expect(ejecutar('admin_registrar_donacion', contexto(db), { token: 'DV-NO-0000-0001', monto: 10 }))
      .rejects.toThrow(new ApiError('Factura no encontrada', 404));
  });

  it('valida el monto después de resolver la factura', async () => {
    const { db } = crearDb(presupuestoSembrado());
    await expect(ejecutar('admin_registrar_donacion', contexto(db), { token: 'DV-PRES-0000-0001', monto: 0 }))
      .rejects.toThrow(new ApiError('monto debe ser mayor que 0'));
  });

  it('resuelve la factura también por numeroFactura', async () => {
    const { db } = crearDb(presupuestoSembrado());
    await expect(ejecutar('admin_registrar_donacion', contexto(db), { numeroFactura: 'FAC-2026-000010', monto: 100, estado: 'Confirmada' }))
      .resolves.toMatchObject({ recaudado: 100 });
  });

  it('un estado fuera de lista cae a Registrada y no suma al recaudado', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());

    const salida = await ejecutar('admin_registrar_donacion', contexto(db), {
      token: 'DV-PRES-0000-0001', monto: 400, estado: 'Inventada',
    });

    expect(salida).toEqual({ estado: 'Abierta', recaudado: 0 });
    const [ruta] = rutas(documentos, 'facturas/FCT-PRES0001/donaciones/');
    expect(documentos[ruta!]).toMatchObject({ estado: 'Registrada', nombreDonante: 'Anónimo' });
  });

  // Decisión del legado que se conserva: aquí no hay comprobante que verificar,
  // así que asentar efectivo no dispara el ciclo de compra.
  it('no pasa a PorComprar aunque la donación cubra la meta', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());

    const salida = await ejecutar('admin_registrar_donacion', contexto(db), {
      token: 'DV-PRES-0000-0001', monto: 90_000, estado: 'Confirmada',
    });

    expect(salida).toEqual({ estado: 'Abierta', recaudado: 90_000 });
    expect(documentos['facturas/FCT-PRES0001']).toMatchObject({ estado: 'Abierta' });
  });
});

// --- admin_registrar_movimiento --------------------------------------------------

describe('admin_registrar_movimiento', () => {
  it('un tipo fuera de lista cae a Ingreso y la descripción va en texto plano', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());

    await ejecutar('admin_registrar_movimiento', contexto(db), {
      token: 'DV-PRES-0000-0001', tipo: 'Viaje', descripcion: 'Ajuste manual del cierre', monto: -50,
    });

    const [ruta] = rutas(documentos, 'facturas/FCT-PRES0001/movimientos/');
    expect(documentos[ruta!]).toMatchObject({
      tipo: 'Ingreso', descripcion: 'Ajuste manual del cierre', monto: -50,
    });
  });

  it('acepta Egreso, que es el único emisor de ese tipo', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());
    await ejecutar('admin_registrar_movimiento', contexto(db), {
      token: 'DV-PRES-0000-0001', tipo: 'Egreso', descripcion: 'Gasto', monto: 10,
    });
    const [ruta] = rutas(documentos, 'facturas/FCT-PRES0001/movimientos/');
    expect(documentos[ruta!]).toMatchObject({ tipo: 'Egreso' });
  });

  it('recorta a 80 la descripción de la bitácora, no la del movimiento', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());
    const largo = 'x'.repeat(200);

    await ejecutar('admin_registrar_movimiento', contexto(db), {
      token: 'DV-PRES-0000-0001', tipo: 'Compra', descripcion: largo, monto: 0,
    });

    const [ruta] = rutas(documentos, 'facturas/FCT-PRES0001/movimientos/');
    expect(String(documentos[ruta!]!.descripcion)).toHaveLength(200);
    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(String(bitacora?.[1]!.descripcion)).toContain('x'.repeat(80));
    expect(String(bitacora?.[1]!.descripcion)).not.toContain('x'.repeat(81));
  });
});

// --- admin_registrar_evidencia ---------------------------------------------------

describe('admin_registrar_evidencia', () => {
  it('exige una URL https en minúsculas', async () => {
    const { db } = crearDb(presupuestoSembrado());
    for (const archivo of ['', 'http://ejemplo/x.pdf', 'HTTPS://ejemplo/x.pdf', 'ftp://ejemplo/x']) {
      await expect(ejecutar('admin_registrar_evidencia', contexto(db), { token: 'DV-PRES-0000-0001', archivo }))
        .rejects.toThrow(new ApiError('archivo debe ser una URL https'));
    }
  });

  it('la evidencia es pública salvo que se pida lo contrario', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());

    await ejecutar('admin_registrar_evidencia', contexto(db), {
      token: 'DV-PRES-0000-0001', archivo: 'https://ejemplo/publica.pdf', descripcion: 'Pública',
    });
    await ejecutar('admin_registrar_evidencia', contexto(db), {
      token: 'DV-PRES-0000-0001', archivo: 'https://ejemplo/privada.pdf', descripcion: 'Privada', publica: false,
    });

    const publico = documentos['facturasPublicas/DV-PRES-0000-0001']!;
    expect(publico.evidencias).toEqual([
      { archivo: 'https://ejemplo/publica.pdf', descripcion: 'Pública', fecha: AHORA.toISOString() },
    ]);
  });
});

// --- admin_cerrar_factura --------------------------------------------------------

describe('admin_cerrar_factura', () => {
  it('cierra desde cualquier estado, fija la fecha y descuenta el contador', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado());

    await expect(ejecutar('admin_cerrar_factura', contexto(db), { token: 'DV-PRES-0000-0001' }))
      .resolves.toEqual({ estado: 'Cerrada' });

    expect(documentos['facturas/FCT-PRES0001']).toMatchObject({ estado: 'Cerrada', fechaCierre: AHORA });
    expect(documentos['estadisticas/global']).toMatchObject({ facturasAbiertas: -1 });
    // Una necesidad cerrada libera su objetivo: la siguiente donación abre otra.
    expect(documentos['indices/facturasAbiertasPorObjetivo/claves/agua potable → hospital vargas · farmacia sur']).toBeUndefined();
  });

  it('cerrar una factura ya cerrada no descuenta dos veces', async () => {
    const { db, documentos } = crearDb(presupuestoSembrado('Cerrada'));
    await ejecutar('admin_cerrar_factura', contexto(db), { token: 'DV-PRES-0000-0001' });
    expect(documentos['estadisticas/global']).toBeUndefined();
  });
});

// --- Enganche `registrarEntrega` (desde `panel_insumo`, Task 3.1) ----------------

describe('registrarEntrega desde panel_insumo', () => {
  const PANEL = (db: unknown) => contexto(db, { uid: 'uid-panel', role: 'panel', panelLugarId: 'LUG-AAAA1111' });

  async function conNecesidadDonada() {
    const base = baseConCentro();
    await ejecutar('donar_necesidad', ANONIMO(base.db), {
      centro: 'Hospital Vargas', insumo: 'Agua potable', cantidad: 40,
    });
    return base;
  }

  it('anota lo recibido como movimiento de entrega sin cerrar la factura', async () => {
    const { db, documentos } = await conNecesidadDonada();

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 30, estado: 'Necesita',
    });

    const facturaRuta = unicaFactura(documentos).ruta;
    const publico = documentos['facturasPublicas/DV-TEST-0000-0001']!;
    const movimientos = (publico.movimientos as Array<{ descripcion: string }>).map((m) => JSON.parse(m.descripcion));
    expect(movimientos.map((m) => m.c)).toEqual(['donacionRegistrada', 'recepcionConfirmada']);
    expect(movimientos[1]).toMatchObject({ delta: 30, unidad: 'litros' });
    expect(documentos[facturaRuta!]).toMatchObject({ estado: 'Abierta' });
  });

  // El legado dejaba `monto_recaudado = 0` en una necesidad para siempre (sus
  // donaciones nacen `Registrada` y nadie las confirma), así que el seguimiento
  // mostraba 0 % desde la primera donación hasta el cierre.
  it('lo que el centro confirma es el porcentaje que ve el público', async () => {
    const { db, documentos } = await conNecesidadDonada();
    const facturaRuta = unicaFactura(documentos).ruta;

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 30, estado: 'Necesita',
    });
    expect(documentos[facturaRuta]).toMatchObject({ montoRecaudado: 30 });
    expect((documentos['facturasPublicas/DV-TEST-0000-0001']!.factura as Record<string, unknown>))
      .toMatchObject({ porcentaje: 30, porcentaje_completado: 30, monto_recaudado: 30 });
  });

  // Un centro puede apuntar más de lo que pedía; un 340 % no dice nada útil.
  it('recorta el recibido a la meta', async () => {
    const { db, documentos } = await conNecesidadDonada();
    const facturaRuta = unicaFactura(documentos).ruta;

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 340, estado: 'Cubierto',
    });
    expect(documentos[facturaRuta]).toMatchObject({ montoRecaudado: 100, estado: 'Cerrada' });
  });

  it('al cubrir la necesidad escribe necesidadCubierta y cierra la factura', async () => {
    const { db, documentos } = await conNecesidadDonada();

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 100, estado: 'Cubierto',
    });

    const facturaRuta = unicaFactura(documentos).ruta;
    const publicos = documentos['facturasPublicas/DV-TEST-0000-0001']!.movimientos as Array<{ descripcion: string }>;
    expect(publicos.map((m) => JSON.parse(m.descripcion).c))
      .toEqual(['donacionRegistrada', 'recepcionConfirmada', 'necesidadCubierta']);
    expect(documentos[facturaRuta!]).toMatchObject({ estado: 'Cerrada', fechaCierre: AHORA });
    expect(documentos['estadisticas/global']).toMatchObject({ facturasAbiertas: 0 });
  });

  // El delta es 0 y no hay nada que anotar: el panel puede tocar la ficha del
  // insumo sin que eso ensucie el hilo público de la factura.
  it('no escribe movimiento cuando el delta es cero', async () => {
    const { db, documentos } = await conNecesidadDonada();

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 0, estado: 'Necesita',
    });

    const facturaRuta = unicaFactura(documentos).ruta;
    expect(rutas(documentos, `${facturaRuta}/movimientos/`)).toHaveLength(1);
  });

  it('no hace nada si el centro no tiene factura abierta de esa necesidad', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('panel_insumo', PANEL(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 30, estado: 'Necesita',
    });

    expect(rutas(documentos, 'facturas/')).toHaveLength(0);
  });
});

// --- Guardas del modelo ----------------------------------------------------------

describe('lecturas y escrituras dentro de la transacción', () => {
  // Firestore prohíbe leer después de escribir. El Firestore falso lo reproduce,
  // así que estas dos acciones son las que más orden de operaciones tienen.
  it('donar_necesidad y donar_dinero no leen después de escribir', async () => {
    const { db } = baseConCentro(presupuestoSembrado());
    await expect(ejecutar('donar_necesidad', ANONIMO(db), {
      centro: 'Hospital Vargas', insumo: 'Agua potable', cantidad: 1,
    })).resolves.toBeDefined();
    await expect(ejecutar('donar_dinero', DONANTE(db), {
      token: 'DV-PRES-0000-0001', montoUsd: 1, comprobantePath: COMPROBANTE,
    })).resolves.toBeDefined();
  });

  it('el generador de tokens vuelve al real al desconectarlo', () => {
    facturas.usarGeneradorDeTokens(null);
    expect(facturas.nuevoToken()).toMatch(/^DV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(facturas.nuevaReferencia()).toMatch(/^REF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe('el notificador es a prueba de fallos', () => {
  it('una excepción del aviso no tumba la donación ya escrita', async () => {
    const { db, documentos } = baseConCentro(presupuestoSembrado());
    facturas.conectarNotificador(() => { throw new Error('telegram caído'); });

    await expect(ejecutar('donar_dinero', DONANTE(db), {
      token: 'DV-PRES-0000-0001', montoUsd: 300, comprobantePath: COMPROBANTE,
    })).resolves.toMatchObject({ estado: 'PorComprar' });
    expect(documentos['facturas/FCT-PRES0001']).toMatchObject({ estado: 'PorComprar' });
  });
});

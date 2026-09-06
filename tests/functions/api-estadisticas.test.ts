import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONTADORES,
  ajustarContadores,
  estadisticasVacias,
  fijarEstadisticas,
  sumarEstadisticas,
} from '../../functions/src/api/estadisticas.js';
import { marcaServidor } from '../../functions/src/api/publicar.js';
import {
  ID_TASA,
  TASA_MAX,
  TASA_MIN,
  leerTasaActual,
  normalizarTasa,
  publicarTasa,
  tasaPlausible,
} from '../../functions/src/api/tasas.js';
import {
  reconstruirProyecciones,
  registrarFuente,
  resetFuentes,
} from '../../functions/src/jobs/reconciliar-proyecciones.js';

type Documento = Record<string, unknown>;

// Firestore falso con lo que usan estas utilidades: transacciones diferidas,
// `merge`, `FieldValue.increment` aplicado al confirmar, y consultas por id con
// `orderBy('__name__')` + `startAfter` + `limit` para el recorrido por lotes.
function crearDb(inicial: Record<string, Documento> = {}) {
  const documentos: Record<string, Documento> = {};
  for (const [ruta, datos] of Object.entries(inicial)) documentos[ruta] = { ...datos };

  function aplicar(ruta: string, datos: Documento, merge: boolean) {
    const previo = merge ? { ...(documentos[ruta] ?? {}) } : {};
    for (const [clave, valor] of Object.entries(datos)) {
      const incremento = valor as { operand?: unknown; isEqual?: unknown } | null;
      if (incremento && typeof incremento === 'object' && typeof incremento.operand === 'number') {
        previo[clave] = Number(previo[clave] ?? 0) + incremento.operand;
      } else {
        previo[clave] = valor;
      }
    }
    documentos[ruta] = previo;
  }

  function referencia(coleccion: string, id: string) {
    return { path: `${coleccion}/${id}` };
  }

  function idsDe(coleccion: string): string[] {
    return Object.keys(documentos)
      .filter((ruta) => ruta.startsWith(`${coleccion}/`) && ruta.split('/').length === 2)
      .map((ruta) => ruta.slice(coleccion.length + 1))
      .sort();
  }

  function consulta(coleccion: string, desde: string | null = null, tope = Infinity): unknown {
    return {
      startAfter: (valor: string) => consulta(coleccion, valor, tope),
      limit: (cantidad: number) => consulta(coleccion, desde, cantidad),
      get: async () => ({
        docs: idsDe(coleccion)
          .filter((id) => desde === null || id > desde)
          .slice(0, tope === Infinity ? undefined : tope)
          .map((id) => ({ id, data: () => documentos[`${coleccion}/${id}`] })),
      }),
    };
  }

  let autoId = 0;
  const db = {
    collection(coleccion: string) {
      return {
        doc: (id?: string) => referencia(coleccion, id ?? `auto-${(autoId += 1)}`),
        orderBy: (_campo: string) => consulta(coleccion),
      };
    },
    batch() {
      const operaciones: Array<() => void> = [];
      return {
        set(ref: { path: string }, datos: Documento) {
          operaciones.push(() => aplicar(ref.path, datos, false));
        },
        delete(ref: { path: string }) {
          operaciones.push(() => { delete documentos[ref.path]; });
        },
        async commit() {
          for (const operacion of operaciones) operacion();
        },
      };
    },
  };

  async function transaccion<T>(fn: (tx: never) => Promise<T> | T): Promise<T> {
    const pendientes: Array<() => void> = [];
    const tx = {
      async get(ref: { path: string }) {
        const datos = documentos[ref.path];
        return { exists: datos !== undefined, data: () => datos };
      },
      set(ref: { path: string }, datos: Documento, opciones?: { merge: boolean }) {
        pendientes.push(() => aplicar(ref.path, datos, Boolean(opciones?.merge)));
      },
      delete(ref: { path: string }) {
        pendientes.push(() => { delete documentos[ref.path]; });
      },
    };
    const resultado = await fn(tx as never);
    for (const operacion of pendientes) operacion();
    return resultado;
  }

  return { db, documentos, transaccion };
}

afterEach(() => {
  resetFuentes();
});

describe('contadores agregados', () => {
  it('acumula incrementos atómicos en estadisticas/global', async () => {
    const { db, documentos, transaccion } = crearDb();

    await transaccion(async (tx) => ajustarContadores(tx, db, { centrosRegistrados: 1, facturasAbiertas: 1 }));
    await transaccion(async (tx) => ajustarContadores(tx, db, { centrosRegistrados: 2, facturasAbiertas: -1 }));

    expect(documentos['estadisticas/global']).toMatchObject({
      centrosRegistrados: 3,
      facturasAbiertas: 0,
    });
  });

  it('no escribe nada cuando todos los deltas son cero', async () => {
    const { db, documentos, transaccion } = crearDb();

    await transaccion(async (tx) => ajustarContadores(tx, db, { centrosRegistrados: 0 }));

    expect(documentos).not.toHaveProperty('estadisticas/global');
  });

  it('rechaza un contador fuera de la allowlist o no numérico', async () => {
    const { db, transaccion } = crearDb();

    await expect(transaccion(async (tx) => ajustarContadores(tx, db, { inventado: 1 } as never)))
      .rejects.toThrow('contador-desconocido:inventado');
    await expect(transaccion(async (tx) => ajustarContadores(tx, db, { centrosRegistrados: Number.NaN })))
      .rejects.toThrow('contador-no-numerico:centrosRegistrados');
  });

  it('fija el documento completo en la reconstrucción', async () => {
    const { db, documentos, transaccion } = crearDb({ 'estadisticas/global': { centrosRegistrados: 99 } });

    await transaccion(async (tx) => fijarEstadisticas(tx, db, {
      ...estadisticasVacias(),
      centrosRegistrados: 2,
      montoRecaudadoTotal: 150.5,
    }));

    expect(documentos['estadisticas/global']).toMatchObject({
      centrosRegistrados: 2,
      montoRecaudadoTotal: 150.5,
      voluntariosActivos: 0,
    });
  });

  it('declara los nueve agregados del tablero', () => {
    expect(CONTADORES).toContain('montoRecaudadoTotal');
    expect(Object.keys(estadisticasVacias())).toHaveLength(CONTADORES.length);
  });

  it('suma aportes documento a documento', () => {
    const total = sumarEstadisticas(
      sumarEstadisticas(estadisticasVacias(), { centrosRegistrados: 1 }),
      { centrosRegistrados: 1, hospitalesRegistrados: 2 },
    );

    expect(total).toMatchObject({ centrosRegistrados: 2, hospitalesRegistrados: 2 });
  });
});

describe('tasa vigente', () => {
  it('acepta solo valores plausibles', () => {
    expect(tasaPlausible(TASA_MIN)).toBe(false);
    expect(tasaPlausible(TASA_MAX)).toBe(false);
    expect(tasaPlausible(36.5)).toBe(false);
    expect(tasaPlausible(250)).toBe(true);
  });

  it('cae de diaria a efectiva cuando la diaria no es plausible', () => {
    expect(normalizarTasa({ efectiva: 250, diaria: 3, fuente: 'bcv', fecha: '2026-09-06' }))
      .toEqual({ efectiva: 250, diaria: 250, fuente: 'bcv', fecha: '2026-09-06' });
  });

  it('descarta una captura no plausible', () => {
    expect(normalizarTasa({ efectiva: 12 })).toBeNull();
  });

  it('publica y relee tasas/actual', async () => {
    const { db, documentos, transaccion } = crearDb();
    const tasa = normalizarTasa({ efectiva: 250, diaria: 240, fuente: 'remitly', fecha: '2026-09-06' })!;

    await transaccion(async (tx) => publicarTasa(tx, db, tasa));

    expect(documentos[`tasas/${ID_TASA}`]).toMatchObject({ efectiva: 250, diaria: 240, fuente: 'remitly' });
    const leida = await leerTasaActual({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => documentos['tasas/actual'] }) }) }),
    });
    expect(leida).toMatchObject({ efectiva: 250, diaria: 240 });
  });

  it('devuelve null si nunca se capturó una tasa', async () => {
    await expect(leerTasaActual({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) }),
    })).resolves.toBeNull();
  });
});

describe('reconstruirProyecciones', () => {
  const canonicos = {
    'lugares/lugar-1': { nombre: 'Centro Chacao', tipo: 'Centro', activo: true, telefono: '0414' },
    'lugares/lugar-2': { nombre: 'Hospital Vargas', tipo: 'Hospital', activo: true, telefono: '0424' },
    'lugares/lugar-3': { nombre: 'Centro Cerrado', tipo: 'Centro', activo: false, telefono: '0412' },
  };

  function fuenteLugares() {
    registrarFuente({
      coleccion: 'lugares',
      proyeccion: 'lugaresPublicos',
      incluir: ({ datos }) => datos.activo === true,
      mapear: ({ datos }) => ({
        nombre: datos.nombre,
        tipo: datos.tipo,
        activo: true,
        // `telefono` está en la denylist: si el mapeo lo dejara pasar,
        // `proyeccionPublica` lo cortaría igual.
        contactoPublico: datos.telefono,
      }),
      contadores: ({ datos }) => (datos.tipo === 'Hospital'
        ? { hospitalesRegistrados: 1 }
        : { centrosRegistrados: 1 }),
    });
  }

  beforeEach(() => {
    fuenteLugares();
  });

  it('publica los documentos incluidos y cuenta los agregados', async () => {
    const { db, documentos } = crearDb(canonicos);

    const resumen = await reconstruirProyecciones(db as never, { tamanoLote: 2 });

    expect(resumen.publicados).toBe(2);
    expect(resumen.contadores).toMatchObject({ centrosRegistrados: 1, hospitalesRegistrados: 1 });
    expect(documentos['lugaresPublicos/lugar-1']).toMatchObject({ nombre: 'Centro Chacao' });
    expect(documentos['lugaresPublicos/lugar-1']).not.toHaveProperty('telefono');
    expect(documentos).not.toHaveProperty('lugaresPublicos/lugar-3');
    expect(documentos['estadisticas/global']).toMatchObject({
      centrosRegistrados: 1,
      hospitalesRegistrados: 1,
      voluntariosActivos: 0,
    });
  });

  it('borra proyecciones huérfanas y las de documentos ya excluidos', async () => {
    const { db, documentos } = crearDb({
      ...canonicos,
      'lugaresPublicos/lugar-3': { nombre: 'Centro Cerrado', activo: false },
      'lugaresPublicos/borrado': { nombre: 'Ya no existe' },
    });

    const resumen = await reconstruirProyecciones(db as never, { tamanoLote: 2 });

    expect(resumen.eliminados).toBe(2);
    expect(documentos).not.toHaveProperty('lugaresPublicos/lugar-3');
    expect(documentos).not.toHaveProperty('lugaresPublicos/borrado');
  });

  it('es idempotente: la segunda pasada deja lo mismo', async () => {
    const { db, documentos } = crearDb(canonicos);

    const primera = await reconstruirProyecciones(db as never, { tamanoLote: 1 });
    const estadoTrasPrimera = JSON.parse(JSON.stringify(documentos));
    const segunda = await reconstruirProyecciones(db as never, { tamanoLote: 1 });

    expect(segunda).toEqual(primera);
    expect(JSON.parse(JSON.stringify(documentos))).toEqual(estadoTrasPrimera);
  });

  it('recorre la colección completa aunque el lote sea de uno', async () => {
    const { db } = crearDb(canonicos);

    await expect(reconstruirProyecciones(db as never, { tamanoLote: 1 }))
      .resolves.toMatchObject({ publicados: 2 });
  });

  it('rechaza un tamaño de lote fuera de rango', async () => {
    const { db } = crearDb(canonicos);

    await expect(reconstruirProyecciones(db as never, { tamanoLote: 501 }))
      .rejects.toThrow('tamano-lote-invalido');
  });

  it('sella actualizado con la hora del servidor', async () => {
    const { db, documentos } = crearDb(canonicos);

    await reconstruirProyecciones(db as never, { tamanoLote: 400 });

    const referencia = marcaServidor() as { isEqual(otro: unknown): boolean };
    expect(referencia.isEqual(documentos['estadisticas/global']!.actualizado)).toBe(true);
  });
});

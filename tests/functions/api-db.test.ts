import { describe, expect, it } from 'vitest';

import { ApiError, coordsPublicas } from '../../functions/src/api/contract.js';
import {
  auditar,
  claveIndice,
  enmascararCorreo,
  historial,
  liberarClaveUnica,
  redactar,
  reservarClaveUnica,
  siguienteNumeroFactura,
  type ContextoMinimo,
  type TransaccionMinima,
} from '../../functions/src/api/db.js';
import { despublicar, marcaServidor, proyeccionPublica, publicar } from '../../functions/src/api/publicar.js';

type Documento = Record<string, unknown>;

// Firestore falso con la semántica que importa aquí: escrituras diferidas hasta
// el commit, `merge`, y el rechazo de una lectura después de una escritura
// (Firestore lo prohíbe y varias utilidades de este módulo leen).
function crearDb(inicial: Record<string, Documento> = {}) {
  const documentos: Record<string, Documento> = { ...inicial };
  let autoId = 0;

  const db = {
    collection(nombre: string) {
      return {
        doc(id?: string) {
          const real = id ?? `auto-${(autoId += 1)}`;
          return { path: `${nombre}/${real}`, id: real };
        },
      };
    },
  };

  async function transaccion<T>(fn: (tx: TransaccionMinima) => Promise<T> | T, confirmar = true): Promise<T> {
    const pendientes = new Map<string, { data?: Documento; merge?: boolean; borrar?: boolean }>();
    let huboEscritura = false;

    const tx: TransaccionMinima = {
      async get(referencia) {
        if (huboEscritura) throw new Error('lectura despues de escritura');
        const data = documentos[(referencia as { path: string }).path];
        return { exists: data !== undefined, data: () => data };
      },
      set(referencia, data, opciones) {
        huboEscritura = true;
        pendientes.set((referencia as { path: string }).path, { data, merge: Boolean(opciones?.merge) });
      },
      delete(referencia) {
        huboEscritura = true;
        pendientes.set((referencia as { path: string }).path, { borrar: true });
      },
    };

    const resultado = await fn(tx);
    if (!confirmar) return resultado;

    for (const [ruta, operacion] of pendientes) {
      if (operacion.borrar) delete documentos[ruta];
      else documentos[ruta] = operacion.merge ? { ...(documentos[ruta] ?? {}), ...operacion.data } : operacion.data!;
    }
    return resultado;
  }

  return { db, documentos, transaccion };
}

function contexto(db: ReturnType<typeof crearDb>['db'], extra: Partial<ContextoMinimo> = {}): ContextoMinimo {
  return {
    uid: 'uid-admin',
    role: 'admin',
    ip: '203.0.113.7',
    now: new Date('2026-09-06T12:00:00.000Z'),
    db,
    ...extra,
  };
}

function esMarcaServidor(valor: unknown): boolean {
  const referencia = marcaServidor() as { isEqual(otro: unknown): boolean };
  return Boolean(valor) && referencia.isEqual(valor);
}

describe('redacción de la bitácora', () => {
  it('enmascara el correo dejando la inicial y el dominio', () => {
    expect(enmascararCorreo('Persona@Correo.com')).toBe('P***@Correo.com');
    expect(enmascararCorreo('@sinlocal.com')).toBe('***');
    expect(enmascararCorreo('')).toBe('');
  });

  it('elimina credenciales aunque estén anidadas y conserva el resto', () => {
    expect(redactar({
      nombre: 'Centro Demo',
      pin: '1234',
      pinHash: 'abc',
      tokenInterno: 'CTR-AAAA',
      email: 'persona@correo.com',
      anidado: { password: 'x', refreshToken: 'y', ciudad: 'Chacao', correo: 'otro@correo.com' },
      lista: [{ clave: 'secreta', monto: 5 }],
    })).toEqual({
      nombre: 'Centro Demo',
      email: 'p***@correo.com',
      anidado: { ciudad: 'Chacao', correo: 'o***@correo.com' },
      lista: [{ monto: 5 }],
    });
  });

  it('corta la recursión en objetos muy profundos', () => {
    let profundo: Documento = { fin: true };
    for (let i = 0; i < 12; i += 1) profundo = { hijo: profundo };

    expect(redactar(profundo)).toBeTruthy();
  });
});

describe('auditar', () => {
  it('escribe el actor, la IP y los estados ya redactados', async () => {
    const { db, documentos, transaccion } = crearDb();

    await transaccion(async (tx) => auditar(tx, contexto(db), {
      accion: 'editar',
      entidad: 'lugares',
      entidadId: 'lugar-1',
      antes: { telefono: '0414', pin: '1234' },
      despues: { telefono: '0424', email: 'persona@correo.com' },
    }));

    const escrito = documentos['auditoriaAdmin/auto-1']!;
    expect(escrito).toMatchObject({
      accion: 'editar',
      entidad: 'lugares',
      entidadId: 'lugar-1',
      actorUid: 'uid-admin',
      actorRol: 'admin',
      ip: '203.0.113.7',
      resultado: 'ok',
      antes: { telefono: '0414' },
      despues: { telefono: '0424', email: 'p***@correo.com' },
    });
    expect(esMarcaServidor(escrito.fecha)).toBe(true);
  });
});

describe('historial', () => {
  it('escribe el movimiento canónico y su proyección en la misma transacción', async () => {
    const { db, documentos, transaccion } = crearDb();

    const id = await transaccion(async (tx) => historial(tx, contexto(db), {
      lugarId: 'lugar-1',
      lugarNombre: 'Centro Chacaó',
      insumo: 'Agua potable',
      descripcion: 'Entrega verificada',
      origen: 'panel',
      cantidad: 12,
      unidad: 'litros',
      tipo: 'entrada',
    }));

    expect(documentos[`historialMovimientos/${id}`]).toMatchObject({
      lugarId: 'lugar-1',
      lugar: 'Centro Chacaó',
      lugarNorm: 'centro chacao',
      cantidad: 12,
      origen: 'panel',
    });
    // La proyección indexa por nombre normalizado: la ventana `historial` solo
    // conoce el nombre del centro.
    expect(documentos[`historialPublico/${id}`]).toMatchObject({
      lugarId: 'centro chacao',
      lugar: 'Centro Chacaó',
      insumo: 'Agua potable',
      cantidad: 12,
      unidad: 'litros',
      tipo: 'entrada',
    });
    expect(documentos[`historialPublico/${id}`]).not.toHaveProperty('lugarNorm');
  });

  it('exige el nombre del lugar', async () => {
    const { db, transaccion } = crearDb();

    await expect(transaccion(async (tx) => historial(tx, contexto(db), {
      lugarNombre: '  ',
      origen: 'admin',
    }))).rejects.toThrow(new ApiError('nombre requerido'));
  });
});

describe('siguienteNumeroFactura', () => {
  it('empieza en 1 y devuelve FAC-YYYY-NNNNNN', async () => {
    const { db, documentos, transaccion } = crearDb();

    const resultado = await transaccion((tx) => siguienteNumeroFactura(tx, contexto(db)));

    expect(resultado).toEqual({ numero: 'FAC-2026-000001', secuencia: 1 });
    expect(documentos['config/contadores']).toEqual({ facturaSeq: 1 });
  });

  it('es monotónico entre transacciones', async () => {
    const { db, transaccion } = crearDb();
    const numeros: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      numeros.push((await transaccion((tx) => siguienteNumeroFactura(tx, contexto(db)))).numero);
    }

    expect(numeros).toEqual(['FAC-2026-000001', 'FAC-2026-000002', 'FAC-2026-000003']);
  });

  it('libera el número cuando la transacción no se confirma', async () => {
    const { db, transaccion } = crearDb();

    await transaccion((tx) => siguienteNumeroFactura(tx, contexto(db)));
    // Transacción abortada: el contador no llega a confirmarse.
    await transaccion((tx) => siguienteNumeroFactura(tx, contexto(db)), false);
    const tercera = await transaccion((tx) => siguienteNumeroFactura(tx, contexto(db)));

    expect(tercera.numero).toBe('FAC-2026-000002');
  });

  it('ignora un contador corrupto en vez de repetir el número 1', async () => {
    const { db, transaccion } = crearDb({ 'config/contadores': { facturaSeq: 'x' } });

    await expect(transaccion((tx) => siguienteNumeroFactura(tx, contexto(db))))
      .resolves.toMatchObject({ secuencia: 1 });
  });
});

describe('índices de unicidad', () => {
  it('reserva la clave normalizada bajo indices/<indice>/claves', async () => {
    const { db, documentos, transaccion } = crearDb();

    const clave = await transaccion((tx) => reservarClaveUnica(
      tx, contexto(db), 'lugaresPorNombre', ' Centro Chacaó ', 'lugar-1', 'Ese centro ya existe',
    ));

    expect(clave).toBe('centro chacao');
    expect(documentos['indices/lugaresPorNombre/claves/centro chacao'])
      .toMatchObject({ valor: 'lugar-1' });
  });

  it('rechaza con 409 cuando la clave es de otro documento', async () => {
    const { db, transaccion } = crearDb({
      'indices/lugaresPorNombre/claves/centro chacao': { valor: 'lugar-1' },
    });

    await expect(transaccion((tx) => reservarClaveUnica(
      tx, contexto(db), 'lugaresPorNombre', 'Centro Chacao', 'lugar-2', 'Ese centro ya existe',
    ))).rejects.toMatchObject({ name: 'ApiError', message: 'Ese centro ya existe', status: 409 });
  });

  it('es idempotente para el mismo dueño', async () => {
    const { db, transaccion } = crearDb({
      'indices/cuentasPorEmail/claves/persona@correo.com': { valor: 'VOL-1' },
    });

    await expect(transaccion((tx) => reservarClaveUnica(
      tx, contexto(db), 'cuentasPorEmail', 'Persona@Correo.com', 'VOL-1', 'Ese correo ya está registrado',
    ))).resolves.toBe('persona@correo.com');
  });

  it('exige una clave no vacía', () => {
    expect(() => claveIndice('facturasPorToken', '  ')).toThrow(ApiError);
  });

  it('libera la clave', async () => {
    const { db, documentos, transaccion } = crearDb({
      'indices/lugaresPorNombre/claves/centro chacao': { valor: 'lugar-1' },
    });

    await transaccion(async (tx) => liberarClaveUnica(tx, contexto(db), 'lugaresPorNombre', 'Centro Chacao'));

    expect(documentos).not.toHaveProperty('indices/lugaresPorNombre/claves/centro chacao');
  });
});

describe('publicar', () => {
  it('escribe solo la allowlist y sella updatedAt', async () => {
    const { db, documentos, transaccion } = crearDb();

    await transaccion(async (tx) => publicar(tx, db, 'lugaresPublicos', 'lugar-1', {
      nombre: 'Centro Chacao',
      nombreNorm: 'centro chacao',
      tipo: 'Centro',
      lat: 10.496,
      lng: -66.854,
      gestionado: true,
      activo: true,
      necesita: [{ nombre: 'Agua', urgencia: 'Alta' }],
      telefono: '04141234567',
      panelUid: 'uid-privado',
    }));

    const escrito = documentos['lugaresPublicos/lugar-1']!;
    expect(escrito).toMatchObject({
      nombre: 'Centro Chacao',
      nombreNorm: 'centro chacao',
      lat: 10.496,
      gestionado: true,
      necesita: [{ nombre: 'Agua', urgencia: 'Alta' }],
    });
    expect(escrito).not.toHaveProperty('telefono');
    expect(escrito).not.toHaveProperty('panelUid');
    expect(esMarcaServidor(escrito.updatedAt)).toBe(true);
  });

  it('rechaza un campo prohibido anidado que la allowlist dejó pasar', () => {
    expect(() => proyeccionPublica('lugaresPublicos', {
      nombre: 'Centro Demo',
      necesita: [{ nombre: 'Agua', coincidencias: [{ telefono: '0414' }] }],
    })).toThrow(/forbidden-public-fields/);
  });

  it('rechaza publicar sin createdAt una proyección que se consulta por createdAt', () => {
    expect(() => proyeccionPublica('familiasPublicas', { codigo: 'FAM-1', municipio: 'Chacao' }))
      .toThrow('proyeccion-sin-createdAt:familiasPublicas');
  });

  it('no exige createdAt donde la allowlist no lo declara', () => {
    expect(() => proyeccionPublica('lugaresPublicos', { nombre: 'Centro Demo' })).not.toThrow();
  });

  it('conserva lo publicado antes por otra acción del dominio', async () => {
    const { db, documentos, transaccion } = crearDb({
      'motorizadosPublicos/mot-1': { nombre: 'Luis', zona: 'Petare', createdAt: '2026-09-01' },
    });

    await transaccion(async (tx) => publicar(tx, db, 'motorizadosPublicos', 'mot-1', {
      tipoVehiculo: 'Moto', activo: true, createdAt: '2026-09-01',
    }));

    expect(documentos['motorizadosPublicos/mot-1']).toMatchObject({
      nombre: 'Luis', zona: 'Petare', tipoVehiculo: 'Moto', activo: true,
    });
  });

  it('despublicar borra la proyección', async () => {
    const { db, documentos, transaccion } = crearDb({ 'lugaresPublicos/lugar-1': { nombre: 'X' } });

    await transaccion(async (tx) => despublicar(tx, db, 'lugaresPublicos', 'lugar-1'));

    expect(documentos).not.toHaveProperty('lugaresPublicos/lugar-1');
  });
});

describe('coordsPublicas', () => {
  it('redondea a 3 decimales (~110 m)', () => {
    expect(coordsPublicas(10.4961234, -66.8543210)).toEqual({ lat: 10.496, lng: -66.854 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';
// Importar el dominio es lo que registra sus acciones. No se puede resetear el
// registro entre casos: `vi.resetModules()` daria a `lugares.ts` una copia de
// `registry.ts` distinta de la que consulta `getAction`.
import * as lugares from '../../functions/src/api/lugares.js';

type Documento = Record<string, unknown>;

// Firestore falso con lo que necesita este dominio: transacción diferida,
// lectura de subcolección, `merge`, `FieldValue.increment` aplicado al
// confirmar, `collectionGroup` y `getAll`. Rechaza leer después de escribir,
// igual que Firestore.
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

  function referencia(ruta: string): Documento {
    return {
      path: ruta,
      id: ruta.split('/').pop(),
      collection: (nombre: string) => coleccion(`${ruta}/${nombre}`),
    };
  }

  function coleccion(ruta: string): Documento {
    let auto = 0;
    return {
      path: ruta,
      doc: (id?: string) => referencia(`${ruta}/${id ?? `auto-${(auto += 1)}`}`),
      get: async () => ({ docs: hijosDe(ruta) }),
    };
  }

  const db = {
    collection: coleccion,
    collectionGroup(nombre: string) {
      const coincidencias = () => Object.keys(documentos)
        .filter((ruta) => ruta.split('/').slice(-2, -1)[0] === nombre)
        .sort();
      const construir = (filtro: [string, unknown] | null, tope: number) => ({
        where: (campo: string, _op: string, valor: unknown) => construir([campo, valor], tope),
        limit: (cantidad: number) => construir(filtro, cantidad),
        get: async () => ({
          docs: coincidencias()
            .filter((ruta) => !filtro || documentos[ruta]![filtro[0]] === filtro[1])
            .slice(0, tope)
            .map((ruta) => {
              const partes = ruta.split('/');
              return {
                id: partes[partes.length - 1]!,
                data: () => documentos[ruta]!,
                ref: { parent: { parent: { id: partes[partes.length - 3]! } } },
              };
            }),
        }),
      });
      return construir(null, Number.MAX_SAFE_INTEGER);
    },
    async getAll(...refs: Array<{ path: string }>) {
      return refs.map((ref) => ({
        id: ref.path.split('/').pop()!,
        exists: documentos[ref.path] !== undefined,
        data: () => documentos[ref.path],
      }));
    },
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

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    uid: 'uid-panel',
    role: 'panel',
    panelLugarId: 'LUG-AAAA1111',
    ip: '203.0.113.7',
    now: new Date('2026-09-06T12:00:00.000Z'),
    db: db as ActionContext['db'],
    ...extra,
  } as ActionContext;
}

async function ejecutar(nombre: string, ctx: ActionContext, payload: Record<string, unknown> = {}) {
  const definicion = getAction(nombre);
  if (!definicion) throw new Error(`accion no registrada: ${nombre}`);
  return definicion.handler(ctx, payload);
}

const AUTH_FALSO = {
  getUserByEmail: vi.fn(async () => ({ uid: 'uid-nuevo' })),
  getUser: vi.fn(async (uid: string) => ({ uid, customClaims: {} as Record<string, unknown> })),
  setCustomUserClaims: vi.fn(async () => {}),
  revokeRefreshTokens: vi.fn(async () => {}),
};

const CENTRO = {
  tipo: 'Centro',
  nombre: 'Centro Chacao',
  nombreNorm: 'centro chacao',
  ubicacion: 'Miranda',
  telefono: '04141234567',
  lat: 10.4961234,
  lng: -66.8543,
  activo: true,
  panelUid: 'uid-panel',
  actualizado: new Date('2026-09-01T00:00:00.000Z'),
};

function baseConCentro(extra: Record<string, Documento> = {}) {
  return crearDb({
    'lugares/LUG-AAAA1111': { ...CENTRO },
    'indices/lugaresPorNombre/claves/centro chacao': { valor: 'LUG-AAAA1111' },
    'lugares/LUG-AAAA1111/insumos/agua potable': {
      nombre: 'Agua potable',
      categoria: 'Alimentos',
      estado: 'Necesita',
      cantidadNecesaria: 100,
      cantidadRecibida: 20,
      urgencia: 'Alta',
      unidad: 'litros',
      actualizado: new Date('2026-09-01T00:00:00.000Z'),
    },
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  AUTH_FALSO.getUserByEmail.mockResolvedValue({ uid: 'uid-nuevo' });
  AUTH_FALSO.getUser.mockImplementation(async (uid: string) => ({ uid, customClaims: {} }));
  lugares.usarAuthAdmin(AUTH_FALSO);
});

afterEach(() => {
  lugares.usarAuthAdmin(null);
  lugares.conectarRegistroDeEntregas(null);
});

describe('saneamiento', () => {
  it('mapea las etiquetas del formulario público a los valores canónicos', () => {
    // El legado degradaba 'Tiene disponible' a 'Necesita': quien avisaba de que
    // TENÍA insumos quedaba publicado como que los NECESITABA.
    expect(lugares.estadoInsumo('Tiene disponible')).toBe('Disponible');
    expect(lugares.tipoLugar('Punto de ayuda')).toBe('Centro');
    expect(lugares.estadoInsumo('cualquier cosa')).toBe('Necesita');
    expect(lugares.tipoLugar('Hospital')).toBe('Hospital');
    expect(lugares.tipoLugar('')).toBe('Centro');
  });

  it('usa el mismo id de insumo que la semilla y neutraliza la barra', () => {
    expect(lugares.claveInsumo('Guantes quirúrgicos')).toBe('guantes quirurgicos');
    expect(lugares.claveInsumo('Agua/Hielo')).toBe('agua-hielo');
    expect(lugares.claveInsumo('..')).toBe('_..');
    expect(lugares.claveInsumo('   ')).toBe('');
  });
});

describe('registrar_lugar', () => {
  const ANON = (db: unknown) => contexto(db, { uid: null, role: 'anon', panelLugarId: null });

  it('exige el nombre', async () => {
    const { db } = crearDb();

    await expect(ejecutar('registrar_lugar', ANON(db), { nombre: '  ' }))
      .rejects.toThrow(new ApiError('nombre requerido'));
  });

  it('crea el lugar, reserva el nombre y publica la proyección', async () => {
    const { db, documentos } = crearDb();

    await expect(ejecutar('registrar_lugar', ANON(db), {
      nombre: 'Refugio Catia', tipo: 'Refugio', ubicacion: 'Catia', telefono: '04120000000',
      lat: 10.52, lng: -66.95,
    })).resolves.toEqual({});

    const [ruta] = Object.keys(documentos).filter((r) => /^lugares\/LUG-/.test(r) && r.split('/').length === 2);
    const lugarId = ruta!.split('/')[1]!;
    expect(documentos[ruta!]).toMatchObject({ nombre: 'Refugio Catia', tipo: 'Refugio', activo: true });
    expect(documentos[`indices/lugaresPorNombre/claves/refugio catia`]).toMatchObject({ valor: lugarId });
    expect(documentos[`lugaresPublicos/${lugarId}`]).toMatchObject({
      nombre: 'Refugio Catia',
      nombreNorm: 'refugio catia',
      ubicacionPublica: 'Catia',
      contactoPublico: '04120000000',
      // Redondeadas a 3 decimales: ubican el centro, no una puerta.
      lat: 10.52,
      lng: -66.95,
      gestionado: false,
      activo: true,
    });
    expect(documentos[`lugaresPublicos/${lugarId}`]).not.toHaveProperty('telefono');
    expect(documentos['estadisticas/global']).toMatchObject({ centrosRegistrados: 1 });
  });

  it('no toca un lugar que ya existe', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('registrar_lugar', ANON(db), {
      nombre: 'Centro Chacao', tipo: 'Hospital', ubicacion: 'Otra', telefono: '00000000000',
    });

    expect(documentos['lugares/LUG-AAAA1111']).toMatchObject({
      tipo: 'Centro', ubicacion: 'Miranda', telefono: '04141234567',
    });
    expect(documentos['estadisticas/global']).toBeUndefined();
  });

  it('sin insumo no escribe insumos ni bitácora', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('registrar_lugar', ANON(db), { nombre: 'Centro Chacao' });

    expect(Object.keys(documentos).filter((r) => r.startsWith('historialPublico/'))).toHaveLength(0);
  });

  it('añade el insumo conservando cantidades y escribe la bitácora', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('registrar_lugar', ANON(db), {
      nombre: 'Centro Chacao', insumo: 'Agua potable', categoria: 'Agua', estado: 'Tiene disponible',
    });

    expect(documentos['lugares/LUG-AAAA1111/insumos/agua potable']).toMatchObject({
      categoria: 'Agua',
      estado: 'Disponible',
      // Las cantidades del insumo existente se conservan.
      cantidadNecesaria: 100,
      cantidadRecibida: 20,
      unidad: 'litros',
    });
    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({
      lugar: 'Centro Chacao',
      insumo: 'Agua potable',
      descripcion: 'Reporte: Agua potable (Disponible)',
      origen: 'publico',
      cantidad: 0,
      tipo: 'Reporte',
    });
    // El insumo pasa al bucket público correcto.
    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toMatchObject({
      necesita: [], tieneDisponible: [{ nombre: 'Agua potable' }],
    });
  });
});

describe('acciones del panel', () => {
  it('rechazan una cuenta sin centro asignado, incluida la del admin', async () => {
    const { db } = baseConCentro();
    const admin = contexto(db, { uid: 'uid-admin', role: 'admin', panelLugarId: null });

    for (const accion of ['panel_ver', 'panel_actualizar_lugar', 'panel_insumo_borrar']) {
      await expect(ejecutar(accion, admin, { insumoNombre: 'x' }))
        .rejects.toMatchObject({ message: 'Tu cuenta no tiene un centro asignado', status: 403 });
    }
  });

  it('panel_ver devuelve el lugar y sus insumos con los nombres que lee la UI', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('panel_ver', contexto(db))).resolves.toEqual({
      lugar: {
        id: 'LUG-AAAA1111',
        tipo: 'Centro',
        nombre: 'Centro Chacao',
        ubicacion: 'Miranda',
        telefono: '04141234567',
        lat: 10.4961234,
        lng: -66.8543,
        actualizado: '2026-09-01T00:00:00.000Z',
      },
      insumos: [{
        id: 'agua potable',
        nombre: 'Agua potable',
        categoria: 'Alimentos',
        estado: 'Necesita',
        cantidad_necesaria: 100,
        cantidad_recibida: 20,
        urgencia: 'Alta',
        unidad: 'litros',
      }],
    });
  });

  it('panel_ver responde 404 si el claim apunta a un centro que ya no existe', async () => {
    const { db } = crearDb();

    await expect(ejecutar('panel_ver', contexto(db)))
      .rejects.toMatchObject({ message: 'Centro no encontrado', status: 404 });
  });

  it('panel_actualizar_lugar ignora los campos vacíos y no cambia el nombre', async () => {
    const { db, documentos } = baseConCentro();

    const respuesta = await ejecutar('panel_actualizar_lugar', contexto(db), {
      tipo: 'Hospital', ubicacion: '', telefono: '04149999999', nombre: 'Intento de renombrado',
      lat: 999, lng: 999,
    }) as { lugar: Record<string, unknown> };

    expect(respuesta.lugar).toMatchObject({
      nombre: 'Centro Chacao',
      tipo: 'Hospital',
      ubicacion: 'Miranda',
      telefono: '04149999999',
      // Geo fuera de Venezuela: se ignora, no es error.
      lat: 10.4961234,
    });
    expect(documentos['estadisticas/global']).toMatchObject({
      centrosRegistrados: -1, hospitalesRegistrados: 1,
    });
    const bitacora = Object.values(documentos).find((d) => d.descripcion === 'Datos del centro actualizados desde el panel');
    expect(bitacora).toMatchObject({ origen: 'panel', lugar: 'Centro Chacao' });
  });

  it('panel_insumo exige el nombre del insumo', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('panel_insumo', contexto(db), { insumoNombre: '' }))
      .rejects.toThrow(new ApiError('insumo requerido'));
  });

  it('panel_insumo normaliza cantidades, conserva la unidad y publica', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('panel_insumo', contexto(db), {
      insumoNombre: 'Agua potable', estado: 'Necesita', urgencia: 'Alta',
      cantidadNecesaria: 0, cantidadRecibida: -5,
    });

    expect(documentos['lugares/LUG-AAAA1111/insumos/agua potable']).toMatchObject({
      // 0 o negativo vuelve a 1, como el legado.
      cantidadNecesaria: 1,
      cantidadRecibida: 0,
      // La UI nunca envía `unidad`; el legado la devolvía a 'unidades' en cada toque.
      unidad: 'litros',
      categoria: 'Alimentos',
    });
  });

  it('panel_insumo calcula el delta dentro de la transacción y avisa a facturas', async () => {
    const { db } = baseConCentro();
    const entregas = vi.fn();
    lugares.conectarRegistroDeEntregas(entregas);

    await ejecutar('panel_insumo', contexto(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 100, cantidadRecibida: 55,
    });

    expect(entregas).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      centro: 'Centro Chacao',
      insumo: 'Agua potable',
      unidad: 'litros',
      delta: 35,
      recibida: 55,
      necesaria: 100,
    });
  });

  it('panel_insumo deja el insumo en el bucket público que dice su estado', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('panel_insumo', contexto(db), {
      insumoNombre: 'Agua potable', estado: 'Cubierto', cantidadNecesaria: 100, cantidadRecibida: 100,
    });

    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toMatchObject({
      necesita: [],
      cubiertos: [{ nombre: 'Agua potable', porcentaje: 100, yaCubierto: true }],
    });
  });

  it('panel_insumo_borrar elimina el insumo y escribe la bitácora aunque no existiera', async () => {
    const { db, documentos } = baseConCentro();

    await ejecutar('panel_insumo_borrar', contexto(db), { insumoNombre: 'Agua potable' });
    expect(documentos['lugares/LUG-AAAA1111/insumos/agua potable']).toBeUndefined();
    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toMatchObject({ necesita: [] });

    await ejecutar('panel_insumo_borrar', contexto(db), { insumoNombre: 'Nunca existió' });
    const entradas = Object.values(documentos).filter((d) => String(d.descripcion ?? '').startsWith('Panel: insumo'));
    expect(entradas).toHaveLength(2);
    expect(entradas[1]).toMatchObject({ descripcion: 'Panel: insumo Nunca existió retirado' });
  });
});

describe('panel_crear', () => {
  const USUARIO = (db: unknown) => contexto(db, { uid: 'uid-nuevo', role: 'user', panelLugarId: null });
  const VALIDO = {
    nombre: 'Refugio Nuevo',
    tipo: 'Refugio',
    email: 'centro@correo.com',
    telefono: '04141234567',
    fotoCedulaPath: 'private/uid-nuevo/centers/cedula.jpg',
    fotoSitioPath: 'private/uid-nuevo/centers/sitio.jpg',
  };

  it.each([
    [{ nombre: '' }, 'nombre requerido'],
    [{ email: 'no-es-correo' }, 'correo electrónico válido requerido'],
    [{ telefono: '12345' }, 'teléfono requerido'],
    [{ fotoCedulaPath: '' }, 'Falta la foto de la cédula de la persona responsable'],
    [{ fotoSitioPath: '' }, 'Falta la foto del sitio del centro'],
    // Un `path` ajeno apuntaria el expediente del centro al archivo de otra persona.
    [{ fotoCedulaPath: 'private/uid-de-otro/centers/cedula.jpg' }, 'Falta la foto de la cédula de la persona responsable'],
    [{ fotoSitioPath: 'private/uid-nuevo/needs/sitio.jpg' }, 'Falta la foto del sitio del centro'],
  ])('rechaza %j con el mensaje del catálogo', async (parche, mensaje) => {
    const { db } = crearDb();

    await expect(ejecutar('panel_crear', USUARIO(db), { ...VALIDO, ...parche }))
      .rejects.toThrow(mensaje as string);
  });

  it('rechaza un centro que ya existe', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('panel_crear', USUARIO(db), { ...VALIDO, nombre: 'Centro Chacao' }))
      .rejects.toMatchObject({
        message: 'Este centro ya está registrado. Pide al administrador que genere el acceso del panel.',
        status: 409,
      });
  });

  it('crea lugar y panel en la misma transacción y asigna los claims después', async () => {
    const { db, documentos } = crearDb();

    const respuesta = await ejecutar('panel_crear', USUARIO(db), VALIDO) as { lugarId: string };

    expect(documentos[`lugares/${respuesta.lugarId}`]).toMatchObject({
      nombre: 'Refugio Nuevo', panelUid: 'uid-nuevo',
    });
    expect(documentos[`centrosPanel/${respuesta.lugarId}`]).toMatchObject({
      authUid: 'uid-nuevo',
      email: 'centro@correo.com',
      fotoCedulaPath: 'private/uid-nuevo/centers/cedula.jpg',
    });
    // `gestionado` es derivado: un centro con panel se marca en el directorio.
    expect(documentos[`lugaresPublicos/${respuesta.lugarId}`]).toMatchObject({ gestionado: true });
    expect(AUTH_FALSO.setCustomUserClaims).toHaveBeenCalledWith('uid-nuevo', {
      role: 'panel', panelLugarId: respuesta.lugarId,
    });
    // La cédula y la foto del sitio nunca salen a la proyección pública.
    expect(JSON.stringify(documentos[`lugaresPublicos/${respuesta.lugarId}`])).not.toContain('cedula');
  });

  it('no devuelve token ni PIN: el acceso es la cuenta', async () => {
    const { db } = crearDb();

    const respuesta = await ejecutar('panel_crear', USUARIO(db), VALIDO);

    expect(respuesta).not.toHaveProperty('token');
    expect(respuesta).not.toHaveProperty('pin');
    expect(respuesta).toMatchObject({ nombre: 'Refugio Nuevo' });
  });
});

describe('admin_listar_necesidades', () => {
  const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin', panelLugarId: null });

  it('agrupa por centro y descarta lo que ya no falta', async () => {
    const { db } = baseConCentro({
      'lugares/LUG-AAAA1111/insumos/mantas': {
        nombre: 'Mantas', categoria: 'Ropa', estado: 'Necesita',
        cantidadNecesaria: 10, cantidadRecibida: 10, urgencia: 'Normal', unidad: '',
      },
      'lugares/LUG-BBBB2222': { ...CENTRO, nombre: 'Hospital Vargas', tipo: 'Hospital' },
      'lugares/LUG-BBBB2222/insumos/gasas': {
        nombre: 'Gasas', categoria: 'Salud', estado: 'Necesita',
        cantidadNecesaria: 50, cantidadRecibida: 0, urgencia: 'Alta', unidad: 'cajas',
      },
      'lugares/LUG-BBBB2222/insumos/arroz': {
        nombre: 'Arroz', categoria: 'Alimentos', estado: 'Disponible',
        cantidadNecesaria: 5, cantidadRecibida: 0, urgencia: 'Normal', unidad: 'kg',
      },
    });

    const respuesta = await ejecutar('admin_listar_necesidades', ADMIN(db)) as {
      centros: Array<{ centro: string; insumos: Array<Record<string, unknown>> }>;
      truncado: boolean;
    };

    expect(respuesta.truncado).toBe(false);
    expect(respuesta.centros).toHaveLength(2);
    const chacao = respuesta.centros.find((c) => c.centro === 'Centro Chacao');
    // 'Mantas' está cubierta (10 de 10) y 'Arroz' no está en estado Necesita.
    expect(chacao?.insumos).toEqual([{
      id: 'agua potable',
      lugarId: 'LUG-AAAA1111',
      nombre: 'Agua potable',
      unidad: 'litros',
      pendiente: 80,
      urgencia: 'Alta',
    }]);
    expect(respuesta.centros.find((c) => c.centro === 'Hospital Vargas')?.insumos[0])
      .toMatchObject({ nombre: 'Gasas', pendiente: 50 });
  });

  it('cae a unidades cuando el insumo no tiene unidad', async () => {
    const { db } = baseConCentro({
      'lugares/LUG-AAAA1111/insumos/mantas': {
        nombre: 'Mantas', estado: 'Necesita', cantidadNecesaria: 4, cantidadRecibida: 0, unidad: '',
      },
    });

    const respuesta = await ejecutar('admin_listar_necesidades', ADMIN(db)) as {
      centros: Array<{ insumos: Array<Record<string, unknown>> }>;
    };

    expect(respuesta.centros[0]!.insumos.find((i) => i.nombre === 'Mantas'))
      .toMatchObject({ unidad: 'unidades' });
  });
});

describe('admin_regenerar_panel', () => {
  const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin', panelLugarId: null });

  it('exige nombre del centro y correo', async () => {
    const { db } = baseConCentro();

    await expect(ejecutar('admin_regenerar_panel', ADMIN(db), { email: 'a@b.com' }))
      .rejects.toThrow(new ApiError('nombre del centro requerido'));
    await expect(ejecutar('admin_regenerar_panel', ADMIN(db), { nombre: 'Centro Chacao' }))
      .rejects.toThrow(new ApiError('correo electrónico válido requerido'));
  });

  it('exige que la persona ya tenga cuenta', async () => {
    const { db } = baseConCentro();
    AUTH_FALSO.getUserByEmail.mockRejectedValueOnce(new Error('no existe'));

    await expect(ejecutar('admin_regenerar_panel', ADMIN(db), {
      nombre: 'Centro Chacao', email: 'nadie@correo.com',
    })).rejects.toMatchObject({
      message: 'Esa persona debe registrarse primero con ese correo', status: 404,
    });
  });

  it('rechaza un centro inexistente', async () => {
    const { db } = crearDb();

    await expect(ejecutar('admin_regenerar_panel', ADMIN(db), {
      nombre: 'No existe', email: 'a@correo.com',
    })).rejects.toMatchObject({ message: 'Centro no encontrado', status: 404 });
  });

  it('reasigna los claims, conserva las fotos del panel y audita', async () => {
    const { db, documentos } = baseConCentro({
      'centrosPanel/LUG-AAAA1111': {
        authUid: 'uid-viejo', email: 'viejo@correo.com',
        fotoCedulaPath: 'private/uid-viejo/centers/cedula.jpg', creado: new Date(0),
      },
    });

    const respuesta = await ejecutar('admin_regenerar_panel', ADMIN(db), {
      nombre: 'Centro Chacao', email: 'Nuevo@Correo.com',
    });

    expect(respuesta).toEqual({
      lugarId: 'LUG-AAAA1111', nombre: 'Centro Chacao', email: 'nuevo@correo.com',
    });
    expect(respuesta).not.toHaveProperty('pin');
    expect(documentos['centrosPanel/LUG-AAAA1111']).toMatchObject({
      authUid: 'uid-nuevo',
      email: 'nuevo@correo.com',
      // `merge`: la foto de la cédula del panel anterior no se pierde.
      fotoCedulaPath: 'private/uid-viejo/centers/cedula.jpg',
    });
    expect(documentos['lugares/LUG-AAAA1111']).toMatchObject({ panelUid: 'uid-nuevo' });
    expect(AUTH_FALSO.setCustomUserClaims).toHaveBeenCalledWith('uid-nuevo', {
      role: 'panel', panelLugarId: 'LUG-AAAA1111',
    });

    const auditoria = Object.entries(documentos).find(([r]) => r.startsWith('auditoriaAdmin/'));
    expect(auditoria?.[1]).toMatchObject({
      accion: 'editar', entidad: 'centrosPanel', entidadId: 'LUG-AAAA1111', actorUid: 'uid-admin',
    });
    // La bitácora del admin enmascara el correo.
    expect(JSON.stringify(auditoria?.[1])).toContain('v***@correo.com');
  });
});

describe('defectos encontrados en revisión', () => {
  const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin', panelLugarId: null });

  it('relee las fechas que Firestore devuelve como Timestamp, no como 1970', async () => {
    const marca = { toDate: () => new Date('2026-09-04T08:00:00.000Z') };
    const { db } = baseConCentro({
      'lugares/LUG-AAAA1111': { ...CENTRO, actualizado: marca },
    });

    const respuesta = await ejecutar('panel_ver', contexto(db)) as { lugar: { actualizado: string } };

    expect(respuesta.lugar.actualizado).toBe('2026-09-04T08:00:00.000Z');
  });

  it('no publica en 0,0 un centro sin coordenadas', async () => {
    // Number(null) es 0 y Number.isFinite(0) es cierto: sin descartar el nulo,
    // el centro aparecia en el golfo de Guinea.
    const { db, documentos } = baseConCentro({
      'lugares/LUG-AAAA1111': { ...CENTRO, lat: null, lng: null },
    });

    await ejecutar('panel_actualizar_lugar', contexto(db), { ubicacion: 'Nueva' });

    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toMatchObject({ lat: null, lng: null });
  });

  it('avisa a facturas antes de escribir, porque ese enganche lee', async () => {
    const { db } = baseConCentro();
    const orden: string[] = [];
    lugares.conectarRegistroDeEntregas((tx) => {
      // Firestore prohibe leer despues de escribir: si el enganche corriera
      // despues de los tx.set, esta lectura reventaria en produccion.
      orden.push('entrega');
      return (tx as unknown as { get(ref: unknown): Promise<unknown> })
        .get({ path: 'facturas/DV-X' }).then(() => undefined);
    });

    await expect(ejecutar('panel_insumo', contexto(db), {
      insumoNombre: 'Agua potable', cantidadNecesaria: 10, cantidadRecibida: 3,
    })).resolves.toBeTruthy();
    expect(orden).toEqual(['entrega']);
  });

  it('impide que quien ya administra un centro cree otro y huérfane el primero', async () => {
    const { db } = crearDb();
    const ctx = contexto(db, { uid: 'uid-nuevo', role: 'panel', panelLugarId: 'LUG-YA-TIENE' });

    await expect(ejecutar('panel_crear', ctx, {
      nombre: 'Otro centro',
      email: 'centro@correo.com',
      telefono: '04141234567',
      fotoCedulaPath: 'private/uid-nuevo/centers/cedula.jpg',
      fotoSitioPath: 'private/uid-nuevo/centers/sitio.jpg',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('no degrada a un administrador que registre su propio centro', async () => {
    const { db } = crearDb();
    AUTH_FALSO.getUser.mockResolvedValue({ uid: 'uid-nuevo', customClaims: { role: 'admin' } });
    const ctx = contexto(db, { uid: 'uid-nuevo', role: 'admin', panelLugarId: null });

    const creado = await ejecutar('panel_crear', ctx, {
      nombre: 'Centro del admin',
      email: 'centro@correo.com',
      telefono: '04141234567',
      fotoCedulaPath: 'private/uid-nuevo/centers/cedula.jpg',
      fotoSitioPath: 'private/uid-nuevo/centers/sitio.jpg',
    }) as { lugarId: string };

    // `setCustomUserClaims` reemplaza el objeto entero: escribir role:'panel'
    // a secas le habria quitado el rol de administrador para siempre.
    expect(AUTH_FALSO.setCustomUserClaims).toHaveBeenCalledWith('uid-nuevo', {
      role: 'admin', panelLugarId: creado.lugarId,
    });
  });

  it('revoca el acceso del titular anterior al traspasar un centro', async () => {
    const { db } = baseConCentro();
    AUTH_FALSO.getUser.mockImplementation(async (uid: string) => ({
      uid,
      customClaims: uid === 'uid-panel' ? { role: 'panel', panelLugarId: 'LUG-AAAA1111' } : {},
    }));

    await ejecutar('admin_regenerar_panel', ADMIN(db), {
      nombre: 'Centro Chacao', email: 'nuevo@correo.com',
    });

    // Traspasar un centro es, sobre todo, quitarselo a quien lo tenia.
    expect(AUTH_FALSO.setCustomUserClaims).toHaveBeenCalledWith('uid-panel', { role: 'user' });
    expect(AUTH_FALSO.revokeRefreshTokens).toHaveBeenCalledWith('uid-panel');
    expect(AUTH_FALSO.setCustomUserClaims).toHaveBeenCalledWith('uid-nuevo', {
      role: 'panel', panelLugarId: 'LUG-AAAA1111',
    });
  });

  it('rechaza al titular anterior aunque su ID token siga vivo', async () => {
    // Limpiar el claim no basta: un ID token ya emitido vale hasta una hora.
    const { db } = baseConCentro({
      'lugares/LUG-AAAA1111': { ...CENTRO, panelUid: 'uid-nuevo' },
    });

    await expect(ejecutar('panel_ver', contexto(db, { uid: 'uid-panel' })))
      .rejects.toMatchObject({ message: 'Tu cuenta ya no administra este centro', status: 403 });
  });
});

describe('borrado en cascada', () => {
  it('arrastra insumos, panel, proyección y la reserva del nombre', async () => {
    const { db, documentos } = baseConCentro({
      'centrosPanel/LUG-AAAA1111': { authUid: 'uid-panel' },
      'lugaresPublicos/LUG-AAAA1111': { nombre: 'Centro Chacao' },
    });
    const ctx = contexto(db, { uid: 'uid-admin', role: 'admin', panelLugarId: null });

    await (db as { runTransaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown> })
      .runTransaction(async (tx) => lugares.borrarLugarEnCascada(tx as never, ctx, 'LUG-AAAA1111'));

    for (const ruta of [
      'lugares/LUG-AAAA1111',
      'lugares/LUG-AAAA1111/insumos/agua potable',
      'centrosPanel/LUG-AAAA1111',
      'lugaresPublicos/LUG-AAAA1111',
      // Sin esto el nombre quedaría reservado para siempre y ese centro no
      // se podría volver a registrar nunca.
      'indices/lugaresPorNombre/claves/centro chacao',
    ]) {
      expect(documentos).not.toHaveProperty(ruta);
    }
    expect(documentos['estadisticas/global']).toMatchObject({ centrosRegistrados: -1 });
  });
});

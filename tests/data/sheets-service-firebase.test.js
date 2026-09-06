import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mismo patrón que `tests/firebase/firebase-public-reads.test.js`: se falsea
// `firebase/firestore` entero y se comprueban las restricciones que arma la
// fachada, además del mapeo al contrato de `docs/reference/contrato-datos-ui.md`.
const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => ({ path: name })),
  doc: vi.fn((_db, path) => ({ path })),
  documentId: vi.fn(() => 'documentId()'),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ name: 'firestore' })),
  limit: vi.fn((value) => ({ type: 'limit', value })),
  orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
  query: vi.fn((reference, ...constraints) => ({ reference, constraints })),
  startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
  where: vi.fn((field, operator, value) => ({ type: 'where', field, operator, value })),
}));

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getIdToken: vi.fn(async () => null),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

const clienteMocks = vi.hoisted(() => ({ post: vi.fn(async () => ({ success: true })) }));

const cacheMocks = vi.hoisted(() => ({
  clearOfflineQueue: vi.fn(async () => 0),
  contarCola: vi.fn(async () => 0),
  enviarConCola: vi.fn((payload, enviar) => enviar(payload)),
  flushQueue: vi.fn(async () => ({ sent: 0, pending: 0 })),
  guardarSnapshot: vi.fn(async () => true),
  iniciarSincronizacion: vi.fn(),
  leerSnapshot: vi.fn(async () => undefined),
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('../../src/firebase/firebase-config.js', () => ({
  getFirebaseApp: vi.fn(async () => ({ name: 'app' })),
  getFirestoreDb: vi.fn(async () => ({ name: 'firestore' })),
}));
vi.mock('../../src/firebase/firebase-auth.js', () => authMocks);
vi.mock('../../src/data/api-client.js', () => clienteMocks);
vi.mock('../../src/data/offline-cache.js', () => cacheMocks);

import { crearSheetsServiceFirebase } from '../../src/data/sheets-service-firebase.js';

function docFalso(coleccion, id, data) {
  return { id, ref: { path: `${coleccion}/${id}` }, data: () => data };
}

// `getDocs` responde por colección, en el orden en que se pidieron las páginas.
function responderPorColeccion(mapa) {
  const pendientes = new Map(Object.entries(mapa).map(([nombre, paginas]) => [nombre, [...paginas]]));
  firestoreMocks.getDocs.mockImplementation(async ({ reference }) => {
    const paginas = pendientes.get(reference.path) ?? [];
    return { docs: paginas.length ? paginas.shift() : [] };
  });
}

const LUGAR_CENTRO = {
  nombre: 'Centro Chacao',
  nombreNorm: 'centro chacao',
  tipo: 'Centro',
  ubicacionPublica: 'Miranda, Chacao',
  contactoPublico: '04141234567',
  latAproximada: 10.496,
  lngAproximada: -66.854,
  activo: true,
  gestionado: true,
  updatedAt: '2026-09-01T10:00:00.000Z',
  necesita: [
    { nombre: 'Agua potable', categoria: 'Agua', urgencia: 'Normal', cantidadNecesaria: 10, cantidadRecibida: 4 },
    { nombre: 'Pañales', categoria: 'Higiene', urgencia: 'Alta', cantidadNecesaria: 5, cantidadRecibida: 0 },
  ],
  tieneDisponible: [],
  cubiertos: [],
};

const LUGAR_HOSPITAL = {
  nombre: 'Hospital Vargas',
  nombreNorm: 'hospital vargas',
  tipo: 'Hospital',
  ubicacionPublica: 'La Guaira',
  contactoPublico: '04149876543',
  activo: true,
  updatedAt: '2026-09-02T10:00:00.000Z',
  necesita: [],
  tieneDisponible: [{ nombre: 'AGUA POTÁBLE', categoria: 'Agua' }],
  cubiertos: [],
};

let servicio;

beforeEach(() => {
  vi.clearAllMocks();
  cacheMocks.leerSnapshot.mockResolvedValue(undefined);
  cacheMocks.enviarConCola.mockImplementation((payload, enviar) => enviar(payload));
  clienteMocks.post.mockResolvedValue({ success: true });
  authMocks.getIdToken.mockResolvedValue(null);
  firestoreMocks.getDocs.mockResolvedValue({ docs: [] });
  firestoreMocks.getDoc.mockResolvedValue({ exists: () => false });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  servicio = crearSheetsServiceFirebase();
});

describe('getLugares', () => {
  it('consulta solo lugares activos ordenados por nombreNorm y con límite 50', async () => {
    await servicio.getLugares();

    expect(firestoreMocks.collection).toHaveBeenCalledWith(expect.anything(), 'lugaresPublicos');
    expect(firestoreMocks.where).toHaveBeenCalledWith('activo', '==', true);
    expect(firestoreMocks.orderBy).toHaveBeenNthCalledWith(1, 'nombreNorm', 'asc');
    expect(firestoreMocks.orderBy).toHaveBeenNthCalledWith(2, 'documentId()', 'asc');
    expect(firestoreMocks.limit).toHaveBeenCalledWith(50);
  });

  it('mapea la proyección a los nombres que lee la UI', async () => {
    responderPorColeccion({ lugaresPublicos: [[docFalso('lugaresPublicos', 'l1', LUGAR_CENTRO)]] });

    const { data, source } = await servicio.getLugares();

    expect(source).toBe('live');
    expect(data[0]).toMatchObject({
      id: 'l1',
      nombre: 'Centro Chacao',
      tipo: 'Centro',
      ubicacion: 'Miranda, Chacao',
      telefono: '04141234567',
      lat: 10.496,
      lng: -66.854,
      gestionado: true,
      actualizado: '2026-09-01T10:00:00.000Z',
    });
  });

  it('ordena las necesidades por urgencia Alta y calcula porcentaje y yaCubierto', async () => {
    responderPorColeccion({ lugaresPublicos: [[docFalso('lugaresPublicos', 'l1', LUGAR_CENTRO)]] });

    const { data } = await servicio.getLugares();

    expect(data[0].necesita.map((item) => item.nombre)).toEqual(['Pañales', 'Agua potable']);
    expect(data[0].necesita[1]).toMatchObject({ porcentaje: 40, yaCubierto: false, unidad: 'unidades' });
  });

  it('deriva coincidencias comparando el insumo normalizado entre lugares distintos', async () => {
    responderPorColeccion({
      lugaresPublicos: [[
        docFalso('lugaresPublicos', 'l1', LUGAR_CENTRO),
        docFalso('lugaresPublicos', 'l2', LUGAR_HOSPITAL),
      ]],
    });

    const { data } = await servicio.getLugares();
    const agua = data[0].necesita.find((item) => item.nombre === 'Agua potable');

    expect(agua.coincidencias).toEqual([{
      nombre_lugar: 'Hospital Vargas',
      tipo: 'Hospital',
      ubicacion: 'La Guaira',
      telefono: '04149876543',
    }]);
    expect(data[0].necesita.find((item) => item.nombre === 'Pañales').coincidencias).toEqual([]);
  });

  it('pagina de 50 en 50 hasta agotar la colección', async () => {
    const pagina = (inicio) => Array.from({ length: 50 }, (_v, i) =>
      docFalso('lugaresPublicos', `l${inicio + i}`, { ...LUGAR_CENTRO, necesita: [], tieneDisponible: [] }));
    responderPorColeccion({ lugaresPublicos: [pagina(0), pagina(50), []] });

    const { data } = await servicio.getLugares();

    expect(data).toHaveLength(100);
    expect(firestoreMocks.startAfter).toHaveBeenCalledTimes(2);
  });
});

describe('getAll', () => {
  it('compone el estado completo y deriva los traslados sugeridos', async () => {
    responderPorColeccion({
      lugaresPublicos: [[
        docFalso('lugaresPublicos', 'l1', LUGAR_CENTRO),
        docFalso('lugaresPublicos', 'l2', LUGAR_HOSPITAL),
      ]],
      voluntariosPublicos: [[docFalso('voluntariosPublicos', 'v1', {
        nombre: 'Ana', zona: 'Chacao', activo: true, createdAt: '2026-09-01T00:00:00.000Z',
        medioTransporte: 'Moto',
      })]],
      motorizadosPublicos: [[docFalso('motorizadosPublicos', 'm1', {
        nombre: 'Luis', zona: 'Petare', tipoVehiculo: 'Moto', activo: true,
      })]],
      vacantesPublicas: [[docFalso('vacantesPublicas', 'x1', {
        titulo: 'Enfermería', lugarNombre: 'Hospital Vargas', lugarTipo: 'Hospital',
        estado: 'Abierta', cupos: 4, cantidadCubierta: 1,
      })]],
    });
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      id: 'global',
      data: () => ({ centrosRegistrados: 2, actualizado: '2026-09-03T00:00:00.000Z' }),
    });

    const { data, source } = await servicio.getAll();

    expect(source).toBe('live');
    expect(data.centros).toBe(data.lugares);
    expect(data.rescatistas).toEqual([]);
    expect(data.estadisticas).toEqual({ centrosRegistrados: 2, actualizado: '2026-09-03T00:00:00.000Z' });
    expect(data.voluntarios[0]).toMatchObject({ nombre: 'Ana', ciudad: 'Chacao', medioTransporte: 'Moto' });
    expect(data.motorizados[0]).toMatchObject({ id: 'm1', zonaOperacion: 'Petare', operaEn: 'Petare' });
    expect(data.vacantes[0]).toMatchObject({
      rol: 'Enfermería', lugar_nombre: 'Hospital Vargas', cantidad_necesaria: 4, cupos_faltantes: 3,
    });
    expect(data.traslados).toEqual([expect.objectContaining({
      insumo: 'AGUA POTÁBLE',
      origen: 'Hospital Vargas',
      destino: 'Centro Chacao',
      destino_tipo: 'Centro',
      urgencia: 'Normal',
    })]);
    expect(cacheMocks.guardarSnapshot).toHaveBeenCalledWith('all', data);
  });

  it('filtra las vacantes abiertas', async () => {
    await servicio.getAll();

    expect(firestoreMocks.where).toHaveBeenCalledWith('estado', '==', 'Abierta');
  });

  it('devuelve el snapshot con source offline-cache cuando la lectura falla', async () => {
    firestoreMocks.getDocs.mockRejectedValue(new Error('sin red'));
    cacheMocks.leerSnapshot.mockResolvedValue({ lugares: [{ nombre: 'guardado' }] });

    const resultado = await servicio.getAll();

    expect(resultado.source).toBe('offline-cache');
    expect(resultado.data).toEqual({ lugares: [{ nombre: 'guardado' }] });
    expect(resultado.error).toBeInstanceOf(Error);
  });

  it('devuelve el estado vacío con source error cuando no hay snapshot', async () => {
    firestoreMocks.getDocs.mockRejectedValue(new Error('sin red'));

    const resultado = await servicio.getAll();

    expect(resultado.source).toBe('error');
    expect(resultado.data.lugares).toEqual([]);
    expect(resultado.data.estadisticas).toEqual({});
  });

  it('sirve el snapshot sin tocar la red cuando el navegador está offline', async () => {
    globalThis.navigator.onLine = false;
    cacheMocks.leerSnapshot.mockResolvedValue({ lugares: [] });

    await expect(servicio.getAll()).resolves.toEqual({ data: { lugares: [] }, source: 'offline-cache' });
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
  });
});

describe('lecturas por entidad', () => {
  it('getRescatistas no toca la red y responde restricted', async () => {
    await expect(servicio.getRescatistas()).resolves.toEqual({ data: [], source: 'restricted' });
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
  });

  it('getTrayectos filtra por motorizadoId', async () => {
    responderPorColeccion({ trayectosPublicos: [[docFalso('trayectosPublicos', 't1', {
      origen: 'A', destino: 'B', kmRecorridos: 12.5, insumo: 'Agua', fecha: '2026-09-01T00:00:00.000Z',
    })]] });

    const { data } = await servicio.getTrayectos('m1');

    expect(firestoreMocks.where).toHaveBeenCalledWith('motorizadoId', '==', 'm1');
    expect(data[0]).toMatchObject({ km: 12.5, kmRecorridos: 12.5, timestamp: '2026-09-01T00:00:00.000Z' });
  });

  it('getHistorial busca por el nombre del lugar normalizado', async () => {
    await servicio.getHistorial('Centro Chacao');

    expect(firestoreMocks.where).toHaveBeenCalledWith('lugarId', '==', 'centro chacao');
  });

  it('getFamiliasPublicas expone los campos en snake_case', async () => {
    responderPorColeccion({ familiasPublicas: [[docFalso('familiasPublicas', 'f1', {
      codigo: 'FAM-1', municipio: 'Chacao', estadoGeo: 'Miranda', estado: 'nuevo',
      numPersonas: 4, numMenores: 2, perdioCasa: true, necesidadMedica: false,
    })]] });

    const { data } = await servicio.getFamiliasPublicas();

    expect(data[0]).toMatchObject({
      codigo: 'FAM-1', estado_geo: 'Miranda', num_personas: 4, num_menores: 2,
      perdio_casa: true, perdio_vehiculo: false, necesidad_medica: false,
    });
  });

  it('convierte los Timestamp de Firestore a ISO', async () => {
    const marca = { toDate: () => new Date('2026-09-05T12:00:00.000Z') };
    responderPorColeccion({ historialPublico: [[docFalso('historialPublico', 'h1', {
      tipo: 'entrada', insumo: 'Agua', cantidad: 3, unidad: 'litros', createdAt: marca,
    })]] });

    const { data } = await servicio.getHistorial('Centro Chacao');

    expect(data[0]).toMatchObject({ tipoMovimiento: 'entrada', timestamp: '2026-09-05T12:00:00.000Z' });
  });
});

describe('seguimiento por token', () => {
  it('lee facturasPublicas por id y normaliza el shape', async () => {
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      id: 'DV-AAAA-BBBB-CCCC',
      data: () => ({
        factura: { numero_factura: 'FAC-2026-000001', porcentaje: 40 },
        historial: [{ tipo: 'donacion', monto: 10 }],
        evidencias: [],
        donacionesPublicas: [{ monto_usd: 3 }],
      }),
    });

    const { data, source } = await servicio.getSeguimiento('DV-AAAA-BBBB-CCCC');

    expect(firestoreMocks.doc).toHaveBeenCalledWith(expect.anything(), 'facturasPublicas/DV-AAAA-BBBB-CCCC');
    expect(source).toBe('live');
    expect(data.factura.numero_factura).toBe('FAC-2026-000001');
    expect(data.movimientos).toEqual([{ tipo: 'donacion', monto: 10 }]);
    expect(data.evidencias).toEqual([]);
  });

  it('responde error cuando el token no existe', async () => {
    const resultado = await servicio.getSeguimiento('DV-0000-0000-0000');

    expect(resultado).toMatchObject({ data: null, source: 'error' });
    expect(resultado.error.message).toBe('Factura no encontrada');
  });

  it('getDesgloseDonaciones devuelve el array crudo del mismo documento', async () => {
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      id: 'DV-AAAA-BBBB-CCCC',
      data: () => ({ donacionesPublicas: [{ monto_usd: 3, monto: 110, creado: '2026-09-01' }] }),
    });

    await expect(servicio.getDesgloseDonaciones('DV-AAAA-BBBB-CCCC'))
      .resolves.toEqual([{ monto_usd: 3, monto: 110, creado: '2026-09-01' }]);
  });

  it('getDesgloseDonaciones devuelve [] si no hay factura', async () => {
    await expect(servicio.getDesgloseDonaciones('DV-0000-0000-0000')).resolves.toEqual([]);
  });
});

describe('post y sesión', () => {
  it('adjunta el ID token vigente en cada escritura', async () => {
    authMocks.getIdToken.mockResolvedValue('id-token-1');

    await servicio.post({ accion: 'donar_dinero', monto: 5 });

    expect(clienteMocks.post).toHaveBeenCalledWith(
      { accion: 'donar_dinero', monto: 5 },
      { idToken: 'id-token-1' },
    );
  });

  it('pasa por la cola offline', async () => {
    await servicio.post({ accion: 'donar_dinero' });

    expect(cacheMocks.enviarConCola).toHaveBeenCalledWith({ accion: 'donar_dinero' }, expect.any(Function));
  });

  it('getFamiliares usa la acción buscar_familiar y exige envelope live', async () => {
    clienteMocks.post.mockResolvedValue({ success: true, personas: [{ nombre: 'Ana' }] });

    await expect(servicio.getFamiliares('ana')).resolves.toEqual({
      data: [{ nombre: 'Ana' }],
      source: 'live',
    });
    expect(clienteMocks.post).toHaveBeenCalledWith({ accion: 'buscar_familiar', q: 'ana' }, { idToken: null });
  });

  it('sintetiza la sesión de GoTrue desde el usuario de Firebase', async () => {
    authMocks.signIn.mockResolvedValue({
      email: 'persona@correo.com',
      refreshToken: 'refresh-1',
      getIdTokenResult: async () => ({ token: 'jwt-1', expirationTime: '2026-09-06T12:00:00.000Z' }),
    });

    await expect(servicio.iniciarSesion('persona@correo.com', 'contrasena')).resolves.toEqual({
      access_token: 'jwt-1',
      refresh_token: 'refresh-1',
      expires_at: Math.floor(Date.parse('2026-09-06T12:00:00.000Z') / 1000),
      user: { email: 'persona@correo.com' },
    });
  });

  it('refrescarSesion fuerza un token nuevo', async () => {
    const getIdToken = vi.fn(async () => 'jwt-2');
    authMocks.getCurrentUser.mockResolvedValue({
      email: 'persona@correo.com',
      refreshToken: 'refresh-1',
      getIdToken,
      getIdTokenResult: async () => ({ token: 'jwt-2', expirationTime: '2026-09-06T13:00:00.000Z' }),
    });

    const sesion = await servicio.refrescarSesion('ignorado');

    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(sesion.access_token).toBe('jwt-2');
  });

  it('cerrarSesion sale de Firebase y vacía la cola', async () => {
    await servicio.cerrarSesion();

    expect(authMocks.signOut).toHaveBeenCalled();
    expect(cacheMocks.clearOfflineQueue).toHaveBeenCalled();
  });

  it('configure acepta cualquier objeto sin lanzar', () => {
    expect(() => servicio.configure({ loQueSea: true })).not.toThrow();
    expect(() => servicio.configure()).not.toThrow();
  });
});

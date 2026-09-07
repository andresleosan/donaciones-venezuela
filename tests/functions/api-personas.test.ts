import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';
// Importar el dominio es lo que registra sus acciones (mismo motivo que en
// `api-lugares.test.ts`: `vi.resetModules()` le daria otra copia del registro).
import * as personas from '../../functions/src/api/personas.js';

type Documento = Record<string, unknown>;

// Firestore falso con lo que necesita este dominio: transacción diferida,
// `merge`, `FieldValue.increment` aplicado al confirmar, `doc().get()` y
// consultas con `where`/`orderBy`/`limit`. Rechaza leer después de escribir,
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

  type Filtro = [string, string, unknown];

  function ordenable(valor: unknown): number | string {
    if (valor instanceof Date) return valor.getTime();
    if (typeof valor === 'number') return valor;
    return String(valor ?? '');
  }

  function cumple(datos: Documento, [campo, operador, valor]: Filtro): boolean {
    const actual = datos[campo];
    if (operador === '==') return actual === valor;
    if (operador === '>=') return ordenable(actual) >= ordenable(valor);
    if (operador === '<=') return ordenable(actual) <= ordenable(valor);
    throw new Error(`operador no soportado: ${operador}`);
  }

  function consulta(
    ruta: string,
    filtros: Filtro[],
    orden: { campo: string; direccion: 'asc' | 'desc' } | null,
    tope: number,
  ): Documento {
    return {
      path: ruta,
      doc: (id?: string) => referencia(`${ruta}/${id ?? `auto-${Object.keys(documentos).length + 1}`}`),
      where: (campo: string, operador: string, valor: unknown) => (
        consulta(ruta, [...filtros, [campo, operador, valor]], orden, tope)
      ),
      orderBy: (campo: string, direccion: 'asc' | 'desc' = 'asc') => (
        consulta(ruta, filtros, { campo, direccion }, tope)
      ),
      limit: (cantidad: number) => consulta(ruta, filtros, orden, cantidad),
      get: async () => {
        let filas = hijosDe(ruta).filter((fila) => filtros.every((filtro) => cumple(fila.data(), filtro)));
        if (orden) {
          const { campo, direccion } = orden;
          filas = [...filas].sort((a, b) => {
            const x = ordenable(a.data()[campo]);
            const y = ordenable(b.data()[campo]);
            const signo = x < y ? -1 : x > y ? 1 : 0;
            return direccion === 'desc' ? -signo : signo;
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
      get: async () => ({ exists: documentos[ruta] !== undefined, data: () => documentos[ruta] }),
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
        async get(ref: { path: string }) {
          if (huboEscritura) throw new Error('lectura despues de escritura');
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

const AHORA = new Date('2026-09-06T12:00:00.000Z');

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    uid: 'uid-persona',
    role: 'user',
    panelLugarId: null,
    ip: '203.0.113.7',
    now: AHORA,
    db: db as ActionContext['db'],
    ...extra,
  } as ActionContext;
}

const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin' });
const ANON = (db: unknown) => contexto(db, { uid: null, role: 'anon' });

async function ejecutar(nombre: string, ctx: ActionContext, payload: Record<string, unknown> = {}) {
  const definicion = getAction(nombre);
  if (!definicion) throw new Error(`accion no registrada: ${nombre}`);
  return definicion.handler(ctx, payload);
}

function rutas(documentos: Record<string, Documento>, prefijo: string): string[] {
  return Object.keys(documentos).filter((ruta) => ruta.startsWith(prefijo));
}

function unico(documentos: Record<string, Documento>, prefijo: RegExp): [string, Documento] {
  const encontrados = Object.entries(documentos).filter(([ruta]) => prefijo.test(ruta));
  expect(encontrados).toHaveLength(1);
  return encontrados[0]!;
}

const AUTH_FALSO = {
  getUser: vi.fn(async (uid: string) => ({ uid, email: 'persona@ejemplo.com' })),
};

const FOTO_VOL = 'private/uid-persona/volunteers/cedula.jpg';
const FOTOS_MOT = {
  fotoPlacaPath: 'private/uid-persona/drivers/placa.jpg',
  fotoVehiculoPath: 'private/uid-persona/drivers/vehiculo.jpg',
  fotoCedulaPath: 'private/uid-persona/drivers/cedula.jpg',
};

const VOLUNTARIO_OK = {
  nombre: 'Ana', apellido: 'Pérez', email: 'ana@ejemplo.com', telefono: '0412-1234567',
  fotoCedulaPath: FOTO_VOL,
};
const MOTORIZADO_OK = {
  nombre: 'Luis', email: 'luis@ejemplo.com', telefono: '04141234567',
  tipoVehiculo: 'Moto', zonaOperacion: 'Catia', placa: 'AB123CD', ...FOTOS_MOT,
};

beforeEach(() => {
  // `mockReset`, no `mockClear`: `mockClear` deja en pie la cola de
  // `mockResolvedValueOnce`, y un valor encolado y no consumido se filtraba al
  // caso siguiente.
  AUTH_FALSO.getUser.mockReset();
  AUTH_FALSO.getUser.mockImplementation(async (uid: string) => ({ uid, email: 'persona@ejemplo.com' }));
  personas.usarAuthPersonas(AUTH_FALSO);
});

afterEach(() => {
  personas.usarAuthPersonas(null);
  vi.restoreAllMocks();
});

// --- Helpers puros ------------------------------------------------------------

describe('helpers del dominio', () => {
  it('codifica y lee el valor del índice de correos', () => {
    expect(personas.valorCuenta('voluntario', 'VOL-AAAA1111')).toBe('voluntario:VOL-AAAA1111');
    expect(personas.leerValorCuenta('transportista:MOT-1')).toEqual({ tipo: 'transportista', id: 'MOT-1' });
  });

  it('rechaza un valor de índice con tipo desconocido o sin id', () => {
    expect(personas.leerValorCuenta('centro:LUG-1')).toBeNull();
    expect(personas.leerValorCuenta('voluntario:')).toBeNull();
    expect(personas.leerValorCuenta('VOL-1')).toBeNull();
  });

  // El legado contaba `estado ilike 'localiz%' or estado ilike 'hospital%'`.
  it('reconoce los estados que cuentan como persona localizada', () => {
    expect(personas.personaLocalizada('Localizado con vida')).toBe(true);
    expect(personas.personaLocalizada('Hospitalizado')).toBe(true);
    expect(personas.personaLocalizada('Fallecido')).toBe(false);
    expect(personas.personaLocalizada('')).toBe(false);
  });

  it('la tarjeta pública de un transportista no lleva teléfono ni placa', () => {
    const publico = personas.documentoPublicoMotorizado({
      nombre: 'Luis', tipoVehiculo: 'Moto', zonaOperacion: 'Catia',
      telefono: '04141234567', activo: true, createdAt: AHORA,
    });
    expect(publico).toEqual({
      nombre: 'Luis', zona: 'Catia', tipoVehiculo: 'Moto', activo: true,
      tieneContacto: true, createdAt: AHORA,
    });
    expect(Object.keys(publico)).not.toContain('telefono');
    expect(Object.keys(publico)).not.toContain('placa');
  });

  it('marca `tieneContacto` en falso si el teléfono no tiene 7 dígitos', () => {
    const publico = personas.documentoPublicoMotorizado({
      nombre: 'Luis', tipoVehiculo: 'Moto', zonaOperacion: '', telefono: '0412',
      activo: true, createdAt: AHORA,
    });
    expect(publico.tieneContacto).toBe(false);
  });
});

// --- registrar_voluntario -----------------------------------------------------

describe('registrar_voluntario', () => {
  it('exige el nombre', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, nombre: ' ' }))
      .rejects.toThrow(new ApiError('nombre requerido'));
  });

  it('exige un correo válido', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, email: 'ana@' }))
      .rejects.toThrow(new ApiError('correo electrónico válido requerido'));
  });

  it('exige un teléfono con al menos 7 dígitos', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, telefono: '04-12' }))
      .rejects.toThrow(new ApiError('teléfono requerido'));
  });

  it('exige la foto de la cédula', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, fotoCedulaPath: '' }))
      .rejects.toThrow(new ApiError('Falta la foto de la cédula'));
  });

  // Sin esto, alguien podría adjuntar a su ficha el archivo privado de otra
  // persona con solo conocer su uid.
  it('rechaza una foto que no está bajo el `private/<uid propio>/volunteers/`', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_voluntario', contexto(db), {
      ...VOLUNTARIO_OK, fotoCedulaPath: 'private/uid-ajeno/volunteers/cedula.jpg',
    })).rejects.toThrow(new ApiError('Falta la foto de la cédula'));

    await expect(ejecutar('registrar_voluntario', contexto(db), {
      ...VOLUNTARIO_OK, fotoCedulaPath: 'private/uid-persona/receipts/cedula.jpg',
    })).rejects.toThrow(new ApiError('Falta la foto de la cédula'));
  });

  it('crea el documento, reserva el correo y suma el contador', async () => {
    const { db, documentos } = crearDb();

    const salida = await ejecutar('registrar_voluntario', contexto(db), {
      ...VOLUNTARIO_OK, ciudad: 'Caracas', estado: 'Distrito Capital',
      profesion: 'Enfermería', disponibilidad: 'Fines de semana',
      medio_transporte: 'Moto', observaciones: 'Turno nocturno',
    });

    const [ruta, voluntario] = unico(documentos, /^voluntarios\/VOL-/);
    expect(String(salida.id)).toBe(ruta.split('/')[1]);
    expect(voluntario).toMatchObject({
      nombre: 'Ana',
      apellido: 'Pérez',
      emailNorm: 'ana@ejemplo.com',
      telefono: '0412-1234567',
      ciudad: 'Caracas',
      profesion: 'Enfermería',
      // Alias snake_case del formulario legado.
      medioTransporte: 'Moto',
      fotoCedulaPath: FOTO_VOL,
      authUid: 'uid-persona',
      activo: true,
      createdAt: AHORA,
    });
    expect(documentos['indices/cuentasPorEmail/claves/ana@ejemplo.com'])
      .toMatchObject({ valor: `voluntario:${salida.id}` });
    expect(documentos['estadisticas/global']).toMatchObject({ voluntariosActivos: 1 });
  });

  // El perfil público de un voluntario solo existe con consentimiento v1.
  it('no publica ninguna proyección al registrarse', async () => {
    const { db, documentos } = crearDb();
    await ejecutar('registrar_voluntario', contexto(db), VOLUNTARIO_OK);
    expect(rutas(documentos, 'voluntariosPublicos/')).toHaveLength(0);
  });

  it('rechaza un correo ya registrado', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_voluntario', contexto(db), VOLUNTARIO_OK);

    await expect(ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, nombre: 'Otra' }))
      .rejects.toThrow(new ApiError('Ese correo ya está registrado. Entra con tu cuenta.', 409));
  });
});

// --- registrar_rescatista -----------------------------------------------------

describe('registrar_rescatista', () => {
  it('exige el nombre', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_rescatista', ANON(db), { nombre: '' }))
      .rejects.toThrow(new ApiError('nombre requerido'));
  });

  it('guarda la ficha con los alias snake_case del formulario', async () => {
    const { db, documentos } = crearDb();

    await ejecutar('registrar_rescatista', ANON(db), {
      nombre: 'Brigada Ávila', organizacion: 'Cruz Roja', telefono: '02121234567',
      especialidad: 'Rescate en altura', equipo_disponible: 'Cuerdas, arnés',
      capacidad_operativa: '6 personas',
    });

    const [, rescatista] = unico(documentos, /^rescatistas\/RES-/);
    expect(rescatista).toMatchObject({
      nombre: 'Brigada Ávila',
      organizacion: 'Cruz Roja',
      telefono: '02121234567',
      especialidad: 'Rescate en altura',
      equipoDisponible: 'Cuerdas, arnés',
      capacidadOperativa: '6 personas',
      activo: true,
      createdAt: AHORA,
    });
  });

  // Su ficha lleva teléfono, capacidad y equipo, y `filtrarLista` de la UI busca
  // sobre `Object.values(fila)`: publicarla sería publicarlo todo.
  it('nunca publica una proyección de rescatistas', async () => {
    const { db, documentos } = crearDb();
    await ejecutar('registrar_rescatista', ANON(db), { nombre: 'Brigada Ávila' });
    expect(rutas(documentos, 'rescatistasPublicos/')).toHaveLength(0);
    expect(documentos['estadisticas/global']).toBeUndefined();
  });
});

// --- registrar_motorizado -----------------------------------------------------

describe('registrar_motorizado', () => {
  it('exige nombre, correo y teléfono en ese orden', async () => {
    const { db } = crearDb();
    await expect(ejecutar('registrar_motorizado', contexto(db), { ...MOTORIZADO_OK, nombre: '' }))
      .rejects.toThrow(new ApiError('nombre requerido'));
    await expect(ejecutar('registrar_motorizado', contexto(db), { ...MOTORIZADO_OK, email: 'x' }))
      .rejects.toThrow(new ApiError('correo electrónico válido requerido'));
    await expect(ejecutar('registrar_motorizado', contexto(db), { ...MOTORIZADO_OK, telefono: '12' }))
      .rejects.toThrow(new ApiError('teléfono requerido'));
  });

  it('exige las tres fotos con un solo mensaje', async () => {
    const { db } = crearDb();
    for (const campo of ['fotoPlacaPath', 'fotoVehiculoPath', 'fotoCedulaPath']) {
      await expect(ejecutar('registrar_motorizado', contexto(db), { ...MOTORIZADO_OK, [campo]: '' }))
        .rejects.toThrow(new ApiError('Faltan fotos: placa, vehículo y cédula son obligatorias'));
    }
  });

  it('crea el documento, publica sin teléfono ni placa y suma el contador', async () => {
    const { db, documentos } = crearDb();

    const salida = await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);
    const id = String(salida.id);

    expect(documentos[`motorizados/${id}`]).toMatchObject({
      nombre: 'Luis',
      emailNorm: 'luis@ejemplo.com',
      telefono: '04141234567',
      placa: 'AB123CD',
      zonaOperacion: 'Catia',
      authUid: 'uid-persona',
      activo: true,
    });

    const publico = documentos[`motorizadosPublicos/${id}`]!;
    expect(publico).toMatchObject({
      nombre: 'Luis', zona: 'Catia', tipoVehiculo: 'Moto', activo: true, tieneContacto: true,
    });
    expect(Object.keys(publico)).not.toContain('telefono');
    expect(Object.keys(publico)).not.toContain('placa');
    expect(documentos['estadisticas/global']).toMatchObject({ motorizadosRegistrados: 1 });
  });

  it('acepta el alias `operaEn` y cae a `Moto` sin tipo de vehículo', async () => {
    const { db, documentos } = crearDb();
    const salida = await ejecutar('registrar_motorizado', contexto(db), {
      ...MOTORIZADO_OK, tipoVehiculo: undefined, zonaOperacion: undefined, operaEn: 'Petare',
    });
    expect(documentos[`motorizados/${salida.id}`]).toMatchObject({
      tipoVehiculo: 'Moto', zonaOperacion: 'Petare',
    });
  });

  // Un correo, una cuenta: el índice es compartido por los dos tipos.
  it('rechaza un correo que ya usa un voluntario', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_voluntario', contexto(db), { ...VOLUNTARIO_OK, email: 'luis@ejemplo.com' });

    await expect(ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK))
      .rejects.toThrow(new ApiError('Ese correo ya está registrado. Entra con tu cuenta.', 409));
  });
});

// --- reportar_persona ---------------------------------------------------------

describe('reportar_persona', () => {
  it('exige el nombre', async () => {
    const { db } = crearDb();
    await expect(ejecutar('reportar_persona', ANON(db), { nombre: '' }))
      .rejects.toThrow(new ApiError('nombre requerido'));
  });

  it('guarda el reporte sin verificar y con las claves de búsqueda', async () => {
    const { db, documentos } = crearDb();

    await ejecutar('reportar_persona', ANON(db), {
      nombre: 'José Ramírez', cedula: 'V-12.345.678', estadoSalud: 'Sin información reciente',
      ubicacion: 'Última vez: Catia', contacto: '04121112233', fuente: 'Reporte familiar',
      reportado_por: 'Hermana',
    });

    const [, persona] = unico(documentos, /^personas\/PER-/);
    expect(persona).toMatchObject({
      nombre: 'José Ramírez',
      // Sin acentos ni mayúsculas: es la clave del prefijo de `buscar_familiar`.
      nombreNorm: 'jose ramirez',
      cedula: 'V-12.345.678',
      cedulaNorm: '12345678',
      estado: 'Sin información reciente',
      ubicacion: 'Última vez: Catia',
      reportadoPor: 'Hermana',
      verificada: false,
    });
    expect(documentos['estadisticas/global']).toMatchObject({ personasReportadas: 1 });
    expect(documentos['estadisticas/global']!.personasLocalizadas).toBeUndefined();
  });

  it('suma también `personasLocalizadas` cuando el estado lo dice', async () => {
    const { db, documentos } = crearDb();
    await ejecutar('reportar_persona', ANON(db), { nombre: 'Ana', estado: 'Hospitalizado' });
    expect(documentos['estadisticas/global']).toMatchObject({
      personasReportadas: 1, personasLocalizadas: 1,
    });
  });

  it('no publica ninguna proyección: el registro solo se consulta con sesión', async () => {
    const { db, documentos } = crearDb();
    await ejecutar('reportar_persona', ANON(db), { nombre: 'Ana' });
    expect(rutas(documentos, 'personasPublicas/')).toHaveLength(0);
  });
});

// --- buscar_familiar ----------------------------------------------------------

function baseConPersonas() {
  return crearDb({
    'personas/PER-1': {
      nombre: 'José Ramírez', nombreNorm: 'jose ramirez', cedula: 'V-12.345.678',
      cedulaNorm: '12345678', estado: 'Hospitalizado', ubicacion: 'Última vez: Catia',
      contacto: '04121112233', fuente: 'Registro hospitalario', reportadoPor: 'Hermana',
      verificada: true, createdAt: new Date('2026-09-01T00:00:00.000Z'),
      actualizado: new Date('2026-09-01T00:00:00.000Z'),
    },
    'personas/PER-2': {
      nombre: 'José Antonio Rivas', nombreNorm: 'jose antonio rivas', cedula: '',
      cedulaNorm: '', estado: 'Sin información reciente', ubicacion: '', contacto: '',
      fuente: '', reportadoPor: '', verificada: false,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
      actualizado: new Date('2026-09-04T00:00:00.000Z'),
    },
    'personas/PER-3': {
      nombre: 'Marta Suárez', nombreNorm: 'marta suarez', cedula: '', cedulaNorm: '',
      estado: 'Localizado con vida', ubicacion: '', contacto: '', fuente: '',
      reportadoPor: '', verificada: true,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      actualizado: new Date('2026-09-05T00:00:00.000Z'),
    },
  });
}

describe('buscar_familiar', () => {
  it('exige al menos 4 caracteres', async () => {
    const { db } = baseConPersonas();
    for (const q of ['', 'jos', '  ana  '.slice(0, 5)]) {
      await expect(ejecutar('buscar_familiar', contexto(db), { q }))
        .rejects.toThrow(new ApiError('escribe al menos 4 caracteres'));
    }
  });

  it('busca por prefijo del nombre normalizado, sin acentos', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: 'José' });
    const nombres = (salida.personas as Array<{ nombre: string }>).map((p) => p.nombre);
    expect(nombres).toEqual(['José Antonio Rivas', 'José Ramírez']);
  });

  // La ordenación por recencia se hace en memoria: con un filtro de rango,
  // Firestore obliga a ordenar primero por el campo del rango.
  it('devuelve primero lo más reciente', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: 'jose' });
    const fechas = (salida.personas as Array<{ actualizado: string }>).map((p) => p.actualizado);
    expect(fechas).toEqual([
      '2026-09-04T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    ]);
  });

  // El registro de personas buscadas es el dato más sensible del sistema y esta
  // acción es su única salida.
  it('devuelve solo cinco campos: nunca cédula, ubicación, contacto ni fuente', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: 'Marta' });
    const [persona] = salida.personas as Array<Record<string, unknown>>;

    expect(Object.keys(persona!).sort()).toEqual(
      ['actualizado', 'cedulaCoincide', 'estado', 'nombre', 'verificada'],
    );
    expect(persona).toMatchObject({
      nombre: 'Marta Suárez', estado: 'Localizado con vida', verificada: true,
      cedulaCoincide: false,
    });
  });

  it('marca `verificada: false` sin ocultar el reporte', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: 'jose antonio' });
    expect(salida.personas).toEqual([
      expect.objectContaining({ nombre: 'José Antonio Rivas', verificada: false }),
    ]);
  });

  it('encuentra por cédula exacta y lo señala con `cedulaCoincide`', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: '12345678' });

    expect(salida.personas).toEqual([
      expect.objectContaining({ nombre: 'José Ramírez', cedulaCoincide: true }),
    ]);
  });

  it('no encuentra por una cédula parcial: la comparación es de igualdad', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('buscar_familiar', contexto(db), { q: '1234567' });
    expect(salida.personas).toEqual([]);
  });

  it('corta en 25 resultados', async () => {
    const inicial: Record<string, Documento> = {};
    for (let i = 0; i < 40; i += 1) {
      inicial[`personas/PER-${String(i).padStart(3, '0')}`] = {
        nombre: `Ramírez ${i}`, nombreNorm: `ramirez ${String(i).padStart(3, '0')}`,
        cedula: '', cedulaNorm: '', estado: '', verificada: false,
        createdAt: new Date(2026, 0, 1 + i), actualizado: new Date(2026, 0, 1 + i),
      };
    }
    const { db } = crearDb(inicial);

    const salida = await ejecutar('buscar_familiar', contexto(db), { q: 'ramirez' });
    expect((salida.personas as unknown[]).length).toBe(25);
  });
});

// --- acceso_perfil ------------------------------------------------------------

describe('acceso_perfil', () => {
  it('devuelve el rol de voluntario con nombre y apellido', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_voluntario', contexto(db), VOLUNTARIO_OK);

    // Admin Auth devuelve el correo tal cual lo escribio la persona; el indice
    // se consulta normalizado.
    AUTH_FALSO.getUser.mockResolvedValueOnce({ uid: 'uid-persona', email: 'Ana@Ejemplo.com' });
    await expect(ejecutar('acceso_perfil', contexto(db))).resolves.toEqual({
      email: 'ana@ejemplo.com',
      roles: [{ tipo: 'voluntario', nombre: 'Ana Pérez' }],
    });
  });

  it('devuelve el rol de transportista', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);

    AUTH_FALSO.getUser.mockResolvedValueOnce({ uid: 'uid-persona', email: 'luis@ejemplo.com' });
    await expect(ejecutar('acceso_perfil', contexto(db))).resolves.toEqual({
      email: 'luis@ejemplo.com',
      roles: [{ tipo: 'transportista', nombre: 'Luis' }],
    });
  });

  // El centro no pasa por el índice de correos: es el claim `panelLugarId`, que
  // es lo que de verdad da acceso al panel.
  it('añade el rol de centro desde el claim, no desde el correo', async () => {
    const { db } = crearDb({ 'lugares/LUG-AAAA1111': { nombre: 'Centro Chacao' } });
    AUTH_FALSO.getUser.mockResolvedValueOnce({ uid: 'uid-persona', email: 'panel@ejemplo.com' });

    const ctx = contexto(db, { role: 'panel', panelLugarId: 'LUG-AAAA1111' });
    await expect(ejecutar('acceso_perfil', ctx)).resolves.toEqual({
      email: 'panel@ejemplo.com',
      roles: [{ tipo: 'centro', nombre: 'Centro Chacao' }],
    });
  });

  it('un donante sin roles no se rechaza', async () => {
    const { db } = crearDb();
    AUTH_FALSO.getUser.mockResolvedValueOnce({ uid: 'uid-persona', email: 'donante@ejemplo.com' });

    await expect(ejecutar('acceso_perfil', contexto(db)))
      .resolves.toEqual({ email: 'donante@ejemplo.com', roles: [] });
  });

  it('no falla si Admin Auth no devuelve correo', async () => {
    const { db } = crearDb();
    AUTH_FALSO.getUser.mockRejectedValueOnce(new Error('auth/user-not-found'));

    await expect(ejecutar('acceso_perfil', contexto(db)))
      .resolves.toEqual({ email: '', roles: [] });
  });

  // El `accessToken` que sigue enviando `js/admin.js:1593` no puede decidir de
  // quién son los roles: eso lo fija el token ya verificado por el despachador.
  it('ignora el `accessToken` del cuerpo', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);
    AUTH_FALSO.getUser.mockResolvedValueOnce({ uid: 'uid-persona', email: 'otro@ejemplo.com' });

    const salida = await ejecutar('acceso_perfil', contexto(db), { accessToken: 'jwt-de-otra-persona' });
    expect(salida).toEqual({ email: 'otro@ejemplo.com', roles: [] });
    expect(AUTH_FALSO.getUser).toHaveBeenLastCalledWith('uid-persona');
  });
});

// --- contactar_motorizado -----------------------------------------------------

describe('contactar_motorizado', () => {
  it('exige el id', async () => {
    const { db } = crearDb();
    await expect(ejecutar('contactar_motorizado', contexto(db), {}))
      .rejects.toThrow(new ApiError('id requerido'));
  });

  it('entrega el teléfono de uno en uno', async () => {
    const { db } = crearDb();
    const { id } = await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);

    await expect(ejecutar('contactar_motorizado', contexto(db), { id })).resolves.toEqual({
      id, nombre: 'Luis', telefono: '04141234567',
    });
  });

  it('acepta el alias `idMotorizado` de la UI', async () => {
    const { db } = crearDb();
    const { id } = await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);
    const salida = await ejecutar('contactar_motorizado', contexto(db), { idMotorizado: id });
    expect(salida.telefono).toBe('04141234567');
  });

  it('responde 404 para un id inexistente', async () => {
    const { db } = crearDb();
    await expect(ejecutar('contactar_motorizado', contexto(db), { id: 'MOT-NOEXISTE' }))
      .rejects.toThrow(new ApiError('Transportista no encontrado', 404));
  });

  // Una baja no se distingue de un id inventado: la respuesta no filtra que
  // esa persona existió.
  it('responde 404 para un transportista dado de baja', async () => {
    const { db, documentos } = crearDb();
    const { id } = await ejecutar('registrar_motorizado', contexto(db), MOTORIZADO_OK);
    documentos[`motorizados/${id}`]!.activo = false;

    await expect(ejecutar('contactar_motorizado', contexto(db), { id }))
      .rejects.toThrow(new ApiError('Transportista no encontrado', 404));
  });
});

// --- voluntario_consentimiento ------------------------------------------------

describe('voluntario_consentimiento', () => {
  async function conVoluntario() {
    const base = crearDb();
    const { id } = await ejecutar('registrar_voluntario', contexto(base.db), {
      ...VOLUNTARIO_OK, ciudad: 'Caracas',
    });
    return { ...base, id: String(id) };
  }

  it('publica el perfil reducido cuando la persona consiente', async () => {
    const { db, documentos, id } = await conVoluntario();

    await expect(ejecutar('voluntario_consentimiento', contexto(db), {
      volunteerId: id, enabled: true, consentVersion: 'volunteer-public-v1',
    })).resolves.toEqual({ volunteerId: id, enabled: true });

    const publico = documentos[`voluntariosPublicos/${id}`]!;
    expect(publico).toMatchObject({ nombre: 'Ana', activo: true });
    // Ni correo, ni teléfono, ni la foto de la cédula.
    for (const prohibido of ['email', 'emailNorm', 'telefono', 'fotoCedulaPath', 'apellido']) {
      expect(Object.keys(publico)).not.toContain(prohibido);
    }
    expect(documentos[`voluntarios/${id}`]).toMatchObject({
      publicProfileConsent: expect.objectContaining({ enabled: true, version: 'volunteer-public-v1' }),
    });
  });

  it('retira la proyección al revocar', async () => {
    const { db, documentos, id } = await conVoluntario();
    const payload = { volunteerId: id, consentVersion: 'volunteer-public-v1' };

    await ejecutar('voluntario_consentimiento', contexto(db), { ...payload, enabled: true });
    await ejecutar('voluntario_consentimiento', contexto(db), { ...payload, enabled: false });

    expect(documentos[`voluntariosPublicos/${id}`]).toBeUndefined();
    expect(documentos[`voluntarios/${id}`]).toMatchObject({
      publicProfileConsent: expect.objectContaining({ enabled: false }),
    });
  });

  it('no deja que otra cuenta publique un perfil ajeno', async () => {
    const { db, id } = await conVoluntario();
    const ajeno = contexto(db, { uid: 'uid-ajeno' });

    await expect(ejecutar('voluntario_consentimiento', ajeno, {
      volunteerId: id, enabled: true, consentVersion: 'volunteer-public-v1',
    })).rejects.toThrow(new ApiError('No tienes permiso para esta accion', 403));
  });

  it('rechaza una versión de consentimiento distinta', async () => {
    const { db, id } = await conVoluntario();

    await expect(ejecutar('voluntario_consentimiento', contexto(db), {
      volunteerId: id, enabled: true, consentVersion: 'volunteer-public-v0',
    })).rejects.toThrow(new ApiError('versión de consentimiento no válida'));
  });

  it('responde 404 si el voluntario no existe', async () => {
    const { db } = crearDb();
    await expect(ejecutar('voluntario_consentimiento', contexto(db), {
      volunteerId: 'VOL-NOEXISTE', enabled: true, consentVersion: 'volunteer-public-v1',
    })).rejects.toThrow(new ApiError('Voluntario no encontrado', 404));
  });
});

// --- listados del admin -------------------------------------------------------

describe('listados del admin', () => {
  it('admin_listar_voluntarios usa las claves snake_case que lee la consola', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_voluntario', contexto(db), {
      ...VOLUNTARIO_OK, ciudad: 'Caracas', estado: 'Miranda', profesion: 'Enfermería',
      disponibilidad: 'Fines de semana', medioTransporte: 'Moto',
    });

    const salida = await ejecutar('admin_listar_voluntarios', ADMIN(db));
    expect(salida.voluntarios).toEqual([expect.objectContaining({
      nombre: 'Ana',
      apellido: 'Pérez',
      email: 'ana@ejemplo.com',
      telefono: '0412-1234567',
      ciudad: 'Caracas',
      profesion: 'Enfermería',
      medio_transporte: 'Moto',
      fecha_registro: '2026-09-06T12:00:00.000Z',
    })]);
  });

  it('admin_listar_rescatistas incluye el teléfono y el equipo', async () => {
    const { db } = crearDb();
    await ejecutar('registrar_rescatista', ANON(db), {
      nombre: 'Brigada Ávila', telefono: '02121234567',
      equipo_disponible: 'Cuerdas', capacidad_operativa: '6 personas',
    });

    const salida = await ejecutar('admin_listar_rescatistas', ADMIN(db));
    expect(salida.rescatistas).toEqual([expect.objectContaining({
      nombre: 'Brigada Ávila',
      telefono: '02121234567',
      equipo_disponible: 'Cuerdas',
      capacidad_operativa: '6 personas',
      fecha_registro: '2026-09-06T12:00:00.000Z',
    })]);
  });

  it('admin_listar_personas es la cola de moderación: solo las no verificadas', async () => {
    const { db } = baseConPersonas();

    const salida = await ejecutar('admin_listar_personas', ADMIN(db));
    expect(salida.personas).toEqual([expect.objectContaining({
      id: 'PER-2', nombre: 'José Antonio Rivas', fecha: '2026-09-04T00:00:00.000Z',
    })]);
  });

  it('admin_listar_personas no devuelve quién reportó', async () => {
    const { db } = baseConPersonas();
    const salida = await ejecutar('admin_listar_personas', ADMIN(db));
    const [persona] = salida.personas as Array<Record<string, unknown>>;
    expect(Object.keys(persona!)).not.toContain('reportadoPor');
    expect(Object.keys(persona!)).not.toContain('reportado_por');
  });
});

// --- admin_verificar_persona --------------------------------------------------

describe('admin_verificar_persona', () => {
  it('exige el id', async () => {
    const { db } = baseConPersonas();
    await expect(ejecutar('admin_verificar_persona', ADMIN(db), { id: ' ' }))
      .rejects.toThrow(new ApiError('id requerido'));
  });

  // El legado hacía `update … where id` y 0 filas no era un error, así que un id
  // inventado pasaba en silencio. Aquí un `set` crearía una persona fantasma.
  it('responde 404 en vez de crear una persona fantasma', async () => {
    const { db, documentos } = baseConPersonas();

    await expect(ejecutar('admin_verificar_persona', ADMIN(db), { id: 'PER-NOEXISTE' }))
      .rejects.toThrow(new ApiError('Persona no encontrada', 404));
    expect(documentos['personas/PER-NOEXISTE']).toBeUndefined();
  });

  it('marca la persona, escribe la bitácora y audita', async () => {
    const { db, documentos } = baseConPersonas();

    await expect(ejecutar('admin_verificar_persona', ADMIN(db), { id: 'PER-2' })).resolves.toEqual({});

    expect(documentos['personas/PER-2']).toMatchObject({ verificada: true, actualizado: AHORA });
    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({
      lugar: 'Administración',
      descripcion: 'Persona PER-2 verificada',
      origen: 'admin',
      tipo: 'Administración',
    });
    const auditoria = Object.entries(documentos).find(([r]) => r.startsWith('auditoriaAdmin/'));
    expect(auditoria?.[1]).toMatchObject({
      accion: 'editar',
      entidad: 'personas',
      entidadId: 'PER-2',
      antes: { verificada: false },
      despues: { verificada: true },
      actorRol: 'admin',
    });
  });
});

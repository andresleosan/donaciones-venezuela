import { describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';
// Importar el dominio es lo que registra sus acciones.
import * as vacantes from '../../functions/src/api/vacantes.js';

type Documento = Record<string, unknown>;

// Mismo Firestore falso que `api-personas.test.ts`: transacción diferida,
// `merge`, `doc().get()` y consultas con `orderBy`/`limit`. Rechaza leer
// después de escribir, igual que Firestore.
function crearDb(inicial: Record<string, Documento> = {}) {
  const documentos: Record<string, Documento> = {};
  for (const [ruta, datos] of Object.entries(inicial)) documentos[ruta] = { ...datos };

  function aplicar(ruta: string, datos: Documento, merge: boolean) {
    const previo = merge ? { ...(documentos[ruta] ?? {}) } : {};
    for (const [clave, valor] of Object.entries(datos)) previo[clave] = valor;
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

  function consulta(
    ruta: string,
    orden: { campo: string; direccion: 'asc' | 'desc' } | null,
    tope: number,
  ): Documento {
    return {
      path: ruta,
      doc: (id?: string) => referencia(`${ruta}/${id ?? `auto-${Object.keys(documentos).length + 1}`}`),
      orderBy: (campo: string, direccion: 'asc' | 'desc' = 'asc') => consulta(ruta, { campo, direccion }, tope),
      limit: (cantidad: number) => consulta(ruta, orden, cantidad),
      get: async () => {
        let filas = hijosDe(ruta);
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
    };
  }

  function coleccion(ruta: string): Documento {
    return consulta(ruta, null, Number.MAX_SAFE_INTEGER);
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

const USUARIO = (db: unknown) => contexto(db, { uid: 'uid-persona', role: 'user' });

async function ejecutar(nombre: string, ctx: ActionContext, payload: Record<string, unknown> = {}) {
  const definicion = getAction(nombre);
  if (!definicion) throw new Error(`accion no registrada: ${nombre}`);
  return definicion.handler(ctx, payload);
}

const VACANTE_OK = {
  lugarNombre: 'Hospital Vargas',
  rol: 'Enfermería',
  cantidad: 4,
  lugarTipo: 'Hospital',
  ubicacion: 'La Guaira',
  descripcion: 'Turno de apoyo en triaje',
  urgencia: 'Alta',
  turno: 'Nocturno',
  telefono: '04141234567',
};

// Vacante ya sembrada, para las acciones que leen.
function baseConVacante(extra: Partial<Record<string, unknown>> = {}) {
  return crearDb({
    'vacantes/VAC-AAAA1111': {
      lugarTipo: 'Hospital',
      lugarNombre: 'Hospital Vargas',
      lugarNombreNorm: 'hospital vargas',
      ubicacion: 'La Guaira',
      rol: 'Enfermería',
      descripcion: 'Turno de apoyo en triaje',
      cantidadNecesaria: 4,
      cantidadCubierta: 1,
      urgencia: 'Alta',
      turno: 'Nocturno',
      telefono: '04141234567',
      estado: 'Abierta',
      createdAt: ANTES,
      actualizado: ANTES,
      ...extra,
    },
    'vacantesPublicas/VAC-AAAA1111': { rol: 'Enfermería', estado: 'Abierta' },
  });
}

// --- Helpers puros ------------------------------------------------------------

describe('helpers del dominio', () => {
  it('calcula los cupos que faltan sin bajar de cero', () => {
    expect(vacantes.cuposFaltantes({ cantidadNecesaria: 4, cantidadCubierta: 1 })).toBe(3);
    expect(vacantes.cuposFaltantes({ cantidadNecesaria: 4, cantidadCubierta: 9 })).toBe(0);
  });

  it('solo publica las vacantes abiertas', () => {
    expect(vacantes.debePublicarse({ estado: 'Abierta' })).toBe(true);
    expect(vacantes.debePublicarse({ estado: 'Cubierta' })).toBe(false);
    expect(vacantes.debePublicarse({ estado: 'Cerrada' })).toBe(false);
  });

  it('la tarjeta pública no lleva teléfono, solo si lo hay', () => {
    const publico = vacantes.documentoPublico(vacantes.comoVacante({
      lugarNombre: 'Hospital Vargas', rol: 'Enfermería', telefono: '04141234567',
      cantidadNecesaria: 4, cantidadCubierta: 1, createdAt: AHORA,
    }));

    expect(publico).toMatchObject({ rol: 'Enfermería', cuposFaltantes: 3, tieneContacto: true });
    expect(Object.keys(publico)).not.toContain('telefono');
  });

  it('marca `tieneContacto` en falso sin un teléfono de 7 dígitos', () => {
    const publico = vacantes.documentoPublico(vacantes.comoVacante({
      lugarNombre: 'X', rol: 'Y', telefono: '0414', cantidadNecesaria: 1, createdAt: AHORA,
    }));
    expect(publico.tieneContacto).toBe(false);
  });

  it('normaliza los valores fuera de lista al leer', () => {
    const vacante = vacantes.comoVacante({
      lugarNombre: 'X', rol: 'Y', lugarTipo: 'Nave espacial', urgencia: 'Urgentísima',
      estado: 'Inventada', createdAt: AHORA,
    });
    expect(vacante).toMatchObject({ lugarTipo: 'Centro', urgencia: 'Normal', estado: 'Abierta' });
  });
});

// --- admin_crear_vacante ------------------------------------------------------

describe('admin_crear_vacante', () => {
  it('valida el lugar, el rol y la cantidad en ese orden', async () => {
    const { db } = crearDb();

    await expect(ejecutar('admin_crear_vacante', contexto(db), { ...VACANTE_OK, lugarNombre: ' ' }))
      .rejects.toThrow(new ApiError('nombre del lugar o zona requerido'));
    await expect(ejecutar('admin_crear_vacante', contexto(db), { ...VACANTE_OK, rol: '' }))
      .rejects.toThrow(new ApiError('tipo de voluntario requerido'));
    for (const cantidad of [0, -3, 10_001, 'hola']) {
      await expect(ejecutar('admin_crear_vacante', contexto(db), { ...VACANTE_OK, cantidad }))
        .rejects.toThrow(new ApiError('cantidad inválida'));
    }
  });

  it('acepta el tope de 10 000 cupos', async () => {
    const { db } = crearDb();
    await expect(ejecutar('admin_crear_vacante', contexto(db), { ...VACANTE_OK, cantidad: 10_000 }))
      .resolves.toMatchObject({ id: expect.stringMatching(/^VAC-[0-9A-F]{8}$/) });
  });

  it('crea la vacante, la publica sin teléfono y escribe la bitácora', async () => {
    const { db, documentos } = crearDb();

    const salida = await ejecutar('admin_crear_vacante', contexto(db), VACANTE_OK);
    const id = String(salida.id);

    expect(documentos[`vacantes/${id}`]).toMatchObject({
      lugarTipo: 'Hospital',
      lugarNombre: 'Hospital Vargas',
      lugarNombreNorm: 'hospital vargas',
      rol: 'Enfermería',
      cantidadNecesaria: 4,
      cantidadCubierta: 0,
      urgencia: 'Alta',
      turno: 'Nocturno',
      telefono: '04141234567',
      estado: 'Abierta',
      createdAt: AHORA,
    });

    const publico = documentos[`vacantesPublicas/${id}`]!;
    expect(publico).toMatchObject({
      rol: 'Enfermería', lugarNombre: 'Hospital Vargas', lugarTipo: 'Hospital',
      cantidadNecesaria: 4, cantidadCubierta: 0, cuposFaltantes: 4, tieneContacto: true,
      estado: 'Abierta',
    });
    expect(Object.keys(publico)).not.toContain('telefono');

    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({
      lugar: 'Hospital Vargas',
      // El separador es `×` (U+00D7), no una equis.
      descripcion: 'Vacante de voluntariado: 4 × Enfermería (Hospital)',
      origen: 'admin',
      cantidad: 4,
      tipo: 'Vacante',
    });

    const auditoria = Object.entries(documentos).find(([r]) => r.startsWith('auditoriaAdmin/'));
    expect(auditoria?.[1]).toMatchObject({ accion: 'crear', entidad: 'vacantes', entidadId: id });
  });

  // El lugar de una vacante es texto libre: puede ser una zona de derrumbe, que
  // no es un centro y no está en `lugares`.
  it('admite «Zona de derrumbe» como tipo de lugar', async () => {
    const { db, documentos } = crearDb();
    const { id } = await ejecutar('admin_crear_vacante', contexto(db), {
      ...VACANTE_OK, lugarTipo: 'Zona de derrumbe', lugarNombre: 'Quebrada de Catia',
    });
    expect(documentos[`vacantes/${id}`]).toMatchObject({ lugarTipo: 'Zona de derrumbe' });
  });

  it('un tipo o una urgencia fuera de lista caen al valor por defecto, sin error', async () => {
    const { db, documentos } = crearDb();
    const { id } = await ejecutar('admin_crear_vacante', contexto(db), {
      ...VACANTE_OK, lugarTipo: 'Nave espacial', urgencia: 'Urgentísima',
    });
    expect(documentos[`vacantes/${id}`]).toMatchObject({ lugarTipo: 'Centro', urgencia: 'Normal' });
  });
});

// --- admin_actualizar_vacante -------------------------------------------------

describe('admin_actualizar_vacante', () => {
  it('exige el id', async () => {
    const { db } = baseConVacante();
    await expect(ejecutar('admin_actualizar_vacante', contexto(db), { id: '  ' }))
      .rejects.toThrow(new ApiError('id requerido'));
  });

  // El legado propagaba crudo el error de PostgREST ("JSON object requested,
  // multiple (or no) rows returned") hasta la pantalla del admin.
  it('responde 404 con un mensaje enseñable si la vacante no existe', async () => {
    const { db } = baseConVacante();
    await expect(ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-NOEXISTE' }))
      .rejects.toThrow(new ApiError('Vacante no encontrada', 404));
  });

  it('registra los cubiertos y actualiza la proyección', async () => {
    const { db, documentos } = baseConVacante();

    await expect(ejecutar('admin_actualizar_vacante', contexto(db), {
      id: 'VAC-AAAA1111', cantidadCubierta: 3,
    })).resolves.toMatchObject({ estado: 'Abierta', cantidadCubierta: 3, cuposFaltantes: 1 });

    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({
      cantidadCubierta: 3, estado: 'Abierta', actualizado: AHORA,
    });
    expect(documentos['vacantesPublicas/VAC-AAAA1111']).toMatchObject({
      cantidadCubierta: 3, cuposFaltantes: 1,
    });
  });

  // `cantidadCubierta: 0` es un valor válido: la comprobación del legado es
  // `!= null`, no la veracidad del valor.
  it('aplica un 0 explícito e ignora ausente y null', async () => {
    const { db, documentos } = baseConVacante();

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', cantidadCubierta: 0 });
    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ cantidadCubierta: 0 });

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', cantidadCubierta: 2 });
    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111' });
    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ cantidadCubierta: 2 });

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', cantidadCubierta: null });
    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ cantidadCubierta: 2 });
  });

  // El legado no lo comprobaba: se podían registrar 30 cubiertos en una vacante
  // de 4, y `cupos_faltantes` de la vista pública se iba a negativo.
  it('nunca deja los cubiertos por encima de los necesarios', async () => {
    const { db, documentos } = baseConVacante();

    const salida = await ejecutar('admin_actualizar_vacante', contexto(db), {
      id: 'VAC-AAAA1111', cantidadCubierta: 30,
    });

    expect(salida).toMatchObject({ cantidadCubierta: 4, cuposFaltantes: 0 });
    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ cantidadCubierta: 4 });
  });

  // El legado dejaba el cierre en manos del admin: una vacante llena se seguía
  // anunciando en el directorio hasta que alguien se acordaba de cerrarla.
  it('cierra la vacante y la retira del directorio al cubrirla', async () => {
    const { db, documentos } = baseConVacante();

    const salida = await ejecutar('admin_actualizar_vacante', contexto(db), {
      id: 'VAC-AAAA1111', cantidadCubierta: 4,
    });

    expect(salida).toMatchObject({ estado: 'Cubierta', cuposFaltantes: 0 });
    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ estado: 'Cubierta' });
    expect(documentos['vacantesPublicas/VAC-AAAA1111']).toBeUndefined();
  });

  it('retira del directorio una vacante cerrada a mano', async () => {
    const { db, documentos } = baseConVacante();

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', estado: 'Cerrada' });

    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ estado: 'Cerrada' });
    expect(documentos['vacantesPublicas/VAC-AAAA1111']).toBeUndefined();
  });

  it('vuelve a publicarla si el admin la reabre', async () => {
    const { db, documentos } = baseConVacante({ estado: 'Cerrada' });

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', estado: 'Abierta' });

    expect(documentos['vacantesPublicas/VAC-AAAA1111']).toMatchObject({
      rol: 'Enfermería', estado: 'Abierta', cuposFaltantes: 3,
    });
  });

  it('un estado fuera de lista no cambia el estado', async () => {
    const { db, documentos } = baseConVacante();

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', estado: 'Pendiente' });

    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({ estado: 'Abierta' });
  });

  // Paridad con el legado: `actualizado` se toca siempre.
  it('sella `actualizado` aunque no cambie nada más', async () => {
    const { db, documentos } = baseConVacante();

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111' });

    expect(documentos['vacantes/VAC-AAAA1111']).toMatchObject({
      actualizado: AHORA, cantidadCubierta: 1, estado: 'Abierta',
    });
  });

  it('escribe la bitácora con el estado resultante y audita el cambio', async () => {
    const { db, documentos } = baseConVacante();

    await ejecutar('admin_actualizar_vacante', contexto(db), { id: 'VAC-AAAA1111', cantidadCubierta: 4 });

    const bitacora = Object.entries(documentos).find(([r]) => r.startsWith('historialMovimientos/'));
    expect(bitacora?.[1]).toMatchObject({
      lugar: 'Hospital Vargas',
      descripcion: 'Vacante Enfermería: Cubierta, 4 cubiertos',
      origen: 'admin',
      tipo: 'Vacante',
    });

    const auditoria = Object.entries(documentos).find(([r]) => r.startsWith('auditoriaAdmin/'));
    expect(auditoria?.[1]).toMatchObject({
      accion: 'editar',
      entidad: 'vacantes',
      entidadId: 'VAC-AAAA1111',
      antes: { estado: 'Abierta', cantidadCubierta: 1 },
      despues: { estado: 'Cubierta', cantidadCubierta: 4 },
    });
  });
});

// --- admin_listar_vacantes ----------------------------------------------------

describe('admin_listar_vacantes', () => {
  it('devuelve las claves snake_case que lee la consola, con el teléfono', async () => {
    const { db } = baseConVacante();

    const salida = await ejecutar('admin_listar_vacantes', contexto(db));

    expect(salida.vacantes).toEqual([{
      id: 'VAC-AAAA1111',
      lugar_tipo: 'Hospital',
      lugar_nombre: 'Hospital Vargas',
      ubicacion: 'La Guaira',
      rol: 'Enfermería',
      descripcion: 'Turno de apoyo en triaje',
      cantidad_necesaria: 4,
      cantidad_cubierta: 1,
      urgencia: 'Alta',
      turno: 'Nocturno',
      estado: 'Abierta',
      // El admin sí ve el teléfono; la tarjeta pública no.
      telefono: '04141234567',
      fecha_creacion: '2026-09-01T00:00:00.000Z',
    }]);
  });

  it('incluye las cerradas y las cubiertas, no solo las abiertas', async () => {
    const { db } = baseConVacante({ estado: 'Cerrada' });

    const salida = await ejecutar('admin_listar_vacantes', contexto(db));
    expect(salida.vacantes).toHaveLength(1);
  });

  it('ordena por fecha de creación descendente', async () => {
    const { db } = crearDb({
      'vacantes/VAC-1': { lugarNombre: 'A', rol: 'A', cantidadNecesaria: 1, createdAt: ANTES },
      'vacantes/VAC-2': { lugarNombre: 'B', rol: 'B', cantidadNecesaria: 1, createdAt: AHORA },
    });

    const salida = await ejecutar('admin_listar_vacantes', contexto(db));
    expect((salida.vacantes as Array<{ id: string }>).map((v) => v.id)).toEqual(['VAC-2', 'VAC-1']);
  });
});

// --- contactar_vacante --------------------------------------------------------

describe('contactar_vacante', () => {
  it('exige el id', async () => {
    const { db } = baseConVacante();
    await expect(ejecutar('contactar_vacante', USUARIO(db), {}))
      .rejects.toThrow(new ApiError('id requerido'));
  });

  it('entrega el teléfono de una vacante abierta', async () => {
    const { db } = baseConVacante();

    await expect(ejecutar('contactar_vacante', USUARIO(db), { id: 'VAC-AAAA1111' })).resolves.toEqual({
      id: 'VAC-AAAA1111',
      rol: 'Enfermería',
      lugarNombre: 'Hospital Vargas',
      telefono: '04141234567',
    });
  });

  it('responde 404 si no existe', async () => {
    const { db } = baseConVacante();
    await expect(ejecutar('contactar_vacante', USUARIO(db), { id: 'VAC-NOEXISTE' }))
      .rejects.toThrow(new ApiError('Vacante no encontrada', 404));
  });

  // Repartir el contacto de un puesto ya lleno es mandar gente a un sitio donde
  // no hace falta.
  it('responde 404 si la vacante ya está cubierta o cerrada', async () => {
    for (const estado of ['Cubierta', 'Cerrada']) {
      const { db } = baseConVacante({ estado });
      await expect(ejecutar('contactar_vacante', USUARIO(db), { id: 'VAC-AAAA1111' }))
        .rejects.toThrow(new ApiError('Vacante no encontrada', 404));
    }
  });
});

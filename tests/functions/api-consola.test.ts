import { describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import * as catalogo from '../../functions/src/api/consola-entidades.js';
import * as consola from '../../functions/src/api/consola.js';
// La consola escribe colecciones de otros dominios: hay que registrarlos para
// que sus proyecciones y contadores existan.
import '../../functions/src/api/lugares.js';
import '../../functions/src/api/personas.js';
import '../../functions/src/api/vacantes.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const CEDULA = 'private/uid-vol/volunteers/cedula.jpg';

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, uid: 'uid-admin', role: 'admin', ...extra });
}

const ADMIN = (db: unknown) => contexto(db);

function base(extra: Record<string, Documento> = {}) {
  return crearDb({
    'lugares/LUG-AAAA1111': {
      tipo: 'Hospital',
      nombre: 'Hospital Vargas',
      nombreNorm: 'hospital vargas',
      ubicacion: 'La Guaira',
      telefono: '04141112233',
      lat: 10.6,
      lng: -66.93,
      activo: true,
      panelUid: null,
      actualizado: ANTES,
    },
    'indices/lugaresPorNombre/claves/hospital vargas': { valor: 'LUG-AAAA1111' },
    'lugares/LUG-AAAA1111/insumos/agua potable': {
      nombre: 'Agua potable',
      categoria: 'Alimentos',
      estado: 'Necesita',
      cantidadNecesaria: 500,
      cantidadRecibida: 100,
      urgencia: 'Alta',
      unidad: 'bidones',
      actualizado: ANTES,
    },
    'voluntarios/VOL-AAAA1111': {
      nombre: 'Ana',
      apellido: 'Pérez',
      emailNorm: 'ana@ejemplo.local',
      telefono: '04141234567',
      ciudad: 'Caracas',
      profesion: 'Enfermera',
      fotoCedulaPath: CEDULA,
      activo: true,
      createdAt: ANTES,
    },
    'motorizados/MOT-AAAA1111': {
      nombre: 'Luis Motorizado',
      tipoVehiculo: 'Moto',
      zonaOperacion: 'Caracas',
      telefono: '04149998877',
      placa: 'AB123CD',
      emailNorm: 'luis@ejemplo.local',
      activo: true,
      createdAt: ANTES,
    },
    'personas/PER-AAAA1111': {
      nombre: 'José Ramírez',
      nombreNorm: 'jose ramirez',
      cedula: 'V-12345678',
      cedulaNorm: '12345678',
      estado: 'Sin información reciente',
      verificada: false,
      createdAt: ANTES,
    },
    ...extra,
  });
}

// --- Validación de columnas ------------------------------------------------------

describe('valorValidado', () => {
  it('nombra la columna en cada error, que es lo que lee el formulario', () => {
    const numero = { id: 'cantidad_necesaria', tipo: 'numero', minNum: 1, maxNum: 10 } as const;
    expect(() => catalogo.valorValidado(numero, 0)).toThrow('cantidad_necesaria: el mínimo es 1');
    expect(() => catalogo.valorValidado(numero, 99)).toThrow('cantidad_necesaria: el máximo es 10');

    expect(() => catalogo.valorValidado({ id: 'email', tipo: 'email' }, 'no-es-correo'))
      .toThrow('email: correo electrónico inválido');
    expect(() => catalogo.valorValidado({ id: 'telefono', tipo: 'telefono' }, '1234'))
      .toThrow('telefono: teléfono demasiado corto');
    expect(() => catalogo.valorValidado({ id: 'tipo', tipo: 'opcion', opciones: ['Centro'] }, 'Otro'))
      .toThrow('tipo: ese valor no está permitido');
    expect(() => catalogo.valorValidado({ id: 'lugar_id', tipo: 'refLugar' }, ''))
      .toThrow('lugar_id: hay que elegir un centro');
  });

  it('las coordenadas tienen que caer dentro de Venezuela, y vacío es null', () => {
    expect(catalogo.valorValidado({ id: 'lat', tipo: 'lat' }, 10.5)).toBe(10.5);
    expect(catalogo.valorValidado({ id: 'lat', tipo: 'lat' }, '')).toBeNull();
    expect(catalogo.valorValidado({ id: 'lat', tipo: 'lat' }, null)).toBeNull();
    expect(() => catalogo.valorValidado({ id: 'lat', tipo: 'lat' }, 40.4))
      .toThrow('lat: esa coordenada cae fuera de Venezuela');
    expect(() => catalogo.valorValidado({ id: 'lng', tipo: 'lng' }, 0))
      .toThrow('lng: esa coordenada cae fuera de Venezuela');
  });

  it('el booleano solo es cierto con `true` o la cadena "true"', () => {
    const col = { id: 'verificada', tipo: 'booleano' } as const;
    expect(catalogo.valorValidado(col, true)).toBe(true);
    expect(catalogo.valorValidado(col, 'true')).toBe(true);
    expect(catalogo.valorValidado(col, 'sí')).toBe(false);
    expect(catalogo.valorValidado(col, 1)).toBe(false);
  });

  it('un correo vacío se acepta: no toda persona tiene', () => {
    expect(catalogo.valorValidado({ id: 'email', tipo: 'email' }, '')).toBe('');
  });
});

describe('camposValidados', () => {
  const entidad = catalogo.entidadDe('personas');

  it('una columna que no está en la lista blanca se rechaza, no se ignora', () => {
    expect(() => catalogo.camposValidados(entidad, { nombre: 'A', cedulaNorm: 'x' }, true))
      .toThrow('Ese dato no se puede editar desde aquí: cedulaNorm');
  });

  it('en modo parcial se saltan las ausentes; al crear se evalúan con vacío', () => {
    const parcial = catalogo.camposValidados(entidad, { cedula: 'V-1' }, true);
    expect([...parcial.porColumna.keys()]).toEqual(['cedula']);

    // Crear evalúa todas: `nombre` es requerido y vacío falla.
    expect(() => catalogo.camposValidados(entidad, { cedula: 'V-1' }, false))
      .toThrow('nombre: es obligatorio');
  });

  it('sin ninguna columna no hay nada que guardar', () => {
    expect(() => catalogo.camposValidados(entidad, {}, true)).toThrow('No hay nada que guardar');
  });

  it('crear una vacante sin cantidad falla por el mínimo, igual que el legado', () => {
    const vacantes = catalogo.entidadDe('vacantes_voluntarios');
    expect(() => catalogo.camposValidados(vacantes, {
      lugar_tipo: 'Centro', lugar_nombre: 'X', rol: 'Cocina', urgencia: 'Alta', estado: 'Abierta',
    }, false)).toThrow('cantidad_necesaria: el mínimo es 1');
  });

  it('traduce al vocabulario canónico de Firestore', () => {
    const motorizados = catalogo.entidadDe('motorizados');
    const validados = catalogo.camposValidados(motorizados, {
      nombre: 'Luis', tipo_vehiculo: 'Moto', email: 'L@Ejemplo.Local', zona_operacion: 'Catia',
    }, true);
    expect(catalogo.aCanonico(motorizados, validados)).toEqual({
      nombre: 'Luis', tipoVehiculo: 'Moto', emailNorm: 'l@ejemplo.local', zonaOperacion: 'Catia',
    });
  });
});

describe('normaClave', () => {
  it('«José Pérez» ≡ «jose perez  » y «0412-000 00 00» ≡ «04120000000»', () => {
    expect(catalogo.normaClave('José  Pérez ', 'texto')).toBe('jose perez');
    expect(catalogo.normaClave('0412-000 00 00', 'digitos')).toBe('04120000000');
    expect(catalogo.normaClave(' A@B.COM ', 'email')).toBe('a@b.com');
    expect(catalogo.normaClave(null, 'texto')).toBe('');
  });
});

// --- admin_datos_entidades ---------------------------------------------------------

describe('admin_datos_entidades', () => {
  it('devuelve el catálogo entero, con los límites que el cliente pinta', async () => {
    const { db } = base();
    const { entidades } = await ejecutar('admin_datos_entidades', ADMIN(db));
    const lista = entidades as Documento[];

    expect(lista.map((e) => e.id)).toEqual([
      'lugares', 'insumos', 'voluntarios', 'motorizados', 'rescatistas',
      'centros_panel', 'vacantes_voluntarios', 'personas',
    ]);
    const lugares = lista[0]!;
    expect(lugares).toMatchObject({ etiqueta: 'nombre', pk: 'id', borrado: 'fisico' });
    expect((lugares.columnas as Documento[])[0]).toEqual({
      id: 'tipo', tipo: 'opcion', opciones: ['Centro', 'Hospital', 'Refugio'], requerido: true,
    });
    expect(lugares.hijos).toEqual([
      { etiqueta: 'insumos', modo: 'cascade' },
      { etiqueta: 'accesos de panel', modo: 'cascade' },
    ]);
  });

  it('nunca describe una entidad fuera de la lista blanca', async () => {
    const { db } = base();
    const { entidades } = await ejecutar('admin_datos_entidades', ADMIN(db));
    const ids = (entidades as Documento[]).map((e) => e.id);
    for (const prohibida of ['facturas', 'denuncias', 'familiasDamnificadas', 'viajes', 'auditoriaAdmin', 'config']) {
      expect(ids).not.toContain(prohibida);
    }
  });
});

// --- admin_datos_listar ------------------------------------------------------------

describe('admin_datos_listar', () => {
  it('una entidad fuera de la lista blanca no se lista', async () => {
    const { db } = base();
    await expect(ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'facturas' }))
      .rejects.toThrow(catalogo.MENSAJE_FUERA);
  });

  it('devuelve las columnas del legado, con las fechas en ISO', async () => {
    const { db } = base();
    const { filas } = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios' });
    expect((filas as Documento[])[0]).toMatchObject({
      id: 'VOL-AAAA1111',
      nombre: 'Ana',
      apellido: 'Pérez',
      email: 'ana@ejemplo.local',
      medio_transporte: null,
      foto_cedula: CEDULA,
      fecha_registro: ANTES.toISOString(),
    });
  });

  it('los insumos se listan por grupo de colecciones, con el id compuesto', async () => {
    const { db } = base();
    const { filas } = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'insumos' });
    expect((filas as Documento[])[0]).toMatchObject({
      // El insumo vive en la subcolección de su centro: su id lleva las dos
      // mitades, porque una sola no direcciona nada.
      id: 'LUG-AAAA1111/agua potable',
      lugar_id: 'LUG-AAAA1111',
      nombre: 'Agua potable',
      cantidad_necesaria: 500,
      cantidad_recibida: 100,
    });
  });

  it('la búsqueda ignora acentos y mayúsculas, y no tiene comodines que romper', async () => {
    const { db } = base();
    const conAcento = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios', busca: 'perez' });
    expect(conAcento.filas).toHaveLength(1);

    // El legado mandaba el texto al `ilike`: buscar `%` listaba la tabla entera.
    const comodin = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios', busca: '%' });
    expect(comodin.filas).toHaveLength(0);
    expect(comodin.total).toBe(0);
  });

  it('pagina y acota `porPagina` entre 5 y 100', async () => {
    const { db } = base();
    const salida = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios', porPagina: 999 });
    expect(salida.porPagina).toBe(100);
    expect((await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios', porPagina: 1 })).porPagina).toBe(5);

    const pagina2 = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios', pagina: 2 });
    expect(pagina2.filas).toEqual([]);
    expect(pagina2.total).toBe(1);
  });

  it('dice si el escaneo llegó al tope, en vez de fingir que ése es el total', async () => {
    const { db } = base();
    const salida = await ejecutar('admin_datos_listar', ADMIN(db), { entidad: 'voluntarios' });
    expect(salida.truncado).toBe(false);
  });
});

// --- admin_datos_ficha -------------------------------------------------------------

describe('admin_datos_ficha', () => {
  it('un id inexistente es un 404', async () => {
    const { db } = base();
    const error = await ejecutar('admin_datos_ficha', ADMIN(db), { entidad: 'voluntarios', id: 'VOL-NADA' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(consola.NO_ENCONTRADO);
    expect((error as ApiError).status).toBe(404);
  });

  it('devuelve las RUTAS de las fotos, no URLs firmadas', async () => {
    const { db } = base();
    const salida = await ejecutar('admin_datos_ficha', ADMIN(db), { entidad: 'voluntarios', id: 'VOL-AAAA1111' });
    // El legado firmaba una URL de una hora por cada foto en cada apertura.
    expect(salida.fotos).toEqual([{ campo: 'foto_cedula', path: CEDULA }]);
    expect(JSON.stringify(salida)).not.toContain('http');
  });

  it('cuenta los dependientes de un centro antes de que nadie borre nada', async () => {
    const { db } = base({ 'centrosPanel/LUG-AAAA1111': { authUid: 'uid-panel', email: 'c@x.local', creado: ANTES } });
    const salida = await ejecutar('admin_datos_ficha', ADMIN(db), { entidad: 'lugares', id: 'LUG-AAAA1111' });
    expect(salida.dependientes).toEqual([
      { etiqueta: 'insumos', cuantos: 1, modo: 'cascade' },
      { etiqueta: 'accesos de panel', cuantos: 1, modo: 'cascade' },
    ]);
  });

  it('la ficha de un acceso de panel nunca trae la credencial', async () => {
    const { db } = base({
      'centrosPanel/LUG-AAAA1111': { authUid: 'uid-secreto', email: 'c@x.local', creado: ANTES },
    });
    const salida = await ejecutar('admin_datos_ficha', ADMIN(db), { entidad: 'centros_panel', id: 'LUG-AAAA1111' });
    expect(JSON.stringify(salida)).not.toContain('uid-secreto');
    expect(salida.fila).toMatchObject({ id: 'LUG-AAAA1111', lugar_id: 'LUG-AAAA1111', email: 'c@x.local' });
  });
});

// --- admin_datos_crear -------------------------------------------------------------

describe('admin_datos_crear', () => {
  const NUEVO = {
    nombre: 'Marta', apellido: 'Silva', email: 'marta@ejemplo.local',
    telefono: '04149990000', ciudad: 'Valencia', estado: '', profesion: '',
    disponibilidad: '', medio_transporte: '', observaciones: '',
  };

  it('crea, publica lo que toque y deja la fila en la bitácora', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_datos_crear', ADMIN(db), { entidad: 'voluntarios', campos: NUEVO });

    expect(salida.duplicados).toEqual([]);
    const id = String((salida.fila as Documento).id);
    expect(id).toMatch(/^VOL-[0-9A-F]{8}$/);
    expect(documentos[`voluntarios/${id}`]).toMatchObject({ nombre: 'Marta', emailNorm: 'marta@ejemplo.local' });
    // Sin consentimiento no hay perfil público, igual que al registrarse.
    expect(rutas(documentos, 'voluntariosPublicos/')).toHaveLength(0);
    expect(documentos['estadisticas/global']).toMatchObject({ voluntariosActivos: 1 });
    expect(rutas(documentos, 'auditoriaAdmin/')).toHaveLength(1);
  });

  it('avisa de un duplicado y NO escribe hasta que se fuerza', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'voluntarios', campos: { ...NUEVO, email: 'ANA@ejemplo.local' },
    });
    expect(salida.fila).toBeUndefined();
    expect(salida.duplicados).toEqual([{ id: 'VOL-AAAA1111', etiqueta: 'Ana', porque: 'email' }]);
    expect(rutas(documentos, 'voluntarios/')).toHaveLength(1);

    const forzado = await ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'voluntarios', campos: { ...NUEVO, email: 'ANA@ejemplo.local' }, forzar: true,
    });
    expect(forzado.fila).toBeDefined();
    expect(rutas(documentos, 'voluntarios/')).toHaveLength(2);
  });

  it('un centro creado desde la consola reserva su nombre y publica su ficha', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'lugares',
      campos: { tipo: 'Refugio', nombre: 'Refugio Catia', ubicacion: 'Catia', telefono: '', lat: 10.5, lng: -66.9 },
    });

    const id = String((salida.fila as Documento).id);
    expect(documentos[`lugares/${id}`]).toMatchObject({ nombre: 'Refugio Catia', nombreNorm: 'refugio catia' });
    // Lo mismo que haría `registrar_lugar`: índice de unicidad, proyección y contador.
    expect(documentos['indices/lugaresPorNombre/claves/refugio catia']).toMatchObject({ valor: id });
    expect(documentos[`lugaresPublicos/${id}`]).toMatchObject({ nombre: 'Refugio Catia', activo: true });
    expect(documentos['estadisticas/global']).toMatchObject({ centrosRegistrados: 1 });
  });

  it('un insumo se crea dentro de su centro y republica la ficha pública del centro', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'insumos',
      campos: {
        lugar_id: 'LUG-AAAA1111', nombre: 'Mantas', categoria: 'Refugio', estado: 'Necesita',
        cantidad_necesaria: 50, cantidad_recibida: 0, urgencia: 'Normal', unidad: 'unidades',
      },
    });

    expect(salida.fila).toMatchObject({ id: 'LUG-AAAA1111/mantas', lugar_id: 'LUG-AAAA1111' });
    expect(documentos['lugares/LUG-AAAA1111/insumos/mantas']).toMatchObject({ nombre: 'Mantas' });
    // El insumo no guarda el id de su centro: se direcciona por la ruta.
    expect(documentos['lugares/LUG-AAAA1111/insumos/mantas']!.lugarId).toBeUndefined();
    const publico = documentos['lugaresPublicos/LUG-AAAA1111']!;
    expect((publico.necesita as Documento[]).map((i) => i.nombre).sort()).toEqual(['Agua potable', 'Mantas']);
  });

  it('un centro que no existe no se puede referenciar', async () => {
    const { db } = base();
    await expect(ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'insumos',
      campos: {
        lugar_id: 'LUG-NADA', nombre: 'Mantas', estado: 'Necesita', urgencia: 'Normal',
        categoria: '', cantidad_necesaria: 1, cantidad_recibida: 0, unidad: '',
      },
    })).rejects.toThrow('lugar_id: ese centro no existe');
  });

  it('un acceso de panel no se teclea: su credencial es un claim, no una fila', async () => {
    const { db } = base();
    await expect(ejecutar('admin_datos_crear', ADMIN(db), {
      entidad: 'centros_panel', campos: { email: 'x@y.local' },
    })).rejects.toThrow(catalogo.MENSAJE_FUERA);
  });
});

// --- admin_datos_editar ------------------------------------------------------------

describe('admin_datos_editar', () => {
  it('edita, republica y devuelve las columnas enviadas', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'motorizados', id: 'MOT-AAAA1111', campos: { zona_operacion: 'La Guaira' },
    });

    expect(salida.cambiados).toEqual(['zona_operacion']);
    expect(documentos['motorizados/MOT-AAAA1111']).toMatchObject({ zonaOperacion: 'La Guaira' });
    expect(documentos['motorizadosPublicos/MOT-AAAA1111']).toMatchObject({ zona: 'La Guaira' });
    // La tarjeta pública sigue sin teléfono ni placa.
    expect(documentos['motorizadosPublicos/MOT-AAAA1111']!.telefono).toBeUndefined();
  });

  it('renombrar un centro mueve la reserva del nombre y republica el directorio', async () => {
    const { db, documentos } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'lugares', id: 'LUG-AAAA1111', campos: { nombre: 'Hospital Pérez de León' },
    });

    expect(documentos['lugares/LUG-AAAA1111']).toMatchObject({ nombreNorm: 'hospital perez de leon' });
    // Sin esto el nombre viejo quedaría tomado para siempre y el nuevo, libre.
    expect(documentos['indices/lugaresPorNombre/claves/hospital vargas']).toBeUndefined();
    expect(documentos['indices/lugaresPorNombre/claves/hospital perez de leon'])
      .toMatchObject({ valor: 'LUG-AAAA1111' });
    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toMatchObject({ nombre: 'Hospital Pérez de León' });
  });

  it('no deja renombrar un centro con el nombre de otro', async () => {
    const { db } = base({
      'lugares/LUG-BBBB2222': { tipo: 'Refugio', nombre: 'Refugio Catia', nombreNorm: 'refugio catia', activo: true, actualizado: ANTES },
      'indices/lugaresPorNombre/claves/refugio catia': { valor: 'LUG-BBBB2222' },
    });
    await expect(ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'lugares', id: 'LUG-AAAA1111', campos: { nombre: 'Refugio Catia' }, forzar: true,
    })).rejects.toThrow('Ya existe un registro con ese valor único');
  });

  it('editar un insumo rehace la ficha pública de su centro', async () => {
    const { db, documentos } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'insumos', id: 'LUG-AAAA1111/agua potable', campos: { cantidad_recibida: 500, estado: 'Cubierto' },
    });

    const publico = documentos['lugaresPublicos/LUG-AAAA1111']!;
    expect(publico.necesita).toEqual([]);
    expect((publico.cubiertos as Documento[])[0]).toMatchObject({ nombre: 'Agua potable', yaCubierto: true });
  });

  it('cambiar el estado de una persona mueve el contador de localizadas', async () => {
    const { db, documentos } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'personas', id: 'PER-AAAA1111', campos: { estado: 'Localizada' },
    });
    expect(documentos['estadisticas/global']).toMatchObject({ personasLocalizadas: 1 });

    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'personas', id: 'PER-AAAA1111', campos: { estado: 'Sin información reciente' },
    });
    expect(documentos['estadisticas/global']).toMatchObject({ personasLocalizadas: 0 });
  });

  it('editar el nombre de una persona rehace su clave de búsqueda', async () => {
    const { db, documentos } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'personas', id: 'PER-AAAA1111', campos: { nombre: 'José Antonio Ramírez', cedula: 'V-999.111' },
    });
    expect(documentos['personas/PER-AAAA1111']).toMatchObject({
      nombreNorm: 'jose antonio ramirez', cedulaNorm: '999111',
    });
  });

  it('un registro que no existe es un 404, y una columna vetada no se cuela', async () => {
    const { db } = base();
    await expect(ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-NADA', campos: { nombre: 'X' },
    })).rejects.toThrow(consola.NO_ENCONTRADO);

    await expect(ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', campos: { authUid: 'yo' },
    })).rejects.toThrow('Ese dato no se puede editar desde aquí: authUid');
  });

  it('una vacante cubierta desaparece del directorio público', async () => {
    const { db, documentos } = base({
      'vacantes/VAC-AAAA1111': {
        lugarTipo: 'Centro', lugarNombre: 'Refugio', lugarNombreNorm: 'refugio', rol: 'Cocina',
        cantidadNecesaria: 4, cantidadCubierta: 0, urgencia: 'Alta', estado: 'Abierta',
        telefono: '04141234567', createdAt: ANTES, actualizado: ANTES,
      },
      'vacantesPublicas/VAC-AAAA1111': { rol: 'Cocina', estado: 'Abierta', createdAt: ANTES },
    });

    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'vacantes_voluntarios', id: 'VAC-AAAA1111', campos: { estado: 'Cerrada' },
    });
    expect(documentos['vacantesPublicas/VAC-AAAA1111']).toBeUndefined();
  });
});

// --- admin_datos_duplicados ---------------------------------------------------------

describe('admin_datos_duplicados', () => {
  it('agrupa por cada clave natural y solo emite los grupos con más de uno', async () => {
    const { db } = base({
      'voluntarios/VOL-BBBB2222': {
        nombre: 'Ana', apellido: 'Pérez', emailNorm: 'otra@ejemplo.local',
        telefono: '0414-123 45 67', activo: true, createdAt: ANTES,
      },
    });

    const { grupos } = await ejecutar('admin_datos_duplicados', ADMIN(db), { entidad: 'voluntarios' });
    const porQue = (grupos as Documento[]).map((g) => g.porque).sort();
    // La misma pareja sale por dos motivos: mismo teléfono y mismo nombre.
    expect(porQue).toEqual(['nombre + apellido', 'telefono']);
    expect((grupos as Documento[])[0]!.filas).toHaveLength(2);
  });

  it('una parte vacía invalida la clave: dos sin teléfono no son duplicados', async () => {
    const { db } = base({
      'rescatistas/RES-1': { nombre: 'A', organizacion: '', telefono: '', activo: true, createdAt: ANTES },
      'rescatistas/RES-2': { nombre: 'B', organizacion: '', telefono: '', activo: true, createdAt: ANTES },
    });
    const { grupos } = await ejecutar('admin_datos_duplicados', ADMIN(db), { entidad: 'rescatistas' });
    expect(grupos).toEqual([]);
  });

  it('una entidad sin claves naturales no consulta nada', async () => {
    const { db } = base();
    expect(await ejecutar('admin_datos_duplicados', ADMIN(db), { entidad: 'centros_panel' }))
      .toEqual({ grupos: [] });
  });
});

// --- admin_datos_borrar --------------------------------------------------------------

describe('admin_datos_borrar', () => {
  it('hay que teclear la etiqueta, sin acentos y sin importar mayúsculas', async () => {
    const { db, documentos } = base();
    await expect(ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'lugares', id: 'LUG-AAAA1111', confirmar: 'otra cosa',
    })).rejects.toThrow(consola.CONFIRMA_BORRADO);
    expect(documentos['lugares/LUG-AAAA1111']).toBeDefined();

    await ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'lugares', id: 'LUG-AAAA1111', confirmar: 'hospital  VARGAS',
    });
    expect(documentos['lugares/LUG-AAAA1111']).toBeUndefined();
  });

  it('borrar un centro arrastra sus insumos, su panel, su proyección y su nombre reservado', async () => {
    const { db, documentos } = base({
      'centrosPanel/LUG-AAAA1111': { authUid: 'uid-panel', email: 'c@x.local', creado: ANTES },
      'lugaresPublicos/LUG-AAAA1111': { nombre: 'Hospital Vargas', activo: true, updatedAt: ANTES },
    });

    const salida = await ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'lugares', id: 'LUG-AAAA1111', confirmar: 'Hospital Vargas',
    });

    expect(salida).toMatchObject({ borrado: true });
    expect(salida.dependientes).toEqual([
      { etiqueta: 'insumos', cuantos: 1, modo: 'cascade' },
      { etiqueta: 'accesos de panel', cuantos: 1, modo: 'cascade' },
    ]);
    expect(rutas(documentos, 'lugares/')).toHaveLength(0);
    expect(documentos['centrosPanel/LUG-AAAA1111']).toBeUndefined();
    expect(documentos['lugaresPublicos/LUG-AAAA1111']).toBeUndefined();
    // Sin liberar el nombre, nadie podría volver a registrar ese centro.
    expect(documentos['indices/lugaresPorNombre/claves/hospital vargas']).toBeUndefined();
    expect(documentos['estadisticas/global']).toMatchObject({ hospitalesRegistrados: -1 });
  });

  it('la bitácora guarda la fila entera y lo que se llevó por delante', async () => {
    const { db, documentos } = base();
    await ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', confirmar: 'Ana',
    });

    const entrada = documentos[rutas(documentos, 'auditoriaAdmin/')[0]!]!;
    expect(entrada).toMatchObject({ accion: 'borrar', entidad: 'voluntarios', entidadId: 'VOL-AAAA1111' });
    const antes = (entrada.antes as Documento).fila as Documento;
    expect(antes).toMatchObject({ nombre: 'Ana' });
    // `auditar` enmascara los correos incluso en la bitácora del admin.
    expect(antes.email).toBe('a***@ejemplo.local');
  });

  it('revocar un acceso de panel deja al centro sin gestor en su ficha pública', async () => {
    const { db, documentos } = base({
      'lugares/LUG-CCCC3333': {
        tipo: 'Centro', nombre: 'Centro Sur', nombreNorm: 'centro sur',
        activo: true, panelUid: 'uid-panel', actualizado: ANTES,
      },
      'centrosPanel/LUG-CCCC3333': { authUid: 'uid-panel', email: 'sur@x.local', creado: ANTES },
    });

    await ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'centros_panel', id: 'LUG-CCCC3333', confirmar: 'sur@x.local',
    });

    expect(documentos['centrosPanel/LUG-CCCC3333']).toBeUndefined();
    expect(documentos['lugares/LUG-CCCC3333']).toMatchObject({ panelUid: null });
    expect(documentos['lugaresPublicos/LUG-CCCC3333']).toMatchObject({ gestionado: false });
  });

  it('una fila con la etiqueta vacía no se puede borrar desde la consola', async () => {
    const { db } = base({
      'rescatistas/RES-1': { nombre: '', telefono: '04141234567', activo: true, createdAt: ANTES },
    });
    await expect(ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'rescatistas', id: 'RES-1', confirmar: '',
    })).rejects.toThrow(consola.CONFIRMA_BORRADO);
  });
});

// --- admin_bitacora y admin_datos_deshacer -------------------------------------------

describe('admin_bitacora', () => {
  it('devuelve lo más reciente primero, con el uid del admin que firmó el cambio', async () => {
    const { db } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', campos: { ciudad: 'Maracay' },
    });

    const { cambios } = await ejecutar('admin_bitacora', ADMIN(db), {});
    expect(cambios).toHaveLength(1);
    expect((cambios as Documento[])[0]).toMatchObject({
      accion: 'editar', entidad: 'voluntarios', fila_id: 'VOL-AAAA1111', actor_uid: 'uid-admin',
    });
  });

  it('filtra por entidad', async () => {
    const { db } = base();
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', campos: { ciudad: 'Maracay' },
    });
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'personas', id: 'PER-AAAA1111', campos: { verificada: true },
    });

    const { cambios } = await ejecutar('admin_bitacora', ADMIN(db), { entidad: 'personas' });
    expect(cambios).toHaveLength(1);
    expect((cambios as Documento[])[0]).toMatchObject({ entidad: 'personas' });
  });
});

describe('admin_datos_deshacer', () => {
  async function conEdicion() {
    const b = base();
    await ejecutar('admin_datos_editar', ADMIN(b.db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', campos: { ciudad: 'Maracay', profesion: 'Docente' },
    });
    const { cambios } = await ejecutar('admin_bitacora', ADMIN(b.db), {});
    return { ...b, auditoriaId: String((cambios as Documento[])[0]!.id) };
  }

  it('restaura los valores anteriores y deja su propia entrada', async () => {
    const { db, documentos, auditoriaId } = await conEdicion();
    expect(documentos['voluntarios/VOL-AAAA1111']).toMatchObject({ ciudad: 'Maracay' });

    const salida = await ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId });
    expect(salida.fila).toMatchObject({ ciudad: 'Caracas', profesion: 'Enfermera' });
    expect(documentos['voluntarios/VOL-AAAA1111']).toMatchObject({ ciudad: 'Caracas' });

    const { cambios } = await ejecutar('admin_bitacora', ADMIN(db), {});
    expect((cambios as Documento[]).map((c) => c.accion)).toEqual(['deshacer', 'editar']);
  });

  it('solo se deshacen las ediciones: ni crear, ni borrar, ni otro deshacer', async () => {
    const { db, auditoriaId } = await conEdicion();
    await ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId });

    const { cambios } = await ejecutar('admin_bitacora', ADMIN(db), {});
    const elDeshacer = (cambios as Documento[]).find((c) => c.accion === 'deshacer')!;
    await expect(ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId: elDeshacer.id }))
      .rejects.toThrow('Solo se puede deshacer una edición');
  });

  it('un id que no está en la bitácora es un 404', async () => {
    const { db } = base();
    const error = await ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId: 'nada' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
    await expect(ejecutar('admin_datos_deshacer', ADMIN(db), {}))
      .rejects.toThrow('No se encontró ese cambio en la bitácora');
  });

  it('si el registro ya no existe, lo dice en vez de recrearlo', async () => {
    const { db, auditoriaId } = await conEdicion();
    await ejecutar('admin_datos_borrar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', confirmar: 'Ana',
    });
    await expect(ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId }))
      .rejects.toThrow('Ese registro ya no existe');
  });

  it('deshacer NO restaura el correo: la bitácora solo guarda su máscara', async () => {
    const { db, documentos } = base();
    // La edición toca el correo y la ciudad.
    await ejecutar('admin_datos_editar', ADMIN(db), {
      entidad: 'voluntarios', id: 'VOL-AAAA1111', campos: { email: 'nueva@ejemplo.local', ciudad: 'Maracay' },
    });
    const { cambios } = await ejecutar('admin_bitacora', ADMIN(db), {});
    const auditoriaId = String((cambios as Documento[])[0]!.id);
    // `auditar` enmascara: en la bitácora el correo viejo es `a***@…`.
    expect(((cambios as Documento[])[0]!.antes as Documento).email).toBe('a***@ejemplo.local');

    await ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId });

    // La ciudad vuelve; el correo se queda como estaba, no se convierte en la
    // máscara (que además pasaría la validación de correo sin protestar).
    expect(documentos['voluntarios/VOL-AAAA1111']).toMatchObject({
      ciudad: 'Caracas', emailNorm: 'nueva@ejemplo.local',
    });
  });

  it('deshacer no escribe una columna que hoy ya no sería editable', async () => {
    const { db, documentos, auditoriaId } = await conEdicion();
    // La bitácora guardó la fila entera; `foto_cedula` no está en `editables`,
    // así que deshacer no la toca ni la borra.
    documentos['voluntarios/VOL-AAAA1111']!.fotoCedulaPath = 'private/uid-vol/volunteers/nueva.jpg';
    await ejecutar('admin_datos_deshacer', ADMIN(db), { auditoriaId });
    expect(documentos['voluntarios/VOL-AAAA1111']).toMatchObject({
      fotoCedulaPath: 'private/uid-vol/volunteers/nueva.jpg',
    });
  });
});

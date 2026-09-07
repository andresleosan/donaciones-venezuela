import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import * as facturas from '../../functions/src/api/facturas.js';
// Registra `admin_crear_presupuesto`, con el que estas pruebas fabrican la
// factura sobre la que se denuncia.
import '../../functions/src/api/presupuestos.js';
import * as denuncias from '../../functions/src/api/denuncias.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const VIDEO = 'private/uid-vecino/reports/denuncia-1.webm';
const VIDEO_MP4 = 'private/uid-vecino/reports/denuncia-1.mp4';
const COMPROBANTE = 'private/uid-admin/receipts/c.jpg';

// Caracas, dentro de la caja de Venezuela.
const GPS = { lat: 10.5061, lng: -66.9146, precision: 12 };

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, ...extra });
}

const VECINO = (db: unknown) => contexto(db, { uid: 'uid-vecino', role: 'user' });
const OTRO = (db: unknown) => contexto(db, { uid: 'uid-otro', role: 'user' });
const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin' });

let contadorToken = 0;

beforeEach(() => {
  contadorToken = 0;
  facturas.usarGeneradorDeTokens((prefijo) => {
    contadorToken += 1;
    return `${prefijo}-TEST-0000-${String(contadorToken).padStart(4, '0')}`;
  });
  denuncias.conectarFirmadorDeVideo(vi.fn(async (ruta: string) => `https://firmada.example/${ruta}?exp=1`));
});

afterEach(() => {
  facturas.usarGeneradorDeTokens(null);
  facturas.conectarNotificador(null);
  denuncias.conectarFirmadorDeVideo(null);
});

function base(extra: Record<string, Documento> = {}) {
  return crearDb({
    'lugares/LUG-AAAA1111': {
      tipo: 'Hospital', nombre: 'Hospital Vargas', nombreNorm: 'hospital vargas',
      activo: true, actualizado: ANTES,
    },
    'indices/lugaresPorNombre/claves/hospital vargas': { valor: 'LUG-AAAA1111' },
    'tasas/actual': { efectiva: 250, diaria: 245, fuente: 'seed', fecha: ANTES.toISOString() },
    ...extra,
  });
}

// Un presupuesto sobre el que denunciar, con su token público.
async function conFactura(db: unknown) {
  const salida = await ejecutar('admin_crear_presupuesto', ADMIN(db), {
    centro: 'Hospital Vargas', insumo: 'Agua potable', tienda: 'Farmacia Sur',
    direccion: 'Av. Principal', cantidad: 500, presentacion: 'Bidón', precio: 5000,
    tiendaLat: 10.6, tiendaLng: -66.93,
  });
  return String(salida.token);
}

function denunciaDe(documentos: Record<string, Documento>, id: string): Documento {
  return documentos[`denuncias/${id}`]!;
}

// --- Helpers puros ---------------------------------------------------------------

describe('normalización', () => {
  it('un tipo fuera de lista cae a «Otro», y un estado a «Recibida»', () => {
    expect(denuncias.tipoDenuncia('Retención de insumos')).toBe('Retención de insumos');
    expect(denuncias.tipoDenuncia('lo que sea')).toBe('Otro');
    expect(denuncias.estadoDenuncia('En revisión')).toBe('En revisión');
    expect(denuncias.estadoDenuncia('inventado')).toBe('Recibida');
  });

  it('la duración se acota entre 0 y 600 s', () => {
    expect(denuncias.duracionValida(45.4)).toBe(45);
    expect(denuncias.duracionValida(-10)).toBe(0);
    expect(denuncias.duracionValida(9999)).toBe(600);
    expect(denuncias.duracionValida('nada')).toBe(0);
  });
});

describe('ruta del video', () => {
  it('solo acepta `reports` de quien graba, y solo webm o mp4', () => {
    expect(denuncias.rutaDeVideo('uid-vecino', VIDEO)).toBe(VIDEO);
    expect(denuncias.rutaDeVideo('uid-vecino', VIDEO_MP4)).toBe(VIDEO_MP4);
    expect(denuncias.rutaDeVideo('uid-vecino', 'private/uid-otro/reports/v.webm')).toBe('');
    expect(denuncias.rutaDeVideo('uid-vecino', 'private/uid-vecino/offers/v.webm')).toBe('');
    expect(denuncias.rutaDeVideo('uid-vecino', 'private/uid-vecino/reports/v.jpg')).toBe('');
    expect(denuncias.rutaDeVideo('', VIDEO)).toBe('');
  });
});

describe('fila pública', () => {
  const denuncia = denuncias.comoDenuncia({
    uid: 'uid-vecino',
    rol: 'user',
    tipo: 'Retención de insumos',
    gpsLat: 10.50612,
    gpsLng: -66.91463,
    gpsPrecision: 12,
    texto: 'Me pidieron dinero por las cajas',
    videoPath: VIDEO,
    duracionS: 45,
    facturaToken: 'DV-AAAA-BBBB-CCCC',
    estado: 'En revisión',
    createdAt: ANTES,
  });

  it('no lleva identidad, ni rol, ni texto, ni la precisión del GPS, ni la ruta del video', () => {
    const fila = denuncias.filaPublica('DEN-1', denuncia);
    const texto = JSON.stringify(fila);
    expect(texto).not.toContain('uid-vecino');
    expect(texto).not.toContain('Me pidieron');
    expect(texto).not.toContain('reports/');
    expect(texto).not.toContain('precision');
    expect(fila).toMatchObject({ id: 'DEN-1', tipo: 'Retención de insumos', estado: 'En revisión', tieneVideo: true });
  });

  it('el GPS va redondeado a ~1 km: el legado servía el punto exacto a cualquiera', () => {
    expect(denuncias.filaPublica('DEN-1', denuncia))
      .toMatchObject({ gps_lat: 10.51, gps_lng: -66.91 });
  });

  it('sin coordenadas no se inventa un punto', () => {
    const sinGps = denuncias.comoDenuncia({ videoPath: '', createdAt: ANTES });
    expect(denuncias.filaPublica('DEN-2', sinGps))
      .toMatchObject({ gps_lat: null, gps_lng: null, tieneVideo: false });
  });
});

// --- denuncia_parcial -------------------------------------------------------------

describe('denuncia_parcial', () => {
  it('el primer parcial crea la denuncia con el GPS exacto y sin video', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), {
      tipo: 'Retención de insumos', gps: GPS, duracionS: 5,
    });

    expect(String(id)).toMatch(/^DEN-[0-9A-F]{8}$/);
    expect(denunciaDe(documentos, String(id))).toMatchObject({
      uid: 'uid-vecino',
      rol: 'user',
      tipo: 'Retención de insumos',
      gpsLat: GPS.lat,
      gpsLng: GPS.lng,
      gpsPrecision: 12,
      // Solo progreso: el legado resubía el video entero cada ~5 s.
      videoPath: '',
      duracionS: 5,
      estado: 'Recibida',
      origen: 'usuario',
    });
  });

  it('los siguientes reutilizan la fila y solo adelantan el reloj', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { gps: GPS, duracionS: 5 });
    await ejecutar('denuncia_parcial', VECINO(db), { denunciaId: id, duracionS: 15 });

    expect(rutas(documentos, 'denuncias/')).toHaveLength(1);
    expect(denunciaDe(documentos, String(id))).toMatchObject({ duracionS: 15 });
  });

  it('un parcial que llega tarde no hace retroceder la duración', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { duracionS: 30 });
    await ejecutar('denuncia_parcial', VECINO(db), { denunciaId: id, duracionS: 10 });
    expect(denunciaDe(documentos, String(id))).toMatchObject({ duracionS: 30 });
  });

  it('la denuncia de otra persona no se puede continuar, y responde como si no existiera', async () => {
    const { db } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { duracionS: 5 });

    const ajena = await ejecutar('denuncia_parcial', OTRO(db), { denunciaId: id, duracionS: 10 })
      .catch((e: unknown) => e as ApiError);
    const inexistente = await ejecutar('denuncia_parcial', OTRO(db), { denunciaId: 'DEN-NADA' })
      .catch((e: unknown) => e as ApiError);

    // El mismo mensaje y el mismo código: probar ids no dice cuáles existen.
    expect((ajena as ApiError).message).toBe(denuncias.AJENA);
    expect((ajena as ApiError).status).toBe(404);
    expect((inexistente as ApiError).message).toBe(denuncias.AJENA);
  });

  it('un GPS fuera de la caja de Venezuela se ignora sin fallar', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { gps: { lat: 40.4, lng: -3.7 } });
    expect(denunciaDe(documentos, String(id))).toMatchObject({ gpsLat: null, gpsLng: null });
  });
});

// --- denuncia_crear ---------------------------------------------------------------

describe('denuncia_crear', () => {
  it('exige el video, y de la carpeta de quien envía', async () => {
    const { db } = base();
    await expect(ejecutar('denuncia_crear', VECINO(db), { texto: 'x' }))
      .rejects.toThrow('Falta el video de la denuncia');
    await expect(ejecutar('denuncia_crear', VECINO(db), { videoPath: 'private/uid-otro/reports/v.webm' }))
      .rejects.toThrow('Falta el video de la denuncia');
  });

  it('sin parcial previo crea la denuncia entera', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('denuncia_crear', VECINO(db), {
      videoPath: VIDEO, texto: 'Me pidieron dinero', tipo: 'Retención de insumos',
      gps: GPS, duracionS: 45,
    });

    expect(salida).toMatchObject({ estado: 'Recibida' });
    expect(denunciaDe(documentos, String(salida.id))).toMatchObject({
      videoPath: VIDEO, texto: 'Me pidieron dinero', duracionS: 45, uid: 'uid-vecino',
    });
  });

  it('cierra la denuncia que dejaron abierta los parciales, sin duplicarla', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { gps: GPS, duracionS: 40 });
    const salida = await ejecutar('denuncia_crear', VECINO(db), {
      denunciaId: id, videoPath: VIDEO, texto: 'El texto', duracionS: 45,
    });

    expect(salida.id).toBe(id);
    expect(rutas(documentos, 'denuncias/')).toHaveLength(1);
    expect(denunciaDe(documentos, String(id))).toMatchObject({
      videoPath: VIDEO, texto: 'El texto', duracionS: 45, createdAt: AHORA,
    });
  });

  it('enviar sin tipo ni GPS no borra los que dejó el parcial', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), {
      tipo: 'Retención de insumos', gps: GPS, duracionS: 5,
    });
    // El legado los reescribía siempre: enviar sin `tipo` convertía la denuncia
    // en «Otro» y perdía las coordenadas del sitio.
    await ejecutar('denuncia_crear', VECINO(db), { denunciaId: id, videoPath: VIDEO });

    expect(denunciaDe(documentos, String(id))).toMatchObject({
      tipo: 'Retención de insumos', gpsLat: GPS.lat, gpsLng: GPS.lng, gpsPrecision: 12,
    });
  });

  it('pero sí se aplican cuando el envío los trae', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { tipo: 'Otro', duracionS: 5 });
    await ejecutar('denuncia_crear', VECINO(db), {
      denunciaId: id, videoPath: VIDEO, tipo: 'Retención de insumos', gps: GPS,
    });

    expect(denunciaDe(documentos, String(id))).toMatchObject({
      tipo: 'Retención de insumos', gpsLat: GPS.lat,
    });
  });

  it('no pisa el estado que el admin ya cambió mientras se grababa', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { duracionS: 5 });
    await ejecutar('admin_denuncia_estado', ADMIN(db), { id, estado: 'En revisión' });

    const salida = await ejecutar('denuncia_crear', VECINO(db), { denunciaId: id, videoPath: VIDEO });
    expect(salida).toMatchObject({ estado: 'En revisión' });
    expect(denunciaDe(documentos, String(id))).toMatchObject({ estado: 'En revisión' });
  });

  it('la denuncia de otra persona no se puede cerrar', async () => {
    const { db } = base();
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { duracionS: 5 });
    await expect(ejecutar('denuncia_crear', OTRO(db), {
      denunciaId: id, videoPath: 'private/uid-otro/reports/v.webm',
    })).rejects.toThrow(denuncias.AJENA);
  });

  it('con un token de factura deja el movimiento público `denunciaRegistrada`', async () => {
    const { db, documentos } = base();
    const token = await conFactura(db);
    await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO, facturaToken: token, texto: 'algo' });

    const movimientos = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => documentos[ruta]!);
    const denuncia = movimientos.find((m) => String(m.descripcion).includes('denunciaRegistrada'));
    expect(JSON.parse(String(denuncia!.descripcion))).toEqual({ k: 'mov', c: 'denunciaRegistrada' });
    expect(denuncia).toMatchObject({ tipo: 'Denuncia', monto: 0 });

    // El movimiento es público, así que no puede llevar nada de quien denunció.
    const publica = JSON.stringify(documentos[`facturasPublicas/${token}`]);
    expect(publica).not.toContain('uid-vecino');
    expect(publica).not.toContain('algo');
  });

  it('un token que no existe no deja movimiento ni se guarda como si existiera', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('denuncia_crear', VECINO(db), {
      videoPath: VIDEO, facturaToken: 'DV-NADA-NADA-NADA',
    });
    expect(rutas(documentos, 'facturas/')).toHaveLength(0);
    expect(denunciaDe(documentos, String(salida.id))).toMatchObject({ facturaToken: 'DV-NADA-NADA-NADA' });
  });

  it('cerrar una denuncia ya creada no añade un segundo movimiento a la factura', async () => {
    const { db, documentos } = base();
    const token = await conFactura(db);
    const { id } = await ejecutar('denuncia_parcial', VECINO(db), { facturaToken: token });
    await ejecutar('denuncia_crear', VECINO(db), { denunciaId: id, videoPath: VIDEO, facturaToken: token });

    const denunciasEnFactura = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => documentos[ruta]!)
      .filter((m) => String(m.descripcion).includes('denunciaRegistrada'));
    // El parcial no anota nada y el cierre de una fila ya existente tampoco.
    expect(denunciasEnFactura).toHaveLength(0);
  });
});

// --- denuncias_listar y denuncia_video --------------------------------------------

describe('denuncias_listar', () => {
  it('devuelve la fila pública, sin identidad ni texto ni ruta', async () => {
    const { db } = base();
    await ejecutar('denuncia_crear', VECINO(db), {
      videoPath: VIDEO, texto: 'Me pidieron dinero', gps: GPS, duracionS: 45,
    });

    const { denuncias: filas } = await ejecutar('denuncias_listar', VECINO(db));
    expect(filas).toHaveLength(1);
    const texto = JSON.stringify(filas);
    expect(texto).not.toContain('uid-vecino');
    expect(texto).not.toContain('Me pidieron');
    expect(texto).not.toContain('reports/');
    expect((filas as Documento[])[0]).toMatchObject({ tieneVideo: true, gps_lat: 10.51 });
  });

  it('lo más reciente primero', async () => {
    const { db } = base();
    await ejecutar('denuncia_crear', contexto(db, { uid: 'uid-vecino', role: 'user', now: ANTES }), {
      videoPath: VIDEO, texto: 'vieja',
    });
    await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO, texto: 'nueva' });

    const { denuncias: filas } = await ejecutar('denuncias_listar', VECINO(db));
    expect((filas as Documento[]).map((d) => d.created_at))
      .toEqual([AHORA.toISOString(), ANTES.toISOString()]);
  });

  it('una denuncia sin video se lista igual, marcada como que no lo tiene', async () => {
    const { db } = base();
    await ejecutar('admin_denuncia_crear', ADMIN(db), { transportista: 'Luis', horas: 5 });
    const { denuncias: filas } = await ejecutar('denuncias_listar', VECINO(db));
    expect((filas as Documento[])[0]).toMatchObject({ tieneVideo: false });
  });
});

describe('denuncia_video', () => {
  it('firma una URL corta solo cuando alguien la pide', async () => {
    const { db } = base();
    const { id } = await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO });

    const salida = await ejecutar('denuncia_video', OTRO(db), { id });
    expect(salida.url).toBe(`https://firmada.example/${VIDEO}?exp=1`);
    // 120 s desde ahora: la lista no la trae, se pide al pulsar play.
    expect(salida.expiraEn).toBe(new Date(AHORA.getTime() + denuncias.TTL_VIDEO_MS).toISOString());
  });

  it('exige el id, y una denuncia sin video es un 404', async () => {
    const { db } = base();
    await expect(ejecutar('denuncia_video', VECINO(db), {})).rejects.toThrow('id requerido');

    const { id } = await ejecutar('admin_denuncia_crear', ADMIN(db), { transportista: 'Luis' });
    const error = await ejecutar('denuncia_video', VECINO(db), { id }).catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('un id inexistente no dice nada distinto', async () => {
    const { db } = base();
    const error = await ejecutar('denuncia_video', VECINO(db), { id: 'DEN-NADA' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).message).toBe(denuncias.AJENA);
  });
});

// --- Acciones del admin -----------------------------------------------------------

describe('admin_denuncias', () => {
  it('el admin sí ve el GPS exacto, el texto y el rol', async () => {
    const { db } = base();
    await ejecutar('denuncia_crear', VECINO(db), {
      videoPath: VIDEO, texto: 'Me pidieron dinero', gps: GPS, duracionS: 45,
    });

    const { denuncias: filas } = await ejecutar('admin_denuncias', ADMIN(db));
    expect((filas as Documento[])[0]).toMatchObject({
      uid: 'uid-vecino',
      rol: 'user',
      gps_lat: GPS.lat,
      gps_lng: GPS.lng,
      gps_precision: 12,
      texto: 'Me pidieron dinero',
      duracion_s: 45,
      estado: 'Recibida',
      tieneVideo: true,
    });
  });

  it('tampoco al admin se le entrega la ruta ni una URL: se firma al mirarla', async () => {
    const { db } = base();
    await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO });
    const { denuncias: filas } = await ejecutar('admin_denuncias', ADMIN(db));
    const fila = (filas as Documento[])[0]!;
    expect(fila.video_url).toBeUndefined();
    expect(JSON.stringify(fila)).not.toContain('reports/');
  });
});

describe('admin_denuncia_estado', () => {
  it('exige el id y responde 404 si no existe: el legado actualizaba 0 filas y decía que sí', async () => {
    const { db } = base();
    await expect(ejecutar('admin_denuncia_estado', ADMIN(db), {})).rejects.toThrow('id requerido');
    const error = await ejecutar('admin_denuncia_estado', ADMIN(db), { id: 'DEN-NADA', estado: 'Atendida' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('cambia el estado y lo audita', async () => {
    const { db, documentos } = base();
    const { id } = await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO });

    expect(await ejecutar('admin_denuncia_estado', ADMIN(db), { id, estado: 'Atendida' }))
      .toEqual({ estado: 'Atendida' });
    expect(denunciaDe(documentos, String(id))).toMatchObject({ estado: 'Atendida' });
    expect(rutas(documentos, 'auditoriaAdmin/')).toHaveLength(1);
  });

  it('un estado fuera de lista cae a `Recibida`', async () => {
    const { db } = base();
    const { id } = await ejecutar('denuncia_crear', VECINO(db), { videoPath: VIDEO });
    expect(await ejecutar('admin_denuncia_estado', ADMIN(db), { id, estado: 'archivada' }))
      .toEqual({ estado: 'Recibida' });
  });
});

describe('admin_denuncia_crear', () => {
  it('compone el texto en el servidor y queda con origen `admin`', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_denuncia_crear', ADMIN(db), {
      transportista: 'Luis Motorizado', horas: 5, tramo: 2,
    });

    expect(salida).toMatchObject({ estado: 'Recibida' });
    expect(denunciaDe(documentos, String(salida.id))).toMatchObject({
      origen: 'admin',
      rol: 'admin',
      // El legado inventaba `administracion@sistema.local`; aquí queda el uid
      // del admin que la genera, que es quien responde por ella.
      uid: 'uid-admin',
      tipo: 'Retención de insumos',
      texto: 'Generada por administración: el transportista Luis Motorizado no se reportó; retraso de 5 h en el tramo 2.',
      videoPath: '',
    });
    expect(rutas(documentos, 'auditoriaAdmin/')).toHaveLength(1);
  });

  it('con transportista vacío y tramo raro cae en los valores del legado', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('admin_denuncia_crear', ADMIN(db), { horas: 9999, tramo: 7 });
    expect(String(denunciaDe(documentos, String(salida.id)).texto))
      .toBe('Generada por administración: el transportista desconocido no se reportó; retraso de 999 h en el tramo 1.');
  });

  it('anota el movimiento en la factura denunciada', async () => {
    const { db, documentos } = base();
    const token = await conFactura(db);
    await ejecutar('admin_denuncia_crear', ADMIN(db), { facturaToken: token, transportista: 'Luis', horas: 3 });

    const movimientos = rutas(documentos, 'facturas/')
      .filter((ruta) => ruta.includes('/movimientos/'))
      .map((ruta) => documentos[ruta]!);
    expect(movimientos.some((m) => String(m.descripcion).includes('denunciaRegistrada'))).toBe(true);
    // Y el texto compuesto por el admin no sale al hilo público.
    expect(JSON.stringify(documentos[`facturasPublicas/${token}`])).not.toContain('Luis');
  });
});

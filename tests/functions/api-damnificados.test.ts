import { describe, expect, it } from 'vitest';

import { ApiError } from '../../functions/src/api/contract.js';
import type { ActionContext } from '../../functions/src/api/contract.js';
import * as damnificados from '../../functions/src/api/damnificados.js';

import { crearDb, contextoBase, ejecutar, rutas, type Documento } from './ayuda-firestore-falso.js';

const AHORA = new Date('2026-09-07T12:00:00.000Z');
const ANTES = new Date('2026-09-01T00:00:00.000Z');

const FOTO_1 = 'private/uid-vecina/families/casa-1.jpg';
const FOTO_2 = 'private/uid-vecina/families/casa-2.jpg';

function contexto(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return contextoBase(db, { now: AHORA, ...extra });
}

const ANONIMO = (db: unknown) => contexto(db, { uid: null, role: 'anon' });
const VECINA = (db: unknown) => contexto(db, { uid: 'uid-vecina', role: 'user' });
const ADMIN = (db: unknown) => contexto(db, { uid: 'uid-admin', role: 'admin' });

const FAMILIA_OK = {
  responsableNombre: 'Carmen Rodríguez',
  responsableTelefono: '04141234567',
  responsableEmail: 'carmen@ejemplo.local',
  alojamiento: 'Casa de mi hermana, calle 4',
  municipio: 'Vargas',
  estadoGeo: 'La Guaira',
  gps: { lat: 10.6, lng: -66.93 },
  integrantes: [
    { nombre: 'Carmen Rodríguez', parentesco: 'Madre', edad: 41, ocupacion: 'Costurera' },
    { nombre: 'Luis Rodríguez', parentesco: 'Hijo', edad: 9, condicionMedica: 'Asma' },
    { nombre: 'Ana Rodríguez', parentesco: 'Hija', edad: 3 },
    { nombre: 'Abuela Rosa', parentesco: 'Abuela', edad: 71 },
  ],
  fallecidos: 1,
  fallecidosDetalle: 'Mi esposo',
  perdioCasa: true,
  perdioVehiculo: true,
  vehiculosDetalle: 'Una moto',
  sustentoPrincipal: 'Costura',
  bienesPerdidos: 'Todo el mobiliario',
};

function base(extra: Record<string, Documento> = {}) {
  return crearDb({ ...extra });
}

function familiaDe(documentos: Record<string, Documento>): Documento {
  const ruta = Object.keys(documentos).find((clave) => clave.startsWith('familiasDamnificadas/'));
  return documentos[ruta!]!;
}

// --- Helpers puros ---------------------------------------------------------------

describe('integrantes', () => {
  it('descarta las filas que el formulario dejó del todo en blanco', () => {
    const lista = damnificados.integrantesDe([
      { nombre: 'Ana', parentesco: 'Hija', edad: 9 },
      { nombre: '', parentesco: '', edad: 0, notas: 'basura' },
      { nombre: '', parentesco: '', edad: 4 },
    ]);
    expect(lista.map((it) => it.nombre)).toEqual(['Ana', '']);
  });

  it('deduce `menor` de la edad, y respeta el explícito', () => {
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: 17 }).menor).toBe(true);
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: 18 }).menor).toBe(false);
    // Edad 0 es «no la dijeron», no «recién nacido»: no basta para deducirlo.
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: 0 }).menor).toBe(false);
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: 0, menor: true }).menor).toBe(true);
  });

  it('acota la edad y acepta el alias `condicion_medica`', () => {
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: 999 }).edad).toBe(120);
    expect(damnificados.comoIntegrante({ nombre: 'A', edad: -5 }).edad).toBe(0);
    expect(damnificados.comoIntegrante({ nombre: 'A', condicion_medica: 'Diabetes' }).condicionMedica)
      .toBe('Diabetes');
  });

  it('se queda con 20 integrantes como mucho', () => {
    const veinticinco = Array.from({ length: 25 }, (_, i) => ({ nombre: `P${i}`, edad: 30 }));
    expect(damnificados.integrantesDe(veinticinco)).toHaveLength(20);
  });
});

describe('rangos de edad', () => {
  it('agrupa en tramos anchos y deja fuera a quien no declaró edad', () => {
    const integrantes = damnificados.integrantesDe([
      { nombre: 'a', edad: 3 }, { nombre: 'b', edad: 9 }, { nombre: 'c', edad: 15 },
      { nombre: 'd', edad: 41 }, { nombre: 'e', edad: 71 }, { nombre: 'f', parentesco: 'Tío' },
    ]);
    expect(damnificados.rangosEdadDe(integrantes))
      .toEqual({ '0-5': 1, '6-12': 1, '13-17': 1, '18-59': 1, '60+': 1 });
  });

  it('los bordes caen donde dice la tabla', () => {
    expect(damnificados.rangoDe(5)).toBe('0-5');
    expect(damnificados.rangoDe(6)).toBe('6-12');
    expect(damnificados.rangoDe(17)).toBe('13-17');
    expect(damnificados.rangoDe(18)).toBe('18-59');
    expect(damnificados.rangoDe(60)).toBe('60+');
    expect(damnificados.rangoDe(0)).toBeNull();
  });
});

describe('vista pública de una familia', () => {
  const familia = damnificados.comoFamilia({
    codigo: 'FAM-AAAA1111',
    responsableNombre: 'Carmen Rodríguez',
    responsableTelefono: '04141234567',
    responsableEmail: 'carmen@ejemplo.local',
    alojamiento: 'Casa de mi hermana, calle 4',
    municipio: 'Vargas',
    estadoGeo: 'La Guaira',
    gpsLat: 10.6,
    gpsLng: -66.93,
    integrantes: FAMILIA_OK.integrantes,
    numMenores: 2,
    fallecidos: 1,
    fallecidosDetalle: 'Mi esposo',
    perdioCasa: true,
    fotosPath: [FOTO_1],
    estado: 'nuevo',
    createdAt: ANTES,
  });

  it('no lleva un solo nombre, ni el teléfono, ni el alojamiento, ni el GPS, ni las fotos', () => {
    const publico = damnificados.documentoPublico(familia);
    const texto = JSON.stringify(publico);
    expect(texto).not.toContain('Carmen');
    expect(texto).not.toContain('04141234567');
    expect(texto).not.toContain('calle 4');
    expect(texto).not.toContain('10.6');
    expect(texto).not.toContain('families/');
    expect(texto).not.toContain('Mi esposo');
    expect(texto).not.toContain('Asma');
  });

  it('las condiciones médicas salen como un booleano, y las edades en rangos', () => {
    const publico = damnificados.documentoPublico(familia);
    expect(publico).toMatchObject({
      codigo: 'FAM-AAAA1111',
      municipio: 'Vargas',
      estadoGeo: 'La Guaira',
      necesidadMedica: true,
      perdioFamiliar: true,
      rangosEdad: { '0-5': 1, '6-12': 1, '13-17': 0, '18-59': 1, '60+': 1 },
    });
  });

  it('sin fallecidos ni condiciones, los dos booleanos son falsos', () => {
    const sencilla = damnificados.comoFamilia({
      codigo: 'FAM-BBBB2222',
      integrantes: [{ nombre: 'Solo', edad: 30 }],
      fallecidos: 0,
      createdAt: ANTES,
    });
    expect(damnificados.documentoPublico(sencilla))
      .toMatchObject({ perdioFamiliar: false, necesidadMedica: false });
  });
});

// --- damnificado_registrar --------------------------------------------------------

describe('damnificado_registrar', () => {
  it('el honeypot finge éxito y no escribe nada', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('damnificado_registrar', ANONIMO(db), { ...FAMILIA_OK, web: 'bot' });

    expect(salida).toEqual({ codigo: damnificados.CODIGO_TRAMPA, ok: true });
    expect(rutas(documentos, 'familiasDamnificadas/')).toHaveLength(0);
    expect(rutas(documentos, 'familiasPublicas/')).toHaveLength(0);
  });

  it('exige el nombre de quien registra', async () => {
    const { db } = base();
    await expect(ejecutar('damnificado_registrar', ANONIMO(db), { ...FAMILIA_OK, responsableNombre: '' }))
      .rejects.toThrow('Falta el nombre de quien registra a la familia');
  });

  it('se registra SIN sesión: es el formulario de quien acaba de perder su casa', async () => {
    const { db, documentos } = base();
    const salida = await ejecutar('damnificado_registrar', ANONIMO(db), FAMILIA_OK);

    expect(String(salida.codigo)).toMatch(/^FAM-[0-9A-F]{8}$/);
    expect(salida).toMatchObject({ numPersonas: 4, numMenores: 2 });
    expect(documentos[`familiasDamnificadas/${salida.codigo}`]).toMatchObject({
      responsableNombre: 'Carmen Rodríguez', municipio: 'Vargas', estado: 'nuevo', authUid: '',
    });
  });

  it('el código ES el id del documento, y también el de la vista pública', async () => {
    const { db, documentos } = base();
    const { codigo } = await ejecutar('damnificado_registrar', ANONIMO(db), FAMILIA_OK);
    expect(rutas(documentos, 'familiasDamnificadas/')).toEqual([`familiasDamnificadas/${codigo}`]);
    expect(rutas(documentos, 'familiasPublicas/')).toEqual([`familiasPublicas/${codigo}`]);
    expect(documentos[`familiasPublicas/${codigo}`]).toMatchObject({ codigo });
  });

  it('la vista pública que se escribe no filtra la PII', async () => {
    const { db, documentos } = base();
    const { codigo } = await ejecutar('damnificado_registrar', ANONIMO(db), FAMILIA_OK);
    const texto = JSON.stringify(documentos[`familiasPublicas/${codigo}`]);
    expect(texto).not.toContain('Carmen');
    expect(texto).not.toContain('04141234567');
    expect(texto).not.toContain('Asma');
    expect(texto).not.toContain('10.6');
  });

  it('sin sesión las fotos se descartan, con sesión se guardan las propias', async () => {
    const sin = base();
    const a = await ejecutar('damnificado_registrar', ANONIMO(sin.db), { ...FAMILIA_OK, fotosPath: [FOTO_1] });
    expect(familiaDe(sin.documentos).fotosPath).toEqual([]);

    const con = base();
    const b = await ejecutar('damnificado_registrar', VECINA(con.db), {
      ...FAMILIA_OK, fotosPath: [FOTO_1, FOTO_2, 'private/uid-otra/families/x.jpg'],
    });
    expect(familiaDe(con.documentos).fotosPath).toEqual([FOTO_1, FOTO_2]);
    expect(familiaDe(con.documentos).authUid).toBe('uid-vecina');
    expect(String(a.codigo)).not.toBe(String(b.codigo));
  });

  it('unas coordenadas ausentes no colocan a la familia en el golfo de Guinea', async () => {
    const { db, documentos } = base();
    await ejecutar('damnificado_registrar', ANONIMO(db), { ...FAMILIA_OK, gps: { lat: null, lng: null } });
    expect(familiaDe(documentos)).toMatchObject({ gpsLat: null, gpsLng: null });

    const otra = base();
    await ejecutar('damnificado_registrar', ANONIMO(otra.db), { ...FAMILIA_OK, gps: null });
    expect(familiaDe(otra.documentos)).toMatchObject({ gpsLat: null, gpsLng: null });
  });

  it('acepta coordenadas de fuera de Venezuela: la familia pudo ser acogida en otro país', async () => {
    const { db, documentos } = base();
    await ejecutar('damnificado_registrar', ANONIMO(db), { ...FAMILIA_OK, gps: { lat: 4.71, lng: -74.07 } });
    expect(familiaDe(documentos)).toMatchObject({ gpsLat: 4.71, gpsLng: -74.07 });
  });

  it('acota los fallecidos y respeta los valores por defecto de las pérdidas', async () => {
    const { db, documentos } = base();
    await ejecutar('damnificado_registrar', ANONIMO(db), {
      responsableNombre: 'Solo', fallecidos: 500,
    });
    expect(familiaDe(documentos)).toMatchObject({
      fallecidos: 99,
      // `perdioCasa` es cierto salvo que se diga que no; `perdioVehiculo` al revés.
      perdioCasa: true,
      perdioVehiculo: false,
      numPersonas: 0,
    });
  });
});

// --- Acciones del admin -----------------------------------------------------------

describe('admin_damnificados', () => {
  it('devuelve la ficha entera con las RUTAS de las fotos, no URLs firmadas', async () => {
    const { db, documentos } = base();
    const { codigo } = await ejecutar('damnificado_registrar', VECINA(db), { ...FAMILIA_OK, fotosPath: [FOTO_1] });

    const { familias } = await ejecutar('admin_damnificados', ADMIN(db));
    const fila = (familias as Documento[])[0]!;
    expect(fila).toMatchObject({
      id: codigo,
      codigo,
      responsable_nombre: 'Carmen Rodríguez',
      responsable_telefono: '04141234567',
      num_personas: 4,
      num_menores: 2,
      fallecidos: 1,
      estado: 'nuevo',
      fotos: [FOTO_1],
    });
    // Nada de `fotos_urls`: el legado firmaba hasta 300 × 12 URLs por apertura.
    expect(fila.fotos_urls).toBeUndefined();
    expect((fila.integrantes as Documento[])[1]).toMatchObject({ condicion_medica: 'Asma' });
    expect(documentos[`familiasDamnificadas/${codigo}`]).toBeDefined();
  });

  it('lo más reciente primero', async () => {
    const { db } = base();
    await ejecutar('damnificado_registrar', contexto(db, { uid: null, role: 'anon', now: ANTES }), {
      responsableNombre: 'Vieja',
    });
    await ejecutar('damnificado_registrar', ANONIMO(db), { responsableNombre: 'Nueva' });

    const { familias } = await ejecutar('admin_damnificados', ADMIN(db));
    expect((familias as Documento[]).map((f) => f.responsable_nombre)).toEqual(['Nueva', 'Vieja']);
  });
});

describe('admin_damnificado_estado', () => {
  it('exige el id y responde 404 si no existe: el legado actualizaba 0 filas y decía que sí', async () => {
    const { db } = base();
    await expect(ejecutar('admin_damnificado_estado', ADMIN(db), {})).rejects.toThrow('id requerido');
    const error = await ejecutar('admin_damnificado_estado', ADMIN(db), { id: 'FAM-NADA', estado: 'atendido' })
      .catch((e: unknown) => e as ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('cambia el estado, lo republica y lo audita', async () => {
    const { db, documentos } = base();
    const { codigo } = await ejecutar('damnificado_registrar', ANONIMO(db), FAMILIA_OK);

    const salida = await ejecutar('admin_damnificado_estado', ADMIN(db), { id: codigo, estado: 'contactado' });
    expect(salida).toEqual({ estado: 'contactado' });
    expect(documentos[`familiasDamnificadas/${codigo}`]).toMatchObject({ estado: 'contactado' });
    expect(documentos[`familiasPublicas/${codigo}`]).toMatchObject({ estado: 'contactado' });
    expect(rutas(documentos, 'auditoriaAdmin/')).toHaveLength(1);
  });

  it('un estado fuera de lista cae a `nuevo`, como el legado', async () => {
    const { db } = base();
    const { codigo } = await ejecutar('damnificado_registrar', ANONIMO(db), FAMILIA_OK);
    const salida = await ejecutar('admin_damnificado_estado', ADMIN(db), { id: codigo, estado: 'inventado' });
    expect(salida).toEqual({ estado: 'nuevo' });
  });

  it('cambiar el estado no reabre la PII en la vista pública', async () => {
    const { db, documentos } = base();
    const { codigo } = await ejecutar('damnificado_registrar', VECINA(db), { ...FAMILIA_OK, fotosPath: [FOTO_1] });
    await ejecutar('admin_damnificado_estado', ADMIN(db), { id: codigo, estado: 'atendido' });

    const texto = JSON.stringify(documentos[`familiasPublicas/${codigo}`]);
    expect(texto).not.toContain('Carmen');
    expect(texto).not.toContain('families/');
    // Y la ficha canónica sigue completa.
    expect(documentos[`familiasDamnificadas/${codigo}`]).toMatchObject({
      responsableNombre: 'Carmen Rodríguez', fotosPath: [FOTO_1],
    });
  });
});

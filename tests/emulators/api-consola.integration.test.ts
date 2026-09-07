import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims } from './entorno.js';

// Consola de datos del admin contra el Emulator Suite.
//
// Lo que ninguna prueba en proceso cubre: que la consola sea solo del admin de
// verdad (rol por claims, no por un campo del cuerpo); que un centro editado
// desde ahi quede igual en la ficha y en el directorio publico, que es lo que se
// lee sin sesion; y que borrarlo arrastre de verdad la subcoleccion, el indice
// de unicidad y la proyeccion, cosas que Firestore no hace sola.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `consola-${crypto.randomUUID()}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, EMULADORES.auth, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULADORES.firestore.host, EMULADORES.firestore.port);
  return { auth, db };
}

async function cuenta(sesion: Auth, etiqueta: string): Promise<User> {
  const correo = `${etiqueta}-${crypto.randomUUID()}@prueba.local`;
  const { user } = await createUserWithEmailAndPassword(sesion, correo, 'prueba1234');
  creados.push(user);
  return user;
}

async function llamar(accion: string, datos: Record<string, unknown>, idToken?: string) {
  const respuesta = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGEN,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ accion, ...datos }),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, unknown> };
}

afterEach(async () => {
  for (const usuario of creados.splice(0)) {
    try {
      await deleteUser(usuario);
    } catch { /* la cuenta pudo quedar sin sesion */ }
  }
  try {
    if (auth) await signOut(auth);
  } finally {
    if (app) await deleteApp(app);
    app = undefined;
    auth = undefined;
    db = undefined;
  }
});

it('crea, edita y borra un centro dejando el directorio público al día', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const admin = await cuenta(sesion, 'con-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const otro = await cuenta(sesion, 'con-otro');
  const tokenOtro = await otro.getIdToken();

  // 1. La consola es del admin, y el rol sale de los claims.
  expect((await llamar('admin_datos_entidades', {})).estado).toBe(401);
  expect((await llamar('admin_datos_entidades', {}, tokenOtro)).estado).toBe(403);
  const catalogo = await llamar('admin_datos_entidades', {}, tokenAdmin);
  expect(catalogo.estado).toBe(200);
  const ids = (catalogo.cuerpo.entidades as Array<Record<string, unknown>>).map((e) => e.id);
  expect(ids).toContain('lugares');
  // Nada de facturas, denuncias ni la propia bitácora.
  for (const prohibida of ['facturas', 'denuncias', 'familiasDamnificadas', 'auditoriaAdmin']) {
    expect(ids).not.toContain(prohibida);
  }

  // 2. Crear un centro por la consola hace lo mismo que `registrar_lugar`.
  const nombre = `PRUEBA · Refugio ${crypto.randomUUID().slice(0, 8)}`;
  const creado = await llamar('admin_datos_crear', {
    entidad: 'lugares',
    campos: { tipo: 'Refugio', nombre, ubicacion: 'PRUEBA · Catia', telefono: '04141234567', lat: 10.5, lng: -66.9 },
  }, tokenAdmin);
  expect(creado.estado).toBe(200);
  const lugarId = String((creado.cuerpo.fila as Record<string, unknown>).id);

  // La ficha pública se lee SIN sesión, bajo las reglas.
  const publica = await getDoc(doc(firestore, 'lugaresPublicos', lugarId));
  expect(publica.exists()).toBe(true);
  expect(publica.data()).toMatchObject({ nombre, tipo: 'Refugio', activo: true, gestionado: false });

  // 3. Un insumo dentro del centro, y la ficha pública lo recoge.
  const insumo = await llamar('admin_datos_crear', {
    entidad: 'insumos',
    campos: {
      lugar_id: lugarId, nombre: 'PRUEBA · Mantas', categoria: 'Refugio', estado: 'Necesita',
      cantidad_necesaria: 50, cantidad_recibida: 10, urgencia: 'Alta', unidad: 'unidades',
    },
  }, tokenAdmin);
  expect(insumo.estado).toBe(200);
  const insumoId = String((insumo.cuerpo.fila as Record<string, unknown>).id);
  expect(insumoId.startsWith(`${lugarId}/`)).toBe(true);

  const conInsumo = (await getDoc(doc(firestore, 'lugaresPublicos', lugarId))).data() as Record<string, unknown>;
  expect((conInsumo.necesita as Array<Record<string, unknown>>).map((i) => i.nombre)).toContain('PRUEBA · Mantas');

  // 4. Renombrar mueve la reserva del nombre y republica el directorio.
  const nuevoNombre = `${nombre} (2)`;
  expect((await llamar('admin_datos_editar', {
    entidad: 'lugares', id: lugarId, campos: { nombre: nuevoNombre },
  }, tokenAdmin)).cuerpo).toMatchObject({ cambiados: ['nombre'] });

  expect((await getDoc(doc(firestore, 'lugaresPublicos', lugarId))).data())
    .toMatchObject({ nombre: nuevoNombre });
  // El nombre viejo queda libre: registrarlo otra vez crea un centro distinto.
  const reusado = await llamar('registrar_lugar', {
    nombre, tipo: 'Centro', ubicacion: 'PRUEBA · Otro sitio',
    insumo: 'Agua', categoria: 'Alimentos', estado: 'Necesita', cantidad: 1,
  });
  expect(reusado.estado).toBe(200);
  expect(String(reusado.cuerpo.lugarId ?? reusado.cuerpo.id ?? '')).not.toBe(lugarId);

  // 5. La ficha da las RUTAS de las fotos, no URLs firmadas.
  const ficha = await llamar('admin_datos_ficha', { entidad: 'lugares', id: lugarId }, tokenAdmin);
  expect(ficha.cuerpo.fotos).toEqual([]);
  expect(ficha.cuerpo.dependientes).toEqual([{ etiqueta: 'insumos', cuantos: 1, modo: 'cascade' }]);

  // 6. Borrar exige teclear el nombre, y arrastra la subcolección, el índice y
  //    la proyección: Firestore no tiene `on delete cascade`.
  expect((await llamar('admin_datos_borrar', {
    entidad: 'lugares', id: lugarId, confirmar: 'no es el nombre',
  }, tokenAdmin)).cuerpo).toMatchObject({ error: 'Escribe el nombre del registro para confirmar el borrado' });

  const borrado = await llamar('admin_datos_borrar', {
    entidad: 'lugares', id: lugarId, confirmar: nuevoNombre,
  }, tokenAdmin);
  expect(borrado.estado).toBe(200);
  expect(borrado.cuerpo.dependientes).toEqual([{ etiqueta: 'insumos', cuantos: 1, modo: 'cascade' }]);

  expect((await getDoc(doc(firestore, 'lugaresPublicos', lugarId))).exists()).toBe(false);
  const restos = await llamar('admin_datos_listar', { entidad: 'insumos', porPagina: 100 }, tokenAdmin);
  expect((restos.cuerpo.filas as Array<Record<string, unknown>>).map((f) => f.id)).not.toContain(insumoId);

  // 7. La bitácora guarda los tres cambios, y `auditoriaAdmin` está cerrada al
  //    cliente aunque el admin la lea por la Function.
  const bitacora = await llamar('admin_bitacora', { entidad: 'lugares' }, tokenAdmin);
  const acciones = (bitacora.cuerpo.cambios as Array<Record<string, unknown>>)
    .filter((c) => c.fila_id === lugarId)
    .map((c) => c.accion);
  expect(acciones).toEqual(['borrar', 'editar', 'crear']);
  await expect(getDocs(query(collection(firestore, 'auditoriaAdmin'), limit(10))))
    .rejects.toMatchObject({ code: 'permission-denied' });
}, 120000);

it('avisa de duplicados, valida por columna y deshace una edición', async () => {
  const { auth: sesion } = arrancar();

  const admin = await cuenta(sesion, 'dup-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const marca = crypto.randomUUID().slice(0, 8);
  const correo = `duplicado-${marca}@prueba.local`;

  const base = {
    nombre: `PRUEBA · Ana ${marca}`, apellido: 'Pérez', email: correo, telefono: '04141234567',
    ciudad: 'Caracas', estado: '', profesion: 'Enfermera', disponibilidad: '',
    medio_transporte: '', observaciones: '',
  };

  const primero = await llamar('admin_datos_crear', { entidad: 'voluntarios', campos: base }, tokenAdmin);
  expect(primero.estado).toBe(200);
  const id = String((primero.cuerpo.fila as Record<string, unknown>).id);

  // 1. El duplicado sale ANTES de escribir, y con `success: true`: el cliente lo
  //    distingue por la ausencia de `fila`.
  const duplicado = await llamar('admin_datos_crear', {
    entidad: 'voluntarios', campos: { ...base, email: correo.toUpperCase() },
  }, tokenAdmin);
  expect(duplicado.estado).toBe(200);
  expect(duplicado.cuerpo.fila).toBeUndefined();
  expect((duplicado.cuerpo.duplicados as Array<Record<string, unknown>>)[0])
    .toMatchObject({ id, porque: 'email' });

  // 2. Cada error nombra su columna, que es lo que lee el formulario.
  expect((await llamar('admin_datos_crear', {
    entidad: 'voluntarios', campos: { ...base, email: 'esto-no-es-un-correo' },
  }, tokenAdmin)).cuerpo).toMatchObject({ error: 'email: correo electrónico inválido' });

  expect((await llamar('admin_datos_editar', {
    entidad: 'voluntarios', id, campos: { telefono: '123' },
  }, tokenAdmin)).cuerpo).toMatchObject({ error: 'telefono: teléfono demasiado corto' });

  // 3. Una columna que no está en la lista blanca se rechaza, no se ignora.
  expect((await llamar('admin_datos_editar', {
    entidad: 'voluntarios', id, campos: { authUid: 'me-hago-admin' },
  }, tokenAdmin)).cuerpo)
    .toMatchObject({ error: 'Ese dato no se puede editar desde aquí: authUid' });

  // 4. Editar, y deshacer desde la bitácora.
  expect((await llamar('admin_datos_editar', {
    entidad: 'voluntarios', id, campos: { ciudad: 'Maracay' },
  }, tokenAdmin)).estado).toBe(200);
  expect((await llamar('admin_datos_ficha', { entidad: 'voluntarios', id }, tokenAdmin)).cuerpo.fila)
    .toMatchObject({ ciudad: 'Maracay' });

  const bitacora = await llamar('admin_bitacora', { entidad: 'voluntarios' }, tokenAdmin);
  const edicion = (bitacora.cuerpo.cambios as Array<Record<string, unknown>>)
    .find((c) => c.fila_id === id && c.accion === 'editar')!;
  expect(edicion).toMatchObject({ actor_uid: admin.uid });

  const deshecho = await llamar('admin_datos_deshacer', { auditoriaId: edicion.id }, tokenAdmin);
  expect(deshecho.estado).toBe(200);
  expect(deshecho.cuerpo.fila).toMatchObject({ ciudad: 'Caracas' });

  // 5. Un deshacer no se deshace.
  const conDeshacer = await llamar('admin_bitacora', { entidad: 'voluntarios' }, tokenAdmin);
  const elDeshacer = (conDeshacer.cuerpo.cambios as Array<Record<string, unknown>>)
    .find((c) => c.accion === 'deshacer' && c.fila_id === id)!;
  expect((await llamar('admin_datos_deshacer', { auditoriaId: elDeshacer.id }, tokenAdmin)).cuerpo)
    .toMatchObject({ error: 'Solo se puede deshacer una edición' });

  // 6. La búsqueda encuentra sin acentos y no tiene comodines que romper.
  const encontrado = await llamar('admin_datos_listar', {
    entidad: 'voluntarios', busca: 'perez', porPagina: 100,
  }, tokenAdmin);
  expect((encontrado.cuerpo.filas as Array<Record<string, unknown>>).map((f) => f.id)).toContain(id);
  expect((await llamar('admin_datos_listar', { entidad: 'voluntarios', busca: '%' }, tokenAdmin)).cuerpo.total)
    .toBe(0);

  // 7. Y el duplicado se puede forzar, que es lo que hace el botón de la consola.
  const forzado = await llamar('admin_datos_crear', {
    entidad: 'voluntarios', campos: { ...base, email: correo }, forzar: true,
  }, tokenAdmin);
  expect(forzado.estado).toBe(200);
  expect(forzado.cuerpo.fila).toBeDefined();

  const grupos = await llamar('admin_datos_duplicados', { entidad: 'voluntarios' }, tokenAdmin);
  const porCorreo = (grupos.cuerpo.grupos as Array<Record<string, unknown>>)
    .find((g) => g.clave === correo.toLowerCase());
  expect((porCorreo!.filas as unknown[]).length).toBe(2);
}, 120000);

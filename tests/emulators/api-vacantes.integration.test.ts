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
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims } from './entorno.js';

// Ciclo completo de una vacante contra el Emulator Suite: crearla como admin,
// verla publicada SIN sesion (que es como la lee el directorio), pedir su
// contacto con sesion, cubrirla y comprobar que desaparece del directorio y deja
// de repartir contactos. Lo que ninguna prueba en proceso cubre es ese salto por
// las reglas de Firestore.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `vacantes-${crypto.randomUUID()}`);
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

it('publica la vacante, reparte el contacto con sesión y la retira al cubrirla', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const persona = await cuenta(sesion, 'vac-user');
  const tokenUsuario = await persona.getIdToken();

  // Sin rol admin, crear una vacante es 403: el despachador corta antes del
  // dominio. Es la primera mitad del contrato de la accion.
  const sinPermiso = await llamar('admin_crear_vacante', {
    lugarNombre: 'PRUEBA · Hospital', rol: 'Enfermería', cantidad: 2,
  }, tokenUsuario);
  expect(sinPermiso.estado).toBe(403);

  // Y sin sesion, 401.
  const anonimo = await llamar('admin_crear_vacante', {
    lugarNombre: 'PRUEBA · Hospital', rol: 'Enfermería', cantidad: 2,
  });
  expect(anonimo.estado).toBe(401);

  // El resto del ciclo necesita un admin de verdad. El rol vive en el ID token,
  // asi que se acuna en el emulador y se fuerza la renovacion del token.
  const admin = await cuenta(sesion, 'vac-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const rol = `PRUEBA · Rol ${crypto.randomUUID().slice(0, 8)}`;
  const creada = await llamar('admin_crear_vacante', {
    lugarNombre: 'PRUEBA · Zona Catia',
    lugarTipo: 'Zona de derrumbe',
    rol,
    cantidad: 2,
    ubicacion: 'Catia',
    descripcion: 'PRUEBA · Apoyo en remoción',
    urgencia: 'Alta',
    turno: 'Mañana',
    telefono: '04141234567',
  }, tokenAdmin);

  expect(creada.estado).toBe(200);
  const id = String(creada.cuerpo.id);
  expect(id).toMatch(/^VAC-[0-9A-F]{8}$/);

  // El directorio la lee sin sesion, bajo las reglas, y no ve el telefono.
  const publicada = await getDoc(doc(firestore, 'vacantesPublicas', id));
  expect(publicada.exists()).toBe(true);
  const datos = publicada.data() as Record<string, unknown>;
  expect(datos).toMatchObject({
    rol, lugarNombre: 'PRUEBA · Zona Catia', lugarTipo: 'Zona de derrumbe',
    cantidadNecesaria: 2, cantidadCubierta: 0, cuposFaltantes: 2,
    tieneContacto: true, estado: 'Abierta',
  });
  expect(JSON.stringify(datos)).not.toContain('04141234567');

  // La ficha canonica no se lee desde el cliente.
  await expect(getDoc(doc(firestore, 'vacantes', id)))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // El contacto exige sesion y se entrega de uno en uno.
  const contactoAnonimo = await llamar('contactar_vacante', { id });
  expect(contactoAnonimo.estado).toBe(401);

  const contacto = await llamar('contactar_vacante', { id }, tokenUsuario);
  expect(contacto.estado).toBe(200);
  expect(contacto.cuerpo).toMatchObject({ rol, telefono: '04141234567' });

  // Registrar un cubierto la mantiene abierta y actualiza la proyeccion.
  const parcial = await llamar('admin_actualizar_vacante', { id, cantidadCubierta: 1 }, tokenAdmin);
  expect(parcial.estado).toBe(200);
  expect(parcial.cuerpo).toMatchObject({ estado: 'Abierta', cantidadCubierta: 1, cuposFaltantes: 1 });
  expect((await getDoc(doc(firestore, 'vacantesPublicas', id))).data())
    .toMatchObject({ cantidadCubierta: 1, cuposFaltantes: 1 });

  // Cubrirla la cierra sola y la retira del directorio: el legado dejaba eso a
  // mano y una vacante llena se seguia anunciando.
  const cubierta = await llamar('admin_actualizar_vacante', { id, cantidadCubierta: 5 }, tokenAdmin);
  expect(cubierta.estado).toBe(200);
  expect(cubierta.cuerpo).toMatchObject({ estado: 'Cubierta', cantidadCubierta: 2, cuposFaltantes: 0 });
  expect((await getDoc(doc(firestore, 'vacantesPublicas', id))).exists()).toBe(false);

  // Y deja de repartir contactos: el puesto ya no existe.
  const contactoCerrado = await llamar('contactar_vacante', { id }, tokenUsuario);
  expect(contactoCerrado.estado).toBe(404);

  // El listado del admin si la sigue viendo, con su telefono.
  const listado = await llamar('admin_listar_vacantes', {}, tokenAdmin);
  expect(listado.estado).toBe(200);
  const fila = (listado.cuerpo.vacantes as Array<Record<string, unknown>>).find((v) => v.id === id);
  expect(fila).toMatchObject({
    rol, estado: 'Cubierta', cantidad_cubierta: 2, telefono: '04141234567',
  });
}, 30000);

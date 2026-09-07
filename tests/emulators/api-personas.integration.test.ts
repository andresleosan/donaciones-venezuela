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

import { DEMO_FIREBASE_CONFIG, EMULADORES } from './entorno.js';

// Flujo principal del dominio contra el Emulator Suite de verdad. Lo que ninguna
// prueba en proceso puede cubrir es el otro lado de la frontera: que la
// proyeccion publica se lea SIN sesion bajo las reglas, y que las colecciones
// canonicas (con cedulas, telefonos y el registro de personas buscadas) no se
// lean nunca desde el cliente.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `personas-${crypto.randomUUID()}`);
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

it('registra un voluntario, lo publica solo con consentimiento y nunca su ficha', async () => {
  const { auth: sesion, db: firestore } = arrancar();
  const usuario = await cuenta(sesion, 'vol');
  const uid = usuario.uid;
  const correo = usuario.email!;
  const token = await usuario.getIdToken();

  const alta = await llamar('registrar_voluntario', {
    nombre: 'PRUEBA · Ana',
    apellido: 'Pérez',
    email: correo,
    telefono: '04141234567',
    ciudad: 'Caracas',
    profesion: 'Enfermería',
    fotoCedulaPath: `private/${uid}/volunteers/cedula.jpg`,
  }, token);

  expect(alta.estado).toBe(200);
  const id = String(alta.cuerpo.id);
  expect(id).toMatch(/^VOL-[0-9A-F]{8}$/);

  // Registrarse NO publica: el perfil publico es consentimiento v1.
  expect((await getDoc(doc(firestore, 'voluntariosPublicos', id))).exists()).toBe(false);

  const consentido = await llamar('voluntario_consentimiento', {
    volunteerId: id, enabled: true, consentVersion: 'volunteer-public-v1',
  }, token);
  expect(consentido.estado).toBe(200);

  // Ahora si, y legible sin sesion, que es como lo lee el directorio.
  const publicado = await getDoc(doc(firestore, 'voluntariosPublicos', id));
  expect(publicado.exists()).toBe(true);
  const datos = publicado.data() as Record<string, unknown>;
  expect(datos).toMatchObject({ nombre: 'PRUEBA · Ana', activo: true });
  const serializado = JSON.stringify(datos);
  expect(serializado).not.toContain(correo);
  expect(serializado).not.toContain('04141234567');
  expect(serializado).not.toContain('cedula');

  // La ficha canonica no se lee desde el cliente en ningun caso.
  await expect(getDoc(doc(firestore, 'voluntarios', id)))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // El correo queda reservado: una segunda cuenta no puede repetirlo.
  const otra = await cuenta(sesion, 'vol2');
  const repetido = await llamar('registrar_voluntario', {
    nombre: 'PRUEBA · Otra',
    email: correo,
    telefono: '04141234567',
    fotoCedulaPath: `private/${otra.uid}/volunteers/cedula.jpg`,
  }, await otra.getIdToken());
  expect(repetido.estado).toBe(409);
}, 30000);

it('publica al transportista sin teléfono y lo entrega solo con sesión', async () => {
  const { auth: sesion, db: firestore } = arrancar();
  const usuario = await cuenta(sesion, 'mot');
  const uid = usuario.uid;
  const token = await usuario.getIdToken();

  const alta = await llamar('registrar_motorizado', {
    nombre: 'PRUEBA · Luis',
    email: usuario.email,
    telefono: '04241112233',
    tipoVehiculo: 'Moto',
    zonaOperacion: 'Catia',
    placa: 'AB123CD',
    fotoPlacaPath: `private/${uid}/drivers/placa.jpg`,
    fotoVehiculoPath: `private/${uid}/drivers/vehiculo.jpg`,
    fotoCedulaPath: `private/${uid}/drivers/cedula.jpg`,
  }, token);

  expect(alta.estado).toBe(200);
  const id = String(alta.cuerpo.id);

  const publicado = await getDoc(doc(firestore, 'motorizadosPublicos', id));
  expect(publicado.exists()).toBe(true);
  const datos = publicado.data() as Record<string, unknown>;
  expect(datos).toMatchObject({
    nombre: 'PRUEBA · Luis', zona: 'Catia', tipoVehiculo: 'Moto', tieneContacto: true,
  });
  const serializado = JSON.stringify(datos);
  expect(serializado).not.toContain('04241112233');
  expect(serializado).not.toContain('AB123CD');

  // El numero se pide de uno en uno y exige sesion.
  const anonimo = await llamar('contactar_motorizado', { id });
  expect(anonimo.estado).toBe(401);

  const conSesion = await llamar('contactar_motorizado', { id }, token);
  expect(conSesion.estado).toBe(200);
  expect(conSesion.cuerpo).toMatchObject({ nombre: 'PRUEBA · Luis', telefono: '04241112233' });

  // `acceso_perfil` resuelve el rol por el indice de correos, no por el cuerpo.
  const perfil = await llamar('acceso_perfil', {}, token);
  expect(perfil.estado).toBe(200);
  expect(perfil.cuerpo).toMatchObject({
    email: usuario.email,
    roles: [{ tipo: 'transportista', nombre: 'PRUEBA · Luis' }],
  });
}, 30000);

it('reporta una persona en anónimo y solo la deja buscar con sesión', async () => {
  const { auth: sesion, db: firestore } = arrancar();
  const nombre = `PRUEBA · Ramírez ${crypto.randomUUID().slice(0, 8)}`;

  const reporte = await llamar('reportar_persona', {
    nombre,
    cedula: 'V-12.345.678',
    estado: 'Hospitalizado',
    ubicacion: 'Última vez: Catia',
    contacto: '04121112233',
    fuente: 'Registro hospitalario',
  });

  expect(reporte.estado).toBe(200);
  const id = String(reporte.cuerpo.id);

  // El registro de personas buscadas no se lee desde el cliente: la unica
  // salida es `buscar_familiar`, y esa exige sesion.
  await expect(getDoc(doc(firestore, 'personas', id)))
    .rejects.toMatchObject({ code: 'permission-denied' });

  const anonimo = await llamar('buscar_familiar', { q: nombre });
  expect(anonimo.estado).toBe(401);

  const usuario = await cuenta(sesion, 'busca');
  const token = await usuario.getIdToken();

  const corta = await llamar('buscar_familiar', { q: 'ram' }, token);
  expect(corta.estado).toBe(400);
  expect(corta.cuerpo.error).toBe('escribe al menos 4 caracteres');

  const encontrado = await llamar('buscar_familiar', { q: nombre }, token);
  expect(encontrado.estado).toBe(200);
  const personas = encontrado.cuerpo.personas as Array<Record<string, unknown>>;
  expect(personas).toHaveLength(1);
  expect(Object.keys(personas[0]!).sort()).toEqual(
    ['actualizado', 'cedulaCoincide', 'estado', 'nombre', 'verificada'],
  );
  expect(personas[0]).toMatchObject({ nombre, estado: 'Hospitalizado', verificada: false });

  // La cedula solo se compara por igualdad exacta y nunca vuelve.
  const porCedula = await llamar('buscar_familiar', { q: '12345678' }, token);
  const coincidencias = (porCedula.cuerpo.personas as Array<Record<string, unknown>>)
    .filter((persona) => persona.nombre === nombre);
  expect(coincidencias).toHaveLength(1);
  expect(coincidencias[0]).toMatchObject({ cedulaCoincide: true });
  expect(JSON.stringify(porCedula.cuerpo)).not.toContain('12345678');
}, 30000);

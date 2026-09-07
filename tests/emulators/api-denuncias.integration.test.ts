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
  where,
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims } from './entorno.js';

// Denuncias y familias damnificadas contra el Emulator Suite.
//
// Lo que ninguna prueba en proceso cubre: que `denuncias` y `familiasDamnificadas`
// sean ilegibles desde el cliente aunque lleven el video, el GPS exacto y los
// nombres de menores; que `familiasPublicas` SI se lea sin sesion y salga sin un
// solo nombre; y que la lista de denuncias exija una sesion de verdad.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `denuncias-${crypto.randomUUID()}`);
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

it('registra una familia sin sesión y publica un resumen sin un solo nombre', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const admin = await cuenta(sesion, 'fam-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const municipio = `PRUEBA · Vargas ${crypto.randomUUID().slice(0, 8)}`;

  // 1. El honeypot finge éxito sin escribir.
  const trampa = await llamar('damnificado_registrar', {
    web: 'soy-un-bot', responsableNombre: 'PRUEBA · Bot', municipio,
  });
  expect(trampa.estado).toBe(200);
  expect(trampa.cuerpo).toMatchObject({ codigo: 'FAM-000000', ok: true });

  // 2. Se registra SIN sesión: es el formulario de quien acaba de perder su casa.
  const registrada = await llamar('damnificado_registrar', {
    responsableNombre: 'PRUEBA · Carmen Rodríguez',
    responsableTelefono: '04141234567',
    alojamiento: 'PRUEBA · Casa de mi hermana, calle 4',
    municipio,
    estadoGeo: 'La Guaira',
    gps: { lat: 10.6, lng: -66.93 },
    integrantes: [
      { nombre: 'PRUEBA · Carmen Rodríguez', parentesco: 'Madre', edad: 41 },
      { nombre: 'PRUEBA · Luis', parentesco: 'Hijo', edad: 9, condicionMedica: 'Asma' },
      { nombre: 'PRUEBA · Ana', parentesco: 'Hija', edad: 3 },
    ],
    fallecidos: 1,
    fallecidosDetalle: 'PRUEBA · Mi esposo',
  });
  expect(registrada.estado).toBe(200);
  expect(registrada.cuerpo).toMatchObject({ numPersonas: 3, numMenores: 2 });
  const codigo = String(registrada.cuerpo.codigo);

  // 3. La vista pública se lee SIN sesión, bajo las reglas, y no lleva PII.
  const publica = await getDoc(doc(firestore, 'familiasPublicas', codigo));
  expect(publica.exists()).toBe(true);
  const vista = publica.data() as Record<string, unknown>;
  expect(vista).toMatchObject({
    codigo, municipio, estadoGeo: 'La Guaira', numPersonas: 3, numMenores: 2,
    necesidadMedica: true, perdioFamiliar: true, estado: 'nuevo',
  });
  expect(vista.rangosEdad).toMatchObject({ '0-5': 1, '6-12': 1, '18-59': 1 });

  const texto = JSON.stringify(vista);
  expect(texto).not.toContain('Carmen');
  expect(texto).not.toContain('04141234567');
  expect(texto).not.toContain('calle 4');
  expect(texto).not.toContain('Asma');
  expect(texto).not.toContain('Mi esposo');
  expect(texto).not.toContain('10.6');

  // 4. Y la ficha canónica está cerrada a cal y canto para el cliente.
  await expect(getDoc(doc(firestore, 'familiasDamnificadas', codigo)))
    .rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getDocs(query(collection(firestore, 'familiasDamnificadas'), limit(10))))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // 5. Solo el admin ve la ficha completa, y con las RUTAS de las fotos.
  expect((await llamar('admin_damnificados', {})).estado).toBe(401);
  const consola = await llamar('admin_damnificados', {}, tokenAdmin);
  expect(consola.estado).toBe(200);
  const fila = (consola.cuerpo.familias as Array<Record<string, unknown>>).find((f) => f.codigo === codigo);
  expect(fila).toMatchObject({
    responsable_nombre: 'PRUEBA · Carmen Rodríguez',
    responsable_telefono: '04141234567',
    fallecidos: 1,
    estado: 'nuevo',
  });
  expect(fila!.fotos_urls).toBeUndefined();

  // 6. Cambiar el estado se refleja en la vista pública sin reabrir la PII.
  expect((await llamar('admin_damnificado_estado', { id: codigo, estado: 'contactado' }, tokenAdmin)).cuerpo)
    .toMatchObject({ estado: 'contactado' });
  const despues = (await getDoc(doc(firestore, 'familiasPublicas', codigo))).data() as Record<string, unknown>;
  expect(despues).toMatchObject({ estado: 'contactado' });
  expect(JSON.stringify(despues)).not.toContain('Carmen');

  // 7. La lista pública se puede consultar acotada, como hace la página.
  const acotada = await getDocs(query(
    collection(firestore, 'familiasPublicas'),
    where('municipio', '==', municipio),
    limit(50),
  ));
  expect(acotada.docs.some((documento) => documento.id === codigo)).toBe(true);
}, 90000);

it('guarda una denuncia con su video privado y no la sirve a nadie sin sesión', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const admin = await cuenta(sesion, 'den-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const vecino = await cuenta(sesion, 'den-vecino');
  const tokenVecino = await vecino.getIdToken();
  const otro = await cuenta(sesion, 'den-otro');
  const tokenOtro = await otro.getIdToken();

  // 1. Denunciar exige sesión, aquí y al listar.
  expect((await llamar('denuncia_parcial', { duracionS: 5 })).estado).toBe(401);
  expect((await llamar('denuncias_listar', {})).estado).toBe(401);

  // 2. El primer parcial abre la denuncia. NO sube video: el legado resubía el
  //    vídeo entero cada ~5 s para acabar sustituyéndolo otra vez al enviar.
  const parcial = await llamar('denuncia_parcial', {
    tipo: 'Retención de insumos',
    gps: { lat: 10.5061, lng: -66.9146, precision: 12 },
    duracionS: 5,
  }, tokenVecino);
  expect(parcial.estado).toBe(200);
  const id = String(parcial.cuerpo.id);

  // La de otra persona no se puede continuar, y responde como si no existiera.
  const ajena = await llamar('denuncia_parcial', { denunciaId: id, duracionS: 10 }, tokenOtro);
  expect(ajena.estado).toBe(404);
  expect(ajena.cuerpo).toMatchObject({ error: 'Denuncia no encontrada' });

  // 3. Al enviar se adjunta el vídeo, que vive en `private/<uid>/reports/`.
  const creada = await llamar('denuncia_crear', {
    denunciaId: id,
    videoPath: `private/${vecino.uid}/reports/denuncia.webm`,
    texto: 'PRUEBA · Me pidieron dinero por las cajas',
    duracionS: 45,
  }, tokenVecino);
  expect(creada.estado).toBe(200);
  expect(creada.cuerpo).toMatchObject({ id, estado: 'Recibida' });

  // 4. La colección canónica está cerrada al cliente: lleva el vídeo, el GPS
  //    exacto y quién denunció.
  await expect(getDoc(doc(firestore, 'denuncias', id)))
    .rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getDocs(query(collection(firestore, 'denuncias'), limit(10))))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // 5. La lista, con sesión, no lleva identidad, ni texto, ni la ruta del vídeo,
  //    y el GPS va redondeado a ~1 km (el legado servía el punto exacto, y a
  //    cualquiera, sin sesión).
  const listado = await llamar('denuncias_listar', {}, tokenOtro);
  expect(listado.estado).toBe(200);
  const publica = (listado.cuerpo.denuncias as Array<Record<string, unknown>>).find((d) => d.id === id);
  expect(publica).toMatchObject({ tipo: 'Retención de insumos', estado: 'Recibida', tieneVideo: true });
  expect(publica).toMatchObject({ gps_lat: 10.51, gps_lng: -66.91 });
  const texto = JSON.stringify(publica);
  expect(texto).not.toContain(vecino.uid);
  expect(texto).not.toContain('Me pidieron');
  expect(texto).not.toContain('reports/');

  // 6. El admin sí ve el GPS exacto y el texto, pero tampoco la ruta.
  const consola = await llamar('admin_denuncias', {}, tokenAdmin);
  const completa = (consola.cuerpo.denuncias as Array<Record<string, unknown>>).find((d) => d.id === id);
  expect(completa).toMatchObject({
    uid: vecino.uid, gps_lat: 10.5061, gps_precision: 12,
    texto: 'PRUEBA · Me pidieron dinero por las cajas', duracion_s: 45,
  });
  expect(completa!.video_url).toBeUndefined();

  // 7. El estado lo cambia solo el admin.
  expect((await llamar('admin_denuncia_estado', { id, estado: 'En revisión' }, tokenVecino)).estado).toBe(403);
  expect((await llamar('admin_denuncia_estado', { id, estado: 'En revisión' }, tokenAdmin)).cuerpo)
    .toMatchObject({ estado: 'En revisión' });

  // 8. Y el admin puede generar una denuncia sin vídeo, con el texto compuesto
  //    en el servidor.
  const generada = await llamar('admin_denuncia_crear', {
    transportista: 'PRUEBA · Luis', horas: 5, tramo: 2,
  }, tokenAdmin);
  expect(generada.estado).toBe(200);
  const sinVideo = (await llamar('denuncias_listar', {}, tokenOtro)).cuerpo.denuncias as Array<Record<string, unknown>>;
  expect(sinVideo.find((d) => d.id === generada.cuerpo.id)).toMatchObject({ tieneVideo: false });
}, 90000);

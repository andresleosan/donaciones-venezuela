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

import { DEMO_FIREBASE_CONFIG, EMULADORES } from './entorno.js';

const normalizar = (texto: string) => texto
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

// Flujo principal del dominio contra el Emulator Suite de verdad: crear un
// centro con una cuenta, ver su panel con el claim recien emitido, registrar un
// insumo y comprobar que la proyeccion publica queda legible SIN sesion (que es
// como la lee el directorio). Ninguna prueba en proceso cubre ese ultimo salto:
// ahi es donde las reglas de Firestore pueden decir que no.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let usuario: User | undefined;

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `lugares-${crypto.randomUUID()}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, EMULADORES.auth, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULADORES.firestore.host, EMULADORES.firestore.port);
  return { auth, db };
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
  try {
    if (usuario) await deleteUser(usuario);
  } catch { /* el usuario pudo quedar sin sesion */ }
  try {
    if (auth) await signOut(auth);
  } finally {
    if (app) await deleteApp(app);
    app = undefined;
    auth = undefined;
    db = undefined;
    usuario = undefined;
  }
});

it('crea un centro con la cuenta, opera su panel y lo publica', async () => {
  const { auth: sesion, db: firestore } = arrancar();
  const correo = `panel-${crypto.randomUUID()}@prueba.local`;
  const credenciales = await createUserWithEmailAndPassword(sesion, correo, 'prueba1234');
  usuario = credenciales.user;
  const uid = usuario.uid;
  const nombre = `PRUEBA · Centro ${crypto.randomUUID().slice(0, 8)}`;

  // 1. Crear el centro. Las fotos ya estan subidas: la accion recibe el `path`.
  const creado = await llamar('panel_crear', {
    nombre,
    tipo: 'Refugio',
    ubicacion: 'Catia',
    telefono: '04141234567',
    email: correo,
    fotoCedulaPath: `private/${uid}/centers/cedula.jpg`,
    fotoSitioPath: `private/${uid}/centers/sitio.jpg`,
    lat: 10.52,
    lng: -66.95,
  }, await usuario.getIdToken());

  expect(creado.estado).toBe(200);
  expect(creado.cuerpo).toMatchObject({ success: true, nombre });
  expect(creado.cuerpo).not.toHaveProperty('token');
  const lugarId = String(creado.cuerpo.lugarId);

  // 2. El claim `panelLugarId` acaba de emitirse: sin forzar la renovacion, el
  // ID token en memoria no lo lleva y el panel responderia 403.
  const conClaim = await usuario.getIdToken(true);
  const panel = await llamar('panel_ver', {}, conClaim);

  expect(panel.estado).toBe(200);
  expect(panel.cuerpo).toMatchObject({
    success: true,
    lugar: { id: lugarId, nombre, tipo: 'Refugio', ubicacion: 'Catia' },
    insumos: [],
  });

  // 3. Registrar una necesidad desde el panel.
  const insumo = await llamar('panel_insumo', {
    insumoNombre: 'Agua potable',
    categoria: 'Alimentos',
    estado: 'Necesita',
    urgencia: 'Alta',
    cantidadNecesaria: 200,
    cantidadRecibida: 50,
  }, conClaim);

  expect(insumo.estado).toBe(200);
  expect((insumo.cuerpo.insumos as Array<Record<string, unknown>>)[0]).toMatchObject({
    nombre: 'Agua potable', cantidad_necesaria: 200, cantidad_recibida: 50,
  });

  // 4. El directorio publico lee la proyeccion SIN sesion, bajo las reglas.
  const publicado = await getDoc(doc(firestore, 'lugaresPublicos', lugarId));

  expect(publicado.exists()).toBe(true);
  const datos = publicado.data() as Record<string, unknown>;
  expect(datos).toMatchObject({
    nombre,
    nombreNorm: normalizar(nombre),
    tipo: 'Refugio',
    ubicacionPublica: 'Catia',
    contactoPublico: '04141234567',
    activo: true,
    // Un centro con panel se marca como gestionado en el directorio.
    gestionado: true,
  });
  expect(datos.necesita).toEqual([expect.objectContaining({
    nombre: 'Agua potable', porcentaje: 25, yaCubierto: false, unidad: 'unidades',
  })]);
  // Ni el telefono crudo ni las fotos del expediente salen a lo publico.
  expect(datos).not.toHaveProperty('telefono');
  expect(JSON.stringify(datos)).not.toContain('cedula');
}, 30000);

it('rechaza el panel sin sesion y sin centro asignado', async () => {
  const { auth: sesion } = arrancar();
  const correo = `sin-centro-${crypto.randomUUID()}@prueba.local`;
  const credenciales = await createUserWithEmailAndPassword(sesion, correo, 'prueba1234');
  usuario = credenciales.user;

  const anonimo = await llamar('panel_ver', {});
  expect(anonimo.estado).toBe(401);

  // Una cuenta recien creada no tiene el claim `role: 'panel'`, asi que la corta
  // el despachador antes de llegar al dominio. El mensaje es el generico de
  // permisos; el mensaje 'Tu cuenta no tiene un centro asignado' queda para quien
  // SI tiene rol pero apunta a un centro que ya no existe (prueba de contrato).
  // La UI trata cualquier 403 igual: muestra `panel.noAccess`.
  const sinCentro = await llamar('panel_ver', {}, await usuario.getIdToken());
  expect(sinCentro.estado).toBe(403);
  expect(sinCentro.cuerpo).toEqual({ success: false, error: 'No tienes permiso para esta accion' });
}, 30000);

it('registra un lugar de forma anonima, lo publica y no filtra el indice', async () => {
  const { db: firestore } = arrancar();
  const nombre = `PRUEBA · Punto ${crypto.randomUUID().slice(0, 8)}`;

  const alta = await llamar('registrar_lugar', {
    nombre,
    // Etiquetas del formulario publico, fuera de las enumeraciones canonicas.
    tipo: 'Punto de ayuda',
    ubicacion: 'La Vega',
    insumo: 'Colchonetas',
    categoria: 'Otros',
    estado: 'Tiene disponible',
  });

  expect(alta.estado).toBe(200);
  expect(alta.cuerpo).toEqual({ success: true });

  const encontrados = await getDocs(query(
    collection(firestore, 'lugaresPublicos'),
    where('nombreNorm', '==', normalizar(nombre)),
    limit(50),
  ));

  expect(encontrados.size).toBe(1);
  const datos = encontrados.docs[0]!.data() as Record<string, unknown>;
  // 'Punto de ayuda' -> 'Centro' y 'Tiene disponible' -> 'Disponible': el legado
  // publicaba una oferta de insumos como si fuera una necesidad.
  expect(datos.tipo).toBe('Centro');
  expect(datos.necesita).toEqual([]);
  expect(datos.tieneDisponible).toEqual([expect.objectContaining({ nombre: 'Colchonetas' })]);

  // El indice de unicidad es interno: las reglas lo deniegan al cliente. El
  // emulador devuelve la traza de la regla como mensaje, asi que se comprueba el
  // codigo, que es lo estable.
  await expect(getDoc(doc(firestore, `indices/lugaresPorNombre/claves/${normalizar(nombre)}`)))
    .rejects.toMatchObject({ code: 'permission-denied' });
}, 30000);

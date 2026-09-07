// Identidad del proyecto de pruebas, en un solo sitio.
//
// Existia una costura real: el cliente apuntaba a `<proyecto>.firebasestorage.app`,
// las pruebas de emulador cableaban `<proyecto>.appspot.com` y Functions resolvia
// un tercer valor con el bucket por defecto. Nadie cubria el punto de union.
// Ahora el bucket se declara aqui y en `functions/.env.<proyecto>`, y una prueba
// comprueba que ambos coinciden.
export const DEMO_PROJECT_ID = 'demo-donaciones-venezuela';

// El emulador de Storage sirve el nombre historico `.appspot.com` para un
// proyecto demo; el proyecto real usa el nombre moderno `.firebasestorage.app`.
export const DEMO_STORAGE_BUCKET = `${DEMO_PROJECT_ID}.appspot.com`;

export const DEMO_FIREBASE_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
  projectId: DEMO_PROJECT_ID,
  storageBucket: DEMO_STORAGE_BUCKET,
  messagingSenderId: 'demo-sender-id',
  appId: 'demo-app-id',
};

export const EMULADORES = {
  auth: 'http://127.0.0.1:9099',
  functions: `http://127.0.0.1:5001/${DEMO_PROJECT_ID}/us-east1`,
  firestore: { host: '127.0.0.1', port: 8080 },
  storage: { host: '127.0.0.1', port: 9199 },
} as const;

// Concede claims a una cuenta del emulador de Auth.
//
// El emulador no ejecuta Admin SDK dentro de la prueba, pero expone la misma API
// de Identity Toolkit autenticada con el token literal `owner`. Sin esto no hay
// forma de probar una accion `admin` de punta a punta: `authenticateRequest` lee
// el rol del ID token, no de una variable de la prueba.
//
// Tras llamarla hay que pedir `getIdToken(true)`: el token en memoria se emitio
// antes de los claims y el despachador responderia 403.
export async function darClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
  const url = `${EMULADORES.auth}/identitytoolkit.googleapis.com/v1/projects/${DEMO_PROJECT_ID}/accounts:update`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
  });
  if (!respuesta.ok) {
    throw new Error(`no se pudieron asignar claims (${respuesta.status}): ${await respuesta.text()}`);
  }
}

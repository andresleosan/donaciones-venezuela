// Configuracion publica del Firebase Web SDK.
// Los valores reales deben venir de variables VITE_* en el entorno de build.
//
// Cada campo se resuelve al leerlo, no al evaluar el modulo: Vite inyecta el
// bundle en el <head>, asi que `js/entorno.js` (que define DV_ENTORNO) se
// ejecuta despues. Con getters, la sobrescritura de entorno sigue valiendo.

const buildConfig = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

function valorConfig(claveEntorno, claveVite) {
  const runtimeConfig = globalThis.DV_ENTORNO?.firebaseConfig ?? {};
  return buildConfig[claveVite] || runtimeConfig[claveEntorno] || '';
}

export const firebaseConfig = Object.freeze({
  get apiKey() { return valorConfig('apiKey', 'VITE_FIREBASE_API_KEY'); },
  get authDomain() { return valorConfig('authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'); },
  get projectId() { return valorConfig('projectId', 'VITE_FIREBASE_PROJECT_ID'); },
  get storageBucket() { return valorConfig('storageBucket', 'VITE_FIREBASE_STORAGE_BUCKET'); },
  get messagingSenderId() { return valorConfig('messagingSenderId', 'VITE_FIREBASE_MESSAGING_SENDER_ID'); },
  get appId() { return valorConfig('appId', 'VITE_FIREBASE_APP_ID'); },
});

export function validateFirebaseConfig(config = firebaseConfig) {
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Configuracion Firebase incompleta: ${missing.join(', ')}`);
  }
  return config;
}

let appPromise;

export async function getFirebaseApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const { getApps, getApp, initializeApp } = await import('firebase/app');
      const config = validateFirebaseConfig();
      return getApps().length > 0 ? getApp() : initializeApp(config);
    })();
  }
  return appPromise;
}

// --- Emulator Suite ---------------------------------------------------------
//
// Cada servicio se crea UNA sola vez y aqui: `getFirestore(app)` devuelve
// siempre la misma instancia, y `connectFirestoreEmulator` sobre una instancia
// ya conectada (o ya usada) lanza. Por eso ningun modulo llama a `getFirestore`,
// `getAuth` ni `getStorage` por su cuenta.
//
// Se activa con `window.DV_ENTORNO.emuladores` (booleano u objeto con puertos) o
// con `VITE_FIREBASE_EMULATORS` en el build. Los puertos por defecto son los de
// `firebase.json`.

export const EMULADORES_POR_DEFECTO = Object.freeze({
  firestore: Object.freeze({ host: '127.0.0.1', port: 8080 }),
  auth: Object.freeze({ host: '127.0.0.1', port: 9099 }),
  storage: Object.freeze({ host: '127.0.0.1', port: 9199 }),
});

const HOST_LOCAL = /^(127\.0\.0\.1|::1|localhost)$/;

export function configuracionEmuladores() {
  const runtime = globalThis.DV_ENTORNO?.emuladores;
  const elegido = runtime === undefined ? buildConfig.VITE_FIREBASE_EMULATORS : runtime;
  if (!elegido || elegido === 'false' || elegido === '0') return null;

  const config = typeof elegido === 'object'
    ? { ...EMULADORES_POR_DEFECTO, ...elegido }
    : { ...EMULADORES_POR_DEFECTO };

  // Un emulador fuera de la maquina local no es un emulador: es un servidor
  // ajeno hablando por Firebase. Mejor romper que autenticar contra el.
  for (const [servicio, { host }] of Object.entries(config)) {
    if (!HOST_LOCAL.test(String(host))) {
      throw new Error(`Emulador ${servicio} fuera de la maquina local: ${host}`);
    }
  }
  return config;
}

let firestorePromise;
let authPromise;
let storagePromise;

export async function getFirestoreDb() {
  if (!firestorePromise) {
    firestorePromise = (async () => {
      const app = await getFirebaseApp();
      const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
      const db = getFirestore(app);
      const emuladores = configuracionEmuladores();
      if (emuladores) connectFirestoreEmulator(db, emuladores.firestore.host, emuladores.firestore.port);
      return db;
    })();
  }
  return firestorePromise;
}

export async function getAuthInstance() {
  if (!authPromise) {
    authPromise = (async () => {
      const app = await getFirebaseApp();
      const { getAuth, connectAuthEmulator } = await import('firebase/auth');
      const auth = getAuth(app);
      const emuladores = configuracionEmuladores();
      if (emuladores) {
        connectAuthEmulator(auth, `http://${emuladores.auth.host}:${emuladores.auth.port}`, { disableWarnings: true });
      }
      return auth;
    })();
  }
  return authPromise;
}

export async function getStorageInstance() {
  if (!storagePromise) {
    storagePromise = (async () => {
      const app = await getFirebaseApp();
      const { getStorage, connectStorageEmulator } = await import('firebase/storage');
      const storage = getStorage(app);
      const emuladores = configuracionEmuladores();
      if (emuladores) connectStorageEmulator(storage, emuladores.storage.host, emuladores.storage.port);
      return storage;
    })();
  }
  return storagePromise;
}

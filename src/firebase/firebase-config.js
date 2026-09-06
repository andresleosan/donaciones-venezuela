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

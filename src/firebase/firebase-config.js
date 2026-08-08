// Configuracion publica del Firebase Web SDK.
// Los valores reales deben venir de variables VITE_* en el entorno de build.

const runtimeConfig = globalThis.DV_ENTORNO?.firebaseConfig ?? {};
const buildConfig = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const firebaseConfig = Object.freeze({
  apiKey: buildConfig.VITE_FIREBASE_API_KEY || runtimeConfig.apiKey || '',
  authDomain: buildConfig.VITE_FIREBASE_AUTH_DOMAIN || runtimeConfig.authDomain || '',
  projectId: buildConfig.VITE_FIREBASE_PROJECT_ID || runtimeConfig.projectId || '',
  storageBucket: buildConfig.VITE_FIREBASE_STORAGE_BUCKET || runtimeConfig.storageBucket || '',
  messagingSenderId: buildConfig.VITE_FIREBASE_MESSAGING_SENDER_ID || runtimeConfig.messagingSenderId || '',
  appId: buildConfig.VITE_FIREBASE_APP_ID || runtimeConfig.appId || '',
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

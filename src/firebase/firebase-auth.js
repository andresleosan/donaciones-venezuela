import { browserLocalPersistence, browserSessionPersistence, inMemoryPersistence, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirebaseApp } from './firebase-config.js';

let authPromise;

async function getFirebaseAuth() {
  if (!authPromise) {
    authPromise = getFirebaseApp().then(async (app) => {
      const { getAuth } = await import('firebase/auth');
      return getAuth(app);
    });
  }
  return authPromise;
}

export async function configureAuthPersistence(mode = 'local') {
  const persistence = {
    local: browserLocalPersistence,
    session: browserSessionPersistence,
    none: inMemoryPersistence,
  }[mode];
  if (!persistence) throw new Error(`Persistencia Firebase no soportada: ${mode}`);
  await setPersistence(await getFirebaseAuth(), persistence);
}

export async function observeAuth(callback, errorCallback) {
  if (typeof callback !== 'function') throw new TypeError('callback debe ser una funcion');
  return onAuthStateChanged(await getFirebaseAuth(), callback, errorCallback);
}

export async function signIn(email, password) {
  const result = await signInWithEmailAndPassword(await getFirebaseAuth(), email, password);
  return result.user;
}

export async function register(email, password) {
  const result = await createUserWithEmailAndPassword(await getFirebaseAuth(), email, password);
  return result.user;
}

export async function signOut() {
  await firebaseSignOut(await getFirebaseAuth());
}

export async function getIdToken(forceRefresh = false) {
  const user = (await getFirebaseAuth()).currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}

export async function getCurrentUser() {
  return (await getFirebaseAuth()).currentUser;
}

export async function getIdTokenResult(forceRefresh = false) {
  const user = await getCurrentUser();
  return user ? user.getIdTokenResult(forceRefresh) : null;
}

export { getFirebaseAuth };

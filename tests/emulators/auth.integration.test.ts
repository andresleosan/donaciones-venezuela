import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG } from './entorno.js';

const firebaseConfig = DEMO_FIREBASE_CONFIG;
const authEmulatorUrl = 'http://127.0.0.1:9099';
const authSessionUrl = 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/authSession';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let createdUser: User | undefined;

function createEmulatorAuth(): Auth {
  app = initializeApp(firebaseConfig, `auth-integration-${crypto.randomUUID()}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  return auth;
}

afterEach(async () => {
  const currentAuth = auth;
  const currentUser = createdUser;
  const currentApp = app;
  let cleanupError: unknown;

  try {
    if (currentAuth) await signOut(currentAuth);
  } catch (error) {
    cleanupError = error;
  } finally {
    try {
      if (currentUser) await deleteUser(currentUser);
    } catch (error) {
      cleanupError ??= error;
    } finally {
      try {
        if (currentApp) await deleteApp(currentApp);
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  createdUser = undefined;
  auth = undefined;
  app = undefined;
  if (cleanupError) throw cleanupError;
});

describe('Auth y authSession en Emulator Suite', () => {
  it('registra, inicia sesion, obtiene token y responde la sesion autenticada', async () => {
    const emulatorAuth = createEmulatorAuth();
    const email = `auth-${crypto.randomUUID()}@example.test`;
    const password = 'Password-1234!';
    const credential = await createUserWithEmailAndPassword(emulatorAuth, email, password);
    createdUser = credential.user;

    await signOut(emulatorAuth);
    const signedInCredential = await signInWithEmailAndPassword(emulatorAuth, email, password);
    const token = await signedInCredential.user.getIdToken();
    const response = await fetch(authSessionUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: credential.user.uid, role: 'user' });
  });

  it('rechaza authSession sin token', async () => {
    createEmulatorAuth();

    const response = await fetch(authSessionUrl);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication required' },
    });
  });
});

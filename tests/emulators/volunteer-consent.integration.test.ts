import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
const require = createRequire(import.meta.url);
const adminModule = resolve(process.cwd(), 'functions/node_modules/firebase-admin/lib');
const { getAuth: getAdminAuth } = require(resolve(adminModule, 'auth/index.js'));
const { getApps, initializeApp: initializeAdminApp } = require(resolve(adminModule, 'app/index.js'));

const projectId = 'demo-donaciones-venezuela';
const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: `${projectId}.appspot.com`,
  messagingSenderId: 'demo-sender-id',
  appId: 'demo-app-id',
};
const authEmulatorUrl = 'http://127.0.0.1:9099';
const consentUrl = `http://127.0.0.1:5001/${projectId}/us-east1/setVolunteerPublicConsent`;
const volunteerId = 'volunteer-1';
const password = 'Password-1234!';

let rulesEnv: RulesTestEnvironment;
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let createdUsers: User[] = [];

function createEmulatorApp(name: string): { app: FirebaseApp; auth: Auth; firestore: Firestore } {
  const emulatorApp = initializeApp(firebaseConfig, `${name}-${crypto.randomUUID()}`);
  const emulatorAuth = getAuth(emulatorApp);
  const emulatorFirestore = getFirestore(emulatorApp);
  connectAuthEmulator(emulatorAuth, authEmulatorUrl, { disableWarnings: true });
  connectFirestoreEmulator(emulatorFirestore, '127.0.0.1', 8080);
  return { app: emulatorApp, auth: emulatorAuth, firestore: emulatorFirestore };
}

async function createUser(emailPrefix: string): Promise<User> {
  if (!auth) throw new Error('test auth is not initialized');
  const credential = await createUserWithEmailAndPassword(
    auth,
    `${emailPrefix}-${crypto.randomUUID()}@example.test`,
    password,
  );
  createdUsers.push(credential.user);
  return credential.user;
}

async function setRole(uid: string, role: 'panel' | 'admin'): Promise<void> {
  await getAdminAuth().setCustomUserClaims(uid, { role });
}

async function idToken(user: User): Promise<string> {
  await signInWithEmailAndPassword(auth!, user.email!, password);
  return user.getIdToken(true);
}

async function deleteCreatedUsers(currentAuth: Auth, users: User[]): Promise<void> {
  for (const user of users) {
    await signInWithEmailAndPassword(currentAuth, user.email!, password);
    await deleteUser(currentAuth.currentUser!);
  }
}

async function callConsent(token: string, enabled: boolean) {
  return fetch(consentUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      volunteerId,
      enabled,
      consentVersion: 'volunteer-public-v1',
    }),
  });
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  if (getApps().length === 0) initializeAdminApp({ projectId });

  rulesEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firebase/firestore.rules', 'utf8'),
    },
  });
});

beforeEach(() => {
  ({ app, auth, firestore } = createEmulatorApp('volunteer-consent-integration'));
});

afterEach(async () => {
  let cleanupError: unknown;
  const currentAuth = auth;
  const currentUsers = [...createdUsers];
  const currentApp = app;

  try {
    if (currentAuth) await signOut(currentAuth);
  } catch (error) {
    cleanupError = error;
  } finally {
    try {
      if (currentAuth) await deleteCreatedUsers(currentAuth, currentUsers);
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

  createdUsers = [];
  app = undefined;
  auth = undefined;
  firestore = undefined;
  if (cleanupError) throw cleanupError;
});

afterAll(async () => {
  if (rulesEnv) await rulesEnv.cleanup();
});

describe('consentimiento publico de voluntarios en Emulator Suite', () => {
  it('activa atomico, revoca atomico y conserva el perfil privado', async () => {
    const owner = await createUser('volunteer');
    const panel = await createUser('panel');
    const admin = await createUser('admin');
    await setRole(panel.uid, 'panel');
    await setRole(admin.uid, 'admin');

    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `voluntarios/${volunteerId}`), {
        authUid: owner.uid,
        activo: true,
        nombre: 'Ana Demo',
        zona: 'Este',
        habilidades: ['salud'],
        createdAt: '2026-08-11T12:00:00.000Z',
        email: owner.email,
        telefono: '000-0000000',
        fotoPath: 'private/voluntarios/volunteer-1/foto.jpg',
      });
    });

    const ownerResponse = await callConsent(await idToken(owner), true);
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toEqual({
      success: true,
      enabled: true,
      volunteerId,
    });

    const publicSnapshot = await getDoc(doc(firestore!, `voluntariosPublicos/${volunteerId}`));
    expect(publicSnapshot.exists()).toBe(true);
    expect(Object.keys(publicSnapshot.data()!).sort()).toEqual([
      'activo',
      'createdAt',
      'habilidades',
      'nombre',
      'zona',
    ]);
    expect(JSON.stringify(publicSnapshot.data())).not.toMatch(/foto|email|telefono|authUid|token/i);

    const adminResponse = await callConsent(await idToken(admin), false);
    expect(adminResponse.status).toBe(200);
    expect((await getDoc(doc(firestore!, `voluntariosPublicos/${volunteerId}`))).exists()).toBe(false);

    let privateSnapshot;
    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      privateSnapshot = await getDoc(doc(context.firestore(), `voluntarios/${volunteerId}`));
    });
    expect(privateSnapshot.data()).toMatchObject({
      authUid: owner.uid,
      email: owner.email,
      telefono: '000-0000000',
      fotoPath: 'private/voluntarios/volunteer-1/foto.jpg',
      publicProfileConsent: { enabled: false, revokedByUid: admin.uid },
    });

    let auditSnapshot;
    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      auditSnapshot = await getDocs(collection(context.firestore(), 'auditoriaAdmin'));
    });
    expect(auditSnapshot?.empty).toBe(false);
    const auditId = auditSnapshot?.docs[0]?.id;
    expect(auditId).toBeTruthy();
    await assertFails(getDoc(doc(firestore!, `auditoriaAdmin/${auditId}`)));
  });

  it('rechaza activacion administrativa y revocacion de otro titular', async () => {
    const owner = await createUser('volunteer');
    const panel = await createUser('panel');
    const admin = await createUser('admin');
    const otherUser = await createUser('other');
    await setRole(panel.uid, 'panel');
    await setRole(admin.uid, 'admin');

    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `voluntarios/${volunteerId}`), {
        authUid: owner.uid,
        activo: true,
        nombre: 'Ana Demo',
        zona: 'Este',
        habilidades: ['salud'],
        createdAt: '2026-08-11T12:00:00.000Z',
      });
    });

    for (const actor of [panel, admin]) {
      const response = await callConsent(await idToken(actor), true);
      expect(response.status).toBe(403);
    }

    const otherResponse = await callConsent(await idToken(otherUser), false);
    expect(otherResponse.status).toBe(403);
  });
});

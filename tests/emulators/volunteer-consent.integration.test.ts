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
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  applyConsentTransaction,
  setVolunteerPublicConsentHandler,
} from '../../functions/src/volunteers/public-consent-http.js';
const require = createRequire(import.meta.url);
const adminModule = resolve(process.cwd(), 'functions/node_modules/firebase-admin/lib');
const { getAuth: getAdminAuth } = require(resolve(adminModule, 'auth/index.js'));
const { getFirestore: getAdminFirestore } = require(resolve(adminModule, 'firestore/index.js'));
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
const password = 'Password-1234!';

let rulesEnv: RulesTestEnvironment;
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let createdUsers: User[] = [];
let volunteerId: string;

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

function createResponse() {
  const result: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
  const res = {
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
    },
  };
  return { res, result };
}

async function seedPrivateProfile(authUid: string, includePrivateFields = true): Promise<void> {
  await rulesEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `voluntarios/${volunteerId}`), {
      authUid,
      activo: true,
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: ['salud'],
      createdAt: '2026-08-11T12:00:00.000Z',
      ...(includePrivateFields ? {
        email: 'volunteer@example.test',
        telefono: '000-0000000',
        fotoPath: `private/voluntarios/${volunteerId}/foto.jpg`,
      } : {}),
    });
  });
}

async function readPrivateConsent(): Promise<unknown> {
  let privateSnapshot;
  await rulesEnv.withSecurityRulesDisabled(async (context) => {
    privateSnapshot = await getDoc(doc(context.firestore(), `voluntarios/${volunteerId}`));
  });
  return privateSnapshot.data()?.publicProfileConsent ?? null;
}

async function readAuditCount(): Promise<number> {
  return (await getAdminFirestore().collection('auditoriaAdmin')
    .where('entidadId', '==', volunteerId)
    .get()).size;
}

async function readAdminAudit(actorUid: string): Promise<{ id: string; data: Record<string, unknown> }> {
  const snapshot = await getAdminFirestore()
    .collection('auditoriaAdmin')
    .where('entidadId', '==', volunteerId)
    .where('accion', '==', 'revocar_consentimiento_publico')
    .where('actorUid', '==', actorUid)
    .get();
  expect(snapshot.size).toBe(1);
  const auditDocument = snapshot.docs.find((candidate) => {
    const data = candidate.data();
    return data.entidadId === volunteerId
      && data.accion === 'revocar_consentimiento_publico'
      && data.actorUid === actorUid;
  });
  expect(auditDocument).toBeDefined();
  return { id: auditDocument!.id, data: auditDocument!.data() as Record<string, unknown> };
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

beforeEach(async () => {
  await rulesEnv.clearFirestore();
  volunteerId = `volunteer-${crypto.randomUUID()}`;
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

    await seedPrivateProfile(owner.uid);

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
      email: 'volunteer@example.test',
      telefono: '000-0000000',
      fotoPath: `private/voluntarios/${volunteerId}/foto.jpg`,
      publicProfileConsent: { enabled: false, revokedByUid: admin.uid },
    });

    const { id: auditId, data: audit } = await readAdminAudit(admin.uid);
    expect(Object.keys(audit).sort()).toEqual([
      'accion', 'actorUid', 'createdAt', 'entidad', 'entidadId', 'resultado',
    ]);
    expect(audit).toMatchObject({
      actorUid: admin.uid,
      accion: 'revocar_consentimiento_publico',
      entidad: 'voluntarios',
      entidadId: volunteerId,
      resultado: 'success',
    });
    expect(JSON.stringify(audit)).not.toMatch(/email|telefono|foto|authUid|token|nombre|zona|habilidades/i);
    await assertFails(getDoc(doc(firestore!, `auditoriaAdmin/${auditId}`)));

    for (const role of ['anonymous', 'user', 'panel', 'admin'] as const) {
      const privateDb = role === 'anonymous'
        ? rulesEnv.unauthenticatedContext().firestore()
        : rulesEnv.authenticatedContext(`${role}-${crypto.randomUUID()}`, { role }).firestore();
      await assertFails(getDoc(doc(privateDb, `voluntarios/${volunteerId}`)));
    }
  });

  it('rechaza activacion administrativa y revocacion de otro titular', async () => {
    const owner = await createUser('volunteer');
    const panel = await createUser('panel');
    const admin = await createUser('admin');
    const otherUser = await createUser('other');
    await setRole(panel.uid, 'panel');
    await setRole(admin.uid, 'admin');

    await seedPrivateProfile(owner.uid, false);

    for (const actor of [panel, admin]) {
      const response = await callConsent(await idToken(actor), true);
      expect(response.status).toBe(403);
    }

    const otherResponse = await callConsent(await idToken(otherUser), false);
    expect(otherResponse.status).toBe(403);
  });

  it('no deja estado parcial cuando falla una escritura dentro de la transaccion', async () => {
    const committed = new Map<string, unknown>([
      [`voluntarios/${volunteerId}`, {
        authUid: 'owner-uid', activo: true, nombre: 'Ana Demo', zona: 'Este',
        habilidades: ['salud'], createdAt: 'created-at',
      }],
    ]);
    const initialState = new Map(committed);
    let failedTransactionWrites: Array<{ path: string; operation: 'update' | 'set' | 'delete'; data?: unknown }> = [];
    let failAuditWrite = true;
    let auditPath = '';
    const createTransaction = (stagedWrites: Array<{ path: string; operation: 'update' | 'set' | 'delete'; data?: unknown }>) => ({
      get: async (reference: { path?: string }) => ({
        exists: committed.has(reference.path!),
        data: () => committed.get(reference.path!),
      }),
      update: (reference: { path?: string }, data: unknown) => {
        stagedWrites.push({ path: reference.path!, operation: 'update', data });
      },
      set: (reference: { path?: string }, data: unknown) => {
        stagedWrites.push({ path: reference.path!, operation: 'set', data });
        if (failAuditWrite && reference.path!.startsWith('auditoriaAdmin/')) {
          auditPath = reference.path!;
          throw new Error('injected-transaction-failure');
        }
      },
      delete: (reference: { path?: string }) => {
        stagedWrites.push({ path: reference.path!, operation: 'delete' });
      },
    });
    const db = {
      collection: (name: string) => ({
        doc: (id?: string) => ({
          path: id ? `${name}/${id}` : `${name}/audit-generated`,
        }),
      }),
      runTransaction: async <T>(callback: (tx: ReturnType<typeof createTransaction>) => Promise<T>) => {
        const stagedWrites: Array<{ path: string; operation: 'update' | 'set' | 'delete'; data?: unknown }> = [];
        try {
          const result = await callback(createTransaction(stagedWrites));
          for (const write of stagedWrites) {
            if (write.operation === 'delete') committed.delete(write.path);
            else if (write.operation === 'update') {
              committed.set(write.path, {
                ...(committed.get(write.path) as object),
                ...(write.data as object),
              });
            } else {
              committed.set(write.path, write.data);
            }
          }
          return result;
        } catch (error) {
          failedTransactionWrites = stagedWrites;
          throw error;
        }
      },
    };

    await expect(applyConsentTransaction(
      {
        volunteerId,
        enabled: true,
        consentVersion: 'volunteer-public-v1',
      },
      { uid: 'owner-uid', role: 'user' },
      db,
      'transaction-now',
    )).rejects.toThrow('injected-transaction-failure');

    expect(auditPath).toBe(`auditoriaAdmin/audit-generated`);
    expect(failedTransactionWrites).toHaveLength(3);
    expect(committed).toEqual(initialState);
    expect(committed.has(`voluntariosPublicos/${volunteerId}`)).toBe(false);
    expect([...committed.keys()].some((path) => path.startsWith('auditoriaAdmin/'))).toBe(false);

    failAuditWrite = false;
    await applyConsentTransaction(
      {
        volunteerId,
        enabled: true,
        consentVersion: 'volunteer-public-v1',
      },
      { uid: 'owner-uid', role: 'user' },
      db,
      'transaction-now',
    );
    expect(committed.has(`voluntariosPublicos/${volunteerId}`)).toBe(true);
    expect([...committed.keys()].some((path) => path.startsWith('auditoriaAdmin/'))).toBe(true);
  });

  it('permite revocacion a panel y luego al titular', async () => {
    const owner = await createUser('volunteer');
    const panel = await createUser('panel');
    await setRole(panel.uid, 'panel');
    await seedPrivateProfile(owner.uid, false);

    expect((await callConsent(await idToken(owner), true)).status).toBe(200);
    expect((await callConsent(await idToken(panel), false)).status).toBe(200);
    expect((await getDoc(doc(firestore!, `voluntariosPublicos/${volunteerId}`))).exists()).toBe(false);
    expect((await readAdminAudit(panel.uid)).data.actorUid).toBe(panel.uid);

    expect((await callConsent(await idToken(owner), true)).status).toBe(200);
    expect((await callConsent(await idToken(owner), false)).status).toBe(200);
    expect((await getDoc(doc(firestore!, `voluntariosPublicos/${volunteerId}`))).exists()).toBe(false);
    expect((await readAdminAudit(owner.uid)).data.actorUid).toBe(owner.uid);
  });

  it('bloquea la sexta solicitud UID sin mutar el consentimiento bloqueado', async () => {
    const owner = await createUser('volunteer');
    await seedPrivateProfile(owner.uid);
    const token = await idToken(owner);

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => callConsent(token, true)),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    const limitedResponse = responses.find((response) => response.status === 429);
    expect(limitedResponse).toBeDefined();
    expect(limitedResponse!.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/);
    expect(await readPrivateConsent()).toMatchObject({ enabled: true, version: 'volunteer-public-v1' });
    expect((await getDoc(doc(firestore!, `voluntariosPublicos/${volunteerId}`))).exists()).toBe(true);
    expect(await readAuditCount()).toBe(5);
  });

  it('limita veinte intentos Auth fallidos por request sin aplicar consentimiento', async () => {
    const responses = await Promise.all(
      Array.from({ length: 21 }, () => fetch(consentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.77',
        },
        body: JSON.stringify({
          volunteerId,
          enabled: true,
          consentVersion: 'volunteer-public-v1',
        }),
      })),
    );

    expect(responses.filter((response) => response.status === 401)).toHaveLength(20);
    const limitedResponse = responses.find((response) => response.status === 429);
    expect(limitedResponse).toBeDefined();
    expect(limitedResponse!.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/);
    expect(await readAuditCount()).toBe(0);
  });

  it('mantiene App Check local en disabled, log-only y enforced sin enforcement remoto', async () => {
    const owner = await createUser('volunteer');
    await seedPrivateProfile(owner.uid, false);
    const authenticate = async () => ({ uid: owner.uid, role: 'user' as const });
    const rateLimiter = async () => ({ allowed: true as const, hits: 1, retryAfter: 0 as const });
    const request = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-firebase-appcheck': 'synthetic-invalid-token',
      },
      body: {
        volunteerId,
        enabled: true,
        consentVersion: 'volunteer-public-v1',
      },
    };

    const disabled = createResponse();
    await setVolunteerPublicConsentHandler(request, disabled.res, undefined, {
      appCheckMode: 'disabled',
      verifyAppCheck: async () => { throw new Error('must-not-run'); },
      authenticate,
      rateLimiter,
    });
    expect(disabled.result.status).toBe(200);

    const logOnly = createResponse();
    await setVolunteerPublicConsentHandler(request, logOnly.res, undefined, {
      appCheckMode: 'log-only',
      verifyAppCheck: async () => { throw new Error('synthetic verifier failure'); },
      authenticate,
      rateLimiter,
    });
    expect(logOnly.result.status).toBe(200);

    const previousState = await readPrivateConsent();
    const previousAuditCount = await readAuditCount();
    const enforced = createResponse();
    await setVolunteerPublicConsentHandler(request, enforced.res, undefined, {
      appCheckMode: 'enforced',
      verifyAppCheck: async () => { throw new Error('synthetic verifier failure'); },
      authenticate,
      rateLimiter,
    });
    expect(enforced.result.status).toBe(403);
    expect(enforced.result.body).toEqual({
      error: { code: 'app-check-required', message: 'App Check required' },
    });
    expect(await readPrivateConsent()).toEqual(previousState);
    expect(await readAuditCount()).toBe(previousAuditCount);
  });

  it('deniega al cliente leer y escribir rateLimits', async () => {
    const owner = await createUser('volunteer');
    const ownerToken = await idToken(owner);
    expect(ownerToken).toEqual(expect.any(String));

    await assertFails(getDoc(doc(firestore!, 'rateLimits/test')));
    await assertFails(setDoc(doc(firestore!, 'rateLimits/test'), { hits: 1 }));
  });
});

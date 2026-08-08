import { beforeEach, expect, it, vi } from 'vitest';

const authState = { currentUser: null };

const authMocks = vi.hoisted(() => ({
  browserLocalPersistence: { name: 'local' },
  browserSessionPersistence: { name: 'session' },
  createUserWithEmailAndPassword: vi.fn(),
  getAuth: vi.fn(() => authState),
  inMemoryPersistence: { name: 'none' },
  onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', () => authMocks);
vi.mock('../../src/firebase/firebase-config.js', () => ({
  getFirebaseApp: vi.fn(async () => ({ name: 'app' })),
}));

import {
  configureAuthPersistence,
  getCurrentUser,
  getIdToken,
  getIdTokenResult,
  observeAuth,
} from '../../src/firebase/firebase-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
  authState.currentUser = null;
});

it('devuelve el usuario actual y sus claims', async () => {
  const user = {
    uid: 'user-1',
    getIdTokenResult: vi.fn(async () => ({
      token: 'token-1',
      claims: { role: 'panel' },
    })),
  };
  authState.currentUser = user;

  expect(await getCurrentUser()).toBe(user);
  expect(await getIdTokenResult()).toEqual({
    token: 'token-1',
    claims: { role: 'panel' },
  });
});

it('devuelve null cuando no hay sesion', async () => {
  expect(await getCurrentUser()).toBeNull();
  expect(await getIdTokenResult()).toBeNull();
  expect(await getIdToken()).toBeNull();
});

it('rechaza persistencia desconocida antes de tocar Auth', async () => {
  await expect(configureAuthPersistence('persistente')).rejects.toThrow(
    'Persistencia Firebase no soportada: persistente',
  );
  expect(authMocks.setPersistence).not.toHaveBeenCalled();
});

it('observa cambios de sesion y devuelve el unsubscribe de Firebase', async () => {
  const unsubscribe = vi.fn();
  const callback = vi.fn();
  authMocks.onAuthStateChanged.mockReturnValue(unsubscribe);

  await expect(observeAuth(callback)).resolves.toBe(unsubscribe);
  expect(authMocks.onAuthStateChanged).toHaveBeenCalledWith(
    expect.anything(),
    callback,
    undefined,
  );
});

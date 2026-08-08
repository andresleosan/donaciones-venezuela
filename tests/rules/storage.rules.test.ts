import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-donaciones-venezuela',
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: readFileSync('firebase/storage.rules', 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const objectRef = ref(context.storage(), 'private/pruebas/existing.txt');
    await uploadBytes(objectRef, new Uint8Array([1]), { contentType: 'text/plain' });
  });
});

afterAll(async () => testEnv.cleanup());

const roles = ['anonymous', 'user', 'panel', 'admin'] as const;

describe('Storage deny-by-default', () => {
  for (const role of roles) {
    it(`deniega lectura y escritura a ${role}`, async () => {
      const context = role === 'anonymous'
        ? testEnv.unauthenticatedContext()
        : testEnv.authenticatedContext(`${role}-uid`, { role });
      const storage = context.storage();

      await assertFails(uploadBytes(
        ref(storage, `private/pruebas/new-${role}.txt`),
        new Uint8Array([1]),
        { contentType: 'text/plain' },
      ));
      await assertFails(getBytes(ref(storage, 'private/pruebas/existing.txt')));
    });
  }
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-donaciones-venezuela',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firebase/firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => testEnv.clearFirestore());
afterAll(async () => testEnv.cleanup());

const roles = ['anonymous', 'user', 'panel', 'admin'] as const;

describe('Firestore deny-by-default', () => {
  for (const role of roles) {
    it(`deniega lectura y escritura a ${role}`, async () => {
      const context = role === 'anonymous'
        ? testEnv.unauthenticatedContext()
        : testEnv.authenticatedContext(`${role}-uid`, { role });
      const ref = doc(context.firestore(), 'voluntarios/example');

      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { nombre: 'No permitido' }));
    });
  }
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
} from 'firebase/firestore';

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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'voluntariosPublicos/volunteer-1'), {
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
      createdAt: '2026-08-11T12:00:00.000Z',
    });
    await setDoc(doc(db, 'voluntarios/volunteer-1'), {
      nombre: 'Ana Privada',
      email: 'ana@example.test',
    });
    await setDoc(doc(db, 'auditoriaAdmin/audit-1'), {
      accion: 'test',
    });
  });
});

afterAll(async () => testEnv.cleanup());

describe('Firestore voluntariosPublicos', () => {
  it('permite get/list publico con limite 50', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'voluntariosPublicos/volunteer-1')));
    await assertSucceeds(getDocs(query(
      collection(db, 'voluntariosPublicos'),
      limit(50),
    )));
    await assertFails(getDocs(query(collection(db, 'voluntariosPublicos'))));
    await assertFails(getDocs(query(
      collection(db, 'voluntariosPublicos'),
      limit(51),
    )));
  });

  it.each(['anonymous', 'user', 'panel', 'admin'])('deniega escritura publica a %s', async (role) => {
    const db = role === 'anonymous'
      ? testEnv.unauthenticatedContext().firestore()
      : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
    await assertFails(setDoc(
      doc(db, 'voluntariosPublicos/new'),
      { nombre: 'No permitido' },
    ));
  });

  it('deniega lectura directa del perfil privado y auditoria', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'voluntarios/volunteer-1')));
    await assertFails(getDoc(doc(db, 'auditoriaAdmin/audit-1')));
  });
});

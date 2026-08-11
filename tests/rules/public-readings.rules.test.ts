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
    await setDoc(doc(db, 'lugaresPublicos/lugar-1'), {
      nombre: 'Centro Demo',
      tipo: 'Centro',
      ubicacionPublica: 'Zona Este',
      latAproximada: 10.5,
      lngAproximada: -66.9,
      contactoPublico: 'contacto publico',
      activo: true,
      updatedAt: '2026-08-11T12:00:00.000Z',
    });
    await setDoc(doc(db, 'vacantesPublicas/vacante-1'), {
      lugarId: 'lugar-1',
      titulo: 'Apoyo logistico',
      descripcion: 'Turno de prueba',
      cupos: 2,
      estado: 'Abierta',
      createdAt: '2026-08-11T12:00:00.000Z',
    });
    await setDoc(doc(db, 'lugares/private'), { nombre: 'Privado' });
    await setDoc(doc(db, 'vacantesVoluntarios/private'), { titulo: 'Privado' });
  });
});

afterAll(async () => testEnv.cleanup());

describe('Firestore public-readings', () => {
  it('permite get anonimo de una proyeccion publica', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'lugaresPublicos/lugar-1')));
  });

  it('permite list publico solo con limite maximo 50', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'vacantesPublicas'),
      limit(50),
    )));
    await assertFails(getDocs(query(collection(db, 'vacantesPublicas'))));
    await assertFails(getDocs(query(
      collection(db, 'vacantesPublicas'),
      limit(51),
    )));
  });

  it.each(['anonymous', 'user', 'panel', 'admin'])('deniega escritura publica a %s', async (role) => {
    const db = role === 'anonymous'
      ? testEnv.unauthenticatedContext().firestore()
      : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
    await assertFails(setDoc(doc(db, 'lugaresPublicos/new'), { nombre: 'No permitido' }));
  });

  it.each(['anonymous', 'user', 'panel', 'admin'])('deniega lectura privada a %s', async (role) => {
    const db = role === 'anonymous'
      ? testEnv.unauthenticatedContext().firestore()
      : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
    await assertFails(getDoc(doc(db, 'lugares/private')));
    await assertFails(getDoc(doc(db, 'vacantesVoluntarios/private')));
  });
});

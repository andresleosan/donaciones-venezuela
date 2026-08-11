import { beforeEach, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => ({ path: name })),
  documentId: vi.fn(() => 'documentId()'),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ name: 'firestore' })),
  limit: vi.fn((value) => ({ type: 'limit', value })),
  orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
  query: vi.fn((reference, ...constraints) => ({ reference, constraints })),
  startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
  where: vi.fn((field, operator, value) => ({ type: 'where', field, operator, value })),
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('../../src/firebase/firebase-config.js', () => ({
  getFirebaseApp: vi.fn(async () => ({ name: 'app' })),
}));

import { listPublicPlaces, listPublicVacancies } from '../../src/firebase/firebase-public-reads.js';

beforeEach(() => {
  vi.clearAllMocks();
  firestoreMocks.getDocs.mockResolvedValue({ docs: [] });
});

it('lista lugares activos con limite y cursor de documento', async () => {
  const lastDoc = { id: 'lugar-2', ref: { path: 'lugaresPublicos/lugar-2' }, data: () => ({}) };
  firestoreMocks.getDocs.mockResolvedValue({
    docs: [
      { id: 'lugar-1', ref: { path: 'lugaresPublicos/lugar-1' }, data: () => ({ nombre: 'A' }) },
      lastDoc,
    ],
  });

  await expect(listPublicPlaces({ pageSize: 2 })).resolves.toEqual({
    data: [{ id: 'lugar-1', nombre: 'A' }, { id: 'lugar-2' }],
    nextCursor: lastDoc,
  });
  expect(firestoreMocks.collection).toHaveBeenCalledWith(expect.anything(), 'lugaresPublicos');
  expect(firestoreMocks.where).toHaveBeenCalledWith('activo', '==', true);
  expect(firestoreMocks.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
  expect(firestoreMocks.documentId).toHaveBeenCalled();
  expect(firestoreMocks.limit).toHaveBeenCalledWith(2);
  expect(firestoreMocks.query).toHaveBeenCalled();
});

it('lista vacantes con orden y limite por defecto', async () => {
  firestoreMocks.getDocs.mockResolvedValue({
    docs: [{ id: 'vacante-1', ref: { path: 'vacantesPublicas/vacante-1' }, data: () => ({ titulo: 'B' }) }],
  });

  await expect(listPublicVacancies()).resolves.toEqual({
    data: [{ id: 'vacante-1', titulo: 'B' }],
    nextCursor: null,
  });
  expect(firestoreMocks.collection).toHaveBeenCalledWith(expect.anything(), 'vacantesPublicas');
  expect(firestoreMocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(firestoreMocks.orderBy).toHaveBeenNthCalledWith(2, 'documentId()', 'desc');
  expect(firestoreMocks.limit).toHaveBeenCalledWith(50);
  expect(firestoreMocks.query).toHaveBeenCalled();
});

it.each([0, -1, 51, '50', NaN, null])('rechaza pageSize invalido: %s', async (pageSize) => {
  await expect(listPublicVacancies({ pageSize })).rejects.toThrow('invalid-public-page-size');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('rechaza opciones nulas con un error estable', async () => {
  await expect(listPublicPlaces(null)).rejects.toThrow('invalid-public-options');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it.each([0, false, ''])('rechaza cursor falsy explicito: %s', async (cursor) => {
  await expect(listPublicPlaces({ cursor })).rejects.toThrow('invalid-public-cursor');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('rechaza cursor de otra coleccion', async () => {
  const cursor = { ref: { path: 'vacantesPublicas/v-1' } };

  await expect(listPublicPlaces({ cursor })).rejects.toThrow('invalid-public-cursor');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('rechaza cursor con una ruta anidada', async () => {
  const cursor = { ref: { path: 'lugaresPublicos/lugar-1/subruta' } };

  await expect(listPublicPlaces({ cursor })).rejects.toThrow('invalid-public-cursor');
  expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
});

it('usa un cursor valido para continuar la consulta', async () => {
  const cursor = { ref: { path: 'vacantesPublicas/v-1' } };

  await listPublicVacancies({ cursor });

  expect(firestoreMocks.startAfter).toHaveBeenCalledWith(cursor);
});

it('normaliza fallos de Firestore sin filtrar detalles', async () => {
  firestoreMocks.getDocs.mockRejectedValue(new Error('private@example.test lugaresPublicos/lugar-1'));

  await expect(listPublicPlaces()).rejects.toThrow('public-read-failed');
  await expect(listPublicPlaces()).rejects.not.toThrow('private@example.test');
});

it('devuelve null cuando la pagina no esta llena', async () => {
  firestoreMocks.getDocs.mockResolvedValue({
    docs: [{ id: 'lugar-1', ref: { path: 'lugaresPublicos/lugar-1' }, data: () => ({}) }],
  });

  await expect(listPublicPlaces({ pageSize: 2 })).resolves.toMatchObject({ nextCursor: null });
});

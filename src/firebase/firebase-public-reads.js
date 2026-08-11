import { collection, documentId, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { getFirebaseApp } from './firebase-config.js';

export const MAX_PUBLIC_PAGE_SIZE = 50;

let dbPromise;

async function getFirestoreDb() {
  if (!dbPromise) {
    dbPromise = getFirebaseApp().then(async (app) => {
      const { getFirestore } = await import('firebase/firestore');
      return getFirestore(app);
    });
  }
  return dbPromise;
}

async function listPublicCollection(collectionName, orderField, options) {
  const pageSize = options.pageSize ?? MAX_PUBLIC_PAGE_SIZE;
  const cursor = options.cursor;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PUBLIC_PAGE_SIZE) {
    throw new Error('invalid-public-page-size');
  }

  if (cursor && (typeof cursor.ref?.path !== 'string' || !cursor.ref.path.startsWith(`${collectionName}/`))) {
    throw new Error('invalid-public-cursor');
  }

  try {
    const reference = collection(await getFirestoreDb(), collectionName);
    const constraints = [];

    if (collectionName === 'lugaresPublicos') {
      constraints.push(where('activo', '==', true));
    }
    constraints.push(orderBy(orderField, 'desc'), orderBy(documentId(), 'desc'));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snapshot = await getDocs(query(reference, ...constraints));
    const docs = snapshot.docs;

    return {
      data: docs.map((item) => ({ id: item.id, ...item.data() })),
      nextCursor: docs.length === pageSize ? docs[docs.length - 1] : null,
    };
  } catch {
    throw new Error('public-read-failed');
  }
}

export async function listPublicPlaces(options = {}) {
  return listPublicCollection('lugaresPublicos', 'updatedAt', options);
}

export async function listPublicVacancies(options = {}) {
  return listPublicCollection('vacantesPublicas', 'createdAt', options);
}

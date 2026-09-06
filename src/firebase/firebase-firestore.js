import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getFirestoreDb } from './firebase-config.js';


export async function getDocument(path) {
  const snapshot = await getDoc(doc(await getFirestoreDb(), path));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function listDocuments(path, constraints = []) {
  const reference = collection(await getFirestoreDb(), path);
  const snapshot = await getDocs(constraints.length ? query(reference, ...constraints) : reference);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function createDocument(path, data) {
  const result = await addDoc(collection(await getFirestoreDb(), path), data);
  return result.id;
}

export async function setDocument(path, data, options) {
  await setDoc(doc(await getFirestoreDb(), path), data, options);
}

export async function updateDocument(path, data) {
  await updateDoc(doc(await getFirestoreDb(), path), data);
}

export async function deleteDocument(path) {
  await deleteDoc(doc(await getFirestoreDb(), path));
}

export { limit, orderBy, where };

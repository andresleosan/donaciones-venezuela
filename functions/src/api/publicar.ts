import { FieldValue } from 'firebase-admin/firestore';
import {
  PUBLIC_PROJECTION_FIELDS,
  findForbiddenPublicFields,
  sanitizePublicProjection,
  type ProjectionName,
} from '../public-projections.js';

// Escritura de proyecciones publicas.
//
// Ninguna accion escribe una coleccion `*Publico*` a mano: todo pasa por aqui,
// que filtra por la allowlist de `public-projections.ts` y vuelve a comprobar la
// denylist sobre el resultado. La proyeccion se escribe SIEMPRE en la misma
// transaccion que el documento canonico.

// Unico productor del centinela de hora del servidor. Tenerlo aqui deja a las
// pruebas comparar contra el mismo valor sin importar firebase-admin (que solo
// esta instalado dentro de functions/).
export function marcaServidor(): unknown {
  return FieldValue.serverTimestamp();
}

type DocumentReference = { path?: string };

type EscrituraTransaccion = {
  set(reference: DocumentReference, data: Record<string, unknown>, options?: { merge: boolean }): void;
  delete(reference: DocumentReference): void;
};

type ColeccionMinima = { doc(id: string): DocumentReference };
type FirestoreMinimo = { collection(name: string): ColeccionMinima };

export type { ProjectionName };

// Las proyecciones que se consultan ordenadas por `createdAt` no pueden
// publicarse sin el: la fila existiria pero ninguna query la veria. Se falla
// aqui, no en produccion.
function exigeCreatedAt(nombre: ProjectionName): boolean {
  return (PUBLIC_PROJECTION_FIELDS[nombre] as readonly string[]).includes('createdAt');
}

export function proyeccionPublica(
  nombre: ProjectionName,
  documentoPrivado: Record<string, unknown>,
): Record<string, unknown> {
  const saneado = sanitizePublicProjection(nombre, documentoPrivado);

  if (exigeCreatedAt(nombre) && saneado.createdAt === undefined) {
    throw new Error(`proyeccion-sin-createdAt:${nombre}`);
  }

  const prohibidos = findForbiddenPublicFields(saneado);
  if (prohibidos.length) {
    throw new Error(`forbidden-public-fields:${prohibidos.join(',')}`);
  }

  return { ...saneado, updatedAt: marcaServidor() };
}

export function publicar(
  tx: EscrituraTransaccion,
  db: FirestoreMinimo,
  nombre: ProjectionName,
  id: string,
  documentoPrivado: Record<string, unknown>,
): Record<string, unknown> {
  const datos = proyeccionPublica(nombre, documentoPrivado);
  // `merge` para no perder campos que otra accion del mismo dominio ya publico
  // (por ejemplo los contadores de un motorizado frente a su perfil).
  tx.set(db.collection(nombre).doc(id), datos, { merge: true });
  return datos;
}

export function despublicar(
  tx: EscrituraTransaccion,
  db: FirestoreMinimo,
  nombre: ProjectionName,
  id: string,
): void {
  tx.delete(db.collection(nombre).doc(id));
}

import { n, s } from './contract.js';
import { publicar } from './publicar.js';
import type { FirestoreMinimo, TransaccionMinima } from './db.js';

// Tasa USD -> Bs vigente, en el documento unico `tasas/actual`.
//
// El legado guardaba una fila por captura y leia la ultima por fecha; aqui solo
// interesa la vigente, que es lo unico que el navegador puede leer (las reglas
// permiten `get` de `tasas/actual` y nada mas). La captura desde Remitly/BCV es
// de la Task 3.8; esto es el almacen y la validacion.

export const ID_TASA = 'actual';
const RUTA = 'tasas';

// Rango del legado: fuera de el la fuente devolvio basura y no se guarda.
export const TASA_MIN = 200;
export const TASA_MAX = 5000;

export type Tasa = {
  efectiva: number;
  diaria: number;
  fuente: string;
  fecha: string;
};

export function tasaPlausible(valor: unknown): boolean {
  const x = Number(valor);
  return Number.isFinite(x) && x > TASA_MIN && x < TASA_MAX;
}

// Normaliza igual que el legado: `diaria` cae a `efectiva` si no es plausible.
export function normalizarTasa(entrada: {
  efectiva: unknown;
  diaria?: unknown;
  fuente?: unknown;
  fecha?: unknown;
}): Tasa | null {
  if (!tasaPlausible(entrada.efectiva)) return null;
  const efectiva = n(entrada.efectiva);
  return {
    efectiva,
    diaria: tasaPlausible(entrada.diaria) ? n(entrada.diaria) : efectiva,
    fuente: s(entrada.fuente, 40) || 'desconocida',
    fecha: s(entrada.fecha, 40),
  };
}

export function publicarTasa(
  tx: TransaccionMinima,
  db: FirestoreMinimo,
  tasa: Tasa,
): Record<string, unknown> {
  return publicar(tx, db, RUTA, ID_TASA, { ...tasa, capturadaAt: tasa.fecha });
}

export async function leerTasaActual(db: {
  collection(name: string): { doc(id: string): { get(): Promise<{ exists: boolean; data(): unknown }> } };
}): Promise<Tasa | null> {
  const snapshot = await db.collection(RUTA).doc(ID_TASA).get();
  if (!snapshot.exists) return null;
  return normalizarTasa((snapshot.data() ?? {}) as { efectiva: unknown });
}

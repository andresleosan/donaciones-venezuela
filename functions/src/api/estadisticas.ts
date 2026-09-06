import { FieldValue } from 'firebase-admin/firestore';
import { PUBLIC_PROJECTION_FIELDS } from '../public-projections.js';
import { marcaServidor, publicar } from './publicar.js';
import type { FirestoreMinimo, TransaccionMinima } from './db.js';

// Documento agregado `estadisticas/global`: los numeros del tablero publico.
//
// No se recalcula recorriendo colecciones en cada lectura (seria una lectura por
// documento por visita): cada accion de dominio ajusta el delta dentro de SU
// transaccion, asi que el agregado y el dato canonico no pueden divergir por una
// escritura a medias. `admin_reconstruir_proyecciones` (jobs/) lo recompone
// desde cero cuando hace falta.

export const CONTADORES = [
  'centrosRegistrados',
  'hospitalesRegistrados',
  'voluntariosActivos',
  'motorizadosRegistrados',
  'personasReportadas',
  'personasLocalizadas',
  'donacionesRegistradas',
  'facturasAbiertas',
  'montoRecaudadoTotal',
] as const;

export type Contador = typeof CONTADORES[number];
export type Deltas = Partial<Record<Contador, number>>;
export type Estadisticas = Record<Contador, number> & { actualizado?: unknown };

export const ID_ESTADISTICAS = 'global';
const RUTA = 'estadisticas';

const PERMITIDOS = new Set<string>(PUBLIC_PROJECTION_FIELDS.estadisticas);

export function estadisticasVacias(): Record<Contador, number> {
  return Object.fromEntries(CONTADORES.map((clave) => [clave, 0])) as Record<Contador, number>;
}

// El incremento atomico no puede pasar por `sanitizePublicProjection` (el valor
// es un centinela, no un numero), asi que la allowlist se comprueba aqui: solo
// contadores declarados y solo numeros finitos.
export function ajustarContadores(
  tx: TransaccionMinima,
  db: FirestoreMinimo,
  deltas: Deltas,
): Deltas {
  const aplicables: Record<string, unknown> = {};
  let hayAlguno = false;

  for (const [clave, delta] of Object.entries(deltas)) {
    if (!PERMITIDOS.has(clave) || !(CONTADORES as readonly string[]).includes(clave)) {
      throw new Error(`contador-desconocido:${clave}`);
    }
    if (!Number.isFinite(delta)) throw new Error(`contador-no-numerico:${clave}`);
    if (delta === 0) continue;
    aplicables[clave] = FieldValue.increment(delta as number);
    hayAlguno = true;
  }

  if (!hayAlguno) return {};

  aplicables.actualizado = marcaServidor();
  tx.set(db.collection(RUTA).doc(ID_ESTADISTICAS), aplicables, { merge: true });
  return deltas;
}

// Reemplazo completo, solo para la reconstruccion: aqui si hay numeros reales y
// el documento pasa por la allowlist como cualquier otra proyeccion.
export function fijarEstadisticas(
  tx: TransaccionMinima,
  db: FirestoreMinimo,
  valores: Record<Contador, number>,
): Record<string, unknown> {
  return publicar(tx, db, RUTA, ID_ESTADISTICAS, { ...valores, actualizado: marcaServidor() });
}

export function sumarEstadisticas(
  acumulado: Record<Contador, number>,
  aporte: Deltas,
): Record<Contador, number> {
  const salida = { ...acumulado };
  for (const [clave, delta] of Object.entries(aporte)) {
    if (!(CONTADORES as readonly string[]).includes(clave)) throw new Error(`contador-desconocido:${clave}`);
    if (!Number.isFinite(delta)) continue;
    salida[clave as Contador] += delta as number;
  }
  return salida;
}

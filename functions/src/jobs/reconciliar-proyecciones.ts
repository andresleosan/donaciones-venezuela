import { ApiError } from '../api/contract.js';
import { defineAction } from '../api/registry.js';
import { estadisticasVacias, sumarEstadisticas, type Contador, type Deltas } from '../api/estadisticas.js';
import { marcaServidor, proyeccionPublica, type ProjectionName } from '../api/publicar.js';
import type { ActionContext } from '../api/contract.js';

// Reconstruccion de proyecciones publicas y contadores desde las colecciones
// canonicas.
//
// Es la red de seguridad de D3 (canonica privada + proyeccion publica escritas
// en la misma transaccion): si una proyeccion queda desincronizada por un
// despliegue a medias, un cambio de allowlist o un arreglo manual, esto la
// vuelve a derivar. Es idempotente: correrla dos veces deja exactamente los
// mismos documentos.
//
// Cada dominio de la fase 3 registra aqui su fuente al importarse; este modulo
// no conoce ningun dominio.

export const TAMANO_LOTE = 400;

export type DocumentoCanonico = { id: string; datos: Record<string, unknown> };

export type FuenteProyeccion = {
  // Coleccion canonica de la que se deriva.
  coleccion: string;
  // Ausente = fuente de SOLO CONTADORES: recorre la coleccion para recomponer
  // el tablero y no publica ni borra nada. Lo necesitan las colecciones que
  // alimentan `estadisticas/global` sin tener proyeccion publica (voluntarios
  // sin consentimiento, personas reportadas). Declararlas contra una proyeccion
  // ajena y filtrarlas con `incluir` no vale: el barrido de huerfanos borraria
  // esa proyeccion entera.
  proyeccion?: ProjectionName;
  // Documentos que NO deben aparecer en publico (bajas, vacantes cerradas...).
  // No afecta a `contadores`: el tablero legado contaba `count(*)`, bajas
  // incluidas, y `incluir` decide que se PUBLICA, no que existe.
  incluir?(documento: DocumentoCanonico): boolean;
  // Documento privado -> documento que recibe `proyeccionPublica`. Recibe la
  // base porque una proyeccion puede depender de una subcoleccion (los insumos
  // de un lugar, sin ir mas lejos) y sin ella la reconstruccion la vaciaria.
  mapear?(documento: DocumentoCanonico, db: FirestoreReconciliable): Record<string, unknown> | Promise<Record<string, unknown>>;
  // Aporte de este documento a `estadisticas/global`.
  contadores?(documento: DocumentoCanonico): Deltas;
};

const fuentes = new Map<string, FuenteProyeccion>();

export function registrarFuente(fuente: FuenteProyeccion): FuenteProyeccion {
  if (fuente.proyeccion && !fuente.mapear) throw new Error('fuente-sin-mapear');
  const clave = `${fuente.coleccion}->${fuente.proyeccion ?? 'contadores'}`;
  if (fuentes.has(clave)) throw new Error(`fuente-duplicada:${clave}`);
  fuentes.set(clave, fuente);
  return fuente;
}

export function listarFuentes(): FuenteProyeccion[] {
  return [...fuentes.values()];
}

// Solo para pruebas.
export function resetFuentes(): void {
  fuentes.clear();
}

// --- Superficie minima de Firestore que necesita el recorrido ----------------

type Snapshot = { id: string; data(): Record<string, unknown> | undefined };
type Consulta = {
  startAfter(valor: unknown): Consulta;
  limit(cantidad: number): Consulta;
  get(): Promise<{ docs: Snapshot[] }>;
};
type DocumentoRef = {
  path?: string;
  collection?(nombre: string): { get(): Promise<{ docs: Snapshot[] }> };
};
type Coleccion = {
  doc(id: string): DocumentoRef;
  orderBy(campo: string): Consulta;
};
type Lote = {
  set(referencia: unknown, datos: Record<string, unknown>, opciones?: { merge: boolean }): void;
  delete(referencia: unknown): void;
  commit(): Promise<void>;
};
export type FirestoreReconciliable = {
  collection(nombre: string): Coleccion;
  batch(): Lote;
};

// Recorre una coleccion entera ordenada por id, de `tamanoLote` en `tamanoLote`.
async function* porLotes(
  db: FirestoreReconciliable,
  coleccion: string,
  tamanoLote: number,
): AsyncGenerator<Snapshot[]> {
  let cursor: string | null = null;
  for (;;) {
    let consulta = db.collection(coleccion).orderBy('__name__');
    if (cursor !== null) consulta = consulta.startAfter(cursor);
    const { docs } = await consulta.limit(tamanoLote).get();
    if (docs.length === 0) return;
    yield docs;
    if (docs.length < tamanoLote) return;
    cursor = docs[docs.length - 1]!.id;
  }
}

export type ResumenReconciliacion = {
  publicados: number;
  eliminados: number;
  contadores: Record<Contador, number>;
};

export async function reconstruirProyecciones(
  db: FirestoreReconciliable,
  opciones: { tamanoLote?: number } = {},
): Promise<ResumenReconciliacion> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;
  if (!Number.isInteger(tamanoLote) || tamanoLote < 1 || tamanoLote > 500) {
    throw new Error('tamano-lote-invalido');
  }

  let contadores = estadisticasVacias();
  // Solo se reescriben los contadores que ALGUNA fuente alimenta. Con las
  // fuentes registradas a medias (la fase 3 las va anadiendo dominio a dominio),
  // un reemplazo completo pondria a cero los contadores de los dominios que
  // todavia no se han portado.
  const cubiertos = new Set<Contador>();
  let publicados = 0;
  let eliminados = 0;
  // Por proyeccion, los ids que deben quedar publicados. Lo que sobre en la
  // coleccion publica es huerfano y se borra.
  const vigentes = new Map<ProjectionName, Set<string>>();

  for (const fuente of listarFuentes()) {
    const proyeccion = fuente.proyeccion;
    const vistos = proyeccion ? vigentes.get(proyeccion) ?? new Set<string>() : null;
    if (proyeccion && vistos) vigentes.set(proyeccion, vistos);

    for await (const docs of porLotes(db, fuente.coleccion, tamanoLote)) {
      const lote = db.batch();
      let escrituras = 0;
      for (const snapshot of docs) {
        const documento = { id: snapshot.id, datos: snapshot.data() ?? {} };

        // Antes del filtro: un documento excluido del directorio publico sigue
        // existiendo y sigue contando en el tablero.
        if (fuente.contadores) {
          const aporte = fuente.contadores(documento);
          for (const clave of Object.keys(aporte)) cubiertos.add(clave as Contador);
          contadores = sumarEstadisticas(contadores, aporte);
        }

        if (fuente.incluir && !fuente.incluir(documento)) continue;
        if (!proyeccion || !vistos || !fuente.mapear) continue;

        lote.set(
          db.collection(proyeccion).doc(documento.id),
          proyeccionPublica(proyeccion, await fuente.mapear(documento, db)),
        );
        vistos.add(documento.id);
        publicados += 1;
        escrituras += 1;
      }
      if (escrituras) await lote.commit();
    }
  }

  for (const [proyeccion, vistos] of vigentes) {
    for await (const docs of porLotes(db, proyeccion, tamanoLote)) {
      const sobrantes = docs.filter((snapshot) => !vistos.has(snapshot.id));
      if (sobrantes.length === 0) continue;
      const lote = db.batch();
      for (const snapshot of sobrantes) lote.delete(db.collection(proyeccion).doc(snapshot.id));
      await lote.commit();
      eliminados += sobrantes.length;
    }
  }

  const parciales: Record<string, number> = {};
  for (const clave of cubiertos) parciales[clave] = contadores[clave];

  const lote = db.batch();
  // Mismo camino que cualquier otra proyeccion: allowlist + denylist.
  lote.set(
    db.collection('estadisticas').doc('global'),
    proyeccionPublica('estadisticas', { ...parciales, actualizado: marcaServidor() }),
    { merge: true },
  );
  await lote.commit();

  return { publicados, eliminados, contadores: parciales as Record<Contador, number> };
}

defineAction({
  nombre: 'admin_reconstruir_proyecciones',
  auth: 'admin',
  cubo: 'admin',
  async handler(ctx: ActionContext, payload) {
    const tamanoLote = payload.tamanoLote === undefined ? TAMANO_LOTE : Number(payload.tamanoLote);
    if (!Number.isInteger(tamanoLote) || tamanoLote < 1 || tamanoLote > 500) {
      throw new ApiError('tamanoLote debe estar entre 1 y 500');
    }
    if (listarFuentes().length === 0) throw new ApiError('no hay proyecciones registradas');

    const resumen = await reconstruirProyecciones(
      ctx.db as unknown as FirestoreReconciliable,
      { tamanoLote },
    );
    return { ...resumen };
  },
});

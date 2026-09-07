import type { ActionContext } from '../../functions/src/api/contract.js';
import { getAction } from '../../functions/src/api/registry.js';

// Firestore falso compartido por las pruebas de contrato de la Task 3.4.
//
// Reproduce lo que estos dominios usan de verdad: transacción diferida, lectura
// de subcolección como consulta, `merge`, `FieldValue.increment` aplicado al
// confirmar, y consultas con `where` (incluido el operador `in`), `orderBy` y
// `limit`. Y rechaza leer después de escribir, igual que Firestore: esa trampa
// ya reventó dos veces en esta fase y no se ve en producción hasta que revienta.
//
// Vive aparte porque `presupuestos.ts` y `ofertas.ts` comparten el mismo modelo
// que `facturas.ts`; `api-facturas.test.ts` conserva su copia, que además cubre
// el caso en el que el dominio se importa solo.

export type Documento = Record<string, unknown>;

export function crearDb(inicial: Record<string, Documento> = {}) {
  const documentos: Record<string, Documento> = {};
  for (const [ruta, datos] of Object.entries(inicial)) documentos[ruta] = { ...datos };

  // Ids automáticos únicos en TODA la base, no por consulta: dos entradas de
  // bitácora seguidas son dos documentos, no uno que pisa al otro. En Firestore
  // real `collection().doc()` nunca repite.
  let autoId = 0;
  // El centinela de hora del servidor se resuelve al aplicar la escritura, como
  // hace Firestore. Sin esto, `orderBy('fecha')` compararía objetos idénticos y
  // la bitácora saldría en un orden cualquiera.
  let reloj = new Date('2026-09-07T12:00:00.000Z').getTime();

  // `firebase-admin` solo esta instalado dentro de functions/, asi que el
  // centinela de `FieldValue.serverTimestamp()` se reconoce por su forma: una
  // instancia de clase (su prototipo no es el de un objeto literal) que no es ni
  // Date ni array. El incremento se comprueba antes, por su `operand`.
  function esCentinela(valor: unknown): boolean {
    return Boolean(valor)
      && typeof valor === 'object'
      && !(valor instanceof Date)
      && !Array.isArray(valor)
      && Object.getPrototypeOf(valor) !== Object.prototype;
  }

  function aplicar(ruta: string, datos: Documento, merge: boolean) {
    const previo = merge ? { ...(documentos[ruta] ?? {}) } : {};
    for (const [clave, valor] of Object.entries(datos)) {
      const incremento = valor as { operand?: unknown } | null;
      if (incremento && typeof incremento === 'object' && typeof incremento.operand === 'number') {
        previo[clave] = Number(previo[clave] ?? 0) + incremento.operand;
      } else if (esCentinela(valor)) {
        reloj += 1000;
        previo[clave] = new Date(reloj);
      } else {
        previo[clave] = valor;
      }
    }
    documentos[ruta] = previo;
  }

  function hijosDe(prefijo: string): Array<{ id: string; ref: { path: string }; data(): Documento }> {
    return Object.keys(documentos)
      .filter((ruta) => ruta.startsWith(`${prefijo}/`) && !ruta.slice(prefijo.length + 1).includes('/'))
      .sort()
      .map((ruta) => ({ id: ruta.slice(prefijo.length + 1), ref: { path: ruta }, data: () => documentos[ruta]! }));
  }

  // Grupo de colecciones: todo documento cuyo penúltimo segmento sea `nombre`.
  // Es lo que necesita la consola de datos para listar los insumos de todos los
  // centros sin recorrer centro por centro.
  function grupoDe(nombre: string): Array<{ id: string; ref: { path: string }; data(): Documento }> {
    return Object.keys(documentos)
      .filter((ruta) => {
        const partes = ruta.split('/');
        return partes.length >= 2 && partes[partes.length - 2] === nombre;
      })
      .sort()
      .map((ruta) => ({ id: ruta.split('/').pop()!, ref: { path: ruta }, data: () => documentos[ruta]! }));
  }

  function ordenable(valor: unknown): number | string {
    if (valor instanceof Date) return valor.getTime();
    if (typeof valor === 'number') return valor;
    return String(valor ?? '');
  }

  type Filtro = { campo: string; operador: string; valor: unknown };
  type Orden = { campo: string; direccion: 'asc' | 'desc' };

  function cumple(fila: Documento, filtro: Filtro): boolean {
    const valor = fila[filtro.campo];
    if (filtro.operador === 'in') return Array.isArray(filtro.valor) && filtro.valor.includes(valor);
    if (filtro.operador === '!=') return valor !== filtro.valor;
    // Rangos: la alerta de viajes atrasados consulta `venceAlerta <= now`, y
    // Firestore compara fechas, no referencias. `ordenable` las normaliza igual
    // que para `orderBy`.
    if (filtro.operador === '<=' || filtro.operador === '<'
      || filtro.operador === '>=' || filtro.operador === '>') {
      if (valor === undefined || valor === null) return false;
      const x = ordenable(valor);
      const y = ordenable(filtro.valor);
      if (filtro.operador === '<=') return x <= y;
      if (filtro.operador === '<') return x < y;
      if (filtro.operador === '>=') return x >= y;
      return x > y;
    }
    return valor === filtro.valor;
  }

  function consulta(ruta: string, filtros: Filtro[], orden: Orden | null, tope: number): Documento {
    return {
      path: ruta,
      doc: (id?: string) => referencia(`${ruta}/${id ?? `auto-${(autoId += 1)}`}`),
      where: (campo: string, operador: string, valor: unknown) => consulta(ruta, [...filtros, { campo, operador, valor }], orden, tope),
      orderBy: (campo: string, direccion: 'asc' | 'desc' = 'asc') => consulta(ruta, filtros, { campo, direccion }, tope),
      limit: (cantidad: number) => consulta(ruta, filtros, orden, cantidad),
      get: async () => {
        const origen = ruta.startsWith('@grupo/') ? grupoDe(ruta.slice(7)) : hijosDe(ruta);
        let filas = origen.filter((fila) => filtros.every((filtro) => cumple(fila.data(), filtro)));
        if (orden) {
          filas = [...filas].sort((a, b) => {
            const x = ordenable(a.data()[orden.campo]);
            const y = ordenable(b.data()[orden.campo]);
            const signo = x < y ? -1 : x > y ? 1 : 0;
            return orden.direccion === 'desc' ? -signo : signo;
          });
        }
        return { docs: filas.slice(0, tope) };
      },
    };
  }

  function referencia(ruta: string): Documento {
    return {
      path: ruta,
      id: ruta.split('/').pop(),
      collection: (nombre: string) => coleccion(`${ruta}/${nombre}`),
      get: async () => ({ exists: documentos[ruta] !== undefined, data: () => documentos[ruta] }),
    };
  }

  function coleccion(ruta: string): Documento {
    return consulta(ruta, [], null, Number.MAX_SAFE_INTEGER);
  }

  const db = {
    collection: coleccion,
    collectionGroup: (nombre: string) => consulta(`@grupo/${nombre}`, [], null, Number.MAX_SAFE_INTEGER),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pendientes: Array<() => void> = [];
      let huboEscritura = false;
      const tx = {
        async get(ref: { path: string; doc?: unknown }) {
          if (huboEscritura) throw new Error('lectura despues de escritura');
          // Una referencia de colección se lee como consulta.
          if (typeof ref.doc === 'function') return { docs: hijosDe(ref.path) };
          const datos = documentos[ref.path];
          return { exists: datos !== undefined, data: () => datos };
        },
        set(ref: { path: string }, datos: Documento, opciones?: { merge: boolean }) {
          huboEscritura = true;
          pendientes.push(() => aplicar(ref.path, datos, Boolean(opciones?.merge)));
        },
        delete(ref: { path: string }) {
          huboEscritura = true;
          pendientes.push(() => { delete documentos[ref.path]; });
        },
      };
      const resultado = await fn(tx);
      for (const operacion of pendientes) operacion();
      return resultado;
    },
  };

  return { db, documentos };
}

export function contextoBase(db: unknown, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    uid: 'uid-admin',
    role: 'admin',
    panelLugarId: null,
    ip: '203.0.113.7',
    now: new Date('2026-09-07T12:00:00.000Z'),
    db: db as ActionContext['db'],
    ...extra,
  } as ActionContext;
}

export async function ejecutar(
  nombre: string,
  ctx: ActionContext,
  payload: Record<string, unknown> = {},
) {
  const definicion = getAction(nombre);
  if (!definicion) throw new Error(`accion no registrada: ${nombre}`);
  return definicion.handler(ctx, payload);
}

export function rutas(documentos: Record<string, Documento>, prefijo: string): string[] {
  return Object.keys(documentos).filter((ruta) => ruta.startsWith(prefijo)).sort();
}

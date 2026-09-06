import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

// Cobertura de TODAS las proyecciones publicas que la fachada Firebase leera,
// no solo las dos primeras. Cada una debe permitir `get` anonimo, `list` con
// limite <= 50 y ninguna escritura, para los cuatro roles.
const PROYECCIONES_LISTABLES = [
  'lugaresPublicos',
  'vacantesPublicas',
  'voluntariosPublicos',
  'motorizadosPublicos',
  'historialPublico',
  'trayectosPublicos',
  'donacionesMotorizadosPublicos',
  'entregasPublicas',
  'familiasPublicas',
  'presupuestosPublicos',
  'ofertasPublicas',
] as const;

// Colecciones canonicas: ni un rol autenticado puede leerlas desde el cliente.
const CANONICAS = [
  'lugares',
  'insumos',
  'centrosPanel',
  'voluntarios',
  'rescatistas',
  'motorizados',
  'personas',
  'vacantesVoluntarios',
  'facturas',
  'viajes',
  'trayectos',
  'entregas',
  'donacionesMotorizados',
  'historialMovimientos',
  'familiasDamnificadas',
  'denuncias',
  'auditoriaAdmin',
  'rateLimits',
  'config',
] as const;

const ROLES = ['anonymous', 'user', 'panel', 'admin'] as const;

let testEnv: RulesTestEnvironment;

function dbPara(role: typeof ROLES[number]) {
  return role === 'anonymous'
    ? testEnv.unauthenticatedContext().firestore()
    : testEnv.authenticatedContext(`${role}-uid`, { role }).firestore();
}

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
    for (const coleccion of PROYECCIONES_LISTABLES) {
      await setDoc(doc(db, `${coleccion}/demo-1`), { activo: true, createdAt: '2026-09-06T12:00:00.000Z' });
    }
    await setDoc(doc(db, 'facturasPublicas/DV-AAAA-BBBB-CCCC'), { numero: 'FAC-2026-000001', estado: 'Abierta' });
    await setDoc(doc(db, 'estadisticas/global'), { centrosRegistrados: 3 });
    await setDoc(doc(db, 'estadisticas/otro'), { centrosRegistrados: 3 });
    await setDoc(doc(db, 'tasas/actual'), { efectiva: 36.5 });
    await setDoc(doc(db, 'tasas/2026-09-05'), { efectiva: 36.1 });
    for (const coleccion of CANONICAS) {
      await setDoc(doc(db, `${coleccion}/privado-1`), { dato: 'privado' });
    }
    await setDoc(doc(db, 'facturas/f1/donaciones/d1'), { monto: 10 });
    await setDoc(doc(db, 'indices/lugaresPorNombre/claves/centro-demo'), { lugarId: 'lugar-1' });
  });
});

afterAll(async () => testEnv.cleanup());

describe('Proyecciones publicas listables', () => {
  it.each(PROYECCIONES_LISTABLES)('%s permite get anonimo', async (coleccion) => {
    await assertSucceeds(getDoc(doc(dbPara('anonymous'), `${coleccion}/demo-1`)));
  });

  it.each(PROYECCIONES_LISTABLES)('%s exige un limite de 50 como maximo al listar', async (coleccion) => {
    const db = dbPara('anonymous');
    await assertSucceeds(getDocs(query(collection(db, coleccion), limit(50))));
    await assertFails(getDocs(query(collection(db, coleccion))));
    await assertFails(getDocs(query(collection(db, coleccion), limit(51))));
  });

  it.each(PROYECCIONES_LISTABLES)('%s no admite escritura de ningun rol', async (coleccion) => {
    for (const role of ROLES) {
      await assertFails(setDoc(doc(dbPara(role), `${coleccion}/nuevo`), { dato: 'no permitido' }));
      await assertFails(setDoc(doc(dbPara(role), `${coleccion}/demo-1`), { dato: 'no permitido' }));
    }
  });
});

describe('Factura publica por token', () => {
  it('permite get por token pero nunca listar la coleccion', async () => {
    const db = dbPara('anonymous');
    await assertSucceeds(getDoc(doc(db, 'facturasPublicas/DV-AAAA-BBBB-CCCC')));
    await assertFails(getDocs(query(collection(db, 'facturasPublicas'), limit(10))));
    await assertFails(getDocs(query(collection(db, 'facturasPublicas'), limit(50))));
  });

  it('tampoco permite listar a un admin autenticado', async () => {
    await assertFails(getDocs(query(collection(dbPara('admin'), 'facturasPublicas'), limit(10))));
  });
});

describe('Documentos unicos agregados', () => {
  it('expone solo estadisticas/global y tasas/actual', async () => {
    const db = dbPara('anonymous');
    await assertSucceeds(getDoc(doc(db, 'estadisticas/global')));
    await assertSucceeds(getDoc(doc(db, 'tasas/actual')));
    await assertFails(getDoc(doc(db, 'estadisticas/otro')));
    await assertFails(getDoc(doc(db, 'tasas/2026-09-05')));
    await assertFails(getDocs(query(collection(db, 'estadisticas'), limit(10))));
    await assertFails(getDocs(query(collection(db, 'tasas'), limit(10))));
  });
});

describe('Colecciones canonicas', () => {
  it.each(CANONICAS)('%s queda cerrada para los cuatro roles', async (coleccion) => {
    for (const role of ROLES) {
      const db = dbPara(role);
      await assertFails(getDoc(doc(db, `${coleccion}/privado-1`)));
      await assertFails(getDocs(query(collection(db, coleccion), limit(10))));
      await assertFails(setDoc(doc(db, `${coleccion}/nuevo`), { dato: 'no permitido' }));
    }
  });

  it('cierra tambien las subcolecciones de facturas y los indices de unicidad', async () => {
    for (const role of ROLES) {
      const db = dbPara(role);
      await assertFails(getDoc(doc(db, 'facturas/f1/donaciones/d1')));
      await assertFails(getDocs(query(collection(db, 'facturas/f1/donaciones'), limit(10))));
      await assertFails(getDoc(doc(db, 'indices/lugaresPorNombre/claves/centro-demo')));
    }
  });
});

describe('Cobertura de las reglas', () => {
  it('toda proyeccion publica del archivo de reglas esta cubierta por una prueba', () => {
    const reglas = readFileSync('firebase/firestore.rules', 'utf8');
    const declaradas = [...reglas.matchAll(/match \/([A-Za-z]+)\/\{/g)]
      .map((m) => m[1] as string)
      .filter((nombre) => /Publicos|Publicas|Publico$/.test(nombre));
    const probadas = new Set<string>([...PROYECCIONES_LISTABLES, 'facturasPublicas']);

    expect([...new Set(declaradas)].filter((nombre) => !probadas.has(nombre))).toEqual([]);
  });
});

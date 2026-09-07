import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims } from './entorno.js';

// Ciclo completo del hilo público de una necesidad contra el Emulator Suite:
// alguien dona en especie, cualquiera sigue la factura con el token y SIN
// sesión, el centro confirma lo que va recibiendo y al cubrirla la factura se
// cierra sola con el movimiento `necesidadCubierta`. Es la prueba que exige el
// plan (Task 3.4) y lo que ninguna prueba en proceso cubre: el salto por las
// reglas de Firestore y por los claims reales del ID token.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `facturas-${crypto.randomUUID()}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, EMULADORES.auth, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULADORES.firestore.host, EMULADORES.firestore.port);
  return { auth, db };
}

async function cuenta(sesion: Auth, etiqueta: string): Promise<{ usuario: User; correo: string }> {
  const correo = `${etiqueta}-${crypto.randomUUID()}@prueba.local`;
  const { user } = await createUserWithEmailAndPassword(sesion, correo, 'prueba1234');
  creados.push(user);
  return { usuario: user, correo };
}

async function llamar(accion: string, datos: Record<string, unknown>, idToken?: string) {
  const respuesta = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGEN,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ accion, ...datos }),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, unknown> };
}

type Seguimiento = {
  factura: Record<string, unknown>;
  movimientos: Array<{ tipo: string; monto: number; descripcion: string; fecha: string }>;
  evidencias: Array<{ archivo: string; descripcion: string; fecha: string }>;
  donacionesPublicas: Array<Record<string, unknown>>;
};

// Lo que hace `getSeguimiento(token)` de la fachada: un `get` directo por token,
// sin sesión, bajo las reglas.
async function seguimiento(firestore: Firestore, token: string): Promise<Seguimiento> {
  const documento = await getDoc(doc(firestore, 'facturasPublicas', token));
  expect(documento.exists()).toBe(true);
  return documento.data() as unknown as Seguimiento;
}

function codigos(movimientos: Seguimiento['movimientos']): string[] {
  return movimientos.map((movimiento) => JSON.parse(movimiento.descripcion).c as string);
}

afterEach(async () => {
  for (const usuario of creados.splice(0)) {
    try {
      await deleteUser(usuario);
    } catch { /* la cuenta pudo quedar sin sesion */ }
  }
  try {
    if (auth) await signOut(auth);
  } finally {
    if (app) await deleteApp(app);
    app = undefined;
    auth = undefined;
    db = undefined;
  }
});

it('dona a una necesidad, la sigue por token y la cierra cuando el centro la cubre', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const { usuario: admin } = await cuenta(sesion, 'fac-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const { usuario: responsable, correo: correoPanel } = await cuenta(sesion, 'fac-panel');

  // 1. Un centro con una necesidad, dado de alta de forma anónima como haría
  //    cualquiera desde el formulario público.
  const centro = `PRUEBA · Refugio ${crypto.randomUUID().slice(0, 8)}`;
  const alta = await llamar('registrar_lugar', {
    nombre: centro,
    tipo: 'Refugio',
    ubicacion: 'Catia',
    insumo: 'Colchonetas',
    categoria: 'Refugio',
    estado: 'Necesita',
    cantidad: 80,
  });
  expect(alta.estado).toBe(200);

  // 2. El centro pasa a manos de una cuenta: es lo que emite el claim `panel`.
  const panelDado = await llamar('admin_regenerar_panel', { nombre: centro, email: correoPanel }, tokenAdmin);
  expect(panelDado.estado).toBe(200);
  const tokenPanel = await responsable.getIdToken(true);

  // 3. El centro fija la meta de la necesidad desde su panel.
  const fijada = await llamar('panel_insumo', {
    insumoNombre: 'Colchonetas',
    categoria: 'Refugio',
    estado: 'Necesita',
    urgencia: 'Normal',
    unidad: 'unidades',
    cantidadNecesaria: 80,
    cantidadRecibida: 0,
  }, tokenPanel);
  expect(fijada.estado).toBe(200);

  // 4. Alguien dona en especie, sin cuenta.
  const donacion = await llamar('donar_necesidad', {
    centro,
    insumo: 'Colchonetas',
    cantidad: 30,
    nombreDonante: 'PRUEBA · Casa Solidaria',
  });
  expect(donacion.estado).toBe(200);
  const token = String(donacion.cuerpo.token);
  expect(token).toMatch(/^DV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  expect(donacion.cuerpo.objetivo).toBe(`Colchonetas → ${centro}`);

  // 5. Con el token, cualquiera sigue la factura sin identificarse.
  const inicial = await seguimiento(firestore, token);
  expect(inicial.factura).toMatchObject({
    token_publico: token,
    objetivo: `Colchonetas → ${centro}`,
    estado: 'Abierta',
    moneda: 'unidades',
    monto_requerido: 80,
    monto_recaudado: 0,
    porcentaje: 0,
    porcentaje_completado: 0,
    fecha_cierre: '',
  });
  expect(codigos(inicial.movimientos)).toEqual(['donacionRegistrada']);
  // Una donación en especie no se confirma sola: nadie ha visto llegar nada.
  expect(inicial.donacionesPublicas).toEqual([]);
  // Y el hilo público no dice quién donó.
  expect(JSON.stringify(inicial)).not.toContain('Casa Solidaria');

  // 6. La ficha canónica NO se lee desde el cliente, ni con sesión de admin.
  await expect(getDoc(doc(firestore, 'facturas', 'FCT-CUALQUIERA')))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // 7. El centro confirma la mitad: eso, y no lo prometido, es el porcentaje que
  //    ve el público (el legado dejaba la barra en 0 % hasta el cierre).
  const mitad = await llamar('panel_insumo', {
    insumoNombre: 'Colchonetas',
    estado: 'Necesita',
    unidad: 'unidades',
    cantidadNecesaria: 80,
    cantidadRecibida: 40,
  }, tokenPanel);
  expect(mitad.estado).toBe(200);

  const aMedias = await seguimiento(firestore, token);
  expect(aMedias.factura).toMatchObject({ estado: 'Abierta', monto_recaudado: 40, porcentaje: 50 });
  expect(codigos(aMedias.movimientos)).toEqual(['donacionRegistrada', 'recepcionConfirmada']);
  expect(aMedias.movimientos[1]).toMatchObject({ tipo: 'Entrega', monto: 40 });

  // 8. Al cubrirla, la factura se cierra sola con `necesidadCubierta`.
  const cubierta = await llamar('panel_insumo', {
    insumoNombre: 'Colchonetas',
    estado: 'Cubierto',
    unidad: 'unidades',
    cantidadNecesaria: 80,
    cantidadRecibida: 80,
  }, tokenPanel);
  expect(cubierta.estado).toBe(200);

  const cerrada = await seguimiento(firestore, token);
  expect(cerrada.factura).toMatchObject({ estado: 'Cerrada', monto_recaudado: 80, porcentaje: 100 });
  expect(String(cerrada.factura.fecha_cierre)).not.toBe('');
  expect(codigos(cerrada.movimientos))
    .toEqual(['donacionRegistrada', 'recepcionConfirmada', 'recepcionConfirmada', 'necesidadCubierta']);

  // 9. Cerrada la necesidad, una donación nueva abre otro hilo: el objetivo
  //    quedó libre en el índice.
  const siguiente = await llamar('donar_necesidad', { centro, insumo: 'Colchonetas', cantidad: 5 });
  expect(siguiente.estado).toBe(200);
  expect(siguiente.cuerpo.token).not.toBe(token);
}, 60000);

it('lleva la factura manual del admin de punta a punta y la deja legible por token', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const { usuario: persona } = await cuenta(sesion, 'fac-user');
  const tokenUsuario = await persona.getIdToken();

  // Sin rol admin, 403; sin sesión, 401. El despachador corta antes del dominio.
  const objetivo = `PRUEBA · Compra ${crypto.randomUUID().slice(0, 8)}`;
  expect((await llamar('admin_crear_factura', { objetivo, montoRequerido: 100 }, tokenUsuario)).estado).toBe(403);
  expect((await llamar('admin_crear_factura', { objetivo, montoRequerido: 100 })).estado).toBe(401);

  const { usuario: admin } = await cuenta(sesion, 'fac-admin2');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const creada = await llamar('admin_crear_factura', {
    objetivo, descripcion: 'PRUEBA · Compra directa', montoRequerido: 1000,
  }, tokenAdmin);
  expect(creada.estado).toBe(200);
  const token = String(creada.cuerpo.token);
  expect(String(creada.cuerpo.numeroFactura)).toMatch(/^FAC-\d{4}-\d{6}$/);

  // Repetir el objetivo mientras siga abierta es 409: el legado dejaba dos
  // hilos para lo mismo y ninguno llegaba a su meta.
  expect((await llamar('admin_crear_factura', { objetivo, montoRequerido: 50 }, tokenAdmin)).estado).toBe(409);

  // Una donación asentada a mano suma solo si se marca confirmada.
  expect((await llamar('admin_registrar_donacion', {
    token, monto: 400, nombreDonante: 'PRUEBA · Efectivo', estado: 'Registrada',
  }, tokenAdmin)).cuerpo).toMatchObject({ recaudado: 0 });
  expect((await llamar('admin_registrar_donacion', {
    token, monto: 400, nombreDonante: 'PRUEBA · Transferencia', estado: 'Confirmada',
  }, tokenAdmin)).cuerpo).toMatchObject({ recaudado: 400, estado: 'Abierta' });

  await llamar('admin_registrar_movimiento', {
    token, tipo: 'Egreso', descripcion: 'PRUEBA · Gasto de traslado', monto: 25,
  }, tokenAdmin);
  await llamar('admin_registrar_evidencia', {
    token, archivo: 'https://ejemplo.test/prueba-factura.pdf', descripcion: 'PRUEBA · Factura',
  }, tokenAdmin);
  await llamar('admin_registrar_evidencia', {
    token, archivo: 'https://ejemplo.test/prueba-interna.pdf', descripcion: 'PRUEBA · Interna', publica: false,
  }, tokenAdmin);

  const publico = await seguimiento(firestore, token);
  expect(publico.factura).toMatchObject({
    objetivo, descripcion: 'PRUEBA · Compra directa', estado: 'Abierta',
    monto_requerido: 1000, monto_recaudado: 400, porcentaje: 40,
  });
  // El desglose es anónimo y solo trae lo confirmado.
  expect(publico.donacionesPublicas).toHaveLength(1);
  expect(JSON.stringify(publico.donacionesPublicas)).not.toContain('Transferencia');
  // La evidencia privada no sale.
  expect(publico.evidencias).toEqual([
    expect.objectContaining({ archivo: 'https://ejemplo.test/prueba-factura.pdf' }),
  ]);
  expect(JSON.stringify(publico)).not.toContain('prueba-interna.pdf');

  // El listado del admin ve la fila con su última actualización.
  const listado = await llamar('admin_listar_facturas', {}, tokenAdmin);
  const fila = (listado.cuerpo.facturas as Array<Record<string, unknown>>).find((f) => f.token_publico === token);
  expect(fila).toMatchObject({ objetivo, estado: 'Abierta', monto_recaudado: 400, tipo: 'dinero' });
  expect(String(fila!.ultima_actualizacion)).not.toBe('');

  // Cerrar es la única transición sin comprobar el estado previo.
  expect((await llamar('admin_cerrar_factura', { token }, tokenAdmin)).cuerpo)
    .toMatchObject({ estado: 'Cerrada' });
  const cerrada = await seguimiento(firestore, token);
  expect(cerrada.factura).toMatchObject({ estado: 'Cerrada' });
  expect(String(cerrada.factura.fecha_cierre)).not.toBe('');
}, 60000);

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
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims, sembrarDocumento } from './entorno.js';

// Ciclo de compra verificada de punta a punta contra el Emulator Suite, y el
// ciclo de una oferta hasta donde llega sin la Task 3.5.
//
// Lo que ninguna prueba en proceso cubre: que la vista publica se pueda leer SIN
// sesion bajo las reglas de Firestore, que la ficha canonica y el contacto de
// quien ofrece NO se puedan leer desde el cliente, y que el rol admin salga de
// verdad de un ID token.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `presupuestos-${crypto.randomUUID()}`);
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

it('recauda un presupuesto, lo transfiere, lo compra y lo pone en la cola del transportista', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const { usuario: admin } = await cuenta(sesion, 'pres-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const { usuario: donante } = await cuenta(sesion, 'pres-donante');
  const tokenDonante = await donante.getIdToken();

  // 1. Un centro con una necesidad.
  const centro = `PRUEBA · Hospital ${crypto.randomUUID().slice(0, 8)}`;
  expect((await llamar('registrar_lugar', {
    nombre: centro, tipo: 'Hospital', ubicacion: 'La Guaira',
    insumo: 'Agua potable', categoria: 'Alimentos', estado: 'Necesita', cantidad: 500,
  })).estado).toBe(200);

  // 2. El admin cotiza. El adjunto es un archivo privado suyo, no un enlace
  //    público e irrevocable como en el legado.
  const tienda = `PRUEBA · Farmacia ${crypto.randomUUID().slice(0, 8)}`;
  const creado = await llamar('admin_crear_presupuesto', {
    centro,
    insumo: 'Agua potable',
    tienda,
    direccion: 'Av. Principal',
    cantidad: 500,
    presentacion: 'Bidón de 20 L',
    precio: 5000,
    tiendaLat: 10.6,
    tiendaLng: -66.93,
    tiendaUrl: 'https://tienda.example/sur',
    adjuntoPath: `private/${admin.uid}/receipts/cotizacion.pdf`,
  }, tokenAdmin);

  expect(creado.estado).toBe(200);
  const token = String(creado.cuerpo.token);

  // 3. La vista pública se lee SIN sesión, bajo las reglas, y no lleva los datos
  //    de gestión.
  const publicada = await getDoc(doc(firestore, 'presupuestosPublicos', token));
  expect(publicada.exists()).toBe(true);
  const vista = publicada.data() as Record<string, unknown>;
  expect(vista).toMatchObject({
    token, estado: 'Abierta', centro, tienda, precio: 5000, recaudado: 0, moneda: 'VES',
  });
  expect(JSON.stringify(vista)).not.toContain('receipts');
  expect(Object.keys(vista)).not.toContain('tiendaLat');

  // Y la ficha canónica no.
  await expect(getDoc(doc(firestore, 'facturas', 'FCT-CUALQUIERA')))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // 4. `listar_presupuestos` lo devuelve con la tasa. La tasa la captura el
  //    trabajo programado de la Task 3.8; aqui se siembra saltandose las reglas,
  //    porque sin ella `donar_dinero` responde «tasa de cambio no disponible» y
  //    el ciclo no se puede recorrer entero.
  await sembrarDocumento('tasas/actual', {
    efectiva: 250, diaria: 245, fuente: 'prueba', fecha: '2026-09-07T00:00:00.000Z',
    capturadaAt: '2026-09-07T00:00:00.000Z',
  });
  const listado = await llamar('listar_presupuestos', {});
  expect(listado.estado).toBe(200);
  const enLista = (listado.cuerpo.presupuestos as Array<Record<string, unknown>>).find((p) => p.token === token);
  expect(enLista).toMatchObject({ estado: 'Abierta', precio: 5000 });
  const tasa = listado.cuerpo.tasa as { efectiva: number } | null;
  expect(tasa && tasa.efectiva > 0).toBe(true);

  // 5. Donar exige sesión: el comprobante va a `private/<uid>/receipts/`.
  expect((await llamar('donar_dinero', { token, montoUsd: 1, comprobante: 'x' })).estado).toBe(401);

  const montoUsd = Math.ceil(5000 / tasa!.efectiva) + 1;
  const donado = await llamar('donar_dinero', {
    token, montoUsd, nombreDonante: 'PRUEBA · Ana',
    comprobantePath: `private/${donante.uid}/receipts/comprobante.jpg`,
  }, tokenDonante);

  expect(donado.estado).toBe(200);
  expect(donado.cuerpo).toMatchObject({ estado: 'PorComprar', token });
  expect(String(donado.cuerpo.referencia)).toMatch(/^REF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // 6. El admin ve la donación con la RUTA del comprobante, no con una URL.
  const donaciones = await llamar('admin_donaciones_presupuesto', { token }, tokenAdmin);
  const fila = (donaciones.cuerpo.donaciones as Array<Record<string, unknown>>)[0]!;
  expect(fila).toMatchObject({
    token, nombre_donante: 'PRUEBA · Ana', estado: 'Confirmada', comprobante_url: '',
  });
  expect(String(fila.comprobante)).toBe(`private/${donante.uid}/receipts/comprobante.jpg`);

  // 7. Está en la cola de compra.
  const cola = await llamar('admin_presupuestos_por_comprar', {}, tokenAdmin);
  expect((cola.cuerpo.presupuestos as Array<Record<string, unknown>>).map((p) => p.token)).toContain(token);

  // 8. Transferir y comprar.
  expect((await llamar('admin_presupuesto_transferido', {
    token, consolidadoPath: `private/${admin.uid}/receipts/consolidado.pdf`,
  }, tokenAdmin)).cuerpo).toMatchObject({ estado: 'Transferida' });

  expect((await llamar('admin_presupuesto_comprado', {
    token, facturaPath: `private/${admin.uid}/receipts/factura.pdf`,
  }, tokenAdmin)).cuerpo).toMatchObject({ estado: 'Comprada' });

  // 9. Comprada es lo que abre la cola del transportista.
  const comprados = await llamar('listar_comprados', {});
  expect((comprados.cuerpo.comprados as Array<Record<string, unknown>>).map((c) => c.token)).toContain(token);

  // 10. El hilo público cuenta la historia entera, sin identidad ni rutas.
  const seguimiento = (await getDoc(doc(firestore, 'facturasPublicas', token))).data() as Record<string, unknown>;
  const movimientos = seguimiento.movimientos as Array<{ descripcion: string }>;
  expect(movimientos.map((m) => JSON.parse(m.descripcion).c))
    .toEqual(['dineroRecibido', 'metaCubierta', 'transferidoABs', 'compraConfirmada']);
  expect(seguimiento.factura).toMatchObject({ estado: 'Comprada', porcentaje: 100 });
  expect(JSON.stringify(seguimiento)).not.toContain('PRUEBA · Ana');
  expect(JSON.stringify(seguimiento)).not.toContain('receipts');

  // 11. Anular la donación no reabre una compra ya hecha.
  expect((await llamar('admin_donacion_anular', { token, id: fila.id }, tokenAdmin)).cuerpo)
    .toMatchObject({ estado: 'Comprada', recaudado: 0 });
  // Y anularla otra vez es 409, no un éxito silencioso como en el legado.
  expect((await llamar('admin_donacion_anular', { token, id: fila.id }, tokenAdmin)).estado).toBe(409);
}, 90000);

it('publica una oferta sin el contacto y solo lo entrega a quien tiene la reserva', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const { usuario: donante } = await cuenta(sesion, 'of-donante');
  const tokenDonante = await donante.getIdToken();
  const { usuario: moto } = await cuenta(sesion, 'of-moto');
  const tokenMoto = await moto.getIdToken();

  // Sin sesión no se puede ofrecer: las fotos van a `private/<uid>/offers/`.
  expect((await llamar('ofrecer_insumo', { insumo: 'X', cantidad: 1 })).estado).toBe(401);

  const insumo = `PRUEBA · Colchonetas ${crypto.randomUUID().slice(0, 8)}`;
  const ofrecida = await llamar('ofrecer_insumo', {
    insumo,
    cantidad: 12,
    unidad: 'unidades',
    ubicacion: 'PRUEBA · Casa de Ana, callejón El Rosal nº 4',
    telefono: '04141234567',
    nombreDonante: 'PRUEBA · Ana Pérez',
    zona: 'PRUEBA · Chacao',
    centro: 'PRUEBA · Refugio Catia',
    lat: 10.4971,
    lng: -66.8534,
    fotosInsumoPath: [`private/${donante.uid}/offers/insumo-1.jpg`],
    fotoCedulaPath: `private/${donante.uid}/offers/cedula.jpg`,
  }, tokenDonante);

  expect(ofrecida.estado).toBe(200);
  const token = String(ofrecida.cuerpo.token);

  // La tarjeta pública: zona y un punto de ~1 km, nada más.
  const vista = (await getDoc(doc(firestore, 'ofertasPublicas', token))).data() as Record<string, unknown>;
  expect(vista).toMatchObject({
    token, estado: 'Ofrecida', insumo, cantidad: 12, zona: 'PRUEBA · Chacao',
    coordsAprox: { lat: 10.5, lng: -66.85 },
  });
  const comoTexto = JSON.stringify(vista);
  expect(comoTexto).not.toContain('04141234567');
  expect(comoTexto).not.toContain('Ana Pérez');
  expect(comoTexto).not.toContain('El Rosal');

  // El hilo de seguimiento por token tampoco lo filtra. Ésta es la fuga que el
  // legado tenía: `seguimiento_factura` devolvía la `descripcion` íntegra.
  const seguimiento = (await getDoc(doc(firestore, 'facturasPublicas', token))).data() as Record<string, unknown>;
  const texto = JSON.stringify(seguimiento);
  expect(texto).not.toContain('04141234567');
  expect(texto).not.toContain('Ana Pérez');
  expect(texto).not.toContain('El Rosal');
  expect(texto).not.toContain('10.4971');

  // El documento de contacto está cerrado a cal y canto, incluso para quien lo
  // escribió.
  await expect(getDocs(query(collection(firestore, 'facturasContacto'), limit(10))))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // Aparece en el directorio de ofertas.
  const lista = await llamar('listar_ofertas', {});
  expect((lista.cuerpo.ofertas as Array<Record<string, unknown>>).map((o) => o.token)).toContain(token);

  // Y el contacto no sale por ninguna otra vía: sin la reserva de viaje (Task
  // 3.5) las dos acciones que lo entregan fallan cerradas.
  expect((await llamar('reserva_detalle', { token })).estado).toBe(401);
  const detalle = await llamar('reserva_detalle', { token }, tokenMoto);
  expect(detalle.estado).toBe(403);
  expect(detalle.cuerpo).toMatchObject({ success: false, error: 'Tu reserva venció; vuelve a reservarla' });
  expect((await llamar('recoger_oferta', { token, centroDestino: 'PRUEBA · Refugio Catia' }, tokenMoto)).estado).toBe(403);

  // Comprobación de forma: la proyección pública se puede listar acotada, como
  // hace el directorio.
  const acotada = await getDocs(query(
    collection(firestore, 'ofertasPublicas'),
    where('estado', '==', 'Ofrecida'),
    limit(50),
  ));
  expect(acotada.docs.some((documento) => documento.id === token)).toBe(true);
}, 60000);

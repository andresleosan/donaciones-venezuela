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
  type Firestore,
} from 'firebase/firestore';
import { afterEach, expect, it } from 'vitest';

import { DEMO_FIREBASE_CONFIG, EMULADORES, darClaims, sembrarDocumento } from './entorno.js';

// El ciclo logistico de tres pasos contra el Emulator Suite, de punta a punta.
//
// Lo que ninguna prueba en proceso cubre: que `viajes` sea ilegible desde el
// cliente aunque lleve el GPS de quien lo conduce, que la reserva sea de verdad
// exclusiva entre dos cuentas distintas del emulador de Auth, y que el rol admin
// que resuelve un viaje atrasado salga de un ID token y no del cuerpo.
const apiUrl = `${EMULADORES.functions}/api`;
const ORIGEN = 'http://localhost:5173';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
const creados: User[] = [];

function arrancar(): { auth: Auth; db: Firestore } {
  app = initializeApp(DEMO_FIREBASE_CONFIG, `viajes-${crypto.randomUUID()}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, EMULADORES.auth, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULADORES.firestore.host, EMULADORES.firestore.port);
  return { auth, db };
}

async function cuenta(sesion: Auth, etiqueta: string): Promise<User> {
  const correo = `${etiqueta}-${crypto.randomUUID()}@prueba.local`;
  const { user } = await createUserWithEmailAndPassword(sesion, correo, 'prueba1234');
  creados.push(user);
  return user;
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

// Caracas: la tienda, un punto a ~3 km y el centro. Todos dentro de la caja de
// Venezuela que exige `geoValida`.
const GPS_TIENDA = { lat: 10.5061, lng: -66.9146 };
const GPS_RECOGIDA = { lat: 10.5261, lng: -66.9346 };
const GPS_CENTRO = { lat: 10.4806, lng: -66.9036 };

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

it('lleva un presupuesto comprado hasta el centro: reserva, recogida y entrega', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const admin = await cuenta(sesion, 'via-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const donante = await cuenta(sesion, 'via-donante');
  const tokenDonante = await donante.getIdToken();

  const moto = await cuenta(sesion, 'via-moto');
  const tokenMoto = await moto.getIdToken();

  const otraMoto = await cuenta(sesion, 'via-otra');
  const tokenOtraMoto = await otraMoto.getIdToken();

  await sembrarDocumento('tasas/actual', {
    efectiva: 250, diaria: 245, fuente: 'prueba', fecha: '2026-09-07T00:00:00.000Z',
    capturadaAt: '2026-09-07T00:00:00.000Z',
  });

  // 1. Un presupuesto llevado hasta `Comprada`, que es lo unico que abre el
  //    ciclo del transportista.
  const centro = `PRUEBA · Refugio ${crypto.randomUUID().slice(0, 8)}`;
  const tienda = `PRUEBA · Ferretería ${crypto.randomUUID().slice(0, 8)}`;
  expect((await llamar('registrar_lugar', {
    nombre: centro, tipo: 'Refugio', ubicacion: 'Caracas',
    insumo: 'Mantas', categoria: 'Refugio', estado: 'Necesita', cantidad: 100,
  })).estado).toBe(200);

  const creado = await llamar('admin_crear_presupuesto', {
    centro, insumo: 'Mantas', tienda, direccion: 'PRUEBA · Av. Principal',
    cantidad: 100, presentacion: 'Fardo de 10', precio: 5000,
    tiendaLat: GPS_TIENDA.lat, tiendaLng: GPS_TIENDA.lng,
    adjuntoPath: `private/${admin.uid}/receipts/cotizacion.pdf`,
  }, tokenAdmin);
  expect(creado.estado).toBe(200);
  const token = String(creado.cuerpo.token);

  expect((await llamar('donar_dinero', {
    token, montoUsd: 25, nombreDonante: 'PRUEBA · Ana',
    comprobantePath: `private/${donante.uid}/receipts/comprobante.jpg`,
  }, tokenDonante)).cuerpo).toMatchObject({ estado: 'PorComprar' });

  expect((await llamar('admin_presupuesto_comprado', {
    token, facturaPath: `private/${admin.uid}/receipts/factura.pdf`,
  }, tokenAdmin)).cuerpo).toMatchObject({ estado: 'Comprada' });

  // 2. Reservar exige sesion y GPS.
  expect((await llamar('viaje_iniciar', { token, etaMinutos: 45, gps: GPS_TIENDA })).estado).toBe(401);
  expect((await llamar('viaje_iniciar', { token, etaMinutos: 45 }, tokenMoto)).cuerpo)
    .toMatchObject({ error: 'Se necesita tu ubicación GPS para iniciar el viaje' });

  const reserva = await llamar('viaje_iniciar', {
    token, etaMinutos: 45, gps: GPS_TIENDA, nombreTransportista: 'PRUEBA · Luis',
  }, tokenMoto);
  expect(reserva.estado).toBe(200);
  expect(reserva.cuerpo).toMatchObject({ ok: true, etaMinutos: 45 });
  const viajeId = String(reserva.cuerpo.viajeId);

  // 3. La reserva es exclusiva: otra cuenta del emulador no la puede tomar ni
  //    avanzar el ciclo.
  const ajena = await llamar('viaje_iniciar', { token, etaMinutos: 30, gps: GPS_TIENDA }, tokenOtraMoto);
  expect(ajena.estado).toBe(409);
  expect(ajena.cuerpo).toMatchObject({ error: 'Este trabajo ya lo reservó otra persona' });

  const recogeAjena = await llamar('registrar_recogida', {
    token,
    fotoSitioPath: `private/${otraMoto.uid}/deliveries/sitio.jpg`,
    fotoInsumoPath: `private/${otraMoto.uid}/deliveries/insumo.jpg`,
    gps: GPS_RECOGIDA,
  }, tokenOtraMoto);
  expect(recogeAjena.estado).toBe(403);
  expect(recogeAjena.cuerpo).toMatchObject({ error: 'Este trabajo está reservado por otra persona' });

  // 4. El documento del viaje lleva el GPS exacto de una persona: el cliente no
  //    lo lee ni por id ni listando.
  await expect(getDoc(doc(firestore, 'viajes', viajeId)))
    .rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getDocs(query(collection(firestore, 'viajes'), limit(10))))
    .rejects.toMatchObject({ code: 'permission-denied' });

  // 5. Recogida: cambia el estado y calcula los km del primer tramo.
  const recogida = await llamar('registrar_recogida', {
    token,
    fotoSitioPath: `private/${moto.uid}/deliveries/sitio.jpg`,
    fotoInsumoPath: `private/${moto.uid}/deliveries/insumo.jpg`,
    notas: 'PRUEBA · faltaban 2 fardos',
    gps: GPS_RECOGIDA,
  }, tokenMoto);
  expect(recogida.estado).toBe(200);
  expect(recogida.cuerpo).toMatchObject({ estado: 'EnTransito' });
  expect(Number(recogida.cuerpo.km)).toBeGreaterThan(0);

  // 6. Entrega final: cierra la factura y suma los dos tramos.
  const entrega = await llamar('registrar_entrega_final', {
    token, nombreReceptor: 'PRUEBA · Sra. Rodríguez', cargoReceptor: 'Coordinadora',
    fotoCentroPath: `private/${moto.uid}/deliveries/centro.jpg`,
    gps: GPS_CENTRO,
  }, tokenMoto);
  expect(entrega.estado).toBe(200);
  expect(entrega.cuerpo).toMatchObject({ estado: 'Entregada' });
  expect(Number(entrega.cuerpo.km)).toBeGreaterThan(Number(recogida.cuerpo.km));

  // 7. El hilo publico cuenta la historia entera y no filtra ni una coordenada
  //    ni una ruta de Storage.
  const seguimiento = (await getDoc(doc(firestore, 'facturasPublicas', token))).data() as Record<string, unknown>;
  const movimientos = seguimiento.movimientos as Array<{ descripcion: string }>;
  expect(movimientos.map((m) => JSON.parse(m.descripcion).c)).toEqual([
    'dineroRecibido', 'metaCubierta', 'compraConfirmada', 'viajeIniciado',
    'insumoRecogidoConNota', 'entregadoConCargo',
  ]);
  expect(seguimiento.factura).toMatchObject({ estado: 'Entregada' });

  const texto = JSON.stringify(seguimiento);
  expect(texto).not.toContain('deliveries');
  expect(texto).not.toContain(String(GPS_RECOGIDA.lat));
  expect(texto).not.toContain('PRUEBA · Ana');

  // 8. Y sale de la cola del transportista.
  const comprados = await llamar('listar_comprados', {});
  expect((comprados.cuerpo.comprados as Array<Record<string, unknown>>).map((c) => c.token))
    .not.toContain(token);
}, 120000);

it('la alerta de atrasos es del admin, y resolver un viaje libera el trabajo', async () => {
  const { auth: sesion } = arrancar();

  const admin = await cuenta(sesion, 'atr-admin');
  await darClaims(admin.uid, { role: 'admin' });
  const tokenAdmin = await admin.getIdToken(true);

  const moto = await cuenta(sesion, 'atr-moto');
  const tokenMoto = await moto.getIdToken();

  const otraMoto = await cuenta(sesion, 'atr-otra');
  const tokenOtraMoto = await otraMoto.getIdToken();

  await sembrarDocumento('tasas/actual', {
    efectiva: 250, diaria: 245, fuente: 'prueba', fecha: '2026-09-07T00:00:00.000Z',
    capturadaAt: '2026-09-07T00:00:00.000Z',
  });

  const centro = `PRUEBA · Refugio ${crypto.randomUUID().slice(0, 8)}`;
  const tienda = `PRUEBA · Bodega ${crypto.randomUUID().slice(0, 8)}`;
  // El presupuesto se cuelga de un centro que exista: `admin_crear_presupuesto`
  // resuelve el nombre contra `lugares` y responde 404 si no está.
  expect((await llamar('registrar_lugar', {
    nombre: centro, tipo: 'Refugio', ubicacion: 'Caracas',
    insumo: 'Agua', categoria: 'Alimentos', estado: 'Necesita', cantidad: 50,
  })).estado).toBe(200);

  const creado = await llamar('admin_crear_presupuesto', {
    centro, insumo: 'Agua', tienda, direccion: 'PRUEBA · Calle 2',
    cantidad: 50, presentacion: 'Bidón', precio: 1000,
    tiendaLat: GPS_TIENDA.lat, tiendaLng: GPS_TIENDA.lng,
    adjuntoPath: `private/${admin.uid}/receipts/cotizacion.pdf`,
  }, tokenAdmin);
  expect(creado.estado).toBe(200);
  const token = String(creado.cuerpo.token);
  expect((await llamar('donar_dinero', {
    token, montoUsd: 5, comprobantePath: `private/${admin.uid}/receipts/c.jpg`,
  }, tokenAdmin)).cuerpo).toMatchObject({ estado: 'PorComprar' });
  expect((await llamar('admin_presupuesto_comprado', {
    token, facturaPath: `private/${admin.uid}/receipts/f.pdf`,
  }, tokenAdmin)).cuerpo).toMatchObject({ estado: 'Comprada' });

  const reserva = await llamar('viaje_iniciar', {
    token, etaMinutos: 30, gps: GPS_TIENDA, nombreTransportista: 'PRUEBA · Luis',
  }, tokenMoto);
  expect(reserva.estado).toBe(200);
  const viajeId = String(reserva.cuerpo.viajeId);

  // La lista de atrasados es solo del admin.
  expect((await llamar('admin_viajes_atrasados', {}, tokenMoto)).estado).toBe(403);
  const atrasados = await llamar('admin_viajes_atrasados', {}, tokenAdmin);
  expect(atrasados.estado).toBe(200);
  // Recien reservado no esta atrasado: el umbral del tramo 1 son `eta + 120` min.
  expect((atrasados.cuerpo.viajes as Array<Record<string, unknown>>).map((v) => v.id))
    .not.toContain(viajeId);

  // Resolverlo libera el trabajo sin deshacer la compra.
  expect((await llamar('admin_viaje_resolver', { id: viajeId }, tokenMoto)).estado).toBe(403);
  expect((await llamar('admin_viaje_resolver', { id: viajeId }, tokenAdmin)).cuerpo)
    .toMatchObject({ resuelto: true });

  // Quien la tenia ya no puede recoger...
  const tarde = await llamar('registrar_recogida', {
    token,
    fotoSitioPath: `private/${moto.uid}/deliveries/sitio.jpg`,
    fotoInsumoPath: `private/${moto.uid}/deliveries/insumo.jpg`,
    gps: GPS_RECOGIDA,
  }, tokenMoto);
  expect(tarde.estado).toBe(403);
  expect(tarde.cuerpo).toMatchObject({ error: 'Tu reserva venció; vuelve a reservarla' });

  // ...y otra persona sí puede tomar el trabajo.
  const nueva = await llamar('viaje_iniciar', {
    token, etaMinutos: 60, gps: GPS_TIENDA, nombreTransportista: 'PRUEBA · Otra',
  }, tokenOtraMoto);
  expect(nueva.estado).toBe(200);
  expect(String(nueva.cuerpo.viajeId)).not.toBe(viajeId);
}, 120000);

it('reserva una oferta, entrega su contacto solo al dueño y cierra el ciclo', async () => {
  const { auth: sesion, db: firestore } = arrancar();

  const donante = await cuenta(sesion, 'ofv-donante');
  const tokenDonante = await donante.getIdToken();
  const moto = await cuenta(sesion, 'ofv-moto');
  const tokenMoto = await moto.getIdToken();
  const otraMoto = await cuenta(sesion, 'ofv-otra');
  const tokenOtraMoto = await otraMoto.getIdToken();

  const insumo = `PRUEBA · Colchonetas ${crypto.randomUUID().slice(0, 8)}`;
  const centro = `PRUEBA · Refugio ${crypto.randomUUID().slice(0, 8)}`;
  const ofrecida = await llamar('ofrecer_insumo', {
    insumo, cantidad: 12, unidad: 'unidades',
    ubicacion: 'PRUEBA · Casa de Ana, callejón El Rosal nº 4',
    telefono: '04141234567', nombreDonante: 'PRUEBA · Ana Pérez',
    zona: 'PRUEBA · Chacao', centro,
    lat: 10.4971, lng: -66.8534,
    fotosInsumoPath: [`private/${donante.uid}/offers/insumo-1.jpg`],
  }, tokenDonante);
  expect(ofrecida.estado).toBe(200);
  const token = String(ofrecida.cuerpo.token);

  // Sin reserva no hay contacto, ni siquiera con sesión.
  const sinReserva = await llamar('reserva_detalle', { token }, tokenMoto);
  expect(sinReserva.estado).toBe(403);
  expect(sinReserva.cuerpo).toMatchObject({ error: 'Tu reserva venció; vuelve a reservarla' });

  // Reservar la oferta la pone `EnCamino` y entrega el contacto, que es lo que
  // hacía el legado — pero ahora solo aquí, y solo a quien tiene la reserva.
  const reserva = await llamar('viaje_iniciar', {
    token, etaMinutos: 60, gps: GPS_TIENDA, nombreTransportista: 'PRUEBA · Luis',
  }, tokenMoto);
  expect(reserva.estado).toBe(200);
  expect(reserva.cuerpo.detalle).toMatchObject({
    telefono: '04141234567',
    nombreDonante: 'PRUEBA · Ana Pérez',
    ubicacion: 'PRUEBA · Casa de Ana, callejón El Rosal nº 4',
  });

  // A otra persona con sesión, no.
  expect((await llamar('reserva_detalle', { token }, tokenOtraMoto)).cuerpo)
    .toMatchObject({ error: 'Este trabajo está reservado por otra persona' });
  // Y a quien la tiene, sí.
  expect((await llamar('reserva_detalle', { token }, tokenMoto)).cuerpo.detalle)
    .toMatchObject({ telefono: '04141234567' });

  // La tarjeta pública sigue sin contacto aunque esté reservada.
  const vista = (await getDoc(doc(firestore, 'ofertasPublicas', token))).data() as Record<string, unknown>;
  expect(vista).toMatchObject({ estado: 'EnCamino' });
  expect(JSON.stringify(vista)).not.toContain('04141234567');

  // Recogida (paso 2 de la oferta) y entrega final.
  const recogida = await llamar('recoger_oferta', {
    token, centroDestino: centro,
    fotoSitioPath: `private/${moto.uid}/offers/recogida-sitio.jpg`,
    gps: GPS_RECOGIDA,
  }, tokenMoto);
  expect(recogida.estado).toBe(200);
  expect(recogida.cuerpo).toMatchObject({ estado: 'Recogida' });
  expect(Number(recogida.cuerpo.km)).toBeGreaterThan(0);

  const entrega = await llamar('registrar_entrega_final', {
    token, nombreReceptor: 'PRUEBA · Encargado',
    fotoCentroPath: `private/${moto.uid}/deliveries/centro.jpg`,
    gps: GPS_CENTRO,
  }, tokenMoto);
  expect(entrega.estado).toBe(200);
  expect(entrega.cuerpo).toMatchObject({ estado: 'Entregada' });

  // El hilo público de la oferta cuenta el ciclo sin filtrar el contacto.
  const seguimiento = (await getDoc(doc(firestore, 'facturasPublicas', token))).data() as Record<string, unknown>;
  const texto = JSON.stringify(seguimiento);
  expect(texto).not.toContain('04141234567');
  expect(texto).not.toContain('Ana Pérez');
  expect(texto).not.toContain('El Rosal');
  expect((seguimiento.movimientos as Array<{ descripcion: string }>).map((m) => JSON.parse(m.descripcion).c))
    .toEqual(['donacionOfrecida', 'viajeIniciado', 'donacionRecogida', 'entregado']);
}, 120000);

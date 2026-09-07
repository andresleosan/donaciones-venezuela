// Semilla determinista para el Emulator Suite.
//
// Datos sinteticos, todos marcados `PRUEBA · ` / `@prueba.local` / `DV-SEED-*`,
// portados de `scripts/semilla-pruebas.sql`. NO migra nada de Supabase.
//
// Solo corre contra los emuladores locales: si `FIRESTORE_EMULATOR_HOST` o
// `FIREBASE_AUTH_EMULATOR_HOST` no apuntan a 127.0.0.1, aborta. Escribir esto
// contra el proyecto real seria contaminar la base de produccion con datos
// falsos, y no hay forma de distinguirlo despues salvo por el prefijo.
//
// Las proyecciones publicas se derivan con `proyeccionPublica()`, la misma
// funcion que usan las acciones: si la allowlist cambia, la semilla cambia con
// ella y nunca publica un campo que la app no publicaria.

const PROYECTO = 'demo-donaciones-venezuela';
const LOCAL = /^(127\.0\.0\.1|\[::1\]|localhost):\d+$/;

function exigeEmuladorLocal(variable) {
  const valor = process.env[variable];
  if (!valor || !LOCAL.test(valor)) {
    throw new Error(`${variable} debe apuntar a un emulador local (127.0.0.1:puerto), no a "${valor ?? ''}"`);
  }
}

exigeEmuladorLocal('FIRESTORE_EMULATOR_HOST');
exigeEmuladorLocal('FIREBASE_AUTH_EMULATOR_HOST');

const projectId = process.env.FIREBASE_PROJECT_ID ?? PROYECTO;
if (projectId !== PROYECTO) {
  throw new Error(`La semilla solo se aplica al proyecto ${PROYECTO}`);
}

const { initializeApp } = await import('firebase-admin/app');
initializeApp({ projectId });

const { getFirestore } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
const { proyeccionPublica } = await import('../lib/api/publicar.js');
const { normalizar } = await import('../lib/api/contract.js');
const { estadisticasVacias } = await import('../lib/api/estadisticas.js');
// La proyeccion y el id de insumo salen del propio dominio: si cambia el
// modelo, la semilla cambia con el y no queda describiendo una app anterior.
const { claveInsumo, documentoPublico } = await import('../lib/api/lugares.js');

const db = getFirestore();
const auth = getAuth();

// Fecha fija para todo lo que la app muestra: la semilla ordena y filtra igual
// en cada ejecucion. Lo unico que varia es el `updatedAt` que sella
// `proyeccionPublica`, que es la hora real de escritura.
const AHORA = new Date('2026-09-06T12:00:00.000Z');

const LUGARES = [
  {
    id: 'LUG-SEED-1',
    tipo: 'Hospital',
    nombre: 'PRUEBA · Hospital Vargas',
    ubicacion: 'La Guaira',
    telefono: '+58 212 000 0001',
    lat: 10.6009,
    lng: -66.933,
    gestionado: true,
    insumos: [
      { nombre: 'Agua potable', categoria: 'Alimentos', estado: 'Necesita', cantidadNecesaria: 500, cantidadRecibida: 120, urgencia: 'Alta', unidad: 'litros' },
      { nombre: 'Guantes quirúrgicos', categoria: 'Salud', estado: 'Necesita', cantidadNecesaria: 200, cantidadRecibida: 0, urgencia: 'Alta', unidad: 'cajas' },
    ],
  },
  {
    id: 'LUG-SEED-2',
    tipo: 'Centro',
    nombre: 'PRUEBA · Ambulatorio Centro',
    ubicacion: 'Caracas',
    telefono: '+58 212 000 0002',
    lat: 10.5061,
    lng: -66.9146,
    gestionado: false,
    insumos: [
      { nombre: 'Analgésicos', categoria: 'Salud', estado: 'Necesita', cantidadNecesaria: 100, cantidadRecibida: 100, urgencia: 'Normal', unidad: 'cajas' },
      // Disponible aqui y necesario en el refugio: alimenta `coincidencias` y
      // `traslados` en la fachada.
      { nombre: 'Colchonetas', categoria: 'Refugio', estado: 'Disponible', cantidadNecesaria: 0, cantidadRecibida: 0, urgencia: 'Normal', unidad: 'unidades' },
    ],
  },
  {
    id: 'LUG-SEED-3',
    tipo: 'Refugio',
    nombre: 'PRUEBA · Refugio Catia',
    ubicacion: 'Catia, Caracas',
    telefono: '+58 212 000 0003',
    lat: 10.52,
    lng: -66.95,
    gestionado: false,
    insumos: [
      { nombre: 'Colchonetas', categoria: 'Refugio', estado: 'Necesita', cantidadNecesaria: 80, cantidadRecibida: 10, urgencia: 'Normal', unidad: 'unidades' },
    ],
  },
];

const VOLUNTARIOS = [
  { id: 'VOL-SEED-1', nombre: 'PRUEBA · Dora Voluntaria', zona: 'Caracas', habilidades: ['logística'], email: 'dora.vol@prueba.local' },
  { id: 'VOL-SEED-2', nombre: 'PRUEBA · Elio Voluntario', zona: 'La Guaira', habilidades: ['salud'], email: 'elio.vol@prueba.local' },
];

const MOTORIZADOS = [
  { id: 'MOT-SEED-1', nombre: 'PRUEBA · Ana Motorizada', zona: 'Caracas Oeste', tipoVehiculo: 'Moto', telefono: '+58 424 000 0001', placa: 'AB123CD', email: 'ana.moto@prueba.local' },
  { id: 'MOT-SEED-2', nombre: 'PRUEBA · Luis Motorizado', zona: 'La Guaira', tipoVehiculo: 'Camión', telefono: '+58 424 000 0002', placa: 'EF456GH', email: 'luis.moto@prueba.local' },
];

const VACANTES = [
  {
    id: 'VAC-SEED-1',
    rol: 'Enfermería',
    lugarId: 'LUG-SEED-1',
    lugarNombre: 'PRUEBA · Hospital Vargas',
    lugarTipo: 'Hospital',
    ubicacion: 'La Guaira',
    descripcion: 'PRUEBA · Turno de apoyo en triaje',
    urgencia: 'Alta',
    cantidadNecesaria: 4,
    cantidadCubierta: 1,
    turno: 'Mañana',
    estado: 'Abierta',
  },
];

const FACTURAS = [
  {
    token: 'DV-SEED-PRES-0001',
    numero: 'FAC-2026-000001',
    tipo: 'dinero',
    objetivo: 'PRUEBA · Agua potable → Hospital Vargas',
    estado: 'Abierta',
    montoRequerido: 850,
    montoRecaudado: 300,
    donaciones: [
      { monto_usd: 200, monto: 50000, creado: '2026-09-02T10:00:00.000Z' },
      { monto_usd: 100, monto: 25000, creado: '2026-09-03T10:00:00.000Z' },
    ],
  },
  {
    token: 'DV-SEED-NEC-0002',
    numero: 'FAC-2026-000002',
    tipo: 'necesidad',
    objetivo: 'PRUEBA · Colchonetas → Refugio Catia',
    estado: 'Comprada',
    montoRequerido: 420,
    montoRecaudado: 420,
    donaciones: [],
  },
];

// El rango plausible del legado es 200 < x < 5000 (`api/tasas.ts`): una semilla
// con la tasa historica de 36,5 la rechazaria `normalizarTasa` y la app se
// quedaria sin equivalentes en USD.
const TASA = { efectiva: 250, diaria: 245, fuente: 'seed', fecha: AHORA.toISOString() };

const USUARIOS = [
  { email: 'admin@prueba.local', password: 'prueba1234', claims: { role: 'admin' } },
  { email: 'panel@prueba.local', password: 'prueba1234', claims: { role: 'panel', panelLugarId: 'LUG-SEED-1' } },
  { email: 'user@prueba.local', password: 'prueba1234', claims: {} },
];

async function sembrarUsuarios() {
  const creados = [];
  for (const { email, password, claims } of USUARIOS) {
    let usuario;
    try {
      usuario = await auth.getUserByEmail(email);
    } catch {
      usuario = await auth.createUser({ email, password, emailVerified: true });
    }
    await auth.setCustomUserClaims(usuario.uid, claims);
    creados.push({ email, uid: usuario.uid, claims });
  }
  return creados;
}

function sembrarLugares(lote, panelUid) {
  let centros = 0;
  let hospitales = 0;

  for (const lugar of LUGARES) {
    const canonico = {
      tipo: lugar.tipo,
      nombre: lugar.nombre,
      nombreNorm: normalizar(lugar.nombre),
      ubicacion: lugar.ubicacion,
      telefono: lugar.telefono,
      lat: lugar.lat,
      lng: lugar.lng,
      activo: true,
      panelUid: lugar.gestionado ? panelUid : null,
      actualizado: AHORA,
    };
    const insumos = lugar.insumos.map((insumo) => ({ ...insumo, actualizado: AHORA }));

    lote.set(db.collection('lugares').doc(lugar.id), canonico);
    for (const insumo of insumos) {
      lote.set(
        db.collection('lugares').doc(lugar.id).collection('insumos').doc(claveInsumo(insumo.nombre)),
        insumo,
      );
    }
    // Sin la reserva del nombre, `registrar_lugar` crearia un centro duplicado
    // sobre uno sembrado y `admin_regenerar_panel` no lo encontraria.
    lote.set(
      db.collection(`indices/lugaresPorNombre/claves`).doc(canonico.nombreNorm),
      { valor: lugar.id, createdAt: AHORA },
    );
    if (lugar.gestionado) {
      lote.set(db.collection('centrosPanel').doc(lugar.id), {
        authUid: panelUid,
        email: 'panel@prueba.local',
        fotoCedulaPath: `private/${panelUid}/centers/cedula.jpg`,
        fotoSitioPath: `private/${panelUid}/centers/sitio.jpg`,
        creado: AHORA,
      });
    }

    lote.set(
      db.collection('lugaresPublicos').doc(lugar.id),
      proyeccionPublica('lugaresPublicos', documentoPublico(canonico, insumos)),
    );

    if (lugar.tipo === 'Hospital') hospitales += 1;
    else centros += 1;
  }

  return { centrosRegistrados: centros, hospitalesRegistrados: hospitales };
}

function sembrarPersonas(lote) {
  for (const voluntario of VOLUNTARIOS) {
    lote.set(db.collection('voluntarios').doc(voluntario.id), { ...voluntario, createdAt: AHORA, activo: true });
    lote.set(db.collection('voluntariosPublicos').doc(voluntario.id), proyeccionPublica('voluntariosPublicos', {
      nombre: voluntario.nombre,
      zona: voluntario.zona,
      habilidades: voluntario.habilidades,
      activo: true,
      createdAt: AHORA,
    }));
  }

  for (const motorizado of MOTORIZADOS) {
    lote.set(db.collection('motorizados').doc(motorizado.id), { ...motorizado, createdAt: AHORA, activo: true });
    // Sin telefono ni placa: el contacto pasa por `contactar_motorizado`.
    lote.set(db.collection('motorizadosPublicos').doc(motorizado.id), proyeccionPublica('motorizadosPublicos', {
      nombre: motorizado.nombre,
      zona: motorizado.zona,
      tipoVehiculo: motorizado.tipoVehiculo,
      activo: true,
      createdAt: AHORA,
    }));
  }

  return {
    voluntariosActivos: VOLUNTARIOS.length,
    motorizadosRegistrados: MOTORIZADOS.length,
  };
}

function sembrarVacantes(lote) {
  for (const vacante of VACANTES) {
    lote.set(db.collection('vacantes').doc(vacante.id), { ...vacante, createdAt: AHORA });
    lote.set(db.collection('vacantesPublicas').doc(vacante.id), proyeccionPublica('vacantesPublicas', {
      lugarId: vacante.lugarId,
      titulo: vacante.rol,
      descripcion: vacante.descripcion,
      cupos: vacante.cantidadNecesaria,
      estado: vacante.estado,
      createdAt: AHORA,
    }));
  }
  return {};
}

function sembrarFacturas(lote) {
  let abiertas = 0;
  let recaudado = 0;
  let donaciones = 0;

  for (const factura of FACTURAS) {
    lote.set(db.collection('facturas').doc(factura.token), {
      numeroFactura: factura.numero,
      tokenPublico: factura.token,
      tipo: factura.tipo,
      objetivo: factura.objetivo,
      estado: factura.estado,
      montoRequerido: factura.montoRequerido,
      montoRecaudado: factura.montoRecaudado,
      createdAt: AHORA,
    });

    // El documento publico se lee por token (`getSeguimiento`), asi que lleva
    // dentro la factura, sus movimientos y el desglose anonimo de donaciones.
    lote.set(db.collection('facturasPublicas').doc(factura.token), proyeccionPublica('facturasPublicas', {
      factura: {
        numero_factura: factura.numero,
        objetivo: factura.objetivo,
        descripcion: factura.objetivo,
        estado: factura.estado,
        monto_requerido: factura.montoRequerido,
        monto_recaudado: factura.montoRecaudado,
        porcentaje: Math.round((100 * factura.montoRecaudado) / factura.montoRequerido),
        token_publico: factura.token,
        fecha_creacion: AHORA.toISOString(),
        fecha_cierre: '',
      },
      movimientos: factura.donaciones.map((donacion) => ({
        tipo: 'Donación',
        monto: donacion.monto_usd,
        descripcion: JSON.stringify({ k: 'mov', c: 'donacion' }),
        fecha: donacion.creado,
      })),
      evidencias: [],
      donacionesPublicas: factura.donaciones,
      createdAt: AHORA,
    }));

    if (factura.estado === 'Abierta') abiertas += 1;
    if (factura.tipo === 'dinero') recaudado += factura.montoRecaudado;
    donaciones += factura.donaciones.length;
  }

  return {
    facturasAbiertas: abiertas,
    montoRecaudadoTotal: recaudado,
    donacionesRegistradas: donaciones,
  };
}

const usuarios = await sembrarUsuarios();
const panelUid = usuarios.find((usuario) => usuario.claims.role === 'panel')?.uid ?? null;

const lote = db.batch();
const contadores = {
  ...estadisticasVacias(),
  ...sembrarLugares(lote, panelUid),
  ...sembrarPersonas(lote),
  ...sembrarVacantes(lote),
  ...sembrarFacturas(lote),
};

lote.set(db.collection('tasas').doc('actual'), proyeccionPublica('tasas', { ...TASA, capturadaAt: TASA.fecha }));
lote.set(db.collection('estadisticas').doc('global'), proyeccionPublica('estadisticas', {
  ...contadores,
  actualizado: AHORA,
}));
lote.set(db.collection('config').doc('contadores'), { facturaSeq: FACTURAS.length });

await lote.commit();

process.stdout.write(`${JSON.stringify({
  proyecto: projectId,
  lugares: LUGARES.length,
  voluntarios: VOLUNTARIOS.length,
  motorizados: MOTORIZADOS.length,
  vacantes: VACANTES.length,
  facturas: FACTURAS.length,
  usuarios: usuarios.map(({ email, uid }) => ({ email, uid })),
  contadores,
}, null, 2)}\n`);

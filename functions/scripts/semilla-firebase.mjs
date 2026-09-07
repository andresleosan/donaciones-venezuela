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
// Lo mismo con las facturas: la proyeccion publica por token la construye el
// propio dominio, asi que la semilla no puede describir una forma que la app ya
// no escriba (y no puede publicar el contacto de una oferta por descuido).
const facturas = await import('../lib/api/facturas.js');
// El filtro de PII de una familia vive en `documentoPublico`, y en ningun otro
// sitio: la semilla lo usa igual que la accion y que el reconciliador.
const damnificados = await import('../lib/api/damnificados.js');
// Las dos vistas publicas propias de la Task 3.4: la del presupuesto (lo que
// pinta la pagina de necesidades) y la de la oferta (sin contacto ni punto
// exacto). Tambien las arma el dominio.
const presupuestos = await import('../lib/api/presupuestos.js');
const ofertas = await import('../lib/api/ofertas.js');

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

// `zona` y `habilidades` alimentan la proyeccion publica; el resto es la ficha
// canonica tal y como la escribe `registrar_voluntario`. Solo la primera tiene
// consentimiento publico: la segunda comprueba que sin el no se publica.
const VOLUNTARIOS = [
  {
    id: 'VOL-SEED-1', nombre: 'PRUEBA · Dora Voluntaria', apellido: 'Pérez',
    zona: 'Caracas', habilidades: ['logística'], emailNorm: 'dora.vol@prueba.local',
    telefono: '+58 412 000 0001', ciudad: 'Caracas', estado: 'Distrito Capital',
    profesion: 'Logística', disponibilidad: 'Fines de semana', medioTransporte: 'Moto',
    observaciones: '', consentimiento: true,
  },
  {
    id: 'VOL-SEED-2', nombre: 'PRUEBA · Elio Voluntario', apellido: 'Rojas',
    zona: 'La Guaira', habilidades: ['salud'], emailNorm: 'elio.vol@prueba.local',
    telefono: '+58 412 000 0002', ciudad: 'La Guaira', estado: 'La Guaira',
    profesion: 'Enfermería', disponibilidad: 'Turno nocturno', medioTransporte: 'A pie',
    observaciones: '', consentimiento: false,
  },
];

const MOTORIZADOS = [
  { id: 'MOT-SEED-1', nombre: 'PRUEBA · Ana Motorizada', zona: 'Caracas Oeste', zonaOperacion: 'Caracas Oeste', tipoVehiculo: 'Moto', telefono: '+58 424 000 0001', placa: 'AB123CD', emailNorm: 'ana.moto@prueba.local' },
  { id: 'MOT-SEED-2', nombre: 'PRUEBA · Luis Motorizado', zona: 'La Guaira', zonaOperacion: 'La Guaira', tipoVehiculo: 'Camión', telefono: '+58 424 000 0002', placa: 'EF456GH', emailNorm: 'luis.moto@prueba.local' },
];

// Familias damnificadas (Task 3.6). La ficha canonica lleva PII de verdad;
// `familiasPublicas` solo agregados. La semilla escribe las dos con el mismo
// mapeo que la accion, que es donde vive el filtro.
const FAMILIAS = [
  {
    codigo: 'FAM-SEED0001',
    responsableNombre: 'PRUEBA · Carmen Rodríguez',
    responsableTelefono: '+58 412 000 0011',
    responsableEmail: 'carmen@prueba.local',
    alojamiento: 'PRUEBA · Casa de su hermana, calle 4',
    municipio: 'PRUEBA · Vargas',
    estadoGeo: 'PRUEBA · La Guaira',
    gpsLat: 10.6013,
    gpsLng: -66.9331,
    integrantes: [
      { nombre: 'PRUEBA · Carmen Rodríguez', parentesco: 'Madre', edad: 41, ocupacion: 'Costurera' },
      { nombre: 'PRUEBA · Luis', parentesco: 'Hijo', edad: 9, condicionMedica: 'Asma' },
      { nombre: 'PRUEBA · Ana', parentesco: 'Hija', edad: 3 },
    ],
    fallecidos: 1,
    fallecidosDetalle: 'PRUEBA · Su esposo',
    perdioCasa: true,
    perdioVehiculo: false,
    sustentoPrincipal: 'Costura',
    bienesPerdidos: 'PRUEBA · Todo el mobiliario',
    estado: 'nuevo',
  },
  {
    codigo: 'FAM-SEED0002',
    responsableNombre: 'PRUEBA · Pedro Salas',
    responsableTelefono: '+58 412 000 0012',
    responsableEmail: '',
    alojamiento: 'PRUEBA · Refugio Catia',
    municipio: 'PRUEBA · Libertador',
    estadoGeo: 'PRUEBA · Distrito Capital',
    gpsLat: null,
    gpsLng: null,
    integrantes: [
      { nombre: 'PRUEBA · Pedro Salas', parentesco: 'Padre', edad: 63 },
      { nombre: 'PRUEBA · Marta', parentesco: 'Esposa', edad: 60 },
    ],
    fallecidos: 0,
    fallecidosDetalle: '',
    perdioCasa: true,
    perdioVehiculo: true,
    sustentoPrincipal: 'Pensión',
    bienesPerdidos: '',
    estado: 'contactado',
  },
];

// Denuncias (Task 3.6). Sin proyeccion publica: la lista la arma la accion.
// Sin video, porque el objeto de Storage tendria que existir de verdad para que
// `denuncia_video` pudiera firmarlo.
const DENUNCIAS = [
  {
    id: 'DEN-SEED0001',
    tipo: 'Retención de insumos',
    gpsLat: 10.5061,
    gpsLng: -66.9146,
    gpsPrecision: 14,
    texto: 'PRUEBA · Pidieron dinero por entregar las cajas.',
    origen: 'usuario',
    estado: 'Recibida',
  },
  {
    id: 'DEN-SEED0002',
    tipo: 'Otro',
    gpsLat: null,
    gpsLng: null,
    gpsPrecision: null,
    texto: 'Generada por administración: el transportista PRUEBA · Luis Motorizado no se reportó; retraso de 5 h en el tramo 2.',
    origen: 'admin',
    estado: 'En revisión',
  },
];

// Apoyo a transportistas (Task 3.5): los dos registros sueltos que el legado
// guardaba fuera del ciclo de facturas. Sus proyecciones publicas son las que
// pintan la ficha de un transportista en la consola del admin.
const TRAYECTOS = [
  { id: 'TRY-SEED-1', motorizadoId: 'MOT-SEED-1', origen: 'PRUEBA · Catia', destino: 'PRUEBA · Refugio Catia', kmRecorridos: 8.2, insumo: 'Agua potable' },
  { id: 'TRY-SEED-2', motorizadoId: 'MOT-SEED-1', origen: 'PRUEBA · Chacao', destino: 'PRUEBA · Hospital Vargas', kmRecorridos: 12.5, insumo: 'Medicinas' },
  { id: 'TRY-SEED-3', motorizadoId: 'MOT-SEED-2', origen: 'PRUEBA · La Guaira', destino: 'PRUEBA · Refugio Catia', kmRecorridos: 31, insumo: 'Colchonetas' },
];

const APORTES_MOTORIZADOS = [
  { id: 'DMO-SEED-1', motorizadoId: 'MOT-SEED-1', monto: 20, tipo: 'Gasolina', donante: 'PRUEBA · Marta', ciudad: 'Caracas' },
  { id: 'DMO-SEED-2', motorizadoId: 'MOT-SEED-2', monto: 15, tipo: 'Mantenimiento', donante: 'Anónimo', ciudad: 'La Guaira' },
];

// Los cuatro acumulados de la tarjeta publica, derivados de lo de arriba: la
// semilla no puede inventarlos por su cuenta o la reconciliacion los cambiaria.
function acumuladosDe(motorizadoId) {
  const suyos = TRAYECTOS.filter((t) => t.motorizadoId === motorizadoId);
  const aportes = APORTES_MOTORIZADOS.filter((a) => a.motorizadoId === motorizadoId);
  return {
    totalTrayectos: suyos.length,
    totalKm: Math.round(suyos.reduce((total, t) => total + t.kmRecorridos, 0) * 10) / 10,
    aporteDonado: aportes.reduce((total, a) => total + a.monto, 0),
    ultimoTrayecto: suyos.length ? AHORA : null,
  };
}

// Reportes de personas buscadas: la unica salida es `buscar_familiar`, que exige
// sesion. Una verificada y una en la cola de moderacion del admin.
const PERSONAS = [
  {
    id: 'PER-SEED-1', nombre: 'PRUEBA · José Ramírez', cedula: 'V-12345678',
    estado: 'Hospitalizado', ubicacion: 'Última vez: Catia',
    contacto: '+58 412 000 0003', fuente: 'Registro hospitalario',
    reportadoPor: 'PRUEBA · Hermana', verificada: true,
  },
  {
    id: 'PER-SEED-2', nombre: 'PRUEBA · Marta Suárez', cedula: '',
    estado: 'Sin información reciente', ubicacion: '', contacto: '',
    fuente: 'Reporte familiar', reportadoPor: 'PRUEBA · Vecino', verificada: false,
  },
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
    telefono: '+58 412 000 0004',
    estado: 'Abierta',
  },
];

// Facturas en la forma canonica de la Task 3.4: `tipo` y `moneda` explicitos,
// `meta` con los campos del sabor y las tres subcolecciones. Una en dinero (un
// presupuesto a medio recaudar, que es lo que pinta la vista de necesidades) y
// una en especie (una necesidad con una donacion registrada sin confirmar, que
// es por lo que su recaudado sigue en cero).
const FACTURAS = [
  {
    id: 'FCT-SEED0001',
    token: 'DV-SEED-PRES-0001',
    numero: 'FAC-2026-000001',
    tipo: 'presupuesto',
    moneda: 'VES',
    objetivo: 'Agua potable → PRUEBA · Hospital Vargas · PRUEBA · Farmacia Sur',
    descripcion: '',
    meta: {
      centro: 'PRUEBA · Hospital Vargas',
      insumo: 'Agua potable',
      tienda: 'PRUEBA · Farmacia Sur',
      direccion: 'Av. Principal, La Guaira',
      cantidad: 500,
      presentacion: 'Bidón de 20 L',
      necesidadId: 'agua potable',
      tiendaLat: 10.6,
      tiendaLng: -66.93,
      tiendaUrl: '',
      adjunto: '',
    },
    estado: 'Abierta',
    montoRequerido: 75000,
    donaciones: [
      { nombreDonante: 'PRUEBA · Anónimo', monto: 50000, montoUsd: 200, tasa: 250, estado: 'Confirmada', referenciaPago: 'REF-SEED-0000-0001', creado: '2026-09-02T10:00:00.000Z' },
      { nombreDonante: 'PRUEBA · Anónimo', monto: 25000, montoUsd: 100, tasa: 250, estado: 'Confirmada', referenciaPago: 'REF-SEED-0000-0002', creado: '2026-09-03T10:00:00.000Z' },
    ],
    movimientos: [
      { tipo: 'Ingreso', codigo: 'dineroRecibido', datos: { referencia: 'REF-SEED-0000-0001' }, monto: 50000, creado: '2026-09-02T10:00:00.000Z' },
      { tipo: 'Ingreso', codigo: 'dineroRecibido', datos: { referencia: 'REF-SEED-0000-0002' }, monto: 25000, creado: '2026-09-03T10:00:00.000Z' },
    ],
    evidencias: [],
  },
  {
    id: 'FCT-SEED0003',
    token: 'DV-SEED-OFER-0003',
    numero: 'FAC-2026-000003',
    tipo: 'oferta',
    moneda: 'unidades',
    objetivo: 'Oferta: Colchonetas (PRUEBA · Chacao)',
    descripcion: '',
    meta: {
      insumo: 'Colchonetas',
      cantidad: 12,
      unidad: 'unidades',
      zona: 'PRUEBA · Chacao',
      centro: 'PRUEBA · Refugio Catia',
      // Redondeadas a 2 decimales (~1 km): el punto exacto vive en
      // `facturasContacto`, junto al telefono.
      latAprox: 10.5,
      lngAprox: -66.85,
    },
    // El contacto NO va en la factura: esa es la fuga del legado que la Task 3.4
    // cierra. Vive en `facturasContacto/{facturaId}`, que las reglas deniegan.
    contacto: {
      telefono: '+58 412 000 0009',
      nombreDonante: 'PRUEBA · Ana Pérez',
      ubicacion: 'PRUEBA · Casa de Ana, callejón El Rosal nº 4',
      lat: 10.4971,
      lng: -66.8534,
      fotosInsumoPath: [],
      fotoCedulaPath: '',
      fotoLugarPath: '',
      authUid: '',
    },
    estado: 'Ofrecida',
    montoRequerido: 12,
    donaciones: [],
    movimientos: [
      { tipo: 'Oferta', codigo: 'donacionOfrecida', datos: { cantidad: 12, unidad: 'unidades', insumo: 'Colchonetas', ubicacion: 'PRUEBA · Chacao' }, monto: 12, creado: '2026-09-05T10:00:00.000Z' },
    ],
    evidencias: [],
  },
  {
    id: 'FCT-SEED0002',
    token: 'DV-SEED-NEC-0002',
    numero: 'FAC-2026-000002',
    tipo: 'especie',
    moneda: 'unidades',
    objetivo: 'Colchonetas → PRUEBA · Refugio Catia',
    descripcion: 'Necesidad publicada por PRUEBA · Refugio Catia',
    meta: null,
    estado: 'Abierta',
    montoRequerido: 80,
    donaciones: [
      { nombreDonante: 'PRUEBA · Casa Solidaria', monto: 10, montoUsd: null, tasa: null, estado: 'Registrada', referenciaPago: '', creado: '2026-09-04T10:00:00.000Z' },
    ],
    movimientos: [
      { tipo: 'Ingreso', codigo: 'donacionRegistrada', datos: { cantidad: 10, unidad: 'unidades', insumo: 'Colchonetas' }, monto: 10, creado: '2026-09-04T10:00:00.000Z' },
    ],
    evidencias: [],
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

// `indices/cuentasPorEmail/claves/<correo>` es lo que hace que un correo no
// pueda ser a la vez voluntario y transportista, y lo que resuelve
// `acceso_perfil`. Sin sembrarlo, entrar con una cuenta semilla no daria rol.
function reservarCorreo(lote, correo, tipo, id) {
  lote.set(db.collection('indices/cuentasPorEmail/claves').doc(normalizar(correo)), {
    valor: `${tipo}:${id}`,
    createdAt: AHORA,
  });
}

function sembrarPersonas(lote) {
  for (const { consentimiento, ...voluntario } of VOLUNTARIOS) {
    lote.set(db.collection('voluntarios').doc(voluntario.id), {
      ...voluntario,
      authUid: null,
      fotoCedulaPath: '',
      publicProfileConsent: {
        enabled: consentimiento,
        version: 'volunteer-public-v1',
        consentedAt: consentimiento ? AHORA : null,
        consentedByUid: null,
        revokedAt: null,
        revokedByUid: null,
      },
      createdAt: AHORA,
      activo: true,
    });
    reservarCorreo(lote, voluntario.emailNorm, 'voluntario', voluntario.id);

    // El perfil publico de un voluntario existe SOLO con consentimiento v1.
    if (!consentimiento) continue;
    lote.set(db.collection('voluntariosPublicos').doc(voluntario.id), proyeccionPublica('voluntariosPublicos', {
      nombre: voluntario.nombre,
      zona: voluntario.zona,
      habilidades: voluntario.habilidades,
      activo: true,
      createdAt: AHORA,
    }));
  }

  for (const motorizado of MOTORIZADOS) {
    lote.set(db.collection('motorizados').doc(motorizado.id), {
      ...motorizado,
      authUid: null,
      fotoPlacaPath: '',
      fotoVehiculoPath: '',
      fotoCedulaPath: '',
      createdAt: AHORA,
      activo: true,
      ...acumuladosDe(motorizado.id),
    });
    reservarCorreo(lote, motorizado.emailNorm, 'transportista', motorizado.id);
    // Sin telefono ni placa: el contacto pasa por `contactar_motorizado`, y la
    // tarjeta publica solo sabe que lo hay.
    lote.set(db.collection('motorizadosPublicos').doc(motorizado.id), proyeccionPublica('motorizadosPublicos', {
      nombre: motorizado.nombre,
      zona: motorizado.zona,
      tipoVehiculo: motorizado.tipoVehiculo,
      activo: true,
      tieneContacto: true,
      createdAt: AHORA,
      ...acumuladosDe(motorizado.id),
    }));
  }

  let localizadas = 0;
  for (const persona of PERSONAS) {
    lote.set(db.collection('personas').doc(persona.id), {
      ...persona,
      nombreNorm: normalizar(persona.nombre),
      cedulaNorm: persona.cedula.replace(/[^0-9]/g, ''),
      createdAt: AHORA,
      actualizado: AHORA,
    });
    // Mismo criterio que el legado: `estado ilike 'localiz%' or 'hospital%'`.
    const clave = normalizar(persona.estado);
    if (clave.startsWith('localiz') || clave.startsWith('hospital')) localizadas += 1;
  }

  return {
    // Cuentan todos, hayan dado consentimiento o no: `count(*) from voluntarios`.
    voluntariosActivos: VOLUNTARIOS.length,
    motorizadosRegistrados: MOTORIZADOS.length,
    personasReportadas: PERSONAS.length,
    personasLocalizadas: localizadas,
  };
}

// No se siembra ningun viaje en curso: una reserva viva a nombre de un uid que
// no existe dejaria el presupuesto comprado bloqueado para quien pruebe el ciclo
// del transportista, que es justo lo que la semilla quiere dejar disponible.
function sembrarTransporte(lote) {
  for (const trayecto of TRAYECTOS) {
    const { id, ...datos } = trayecto;
    const fila = {
      ...datos,
      nombreMotorizado: MOTORIZADOS.find((m) => m.id === datos.motorizadoId)?.nombre ?? '',
      insumoTransportado: '',
      createdAt: AHORA,
    };
    lote.set(db.collection('trayectos').doc(id), fila);
    lote.set(db.collection('trayectosPublicos').doc(id), proyeccionPublica('trayectosPublicos', fila));
  }

  for (const aporte of APORTES_MOTORIZADOS) {
    const { id, ...datos } = aporte;
    const fila = {
      ...datos,
      nombreMotorizado: MOTORIZADOS.find((m) => m.id === datos.motorizadoId)?.nombre ?? '',
      createdAt: AHORA,
    };
    lote.set(db.collection('donacionesMotorizados').doc(id), fila);
    lote.set(
      db.collection('donacionesMotorizadosPublicos').doc(id),
      proyeccionPublica('donacionesMotorizadosPublicos', fila),
    );
  }

  return { donacionesRegistradas: APORTES_MOTORIZADOS.length };
}

function sembrarEmergencias(lote) {
  for (const familia of FAMILIAS) {
    const integrantes = damnificados.integrantesDe(familia.integrantes);
    const canonica = {
      ...familia,
      integrantes,
      numPersonas: integrantes.length,
      numMenores: integrantes.filter((it) => it.menor).length,
      vehiculosDetalle: '',
      insumosNecesarios: '',
      notas: '',
      fotosPath: [],
      authUid: '',
      createdAt: AHORA,
      actualizado: AHORA,
    };
    // El codigo ES el id, igual que en la accion.
    lote.set(db.collection('familiasDamnificadas').doc(familia.codigo), canonica);
    lote.set(
      db.collection('familiasPublicas').doc(familia.codigo),
      proyeccionPublica('familiasPublicas', damnificados.documentoPublico(damnificados.comoFamilia(canonica))),
    );
  }

  for (const denuncia of DENUNCIAS) {
    const { id, ...datos } = denuncia;
    lote.set(db.collection('denuncias').doc(id), {
      ...datos,
      uid: '',
      rol: datos.origen === 'admin' ? 'admin' : 'user',
      videoPath: '',
      duracionS: datos.origen === 'admin' ? 0 : 42,
      facturaToken: '',
      createdAt: AHORA,
      actualizado: AHORA,
    });
  }

  return {};
}

function sembrarVacantes(lote) {
  for (const vacante of VACANTES) {
    lote.set(db.collection('vacantes').doc(vacante.id), {
      ...vacante,
      lugarNombreNorm: normalizar(vacante.lugarNombre),
      cantidadCubierta: vacante.cantidadCubierta ?? 0,
      createdAt: AHORA,
      actualizado: AHORA,
    });
    // Sin telefono: el contacto pasa por `contactar_vacante`, y la tarjeta solo
    // sabe que lo hay. Mismos campos que publica `admin_crear_vacante`.
    lote.set(db.collection('vacantesPublicas').doc(vacante.id), proyeccionPublica('vacantesPublicas', {
      rol: vacante.rol,
      lugarNombre: vacante.lugarNombre,
      lugarTipo: vacante.lugarTipo,
      ubicacion: vacante.ubicacion,
      descripcion: vacante.descripcion,
      urgencia: vacante.urgencia,
      cantidadNecesaria: vacante.cantidadNecesaria,
      cantidadCubierta: vacante.cantidadCubierta ?? 0,
      cuposFaltantes: Math.max(0, vacante.cantidadNecesaria - (vacante.cantidadCubierta ?? 0)),
      turno: vacante.turno,
      tieneContacto: true,
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
    // Solo suman las `Confirmada`, igual que en la accion: una necesidad con
    // una donacion `Registrada` mantiene el recaudado en cero.
    const montoRecaudado = factura.donaciones
      .filter((donacion) => donacion.estado === 'Confirmada')
      .reduce((total, donacion) => total + donacion.monto, 0);

    const canonica = {
      numeroFactura: factura.numero,
      tokenPublico: factura.token,
      tipo: factura.tipo,
      moneda: factura.moneda,
      objetivo: factura.objetivo,
      objetivoNorm: normalizar(factura.objetivo),
      descripcion: factura.descripcion,
      meta: factura.meta,
      montoRequerido: factura.montoRequerido,
      montoRecaudado,
      estado: factura.estado,
      viajeVigenteId: null,
      numDonaciones: factura.donaciones.length,
      numMovimientos: factura.movimientos.length,
      numEvidencias: factura.evidencias.length,
      createdAt: AHORA,
      actualizado: AHORA,
      fechaCierre: null,
    };
    const referencia = db.collection('facturas').doc(factura.id);
    lote.set(referencia, canonica);

    const subDonaciones = factura.donaciones.map((donacion, indice) => ({
      id: `DON-SEED${factura.id.slice(-4)}${indice + 1}`,
      datos: {
        nombreDonante: donacion.nombreDonante,
        monto: donacion.monto,
        montoUsd: donacion.montoUsd,
        tasa: donacion.tasa,
        comprobantePath: '',
        referenciaPago: donacion.referenciaPago,
        estado: donacion.estado,
        secuencia: indice + 1,
        createdAt: new Date(donacion.creado),
      },
    }));
    const subMovimientos = factura.movimientos.map((movimiento, indice) => ({
      id: `MOV-SEED${factura.id.slice(-4)}${indice + 1}`,
      datos: {
        tipo: movimiento.tipo,
        descripcion: JSON.stringify({ k: 'mov', c: movimiento.codigo, ...movimiento.datos }),
        monto: movimiento.monto,
        secuencia: indice + 1,
        createdAt: new Date(movimiento.creado),
      },
    }));

    for (const { id, datos } of subDonaciones) lote.set(referencia.collection('donaciones').doc(id), datos);
    for (const { id, datos } of subMovimientos) lote.set(referencia.collection('movimientos').doc(id), datos);
    if (factura.contacto) {
      lote.set(db.collection('facturasContacto').doc(factura.id), { ...factura.contacto, createdAt: AHORA });
    }

    // Los dos indices que sostienen las invariantes: token -> factura y un solo
    // hilo `Abierta` por objetivo.
    lote.set(db.collection('indices/facturasPorToken/claves').doc(normalizar(factura.token)), { valor: factura.id, createdAt: AHORA });
    if (factura.estado === 'Abierta') {
      lote.set(db.collection('indices/facturasAbiertasPorObjetivo/claves').doc(normalizar(factura.objetivo)), { valor: factura.id, createdAt: AHORA });
    }

    // El documento publico se lee por token (`getSeguimiento`) y lo arma el
    // dominio, no la semilla: lleva dentro la factura, sus movimientos y el
    // desglose anonimo de donaciones, y nada mas.
    lote.set(
      db.collection('facturasPublicas').doc(factura.token),
      proyeccionPublica('facturasPublicas', facturas.documentoPublico({
        id: factura.id,
        factura: facturas.comoFactura(canonica),
        donaciones: subDonaciones.map(({ id, datos }) => ({ id, datos: facturas.comoDonacion(datos) })),
        movimientos: subMovimientos.map(({ id, datos }) => ({ id, datos: facturas.comoMovimiento(datos) })),
        evidencias: [],
      })),
    );

    // Las dos vistas propias del sabor: se derivan de la misma factura y se
    // indexan por token, igual que en la accion.
    if (factura.tipo === 'presupuesto') {
      lote.set(
        db.collection('presupuestosPublicos').doc(factura.token),
        proyeccionPublica('presupuestosPublicos', presupuestos.documentoPublico(facturas.comoFactura(canonica))),
      );
    }
    if (factura.tipo === 'oferta') {
      lote.set(
        db.collection('ofertasPublicas').doc(factura.token),
        proyeccionPublica('ofertasPublicas', ofertas.documentoPublico(facturas.comoFactura(canonica))),
      );
    }

    if (factura.estado === 'Abierta') abiertas += 1;
    if (factura.moneda !== 'unidades') recaudado += montoRecaudado;
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
  ...sembrarEmergencias(lote),
};
// `donacionesRegistradas` la alimentan dos fuentes (facturas y apoyo a
// transportistas), asi que se suma en vez de sobrescribirse con el spread.
contadores.donacionesRegistradas += sembrarTransporte(lote).donacionesRegistradas;

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
  personas: PERSONAS.length,
  vacantes: VACANTES.length,
  familias: FAMILIAS.length,
  denuncias: DENUNCIAS.length,
  facturas: FACTURAS.length,
  trayectos: TRAYECTOS.length,
  aportesMotorizados: APORTES_MOTORIZADOS.length,
  usuarios: usuarios.map(({ email, uid }) => ({ email, uid })),
  contadores,
}, null, 2)}\n`);

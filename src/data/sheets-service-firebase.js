import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { getFirestoreDb } from '../firebase/firebase-config.js';
import { getCurrentUser, getIdToken, register, signIn, signOut } from '../firebase/firebase-auth.js';
import { post as postApi } from './api-client.js';
import { archivoDesdeDataUrl, uploadPrivateFile } from '../firebase/firebase-storage.js';
import {
  clearOfflineQueue,
  contarCola,
  enviarConCola,
  flushQueue,
  guardarSnapshot,
  iniciarSincronizacion,
  leerSnapshot,
} from './offline-cache.js';

// Fachada `window.SheetsService` sobre Firebase.
//
// Reimplementa, método por método, el contrato que la UI vanilla ya consume
// (`docs/reference/contrato-datos-ui.md`): mismo envelope `{ data, source }`,
// mismos nombres de campo (camelCase y snake_case conviven a propósito, tal como
// los lee `js/`) y mismas respuestas crudas donde el legado no envolvía.
//
// Las lecturas van directas a las proyecciones públicas de Firestore; las
// escrituras, a la Function `api`. Dos derivaciones que en Supabase hacían las
// vistas SQL se calculan aquí, con la misma lógica:
//   - `necesita[].coincidencias` (vista `lugares_directorio`): insumos
//     `Disponible` de OTRO lugar cuyo nombre normalizado coincide con el de la
//     necesidad.
//   - `estado.traslados` (vista `traslados_sugeridos`): el cruce completo
//     Disponible × Necesita, ordenado por `actualizado` desc y cortado a 30.
//
// Los nombres de campo de las proyecciones todavía se están fijando en la Fase 3,
// así que cada mapeo acepta el nombre del catálogo y el de la proyección actual
// (`ubicacion`/`ubicacionPublica`, `telefono`/`contactoPublico`, …). Lo que la UI
// recibe es siempre el nombre del contrato.

// Las reglas de Firestore rechazan cualquier `list` con `limit > 50`.
const PAGINA = 50;
const MAX_PAGINAS = 20;
const MAX_TRASLADOS = 30;
const MAX_FAMILIAS = 200;
const MAX_VACANTES = 100;


// ── Normalización de valores ──────────────────────────────────────────

// Mismo `normalizar` que `js/core.js` y `functions/src/api/contract.ts`, que es
// el equivalente cliente de `norm_insumo()` en Supabase.
function normalizar(txt) {
  return String(txt == null ? '' : txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function num(valor) {
  return Number.isFinite(Number(valor)) ? Number(valor) : 0;
}

function numeroONulo(valor) {
  return Number.isFinite(Number(valor)) ? Number(valor) : null;
}

// La UI espera cadenas ISO (las pasa a `new Date`). Firestore devuelve
// `Timestamp`, los seeds pueden traer ISO y el legado guardaba texto.
function iso(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor.toDate === 'function') return valor.toDate().toISOString();
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
}

function primero(...valores) {
  for (const valor of valores) if (valor !== undefined && valor !== null) return valor;
  return undefined;
}

// ── Lecturas paginadas de proyecciones ────────────────────────────────

async function listarProyeccion(nombre, opciones = {}) {
  const {
    filtros = [],
    orden = 'createdAt',
    direccion = 'desc',
    maximo = Infinity,
    maxPaginas = MAX_PAGINAS,
  } = opciones;

  const referencia = collection(await getFirestoreDb(), nombre);
  const filas = [];
  let cursor = null;

  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const restricciones = [...filtros, orderBy(orden, direccion), orderBy(documentId(), direccion)];
    if (cursor) restricciones.push(startAfter(cursor));
    restricciones.push(limit(PAGINA));

    const snapshot = await getDocs(query(referencia, ...restricciones));
    const docs = snapshot.docs;
    for (const item of docs) filas.push({ id: item.id, ...item.data() });

    if (docs.length < PAGINA || filas.length >= maximo) break;
    cursor = docs[docs.length - 1];
  }

  return filas.length > maximo ? filas.slice(0, maximo) : filas;
}

async function obtenerDocumento(ruta) {
  const snapshot = await getDoc(doc(await getFirestoreDb(), ruta));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

// ── Mapeo proyección → contrato de la UI ──────────────────────────────

function insumoUI(item) {
  const cantidadNecesaria = num(item.cantidadNecesaria ?? item.cantidad_necesaria);
  const cantidadRecibida = num(item.cantidadRecibida ?? item.cantidad_recibida);
  return {
    nombre: String(item.nombre ?? ''),
    categoria: item.categoria ?? 'Otros',
    urgencia: item.urgencia ?? 'Normal',
    cantidadNecesaria,
    cantidadRecibida,
    porcentaje: num(primero(
      item.porcentaje,
      cantidadNecesaria > 0 ? Math.round((100 * cantidadRecibida) / cantidadNecesaria) : 0,
    )),
    unidad: item.unidad ?? 'unidades',
    yaCubierto: Boolean(primero(item.yaCubierto, cantidadNecesaria > 0 && cantidadRecibida >= cantidadNecesaria)),
    coincidencias: [],
  };
}

// `order by (urgencia = 'Alta') desc, nombre` de la vista `lugares_directorio`.
function ordenarNecesidades(items) {
  return items.sort((a, b) => {
    const peso = Number(b.urgencia === 'Alta') - Number(a.urgencia === 'Alta');
    return peso !== 0 ? peso : a.nombre.localeCompare(b.nombre);
  });
}

function lugarUI(fila) {
  return {
    id: fila.id,
    nombre: String(fila.nombre ?? ''),
    tipo: fila.tipo ?? 'Centro',
    ubicacion: String(primero(fila.ubicacion, fila.ubicacionPublica, '')),
    telefono: String(primero(fila.telefono, fila.contactoPublico, '')),
    lat: numeroONulo(primero(fila.lat, fila.latAproximada)),
    lng: numeroONulo(primero(fila.lng, fila.lngAproximada)),
    actualizado: iso(primero(fila.actualizado, fila.updatedAt)),
    gestionado: Boolean(fila.gestionado),
    necesita: ordenarNecesidades((fila.necesita ?? []).map(insumoUI)),
    tiene_disponible: (primero(fila.tiene_disponible, fila.tieneDisponible, []) ?? []).map(insumoUI),
    cubiertos: (fila.cubiertos ?? []).map(insumoUI),
  };
}

function voluntarioUI(fila) {
  return {
    id: fila.id,
    nombre: String(fila.nombre ?? ''),
    apellido: String(fila.apellido ?? ''),
    ciudad: String(primero(fila.ciudad, fila.zona, '')),
    estado: String(fila.estado ?? ''),
    medioTransporte: String(primero(fila.medioTransporte, fila.medio_transporte, fila.transporte, '')),
    profesion: String(fila.profesion ?? ''),
    disponibilidad: String(fila.disponibilidad ?? ''),
    fecha_registro: iso(primero(fila.fecha_registro, fila.createdAt)),
  };
}

// La proyección pública de transportistas no lleva teléfono ni placa (Task 3.2):
// el contacto pasa por la acción `contactar_motorizado`. Los campos se mantienen
// para no romper el render, vacíos.
function motorizadoUI(fila) {
  const zona = String(primero(fila.zonaOperacion, fila.zona_operacion, fila.zona, ''));
  return {
    id: fila.id,
    nombre: String(fila.nombre ?? ''),
    tipoVehiculo: String(primero(fila.tipoVehiculo, fila.tipo_vehiculo, '')),
    zonaOperacion: zona,
    operaEn: zona,
    placa: String(fila.placa ?? ''),
    telefono: String(fila.telefono ?? ''),
    tieneContacto: Boolean(fila.tieneContacto),
    totalTrayectos: num(fila.totalTrayectos),
    totalKm: num(fila.totalKm),
    aporteDonado: num(fila.aporteDonado),
    ultimoTrayecto: iso(fila.ultimoTrayecto),
    fecha_registro: iso(primero(fila.fecha_registro, fila.createdAt)),
  };
}

function vacanteUI(fila) {
  const cantidadNecesaria = num(primero(fila.cantidad_necesaria, fila.cantidadNecesaria, fila.cupos));
  const cantidadCubierta = num(primero(fila.cantidad_cubierta, fila.cantidadCubierta));
  return {
    id: fila.id,
    rol: String(primero(fila.rol, fila.titulo, '')),
    lugar_nombre: String(primero(fila.lugar_nombre, fila.lugarNombre, '')),
    lugar_tipo: String(primero(fila.lugar_tipo, fila.lugarTipo, '')),
    ubicacion: String(fila.ubicacion ?? ''),
    descripcion: String(fila.descripcion ?? ''),
    urgencia: fila.urgencia ?? 'Normal',
    cantidad_necesaria: cantidadNecesaria,
    cantidad_cubierta: cantidadCubierta,
    cupos_faltantes: num(primero(
      fila.cupos_faltantes,
      fila.cuposFaltantes,
      Math.max(0, cantidadNecesaria - cantidadCubierta),
    )),
    turno: String(fila.turno ?? ''),
    telefono: String(fila.telefono ?? ''),
    tieneContacto: Boolean(fila.tieneContacto),
    fecha_creacion: iso(primero(fila.fecha_creacion, fila.createdAt)),
  };
}

function familiaUI(fila) {
  return {
    id: fila.id,
    codigo: String(fila.codigo ?? ''),
    municipio: String(fila.municipio ?? ''),
    estado_geo: String(primero(fila.estado_geo, fila.estadoGeo, '')),
    estado: String(fila.estado ?? ''),
    num_personas: num(primero(fila.num_personas, fila.numPersonas)),
    num_menores: num(primero(fila.num_menores, fila.numMenores)),
    perdio_casa: Boolean(primero(fila.perdio_casa, fila.perdioCasa)),
    perdio_vehiculo: Boolean(primero(fila.perdio_vehiculo, fila.perdioVehiculo)),
    perdio_familiar: Boolean(primero(fila.perdio_familiar, fila.perdioFamiliar)),
    necesidad_medica: Boolean(primero(fila.necesidad_medica, fila.necesidadMedica)),
    created_at: iso(primero(fila.created_at, fila.createdAt)),
  };
}

function trayectoUI(fila) {
  const km = num(primero(fila.kmRecorridos, fila.km));
  return {
    id: fila.id,
    origen: String(fila.origen ?? ''),
    destino: String(fila.destino ?? ''),
    km,
    kmRecorridos: km,
    insumo: String(fila.insumo ?? ''),
    insumoTransportado: String(fila.insumoTransportado ?? ''),
    timestamp: iso(primero(fila.timestamp, fila.fecha, fila.createdAt)),
  };
}

function historialUI(fila) {
  return {
    id: fila.id,
    tipo: String(primero(fila.tipoMovimiento, fila.tipo, '')),
    tipoMovimiento: String(primero(fila.tipoMovimiento, fila.tipo, '')),
    insumo: String(fila.insumo ?? ''),
    cantidad: num(fila.cantidad),
    unidad: String(fila.unidad ?? ''),
    descripcion: String(fila.descripcion ?? ''),
    timestamp: iso(primero(fila.timestamp, fila.fecha, fila.createdAt)),
  };
}

// ── Derivaciones que en Supabase hacían las vistas ────────────────────

function indicePorInsumoDisponible(lugares) {
  const indice = new Map();
  for (const lugar of lugares) {
    for (const item of lugar.tiene_disponible) {
      const clave = normalizar(item.nombre);
      if (!clave) continue;
      if (!indice.has(clave)) indice.set(clave, []);
      indice.get(clave).push({ lugar, item });
    }
  }
  return indice;
}

// Rellena `necesita[].coincidencias` y devuelve los traslados sugeridos, con el
// mismo cruce que `lugares_directorio` y `traslados_sugeridos`.
function derivarRelaciones(lugares) {
  const disponibles = indicePorInsumoDisponible(lugares);
  const traslados = [];

  for (const destino of lugares) {
    for (const necesidad of destino.necesita) {
      const clave = normalizar(necesidad.nombre);
      const origenes = (clave ? disponibles.get(clave) : null) || [];
      const ajenos = origenes.filter(({ lugar }) => lugar.id !== destino.id);

      necesidad.coincidencias = ajenos.map(({ lugar }) => ({
        nombre_lugar: lugar.nombre,
        tipo: lugar.tipo,
        ubicacion: lugar.ubicacion,
        telefono: lugar.telefono,
      }));

      for (const { lugar: origen, item } of ajenos) {
        traslados.push({
          insumo: item.nombre,
          categoria: item.categoria,
          urgencia: necesidad.urgencia,
          origen: origen.nombre,
          origen_ubicacion: origen.ubicacion,
          origen_lat: origen.lat,
          origen_lng: origen.lng,
          destino: destino.nombre,
          destino_ubicacion: destino.ubicacion,
          destino_lat: destino.lat,
          destino_lng: destino.lng,
          destino_tipo: destino.tipo,
          // `greatest(d.actualizado, n.actualizado)`: los insumos no llevan fecha
          // propia en la proyección, así que se usa la del lugar.
          actualizado: [origen.actualizado, destino.actualizado].sort().pop() || '',
        });
      }
    }
  }

  traslados.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
  return traslados.slice(0, MAX_TRASLADOS);
}

// ── Envelope de lectura ───────────────────────────────────────────────

function estaOffline() {
  return globalThis.navigator?.onLine === false;
}

async function envelope(clave, cargar, vacio) {
  if (estaOffline()) {
    const cacheado = await leerSnapshot(clave);
    if (cacheado) return { data: cacheado, source: 'offline-cache' };
  }
  try {
    const data = await cargar();
    await guardarSnapshot(clave, data);
    return { data, source: 'live' };
  } catch (err) {
    const cacheado = await leerSnapshot(clave);
    return cacheado
      ? { data: cacheado, source: 'offline-cache', error: err }
      : { data: vacio, source: 'error', error: err };
  }
}

function emptyAll() {
  return {
    lugares: [],
    centros: [],
    traslados: [],
    voluntarios: [],
    rescatistas: [],
    motorizados: [],
    trayectos: [],
    historial: [],
    facturas: [],
    donacionesHumanitarias: [],
    vacantes: [],
    estadisticas: {},
  };
}

// ── Fachada ───────────────────────────────────────────────────────────

export function crearSheetsServiceFirebase() {
  // Devuelve los lugares ya mapeados; las coincidencias las rellena
  // `derivarRelaciones`, que necesita el listado completo.
  async function leerLugares() {
    const filas = await listarProyeccion('lugaresPublicos', {
      filtros: [where('activo', '==', true)],
      orden: 'nombreNorm',
      direccion: 'asc',
    });
    return filas.map(lugarUI);
  }

  async function leerVoluntarios() {
    const filas = await listarProyeccion('voluntariosPublicos', {
      filtros: [where('activo', '==', true)],
      orden: 'createdAt',
    });
    return filas.map(voluntarioUI);
  }

  async function leerMotorizados() {
    const filas = await listarProyeccion('motorizadosPublicos', {
      filtros: [where('activo', '==', true)],
      orden: 'createdAt',
    });
    return filas.map(motorizadoUI);
  }

  async function leerVacantes() {
    const filas = await listarProyeccion('vacantesPublicas', {
      filtros: [where('estado', '==', 'Abierta')],
      orden: 'createdAt',
      maximo: MAX_VACANTES,
    });
    return filas.map(vacanteUI);
  }

  async function leerEstadisticas() {
    const documento = await obtenerDocumento('estadisticas/global');
    if (!documento) return {};
    const { id, actualizado, updatedAt, ...resto } = documento;
    return { ...resto, actualizado: iso(primero(actualizado, updatedAt)) };
  }

  async function getAll() {
    return envelope('all', async () => {
      const [lugares, voluntarios, motorizados, vacantes, estadisticas] = await Promise.all([
        leerLugares(),
        leerVoluntarios(),
        leerMotorizados(),
        // Igual que el legado: si estas dos fallan, el resto de la app sigue viva.
        leerVacantes().catch(() => []),
        leerEstadisticas().catch(() => ({})),
      ]);
      const traslados = derivarRelaciones(lugares);
      return Object.assign(emptyAll(), {
        lugares,
        centros: lugares,
        voluntarios,
        // Los perfiles de rescatistas son información operativa sensible: solo
        // se cargan con `admin_listar_rescatistas`.
        rescatistas: [],
        motorizados,
        estadisticas,
        traslados,
        vacantes,
      });
    }, emptyAll());
  }

  function getLugares() {
    return envelope('list:lugaresPublicos', async () => {
      const lugares = await leerLugares();
      derivarRelaciones(lugares);
      return lugares;
    }, []);
  }

  function getVoluntarios() {
    return envelope('list:voluntariosPublicos', leerVoluntarios, []);
  }

  function getMotorizados() {
    return envelope('list:motorizadosPublicos', leerMotorizados, []);
  }

  function getVacantes() {
    return envelope('list:vacantesPublicas', leerVacantes, []);
  }

  function getRescatistas() {
    return Promise.resolve({ data: [], source: 'restricted' });
  }

  function getFamiliasPublicas() {
    return envelope('list:familiasPublicas', async () => {
      const filas = await listarProyeccion('familiasPublicas', {
        orden: 'createdAt',
        maximo: MAX_FAMILIAS,
      });
      return filas.map(familiaUI);
    }, []);
  }

  function getTrayectos(motorizadoId) {
    const id = String(motorizadoId ?? '');
    return envelope(`list:trayectosPublicos:${id}`, async () => {
      const filas = await listarProyeccion('trayectosPublicos', {
        filtros: id ? [where('motorizadoId', '==', id)] : [],
        orden: 'createdAt',
      });
      return filas.map(trayectoUI);
    }, []);
  }

  // La UI llama con el NOMBRE del lugar (`js/admin.js:912`), no con su id: la
  // ventana `historial` no tiene el listado cargado. La proyección guarda en
  // `lugarId` el nombre normalizado del lugar (Task 3.1), que es lo que hace
  // resoluble esta consulta sin una lectura extra.
  function getHistorial(lugar) {
    const clave = normalizar(lugar);
    return envelope(`list:historialPublico:${clave}`, async () => {
      const filas = await listarProyeccion('historialPublico', {
        filtros: clave ? [where('lugarId', '==', clave)] : [],
        orden: 'createdAt',
      });
      return filas.map(historialUI);
    }, []);
  }

  function getFamiliares(consulta) {
    const texto = String(consulta ?? '');
    return envelope(`familiares:${texto.trim().toLowerCase()}`, async () => {
      const respuesta = await post({ accion: 'buscar_familiar', q: texto });
      return respuesta.personas ?? [];
    }, []);
  }

  async function leerFacturaPublica(token) {
    return obtenerDocumento(`facturasPublicas/${String(token ?? '').trim()}`);
  }

  async function getSeguimiento(token) {
    const clave = `seguimiento:${String(token ?? '').trim().toUpperCase()}`;
    if (estaOffline()) {
      const cacheado = await leerSnapshot(clave);
      if (cacheado) return { data: cacheado, source: 'offline-cache' };
    }
    try {
      const documento = await leerFacturaPublica(token);
      if (!documento) return { data: null, source: 'error', error: new Error('Factura no encontrada') };
      const data = {
        factura: documento.factura ?? null,
        movimientos: documento.movimientos ?? documento.historial ?? [],
        evidencias: documento.evidencias ?? [],
      };
      await guardarSnapshot(clave, data);
      return { data, source: 'live' };
    } catch (err) {
      const cacheado = await leerSnapshot(clave);
      return cacheado
        ? { data: cacheado, source: 'offline-cache', error: err }
        : { data: null, source: 'error', error: err };
    }
  }

  // Crudo y sin caché, igual que el RPC `seguimiento_donaciones` del legado.
  async function getDesgloseDonaciones(token) {
    const documento = await leerFacturaPublica(token);
    return documento?.donacionesPublicas ?? [];
  }

  // ── Sesión ──────────────────────────────────────────────────────────
  // La UI espera la forma de GoTrue (`access_token`, `refresh_token`,
  // `expires_at` en segundos). Se sintetiza desde el usuario de Firebase Auth
  // para que `entrarConSesion` y `guardarSesion` sigan funcionando sin cambios.
  async function sesionDesdeUsuario(usuario) {
    if (!usuario) return null;
    const resultado = await usuario.getIdTokenResult();
    return {
      access_token: resultado.token,
      refresh_token: usuario.refreshToken ?? '',
      expires_at: Math.floor(new Date(resultado.expirationTime).getTime() / 1000),
      user: { email: usuario.email ?? '' },
    };
  }

  async function registrarse(email, password) {
    return sesionDesdeUsuario(await register(email, password));
  }

  async function iniciarSesion(email, password) {
    return sesionDesdeUsuario(await signIn(email, password));
  }

  async function refrescarSesion() {
    const usuario = await getCurrentUser();
    if (!usuario) throw new Error('Sesión no disponible');
    await usuario.getIdToken(true);
    return sesionDesdeUsuario(usuario);
  }

  async function cerrarSesion() {
    await signOut();
    return clearOfflineQueue();
  }

  // ── Escrituras ──────────────────────────────────────────────────────

  // El backend legado recibia la foto como dataURL en el JSON y la subia el
  // servidor. En Firebase la sube el cliente a `private/<uid>/<categoria>/` y
  // la accion solo recibe el `path`, que ademas comprueba que sea del propio
  // uid. Los formularios de `js/` siguen mandando dataURL: la traduccion vive
  // aqui, que es la capa de compatibilidad, y no en catorce sitios de la UI.
  const FOTOS_DE_REGISTRO = {
    registrar_voluntario: { categoria: 'volunteers', campos: { fotoCedula: 'fotoCedulaPath' } },
    registrar_motorizado: {
      categoria: 'drivers',
      campos: {
        fotoPlaca: 'fotoPlacaPath',
        fotoVehiculo: 'fotoVehiculoPath',
        fotoCedula: 'fotoCedulaPath',
      },
    },
    // El comprobante de la transferencia es privado: solo lo ven quien dona y
    // el admin que lo verifica. Por eso `donar_dinero` pasó a exigir sesión
    // (Task 3.4): las reglas de Storage no dejan escribir sin ella.
    donar_dinero: { categoria: 'receipts', campos: { comprobante: 'comprobantePath' } },
  };

  async function subirFotosDeRegistro(payload) {
    const regla = FOTOS_DE_REGISTRO[payload && payload.accion];
    if (!regla) return payload;

    const usuario = await getCurrentUser();
    if (!usuario) throw new Error('Entra con tu cuenta para continuar');

    const salida = { ...payload };
    for (const [campo, destino] of Object.entries(regla.campos)) {
      const valor = salida[campo];
      // Un `path` ya subido (reintento de la cola offline) no se vuelve a subir.
      if (salida[destino]) { delete salida[campo]; continue; }
      if (typeof valor !== 'string' || !valor.startsWith('data:')) continue;

      const { path } = await uploadPrivateFile(
        usuario.uid,
        regla.categoria,
        archivoDesdeDataUrl(valor),
      );
      salida[destino] = path;
      // La dataURL NO viaja en el JSON: pesa megabytes y duplicaria el
      // documento de identidad en el cuerpo de la peticion.
      delete salida[campo];
    }
    return salida;
  }

  // El rol ya no viaja en el cuerpo: la Function lo resuelve por claims del
  // ID token. Los campos `accessToken`/`adminKey`/`token`+`pin` que la UI
  // legada aún adjunta son ignorados por el servidor.
  async function enviar(payload) {
    return postApi(payload, { idToken: await getIdToken() });
  }

  async function post(payload) {
    const respuesta = await enviarConCola(await subirFotosDeRegistro(payload), enviar);
    // `panel_crear` acaba de asignar el claim `panelLugarId`. El ID token en
    // memoria todavia no lo lleva: sin forzar la renovacion, la primera
    // accion del panel recien creado responderia 403.
    if (payload && payload.accion === 'panel_crear') await getIdToken(true);
    return respuesta;
  }

  // El telefono de un transportista salio de la proyeccion publica para que no
  // se pueda recolectar en bloque: se pide de uno en uno, con sesion.
  async function contactarMotorizado(id) {
    const respuesta = await post({ accion: 'contactar_motorizado', id });
    return { telefono: String(respuesta.telefono ?? ''), nombre: String(respuesta.nombre ?? '') };
  }

  // Lo mismo para el contacto de una vacante de voluntariado (Task 3.3). Una
  // vacante ya cubierta o cerrada responde 404: el puesto no existe.
  async function contactarVacante(id) {
    const respuesta = await post({ accion: 'contactar_vacante', id });
    return {
      telefono: String(respuesta.telefono ?? ''),
      rol: String(respuesta.rol ?? ''),
      lugarNombre: String(respuesta.lugarNombre ?? ''),
    };
  }

  return {
    configure() {},
    contactarMotorizado,
    contactarVacante,
    getAll,
    getLugares,
    getVoluntarios,
    getRescatistas,
    getMotorizados,
    getVacantes,
    getFamiliasPublicas,
    getDesgloseDonaciones,
    getTrayectos,
    getHistorial,
    getFamiliares,
    getSeguimiento,
    registrarse,
    iniciarSesion,
    refrescarSesion,
    cerrarSesion,
    post,
    flushQueue: () => flushQueue(enviar),
    getQueueCount: contarCola,
    clearOfflineQueue,
    iniciarSincronizacion: () => iniciarSincronizacion(enviar),
  };
}

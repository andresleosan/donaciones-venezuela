import { ApiError, GEO_VENEZUELA, emailNorm, n, s, soloDigitos } from './contract.js';

// Lista blanca de la consola de datos del admin (contrato §1.18).
//
// Todo lo que las acciones `admin_datos_*` pueden listar, crear, editar o borrar
// esta declarado aqui. Una columna ausente de `editables` NO se puede tocar desde
// la web: se rechaza con un mensaje, no se ignora en silencio.
//
// El vocabulario de columnas es el del legado (`cantidad_necesaria`,
// `tipo_vehiculo`, `foto_cedula`…) porque es el que la consola ya envia y pinta.
// `campo` traduce cada una al nombre canonico del documento de Firestore, y esa
// traduccion es la unica que existe: leer, escribir y deshacer pasan por ella.

export const TIPOS_COLUMNA = [
  'texto', 'entero', 'numero', 'booleano', 'email', 'telefono', 'lat', 'lng', 'opcion', 'refLugar',
] as const;
export type TipoColumna = typeof TIPOS_COLUMNA[number];

export type ColDef = {
  id: string;
  // Campo canonico en Firestore. Ausente = el mismo nombre que `id`.
  campo?: string;
  tipo: TipoColumna;
  max?: number;
  opciones?: readonly string[];
  requerido?: boolean;
  minNum?: number;
  maxNum?: number;
};

export const NORMAS = ['texto', 'digitos', 'email'] as const;
export type Norma = typeof NORMAS[number];

export type ClaveNatural = { campos: string[]; norma: Norma };
export type Hijo = { etiqueta: string; modo: 'cascade' | 'null' };

export type Entidad = {
  id: string;
  // Coleccion de Firestore. Para `insumos` es la subcoleccion de un centro y el
  // id de la fila lleva las dos mitades (`LUG-…/clave`).
  coleccion: string;
  subcoleccionDe?: string;
  prefijoId?: string;
  // Columna humana: la que el admin teclea para confirmar un borrado.
  etiqueta: string;
  // Campo canonico por el que se ordena, y sentido.
  orden: string;
  ordenAsc: boolean;
  // Columnas que devuelven `listar` y `ficha`, en el vocabulario del legado.
  lectura: string[];
  editables: ColDef[];
  buscar: string[];
  naturales: ClaveNatural[];
  fotos: string[];
  hijos: Hijo[];
  // Campo canonico de las columnas de SOLO lectura (fotos, fechas, derivadas).
  // Las editables ya lo llevan en su `ColDef`. Es por entidad a proposito: en
  // `voluntarios` la columna `email` es `emailNorm`, pero en `centros_panel` es
  // literalmente `email`, y un mapa global las confundiria.
  lecturaCampos?: Record<string, string>;
};

export const MENSAJE_FUERA = 'Ese dato no se puede editar desde aquí';

// --- Normalizacion de claves naturales ----------------------------------------

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// «José Pérez» ≡ «jose perez  » y «0412-000 00 00» ≡ «04120000000».
export function normaClave(valor: unknown, norma: Norma): string {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  if (norma === 'digitos') return soloDigitos(texto);
  if (norma === 'email') return texto.toLowerCase();
  return sinAcentos(texto.toLowerCase()).replace(/\s+/g, ' ');
}

// --- Validacion de columnas ---------------------------------------------------

// Lanza nombrando la columna, como el legado: el mensaje llega tal cual al
// formulario y dice cual de los quince campos esta mal.
export function valorValidado(col: ColDef, crudo: unknown): unknown {
  if (col.tipo === 'booleano') return crudo === true || crudo === 'true';

  if (col.tipo === 'entero' || col.tipo === 'numero') {
    const x = n(crudo);
    if (col.minNum !== undefined && x < col.minNum) throw new ApiError(`${col.id}: el mínimo es ${col.minNum}`);
    if (col.maxNum !== undefined && x > col.maxNum) throw new ApiError(`${col.id}: el máximo es ${col.maxNum}`);
    return col.tipo === 'entero' ? Math.round(x) : x;
  }

  if (col.tipo === 'lat' || col.tipo === 'lng') {
    if (crudo === '' || crudo === null || crudo === undefined) return null;
    const x = Number(crudo);
    const dentro = col.tipo === 'lat'
      ? x >= GEO_VENEZUELA.latMin && x <= GEO_VENEZUELA.latMax
      : x >= GEO_VENEZUELA.lngMin && x <= GEO_VENEZUELA.lngMax;
    if (!Number.isFinite(x) || !dentro) throw new ApiError(`${col.id}: esa coordenada cae fuera de Venezuela`);
    return x;
  }

  if (col.tipo === 'email') {
    const texto = s(crudo, 254);
    if (!texto) return '';
    const correo = emailNorm(texto);
    if (!correo) throw new ApiError(`${col.id}: correo electrónico inválido`);
    return correo;
  }

  if (col.tipo === 'telefono') {
    const texto = s(crudo, col.max ?? 40);
    if (texto && soloDigitos(texto).length < 7) throw new ApiError(`${col.id}: teléfono demasiado corto`);
    return texto;
  }

  if (col.tipo === 'opcion') {
    const texto = s(crudo, 60);
    if (!col.opciones?.includes(texto)) throw new ApiError(`${col.id}: ese valor no está permitido`);
    return texto;
  }

  if (col.tipo === 'refLugar') {
    // En el legado era un entero. Aqui el id de un centro es texto (`LUG-…`), y
    // que exista lo comprueba quien llama, dentro de la transaccion.
    const texto = s(crudo, 60);
    if (!texto) throw new ApiError(`${col.id}: hay que elegir un centro`);
    return texto;
  }

  return s(crudo, col.max ?? 300);
}

export type CamposValidados = { porColumna: Map<string, unknown>; refsLugar: string[] };

// `parcial` = editar (las columnas ausentes se saltan). Sin el es crear, y toda
// columna editable ausente se evalua con `''`, igual que el legado: por eso
// crear una vacante sin `cantidad_necesaria` falla con «el mínimo es 1».
export function camposValidados(
  entidad: Entidad,
  crudos: Record<string, unknown>,
  parcial: boolean,
): CamposValidados {
  const porId = new Map(entidad.editables.map((col) => [col.id, col]));

  for (const clave of Object.keys(crudos)) {
    if (!porId.has(clave)) throw new ApiError(`${MENSAJE_FUERA}: ${clave}`);
  }

  const porColumna = new Map<string, unknown>();
  const refsLugar: string[] = [];

  for (const col of entidad.editables) {
    const presente = Object.prototype.hasOwnProperty.call(crudos, col.id);
    if (parcial && !presente) continue;

    const valor = valorValidado(col, presente ? crudos[col.id] : '');
    if (col.requerido && (valor === '' || valor === null || valor === undefined)) {
      throw new ApiError(`${col.id}: es obligatorio`);
    }
    if (col.tipo === 'refLugar') refsLugar.push(String(valor));
    porColumna.set(col.id, valor);
  }

  if (!porColumna.size) throw new ApiError('No hay nada que guardar');
  return { porColumna, refsLugar };
}

// Traduce lo validado al vocabulario canonico de Firestore.
export function aCanonico(entidad: Entidad, validados: CamposValidados): Record<string, unknown> {
  const porId = new Map(entidad.editables.map((col) => [col.id, col]));
  const salida: Record<string, unknown> = {};
  for (const [id, valor] of validados.porColumna) {
    salida[porId.get(id)?.campo ?? id] = valor;
  }
  return salida;
}

// --- Catalogo ------------------------------------------------------------------

const TIPOS_LUGAR = ['Centro', 'Hospital', 'Refugio'] as const;
const ESTADOS_INSUMO = ['Necesita', 'Disponible', 'Cubierto'] as const;
const URGENCIAS = ['Alta', 'Normal', 'Baja'] as const;
const TIPOS_VEHICULO = ['Moto', 'Carro', 'Bicicleta', 'Camión', 'Triciclo motorizado'] as const;
const TIPOS_LUGAR_VACANTE = ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'] as const;
const ESTADOS_VACANTE = ['Abierta', 'Cubierta', 'Cerrada'] as const;

// El orden importa: es el que devuelve `admin_datos_entidades` y el que pinta el
// menu de la consola.
export const ENTIDADES: readonly Entidad[] = [
  {
    id: 'lugares',
    coleccion: 'lugares',
    prefijoId: 'LUG',
    etiqueta: 'nombre',
    orden: 'nombreNorm',
    ordenAsc: true,
    lectura: ['id', 'tipo', 'nombre', 'ubicacion', 'telefono', 'lat', 'lng', 'actualizado'],
    editables: [
      { id: 'tipo', tipo: 'opcion', opciones: TIPOS_LUGAR, requerido: true },
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'ubicacion', tipo: 'texto', max: 300 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'lat', tipo: 'lat' },
      { id: 'lng', tipo: 'lng' },
    ],
    buscar: ['nombre', 'ubicacion', 'telefono'],
    naturales: [{ campos: ['nombre'], norma: 'texto' }],
    fotos: [],
    lecturaCampos: { actualizado: 'actualizado' },
    hijos: [
      { etiqueta: 'insumos', modo: 'cascade' },
      { etiqueta: 'accesos de panel', modo: 'cascade' },
    ],
  },
  {
    id: 'insumos',
    coleccion: 'insumos',
    subcoleccionDe: 'lugares',
    etiqueta: 'nombre',
    orden: 'nombre',
    ordenAsc: true,
    lectura: [
      'id', 'lugar_id', 'nombre', 'categoria', 'estado', 'cantidad_necesaria',
      'cantidad_recibida', 'urgencia', 'unidad', 'actualizado',
    ],
    editables: [
      { id: 'lugar_id', campo: 'lugarId', tipo: 'refLugar', requerido: true },
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'categoria', tipo: 'texto', max: 60 },
      { id: 'estado', tipo: 'opcion', opciones: ESTADOS_INSUMO, requerido: true },
      { id: 'cantidad_necesaria', campo: 'cantidadNecesaria', tipo: 'numero', minNum: 0, maxNum: 1_000_000 },
      { id: 'cantidad_recibida', campo: 'cantidadRecibida', tipo: 'numero', minNum: 0, maxNum: 1_000_000 },
      { id: 'urgencia', tipo: 'opcion', opciones: URGENCIAS, requerido: true },
      { id: 'unidad', tipo: 'texto', max: 30 },
    ],
    buscar: ['nombre', 'categoria'],
    naturales: [{ campos: ['lugar_id', 'nombre'], norma: 'texto' }],
    fotos: [],
    lecturaCampos: { actualizado: 'actualizado' },
    hijos: [],
  },
  {
    id: 'voluntarios',
    coleccion: 'voluntarios',
    prefijoId: 'VOL',
    etiqueta: 'nombre',
    orden: 'createdAt',
    ordenAsc: false,
    lectura: [
      'id', 'nombre', 'apellido', 'email', 'telefono', 'estado', 'ciudad', 'profesion',
      'disponibilidad', 'medio_transporte', 'observaciones', 'foto_cedula', 'fecha_registro',
    ],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'apellido', tipo: 'texto', max: 120 },
      { id: 'email', campo: 'emailNorm', tipo: 'email', max: 254 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'estado', tipo: 'texto', max: 60 },
      { id: 'ciudad', tipo: 'texto', max: 80 },
      { id: 'profesion', tipo: 'texto', max: 80 },
      { id: 'disponibilidad', tipo: 'texto', max: 120 },
      { id: 'medio_transporte', campo: 'medioTransporte', tipo: 'texto', max: 60 },
      { id: 'observaciones', tipo: 'texto', max: 500 },
    ],
    buscar: ['nombre', 'apellido', 'email', 'telefono', 'ciudad'],
    naturales: [
      { campos: ['email'], norma: 'email' },
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['nombre', 'apellido'], norma: 'texto' },
    ],
    fotos: ['foto_cedula'],
    lecturaCampos: { foto_cedula: 'fotoCedulaPath', fecha_registro: 'createdAt' },
    hijos: [],
  },
  {
    id: 'motorizados',
    coleccion: 'motorizados',
    prefijoId: 'MOT',
    etiqueta: 'nombre',
    orden: 'createdAt',
    ordenAsc: false,
    lectura: [
      'id', 'nombre', 'tipo_vehiculo', 'telefono', 'zona_operacion', 'placa', 'email',
      'foto_placa', 'foto_vehiculo', 'foto_cedula', 'fecha_registro',
    ],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'tipo_vehiculo', campo: 'tipoVehiculo', tipo: 'opcion', opciones: TIPOS_VEHICULO, requerido: true },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'zona_operacion', campo: 'zonaOperacion', tipo: 'texto', max: 120 },
      { id: 'placa', tipo: 'texto', max: 20 },
      { id: 'email', campo: 'emailNorm', tipo: 'email', max: 254 },
    ],
    buscar: ['nombre', 'placa', 'telefono', 'email', 'zona_operacion'],
    naturales: [
      { campos: ['email'], norma: 'email' },
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['placa'], norma: 'texto' },
    ],
    fotos: ['foto_placa', 'foto_vehiculo', 'foto_cedula'],
    lecturaCampos: {
      foto_placa: 'fotoPlacaPath',
      foto_vehiculo: 'fotoVehiculoPath',
      foto_cedula: 'fotoCedulaPath',
      fecha_registro: 'createdAt',
    },
    hijos: [
      { etiqueta: 'trayectos', modo: 'null' },
      { etiqueta: 'aportes recibidos', modo: 'null' },
    ],
  },
  {
    id: 'rescatistas',
    coleccion: 'rescatistas',
    prefijoId: 'RES',
    etiqueta: 'nombre',
    orden: 'createdAt',
    ordenAsc: false,
    lectura: [
      'id', 'nombre', 'organizacion', 'telefono', 'especialidad', 'estado', 'ciudad',
      'disponibilidad', 'equipo_disponible', 'capacidad_operativa', 'observaciones', 'fecha_registro',
    ],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'organizacion', tipo: 'texto', max: 120 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'especialidad', tipo: 'texto', max: 80 },
      { id: 'estado', tipo: 'texto', max: 60 },
      { id: 'ciudad', tipo: 'texto', max: 80 },
      { id: 'disponibilidad', tipo: 'texto', max: 120 },
      { id: 'equipo_disponible', campo: 'equipoDisponible', tipo: 'texto', max: 300 },
      { id: 'capacidad_operativa', campo: 'capacidadOperativa', tipo: 'texto', max: 120 },
      { id: 'observaciones', tipo: 'texto', max: 500 },
    ],
    buscar: ['nombre', 'organizacion', 'telefono', 'ciudad', 'especialidad'],
    naturales: [
      { campos: ['telefono'], norma: 'digitos' },
      { campos: ['nombre', 'organizacion'], norma: 'texto' },
    ],
    fotos: [],
    lecturaCampos: { fecha_registro: 'createdAt' },
    hijos: [],
  },
  {
    id: 'centros_panel',
    coleccion: 'centrosPanel',
    // El id del documento ES el del centro: `centrosPanel/{LUG-…}`.
    etiqueta: 'email',
    orden: 'creado',
    ordenAsc: false,
    // NUNCA el `authUid`: es la credencial que da acceso al panel de un centro.
    // (En el legado eran `pin_hash` y `pin_salt`; aqui el acceso es un claim.)
    lectura: ['id', 'lugar_id', 'email', 'foto_cedula', 'foto_sitio', 'creado'],
    editables: [
      { id: 'email', tipo: 'email', max: 254 },
    ],
    buscar: ['email', 'lugar_id'],
    naturales: [],
    fotos: ['foto_cedula', 'foto_sitio'],
    // Aqui `email` es literalmente `email`, no `emailNorm`.
    lecturaCampos: { foto_cedula: 'fotoCedulaPath', foto_sitio: 'fotoSitioPath', creado: 'creado' },
    hijos: [],
  },
  {
    id: 'vacantes_voluntarios',
    coleccion: 'vacantes',
    prefijoId: 'VAC',
    etiqueta: 'rol',
    orden: 'createdAt',
    ordenAsc: false,
    lectura: [
      'id', 'lugar_tipo', 'lugar_nombre', 'ubicacion', 'rol', 'descripcion',
      'cantidad_necesaria', 'cantidad_cubierta', 'urgencia', 'turno', 'telefono',
      'estado', 'fecha_creacion',
    ],
    editables: [
      { id: 'lugar_tipo', campo: 'lugarTipo', tipo: 'opcion', opciones: TIPOS_LUGAR_VACANTE, requerido: true },
      { id: 'lugar_nombre', campo: 'lugarNombre', tipo: 'texto', max: 120, requerido: true },
      { id: 'ubicacion', tipo: 'texto', max: 160 },
      { id: 'rol', tipo: 'texto', max: 80, requerido: true },
      { id: 'descripcion', tipo: 'texto', max: 400 },
      { id: 'cantidad_necesaria', campo: 'cantidadNecesaria', tipo: 'numero', minNum: 1, maxNum: 10_000 },
      { id: 'cantidad_cubierta', campo: 'cantidadCubierta', tipo: 'numero', minNum: 0, maxNum: 10_000 },
      { id: 'urgencia', tipo: 'opcion', opciones: URGENCIAS, requerido: true },
      { id: 'turno', tipo: 'texto', max: 80 },
      { id: 'telefono', tipo: 'telefono', max: 40 },
      { id: 'estado', tipo: 'opcion', opciones: ESTADOS_VACANTE, requerido: true },
    ],
    buscar: ['lugar_nombre', 'rol', 'ubicacion'],
    naturales: [{ campos: ['lugar_nombre', 'rol'], norma: 'texto' }],
    fotos: [],
    lecturaCampos: { fecha_creacion: 'createdAt' },
    hijos: [],
  },
  {
    id: 'personas',
    coleccion: 'personas',
    prefijoId: 'PER',
    etiqueta: 'nombre',
    orden: 'createdAt',
    ordenAsc: false,
    lectura: [
      'id', 'nombre', 'cedula', 'estado', 'ubicacion', 'contacto', 'fuente',
      'reportado_por', 'verificada', 'fecha',
    ],
    editables: [
      { id: 'nombre', tipo: 'texto', max: 160, requerido: true },
      { id: 'cedula', tipo: 'texto', max: 20 },
      { id: 'estado', tipo: 'texto', max: 120 },
      { id: 'ubicacion', tipo: 'texto', max: 200 },
      { id: 'contacto', tipo: 'texto', max: 120 },
      { id: 'fuente', tipo: 'texto', max: 120 },
      { id: 'reportado_por', campo: 'reportadoPor', tipo: 'texto', max: 120 },
      { id: 'verificada', tipo: 'booleano' },
    ],
    buscar: ['nombre', 'cedula', 'ubicacion', 'contacto'],
    naturales: [
      { campos: ['cedula'], norma: 'digitos' },
      { campos: ['nombre'], norma: 'texto' },
    ],
    fotos: [],
    lecturaCampos: { fecha: 'createdAt' },
    hijos: [],
  },
];

const POR_ID = new Map(ENTIDADES.map((entidad) => [entidad.id, entidad]));

export function entidadDe(nombre: unknown): Entidad {
  const entidad = POR_ID.get(s(nombre, 40));
  if (!entidad) throw new ApiError(MENSAJE_FUERA);
  return entidad;
}

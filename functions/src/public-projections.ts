export const PUBLIC_PROJECTION_FIELDS = {
  // `lat`/`lng` van redondeadas a 3 decimales (~110 m) con `coordsPublicas()`:
  // ubican el centro en el mapa sin senalar una puerta.
  lugaresPublicos: [
    'nombre', 'nombreNorm', 'tipo', 'ubicacionPublica', 'latAproximada', 'lngAproximada',
    'lat', 'lng', 'contactoPublico', 'gestionado', 'necesita', 'tieneDisponible',
    'cubiertos', 'activo', 'updatedAt',
  ],
  // Compatibilidad generica; el consentimiento v1 usa la allowlist separada sin foto.
  voluntariosPublicos: [
    'nombre', 'zona', 'habilidades', 'fotoPublicaPath', 'activo', 'createdAt',
  ],
  rescatistasPublicos: [
    'nombre', 'zona', 'especialidades', 'capacidadOperativa', 'fotoPublicaPath',
    'activo', 'createdAt',
  ],
  motorizadosPublicos: [
    'nombre', 'zona', 'tipoVehiculo', 'capacidad', 'fotoPublicaPath', 'activo',
    'createdAt',
  ],
  vacantesPublicas: ['lugarId', 'titulo', 'descripcion', 'cupos', 'estado', 'createdAt'],
  facturasPublicas: [
    'numero', 'tokenPublico', 'necesidad', 'montoObjetivo', 'recaudado', 'estado',
    'moneda', 'createdAt',
  ],
  // `lugarId` guarda el NOMBRE NORMALIZADO del lugar, no su id: la ventana
  // `historial` solo conoce el nombre y el indice disponible es
  // (lugarId, createdAt, __name__). Ver Task 2.2 del plan.
  historialPublico: [
    'lugarId', 'lugar', 'insumo', 'cantidad', 'unidad', 'tipo', 'descripcion',
    'origen', 'entidadPublicaId', 'estado', 'descripcionPublica', 'createdAt',
  ],
  entregasPublicas: [
    'facturaPublicaId', 'estado', 'createdAt', 'evidenciaPublicaPath',
  ],
  trayectosPublicos: [
    'motorizadoId', 'nombreMotorizado', 'origen', 'destino', 'kmRecorridos',
    'insumo', 'insumoTransportado', 'createdAt',
  ],
  donacionesMotorizadosPublicos: [
    'motorizadoId', 'nombreMotorizado', 'monto', 'tipo', 'donante', 'ciudad',
    'createdAt',
  ],
  // Sin nombres, contacto, direccion ni GPS: solo el codigo y el agregado.
  familiasPublicas: [
    'codigo', 'municipio', 'estadoGeo', 'numPersonas', 'numMenores', 'perdioCasa',
    'perdioVehiculo', 'perdioFamiliar', 'necesidadMedica', 'rangosEdad', 'estado',
    'insumosNecesarios', 'createdAt',
  ],
  // Documento unico `estadisticas/global`.
  estadisticas: [
    'centrosRegistrados', 'hospitalesRegistrados', 'voluntariosActivos',
    'motorizadosRegistrados', 'personasReportadas', 'personasLocalizadas',
    'donacionesRegistradas', 'facturasAbiertas', 'montoRecaudadoTotal', 'actualizado',
  ],
  // Documento unico `tasas/actual`.
  tasas: ['efectiva', 'diaria', 'fuente', 'fecha', 'capturadaAt'],
} as const;

export const VOLUNTEER_PUBLIC_PROFILE_FIELDS = [
  'nombre', 'zona', 'habilidades', 'activo', 'createdAt',
] as const;

const FORBIDDEN = new Set([
  'email', 'telefono', 'documento', 'cedula', 'placa', 'authuid',
  'pin', 'pinhash', 'tokeninterno', 'refreshtoken', 'ip', 'iphash',
  'comprobantepath', 'fileprivatepath', 'ubicacionprecisa',
]);

const VOLUNTEER_FORBIDDEN = new Set([
  ...FORBIDDEN,
  'documentos', 'tokens', 'fotopublicapath',
  'foto', 'photo', 'fotopath', 'photopath', 'imagen', 'image', 'imagenpath',
  'imagepath', 'location', 'ubicacion', 'token', 'tokenpublico',
]);

export type ProjectionName = keyof typeof PUBLIC_PROJECTION_FIELDS;
type UnknownRecord = Record<string, unknown>;

function normalizeKey(key: string): string {
  return key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function findForbiddenFields(
  value: unknown,
  forbidden: Set<string>,
  path = '',
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFields(item, forbidden, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as UnknownRecord).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const own = forbidden.has(normalizeKey(key)) ? [childPath] : [];
    return own.concat(findForbiddenFields(child, forbidden, childPath));
  });
}

export function findForbiddenPublicFields(value: unknown, path = ''): string[] {
  return findForbiddenFields(value, FORBIDDEN, path);
}

export function sanitizePublicProjection(
  name: ProjectionName,
  source: UnknownRecord,
): UnknownRecord {
  const result: UnknownRecord = {};
  for (const field of PUBLIC_PROJECTION_FIELDS[name]) {
    if (source[field] !== undefined) result[field] = source[field];
  }

  const forbidden = findForbiddenFields(result, FORBIDDEN);
  if (forbidden.length) {
    throw new Error(`forbidden-public-fields:${forbidden.join(',')}`);
  }
  return result;
}

export function sanitizeVolunteerPublicProfile(source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = {};
  for (const field of VOLUNTEER_PUBLIC_PROFILE_FIELDS) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  const forbidden = findForbiddenFields(result, VOLUNTEER_FORBIDDEN);
  if (forbidden.length) {
    throw new Error(`forbidden-public-fields:${forbidden.join(',')}`);
  }
  return result;
}

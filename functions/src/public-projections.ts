export const PUBLIC_PROJECTION_FIELDS = {
  lugaresPublicos: [
    'nombre', 'tipo', 'ubicacionPublica', 'latAproximada', 'lngAproximada',
    'contactoPublico', 'activo', 'updatedAt',
  ],
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
  historialPublico: [
    'entidadPublicaId', 'tipo', 'estado', 'descripcionPublica', 'createdAt',
  ],
  entregasPublicas: [
    'facturaPublicaId', 'estado', 'createdAt', 'evidenciaPublicaPath',
  ],
} as const;

export const VOLUNTEER_PUBLIC_PROFILE_FIELDS = [
  'nombre', 'zona', 'habilidades', 'activo', 'createdAt',
] as const;

const FORBIDDEN = new Set([
  'email', 'telefono', 'documento', 'cedula', 'placa', 'authuid',
  'pin', 'pinhash', 'tokeninterno', 'refreshtoken', 'ip', 'iphash',
  'comprobantepath', 'fileprivatepath', 'ubicacionprecisa',
]);

export type ProjectionName = keyof typeof PUBLIC_PROJECTION_FIELDS;
type UnknownRecord = Record<string, unknown>;

function normalizeKey(key: string): string {
  return key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function findForbiddenPublicFields(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenPublicFields(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as UnknownRecord).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const own = FORBIDDEN.has(normalizeKey(key)) ? [childPath] : [];
    return own.concat(findForbiddenPublicFields(child, childPath));
  });
}

export function sanitizePublicProjection(
  name: ProjectionName,
  source: UnknownRecord,
): UnknownRecord {
  const result: UnknownRecord = {};
  for (const field of PUBLIC_PROJECTION_FIELDS[name]) {
    if (source[field] !== undefined) result[field] = source[field];
  }

  const forbidden = findForbiddenPublicFields(result);
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
  const forbidden = findForbiddenPublicFields(result);
  if (forbidden.length) {
    throw new Error(`forbidden-public-fields:${forbidden.join(',')}`);
  }
  return result;
}

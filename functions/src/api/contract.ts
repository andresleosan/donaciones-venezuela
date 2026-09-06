// Contrato de las acciones de la Function `api` y helpers portados 1:1 de la
// edge function legada (ver docs/reference/contrato-acciones-legado.md,
// seccion "Reglas transversales"). Sin dependencias de Firebase: todo es puro
// y se prueba en unidad.
import { randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { RateLimitBucket } from '../security/rate-limit.js';

export type ActionAuth = 'anon' | 'user' | 'panel' | 'admin';
export type ActionRole = 'anon' | 'user' | 'panel' | 'admin';

export type ActionContext = {
  uid: string | null;
  role: ActionRole;
  panelLugarId: string | null;
  ip: string;
  now: Date;
  db: Firestore;
};

export type ActionPayload = Record<string, unknown>;
export type ActionResult = Record<string, unknown>;

export type ActionDefinition = {
  nombre: string;
  auth: ActionAuth;
  cubo: RateLimitBucket;
  handler(ctx: ActionContext, payload: ActionPayload): Promise<ActionResult>;
};

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429;

// Error con mensaje publico (en espanol, como el legado) y status HTTP. Cualquier
// otro error se responde como 500 generico sin filtrar detalles internos.
export class ApiError extends Error {
  constructor(message: string, public readonly status: ApiErrorStatus = 400) {
    super(message);
    this.name = 'ApiError';
  }
}

// --- Helpers de entrada ------------------------------------------------------

// Texto recortado: nunca rechaza por longitud, trunca (igual que el legado).
export function s(value: unknown, max = 300): string {
  return String(value ?? '').trim().slice(0, max);
}

// Numero finito o 0.
export function n(value: unknown): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

// Correo normalizado a minusculas o '' si no es valido.
export function emailNorm(value: unknown): string {
  const x = s(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x) ? x : '';
}

// Clave de comparacion sin acentos ni mayusculas (equivale a norm_insumo() del
// SQL legado y a normalizar() de js/core.js). Sirve para ids de documento y
// para indices de unicidad.
export function normalizar(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Segmento seguro para ids de documento e indices: solo [a-z0-9-], sin '/'.
export function claveDocumento(value: unknown): string {
  return normalizar(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

// Digitos de un telefono (el legado exige >= 7 para aceptarlo).
export function soloDigitos(value: unknown): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

// --- Tokens y numeracion -----------------------------------------------------

// Alfabeto sin 0/O/1/I para tokens legibles: PREFIJO-XXXX-XXXX-XXXX.
export const TOKEN_ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function tokenAlfa(prefijo: string, random: (length: number) => Uint8Array = (length) => new Uint8Array(randomBytes(length))): string {
  const rnd = random(12);
  const cuerpo = Array.from(rnd).map((b) => TOKEN_ALFABETO[b % TOKEN_ALFABETO.length]).join('');
  return `${prefijo}-${cuerpo.slice(0, 4)}-${cuerpo.slice(4, 8)}-${cuerpo.slice(8, 12)}`;
}

export const TOKEN_PATRON: Record<'DV' | 'CTR' | 'REF' | 'C', RegExp> = {
  DV: /^DV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  CTR: /^CTR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  REF: /^REF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  C: /^C-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
};

// FAC-YYYY-NNNNNN (6 digitos, sin reinicio anual: el contador es global).
export function numeroFactura(year: number, seq: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(seq) || seq < 1) {
    throw new Error('numero-factura-invalido');
  }
  return `FAC-${year}-${String(seq).padStart(6, '0')}`;
}

// Movimientos publicos: codigo + datos, el cliente los redacta en su idioma.
export function mov(codigo: string, datos: Record<string, unknown> = {}): string {
  return JSON.stringify({ k: 'mov', c: codigo, ...datos });
}

// Objetivo textual de una necesidad: hilo publico compartido por los donantes.
export function objetivoNecesidad(insumo: string, centro: string): string {
  return `${insumo} → ${centro}`;
}

// --- Geografia ---------------------------------------------------------------

export const GEO_VENEZUELA = { latMin: -4, latMax: 13, lngMin: -74, lngMax: -59 } as const;

export function geoValida(p: { lat?: unknown; lng?: unknown }): { lat: number | null; lng: number | null } {
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (
    Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= GEO_VENEZUELA.latMin && lat <= GEO_VENEZUELA.latMax
    && lng >= GEO_VENEZUELA.lngMin && lng <= GEO_VENEZUELA.lngMax
  ) {
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

// Haversine en km con 1 decimal (linea recta, no ruta de carretera).
export function kmEntre(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// Coordenadas de un centro en el directorio: 3 decimales (~110 m). Ubican el
// lugar en el mapa sin senalar una puerta concreta.
export function coordsPublicas(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
}

// Coordenadas publicas: ~1 km de precision, no localizan una casa.
export function coordsAproximadas(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

// --- Maquinas de estado ------------------------------------------------------

export const ESTADOS_FACTURA = [
  'Abierta', 'PorComprar', 'Transferida', 'Comprada', 'EnTransito', 'Entregada',
  'Ofrecida', 'EnCamino', 'Recogida', 'Cerrada',
] as const;
export type EstadoFactura = typeof ESTADOS_FACTURA[number];

export const ESTADOS_DONACION = ['Registrada', 'Confirmada', 'Anulada'] as const;
export const ESTADOS_INSUMO = ['Necesita', 'Disponible', 'Cubierto'] as const;
export const URGENCIAS = ['Alta', 'Normal', 'Baja'] as const;
export const TIPOS_LUGAR = ['Centro', 'Hospital', 'Refugio'] as const;

export function opcion<const T extends readonly string[]>(value: unknown, opciones: T, porDefecto: T[number]): T[number] {
  const texto = s(value, 40);
  return (opciones as readonly string[]).includes(texto) ? (texto as T[number]) : porDefecto;
}

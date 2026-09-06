// Origenes autorizados a llamar las Functions desde el navegador.
//
// Se leen de API_ALLOWED_ORIGINS (lista separada por comas, sin barra final).
// Sin variable, se usa la allowlist por defecto: produccion en Vercel y los
// servidores locales de Vite/preview. Nunca se devuelve `true` (comodin).
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://donacionesvenezuela.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const;

const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

export function parseAllowedOrigins(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => ORIGIN_PATTERN.test(origin));
  return [...new Set(origins)];
}

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = parseAllowedOrigins(env.API_ALLOWED_ORIGINS);
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_ORIGINS];
}

export function isAllowedOrigin(origin: unknown, origins: readonly string[] = allowedOrigins()): boolean {
  return typeof origin === 'string' && origins.includes(origin.replace(/\/+$/, ''));
}

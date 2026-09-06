import { expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_ORIGINS,
  allowedOrigins,
  isAllowedOrigin,
  parseAllowedOrigins,
} from '../../functions/src/security/cors.js';

it('usa la allowlist por defecto cuando no hay variable', () => {
  expect(allowedOrigins({})).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
  expect(allowedOrigins({ API_ALLOWED_ORIGINS: '   ' })).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
});

it('parsea origenes validos, sin duplicados ni barra final', () => {
  expect(parseAllowedOrigins('https://a.example/, https://a.example,http://localhost:5173'))
    .toEqual(['https://a.example', 'http://localhost:5173']);
});

it('descarta comodines y valores que no son origenes', () => {
  expect(parseAllowedOrigins('*, https://a.example/ruta, ftp://x, javascript:alert(1)')).toEqual([]);
  expect(allowedOrigins({ API_ALLOWED_ORIGINS: '*' })).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
});

it('valida un origen contra la allowlist', () => {
  expect(isAllowedOrigin('https://donacionesvenezuela.vercel.app')).toBe(true);
  expect(isAllowedOrigin('https://donacionesvenezuela.vercel.app/')).toBe(true);
  expect(isAllowedOrigin('https://evil.example', ['https://a.example'])).toBe(false);
  expect(isAllowedOrigin(undefined)).toBe(false);
});

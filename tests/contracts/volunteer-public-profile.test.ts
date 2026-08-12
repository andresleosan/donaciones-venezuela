import { describe, expect, it } from 'vitest';
import { sanitizeVolunteerPublicProfile } from '../../functions/src/public-projections.js';

describe('perfil publico de voluntarios', () => {
  it('publica solo la allowlist v1 y omite foto y PII', () => {
    expect(sanitizeVolunteerPublicProfile({
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
      createdAt: '2026-08-11T12:00:00.000Z',
      fotoPublicaPath: 'private/voluntarios/v1/foto.jpg',
      email: 'ana@example.test',
      telefono: '000',
      authUid: 'uid-privado',
      documento: 'V-1',
    })).toEqual({
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
      createdAt: '2026-08-11T12:00:00.000Z',
    });
  });

  it('rechaza PII anidada dentro de habilidades', () => {
    expect(() => sanitizeVolunteerPublicProfile({
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: [{ etiqueta: 'salud', telefono: '000' }],
      activo: true,
      createdAt: '2026-08-11T12:00:00.000Z',
    })).toThrow('forbidden-public-fields');
  });
});

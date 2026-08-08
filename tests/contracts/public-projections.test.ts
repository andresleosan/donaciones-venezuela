import { describe, expect, it } from 'vitest';
import {
  findForbiddenPublicFields,
  PUBLIC_PROJECTION_FIELDS,
  sanitizePublicProjection,
  type ProjectionName,
} from '../../functions/src/public-projections.js';

describe('proyecciones públicas', () => {
  it('construye voluntario público solo desde allowlist', () => {
    expect(sanitizePublicProjection('voluntariosPublicos', {
      nombre: 'Ana',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
      email: 'privado@example.com',
      telefono: '000',
      authUid: 'uid',
    })).toEqual({
      nombre: 'Ana',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
    });
  });

  it('detecta campos prohibidos también anidados', () => {
    expect(findForbiddenPublicFields({ evidencia: { documento: 'V-1' } }))
      .toEqual(['evidencia.documento']);
  });

  const sensitiveFixture = {
    nombre: 'Ana',
    zona: 'Este',
    activo: true,
    email: 'privado@example.com',
    telefono: '000',
    documento: 'V-1',
    authUid: 'uid',
  };

  it.each(Object.keys(PUBLIC_PROJECTION_FIELDS))('%s nunca publica denylist', (name) => {
    const result = sanitizePublicProjection(name as ProjectionName, sensitiveFixture);
    expect(findForbiddenPublicFields(result)).toEqual([]);
  });
});

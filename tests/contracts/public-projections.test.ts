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

  it.each(['voluntariosPublicos', 'rescatistasPublicos', 'motorizadosPublicos'] as const)(
    'conserva fotoPublicaPath declarado en %s',
    (name) => {
      expect(sanitizePublicProjection(name, {
        nombre: 'Ana',
        zona: 'Este',
        fotoPublicaPath: 'public/profile.jpg',
        activo: true,
        createdAt: '2026-08-11T12:00:00.000Z',
      })).toMatchObject({
        fotoPublicaPath: 'public/profile.jpg',
      });
    },
  );

  it('sanitiza lugaresPublicos con la allowlist exacta', () => {
    expect(sanitizePublicProjection('lugaresPublicos', {
      nombre: 'Centro Demo',
      tipo: 'Centro',
      ubicacionPublica: 'Zona Este',
      latAproximada: 10.5,
      lngAproximada: -66.9,
      contactoPublico: 'contacto publico',
      activo: true,
      updatedAt: '2026-08-11T12:00:00.000Z',
      telefono: '0000000000',
      direccion: 'Direccion privada',
      authUid: 'uid-privado',
    })).toEqual({
      nombre: 'Centro Demo',
      tipo: 'Centro',
      ubicacionPublica: 'Zona Este',
      latAproximada: 10.5,
      lngAproximada: -66.9,
      contactoPublico: 'contacto publico',
      activo: true,
      updatedAt: '2026-08-11T12:00:00.000Z',
    });
  });

  it('sanitiza vacantesPublicas y elimina campos privados', () => {
    expect(sanitizePublicProjection('vacantesPublicas', {
      lugarId: 'lugar-1',
      titulo: 'Apoyo logistico',
      descripcion: 'Turno de prueba',
      cupos: 2,
      estado: 'Abierta',
      createdAt: '2026-08-11T12:00:00.000Z',
      email: 'privado@example.test',
      telefono: '000',
      ubicacionPrecisa: { lat: 10.5, lng: -66.9 },
    })).toEqual({
      lugarId: 'lugar-1',
      titulo: 'Apoyo logistico',
      descripcion: 'Turno de prueba',
      cupos: 2,
      estado: 'Abierta',
      createdAt: '2026-08-11T12:00:00.000Z',
    });
  });

  it('rechaza campos prohibidos anidados despues de la allowlist', () => {
    expect(findForbiddenPublicFields({ contactoPublico: { documento: 'V-1' } }))
      .toEqual(['contactoPublico.documento']);
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

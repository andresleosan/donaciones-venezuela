import { expect, it } from 'vitest';
import {
  VOLUNTEER_PUBLIC_CONSENT_VERSION,
  assertConsentPermission,
  buildConsentMutation,
  parseConsentRequest,
} from '../../functions/src/volunteers/public-consent.js';

const consentRequest = {
  volunteerId: 'v1',
  enabled: true,
  consentVersion: VOLUNTEER_PUBLIC_CONSENT_VERSION,
} as const;

it('acepta el body exacto de activacion', () => {
  expect(parseConsentRequest({
    volunteerId: 'volunteer-1',
    enabled: true,
    consentVersion: 'volunteer-public-v1',
  })).toEqual({
    volunteerId: 'volunteer-1',
    enabled: true,
    consentVersion: 'volunteer-public-v1',
  });
});

it.each([
  null,
  {},
  { volunteerId: '', enabled: true, consentVersion: 'volunteer-public-v1' },
  { volunteerId: 'v1', enabled: 'true', consentVersion: 'volunteer-public-v1' },
  { volunteerId: 'v1', enabled: true, consentVersion: 'volunteer-public-v1', extra: true },
])('rechaza body invalido: %j', (body) => {
  expect(() => parseConsentRequest(body)).toThrow('invalid-input');
});

it('rechaza una version de consentimiento desconocida con codigo especifico', () => {
  expect(() => parseConsentRequest({
    volunteerId: 'v1', enabled: true, consentVersion: 'v2',
  })).toThrow('invalid-consent-version');
});

it('solo permite activar al titular user de un perfil activo', () => {
  expect(() => assertConsentPermission(
    { uid: 'uid-1', role: 'user' },
    { authUid: 'uid-1', activo: true },
    true,
  )).not.toThrow();
  expect(() => assertConsentPermission(
    { uid: 'admin-1', role: 'admin' },
    { authUid: 'uid-1', activo: true },
    true,
  )).toThrow('forbidden');
});

it.each([
  { uid: 'panel-1', role: 'panel' as const },
  { uid: 'uid-1', role: 'admin' as const },
  { uid: 'other-1', role: 'user' as const },
])('rechaza activar a %s aunque el perfil este activo', (context) => {
  expect(() => assertConsentPermission(
    context,
    { authUid: 'uid-1', activo: true },
    true,
  )).toThrow('forbidden');
});

it('rechaza activar un perfil inactivo', () => {
  expect(() => assertConsentPermission(
    { uid: 'uid-1', role: 'user' },
    { authUid: 'uid-1', activo: false },
    true,
  )).toThrow('volunteer-not-active');
});

it('permite revocar al titular, panel y admin, pero no a otro user', () => {
  const profile = { authUid: 'uid-1', activo: true };
  expect(() => assertConsentPermission({ uid: 'uid-1', role: 'user' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'panel-1', role: 'panel' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'admin-1', role: 'admin' }, profile, false)).not.toThrow();
  expect(() => assertConsentPermission({ uid: 'other-1', role: 'user' }, profile, false)).toThrow('forbidden');
});

it('construye activacion sin foto y conserva la revocacion previa', () => {
  const profile = {
    authUid: 'uid-1',
    activo: true,
    nombre: 'Ana Demo',
    zona: 'Este',
    habilidades: ['salud'],
    createdAt: 'created-at',
    fotoPath: 'private/foto.jpg',
    publicProfileConsent: {
      revokedAt: 'previous-revoked-at',
      revokedByUid: 'previous-admin',
    },
  };

  expect(buildConsentMutation(
    consentRequest,
    profile,
    { now: 'now', actorUid: 'uid-1' },
  )).toEqual({
    enabled: true,
    privatePatch: {
      publicProfileConsent: {
        enabled: true,
        version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
        consentedAt: 'now',
        consentedByUid: 'uid-1',
        revokedAt: 'previous-revoked-at',
        revokedByUid: 'previous-admin',
      },
    },
    publicDocument: {
      nombre: 'Ana Demo',
      zona: 'Este',
      habilidades: ['salud'],
      activo: true,
      createdAt: 'created-at',
    },
    audit: {
      actorUid: 'uid-1',
      accion: 'activar_consentimiento_publico',
      entidad: 'voluntarios',
      entidadId: 'v1',
      resultado: 'success',
      createdAt: 'now',
    },
  });
});

it('construye revocacion separada y conserva el consentimiento previo', () => {
  const profile = {
    authUid: 'uid-1',
    activo: true,
    publicProfileConsent: {
      consentedAt: 'previous-consented-at',
      consentedByUid: 'uid-1',
      revokedAt: 'old-revoked-at',
      revokedByUid: 'old-admin',
    },
  };

  expect(buildConsentMutation(
    { ...consentRequest, enabled: false },
    profile,
    { now: 'now', actorUid: 'admin-1' },
  )).toEqual({
    enabled: false,
    privatePatch: {
      publicProfileConsent: {
        enabled: false,
        version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
        consentedAt: 'previous-consented-at',
        consentedByUid: 'uid-1',
        revokedAt: 'now',
        revokedByUid: 'admin-1',
      },
    },
    publicDocument: null,
    audit: {
      actorUid: 'admin-1',
      accion: 'revocar_consentimiento_publico',
      entidad: 'voluntarios',
      entidadId: 'v1',
      resultado: 'success',
      createdAt: 'now',
    },
  });
});

it('normaliza trazabilidad ausente a null', () => {
  const mutation = buildConsentMutation(
    { ...consentRequest, enabled: false },
    { activo: true },
    { now: 'now', actorUid: 'panel-1' },
  );

  expect(mutation.privatePatch.publicProfileConsent).toMatchObject({
    consentedAt: null,
    consentedByUid: null,
    revokedAt: 'now',
    revokedByUid: 'panel-1',
  });
});

it.each(['fotoPath', 'location', 'ubicacion', 'token', 'tokenPublico'])
  ('rechaza %s anidado dentro de habilidades durante la activacion', (forbiddenField) => {
    expect(() => buildConsentMutation(
      consentRequest,
      {
        activo: true,
        habilidades: [{ etiqueta: 'salud', [forbiddenField]: 'privado' }],
      },
      { now: 'now', actorUid: 'uid-1' },
    )).toThrow('forbidden-public-fields');
  });

it('conserva la trazabilidad al repetir una activacion', () => {
  const mutation = buildConsentMutation(
    consentRequest,
    {
      activo: true,
      nombre: 'Ana Demo',
      publicProfileConsent: {
        enabled: true,
        consentedAt: 'previous-consented-at',
        consentedByUid: 'previous-user',
        revokedAt: 'previous-revoked-at',
        revokedByUid: 'previous-admin',
      },
    },
    { now: 'new-now', actorUid: 'new-actor' },
  );

  expect(mutation.privatePatch.publicProfileConsent).toEqual({
    enabled: true,
    version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
    consentedAt: 'previous-consented-at',
    consentedByUid: 'previous-user',
    revokedAt: 'previous-revoked-at',
    revokedByUid: 'previous-admin',
  });
  expect(mutation.audit).toMatchObject({ actorUid: 'new-actor', createdAt: 'new-now' });
});

it('conserva la trazabilidad al repetir una revocacion', () => {
  const mutation = buildConsentMutation(
    { ...consentRequest, enabled: false },
    {
      activo: true,
      publicProfileConsent: {
        enabled: false,
        consentedAt: 'previous-consented-at',
        consentedByUid: 'previous-user',
        revokedAt: 'previous-revoked-at',
        revokedByUid: 'previous-admin',
      },
    },
    { now: 'new-now', actorUid: 'new-actor' },
  );

  expect(mutation.privatePatch.publicProfileConsent).toEqual({
    enabled: false,
    version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
    consentedAt: 'previous-consented-at',
    consentedByUid: 'previous-user',
    revokedAt: 'previous-revoked-at',
    revokedByUid: 'previous-admin',
  });
  expect(mutation.audit).toMatchObject({ actorUid: 'new-actor', createdAt: 'new-now' });
});

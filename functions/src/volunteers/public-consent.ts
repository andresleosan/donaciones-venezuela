import type { AuthContext } from '../auth/authorization.js';
import { sanitizeVolunteerPublicProfile } from '../public-projections.js';

export const VOLUNTEER_PUBLIC_CONSENT_VERSION = 'volunteer-public-v1' as const;

export type ConsentRequest = {
  volunteerId: string;
  enabled: boolean;
  consentVersion: typeof VOLUNTEER_PUBLIC_CONSENT_VERSION;
};

type UnknownRecord = Record<string, unknown>;

type PrivateProfile = UnknownRecord & {
  authUid?: unknown;
  activo?: unknown;
  publicProfileConsent?: UnknownRecord;
};

type ConsentTimestamps = {
  now: unknown;
  actorUid: string;
};

type ConsentState = {
  enabled: boolean;
  version: typeof VOLUNTEER_PUBLIC_CONSENT_VERSION;
  consentedAt: unknown;
  consentedByUid: unknown;
  revokedAt: unknown;
  revokedByUid: unknown;
};

export type ConsentMutation = {
  enabled: boolean;
  privatePatch: {
    publicProfileConsent: ConsentState;
  };
  publicDocument: UnknownRecord | null;
  audit: {
    actorUid: string;
    accion: string;
    entidad: 'voluntarios';
    entidadId: string;
    resultado: 'success';
    createdAt: unknown;
  };
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseConsentRequest(body: unknown): ConsentRequest {
  if (!isRecord(body)
    || Object.keys(body).length !== 3
    || typeof body.volunteerId !== 'string'
    || !body.volunteerId.trim()
    || typeof body.enabled !== 'boolean'
    || typeof body.consentVersion !== 'string') {
    throw new Error('invalid-input');
  }

  if (body.consentVersion !== VOLUNTEER_PUBLIC_CONSENT_VERSION) {
    throw new Error('invalid-consent-version');
  }

  return {
    volunteerId: body.volunteerId.trim(),
    enabled: body.enabled,
    consentVersion: VOLUNTEER_PUBLIC_CONSENT_VERSION,
  };
}

export function assertConsentPermission(
  context: AuthContext,
  profile: PrivateProfile,
  enabled: boolean,
): void {
  const isOwner = context.uid === profile.authUid;
  const isKnownRole = context.role === 'user' || context.role === 'panel' || context.role === 'admin';

  if (!isKnownRole || (enabled && (!isOwner || context.role !== 'user'))
    || (!enabled && context.role === 'user' && !isOwner)) {
    throw new Error('forbidden');
  }

  if (enabled && profile.activo !== true) {
    throw new Error('volunteer-not-active');
  }
}

export function buildConsentMutation(
  input: ConsentRequest,
  profile: PrivateProfile,
  timestamps: ConsentTimestamps,
): ConsentMutation {
  const previous = profile.publicProfileConsent ?? {};
  const consentedAt = previous.consentedAt ?? null;
  const consentedByUid = previous.consentedByUid ?? null;
  const revokedAt = previous.revokedAt ?? null;
  const revokedByUid = previous.revokedByUid ?? null;
  const stateChanged = previous.enabled !== input.enabled;

  const consent = input.enabled
    ? {
      enabled: true,
      version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
      consentedAt: stateChanged ? timestamps.now : consentedAt,
      consentedByUid: stateChanged ? timestamps.actorUid : consentedByUid,
      revokedAt,
      revokedByUid,
    }
    : {
      enabled: false,
      version: VOLUNTEER_PUBLIC_CONSENT_VERSION,
      consentedAt,
      consentedByUid,
      revokedAt: stateChanged ? timestamps.now : revokedAt,
      revokedByUid: stateChanged ? timestamps.actorUid : revokedByUid,
    };

  return {
    enabled: input.enabled,
    privatePatch: { publicProfileConsent: consent },
    publicDocument: input.enabled ? sanitizeVolunteerPublicProfile(profile) : null,
    audit: {
      actorUid: timestamps.actorUid,
      accion: input.enabled ? 'activar_consentimiento_publico' : 'revocar_consentimiento_publico',
      entidad: 'voluntarios',
      entidadId: input.volunteerId,
      resultado: 'success',
      createdAt: timestamps.now,
    },
  };
}

import { initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { authSessionHandler } from './auth/session.js';
import { healthHandler } from './health.js';
import { setVolunteerPublicConsentHandler } from './volunteers/public-consent-http.js';

initializeApp();

export const health = onRequest(
  { cors: false, region: 'us-east1' },
  healthHandler,
);

export const authSession = onRequest(
  { cors: false, region: 'us-east1' },
  authSessionHandler,
);

export const setVolunteerPublicConsent = onRequest(
  { cors: false, region: 'us-east1' },
  setVolunteerPublicConsentHandler,
);

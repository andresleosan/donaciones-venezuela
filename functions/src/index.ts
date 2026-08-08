import { onRequest } from 'firebase-functions/v2/https';
import { authSessionHandler } from './auth/session.js';
import { healthHandler } from './health.js';

export const health = onRequest(
  { cors: false, region: 'us-east1' },
  healthHandler,
);

export const authSession = onRequest(
  { cors: false, region: 'us-east1' },
  authSessionHandler,
);

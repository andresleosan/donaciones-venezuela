(function (root) {
  'use strict';

  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_ATTEMPTS = 3;
  const SAFE_OFFLINE_ACTIONS = new Set();
  const SENSITIVE_KEYS = /token|password|pin|documento|cedula|foto|video|comprobante|gps|ubicacion|email|telefono|familia|denuncia|monto|pago/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasSensitiveData(value, seen) {
    if (!value || typeof value !== 'object') return false;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) {
      return value.some((item) => hasSensitiveData(item, visited));
    }
    return Object.entries(value).some(([key, child]) =>
      SENSITIVE_KEYS.test(key) || hasSensitiveData(child, visited));
  }

  function isQueueable(payload, allowedActions) {
    const allowed = allowedActions || SAFE_OFFLINE_ACTIONS;
    return isPlainObject(payload)
      && allowed.has(String(payload.accion || ''))
      && !hasSensitiveData(payload);
  }

  function createQueueEntry(payload, options) {
    const config = options || {};
    if (!isQueueable(payload, config.allowedActions)) {
      throw new Error('offline-payload-not-allowed');
    }
    const now = Number(config.now == null ? Date.now() : config.now);
    const createId = config.createId || (() => root.crypto?.randomUUID?.()
      || `offline-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    const id = String(createId());
    return {
      id,
      queueId: id,
      idempotencyKey: id,
      payload,
      createdAt: now,
      expiresAt: now + TTL_MS,
      attempts: 0,
      lastErrorCode: '',
    };
  }

  function recordFailure(row, errorCode) {
    const code = String(errorCode || 'unknown-error').toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
    return Object.assign({}, row, {
      attempts: Number(row.attempts || 0) + 1,
      lastErrorCode: code || 'unknown-error',
    });
  }

  function shouldDiscard(row, now) {
    const current = Number(now == null ? Date.now() : now);
    return Number(row?.attempts || 0) >= MAX_ATTEMPTS
      || Number(row?.expiresAt || 0) <= current;
  }

  root.DVOfflinePolicy = Object.freeze({
    isQueueable,
    createQueueEntry,
    recordFailure,
    shouldDiscard,
  });
})(typeof window !== 'undefined' ? window : globalThis);

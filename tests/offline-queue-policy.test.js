import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  await import('../services/offline-queue-policy.js');
});

describe('política de cola offline', () => {
  it('rechaza todas las acciones actuales y payloads sensibles', () => {
    expect(globalThis.DVOfflinePolicy.isQueueable({
      accion: 'reportar_persona',
      documento: 'V-1',
    })).toBe(false);
    expect(globalThis.DVOfflinePolicy.isQueueable({
      accion: 'registrar_entrega_final',
      gps: { lat: 1 },
    })).toBe(false);
  });

  it('crea IDs estables y TTL de 24 horas para una acción explícitamente segura', () => {
    const row = globalThis.DVOfflinePolicy.createQueueEntry(
      { accion: 'public_ping', value: 'ok' },
      {
        now: 1000,
        allowedActions: new Set(['public_ping']),
        createId: () => 'queue-1',
      },
    );

    expect(row).toMatchObject({
      id: 'queue-1',
      queueId: 'queue-1',
      idempotencyKey: 'queue-1',
      createdAt: 1000,
      expiresAt: 1000 + 86400000,
      attempts: 0,
    });
  });

  it('descarta al tercer fallo o al expirar', () => {
    const failed = globalThis.DVOfflinePolicy.recordFailure(
      { attempts: 2 },
      'network-timeout',
    );

    expect(failed.attempts).toBe(3);
    expect(globalThis.DVOfflinePolicy.shouldDiscard(failed, 1000)).toBe(true);
    expect(globalThis.DVOfflinePolicy.shouldDiscard(
      { attempts: 0, expiresAt: 999 },
      1000,
    )).toBe(true);
  });
});

import { expect, it } from 'vitest';

const base = 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/health';

it('sirve health desde Functions Emulator', async () => {
  const response = await fetch(base);
  expect(response.status).toBe(200);

  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'version']);
});

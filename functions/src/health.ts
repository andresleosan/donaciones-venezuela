type HealthRequest = { method: string };
type HealthResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): HealthResponse;
  json(body: unknown): void;
};

export function healthHandler(
  req: HealthRequest,
  res: HealthResponse,
  now: () => Date = () => new Date(),
): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: { code: 'method-not-allowed', message: 'Method not allowed' },
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    version: 'local',
    timestamp: now().toISOString(),
  });
}

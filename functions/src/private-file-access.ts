export const PRIVATE_URL_TTL_MS = 15 * 60 * 1000;

export function validatePrivateStoragePath(path: string): string {
  if (
    path.includes('..')
    || !/^private\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(path)
  ) {
    throw new Error('invalid-private-storage-path');
  }
  return path;
}

export function privateUrlExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PRIVATE_URL_TTL_MS);
}

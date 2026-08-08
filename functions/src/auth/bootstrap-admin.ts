type AdminUser = {
  customClaims?: Record<string, unknown>;
};

export type AdminAuth = {
  getUser(uid: string): Promise<AdminUser>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
};

export async function bootstrapAdmin(
  uid: string,
  auth: AdminAuth,
): Promise<{ uid: string; role: 'admin' }> {
  const normalizedUid = typeof uid === 'string' ? uid.trim() : '';
  if (!normalizedUid) throw new Error('UID de administrador requerido');

  let user: AdminUser;
  try {
    user = await auth.getUser(normalizedUid);
  } catch {
    throw new Error('No se pudo verificar el usuario administrador');
  }

  const claims = { ...(user.customClaims ?? {}), role: 'admin' };
  await auth.setCustomUserClaims(normalizedUid, claims);

  return { uid: normalizedUid, role: 'admin' };
}

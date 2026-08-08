const projectId = process.env.FIREBASE_PROJECT_ID;
const uid = process.env.BOOTSTRAP_ADMIN_UID;

if (!['demo-donaciones-venezuela', 'donaciones-venezuela-4fc29'].includes(projectId)) {
  throw new Error('FIREBASE_PROJECT_ID no permitido para bootstrap');
}
if (process.env.BOOTSTRAP_ADMIN_APPROVED !== 'YES') {
  throw new Error('Se requiere BOOTSTRAP_ADMIN_APPROVED=YES');
}
if (!uid?.trim()) throw new Error('BOOTSTRAP_ADMIN_UID requerido');

const { initializeApp } = await import('firebase-admin/app');
initializeApp({ projectId });

const { getAuth } = await import('firebase-admin/auth');
const { bootstrapAdmin } = await import('../lib/auth/bootstrap-admin.js');

try {
  const result = await bootstrapAdmin(uid, getAuth());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  throw new Error('No se pudo completar el bootstrap administrativo');
}

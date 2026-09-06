import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, updateMetadata, uploadBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-donaciones-venezuela',
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: readFileSync('firebase/storage.rules', 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const objectRef = ref(context.storage(), 'private/owner-uid/receipts/existing.pdf');
    await uploadBytes(
      objectRef,
      new Uint8Array([1]),
      metadata('application/pdf', 'receipts'),
    );
  });
});

afterAll(async () => testEnv.cleanup());

const owner = () => testEnv.authenticatedContext('owner-uid', { role: 'user' }).storage();
const other = () => testEnv.authenticatedContext('other-uid', { role: 'user' }).storage();

const metadata = (contentType: string, category: string, visibility = 'private') => ({
  contentType,
  customMetadata: {
    ownerUid: 'owner-uid',
    category,
    visibility,
  },
});

const upload = (
  storage: ReturnType<typeof owner>,
  path: string,
  contentType: string,
  category: string,
  size = 1,
) => uploadBytes(
  ref(storage, path),
  new Uint8Array(size),
  metadata(contentType, category),
);

describe('Storage private files', () => {
  it('permite carga valida del propietario para las tres categorias', async () => {
    for (const [category, extension, contentType] of [
      ['receipts', 'pdf', 'application/pdf'],
      ['needs', 'png', 'image/png'],
      ['reports', 'webp', 'image/webp'],
    ] as const) {
      await assertSucceeds(upload(
        owner(),
        `private/owner-uid/${category}/file-1.${extension}`,
        contentType,
        category,
      ));
    }
  });

  it('permite actualizar metadata valida al propietario', async () => {
    const storage = owner();
    await assertSucceeds(upload(
      storage,
      'private/owner-uid/receipts/file-update.pdf',
      'application/pdf',
      'receipts',
    ));
    await assertSucceeds(updateMetadata(
      ref(storage, 'private/owner-uid/receipts/file-update.pdf'),
      metadata('application/pdf', 'receipts'),
    ));
  });

  it('deniega lectura y borrado directo al propietario, panel y admin', async () => {
    for (const storage of [
      owner(),
      testEnv.authenticatedContext('panel-uid', { role: 'panel' }).storage(),
      testEnv.authenticatedContext('admin-uid', { role: 'admin' }).storage(),
    ]) {
      const objectRef = ref(storage, 'private/owner-uid/receipts/existing.pdf');
      await assertFails(getBytes(objectRef));
      await assertFails(deleteObject(objectRef));
    }
  });

  it('deniega carga anonima', async () => {
    await assertFails(upload(
      testEnv.unauthenticatedContext().storage(),
      'private/owner-uid/receipts/anonymous.pdf',
      'application/pdf',
      'receipts',
    ));
  });

  it('deniega carga de un UID ajeno', async () => {
    await assertFails(upload(
      other(),
      'private/owner-uid/receipts/other.pdf',
      'application/pdf',
      'receipts',
    ));
  });

  it('deniega escritura fuera del prefijo privado contractual', async () => {
    await assertFails(upload(
      owner(),
      'public/owner-uid/receipts/outside.pdf',
      'application/pdf',
      'receipts',
    ));
  });

  it('deniega categoria desconocida', async () => {
    await assertFails(upload(
      owner(),
      'private/owner-uid/avatars/avatar.png',
      'image/png',
      'avatars',
    ));
  });

  it('deniega MIME invalido', async () => {
    await assertFails(upload(
      owner(),
      'private/owner-uid/needs/file.txt',
      'text/plain',
      'needs',
    ));
  });

  it('deniega extension incoherente con el MIME', async () => {
    await assertFails(upload(
      owner(),
      'private/owner-uid/needs/file.pdf',
      'image/png',
      'needs',
    ));
  });

  it('deniega metadata ausente', async () => {
    await assertFails(uploadBytes(
      ref(owner(), 'private/owner-uid/receipts/missing-metadata.pdf'),
      new Uint8Array([1]),
      { contentType: 'application/pdf' },
    ));
  });

  it('deniega metadata con visibilidad publica', async () => {
    await assertFails(uploadBytes(
      ref(owner(), 'private/owner-uid/receipts/public.pdf'),
      new Uint8Array([1]),
      metadata('application/pdf', 'receipts', 'public'),
    ));
  });

  it('deniega imagenes que exceden 5 MiB', async () => {
    await assertFails(upload(
      owner(),
      'private/owner-uid/needs/too-large.png',
      'image/png',
      'needs',
      5 * 1024 * 1024 + 1,
    ));
  });

  it('deniega PDFs que exceden 10 MiB', async () => {
    await assertFails(upload(
      owner(),
      'private/owner-uid/receipts/too-large.pdf',
      'application/pdf',
      'receipts',
      10 * 1024 * 1024 + 1,
    ));
  });

  it('deniega sustituir el contenido de un archivo ya cargado', async () => {
    const storage = owner();
    await assertSucceeds(upload(storage, 'private/owner-uid/needs/file-fixed.png', 'image/png', 'needs', 3));
    await assertFails(upload(storage, 'private/owner-uid/needs/file-fixed.png', 'image/png', 'needs', 7));
  });

  it('deniega archivos vacios', async () => {
    await assertFails(upload(owner(), 'private/owner-uid/needs/file-empty.png', 'image/png', 'needs', 0));
  });

  it('deniega metadata con claves fuera del contrato', async () => {
    await assertFails(uploadBytes(
      ref(owner(), 'private/owner-uid/needs/file-extra.png'),
      new Uint8Array(1),
      {
        contentType: 'image/png',
        customMetadata: { ownerUid: 'owner-uid', category: 'needs', visibility: 'private', nota: 'libre' },
      },
    ));
  });

  it('deniega panel y admin en espacios ajenos', async () => {
    for (const role of ['panel', 'admin'] as const) {
      await assertFails(upload(
        testEnv.authenticatedContext(`${role}-uid`, { role }).storage(),
        `private/owner-uid/reports/${role}.webp`,
        'image/webp',
        'reports',
      ));
    }
  });
});

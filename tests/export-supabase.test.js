import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOutputRoot,
  buildPostgresInvocation,
  FINANCIAL_TOTALS_QUERY,
  cleanupFailedRun,
  createRunDirectory,
  exportAuth,
  exportPostgres,
  exportStorage,
  markRunFailed,
  parsePostgresConnection,
  quoteIdentifier,
  readExportConfig,
  runCommand,
  sealRun,
  verifyRun,
  writeRunManifest,
} from '../scripts/export-supabase-lib.mjs';
import { formatDryRunSummary, main, parseCliArgs } from '../scripts/export-supabase.mjs';
import { main as verifyMain } from '../scripts/verify-supabase-export.mjs';

const EXPECTED_PROJECT_REF = 'zryfwbjvlacorryzdaod';
const EXPECTED_SUPABASE_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;

function completeExportEnv(overrides = {}) {
  return {
    SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
    SUPABASE_URL: EXPECTED_SUPABASE_URL,
    SUPABASE_DB_URL: 'postgres://user:placeholder@example/db',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-key',
    EXPORT_ROOT: 'C:/secure/donaciones-export',
    EXPORT_AGE_RECIPIENT: 'age1test',
    EXPORT_EXECUTION_APPROVED: 'YES',
    ...overrides,
  };
}

function fakeSuccessfulSpawn(calls, { code = 0, stderr = '', stdout = '' } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  };
}

function createAuthPaths() {
  const root = mkdtempSync(join(tmpdir(), 'export-auth-'));
  const auth = join(root, 'auth');
  const temp = join(root, 'temp');
  mkdirSync(auth);
  mkdirSync(temp);
  return { root, auth, temp };
}

function fakeAuthResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createStoragePaths() {
  const root = mkdtempSync(join(tmpdir(), 'export-storage-'));
  const storage = join(root, 'storage');
  const temp = join(root, 'temp');
  mkdirSync(storage);
  mkdirSync(temp);
  return { root, storage, temp };
}

function storageConfig(overrides = {}) {
  return {
    projectRef: EXPECTED_PROJECT_REF,
    supabaseUrl: EXPECTED_SUPABASE_URL,
    mode: 'execute',
    serviceRoleKey: 'placeholder-service-key',
    storagePageSize: 2,
    ...overrides,
  };
}

function fakeStorageResponse({ status = 200, body, stream, contentType } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async json() {
      return body;
    },
    body: stream,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function authUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    last_sign_in_at: '2026-01-03T00:00:00Z',
    phone: '+584120000000',
    user_metadata: {
      display_name: 'Alice',
      secret: 'user-metadata-secret',
    },
    app_metadata: {
      provider: 'email',
      role: 'admin',
      secret: 'app-metadata-secret',
    },
    banned_until: null,
    disabled: true,
    identities: [{ identity_id: 'identity-secret' }],
    access_token: 'access-token-secret',
    refresh_token: 'refresh-token-secret',
    encrypted_password: 'password-hash-secret',
    raw_headers: { authorization: 'raw-header-secret' },
    unsupported_field: 'must-not-be-exported',
    ...overrides,
  };
}

describe('export config', () => {
  it('requires the exact Supabase project reference', () => {
    expect(() => readExportConfig({
      SUPABASE_PROJECT_REF: 'otro-proyecto',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_DB_URL: 'postgres://user:secret@example/db',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      EXPORT_ROOT: 'C:/secure/donaciones-export',
      EXPORT_AGE_RECIPIENT: 'age1test',
    }, 'F:/repo')).toThrow(/project/i);
  });

  it('rejects output inside the repository', () => {
    expect(() => assertSafeOutputRoot('F:/repo/backups', 'F:/repo')).toThrow(/outside/i);
    expect(() => assertSafeOutputRoot('/outside/backups', '/repo')).not.toThrow();
  });

  it('never exposes credentials in the normalized config summary', () => {
    const config = readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
      SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
      SUPABASE_DB_URL: 'postgres://user:secret@example/db',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
      EXPORT_ROOT: 'C:/secure/donaciones-export',
      EXPORT_AGE_RECIPIENT: 'age1test',
    }, 'F:/repo');
    expect(JSON.stringify(config)).not.toContain('secret');
  });

  it('reports missing variable names without requiring them in dry-run', () => {
    const config = readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
    }, 'F:/repo');

    expect(config.missingVariables).toEqual([
      'SUPABASE_URL',
      'SUPABASE_DB_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'EXPORT_ROOT',
      'EXPORT_AGE_RECIPIENT',
    ]);
  });

  it('requires all variables in execute mode', () => {
    expect(() => readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
      EXPORT_EXECUTION_APPROVED: 'YES',
    }, 'F:/repo', { mode: 'execute' })).toThrow(/SUPABASE_URL/);
  });

  it('rejects invalid database URLs without echoing their contents', () => {
    expect(() => readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
      SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
      SUPABASE_DB_URL: 'not-a-postgres-url-password',
      EXPORT_EXECUTION_APPROVED: 'YES',
    }, 'F:/repo', { mode: 'execute' })).toThrowError(/database|postgres/i);

    try {
      readExportConfig({
        SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
        SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
        SUPABASE_DB_URL: 'not-a-postgres-url-password',
        EXPORT_EXECUTION_APPROVED: 'YES',
      }, 'F:/repo', { mode: 'execute' });
    } catch (error) {
      expect(error.message).not.toContain('not-a-postgres-url-password');
    }
  });

  it('defaults to dry-run and rejects unknown flags with exit code 2', () => {
    expect(parseCliArgs([])).toMatchObject({ mode: 'dry-run' });

    let error;
    try {
      parseCliArgs(['--unknown']);
    } catch (caught) {
      error = caught;
    }

    expect(error?.code).toBe(2);
  });

  it('summarizes only tool statuses and missing variable names', () => {
    const summary = formatDryRunSummary({
      tools: [
        { name: 'pg_dump', available: true },
        { name: 'age', available: false },
      ],
      missingVariables: ['SUPABASE_URL'],
    });

    expect(summary).toContain('pg_dump');
    expect(summary).toContain('age');
    expect(summary).toContain('SUPABASE_URL');
    expect(summary).not.toContain('https://');
  });

  it('formats an empty dry-run summary without reading configuration values', () => {
    const summary = formatDryRunSummary();

    expect(summary).toContain('dry-run');
    expect(summary).toContain('Missing variables:');
  });

  it('does not read credential values in dry-run', () => {
    const env = {
      SUPABASE_PROJECT_REF: EXPECTED_PROJECT_REF,
      SUPABASE_URL: EXPECTED_SUPABASE_URL,
      EXPORT_ROOT: 'C:/secure/donaciones-export',
      EXPORT_AGE_RECIPIENT: 'age1test',
      get SUPABASE_DB_URL() {
        throw new Error('dry-run read database credential');
      },
      get SUPABASE_SERVICE_ROLE_KEY() {
        throw new Error('dry-run read service credential');
      },
      get EXPORT_EXECUTION_APPROVED() {
        throw new Error('dry-run read execute approval');
      },
    };

    const config = readExportConfig(env, 'F:/repo');

    expect(config.dbUrl).toBeUndefined();
    expect(config.serviceRoleKey).toBeUndefined();
    expect(config.missingVariables).not.toContain('SUPABASE_DB_URL');
    expect(config.missingVariables).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('materializes credential values only in execute mode', () => {
    const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });

    expect(config.dbUrl).toBe('postgres://user:placeholder@example/db');
    expect(config.serviceRoleKey).toBe('placeholder-service-key');
  });

  it('requires explicit approval only in execute mode', () => {
    expect(() => readExportConfig(completeExportEnv({
      EXPORT_EXECUTION_APPROVED: undefined,
    }), 'F:/repo', { mode: 'execute' })).toThrow(/EXPORT_EXECUTION_APPROVED=YES/);
  });

  it('rejects an HTTPS URL belonging to another project', () => {
    expect(() => readExportConfig(completeExportEnv({
      SUPABASE_URL: 'https://otro-proyecto.supabase.co',
    }), 'F:/repo')).toThrow(/project|host|URL/i);
  });

  it('keeps run-dir in main preflight state without printing its value', async () => {
    const output = [];
    const code = await main(
      ['--dry-run', '--project-ref', EXPECTED_PROJECT_REF, '--run-dir', 'C:/secure/run-dir'],
      completeExportEnv(),
      {
        log: (message) => output.push(message),
        error: (message) => output.push(message),
      },
    );

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Run directory: configured');
    expect(output.join('\n')).not.toContain('C:/secure/run-dir');
  });

  it('rejects a run directory whose symlink resolves inside the repository', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'export-preflight-'));
    const repoRoot = join(fixtureRoot, 'repo');
    const linkRoot = join(fixtureRoot, 'external-link');
    mkdirSync(repoRoot);

    try {
      symlinkSync(repoRoot, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => assertSafeOutputRoot(join(linkRoot, 'run'), repoRoot)).toThrow(/outside/i);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe('Supabase Auth export', () => {
  it('rejects direct calls with an unapproved host before reading the service key', async () => {
    const paths = createAuthPaths();
    const config = {
      projectRef: EXPECTED_PROJECT_REF,
      supabaseUrl: 'https://attacker.example.test',
      mode: 'execute',
    };
    Object.defineProperty(config, 'serviceRoleKey', {
      get() {
        throw new Error('service key was read');
      },
    });

    try {
      await expect(exportAuth(config, paths, async () => {
        throw new Error('fetch must not run');
      })).rejects.toThrow(/approved|origin|URL/i);
      expect(readdirSync(paths.auth)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['wrong project', { projectRef: 'another-project' }],
    ['dry-run mode', { mode: 'dry-run' }],
  ])('rejects direct Auth export with %s before using the service key', async (_name, overrides) => {
    const paths = createAuthPaths();
    const config = {
      projectRef: EXPECTED_PROJECT_REF,
      supabaseUrl: EXPECTED_SUPABASE_URL,
      mode: 'execute',
      ...overrides,
    };
    Object.defineProperty(config, 'serviceRoleKey', {
      get() {
        throw new Error('service key was read');
      },
    });

    try {
      await expect(exportAuth(config, paths, async () => {
        throw new Error('fetch must not run');
      })).rejects.toThrow(/project|execute|mode/i);
      expect(readdirSync(paths.auth)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('fetches bounded pages and writes only the approved redacted user fields', async () => {
    const paths = createAuthPaths();
    const calls = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => authUser({
      id: `user-${index + 1}`,
      email: index === 0 ? 'alice@example.com' : `user-${index + 1}@example.com`,
    }));
    const secondPage = [authUser({
      id: 'user-101',
      email: 'last@example.com',
      email_confirmed_at: null,
      last_sign_in_at: null,
      phone: null,
      disabled: false,
    })];
    const responses = [
      fakeAuthResponse({ users: firstPage }),
      fakeAuthResponse({ users: secondPage }),
    ];
    const fetchImpl = async (...args) => {
      calls.push(args);
      return responses.shift();
    };

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      const evidence = await exportAuth(config, paths, fetchImpl, {
        now: '2026-01-10T00:00:00Z',
      });
      const usersFile = join(paths.auth, 'users.json');
      const metadataFile = join(paths.auth, 'metadata.json');
      const users = JSON.parse(readFileSync(usersFile, 'utf8'));
      const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));

      expect(evidence).toEqual({ usersFile, userCount: 101, pages: 2 });
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(`${EXPECTED_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100`);
      expect(calls[1][0]).toBe(`${EXPECTED_SUPABASE_URL}/auth/v1/admin/users?page=2&per_page=100`);
      expect(calls[0][1]).toEqual({
        headers: {
          apikey: 'placeholder-service-key',
          Authorization: 'Bearer placeholder-service-key',
        },
      });
      expect(Object.keys(users[0]).sort()).toEqual([
        'appMetadata',
        'createdAt',
        'disabled',
        'email',
        'emailConfirmedAt',
        'id',
        'lastSignInAt',
        'phone',
        'updatedAt',
        'userMetadata',
      ].sort());
      expect(users[0]).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        emailConfirmedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        lastSignInAt: '2026-01-03T00:00:00.000Z',
        phone: '+584120000000',
        userMetadata: { display_name: 'Alice' },
        appMetadata: { provider: 'email', role: 'admin' },
        disabled: true,
      });
      expect(users[100]).toMatchObject({
        id: 'user-101',
        emailConfirmedAt: null,
        lastSignInAt: null,
        phone: null,
        disabled: false,
      });
      expect(metadata).toMatchObject({ count: 101, pages: 2 });
      expect(metadata.fieldPolicy).toMatchObject({
        userMetadata: ['display_name', 'full_name', 'name', 'avatar_url'],
        appMetadata: ['provider', 'providers', 'role', 'roles'],
      });

      const written = `${readFileSync(usersFile, 'utf8')}\n${readFileSync(metadataFile, 'utf8')}`;
      for (const secret of [
        'identity-secret',
        'access-token-secret',
        'refresh-token-secret',
        'password-hash-secret',
        'raw-header-secret',
        'must-not-be-exported',
        'user-metadata-secret',
        'app-metadata-secret',
        'placeholder-service-key',
      ]) {
        expect(written).not.toContain(secret);
      }
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects an HTTP error without writing Auth evidence or exposing the key', async () => {
    const paths = createAuthPaths();
    const serviceRoleKey = 'placeholder-service-key';

    try {
      const config = readExportConfig(completeExportEnv({
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      }), 'F:/repo', { mode: 'execute' });

      await expect(exportAuth(config, paths, async () => fakeAuthResponse({
        error: 'remote detail with access-token-secret',
      }, 503))).rejects.toThrow(/HTTP/);
      expect(readdirSync(paths.auth)).toEqual([]);
      try {
        await exportAuth(config, paths, async () => fakeAuthResponse({
          error: 'remote detail with access-token-secret',
        }, 503));
      } catch (error) {
        expect(error.message).not.toContain(serviceRoleKey);
        expect(error.message).not.toContain('access-token-secret');
      }
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects malformed JSON without writing Auth evidence', async () => {
    const paths = createAuthPaths();

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      const response = {
        ok: true,
        status: 200,
        async json() {
          throw new SyntaxError('malformed response access-token-secret');
        },
      };

      await expect(exportAuth(config, paths, async () => response)).rejects.toThrow(/JSON/);
      expect(readdirSync(paths.auth)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects a repeated page before writing Auth evidence', async () => {
    const paths = createAuthPaths();
    const page = Array.from({ length: 100 }, (_, index) => authUser({ id: `user-${index + 1}` }));
    let calls = 0;

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await expect(exportAuth(config, paths, async () => {
        calls += 1;
        return fakeAuthResponse({ users: page });
      })).rejects.toThrow(/repeated|repeat/i);
      expect(calls).toBe(2);
      expect(readdirSync(paths.auth)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects an overlapping user ID across pages before writing Auth evidence', async () => {
    const paths = createAuthPaths();
    const firstPage = Array.from({ length: 100 }, (_, index) => authUser({ id: `user-${index + 1}` }));
    const secondPage = [authUser({ id: 'user-100' })];
    let calls = 0;

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await expect(exportAuth(config, paths, async () => {
        calls += 1;
        return fakeAuthResponse({ users: calls === 1 ? firstPage : secondPage });
      })).rejects.toThrow(/overlap|repeated|duplicate/i);
      expect(calls).toBe(2);
      expect(readdirSync(paths.auth)).toEqual([]);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects a page larger than the bounded page size before writing evidence', async () => {
    const paths = createAuthPaths();
    let calls = 0;

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      const oversizedPage = Array.from({ length: 101 }, (_, index) => authUser({ id: `user-${index}` }));
      await expect(exportAuth(config, paths, async () => {
        calls += 1;
        return fakeAuthResponse({ users: oversizedPage });
      })).rejects.toThrow(/safe page size/i);
      expect(calls).toBe(1);
      expect(readdirSync(paths.auth)).toEqual([]);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid Supabase ban timestamp without writing evidence', async () => {
    const paths = createAuthPaths();

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await expect(exportAuth(config, paths, async () => fakeAuthResponse({ users: [authUser({
        banned_until: 'not-a-timestamp',
      })] }), { now: '2026-01-10T00:00:00Z' })).rejects.toThrow(/timestamp|ban/i);
      expect(readdirSync(paths.auth)).toEqual([]);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('maps future and expired Supabase bans to the approved disabled field', async () => {
    const paths = createAuthPaths();
    const responseUsers = [
      authUser({
        id: 'future-ban',
        disabled: false,
        banned_until: '2026-01-11T00:00:00Z',
      }),
      authUser({
        id: 'expired-ban',
        disabled: false,
        banned_until: '2026-01-09T00:00:00Z',
      }),
      authUser({
        id: 'explicit-disabled',
        disabled: true,
        banned_until: '2026-01-09T00:00:00Z',
      }),
    ];

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await exportAuth(config, paths, async () => fakeAuthResponse({ users: responseUsers }), {
        now: '2026-01-10T00:00:00Z',
      });
      const users = JSON.parse(readFileSync(join(paths.auth, 'users.json'), 'utf8'));

      expect(users.map(({ id, disabled }) => ({ id, disabled }))).toEqual([
        { id: 'future-ban', disabled: true },
        { id: 'expired-ban', disabled: false },
        { id: 'explicit-disabled', disabled: true },
      ]);
      expect(readFileSync(join(paths.auth, 'users.json'), 'utf8')).not.toContain('banned_until');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('removes temporary and final Auth artifacts when publication fails', async () => {
    const paths = createAuthPaths();
    const writes = [];

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await expect(exportAuth(config, paths, async () => fakeAuthResponse({ users: [authUser()] }), {
        now: '2026-01-10T00:00:00Z',
        writer: async (filePath, value) => {
          writes.push({ filePath, value });
        },
        renameImpl: async () => {
          throw new Error('publish failure');
        },
      })).rejects.toThrow(/publish|artifact/i);
      expect(writes).toHaveLength(2);
      expect(readdirSync(paths.auth)).toEqual([]);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects an unbounded full-page sequence at the page limit', async () => {
    const paths = createAuthPaths();
    let calls = 0;

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await expect(exportAuth(config, paths, async () => {
        calls += 1;
        return fakeAuthResponse({ users: Array.from({ length: 100 }, (_, index) => authUser({
          id: `page-${calls}-user-${index}`,
        })) });
      })).rejects.toThrow(/limit|bounded|pagination/i);
      expect(calls).toBeLessThanOrEqual(100);
      expect(readdirSync(paths.auth)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe('export staging and command runner', () => {
  it('passes PostgreSQL credentials through the environment, never pg_dump argv', async () => {
    const calls = [];
    const connectionUrl = 'postgresql://exporter:db-password@db.example.test:5432/postgres';
    const invocation = buildPostgresInvocation(
      parsePostgresConnection(connectionUrl),
      'C:/secure/run/postgres/data.dump',
    );

    await runCommand(invocation.command, invocation.args, {
      env: invocation.env,
      spawnImpl: fakeSuccessfulSpawn(calls),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('pg_dump');
    expect(calls[0].args).toEqual([
      '--host', 'db.example.test',
      '--port', '5432',
      '--username', 'exporter',
      '--dbname', 'postgres',
      '--file', 'C:/secure/run/postgres/data.dump',
    ]);
    expect(calls[0].args.join(' ')).not.toContain('db-password');
    expect(calls[0].args.join(' ')).not.toContain(connectionUrl);
    expect(calls[0].options.env).toMatchObject({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'exporter',
      PGDATABASE: 'postgres',
      PGPASSWORD: 'db-password',
      PGSSLMODE: 'require',
    });
  });

  it('uses the explicit PostgreSQL environment without inheriting process variables', async () => {
    const calls = [];
    const invocation = buildPostgresInvocation(
      parsePostgresConnection('postgresql://exporter:DB_PASSWORD@db.example.test:5432/postgres'),
      'C:/secure/run/postgres/data.dump',
    );

    await runCommand(invocation.command, invocation.args, {
      env: invocation.env,
      spawnImpl: fakeSuccessfulSpawn(calls),
    });

    expect(Object.keys(calls[0].options.env).sort()).toEqual([
      'PGDATABASE',
      'PGHOST',
      'PGPASSWORD',
      'PGPORT',
      'PGSSLMODE',
      'PGUSER',
    ]);
    expect(calls[0].options.env).toEqual({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'exporter',
      PGDATABASE: 'postgres',
      PGPASSWORD: 'DB_PASSWORD',
      PGSSLMODE: 'require',
    });
    expect(calls[0].options.env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(calls[0].options.env).not.toHaveProperty('SUPABASE_DB_URL');
    expect(calls[0].options.env).not.toHaveProperty('PATH');
  });

  it('forces TLS and only passes the six approved PostgreSQL environment fields', () => {
    const invocation = buildPostgresInvocation({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'exporter',
      PGDATABASE: 'postgres',
      PGPASSWORD: 'DB_PASSWORD',
      PGSSLMODE: 'disable',
      PGOPTIONS: '--search_path=private',
      PATH: 'C:/attacker/bin',
    }, 'C:/secure/run/postgres/data.dump');

    expect(invocation.env).toEqual({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'exporter',
      PGDATABASE: 'postgres',
      PGPASSWORD: 'DB_PASSWORD',
      PGSSLMODE: 'require',
    });
  });

  it('captures command output and returns the child exit code', async () => {
    const calls = [];
    const result = await runCommand('pg_dump', ['--version'], {
      spawnImpl: fakeSuccessfulSpawn(calls, { code: 3, stdout: 'version\n', stderr: 'failed\n' }),
    });

    expect(result).toEqual({ stdout: 'version\n', stderr: 'failed\n', code: 3 });
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(calls[0].options.env.PATH).toBe(process.env.PATH);
  });

  it('redacts sensitive command output', async () => {
    const result = await runCommand('pg_dump', ['--version'], {
      env: { PGPASSWORD: 'db-password' },
      spawnImpl: fakeSuccessfulSpawn([], { stderr: 'password=db-password\n' }),
    });

    expect(result.stderr).toBe('password=[redacted]\n');
  });

  it('refuses to spawn when command arguments contain a credential', async () => {
    const calls = [];

    for (const args of [
      ['--dbname', 'postgresql://exporter:db-password@db.example.test:5432/postgres'],
      ['--password', 'DB_PASSWORD'],
      ['--password=DB_PASSWORD'],
      ['-W', 'DB_PASSWORD'],
      ['--pass-file', 'C:/secure/secret-file'],
    ]) {
      await expect(runCommand('pg_dump', args, {
        env: { PGPASSWORD: 'db-password' },
        spawnImpl: fakeSuccessfulSpawn(calls),
      })).rejects.toMatchObject({ code: expect.stringMatching(/^COMMAND_ARGUMENT_/) });
    }

    await expect(runCommand('pg_dump', ['--unapproved-option'], {
      spawnImpl: fakeSuccessfulSpawn(calls),
    })).rejects.toMatchObject({ code: 'COMMAND_ARGUMENT_NOT_ALLOWED' });
    expect(calls).toEqual([]);
  });

  it('fails timed-out commands without exposing their environment', async () => {
    const calls = [];
    const signals = [];
    const destroyedStreams = [];
    const spawnImpl = (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.destroy = () => destroyedStreams.push('stdout');
      child.stderr.destroy = () => destroyedStreams.push('stderr');
      child.kill = (signal) => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null));
      };
      return child;
    };

    await expect(runCommand('pg_dump', ['--version'], {
      env: { PGPASSWORD: 'db-password' },
      timeout: 1,
      terminationGraceMs: 1,
      spawnImpl,
    })).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
    expect(calls[0].args.join(' ')).not.toContain('db-password');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(destroyedStreams).toEqual(['stdout', 'stderr']);
  });

  it('does not persist an untrusted child error code', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('error', { code: 'DB_PASSWORD', message: 'secret=DB_PASSWORD' }));
      return child;
    };

    await expect(runCommand('pg_dump', [], { spawnImpl })).rejects.toMatchObject({
      code: 'COMMAND_SPAWN_FAILED',
    });
  });

  it('creates an exclusive UTC run directory with protected staging paths', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-staging-'));
    const timestamp = '2026-08-06T12:00:00.000Z';

    try {
      const paths = await createRunDirectory(outputRoot, timestamp);

      expect(paths.root).toContain('2026-08-06T120000Z');
      for (const name of ['root', 'postgres', 'auth', 'storage', 'reconciliation', 'temp']) {
        expect(paths[name]).toBeDefined();
        if (name !== 'root') expect(paths[name].startsWith(paths.root + '\\')).toBe(true);
        expect(existsSync(paths[name])).toBe(true);
      }
      expect(JSON.parse(readFileSync(join(paths.root, 'run.json'), 'utf8'))).toMatchObject({
        status: 'prepared',
      });

      await expect(createRunDirectory(outputRoot, timestamp)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(readdirSync(outputRoot)).toEqual(['2026-08-06T120000Z']);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('rejects an invalid timestamp before creating an output root', async () => {
    const parentRoot = mkdtempSync(join(tmpdir(), 'export-invalid-parent-'));
    const outputRoot = join(parentRoot, 'not-created');

    try {
      await expect(createRunDirectory(outputRoot, 'not-a-timestamp')).rejects.toThrow(/timestamp/i);
      expect(existsSync(outputRoot)).toBe(false);
    } finally {
      rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('rejects a staging root inside the supplied repository boundary', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'export-root-boundary-'));
    const repoRoot = join(fixtureRoot, 'repo');
    const outputRoot = join(repoRoot, 'exports');
    mkdirSync(repoRoot);

    try {
      await expect(createRunDirectory(
        outputRoot,
        '2026-08-06T12:00:00.000Z',
        repoRoot,
      )).rejects.toThrow(/outside/i);
      expect(existsSync(outputRoot)).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('marks failed runs safely and cleans only temporary files', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-failed-'));
    const previousRun = join(outputRoot, '2026-08-05T120000Z');
    mkdirSync(previousRun);

    try {
      const paths = await createRunDirectory(outputRoot, '2026-08-06T12:00:00.000Z');
      writeFileSync(join(paths.temp, 'partial.tmp'), 'temporary');
      writeFileSync(join(paths.postgres, 'partial.dump'), 'diagnostic');

      await markRunFailed(paths, { code: 7, message: 'password=db-password' });
      await cleanupFailedRun(paths);

      expect(JSON.parse(readFileSync(join(paths.root, 'run.json'), 'utf8'))).toMatchObject({
        status: 'failed',
        errorCode: 'COMMAND_EXIT',
      });
      expect(readdirSync(paths.temp)).toEqual([]);
      expect(existsSync(join(paths.postgres, 'partial.dump'))).toBe(true);
      expect(existsSync(previousRun)).toBe(true);
      expect(readFileSync(join(paths.root, 'run.json'), 'utf8')).not.toContain('db-password');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('recreates failed-run temp staging with restrictive permissions where supported', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-temp-mode-'));

    try {
      const paths = await createRunDirectory(outputRoot, '2026-08-06T12:00:00.000Z');
      await markRunFailed(paths, { code: 'COMMAND_TIMEOUT' });

      expect(existsSync(paths.temp)).toBe(true);
      if (process.platform !== 'win32') {
        expect(statSync(paths.temp).mode & 0o777).toBe(0o700);
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('normalizes untrusted failure codes before writing run.json', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-error-code-'));

    try {
      const paths = await createRunDirectory(outputRoot, '2026-08-06T12:00:00.000Z');
      await markRunFailed(paths, { code: 'DB_PASSWORD', message: 'secret=DB_PASSWORD' });

      const run = readFileSync(join(paths.root, 'run.json'), 'utf8');
      expect(JSON.parse(run)).toMatchObject({ status: 'failed', errorCode: 'EXPORT_FAILED' });
      expect(run).not.toContain('DB_PASSWORD');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('does not invoke commands or write artifacts during dry-run', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-dry-run-'));
    const before = readdirSync(outputRoot);
    const output = [];
    const calls = [];

    try {
      const code = await main(
        ['--dry-run', '--project-ref', EXPECTED_PROJECT_REF],
        completeExportEnv({ EXPORT_ROOT: outputRoot, PATH: '' }),
        {
          log: (message) => output.push(message),
          error: (message) => output.push(message),
        },
        {
          fetchImpl: () => { throw new Error('dry-run called fetch'); },
          runner: (...args) => {
            calls.push(args);
            throw new Error('dry-run invoked command');
          },
        },
      );

      expect(code).toBe(0);
      expect(calls).toEqual([]);
      expect(readdirSync(outputRoot)).toEqual(before);
      expect(output.join('\n')).toContain('dry-run');
      expect(output.join('\n')).not.toContain('dry-run called fetch');
      expect(output.join('\n')).not.toContain('dry-run invoked command');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('blocks execute before staging or commands without explicit approval', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-approval-'));
    const output = [];
    const calls = [];

    try {
      const code = await main(
        ['--execute', '--project-ref', EXPECTED_PROJECT_REF],
        completeExportEnv({
          EXPORT_ROOT: outputRoot,
          EXPORT_EXECUTION_APPROVED: undefined,
        }),
        {
          log: (message) => output.push(message),
          error: (message) => output.push(message),
        },
        {
          runner: async (...args) => {
            calls.push(args);
            throw new Error('execute command must not run');
          },
        },
      );

      expect(code).toBe(1);
      expect(calls).toEqual([]);
      expect(readdirSync(outputRoot)).toEqual([]);
      expect(output.join('\n')).toContain('EXPORT_EXECUTION_APPROVED=YES');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('coordinates the PostgreSQL export with the injected runner', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-execute-'));
    const output = [];
    const calls = [];

    try {
      const code = await main(
        ['--execute', '--project-ref', EXPECTED_PROJECT_REF],
        completeExportEnv({ EXPORT_ROOT: outputRoot }),
        {
          log: (message) => output.push(message),
          error: (message) => output.push(message),
        },
        {
          runner: async (...args) => {
            calls.push(args);
            const [command, commandArgs] = args;
            if (commandArgs.includes('--version')) {
              return { code: 0, stdout: `${command} (PostgreSQL) 16.1\n`, stderr: '' };
            }
            if (command === 'pg_dump') {
              const outputArg = commandArgs.find((argument) => argument.startsWith('--file='));
              writeFileSync(outputArg.slice('--file='.length), commandArgs.includes('--schema-only') ? 'schema fixture' : 'data fixture');
            }
            if (command === 'age') {
              const outputIndex = commandArgs.indexOf('--output');
              writeFileSync(commandArgs[outputIndex + 1], 'encrypted archive fixture');
            }
            return {
              code: 0,
              stdout: command === 'psql'
                ? [
                  JSON.stringify({ relation: 'public.facturas', count: '1' }),
                  JSON.stringify({
                    facturas: {
                      count: '1',
                      abiertas: '1',
                      monto_requerido: '10.00',
                      monto_recaudado: '5.00',
                    },
                    donaciones: {
                      count: '1',
                      confirmadas_count: '1',
                      confirmadas_monto: '5.00',
                    },
                    movimientos_factura: {
                      count: '1',
                      monto: '5.00',
                    },
                  }),
                ].join('\n')
                : '',
              stderr: '',
            };
          },
          fetchImpl: async (url) => ({
            ok: true,
            status: 200,
            async json() {
              return url.includes('/storage/v1/bucket') ? [] : { users: [] };
            },
          }),
          now: '2026-08-06T12:00:00.000Z',
        },
      );

      expect(code).toBe(0);
      expect(calls).toHaveLength(7);
      expect(calls.filter(([command, commandArgs]) => command === 'pg_dump' && !commandArgs.includes('--version'))).toHaveLength(2);
      expect(calls.filter(([command, commandArgs]) => command === 'psql' && !commandArgs.includes('--version'))).toHaveLength(1);
      expect(readdirSync(outputRoot)).toEqual(expect.arrayContaining([
        '2026-08-06T120000Z',
        '2026-08-06T120000Z.tar.age',
      ]));
      expect(JSON.parse(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'run.json'), 'utf8'))).toMatchObject({
        status: 'completed',
      });
      expect(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'schema.sql'), 'utf8')).toBe('schema fixture');
      expect(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'data.dump'), 'utf8')).toBe('data fixture');
      expect(existsSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'object-counts.json'))).toBe(true);
      expect(existsSync(join(outputRoot, '2026-08-06T120000Z', 'auth', 'users.json'))).toBe(true);
      expect(existsSync(join(outputRoot, '2026-08-06T120000Z', 'auth', 'metadata.json'))).toBe(true);
      expect(existsSync(join(outputRoot, '2026-08-06T120000Z', 'storage', 'manifest.jsonl'))).toBe(true);
      expect(output.join('\n')).toContain('PostgreSQL export prepared');
      expect(output.join('\n')).toContain('Storage export prepared (0 objects, 0 buckets)');
      expect(output.join('\n')).toContain('Run status: completed');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('does not print the configured staging path when exclusive creation fails', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'export-collision-'));
    const configuredRunRoot = join(outputRoot, '2026-08-06T120000Z');
    mkdirSync(configuredRunRoot);
    const output = [];

    try {
      const code = await main(
        ['--execute', '--project-ref', EXPECTED_PROJECT_REF],
        completeExportEnv({ EXPORT_ROOT: outputRoot }),
        {
          log: (message) => output.push(message),
          error: (message) => output.push(message),
        },
        { now: '2026-08-06T12:00:00.000Z' },
      );

      expect(code).toBe(1);
      expect(output.join('\n')).not.toContain(configuredRunRoot);
      expect(output.join('\n')).toContain('already exists');
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

describe('PostgreSQL export', () => {
  function createPostgresPaths() {
    const root = mkdtempSync(join(tmpdir(), 'export-postgres-'));
    const paths = {
      root,
      postgres: join(root, 'postgres'),
      reconciliation: join(root, 'reconciliation'),
      temp: join(root, 'temp'),
    };
    for (const path of [paths.postgres, paths.reconciliation, paths.temp]) mkdirSync(path);
    writeFileSync(join(root, 'run.json'), JSON.stringify({ status: 'prepared' }));
    return paths;
  }

  function completeFinancialTotals() {
    return {
      facturas: {
        count: '3',
        abiertas: '2',
        monto_requerido: '100.00',
        monto_recaudado: '75.00',
      },
      donaciones: {
        count: '4',
        confirmadas_count: '3',
        confirmadas_monto: '50.00',
      },
      movimientos_factura: {
        count: '5',
        monto: '20.00',
      },
    };
  }

  function fakePostgresRunner(calls, stdout) {
    return async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('--version')) return { code: 0, stdout: `${command} (PostgreSQL) 16.1\n`, stderr: '' };
      if (command === 'pg_dump') {
        const outputArg = args.find((argument) => argument.startsWith('--file='));
        writeFileSync(outputArg.slice('--file='.length), args.includes('--schema-only') ? 'schema fixture' : 'data fixture');
      }
      return { code: 0, stdout: command === 'psql' ? stdout : '', stderr: '' };
    };
  }

  it('runs public schema, custom data and exact count exports with redacted connection args', async () => {
    const paths = createPostgresPaths();
    const calls = [];
    const countOutput = [
      JSON.stringify({ relation: 'public.facturas', count: 3 }),
      JSON.stringify({ relation: 'public.donaciones', count: 4 }),
      JSON.stringify({
        facturas: {
          count: '3',
          abiertas: '2',
          monto_requerido: '100.00',
          monto_recaudado: '75.00',
        },
        donaciones: {
          count: '4',
          confirmadas_count: '3',
          confirmadas_monto: '50.00',
        },
        movimientos_factura: {
          count: '5',
          monto: '20.00',
        },
      }),
    ].join('\n');
    const runner = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('--version')) return { code: 0, stdout: `${command} (PostgreSQL) 16.1\n`, stderr: '' };
      if (command === 'pg_dump') {
        const outputArg = args.find((argument) => argument.startsWith('--file='));
        writeFileSync(outputArg.slice('--file='.length), args.includes('--schema-only') ? 'schema fixture' : 'data fixture');
      }
      return { code: 0, stdout: command === 'psql' ? countOutput : '', stderr: '' };
    };

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      const evidence = await exportPostgres(config, paths, runner);
      const pgDumpCalls = calls.filter(({ command, args }) => command === 'pg_dump' && !args.includes('--version'));
      const psqlCall = calls.find(({ command, args }) => command === 'psql' && args[0] === '--set=ON_ERROR_STOP=1');
      const countsSql = readFileSync(join(paths.temp, 'counts.sql'), 'utf8');

      expect(pgDumpCalls).toHaveLength(2);
      expect(pgDumpCalls[0].args).toEqual([
        '--schema=public',
        '--schema-only',
        '--no-owner',
        '--no-privileges',
        `--file=${join(paths.postgres, 'schema.sql')}`,
      ]);
      expect(pgDumpCalls[1].args).toEqual([
        '--schema=public',
        '--data-only',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${join(paths.postgres, 'data.dump')}`,
      ]);
      expect(psqlCall.args).toEqual([
        '--set=ON_ERROR_STOP=1',
        `--file=${join(paths.temp, 'counts.sql')}`,
      ]);
      expect(psqlCall.options.env).toEqual({
        PGHOST: 'example',
        PGPORT: '5432',
        PGUSER: 'user',
        PGDATABASE: 'db',
        PGPASSWORD: 'placeholder',
        PGSSLMODE: 'require',
      });
      expect(JSON.stringify(psqlCall.args)).not.toContain('placeholder');
      expect(evidence).toEqual({
        schemaFile: join(paths.postgres, 'schema.sql'),
        dataFile: join(paths.postgres, 'data.dump'),
        countsFile: join(paths.postgres, 'object-counts.json'),
        tableCount: 2,
      });
      expect(JSON.parse(readFileSync(evidence.countsFile, 'utf8'))).toEqual({
        schema: 'public',
        tableCount: 2,
        tables: [
          { relation: 'public.donaciones', count: 4 },
          { relation: 'public.facturas', count: 3 },
        ],
      });
      expect(JSON.parse(readFileSync(join(paths.reconciliation, 'financial-totals.json'), 'utf8'))).toEqual({
        query: 'financial_totals',
        schema: 'public',
        totals: {
          facturas: {
            count: '3',
            abiertas: '2',
            monto_requerido: '100.00',
            monto_recaudado: '75.00',
          },
          donaciones: {
            count: '4',
            confirmadas_count: '3',
            confirmadas_monto: '50.00',
          },
          movimientos_factura: {
            count: '5',
            monto: '20.00',
          },
        },
      });
      expect(countsSql).toContain('"information_schema"."tables"');
      expect(countsSql).toContain("table_type = 'BASE TABLE'");
      expect(countsSql).toContain("table_schema || '.' || table_name");
      expect(countsSql).toContain('count(*)');
      expect(countsSql).toContain('public.facturas');
      expect(countsSql).toContain('monto_requerido');
      expect(countsSql).toContain('monto_recaudado');
      expect(countsSql).toContain('confirmadas_monto');
      expect(countsSql).toContain(FINANCIAL_TOTALS_QUERY);
      expect(countsSql).not.toContain('nombre_donante');
      expect(JSON.parse(readFileSync(join(paths.root, 'run.json'), 'utf8')).commandVersions).toEqual({
        pg_dump: 'pg_dump (PostgreSQL) 16.1',
        psql: 'psql (PostgreSQL) 16.1',
      });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('preserves long financial numeric lexemes without Number rounding', async () => {
    const paths = createPostgresPaths();
    const longDecimal = '12345678901234567890.12345678901234567890';
    const countOutput = [
      JSON.stringify({ relation: 'public.facturas', count: 1 }),
      `{"facturas":{"count":1,"abiertas":1,"monto_requerido":${longDecimal},"monto_recaudado":0},"donaciones":{"count":0,"confirmadas_count":0,"confirmadas_monto":0},"movimientos_factura":{"count":0,"monto":0}}`,
    ].join('\n');

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });
      await exportPostgres(config, paths, fakePostgresRunner([], countOutput));

      const financial = JSON.parse(readFileSync(join(paths.reconciliation, 'financial-totals.json'), 'utf8'));

      expect(financial.totals.facturas.monto_requerido).toBe(longDecimal);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('quotes PostgreSQL identifiers without allowing embedded SQL', () => {
    expect(quoteIdentifier('column"name')).toBe('"column""name"');
    expect(quoteIdentifier('public')).toBe('"public"');
    expect(() => quoteIdentifier('bad\0name')).toThrow(/identifier/i);
  });

  it.each([
    ['empty stdout', ''],
    ['invalid JSON line', 'not-json'],
    ['unknown JSON record', JSON.stringify({ unexpected: true })],
    ['missing relation', JSON.stringify(completeFinancialTotals())],
    ['duplicate relation', [
      JSON.stringify({ relation: 'public.facturas', count: '1' }),
      JSON.stringify({ relation: 'public.facturas', count: '1' }),
      JSON.stringify(completeFinancialTotals()),
    ].join('\n')],
    ['duplicate financial block', [
      JSON.stringify({ relation: 'public.facturas', count: '1' }),
      JSON.stringify(completeFinancialTotals()),
      JSON.stringify(completeFinancialTotals()),
    ].join('\n')],
    ['incomplete financial block', [
      JSON.stringify({ relation: 'public.facturas', count: '1' }),
      JSON.stringify({
        ...completeFinancialTotals(),
        facturas: { ...completeFinancialTotals().facturas, monto_recaudado: undefined },
      }),
    ].join('\n')],
    ['invalid decimal financial value', [
      JSON.stringify({ relation: 'public.facturas', count: '1' }),
      JSON.stringify({
        ...completeFinancialTotals(),
        facturas: { ...completeFinancialTotals().facturas, monto_requerido: '1.2.3' },
      }),
    ].join('\n')],
  ])('rejects incomplete or unsafe count output: %s', async (_name, stdout) => {
    const paths = createPostgresPaths();
    const calls = [];

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });

      await expect(exportPostgres(config, paths, fakePostgresRunner(calls, stdout))).rejects.toThrow();
      expect(existsSync(join(paths.postgres, 'object-counts.json'))).toBe(false);
      expect(existsSync(join(paths.reconciliation, 'financial-totals.json'))).toBe(false);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects a non-zero PostgreSQL command and stops before later exports', async () => {
    const paths = createPostgresPaths();
    const calls = [];
    let dumpCalls = 0;
    const runner = async (command, args) => {
      calls.push({ command, args });
      if (args.includes('--version')) return { code: 0, stdout: `${command} (PostgreSQL) 16.1\n`, stderr: '' };
      if (command === 'pg_dump') {
        dumpCalls += 1;
        if (dumpCalls === 1) return { code: 7, stdout: '', stderr: 'remote detail must not escape' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    try {
      const config = readExportConfig(completeExportEnv(), 'F:/repo', { mode: 'execute' });

      await expect(exportPostgres(config, paths, runner)).rejects.toMatchObject({ code: 'COMMAND_EXIT' });
      expect(calls.some(({ command, args }) => command === 'psql' && args[0] === '--set=ON_ERROR_STOP=1')).toBe(false);
      expect(calls.some(({ args }) => args.join(' ').includes('remote detail'))).toBe(false);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe('Supabase Storage export', () => {
  it('discovers every bucket, paginates objects, recurses folders and writes hashed manifest rows', async () => {
    const paths = createStoragePaths();
    const calls = [];
    const files = {
      'alpha/top.txt': Buffer.from('alpha top'),
      'alpha/folder/child.txt': Buffer.from('alpha child'),
      'beta/report.csv': Buffer.from('beta report'),
    };

    const fetchImpl = async (url, options = {}) => {
      const parsed = new URL(url);
      calls.push({ url, options });

      if (parsed.pathname === '/storage/v1/bucket') {
        const offset = Number(parsed.searchParams.get('offset'));
        return fakeStorageResponse({
          body: offset === 0
            ? [{ id: 'alpha', name: 'alpha' }, { id: 'beta', name: 'beta' }]
            : [{ id: 'gamma', name: 'gamma' }],
        });
      }

      if (parsed.pathname.startsWith('/storage/v1/object/list/')) {
        expect(options.method).toBe('POST');
        expect(options.headers).toMatchObject({
          apikey: 'placeholder-service-key',
          Authorization: 'Bearer placeholder-service-key',
          'Content-Type': 'application/json',
        });
        const bucket = decodeURIComponent(parsed.pathname.split('/').pop());
        const request = JSON.parse(options.body);
        if (bucket === 'alpha' && request.prefix === '') {
          return fakeStorageResponse({
            body: request.offset === 0
              ? [
                { name: 'folder', id: null, metadata: null },
                { name: 'top.txt', id: 'alpha-top', metadata: { mimetype: 'text/plain' } },
              ]
              : [],
          });
        }
        if (bucket === 'alpha' && request.prefix === 'folder') {
          return fakeStorageResponse({
            body: [{ name: 'child.txt', id: 'alpha-child', metadata: { mimetype: 'text/plain' } }],
          });
        }
        if (bucket === 'beta' && request.prefix === '') {
          return fakeStorageResponse({
            body: [{ name: 'report.csv', id: 'beta-report', metadata: { mimetype: 'text/csv' } }],
          });
        }
        if (bucket === 'gamma' && request.prefix === '') {
          return fakeStorageResponse({ body: [] });
        }
        throw new Error('unexpected list fixture');
      }

      if (parsed.pathname.startsWith('/storage/v1/object/authenticated/')) {
        const encoded = parsed.pathname.split('/storage/v1/object/authenticated/')[1];
        const [bucket, ...encodedPath] = encoded.split('/');
        const objectPath = [bucket, ...encodedPath].map((part) => decodeURIComponent(part)).join('/');
        return fakeStorageResponse({ stream: Readable.from([files[objectPath]]) });
      }

      throw new Error('unexpected Storage endpoint');
    };

    try {
      const evidence = await exportStorage(storageConfig(), paths, fetchImpl);
      const manifest = readFileSync(evidence.manifestFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(evidence).toEqual({
        manifestFile: join(paths.storage, 'manifest.jsonl'),
        objectCount: 3,
        bucketCount: 3,
      });
      expect(JSON.parse(readFileSync(join(paths.storage, 'buckets.json'), 'utf8'))).toEqual({
        buckets: ['alpha', 'beta', 'gamma'],
      });
      expect(manifest).toEqual(expect.arrayContaining([
        { bucket: 'alpha', path: 'top.txt', bytes: 9, mime: 'text/plain', sha256: sha256(files['alpha/top.txt']) },
        { bucket: 'alpha', path: 'folder/child.txt', bytes: 11, mime: 'text/plain', sha256: sha256(files['alpha/folder/child.txt']) },
        { bucket: 'beta', path: 'report.csv', bytes: 11, mime: 'text/csv', sha256: sha256(files['beta/report.csv']) },
      ]));
      expect(existsSync(join(paths.storage, 'objects', 'alpha', 'top.txt'))).toBe(true);
      expect(existsSync(join(paths.storage, 'objects', 'alpha', 'folder', 'child.txt'))).toBe(true);
      expect(existsSync(join(paths.storage, 'objects', 'beta', 'report.csv'))).toBe(true);
      expect(calls.filter(({ url }) => url.includes('/storage/v1/object/list/'))).toHaveLength(5);
      expect(calls.filter(({ url }) => url.includes('/storage/v1/object/authenticated/'))).toHaveLength(3);
      expect(calls.filter(({ url }) => url.includes('/storage/v1/bucket'))).toHaveLength(2);
      expect(calls.every(({ options }) => JSON.stringify(options).includes('placeholder-service-key'))).toBe(true);
      expect(readFileSync(evidence.manifestFile, 'utf8')).not.toContain('placeholder-service-key');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['absolute object path', '/absolute.txt'],
    ['parent object path', '../escape.txt'],
    ['backslash traversal', 'nested\\escape.txt'],
    ['parent traversal in nested path', 'nested/../escape.txt'],
    ['ambiguous dot path', './escape.txt'],
  ])('rejects %s without publishing a manifest', async (_name, objectPath) => {
    const paths = createStoragePaths();
    const fetchImpl = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (parsed.pathname.includes('/object/list/')) {
        const request = JSON.parse(options.body);
        return fakeStorageResponse({
          body: request.prefix === ''
            ? [{ name: objectPath, id: 'object-id', metadata: { mimetype: 'text/plain' } }]
            : [],
        });
      }
      throw new Error('download must not run');
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/path|safe|storage/i);
      expect(existsSync(join(paths.storage, 'manifest.jsonl'))).toBe(false);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['parent bucket name', '../bucket'],
    ['bucket separator', 'bucket/name'],
    ['Windows absolute bucket name', 'C:/bucket'],
  ])('rejects %s before creating Storage object output', async (_name, bucketName) => {
    const paths = createStoragePaths();
    const config = storageConfig();

    try {
      await expect(exportStorage(config, paths, async () => fakeStorageResponse({
        body: [{ id: bucketName, name: bucketName }],
      }))).rejects.toThrow(/bucket|path|safe/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects repeated bucket pages and object pages before publishing evidence', async () => {
    const bucketPaths = createStoragePaths();
    let bucketCalls = 0;
    const repeatedBucketFetch = async (url) => {
      if (new URL(url).pathname !== '/storage/v1/bucket') throw new Error('object listing must not run');
      bucketCalls += 1;
      return fakeStorageResponse({
        body: bucketCalls === 1
          ? [{ id: 'bucket-a', name: 'bucket-a' }, { id: 'bucket-b', name: 'bucket-b' }]
          : [{ id: 'bucket-b', name: 'bucket-b' }],
      });
    };

    try {
      await expect(exportStorage(storageConfig(), bucketPaths, repeatedBucketFetch)).rejects.toThrow(/repeated|overlap/i);
      expect(existsSync(join(bucketPaths.storage, 'manifest.jsonl'))).toBe(false);
    } finally {
      rmSync(bucketPaths.root, { recursive: true, force: true });
    }

    const objectPaths = createStoragePaths();
    let objectCalls = 0;
    const repeatedObjectFetch = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'bucket-a', name: 'bucket-a' }] });
      }
      if (pathname.includes('/object/list/')) {
        objectCalls += 1;
        return fakeStorageResponse({
          body: objectCalls === 1
            ? [
              { name: 'a.txt', id: 'a', metadata: { mimetype: 'text/plain' } },
              { name: 'b.txt', id: 'b', metadata: { mimetype: 'text/plain' } },
            ]
            : [{ name: 'b.txt', id: 'b', metadata: { mimetype: 'text/plain' } }],
        });
      }
      throw new Error(`download must not run: ${options.method}`);
    };

    try {
      await expect(exportStorage(storageConfig(), objectPaths, repeatedObjectFetch)).rejects.toThrow(/repeated|overlap/i);
      expect(existsSync(join(objectPaths.storage, 'manifest.jsonl'))).toBe(false);
    } finally {
      rmSync(objectPaths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['wrong project', { projectRef: 'another-project' }],
    ['wrong origin', { supabaseUrl: 'https://attacker.example.test' }],
    ['dry-run mode', { mode: 'dry-run' }],
  ])('rejects %s before reading the Storage service key', async (_name, overrides) => {
    const paths = createStoragePaths();
    const config = storageConfig(overrides);
    Object.defineProperty(config, 'serviceRoleKey', {
      configurable: true,
      get() {
        throw new Error('service key was read');
      },
    });

    try {
      await expect(exportStorage(config, paths, async () => {
        throw new Error('fetch must not run');
      })).rejects.toThrow(/project|origin|execute|mode/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('does not retry a non-network fetch exception', async () => {
    const paths = createStoragePaths();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error('programming failure with secret detail');
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/request failed/i);
      expect(calls).toBe(1);
      expect(existsSync(join(paths.storage, 'manifest.jsonl'))).toBe(false);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('retries a list JSON body network failure once through a nested cause code', async () => {
    const paths = createStoragePaths();
    let bucketCalls = 0;
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        bucketCalls += 1;
        const response = fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
        if (bucketCalls === 1) {
          response.json = async () => {
            throw Object.assign(new Error('body network detail'), { cause: { code: 'ECONNRESET' } });
          };
        }
        return response;
      }
      return fakeStorageResponse({ body: [] });
    };

    try {
      const evidence = await exportStorage(storageConfig(), paths, fetchImpl);
      expect(evidence).toMatchObject({ bucketCount: 1, objectCount: 0 });
      expect(bucketCalls).toBe(2);
      expect(readFileSync(join(paths.storage, 'error-report.json'), 'utf8')).not.toContain('body network detail');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('does not retry invalid list JSON', async () => {
    const paths = createStoragePaths();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const response = fakeStorageResponse({ body: [] });
      response.json = async () => {
        throw new SyntaxError('invalid remote JSON');
      };
      return response;
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/JSON is invalid/i);
      expect(calls).toBe(1);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('retries one transient download and records no response body or headers in the manifest', async () => {
    const paths = createStoragePaths();
    let downloadCalls = 0;
    const fetchImpl = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (parsed.pathname.includes('/object/list/')) {
        return fakeStorageResponse({ body: [{ name: 'file.txt', id: 'object-id', metadata: { mimetype: 'text/plain' } }] });
      }
      if (parsed.pathname.includes('/object/authenticated/')) {
        downloadCalls += 1;
        if (downloadCalls === 1) {
          return fakeStorageResponse({ status: 503, body: { error: 'remote body must not escape' } });
        }
        expect(options.headers.Authorization).toBe('Bearer placeholder-service-key');
        return fakeStorageResponse({
          stream: Readable.from([Buffer.from('payload-secret')]),
          contentType: 'secret-header-value',
        });
      }
      throw new Error('unexpected Storage endpoint');
    };

    try {
      const evidence = await exportStorage(storageConfig(), paths, fetchImpl);
      const manifest = readFileSync(evidence.manifestFile, 'utf8');
      expect(downloadCalls).toBe(2);
      expect(manifest).toContain('"bytes":14');
      expect(manifest).not.toContain('payload-secret');
      expect(manifest).not.toContain('secret-header-value');
      expect(manifest).not.toContain('remote body must not escape');
      expect(JSON.parse(readFileSync(join(paths.storage, 'error-report.json'), 'utf8'))).toEqual({
        errors: expect.arrayContaining([
          { operation: 'download', retries: 1, status: 503 },
        ]),
      });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('retries one network failure without exposing the thrown error', async () => {
    const paths = createStoragePaths();
    let downloadCalls = 0;
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (pathname.includes('/object/list/')) {
        return fakeStorageResponse({ body: [{ name: 'file.txt', id: 'object-id', metadata: { mimetype: 'text/plain' } }] });
      }
      downloadCalls += 1;
      if (downloadCalls === 1) {
        throw Object.assign(new Error('network PII and key must not escape'), { code: 'ECONNRESET' });
      }
      return fakeStorageResponse({ stream: Readable.from([Buffer.from('network-retry')]) });
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).resolves.toMatchObject({ objectCount: 1 });
      expect(downloadCalls).toBe(2);
      expect(readFileSync(join(paths.storage, 'error-report.json'), 'utf8')).toContain('"status":"network"');
      expect(readFileSync(join(paths.storage, 'error-report.json'), 'utf8')).not.toContain('network PII');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('retries a streamed body failure when its nested cause is a network code', async () => {
    const paths = createStoragePaths();
    let downloadCalls = 0;
    async function* failingBody() {
      yield Buffer.from('partial');
      throw Object.assign(new Error('stream network detail'), { cause: { code: 'ECONNRESET' } });
    }
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (pathname.includes('/object/list/')) {
        return fakeStorageResponse({ body: [{ name: 'file.txt', id: 'object-id', metadata: { mimetype: 'text/plain' } }] });
      }
      downloadCalls += 1;
      return fakeStorageResponse({
        stream: downloadCalls === 1 ? Readable.from(failingBody()) : Readable.from([Buffer.from('retry-success')]),
      });
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).resolves.toMatchObject({ objectCount: 1 });
      expect(downloadCalls).toBe(2);
      expect(readFileSync(join(paths.storage, 'manifest.jsonl'), 'utf8')).not.toContain('stream network detail');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('fails after one transient retry and leaves no successful manifest', async () => {
    const paths = createStoragePaths();
    let downloadCalls = 0;
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (pathname.includes('/object/list/')) {
        return fakeStorageResponse({ body: [{ name: 'file.txt', id: 'object-id', metadata: { mimetype: 'text/plain' } }] });
      }
      downloadCalls += 1;
      return fakeStorageResponse({ status: 503, body: { error: 'must not escape' } });
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/HTTP status 503/);
      expect(downloadCalls).toBe(2);
      expect(existsSync(join(paths.storage, 'manifest.jsonl'))).toBe(false);
      expect(existsSync(join(paths.storage, 'objects', 'safe-bucket', 'file.txt'))).toBe(false);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rolls back every object already published when a later object fails', async () => {
    const paths = createStoragePaths();
    let downloadCalls = 0;
    const fetchImpl = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (pathname.includes('/object/list/')) {
        const request = JSON.parse(options.body);
        return fakeStorageResponse({
          body: request.offset === 0
            ? [
              { name: 'first.txt', id: 'first', metadata: { mimetype: 'text/plain' } },
              { name: 'second.txt', id: 'second', metadata: { mimetype: 'text/plain' } },
            ]
            : [],
        });
      }
      downloadCalls += 1;
      if (downloadCalls === 1) return fakeStorageResponse({ stream: Readable.from([Buffer.from('first')]) });
      return fakeStorageResponse({ status: 503, body: { error: 'later failure body' } });
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/HTTP status 503/);
      expect(existsSync(join(paths.storage, 'objects', 'safe-bucket', 'first.txt'))).toBe(false);
      expect(existsSync(join(paths.storage, 'objects', 'safe-bucket', 'second.txt'))).toBe(false);
      expect(existsSync(join(paths.storage, 'manifest.jsonl'))).toBe(false);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('removes a partial streamed object and never publishes its manifest row', async () => {
    const paths = createStoragePaths();
    async function* partialBody() {
      yield Buffer.from('partial-data');
      throw new Error('remote PII must not escape');
    }
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/storage/v1/bucket') {
        return fakeStorageResponse({ body: [{ id: 'safe-bucket', name: 'safe-bucket' }] });
      }
      if (pathname.includes('/object/list/')) {
        return fakeStorageResponse({ body: [{ name: 'file.txt', id: 'object-id', metadata: { mimetype: 'text/plain' } }] });
      }
      return fakeStorageResponse({ stream: Readable.from(partialBody()) });
    };

    try {
      await expect(exportStorage(storageConfig(), paths, fetchImpl)).rejects.toThrow(/download|stream|Storage/i);
      expect(existsSync(join(paths.storage, 'manifest.jsonl'))).toBe(false);
      expect(existsSync(join(paths.storage, 'objects', 'safe-bucket', 'file.txt'))).toBe(false);
      expect(readdirSync(paths.temp)).toEqual([]);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe('Task 6 reconciliation, sealing and verification', () => {
  function createTask6Paths() {
    const root = mkdtempSync(join(tmpdir(), 'export-task6-'));
    const paths = {
      root,
      postgres: join(root, 'postgres'),
      auth: join(root, 'auth'),
      storage: join(root, 'storage'),
      reconciliation: join(root, 'reconciliation'),
      temp: join(root, 'temp'),
    };
    for (const path of Object.values(paths).slice(1)) mkdirSync(path);
    return paths;
  }

  function seedTask6Artifacts(paths) {
    writeFileSync(join(paths.postgres, 'schema.sql'), 'create table public.facturas (id integer);\n');
    writeFileSync(join(paths.postgres, 'data.dump'), 'custom dump fixture\n');
    writeFileSync(join(paths.postgres, 'object-counts.json'), JSON.stringify({
      schema: 'public',
      tableCount: 1,
      tables: [{ relation: 'public.facturas', count: 2 }],
    }));
    writeFileSync(join(paths.auth, 'users.json'), JSON.stringify([{ id: 'user-1', email: 'redacted@example.test' }]));
    writeFileSync(join(paths.auth, 'metadata.json'), JSON.stringify({ count: 1, pages: 1 }));
    writeFileSync(join(paths.storage, 'manifest.jsonl'), JSON.stringify({
      bucket: 'private',
      path: 'evidence.txt',
      bytes: 8,
      mime: 'text/plain',
      sha256: sha256('evidence'),
    }) + '\n');
    writeFileSync(join(paths.storage, 'buckets.json'), JSON.stringify({ buckets: ['private'] }));
    mkdirSync(join(paths.storage, 'objects', 'private'), { recursive: true });
    writeFileSync(join(paths.storage, 'objects', 'private', 'evidence.txt'), 'evidence');
  }

  function task6ArchivePath(paths) {
    return join(paths.root, '..', `${basename(paths.root)}.tar.age`);
  }

  function refreshTask6Checksum(paths, relativePath) {
    const artifactPath = join(paths.root, ...relativePath.split('/'));
    const checksumPath = join(paths.root, 'checksums.sha256');
    const digest = sha256(readFileSync(artifactPath));
    const lines = readFileSync(checksumPath, 'utf8').trim().split('\n');
    const lineIndex = lines.findIndex((line) => line.endsWith(`  ${relativePath}`));
    if (lineIndex < 0) throw new Error(`Checksum entry not found: ${relativePath}`);
    lines[lineIndex] = `${digest}  ${relativePath}`;
    writeFileSync(checksumPath, `${lines.join('\n')}\n`);
  }

  function addTask6Artifact(paths, relativePath) {
    const runPath = join(paths.root, 'run.json');
    const run = JSON.parse(readFileSync(runPath, 'utf8'));
    run.artifacts = [...new Set([...run.artifacts, relativePath])].sort();
    writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);

    const checksumPath = join(paths.root, 'checksums.sha256');
    const lines = readFileSync(checksumPath, 'utf8').trim().split('\n')
      .filter((line) => !line.endsWith(`  ${relativePath}`) && !line.endsWith('  run.json'));
    lines.push(`${sha256(readFileSync(join(paths.root, ...relativePath.split('/'))))}  ${relativePath}`);
    lines.push(`${sha256(readFileSync(runPath))}  run.json`);
    lines.sort((left, right) => left.slice(66).localeCompare(right.slice(66)));
    writeFileSync(checksumPath, `${lines.join('\n')}\n`);
  }

  function completeTask6Evidence(paths, overrides = {}) {
    return {
      projectRef: EXPECTED_PROJECT_REF,
      commandVersions: {
        pg_dump: 'pg_dump (PostgreSQL) 16.1',
        psql: 'psql (PostgreSQL) 16.1',
        tar: 'tar 1.35',
        age: 'age 1.2.0',
      },
      postgres: {
        schemaFile: join(paths.postgres, 'schema.sql'),
        dataFile: join(paths.postgres, 'data.dump'),
        countsFile: join(paths.postgres, 'object-counts.json'),
        tableCount: 1,
        financialTotals: {
          facturas: {
            count: '2',
            abiertas: '1',
            monto_requerido: '100.00',
            monto_recaudado: '75.00',
          },
          donaciones: {
            count: '3',
            confirmadas_count: '2',
            confirmadas_monto: '50.00',
          },
          movimientos_factura: {
            count: '4',
            monto: '25.00',
          },
        },
      },
      auth: {
        usersFile: join(paths.auth, 'users.json'),
        userCount: 1,
        pages: 1,
      },
      storage: {
        manifestFile: join(paths.storage, 'manifest.jsonl'),
        objectCount: 1,
        bucketCount: 1,
      },
      rpcSamples: [
        {
          name: 'estadisticas',
          status: 'ok',
          output: {
            total: 4,
            label: 'safe-value-must-not-be-written',
            buscar_familiar: [{ email: 'private-person@example.test' }],
          },
          raw: 'rpc-secret-value',
        },
        {
          name: 'seguimiento_factura',
          status: 'error',
          output: { error: 'redacted-error' },
        },
        {
          name: 'seguimiento_donaciones',
          status: 'ok',
          output: { confirmed: true },
        },
        {
          name: 'buscar_familiar',
          status: 'ok',
          output: { person: 'must-never-be-stored' },
        },
      ],
      secretValues: ['rpc-secret-value', 'service-role-secret', 'age-recipient-secret'],
      now: '2026-08-06T12:00:00.000Z',
      ...overrides,
    };
  }

  async function createCompleteTask6Run() {
    const paths = createTask6Paths();
    seedTask6Artifacts(paths);
    await writeRunManifest(paths, completeTask6Evidence(paths));
    return paths;
  }

  it('writes complete reconciliation metadata and checksums every final artifact except itself', async () => {
    const paths = createTask6Paths();

    try {
      seedTask6Artifacts(paths);
      await writeRunManifest(paths, completeTask6Evidence(paths));

      const run = JSON.parse(readFileSync(join(paths.root, 'run.json'), 'utf8'));
      const checksums = readFileSync(join(paths.root, 'checksums.sha256'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('  ')[1]);
      const sourceCounts = JSON.parse(readFileSync(join(paths.reconciliation, 'source-counts.json'), 'utf8'));
      const financialTotals = JSON.parse(readFileSync(join(paths.reconciliation, 'financial-totals.json'), 'utf8'));
      const rpcSamples = JSON.parse(readFileSync(join(paths.reconciliation, 'rpc-samples.json'), 'utf8'));

      expect(run).toMatchObject({
        projectRef: EXPECTED_PROJECT_REF,
        status: 'completed',
        counts: {
          postgres: { tableCount: 1 },
          auth: { userCount: 1 },
          storage: { bucketCount: 1, objectCount: 1 },
        },
      });
      expect(run.createdAt).toBe('2026-08-06T12:00:00.000Z');
      expect(run.updatedAt).toBe('2026-08-06T12:00:00.000Z');
      expect(run.artifacts).toEqual(expect.arrayContaining([
        'run.json',
        'postgres/schema.sql',
        'postgres/data.dump',
        'auth/users.json',
        'storage/objects/private/evidence.txt',
        'reconciliation/source-counts.json',
        'reconciliation/financial-totals.json',
        'reconciliation/rpc-samples.json',
      ]));
      expect(checksums).not.toContain('checksums.sha256');
      expect(checksums).toEqual([...checksums].sort());
      expect(checksums).toEqual(expect.arrayContaining(run.artifacts));
      expect(sourceCounts).toEqual({
        postgres: { tableCount: 1, tables: [{ relation: 'public.facturas', count: 2 }] },
        auth: { userCount: 1 },
        storage: { bucketCount: 1, objectCount: 1 },
      });
      expect(financialTotals).toMatchObject({
        query: 'financial_totals',
        totals: completeTask6Evidence(paths).postgres.financialTotals,
      });
      expect(JSON.stringify(financialTotals)).not.toContain('redacted@example.test');
      expect(rpcSamples).toEqual([
        {
          name: 'estadisticas',
          status: 'ok',
          outputKeys: ['label', 'total'],
          primitiveTypes: { label: 'string', total: 'number' },
        },
        {
          name: 'seguimiento_factura',
          status: 'error',
          outputKeys: ['error'],
          primitiveTypes: { error: 'string' },
        },
        {
          name: 'seguimiento_donaciones',
          status: 'ok',
          outputKeys: ['confirmed'],
          primitiveTypes: { confirmed: 'boolean' },
        },
      ]);
      expect(JSON.stringify(rpcSamples)).not.toContain('buscar_familiar');
      expect(JSON.stringify(rpcSamples)).not.toContain('rpc-secret-value');

      await expect(verifyRun(paths.root, { requireArchive: false })).resolves.toMatchObject({ ok: true });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('detects a one-byte tamper through the independent checksum verification', async () => {
    const paths = await createCompleteTask6Run();

    try {
      writeFileSync(join(paths.postgres, 'schema.sql'), 'xreate table public.facturas (id integer);\n');

      const report = await verifyRun(paths.root);

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(false);
      expect(report.errors.join('\n')).toMatch(/checksum|hash|integrity/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects a complete CLI verification when the derived encrypted archive is absent', async () => {
    const paths = await createCompleteTask6Run();
    const output = [];

    try {
      const code = await verifyMain(
        ['--run-dir', paths.root],
        process.env,
        {
          log: (message) => output.push(message),
          error: (message) => output.push(message),
        },
      );

      expect(code).toBe(1);
      expect(output.join('\n')).toContain('archive');
      expect(existsSync(task6ArchivePath(paths))).toBe(false);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
      rmSync(task6ArchivePath(paths), { force: true });
    }
  });

  it('rejects Auth metadata mismatches even when the changed artifact checksum is refreshed', async () => {
    const paths = await createCompleteTask6Run();

    try {
      const users = JSON.parse(readFileSync(join(paths.auth, 'users.json'), 'utf8'));
      users.push({ id: 'user-2', email: 'second@example.test' });
      writeFileSync(join(paths.auth, 'users.json'), JSON.stringify(users));
      refreshTask6Checksum(paths, 'auth/users.json');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.checks.reconciliation).toBe(false);
      expect(report.errors.join('\n')).toMatch(/Auth|user|metadata|count/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects a truncated Storage manifest with coherent checksums', async () => {
    const paths = await createCompleteTask6Run();

    try {
      writeFileSync(join(paths.storage, 'manifest.jsonl'), '');
      refreshTask6Checksum(paths, 'storage/manifest.jsonl');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.checks.reconciliation).toBe(false);
      expect(report.errors.join('\n')).toMatch(/Storage|manifest|object/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects Storage manifest traversal and byte/hash mismatches', async () => {
    const paths = await createCompleteTask6Run();

    try {
      writeFileSync(join(paths.storage, 'manifest.jsonl'), `${JSON.stringify({
        bucket: 'private',
        path: '../escape.txt',
        bytes: 999,
        mime: 'text/plain',
        sha256: sha256('wrong'),
      })}\n`);
      refreshTask6Checksum(paths, 'storage/manifest.jsonl');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.checks.reconciliation).toBe(false);
      expect(report.errors.join('\n')).toMatch(/path|object|hash|bytes|Storage/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects PostgreSQL relation count mismatches with coherent checksums', async () => {
    const paths = await createCompleteTask6Run();

    try {
      const objectCounts = JSON.parse(readFileSync(join(paths.postgres, 'object-counts.json'), 'utf8'));
      objectCounts.tables[0].count = 3;
      writeFileSync(join(paths.postgres, 'object-counts.json'), JSON.stringify(objectCounts));
      refreshTask6Checksum(paths, 'postgres/object-counts.json');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.checks.reconciliation).toBe(false);
      expect(report.errors.join('\n')).toMatch(/PostgreSQL|relation|count/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects an orphan physical Storage object even when manifest and checksums include it', async () => {
    const paths = await createCompleteTask6Run();

    try {
      const orphanPath = join(paths.storage, 'objects', 'private', 'orphan.txt');
      writeFileSync(orphanPath, 'orphan');
      addTask6Artifact(paths, 'storage/objects/private/orphan.txt');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.errors.join('\n')).toMatch(/orphan|physical|manifest|object/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('preserves and verifies empty Storage buckets through bucket metadata', async () => {
    const paths = createTask6Paths();

    try {
      seedTask6Artifacts(paths);
      writeFileSync(join(paths.storage, 'buckets.json'), JSON.stringify({ buckets: ['private', 'empty'] }));
      await writeRunManifest(paths, completeTask6Evidence(paths, {
        storage: {
          manifestFile: join(paths.storage, 'manifest.jsonl'),
          objectCount: 1,
          bucketCount: 2,
        },
      }));

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(true);
      expect(report.counts.storage.bucketCount).toBe(2);
      expect(JSON.parse(readFileSync(join(paths.storage, 'buckets.json'), 'utf8'))).toEqual({
        buckets: ['private', 'empty'],
      });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('rejects inconsistent bucket metadata with a refreshed checksum', async () => {
    const paths = await createCompleteTask6Run();

    try {
      writeFileSync(join(paths.storage, 'buckets.json'), JSON.stringify({ buckets: ['empty'] }));
      refreshTask6Checksum(paths, 'storage/buckets.json');

      const report = await verifyRun(paths.root, { requireArchive: false });

      expect(report.ok).toBe(false);
      expect(report.checks.checksums).toBe(true);
      expect(report.checks.reconciliation).toBe(false);
      expect(report.errors.join('\n')).toMatch(/bucket|Storage|metadata|count/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['schema', 'postgres/schema.sql'],
    ['data', 'postgres/data.dump'],
    ['Auth', 'auth/users.json'],
    ['Storage', 'storage/manifest.jsonl'],
  ])('rejects a run with missing %s evidence', async (_label, relativePath) => {
    const paths = await createCompleteTask6Run();

    try {
      rmSync(join(paths.root, relativePath));

      const report = await verifyRun(paths.root);

      expect(report.ok).toBe(false);
      expect(report.checks.completeness).toBe(false);
      expect(report.errors.join('\n')).toMatch(/missing|evidence|artifact/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('refuses to seal empty or failed runs', async () => {
    const emptyPaths = createTask6Paths();
    const failedPaths = createTask6Paths();
    const runner = { runPipeline: async () => { throw new Error('age must not run'); } };

    try {
      writeFileSync(join(emptyPaths.root, 'run.json'), JSON.stringify({ status: 'prepared' }));
      writeFileSync(join(failedPaths.root, 'run.json'), JSON.stringify({ status: 'failed', errorCode: 'EXPORT_FAILED' }));

      await expect(sealRun(emptyPaths, 'age1test', runner)).rejects.toThrow(/complete|empty|prepared/i);
      await expect(sealRun(failedPaths, 'age1test', runner)).rejects.toThrow(/failed|complete/i);
    } finally {
      rmSync(emptyPaths.root, { recursive: true, force: true });
      rmSync(failedPaths.root, { recursive: true, force: true });
    }
  });

  it('seals through the injected streaming runner and removes only its temporary archive', async () => {
    const paths = await createCompleteTask6Run();
    const temporaryArchive = join(paths.temp, 'run.tar');
    const unrelatedTemporaryFile = join(paths.temp, 'keep-for-diagnosis.tmp');
    writeFileSync(temporaryArchive, 'unsealed archive');
    writeFileSync(unrelatedTemporaryFile, 'diagnostic');
    let pipelineSpec;

    try {
      const archivePath = await sealRun(paths, 'age1test', {
        runPipeline: async (spec) => {
          pipelineSpec = spec;
          writeFileSync(spec.archivePath, 'encrypted archive');
          writeFileSync(spec.temporaryArchive, 'unsealed archive');
        },
      });

      expect(archivePath).toBe(join(paths.root, '..', `${basename(paths.root)}.tar.age`));
      expect(existsSync(archivePath)).toBe(true);
      expect(existsSync(temporaryArchive)).toBe(false);
      expect(existsSync(unrelatedTemporaryFile)).toBe(true);
      expect(pipelineSpec.tar.args).toEqual(expect.arrayContaining(['--create', '--directory', paths.root, '--file=-', '.']));
      expect(pipelineSpec.age.args).toEqual(expect.arrayContaining(['--recipient', 'age1test', '--output', archivePath]));
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
      rmSync(join(paths.root, '..', `${basename(paths.root)}.tar.age`), { force: true });
    }
  });

  it('marks a failed age process without deleting the unsealed run or leaking secrets', async () => {
    const paths = await createCompleteTask6Run();
    const secret = 'age-recipient-secret';
    const temporaryArchive = join(paths.temp, 'run.tar');
    writeFileSync(temporaryArchive, 'unsealed archive');

    try {
      let thrown;
      try {
        await sealRun(paths, secret, {
          runPipeline: async () => {
            writeFileSync(task6ArchivePath(paths), 'partial encrypted archive');
            throw Object.assign(new Error(`age failed password=${secret}`), { code: 'COMMAND_EXIT' });
          },
        });
      } catch (error) {
        thrown = error;
      }

      const runText = readFileSync(join(paths.root, 'run.json'), 'utf8');
      const failedRun = JSON.parse(runText);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).not.toContain(secret);
      expect(failedRun).toMatchObject({
        status: 'failed',
        errorCode: 'COMMAND_EXIT',
        projectRef: EXPECTED_PROJECT_REF,
        counts: expect.any(Object),
      });
      expect(failedRun.artifacts).toEqual(expect.arrayContaining(['run.json', 'postgres/schema.sql']));
      expect(runText).not.toContain(secret);
      expect(existsSync(paths.postgres)).toBe(true);
      expect(existsSync(temporaryArchive)).toBe(true);
      expect(existsSync(task6ArchivePath(paths))).toBe(false);
      const runChecksum = readFileSync(join(paths.root, 'checksums.sha256'), 'utf8')
        .split('\n')
        .find((line) => line.endsWith('  run.json'));
      expect(runChecksum).toBe(`${sha256(runText)}  run.json`);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
      rmSync(task6ArchivePath(paths), { force: true });
    }
  });

  it('vetoes restore-db for non-local hosts or the wrong project target before pg_restore', async () => {
    const paths = await createCompleteTask6Run();
    const calls = [];

    try {
      const report = await verifyRun(paths.root, {
        restoreDb: 'postgres://restore:db-password@remote.example.test/demo',
        projectTarget: 'demo-donaciones-venezuela',
        runner: async (...args) => {
          calls.push(args);
          return { code: 0, stdout: '', stderr: '' };
        },
      });

      expect(report.ok).toBe(false);
      expect(calls).toEqual([]);
      expect(report.errors.join('\n')).toMatch(/localhost|127\.0\.0\.1|restore|host/i);
      expect(report.errors.join('\n')).not.toContain('db-password');

      const wrongProject = await verifyRun(paths.root, {
        restoreDb: 'postgres://restore@127.0.0.1/demo',
        projectTarget: 'other-project',
      });
      expect(wrongProject.ok).toBe(false);
      expect(wrongProject.errors.join('\n')).toMatch(/project|target/i);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('restores locally with the dump as the only pg_restore positional input', async () => {
    const paths = await createCompleteTask6Run();
    const calls = [];

    try {
      const report = await verifyRun(paths.root, {
        requireArchive: false,
        restoreDb: 'postgres://restore:db-password@127.0.0.1/demo_restore',
        projectTarget: 'demo-donaciones-venezuela',
        runner: async (...args) => {
          calls.push(args);
          return { code: 0, stdout: '', stderr: '' };
        },
      });

      expect(report.ok).toBe(true);
      expect(report.checks.restore).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('pg_restore');
      expect(calls[0][1]).toEqual(expect.arrayContaining([
        '--dbname', 'demo_restore',
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
      ]));
      expect(calls[0][1]).not.toContain('--file');
      expect(calls[0][1].at(-1)).toBe(join(paths.root, 'postgres', 'data.dump'));
      expect(calls[0][2].env.PGPASSWORD).toBe('db-password');
      expect(calls[0][1].join(' ')).not.toContain('db-password');
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe('runbook documentation', () => {
  it('documents the safe Supabase export gate and repository guardrails', () => {
    const runbook = readFileSync(new URL('../docs/runbooks/export-supabase.md', import.meta.url), 'utf8');
    const backupPlan = readFileSync(new URL('../BACKUP_RESTORE_PLAN.md', import.meta.url), 'utf8');
    const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

    expect(runbook).toContain('zryfwbjvlacorryzdaod');
    expect(runbook).toMatch(/--dry-run[\s\S]*predetermin|predetermin[\s\S]*--dry-run/i);
    expect(runbook).toMatch(/--execute[\s\S]*acci[oó]n\s+remota\s+expl[ií]cita|acci[oó]n\s+remota\s+expl[ií]cita[\s\S]*--execute/i);
    for (const variable of [
      'SUPABASE_PROJECT_REF',
      'SUPABASE_URL',
      'SUPABASE_DB_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'EXPORT_ROOT',
      'EXPORT_AGE_RECIPIENT',
    ]) {
      expect(runbook).toContain(variable);
      expect(runbook).not.toMatch(new RegExp(`${variable}\\s*=\\s*[^\\s]+`));
    }
    expect(runbook).toContain('C:\\\\secure\\\\donaciones-export');
    expect(runbook).toContain('npm.cmd run export:supabase:dry-run');
    expect(runbook).toContain('# detenerse y obtener confirmacion explicita del operador');
    expect(runbook).toContain('npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod');
    expect(runbook).toContain('npm.cmd run verify:export -- --run-dir "C:\\\\secure\\\\donaciones-export\\\\2026-08-06T120000Z"');
    const checkpointIndex = runbook.indexOf('# detenerse y obtener confirmacion explicita del operador');
    const approvalIndex = runbook.indexOf("$env:EXPORT_EXECUTION_APPROVED = 'YES'");
    const executeIndex = runbook.indexOf('npm.cmd run export:supabase -- --execute --project-ref zryfwbjvlacorryzdaod');
    expect(approvalIndex).toBeGreaterThan(checkpointIndex);
    expect(executeIndex).toBeGreaterThan(approvalIndex);

    for (const control of [
      /estructura.*completitud/i,
      /manifest/i,
      /checksum.*tamper|tamper.*checksum/i,
      /reconciliaci[oó]n.*conteo|conteo.*reconciliaci[oó]n/i,
      /archive status/i,
      /localhost.*restore|restore.*localhost/i,
    ]) {
      expect(runbook).toMatch(control);
    }
    expect(runbook).toMatch(/desencript|decrypt/i);
    expect(runbook).toMatch(/evidencia/);
    expect(runbook).toMatch(/checkpoint[\s\S]*inmediatamente antes[\s\S]*--execute/i);
    expect(runbook).toMatch(/agente[\s\S]*(?:no puede|no debe)[\s\S]*ejecutar[\s\S]*--execute/i);
    expect(runbook).toMatch(/no.*producci[oó]n/i);
    expect(runbook).toMatch(/Blaze/);
    expect(runbook).toMatch(/migraci[oó]n destructiva/i);
    expect(runbook).toMatch(/export(?:ar|aci[oó]n).*credencial|credencial.*export/i);
    expect(runbook).toMatch(/restore local.*opcional.*verificaci[oó]n general/i);
    expect(runbook).toMatch(/not-run[\s\S]*motivo|motivo[\s\S]*not-run/i);
    expect(runbook).toMatch(/completed[\s\S]*(?:evidencia local|checksum)[\s\S]*(?:habilita|permite).*sellado/i);
    expect(runbook).toMatch(/archive status[\s\S]*control separado|control separado[\s\S]*archive status/i);
    expect(runbook).toMatch(/temp\/run\.tar[\s\S]*solo\s+se\s+elimina[\s\S]*sellado\s+exitoso/i);
    expect(runbook).toMatch(/temp\/[\s\S]*(?:fuera|excluid)[\s\S]*(?:artifacts|artefactos)/i);
    expect(runbook).toMatch(/temporales\s+diagn[oó]sticos[\s\S]*(?:conservar|preserv)/i);

    expect(backupPlan).toContain('docs/runbooks/export-supabase.md');
    expect(backupPlan).toMatch(/plan escrito.*(?:no equivale|no es igual).*gate/i);
    expect(backupPlan).toMatch(/manifest.*checksum.*evidencia/i);
    expect(backupPlan).toMatch(/Gate previo a T06[\s\S]*restore local[\s\S]*(?:requisito|requerido|obligatorio)/i);

    for (const entry of [
      'backups/',
      'exports/',
      '*.dump',
      '*.age',
      '/exports/**/*.jsonl',
      '/exports/**/*.sql',
      'credentials.json',
      'token.json',
      'oauth.json',
      'service-account.json',
    ]) {
      expect(gitignore).toContain(entry);
    }
  });
});

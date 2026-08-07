import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOutputRoot,
  buildPostgresInvocation,
  cleanupFailedRun,
  createRunDirectory,
  markRunFailed,
  parsePostgresConnection,
  readExportConfig,
  runCommand,
} from '../scripts/export-supabase-lib.mjs';
import { formatDryRunSummary, main, parseCliArgs } from '../scripts/export-supabase.mjs';

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
    }, 'F:/repo', { mode: 'execute' })).toThrow(/SUPABASE_URL/);
  });

  it('rejects invalid database URLs without echoing their contents', () => {
    expect(() => readExportConfig({
      SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
      SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
      SUPABASE_DB_URL: 'not-a-postgres-url-password',
    }, 'F:/repo', { mode: 'execute' })).toThrowError(/database|postgres/i);

    try {
      readExportConfig({
        SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
        SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
        SUPABASE_DB_URL: 'not-a-postgres-url-password',
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

  it('prepares execute staging without invoking export or sealing commands', async () => {
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
          runner: (...args) => {
            calls.push(args);
            throw new Error('execute attempted a command before later task');
          },
          fetchImpl: () => { throw new Error('execute attempted fetch before later task'); },
          now: '2026-08-06T12:00:00.000Z',
        },
      );

      expect(code).toBe(0);
      expect(calls).toEqual([]);
      expect(readdirSync(outputRoot)).toEqual(['2026-08-06T120000Z']);
      expect(JSON.parse(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'run.json'), 'utf8'))).toMatchObject({
        status: 'prepared',
      });
      expect(output.join('\n')).toContain('prepared');
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

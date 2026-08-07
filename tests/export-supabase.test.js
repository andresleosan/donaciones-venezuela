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
  exportPostgres,
  markRunFailed,
  parsePostgresConnection,
  quoteIdentifier,
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
          fetchImpl: () => { throw new Error('execute attempted fetch before later task'); },
          now: '2026-08-06T12:00:00.000Z',
        },
      );

      expect(code).toBe(0);
      expect(calls).toHaveLength(5);
      expect(calls.filter(([command, commandArgs]) => command === 'pg_dump' && !commandArgs.includes('--version'))).toHaveLength(2);
      expect(calls.filter(([command, commandArgs]) => command === 'psql' && !commandArgs.includes('--version'))).toHaveLength(1);
      expect(readdirSync(outputRoot)).toEqual(['2026-08-06T120000Z']);
      expect(JSON.parse(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'run.json'), 'utf8'))).toMatchObject({
        status: 'prepared',
      });
      expect(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'schema.sql'), 'utf8')).toBe('schema fixture');
      expect(readFileSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'data.dump'), 'utf8')).toBe('data fixture');
      expect(existsSync(join(outputRoot, '2026-08-06T120000Z', 'postgres', 'object-counts.json'))).toBe(true);
      expect(output.join('\n')).toContain('PostgreSQL export prepared');
      expect(output.join('\n')).not.toContain('completed');
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
      expect(countsSql).toContain('"public"."facturas"');
      expect(countsSql).toContain('monto_requerido');
      expect(countsSql).toContain('monto_recaudado');
      expect(countsSql).toContain('confirmadas_monto');
      expect(countsSql).toMatch(/'count', \(select count\(\*\)::text/);
      expect(countsSql).toContain('coalesce(sum(monto_requerido), 0)::text');
      expect(countsSql).toContain('coalesce(sum(monto_recaudado), 0)::text');
      expect(countsSql).toContain('coalesce(sum(monto), 0)::text');
      expect(countsSql).not.toContain('nombre_donante');
      expect(JSON.parse(readFileSync(join(paths.root, 'run.json'), 'utf8')).commandVersions).toEqual({
        pg_dump: 'pg_dump (PostgreSQL) 16.1',
        psql: 'psql (PostgreSQL) 16.1',
      });
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

import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeOutputRoot, readExportConfig } from '../scripts/export-supabase-lib.mjs';
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

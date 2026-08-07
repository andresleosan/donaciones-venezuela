import { describe, expect, it } from 'vitest';
import { assertSafeOutputRoot, readExportConfig } from '../scripts/export-supabase-lib.mjs';
import { formatDryRunSummary, parseCliArgs } from '../scripts/export-supabase.mjs';

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
    }, 'F:/repo')).toThrowError(/database|postgres/i);

    try {
      readExportConfig({
        SUPABASE_PROJECT_REF: 'zryfwbjvlacorryzdaod',
        SUPABASE_URL: 'https://zryfwbjvlacorryzdaod.supabase.co',
        SUPABASE_DB_URL: 'not-a-postgres-url-password',
      }, 'F:/repo');
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
});

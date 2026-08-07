#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertSafeRestoreTarget, verifyRun } from './export-supabase-lib.mjs';

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.code = 2;
  }
}

function optionValue(args, index) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new CliUsageError('Missing option value');
  return value;
}

export function parseVerifyArgs(args = []) {
  if (!Array.isArray(args)) throw new CliUsageError('Invalid command-line arguments');

  const options = {
    help: false,
    runDir: undefined,
    restoreDb: undefined,
    projectTarget: undefined,
    archivePath: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--run-dir') {
      options.runDir = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--run-dir=')) {
      options.runDir = argument.slice('--run-dir='.length);
      if (!options.runDir) throw new CliUsageError('Missing option value');
      continue;
    }
    if (argument === '--restore-db') {
      options.restoreDb = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--restore-db=')) {
      options.restoreDb = argument.slice('--restore-db='.length);
      if (!options.restoreDb) throw new CliUsageError('Missing option value');
      continue;
    }
    if (argument === '--project-target') {
      options.projectTarget = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--project-target=')) {
      options.projectTarget = argument.slice('--project-target='.length);
      if (!options.projectTarget) throw new CliUsageError('Missing option value');
      continue;
    }
    if (argument === '--archive') {
      options.archivePath = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--archive=')) {
      options.archivePath = argument.slice('--archive='.length);
      if (!options.archivePath) throw new CliUsageError('Missing option value');
      continue;
    }
    throw new CliUsageError('Unknown option');
  }

  if (!options.help && !options.runDir) throw new CliUsageError('--run-dir is required');
  return options;
}

export function formatVerificationSummary(report) {
  const lines = [`Supabase export verification: ${report.ok ? 'passed' : 'failed'}`];
  for (const [name, passed] of Object.entries(report.checks || {})) {
    lines.push(`- ${name}: ${passed ? 'passed' : 'failed'}`);
  }
  if (report.errors?.length) {
    lines.push('Errors:');
    lines.push(...report.errors.map((error) => `- ${error}`));
  }
  return lines.join('\n');
}

function formatCliError(error) {
  if (error?.code === 2) return error.message;
  return error instanceof Error ? error.message : 'Export verification failed';
}

export async function main(args = process.argv.slice(2), _env = process.env, io = console, dependencies = {}) {
  try {
    const options = parseVerifyArgs(args);
    if (options.help) {
      io.log([
        'Usage: node scripts/verify-supabase-export.mjs --run-dir <decrypted-run>',
        '',
        'Options:',
        '  --run-dir <path>       Verify an already decrypted run directory',
        '  --archive <path>       Require a non-empty encrypted archive',
        '  --restore-db <url>     Restore only to an approved local database',
        '  --project-target <id>  Required target for --restore-db',
        '  --help                  Show this help',
      ].join('\n'));
      return 0;
    }

    if (options.restoreDb !== undefined) {
      try {
        assertSafeRestoreTarget(options.restoreDb, options.projectTarget);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Restore target is not approved');
      }
    }

    const report = await verifyRun(options.runDir, {
      requireArchive: true,
      archivePath: options.archivePath,
      restoreDb: options.restoreDb,
      projectTarget: options.projectTarget,
      runner: dependencies.runner,
      dumpRunner: dependencies.dumpRunner || dependencies.runner,
    });
    io.log(formatVerificationSummary(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    io.error(`Export verification error: ${formatCliError(error)}`);
    return error?.code === 2 ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

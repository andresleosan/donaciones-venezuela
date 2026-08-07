#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  EXPECTED_PROJECT_REF,
  PREFLIGHT_TOOLS,
  REQUIRED_EXPORT_VARIABLES,
  createRunDirectory,
  exportAuth,
  exportPostgres,
  markRunFailed,
  readExportConfig,
  resolveLocalExecutable,
  resolvePreflightTools,
  runCommand,
} from './export-supabase-lib.mjs';

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

export function parseCliArgs(args = []) {
  if (!Array.isArray(args)) throw new CliUsageError('Invalid command-line arguments');

  let mode = 'dry-run';
  let modeWasSet = false;
  let projectRef;
  let runDir;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help') {
      help = true;
      continue;
    }
    if (argument === '--dry-run') {
      if (modeWasSet && mode !== 'dry-run') throw new CliUsageError('Conflicting execution modes');
      mode = 'dry-run';
      modeWasSet = true;
      continue;
    }
    if (argument === '--execute') {
      if (modeWasSet && mode !== 'execute') throw new CliUsageError('Conflicting execution modes');
      mode = 'execute';
      modeWasSet = true;
      continue;
    }
    if (argument === '--project-ref') {
      projectRef = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--project-ref=')) {
      projectRef = argument.slice('--project-ref='.length);
      if (!projectRef) throw new CliUsageError('Missing option value');
      continue;
    }
    if (argument === '--run-dir') {
      runDir = optionValue(args, index);
      index += 1;
      continue;
    }
    if (argument.startsWith('--run-dir=')) {
      runDir = argument.slice('--run-dir='.length);
      if (!runDir) throw new CliUsageError('Missing option value');
      continue;
    }

    throw new CliUsageError('Unknown option');
  }

  return { help, mode, projectRef, runDir };
}

function formatSummary({ mode, tools = [], missingVariables = [], runDir }) {
  const safeTools = tools.filter((tool) => tool && PREFLIGHT_TOOLS.includes(tool.name));
  const safeMissingVariables = missingVariables.filter((name) => REQUIRED_EXPORT_VARIABLES.includes(name));
  const lines = [
    `Supabase export preflight (${mode})`,
    `Run directory: ${runDir ? 'configured' : 'not configured'}`,
    'Local tools:',
    ...safeTools.map((tool) => `- ${tool.name}: ${tool.available ? 'available' : 'not found'}`),
    'Missing variables:',
  ];

  if (safeMissingVariables.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...safeMissingVariables.map((name) => `- ${name}`));
  }

  lines.push('No network, dumps, downloads, sealing, or data artifacts are run by preflight.');
  return lines.join('\n');
}

function formatCliError(error) {
  if (error?.code === 'EEXIST') return 'Run directory already exists';
  if (['EACCES', 'EPERM', 'ENOTDIR', 'EROFS'].includes(error?.code)) {
    return 'Unable to prepare the external run directory';
  }
  return error instanceof Error ? error.message : 'Export preflight failed';
}

export function formatDryRunSummary(input = {}) {
  return formatSummary({ ...input, mode: 'dry-run' });
}

function createExportRunner(env, dependencies = {}) {
  if (dependencies.runner) return dependencies.runner;

  return (command, args, options) => {
    const executable = resolveLocalExecutable(command, env);
    if (!executable) {
      const error = new Error(`Local executable not found: ${command}`);
      error.code = 'ENOENT';
      return Promise.reject(error);
    }
    return runCommand(executable, args, options);
  };
}

const HELP = [
  'Usage: node scripts/export-supabase.mjs [options]',
  '',
  'Options:',
  '  --dry-run                 Validate configuration without remote or data actions (default)',
  '  --execute                 Run the prepared PostgreSQL and Auth export actions',
  '  --project-ref <ref>       Require the approved Supabase project reference',
  '  --run-dir <path>          Use an external staging root for the run',
  '  --help                    Show this help',
].join('\n');

export async function main(args = process.argv.slice(2), env = process.env, io = console, dependencies = {}) {
  try {
    const options = parseCliArgs(args);
    if (options.help) {
      io.log(HELP);
      return 0;
    }

    if (options.projectRef && options.projectRef !== EXPECTED_PROJECT_REF) {
      throw new CliUsageError('Invalid Supabase project reference');
    }

    const config = readExportConfig(env, process.cwd(), {
      mode: options.mode,
      projectRef: options.projectRef,
      runDir: options.runDir,
    });

    const tools = resolvePreflightTools(env);
    const summary = formatSummary({
      mode: options.mode,
      tools,
      missingVariables: config.missingVariables,
      runDir: config.runDir,
    });
    io.log(summary);

    if (options.mode === 'execute') {
      const stagingRoot = config.runDir || config.outputRoot;
      const paths = await createRunDirectory(stagingRoot, dependencies?.now);
      io.log('Run status: prepared');
      try {
        const evidence = await exportPostgres(config, paths, createExportRunner(env, dependencies));
        io.log(`PostgreSQL export prepared (${evidence.tableCount} public tables)`);
        const authEvidence = await exportAuth(config, paths, dependencies.fetchImpl || globalThis.fetch, {
          now: dependencies.now,
        });
        io.log(`Auth export prepared (${authEvidence.userCount} users, ${authEvidence.pages} pages)`);
        io.log('Run status: prepared');
      } catch (error) {
        await markRunFailed(paths, error).catch(() => {});
        throw error;
      }
    }
    return 0;
  } catch (error) {
    const message = formatCliError(error);
    io.error(`Export preflight error: ${message}`);
    return error?.code === 2 ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

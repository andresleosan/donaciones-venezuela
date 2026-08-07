#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  EXPECTED_PROJECT_REF,
  PREFLIGHT_TOOLS,
  REQUIRED_EXPORT_VARIABLES,
  readExportConfig,
  resolvePreflightTools,
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

export function formatDryRunSummary(input = {}) {
  return formatSummary({ ...input, mode: 'dry-run' });
}

const HELP = [
  'Usage: node scripts/export-supabase.mjs [options]',
  '',
  'Options:',
  '  --dry-run                 Validate configuration without remote or data actions (default)',
  '  --execute                 Select execute mode for future data-producing actions',
  '  --project-ref <ref>       Require the approved Supabase project reference',
  '  --run-dir <path>          Use an external run directory without creating it',
  '  --help                    Show this help',
].join('\n');

export async function main(args = process.argv.slice(2), env = process.env, io = console) {
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
      io.log('Execute mode is reserved for a later task; no export action was run.');
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export preflight failed';
    io.error(`Export preflight error: ${message}`);
    return error?.code === 2 ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

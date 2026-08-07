import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

export const EXPECTED_PROJECT_REF = 'zryfwbjvlacorryzdaod';
export const EXPECTED_SUPABASE_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
export const ALLOWED_SUPABASE_ORIGINS = Object.freeze([EXPECTED_SUPABASE_URL]);

export const REQUIRED_EXPORT_VARIABLES = Object.freeze([
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EXPORT_ROOT',
  'EXPORT_AGE_RECIPIENT',
]);

export const PREFLIGHT_TOOLS = Object.freeze([
  'pg_dump',
  'psql',
  'pg_restore',
  'tar',
  'age',
]);

export const RUN_DIRECTORY_NAMES = Object.freeze([
  'postgres',
  'auth',
  'storage',
  'reconciliation',
  'temp',
]);

export const RUN_STATUSES = Object.freeze(['prepared', 'completed', 'failed']);

const ALLOWED_ERROR_CODES = new Set([
  'COMMAND_ARGUMENT_NOT_ALLOWED',
  'COMMAND_ARGUMENT_SECRET',
  'COMMAND_EXIT',
  'COMMAND_NOT_ALLOWED',
  'COMMAND_SPAWN_FAILED',
  'COMMAND_TIMEOUT',
  'EACCES',
  'EEXIST',
  'ENOENT',
  'ENOTDIR',
  'EPERM',
  'EROFS',
  'EXPORT_FAILED',
]);

const SAFE_COMMAND_OPTIONS = Object.freeze({
  pg_dump: Object.freeze(['--data-only', '--dbname', '--file', '--format', '--host', '--no-owner',
    '--no-privileges', '--port', '--schema', '--schema-only', '--user', '--username', '--version']),
  psql: Object.freeze(['--dbname', '--file', '--host', '--port', '--set', '--user', '--username', '--version']),
  pg_restore: Object.freeze(['--clean', '--dbname', '--exit-on-error', '--file', '--host', '--if-exists',
    '--no-owner', '--no-privileges', '--port', '--single-transaction', '--user', '--username', '--version']),
  tar: Object.freeze(['--create', '--directory', '--file', '--no-recursion', '-C', '-c', '-f']),
  age: Object.freeze(['--output', '--recipient', '--version', '-o', '-r']),
});

const COMMAND_OPTIONS_WITH_VALUES = Object.freeze({
  pg_dump: Object.freeze(['--dbname', '--file', '--format', '--host', '--port', '--schema', '--user', '--username']),
  psql: Object.freeze(['--dbname', '--file', '--host', '--port', '--set', '--user', '--username']),
  pg_restore: Object.freeze(['--dbname', '--file', '--host', '--port', '--user', '--username']),
  tar: Object.freeze(['--directory', '--file', '-C', '-f']),
  age: Object.freeze(['--output', '--recipient', '-o', '-r']),
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function valueOrUndefined(value) {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function isExecuteMode(options) {
  if (options === true || options === 'execute') return true;
  return Boolean(options && typeof options === 'object' &&
    (options.execute === true || options.mode === 'execute'));
}

function resolvePathForInput(value) {
  const input = String(value);
  const windowsStyle = /^[A-Za-z]:[\\/]/.test(input) || input.includes('\\');
  return windowsStyle ? win32.resolve(input) : resolve(input);
}

function isInsideOrEqual(candidate, parent, pathApi) {
  const comparableCandidate = pathApi === win32 ? candidate.toLowerCase() : candidate;
  const comparableParent = pathApi === win32 ? parent.toLowerCase() : parent;
  const pathFromParent = pathApi.relative(comparableParent, comparableCandidate);

  return pathFromParent === '' || (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(pathFromParent)
  );
}

function canonicalizeExistingPath(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

function canonicalizeWithExistingAncestor(candidate, pathApi) {
  const missingSegments = [];
  let existingAncestor = candidate;

  while (!existsSync(existingAncestor)) {
    const parent = pathApi.dirname(existingAncestor);
    if (parent === existingAncestor) return candidate;
    missingSegments.unshift(pathApi.basename(existingAncestor));
    existingAncestor = parent;
  }

  const canonicalAncestor = canonicalizeExistingPath(existingAncestor);
  return missingSegments.length === 0
    ? canonicalAncestor
    : pathApi.resolve(canonicalAncestor, ...missingSegments);
}

function hasProtectedSegment(candidate) {
  const protectedSegments = new Set(['.git', 'node_modules', 'dist', 'graphify-out']);
  return candidate
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => protectedSegments.has(segment.toLowerCase()));
}

export function assertSafeOutputRoot(outputRoot, repoRoot) {
  if (!isNonEmptyString(outputRoot) || !isNonEmptyString(repoRoot)) {
    throw new Error('Export output root must be outside the repository and protected directories');
  }

  const candidate = resolvePathForInput(outputRoot.trim());
  const repository = resolvePathForInput(repoRoot.trim());
  const useWindowsPaths = /^[A-Za-z]:[\\/]/.test(outputRoot) ||
    /^[A-Za-z]:[\\/]/.test(repoRoot) || outputRoot.includes('\\') || repoRoot.includes('\\');
  const pathApi = useWindowsPaths
    ? win32
    : { basename, dirname, relative, isAbsolute, resolve, sep };
  const canonicalRepository = canonicalizeExistingPath(repository);
  const canonicalCandidate = canonicalizeWithExistingAncestor(candidate, pathApi);

  if (isInsideOrEqual(canonicalCandidate, canonicalRepository, pathApi) ||
    hasProtectedSegment(candidate) || hasProtectedSegment(canonicalCandidate)) {
    throw new Error('Export output root must be outside the repository and protected directories');
  }

  return canonicalCandidate;
}

function parseSupabaseUrl(value) {
  if (!isNonEmptyString(value)) return undefined;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('invalid URL');
    }
    if (!ALLOWED_SUPABASE_ORIGINS.includes(parsed.origin)) {
      throw new Error('unapproved Supabase host');
    }
    return parsed.origin;
  } catch {
    throw new Error('SUPABASE_URL must be the approved HTTPS Supabase project URL');
  }
}

function parseDatabaseUrl(value) {
  if (!isNonEmptyString(value)) return undefined;

  try {
    const parsed = new URL(value.trim());
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname) {
      throw new Error('invalid PostgreSQL URL');
    }
    return value.trim();
  } catch {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL URL');
  }
}

function decodeConnectionPart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`SUPABASE_DB_URL contains an invalid encoded ${label}`);
  }
}

export function parsePostgresConnection(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL URL');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname) {
      throw new Error('invalid PostgreSQL URL');
    }
  } catch {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL URL');
  }

  const database = decodeConnectionPart(parsed.pathname.slice(1), 'database name');
  const username = decodeConnectionPart(parsed.username, 'username');
  const password = decodeConnectionPart(parsed.password, 'password');
  if (!database || !username) {
    throw new Error('SUPABASE_DB_URL must include a PostgreSQL username and database');
  }

  return Object.freeze({
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: username,
    PGDATABASE: database,
    PGPASSWORD: password,
    PGSSLMODE: 'require',
  });
}

export function buildPostgresInvocation(connection, outputPath) {
  const parsedConnection = typeof connection === 'string'
    ? parsePostgresConnection(connection)
    : connection;

  if (!parsedConnection || typeof parsedConnection !== 'object') {
    throw new Error('A PostgreSQL connection is required');
  }
  if (!isNonEmptyString(outputPath) || outputPath.includes('\0')) {
    throw new Error('A PostgreSQL output path is required');
  }

  const requiredFields = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD'];
  if (requiredFields.some((field) => !isNonEmptyString(parsedConnection[field]))) {
    throw new Error('The PostgreSQL connection is incomplete');
  }

  const env = Object.freeze({
    PGHOST: parsedConnection.PGHOST,
    PGPORT: parsedConnection.PGPORT,
    PGUSER: parsedConnection.PGUSER,
    PGDATABASE: parsedConnection.PGDATABASE,
    PGPASSWORD: parsedConnection.PGPASSWORD,
    PGSSLMODE: 'require',
  });

  return Object.freeze({
    command: 'pg_dump',
    args: Object.freeze([
      '--host', parsedConnection.PGHOST,
      '--port', parsedConnection.PGPORT,
      '--username', parsedConnection.PGUSER,
      '--dbname', parsedConnection.PGDATABASE,
      '--file', outputPath,
    ]),
    env,
  });
}

export function quoteIdentifier(value) {
  if (!isNonEmptyString(value) || value.includes('\0')) {
    throw new Error('PostgreSQL identifier must be a non-empty string without NUL bytes');
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedIdentifier(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

const FINANCIAL_TOTALS_QUERY = `select json_build_object(
  'facturas', json_build_object(
    'count', (select count(*) from ${qualifiedIdentifier('public', 'facturas')}),
    'abiertas', (select count(*) from ${qualifiedIdentifier('public', 'facturas')} where estado = 'Abierta'),
    'monto_requerido', (select coalesce(sum(monto_requerido), 0) from ${qualifiedIdentifier('public', 'facturas')}),
    'monto_recaudado', (select coalesce(sum(monto_recaudado), 0) from ${qualifiedIdentifier('public', 'facturas')})
  ),
  'donaciones', json_build_object(
    'count', (select count(*) from ${qualifiedIdentifier('public', 'donaciones')}),
    'confirmadas_count', (select count(*) from ${qualifiedIdentifier('public', 'donaciones')} where estado = 'Confirmada'),
    'confirmadas_monto', (select coalesce(sum(monto), 0) from ${qualifiedIdentifier('public', 'donaciones')} where estado = 'Confirmada')
  ),
  'movimientos_factura', json_build_object(
    'count', (select count(*) from ${qualifiedIdentifier('public', 'movimientos_factura')}),
    'monto', (select coalesce(sum(monto), 0) from ${qualifiedIdentifier('public', 'movimientos_factura')})
  )
);`;

export function buildPostgresCountsQuery() {
  const informationSchemaTables = qualifiedIdentifier('information_schema', 'tables');

  return `\\pset tuples_only on
\\pset format unaligned
\\pset pager off
SELECT format(
  'SELECT json_build_object(''relation'', %L, ''count'', count(*)::text)::text FROM %I.%I;',
  table_schema || '.' || table_name,
  table_schema,
  table_name
)
FROM ${informationSchemaTables}
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name
\\gexec
${FINANCIAL_TOTALS_QUERY}`;
}

function commandInvocationRunner(runner) {
  if (typeof runner === 'function') return runner;
  if (runner && typeof runner.runCommand === 'function') return runner.runCommand.bind(runner);
  if (runner && typeof runner.run === 'function') return runner.run.bind(runner);
  return runCommand;
}

function commandExecutable(command, runner) {
  if (runner && typeof runner === 'object') {
    const configured = runner.commands?.[command] || runner[command];
    if (isNonEmptyString(configured)) return configured;
  }

  if (runner && runner !== runCommand) return command;
  const resolved = resolveLocalExecutable(command, process.env);
  if (!resolved) {
    const error = new Error(`Local executable not found: ${command}`);
    error.code = 'ENOENT';
    throw error;
  }
  return resolved;
}

function commandFailure(command, result) {
  const code = Number.isInteger(result?.code) ? result.code : 'unknown';
  const error = new Error(`Command ${commandName(command)} exited with code ${code}`);
  error.code = 'COMMAND_EXIT';
  return error;
}

async function invokeExportCommand(runner, command, args, options) {
  try {
    const invoke = commandInvocationRunner(runner);
    const result = await invoke(commandExecutable(command, runner), args, options);
    if (!result || result.code !== 0) throw commandFailure(command, result);
    return result;
  } catch (error) {
    const safeError = new Error(redactText(
      error instanceof Error ? error.message : 'PostgreSQL command failed',
      collectSensitiveValues(options?.env),
    ));
    safeError.code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'COMMAND_SPAWN_FAILED';
    throw safeError;
  }
}

function versionText(command, result, env) {
  const firstLine = String(result?.stdout ?? '').split(/\r?\n/, 1)[0].trim();
  if (!firstLine) return `${command} version unavailable`;
  return redactText(firstLine.slice(0, 200), collectSensitiveValues(env));
}

function exactCount(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('PostgreSQL row count must be a non-negative integer');
    }
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }

  throw new Error('PostgreSQL row count must be an exact non-negative integer');
}

function isFinancialTotals(value) {
  return value && typeof value === 'object' &&
    value.facturas && value.donaciones && value.movimientos_factura;
}

function normalizeFinancialTotals(value) {
  const fields = {
    facturas: ['count', 'abiertas', 'monto_requerido', 'monto_recaudado'],
    donaciones: ['count', 'confirmadas_count', 'confirmadas_monto'],
    movimientos_factura: ['count', 'monto'],
  };

  const result = {};
  for (const [section, names] of Object.entries(fields)) {
    result[section] = {};
    for (const name of names) {
      const field = value[section][name];
      if (field === null || ['number', 'string'].includes(typeof field)) {
        result[section][name] = field;
      } else {
        throw new Error('Financial totals must contain only primitive values');
      }
    }
  }
  return result;
}

function parseCountsOutput(stdout) {
  const tables = [];
  let financialTotals;
  const seenRelations = new Set();

  for (const line of String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof value?.relation === 'string' && Object.prototype.hasOwnProperty.call(value, 'count')) {
      if (!value.relation.startsWith('public.') || seenRelations.has(value.relation)) {
        throw new Error('PostgreSQL counts contain an invalid relation');
      }
      seenRelations.add(value.relation);
      tables.push({ relation: value.relation, count: exactCount(value.count) });
    } else if (isFinancialTotals(value)) {
      financialTotals = normalizeFinancialTotals(value);
    } else if (value && typeof value === 'object' && value.tables) {
      for (const table of value.tables) {
        if (typeof table?.relation !== 'string' || !table.relation.startsWith('public.')) {
          throw new Error('PostgreSQL counts contain an invalid relation');
        }
        tables.push({ relation: table.relation, count: exactCount(table.count) });
      }
      if (isFinancialTotals(value.financialTotals)) financialTotals = normalizeFinancialTotals(value.financialTotals);
    }
  }

  tables.sort((left, right) => left.relation.localeCompare(right.relation));
  return { tables, financialTotals };
}

async function writeJsonArtifact(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function writeCommandVersions(paths, commandVersions) {
  const runPath = runStatusPath(paths);
  let current;
  try {
    current = JSON.parse(await readFile(runPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  current.commandVersions = commandVersions;
  await writeFile(runPath, `${JSON.stringify(current, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function exportPostgres(config, paths, runner = runCommand) {
  if (!config || typeof config !== 'object' || !isNonEmptyString(config.dbUrl)) {
    throw new Error('A PostgreSQL export configuration is required');
  }
  if (!paths || !isNonEmptyString(paths.postgres) || !isNonEmptyString(paths.reconciliation) ||
    !isNonEmptyString(paths.temp)) {
    throw new Error('PostgreSQL export paths are required');
  }

  const connection = parsePostgresConnection(config.dbUrl);
  const connectionEnv = buildPostgresInvocation(connection, join(paths.postgres, 'schema.sql')).env;
  const schemaFile = join(paths.postgres, 'schema.sql');
  const dataFile = join(paths.postgres, 'data.dump');
  const countsFile = join(paths.postgres, 'object-counts.json');
  const countsSqlFile = join(paths.temp, 'counts.sql');

  await mkdir(paths.postgres, { recursive: true, mode: 0o700 });
  await mkdir(paths.reconciliation, { recursive: true, mode: 0o700 });
  await mkdir(paths.temp, { recursive: true, mode: 0o700 });
  await writeFile(countsSqlFile, buildPostgresCountsQuery(), {
    encoding: 'utf8',
    mode: 0o600,
  });

  const versions = {};
  for (const command of ['pg_dump', 'psql']) {
    const result = await invokeExportCommand(runner, command, ['--version'], { env: connectionEnv });
    versions[command] = versionText(command, result, connectionEnv);
  }

  await invokeExportCommand(runner, 'pg_dump', [
    '--schema=public',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    `--file=${schemaFile}`,
  ], { env: connectionEnv });

  await invokeExportCommand(runner, 'pg_dump', [
    '--schema=public',
    '--data-only',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${dataFile}`,
  ], { env: connectionEnv });

  const countsResult = await invokeExportCommand(runner, 'psql', [
    '--set=ON_ERROR_STOP=1',
    `--file=${countsSqlFile}`,
  ], { env: connectionEnv });
  const parsedCounts = parseCountsOutput(countsResult.stdout);
  const evidence = {
    schemaFile,
    dataFile,
    countsFile,
    tableCount: parsedCounts.tables.length,
  };

  await writeJsonArtifact(countsFile, {
    schema: 'public',
    tableCount: parsedCounts.tables.length,
    tables: parsedCounts.tables,
  });
  if (parsedCounts.financialTotals) {
    await writeJsonArtifact(join(paths.reconciliation, 'financial-totals.json'), {
      query: 'financial_totals',
      schema: 'public',
      totals: parsedCounts.financialTotals,
    });
  }
  await writeCommandVersions(paths, versions);
  return evidence;
}

function collectSensitiveValues(env, options = {}) {
  const values = new Set();
  const addValue = (value) => {
    if (isNonEmptyString(value)) values.add(value);
  };

  for (const [name, value] of Object.entries(env || {})) {
    if (/pass|secret|token|key|credential|db_url/i.test(name)) addValue(value);
  }
  for (const value of options.redact || []) addValue(value);
  return [...values].sort((left, right) => right.length - left.length);
}

function redactText(value, sensitiveValues) {
  let redacted = String(value ?? '');
  for (const secret of sensitiveValues) redacted = redacted.split(secret).join('[redacted]');
  return redacted.replace(/((?:postgres(?:ql)?):\/\/)[^@\s/]+@/gi, '$1[redacted]@');
}

function commandError(command, message, code, sensitiveValues) {
  const error = new Error(`Command ${command} ${message}`);
  error.code = ALLOWED_ERROR_CODES.has(code) ? code : 'COMMAND_SPAWN_FAILED';
  error.message = redactText(error.message, sensitiveValues);
  return error;
}

function commandName(command) {
  const executable = command.includes('\\') ? win32.basename(command) : basename(command);
  return executable.replace(/\.(?:bat|cmd|exe)$/i, '').toLowerCase();
}

function sensitiveArgumentName(argument) {
  const optionName = argument.split('=', 1)[0].toLowerCase();
  return optionName === '-w' || /^(?:--?)(?:pass(?:word|file)?|secret|token|key|credential)$/.test(optionName);
}

function validateCommandArguments(command, args) {
  const name = commandName(command);
  const allowedOptions = SAFE_COMMAND_OPTIONS[name];
  if (!allowedOptions) return 'COMMAND_NOT_ALLOWED';

  const optionsWithValues = COMMAND_OPTIONS_WITH_VALUES[name];
  let expectedValueFor;

  for (const argument of args) {
    if (expectedValueFor) {
      if (argument.startsWith('-')) return 'COMMAND_ARGUMENT_NOT_ALLOWED';
      expectedValueFor = undefined;
      continue;
    }

    if (!argument.startsWith('-')) return 'COMMAND_ARGUMENT_NOT_ALLOWED';
    if (sensitiveArgumentName(argument)) return 'COMMAND_ARGUMENT_SECRET';

    const separator = argument.indexOf('=');
    const optionName = separator === -1 ? argument : argument.slice(0, separator);
    if (!allowedOptions.includes(optionName)) return 'COMMAND_ARGUMENT_NOT_ALLOWED';

    if (separator === -1 && optionsWithValues.includes(optionName)) {
      expectedValueFor = optionName;
    } else if (separator !== -1 && !argument.slice(separator + 1)) {
      return 'COMMAND_ARGUMENT_NOT_ALLOWED';
    }
  }

  return expectedValueFor ? 'COMMAND_ARGUMENT_NOT_ALLOWED' : undefined;
}

function hasSensitiveArgument(args, sensitiveValues) {
  return args.some((argument) => sensitiveValues.some((secret) => argument.includes(secret)) ||
    /postgres(?:ql)?:\/\/[^@\s/]+@/i.test(argument));
}

export function runCommand(command, args = [], options = {}) {
  if (!isNonEmptyString(command) || command.includes('\0')) {
    return Promise.reject(new Error('Command name is required'));
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    return Promise.reject(new Error('Command arguments must be strings'));
  }

  const commandOptions = options && typeof options === 'object' ? options : {};
  const hasExplicitEnv = Object.prototype.hasOwnProperty.call(commandOptions, 'env');
  const childEnv = hasExplicitEnv ? { ...(commandOptions.env || {}) } : { ...process.env };
  const sensitiveValues = collectSensitiveValues(childEnv, commandOptions);
  const spawnImpl = commandOptions.spawnImpl || commandOptions.spawn || nodeSpawn;
  const timeout = commandOptions.timeoutMs ?? commandOptions.timeout ?? 120000;
  const invalidArgumentCode = validateCommandArguments(command, args);

  if (invalidArgumentCode) {
    return Promise.reject(commandError(
      command,
      'refused command arguments',
      invalidArgumentCode,
      sensitiveValues,
    ));
  }

  if (hasSensitiveArgument(args, sensitiveValues)) {
    return Promise.reject(commandError(
      command,
      'refused sensitive command arguments',
      'COMMAND_ARGUMENT_SECRET',
      sensitiveValues,
    ));
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    return Promise.reject(new Error('Command timeout must be a positive number'));
  }
  const terminationGraceMs = commandOptions.terminationGraceMs ?? commandOptions.killGraceMs ?? 250;
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs <= 0) {
    return Promise.reject(new Error('Command termination grace must be a positive number'));
  }

  return new Promise((resolveResult, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutTimer;
    let terminationTimer;
    let timedOut = false;
    let timeoutError;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (terminationTimer) clearTimeout(terminationTimer);
    };

    const closeStreams = () => {
      for (const stream of [child?.stdout, child?.stderr]) {
        try {
          stream?.destroy?.();
        } catch {
          // Stream cleanup must not replace the command result.
        }
      }
    };

    const settle = (callback) => {
      if (settled) return false;
      settled = true;
      clearTimers();
      callback();
      return true;
    };

    const rejectWith = (error) => settle(() => reject(error));
    const resolveWith = (code) => {
      if (timedOut) {
        closeStreams();
        settle(() => reject(timeoutError));
        return;
      }
      settle(() => resolveResult({
        stdout: redactText(stdout, sensitiveValues),
        stderr: redactText(stderr, sensitiveValues),
        code: Number.isInteger(code) ? code : null,
      }));
    };

    try {
      child = spawnImpl(command, args, {
        cwd: commandOptions.cwd,
        env: childEnv,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectWith(commandError(
        command,
        `could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
        'COMMAND_SPAWN_FAILED',
        sensitiveValues,
      ));
      return;
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
    });
    child.once('error', (error) => {
      if (timedOut) return;
      rejectWith(commandError(
        command,
        `could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
        error?.code || 'COMMAND_SPAWN_FAILED',
        sensitiveValues,
      ));
    });
    child.once('close', (code) => resolveWith(code));

    timeoutTimer = setTimeout(() => {
      if (settled || timedOut) return;
      timedOut = true;
      timeoutError = commandError(command, `timed out after ${timeout}ms`, 'COMMAND_TIMEOUT', sensitiveValues);
      terminationTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill?.('SIGKILL');
        } catch {
          // The close event remains the source of truth for timeout completion.
        }
      }, terminationGraceMs);
      try {
        child.kill?.('SIGTERM');
      } catch {
        // Escalation still runs if graceful termination is unavailable.
      }
    }, timeout);
  });
}

function runTimestamp(timestamp) {
  const date = timestamp === undefined ? new Date() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('Run timestamp must be a valid date');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
}

function runStatusPath(paths) {
  if (!paths || !isNonEmptyString(paths.root)) throw new Error('Run paths are required');
  return join(paths.root, 'run.json');
}

function safeErrorCode(error) {
  const candidate = typeof error === 'string' ? error : error?.code;
  if (typeof candidate === 'number' && Number.isInteger(candidate)) return 'COMMAND_EXIT';
  if (typeof candidate === 'string' && ALLOWED_ERROR_CODES.has(candidate)) return candidate;
  return 'EXPORT_FAILED';
}

async function readSafeRunRecord(paths) {
  try {
    const parsed = JSON.parse(await readFile(runStatusPath(paths), 'utf8'));
    return {
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
      commandVersions: parsed.commandVersions && typeof parsed.commandVersions === 'object'
        ? Object.fromEntries(Object.entries(parsed.commandVersions)
          .filter(([name, version]) => ['pg_dump', 'psql'].includes(name) && typeof version === 'string')
          .map(([name, version]) => [name, version.slice(0, 200)]))
        : undefined,
    };
  } catch {
    return {};
  }
}

export async function writeRunStatus(paths, status, details = {}) {
  if (!RUN_STATUSES.includes(status)) throw new Error('Invalid run status');
  const existing = await readSafeRunRecord(paths);
  const now = new Date().toISOString();
  const record = {
    status,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };

  if (existing.commandVersions) record.commandVersions = existing.commandVersions;
  if (status === 'failed') record.errorCode = safeErrorCode(details);
  await writeFile(runStatusPath(paths), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return record;
}

export async function cleanupFailedRun(paths) {
  if (!paths || !isNonEmptyString(paths.temp)) return;
  await rm(paths.temp, { recursive: true, force: true });
  await mkdir(paths.temp, { recursive: true, mode: 0o700 });
}

export async function markRunFailed(paths, error) {
  const record = await writeRunStatus(paths, 'failed', error);
  await cleanupFailedRun(paths);
  return record;
}

export async function markRunCompleted(paths) {
  return writeRunStatus(paths, 'completed');
}

export async function createRunDirectory(outputRoot, timestamp, repoRoot = process.cwd()) {
  if (!isNonEmptyString(outputRoot) || outputRoot.includes('\0')) {
    throw new Error('Export output root is required');
  }

  const validatedOutputRoot = assertSafeOutputRoot(outputRoot.trim(), repoRoot);
  const runName = runTimestamp(timestamp);
  const resolvedOutputRoot = validatedOutputRoot;
  await mkdir(resolvedOutputRoot, { recursive: true, mode: 0o700 });
  const root = join(resolvedOutputRoot, runName);
  const paths = { root };
  for (const name of RUN_DIRECTORY_NAMES) paths[name] = join(root, name);

  let createdRoot = false;
  try {
    await mkdir(root, { mode: 0o700 });
    createdRoot = true;
    for (const name of RUN_DIRECTORY_NAMES) await mkdir(paths[name], { mode: 0o700 });
    await writeRunStatus(paths, 'prepared');
    return Object.freeze(paths);
  } catch (error) {
    if (createdRoot) await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function safeConfigSummary(config) {
  return {
    projectRef: config.projectRef,
    supabaseUrl: config.supabaseUrl,
    dbUrl: config.dbUrl ? '[redacted]' : undefined,
    serviceRoleKey: config.serviceRoleKey ? '[redacted]' : undefined,
    outputRoot: config.outputRoot,
    runDir: config.runDir,
    ageRecipient: config.ageRecipient,
    repoRoot: config.repoRoot,
    missingVariables: config.missingVariables,
    mode: config.mode,
  };
}

export function readExportConfig(env = process.env, repoRoot = process.cwd(), options = {}) {
  const source = env || {};
  const execute = isExecuteMode(options);
  const requestedProjectRef = options && typeof options === 'object' ? options.projectRef : undefined;
  const requestedRunDir = options && typeof options === 'object' ? options.runDir : undefined;
  const environmentProjectRef = valueOrUndefined(source.SUPABASE_PROJECT_REF);

  if (environmentProjectRef && environmentProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }
  if (requestedProjectRef && requestedProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }

  const projectRef = requestedProjectRef || environmentProjectRef;
  const supabaseUrl = parseSupabaseUrl(source.SUPABASE_URL);
  const dbUrl = execute ? parseDatabaseUrl(source.SUPABASE_DB_URL) : undefined;
  const serviceRoleKey = execute ? valueOrUndefined(source.SUPABASE_SERVICE_ROLE_KEY) : undefined;
  const outputValue = valueOrUndefined(source.EXPORT_ROOT);
  const outputRoot = outputValue ? assertSafeOutputRoot(outputValue, repoRoot) : undefined;
  const runDirValue = valueOrUndefined(requestedRunDir);
  const runDir = runDirValue ? assertSafeOutputRoot(runDirValue, repoRoot) : undefined;
  const missingVariables = REQUIRED_EXPORT_VARIABLES.filter((name) => {
    if (name === 'SUPABASE_PROJECT_REF') return !projectRef;
    return execute ? !valueOrUndefined(source[name]) : !Object.prototype.hasOwnProperty.call(source, name);
  });

  if (execute && missingVariables.length > 0) {
    throw new Error(`Missing required export variables: ${missingVariables.join(', ')}`);
  }

  const config = {
    projectRef,
    supabaseUrl,
    outputRoot,
    runDir,
    ageRecipient: execute ? valueOrUndefined(source.EXPORT_AGE_RECIPIENT) : undefined,
    repoRoot: canonicalizeExistingPath(resolvePathForInput(repoRoot)),
    missingVariables,
    mode: execute ? 'execute' : 'dry-run',
  };

  Object.defineProperties(config, {
    dbUrl: {
      configurable: false,
      enumerable: false,
      value: dbUrl,
      writable: false,
    },
    serviceRoleKey: {
      configurable: false,
      enumerable: false,
      value: serviceRoleKey,
      writable: false,
    },
    toJSON: {
      configurable: false,
      enumerable: false,
      value: () => safeConfigSummary(config),
      writable: false,
    },
  });

  return Object.freeze(config);
}

function executableCandidates(name, env) {
  const pathValue = env.PATH || env.Path || '';
  const pathEntries = pathValue.split(delimiter).filter(Boolean);
  const windowsStyle = process.platform === 'win32';
  const extensions = windowsStyle
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const hasExtension = extname(name).length > 0;

  return pathEntries.flatMap((directory) => {
    if (!windowsStyle || hasExtension) return [join(directory, name)];
    return extensions.map((extension) => join(directory, `${name}${extension}`));
  });
}

export function resolveLocalExecutable(name, env = process.env) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return undefined;

  for (const candidate of executableCandidates(name, env || {})) {
    const absoluteCandidate = process.platform === 'win32' ? win32.resolve(candidate) : resolve(candidate);
    try {
      if (!statSync(absoluteCandidate).isFile()) continue;
      if (process.platform !== 'win32') accessSync(absoluteCandidate, constants.X_OK);
      return absoluteCandidate;
    } catch {
      // An unavailable or non-executable PATH entry is not a preflight failure.
    }
  }

  return undefined;
}

export function resolvePreflightTools(env = process.env) {
  return PREFLIGHT_TOOLS.map((name) => ({
    name,
    available: Boolean(resolveLocalExecutable(name, env)),
  }));
}

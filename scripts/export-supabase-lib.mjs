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
  const childEnv = { ...process.env, ...(commandOptions.env || {}) };
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
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
      return candidate;
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

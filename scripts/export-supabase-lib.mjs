import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, closeSync, constants, createWriteStream, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
export const REQUIRED_RUN_ARTIFACTS = Object.freeze([
  'postgres/schema.sql',
  'postgres/data.dump',
  'postgres/object-counts.json',
  'auth/users.json',
  'auth/metadata.json',
  'storage/manifest.jsonl',
  'storage/buckets.json',
  'reconciliation/source-counts.json',
  'reconciliation/financial-totals.json',
  'reconciliation/rpc-samples.json',
]);
export const REQUIRED_RPC_NAMES = Object.freeze([
  'estadisticas',
  'seguimiento_factura',
  'seguimiento_donaciones',
]);
export const CHECKSUM_FILE_NAME = 'checksums.sha256';
export const AUTH_PAGE_SIZE = 100;
export const AUTH_MAX_PAGES = 100;
export const STORAGE_PAGE_SIZE = 100;
export const STORAGE_MAX_PAGES = 1000;
export const STORAGE_MAX_PREFIXES = 10000;

const AUTH_USER_METADATA_FIELDS = Object.freeze([
  'display_name',
  'full_name',
  'name',
  'avatar_url',
]);
const AUTH_APP_METADATA_FIELDS = Object.freeze([
  'provider',
  'providers',
  'role',
  'roles',
]);
const AUTH_USER_FIELDS = Object.freeze([
  'id',
  'email',
  'emailConfirmedAt',
  'createdAt',
  'updatedAt',
  'lastSignInAt',
  'phone',
  'userMetadata',
  'appMetadata',
  'disabled',
]);

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
  pg_restore: Object.freeze(['--clean', '--dbname', '--exit-on-error', '--host', '--if-exists', '--list',
    '--no-owner', '--no-privileges', '--port', '--single-transaction', '--user', '--username', '--version']),
  tar: Object.freeze(['--create', '--directory', '--exclude', '--file', '--no-recursion', '-C', '-c', '-f']),
  age: Object.freeze(['--output', '--recipient', '--version', '-o', '-r']),
});

const COMMAND_OPTIONS_WITH_VALUES = Object.freeze({
  pg_dump: Object.freeze(['--dbname', '--file', '--format', '--host', '--port', '--schema', '--user', '--username']),
  psql: Object.freeze(['--dbname', '--file', '--host', '--port', '--set', '--user', '--username']),
  pg_restore: Object.freeze(['--dbname', '--host', '--port', '--user', '--username']),
  tar: Object.freeze(['--directory', '--exclude', '--file', '-C', '-f']),
  age: Object.freeze(['--output', '--recipient', '-o', '-r']),
});

const APPROVED_EXECUTION_CONFIGS = new WeakSet();

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

function assertApprovedExecution(config, label) {
  if (!config || typeof config !== 'object' ||
    !APPROVED_EXECUTION_CONFIGS.has(config) ||
    config.projectRef !== EXPECTED_PROJECT_REF ||
    config.supabaseUrl !== EXPECTED_SUPABASE_URL ||
    config.mode !== 'execute') {
    throw new Error(`${label} requires the approved execute gate`);
  }
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

export const FINANCIAL_TOTALS_QUERY = `select json_build_object(
  'facturas', json_build_object(
    'count', (select count(*) from public.facturas),
    'abiertas', (select count(*) from public.facturas where estado = 'Abierta'),
    'monto_requerido', (select coalesce(sum(monto_requerido), 0) from public.facturas),
    'monto_recaudado', (select coalesce(sum(monto_recaudado), 0) from public.facturas)
  ),
  'donaciones', json_build_object(
    'count', (select count(*) from public.donaciones),
    'confirmadas_count', (select count(*) from public.donaciones where estado = 'Confirmada'),
    'confirmadas_monto', (select coalesce(sum(monto), 0) from public.donaciones where estado = 'Confirmada')
  ),
  'movimientos_factura', json_build_object(
    'count', (select count(*) from public.movimientos_factura),
    'monto', (select coalesce(sum(monto), 0) from public.movimientos_factura)
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

const EXACT_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function exactCountText(value, label) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be an exact decimal integer string`);
    }
    return String(value);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be an exact decimal integer string`);
  }
  return value;
}

function exactDecimalText(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) && !Number.isSafeInteger(Math.round(value))) {
      throw new Error(`${label} must be an exact decimal string`);
    }
    value = String(value);
  }
  if (typeof value !== 'string' || !EXACT_DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact decimal string`);
  }
  return value;
}

function isFinancialTotals(value) {
  return value && typeof value === 'object' &&
    ['facturas', 'donaciones', 'movimientos_factura']
      .every((section) => Object.prototype.hasOwnProperty.call(value, section));
}

function normalizeFinancialTotals(value) {
  const fields = {
    facturas: {
      count: exactCountText,
      abiertas: exactCountText,
      monto_requerido: exactDecimalText,
      monto_recaudado: exactDecimalText,
    },
    donaciones: {
      count: exactCountText,
      confirmadas_count: exactCountText,
      confirmadas_monto: exactDecimalText,
    },
    movimientos_factura: {
      count: exactCountText,
      monto: exactDecimalText,
    },
  };

  const rootKeys = Object.keys(value);
  if (rootKeys.length !== Object.keys(fields).length ||
    Object.keys(fields).some((section) => !rootKeys.includes(section))) {
    throw new Error('Financial totals contain an unapproved section');
  }

  const result = {};
  for (const [section, validators] of Object.entries(fields)) {
    const names = Object.keys(validators);
    const sectionValue = value[section];
    const sectionKeys = sectionValue && typeof sectionValue === 'object'
      ? Object.keys(sectionValue)
      : [];
    if (sectionKeys.length !== names.length || names.some((name) => !sectionKeys.includes(name))) {
      throw new Error(`Financial totals section ${section} is incomplete`);
    }

    result[section] = {};
    for (const name of names) {
      result[section][name] = validators[name](sectionValue[name], `${section}.${name}`);
    }
  }
  return result;
}

function parseJsonPreservingNumberLexemes(input) {
  const source = String(input);
  let index = 0;

  function fail() {
    throw new Error('PostgreSQL counts output contains invalid JSON');
  }

  function skipWhitespace() {
    while (/\s/.test(source[index] || '')) index += 1;
  }

  function parseString() {
    if (source[index] !== '"') fail();
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          fail();
        }
      }
      index += 1;
    }
    fail();
  }

  function parseNumber() {
    const match = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail();
    index += match[0].length;
    return match[0];
  }

  function parseValue() {
    skipWhitespace();
    const character = source[index];
    if (character === '"') return parseString();
    if (character === '{') return parseObject();
    if (character === '[') return parseArray();
    if (character === 't' && source.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (character === 'f' && source.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (character === 'n' && source.startsWith('null', index)) {
      index += 4;
      return null;
    }
    if (character === '-' || /\d/.test(character || '')) return parseNumber();
    fail();
  }

  function parseObject() {
    const value = {};
    index += 1;
    skipWhitespace();
    if (source[index] === '}') {
      index += 1;
      return value;
    }
    while (index < source.length) {
      const key = parseString();
      skipWhitespace();
      if (source[index] !== ':') fail();
      index += 1;
      value[key] = parseValue();
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return value;
      }
      if (source[index] !== ',') fail();
      index += 1;
      skipWhitespace();
    }
    fail();
  }

  function parseArray() {
    const value = [];
    index += 1;
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return value;
    }
    while (index < source.length) {
      value.push(parseValue());
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return value;
      }
      if (source[index] !== ',') fail();
      index += 1;
      skipWhitespace();
    }
    fail();
  }

  const value = parseValue();
  skipWhitespace();
  if (index !== source.length) fail();
  return value;
}

function parseCountsOutput(stdout) {
  const tables = [];
  let financialTotals;
  let financialBlockCount = 0;
  const seenRelations = new Set();
  const lines = String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);

  if (lines.length === 0) throw new Error('PostgreSQL counts output is empty');

  for (const line of lines) {
    let value;
    try {
      value = parseJsonPreservingNumberLexemes(line);
    } catch {
      throw new Error('PostgreSQL counts output contains invalid JSON');
    }

    if (typeof value?.relation === 'string' && Object.prototype.hasOwnProperty.call(value, 'count')) {
      if (Object.keys(value).length !== 2 || !value.relation.startsWith('public.') ||
        value.relation.length <= 'public.'.length || seenRelations.has(value.relation)) {
        throw new Error('PostgreSQL counts contain an invalid relation');
      }
      seenRelations.add(value.relation);
      tables.push({ relation: value.relation, count: exactCount(value.count) });
    } else if (isFinancialTotals(value)) {
      financialBlockCount += 1;
      if (financialBlockCount > 1) throw new Error('PostgreSQL counts contain multiple financial blocks');
      financialTotals = normalizeFinancialTotals(value);
    } else {
      throw new Error('PostgreSQL counts output contains an unexpected record');
    }
  }

  if (tables.length === 0) throw new Error('PostgreSQL counts contain no public relations');
  if (financialBlockCount !== 1 || !financialTotals) {
    throw new Error('PostgreSQL counts contain an incomplete financial block');
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

function authString(value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Supabase Auth user ${label} is invalid`);
    return null;
  }
  if (typeof value !== 'string' || (required && value.length === 0)) {
    throw new Error(`Supabase Auth user ${label} is invalid`);
  }
  return value;
}

function authTimestamp(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Supabase Auth user ${label} is invalid`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Supabase Auth user ${label} is invalid`);
  return parsed.toISOString();
}

function authNow(value) {
  let candidate;
  try {
    candidate = typeof value === 'function' ? value() : value;
  } catch {
    throw new Error('Supabase Auth reference time is invalid');
  }

  if (candidate === null) throw new Error('Supabase Auth reference time is invalid');
  const parsed = candidate === undefined
    ? new Date()
    : candidate instanceof Date
      ? new Date(candidate.getTime())
      : new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new Error('Supabase Auth reference time is invalid');
  return parsed;
}

function authMetadata(value, allowedFields) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Supabase Auth metadata is invalid');
  }

  const result = {};
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const fieldValue = value[field];
    if (field === 'providers' || field === 'roles') {
      if (!Array.isArray(fieldValue) || fieldValue.some((entry) => typeof entry !== 'string')) {
        throw new Error('Supabase Auth metadata is invalid');
      }
      result[field] = [...fieldValue];
      continue;
    }
    if (typeof fieldValue !== 'string') throw new Error('Supabase Auth metadata is invalid');
    result[field] = fieldValue;
  }
  return result;
}

function normalizeAuthUser(user, now) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('Supabase Auth user record is invalid');
  }

  const explicitDisabled = user.disabled;
  if (explicitDisabled !== undefined && explicitDisabled !== null && typeof explicitDisabled !== 'boolean') {
    throw new Error('Supabase Auth user disabled flag is invalid');
  }
  const bannedUntil = authTimestamp(user.banned_until, 'ban timestamp');
  const disabled = bannedUntil && new Date(bannedUntil).getTime() > now.getTime()
    ? true
    : explicitDisabled ?? false;

  return {
    id: authString(user.id, 'id', { required: true }),
    email: authString(user.email, 'email'),
    emailConfirmedAt: authTimestamp(user.email_confirmed_at, 'email confirmation timestamp'),
    createdAt: authTimestamp(user.created_at, 'creation timestamp'),
    updatedAt: authTimestamp(user.updated_at, 'update timestamp'),
    lastSignInAt: authTimestamp(user.last_sign_in_at, 'last sign-in timestamp'),
    phone: authString(user.phone, 'phone'),
    userMetadata: authMetadata(user.user_metadata, AUTH_USER_METADATA_FIELDS),
    appMetadata: authMetadata(user.app_metadata, AUTH_APP_METADATA_FIELDS),
    disabled,
  };
}

async function fetchAuthPage(fetchImpl, endpoint, serviceRoleKey, now) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
  } catch {
    throw new Error('Supabase Auth request failed');
  }

  const status = response?.status;
  if (!response || !Number.isInteger(status) || status < 200 || status >= 300 || response.ok === false) {
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
    throw new Error(`Supabase Auth request failed with HTTP status ${safeStatus}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Supabase Auth response JSON is invalid');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.users)) {
    throw new Error('Supabase Auth response JSON is invalid');
  }
  if (payload.users.length > AUTH_PAGE_SIZE) {
    throw new Error('Supabase Auth page exceeds the safe page size');
  }

  return payload.users.map((user) => normalizeAuthUser(user, now));
}

function authFieldPolicy() {
  return {
    user: [...AUTH_USER_FIELDS],
    userMetadata: [...AUTH_USER_METADATA_FIELDS],
    appMetadata: [...AUTH_APP_METADATA_FIELDS],
  };
}

function assertCreatedDump(filePath, label) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size === 0) throw new Error('empty file');
    if (label === 'schema.sql' && !hasNonWhitespaceContent(filePath)) {
      throw new Error('empty schema');
    }
    if (label === 'data.dump') {
      const header = readFilePrefix(filePath, 6);
      if (header.length <= 5 || header.subarray(0, 5).toString('ascii') !== 'PGDMP') {
        throw new Error('truncated custom dump');
      }
    }
  } catch {
    throw new Error(`${label} is empty, truncated, or was not created by pg_dump`);
  }
}

async function validateCustomDump(filePath, runner) {
  await invokeExportCommand(runner || runCommand, 'pg_restore', ['--list', filePath], {
    env: {},
  });
}

function readFilePrefix(filePath, length) {
  const descriptor = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function hasNonWhitespaceContent(filePath) {
  const descriptor = openSync(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) return false;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] > 32) return true;
      }
      position += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
}

function runPathApi(...values) {
  return storageUsesWindowsPaths(values)
    ? win32
    : { basename, dirname, relative, isAbsolute, resolve, sep };
}

function assertRunPathLayout(paths, names) {
  if (!paths || !isNonEmptyString(paths.root)) {
    throw new Error('Export run root is required');
  }

  const values = [paths.root, ...names.map((name) => paths[name])];
  const pathApi = runPathApi(...values);
  const canonicalRoot = canonicalizeWithExistingAncestor(resolvePathForInput(paths.root), pathApi);
  const canonicalChildren = [];

  for (const name of names) {
    if (!isNonEmptyString(paths[name])) {
      throw new Error('Export paths must remain inside the run root');
    }
    const candidate = canonicalizeWithExistingAncestor(resolvePathForInput(paths[name]), pathApi);
    if (!isInsideOrEqual(candidate, canonicalRoot, pathApi) || candidate === canonicalRoot ||
      canonicalChildren.some((existing) => storagePathsOverlap(candidate, existing, pathApi))) {
      throw new Error('Export paths must remain inside the run root');
    }
    canonicalChildren.push(candidate);
  }
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
  assertApprovedExecution(config, 'PostgreSQL export');
  if (!config || typeof config !== 'object' || !isNonEmptyString(config.dbUrl)) {
    throw new Error('A PostgreSQL export configuration is required');
  }
  if (!isNonEmptyString(config.repoRoot)) {
    throw new Error('A PostgreSQL export repository root is required');
  }
  if (!paths || !isNonEmptyString(paths.postgres) || !isNonEmptyString(paths.reconciliation) ||
    !isNonEmptyString(paths.temp)) {
    throw new Error('PostgreSQL export paths are required');
  }

  assertSafeOutputRoot(paths.root, config.repoRoot);

  assertRunPathLayout(paths, ['postgres', 'reconciliation', 'temp']);

  const connection = parsePostgresConnection(config.dbUrl);
  const connectionEnv = buildPostgresInvocation(connection, join(paths.postgres, 'schema.sql')).env;
  const schemaFile = join(paths.postgres, 'schema.sql');
  const dataFile = join(paths.postgres, 'data.dump');
  const countsFile = join(paths.postgres, 'object-counts.json');
  const countsSqlFile = join(paths.temp, 'counts.sql');

  await mkdir(paths.postgres, { recursive: true, mode: 0o700 });
  await mkdir(paths.reconciliation, { recursive: true, mode: 0o700 });
  await mkdir(paths.temp, { recursive: true, mode: 0o700 });
  assertRunPathLayout(paths, ['postgres', 'reconciliation', 'temp']);
  await Promise.all([
    rm(schemaFile, { force: true }),
    rm(dataFile, { force: true }),
    rm(countsFile, { force: true }),
    rm(join(paths.reconciliation, 'financial-totals.json'), { force: true }),
  ]);
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
  assertCreatedDump(schemaFile, 'schema.sql');

  await invokeExportCommand(runner, 'pg_dump', [
    '--schema=public',
    '--data-only',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${dataFile}`,
  ], { env: connectionEnv });
  assertCreatedDump(dataFile, 'data.dump');
  await validateCustomDump(dataFile, runner);

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

export async function exportAuth(config, paths, fetchImpl, options = {}) {
  assertApprovedExecution(config, 'Supabase Auth export');
  if (!config || typeof config !== 'object') {
    throw new Error('A Supabase Auth export configuration is required');
  }
  if (config.projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Supabase Auth export project is not approved');
  }
  if (config.supabaseUrl !== EXPECTED_SUPABASE_URL) {
    throw new Error('Supabase Auth export origin is not approved');
  }
  if (config.mode !== 'execute') {
    throw new Error('Supabase Auth export requires execute mode');
  }
  if (!isNonEmptyString(config.serviceRoleKey)) {
    throw new Error('A Supabase Auth export configuration is required');
  }
  if (!paths || !isNonEmptyString(paths.auth)) {
    throw new Error('Supabase Auth export paths are required');
  }
  if (!isNonEmptyString(paths.temp)) {
    throw new Error('Supabase Auth temporary export path is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A Supabase Auth fetch implementation is required');
  }

  const authOptions = options && typeof options === 'object' ? options : {};
  const now = authNow(authOptions.now);
  const writeArtifact = typeof authOptions.writer === 'function'
    ? authOptions.writer
    : writeJsonArtifact;
  const renameArtifact = typeof authOptions.renameImpl === 'function'
    ? authOptions.renameImpl
    : rename;
  const usersFile = join(paths.auth, 'users.json');
  const metadataFile = join(paths.auth, 'metadata.json');
  const temporaryUsersFile = join(paths.temp, 'auth-users.json.tmp');
  const temporaryMetadataFile = join(paths.temp, 'auth-metadata.json.tmp');
  const users = [];
  const seenUserIds = new Set();

  for (let page = 1; page <= AUTH_MAX_PAGES; page += 1) {
    const endpoint = new URL('/auth/v1/admin/users', `${config.supabaseUrl}/`);
    endpoint.searchParams.set('page', String(page));
    endpoint.searchParams.set('per_page', String(AUTH_PAGE_SIZE));
    const pageUsers = await fetchAuthPage(fetchImpl, endpoint.toString(), config.serviceRoleKey, now);

    for (const user of pageUsers) {
      if (seenUserIds.has(user.id)) {
        throw new Error('Supabase Auth pagination returned a repeated or overlapping user ID');
      }
      seenUserIds.add(user.id);
    }
    users.push(...pageUsers);

    if (pageUsers.length < AUTH_PAGE_SIZE) {
      try {
        await writeArtifact(temporaryUsersFile, users);
        await writeArtifact(temporaryMetadataFile, {
          count: users.length,
          pages: page,
          fieldPolicy: authFieldPolicy(),
        });
        await renameArtifact(temporaryUsersFile, usersFile);
        await renameArtifact(temporaryMetadataFile, metadataFile);
      } catch {
        await Promise.all([
          temporaryUsersFile,
          temporaryMetadataFile,
          usersFile,
          metadataFile,
        ].map((filePath) => rm(filePath, { force: true }).catch(() => {})));
        throw new Error('Supabase Auth artifacts could not be published');
      }
      return { usersFile, userCount: users.length, pages: page };
    }
  }

  throw new Error('Supabase Auth pagination exceeded the safe page limit');
}

function storageSafeError(message) {
  const error = new Error(message);
  error.storageSafe = true;
  return error;
}

function storagePageSize(config) {
  const configured = config?.storagePageSize;
  if (configured === undefined) return STORAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > STORAGE_PAGE_SIZE) {
    throw storageSafeError('Supabase Storage page size is invalid');
  }
  return configured;
}

function validateStorageConfig(config, fetchImpl) {
  assertApprovedExecution(config, 'Supabase Storage export');
  if (!config || typeof config !== 'object') {
    throw storageSafeError('A Supabase Storage export configuration is required');
  }
  if (config.projectRef !== EXPECTED_PROJECT_REF) {
    throw storageSafeError('Supabase Storage export project is not approved');
  }
  if (config.supabaseUrl !== EXPECTED_SUPABASE_URL) {
    throw storageSafeError('Supabase Storage export origin is not approved');
  }
  if (config.mode !== 'execute') {
    throw storageSafeError('Supabase Storage export requires execute mode');
  }
  if (typeof fetchImpl !== 'function') {
    throw storageSafeError('A Supabase Storage fetch implementation is required');
  }

  return Object.freeze({
    fetchImpl,
    supabaseUrl: config.supabaseUrl,
  });
}

function storageContextWithSecret(config, validated) {
  let serviceRoleKey;
  try {
    serviceRoleKey = config.serviceRoleKey;
  } catch {
    throw storageSafeError('A Supabase Storage export configuration is required');
  }
  if (!isNonEmptyString(serviceRoleKey)) {
    throw storageSafeError('A Supabase Storage export configuration is required');
  }
  return Object.freeze({ ...validated, serviceRoleKey });
}

function storageUsesWindowsPaths(values) {
  return values.some((value) => typeof value === 'string' && (
    /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')
  ));
}

function storagePathApi(...values) {
  return storageUsesWindowsPaths(values)
    ? win32
    : { basename, dirname, relative, isAbsolute, resolve, sep };
}

function safeStorageExternalPath(value, repoRoot) {
  if (!isNonEmptyString(value) || value.includes('\0') || value !== value.trim()) {
    throw storageSafeError('Supabase Storage paths must be external protected paths');
  }

  try {
    return assertSafeOutputRoot(value, isNonEmptyString(repoRoot) ? repoRoot : process.cwd());
  } catch {
    throw storageSafeError('Supabase Storage paths must be external protected paths');
  }
}

function storagePathsOverlap(left, right, pathApi) {
  return isInsideOrEqual(left, right, pathApi) || isInsideOrEqual(right, left, pathApi);
}

function assertStorageChild(candidate, parent, pathApi, message) {
  const canonicalParent = canonicalizeExistingPath(parent);
  const canonicalCandidate = canonicalizeWithExistingAncestor(pathApi.resolve(candidate), pathApi);
  if (!isInsideOrEqual(canonicalCandidate, canonicalParent, pathApi)) {
    throw storageSafeError(message);
  }
  return canonicalCandidate;
}

async function prepareStoragePaths(config, paths) {
  if (!paths || !isNonEmptyString(paths.storage) || !isNonEmptyString(paths.temp)) {
    throw storageSafeError('Supabase Storage export paths are required');
  }

  const storageRoot = safeStorageExternalPath(paths.storage, config.repoRoot);
  const tempRoot = safeStorageExternalPath(paths.temp, config.repoRoot);
  const pathApi = storagePathApi(storageRoot, tempRoot, config.repoRoot);

  if (storagePathsOverlap(storageRoot, tempRoot, pathApi)) {
    throw storageSafeError('Supabase Storage paths must be separate');
  }

  try {
    await mkdir(storageRoot, { recursive: true, mode: 0o700 });
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  } catch {
    throw storageSafeError('Supabase Storage paths could not be prepared');
  }

  const canonicalStorageRoot = canonicalizeExistingPath(storageRoot);
  const canonicalTempRoot = canonicalizeExistingPath(tempRoot);
  if (storagePathsOverlap(canonicalStorageRoot, canonicalTempRoot, pathApi)) {
    throw storageSafeError('Supabase Storage paths must be separate');
  }

  const objectsRoot = join(storageRoot, 'objects');
  try {
    await mkdir(objectsRoot, { recursive: true, mode: 0o700 });
  } catch {
    throw storageSafeError('Supabase Storage object path could not be prepared');
  }
  const canonicalObjectsRoot = assertStorageChild(
    objectsRoot,
    canonicalStorageRoot,
    pathApi,
    'Supabase Storage object path escapes the storage directory',
  );

  return Object.freeze({
    canonicalObjectsRoot,
    canonicalStorageRoot,
    canonicalTempRoot,
    objectsRoot,
    pathApi,
    storageRoot,
    tempRoot,
  });
}

const WINDOWS_RESERVED_STORAGE_NAMES = new Set([
  'AUX', 'CLOCK$', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'CON', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9', 'NUL', 'PRN',
]);

function safeStorageSegment(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes('\0')) {
    throw storageSafeError(`Supabase Storage ${label} name is invalid`);
  }
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') ||
    value.includes(':') || isAbsolute(value) || win32.isAbsolute(value) ||
    /%(?:2e|2f|5c)/i.test(value) || /[<>"|?*\u0000-\u001f\u007f]/.test(value) ||
    value.endsWith('.') || value.endsWith(' ')) {
    throw storageSafeError(`Supabase Storage ${label} name is invalid`);
  }

  const windowsName = value.split('.', 1)[0].toUpperCase();
  if (WINDOWS_RESERVED_STORAGE_NAMES.has(windowsName)) {
    throw storageSafeError(`Supabase Storage ${label} name is invalid`);
  }
  return value;
}

function safeStorageObjectPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes('\\') ||
    value.includes('\0') || value.startsWith('/') || value.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) {
    throw storageSafeError('Supabase Storage object path is invalid');
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    throw storageSafeError('Supabase Storage object path is invalid');
  }
  return segments.map((segment) => safeStorageSegment(segment, 'object'));
}

function combinedStoragePath(prefix, name) {
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (!base) return name;
  if (name === base || name.startsWith(`${base}/`)) return name;
  return `${base}/${name}`;
}

function storageMime(value, label = 'metadata') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw storageSafeError(`Supabase Storage ${label} is invalid`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 255 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw storageSafeError(`Supabase Storage ${label} is invalid`);
  }
  return normalized;
}

function normalizeStorageListEntry(entry, prefix) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string') {
    throw storageSafeError('Supabase Storage object listing is invalid');
  }

  const folder = entry.id === null || entry.name.endsWith('/');
  const entryName = folder && entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
  const path = safeStorageObjectPath(combinedStoragePath(prefix, entryName)).join('/');
  return {
    folder,
    mime: folder ? null : storageMime(entry.metadata?.mimetype),
    path,
  };
}

function retryableStorageStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function validStorageStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
}

function recordStorageFailure(report, operation, status, retries) {
  report.push({
    operation,
    retries,
    status: status === 'network' ? 'network' : validStorageStatus(status),
  });
}

function storageRequestHeaders(serviceRoleKey, options = {}) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  if (options.method === 'POST' || options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

const STORAGE_NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'FETCH_ERR',
  'ERR_NETWORK',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isStorageNetworkError(error) {
  const visited = new Set();
  let current = error;
  for (let depth = 0; current && depth < 8 && !visited.has(current); depth += 1) {
    visited.add(current);
    const code = typeof current.code === 'string' ? current.code.toUpperCase() : undefined;
    if (code && STORAGE_NETWORK_ERROR_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}

async function fetchStorageResponse(context, endpoint, options, operation, report, retryState = { used: 0 }) {
  while (true) {
    let response;
    try {
      response = await context.fetchImpl(endpoint, {
        ...options,
        headers: storageRequestHeaders(context.serviceRoleKey, options),
      });
    } catch (error) {
      if (!isStorageNetworkError(error)) {
        recordStorageFailure(report, operation, 'unknown', retryState.used);
        throw storageSafeError(`Supabase Storage ${operation} request failed`);
      }
      if (retryState.used < 1) {
        retryState.used += 1;
        recordStorageFailure(report, operation, 'network', retryState.used);
        continue;
      }
      recordStorageFailure(report, operation, 'network', retryState.used);
      throw storageSafeError(`Supabase Storage ${operation} request failed`);
    }

    const status = validStorageStatus(response?.status);
    const ok = status !== 'unknown' && status >= 200 && status < 300 && response?.ok !== false;
    if (ok) return { response, retries: retryState.used };

    if (retryableStorageStatus(status) && retryState.used < 1) {
      retryState.used += 1;
      recordStorageFailure(report, operation, status, retryState.used);
      continue;
    }

    recordStorageFailure(report, operation, status, retryState.used);
    throw storageSafeError(`Supabase Storage ${operation} request failed with HTTP status ${status}`);
  }
}

async function parseStorageJson(response, operation) {
  if (!response || typeof response.json !== 'function') {
    throw storageSafeError(`Supabase Storage ${operation} response JSON is invalid`);
  }
  return response.json();
}

async function fetchStorageJson(context, endpoint, options, operation, report) {
  const retryState = { used: 0 };
  while (true) {
    const { response } = await fetchStorageResponse(
      context,
      endpoint,
      options,
      operation,
      report,
      retryState,
    );
    try {
      return { payload: await parseStorageJson(response, operation), response };
    } catch (error) {
      const networkFailure = isStorageNetworkError(error);
      if (networkFailure && retryState.used < 1) {
        retryState.used += 1;
        recordStorageFailure(report, operation, 'network', retryState.used);
        continue;
      }
      recordStorageFailure(
        report,
        operation,
        networkFailure ? 'network' : response?.status,
        retryState.used,
      );
      if (networkFailure) {
        throw storageSafeError(`Supabase Storage ${operation} request failed`);
      }
      throw storageSafeError(`Supabase Storage ${operation} response JSON is invalid`);
    }
  }
}

async function listStorageBuckets(context, pageSize, report) {
  const buckets = [];
  const seenBuckets = new Set();

  for (let page = 0; page < STORAGE_MAX_PAGES; page += 1) {
    const endpoint = new URL('/storage/v1/bucket', `${context.supabaseUrl}/`);
    endpoint.searchParams.set('limit', String(pageSize));
    endpoint.searchParams.set('offset', String(page * pageSize));
    const { payload } = await fetchStorageJson(
      context,
      endpoint.toString(),
      { method: 'GET' },
      'bucket list',
      report,
    );
    if (!Array.isArray(payload) || payload.length > pageSize) {
      throw storageSafeError('Supabase Storage bucket list page is invalid');
    }

    for (const bucket of payload) {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        throw storageSafeError('Supabase Storage bucket list is invalid');
      }
      const bucketId = typeof bucket.id === 'string' && bucket.id.length > 0
        ? bucket.id
        : bucket.name;
      const safeBucket = safeStorageSegment(bucketId, 'bucket');
      if (bucket.name !== undefined) safeStorageSegment(bucket.name, 'bucket');
      if (seenBuckets.has(safeBucket)) {
        throw storageSafeError('Supabase Storage bucket pagination returned a repeated or overlapping bucket');
      }
      seenBuckets.add(safeBucket);
      buckets.push(safeBucket);
    }

    if (payload.length < pageSize) return buckets;
  }

  throw storageSafeError('Supabase Storage bucket pagination exceeded the safe page limit');
}

async function listStorageObjectsWithContext(context, bucket, pageSize, report) {
  const safeBucket = safeStorageSegment(bucket, 'bucket');
  const objects = [];
  const seenEntries = new Set();
  const visitedPrefixes = new Set();
  const pendingPrefixes = [''];

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.shift();
    if (visitedPrefixes.has(prefix)) {
      throw storageSafeError('Supabase Storage object listing returned a repeated folder');
    }
    visitedPrefixes.add(prefix);
    if (visitedPrefixes.size > STORAGE_MAX_PREFIXES) {
      throw storageSafeError('Supabase Storage folder recursion exceeded the safe limit');
    }

    const folders = [];
    for (let page = 0; page < STORAGE_MAX_PAGES; page += 1) {
      const endpoint = new URL(
        `/storage/v1/object/list/${encodeURIComponent(safeBucket)}`,
        `${context.supabaseUrl}/`,
      );
      const request = {
        limit: pageSize,
        offset: page * pageSize,
        prefix,
        sortBy: { column: 'name', order: 'asc' },
      };
      const { payload } = await fetchStorageJson(
        context,
        endpoint.toString(),
        {
          body: JSON.stringify(request),
          method: 'POST',
        },
        'object list',
        report,
      );
      if (!Array.isArray(payload) || payload.length > pageSize) {
        throw storageSafeError('Supabase Storage object list page is invalid');
      }

      for (const entry of payload) {
        const normalized = normalizeStorageListEntry(entry, prefix);
        if (seenEntries.has(normalized.path)) {
          throw storageSafeError('Supabase Storage object pagination returned a repeated or overlapping path');
        }
        seenEntries.add(normalized.path);
        if (normalized.folder) {
          folders.push(normalized.path);
        } else {
          objects.push({
            bucket: safeBucket,
            mime: normalized.mime,
            path: normalized.path,
          });
        }
      }

      if (payload.length < pageSize) break;
      if (page === STORAGE_MAX_PAGES - 1) {
        throw storageSafeError('Supabase Storage object pagination exceeded the safe page limit');
      }
    }

    for (const folder of folders) pendingPrefixes.push(folder);
  }

  return objects;
}

export async function listStorageObjects(config, bucket, fetchImpl) {
  const validated = validateStorageConfig(config, fetchImpl);
  const context = storageContextWithSecret(config, validated);
  return listStorageObjectsWithContext(context, bucket, storagePageSize(config), []);
}

function storageObjectEndpoint(context, bucket, objectPath) {
  const segments = [bucket, ...safeStorageObjectPath(objectPath)];
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(
    `/storage/v1/object/authenticated/${encodedPath}`,
    `${context.supabaseUrl}/`,
  ).toString();
}

function responseContentType(response) {
  try {
    return storageMime(response?.headers?.get?.('content-type'), 'content type');
  } catch {
    return null;
  }
}

function toNodeReadable(body) {
  if (body && typeof body.getReader === 'function') {
    try {
      return Readable.fromWeb(body);
    } catch {
      throw storageSafeError('Supabase Storage object response stream is invalid');
    }
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') return body;
  throw storageSafeError('Supabase Storage object response stream is invalid');
}

async function streamStorageObject(body, temporaryFile) {
  const hash = createHash('sha256');
  let bytes = 0;
  const hashingTransform = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (bytes > Number.MAX_SAFE_INTEGER - buffer.byteLength) {
          callback(storageSafeError('Supabase Storage object is too large to count safely'));
          return;
        }
        bytes += buffer.byteLength;
        hash.update(buffer);
        callback(null, buffer);
      } catch {
        callback(storageSafeError('Supabase Storage object stream is invalid'));
      }
    },
  });

  try {
    await pipeline(
      toNodeReadable(body),
      hashingTransform,
      createWriteStream(temporaryFile, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    const safeError = error?.storageSafe
      ? error
      : storageSafeError('Supabase Storage object stream failed');
    safeError.retryable = isStorageNetworkError(error);
    throw safeError;
  }

  return { bytes, sha256: hash.digest('hex') };
}

async function rollbackStorageArtifacts(createdDestinations, temporaryFiles) {
  await Promise.all([
    ...createdDestinations,
    ...temporaryFiles,
  ].map((filePath) => rm(filePath, { force: true }).catch(() => {})));
}

async function downloadStorageObjectWithContext(
  context,
  storagePaths,
  bucket,
  object,
  report,
  sequence,
  createdDestinations = [],
  temporaryFiles = new Set(),
) {
  const safeBucket = safeStorageSegment(bucket, 'bucket');
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw storageSafeError('Supabase Storage object is invalid');
  }
  const objectSegments = safeStorageObjectPath(object.path);
  const objectPath = objectSegments.join('/');
  const listedMime = storageMime(object.mime, 'object MIME');
  const bucketRoot = join(storagePaths.objectsRoot, safeBucket);

  try {
    await mkdir(bucketRoot, { recursive: true, mode: 0o700 });
  } catch {
    throw storageSafeError('Supabase Storage bucket path could not be prepared');
  }
  const canonicalBucketRoot = assertStorageChild(
    bucketRoot,
    storagePaths.canonicalObjectsRoot,
    storagePaths.pathApi,
    'Supabase Storage bucket path escapes the objects directory',
  );
  const destination = join(bucketRoot, ...objectSegments);
  assertStorageChild(
    destination,
    canonicalBucketRoot,
    storagePaths.pathApi,
    'Supabase Storage object path escapes its bucket directory',
  );
  if (existsSync(destination)) {
    throw storageSafeError('Supabase Storage object destination already exists');
  }

  try {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    assertStorageChild(
      destination,
      canonicalBucketRoot,
      storagePaths.pathApi,
      'Supabase Storage object path escapes its bucket directory',
    );
  } catch (error) {
    if (error?.storageSafe) throw error;
    throw storageSafeError('Supabase Storage object path could not be prepared');
  }

  const temporaryFile = join(
    storagePaths.tempRoot,
    `storage-object-${String(sequence).padStart(12, '0')}.tmp`,
  );
  temporaryFiles.add(temporaryFile);
  assertStorageChild(
    temporaryFile,
    storagePaths.canonicalTempRoot,
    storagePaths.pathApi,
    'Supabase Storage temporary path escapes the temporary directory',
  );
  const retryState = { used: 0 };

  while (true) {
    await rm(temporaryFile, { force: true }).catch(() => {});
    try {
      const endpoint = storageObjectEndpoint(context, safeBucket, objectPath);
      const { response } = await fetchStorageResponse(
        context,
        endpoint,
        { method: 'GET' },
        'download',
        report,
        retryState,
      );
      if (!response.body) throw storageSafeError('Supabase Storage object response stream is invalid');
      const streamed = await streamStorageObject(response.body, temporaryFile);
      const mime = listedMime || responseContentType(response);
      await rename(temporaryFile, destination);
      temporaryFiles.delete(temporaryFile);
      createdDestinations.push(destination);
      return {
        bucket: safeBucket,
        bytes: streamed.bytes,
        mime,
        path: objectPath,
        sha256: streamed.sha256,
      };
    } catch (error) {
      await rm(temporaryFile, { force: true }).catch(() => {});
      if (error?.retryable && retryState.used < 1) {
        retryState.used += 1;
        recordStorageFailure(report, 'download stream', 'network', retryState.used);
        continue;
      }
      if (error?.storageSafe) throw error;
      throw storageSafeError('Supabase Storage object download failed');
    }
  }
}

async function writeStorageErrorReport(storagePaths, report, temporaryFiles = new Set()) {
  if (report.length === 0) return;
  const reportFile = join(storagePaths.storageRoot, 'error-report.json');
  assertStorageChild(
    reportFile,
    storagePaths.canonicalStorageRoot,
    storagePaths.pathApi,
    'Supabase Storage error report path escapes the storage directory',
  );
  const temporaryFile = join(storagePaths.tempRoot, 'storage-error-report.json.tmp');
  temporaryFiles.add(temporaryFile);
  try {
    await rm(temporaryFile, { force: true });
    await writeFile(temporaryFile, `${JSON.stringify({ errors: report })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryFile, reportFile);
    temporaryFiles.delete(temporaryFile);
  } catch {
    await rm(temporaryFile, { force: true }).catch(() => {});
    temporaryFiles.delete(temporaryFile);
    throw storageSafeError('Supabase Storage error report could not be published');
  }
}

export async function downloadStorageObject(config, paths, bucket, object, fetchImpl) {
  const validated = validateStorageConfig(config, fetchImpl);
  const storagePaths = await prepareStoragePaths(config, paths);
  const context = storageContextWithSecret(config, validated);
  const report = [];
  try {
    return await downloadStorageObjectWithContext(context, storagePaths, bucket, object, report, 1);
  } catch (error) {
    if (report.length > 0) await writeStorageErrorReport(storagePaths, report).catch(() => {});
    if (error?.storageSafe) throw error;
    throw storageSafeError('Supabase Storage object download failed');
  }
}

export async function exportStorage(config, paths, fetchImpl) {
  const validated = validateStorageConfig(config, fetchImpl);
  const pageSize = storagePageSize(config);
  const storagePaths = await prepareStoragePaths(config, paths);
  const context = storageContextWithSecret(config, validated);
  const report = [];
  const createdDestinations = [];
  const temporaryFiles = new Set();
  const manifestFile = join(storagePaths.storageRoot, 'manifest.jsonl');
  const bucketsFile = join(storagePaths.storageRoot, 'buckets.json');
  const temporaryManifest = join(storagePaths.tempRoot, 'storage-manifest.jsonl.tmp');
  const temporaryBuckets = join(storagePaths.tempRoot, 'storage-buckets.json.tmp');
  assertStorageChild(
    manifestFile,
    storagePaths.canonicalStorageRoot,
    storagePaths.pathApi,
    'Supabase Storage manifest path escapes the storage directory',
  );
  assertStorageChild(
    bucketsFile,
    storagePaths.canonicalStorageRoot,
    storagePaths.pathApi,
    'Supabase Storage bucket metadata path escapes the storage directory',
  );

  if (existsSync(manifestFile) || existsSync(bucketsFile)) {
    throw storageSafeError('Supabase Storage manifest already exists');
  }

  try {
    await writeFile(temporaryManifest, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    temporaryFiles.add(temporaryManifest);
    const buckets = await listStorageBuckets(context, pageSize, report);
    let objectCount = 0;

    for (const bucket of buckets) {
      const objects = await listStorageObjectsWithContext(context, bucket, pageSize, report);
      for (const object of objects) {
        const evidence = await downloadStorageObjectWithContext(
          context,
          storagePaths,
          bucket,
          object,
          report,
          objectCount + 1,
          createdDestinations,
          temporaryFiles,
        );
        await writeFile(temporaryManifest, `${JSON.stringify({
          bucket: evidence.bucket,
          path: evidence.path,
          bytes: evidence.bytes,
          mime: evidence.mime,
          sha256: evidence.sha256,
        })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
        objectCount += 1;
      }
    }

    await writeStorageErrorReport(storagePaths, report, temporaryFiles);
    temporaryFiles.add(temporaryBuckets);
    await writeFile(temporaryBuckets, `${JSON.stringify({ buckets })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryBuckets, bucketsFile);
    temporaryFiles.delete(temporaryBuckets);
    createdDestinations.push(bucketsFile);
    await rename(temporaryManifest, manifestFile);
    temporaryFiles.delete(temporaryManifest);
    return { bucketCount: buckets.length, manifestFile, objectCount };
  } catch (error) {
    await rollbackStorageArtifacts(createdDestinations, temporaryFiles);
    if (report.length > 0) await writeStorageErrorReport(storagePaths, report, temporaryFiles).catch(() => {});
    if (error?.storageSafe) throw error;
    throw storageSafeError('Supabase Storage export failed');
  }
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
  let positionalCount = 0;

  for (const argument of args) {
    if (expectedValueFor) {
      if (argument.startsWith('-')) return 'COMMAND_ARGUMENT_NOT_ALLOWED';
      expectedValueFor = undefined;
      continue;
    }

    if (!argument.startsWith('-')) {
      if (name === 'tar' && argument === '.') continue;
      if (name === 'pg_restore' && positionalCount === 0 && isNonEmptyString(argument)) {
        positionalCount += 1;
        continue;
      }
      return 'COMMAND_ARGUMENT_NOT_ALLOWED';
    }
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

function manifestNow(value) {
  const candidate = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(candidate.getTime())) throw new Error('Run manifest timestamp must be a valid date');
  return candidate.toISOString();
}

function bytewiseCompare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

async function listFinalArtifacts(root) {
  const files = [];

  async function visit(directory, relativeDirectory = '') {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error('Export artifacts could not be enumerated');
    }

    entries.sort((left, right) => bytewiseCompare(left.name, right.name));
    for (const entry of entries) {
      const entryRelativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const entryPath = join(directory, entry.name);

      if (!relativeDirectory && entry.name === 'temp') continue;
      if (!relativeDirectory && entry.name === CHECKSUM_FILE_NAME) continue;
      if (entry.isSymbolicLink()) throw new Error('Export artifacts may not contain symbolic links');
      if (entry.isDirectory()) {
        await visit(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        files.push(entryRelativePath);
      } else {
        throw new Error('Export artifacts contain an unsupported file type');
      }
    }
  }

  await visit(root);
  files.sort(bytewiseCompare);
  return files;
}

function isAllowedFinalArtifact(relativePath) {
  return relativePath === 'run.json' ||
    REQUIRED_RUN_ARTIFACTS.includes(relativePath) ||
    relativePath === 'storage/error-report.json' ||
    (relativePath.startsWith('storage/objects/') && relativePath.length > 'storage/objects/'.length);
}

function assertAllowedFinalArtifacts(artifacts) {
  if (artifacts.some((relativePath) => !isAllowedFinalArtifact(relativePath))) {
    throw new Error('Export contains unexpected final artifacts');
  }
}

function artifactPath(paths, relativePath) {
  return join(paths.root, ...relativePath.split('/'));
}

function assertRequiredArtifactFiles(paths) {
  for (const relativePath of REQUIRED_RUN_ARTIFACTS) {
    const filePath = artifactPath(paths, relativePath);
    try {
      if (!statSync(filePath).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`Required export evidence is missing: ${relativePath}`);
    }
  }
  assertCreatedDump(artifactPath(paths, 'postgres/schema.sql'), 'schema.sql');
  assertCreatedDump(artifactPath(paths, 'postgres/data.dump'), 'data.dump');
}

async function assertValidDumpArtifacts(runDir, runner) {
  assertCreatedDump(join(runDir, 'postgres', 'schema.sql'), 'schema.sql');
  const dataFile = join(runDir, 'postgres', 'data.dump');
  assertCreatedDump(dataFile, 'data.dump');
  await validateCustomDump(dataFile, runner);
}

async function readJsonFile(filePath, label) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value;
  } catch {
    throw new Error(`${label} is invalid or unavailable`);
  }
}

function evidenceSecretValues(evidence = {}) {
  return collectSensitiveValues({
    ageRecipient: evidence.ageRecipient,
    dbUrl: evidence.dbUrl,
    serviceRoleKey: evidence.serviceRoleKey,
  }, {
    redact: Array.isArray(evidence.secretValues) ? evidence.secretValues : [],
  });
}

function safeCommandVersions(value, sensitiveValues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const allowed = new Set(['pg_dump', 'psql', 'pg_restore', 'tar', 'age']);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, version]) => allowed.has(name) && typeof version === 'string')
      .map(([name, version]) => [name, redactText(version.slice(0, 200), sensitiveValues)]),
  );
}

function primitiveType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function safeRpcStatus(value) {
  if (value === 'ok' || value === 'error' || value === 'skipped' || value === 'not-run') return value;
  return 'unknown';
}

function rpcOutputSchema(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { outputKeys: [], primitiveTypes: {} };
  }

  const outputKeys = Object.keys(output)
    .filter((key) => !/buscar_familiar/i.test(key))
    .sort(bytewiseCompare);
  const primitiveTypes = Object.fromEntries(outputKeys.map((key) => [key, primitiveType(output[key])]));
  return { outputKeys, primitiveTypes };
}

function normalizeRpcSamples(value) {
  const input = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray(value.samples)
      ? value.samples
      : [];
  const byName = new Map();

  for (const sample of input) {
    if (!sample || typeof sample !== 'object' || typeof sample.name !== 'string' ||
      !REQUIRED_RPC_NAMES.includes(sample.name) || byName.has(sample.name)) continue;

    const schema = rpcOutputSchema(sample.output);
    byName.set(sample.name, {
      name: sample.name,
      status: safeRpcStatus(sample.status),
      outputKeys: schema.outputKeys,
      primitiveTypes: schema.primitiveTypes,
    });
  }

  return REQUIRED_RPC_NAMES.map((name) => byName.get(name) || {
    name,
    status: 'not-run',
    outputKeys: [],
    primitiveTypes: {},
  });
}

function normalizeSourceCounts(counts, evidence) {
  const postgres = counts && typeof counts.postgres === 'object' ? counts.postgres : {};
  const authCount = evidence.auth?.userCount;
  const storageCount = evidence.storage || {};
  return {
    postgres: {
      tableCount: exactCount(postgres.tableCount ?? evidence.postgres?.tableCount ?? 0),
      tables: Array.isArray(postgres.tables) ? postgres.tables : [],
    },
    auth: {
      userCount: exactCount(authCount ?? 0),
    },
    storage: {
      bucketCount: exactCount(storageCount.bucketCount ?? 0),
      objectCount: exactCount(storageCount.objectCount ?? 0),
    },
  };
}

async function readPostgresObjectCounts(paths) {
  const value = await readJsonFile(join(paths.postgres, 'object-counts.json'), 'PostgreSQL object counts');
  if (value.schema !== 'public' || !Array.isArray(value.tables)) {
    throw new Error('PostgreSQL object counts are incomplete');
  }
  const tables = value.tables.map((table) => {
    if (!table || typeof table.relation !== 'string') throw new Error('PostgreSQL object counts are invalid');
    return { relation: table.relation, count: exactCount(table.count) };
  });
  const tableCount = exactCount(value.tableCount ?? tables.length);
  if (tableCount !== tables.length) throw new Error('PostgreSQL object counts are incomplete');
  return { tableCount, tables };
}

async function readFinancialTotals(paths, evidence) {
  let value = evidence.postgres?.financialTotals || evidence.financialTotals;
  if (!value) {
    const existing = await readJsonFile(
      join(paths.reconciliation, 'financial-totals.json'),
      'Financial totals',
    );
    value = existing.totals;
  }
  return normalizeFinancialTotals(value);
}

async function buildChecksumLines(root, artifacts) {
  const lines = [];
  for (const relativePath of artifacts) {
    try {
      const content = await readFile(join(root, ...relativePath.split('/')));
      const digest = createHash('sha256').update(content).digest('hex');
      lines.push(`${digest}  ${relativePath}`);
    } catch {
      throw new Error(`Export artifact could not be checksummed: ${relativePath}`);
    }
  }
  return lines;
}

function manifestRunRecord({ existing, evidence, now, sourceCounts, artifacts, sensitiveValues }) {
  const projectRef = evidence.projectRef || EXPECTED_PROJECT_REF;
  if (projectRef !== EXPECTED_PROJECT_REF) throw new Error('Export project reference is not approved');
  return {
    projectRef,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    commandVersions: safeCommandVersions(evidence.commandVersions || existing.commandVersions, sensitiveValues),
    artifacts,
    counts: sourceCounts,
    status: 'completed',
  };
}

export async function writeRunManifest(paths, evidence = {}) {
  if (!paths || !isNonEmptyString(paths.root) || !isNonEmptyString(paths.postgres) ||
    !isNonEmptyString(paths.auth) || !isNonEmptyString(paths.storage) ||
    !isNonEmptyString(paths.reconciliation) || !isNonEmptyString(paths.temp)) {
    throw new Error('Complete export run paths are required');
  }

  const now = manifestNow(evidence.now);
  const existing = await readSafeRunRecord(paths);
  const sensitiveValues = evidenceSecretValues(evidence);
  const postgresCounts = await readPostgresObjectCounts(paths);
  const financialTotals = await readFinancialTotals(paths, evidence);
  const sourceCounts = normalizeSourceCounts({ postgres: postgresCounts }, {
    ...evidence,
    postgres: { ...evidence.postgres, tableCount: postgresCounts.tableCount },
  });

  await writeJsonArtifact(join(paths.reconciliation, 'source-counts.json'), sourceCounts);
  await writeJsonArtifact(join(paths.reconciliation, 'financial-totals.json'), {
    query: 'financial_totals',
    schema: 'public',
    totals: financialTotals,
  });
  await writeJsonArtifact(join(paths.reconciliation, 'rpc-samples.json'), normalizeRpcSamples(evidence.rpcSamples));

  assertRequiredArtifactFiles(paths);
  const listedArtifacts = await listFinalArtifacts(paths.root);
  assertAllowedFinalArtifacts(listedArtifacts);
  const artifacts = [...new Set(['run.json', ...listedArtifacts])].sort(bytewiseCompare);
  const record = manifestRunRecord({
    existing,
    evidence,
    now,
    sourceCounts,
    artifacts,
    sensitiveValues,
  });
  await writeJsonArtifact(runStatusPath(paths), record);

  const finalArtifacts = await listFinalArtifacts(paths.root);
  if (finalArtifacts.join('\n') !== artifacts.join('\n')) {
    throw new Error('Export artifact list changed while writing the manifest');
  }
  const checksumLines = await buildChecksumLines(paths.root, finalArtifacts);
  await writeFile(join(paths.root, CHECKSUM_FILE_NAME), `${checksumLines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    manifestFile: runStatusPath(paths),
    checksumFile: join(paths.root, CHECKSUM_FILE_NAME),
    sourceCountsFile: join(paths.reconciliation, 'source-counts.json'),
    financialTotalsFile: join(paths.reconciliation, 'financial-totals.json'),
    rpcSamplesFile: join(paths.reconciliation, 'rpc-samples.json'),
  };
}

function checksumPathIsSafe(value) {
  return isNonEmptyString(value) && !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split('/').includes('..') && value !== CHECKSUM_FILE_NAME && !value.startsWith('temp/');
}

async function readChecksumEntries(runDir) {
  let content;
  try {
    content = await readFile(join(runDir, CHECKSUM_FILE_NAME), 'utf8');
  } catch {
    throw new Error('Checksum file is missing or unavailable');
  }

  const entries = new Map();
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error('Checksum file is empty');
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !checksumPathIsSafe(match[2]) || entries.has(match[2])) {
      throw new Error('Checksum file contains an invalid entry');
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

function setDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) && value.endsWith('Z');
}

function validateRpcSamples(value) {
  if (!Array.isArray(value) || value.length !== REQUIRED_RPC_NAMES.length) {
    throw new Error('RPC samples are incomplete');
  }

  const names = [];
  for (const sample of value) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
      !REQUIRED_RPC_NAMES.includes(sample.name) || names.includes(sample.name)) {
      throw new Error('RPC samples contain an unapproved name');
    }
    const keys = Object.keys(sample).sort(bytewiseCompare);
    const allowedKeys = ['name', 'status', 'outputKeys', 'primitiveTypes'].sort(bytewiseCompare);
    if (keys.join('\n') !== allowedKeys.join('\n') || !Array.isArray(sample.outputKeys) ||
      !sample.primitiveTypes || typeof sample.primitiveTypes !== 'object' ||
      Array.isArray(sample.primitiveTypes)) {
      throw new Error('RPC samples contain raw output values');
    }
    if (sample.outputKeys.some((key) => typeof key !== 'string' || /buscar_familiar/i.test(key)) ||
      Object.keys(sample.primitiveTypes).some((key) => typeof sample.primitiveTypes[key] !== 'string')) {
      throw new Error('RPC sample output types are invalid');
    }
    const outputKeys = [...sample.outputKeys].sort(bytewiseCompare);
    if (outputKeys.join('\n') !== sample.outputKeys.join('\n') ||
      outputKeys.join('\n') !== Object.keys(sample.primitiveTypes).sort(bytewiseCompare).join('\n')) {
      throw new Error('RPC sample output keys are invalid');
    }
    const primitiveTypes = new Set(['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined']);
    if (Object.values(sample.primitiveTypes).some((type) => !primitiveTypes.has(type))) {
      throw new Error('RPC sample primitive types are invalid');
    }
    names.push(sample.name);
  }

  if (names.slice().sort(bytewiseCompare).join('\n') !== REQUIRED_RPC_NAMES.slice().sort(bytewiseCompare).join('\n')) {
    throw new Error('RPC samples are incomplete');
  }
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(bytewiseCompare);
  const expected = [...expectedKeys].sort(bytewiseCompare);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOnlyObjectKeys(value, allowedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasExactStringList(value, expectedValues) {
  return Array.isArray(value) && value.length === expectedValues.length &&
    value.every((entry, index) => entry === expectedValues[index]);
}

function validateAuthMetadataEvidence(value, allowedFields) {
  if (!hasOnlyObjectKeys(value, allowedFields)) {
    throw new Error('Auth metadata fields are not approved');
  }

  for (const field of Object.keys(value)) {
    const fieldValue = value[field];
    if (field === 'providers' || field === 'roles') {
      if (!Array.isArray(fieldValue) || fieldValue.some((entry) => typeof entry !== 'string')) {
        throw new Error('Auth metadata field types are invalid');
      }
    } else if (typeof fieldValue !== 'string') {
      throw new Error('Auth metadata field types are invalid');
    }
  }
}

function validateAuthFieldPolicy(value) {
  if (!hasExactObjectKeys(value, ['user', 'userMetadata', 'appMetadata']) ||
    !hasExactStringList(value.user, AUTH_USER_FIELDS) ||
    !hasExactStringList(value.userMetadata, AUTH_USER_METADATA_FIELDS) ||
    !hasExactStringList(value.appMetadata, AUTH_APP_METADATA_FIELDS)) {
    throw new Error('Auth field policy is invalid');
  }
}

function validAuthEvidenceTimestamp(value) {
  return value === null || (
    typeof value === 'string' &&
    validIsoTimestamp(value) &&
    new Date(value).toISOString() === value
  );
}

function validateAuthUserEvidence(user) {
  if (!hasExactObjectKeys(user, AUTH_USER_FIELDS) ||
    typeof user.id !== 'string' || user.id.length === 0 ||
    (user.email !== null && typeof user.email !== 'string') ||
    !validAuthEvidenceTimestamp(user.emailConfirmedAt) ||
    !validAuthEvidenceTimestamp(user.createdAt) ||
    !validAuthEvidenceTimestamp(user.updatedAt) ||
    !validAuthEvidenceTimestamp(user.lastSignInAt) ||
    (user.phone !== null && typeof user.phone !== 'string') ||
    typeof user.disabled !== 'boolean') {
    throw new Error('Auth user evidence fields are invalid');
  }

  validateAuthMetadataEvidence(user.userMetadata, AUTH_USER_METADATA_FIELDS);
  validateAuthMetadataEvidence(user.appMetadata, AUTH_APP_METADATA_FIELDS);
}

async function validateAuthEvidence(runDir, expectedUserCount) {
  let users;
  try {
    users = JSON.parse(await readFile(join(runDir, 'auth', 'users.json'), 'utf8'));
  } catch {
    throw new Error('Auth users evidence is invalid or unavailable');
  }
  if (!Array.isArray(users)) throw new Error('Auth users evidence must be a JSON array');

  const metadata = await readJsonFile(join(runDir, 'auth', 'metadata.json'), 'Auth metadata');
  if (!hasExactObjectKeys(metadata, ['count', 'pages', 'fieldPolicy'])) {
    throw new Error('Auth metadata shape is invalid');
  }
  const metadataCount = exactCount(metadata.count);
  const metadataPages = exactCount(metadata.pages);
  if (metadataPages < 1 || metadataPages > AUTH_MAX_PAGES) {
    throw new Error('Auth metadata page count is invalid');
  }
  validateAuthFieldPolicy(metadata.fieldPolicy);

  const seenUserIds = new Set();
  for (const user of users) {
    validateAuthUserEvidence(user);
    if (seenUserIds.has(user.id)) throw new Error('Auth user IDs are duplicated');
    seenUserIds.add(user.id);
  }

  if (metadataCount !== users.length || exactCount(expectedUserCount) !== users.length) {
    throw new Error('Auth users evidence does not match metadata or source counts');
  }
  return users.length;
}

async function validatePostgresEvidence(runDir, expectedCounts) {
  const objectCounts = await readPostgresObjectCounts({
    postgres: join(runDir, 'postgres'),
  });
  const expectedTables = Array.isArray(expectedCounts?.tables)
    ? [...expectedCounts.tables].sort((left, right) => bytewiseCompare(left.relation, right.relation))
    : undefined;
  const actualTables = [...objectCounts.tables]
    .sort((left, right) => bytewiseCompare(left.relation, right.relation));
  if (!expectedCounts || exactCount(expectedCounts.tableCount) !== objectCounts.tableCount ||
    !expectedTables || JSON.stringify(expectedTables) !== JSON.stringify(actualTables)) {
    throw new Error('PostgreSQL object counts do not match source counts');
  }
  return objectCounts;
}

async function inventoryStorageObjects(objectsRoot) {
  const objectKeys = new Set();
  const physicalBuckets = new Set();

  async function visitBucket(bucket, directory, segments = []) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error('Storage objects could not be enumerated');
    }
    entries.sort((left, right) => bytewiseCompare(left.name, right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Storage objects may not contain symbolic links');
      const safeSegment = safeStorageSegment(entry.name, 'object');
      const nextSegments = [...segments, safeSegment];
      const candidate = join(directory, entry.name);
      const candidateRelative = relative(objectsRoot, candidate);
      if (candidateRelative === '..' || candidateRelative.startsWith(`..${sep}`) || isAbsolute(candidateRelative)) {
        throw new Error('Storage object path escapes the objects directory');
      }
      if (entry.isDirectory()) {
        await visitBucket(bucket, candidate, nextSegments);
      } else if (entry.isFile()) {
        safeStorageObjectPath(nextSegments.join('/'));
        objectKeys.add(`${bucket}/${nextSegments.join('/')}`);
      } else {
        throw new Error('Storage objects contain an unsupported file type');
      }
    }
  }

  let bucketEntries;
  try {
    bucketEntries = await readdir(objectsRoot, { withFileTypes: true });
  } catch {
    throw new Error('Storage objects could not be enumerated');
  }
  bucketEntries.sort((left, right) => bytewiseCompare(left.name, right.name));
  for (const entry of bucketEntries) {
    if (entry.isSymbolicLink()) throw new Error('Storage objects may not contain symbolic links');
    if (!entry.isDirectory()) throw new Error('Storage objects contain an invalid bucket entry');
    const bucket = safeStorageSegment(entry.name, 'bucket');
    physicalBuckets.add(bucket);
    await visitBucket(bucket, join(objectsRoot, entry.name));
  }

  return { objectKeys, physicalBuckets };
}

function validStorageManifestMime(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (!/^[^/\s]+\/[^/\s]+(?:\s*;.*)?$/.test(value)) return false;
  try {
    return storageMime(value, 'manifest MIME') === value;
  } catch {
    return false;
  }
}

function validateStorageBucketMetadata(value, expectedBucketCount) {
  if (!hasExactObjectKeys(value, ['buckets']) || !Array.isArray(value.buckets)) {
    throw new Error('Storage bucket metadata shape is invalid');
  }

  const buckets = value.buckets.map((bucket) => safeStorageSegment(bucket, 'bucket'));
  const uniqueBuckets = new Set(buckets);
  if (uniqueBuckets.size !== buckets.length || exactCount(expectedBucketCount) !== uniqueBuckets.size) {
    throw new Error('Storage bucket metadata does not match source counts');
  }
  return uniqueBuckets;
}

async function validateStorageErrorReport(runDir) {
  const reportPath = join(runDir, 'storage', 'error-report.json');
  if (!existsSync(reportPath)) return;

  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    throw new Error('Storage error report is invalid');
  }
  if (!hasExactObjectKeys(report, ['errors']) || !Array.isArray(report.errors) || report.errors.length === 0) {
    throw new Error('Storage error report shape is invalid');
  }

  const operations = new Set(['bucket list', 'object list', 'download', 'download stream']);
  for (const error of report.errors) {
    if (!hasExactObjectKeys(error, ['operation', 'retries', 'status']) ||
      !operations.has(error.operation) ||
      !Number.isSafeInteger(error.retries) || error.retries < 0 || error.retries > 1 ||
      !(error.status === 'network' || error.status === 'unknown' ||
        (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599))) {
      throw new Error('Storage error report entries are invalid');
    }
  }
}

async function validateStorageEvidence(runDir, expectedObjectCount, expectedBucketCount) {
  let content;
  try {
    content = await readFile(join(runDir, 'storage', 'manifest.jsonl'), 'utf8');
  } catch {
    throw new Error('Storage manifest is invalid or unavailable');
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  const objectCount = exactCount(expectedObjectCount);
  if (lines.length !== objectCount) {
    throw new Error('Storage manifest row count does not match source counts');
  }

  let bucketMetadata;
  try {
    bucketMetadata = JSON.parse(await readFile(join(runDir, 'storage', 'buckets.json'), 'utf8'));
  } catch {
    throw new Error('Storage bucket metadata is invalid or unavailable');
  }
  const approvedBuckets = validateStorageBucketMetadata(bucketMetadata, expectedBucketCount);
  await validateStorageErrorReport(runDir);

  const inventory = await inventoryStorageObjects(join(runDir, 'storage', 'objects'));
  if ([...inventory.physicalBuckets].some((bucket) => !approvedBuckets.has(bucket))) {
    throw new Error('Storage objects contain an unapproved bucket');
  }

  const objectsRoot = join(runDir, 'storage', 'objects');
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error('Storage manifest contains invalid JSON');
    }
    if (!hasExactObjectKeys(entry, ['bucket', 'path', 'bytes', 'mime', 'sha256']) ||
      typeof entry.bucket !== 'string' || typeof entry.path !== 'string' ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
      !validStorageManifestMime(entry.mime) ||
      typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Storage manifest contains invalid object evidence');
    }

    let objectPath;
    try {
      const bucket = safeStorageSegment(entry.bucket, 'bucket');
      const segments = safeStorageObjectPath(entry.path);
      const objectKey = `${bucket}/${segments.join('/')}`;
      if (!approvedBuckets.has(bucket)) throw new Error('unapproved bucket');
      if (seen.has(objectKey)) throw new Error('duplicate object');
      seen.add(objectKey);
      objectPath = join(objectsRoot, bucket, ...segments);
      const relativeObjectPath = relative(objectsRoot, objectPath);
      if (relativeObjectPath === '..' || relativeObjectPath.startsWith(`..${sep}`) || isAbsolute(relativeObjectPath)) {
        throw new Error('object path escapes Storage objects');
      }
    } catch {
      throw new Error('Storage manifest contains an unsafe object path');
    }

    let contentBuffer;
    try {
      if (!statSync(objectPath).isFile()) throw new Error('not a file');
      contentBuffer = await readFile(objectPath);
    } catch {
      throw new Error('Storage manifest object is missing');
    }
    const digest = createHash('sha256').update(contentBuffer).digest('hex');
    if (contentBuffer.byteLength !== entry.bytes || digest !== entry.sha256) {
      throw new Error('Storage manifest object bytes or checksum do not match');
    }
  }
  const manifestKeys = new Set(seen);
  const physicalOnly = [...inventory.objectKeys].filter((key) => !manifestKeys.has(key));
  const manifestOnly = [...manifestKeys].filter((key) => !inventory.objectKeys.has(key));
  if (physicalOnly.length > 0 || manifestOnly.length > 0) {
    throw new Error('Storage physical objects and manifest do not match');
  }
  return lines.length;
}

async function validateReconciliation(runDir, run) {
  const sourceCounts = await readJsonFile(
    join(runDir, 'reconciliation', 'source-counts.json'),
    'Source counts',
  );
  const financialTotals = await readJsonFile(
    join(runDir, 'reconciliation', 'financial-totals.json'),
    'Financial totals',
  );
  let rpcSamples;
  try {
    rpcSamples = JSON.parse(await readFile(join(runDir, 'reconciliation', 'rpc-samples.json'), 'utf8'));
  } catch {
    throw new Error('RPC samples are invalid or unavailable');
  }

  if (financialTotals.query !== 'financial_totals' || financialTotals.schema !== 'public') {
    throw new Error('Financial totals query metadata is invalid');
  }
  const totals = normalizeFinancialTotals(financialTotals.totals);
  validateRpcSamples(rpcSamples);
  if (!sourceCounts.postgres || !sourceCounts.auth || !sourceCounts.storage ||
    !run.counts || JSON.stringify(sourceCounts) !== JSON.stringify(run.counts)) {
    throw new Error('Source counts do not match the run manifest');
  }
  await validateAuthEvidence(runDir, run.counts.auth.userCount);
  await validatePostgresEvidence(runDir, run.counts.postgres);
  await validateStorageEvidence(
    runDir,
    run.counts.storage.objectCount,
    run.counts.storage.bucketCount,
  );
  return { sourceCounts, financialTotals: totals, rpcSamples };
}

function restoreTargetError(message) {
  const error = new Error(message);
  error.code = 'EXPORT_FAILED';
  return error;
}

export function assertSafeRestoreTarget(restoreDb, projectTarget) {
  if (projectTarget !== 'demo-donaciones-venezuela') {
    throw restoreTargetError('Restore project target is not approved');
  }
  let connection;
  try {
    connection = parsePostgresConnection(restoreDb);
  } catch {
    throw restoreTargetError('Restore database must be a valid PostgreSQL URL');
  }
  if (!['localhost', '127.0.0.1'].includes(connection.PGHOST.toLowerCase())) {
    throw restoreTargetError('Restore database host must be localhost or 127.0.0.1');
  }
  return connection;
}

function buildRestoreInvocation(connection, schemaFile, dataFile) {
  const env = {
    PGHOST: connection.PGHOST,
    PGPORT: connection.PGPORT,
    PGUSER: connection.PGUSER,
    PGDATABASE: connection.PGDATABASE,
    PGPASSWORD: connection.PGPASSWORD,
    PGSSLMODE: 'prefer',
  };
  const commonArgs = [
    '--host', connection.PGHOST,
    '--port', connection.PGPORT,
    '--username', connection.PGUSER,
    '--dbname', connection.PGDATABASE,
  ];

  return {
    schema: {
      args: [
        ...commonArgs,
        '--set=ON_ERROR_STOP=1',
        '--file', schemaFile,
      ],
      env,
    },
    data: {
      args: [
        ...commonArgs,
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--single-transaction',
        dataFile,
      ],
      env,
    },
  };
}

function derivedArchivePath(runDir) {
  const resolvedRunDir = resolve(runDir);
  return join(dirname(resolvedRunDir), `${basename(resolvedRunDir)}.tar.age`);
}

export async function verifyRun(runDir, options = {}) {
  const checks = {
    structure: false,
    completeness: false,
    manifest: false,
    checksums: false,
    reconciliation: false,
    archive: false,
    restore: options.restoreDb === undefined,
  };
  const errors = [];
  const counts = {};
  let run;
  let actualArtifacts = [];

  if (!isNonEmptyString(runDir) || runDir.includes('\0')) {
    errors.push('Run directory is required');
  } else {
    try {
      if (!statSync(runDir).isDirectory()) throw new Error('not a directory');
      checks.structure = true;
    } catch {
      errors.push('Run directory is unavailable');
    }
  }

  if (checks.structure) {
    try {
      run = await readJsonFile(join(runDir, 'run.json'), 'Run manifest');
      if (run.status !== 'completed') throw new Error('Run status is not completed');
      if (run.projectRef !== EXPECTED_PROJECT_REF) throw new Error('Run project reference is not approved');
      if (!validIsoTimestamp(run.createdAt) || !validIsoTimestamp(run.updatedAt)) {
        throw new Error('Run timestamps are invalid');
      }
      if (!Array.isArray(run.artifacts) || run.artifacts.length === 0 ||
        new Set(run.artifacts).size !== run.artifacts.length ||
        run.artifacts.includes(CHECKSUM_FILE_NAME) ||
        run.artifacts.some((value) => !checksumPathIsSafe(value))) {
        throw new Error('Run manifest artifact list is invalid');
      }
      checks.manifest = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Run manifest is invalid');
    }

    try {
      actualArtifacts = await listFinalArtifacts(runDir);
      assertAllowedFinalArtifacts(actualArtifacts);
      const missing = setDifference(REQUIRED_RUN_ARTIFACTS, actualArtifacts);
      const unlisted = run?.artifacts ? setDifference(actualArtifacts, run.artifacts) : [];
      const listedMissing = run?.artifacts ? setDifference(run.artifacts, actualArtifacts) : REQUIRED_RUN_ARTIFACTS;
      if (missing.length > 0 || unlisted.length > 0 || listedMissing.length > 0) {
        throw new Error('Required export evidence or manifest artifacts are missing');
      }
      await assertValidDumpArtifacts(runDir, options.dumpRunner || runCommand);
      checks.completeness = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Export evidence is incomplete');
    }

    try {
      const entries = await readChecksumEntries(runDir);
      const checksumPaths = [...entries.keys()].sort(bytewiseCompare);
      if (checksumPaths.join('\n') !== actualArtifacts.join('\n')) {
        throw new Error('Checksum entries do not match final artifacts');
      }
      for (const [relativePath, expected] of entries) {
        const content = await readFile(join(runDir, ...relativePath.split('/')));
        const actual = createHash('sha256').update(content).digest('hex');
        if (actual !== expected) throw new Error('Checksum mismatch in export artifact');
      }
      checks.checksums = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Checksum verification failed');
    }

    try {
      const reconciliation = await validateReconciliation(runDir, run);
      Object.assign(counts, reconciliation.sourceCounts);
      checks.reconciliation = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Reconciliation evidence is invalid');
    }

    if (options.requireArchive !== false) {
      try {
        const archivePath = options.archivePath || derivedArchivePath(runDir);
        if (!archivePath.toLowerCase().endsWith('.tar.age') ||
          !statSync(archivePath).isFile() || statSync(archivePath).size === 0) {
          throw new Error('Encrypted archive is missing or empty');
        }
        checks.archive = true;
      } catch {
        errors.push('Encrypted archive is missing or empty');
      }
    } else {
      checks.archive = true;
    }

    if (options.restoreDb !== undefined) {
      let restoreConnection;
      try {
        restoreConnection = assertSafeRestoreTarget(options.restoreDb, options.projectTarget);
      } catch (error) {
        checks.restore = false;
        errors.push(redactText(
          error instanceof Error ? error.message : 'Local restore target is not approved',
          collectSensitiveValues({ PGPASSWORD: options.restoreDb }),
        ));
      }

      const restorePreconditions = restoreConnection && checks.structure && checks.manifest &&
        checks.completeness && checks.checksums && checks.reconciliation &&
        (options.requireArchive === false || checks.archive);
      if (restoreConnection && !restorePreconditions) {
        checks.restore = false;
        errors.push('Local restore skipped because verification controls failed');
      } else if (restoreConnection) {
        try {
          const invocations = buildRestoreInvocation(
            restoreConnection,
            join(runDir, 'postgres', 'schema.sql'),
            join(runDir, 'postgres', 'data.dump'),
          );
          for (const [command, invocation] of [
            ['psql', invocations.schema],
            ['pg_restore', invocations.data],
          ]) {
            const result = await invokeExportCommand(
              options.runner || runCommand,
              command,
              invocation.args,
              { env: invocation.env },
            );
            if (result.code !== 0) throw commandFailure(command, result);
          }
          checks.restore = true;
        } catch (error) {
          checks.restore = false;
          errors.push(redactText(
            error instanceof Error ? error.message : 'Local restore failed',
            collectSensitiveValues({ PGPASSWORD: options.restoreDb }),
          ));
        }
      }
    }
  }

  if (options.restoreDb !== undefined && !checks.structure) {
    errors.push('Local restore not-run because the run directory is unavailable');
  }

  return {
    ok: errors.length === 0 && Object.values(checks).every(Boolean),
    checks,
    errors,
    counts,
  };
}

function sealEnvironment(recipient) {
  const environment = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot']) {
    if (isNonEmptyString(process.env[name])) environment[name] = process.env[name];
  }
  environment.EXPORT_AGE_RECIPIENT = recipient;
  return environment;
}

function sealError(error, recipient) {
  const safe = new Error(redactText(
    error instanceof Error ? error.message : 'Export sealing failed',
    [recipient],
  ));
  safe.code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'EXPORT_FAILED';
  return safe;
}

function safeFailureCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const postgres = value.postgres;
  const auth = value.auth;
  const storage = value.storage;
  if (!postgres || !auth || !storage || !Array.isArray(postgres.tables)) return undefined;
  return {
    postgres: {
      tableCount: postgres.tableCount,
      tables: postgres.tables
        .filter((table) => table && typeof table.relation === 'string')
        .map((table) => ({ relation: table.relation, count: table.count })),
    },
    auth: { userCount: auth.userCount },
    storage: { bucketCount: storage.bucketCount, objectCount: storage.objectCount },
  };
}

async function markSealRunFailed(paths, error, redactValues = []) {
  let existing;
  try {
    existing = JSON.parse(await readFile(runStatusPath(paths), 'utf8'));
  } catch {
    return writeRunStatus(paths, 'failed', error);
  }

  const now = new Date().toISOString();
  const record = {
    projectRef: existing.projectRef === EXPECTED_PROJECT_REF ? existing.projectRef : undefined,
    createdAt: validIsoTimestamp(existing.createdAt) ? existing.createdAt : now,
    updatedAt: now,
    commandVersions: safeCommandVersions(existing.commandVersions, redactValues),
    artifacts: Array.isArray(existing.artifacts)
      ? existing.artifacts.filter((value) => checksumPathIsSafe(value))
      : undefined,
    counts: safeFailureCounts(existing.counts),
    status: 'failed',
    errorCode: safeErrorCode(error),
  };
  const safeRecord = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
  await writeFile(runStatusPath(paths), `${JSON.stringify(safeRecord, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  const checksumPath = join(paths.root, CHECKSUM_FILE_NAME);
  if (existsSync(checksumPath)) {
    const artifacts = await listFinalArtifacts(paths.root);
    const checksumLines = await buildChecksumLines(paths.root, artifacts);
    await writeFile(checksumPath, `${checksumLines.join('\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
  return safeRecord;
}

function childProcessResult(child, label) {
  return new Promise((resolveResult, reject) => {
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stderr?.on('data', (chunk) => {
      stderr += chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
    });
    child.once('error', (error) => finish(() => reject(new Error(
      `${label} could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
    ))));
    child.once('close', (code) => finish(() => {
      if (code !== 0) {
        const error = new Error(`${label} exited with code ${Number.isInteger(code) ? code : 'unknown'}`);
        error.code = 'COMMAND_EXIT';
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolveResult();
    }));
  });
}

async function nativeSealPipeline(spec, runner) {
  const spawnImpl = runner && typeof runner === 'object' && typeof runner.spawnImpl === 'function'
    ? runner.spawnImpl
    : nodeSpawn;
  const environment = spec.env;
  let tarChild;
  let ageChild;
  try {
    tarChild = spawnImpl(spec.tar.command, spec.tar.args, {
      cwd: spec.paths.root,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ageChild = spawnImpl(spec.age.command, spec.age.args, {
      cwd: spec.paths.root,
      env: environment,
      shell: false,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    tarChild.stdout?.pipe(ageChild.stdin);
    const tarResult = childProcessResult(tarChild, 'tar');
    const ageResult = childProcessResult(ageChild, 'age');
    await Promise.all([tarResult, ageResult]);
  } catch (error) {
    try { tarChild?.kill?.('SIGTERM'); } catch { /* Keep the original sealing error. */ }
    try { ageChild?.kill?.('SIGTERM'); } catch { /* Keep the original sealing error. */ }
    throw error;
  }
}

async function invokeInjectedSealRunner(runner, spec) {
  if (runner && typeof runner.runPipeline === 'function') {
    await runner.runPipeline(spec);
    return;
  }

  if (typeof runner !== 'function' || runner === runCommand) {
    await nativeSealPipeline(spec, runner);
    return;
  }

  const tarResult = await runner(spec.tar.command, spec.tar.args, {
    env: spec.env,
    shell: false,
    streamTo: spec.age.command,
  });
  if (!tarResult || tarResult.code !== 0) throw commandFailure('tar', tarResult);
  const ageResult = await runner(spec.age.command, spec.age.args, {
    env: spec.env,
    shell: false,
    input: tarResult.stdout,
  });
  if (!ageResult || ageResult.code !== 0) throw commandFailure('age', ageResult);
}

export async function sealRun(paths, recipient, runner) {
  const temporaryArchive = paths && isNonEmptyString(paths.temp) && isNonEmptyString(paths.root)
    ? join(paths.temp, 'run.tar')
    : undefined;
  const archivePath = paths && isNonEmptyString(paths.root)
    ? join(dirname(paths.root), `${basename(paths.root)}.tar.age`)
    : undefined;
  let sealingAttemptStarted = false;

  try {
    if (!paths || !isNonEmptyString(paths.root) || !isNonEmptyString(paths.temp) ||
      !isNonEmptyString(recipient)) {
      throw new Error('A complete run and an age recipient are required for sealing');
    }
    if (existsSync(archivePath)) throw new Error('Encrypted archive already exists');
    let status;
    try {
      status = JSON.parse(await readFile(runStatusPath(paths), 'utf8')).status;
    } catch {
      throw new Error('Run status is unavailable; sealing refused');
    }
    if (status !== 'completed') throw new Error(`Run status ${status || 'unknown'} cannot be sealed`);

    const dumpRunner = typeof runner === 'function'
      ? runner
      : runner && typeof runner.runCommand === 'function'
        ? runner.runCommand.bind(runner)
        : undefined;
    const verification = await verifyRun(paths.root, {
      requireArchive: false,
      dumpRunner,
    });
    if (!verification.ok) throw new Error('Run evidence is incomplete; sealing refused');

    const spec = {
      paths,
      temporaryArchive,
      archivePath,
      env: sealEnvironment(recipient),
      tar: {
        command: commandExecutable('tar', runner),
        args: ['--create', '--directory', paths.root, '--exclude=./temp', '--file=-', '.'],
        options: { env: sealEnvironment(recipient), shell: false },
      },
      age: {
        command: commandExecutable('age', runner),
        args: ['--recipient', recipient, '--output', archivePath],
        options: { env: sealEnvironment(recipient), shell: false },
      },
    };

    sealingAttemptStarted = true;
    await invokeInjectedSealRunner(runner, spec);
    try {
      if (!statSync(archivePath).isFile() || statSync(archivePath).size === 0) {
        throw new Error('Encrypted archive was not created');
      }
    } catch {
      throw new Error('Encrypted archive was not created');
    }
    await rm(temporaryArchive, { force: true });
    return archivePath;
  } catch (error) {
    const safe = sealError(error, recipient);
    if (sealingAttemptStarted) await rm(archivePath, { force: true }).catch(() => {});
    await markSealRunFailed(paths, safe, [recipient]).catch(() => {});
    throw safe;
  }
}

function runWindowsAclCommand(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    try {
      child = nodeSpawn(command, args, {
        shell: false,
        env: options.env || {},
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new Error('Windows export ACL command failed'));
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', () => reject(new Error('Windows export ACL command failed')));
    child.once('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

function normalizeWindowsAclPrincipal(value) {
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'nt authority\\system' ? 'system' : normalized;
}

function windowsAclPrincipals(value) {
  const principals = new Set();
  const pattern = /(?:^|\s)([^:\r\n]+):(?=\()/g;
  for (const line of String(value || '').split(/\r?\n/)) {
    for (const match of line.matchAll(pattern)) {
      const principal = normalizeWindowsAclPrincipal(match[1]);
      if (principal) principals.add(principal);
    }
  }
  return principals;
}

async function applyAndVerifyWindowsAcl(runRoot, options = {}) {
  const domain = valueOrUndefined(options.aclDomain) || valueOrUndefined(process.env.USERDOMAIN);
  const username = valueOrUndefined(options.aclUsername) || valueOrUndefined(process.env.USERNAME);
  const account = valueOrUndefined(options.aclAccount) || (domain && username ? `${domain}\\${username}` : username);
  if (!account) throw new Error('Windows export ACL identity is unavailable');

  const systemRoot = valueOrUndefined(options.systemRoot) || valueOrUndefined(process.env.SystemRoot);
  if (!systemRoot || !win32.isAbsolute(systemRoot)) {
    throw new Error('Windows export ACL system root is unavailable');
  }
  const icacls = win32.join(systemRoot, 'System32', 'icacls.exe');
  const aclEnvironment = Object.freeze({ SystemRoot: systemRoot });

  const runner = typeof options.aclRunner === 'function' ? options.aclRunner : runWindowsAclCommand;
  const grant = `${account}:(OI)(CI)(F)`;
  const runAcl = (args) => runner(icacls, args, {
    env: aclEnvironment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const applyResult = await runAcl([
    runRoot,
    '/inheritance:r',
    '/grant:r', grant,
    '/grant:r', 'SYSTEM:(OI)(CI)(F)',
    '/T',
  ]);
  if (!applyResult || applyResult.code !== 0) {
    throw new Error('Windows export ACL could not be applied');
  }

  const verifyResult = await runAcl([runRoot, '/T']);
  if (!verifyResult || verifyResult.code !== 0) {
    throw new Error('Windows export ACL could not be verified');
  }

  const aclText = `${verifyResult.stdout || ''}\n${verifyResult.stderr || ''}`;
  const actualPrincipals = windowsAclPrincipals(aclText);
  const expectedPrincipals = new Set([
    normalizeWindowsAclPrincipal(account),
    'system',
  ]);
  if (actualPrincipals.size !== expectedPrincipals.size ||
    [...actualPrincipals].some((principal) => !expectedPrincipals.has(principal))) {
    throw new Error('Windows export ACL is not restricted to approved principals');
  }
}

export async function createRunDirectory(outputRoot, timestamp, repoRoot = process.cwd(), options = {}) {
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
    if ((options.platform || process.platform) === 'win32') {
      await applyAndVerifyWindowsAcl(root, options);
    }
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
  const requestedStoragePageSize = options && typeof options === 'object'
    ? options.storagePageSize
    : undefined;
  const environmentProjectRef = valueOrUndefined(source.SUPABASE_PROJECT_REF);

  if (environmentProjectRef && environmentProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }
  if (requestedProjectRef && requestedProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }

  const executionApproved = execute && valueOrUndefined(source.EXPORT_EXECUTION_APPROVED) === 'YES';
  if (execute && !executionApproved) {
    throw new Error('EXPORT_EXECUTION_APPROVED=YES is required for execute mode');
  }

  if (requestedStoragePageSize !== undefined &&
    (!Number.isSafeInteger(requestedStoragePageSize) || requestedStoragePageSize < 1 ||
      requestedStoragePageSize > STORAGE_PAGE_SIZE)) {
    throw new Error('Supabase Storage page size is invalid');
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
    storagePageSize: requestedStoragePageSize,
  };

  if (execute) APPROVED_EXECUTION_CONFIGS.add(config);

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

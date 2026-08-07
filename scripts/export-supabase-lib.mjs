import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

export const EXPECTED_PROJECT_REF = 'zryfwbjvlacorryzdaod';

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
  const pathApi = useWindowsPaths ? win32 : { relative, isAbsolute, sep };

  if (isInsideOrEqual(candidate, repository, pathApi) || hasProtectedSegment(candidate)) {
    throw new Error('Export output root must be outside the repository and protected directories');
  }

  return candidate;
}

function parseSupabaseUrl(value) {
  if (!isNonEmptyString(value)) return undefined;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('invalid URL');
    }
    return parsed.origin;
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL');
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

function safeConfigSummary(config) {
  return {
    projectRef: config.projectRef,
    supabaseUrl: config.supabaseUrl,
    dbUrl: config.dbUrl ? '[redacted]' : undefined,
    serviceRoleKey: config.serviceRoleKey ? '[redacted]' : undefined,
    outputRoot: config.outputRoot,
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
  const environmentProjectRef = valueOrUndefined(source.SUPABASE_PROJECT_REF);

  if (environmentProjectRef && environmentProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }
  if (requestedProjectRef && requestedProjectRef !== EXPECTED_PROJECT_REF) {
    throw new Error('Invalid Supabase project reference');
  }

  const projectRef = requestedProjectRef || environmentProjectRef;
  const supabaseUrl = parseSupabaseUrl(source.SUPABASE_URL);
  const dbUrl = parseDatabaseUrl(source.SUPABASE_DB_URL);
  const serviceRoleKey = valueOrUndefined(source.SUPABASE_SERVICE_ROLE_KEY);
  const outputValue = valueOrUndefined(source.EXPORT_ROOT);
  const outputRoot = outputValue ? assertSafeOutputRoot(outputValue, repoRoot) : undefined;
  const ageRecipient = valueOrUndefined(source.EXPORT_AGE_RECIPIENT);
  const missingVariables = REQUIRED_EXPORT_VARIABLES.filter((name) => {
    if (name === 'SUPABASE_PROJECT_REF') return !projectRef;
    return !valueOrUndefined(source[name]);
  });

  if (execute && missingVariables.length > 0) {
    throw new Error(`Missing required export variables: ${missingVariables.join(', ')}`);
  }

  const config = {
    projectRef,
    supabaseUrl,
    outputRoot,
    ageRecipient,
    repoRoot: resolvePathForInput(repoRoot),
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

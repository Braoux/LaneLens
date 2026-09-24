const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'cookie',
  'setcookie',
  'password',
  'secret',
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[_-]/g, '');
}

function sanitizeString(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactLogFields(serializeError(value, true), seen);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.has(normalizedKey(key))
      ? '[REDACTED]'
      : redactValue(item, seen);
  }
  return output;
}

export function redactLogFields(
  fields: Readonly<Record<string, unknown>>,
  seen = new WeakSet<object>(),
): Record<string, unknown> {
  return redactValue(fields, seen) as Record<string, unknown>;
}

export function serializeError(
  error: unknown,
  includeStack = false,
): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError', errorMessage: 'Erreur non standard.' };
  }

  const serialized: Record<string, unknown> = {
    errorName: error.name,
    errorMessage: sanitizeString(error.message),
  };
  if (includeStack && typeof error.stack === 'string') {
    serialized.errorStack = sanitizeString(error.stack);
  }
  return serialized;
}

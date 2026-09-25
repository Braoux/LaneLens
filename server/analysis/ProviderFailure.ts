export type ProviderFailureCategory =
  | 'authentication'
  | 'rate_limit'
  | 'model_not_found'
  | 'invalid_request'
  | 'timeout'
  | 'network'
  | 'provider_server_error'
  | 'unknown';

export interface ProviderFailureDetails {
  readonly provider: string;
  readonly model?: string;
  readonly category: ProviderFailureCategory;
  readonly status?: number;
  readonly errorName?: string;
  readonly errorMessage?: string;
}

const MAX_PROVIDER_ERROR_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status;
  return typeof status === 'number'
    && Number.isSafeInteger(status)
    && status >= 100
    && status <= 599
    ? status
    : undefined;
}

function readText(error: unknown): string {
  if (!isRecord(error)) return '';
  return [error.name, error.code, error.type, error.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('en-US');
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\b(provider[_-]?path|path)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z]:\\[^\s,;"']+/g, '[REDACTED_PATH]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\s,;"']+/g, '[REDACTED_PATH]')
    .slice(0, MAX_PROVIDER_ERROR_LENGTH);
}

function readSafeErrorName(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.name !== 'string') return undefined;
  const value = error.name.trim();
  return value.length === 0 ? undefined : value.slice(0, 100);
}

function readSafeErrorMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const externalError = isRecord(error.error) ? error.error : undefined;
  const rawMessage = typeof externalError?.message === 'string'
    ? externalError.message
    : typeof error.message === 'string'
      ? error.message
      : undefined;
  if (rawMessage === undefined) return undefined;
  const value = sanitizeProviderText(rawMessage.trim());
  return value.length === 0 ? undefined : value;
}

export function classifyProviderFailure(error: unknown): Pick<
  ProviderFailureDetails,
  'category' | 'status'
> {
  const status = readStatus(error);
  const text = readText(error);
  let category: ProviderFailureCategory = 'unknown';

  if (status === 429) {
    category = 'rate_limit';
  } else if (status === 401 || status === 403) {
    category = 'authentication';
  } else if (status === 404 && /model/.test(text)) {
    category = 'model_not_found';
  } else if (status === 400 || status === 404) {
    category = 'invalid_request';
  } else if (status !== undefined && status >= 500) {
    category = 'provider_server_error';
  } else if (status === 408 || /timeout|timed.?out|aborterror/.test(text)) {
    category = 'timeout';
  } else if (/rate.?limit|quota|credit/.test(text)) {
    category = 'rate_limit';
  } else if (/auth|api.?key|permission/.test(text)) {
    category = 'authentication';
  } else if (/invalid.?request|bad.?request/.test(text)) {
    category = 'invalid_request';
  } else if (/network|fetch failed|econn|enotfound|socket/.test(text)) {
    category = 'network';
  }

  return status === undefined ? { category } : { category, status };
}

export class ProviderFailureError extends Error {
  readonly provider: string;
  readonly model?: string;
  readonly category: ProviderFailureCategory;
  readonly status?: number;
  readonly errorName?: string;
  readonly errorMessage?: string;

  constructor(
    details: ProviderFailureDetails,
    safeMessage = 'Le provider d’analyse est indisponible.',
  ) {
    super(safeMessage);
    this.name = 'ProviderFailureError';
    this.provider = details.provider;
    this.model = details.model;
    this.category = details.category;
    this.status = details.status;
    this.errorName = details.errorName;
    this.errorMessage = details.errorMessage;
  }
}

export function providerFailureDetails(
  provider: string,
  model: string | undefined,
  error: unknown,
): ProviderFailureDetails {
  return {
    provider,
    model,
    ...classifyProviderFailure(error),
    errorName: readSafeErrorName(error),
    errorMessage: readSafeErrorMessage(error),
  };
}

export function findProviderFailure(error: unknown): ProviderFailureError | undefined {
  let current = error;
  const seen = new Set<unknown>();

  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof ProviderFailureError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

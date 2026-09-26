import {
  ANALYSIS_FEEDBACK_CATEGORIES,
  BUG_FEEDBACK_CATEGORIES,
  FEEDBACK_VIEWS,
  type FeedbackClientContext,
  type FeedbackMatchupContext,
  type FeedbackRequest,
} from '../../shared/feedback-contract.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  // Les caractères de contrôle sont volontairement rejetés.
  // eslint-disable-next-line no-control-regex
  if (normalized.length === 0 || normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function optionalString(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return boundedString(value, max) ?? null;
}

function clientContext(value: unknown): FeedbackClientContext | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = ['view', 'viewport', 'userAgent', 'appVersion', 'requestId'];
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.includes(key)) || !actual.includes('view') || !actual.includes('viewport')) {
    return undefined;
  }
  if (
    typeof value.view !== 'string'
    || !FEEDBACK_VIEWS.includes(value.view as FeedbackClientContext['view'])
    || !isRecord(value.viewport)
    || !exactKeys(value.viewport, ['width', 'height'])
    || !Number.isInteger(value.viewport.width)
    || !Number.isInteger(value.viewport.height)
    || (value.viewport.width as number) < 1
    || (value.viewport.width as number) > 10_000
    || (value.viewport.height as number) < 1
    || (value.viewport.height as number) > 10_000
  ) return undefined;

  const userAgent = optionalString(value.userAgent, 512);
  const appVersion = optionalString(value.appVersion, 64);
  const requestId = optionalString(value.requestId, 64);
  if (userAgent === null || appVersion === null || requestId === null) return undefined;
  if (requestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    return undefined;
  }

  return {
    view: value.view as FeedbackClientContext['view'],
    viewport: { width: value.viewport.width as number, height: value.viewport.height as number },
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function matchupContext(value: unknown): FeedbackMatchupContext | undefined {
  if (!isRecord(value) || !exactKeys(value, [
    'allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch',
  ])) return undefined;
  const fields = ['allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch'] as const;
  const output: Record<string, string> = {};
  for (const field of fields) {
    const normalized = boundedString(value[field], field === 'patch' ? 32 : 64);
    if (normalized === undefined) return undefined;
    output[field] = normalized;
  }
  return output as unknown as FeedbackMatchupContext;
}

export function normalizeFeedbackRequest(value: unknown): FeedbackRequest | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  const comment = optionalString(value.comment, 1000);
  if (comment === null) return undefined;
  const client = clientContext(value.client);
  if (client === undefined || typeof value.category !== 'string') return undefined;

  if (value.kind === 'analysis') {
    if (!exactKeys(value, value.comment === undefined
      ? ['kind', 'category', 'client', 'matchup']
      : ['kind', 'category', 'comment', 'client', 'matchup'])) return undefined;
    if (!ANALYSIS_FEEDBACK_CATEGORIES.includes(value.category as never)) return undefined;
    const matchup = matchupContext(value.matchup);
    if (matchup === undefined) return undefined;
    return {
      kind: 'analysis',
      category: value.category as Extract<FeedbackRequest, { kind: 'analysis' }>['category'],
      ...(comment === undefined ? {} : { comment }),
      client,
      matchup,
    };
  }

  if (value.kind === 'bug') {
    if (!exactKeys(value, value.comment === undefined
      ? ['kind', 'category', 'client']
      : ['kind', 'category', 'comment', 'client'])) return undefined;
    if (!BUG_FEEDBACK_CATEGORIES.includes(value.category as never)) return undefined;
    return {
      kind: 'bug',
      category: value.category as Extract<FeedbackRequest, { kind: 'bug' }>['category'],
      ...(comment === undefined ? {} : { comment }),
      client,
    };
  }

  return undefined;
}


import {
  ANALYSIS_TELEMETRY_ERROR_CODES,
  TELEMETRY_EVENTS,
} from '../../shared/telemetry-contract.js';
import type {
  AnalysisFailedTelemetryContext,
  AnalysisStartedTelemetryContext,
  FeedbackOpenedTelemetryContext,
  FeedbackSubmittedTelemetryContext,
  TelemetryRequest,
} from '../../shared/telemetry-contract.js';
import {
  ANALYSIS_FEEDBACK_CATEGORIES,
  BUG_FEEDBACK_CATEGORIES,
} from '../../shared/feedback-contract.js';
import type {
  AnalysisFeedbackCategory,
  BugFeedbackCategory,
} from '../../shared/feedback-contract.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PATCH_PATTERN = /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/u;
const CHAMPION_PATTERN = /^[\p{L}\p{N} .'-]{1,40}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function normalizedPatch(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const patch = value.trim();
  return PATCH_PATTERN.test(patch) ? patch : undefined;
}

function normalizedChampion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const champion = value.trim();
  return CHAMPION_PATTERN.test(champion) ? champion : undefined;
}

function normalizeAnalysisStarted(context: unknown): AnalysisStartedTelemetryContext | undefined {
  if (!isRecord(context) || !hasExactKeys(context, [
    'allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch',
  ])) return undefined;
  const allyCarry = normalizedChampion(context.allyCarry);
  const allySupport = normalizedChampion(context.allySupport);
  const enemyCarry = normalizedChampion(context.enemyCarry);
  const enemySupport = normalizedChampion(context.enemySupport);
  const patch = normalizedPatch(context.patch);
  if (!allyCarry || !allySupport || !enemyCarry || !enemySupport || !patch) return undefined;
  return { allyCarry, allySupport, enemyCarry, enemySupport, patch };
}

function normalizeAnalysisCompleted(context: unknown) {
  if (!isRecord(context)) return undefined;
  const keys = context.analysisRequestId === undefined
    ? ['patch']
    : ['analysisRequestId', 'patch'];
  if (!hasExactKeys(context, keys)) return undefined;
  const patch = normalizedPatch(context.patch);
  if (!patch) return undefined;
  if (context.analysisRequestId === undefined) return { patch };
  if (!isUuid(context.analysisRequestId)) return undefined;
  return { analysisRequestId: context.analysisRequestId, patch };
}

function normalizeAnalysisFailed(context: unknown): AnalysisFailedTelemetryContext | undefined {
  if (!isRecord(context)) return undefined;
  const allowedKeys = ['analysisRequestId', 'errorCode'];
  if (!Object.keys(context).every((key) => allowedKeys.includes(key))) return undefined;
  if (context.analysisRequestId !== undefined && !isUuid(context.analysisRequestId)) return undefined;
  if (
    context.errorCode !== undefined
    && (
      typeof context.errorCode !== 'string'
      || !(ANALYSIS_TELEMETRY_ERROR_CODES as readonly string[]).includes(context.errorCode)
    )
  ) return undefined;
  return {
    ...(context.analysisRequestId === undefined ? {} : { analysisRequestId: context.analysisRequestId }),
    ...(context.errorCode === undefined ? {} : { errorCode: context.errorCode as AnalysisFailedTelemetryContext['errorCode'] }),
  };
}

function normalizeFeedbackOpened(context: unknown): FeedbackOpenedTelemetryContext | undefined {
  if (!isRecord(context) || !hasExactKeys(context, ['kind'])) return undefined;
  return context.kind === 'analysis' || context.kind === 'bug'
    ? { kind: context.kind }
    : undefined;
}

function normalizeFeedbackSubmitted(context: unknown): FeedbackSubmittedTelemetryContext | undefined {
  if (!isRecord(context) || !hasExactKeys(context, ['category', 'kind'])) return undefined;
  if (
    context.kind === 'analysis'
    && typeof context.category === 'string'
    && (ANALYSIS_FEEDBACK_CATEGORIES as readonly string[]).includes(context.category)
  ) return { kind: context.kind, category: context.category as AnalysisFeedbackCategory };
  if (
    context.kind === 'bug'
    && typeof context.category === 'string'
    && (BUG_FEEDBACK_CATEGORIES as readonly string[]).includes(context.category)
  ) return { kind: context.kind, category: context.category as BugFeedbackCategory };
  return undefined;
}

export function normalizeTelemetryRequest(value: unknown): TelemetryRequest | undefined {
  if (!isRecord(value) || !isUuid(value.clientId) || !isUuid(value.sessionId)) return undefined;
  if (
    typeof value.event !== 'string'
    || !(TELEMETRY_EVENTS as readonly string[]).includes(value.event)
  ) return undefined;
  const identity = { clientId: value.clientId, sessionId: value.sessionId };

  if (value.event === 'app_opened') {
    return hasExactKeys(value, ['clientId', 'event', 'sessionId'])
      ? { ...identity, event: value.event }
      : undefined;
  }
  if (!hasExactKeys(value, ['clientId', 'context', 'event', 'sessionId'])) return undefined;

  switch (value.event) {
    case 'analysis_started': {
      const context = normalizeAnalysisStarted(value.context);
      return context ? { ...identity, event: value.event, context } : undefined;
    }
    case 'analysis_completed': {
      const context = normalizeAnalysisCompleted(value.context);
      return context ? { ...identity, event: value.event, context } : undefined;
    }
    case 'analysis_failed': {
      const context = normalizeAnalysisFailed(value.context);
      return context ? { ...identity, event: value.event, context } : undefined;
    }
    case 'history_opened': {
      if (!isRecord(value.context) || !hasExactKeys(value.context, ['patch'])) return undefined;
      const patch = normalizedPatch(value.context.patch);
      return patch ? { ...identity, event: value.event, context: { patch } } : undefined;
    }
    case 'feedback_opened': {
      const context = normalizeFeedbackOpened(value.context);
      return context ? { ...identity, event: value.event, context } : undefined;
    }
    case 'feedback_submitted': {
      const context = normalizeFeedbackSubmitted(value.context);
      return context ? { ...identity, event: value.event, context } : undefined;
    }
  }
}

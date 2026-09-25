import type {
  AnalysisContextResponse,
  ApiErrorCode,
  MatchupAnalysis,
  MatchupRequest,
} from '../shared/analysis-contract';
import { isAnalysisContextResponse, isMatchupAnalysis } from './analysis';

const REQUEST_TIMEOUT_MS = 30_000;

export function analysisRequestSignal(signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export class InvalidAnalysisResponseError extends Error {
  constructor() {
    super('L’analyse reçue est invalide.');
    this.name = 'InvalidAnalysisResponseError';
  }
}

const API_ERROR_CODES = new Set<ApiErrorCode>([
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_JSON',
  'INVALID_MATCHUP_REQUEST',
  'PATCH_CONTEXT_NOT_FOUND',
  'PATCH_CONTEXT_UNAVAILABLE',
  'PATCH_CONTEXT_INVALID',
  'ANALYSIS_NOT_CONFIGURED',
  'ANALYSIS_PROVIDER_UNAVAILABLE',
  'INVALID_ANALYSIS_RESPONSE',
  'ANALYSIS_FAILED',
  'INTERNAL_ERROR',
]);

export class AnalysisRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: ApiErrorCode,
    readonly requestId?: string,
  ) {
    super('Analyse indisponible');
    this.name = 'AnalysisRequestError';
  }
}

async function readSafeApiErrorCode(response: Response): Promise<ApiErrorCode | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body !== 'object'
      || body === null
      || !('error' in body)
      || typeof body.error !== 'object'
      || body.error === null
      || !('code' in body.error)
      || typeof body.error.code !== 'string'
      || !API_ERROR_CODES.has(body.error.code as ApiErrorCode)
    ) return undefined;
    return body.error.code as ApiErrorCode;
  } catch {
    return undefined;
  }
}

export async function checkHealth(): Promise<void> {
  const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') {
    throw new Error('Réponse de santé invalide');
  }
}

export async function getAnalysisContext(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AnalysisContextResponse> {
  const response = await fetchImpl('/api/analysis-context', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Contexte d’analyse indisponible');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Contexte d’analyse invalide');
  }
  if (!isAnalysisContextResponse(body)) throw new Error('Contexte d’analyse invalide');
  return { patch: body.patch.trim(), contextVersion: body.contextVersion.trim() };
}

export async function analyzeMatchup(
  request: MatchupRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<MatchupAnalysis> {
  const response = await fetchImpl('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: analysisRequestSignal(signal),
  });
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id')?.trim() || undefined;
    throw new AnalysisRequestError(
      response.status,
      await readSafeApiErrorCode(response),
      requestId,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InvalidAnalysisResponseError();
  }
  if (!isMatchupAnalysis(body, request)) throw new InvalidAnalysisResponseError();
  return body;
}

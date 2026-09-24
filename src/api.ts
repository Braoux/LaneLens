import type {
  AnalysisContextResponse,
  MatchupAnalysis,
  MatchupRequest,
} from '../shared/analysis-contract';
import { isAnalysisContextResponse, isMatchupAnalysis } from './analysis';

const REQUEST_TIMEOUT_MS = 30_000;

export class InvalidAnalysisResponseError extends Error {
  constructor() {
    super('L’analyse reçue est invalide.');
    this.name = 'InvalidAnalysisResponseError';
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
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Analyse indisponible');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InvalidAnalysisResponseError();
  }
  if (!isMatchupAnalysis(body, request)) throw new InvalidAnalysisResponseError();
  return body;
}

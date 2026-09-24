import { Hono } from 'hono';
import type { Context } from 'hono';
import { MatchupAnalysisError } from './analysis/errors.js';
import type { MatchupAnalysisService } from './analysis/MatchupAnalysisService.js';
import type { MatchupAnalysisInput } from './analysis/types.js';
import { isValidPatchContext } from './analysis/validation.js';
import type { PatchContextResolver, PatchContextResolution } from './patch-context/PatchContextResolver.js';
import type {
  AnalysisContextResponse,
  ApiErrorCode,
  ApiErrorResponse,
  MatchupRequest,
} from '../shared/analysis-contract.js';
import type { HealthResponse } from './types.js';

export interface AppDependencies {
  readonly analysisService?: Pick<MatchupAnalysisService, 'analyze'>;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
}

type ApiErrorStatus = 400 | 415 | 422 | 500 | 502 | 503;

const MATCHUP_KEYS = [
  'allyCarry',
  'allySupport',
  'enemyCarry',
  'enemySupport',
  'patch',
] as const satisfies readonly (keyof MatchupRequest)[];

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  UNSUPPORTED_MEDIA_TYPE: 'Le contenu de la requête doit être au format JSON.',
  INVALID_JSON: 'Le corps JSON est absent ou invalide.',
  INVALID_MATCHUP_REQUEST: 'La requête de matchup est invalide.',
  PATCH_CONTEXT_NOT_FOUND: 'Le contexte du patch demandé est introuvable.',
  PATCH_CONTEXT_UNAVAILABLE: 'Le contexte de patch est indisponible.',
  PATCH_CONTEXT_INVALID: 'Le contexte de patch est invalide.',
  ANALYSIS_NOT_CONFIGURED: 'Le service d’analyse n’est pas configuré.',
  ANALYSIS_PROVIDER_UNAVAILABLE: 'Le service d’analyse est indisponible.',
  INVALID_ANALYSIS_RESPONSE: 'Le service d’analyse a retourné une réponse invalide.',
  ANALYSIS_FAILED: 'Impossible de générer l’analyse.',
  INTERNAL_ERROR: 'Une erreur interne est survenue.',
};

function errorResponse(c: Context, status: ApiErrorStatus, code: ApiErrorCode) {
  return c.json({
    error: {
      code,
      message: ERROR_MESSAGES[code],
    },
  } satisfies ApiErrorResponse, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnalysisContextResponse(value: unknown): value is AnalysisContextResponse {
  return isRecord(value)
    && typeof value.patch === 'string'
    && value.patch.trim().length > 0
    && typeof value.contextVersion === 'string'
    && value.contextVersion.trim().length > 0;
}

function normalizeMatchupRequest(value: unknown): MatchupRequest | undefined {
  if (!isRecord(value)) return undefined;

  const keys = Object.keys(value);
  if (
    keys.length !== MATCHUP_KEYS.length
    || !keys.every((key) => MATCHUP_KEYS.includes(key as keyof MatchupRequest))
  ) return undefined;

  const normalized = {} as MatchupRequest;
  for (const key of MATCHUP_KEYS) {
    const field = value[key];
    if (typeof field !== 'string' || field.trim().length === 0) return undefined;
    normalized[key] = field.trim();
  }

  if (
    normalized.allyCarry.toLocaleLowerCase('en-US')
      === normalized.allySupport.toLocaleLowerCase('en-US')
    || normalized.enemyCarry.toLocaleLowerCase('en-US')
      === normalized.enemySupport.toLocaleLowerCase('en-US')
  ) return undefined;

  return normalized;
}

function hasJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return contentType.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US') === 'application/json';
}

function isValidResolution(value: unknown): value is PatchContextResolution {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'not-found' || value.status === 'unavailable') return true;
  return value.status === 'ready' && 'context' in value;
}

function mapAnalysisError(c: Context, error: MatchupAnalysisError) {
  switch (error.code) {
    case 'ANALYSIS_PROVIDER_UNAVAILABLE':
      return errorResponse(c, 503, error.code);
    case 'INVALID_ANALYSIS_RESPONSE':
      return errorResponse(c, 502, error.code);
    case 'ANALYSIS_FAILED':
      return errorResponse(c, 500, error.code);
  }
}

export function createApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ status: 'ok' } satisfies HealthResponse));

  app.get('/api/analysis-context', (c) => {
    const { analysisContext } = dependencies;
    if (analysisContext === undefined) {
      return errorResponse(c, 503, 'PATCH_CONTEXT_UNAVAILABLE');
    }
    if (!isAnalysisContextResponse(analysisContext)) {
      return errorResponse(c, 500, 'PATCH_CONTEXT_INVALID');
    }
    return c.json({
      patch: analysisContext.patch.trim(),
      contextVersion: analysisContext.contextVersion.trim(),
    } satisfies AnalysisContextResponse);
  });

  app.post('/api/matchup', async (c) => {
    if (!hasJsonContentType(c.req.header('content-type'))) {
      return errorResponse(c, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'INVALID_JSON');
    }

    const request = normalizeMatchupRequest(body);
    if (request === undefined) {
      return errorResponse(c, 422, 'INVALID_MATCHUP_REQUEST');
    }

    const { analysisService, patchContextResolver } = dependencies;
    if (analysisService === undefined || patchContextResolver === undefined) {
      return errorResponse(c, 503, 'ANALYSIS_NOT_CONFIGURED');
    }

    let resolution: PatchContextResolution;
    try {
      const resolved: unknown = await patchContextResolver.resolve(request.patch);
      if (!isValidResolution(resolved)) {
        return errorResponse(c, 500, 'PATCH_CONTEXT_INVALID');
      }
      resolution = resolved;
    } catch {
      return errorResponse(c, 500, 'INTERNAL_ERROR');
    }

    if (resolution.status === 'not-found') {
      return errorResponse(c, 422, 'PATCH_CONTEXT_NOT_FOUND');
    }
    if (resolution.status === 'unavailable') {
      return errorResponse(c, 503, 'PATCH_CONTEXT_UNAVAILABLE');
    }

    if (
      !isValidPatchContext(resolution.context)
      || resolution.context.patch.trim() !== request.patch
    ) {
      return errorResponse(c, 500, 'PATCH_CONTEXT_INVALID');
    }

    const input: MatchupAnalysisInput = {
      ...request,
      patchContext: resolution.context,
    };

    try {
      return c.json(await analysisService.analyze(input), 200);
    } catch (error) {
      if (error instanceof MatchupAnalysisError) return mapAnalysisError(c, error);
      return errorResponse(c, 500, 'INTERNAL_ERROR');
    }
  });

  return app;
}

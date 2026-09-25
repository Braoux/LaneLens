import { randomUUID } from 'node:crypto';
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
import { NOOP_LOGGER } from './logging/Logger.js';
import type { Logger } from './logging/Logger.js';
import { serializeError } from './logging/redaction.js';
import { findProviderFailure } from './analysis/ProviderFailure.js';
import { isAppLocale } from '../shared/locale.js';
import { findAnalysisConformanceFailure } from './analysis/AnalysisConformanceValidator.js';

interface AppBindings {
  Variables: {
    requestId: string;
  };
}

type AppContext = Context<AppBindings>;

export interface AppDependencies {
  readonly analysisService?: Pick<MatchupAnalysisService, 'analyze'>;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
  readonly logger?: Logger;
  readonly analysisProviderName?: string;
  readonly analysisProviderModel?: string;
}

type ApiErrorStatus = 400 | 415 | 422 | 500 | 502 | 503;

const MATCHUP_KEYS = [
  'allyCarry',
  'allySupport',
  'enemyCarry',
  'enemySupport',
  'patch',
  'locale',
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

function errorResponse(c: AppContext, status: ApiErrorStatus, code: ApiErrorCode) {
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

  const normalizedFields: Record<string, string> = {};
  for (const key of MATCHUP_KEYS) {
    const field = value[key];
    if (typeof field !== 'string' || field.trim().length === 0) return undefined;
    normalizedFields[key] = field.trim();
  }

  if (!isAppLocale(normalizedFields.locale)) return undefined;
  const normalized: MatchupRequest = {
    allyCarry: normalizedFields.allyCarry!,
    allySupport: normalizedFields.allySupport!,
    enemyCarry: normalizedFields.enemyCarry!,
    enemySupport: normalizedFields.enemySupport!,
    patch: normalizedFields.patch!,
    locale: normalizedFields.locale,
  };

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

function analysisErrorStatus(error: MatchupAnalysisError): 500 | 502 | 503 {
  switch (error.code) {
    case 'ANALYSIS_PROVIDER_UNAVAILABLE':
      return 503;
    case 'INVALID_ANALYSIS_RESPONSE':
      return 502;
    case 'ANALYSIS_FAILED':
      return 500;
  }
}

function requestLogLevel(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const logger = dependencies.logger ?? NOOP_LOGGER;

  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let status = 500;
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);

    try {
      await next();
      status = c.res.status;
    } finally {
      logger[requestLogLevel(status)]('http_request_completed', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    }
  });

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

    const requestId = c.get('requestId');
    const analysisStartedAt = performance.now();
    logger.info('matchup_analysis_started', {
      requestId,
      allyCarry: request.allyCarry,
      allySupport: request.allySupport,
      enemyCarry: request.enemyCarry,
      enemySupport: request.enemySupport,
      patch: request.patch,
    });

    const failAnalysis = (
      status: ApiErrorStatus,
      code: ApiErrorCode,
      error?: unknown,
    ) => {
      const fields: Record<string, unknown> = {
        requestId,
        patch: request.patch,
        errorCode: code,
      };
      if (error !== undefined) {
        fields.error = serializeError(error, code === 'INTERNAL_ERROR');
      }
      logger[status >= 500 ? 'error' : 'warn']('matchup_analysis_failed', fields);
      if (code === 'INVALID_ANALYSIS_RESPONSE') {
        const conformanceFailure = findAnalysisConformanceFailure(error);
        if (conformanceFailure !== undefined) {
          logger.error('matchup_analysis_conformance_failed', {
            requestId,
            patch: request.patch,
            violationCodes: conformanceFailure.violationCodes,
            violationPaths: conformanceFailure.violationPaths,
          });
        }
      }
      if (
        code === 'ANALYSIS_PROVIDER_UNAVAILABLE'
        && dependencies.analysisProviderName !== undefined
      ) {
        const providerFailure = findProviderFailure(error);
        const providerFields: Record<string, unknown> = {
          requestId,
          provider: providerFailure?.provider ?? dependencies.analysisProviderName,
          model: providerFailure?.model ?? dependencies.analysisProviderModel,
          category: providerFailure?.category,
          status: providerFailure?.status,
          errorName: providerFailure?.errorName,
          errorMessage: providerFailure?.errorMessage,
          errorCode: code,
        };
        logger.error('analysis_provider_failed', {
          ...providerFields,
        });
      }
      return errorResponse(c, status, code);
    };

    const { analysisService, patchContextResolver } = dependencies;
    if (analysisService === undefined || patchContextResolver === undefined) {
      return failAnalysis(503, 'ANALYSIS_NOT_CONFIGURED');
    }

    let resolution: PatchContextResolution;
    try {
      const resolved: unknown = await patchContextResolver.resolve(request.patch);
      if (!isValidResolution(resolved)) {
        return failAnalysis(500, 'PATCH_CONTEXT_INVALID');
      }
      resolution = resolved;
    } catch (error) {
      return failAnalysis(500, 'INTERNAL_ERROR', error);
    }

    if (resolution.status === 'not-found') {
      return failAnalysis(422, 'PATCH_CONTEXT_NOT_FOUND');
    }
    if (resolution.status === 'unavailable') {
      return failAnalysis(503, 'PATCH_CONTEXT_UNAVAILABLE');
    }

    if (
      !isValidPatchContext(resolution.context)
      || resolution.context.patch.trim() !== request.patch
    ) {
      return failAnalysis(500, 'PATCH_CONTEXT_INVALID');
    }

    const input: MatchupAnalysisInput = {
      ...request,
      patchContext: resolution.context,
    };

    try {
      const result = await analysisService.analyze(input);
      logger.info('matchup_analysis_completed', {
        requestId,
        patch: request.patch,
        durationMs: Math.max(0, Math.round(performance.now() - analysisStartedAt)),
      });
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof MatchupAnalysisError) {
        return failAnalysis(analysisErrorStatus(error), error.code, error);
      }
      return failAnalysis(500, 'INTERNAL_ERROR', error);
    }
  });

  return app;
}

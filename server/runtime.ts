import type { MatchupAnalysisProvider } from './analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from './analysis/MatchupAnalysisService.js';
import { createGeminiProvider } from './analysis/providers/GeminiProvider.js';
import { loadGeminiConfig } from './analysis/providers/gemini-config.js';
import type { GeminiConfig } from './analysis/providers/gemini-config.js';
import { createOpenAIProvider } from './analysis/providers/OpenAIProvider.js';
import { loadOpenAIConfig } from './analysis/providers/openai-config.js';
import type { OpenAIConfig } from './analysis/providers/openai-config.js';
import { resolveAIProvider } from './analysis/providers/ai-provider-config.js';
import type { AIEnvironment } from './analysis/providers/ai-provider-config.js';
import type { AnalysisContextResponse } from '../shared/analysis-contract.js';
import { createApp } from './app.js';
import type { PatchContextResolver } from './patch-context/PatchContextResolver.js';
import { VersionedPatchContextResolver } from './patch-context/VersionedPatchContextResolver.js';
import { ACTIVE_PATCH_CONTEXT } from './patch-context/data/contexts.js';
import { NOOP_LOGGER } from './logging/Logger.js';
import type { Logger } from './logging/Logger.js';

export interface RuntimeCompositionOptions {
  readonly environment?: AIEnvironment;
  readonly openAIProviderFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly geminiProviderFactory?: (config: GeminiConfig) => MatchupAnalysisProvider;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
  readonly logger?: Logger;
}

export function createRuntimeApp(options: RuntimeCompositionOptions = {}) {
  const environment = options.environment ?? process.env;
  const logger = options.logger ?? NOOP_LOGGER;
  const providerName = resolveAIProvider(environment.AI_PROVIDER);
  const apiKey = providerName === 'gemini'
    ? environment.GEMINI_API_KEY?.trim() ?? ''
    : environment.OPENAI_API_KEY?.trim() ?? '';
  const patchContextResolver = options.patchContextResolver
    ?? new VersionedPatchContextResolver();
  const analysisContext = options.analysisContext ?? {
    patch: ACTIVE_PATCH_CONTEXT.patch,
    contextVersion: ACTIVE_PATCH_CONTEXT.contextVersion,
  };

  if (apiKey.length === 0) {
    return createApp({ patchContextResolver, analysisContext, logger });
  }

  let provider: MatchupAnalysisProvider;
  let model: string;
  if (providerName === 'gemini') {
    const config = loadGeminiConfig(environment);
    provider = (options.geminiProviderFactory ?? createGeminiProvider)(config);
    model = config.model;
  } else {
    const config = loadOpenAIConfig(environment);
    provider = (options.openAIProviderFactory ?? createOpenAIProvider)(config);
    model = config.model;
  }
  logger.info('analysis_provider_configured', {
    provider: providerName,
    model,
  });
  const analysisService = new MatchupAnalysisService(provider);
  return createApp({
    analysisService,
    patchContextResolver,
    analysisContext,
    logger,
    analysisProviderName: providerName,
  });
}

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

export interface RuntimeCompositionOptions {
  readonly environment?: AIEnvironment;
  readonly openAIProviderFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly geminiProviderFactory?: (config: GeminiConfig) => MatchupAnalysisProvider;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
}

export function createRuntimeApp(options: RuntimeCompositionOptions = {}) {
  const environment = options.environment ?? process.env;
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

  if (apiKey.length === 0) return createApp({ patchContextResolver, analysisContext });

  const provider = providerName === 'gemini'
    ? (options.geminiProviderFactory ?? createGeminiProvider)(loadGeminiConfig(environment))
    : (options.openAIProviderFactory ?? createOpenAIProvider)(loadOpenAIConfig(environment));
  const analysisService = new MatchupAnalysisService(provider);
  return createApp({ analysisService, patchContextResolver, analysisContext });
}

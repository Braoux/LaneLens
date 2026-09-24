import type { MatchupAnalysisProvider } from './analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from './analysis/MatchupAnalysisService.js';
import { createOpenAIProvider } from './analysis/providers/OpenAIProvider.js';
import { loadOpenAIConfig } from './analysis/providers/openai-config.js';
import type {
  OpenAIConfig,
  OpenAIEnvironment,
} from './analysis/providers/openai-config.js';
import type { AnalysisContextResponse } from '../shared/analysis-contract.js';
import { createApp } from './app.js';
import type { PatchContextResolver } from './patch-context/PatchContextResolver.js';
import { VersionedPatchContextResolver } from './patch-context/VersionedPatchContextResolver.js';
import { ACTIVE_PATCH_CONTEXT } from './patch-context/data/contexts.js';

export interface RuntimeCompositionOptions {
  readonly environment?: OpenAIEnvironment;
  readonly providerFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
}

export function createRuntimeApp(options: RuntimeCompositionOptions = {}) {
  const environment = options.environment ?? process.env;
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
  const patchContextResolver = options.patchContextResolver
    ?? new VersionedPatchContextResolver();
  const analysisContext = options.analysisContext ?? {
    patch: ACTIVE_PATCH_CONTEXT.patch,
    contextVersion: ACTIVE_PATCH_CONTEXT.contextVersion,
  };

  if (apiKey.length === 0) return createApp({ patchContextResolver, analysisContext });

  const config = loadOpenAIConfig(environment);
  const provider = (options.providerFactory ?? createOpenAIProvider)(config);
  const analysisService = new MatchupAnalysisService(provider);
  return createApp({ analysisService, patchContextResolver, analysisContext });
}

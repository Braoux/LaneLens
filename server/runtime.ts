import type { MatchupAnalysisProvider } from './analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from './analysis/MatchupAnalysisService.js';
import { createOpenAIProvider } from './analysis/providers/OpenAIProvider.js';
import { loadOpenAIConfig } from './analysis/providers/openai-config.js';
import type {
  OpenAIConfig,
  OpenAIEnvironment,
} from './analysis/providers/openai-config.js';
import { createApp } from './app.js';
import type { PatchContextResolver } from './patch-context/PatchContextResolver.js';
import { VersionedPatchContextResolver } from './patch-context/VersionedPatchContextResolver.js';

export interface RuntimeCompositionOptions {
  readonly environment?: OpenAIEnvironment;
  readonly providerFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly patchContextResolver?: PatchContextResolver;
}

export function createRuntimeApp(options: RuntimeCompositionOptions = {}) {
  const environment = options.environment ?? process.env;
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';

  if (apiKey.length === 0) return createApp();

  const config = loadOpenAIConfig(environment);
  const provider = (options.providerFactory ?? createOpenAIProvider)(config);
  const analysisService = new MatchupAnalysisService(provider);
  const patchContextResolver = options.patchContextResolver
    ?? new VersionedPatchContextResolver();

  return createApp({ analysisService, patchContextResolver });
}

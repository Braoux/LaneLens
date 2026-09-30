import type { MatchupAnalysisProvider } from './MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from './MatchupAnalysisService.js';
import { createGeminiProvider } from './providers/GeminiProvider.js';
import { loadGeminiConfig } from './providers/gemini-config.js';
import type { GeminiConfig } from './providers/gemini-config.js';
import { createOpenAIProvider } from './providers/OpenAIProvider.js';
import { loadOpenAIConfig } from './providers/openai-config.js';
import type { OpenAIConfig } from './providers/openai-config.js';
import { createGroqProvider } from './providers/GroqProvider.js';
import { loadGroqConfig } from './providers/groq-config.js';
import type { GroqConfig } from './providers/groq-config.js';
import {
  resolveAIProvider,
  type AIEnvironment,
  type AIProviderName,
} from './providers/ai-provider-config.js';
import { GameplayOnlyKnowledgeResolver, KnowledgeResolver } from '../knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../knowledge/StaticKnowledgeRepository.js';

export interface AnalysisRuntimeOptions {
  readonly environment?: AIEnvironment;
  readonly openAIProviderFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly geminiProviderFactory?: (config: GeminiConfig) => MatchupAnalysisProvider;
  readonly groqProviderFactory?: (config: GroqConfig) => MatchupAnalysisProvider;
  readonly knowledgeBaseEnabled?: boolean;
}

export interface AnalysisRuntime {
  readonly service: MatchupAnalysisService;
  readonly provider: AIProviderName;
  readonly model: string;
  readonly knowledgeBaseVersion: string | null;
}

export function createAnalysisRuntime(
  options: AnalysisRuntimeOptions = {},
): AnalysisRuntime | undefined {
  const environment = options.environment ?? process.env;
  const providerName = resolveAIProvider(environment.AI_PROVIDER);
  const apiKey = {
    openai: environment.OPENAI_API_KEY,
    gemini: environment.GEMINI_API_KEY,
    groq: environment.GROQ_API_KEY,
  }[providerName]?.trim() ?? '';
  if (apiKey.length === 0) return undefined;

  let provider: MatchupAnalysisProvider;
  let model: string;
  switch (providerName) {
    case 'gemini': {
      const config = loadGeminiConfig(environment);
      provider = (options.geminiProviderFactory ?? createGeminiProvider)(config);
      model = config.model;
      break;
    }
    case 'groq': {
      const config = loadGroqConfig(environment);
      provider = (options.groqProviderFactory ?? createGroqProvider)(config);
      model = config.model;
      break;
    }
    case 'openai': {
      const config = loadOpenAIConfig(environment);
      provider = (options.openAIProviderFactory ?? createOpenAIProvider)(config);
      model = config.model;
      break;
    }
  }

  const knowledgeBaseEnabled = options.knowledgeBaseEnabled ?? true;
  const repository = knowledgeBaseEnabled ? new StaticKnowledgeRepository() : undefined;
  const knowledgeResolver = repository === undefined
    ? new GameplayOnlyKnowledgeResolver()
    : new KnowledgeResolver(repository);
  return Object.freeze({
    service: new MatchupAnalysisService(provider, undefined, knowledgeResolver),
    provider: providerName,
    model,
    knowledgeBaseVersion: repository?.version ?? null,
  });
}

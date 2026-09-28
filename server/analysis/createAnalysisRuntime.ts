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

export interface AnalysisRuntimeOptions {
  readonly environment?: AIEnvironment;
  readonly openAIProviderFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly geminiProviderFactory?: (config: GeminiConfig) => MatchupAnalysisProvider;
  readonly groqProviderFactory?: (config: GroqConfig) => MatchupAnalysisProvider;
}

export interface AnalysisRuntime {
  readonly service: MatchupAnalysisService;
  readonly provider: AIProviderName;
  readonly model: string;
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

  return Object.freeze({
    service: new MatchupAnalysisService(provider),
    provider: providerName,
    model,
  });
}

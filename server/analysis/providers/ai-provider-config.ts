export type AIProviderName = 'openai' | 'gemini' | 'groq';
export type AIEnvironment = Readonly<Record<string, string | undefined>>;

export class AIProviderConfigurationError extends Error {
  constructor() {
    super('Le provider IA configuré est invalide.');
    this.name = 'AIProviderConfigurationError';
  }
}

export function resolveAIProvider(rawValue: string | undefined): AIProviderName {
  const value = rawValue?.trim().toLowerCase() ?? '';
  if (value.length === 0) return 'openai';
  if (value === 'openai' || value === 'gemini' || value === 'groq') return value;
  throw new AIProviderConfigurationError();
}

export const DEFAULT_OPENAI_MODEL = 'gpt-6-sol';
export const DEFAULT_OPENAI_TIMEOUT_MS = 30_000;

export interface OpenAIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export type OpenAIEnvironment = Readonly<Record<string, string | undefined>>;

export class OpenAIConfigurationError extends Error {
  constructor() {
    super('La configuration OpenAI est invalide.');
    this.name = 'OpenAIConfigurationError';
  }
}

function parseTimeout(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_OPENAI_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(value)) throw new OpenAIConfigurationError();

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) throw new OpenAIConfigurationError();
  return timeoutMs;
}

export function loadOpenAIConfig(environment: OpenAIEnvironment = process.env): OpenAIConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
  if (apiKey.length === 0) throw new OpenAIConfigurationError();

  const configuredModel = environment.OPENAI_MODEL?.trim() ?? '';

  return Object.freeze({
    apiKey,
    model: configuredModel || DEFAULT_OPENAI_MODEL,
    timeoutMs: parseTimeout(environment.OPENAI_TIMEOUT_MS),
  });
}

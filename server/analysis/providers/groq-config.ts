export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GROQ_TIMEOUT_MS = 30_000;

export interface GroqConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export type GroqEnvironment = Readonly<Record<string, string | undefined>>;

export class GroqConfigurationError extends Error {
  constructor() {
    super('La configuration Groq est invalide.');
    this.name = 'GroqConfigurationError';
  }
}

function parseTimeout(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_GROQ_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(value)) throw new GroqConfigurationError();

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) throw new GroqConfigurationError();
  return timeoutMs;
}

export function loadGroqConfig(
  environment: GroqEnvironment = process.env,
): GroqConfig {
  const apiKey = environment.GROQ_API_KEY?.trim() ?? '';
  if (apiKey.length === 0) throw new GroqConfigurationError();

  const configuredModel = environment.GROQ_MODEL?.trim() ?? '';

  return Object.freeze({
    apiKey,
    model: configuredModel || DEFAULT_GROQ_MODEL,
    timeoutMs: parseTimeout(environment.GROQ_TIMEOUT_MS),
  });
}

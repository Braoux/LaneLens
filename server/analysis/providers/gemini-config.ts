export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;

export interface GeminiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export type GeminiEnvironment = Readonly<Record<string, string | undefined>>;

export class GeminiConfigurationError extends Error {
  constructor() {
    super('La configuration Gemini est invalide.');
    this.name = 'GeminiConfigurationError';
  }
}

function parseTimeout(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_GEMINI_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(value)) throw new GeminiConfigurationError();

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) throw new GeminiConfigurationError();
  return timeoutMs;
}

export function loadGeminiConfig(
  environment: GeminiEnvironment = process.env,
): GeminiConfig {
  const apiKey = environment.GEMINI_API_KEY?.trim() ?? '';
  if (apiKey.length === 0) throw new GeminiConfigurationError();

  const configuredModel = environment.GEMINI_MODEL?.trim() ?? '';

  return Object.freeze({
    apiKey,
    model: configuredModel || DEFAULT_GEMINI_MODEL,
    timeoutMs: parseTimeout(environment.GEMINI_TIMEOUT_MS),
  });
}

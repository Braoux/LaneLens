export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 30_000;

export interface DeepSeekConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseURL: string;
  readonly timeoutMs: number;
}

export type DeepSeekEnvironment = Readonly<Record<string, string | undefined>>;

export class DeepSeekConfigurationError extends Error {
  constructor() {
    super('La configuration DeepSeek est invalide.');
    this.name = 'DeepSeekConfigurationError';
  }
}

function parseTimeout(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_DEEPSEEK_TIMEOUT_MS;
  if (!/^[1-9]\d*$/u.test(value)) throw new DeepSeekConfigurationError();

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) throw new DeepSeekConfigurationError();
  return timeoutMs;
}

function parseBaseURL(rawValue: string | undefined): string {
  const value = rawValue?.trim() || DEFAULT_DEEPSEEK_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new DeepSeekConfigurationError();
    }
    return url.toString().replace(/\/$/u, '');
  } catch (error) {
    if (error instanceof DeepSeekConfigurationError) throw error;
    throw new DeepSeekConfigurationError();
  }
}

export function loadDeepSeekConfig(
  environment: DeepSeekEnvironment = process.env,
): DeepSeekConfig {
  const apiKey = environment.DEEPSEEK_API_KEY?.trim() ?? '';
  if (apiKey.length === 0) throw new DeepSeekConfigurationError();

  const configuredModel = environment.DEEPSEEK_MODEL?.trim() ?? '';
  return Object.freeze({
    apiKey,
    model: configuredModel || DEFAULT_DEEPSEEK_MODEL,
    baseURL: parseBaseURL(environment.DEEPSEEK_BASE_URL),
    timeoutMs: parseTimeout(environment.DEEPSEEK_TIMEOUT_MS),
  });
}

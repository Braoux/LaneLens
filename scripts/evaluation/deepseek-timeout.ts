import type { AIEnvironment } from '../../server/analysis/providers/ai-provider-config.js';
import { resolveAIProvider } from '../../server/analysis/providers/ai-provider-config.js';

export const DEFAULT_DEEPSEEK_EVALUATION_TIMEOUT_MS = 120_000;

/**
 * The evaluation runner owns a distinct, reproducible DeepSeek deadline.
 * Application transport settings are intentionally not inherited by campaigns.
 */
export function withEvaluationDeepSeekTimeout(
  environment: AIEnvironment,
): AIEnvironment {
  if (resolveAIProvider(environment.AI_PROVIDER) !== 'deepseek') return environment;

  return Object.freeze({
    ...environment,
    DEEPSEEK_TIMEOUT_MS: environment.DEEPSEEK_EVALUATION_TIMEOUT_MS?.trim()
      || String(DEFAULT_DEEPSEEK_EVALUATION_TIMEOUT_MS),
    DEEPSEEK_TRANSPORT_TIMEOUT_MS:
      environment.DEEPSEEK_EVALUATION_TRANSPORT_TIMEOUT_MS?.trim() || undefined,
  });
}

import type { MatchupAnalysisProvider } from './analysis/MatchupAnalysisProvider.js';
import type { GeminiConfig } from './analysis/providers/gemini-config.js';
import type { OpenAIConfig } from './analysis/providers/openai-config.js';
import type { GroqConfig } from './analysis/providers/groq-config.js';
import type { AIEnvironment } from './analysis/providers/ai-provider-config.js';
import { createAnalysisRuntime } from './analysis/createAnalysisRuntime.js';
import type { AnalysisContextResponse } from '../shared/analysis-contract.js';
import { createApp } from './app.js';
import type { PatchContextResolver } from './patch-context/PatchContextResolver.js';
import { VersionedPatchContextResolver } from './patch-context/VersionedPatchContextResolver.js';
import { ACTIVE_PATCH_CONTEXT } from './patch-context/data/contexts.js';
import { NOOP_LOGGER } from './logging/Logger.js';
import type { Logger } from './logging/Logger.js';
import { FeedbackService } from './feedback/FeedbackService.js';
import { createGitHubFeedbackTracker } from './feedback/GitHubFeedbackTracker.js';
import type { FeedbackTracker } from './feedback/types.js';
import {
  loadGitHubFeedbackTrackerConfig,
  type GitHubFeedbackTrackerConfig,
} from './feedback/github-config.js';
import { attachProductionFrontend } from './frontend.js';

export interface RuntimeCompositionOptions {
  readonly environment?: AIEnvironment;
  readonly openAIProviderFactory?: (config: OpenAIConfig) => MatchupAnalysisProvider;
  readonly geminiProviderFactory?: (config: GeminiConfig) => MatchupAnalysisProvider;
  readonly groqProviderFactory?: (config: GroqConfig) => MatchupAnalysisProvider;
  readonly patchContextResolver?: PatchContextResolver;
  readonly analysisContext?: AnalysisContextResponse;
  readonly logger?: Logger;
  readonly feedbackTrackerFactory?: (config: GitHubFeedbackTrackerConfig) => FeedbackTracker;
  readonly clientDirectory?: string;
  readonly workingDirectory?: string;
}

export function createRuntimeApp(options: RuntimeCompositionOptions = {}) {
  const environment = options.environment ?? process.env;
  const logger = options.logger ?? NOOP_LOGGER;
  const patchContextResolver = options.patchContextResolver
    ?? new VersionedPatchContextResolver();
  const analysisContext = options.analysisContext ?? {
    patch: ACTIVE_PATCH_CONTEXT.patch,
    contextVersion: ACTIVE_PATCH_CONTEXT.contextVersion,
  };
  let feedbackService: FeedbackService | undefined;
  try {
    const feedbackConfig = loadGitHubFeedbackTrackerConfig(environment);
    if (feedbackConfig !== undefined) {
      const tracker = (options.feedbackTrackerFactory ?? createGitHubFeedbackTracker)(feedbackConfig);
      feedbackService = new FeedbackService(tracker);
      logger.info('feedback_tracker_configured');
    }
  } catch {
    logger.error('feedback_tracker_configuration_invalid');
  }

  const analysisRuntime = createAnalysisRuntime({
    environment,
    openAIProviderFactory: options.openAIProviderFactory,
    geminiProviderFactory: options.geminiProviderFactory,
    groqProviderFactory: options.groqProviderFactory,
  });
  if (analysisRuntime === undefined) {
    const app = createApp({ patchContextResolver, analysisContext, logger, feedbackService });
    return attachProductionFrontend(app, {
      environment,
      clientDirectory: options.clientDirectory,
      workingDirectory: options.workingDirectory,
    });
  }

  logger.info('analysis_provider_configured', {
    provider: analysisRuntime.provider,
    model: analysisRuntime.model,
    knowledgeBaseVersion: analysisRuntime.knowledgeBaseVersion,
  });
  const app = createApp({
    analysisService: analysisRuntime.service,
    patchContextResolver,
    analysisContext,
    logger,
    analysisProviderName: analysisRuntime.provider,
    analysisProviderModel: analysisRuntime.model,
    feedbackService,
  });
  return attachProductionFrontend(app, {
    environment,
    clientDirectory: options.clientDirectory,
    workingDirectory: options.workingDirectory,
  });
}

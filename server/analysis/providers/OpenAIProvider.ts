import OpenAI from 'openai';
import type { MatchupAnalysisProvider } from '../MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../types.js';
import { loadOpenAIConfig } from './openai-config.js';
import type { OpenAIConfig } from './openai-config.js';
import {
  MATCHUP_ANALYSIS_JSON_SCHEMA,
} from './matchup-analysis-schema.js';
import type { JsonSchema } from './matchup-analysis-schema.js';
import {
  ProviderFailureError,
  providerFailureDetails,
} from '../ProviderFailure.js';

export { MATCHUP_ANALYSIS_JSON_SCHEMA } from './matchup-analysis-schema.js';

export interface OpenAIResponseRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly reasoning: {
    readonly effort: 'medium';
  };
  readonly text: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: 'matchup_analysis';
      readonly strict: true;
      readonly schema: JsonSchema;
    };
  };
  readonly tools: [];
  readonly store: false;
}

export interface OpenAIResponseResult {
  readonly outputText?: string | null;
}

export interface OpenAIResponsesClient {
  create(request: OpenAIResponseRequest): Promise<OpenAIResponseResult>;
}

export interface OpenAIClientOptions {
  readonly apiKey: string;
  readonly timeout: number;
  readonly maxRetries: 0;
  readonly logLevel: 'off';
}

export type OpenAIClientFactory = (options: OpenAIClientOptions) => OpenAIResponsesClient;

export class OpenAIProviderError extends ProviderFailureError {
  constructor(model: string, cause: unknown) {
    super(
      providerFailureDetails('openai', model, cause),
      'Le provider OpenAI est indisponible.',
    );
    this.name = 'OpenAIProviderError';
  }
}

const defaultClientFactory: OpenAIClientFactory = (options) => {
  const client = new OpenAI(options);

  return {
    async create(request) {
      const response = await client.responses.create(request);
      return { outputText: response.output_text };
    },
  };
};

export class OpenAIProvider implements MatchupAnalysisProvider {
  constructor(
    private readonly client: OpenAIResponsesClient,
    private readonly model: string,
  ) {}

  async analyze(request: MatchupAnalysisProviderRequest): Promise<unknown> {
    let response: OpenAIResponseResult;
    try {
      response = await this.client.create({
        model: this.model,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        reasoning: { effort: 'medium' },
        text: {
          format: {
            type: 'json_schema',
            name: 'matchup_analysis',
            strict: true,
            schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
          },
        },
        tools: [],
        store: false,
      });
    } catch (error) {
      throw new OpenAIProviderError(this.model, error);
    }

    if (typeof response.outputText !== 'string' || response.outputText.length === 0) {
      return null;
    }

    try {
      return JSON.parse(response.outputText) as unknown;
    } catch {
      return null;
    }
  }
}

export function createOpenAIProvider(
  config: OpenAIConfig,
  clientFactory: OpenAIClientFactory = defaultClientFactory,
): OpenAIProvider {
  const normalizedConfig = loadOpenAIConfig({
    OPENAI_API_KEY: config.apiKey,
    OPENAI_MODEL: config.model,
    OPENAI_TIMEOUT_MS: String(config.timeoutMs),
  });
  const client = clientFactory({
    apiKey: normalizedConfig.apiKey,
    timeout: normalizedConfig.timeoutMs,
    maxRetries: 0,
    logLevel: 'off',
  });

  return new OpenAIProvider(client, normalizedConfig.model);
}

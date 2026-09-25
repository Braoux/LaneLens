import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import type { MatchupAnalysisProvider } from '../MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../types.js';
import {
  ProviderFailureError,
  providerFailureDetails,
} from '../ProviderFailure.js';
import { loadGroqConfig } from './groq-config.js';
import type { GroqConfig } from './groq-config.js';
import { MATCHUP_ANALYSIS_JSON_SCHEMA } from './matchup-analysis-schema.js';
import type { JsonSchema } from './matchup-analysis-schema.js';

export interface GroqRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly reasoningEffort: 'medium';
  readonly responseFormat: {
    readonly type: 'json_schema';
    readonly jsonSchema: {
      readonly name: 'matchup_analysis';
      readonly strict: true;
      readonly schema: JsonSchema;
    };
  };
  readonly tools: [];
  readonly timeoutMs: number;
}

export interface GroqResult {
  readonly outputText?: string | null;
}

export interface GroqClient {
  generate(request: GroqRequest): Promise<GroqResult>;
}

export interface GroqClientOptions {
  readonly apiKey: string;
  readonly timeout: number;
  readonly maxRetries: 0;
  readonly logLevel: 'off';
}

export type GroqClientFactory = (options: GroqClientOptions) => GroqClient;

export interface GroqSDKRequestOptions {
  readonly timeout: number;
  readonly maxRetries: 0;
}

export interface GroqSDKClient {
  readonly chat: {
    readonly completions: {
      create(
        request: ChatCompletionCreateParamsNonStreaming,
        options?: GroqSDKRequestOptions,
      ): Promise<{
        readonly choices: readonly {
          readonly message: { readonly content: string | null };
        }[];
      }>;
    };
  };
}

export type GroqSDKFactory = (options: GroqClientOptions) => GroqSDKClient;

export class GroqProviderError extends ProviderFailureError {
  constructor(model: string, cause: unknown) {
    super(
      providerFailureDetails('groq', model, cause),
      'Le provider Groq est indisponible.',
    );
    this.name = 'GroqProviderError';
  }
}

const defaultSDKFactory: GroqSDKFactory = (options) => new Groq(options);

export function createGroqSDKClient(
  options: GroqClientOptions,
  sdkFactory: GroqSDKFactory = defaultSDKFactory,
): GroqClient {
  const client = sdkFactory(options);

  return {
    async generate(request) {
      const body = {
        model: request.model,
        messages: [
          { role: 'system' as const, content: request.instructions },
          { role: 'user' as const, content: request.input },
        ],
        reasoning_effort: request.reasoningEffort,
        response_format: {
          type: request.responseFormat.type,
          json_schema: {
            name: request.responseFormat.jsonSchema.name,
            strict: request.responseFormat.jsonSchema.strict,
            schema: request.responseFormat.jsonSchema.schema,
          },
        },
        stream: false as const,
      } satisfies ChatCompletionCreateParamsNonStreaming;

      const completion = await client.chat.completions.create(body, {
        timeout: request.timeoutMs,
        maxRetries: 0,
      });

      return { outputText: completion.choices[0]?.message.content };
    },
  };
}

const defaultClientFactory: GroqClientFactory = createGroqSDKClient;

export class GroqProvider implements MatchupAnalysisProvider {
  constructor(
    private readonly client: GroqClient,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async analyze(request: MatchupAnalysisProviderRequest): Promise<unknown> {
    let response: GroqResult;
    try {
      response = await this.client.generate({
        model: this.model,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        reasoningEffort: 'medium',
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'matchup_analysis',
            strict: true,
            schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
          },
        },
        tools: [],
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new GroqProviderError(this.model, error);
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

export function createGroqProvider(
  config: GroqConfig,
  clientFactory: GroqClientFactory = defaultClientFactory,
): GroqProvider {
  const normalizedConfig = loadGroqConfig({
    GROQ_API_KEY: config.apiKey,
    GROQ_MODEL: config.model,
    GROQ_TIMEOUT_MS: String(config.timeoutMs),
  });
  const client = clientFactory({
    apiKey: normalizedConfig.apiKey,
    timeout: normalizedConfig.timeoutMs,
    maxRetries: 0,
    logLevel: 'off',
  });

  return new GroqProvider(client, normalizedConfig.model, normalizedConfig.timeoutMs);
}

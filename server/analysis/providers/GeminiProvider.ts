import { GoogleGenAI } from '@google/genai';
import type { MatchupAnalysisProvider } from '../MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../types.js';
import { loadGeminiConfig } from './gemini-config.js';
import type { GeminiConfig } from './gemini-config.js';
import {
  MATCHUP_ANALYSIS_JSON_SCHEMA,
} from './matchup-analysis-schema.js';
import type { JsonSchema } from './matchup-analysis-schema.js';
import {
  ProviderFailureError,
  providerFailureDetails,
} from '../ProviderFailure.js';

export interface GeminiRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly responseFormat: {
    readonly type: 'text';
    readonly mimeType: 'application/json';
    readonly schema: JsonSchema;
  };
  readonly tools: [];
  readonly store: false;
  readonly timeoutMs: number;
}

export interface GeminiResult {
  readonly outputText?: string | null;
}

export interface GeminiClient {
  generate(request: GeminiRequest): Promise<GeminiResult>;
}

export interface GeminiClientOptions {
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly retryAttempts: 1;
}

export type GeminiClientFactory = (options: GeminiClientOptions) => GeminiClient;

export interface GeminiSDKOptions {
  readonly apiKey: string;
  readonly httpOptions: {
    readonly timeout: number;
    readonly retryOptions: {
      readonly attempts: 1;
    };
  };
}

export interface GeminiSDKRequest {
  readonly model: string;
  readonly system_instruction: string;
  readonly input: string;
  readonly response_format: {
    readonly type: 'text';
    readonly mime_type: 'application/json';
    readonly schema: JsonSchema;
  };
  readonly tools: [];
  readonly store: false;
}

export interface GeminiSDKRequestOptions {
  readonly timeout: number;
  readonly maxRetries: 0;
}

export interface GeminiSDKClient {
  readonly interactions: {
    create(
      request: GeminiSDKRequest,
      options: GeminiSDKRequestOptions,
    ): Promise<{ readonly output_text?: string | null }>;
  };
}

export type GeminiSDKFactory = (options: GeminiSDKOptions) => GeminiSDKClient;

export class GeminiProviderError extends ProviderFailureError {
  constructor(model: string, cause: unknown) {
    super(
      providerFailureDetails('gemini', model, cause),
      'Le provider Gemini est indisponible.',
    );
    this.name = 'GeminiProviderError';
  }
}

const defaultSDKFactory: GeminiSDKFactory = (options) => new GoogleGenAI(options);

export function createGoogleGenAIClient(
  options: GeminiClientOptions,
  sdkFactory: GeminiSDKFactory = defaultSDKFactory,
): GeminiClient {
  const client = sdkFactory({
    apiKey: options.apiKey,
    httpOptions: {
      timeout: options.timeoutMs,
      retryOptions: { attempts: options.retryAttempts },
    },
  });

  return {
    async generate(request) {
      const response = await client.interactions.create({
        model: request.model,
        system_instruction: request.instructions,
        input: request.input,
        response_format: {
          type: request.responseFormat.type,
          mime_type: request.responseFormat.mimeType,
          schema: request.responseFormat.schema,
        },
        tools: request.tools,
        store: request.store,
      }, {
        timeout: request.timeoutMs,
        maxRetries: 0,
      });

      return { outputText: response.output_text };
    },
  };
}

const defaultClientFactory: GeminiClientFactory = createGoogleGenAIClient;

export class GeminiProvider implements MatchupAnalysisProvider {
  constructor(
    private readonly client: GeminiClient,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async analyze(request: MatchupAnalysisProviderRequest): Promise<unknown> {
    let response: GeminiResult;
    try {
      response = await this.client.generate({
        model: this.model,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        responseFormat: {
          type: 'text',
          mimeType: 'application/json',
          schema: MATCHUP_ANALYSIS_JSON_SCHEMA,
        },
        tools: [],
        store: false,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new GeminiProviderError(this.model, error);
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

export function createGeminiProvider(
  config: GeminiConfig,
  clientFactory: GeminiClientFactory = defaultClientFactory,
): GeminiProvider {
  const normalizedConfig = loadGeminiConfig({
    GEMINI_API_KEY: config.apiKey,
    GEMINI_MODEL: config.model,
    GEMINI_TIMEOUT_MS: String(config.timeoutMs),
  });
  const client = clientFactory({
    apiKey: normalizedConfig.apiKey,
    timeoutMs: normalizedConfig.timeoutMs,
    retryAttempts: 1,
  });

  return new GeminiProvider(client, normalizedConfig.model, normalizedConfig.timeoutMs);
}

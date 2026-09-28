import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from '../MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../types.js';
import {
  ProviderFailureError,
  providerFailureDetails,
} from '../ProviderFailure.js';
import type { ProviderRetryMetadata } from '../ProviderFailure.js';
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
  readonly retryMetadata?: ProviderRetryMetadata;
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
      ): PromiseLike<{
        readonly choices: readonly {
          readonly message: { readonly content: string | null };
        }[];
      }> & {
        withResponse?: () => Promise<{
          readonly data: {
            readonly choices: readonly {
              readonly message: { readonly content: string | null };
            }[];
          };
          readonly response: {
            readonly headers: { get(name: string): string | null };
          };
        }>;
      };
    };
  };
}

export type GroqSDKFactory = (options: GroqClientOptions) => GroqSDKClient;

export class GroqProviderError extends ProviderFailureError {
  constructor(model: string, cause: unknown) {
    super(
      providerFailureDetails('groq', model, cause, readGroqRetryMetadata(cause)),
      'Le provider Groq est indisponible.',
    );
    this.name = 'GroqProviderError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readHeaders(value: unknown): { get(name: string): string | null } | undefined {
  if (!isRecord(value)) return undefined;
  const headers = value.headers;
  if (!isRecord(headers) || typeof headers.get !== 'function') return undefined;
  return headers as unknown as { get(name: string): string | null };
}

function readNonNegativeNumber(rawValue: string | null): number | undefined {
  if (rawValue === null || !/^\d+(?:\.\d+)?$/u.test(rawValue.trim())) return undefined;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readNonNegativeInteger(rawValue: string | null): number | undefined {
  const value = readNonNegativeNumber(rawValue);
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function readReset(rawValue: string | null): string | undefined {
  if (rawValue === null) return undefined;
  const value = rawValue.trim();
  return value.length > 0 && value.length <= 100 ? value : undefined;
}

export function readGroqRateLimitHeaders(
  headers: { get(name: string): string | null },
): ProviderRetryMetadata {
  const retryAfterSeconds = readNonNegativeNumber(headers.get('retry-after'));
  const retryAfterMs = retryAfterSeconds === undefined
    ? undefined
    : Math.ceil(retryAfterSeconds * 1000);
  const metadata: ProviderRetryMetadata = {
    ...(retryAfterMs === undefined
      || !Number.isSafeInteger(retryAfterMs)
      || retryAfterMs > 2_147_483_647
      ? {}
      : { retryAfterMs }),
    ...(readNonNegativeInteger(headers.get('x-ratelimit-limit-requests')) === undefined ? {} : {
      rateLimitLimitRequests: readNonNegativeInteger(headers.get('x-ratelimit-limit-requests')),
    }),
    ...(readNonNegativeInteger(headers.get('x-ratelimit-limit-tokens')) === undefined ? {} : {
      rateLimitLimitTokens: readNonNegativeInteger(headers.get('x-ratelimit-limit-tokens')),
    }),
    ...(readNonNegativeInteger(headers.get('x-ratelimit-remaining-requests')) === undefined ? {} : {
      rateLimitRemainingRequests: readNonNegativeInteger(headers.get('x-ratelimit-remaining-requests')),
    }),
    ...(readNonNegativeInteger(headers.get('x-ratelimit-remaining-tokens')) === undefined ? {} : {
      rateLimitRemainingTokens: readNonNegativeInteger(headers.get('x-ratelimit-remaining-tokens')),
    }),
    ...(readReset(headers.get('x-ratelimit-reset-requests')) === undefined ? {} : {
      rateLimitResetRequests: readReset(headers.get('x-ratelimit-reset-requests')),
    }),
    ...(readReset(headers.get('x-ratelimit-reset-tokens')) === undefined ? {} : {
      rateLimitResetTokens: readReset(headers.get('x-ratelimit-reset-tokens')),
    }),
  };
  return Object.freeze(metadata);
}

function readGroqRetryMetadata(error: unknown): ProviderRetryMetadata | undefined {
  const headers = readHeaders(error);
  if (headers === undefined) return undefined;
  const metadata = readGroqRateLimitHeaders(headers);
  return Object.keys(metadata).length === 0 ? undefined : metadata;
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

      const pending = client.chat.completions.create(body, {
        timeout: request.timeoutMs,
        maxRetries: 0,
      });
      let completion;
      let retryMetadata: ProviderRetryMetadata | undefined;
      if (typeof pending.withResponse === 'function') {
        const result = await pending.withResponse();
        completion = result.data;
        const metadata = readGroqRateLimitHeaders(result.response.headers);
        retryMetadata = Object.keys(metadata).length === 0 ? undefined : metadata;
      } else {
        completion = await pending;
      }

      return {
        outputText: completion.choices[0]?.message.content,
        ...(retryMetadata === undefined ? {} : { retryMetadata }),
      };
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

  async analyze(
    request: MatchupAnalysisProviderRequest,
    options?: MatchupAnalysisProviderOptions,
  ): Promise<unknown> {
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
    if (response.retryMetadata !== undefined) {
      options?.onMetadata?.(response.retryMetadata);
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

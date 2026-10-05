import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from '../MatchupAnalysisProvider.js';
import type { MatchupAnalysisProviderRequest } from '../types.js';
import {
  ProviderFailureError,
  providerFailureDetails,
} from '../ProviderFailure.js';
import { loadDeepSeekConfig } from './deepseek-config.js';
import type { DeepSeekConfig } from './deepseek-config.js';
import { MATCHUP_ANALYSIS_JSON_SCHEMA } from './matchup-analysis-schema.js';

export const DEEPSEEK_REASONING_EFFORT = 'high' as const;
export const DEEPSEEK_THINKING_MODE = 'enabled' as const;
export const DEEPSEEK_RESPONSE_FORMAT = 'json_object' as const;

const JSON_OUTPUT_INSTRUCTION = [
  'Réponds uniquement avec un objet JSON syntaxiquement valide conforme au format LaneLens demandé.',
  'N’ajoute aucun texte, balise Markdown ou commentaire avant ou après cet objet JSON.',
  `Schéma JSON LaneLens attendu : ${JSON.stringify(MATCHUP_ANALYSIS_JSON_SCHEMA)}`,
].join(' ');

export interface DeepSeekRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly responseFormat: { readonly type: typeof DEEPSEEK_RESPONSE_FORMAT };
  readonly thinking: { readonly type: typeof DEEPSEEK_THINKING_MODE };
  readonly reasoningEffort: typeof DEEPSEEK_REASONING_EFFORT;
  readonly tools: [];
  readonly signal: AbortSignal;
  readonly transportTimeoutMs: number;
}

export interface DeepSeekTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
}

export interface DeepSeekResult {
  readonly outputText?: string | null;
  readonly finishReason?: string | null;
  readonly providerRequestId?: string;
  readonly tokenUsage?: DeepSeekTokenUsage;
}

export interface DeepSeekClient {
  generate(request: DeepSeekRequest): Promise<DeepSeekResult>;
}

export interface DeepSeekClientOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: 0;
  readonly logLevel: 'off';
}

export type DeepSeekClientFactory = (options: DeepSeekClientOptions) => DeepSeekClient;

interface DeepSeekChatCompletionBody extends ChatCompletionCreateParamsNonStreaming {
  readonly thinking: { readonly type: typeof DEEPSEEK_THINKING_MODE };
}

export class DeepSeekProviderError extends ProviderFailureError {
  constructor(
    model: string,
    cause: unknown,
    executionContext: 'application' | 'evaluation',
    deadlineMs: number,
    durationMs: number,
  ) {
    super(
      {
        ...providerFailureDetails('deepseek', model, cause),
        executionContext,
        deadlineMs,
        durationMs,
      },
      'Le provider DeepSeek est indisponible.',
    );
    this.name = 'DeepSeekProviderError';
  }
}

const defaultSDKFactory = (options: DeepSeekClientOptions): OpenAI => new OpenAI(options);

export function createDeepSeekSDKClient(
  options: DeepSeekClientOptions,
  sdkFactory: (options: DeepSeekClientOptions) => OpenAI = defaultSDKFactory,
): DeepSeekClient {
  const client = sdkFactory(options);
  return {
    async generate(request) {
      const body = {
        model: request.model,
        messages: [
          { role: 'system' as const, content: `${request.instructions}\n\n${JSON_OUTPUT_INSTRUCTION}` },
          { role: 'user' as const, content: request.input },
        ],
        response_format: request.responseFormat,
        thinking: request.thinking,
        reasoning_effort: request.reasoningEffort,
        stream: false as const,
      } satisfies DeepSeekChatCompletionBody;
      const pending = client.chat.completions.create(body, {
        signal: request.signal,
        timeout: request.transportTimeoutMs,
        maxRetries: 0,
      });
      const { data, request_id: providerRequestId } = await pending.withResponse();
      const usage = data.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
      return {
        outputText: data.choices[0]?.message.content,
        finishReason: data.choices[0]?.finish_reason,
        ...(providerRequestId === null ? {} : { providerRequestId }),
        ...(usage === undefined ? {} : {
          tokenUsage: {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
          },
        }),
      };
    },
  };
}

const defaultClientFactory: DeepSeekClientFactory = createDeepSeekSDKClient;

export class DeepSeekProvider implements MatchupAnalysisProvider {
  constructor(
    private readonly client: DeepSeekClient,
    private readonly model: string,
    private readonly deadlineMs: number,
    private readonly transportTimeoutMs: number,
    private readonly executionContext: 'application' | 'evaluation' = 'application',
  ) {}

  async analyze(
    request: MatchupAnalysisProviderRequest,
    options?: MatchupAnalysisProviderOptions,
  ): Promise<unknown> {
    let response: DeepSeekResult;
    const startedAt = Date.now();
    const controller = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        const error = new DOMException('LaneLens DeepSeek deadline exceeded.', 'TimeoutError');
        controller.abort(error);
        reject(error);
      }, this.deadlineMs);
    });
    try {
      const generation = this.client.generate({
        model: this.model,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        responseFormat: { type: DEEPSEEK_RESPONSE_FORMAT },
        thinking: { type: DEEPSEEK_THINKING_MODE },
        reasoningEffort: DEEPSEEK_REASONING_EFFORT,
        tools: [],
        signal: controller.signal,
        transportTimeoutMs: this.transportTimeoutMs,
      });
      response = await Promise.race([generation, deadline]);
    } catch (error) {
      throw new DeepSeekProviderError(
        this.model,
        error,
        this.executionContext,
        this.deadlineMs,
        Math.max(0, Date.now() - startedAt),
      );
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }

    const usage = response.tokenUsage;
    if (response.providerRequestId !== undefined || usage !== undefined) {
      options?.onMetadata?.({
        ...(response.providerRequestId === undefined
          ? {}
          : { providerRequestId: response.providerRequestId }),
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      });
    }

    if (
      response.finishReason !== undefined
      && response.finishReason !== null
      && response.finishReason !== 'stop'
    ) return null;
    if (typeof response.outputText !== 'string' || response.outputText.trim().length === 0) {
      return null;
    }
    try {
      return JSON.parse(response.outputText) as unknown;
    } catch {
      return null;
    }
  }
}

export function createDeepSeekProvider(
  config: DeepSeekConfig,
  clientFactory: DeepSeekClientFactory = defaultClientFactory,
  executionContext: 'application' | 'evaluation' = 'application',
): DeepSeekProvider {
  const normalizedConfig = loadDeepSeekConfig({
    DEEPSEEK_API_KEY: config.apiKey,
    DEEPSEEK_MODEL: config.model,
    DEEPSEEK_BASE_URL: config.baseURL,
    DEEPSEEK_TIMEOUT_MS: String(config.deadlineMs),
    DEEPSEEK_TRANSPORT_TIMEOUT_MS: String(config.transportTimeoutMs),
  });
  const client = clientFactory({
    apiKey: normalizedConfig.apiKey,
    baseURL: normalizedConfig.baseURL,
    timeout: normalizedConfig.transportTimeoutMs,
    maxRetries: 0,
    logLevel: 'off',
  });
  return new DeepSeekProvider(
    client,
    normalizedConfig.model,
    normalizedConfig.deadlineMs,
    normalizedConfig.transportTimeoutMs,
    executionContext,
  );
}

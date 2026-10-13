import type { ProviderRetryMetadata } from './ProviderFailure.js';

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface StructuredOutputRequest {
  readonly instructions: string;
  readonly input: unknown;
  readonly schemaName: string;
  readonly schema: JsonSchema;
}

export interface StructuredOutputProviderOptions {
  readonly onMetadata?: (metadata: ProviderRetryMetadata) => void;
}

export interface StructuredOutputProvider {
  generateStructured(
    request: StructuredOutputRequest,
    options?: StructuredOutputProviderOptions,
  ): Promise<unknown>;
}

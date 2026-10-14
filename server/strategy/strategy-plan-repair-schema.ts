import type { JsonSchema } from '../analysis/StructuredOutputProvider.js';
import { STRATEGY_ASSERTION_JSON_SCHEMA } from './strategy-plan-schema.js';

function strictObject(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return Object.freeze({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
}

export const STRATEGY_PLAN_REPAIR_JSON_SCHEMA: JsonSchema = strictObject({
  schemaVersion: Object.freeze({ type: 'integer', const: 1 }),
  replacements: Object.freeze({
    type: 'array',
    items: strictObject({
      path: Object.freeze({ type: 'string' }),
      assertion: STRATEGY_ASSERTION_JSON_SCHEMA,
    }),
  }),
});


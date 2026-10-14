type JsonSchema = Readonly<Record<string, unknown>>;

const stringSchema = Object.freeze({ type: 'string' });

function arraySchema(items: JsonSchema): JsonSchema {
  return Object.freeze({ type: 'array', items });
}

function strictObject(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return Object.freeze({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
}

export const STRATEGY_ASSERTION_JSON_SCHEMA: JsonSchema = strictObject({
  text: stringSchema,
  grounding: Object.freeze({
    type: 'string',
    enum: Object.freeze(['fact-grounded', 'strategic-only', 'insufficient']),
  }),
  participantIds: arraySchema(stringSchema),
  factIds: arraySchema(stringSchema),
  missingKnowledge: arraySchema(stringSchema),
});

export const MATCHUP_STRATEGY_PLAN_JSON_SCHEMA: JsonSchema = strictObject({
  schemaVersion: Object.freeze({ type: 'integer', const: 1 }),
  planVersion: Object.freeze({ type: 'string', const: 'matchup-strategy-plan-v1' }),
  matchupId: stringSchema,
  patch: stringSchema,
  laneApproach: STRATEGY_ASSERTION_JSON_SCHEMA,
  threatResponseWindow: strictObject({
    threat: STRATEGY_ASSERTION_JSON_SCHEMA,
    response: STRATEGY_ASSERTION_JSON_SCHEMA,
    tradeWindow: STRATEGY_ASSERTION_JSON_SCHEMA,
    winCondition: STRATEGY_ASSERTION_JSON_SCHEMA,
  }),
  earlyLevels: strictObject({
    level1: STRATEGY_ASSERTION_JSON_SCHEMA,
    level2: STRATEGY_ASSERTION_JSON_SCHEMA,
    level3: STRATEGY_ASSERTION_JSON_SCHEMA,
  }),
  wavePlan: STRATEGY_ASSERTION_JSON_SCHEMA,
  targetPriority: STRATEGY_ASSERTION_JSON_SCHEMA,
  postLevel6: STRATEGY_ASSERTION_JSON_SCHEMA,
  roamPlan: STRATEGY_ASSERTION_JSON_SCHEMA,
});

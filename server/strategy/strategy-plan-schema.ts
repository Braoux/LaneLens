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

const assertionSchema = strictObject({
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
  laneApproach: assertionSchema,
  threatResponseWindow: strictObject({
    threat: assertionSchema,
    response: assertionSchema,
    tradeWindow: assertionSchema,
    winCondition: assertionSchema,
  }),
  earlyLevels: strictObject({
    level1: assertionSchema,
    level2: assertionSchema,
    level3: assertionSchema,
  }),
  wavePlan: assertionSchema,
  targetPriority: assertionSchema,
  postLevel6: assertionSchema,
  roamPlan: assertionSchema,
});

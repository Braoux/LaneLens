export type JsonSchema = Readonly<Record<string, unknown>>;

const stringSchema = Object.freeze({ type: 'string' });

function strictObject(
  properties: Readonly<Record<string, JsonSchema>>,
): JsonSchema {
  return Object.freeze({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
}

export const MATCHUP_ANALYSIS_JSON_SCHEMA: JsonSchema = strictObject({
  matchup: strictObject({
    allyCarry: stringSchema,
    allySupport: stringSchema,
    enemyCarry: stringSchema,
    enemySupport: stringSchema,
    patch: stringSchema,
  }),
  lanePlan: stringSchema,
  threatResponseWindow: strictObject({
    threat: stringSchema,
    response: stringSchema,
    window: stringSchema,
    winCondition: stringSchema,
  }),
  earlyLevels: strictObject({
    level1: stringSchema,
    level2: stringSchema,
    level3: stringSchema,
  }),
  wavePlan: stringSchema,
  targetPriority: strictObject({
    primaryTarget: stringSchema,
    explanation: stringSchema,
  }),
  postLevel6: stringSchema,
  roamPlan: stringSchema,
  cheatSheet: Object.freeze({
    type: 'array',
    items: stringSchema,
  }),
  goldenRule: stringSchema,
});

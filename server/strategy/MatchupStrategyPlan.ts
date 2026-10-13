export const MATCHUP_STRATEGY_PLAN_VERSION = 'matchup-strategy-plan-v1';

export const STRATEGY_GROUNDING_STATES = [
  'fact-grounded',
  'strategic-only',
  'insufficient',
] as const;

export type StrategyGroundingState = (typeof STRATEGY_GROUNDING_STATES)[number];

export interface StrategyAssertion {
  readonly text: string;
  readonly grounding: StrategyGroundingState;
  readonly participantIds: readonly string[];
  readonly factIds: readonly string[];
  readonly missingKnowledge: readonly string[];
}

export interface MatchupStrategyPlan {
  readonly schemaVersion: 1;
  readonly planVersion: typeof MATCHUP_STRATEGY_PLAN_VERSION;
  readonly matchupId: string;
  readonly patch: string;
  readonly laneApproach: StrategyAssertion;
  readonly threatResponseWindow: {
    readonly threat: StrategyAssertion;
    readonly response: StrategyAssertion;
    readonly tradeWindow: StrategyAssertion;
    readonly winCondition: StrategyAssertion;
  };
  readonly earlyLevels: {
    readonly level1: StrategyAssertion;
    readonly level2: StrategyAssertion;
    readonly level3: StrategyAssertion;
  };
  readonly wavePlan: StrategyAssertion;
  readonly targetPriority: StrategyAssertion;
  readonly postLevel6: StrategyAssertion;
  readonly roamPlan: StrategyAssertion;
}

export interface StrategyAssertionAtPath {
  readonly path: string;
  readonly assertion: StrategyAssertion;
}

export function strategyAssertions(plan: MatchupStrategyPlan): readonly StrategyAssertionAtPath[] {
  return Object.freeze([
    { path: 'laneApproach', assertion: plan.laneApproach },
    { path: 'threatResponseWindow.threat', assertion: plan.threatResponseWindow.threat },
    { path: 'threatResponseWindow.response', assertion: plan.threatResponseWindow.response },
    { path: 'threatResponseWindow.tradeWindow', assertion: plan.threatResponseWindow.tradeWindow },
    { path: 'threatResponseWindow.winCondition', assertion: plan.threatResponseWindow.winCondition },
    { path: 'earlyLevels.level1', assertion: plan.earlyLevels.level1 },
    { path: 'earlyLevels.level2', assertion: plan.earlyLevels.level2 },
    { path: 'earlyLevels.level3', assertion: plan.earlyLevels.level3 },
    { path: 'wavePlan', assertion: plan.wavePlan },
    { path: 'targetPriority', assertion: plan.targetPriority },
    { path: 'postLevel6', assertion: plan.postLevel6 },
    { path: 'roamPlan', assertion: plan.roamPlan },
  ].map((entry) => Object.freeze(entry)));
}

export interface PatchContextFact {
  readonly subject: string;
  readonly text: string;
}

export interface PatchContext {
  readonly patch: string;
  readonly contextVersion: string;
  readonly facts: readonly PatchContextFact[];
}

export interface MatchupAnalysisInput {
  readonly allyCarry: string;
  readonly allySupport: string;
  readonly enemyCarry: string;
  readonly enemySupport: string;
  readonly patch: string;
  readonly patchContext: PatchContext;
}

export interface MatchupAnalysisSource {
  readonly name: string;
  readonly url?: string;
}

export interface MatchupAnalysis {
  matchup: {
    allyCarry: string;
    allySupport: string;
    enemyCarry: string;
    enemySupport: string;
    patch: string;
  };
  lanePlan: string;
  threatResponseWindow: {
    threat: string;
    response: string;
    window: string;
    winCondition: string;
  };
  earlyLevels: {
    level1: string;
    level2: string;
    level3: string;
  };
  wavePlan: string;
  targetPriority: {
    primaryTarget: string;
    explanation: string;
  };
  postLevel6: string;
  roamPlan: string;
  cheatSheet: string[];
  goldenRule: string;
  sources?: MatchupAnalysisSource[];
}

export interface MatchupAnalysisProviderRequest {
  readonly input: MatchupAnalysisInput;
  readonly instructions: string;
}

export interface MatchupAnalysisSource {
  name: string;
  url?: string;
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

export interface MatchupRequest {
  allyCarry: string;
  allySupport: string;
  enemyCarry: string;
  enemySupport: string;
  patch: string;
}

export interface AnalysisContextResponse {
  readonly patch: string;
  readonly contextVersion: string;
}

export type ApiErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_JSON'
  | 'INVALID_MATCHUP_REQUEST'
  | 'PATCH_CONTEXT_NOT_FOUND'
  | 'PATCH_CONTEXT_UNAVAILABLE'
  | 'PATCH_CONTEXT_INVALID'
  | 'ANALYSIS_NOT_CONFIGURED'
  | 'ANALYSIS_PROVIDER_UNAVAILABLE'
  | 'INVALID_ANALYSIS_RESPONSE'
  | 'ANALYSIS_FAILED'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
  };
}

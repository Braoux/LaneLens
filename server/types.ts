export interface HealthResponse {
  status: 'ok';
}

export interface MatchupRequest {
  allyCarry: string;
  allySupport: string;
  enemyCarry: string;
  enemySupport: string;
  patch: string;
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
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

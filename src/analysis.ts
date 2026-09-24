import type {
  AnalysisContextResponse,
  MatchupAnalysis,
  MatchupAnalysisSource,
  MatchupRequest,
} from '../shared/analysis-contract';
import type { MatchupSelection } from './matchup';

export interface QuickOverlay {
  readonly plan: string;
  readonly window: {
    readonly threat: string;
    readonly response: string;
    readonly opportunity: string;
  };
  readonly early: readonly [string, string, string];
  readonly mid: readonly [string, string, string];
  readonly target: {
    readonly champion: string;
    readonly explanation: string;
  };
  readonly goldenRule: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validSource(value: unknown): value is MatchupAnalysisSource {
  if (!isRecord(value) || !nonBlank(value.name)) return false;
  if (value.url === undefined) return true;
  if (!nonBlank(value.url)) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sameChampion(actual: string, expected: string): boolean {
  return actual.trim().toLocaleLowerCase('en-US')
    === expected.trim().toLocaleLowerCase('en-US');
}

export function isAnalysisContextResponse(value: unknown): value is AnalysisContextResponse {
  return isRecord(value) && nonBlank(value.patch) && nonBlank(value.contextVersion);
}

export function buildMatchupRequest(
  selection: MatchupSelection,
  patch: string,
): MatchupRequest {
  return {
    allyCarry: selection.allyCarry.name,
    allySupport: selection.allySupport.name,
    enemyCarry: selection.enemyCarry.name,
    enemySupport: selection.enemySupport.name,
    patch: patch.trim(),
  };
}

export function isMatchupAnalysis(
  value: unknown,
  request: MatchupRequest,
): value is MatchupAnalysis {
  if (!isRecord(value) || !isRecord(value.matchup)) return false;
  const matchup = value.matchup;
  if (
    !nonBlank(matchup.allyCarry)
    || !nonBlank(matchup.allySupport)
    || !nonBlank(matchup.enemyCarry)
    || !nonBlank(matchup.enemySupport)
    || !nonBlank(matchup.patch)
  ) return false;

  if (
    !sameChampion(matchup.allyCarry, request.allyCarry)
    || !sameChampion(matchup.allySupport, request.allySupport)
    || !sameChampion(matchup.enemyCarry, request.enemyCarry)
    || !sameChampion(matchup.enemySupport, request.enemySupport)
    || matchup.patch.trim() !== request.patch.trim()
  ) return false;

  if (
    !nonBlank(value.lanePlan)
    || !isRecord(value.threatResponseWindow)
    || !nonBlank(value.threatResponseWindow.threat)
    || !nonBlank(value.threatResponseWindow.response)
    || !nonBlank(value.threatResponseWindow.window)
    || !nonBlank(value.threatResponseWindow.winCondition)
    || !isRecord(value.earlyLevels)
    || !nonBlank(value.earlyLevels.level1)
    || !nonBlank(value.earlyLevels.level2)
    || !nonBlank(value.earlyLevels.level3)
    || !nonBlank(value.wavePlan)
    || !isRecord(value.targetPriority)
    || !nonBlank(value.targetPriority.primaryTarget)
    || !nonBlank(value.targetPriority.explanation)
    || !nonBlank(value.postLevel6)
    || !nonBlank(value.roamPlan)
    || !Array.isArray(value.cheatSheet)
    || value.cheatSheet.length === 0
    || !value.cheatSheet.every(nonBlank)
    || !nonBlank(value.goldenRule)
  ) return false;

  return value.sources === undefined
    || (Array.isArray(value.sources) && value.sources.every(validSource));
}

export function toQuickOverlay(analysis: MatchupAnalysis): QuickOverlay {
  return {
    plan: analysis.lanePlan,
    window: {
      threat: analysis.threatResponseWindow.threat,
      response: analysis.threatResponseWindow.response,
      opportunity: analysis.threatResponseWindow.window,
    },
    early: [
      analysis.earlyLevels.level1,
      analysis.earlyLevels.level2,
      analysis.earlyLevels.level3,
    ],
    mid: [analysis.wavePlan, analysis.postLevel6, analysis.roamPlan],
    target: {
      champion: analysis.targetPriority.primaryTarget,
      explanation: analysis.targetPriority.explanation,
    },
    goldenRule: analysis.goldenRule,
  };
}

export function serializeCheatSheet(cheatSheet: readonly string[]): string {
  return cheatSheet.join('\n');
}

export function isActiveAnalysisRequest(requestId: number, activeRequestId: number): boolean {
  return requestId === activeRequestId;
}

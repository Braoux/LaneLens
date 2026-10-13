import type { MatchupAnalysis } from './types.js';

export interface AnalysisRepairViolation {
  readonly code: string;
  readonly category?: string;
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly subject?: string;
  readonly knowledgeId?: string;
}

const REPAIRABLE_PATHS = new Set([
  'lanePlan',
  'threatResponseWindow.threat',
  'threatResponseWindow.response',
  'threatResponseWindow.window',
  'threatResponseWindow.winCondition',
  'earlyLevels.level1',
  'earlyLevels.level2',
  'earlyLevels.level3',
  'wavePlan',
  'targetPriority.explanation',
  'postLevel6',
  'roamPlan',
  'goldenRule',
]);

function cloneAnalysis(analysis: MatchupAnalysis): MatchupAnalysis {
  return structuredClone(analysis);
}

function repairablePaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths.flatMap((path) => path.split(',')))]
    .map((path) => path.trim())
    .filter((path) => REPAIRABLE_PATHS.has(path) || /^cheatSheet\.\d+$/u.test(path)));
}

function readPath(analysis: MatchupAnalysis, path: string): string | undefined {
  if (/^cheatSheet\.\d+$/u.test(path)) {
    const index = Number(path.slice('cheatSheet.'.length));
    return analysis.cheatSheet[index];
  }
  const [first, second] = path.split('.');
  if (second === undefined) {
    const value = analysis[first as keyof MatchupAnalysis];
    return typeof value === 'string' ? value : undefined;
  }
  const parent = analysis[first as keyof MatchupAnalysis];
  if (typeof parent !== 'object' || parent === null || Array.isArray(parent)) return undefined;
  const value = (parent as unknown as Record<string, unknown>)[second];
  return typeof value === 'string' ? value : undefined;
}

function writePath(analysis: MatchupAnalysis, path: string, value: string): void {
  if (/^cheatSheet\.\d+$/u.test(path)) {
    const index = Number(path.slice('cheatSheet.'.length));
    if (index < analysis.cheatSheet.length) analysis.cheatSheet[index] = value;
    return;
  }
  const [first, second] = path.split('.');
  if (second === undefined) {
    (analysis as unknown as Record<string, unknown>)[first!] = value;
    return;
  }
  const parent = analysis[first as keyof MatchupAnalysis];
  if (typeof parent === 'object' && parent !== null && !Array.isArray(parent)) {
    (parent as unknown as Record<string, unknown>)[second] = value;
  }
}

export function applyTargetedAnalysisRepair(
  original: MatchupAnalysis,
  proposed: MatchupAnalysis,
  violationPaths: readonly string[],
): MatchupAnalysis {
  const repaired = cloneAnalysis(original);
  for (const path of repairablePaths(violationPaths)) {
    const value = readPath(proposed, path);
    if (value !== undefined) writePath(repaired, path, value);
  }
  return repaired;
}

export function targetedRepairPaths(violationPaths: readonly string[]): readonly string[] {
  return repairablePaths(violationPaths);
}

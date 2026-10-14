import {
  strategyAssertions,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from './MatchupStrategyPlan.js';

export interface StrategyAssertionReplacement {
  readonly path: string;
  readonly assertion: StrategyAssertion;
}

const REPAIRABLE_PATHS = new Set([
  'laneApproach',
  'threatResponseWindow.threat',
  'threatResponseWindow.response',
  'threatResponseWindow.tradeWindow',
  'threatResponseWindow.winCondition',
  'earlyLevels.level1',
  'earlyLevels.level2',
  'earlyLevels.level3',
  'wavePlan',
  'targetPriority',
  'postLevel6',
  'roamPlan',
]);

export function targetedStrategyRepairPaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths)].filter((path) => REPAIRABLE_PATHS.has(path)));
}

export function readStrategyAssertion(
  plan: MatchupStrategyPlan,
  path: string,
): StrategyAssertion | undefined {
  return strategyAssertions(plan).find((entry) => entry.path === path)?.assertion;
}

function writeAssertion(
  plan: MatchupStrategyPlan,
  path: string,
  assertion: StrategyAssertion,
): void {
  const [first, second] = path.split('.');
  if (second === undefined) {
    (plan as unknown as Record<string, unknown>)[first!] = assertion;
    return;
  }
  const parent = (plan as unknown as Record<string, unknown>)[first!];
  if (typeof parent === 'object' && parent !== null && !Array.isArray(parent)) {
    (parent as Record<string, unknown>)[second] = assertion;
  }
}

export function applyTargetedStrategyPlanRepair(
  original: MatchupStrategyPlan,
  replacements: readonly StrategyAssertionReplacement[],
  allowedPaths: readonly string[],
): MatchupStrategyPlan {
  const allowed = new Set(targetedStrategyRepairPaths(allowedPaths));
  const repaired = structuredClone(original);
  for (const replacement of replacements) {
    if (allowed.has(replacement.path)) {
      writeAssertion(repaired, replacement.path, structuredClone(replacement.assertion));
    }
  }
  return repaired;
}


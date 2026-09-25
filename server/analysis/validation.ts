import { MatchupAnalysisError } from './errors.js';
import type { MatchupAnalysis, MatchupAnalysisInput, PatchContext } from './types.js';
import { isAppLocale } from '../../shared/locale.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNonBlankStrings(value: UnknownRecord, keys: readonly string[]): boolean {
  return keys.every((key) => isNonBlankString(value[key]));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidPatchContext(value: unknown): value is PatchContext {
  if (!isRecord(value)) return false;
  if (!isNonBlankString(value.patch) || !isNonBlankString(value.contextVersion)) return false;
  if (!Array.isArray(value.facts) || value.facts.length === 0) return false;

  return value.facts.every((fact) =>
    isRecord(fact) && isNonBlankString(fact.subject) && isNonBlankString(fact.text),
  );
}

export function assertValidMatchupAnalysisInput(input: MatchupAnalysisInput): void {
  const inputRecord: UnknownRecord = input as unknown as UnknownRecord;
  const validRolesAndPatch = hasNonBlankStrings(inputRecord, [
    'allyCarry',
    'allySupport',
    'enemyCarry',
    'enemySupport',
    'patch',
  ]);

  if (
    !validRolesAndPatch
    || !isAppLocale(input.locale)
    || !isValidPatchContext(inputRecord.patchContext)
    || input.patch.trim() !== input.patchContext.patch.trim()
  ) {
    throw new MatchupAnalysisError('ANALYSIS_FAILED');
  }
}

function isValidSources(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;

  return value.every((source) => {
    if (!isRecord(source) || !isNonBlankString(source.name)) return false;
    if (source.url === undefined) return true;
    return isNonBlankString(source.url) && isHttpUrl(source.url);
  });
}

function normalizedChampion(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function hasCoherentMatchup(matchup: UnknownRecord, input: MatchupAnalysisInput): boolean {
  return normalizedChampion(matchup.allyCarry as string) === normalizedChampion(input.allyCarry)
    && normalizedChampion(matchup.allySupport as string) === normalizedChampion(input.allySupport)
    && normalizedChampion(matchup.enemyCarry as string) === normalizedChampion(input.enemyCarry)
    && normalizedChampion(matchup.enemySupport as string) === normalizedChampion(input.enemySupport)
    && (matchup.patch as string).trim() === input.patch.trim();
}

function isValidAnalysis(value: unknown, input: MatchupAnalysisInput): value is MatchupAnalysis {
  if (!isRecord(value)) return false;

  const matchup = value.matchup;
  const threatResponseWindow = value.threatResponseWindow;
  const earlyLevels = value.earlyLevels;
  const targetPriority = value.targetPriority;

  if (!isRecord(matchup) || !hasNonBlankStrings(matchup, [
    'allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch',
  ])) return false;
  if (!hasCoherentMatchup(matchup, input)) return false;

  if (!hasNonBlankStrings(value, [
    'lanePlan', 'wavePlan', 'postLevel6', 'roamPlan', 'goldenRule',
  ])) return false;

  if (!isRecord(threatResponseWindow) || !hasNonBlankStrings(threatResponseWindow, [
    'threat', 'response', 'window', 'winCondition',
  ])) return false;

  if (!isRecord(earlyLevels) || !hasNonBlankStrings(earlyLevels, [
    'level1', 'level2', 'level3',
  ])) return false;

  if (!isRecord(targetPriority) || !hasNonBlankStrings(targetPriority, [
    'primaryTarget', 'explanation',
  ])) return false;

  if (
    !Array.isArray(value.cheatSheet)
    || value.cheatSheet.length === 0
    || !value.cheatSheet.every(isNonBlankString)
  ) return false;

  return isValidSources(value.sources);
}

export function validateMatchupAnalysis(
  value: unknown,
  input: MatchupAnalysisInput,
): MatchupAnalysis {
  if (!isValidAnalysis(value, input)) {
    throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE');
  }

  return value;
}

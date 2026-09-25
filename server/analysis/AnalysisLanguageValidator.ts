import type { AppLocale } from '../../shared/locale.js';
import type { MatchupAnalysis } from './types.js';

export interface AnalysisLanguageViolation {
  readonly path: string;
  readonly expectedLocale: AppLocale;
}

export interface AnalysisLanguageResult {
  readonly valid: boolean;
  readonly violations: readonly AnalysisLanguageViolation[];
}

const ENGLISH_MARKERS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'when', 'after', 'before', 'while',
  'with', 'without', 'your', 'you', 'they', 'their', 'her', 'him', 'she', 'he',
  'this', 'that', 'should', 'must', 'keep', 'avoid', 'use', 'miss', 'misses',
  'missed', 'can', 'cannot', 'will', 'into', 'from', 'then', 'because', 'against',
]);

const FRENCH_MARKERS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'mais', 'quand',
  'après', 'avant', 'pendant', 'avec', 'sans', 'votre', 'vous', 'leur', 'elle', 'il',
  'ce', 'cette', 'doit', 'gardez', 'évitez', 'utilisez', 'peut', 'puis', 'car',
  'contre', 'dans', 'depuis', 'lorsque', 'sur', 'pour', 'que', 'qui',
]);

function words(value: string): readonly string[] {
  return value.toLocaleLowerCase('fr-FR').match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) ?? [];
}

function isClearlyEnglish(value: string): boolean {
  const tokens = words(value);
  if (tokens.length < 4) return false;
  const english = tokens.filter((token) => ENGLISH_MARKERS.has(token)).length;
  const french = tokens.filter((token) => FRENCH_MARKERS.has(token)).length;
  return english >= 2 && english > french;
}

function analysisTextFields(analysis: MatchupAnalysis): readonly (readonly [string, string])[] {
  return [
    ['lanePlan', analysis.lanePlan],
    ['threatResponseWindow.threat', analysis.threatResponseWindow.threat],
    ['threatResponseWindow.response', analysis.threatResponseWindow.response],
    ['threatResponseWindow.window', analysis.threatResponseWindow.window],
    ['threatResponseWindow.winCondition', analysis.threatResponseWindow.winCondition],
    ['earlyLevels.level1', analysis.earlyLevels.level1],
    ['earlyLevels.level2', analysis.earlyLevels.level2],
    ['earlyLevels.level3', analysis.earlyLevels.level3],
    ['wavePlan', analysis.wavePlan],
    ['targetPriority.explanation', analysis.targetPriority.explanation],
    ['postLevel6', analysis.postLevel6],
    ['roamPlan', analysis.roamPlan],
    ...analysis.cheatSheet.map((value, index) => [`cheatSheet.${index}`, value] as const),
    ['goldenRule', analysis.goldenRule],
  ];
}

export class AnalysisLanguageValidator {
  validate(analysis: MatchupAnalysis, expectedLocale: AppLocale): AnalysisLanguageResult {
    const violations = expectedLocale === 'fr-FR'
      ? analysisTextFields(analysis)
        .filter(([, value]) => isClearlyEnglish(value))
        .map(([path]) => ({ path, expectedLocale }))
      : [];

    return Object.freeze({
      valid: violations.length === 0,
      violations: Object.freeze(violations),
    });
  }
}

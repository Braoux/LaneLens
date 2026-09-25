import type { MatchupAnalysis, MatchupRequest } from '../shared/analysis-contract';
import { isMatchupAnalysis } from './analysis';
import type { Champion } from './champions';
import type { MatchupSelection } from './matchup';
import { browserStorage, readJson, writeJson } from './storage';
import type { LocalStore } from './storage';
import { DEFAULT_LOCALE, isAppLocale } from '../shared/locale';
import type { AppLocale } from '../shared/locale';

export const MATCHUP_HISTORY_STORAGE_KEY = 'lanelens.matchup-history.v2';
export const MATCHUP_HISTORY_VERSION = 2;
export const MATCHUP_HISTORY_LIMIT = 10;

export interface MatchupHistoryEntry {
  readonly selection: MatchupSelection;
  readonly patch: string;
  readonly locale: AppLocale;
  readonly analysis: MatchupAnalysis;
  readonly generatedAt: string;
}

interface StoredMatchupHistory {
  readonly version: 2;
  readonly entries: readonly MatchupHistoryEntry[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isHttpUrl(value: unknown): value is string {
  if (!nonBlank(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isChampionSnapshot(value: unknown): value is Champion {
  return isRecord(value)
    && hasExactKeys(value, ['id', 'name', 'imageUrl'])
    && nonBlank(value.id)
    && nonBlank(value.name)
    && isHttpUrl(value.imageUrl);
}

function isSelectionSnapshot(value: unknown): value is MatchupSelection {
  return isRecord(value)
    && hasExactKeys(value, ['allyCarry', 'allySupport', 'enemyCarry', 'enemySupport'])
    && isChampionSnapshot(value.allyCarry)
    && isChampionSnapshot(value.allySupport)
    && isChampionSnapshot(value.enemyCarry)
    && isChampionSnapshot(value.enemySupport);
}

function hasStrictAnalysisShape(value: unknown): value is MatchupAnalysis {
  if (!isRecord(value)) return false;
  const rootKeys = value.sources === undefined
    ? ['matchup', 'lanePlan', 'threatResponseWindow', 'earlyLevels', 'wavePlan', 'targetPriority', 'postLevel6', 'roamPlan', 'cheatSheet', 'goldenRule']
    : ['matchup', 'lanePlan', 'threatResponseWindow', 'earlyLevels', 'wavePlan', 'targetPriority', 'postLevel6', 'roamPlan', 'cheatSheet', 'goldenRule', 'sources'];
  if (!hasExactKeys(value, rootKeys)) return false;
  if (
    !isRecord(value.matchup)
    || !hasExactKeys(value.matchup, ['allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch'])
    || !isRecord(value.threatResponseWindow)
    || !hasExactKeys(value.threatResponseWindow, ['threat', 'response', 'window', 'winCondition'])
    || !isRecord(value.earlyLevels)
    || !hasExactKeys(value.earlyLevels, ['level1', 'level2', 'level3'])
    || !isRecord(value.targetPriority)
    || !hasExactKeys(value.targetPriority, ['primaryTarget', 'explanation'])
  ) return false;
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources)) return false;
    if (!value.sources.every((source) => isRecord(source)
      && hasExactKeys(source, source.url === undefined ? ['name'] : ['name', 'url']))) return false;
  }
  return true;
}

function requestFromEntry(
  selection: MatchupSelection,
  patch: string,
  locale: AppLocale,
): MatchupRequest {
  return {
    allyCarry: selection.allyCarry.name,
    allySupport: selection.allySupport.name,
    enemyCarry: selection.enemyCarry.name,
    enemySupport: selection.enemySupport.name,
    patch,
    locale,
  };
}

export function isMatchupHistoryEntry(value: unknown): value is MatchupHistoryEntry {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['selection', 'patch', 'locale', 'analysis', 'generatedAt'])
    || !isSelectionSnapshot(value.selection)
    || !nonBlank(value.patch)
    || !isAppLocale(value.locale)
    || !isCanonicalIsoDate(value.generatedAt)
    || !hasStrictAnalysisShape(value.analysis)
  ) return false;

  return isMatchupAnalysis(
    value.analysis,
    requestFromEntry(value.selection, value.patch.trim(), value.locale),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableCopy(entry: MatchupHistoryEntry): MatchupHistoryEntry {
  return deepFreeze(structuredClone(entry));
}

export function matchupHistoryIdentity(entry: Pick<MatchupHistoryEntry, 'selection' | 'patch' | 'locale'>): string {
  const { selection } = entry;
  return JSON.stringify([
    entry.locale,
    entry.patch.trim(),
    selection.allyCarry.name.trim().toLocaleLowerCase('en-US'),
    selection.allySupport.name.trim().toLocaleLowerCase('en-US'),
    selection.enemyCarry.name.trim().toLocaleLowerCase('en-US'),
    selection.enemySupport.name.trim().toLocaleLowerCase('en-US'),
  ]);
}

export function normalizeMatchupHistory(value: unknown, locale: AppLocale = DEFAULT_LOCALE): readonly MatchupHistoryEntry[] {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['version', 'entries'])
    || value.version !== MATCHUP_HISTORY_VERSION
    || !Array.isArray(value.entries)
  ) return Object.freeze([]);

  const identities = new Set<string>();
  const entries: MatchupHistoryEntry[] = [];
  for (const candidate of value.entries) {
    if (!isMatchupHistoryEntry(candidate) || candidate.locale !== locale) continue;
    const identity = matchupHistoryIdentity(candidate);
    if (identities.has(identity)) continue;
    identities.add(identity);
    entries.push(immutableCopy(candidate));
    if (entries.length === MATCHUP_HISTORY_LIMIT) break;
  }
  return Object.freeze(entries);
}

export function addMatchupHistoryEntry(
  entries: readonly MatchupHistoryEntry[],
  locale: AppLocale,
  selection: MatchupSelection,
  analysis: MatchupAnalysis,
  generatedAt = new Date().toISOString(),
): readonly MatchupHistoryEntry[] {
  const entry = immutableCopy({
    selection,
    patch: analysis.matchup.patch.trim(),
    locale,
    analysis,
    generatedAt,
  });
  if (!isMatchupHistoryEntry(entry)) return Object.freeze(entries.map(immutableCopy));

  const identity = matchupHistoryIdentity(entry);
  return Object.freeze([
    entry,
    ...entries.filter((candidate) => matchupHistoryIdentity(candidate) !== identity)
      .slice(0, MATCHUP_HISTORY_LIMIT - 1)
      .map(immutableCopy),
  ]);
}

export class MatchupHistoryStore {
  private entries: readonly MatchupHistoryEntry[];

  constructor(
    private readonly storage: LocalStore | undefined = browserStorage(),
    private readonly now: () => Date = () => new Date(),
    private readonly locale: AppLocale = DEFAULT_LOCALE,
  ) {
    this.entries = normalizeMatchupHistory(readJson(storage, MATCHUP_HISTORY_STORAGE_KEY), locale);
  }

  getEntries(): readonly MatchupHistoryEntry[] {
    return Object.freeze(this.entries.map(immutableCopy));
  }

  add(selection: MatchupSelection, analysis: MatchupAnalysis): readonly MatchupHistoryEntry[] {
    this.entries = addMatchupHistoryEntry(
      this.entries,
      this.locale,
      selection,
      analysis,
      this.now().toISOString(),
    );
    const stored: StoredMatchupHistory = {
      version: MATCHUP_HISTORY_VERSION,
      entries: this.entries,
    };
    writeJson(this.storage, MATCHUP_HISTORY_STORAGE_KEY, stored);
    return this.getEntries();
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchupAnalysis } from '../shared/analysis-contract';
import {
  MATCHUP_HISTORY_LIMIT,
  MATCHUP_HISTORY_STORAGE_KEY,
  MATCHUP_HISTORY_VERSION,
  MatchupHistoryStore,
  addMatchupHistoryEntry,
  isMatchupHistoryEntry,
  matchupHistoryIdentity,
  normalizeMatchupHistory,
} from '../src/history';
import type { MatchupHistoryEntry } from '../src/history';
import type { MatchupSelection } from '../src/matchup';
import type { LocalStore } from '../src/storage';

const selection = (suffix = ''): MatchupSelection => ({
  allyCarry: { id: `Ziggs${suffix}`, name: `Ziggs${suffix}`, imageUrl: `https://cdn.example/Ziggs${suffix}.png` },
  allySupport: { id: `Galio${suffix}`, name: `Galio${suffix}`, imageUrl: `https://cdn.example/Galio${suffix}.png` },
  enemyCarry: { id: `Jinx${suffix}`, name: `Jinx${suffix}`, imageUrl: `https://cdn.example/Jinx${suffix}.png` },
  enemySupport: { id: `Swain${suffix}`, name: `Swain${suffix}`, imageUrl: `https://cdn.example/Swain${suffix}.png` },
});

const analysis = (snapshot = selection(), patch = '26.19'): MatchupAnalysis => ({
  matchup: {
    allyCarry: snapshot.allyCarry.name,
    allySupport: snapshot.allySupport.name,
    enemyCarry: snapshot.enemyCarry.name,
    enemySupport: snapshot.enemySupport.name,
    patch,
  },
  lanePlan: 'Plan.',
  threatResponseWindow: { threat: 'Threat.', response: 'Response.', window: 'Window.', winCondition: 'Win.' },
  earlyLevels: { level1: 'N1.', level2: 'N2.', level3: 'N3.' },
  wavePlan: 'Wave.',
  targetPriority: { primaryTarget: snapshot.enemyCarry.name, explanation: 'Target.' },
  postLevel6: 'Six.',
  roamPlan: 'Roam.',
  cheatSheet: ['Rappel.'],
  goldenRule: 'Rule.',
  sources: [{ name: 'Riot', url: 'https://example.com/source' }],
});

const entry = (
  snapshot = selection(),
  patch = '26.19',
  generatedAt = '2026-09-24T15:42:00.000Z',
): MatchupHistoryEntry => ({
  selection: snapshot,
  patch,
  locale: 'fr-FR',
  analysis: analysis(snapshot, patch),
  generatedAt,
});

class MemoryStorage implements LocalStore {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
}

test('missing, malformed, incompatible, and empty storage load as an empty history', () => {
  const invalidValues: unknown[] = [
    undefined,
    null,
    {},
    { version: 2, entries: [] },
    { version: 1, entries: 'not-an-array' },
    { version: 1, entries: [], extra: true },
  ];
  for (const value of invalidValues) assert.deepEqual(normalizeMatchupHistory(value), []);

  const storage = new MemoryStorage();
  storage.values.set(MATCHUP_HISTORY_STORAGE_KEY, '{not-json');
  assert.deepEqual(new MatchupHistoryStore(storage).getEntries(), []);
});

test('v1 history is ignored instead of being relabelled as French', () => {
  assert.deepEqual(normalizeMatchupHistory({ version: 1, entries: [entry()] }), []);
  assert.equal(MATCHUP_HISTORY_STORAGE_KEY, 'lanelens.matchup-history.v2');
});

test('history entry validation rejects invalid fields and incoherent analyses', () => {
  const valid = entry();
  assert.equal(isMatchupHistoryEntry(valid), true);

  const wrongMatchup = structuredClone(valid);
  wrongMatchup.analysis.matchup.enemyCarry = 'Caitlyn';
  const wrongPatch = structuredClone(valid);
  wrongPatch.analysis.matchup.patch = '26.18';
  const unsafeSource = structuredClone(valid);
  unsafeSource.analysis.sources = [{ name: 'Source', url: 'javascript:alert(1)' }];
  const extraProviderField = { ...structuredClone(valid), provider: 'gemini' };

  for (const invalid of [
    { ...valid, patch: '   ' },
    { ...valid, generatedAt: 'not-a-date' },
    { ...valid, generatedAt: '2026-09-24' },
    { ...valid, selection: { ...valid.selection, allyCarry: { ...valid.selection.allyCarry, id: '' } } },
    { ...valid, selection: { ...valid.selection, allyCarry: { ...valid.selection.allyCarry, name: ' ' } } },
    { ...valid, selection: { ...valid.selection, allyCarry: { ...valid.selection.allyCarry, imageUrl: '/relative.png' } } },
    { ...valid, analysis: { ...valid.analysis, cheatSheet: [] } },
    wrongMatchup,
    wrongPatch,
    unsafeSource,
    extraProviderField,
  ]) assert.equal(isMatchupHistoryEntry(invalid), false);
});

test('valid entries survive around invalid entries without rejecting the envelope', () => {
  const first = entry(selection('A'), '26.19', '2026-09-24T16:00:00.000Z');
  const second = entry(selection('B'), '26.19', '2026-09-24T15:00:00.000Z');
  const invalid = { ...entry(selection('X')), generatedAt: 'invalid' };

  const loaded = normalizeMatchupHistory({
    version: MATCHUP_HISTORY_VERSION,
    entries: [first, invalid, second],
  });
  assert.deepEqual(loaded.map((item) => item.selection.allyCarry.name), ['ZiggsA', 'ZiggsB']);
});

test('identity trims patch and compares positional champion names case-insensitively', () => {
  const original = entry();
  const normalized = entry({
    allyCarry: { ...original.selection.allyCarry, name: ' ziggs ' },
    allySupport: { ...original.selection.allySupport, name: ' GALIO ' },
    enemyCarry: { ...original.selection.enemyCarry, name: ' jinx ' },
    enemySupport: { ...original.selection.enemySupport, name: ' SWAIN ' },
  }, ' 26.19 ');
  assert.equal(matchupHistoryIdentity(original), matchupHistoryIdentity(normalized));
  assert.match(matchupHistoryIdentity(original), /^\["fr-FR",/);

  const swapped = entry({
    ...original.selection,
    allyCarry: original.selection.allySupport,
    allySupport: original.selection.allyCarry,
  });
  assert.notEqual(matchupHistoryIdentity(original), matchupHistoryIdentity(swapped));
});

test('stored duplicates keep the first valid occurrence in recent-to-old order', () => {
  const recent = entry(selection(), '26.19', '2026-09-24T16:00:00.000Z');
  const old = entry(selection(), '26.19', '2026-09-24T14:00:00.000Z');
  const distinct = entry(selection('B'), '26.19', '2026-09-24T13:00:00.000Z');
  const loaded = normalizeMatchupHistory({ version: MATCHUP_HISTORY_VERSION, entries: [recent, old, distinct] });

  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]?.generatedAt, recent.generatedAt);
  assert.equal(loaded[1]?.selection.allyCarry.name, 'ZiggsB');
});

test('adding the same identity replaces it, renews its date, and moves it first', () => {
  const old = entry(selection(), '26.19', '2026-09-24T14:00:00.000Z');
  const distinct = entry(selection('B'), '26.19', '2026-09-24T15:00:00.000Z');
  const latestAnalysis = analysis(selection(), '26.19');
  latestAnalysis.lanePlan = 'Nouveau plan.';

  const result = addMatchupHistoryEntry(
    [distinct, old],
    'fr-FR',
    selection(),
    latestAnalysis,
    '2026-09-24T17:00:00.000Z',
  );
  assert.equal(result.length, 2);
  assert.equal(result[0]?.generatedAt, '2026-09-24T17:00:00.000Z');
  assert.equal(result[0]?.analysis.lanePlan, 'Nouveau plan.');
  assert.equal(result[1]?.selection.allyCarry.name, 'ZiggsB');
});

test('history keeps at most ten entries in recent-to-old order', () => {
  let entries: readonly MatchupHistoryEntry[] = [];
  for (let index = 0; index < 11; index += 1) {
    const snapshot = selection(String(index));
    entries = addMatchupHistoryEntry(
      entries,
      'fr-FR',
      snapshot,
      analysis(snapshot),
      new Date(Date.UTC(2026, 8, 24, 10, index)).toISOString(),
    );
  }

  assert.equal(entries.length, MATCHUP_HISTORY_LIMIT);
  assert.equal(entries[0]?.selection.allyCarry.name, 'Ziggs10');
  assert.equal(entries.at(-1)?.selection.allyCarry.name, 'Ziggs1');
});

test('failed persistence keeps the current in-memory history usable', () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const store = new MatchupHistoryStore(storage, () => new Date('2026-09-24T17:00:00.000Z'));

  assert.doesNotThrow(() => store.add(selection(), analysis()));
  assert.equal(store.getEntries().length, 1);
  assert.equal(storage.values.has(MATCHUP_HISTORY_STORAGE_KEY), false);
});

test('serialized entries are restored by a new store without network or catalogue access', () => {
  const storage = new MemoryStorage();
  const first = new MatchupHistoryStore(storage, () => new Date('2026-09-24T17:00:00.000Z'));
  first.add(selection(), analysis());

  const restored = new MatchupHistoryStore(storage);
  assert.equal(restored.getEntries().length, 1);
  assert.deepEqual(restored.getEntries()[0]?.selection, selection());
  assert.match(storage.values.get(MATCHUP_HISTORY_STORAGE_KEY) ?? '', /"version":2/);
});

test('returned entries cannot mutate future in-memory reads', () => {
  const store = new MatchupHistoryStore(undefined, () => new Date('2026-09-24T17:00:00.000Z'));
  store.add(selection(), analysis());
  const first = store.getEntries();

  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0]));
  assert.throws(() => {
    (first[0]!.selection.allyCarry as { name: string }).name = 'Corrupted';
  });
  assert.equal(store.getEntries()[0]?.selection.allyCarry.name, 'Ziggs');
});

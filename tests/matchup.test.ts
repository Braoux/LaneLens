import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSelectChampion,
  championUnavailableReason,
  isCompleteSelection,
  searchChampions,
  selectChampion,
  snapshotSelection,
} from '../src/matchup';
import type { Champion } from '../src/champions';
import type { DraftSelection } from '../src/matchup';

const champion = (id: string, name = id): Champion => ({ id, name, imageUrl: `https://example.test/${id}.png` });
const jinx = champion('Jinx');
const thresh = champion('Thresh');
const caitlyn = champion('Caitlyn');
const lux = champion('Lux');

test('search is case-insensitive and matches a partial localized name', () => {
  const champions = [jinx, thresh, champion('MonkeyKing', 'Wukong')];
  assert.deepEqual(searchChampions(champions, 'jin'), [jinx]);
  assert.deepEqual(searchChampions(champions, 'JIN'), [jinx]);
  assert.deepEqual(searchChampions(champions, '  kong '), [champions[2]]);
  assert.deepEqual(searchChampions(champions, 'absent'), []);
});

test('duplicates are unavailable by default but remain visible to the caller', () => {
  const selection = { allyCarry: jinx };
  assert.equal(canSelectChampion(selection, 'enemyCarry', jinx.id, false), false);
  assert.equal(championUnavailableReason(selection, 'enemyCarry', jinx.id, false), 'opponent-duplicate');
  assert.equal(selectChampion(selection, 'enemyCarry', jinx, false), selection);
});

test('Mirror allows one occurrence in each opposing team', () => {
  const selection = { allyCarry: jinx };
  const mirrored = selectChampion(selection, 'enemyCarry', jinx, true);
  assert.equal(mirrored.enemyCarry, jinx);
  assert.equal(canSelectChampion(mirrored, 'enemyCarry', jinx.id, true), true);
});

test('Mirror never allows a duplicate inside the same team', () => {
  const selection = { allyCarry: jinx };
  assert.equal(championUnavailableReason(selection, 'allySupport', jinx.id, true), 'same-team');
  assert.equal(canSelectChampion(selection, 'allySupport', jinx.id, true), false);
});

test('a third occurrence is unavailable regardless of Mirror state', () => {
  const selection = { allyCarry: jinx, enemyCarry: jinx };
  assert.equal(championUnavailableReason(selection, 'enemySupport', jinx.id, true), 'maximum-occurrences');
  assert.equal(canSelectChampion(selection, 'enemySupport', jinx.id, true), false);
  assert.equal(canSelectChampion(selection, 'allySupport', jinx.id, false), false);
});

test('a selected champion can be replaced without changing other slots', () => {
  const initial = { allyCarry: jinx, allySupport: thresh };
  const changed = selectChampion(initial, 'allyCarry', caitlyn, false);
  assert.equal(changed.allyCarry, caitlyn);
  assert.equal(changed.allySupport, thresh);
  assert.equal(initial.allyCarry, jinx);
});

test('selection is complete only when the exact four named slots are filled', () => {
  const partial: DraftSelection = { allyCarry: jinx, allySupport: thresh, enemyCarry: caitlyn };
  assert.equal(isCompleteSelection(partial), false);
  assert.equal(snapshotSelection(partial), undefined);
  const complete = { ...partial, enemySupport: lux };
  assert.equal(isCompleteSelection(complete), true);
  assert.deepEqual(snapshotSelection(complete), complete);
  assert.ok(Object.isFrozen(snapshotSelection(complete)));
});

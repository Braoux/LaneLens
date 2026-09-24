import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatchupRequest,
  isActiveAnalysisRequest,
  isAnalysisContextResponse,
  isMatchupAnalysis,
  serializeCheatSheet,
  toQuickOverlay,
} from '../src/analysis';
import type { MatchupAnalysis } from '../shared/analysis-contract';
import type { MatchupSelection } from '../src/matchup';

const selection: MatchupSelection = {
  allyCarry: { id: 'Ziggs', name: 'Ziggs', imageUrl: '/ziggs.png' },
  allySupport: { id: 'Galio', name: 'Galio', imageUrl: '/galio.png' },
  enemyCarry: { id: 'Jinx', name: 'Jinx', imageUrl: '/jinx.png' },
  enemySupport: { id: 'Swain', name: 'Swain', imageUrl: '/swain.png' },
};

const request = buildMatchupRequest(selection, ' 26.19 ');

const analysis = (): MatchupAnalysis => ({
  matchup: { ...request },
  lanePlan: 'Plan exact.',
  threatResponseWindow: {
    threat: 'Threat exact.',
    response: 'Response exacte.',
    window: 'Window exacte.',
    winCondition: 'Win condition exacte.',
  },
  earlyLevels: { level1: 'N1 exact.', level2: 'N2 exact.', level3: 'N3 exact.' },
  wavePlan: 'Wave exacte.',
  targetPriority: { primaryTarget: 'Jinx', explanation: 'Target exacte.' },
  postLevel6: 'Niveau 6 exact.',
  roamPlan: 'Roaming exact.',
  cheatSheet: ['Premier rappel', 'Second rappel'],
  goldenRule: 'Golden rule exacte.',
  sources: [{ name: 'Riot Games', url: 'https://www.leagueoflegends.com/' }],
});

test('analysis context discovery accepts only non-blank patch metadata', () => {
  assert.equal(isAnalysisContextResponse({ patch: '26.19', contextVersion: '26.19-v1' }), true);
  assert.equal(isAnalysisContextResponse({ patch: ' ', contextVersion: '26.19-v1' }), false);
  assert.equal(isAnalysisContextResponse({ patch: '26.19' }), false);
  assert.equal(isAnalysisContextResponse(null), false);
});

test('MatchupRequest contains exactly the selected champion names and discovered patch', () => {
  assert.deepEqual(request, {
    allyCarry: 'Ziggs',
    allySupport: 'Galio',
    enemyCarry: 'Jinx',
    enemySupport: 'Swain',
    patch: '26.19',
  });
  assert.deepEqual(Object.keys(request).sort(), [
    'allyCarry', 'allySupport', 'enemyCarry', 'enemySupport', 'patch',
  ].sort());
});

test('frontend validation accepts a complete coherent response', () => {
  assert.equal(isMatchupAnalysis(analysis(), request), true);
  const normalized = analysis();
  normalized.matchup.allyCarry = ' ziggs ';
  assert.equal(isMatchupAnalysis(normalized, request), true);
});

test('frontend validation rejects malformed and incoherent successful responses', () => {
  const wrongChampion = analysis();
  wrongChampion.matchup.enemyCarry = 'Caitlyn';
  const wrongPatch = analysis();
  wrongPatch.matchup.patch = '26.19.1';
  const emptyCheatSheet = analysis();
  emptyCheatSheet.cheatSheet = [];
  const blankField = analysis();
  blankField.wavePlan = '   ';
  const unsafeSource = analysis();
  unsafeSource.sources = [{ name: 'Source', url: 'javascript:alert(1)' }];

  for (const value of [wrongChampion, wrongPatch, emptyCheatSheet, blankField, unsafeSource, null]) {
    assert.equal(isMatchupAnalysis(value, request), false);
  }
});

test('Quick Overlay follows the exact field-by-field mapping without a Late section', () => {
  const quick = toQuickOverlay(analysis());
  assert.deepEqual(quick, {
    plan: 'Plan exact.',
    window: {
      threat: 'Threat exact.',
      response: 'Response exacte.',
      opportunity: 'Window exacte.',
    },
    early: ['N1 exact.', 'N2 exact.', 'N3 exact.'],
    mid: ['Wave exacte.', 'Niveau 6 exact.', 'Roaming exact.'],
    target: { champion: 'Jinx', explanation: 'Target exacte.' },
    goldenRule: 'Golden rule exacte.',
  });
  assert.equal('late' in quick, false);
});

test('stale responses are rejected by the monotonic request token', () => {
  assert.equal(isActiveAnalysisRequest(4, 4), true);
  assert.equal(isActiveAnalysisRequest(3, 4), false);
});

test('cheat sheet serialization uses exactly one newline between entries', () => {
  assert.equal(serializeCheatSheet(['Premier rappel', 'Second rappel']), 'Premier rappel\nSecond rappel');
});

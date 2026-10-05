import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { StaticGameplayContextResolver } from '../server/gameplay-context/StaticGameplayContextResolver.js';
import type {
  ChampionGameplayContext,
  GameplayContextResolver,
} from '../server/gameplay-context/types.js';
import {
  evaluateMechanicalCoverage,
} from '../server/knowledge/MechanicalCoverageGate.js';
import { KnowledgeResolver } from '../server/knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../server/knowledge/StaticKnowledgeRepository.js';
import { MECHANICAL_GOLDEN_TRUTH } from '../server/knowledge/data/mechanical-golden-truth.js';
import {
  TRUSTED_ABILITY_MECHANICS,
} from '../server/knowledge/data/trusted-mechanics.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';
import {
  assertMechanicalCoverageGate,
  formatMechanicalCoverageReport,
} from '../scripts/evaluation/mechanical-coverage.js';
import type { CorpusMatchup } from '../scripts/evaluation/types.js';

const corpusDirectory = fileURLToPath(new URL('../evaluation/corpus/', import.meta.url));
const goldenCorpusFile = readdirSync(corpusDirectory).find((file) => {
  if (!file.endsWith('.json')) return false;
  return readFileSync(`${corpusDirectory}/${file}`, 'utf8').includes('"fullCoverageGate"');
});
assert.ok(goldenCorpusFile, 'Expected a golden corpus declaring fullCoverageGate.');
const corpusPath = `${corpusDirectory}/${goldenCorpusFile}`;

async function goldenCorpus() {
  return (await loadEvaluationCorpus(corpusPath)).corpus;
}

function withoutMechanic(key: string) {
  return Object.freeze(Object.fromEntries(
    Object.entries(TRUSTED_ABILITY_MECHANICS).filter(([candidate]) => candidate !== key),
  ));
}

test('golden truth covers the expected eight champion owners, slots and level-six ultimates', () => {
  const resolver = new StaticGameplayContextResolver();
  const gameplay = resolver.resolve(MECHANICAL_GOLDEN_TRUTH.champions);
  assert.equal(gameplay.champions.length, 8);
  assert.deepEqual(
    gameplay.champions.map(({ champion }) => champion),
    MECHANICAL_GOLDEN_TRUTH.champions,
  );
  for (const context of gameplay.champions) {
    assert.deepEqual(context.abilities.map(({ slot }) => slot), ['P', 'Q', 'W', 'E', 'R']);
    assert.ok(context.abilities.every(({ name }) => name.length > 0));
    assert.equal(context.abilities.find(({ slot }) => slot === 'R')?.availability.earliestLevel, 6);
    assert.ok(context.abilities.every(({ availability }) => availability.exceptions === undefined));
  }
});

test('curated golden mechanics close critical effects and cast models', () => {
  assert.deepEqual(TRUSTED_ABILITY_MECHANICS['jinx:e'], {
    castModel: 'ground-targeted', effects: ['root'], complete: true,
  });
  assert.deepEqual(TRUSTED_ABILITY_MECHANICS['morgana:e'], {
    castModel: 'target-ally', effects: ['shield'], complete: true,
  });
  assert.deepEqual(TRUSTED_ABILITY_MECHANICS['galio:r'], {
    castModel: 'target-ally', effects: ['shield', 'knock-up'], complete: true,
  });
  assert.deepEqual(TRUSTED_ABILITY_MECHANICS['leona:r'], {
    castModel: 'ground-targeted', effects: ['stun', 'slow'], complete: true,
  });
  assert.deepEqual(TRUSTED_ABILITY_MECHANICS['swain:e'], {
    castModel: 'directional', effects: ['root', 'displacement'], complete: true,
  });
});

test('the frozen golden corpus passes the global mechanical coverage gate', async () => {
  const corpus = await goldenCorpus();
  const result = evaluateMechanicalCoverage(corpus.matchups, corpus.patch);
  assert.equal(result.goldenTruthVersion, 'mechanical-golden-v1');
  assert.equal(result.coveredChampions, 8);
  assert.equal(result.totalChampions, 8);
  assert.equal(result.coveredMatchups, 10);
  assert.equal(result.totalMatchups, 10);
  assert.equal(result.fullyCovered, true);
  assert.doesNotThrow(() => assertMechanicalCoverageGate(corpus));
  assert.match(formatMechanicalCoverageReport(result), /10\/10 mechanically fully covered/u);
});

test('the gate explains a missing mechanic and marks only affected matchups partial', async () => {
  const corpus = await goldenCorpus();
  const result = evaluateMechanicalCoverage(corpus.matchups, corpus.patch, {
    mechanics: withoutMechanic('jinx:e'),
  });
  assert.equal(result.fullyCovered, false);
  assert.equal(result.coveredChampions, 7);
  assert.equal(result.coveredMatchups, 3);
  assert.deepEqual(
    result.matchups.filter(({ fullyCovered }) => !fullyCovered).map(({ id }) => id),
    ['L61-G01', 'L61-G03', 'L61-G04', 'L61-G06', 'L61-G07', 'L61-G09', 'L61-G10'],
  );
  assert.ok(result.matchups
    .filter(({ fullyCovered }) => !fullyCovered)
    .every(({ missing }) => missing.includes('Jinx E normalized mechanics not complete')));
});

test('the gate reports a missing mechanical fact without treating absence as proof', async () => {
  const corpus = await goldenCorpus();
  const source = new StaticGameplayContextResolver().resolve(
    MECHANICAL_GOLDEN_TRUTH.champions,
  ).champions;
  const contexts = source.map((context): ChampionGameplayContext => context.champion !== 'Jinx'
    ? context
    : {
      ...context,
      abilities: context.abilities.map((ability) => ability.slot !== 'E'
        ? ability
        : { ...ability, facts: [] }),
    });
  const fixtureResolver: GameplayContextResolver = {
    resolve(champions) {
      const selected = champions.map((champion) => contexts.find((item) => item.champion === champion));
      if (selected.some((item) => item === undefined)) return { champions: [] };
      return { champions: selected as ChampionGameplayContext[] };
    },
  };
  const result = evaluateMechanicalCoverage(corpus.matchups, corpus.patch, {
    gameplayResolver: fixtureResolver,
  });
  assert.equal(result.fullyCovered, false);
  assert.ok(result.champions.find(({ champion }) => champion === 'Jinx')?.issues
    .some(({ message }) => message === 'Jinx E mechanical facts missing'));
});

test('a champion outside the golden truth is rejected explicitly', () => {
  const matchup: CorpusMatchup = {
    id: 'OUTSIDE', patch: '26.19',
    ally: { carry: 'Ahri', support: 'Lux' },
    enemy: { carry: 'Caitlyn', support: 'Leona' },
    tags: ['test'], sentinel: true,
  };
  const result = evaluateMechanicalCoverage([matchup], matchup.patch);
  assert.equal(result.matchups[0]?.fullyCovered, false);
  assert.deepEqual(result.matchups[0]?.missing, ['Ahri absent from mechanical golden truth']);
});

test('KnowledgeCoverage.full never implies mechanically fully-covered', async () => {
  const corpus = await goldenCorpus();
  const matchup = corpus.matchups.find(({ id }) => id === 'L61-G06')!;
  const champions = [
    matchup.ally.carry, matchup.ally.support, matchup.enemy.carry, matchup.enemy.support,
  ];
  const knowledge = new KnowledgeResolver(new StaticKnowledgeRepository()).resolve({
    champions,
    patch: corpus.patch,
  });
  const mechanical = evaluateMechanicalCoverage([matchup], corpus.patch, {
    mechanics: withoutMechanic('jinx:e'),
  });
  assert.equal(knowledge.coverage.status, 'full');
  assert.equal(mechanical.matchups[0]?.fullyCovered, false);
});

test('golden corpus invariants remain frozen, unique and sentinel-only', async () => {
  const corpus = await goldenCorpus();
  assert.equal(corpus.patch, '26.19');
  assert.equal(corpus.frozen, true);
  assert.equal(corpus.matchups.length, 10);
  assert.equal(new Set(corpus.matchups.map(({ id }) => id)).size, 10);
  assert.equal(corpus.matchups.every(({ sentinel, patch }) => sentinel && patch === '26.19'), true);
  assert.ok(corpus.fullCoverageGate);
});

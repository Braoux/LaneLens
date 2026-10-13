import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  StaticGameplayContextResolver,
} from '../server/gameplay-context/StaticGameplayContextResolver.js';
import type {
  ChampionGameplayContext,
  GameplayContextResolver,
} from '../server/gameplay-context/types.js';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import { KnowledgeResolver } from '../server/knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../server/knowledge/StaticKnowledgeRepository.js';
import { DERIVATION_RULES } from '../server/knowledge/data/derivation-rules.js';
import {
  KNOWLEDGE_BASE_VERSION,
  KNOWLEDGE_ENTRIES,
} from '../server/knowledge/data/knowledge.js';
import { MECHANICAL_GOLDEN_TRUTH } from '../server/knowledge/data/mechanical-golden-truth.js';
import { TRUSTED_ABILITY_MECHANICS } from '../server/knowledge/data/trusted-mechanics.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';
import {
  inspectFactPack,
  parseInspectFactPackArguments,
} from '../scripts/evaluation/inspect-fact-pack.js';

const corpusPath = fileURLToPath(new URL('../evaluation/corpus/lan-061-golden-v1.json', import.meta.url));

async function goldenMatchup(id = 'L61-G06') {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  return corpus.matchups.find((matchup) => matchup.id === id)!;
}

function withoutMechanic(key: string) {
  return Object.freeze(Object.fromEntries(
    Object.entries(TRUSTED_ABILITY_MECHANICS).filter(([candidate]) => candidate !== key),
  ));
}

function withoutJinxEMechanicContext(): GameplayContextResolver {
  const contexts = new StaticGameplayContextResolver().resolve(
    MECHANICAL_GOLDEN_TRUTH.champions,
  ).champions.map((context): ChampionGameplayContext => context.champion !== 'Jinx'
    ? context
    : {
      ...context,
      abilities: context.abilities.map((ability) => ability.slot !== 'E'
        ? ability
        : { ...ability, castModel: undefined, effects: undefined }),
    });
  return {
    resolve(champions) {
      return {
        champions: champions.map((champion) => contexts.find((context) => context.champion === champion)!),
      };
    },
  };
}

test('fact pack construction is deterministic and associates four participants to their teams', async () => {
  const matchup = await goldenMatchup();
  const builder = new MatchupFactPackBuilder();
  const first = builder.build(matchup);
  const second = builder.build(matchup);
  assert.deepEqual(first, second);
  assert.equal(first.factPackVersion, 'matchup-fact-pack-v1');
  assert.equal(first.patch, '26.19');
  assert.equal(first.knowledgeBaseVersion, KNOWLEDGE_BASE_VERSION);
  assert.equal(first.goldenTruthVersion, 'mechanical-golden-v1');
  assert.equal(first.dataDragonVersion, '16.19.1');
  assert.deepEqual(first.participants.map(({ participantId, champion }) => ({ participantId, champion })), [
    { participantId: 'ally:carry', champion: 'Jinx' },
    { participantId: 'ally:support', champion: 'Leona' },
    { participantId: 'enemy:carry', champion: 'Caitlyn' },
    { participantId: 'enemy:support', champion: 'Morgana' },
  ]);
});

test('fact pack input rejects blank identity before resolving any source', async () => {
  const matchup = await goldenMatchup();
  assert.throws(
    () => new MatchupFactPackBuilder().build({ ...matchup, id: '  ' }),
    /id must be non-blank/u,
  );
});

test('ability facts expose stable ownership, slots, availability, mechanics and provenance', async () => {
  const pack = new MatchupFactPackBuilder().build(await goldenMatchup());
  const jinxE = pack.championFacts.abilities.find(({ factId }) => factId === 'ability:jinx:e');
  assert.ok(jinxE);
  assert.equal(jinxE.owner, 'Jinx');
  assert.equal(jinxE.slot, 'E');
  assert.equal(jinxE.availability.earliestLevel, 1);
  assert.equal(pack.championFacts.abilities
    .find(({ factId }) => factId === 'ability:jinx:r')?.availability.earliestLevel, 6);
  assert.equal(jinxE.castModel, 'ground-targeted');
  assert.deepEqual(jinxE.effects, ['root']);
  assert.deepEqual(jinxE.sources.map(({ kind }) => kind), [
    'data-dragon', 'trusted-mechanics', 'knowledge-base',
  ]);
  assert.ok(jinxE.sources.some(({ id }) => id === 'ability-jinx-e-mechanics'));
});

test('verified critical interactions are included while heuristics are excluded', async () => {
  const pack = new MatchupFactPackBuilder().build(await goldenMatchup());
  assert.equal(pack.championFacts.knowledge
    .map(({ type }) => String(type)).includes('heuristic'), false);
  assert.deepEqual(pack.globalFacts, []);
  assert.deepEqual(pack.coverage.criticalInteractions, {
    status: 'covered',
    factIds: ['morgana-e-vs-leona-engage'],
  });
  assert.ok(pack.championFacts.knowledge
    .some(({ factId }) => factId === 'morgana-e-vs-leona-engage'));

  const withoutKnownInteraction = new MatchupFactPackBuilder().build(await goldenMatchup('L61-G01'));
  assert.deepEqual(withoutKnownInteraction.coverage.criticalInteractions, {
    status: 'none-known',
    factIds: [],
  });
});

test('an absent mechanic remains explicit and cannot be promoted by KnowledgeCoverage.full', async () => {
  const matchup = await goldenMatchup();
  const resolver = withoutJinxEMechanicContext();
  const repository = new StaticKnowledgeRepository(
    KNOWLEDGE_ENTRIES.filter(({ id }) => id !== 'ability-jinx-e-mechanics'),
    KNOWLEDGE_BASE_VERSION,
    DERIVATION_RULES,
  );
  const knowledge = new KnowledgeResolver(repository, resolver, Number.MAX_SAFE_INTEGER).resolve({
    champions: [
      matchup.ally.carry, matchup.ally.support, matchup.enemy.carry, matchup.enemy.support,
    ],
    patch: matchup.patch,
  });
  assert.equal(knowledge.coverage.status, 'full');

  const pack = new MatchupFactPackBuilder(
    repository,
    resolver,
    withoutMechanic('jinx:e'),
  ).build(matchup);
  const jinxE = pack.championFacts.abilities.find(({ factId }) => factId === 'ability:jinx:e');
  assert.equal(pack.coverage.status, 'partial');
  assert.equal(pack.coverage.mechanicallyFullyCovered, false);
  assert.equal(pack.coverage.champions.covered, 3);
  assert.equal(pack.coverage.abilities.covered, 19);
  assert.equal(jinxE?.castModel, undefined);
  assert.equal(jinxE?.effects, undefined);
  assert.equal(jinxE?.coverage.status, 'partial');
  assert.ok(jinxE?.coverage.missing.includes('Jinx E normalized mechanics not complete'));
  assert.equal(jinxE?.sources.some(({ id }) => id === 'ability-jinx-e-mechanics'), false);
});

test('all golden matchups retain the phase A mechanical coverage result', async () => {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  const packs = corpus.matchups.map((matchup) => new MatchupFactPackBuilder().build(matchup));
  assert.equal(packs.length, 10);
  assert.equal(packs.every(({ coverage }) => coverage.status === 'full'), true);
  assert.equal(packs.every(({ coverage }) => coverage.mechanicallyFullyCovered), true);
  assert.equal(packs.every(({ coverage }) => coverage.champions.covered === 4), true);
  assert.equal(packs.every(({ coverage }) => coverage.abilities.covered === 20), true);
});

test('fact pack inspection emits one reusable JSON document without a provider', async () => {
  assert.deepEqual(parseInspectFactPackArguments(['--id', 'L61-G01']), { id: 'L61-G01' });
  let output = '';
  await inspectFactPack(['--corpus', corpusPath, '--id', 'L61-G01'], (value) => {
    output += value;
  });
  const parsed = JSON.parse(output) as { matchupId: string; coverage: { status: string } };
  assert.equal(parsed.matchupId, 'L61-G01');
  assert.equal(parsed.coverage.status, 'full');

  const builderSource = readFileSync(
    fileURLToPath(new URL('../server/knowledge/MatchupFactPackBuilder.ts', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(builderSource, /MatchupAnalysisProvider|DeepSeek|OpenAI|Gemini|Groq|fetch\s*\(/u);
});

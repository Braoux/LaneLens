import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type {
  StructuredOutputProvider,
  StructuredOutputRequest,
} from '../server/analysis/StructuredOutputProvider.js';
import { UnparsedProviderOutput } from '../server/analysis/UnparsedProviderOutput.js';
import { DeepSeekProvider } from '../server/analysis/providers/DeepSeekProvider.js';
import { GeminiProvider } from '../server/analysis/providers/GeminiProvider.js';
import { GroqProvider } from '../server/analysis/providers/GroqProvider.js';
import { OpenAIProvider } from '../server/analysis/providers/OpenAIProvider.js';
import { MatchupFactPackBuilder } from '../server/knowledge/MatchupFactPackBuilder.js';
import type { MatchupFactPack } from '../server/knowledge/MatchupFactPack.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from '../server/strategy/MatchupStrategyPlan.js';
import { StrategyPlanValidator } from '../server/strategy/StrategyPlanValidator.js';
import {
  buildStrategyPlanContext,
  STRATEGY_PLAN_CONTEXT_VERSION,
} from '../server/strategy/StrategyPlanContext.js';
import {
  StrategyPlanGenerationError,
  StrategyPlanGenerationService,
} from '../server/strategy/StrategyPlanGenerationService.js';
import { MATCHUP_STRATEGY_PLAN_JSON_SCHEMA } from '../server/strategy/strategy-plan-schema.js';
import { loadEvaluationCorpus } from '../scripts/evaluation/corpus.js';
import {
  inspectStrategyPlan,
  parseInspectStrategyPlanArguments,
} from '../scripts/evaluation/inspect-strategy-plan.js';

const corpusPath = fileURLToPath(new URL(
  '../evaluation/corpus/lan-061-golden-v1.json',
  import.meta.url,
));
const fixturePath = fileURLToPath(new URL(
  './fixtures/strategy-plan-l61-g06.json',
  import.meta.url,
));

async function factPack(): Promise<MatchupFactPack> {
  const corpus = (await loadEvaluationCorpus(corpusPath)).corpus;
  return new MatchupFactPackBuilder().build(
    corpus.matchups.find(({ id }) => id === 'L61-G06')!,
  );
}

function strategic(text: string): StrategyAssertion {
  return {
    text,
    grounding: 'strategic-only',
    participantIds: [],
    factIds: [],
    missingKnowledge: [],
  };
}

function plan(overrides: Partial<MatchupStrategyPlan> = {}): MatchupStrategyPlan {
  return {
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: 'L61-G06',
    patch: '26.19',
    laneApproach: strategic('Contrôler la vague avant de chercher un échange.'),
    threatResponseWindow: {
      threat: {
        text: 'Black Shield peut protéger Caitlyn des contrôles de Leona.',
        grounding: 'fact-grounded',
        participantIds: ['enemy:support', 'enemy:carry', 'ally:support'],
        factIds: ['ability:morgana:e', 'morgana-e-vs-leona-engage'],
        missingKnowledge: [],
      },
      response: strategic('Attendre que le bouclier soit indisponible.'),
      tradeWindow: strategic('Prendre un échange court après la fenêtre adverse.'),
      winCondition: strategic('Préserver la priorité de vague.'),
    },
    earlyLevels: {
      level1: strategic('Jouer derrière la vague.'),
      level2: strategic('Respecter le pic de niveau 2.'),
      level3: strategic('Échanger avec les kits de base disponibles.'),
    },
    wavePlan: strategic('Maintenir une vague contrôlée.'),
    targetPriority: strategic('Frapper la cible exposée.'),
    postLevel6: strategic('Éviter les combats prolongés.'),
    roamPlan: strategic('Roam uniquement après un crash.'),
    ...overrides,
  };
}

test('strategy plan validates strict shape and references from its Fact Pack', async () => {
  const validation = new StrategyPlanValidator().validate(plan(), await factPack());
  assert.equal(validation.valid, true);
  assert.equal(validation.plan?.planVersion, MATCHUP_STRATEGY_PLAN_VERSION);
  const threat = validation.assertions.find(({ path }) => path === 'threatResponseWindow.threat');
  assert.deepEqual(threat, {
    path: 'threatResponseWindow.threat',
    grounding: 'fact-grounded',
    referenceValidation: 'valid',
    semanticSupportValidation: 'not-evaluated',
    resolvedFactIds: ['ability:morgana:e', 'morgana-e-vs-leona-engage'],
    missingKnowledge: [],
  });
});

test('strategy plan rejects extra properties and an invalid provider-shaped response', async () => {
  const candidate = { ...plan(), unexpected: true };
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues.map(({ code }) => code), ['INVALID_SHAPE']);
});

test('strategy plan rejects unknown and cross-matchup facts', async () => {
  const pack = await factPack();
  for (const factId of ['unknown:fact', 'ability:ziggs:q']) {
    const candidate = plan({
      laneApproach: {
        text: 'Affirmation mécanique.',
        grounding: 'fact-grounded',
        participantIds: ['ally:carry'],
        factIds: [factId],
        missingKnowledge: [],
      },
    });
    const validation = new StrategyPlanValidator().validate(candidate, pack);
    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some(({ code, factId: issueFact }) => (
      code === 'UNKNOWN_FACT' && issueFact === factId
    )));
  }
});

test('strategy plan rejects matchup and patch mismatches', async () => {
  const validation = new StrategyPlanValidator().validate(
    plan({ matchupId: 'another-matchup', patch: '99.99' }),
    await factPack(),
  );
  assert.deepEqual(validation.issues.map(({ code }) => code), [
    'MATCHUP_MISMATCH',
    'PATCH_MISMATCH',
  ]);
});

test('strategy plan enforces champion and team ownership for referenced facts', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Morgana protège son carry.',
      grounding: 'fact-grounded',
      participantIds: ['ally:support'],
      factIds: ['ability:morgana:e'],
      missingKnowledge: [],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.ok(validation.issues.some(({ code, factId }) => (
    code === 'FACT_PARTICIPANT_MISMATCH' && factId === 'ability:morgana:e'
  )));
});

test('strategy plan makes missing knowledge explicit without claiming validation', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Impossible de justifier cette interaction avec les faits disponibles.',
      grounding: 'insufficient',
      participantIds: ['ally:carry'],
      factIds: [],
      missingKnowledge: ['Interaction critique non couverte.'],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.equal(validation.valid, true);
  const status = validation.assertions.find(({ path }) => path === 'laneApproach');
  assert.equal(status?.referenceValidation, 'insufficient');
  assert.equal(status?.semanticSupportValidation, 'not-evaluated');
});

test('strategy plan does not accept ungrounded mechanical or duplicate references', async () => {
  const candidate = plan({
    laneApproach: {
      text: 'Affirmation mécanique sans preuve.',
      grounding: 'fact-grounded',
      participantIds: ['ally:carry', 'ally:carry'],
      factIds: [],
      missingKnowledge: [],
    },
  });
  const validation = new StrategyPlanValidator().validate(candidate, await factPack());
  assert.ok(validation.issues.some(({ code }) => code === 'INVALID_GROUNDING'));
  assert.ok(validation.issues.some(({ code }) => code === 'DUPLICATE_REFERENCE'));
});

test('strategy plan rejects references whose canonical provenance is missing', async () => {
  const pack = await factPack();
  const modified: MatchupFactPack = {
    ...pack,
    championFacts: {
      ...pack.championFacts,
      abilities: pack.championFacts.abilities.map((fact) => fact.factId === 'ability:morgana:e'
        ? { ...fact, sources: [] }
        : fact),
    },
  };
  const validation = new StrategyPlanValidator().validate(plan(), modified);
  assert.ok(validation.issues.some(({ code, factId }) => (
    code === 'MISSING_PROVENANCE' && factId === 'ability:morgana:e'
  )));
});

test('strategy generation context is deterministic, complete and provider-independent', async () => {
  const pack = await factPack();
  const first = buildStrategyPlanContext(pack);
  const second = buildStrategyPlanContext(pack);
  assert.deepEqual(first, second);
  assert.equal(first.contextVersion, STRATEGY_PLAN_CONTEXT_VERSION);
  assert.equal(first.participants.length, 4);
  assert.equal(first.championFacts.abilities.length, 20);
  assert.equal(first.championFacts.knowledge.length, pack.championFacts.knowledge.length);
  assert.deepEqual(first.globalFacts, []);
  assert.deepEqual(
    first.championFacts.abilities.map(({ factId }) => factId),
    pack.championFacts.abilities.map(({ factId }) => factId),
  );
  assert.equal(JSON.stringify(first).includes('DeepSeek'), false);
});

test('strategy generation context preserves partial coverage and missing facts', async () => {
  const pack = await factPack();
  const modified: MatchupFactPack = {
    ...pack,
    championFacts: {
      ...pack.championFacts,
      abilities: pack.championFacts.abilities.map((fact) => fact.factId === 'ability:jinx:e'
        ? { ...fact, coverage: { status: 'partial', missing: ['cast model missing'] } }
        : fact),
    },
    coverage: { ...pack.coverage, status: 'partial', missing: ['Jinx E cast model missing'] },
  };
  const context = buildStrategyPlanContext(modified);
  assert.equal(context.coverage.status, 'partial');
  assert.deepEqual(context.coverage.missing, ['Jinx E cast model missing']);
  assert.deepEqual(
    context.championFacts.abilities.find(({ factId }) => factId === 'ability:jinx:e')?.missing,
    ['cast model missing'],
  );
});

test('strategy generator reuses structured output and validates without mutating the Fact Pack', async () => {
  const pack = await factPack();
  const serializedBefore = JSON.stringify(pack);
  let request: StructuredOutputRequest | undefined;
  const provider: StructuredOutputProvider = {
    async generateStructured(candidate) {
      request = candidate;
      return plan();
    },
  };
  const result = await new StrategyPlanGenerationService(provider).generate(pack);
  assert.equal(result.plan.matchupId, pack.matchupId);
  assert.equal(result.validation.valid, true);
  assert.equal(request?.schemaName, 'matchup_strategy_plan');
  assert.equal(request?.schema, MATCHUP_STRATEGY_PLAN_JSON_SCHEMA);
  assert.equal(JSON.stringify(pack), serializedBefore);
});

test('strategy generator reports parsing and validation failures without fallback', async () => {
  const pack = await factPack();
  const parsingProvider: StructuredOutputProvider = {
    async generateStructured() { return new UnparsedProviderOutput('not-json'); },
  };
  await assert.rejects(
    () => new StrategyPlanGenerationService(parsingProvider).generate(pack),
    (error: unknown) => error instanceof StrategyPlanGenerationError && error.phase === 'parsing',
  );

  const invalidProvider: StructuredOutputProvider = {
    async generateStructured() { return { ...plan(), patch: '99.99' }; },
  };
  await assert.rejects(
    () => new StrategyPlanGenerationService(invalidProvider).generate(pack),
    (error: unknown) => error instanceof StrategyPlanGenerationError
      && error.phase === 'validation'
      && error.issues.some(({ code }) => code === 'PATCH_MISMATCH'),
  );
});

test('all concrete providers accept the shared structured-output contract', async () => {
  const requests: unknown[] = [];
  const outputText = JSON.stringify(plan());
  const providers: StructuredOutputProvider[] = [
    new OpenAIProvider({
      async create(request) { requests.push(request); return { outputText }; },
    }, 'test-model'),
    new GeminiProvider({
      async generate(request) { requests.push(request); return { outputText }; },
    }, 'test-model', 1_000),
    new GroqProvider({
      async generate(request) { requests.push(request); return { outputText }; },
    }, 'test-model', 1_000),
    new DeepSeekProvider({
      async generate(request) {
        requests.push(request);
        return { outputText, finishReason: 'stop' };
      },
    }, 'test-model', 1_000, 2_000, 'evaluation'),
  ];
  const request: StructuredOutputRequest = {
    instructions: 'Generate a test Strategy Plan.',
    input: { matchupId: 'L61-G06' },
    schemaName: 'matchup_strategy_plan',
    schema: MATCHUP_STRATEGY_PLAN_JSON_SCHEMA,
  };
  for (const provider of providers) {
    assert.deepEqual(await provider.generateStructured(request), plan());
  }
  assert.equal(requests.length, 4);
  assert.match(JSON.stringify(requests), /matchup_strategy_plan/u);
  assert.equal(requests.every((entry) => JSON.stringify(entry).includes('matchup-strategy-plan-v1')), true);
});

test('strategy plan inspection requires an explicit fixture or provider mode', () => {
  assert.deepEqual(parseInspectStrategyPlanArguments([
    '--id', 'L61-G06', '--fixture', fixturePath,
  ]), {
    id: 'L61-G06',
    fixture: fixturePath,
    generate: false,
  });
  assert.throws(
    () => parseInspectStrategyPlanArguments(['--id', 'L61-G06']),
    /exactement un mode/u,
  );
  assert.throws(
    () => parseInspectStrategyPlanArguments([
      '--id', 'L61-G06', '--fixture', fixturePath, '--generate',
    ]),
    /exactement un mode/u,
  );
});

test('fixture inspection emits resolved facts and never requires a provider', async () => {
  let output = '';
  await inspectStrategyPlan([
    '--corpus', corpusPath,
    '--id', 'L61-G06',
    '--fixture', fixturePath,
  ], (value) => { output += value; });
  const artifact = JSON.parse(output) as {
    mode: string;
    validation: { valid: boolean };
    assertions: readonly {
      path: string;
      resolvedFacts: readonly { factId: string }[];
      invalidFactIds: readonly string[];
    }[];
  };
  assert.equal(artifact.mode, 'fixture');
  assert.equal(artifact.validation.valid, true);
  const threat = artifact.assertions.find(({ path }) => path === 'threatResponseWindow.threat');
  assert.deepEqual(threat?.resolvedFacts.map(({ factId }) => factId), [
    'ability:morgana:e',
    'morgana-e-vs-leona-engage',
  ]);
  assert.deepEqual(threat?.invalidFactIds, []);
});

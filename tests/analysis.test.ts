import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import type { MatchupAnalysisProvider } from '../server/analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import { AnalysisLanguageValidator } from '../server/analysis/AnalysisLanguageValidator.js';
import type {
  MatchupAnalysis,
  MatchupAnalysisInput,
  MatchupAnalysisProviderRequest,
} from '../server/analysis/types.js';

const input: MatchupAnalysisInput = {
  allyCarry: 'Jinx',
  allySupport: 'Thresh',
  enemyCarry: 'Caitlyn',
  enemySupport: 'Lux',
  patch: '26.19',
  locale: 'fr-FR',
  patchContext: {
    patch: '26.19',
    contextVersion: '26.19-v1',
    facts: [
      { subject: 'Jinx', text: 'Contexte pertinent préparé par LaneLens.' },
      { subject: 'Lux Q', text: 'Contexte pertinent préparé par LaneLens.' },
    ],
  },
};

const validAnalysis = (): MatchupAnalysis => ({
  matchup: {
    allyCarry: 'Jinx',
    allySupport: 'Thresh',
    enemyCarry: 'Caitlyn',
    enemySupport: 'Lux',
    patch: '26.19',
  },
  lanePlan: 'Jouer autour des fenêtres de hook.',
  threatResponseWindow: {
    threat: 'Lux Q ouvre le trade adverse.',
    response: 'Esquiver latéralement puis avancer.',
    window: 'Punir pendant le cooldown du Q.',
    winCondition: 'Créer une fenêtre de all-in pour Jinx.',
  },
  earlyLevels: {
    level1: 'Préserver les PV et la priorité.',
    level2: 'Menacer le hook au passage niveau 2.',
    level3: 'Jouer autour des trois sorts disponibles.',
  },
  wavePlan: 'Maintenir la vague dans une zone favorable aux hooks.',
  targetPriority: {
    primaryTarget: 'Lux',
    explanation: 'Elle est la cible la plus punissable après son Q.',
  },
  postLevel6: 'Respecter le burst adverse et engager sur une cible isolée.',
  roamPlan: 'Thresh peut roam après avoir poussé la vague.',
  cheatSheet: ['Lux Q miss → avance', 'Garde la wave hors de la tour adverse'],
  goldenRule: 'Ne force pas tant que Lux conserve son Q.',
  sources: [{ name: 'Riot Games', url: 'https://www.leagueoflegends.com/' }],
});

class FakeProvider implements MatchupAnalysisProvider {
  requests: MatchupAnalysisProviderRequest[] = [];

  constructor(private readonly response: unknown) {}

  async analyze(request: MatchupAnalysisProviderRequest): Promise<unknown> {
    this.requests.push(request);
    return this.response;
  }
}

function expectCode(code: MatchupAnalysisError['code']) {
  return (error: unknown) => error instanceof MatchupAnalysisError && error.code === code;
}

test('service returns a runtime-validated analysis from a fake provider', async () => {
  const response = validAnalysis();
  const service = new MatchupAnalysisService(new FakeProvider(response));

  assert.equal(await service.analyze(input), response);
});

test('provider response remains untrusted and an invalid structure is rejected', async () => {
  const service = new MatchupAnalysisService(new FakeProvider({ lanePlan: 'incomplet' }));

  await assert.rejects(service.analyze(input), expectCode('INVALID_ANALYSIS_RESPONSE'));
});

test('provider errors become safe LaneLens errors without leaking provider details', async () => {
  const provider: MatchupAnalysisProvider = {
    async analyze() {
      throw new Error('token=secret-value path=C:\\private\\provider.json');
    },
  };

  await assert.rejects(new MatchupAnalysisService(provider).analyze(input), (error: unknown) => {
    assert.ok(error instanceof MatchupAnalysisError);
    assert.equal(error.code, 'ANALYSIS_PROVIDER_UNAVAILABLE');
    assert.doesNotMatch(error.message, /secret-value|private|token/i);
    assert.ok(error.cause instanceof Error);
    return true;
  });
});

test('service accepts interchangeable providers without changing its contract', async () => {
  const first: MatchupAnalysisProvider = { async analyze() { return validAnalysis(); } };
  const second: MatchupAnalysisProvider = { async analyze() { return structuredClone(validAnalysis()); } };

  assert.deepEqual(await new MatchupAnalysisService(first).analyze(input), validAnalysis());
  assert.deepEqual(await new MatchupAnalysisService(second).analyze(input), validAnalysis());
});

test('valid PatchContext reaches the provider unchanged', async () => {
  const provider = new FakeProvider(validAnalysis());
  await new MatchupAnalysisService(provider).analyze(input);

  assert.equal(provider.requests[0]?.input.patchContext, input.patchContext);
});

test('incoherent or structurally invalid PatchContext is rejected before provider invocation', async () => {
  for (const patchContext of [
    { ...input.patchContext, patch: '26.18' },
    { ...input.patchContext, contextVersion: '   ' },
    { ...input.patchContext, facts: [] },
    { ...input.patchContext, facts: [{ subject: 'Jinx', text: '   ' }] },
  ]) {
    const provider = new FakeProvider(validAnalysis());
    const service = new MatchupAnalysisService(provider);

    await assert.rejects(
      service.analyze({ ...input, patchContext }),
      expectCode('ANALYSIS_FAILED'),
    );
    assert.equal(provider.requests.length, 0);
  }
});

test('blank prepared input fields are rejected before provider invocation', async () => {
  const provider = new FakeProvider(validAnalysis());
  await assert.rejects(
    new MatchupAnalysisService(provider).analyze({ ...input, allyCarry: '   ' }),
    expectCode('ANALYSIS_FAILED'),
  );
  assert.equal(provider.requests.length, 0);
});

test('every mandatory response string must be non-blank', async () => {
  const response = validAnalysis();
  response.threatResponseWindow.window = '   ';

  await assert.rejects(
    new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
    expectCode('INVALID_ANALYSIS_RESPONSE'),
  );
});

test('goldenRule must be a non-blank string', async () => {
  const response = validAnalysis();
  response.goldenRule = '   ';

  await assert.rejects(
    new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
    expectCode('INVALID_ANALYSIS_RESPONSE'),
  );
});

test('cheatSheet must contain at least one non-blank string', async () => {
  for (const cheatSheet of [[], [''], ['   ']]) {
    const response = validAnalysis();
    response.cheatSheet = cheatSheet;

    await assert.rejects(
      new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
      expectCode('INVALID_ANALYSIS_RESPONSE'),
    );
  }
});

test('sources may be absent, empty, or contain a non-blank name without URL', async () => {
  const withoutSources = validAnalysis();
  delete withoutSources.sources;
  const emptySources = { ...validAnalysis(), sources: [] };
  const namedSource = { ...validAnalysis(), sources: [{ name: 'Riot Games' }] };

  for (const response of [withoutSources, emptySources, namedSource]) {
    await assert.doesNotReject(new MatchupAnalysisService(new FakeProvider(response)).analyze(input));
  }
});

test('sources reject blank names, relative URLs, and non-HTTP(S) protocols', async () => {
  for (const source of [
    { name: '' },
    { name: 'Source', url: '/relative/path' },
    { name: 'Source', url: 'ftp://example.test/source' },
  ]) {
    const response = { ...validAnalysis(), sources: [source] };
    await assert.rejects(
      new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
      expectCode('INVALID_ANALYSIS_RESPONSE'),
    );
  }
});

test('champion coherence trims and compares case-insensitively', async () => {
  const response = validAnalysis();
  response.matchup.allyCarry = ' jinx ';

  await assert.doesNotReject(
    new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
  );
});

test('a different champion or swapped positional roles is rejected', async () => {
  const wrongChampion = validAnalysis();
  wrongChampion.matchup.allyCarry = 'Caitlyn';

  const swappedRoles = validAnalysis();
  [swappedRoles.matchup.allyCarry, swappedRoles.matchup.allySupport] = [
    swappedRoles.matchup.allySupport,
    swappedRoles.matchup.allyCarry,
  ];

  for (const response of [wrongChampion, swappedRoles]) {
    await assert.rejects(
      new MatchupAnalysisService(new FakeProvider(response)).analyze(input),
      expectCode('INVALID_ANALYSIS_RESPONSE'),
    );
  }
});

test('patch coherence trims whitespace but requires exact value equality', async () => {
  const normalized = validAnalysis();
  normalized.matchup.patch = ' 26.19 ';
  await assert.doesNotReject(
    new MatchupAnalysisService(new FakeProvider(normalized)).analyze(input),
  );

  const wrong = validAnalysis();
  wrong.matchup.patch = '26.19.1';
  await assert.rejects(
    new MatchupAnalysisService(new FakeProvider(wrong)).analyze(input),
    expectCode('INVALID_ANALYSIS_RESPONSE'),
  );
});

test('LaneLens instructions are explicitly transmitted with every required tactical theme', async () => {
  const provider = new FakeProvider(validAnalysis());
  await new MatchupAnalysisService(provider).analyze(input);

  const instructions = provider.requests[0]?.instructions ?? '';
  for (const theme of [
    'Threat', 'Response', 'Window', 'Win condition',
    'niveaux 1, 2 et 3', 'gestion de wave', 'fenêtres de trade',
    'cooldowns', 'cible prioritaire', 'niveau 6+', 'roaming',
    'condition de victoire', 'cheatSheet', 'goldenRule',
  ]) {
    assert.match(instructions, new RegExp(theme.replace(/[+]/g, '\\+'), 'i'));
  }
  assert.match(instructions, /aucune recherche web/i);
  assert.match(instructions, /26\.19/);
  assert.match(instructions, /jamais une capacité avant son niveau de disponibilité/i);
  assert.match(instructions, /shield de dégâts ne bloque pas un contrôle/i);
  assert.match(instructions, /aucun reset, refund, refresh/i);
  assert.match(instructions, /jamais de valeur exacte de cooldown, durée, portée, dégâts, vitesse ou pourcentage/i);
  assert.match(instructions, /N’estime jamais une valeur numérique de gameplay/i);
  assert.match(instructions, /formulation qualitative/i);
  assert.match(instructions, /fenêtre relative et actionnable/i);
  assert.match(instructions, /interaction mécanique uniquement à partir des catégories générales/i);
  assert.match(instructions, /damage shield, spell shield, CC immunity, unstoppable, cleanse et tenacity/i);
  assert.match(instructions, /représentent des niveaux de champion, jamais des timestamps/i);
  assert.match(instructions, /Ne fusionne jamais les effets/i);
  assert.match(instructions, /self-centered comme une zone librement placée/i);
  assert.match(instructions, /raisonnement tactique concret et actionnable/i);
  assert.match(instructions, /lanePlan, wavePlan, winCondition, goldenRule et cheatSheet/i);
  assert.match(instructions, /jamais un lethal ou un kill garanti/i);
  assert.match(instructions, /Data Dragon 16\.19\.1/);
  assert.match(instructions, /Jinx[\s\S]*R Super Mega Death Rocket/i);
});

test('common instructions favor qualitative cooldown windows for Caitlyn Morgana versus Ashe Leona', async () => {
  const caitlynInput: MatchupAnalysisInput = {
    ...input,
    allyCarry: 'Caitlyn',
    allySupport: 'Morgana',
    enemyCarry: 'Ashe',
    enemySupport: 'Leona',
  };
  const response = validAnalysis();
  response.matchup = {
    allyCarry: 'Caitlyn',
    allySupport: 'Morgana',
    enemyCarry: 'Ashe',
    enemySupport: 'Leona',
    patch: '26.19',
  };
  response.lanePlan = 'Punir les engagements manqués sans inventer de mesure.';
  response.threatResponseWindow = {
    threat: 'Leona peut engager une cible avancée.',
    response: 'Garder un outil défensif disponible puis se replacer.',
    window: 'Avancer après qu’un outil d’engage important a été utilisé.',
    winCondition: 'Maintenir une pression à distance actionnable.',
  };
  response.earlyLevels = {
    level1: 'Au niveau 1, préserver les PV.',
    level2: 'Au niveau 2, respecter la menace d’engage.',
    level3: 'Au niveau 3, coordonner les sorts disponibles.',
  };
  response.wavePlan = 'Adapter la vague à la position de Leona.';
  response.targetPriority = {
    primaryTarget: 'Ashe',
    explanation: 'Punir Ashe lorsqu’elle est accessible sans s’exposer.',
  };
  response.postLevel6 = 'Respecter les outils d’engage à longue portée.';
  response.roamPlan = 'Morgana peut roam après avoir sécurisé la vague.';
  response.cheatSheet = ['Engage adverse utilisé → reprendre la pression'];
  response.goldenRule = 'Rester concret tactiquement sans inventer une interaction mécanique.';

  let instructions = '';
  await new MatchupAnalysisService({
    async analyze(request) {
      instructions = request.instructions;
      return response;
    },
  }).analyze(caitlynInput);

  assert.match(instructions, /après qu’un outil d’engage important a été utilisé/i);
  assert.match(instructions, /jamais pendant un nombre inventé de secondes/i);
  assert.doesNotMatch(instructions, /pendant les 12 secondes de cooldown/i);
});

test('French locale instructions explicitly prohibit English explanations', async () => {
  let instructions = '';
  const service = new MatchupAnalysisService({
    async analyze(request) {
      instructions = request.instructions;
      return validAnalysis();
    },
  });
  await service.analyze(input);
  assert.match(instructions, /Rédige exclusivement en français/);
  assert.match(instructions, /N’écris pas les explications en anglais/);
});

test('language validation rejects clearly English prose but tolerates LoL names and jargon', async () => {
  const validator = new AnalysisLanguageValidator();
  const french = validAnalysis();
  french.targetPriority.explanation = 'Après Nevermove, Jinx peut poke puis roam avec son ADC.';
  assert.deepEqual(validator.validate(french, 'fr-FR').violations, []);

  const english = validAnalysis();
  english.targetPriority.explanation = 'Focus her when Swain misses Nevermove.';
  assert.deepEqual(validator.validate(english, 'fr-FR').violations, [
    { path: 'targetPriority.explanation', expectedLocale: 'fr-FR' },
  ]);

  const service = new MatchupAnalysisService({ async analyze() { return english; } });
  await assert.rejects(service.analyze(input), expectCode('INVALID_ANALYSIS_RESPONSE'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import type { MatchupAnalysisProvider } from '../server/analysis/MatchupAnalysisProvider.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
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
    assert.equal(error.cause, undefined);
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
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalysisConformanceFailure,
  AnalysisConformanceValidator,
  type AnalysisConformanceCode,
} from '../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from '../server/analysis/errors.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import { StaticGameplayContextResolver } from '../server/gameplay-context/StaticGameplayContextResolver.js';
import type { ChampionGameplayContext, GameplayContext } from '../server/gameplay-context/types.js';
import { createApp } from '../server/app.js';
import type { Logger, LogFields } from '../server/logging/Logger.js';

const resolver = new StaticGameplayContextResolver();
const validator = new AnalysisConformanceValidator();
const matchupContext = resolver.resolve(['Ziggs', 'Galio', 'Jinx', 'Swain']);

function validAnalysis(): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: 'Ziggs',
      allySupport: 'Galio',
      enemyCarry: 'Jinx',
      enemySupport: 'Swain',
      patch: '26.19',
    },
    lanePlan: 'Contrôler la vague et punir les sorts manqués.',
    threatResponseWindow: {
      threat: 'Nevermove peut initier le contrôle adverse.',
      response: 'Esquiver latéralement puis reprendre l’espace.',
      window: 'Avancer après que Swain a raté Nevermove.',
      winCondition: 'Créer des fenêtres de poke répétées.',
    },
    earlyLevels: {
      level1: 'Ziggs Q maintient la pression à distance.',
      level2: 'Galio E peut menacer une cible avancée.',
      level3: 'Coordonner les sorts de base pour contrôler la zone.',
    },
    wavePlan: 'Garder une vague favorable sans pousser automatiquement.',
    targetPriority: {
      primaryTarget: 'Jinx',
      explanation: 'Punir Jinx lorsque Swain ne peut plus engager.',
    },
    postLevel6: 'Hero’s Entrance peut soutenir un engagement confirmé.',
    roamPlan: 'Galio peut roam après avoir sécurisé la vague.',
    cheatSheet: ['Nevermove raté → avance', 'Préserve Satchel Charge pour te replacer'],
    goldenRule: 'Ne combats pas longtemps dans la zone de Swain.',
  };
}

function codes(result: ReturnType<AnalysisConformanceValidator['validate']>): readonly AnalysisConformanceCode[] {
  return result.violations.map(({ code }) => code);
}

function withField(
  mutate: (analysis: MatchupAnalysis) => void,
  context: GameplayContext = matchupContext,
) {
  const analysis = validAnalysis();
  mutate(analysis);
  return validator.validate(analysis, context);
}

test('valid abilities at their legal levels and an ultimate after level 6 are accepted', () => {
  assert.equal(validator.validate(validAnalysis(), matchupContext).valid, true);
});

for (const [path, mutate] of [
  ['earlyLevels.level1', (analysis: MatchupAnalysis) => { analysis.earlyLevels.level1 = 'Galio R protège Ziggs.'; }],
  ['earlyLevels.level2', (analysis: MatchupAnalysis) => { analysis.earlyLevels.level2 = 'Galio ult protège Ziggs.'; }],
  ['earlyLevels.level3', (analysis: MatchupAnalysis) => { analysis.earlyLevels.level3 = 'Hero’s Entrance protège Ziggs.'; }],
] as const) {
  test(`an unavailable ultimate is rejected in ${path}`, () => {
    const result = withField(mutate);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((violation) =>
      violation.code === 'ABILITY_UNAVAILABLE_AT_LEVEL' && violation.path === path));
  });
}

test('atypical champion availability is represented explicitly', () => {
  const karma = resolver.resolve(['Karma']).champions[0]!;
  const mantra = karma.abilities.find(({ slot }) => slot === 'R');
  assert.equal(mantra?.availability.earliestLevel, 1);
  assert.ok((mantra?.availability.exceptions?.length ?? 0) > 0);
});

test('ability ownership, slot, and explicit name associations are verified', () => {
  const valid = withField((analysis) => {
    analysis.earlyLevels.level3 = 'Galio E (Justice Punch) crée une menace.';
  });
  assert.equal(valid.valid, true);

  const mismatch = withField((analysis) => {
    analysis.earlyLevels.level3 = 'Galio Q (Nevermove) crée une menace.';
  });
  assert.ok(codes(mismatch).includes('ABILITY_CHAMPION_MISMATCH'));
  assert.ok(codes(mismatch).includes('ABILITY_SLOT_MISMATCH'));
  assert.ok(codes(mismatch).includes('ABILITY_NAME_MISMATCH'));

  const unknown = withField((analysis) => {
    analysis.earlyLevels.level3 = 'Galio E (Imaginary Spell) crée une menace.';
  });
  assert.ok(codes(unknown).includes('ABILITY_NAME_MISMATCH'));

  const noFalseAssociation = withField((analysis) => {
    analysis.threatResponseWindow.response = 'Galio répond à Swain Nevermove avec Shield of Durand.';
  });
  assert.equal(noFalseAssociation.valid, true);
});

test('a damage shield cannot be presented as blocking crowd control', () => {
  const result = withField((analysis) => {
    analysis.threatResponseWindow.response = 'Shield of Durand blocks Swain’s pull.';
  });
  assert.ok(codes(result).includes('UNSUPPORTED_CC_INTERACTION'));
});

test('an explicitly trusted protection interaction is accepted', () => {
  const protector: ChampionGameplayContext = {
    champion: 'Protector',
    dataDragonVersion: 'test',
    abilities: [{
      slot: 'W',
      name: 'Trusted Barrier',
      availability: { earliestLevel: 1 },
      facts: ['Trusted Barrier blocks roots and pulls.'],
    }],
  };
  const context: GameplayContext = { champions: [protector] };
  const analysis = validAnalysis();
  analysis.threatResponseWindow.response = 'Trusted Barrier blocks the root.';
  assert.equal(validator.validate(analysis, context).valid, true);
});

test('a patch-specific trusted fact can authorize a protection exception', () => {
  const analysis = validAnalysis();
  analysis.threatResponseWindow.response = 'Galio W bloque le pull.';
  const result = validator.validate(analysis, matchupContext, {
    patch: '26.19',
    contextVersion: 'test',
    facts: [{ subject: 'Galio W', text: 'Galio W bloque les pulls pendant ce patch.' }],
  });
  assert.equal(result.valid, true);
});

test('an invented crowd-control effect is rejected', () => {
  const result = withField((analysis) => {
    analysis.threatResponseWindow.response = 'Justice Punch knocks Swain back.';
  });
  assert.ok(codes(result).includes('UNSUPPORTED_CC_INTERACTION'));
});

test('a self-centered ability cannot be described as a freely placed zone', () => {
  const result = withField((analysis) => {
    analysis.threatResponseWindow.response = 'Galio place son W en retrait pour protéger Ziggs.';
  });
  assert.ok(codes(result).includes('ABILITY_TARGETING_MISMATCH'));
});

test('an unsupported mechanical interaction between two valid abilities is rejected', () => {
  const result = withField((analysis) => {
    analysis.threatResponseWindow.response = 'Galio W bloque le W de Swain.';
  });
  assert.ok(codes(result).includes('UNSUPPORTED_ABILITY_INTERACTION'));
});

test('an explicitly documented interaction between two abilities remains accepted', () => {
  const analysis = validAnalysis();
  analysis.threatResponseWindow.response = 'Morgana E bloque le stun du R d’Ashe tant que Black Shield tient.';
  const context = resolver.resolve(['Morgana', 'Ashe']);
  assert.equal(validator.validate(analysis, context).valid, true);
});

test('ability effects cannot be merged with another spell from the same champion', () => {
  const luxContext = resolver.resolve(['Lux']);
  const correct = validAnalysis();
  correct.threatResponseWindow.response = 'Lux E ralentit la cible dans sa zone.';
  assert.equal(validator.validate(correct, luxContext).valid, true);

  const merged = validAnalysis();
  merged.threatResponseWindow.response = 'Lux utilise son E pour fournir un shield et un slow.';
  const result = validator.validate(merged, luxContext);
  assert.ok(codes(result).includes('ABILITY_EFFECT_MISMATCH'));
});

test('explicit unsupported structure damage is rejected without blocking tactical tower setup', () => {
  const tactical = withField((analysis) => {
    analysis.postLevel6 = 'Utiliser Ziggs R pour sécuriser la prise de la tourelle.';
  });
  assert.equal(tactical.valid, true);

  const mechanical = withField((analysis) => {
    analysis.postLevel6 = 'Ziggs R endommage directement la tourelle.';
  });
  assert.ok(codes(mechanical).includes('ABILITY_EFFECT_MISMATCH'));
});

test('cooldown reset claims require an explicit trusted fact', () => {
  const invented = withField((analysis) => {
    analysis.cheatSheet = ['Galio ultimate resets Shield of Durand cooldown.'];
  });
  assert.ok(codes(invented).includes('UNSUPPORTED_COOLDOWN_RESET'));

  const champion: ChampionGameplayContext = {
    champion: 'Resetter',
    dataDragonVersion: 'test',
    abilities: [{
      slot: 'E',
      name: 'Documented Reset',
      availability: { earliestLevel: 1 },
      facts: ['Documented Reset resets its own cooldown on takedown.'],
    }],
  };
  const analysis = validAnalysis();
  analysis.cheatSheet = ['Documented Reset resets its cooldown on takedown.'];
  assert.equal(validator.validate(analysis, { champions: [champion] }).valid, true);
});

test('exact mechanical values must exist in the resolved ability context', () => {
  const supported = withField((analysis) => {
    analysis.threatResponseWindow.window = 'Punir pendant les 11 s du cooldown de Galio E.';
  });
  assert.equal(supported.valid, true);

  const invented = withField((analysis) => {
    analysis.threatResponseWindow.window = 'Agir dans les 0,3 s avant la fin des 6 s de cooldown.';
  });
  assert.ok(codes(invented).includes('UNSUPPORTED_EXACT_VALUE'));

  const levelsAndPatch = withField((analysis) => {
    analysis.earlyLevels.level3 = 'Au niveau 3 du patch 26.19, jouer les sorts de base.';
  });
  assert.equal(levelsAndPatch.valid, true);

  const lucian = validAnalysis();
  lucian.wavePlan = 'Lucian Q inflige 90 dégâts.';
  const patchSupported = validator.validate(lucian, resolver.resolve(['Lucian']), {
    patch: '26.19',
    contextVersion: 'test',
    facts: [{ subject: 'Lucian Q', text: 'Les dégâts de base passent à 90.' }],
  });
  assert.equal(patchSupported.valid, true);
});

test('probabilistic lethal language is accepted while guaranteed kills are rejected', () => {
  const conditional = withField((analysis) => {
    analysis.goldenRule = 'Ziggs peut menacer un lethal sur une cible très basse.';
  });
  assert.equal(conditional.valid, true);

  const guaranteed = withField((analysis) => {
    analysis.goldenRule = 'Mega Inferno Bomb tue Jinx à coup sûr.';
  });
  assert.ok(codes(guaranteed).includes('UNSUPPORTED_LETHAL_CLAIM'));
});

test('explicit level-6 timing inside an early-level field is rejected', () => {
  const result = withField((analysis) => {
    analysis.earlyLevels.level2 = 'Après le niveau 6, Galio peut engager.';
  });
  assert.ok(codes(result).includes('TEMPORAL_INCONSISTENCY'));
});

test('early level fields reject fixed minute timestamps', () => {
  for (const mutate of [
    (analysis: MatchupAnalysis) => { analysis.earlyLevels.level2 = 'À 2 min, Ziggs combine Q et E.'; },
    (analysis: MatchupAnalysis) => { analysis.earlyLevels.level3 = 'À 3 minutes, Galio avance.'; },
  ]) {
    assert.ok(codes(withField(mutate)).includes('TEMPORAL_INCONSISTENCY'));
  }
});

test('tactical plan contradictions remain non-blocking warnings unless a transition is explicit', () => {
  const result = withField((analysis) => {
    analysis.lanePlan = 'Geler la vague près de la tour.';
    analysis.wavePlan = 'Pousser la vague pour préparer un reset.';
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations.filter(({ severity }) => severity === 'warning'), [{
    code: 'TACTICAL_PLAN_CONTRADICTION',
    severity: 'warning',
    path: 'lanePlan,wavePlan',
  }]);

  const phased = withField((analysis) => {
    analysis.lanePlan = 'Geler d’abord la vague près de la tour.';
    analysis.wavePlan = 'Puis pousser après une fenêtre favorable.';
  });
  assert.equal(phased.violations.some(({ code }) => code === 'TACTICAL_PLAN_CONTRADICTION'), false);
});

test('the real Ziggs Galio regression fixture is rejected for deterministic violations', () => {
  const analysis = validAnalysis();
  analysis.earlyLevels.level3 = 'Ziggs E contrôle la zone puis Galio R (Hero’s Entrance) désengage.';
  analysis.threatResponseWindow.response = 'Shield of Durand blocks Swain’s pull.';
  analysis.cheatSheet = [
    'Galio ultimate resets Shield of Durand cooldown.',
    'Mega Inferno Bomb kills Jinx instantly.',
  ];
  analysis.threatResponseWindow.window = 'Agir dans les 0,25 s avant la fin de son cooldown de 6 s.';

  const result = validator.validate(analysis, matchupContext);
  assert.equal(result.valid, false);
  for (const expected of [
    'ABILITY_UNAVAILABLE_AT_LEVEL',
    'UNSUPPORTED_CC_INTERACTION',
    'UNSUPPORTED_COOLDOWN_RESET',
    'UNSUPPORTED_EXACT_VALUE',
    'UNSUPPORTED_LETHAL_CLAIM',
  ] satisfies readonly AnalysisConformanceCode[]) {
    assert.ok(codes(result).includes(expected), `missing ${expected}`);
  }
});

test('service rejects non-conformance as INVALID_ANALYSIS_RESPONSE without retrying', async () => {
  const analysis = validAnalysis();
  analysis.earlyLevels.level3 = 'Galio R protège Ziggs.';
  let providerCalls = 0;
  const service = new MatchupAnalysisService({
    async analyze() {
      providerCalls += 1;
      return analysis;
    },
  });
  const input: MatchupAnalysisInput = {
    allyCarry: 'Ziggs',
    allySupport: 'Galio',
    enemyCarry: 'Jinx',
    enemySupport: 'Swain',
    patch: '26.19',
    locale: 'fr-FR',
    patchContext: {
      patch: '26.19',
      contextVersion: '26.19-v1',
      facts: [{ subject: 'Matchup', text: 'Contexte préparé par LaneLens.' }],
    },
  };

  await assert.rejects(service.analyze(input), (error: unknown) => {
    assert.ok(error instanceof MatchupAnalysisError);
    assert.equal(error.code, 'INVALID_ANALYSIS_RESPONSE');
    assert.ok(error.cause instanceof AnalysisConformanceFailure);
    return true;
  });
  assert.equal(providerCalls, 1);
});

test('missing trusted gameplay context stops before the provider call', async () => {
  let providerCalls = 0;
  const service = new MatchupAnalysisService({
    async analyze() {
      providerCalls += 1;
      return validAnalysis();
    },
  });
  const input: MatchupAnalysisInput = {
    allyCarry: 'Unknown Champion',
    allySupport: 'Galio',
    enemyCarry: 'Jinx',
    enemySupport: 'Swain',
    patch: '26.19',
    locale: 'fr-FR',
    patchContext: {
      patch: '26.19',
      contextVersion: '26.19-v1',
      facts: [{ subject: 'Matchup', text: 'Contexte préparé par LaneLens.' }],
    },
  };

  await assert.rejects(service.analyze(input), (error: unknown) =>
    error instanceof MatchupAnalysisError && error.code === 'ANALYSIS_FAILED');
  assert.equal(providerCalls, 0);
});

test('conformance failures emit a correlated sanitized diagnostic event', async () => {
  const entries: { event: string; fields?: LogFields }[] = [];
  const logger: Logger = {
    debug(event, fields) { entries.push({ event, fields }); },
    info(event, fields) { entries.push({ event, fields }); },
    warn(event, fields) { entries.push({ event, fields }); },
    error(event, fields) { entries.push({ event, fields }); },
  };
  const violation = {
    code: 'ABILITY_UNAVAILABLE_AT_LEVEL',
    severity: 'error',
    path: 'earlyLevels.level3',
  } as const;
  const app = createApp({
    logger,
    patchContextResolver: {
      async resolve() {
        return {
          status: 'ready' as const,
          context: {
            patch: '26.19',
            contextVersion: '26.19-v1',
            facts: [{ subject: 'Matchup', text: 'Contexte préparé par LaneLens.' }],
          },
        };
      },
    },
    analysisService: {
      async analyze() {
        throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
          cause: new AnalysisConformanceFailure([violation]),
        });
      },
    },
  });

  const response = await app.request('/api/matchup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      allyCarry: 'Ziggs',
      allySupport: 'Galio',
      enemyCarry: 'Jinx',
      enemySupport: 'Swain',
      patch: '26.19',
      locale: 'fr-FR',
    }),
  });

  assert.equal(response.status, 502);
  const diagnostic = entries.find(({ event }) => event === 'matchup_analysis_conformance_failed');
  assert.ok(diagnostic);
  assert.equal(typeof diagnostic.fields?.requestId, 'string');
  assert.equal(diagnostic.fields?.patch, '26.19');
  assert.deepEqual(diagnostic.fields?.violationCodes, ['ABILITY_UNAVAILABLE_AT_LEVEL']);
  assert.deepEqual(diagnostic.fields?.violationPaths, ['earlyLevels.level3']);
  assert.doesNotMatch(JSON.stringify(entries), /Galio R protège|provider response|prompt/i);
});

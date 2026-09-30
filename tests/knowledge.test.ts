import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisConformanceValidator } from '../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisService } from '../server/analysis/MatchupAnalysisService.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from '../server/analysis/types.js';
import { KnowledgeResolver } from '../server/knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../server/knowledge/StaticKnowledgeRepository.js';
import { DERIVATION_RULES } from '../server/knowledge/data/derivation-rules.js';
import { KNOWLEDGE_BASE_VERSION } from '../server/knowledge/data/knowledge.js';
import type { KnowledgeEntry } from '../server/knowledge/types.js';
import {
  KnowledgeValidationError,
  assertValidKnowledgeDataset,
  canPromoteKnowledge,
} from '../server/knowledge/validation.js';

const riotSource = { type: 'riot' as const, name: 'Riot test fixture' };

function official(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'test-official', type: 'official_fact', subjectKind: 'champion', subject: 'Jinx',
    statement: 'Verified fixture.', championKeys: ['jinx'], tags: ['test'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    sources: [riotSource], ...overrides,
  };
}

function analysis(): MatchupAnalysis {
  return {
    matchup: { allyCarry: 'Caitlyn', allySupport: 'Morgana', enemyCarry: 'Ashe', enemySupport: 'Leona', patch: '26.19' },
    lanePlan: 'Préserver la distance puis avancer sur une fenêtre claire.',
    threatResponseWindow: {
      threat: 'Leona peut engager une cible avancée.', response: 'Se replacer avant de répondre.',
      window: 'Punir après un engage manqué.', winCondition: 'Conserver une pression à distance.',
    },
    earlyLevels: { level1: 'Préserver les PV.', level2: 'Respecter la menace adverse.', level3: 'Coordonner les sorts disponibles.' },
    wavePlan: 'Maintenir la vague dans une zone sûre.',
    targetPriority: { primaryTarget: 'Ashe', explanation: 'Punir Ashe lorsqu’elle est accessible.' },
    postLevel6: 'Respecter les ultimes adverses.', roamPlan: 'Roam après avoir sécurisé la vague.',
    cheatSheet: ['Engage manqué → avancer'], goldenRule: 'Ne pas forcer sans fenêtre.',
  };
}

const input: MatchupAnalysisInput = {
  allyCarry: 'Caitlyn', allySupport: 'Morgana', enemyCarry: 'Ashe', enemySupport: 'Leona',
  patch: '26.19', locale: 'fr-FR', patchContext: {
    patch: '26.19', contextVersion: '26.19-v1', facts: [{ subject: 'Matchup', text: 'Contexte préparé.' }],
  },
};

test('knowledge schema enforces patch validity, references, and promotion policy', () => {
  assert.throws(() => assertValidKnowledgeDataset([
    official({ scope: 'patch-dependent' }),
  ], DERIVATION_RULES), KnowledgeValidationError);
  assert.throws(() => assertValidKnowledgeDataset([
    official({ id: 'derived', type: 'derived_fact', derivedFrom: ['missing'], derivationRuleId: 'control-effect-creates-window' }),
  ], DERIVATION_RULES), KnowledgeValidationError);
  assert.throws(() => assertValidKnowledgeDataset([
    official({ type: 'heuristic', verification: 'automatic' }),
  ], DERIVATION_RULES), KnowledgeValidationError);
  assert.throws(() => assertValidKnowledgeDataset([
    official({ sources: [{ type: 'llm', name: 'proposal' }] }),
  ], DERIVATION_RULES), KnowledgeValidationError);

  const riotCandidate = official({ status: 'candidate' });
  const llmCandidate = official({ status: 'candidate', sources: [{ type: 'llm', name: 'proposal' }] });
  assert.equal(canPromoteKnowledge(riotCandidate, [riotCandidate], DERIVATION_RULES), true);
  assert.equal(canPromoteKnowledge(llmCandidate, [llmCandidate], DERIVATION_RULES), false);
});

test('resolver filters by champion, patch, phase, status, and matchup participants', () => {
  const entries: readonly KnowledgeEntry[] = [
    official({ id: 'structural-jinx' }),
    official({ id: 'patch-jinx', scope: 'patch-dependent', patch: { from: '26.19', to: '26.19' } }),
    official({ id: 'future-jinx', scope: 'patch-dependent', patch: { from: '26.20' } }),
    official({ id: 'level-six', phases: ['level-6-plus'] }),
    official({ id: 'unrelated', championKeys: ['braum'] }),
    official({ id: 'candidate', status: 'candidate', verification: 'pending' }),
    official({
      id: 'matchup', type: 'matchup_observation', subjectKind: 'interaction', championKeys: ['jinx', 'thresh'],
      status: 'verified', verification: 'human', sources: [{ type: 'curated', name: 'human review' }],
    }),
  ];
  const resolver = new KnowledgeResolver(new StaticKnowledgeRepository(entries, 'test-v1'));
  const resolved = resolver.resolve({ champions: ['Jinx', 'Thresh', 'Caitlyn', 'Lux'], patch: '26.19', phases: ['lane'] });
  const ids = [...resolved.officialFacts, ...resolved.matchupObservations].map(({ id }) => id);
  assert.deepEqual(ids.sort(), ['matchup', 'patch-jinx', 'structural-jinx'].sort());
  assert.equal(resolved.coverage.status, 'partial');
  assert.equal(resolved.coverage.coveredChampions, 2);
  assert.equal(resolved.coverage.relevantKnowledgeCount, 3);
});

test('resolver keeps the prompt compact and never loads unrelated knowledge', () => {
  const entries = Array.from({ length: 30 }, (_, index) => official({ id: `jinx-${index}` }));
  entries.push(official({ id: 'lux-unrelated', championKeys: ['lux'] }));
  const resolved = new KnowledgeResolver(new StaticKnowledgeRepository(entries, 'budget-v1'), undefined, 5)
    .resolve({ champions: ['Jinx', 'Thresh', 'Ashe', 'Leona'], patch: '26.19' });
  assert.equal(resolved.coverage.relevantKnowledgeCount, 5);
  assert.equal(resolved.officialFacts.some(({ id }) => id === 'lux-unrelated'), false);
});

test('service injects typed KB sections and observes partial coverage without coupling the provider to storage', async () => {
  let instructions = '';
  let coverageStatus = '';
  const service = new MatchupAnalysisService({
    async analyze(request) { instructions = request.instructions; return analysis(); },
  });
  await service.analyze(input, {
    onKnowledgeCoverage(coverage, version) {
      coverageStatus = `${version}:${coverage.status}:${coverage.relevantKnowledgeCount}`;
    },
  });
  assert.match(instructions, /OFFICIAL FACTS/);
  assert.match(instructions, /DERIVED MECHANICS/);
  assert.match(instructions, /HEURISTICS/);
  assert.match(instructions, /MATCHUP OBSERVATIONS/);
  assert.match(instructions, /morgana-e-vs-leona-engage/);
  assert.match(coverageStatus, new RegExp(`^${KNOWLEDGE_BASE_VERSION}:full:\\d+$`));
});

test('no enriched knowledge remains a non-blocking fallback with observable none coverage', async () => {
  const fallbackInput: MatchupAnalysisInput = {
    ...input, allyCarry: 'Aphelios', allySupport: 'Braum', enemyCarry: 'Darius', enemySupport: 'Diana',
  };
  const fallbackAnalysis = analysis();
  fallbackAnalysis.matchup = {
    allyCarry: 'Aphelios', allySupport: 'Braum', enemyCarry: 'Darius', enemySupport: 'Diana', patch: '26.19',
  };
  let called = false;
  await new MatchupAnalysisService({ async analyze() { called = true; return fallbackAnalysis; } })
    .analyze(fallbackInput, {
      onKnowledgeCoverage(coverage) { assert.equal(coverage.status, 'none'); },
    });
  assert.equal(called, true);
});

test('validator can reject a contradiction with a verified structured fact while heuristics stay non-blocking', () => {
  const context = new KnowledgeResolver(new StaticKnowledgeRepository()).resolve({
    champions: ['Caitlyn', 'Morgana', 'Ashe', 'Leona'], patch: '26.19', phases: ['lane'],
  });
  const invalid = analysis();
  invalid.goldenRule = 'Caitlyn E soigne sa cible.';
  const result = new AnalysisConformanceValidator().validate(invalid, context, input.patchContext);
  const contradiction = result.violations.find(({ code }) => code === 'KNOWLEDGE_CONTRADICTION');
  assert.equal(result.valid, false);
  assert.equal(contradiction?.category, 'KNOWLEDGE_CONTRADICTION');
  assert.equal(contradiction?.knowledgeId, 'ability-caitlyn-e-mechanics');

  const safe = new AnalysisConformanceValidator().validate(analysis(), context, input.patchContext);
  assert.equal(safe.valid, true);
});

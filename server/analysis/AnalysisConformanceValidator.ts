import type { MatchupAnalysis, PatchContext } from './types.js';
import type {
  AbilityEffect,
  AbilityGameplayFact,
  AbilitySlot,
  ChampionGameplayContext,
  GameplayContext,
} from '../gameplay-context/types.js';

export type AnalysisConformanceCode =
  | 'ABILITY_UNAVAILABLE_AT_LEVEL'
  | 'ABILITY_CHAMPION_MISMATCH'
  | 'ABILITY_SLOT_MISMATCH'
  | 'ABILITY_NAME_MISMATCH'
  | 'ABILITY_EFFECT_MISMATCH'
  | 'ABILITY_TARGETING_MISMATCH'
  | 'UNSUPPORTED_ABILITY_INTERACTION'
  | 'UNSUPPORTED_CC_INTERACTION'
  | 'UNSUPPORTED_COOLDOWN_RESET'
  | 'UNSUPPORTED_EXACT_VALUE'
  | 'UNSUPPORTED_LETHAL_CLAIM'
  | 'TEMPORAL_INCONSISTENCY'
  | 'TACTICAL_PLAN_CONTRADICTION';

export interface AnalysisConformanceViolation {
  readonly code: AnalysisConformanceCode;
  readonly severity: 'error' | 'warning';
  readonly path: string;
}

export interface AnalysisConformanceResult {
  readonly valid: boolean;
  readonly violations: readonly AnalysisConformanceViolation[];
}

interface AnalysisTextField {
  readonly path: string;
  readonly text: string;
  readonly level?: number;
}

interface AbilityMention {
  readonly champion: ChampionGameplayContext;
  readonly ability: AbilityGameplayFact;
}

const SLOT_ALIASES: Readonly<Record<string, AbilitySlot>> = {
  p: 'P', passif: 'P', passive: 'P',
  q: 'Q', a: 'Q',
  w: 'W', z: 'W',
  e: 'E',
  r: 'R', ult: 'R', ulti: 'R', ultime: 'R', ultimate: 'R',
};

const CC_TERMS = [
  'root', 'immobilis', 'pull', 'traction', 'stun', 'etourdis', 'knock up',
  'knockup', 'projection en l air', 'knock back', 'knockback', 'repouss',
  'suppression', 'fear', 'peur', 'charm', 'charme', 'silence', 'taunt', 'provocation',
] as const;

const PROTECTION_VERBS = [
  'block', 'bloqu', 'negate', 'annul', 'ignore', 'immune', 'immunis', 'prevent',
  'empech', 'cancel',
] as const;

const ABILITY_INTERACTION_VERBS = [
  ...PROTECTION_VERBS,
  'interrupt', 'interromp', 'purge', 'cleanse', 'dissip', 'absorb', 'renvoie', 'reflect',
] as const;

const EFFECT_PATTERNS: ReadonlyArray<readonly [AbilityEffect, RegExp]> = [
  ['shield', /\b(?:shield|bouclier)\b/u],
  ['heal', /\b(?:heal|heals|healing|soin|soigne|guerit|rend des pv)\b/u],
  ['dash', /\b(?:dash|dashes|ruee|bondit|se projette)\b/u],
  ['stun', /\b(?:stun|stuns|etourdit|etourdissement)\b/u],
  ['root', /\b(?:root|roots|immobilise|immobilisation)\b/u],
  ['slow', /\b(?:slow|slows|ralentit|ralentissement)\b/u],
  ['knock-up', /\b(?:knock up|knocks up|projection en l air)\b/u],
  ['displacement', /\b(?:knockback|knock back|pull|pulls|repousse|attire|deplace)\b/u],
  ['silence', /\b(?:silence|silences|reduit au silence)\b/u],
  ['fear', /\b(?:fear|fears|peur|effraie)\b/u],
  ['charm', /\b(?:charm|charms|charme)\b/u],
  ['taunt', /\b(?:taunt|taunts|provocation|provoque)\b/u],
];

const RESET_TERMS = [
  'reset', 'reinitialis', 'refund', 'rembours', 'refresh', 'rafraich',
  'restore cooldown', 'rend le cooldown', 'rend son cooldown',
] as const;

const SUPPORTED_PROTECTION_FACTS = [
  'spell shield', 'blocks a single enemy ability', 'disabling effects',
  'immune to crowd control', 'cannot be disabled', 'unstoppable',
  'blocks root', 'blocks pull', 'bloque les controles', 'bloque les immobilisations',
  'bloque les roots', 'bloque les pulls', 'immunite aux controles',
] as const;

const LETHAL_PATTERNS = [
  /\bguaranteed kill\b/u,
  /\bkills?\b.{0,40}\binstantly\b/u,
  /\bone[ -]?shot\b/u,
  /\btue\b.{0,40}\binstantanement\b/u,
  /\btue\b.{0,40}\ba coup sur\b/u,
  /\bgarantit (?:le |un )?kill\b/u,
  /\bkill garanti\b/u,
] as const;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[’']/gu, ' ')
    .replaceAll(/[^a-z0-9%+.-]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function normalizeAssociation(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[’']/gu, ' ')
    .replaceAll(/[^a-z0-9()]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function fields(analysis: MatchupAnalysis): readonly AnalysisTextField[] {
  return [
    { path: 'lanePlan', text: analysis.lanePlan },
    { path: 'threatResponseWindow.threat', text: analysis.threatResponseWindow.threat },
    { path: 'threatResponseWindow.response', text: analysis.threatResponseWindow.response },
    { path: 'threatResponseWindow.window', text: analysis.threatResponseWindow.window },
    { path: 'threatResponseWindow.winCondition', text: analysis.threatResponseWindow.winCondition },
    { path: 'earlyLevels.level1', text: analysis.earlyLevels.level1, level: 1 },
    { path: 'earlyLevels.level2', text: analysis.earlyLevels.level2, level: 2 },
    { path: 'earlyLevels.level3', text: analysis.earlyLevels.level3, level: 3 },
    { path: 'wavePlan', text: analysis.wavePlan },
    { path: 'targetPriority.explanation', text: analysis.targetPriority.explanation },
    { path: 'postLevel6', text: analysis.postLevel6, level: 6 },
    { path: 'roamPlan', text: analysis.roamPlan },
    ...analysis.cheatSheet.map((text, index) => ({ path: `cheatSheet.${index}`, text })),
    { path: 'goldenRule', text: analysis.goldenRule },
  ];
}

function includesTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function abilityFacts(ability: AbilityGameplayFact): string {
  return normalize(ability.facts.join(' '));
}

function uniqueMentions(mentions: readonly AbilityMention[]): readonly AbilityMention[] {
  const seen = new Set<string>();
  return mentions.filter(({ champion, ability }) => {
    const key = `${normalize(champion.champion)}:${ability.slot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mentionsIn(text: string, context: GameplayContext): readonly AbilityMention[] {
  const normalized = normalize(text);
  const mentions: AbilityMention[] = [];

  for (const champion of context.champions) {
    const championName = normalize(champion.champion);
    for (const ability of champion.abilities) {
      const abilityName = normalize(ability.name);
      if (abilityName.length >= 3 && normalized.includes(abilityName)) {
        mentions.push({ champion, ability });
      }
    }

    const slotPattern = new RegExp(`\\b${escapeRegExp(championName)}(?: s)?(?:\\s+(?:utilise|lance|avec|son|sa|place|pose)){0,3}\\s+(p|passif|passive|q|a|w|z|e|r|ult|ulti|ultime|ultimate)\\b`, 'gu');
    for (const match of normalized.matchAll(slotPattern)) {
      const slot = SLOT_ALIASES[match[1] ?? ''];
      const ability = champion.abilities.find((candidate) => candidate.slot === slot);
      if (ability) mentions.push({ champion, ability });
    }

    const reverseSlotPattern = new RegExp(`\\b(p|passif|passive|q|a|w|z|e|r|ult|ulti|ultime|ultimate)\\s+(?:de|du|d)\\s+${escapeRegExp(championName)}\\b`, 'gu');
    for (const match of normalized.matchAll(reverseSlotPattern)) {
      const slot = SLOT_ALIASES[match[1] ?? ''];
      const ability = champion.abilities.find((candidate) => candidate.slot === slot);
      if (ability) mentions.push({ champion, ability });
    }
  }

  return uniqueMentions(mentions);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addViolation(
  violations: AnalysisConformanceViolation[],
  code: AnalysisConformanceCode,
  path: string,
  severity: 'error' | 'warning' = 'error',
): void {
  if (!violations.some((violation) => violation.code === code && violation.path === path)) {
    violations.push(Object.freeze({ code, severity, path }));
  }
}

function validateExplicitAssociations(
  field: AnalysisTextField,
  context: GameplayContext,
  violations: AnalysisConformanceViolation[],
): void {
  const text = normalize(field.text);
  const associationText = normalizeAssociation(field.text);
  const allAbilities = context.champions.flatMap((champion) =>
    champion.abilities.map((ability) => ({ champion, ability })),
  );

  for (const mention of allAbilities) {
    const abilityName = normalize(mention.ability.name);
    let abilityIndex = text.indexOf(abilityName);
    while (abilityName.length >= 3 && abilityIndex >= 0) {
      const prefix = text.slice(Math.max(0, abilityIndex - 60), abilityIndex);
      const namedChampion = context.champions.find((champion) => {
        const championName = escapeRegExp(normalize(champion.champion));
        return new RegExp(
          `\\b${championName}(?: s)?(?:\\s+(?:uses?|utilise|lance|avec|son|sa))?(?:\\s+(?:p|passif|passive|q|a|w|z|e|r|ult|ulti|ultime|ultimate))?\\s*[(:-]?\\s*$`,
          'u',
        ).test(prefix);
      });
      if (namedChampion && normalize(namedChampion.champion) !== normalize(mention.champion.champion)) {
        addViolation(violations, 'ABILITY_CHAMPION_MISMATCH', field.path);
      }

      const slotMatch = prefix.match(/\b(p|passif|passive|q|a|w|z|e|r|ult|ulti|ultime|ultimate)\s*[(:-]?\s*$/u);
      const statedSlot = slotMatch ? SLOT_ALIASES[slotMatch[1] ?? ''] : undefined;
      if (statedSlot && statedSlot !== mention.ability.slot) {
        addViolation(violations, 'ABILITY_SLOT_MISMATCH', field.path);
      }
      abilityIndex = text.indexOf(abilityName, abilityIndex + abilityName.length);
    }
  }

  for (const champion of context.champions) {
    const championName = normalize(champion.champion);
    const pattern = new RegExp(`\\b${escapeRegExp(championName)}\\s+(p|passif|passive|q|a|w|z|e|r|ult|ulti|ultime|ultimate)\\s*\\(([^)]+)\\)`, 'gu');
    for (const match of associationText.matchAll(pattern)) {
      const slot = SLOT_ALIASES[match[1] ?? ''];
      const statedName = normalize(match[2] ?? '');
      const expected = champion.abilities.find((ability) => ability.slot === slot);
      if (expected && statedName !== normalize(expected.name)) {
        addViolation(violations, 'ABILITY_NAME_MISMATCH', field.path);
      }
    }
  }
}

function validateAvailability(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
): void {
  if (field.level === undefined) return;
  for (const { ability } of mentions) {
    if (ability.availability.earliestLevel > field.level) {
      addViolation(violations, 'ABILITY_UNAVAILABLE_AT_LEVEL', field.path);
    }
  }

  const text = normalize(field.text);
  if (field.level < 6 && /\b(?:apres|post)\s+(?:le\s+)?niveau\s*6\b|\bniveau\s*6\+?/u.test(text)) {
    addViolation(violations, 'TEMPORAL_INCONSISTENCY', field.path);
  }
  if (field.level <= 3 && /\b(?:a|vers)?\s*\d+(?:[.,]\d+)?\s*(?:min|minute|minutes)\b/u.test(text)) {
    addViolation(violations, 'TEMPORAL_INCONSISTENCY', field.path);
  }
}

function validateAbilityEffects(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
): void {
  if (mentions.length === 0) return;
  const text = normalize(field.text);
  const interactionClaim = includesTerm(text, ABILITY_INTERACTION_VERBS);
  const declared = EFFECT_PATTERNS
    .filter(([effect, pattern]) =>
      pattern.test(text)
      && !(interactionClaim && [
        'stun', 'root', 'slow', 'knock-up', 'displacement', 'silence', 'fear', 'charm', 'taunt',
      ].includes(effect)),
    )
    .map(([effect]) => effect);
  for (const effect of declared) {
    const modeledMentions = mentions.filter(({ ability }) => ability.effects !== undefined);
    if (
      modeledMentions.length > 0
      && !modeledMentions.some(({ ability }) => ability.effects?.includes(effect))
    ) {
      addViolation(violations, 'ABILITY_EFFECT_MISMATCH', field.path);
    }
  }

  if (
    /\b(?:damage|damages|endommage|execute|detruit)\b.{0,50}\b(?:turret|tower|tourelle|structure)\b/u.test(text)
    && !mentions.some(({ ability }) => /\b(?:turret|tower|tourelle|structure)\b/u.test(abilityFacts(ability)))
  ) {
    addViolation(violations, 'ABILITY_EFFECT_MISMATCH', field.path);
  }
}

function validateTargeting(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
): void {
  const text = normalize(field.text);
  const impliesPlacedZone = /\b(?:place|pose|depose|zone au sol|au sol|a un endroit|en retrait)\b/u.test(text);
  if (
    impliesPlacedZone
    && mentions.some(({ ability }) => ability.castModel === 'self' || ability.castModel === 'self-centered')
  ) {
    addViolation(violations, 'ABILITY_TARGETING_MISMATCH', field.path);
  }
}

function validateAbilityInteractions(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
  patchFacts: readonly string[],
): void {
  if (mentions.length < 2) return;
  const text = normalize(field.text);
  const verbs = ABILITY_INTERACTION_VERBS.filter((verb) => text.includes(verb));
  if (verbs.length === 0) return;
  const trustedFacts = [
    ...mentions.flatMap(({ ability }) => ability.facts.map(normalize)),
    ...patchFacts,
  ];
  const protectionClaim = includesTerm(text, PROTECTION_VERBS);
  const supported = trustedFacts.some((fact) =>
    verbs.some((verb) => fact.includes(verb))
      || (protectionClaim && includesTerm(fact, SUPPORTED_PROTECTION_FACTS)),
  );
  if (!supported) addViolation(violations, 'UNSUPPORTED_ABILITY_INTERACTION', field.path);
}

function validateCrowdControl(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
  patchFacts: readonly string[],
): void {
  const text = normalize(field.text);
  const ccTerms = CC_TERMS.filter((term) => text.includes(term));
  if (/\bknocks?\b.{0,30}\bback\b/u.test(text)) ccTerms.push('knockback');
  if (/\bknocks?\b.{0,30}\bup\b/u.test(text)) ccTerms.push('knock up');
  if (ccTerms.length === 0 || mentions.length === 0) return;

  if (includesTerm(text, PROTECTION_VERBS)) {
    const supported = mentions.some(({ ability }) =>
      includesTerm(abilityFacts(ability), SUPPORTED_PROTECTION_FACTS),
    ) || patchFacts.some((fact) => includesTerm(fact, SUPPORTED_PROTECTION_FACTS));
    if (!supported) addViolation(violations, 'UNSUPPORTED_CC_INTERACTION', field.path);
    return;
  }

  const supportedEffect = mentions.some(({ ability }) => {
    const facts = abilityFacts(ability);
    return ccTerms.some((term) => facts.includes(term));
  });
  if (!supportedEffect && /\b(?:knocks?|stuns?|roots?|pulls?|silences?|fears?|charms?|taunts?|repousse|etourdit|immobilise|attire|reduit au silence|effraie|charme|provoque)\b/u.test(text)) {
    addViolation(violations, 'UNSUPPORTED_CC_INTERACTION', field.path);
  }
}

function validateCooldownMechanics(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
  patchFacts: readonly string[],
): void {
  const text = normalize(field.text);
  const terms = RESET_TERMS.filter((term) => text.includes(term));
  if (terms.length === 0) return;
  if (mentions.length === 0 && !/\b(?:cooldown|delai de recuperation)\b/u.test(text)) return;
  const supported = mentions.some(({ ability }) => {
    const facts = abilityFacts(ability);
    return terms.some((term) => facts.includes(term));
  }) || patchFacts.some((fact) => terms.some((term) => fact.includes(term)));
  if (!supported) addViolation(violations, 'UNSUPPORTED_COOLDOWN_RESET', field.path);
}

function mechanicalNumbers(text: string): readonly number[] {
  const normalized = normalize(text);
  const values: number[] = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)\s*(?:ms|s|sec|secs|secondes?|seconds?|%|range|portee|degats?|damage)\b/gu;
  for (const match of normalized.matchAll(pattern)) {
    values.push(Number((match[1] ?? '').replace(',', '.')));
  }
  return values.filter(Number.isFinite);
}

function trustedNumbers(ability: AbilityGameplayFact): readonly number[] {
  const values = [...(ability.cooldowns ?? [])];
  for (const fact of ability.facts) {
    for (const match of normalize(fact).matchAll(/\b\d+(?:[.,]\d+)?\b/gu)) {
      values.push(Number((match[0] ?? '').replace(',', '.')));
    }
  }
  return values.filter(Number.isFinite);
}

function validateExactValues(
  field: AnalysisTextField,
  mentions: readonly AbilityMention[],
  violations: AnalysisConformanceViolation[],
  patchFacts: readonly string[],
): void {
  const values = mechanicalNumbers(field.text);
  if (values.length === 0) return;
  const patchNumbers = patchFacts.flatMap((fact) =>
    [...fact.matchAll(/\b\d+(?:[.,]\d+)?\b/gu)]
      .map((match) => Number((match[0] ?? '').replace(',', '.')))
      .filter(Number.isFinite),
  );
  const supported = values.every((value) =>
    mentions.some(({ ability }) => trustedNumbers(ability).some((known) => known === value))
      || patchNumbers.includes(value),
  ) && (mentions.length > 0 || patchFacts.length > 0);
  if (!supported) addViolation(violations, 'UNSUPPORTED_EXACT_VALUE', field.path);
}

function validateLethal(field: AnalysisTextField, violations: AnalysisConformanceViolation[]): void {
  const text = normalize(field.text);
  if (LETHAL_PATTERNS.some((pattern) => pattern.test(text))) {
    addViolation(violations, 'UNSUPPORTED_LETHAL_CLAIM', field.path);
  }
}

export class AnalysisConformanceFailure extends Error {
  readonly violationCodes: readonly AnalysisConformanceCode[];
  readonly violationPaths: readonly string[];

  constructor(violations: readonly AnalysisConformanceViolation[]) {
    super('Gameplay conformance validation failed.');
    this.name = 'AnalysisConformanceFailure';
    this.violationCodes = Object.freeze([...new Set(violations.map(({ code }) => code))]);
    this.violationPaths = Object.freeze([...new Set(violations.map(({ path }) => path))]);
  }
}

export function findAnalysisConformanceFailure(error: unknown): AnalysisConformanceFailure | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof AnalysisConformanceFailure) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

export class AnalysisConformanceValidator {
  validate(
    analysis: MatchupAnalysis,
    context: GameplayContext,
    patchContext?: PatchContext,
  ): AnalysisConformanceResult {
    const violations: AnalysisConformanceViolation[] = [];
    for (const field of fields(analysis)) {
      const mentions = mentionsIn(field.text, context);
      const fieldText = normalize(field.text);
      const patchFacts = (patchContext?.facts ?? [])
        .filter((fact) => {
          const subject = normalize(fact.subject);
          if (fieldText.includes(subject)) return true;
          return mentions.some(({ champion, ability }) => {
            const championName = normalize(champion.champion);
            const abilityName = normalize(ability.name);
            return subject.includes(championName)
              && (subject.includes(abilityName) || new RegExp(`\\b${ability.slot.toLocaleLowerCase('en-US')}\\b`, 'u').test(subject));
          });
        })
        .map((fact) => normalize(`${fact.subject} ${fact.text}`));
      validateExplicitAssociations(field, context, violations);
      validateAvailability(field, mentions, violations);
      validateAbilityEffects(field, mentions, violations);
      validateTargeting(field, mentions, violations);
      validateAbilityInteractions(field, mentions, violations, patchFacts);
      validateCrowdControl(field, mentions, violations, patchFacts);
      validateCooldownMechanics(field, mentions, violations, patchFacts);
      validateExactValues(field, mentions, violations, patchFacts);
      validateLethal(field, violations);
    }

    const waveGuidance = normalize(`${analysis.lanePlan} ${analysis.wavePlan} ${analysis.threatResponseWindow.winCondition}`);
    if (
      /\b(?:freeze|geler|gele)\b/u.test(waveGuidance)
      && /\b(?:push|pousser|pousse)\b/u.test(waveGuidance)
      && !/\b(?:d abord|puis|ensuite|apres|une fois)\b/u.test(waveGuidance)
    ) {
      addViolation(violations, 'TACTICAL_PLAN_CONTRADICTION', 'lanePlan,wavePlan', 'warning');
    }

    const frozen = Object.freeze(violations);
    return Object.freeze({
      valid: !frozen.some(({ severity }) => severity === 'error'),
      violations: frozen,
    });
  }
}

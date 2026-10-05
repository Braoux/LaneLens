import {
  DATA_DRAGON_GAMEPLAY_VERSION,
} from '../gameplay-context/data/data-dragon-champions.js';
import {
  GameplayContextNotFoundError,
  StaticGameplayContextResolver,
} from '../gameplay-context/StaticGameplayContextResolver.js';
import type {
  AbilitySlot,
  ChampionGameplayContext,
  GameplayContextResolver,
} from '../gameplay-context/types.js';
import { MECHANICAL_GOLDEN_TRUTH } from './data/mechanical-golden-truth.js';
import {
  TRUSTED_ABILITY_MECHANICS,
  type TrustedAbilityMechanic,
} from './data/trusted-mechanics.js';

export interface MechanicalCoverageIssue {
  readonly champion: string;
  readonly slot?: AbilitySlot;
  readonly field: string;
  readonly message: string;
}

export interface ChampionMechanicalCoverage {
  readonly champion: string;
  readonly fullyCovered: boolean;
  readonly issues: readonly MechanicalCoverageIssue[];
}

export interface MatchupMechanicalCoverage {
  readonly id: string;
  readonly fullyCovered: boolean;
  readonly champions: readonly ChampionMechanicalCoverage[];
  readonly missing: readonly string[];
}

export interface MechanicalCoverageGateResult {
  readonly goldenTruthVersion: string;
  readonly patch: string;
  readonly fullyCovered: boolean;
  readonly coveredChampions: number;
  readonly totalChampions: number;
  readonly coveredMatchups: number;
  readonly totalMatchups: number;
  readonly champions: readonly ChampionMechanicalCoverage[];
  readonly matchups: readonly MatchupMechanicalCoverage[];
}

export interface MechanicalCoverageGateOptions {
  readonly gameplayResolver?: GameplayContextResolver;
  readonly mechanics?: Readonly<Record<string, TrustedAbilityMechanic>>;
}

export interface MechanicalCoverageMatchup {
  readonly id: string;
  readonly ally: { readonly carry: string; readonly support: string };
  readonly enemy: { readonly carry: string; readonly support: string };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').normalize('NFKD').replaceAll(/\p{M}/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '');
}

function issue(
  champion: string,
  field: string,
  message: string,
  slot?: AbilitySlot,
): MechanicalCoverageIssue {
  return Object.freeze({ champion, ...(slot === undefined ? {} : { slot }), field, message });
}

function validateChampion(
  champion: string,
  context: ChampionGameplayContext | undefined,
  mechanics: Readonly<Record<string, TrustedAbilityMechanic>>,
): ChampionMechanicalCoverage {
  const issues: MechanicalCoverageIssue[] = [];
  if (context === undefined) {
    issues.push(issue(champion, 'champion', `${champion} gameplay context missing`));
    return Object.freeze({ champion, fullyCovered: false, issues: Object.freeze(issues) });
  }
  if (normalize(context.champion) !== normalize(champion)) {
    issues.push(issue(champion, 'ownership', `${champion} ability ownership mismatch`));
  }
  if (context.dataDragonVersion !== MECHANICAL_GOLDEN_TRUTH.dataDragonVersion) {
    issues.push(issue(champion, 'dataDragonVersion', `${champion} Data Dragon version mismatch`));
  }

  for (const slot of MECHANICAL_GOLDEN_TRUTH.requiredSlots) {
    const abilities = context.abilities.filter((ability) => ability.slot === slot);
    if (abilities.length !== 1) {
      issues.push(issue(champion, 'slot', `${champion} ${slot} ownership/slot missing`, slot));
      continue;
    }
    const ability = abilities[0]!;
    if (ability.name.trim().length === 0) {
      issues.push(issue(champion, 'name', `${champion} ${slot} ability name missing`, slot));
    }
    const expectedLevel = slot === 'R' ? 6 : 1;
    if (ability.availability.earliestLevel !== expectedLevel) {
      issues.push(issue(champion, 'availability', `${champion} ${slot} earliest level must be ${expectedLevel}`, slot));
    }
    if (ability.facts.length === 0 || ability.facts.some((fact) => fact.trim().length === 0)) {
      issues.push(issue(champion, 'facts', `${champion} ${slot} mechanical facts missing`, slot));
    }
    if (
      slot !== 'P'
      && (ability.cooldowns === undefined
        || ability.cooldowns.length === 0
        || ability.cooldowns.some((cooldown) => !Number.isFinite(cooldown) || cooldown < 0))
    ) {
      issues.push(issue(champion, 'cooldowns', `${champion} ${slot} useful cooldowns missing`, slot));
    }

    const mechanic = mechanics[`${normalize(champion)}:${slot.toLocaleLowerCase('en-US')}`];
    if (mechanic?.complete !== true) {
      issues.push(issue(champion, 'mechanic.complete', `${champion} ${slot} normalized mechanics not complete`, slot));
      continue;
    }
    if (slot !== 'P' && mechanic.castModel === undefined) {
      issues.push(issue(champion, 'castModel', `${champion} ${slot} cast model missing`, slot));
    }
    if (mechanic.effects === undefined) {
      issues.push(issue(champion, 'effects', `${champion} ${slot} normalized effects missing`, slot));
    }
  }

  return Object.freeze({
    champion,
    fullyCovered: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

function resolveChampion(
  resolver: GameplayContextResolver,
  champion: string,
): ChampionGameplayContext | undefined {
  try {
    return resolver.resolve([champion]).champions[0];
  } catch (error) {
    if (error instanceof GameplayContextNotFoundError) return undefined;
    throw error;
  }
}

export function evaluateMechanicalCoverage(
  matchups: readonly MechanicalCoverageMatchup[],
  patch: string,
  options: MechanicalCoverageGateOptions = {},
): MechanicalCoverageGateResult {
  const resolver = options.gameplayResolver ?? new StaticGameplayContextResolver();
  const mechanics = options.mechanics ?? TRUSTED_ABILITY_MECHANICS;
  const expected = new Map(
    MECHANICAL_GOLDEN_TRUTH.champions.map((champion) => [normalize(champion), champion]),
  );
  const referenced = [...new Set(matchups.flatMap(({ ally, enemy }) => [
    ally.carry, ally.support, enemy.carry, enemy.support,
  ]))];
  const championCoverage = new Map<string, ChampionMechanicalCoverage>();

  for (const canonical of MECHANICAL_GOLDEN_TRUTH.champions) {
    championCoverage.set(
      normalize(canonical),
      validateChampion(canonical, resolveChampion(resolver, canonical), mechanics),
    );
  }
  for (const champion of referenced) {
    const canonical = expected.get(normalize(champion));
    if (canonical !== undefined) continue;
    const coverage = Object.freeze({
      champion,
      fullyCovered: false,
      issues: Object.freeze([issue(champion, 'champion', `${champion} absent from mechanical golden truth`)]),
    });
    championCoverage.set(normalize(champion), coverage);
  }

  const patchIssue = patch === MECHANICAL_GOLDEN_TRUTH.corpusPatch
    && DATA_DRAGON_GAMEPLAY_VERSION === MECHANICAL_GOLDEN_TRUTH.dataDragonVersion
    ? undefined
    : `Golden truth version mismatch: corpus ${patch}, Data Dragon ${DATA_DRAGON_GAMEPLAY_VERSION}`;
  const matchupCoverage = matchups.map((matchup): MatchupMechanicalCoverage => {
    const champions = [matchup.ally.carry, matchup.ally.support, matchup.enemy.carry, matchup.enemy.support]
      .map((champion) => championCoverage.get(normalize(champion))!);
    const missing = [
      ...(patchIssue === undefined ? [] : [patchIssue]),
      ...champions.flatMap(({ issues }) => issues.map(({ message }) => message)),
    ];
    return Object.freeze({
      id: matchup.id,
      fullyCovered: missing.length === 0,
      champions: Object.freeze(champions),
      missing: Object.freeze([...new Set(missing)]),
    });
  });
  const champions = [...championCoverage.values()];
  const coveredChampions = champions.filter(({ fullyCovered }) => fullyCovered).length;
  const coveredMatchups = matchupCoverage.filter(({ fullyCovered }) => fullyCovered).length;

  return Object.freeze({
    goldenTruthVersion: MECHANICAL_GOLDEN_TRUTH.version,
    patch,
    fullyCovered: coveredMatchups === matchupCoverage.length && matchupCoverage.length > 0,
    coveredChampions,
    totalChampions: champions.length,
    coveredMatchups,
    totalMatchups: matchupCoverage.length,
    champions: Object.freeze(champions),
    matchups: Object.freeze(matchupCoverage),
  });
}

import { DATA_DRAGON_GAMEPLAY_VERSION } from '../../gameplay-context/data/data-dragon-champions.js';
import type { KnowledgeEntry } from '../types.js';
import { TRUSTED_ABILITY_MECHANICS } from './trusted-mechanics.js';

const RIOT_SOURCE = Object.freeze({
  type: 'riot' as const,
  name: `Riot Data Dragon ${DATA_DRAGON_GAMEPLAY_VERSION}`,
  url: 'https://developer.riotgames.com/docs/lol#data-dragon',
});
const CURATED_SOURCE = Object.freeze({ type: 'curated' as const, name: 'LaneLens gameplay review' });

function officialMechanics(): readonly KnowledgeEntry[] {
  return Object.entries(TRUSTED_ABILITY_MECHANICS)
    .filter(([, mechanic]) => mechanic.castModel !== undefined || (mechanic.effects?.length ?? 0) > 0)
    .map(([key, mechanic]) => {
      const [championKey = '', rawSlot = ''] = key.split(':');
      const slot = rawSlot.toUpperCase() as 'P' | 'Q' | 'W' | 'E' | 'R';
      const details = [
        mechanic.castModel === undefined ? undefined : `cast model ${mechanic.castModel}`,
        mechanic.effects?.length ? `effects ${mechanic.effects.join(', ')}` : undefined,
      ].filter((value): value is string => value !== undefined).join('; ');
      return Object.freeze({
        id: `ability-${championKey}-${rawSlot}-mechanics`,
        type: 'official_fact',
        subjectKind: 'ability',
        subject: `${championKey}:${slot}`,
        statement: `${championKey} ${slot}: ${details}.`,
        championKeys: Object.freeze([championKey]),
        abilitySlots: Object.freeze([slot]),
        tags: Object.freeze([...(mechanic.effects ?? []), ...(mechanic.castModel === undefined ? [] : [mechanic.castModel])]),
        phases: Object.freeze(['lane'] as const),
        scope: 'structural',
        confidence: 'high',
        status: 'verified',
        verification: 'automatic',
        sources: Object.freeze([RIOT_SOURCE]),
        mechanic: Object.freeze({
          kind: 'ability-mechanic',
          championKey,
          slot,
          castModel: mechanic.castModel,
          effects: mechanic.effects === undefined ? undefined : Object.freeze([...mechanic.effects]),
          complete: mechanic.complete === true,
        }),
      } satisfies KnowledgeEntry);
    });
}


const ENRICHED_KNOWLEDGE: readonly KnowledgeEntry[] = [
  // ============================================================
  // OFFICIAL FACTS
  // ============================================================

  {
    id: 'cassiopeia-w-grounding',
    type: 'official_fact',
    subjectKind: 'ability',
    subject: 'Cassiopeia:W',
    statement:
      'Cassiopeia W creates an area that slows and grounds affected enemies. Grounded enemies cannot cast movement abilities while the effect applies.',
    championKeys: ['cassiopeia'],
    abilitySlots: ['W'],
    tags: ['anti-dash', 'zone-control', 'slow'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    sources: [RIOT_SOURCE],
  },
  {
    id: 'nami-w-heal',
    type: 'official_fact',
    subjectKind: 'ability',
    subject: 'Nami:W',
    statement:
      'Nami W can bounce between allied and enemy champions, healing allied targets and damaging enemy targets.',
    championKeys: ['nami'],
    abilitySlots: ['W'],
    tags: ['sustain', 'heal', 'poke'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    sources: [RIOT_SOURCE],
  },
  {
    id: 'jinx-q-weapon-modes',
    type: 'official_fact',
    subjectKind: 'ability',
    subject: 'Jinx:Q',
    statement:
      'Jinx Q switches between a minigun that rewards sustained attacking and rockets that provide increased attack range and area damage.',
    championKeys: ['jinx'],
    abilitySlots: ['Q'],
    tags: ['sustained-fight', 'waveclear', 'range'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    sources: [RIOT_SOURCE],
  },
  {
    id: 'ashe-q-sustained-fight',
    type: 'official_fact',
    subjectKind: 'ability',
    subject: 'Ashe:Q',
    statement:
      'Ashe Q requires attack-based preparation and temporarily empowers her sustained basic attacks with increased attack speed and flurries of arrows.',
    championKeys: ['ashe'],
    abilitySlots: ['Q'],
    tags: ['sustained-fight', 'dps'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    sources: [RIOT_SOURCE],
  },
  {
    id: 'ziggs-area-waveclear',
    type: 'official_fact',
    subjectKind: 'champion',
    subject: 'Ziggs',
    statement:
      'Ziggs has multiple area-damage abilities. His Q and E can contribute to waveclear, while E creates a minefield that slows enemies who trigger its mines.',
    championKeys: ['ziggs'],
    abilitySlots: ['Q', 'E'],
    tags: ['waveclear', 'poke', 'zone-control'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    sources: [RIOT_SOURCE],
  },

  // ============================================================
  // DERIVED FACTS
  // ============================================================

  {
    id: 'ziggs-w-disengage',
    type: 'derived_fact',
    subjectKind: 'ability',
    subject: 'Ziggs:W',
    statement:
      'Ziggs can use W to create distance, reposition himself, or knock an enemy away, making it a potential disengage tool.',
    championKeys: ['ziggs'],
    abilitySlots: ['W'],
    tags: ['disengage', 'self-peel', 'mobility'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    derivedFrom: ['ability-ziggs-w-mechanics'],
    derivationRuleId: 'movement-effect-enables-spacing',
    sources: [
      { type: 'derived', name: 'LaneLens validated derivation' },
    ],
  },
  {
    id: 'caitlyn-e-self-peel',
    type: 'derived_fact',
    subjectKind: 'ability',
    subject: 'Caitlyn:E',
    statement:
      'Caitlyn can use E to reposition and create distance from a threat when the ability is available and an appropriate escape direction exists.',
    championKeys: ['caitlyn'],
    abilitySlots: ['E'],
    tags: ['disengage', 'self-peel', 'mobility'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    derivedFrom: ['ability-caitlyn-e-mechanics'],
    derivationRuleId: 'movement-effect-enables-spacing',
    sources: [
      { type: 'derived', name: 'LaneLens validated derivation' },
    ],
  },
  {
    id: 'leona-e-engage',
    type: 'derived_fact',
    subjectKind: 'ability',
    subject: 'Leona:E',
    statement:
      'Leona E can initiate an engage when it connects with a valid enemy champion. The resulting opportunity depends on positioning and available defensive responses.',
    championKeys: ['leona'],
    abilitySlots: ['E'],
    tags: ['engage', 'critical-cooldown'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    derivedFrom: ['ability-leona-e-mechanics'],
    derivationRuleId: 'control-effect-creates-window',
    sources: [
      { type: 'derived', name: 'LaneLens validated derivation' },
    ],
  },
  {
    id: 'swain-e-catch-window',
    type: 'derived_fact',
    subjectKind: 'ability',
    subject: 'Swain:E',
    statement:
      'Swain E can create a catch opportunity through crowd control. After a missed cast, this particular catch threat is temporarily reduced while the ability is unavailable.',
    championKeys: ['swain'],
    abilitySlots: ['E'],
    tags: ['engage', 'critical-cooldown', 'catch'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    derivedFrom: ['ability-swain-e-mechanics'],
    derivationRuleId: 'control-effect-creates-window',
    sources: [
      { type: 'derived', name: 'LaneLens validated derivation' },
    ],
  },
  {
    id: 'galio-w-zone-control',
    type: 'derived_fact',
    subjectKind: 'ability',
    subject: 'Galio:W',
    statement:
      'The threat of Galio W can restrict enemy positioning around Galio and support either an engage or protection of a nearby ally.',
    championKeys: ['galio'],
    abilitySlots: ['W'],
    tags: ['zone-control', 'peel', 'engage'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'automatic',
    derivedFrom: ['ability-galio-w-mechanics'],
    derivationRuleId: 'control-effect-creates-window',
    sources: [
      { type: 'derived', name: 'LaneLens validated derivation' },
    ],
  },

  // ============================================================
  // VERIFIED HEURISTICS — Existing curated knowledge
  // ============================================================

  {
    id: 'engage-cooldown-lane-window',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'critical-cooldown',
    statement:
      'After an important engage ability is missed or expended, a temporary pressure window may appear. Its usefulness depends on remaining abilities, health, wave state, and jungle threats.',
    championKeys: ['leona', 'swain', 'galio'],
    tags: ['engage', 'critical-cooldown', 'lane-window'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'poke-vs-engage-spacing',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'poke-vs-engage',
    statement:
      'A poke-oriented lane can use spacing to limit enemy engage opportunities. After a missed engage, it may pressure the opponents while accounting for wave position and remaining threats.',
    championKeys: ['caitlyn', 'lux', 'ziggs', 'leona'],
    tags: ['poke', 'engage', 'spacing'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'annie-burst-window',
    type: 'heuristic',
    subjectKind: 'champion',
    subject: 'Annie',
    statement:
      'When Annie has prepared her stun threat, opponents should account for her ability to combine crowd control and burst damage. After she expends key abilities, reassess the trading window.',
    championKeys: ['annie'],
    tags: ['burst', 'engage', 'critical-cooldown'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'jinx-scaling-protection',
    type: 'heuristic',
    subjectKind: 'champion',
    subject: 'Jinx',
    statement:
      'A lane with Jinx may prioritize resource preservation and safe wave states when forcing early trades would expose her to a stronger enemy engage. This does not rule out favorable early trading opportunities.',
    championKeys: ['jinx'],
    tags: ['scaling', 'wave-state', 'peel'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },

  // ============================================================
  // MATCHUP OBSERVATIONS — Existing reviewed interactions
  // ============================================================

  {
    id: 'morgana-e-vs-leona-engage',
    type: 'matchup_observation',
    subjectKind: 'interaction',
    subject: 'Morgana:E vs Leona engage',
    statement:
      'Morgana E can protect an ally from Leona crowd control while the protection remains effective. Leona must account for shield timing, shield removal, or a different target; the shield does not automatically invalidate every engage.',
    championKeys: ['morgana', 'leona'],
    abilitySlots: ['E'],
    tags: ['engage', 'peel', 'shield'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },

  // ============================================================
  // NEW CANDIDATES — Trading and cooldown decisions
  // Review before promoting to verified.
  // ============================================================

  {
    id: 'defensive-cooldown-punish-window',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'defensive-cooldown',
    statement:
      'When an important defensive ability is unavailable, an opponent may gain an engage or trading opportunity. Check other defensive tools, health, positioning, and wave state before committing.',
    championKeys: [],
    tags: ['critical-cooldown', 'engage', 'lane-window'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'short-vs-extended-trade',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'trade-duration',
    statement:
      'A burst-oriented duo may prefer short trades when key abilities are available, while a sustained-damage duo may benefit from longer exchanges if positioning, survivability, and enemy cooldowns allow it.',
    championKeys: [],
    tags: ['trade', 'burst', 'sustained-fight'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'level-two-advantage-window',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'level-two-advantage',
    statement:
      'Reaching level two before the opposing botlane can create a pressure window through access to another learned ability and increased base stats. The opportunity depends on actual skill choices, health, positioning, and minion waves.',
    championKeys: [],
    tags: ['level-advantage', 'engage', 'lane-window'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'level-three-skill-availability',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'skill-order',
    statement:
      'A champion can have Q, W, and E learned by level three, but this is not guaranteed. Never infer that all three basic abilities are available solely from champion level.',
    championKeys: [],
    tags: ['level-advantage', 'ability-availability'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },

  // ============================================================
  // NEW CANDIDATES — Wave management and positioning
  // ============================================================

  {
    id: 'wave-position-vs-engage',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'wave-position',
    statement:
      'Against a strong engage threat, maintaining a wave position with a safer retreat path may reduce exposure. Consider matchup pressure, jungle information, wave size, and the need for lane priority.',
    championKeys: [],
    tags: ['wave-state', 'engage', 'safety'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'wave-crash-recall-window',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'crash-and-recall',
    statement:
      'Crashing a wave into the enemy turret can create a recall opportunity by forcing opponents to collect minions. The recall is safer when the crash is completed and enemy threats are accounted for.',
    championKeys: [],
    tags: ['wave-state', 'recall', 'tempo'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'lane-priority-and-rotation',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'lane-priority',
    statement:
      'Lane priority can make it easier to move toward the river, assist a jungler, or prepare an objective. Priority alone does not guarantee a safe rotation without sufficient health, vision, and information about enemy positions.',
    championKeys: [],
    tags: ['wave-state', 'priority', 'rotation'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'minion-blocked-skillshot-spacing',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'skillshot-positioning',
    statement:
      'Minions can provide protection against enemy skillshots that collide with units. This protection does not apply universally: some abilities pass through, damage, or affect multiple targets.',
    championKeys: [],
    tags: ['spacing', 'skillshot', 'wave-state'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'large-enemy-wave-trade-risk',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'minion-advantage',
    statement:
      'Trading into a large enemy minion wave can expose a champion to significant minion damage, particularly when attacking an enemy champion draws minion aggression. Assess wave size before committing.',
    championKeys: [],
    tags: ['wave-state', 'trade', 'minion-advantage'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'high',
    status: 'verified',
    verification: 'human',
    sources: [CURATED_SOURCE],
  },

  // ============================================================
  // NEW CANDIDATES — Botlane interactions
  // ============================================================

  {
    id: 'jinx-e-followup-on-allied-cc',
    type: 'matchup_observation',
    subjectKind: 'interaction',
    subject: 'Jinx:E follow-up on allied crowd control',
    statement:
      'Jinx E can be placed to extend area denial or threaten additional crowd control after an ally catches an enemy. The traps have an activation delay, so a guaranteed chain must not be assumed.',
    championKeys: ['jinx'],
    abilitySlots: ['E'],
    tags: ['catch', 'peel', 'zone-control'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'caitlyn-trap-followup-on-cc',
    type: 'matchup_observation',
    subjectKind: 'interaction',
    subject: 'Caitlyn:W follow-up on allied crowd control',
    statement:
      'Caitlyn can place W near a crowd-controlled opponent to threaten a trap-triggered follow-up and enhanced attack. Placement timing, trap arming, enemy positioning, and the remaining control duration determine reliability.',
    championKeys: ['caitlyn'],
    abilitySlots: ['W'],
    tags: ['catch', 'trap', 'follow-up'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'ziggs-minefield-disengage-spacing',
    type: 'matchup_observation',
    subjectKind: 'interaction',
    subject: 'Ziggs:E defensive zone control',
    statement:
      'Ziggs E can discourage enemy pursuit by creating a damaging, slowing minefield. It does not root or stun targets, and its defensive value depends on placement and the enemy movement options.',
    championKeys: ['ziggs'],
    abilitySlots: ['E'],
    tags: ['disengage', 'zone-control', 'slow'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },
  {
    id: 'morgana-black-shield-commit-window',
    type: 'matchup_observation',
    subjectKind: 'interaction',
    subject: 'Morgana:E defensive cooldown',
    statement:
      'After Morgana E has been consumed or expires, an opposing engage duo may have a better crowd-control window. This is conditional on Morgana positioning, available spells, and remaining defensive resources.',
    championKeys: ['morgana'],
    abilitySlots: ['E'],
    tags: ['shield', 'critical-cooldown', 'engage'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'medium',
    status: 'candidate',
    verification: 'pending',
    sources: [CURATED_SOURCE],
  },

  // ============================================================
  // TEST FIXTURE — Must stay excluded from runtime selection
  // ============================================================

  {
    id: 'llm-candidate-example',
    type: 'heuristic',
    subjectKind: 'lane_concept',
    subject: 'candidate-example',
    statement: 'Candidate intentionally excluded from runtime selection.',
    championKeys: ['jinx'],
    tags: ['candidate'],
    phases: ['lane'],
    scope: 'structural',
    confidence: 'low',
    status: 'candidate',
    verification: 'pending',
    sources: [
      { type: 'llm', name: 'Unverified assisted proposal' },
    ],
  },
] as const;

export const KNOWLEDGE_BASE_VERSION = 'lan-032-kb-v1';
export const KNOWLEDGE_ENTRIES: readonly KnowledgeEntry[] = Object.freeze([
  ...officialMechanics(),
  ...ENRICHED_KNOWLEDGE.map((entry) => Object.freeze(entry)),
]);

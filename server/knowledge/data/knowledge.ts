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
  return Object.entries(TRUSTED_ABILITY_MECHANICS).map(([key, mechanic]) => {
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
        complete: true,
      }),
    } satisfies KnowledgeEntry);
  });
}

const ENRICHED_KNOWLEDGE: readonly KnowledgeEntry[] = [
  {
    id: 'cassiopeia-w-grounding', type: 'official_fact', subjectKind: 'ability', subject: 'Cassiopeia:W',
    statement: 'Cassiopeia W ralentit et applique Grounded; une cible Grounded ne peut pas utiliser de capacité de déplacement.',
    championKeys: ['cassiopeia'], abilitySlots: ['W'], tags: ['anti-dash', 'zone-control', 'slow'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic', sources: [RIOT_SOURCE],
  },
  {
    id: 'nami-w-heal', type: 'official_fact', subjectKind: 'ability', subject: 'Nami:W',
    statement: 'Nami W rebondit entre champions alliés et ennemis, soigne les alliés et inflige des dégâts aux ennemis.',
    championKeys: ['nami'], abilitySlots: ['W'], tags: ['sustain', 'heal', 'poke'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic', sources: [RIOT_SOURCE],
  },
  {
    id: 'jinx-q-weapon-modes', type: 'official_fact', subjectKind: 'ability', subject: 'Jinx:Q',
    statement: 'Jinx Q alterne entre une minigun qui augmente sa vitesse d’attaque et des roquettes à portée accrue qui infligent des dégâts de zone.',
    championKeys: ['jinx'], abilitySlots: ['Q'], tags: ['sustained-fight', 'waveclear', 'range'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic', sources: [RIOT_SOURCE],
  },
  {
    id: 'ashe-q-sustained-fight', type: 'official_fact', subjectKind: 'ability', subject: 'Ashe:Q',
    statement: 'Ashe Q se prépare en attaquant puis augmente temporairement sa vitesse d’attaque et transforme ses attaques en rafales.',
    championKeys: ['ashe'], abilitySlots: ['Q'], tags: ['sustained-fight', 'dps'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic', sources: [RIOT_SOURCE],
  },
  {
    id: 'ziggs-area-waveclear', type: 'official_fact', subjectKind: 'champion', subject: 'Ziggs',
    statement: 'Les capacités Q, W, E et R de Ziggs infligent des dégâts de zone; E crée aussi une zone de mines ralentissante.',
    championKeys: ['ziggs'], abilitySlots: ['Q', 'W', 'E', 'R'], tags: ['waveclear', 'poke', 'zone-control'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic', sources: [RIOT_SOURCE],
  },
  {
    id: 'ziggs-w-disengage', type: 'derived_fact', subjectKind: 'ability', subject: 'Ziggs:W',
    statement: 'Ziggs peut utiliser W pour créer de la distance et contribuer au disengage.',
    championKeys: ['ziggs'], abilitySlots: ['W'], tags: ['disengage', 'self-peel', 'mobility'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    derivedFrom: ['ability-ziggs-w-mechanics'], derivationRuleId: 'movement-effect-enables-spacing',
    sources: [{ type: 'derived', name: 'LaneLens validated derivation' }],
  },
  {
    id: 'caitlyn-e-self-peel', type: 'derived_fact', subjectKind: 'ability', subject: 'Caitlyn:E',
    statement: 'Caitlyn peut utiliser E comme outil de repositionnement et de self-peel.',
    championKeys: ['caitlyn'], abilitySlots: ['E'], tags: ['disengage', 'self-peel', 'mobility'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    derivedFrom: ['ability-caitlyn-e-mechanics'], derivationRuleId: 'movement-effect-enables-spacing',
    sources: [{ type: 'derived', name: 'LaneLens validated derivation' }],
  },
  {
    id: 'leona-e-engage', type: 'derived_fact', subjectKind: 'ability', subject: 'Leona:E',
    statement: 'Leona E peut ouvrir une séquence d’engage si la compétence atteint une cible valide.',
    championKeys: ['leona'], abilitySlots: ['E'], tags: ['engage', 'critical-cooldown'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    derivedFrom: ['ability-leona-e-mechanics'], derivationRuleId: 'control-effect-creates-window',
    sources: [{ type: 'derived', name: 'LaneLens validated derivation' }],
  },
  {
    id: 'swain-e-catch-window', type: 'derived_fact', subjectKind: 'ability', subject: 'Swain:E',
    statement: 'Swain E peut créer une fenêtre de catch; après un échec, cette menace est temporairement réduite.',
    championKeys: ['swain'], abilitySlots: ['E'], tags: ['engage', 'critical-cooldown', 'displacement'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    derivedFrom: ['ability-swain-e-mechanics'], derivationRuleId: 'control-effect-creates-window',
    sources: [{ type: 'derived', name: 'LaneLens validated derivation' }],
  },
  {
    id: 'galio-w-zone-control', type: 'derived_fact', subjectKind: 'ability', subject: 'Galio:W',
    statement: 'La menace de provocation de Galio W crée une zone de contrôle centrée sur Galio.',
    championKeys: ['galio'], abilitySlots: ['W'], tags: ['zone-control', 'peel', 'engage'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'automatic',
    derivedFrom: ['ability-galio-w-mechanics'], derivationRuleId: 'control-effect-creates-window',
    sources: [{ type: 'derived', name: 'LaneLens validated derivation' }],
  },
  {
    id: 'engage-cooldown-lane-window', type: 'heuristic', subjectKind: 'lane_concept', subject: 'critical-cooldown',
    statement: 'Après l’utilisation manquée d’un outil d’engage important, envisager une fenêtre temporaire de pression sans supposer sa durée exacte.',
    championKeys: ['leona', 'swain', 'galio'], tags: ['engage', 'critical-cooldown', 'lane-window'], phases: ['lane'],
    scope: 'structural', confidence: 'high', status: 'verified', verification: 'human', sources: [CURATED_SOURCE],
  },
  {
    id: 'poke-vs-engage-spacing', type: 'heuristic', subjectKind: 'lane_concept', subject: 'poke-vs-engage',
    statement: 'Une lane de poke doit préserver l’espacement et convertir les sorts d’engage adverses manqués en pression.',
    championKeys: ['caitlyn', 'lux', 'ziggs', 'leona'], tags: ['poke', 'engage', 'spacing'], phases: ['lane'],
    scope: 'structural', confidence: 'medium', status: 'verified', verification: 'human', sources: [CURATED_SOURCE],
  },
  {
    id: 'annie-burst-window', type: 'heuristic', subjectKind: 'champion', subject: 'Annie',
    statement: 'Quand Annie a préparé sa menace de stun, respecter sa capacité à concentrer rapidement plusieurs sorts; après une séquence manquée, réévaluer la fenêtre de pression.',
    championKeys: ['annie'], tags: ['burst', 'engage', 'critical-cooldown'], phases: ['lane'],
    scope: 'structural', confidence: 'medium', status: 'verified', verification: 'human', sources: [CURATED_SOURCE],
  },
  {
    id: 'jinx-scaling-protection', type: 'heuristic', subjectKind: 'champion', subject: 'Jinx',
    statement: 'Une lane avec Jinx peut privilégier la préservation des ressources et des vagues sûres lorsque forcer tôt expose à un engage adverse supérieur.',
    championKeys: ['jinx'], tags: ['scaling', 'wave-state', 'peel'], phases: ['lane'],
    scope: 'structural', confidence: 'medium', status: 'verified', verification: 'human', sources: [CURATED_SOURCE],
  },
  {
    id: 'morgana-e-vs-leona-engage', type: 'matchup_observation', subjectKind: 'interaction', subject: 'Morgana:E vs Leona engage',
    statement: 'La présence de Morgana E oblige Leona à considérer le timing de la protection ou une autre cible; elle ne garantit pas à elle seule l’échec de tout engage.',
    championKeys: ['morgana', 'leona'], abilitySlots: ['E'], tags: ['engage', 'peel', 'shield'], phases: ['lane'],
    scope: 'structural', confidence: 'medium', status: 'verified', verification: 'human', sources: [CURATED_SOURCE],
  },
  {
    id: 'llm-candidate-example', type: 'heuristic', subjectKind: 'lane_concept', subject: 'candidate-example',
    statement: 'Candidate intentionally excluded from runtime selection.',
    championKeys: ['jinx'], tags: ['candidate'], phases: ['lane'], scope: 'structural', confidence: 'low',
    status: 'candidate', verification: 'pending', sources: [{ type: 'llm', name: 'Unverified assisted proposal' }],
  },
] as const;

export const KNOWLEDGE_BASE_VERSION = 'lan-032-kb-v1';
export const KNOWLEDGE_ENTRIES: readonly KnowledgeEntry[] = Object.freeze([
  ...officialMechanics(),
  ...ENRICHED_KNOWLEDGE.map((entry) => Object.freeze(entry)),
]);

import type { MatchupAnalysisInput } from './types.js';
import type { AppLocale } from '../../shared/locale.js';
import type { GameplayContext } from '../gameplay-context/types.js';

const LANGUAGE_INSTRUCTIONS: Record<AppLocale, readonly string[]> = {
  'fr-FR': [
    'Rédige exclusivement en français.',
    'Tous les champs textuels de MatchupAnalysis doivent être en français : lanePlan, threat, response, window, winCondition, earlyLevels, wavePlan, targetPriority.explanation, postLevel6, roamPlan, cheatSheet et goldenRule.',
    'N’écris pas les explications en anglais.',
    'Les noms propres de champions et de capacités peuvent conserver leur nom officiel lorsqu’ils sont fournis par le contexte.',
  ],
};

function gameplayFacts(context: GameplayContext): readonly string[] {
  return context.champions.map((champion) => {
    const abilities = champion.abilities.map((ability) => {
      const cooldowns = ability.cooldowns?.length
        ? ` ; cooldowns Data Dragon: ${ability.cooldowns.join('/')}`
        : '';
      return `${ability.slot} ${ability.name} (disponible niveau ${ability.availability.earliestLevel}${cooldowns}) : ${ability.facts.join(' ')}`;
    });
    return `${champion.champion} [Data Dragon ${champion.dataDragonVersion}]\n${abilities.join('\n')}`;
  });
}

export function buildMatchupAnalysisInstructions(
  input: MatchupAnalysisInput,
  gameplayContext: GameplayContext,
): string {
  return [
    ...LANGUAGE_INSTRUCTIONS[input.locale],
    'Produis une analyse tactique concrète de la botlane décrite dans input.',
    'Structure chaque interaction importante selon Threat → Response → Window → Win condition.',
    'Traite explicitement les niveaux 1, 2 et 3, la gestion de wave, les fenêtres de trade,',
    'les fenêtres relatives aux cooldowns et sorts importants, la cible prioritaire, le niveau 6+, le roaming,',
    'la condition de victoire de la lane, la cheatSheet et la goldenRule.',
    'Analyse les interactions précises entre les quatre champions et évite les conseils génériques.',
    'Respecte un budget de lecture pré-game : lanePlan en 2 phrases courtes maximum ;',
    'threat, response, window, niveaux 1/2/3 et goldenRule en 1 phrase concise chacun ;',
    'targetPriority.explanation en 1 à 2 phrases ; cheatSheet en 3 à 5 éléments maximum.',
    `Utilise uniquement le contexte LaneLens fourni pour les informations dépendantes du patch ${input.patch}.`,
    'N’effectue aucune recherche web pour déterminer le patch courant.',
    'Si le contexte ne suffit pas à confirmer une information, ne la présente pas comme certaine.',
    'N’utilise jamais une capacité avant son niveau de disponibilité indiqué.',
    'N’invente jamais le nom, le slot, l’effet ou la cible d’une capacité.',
    'Un shield de dégâts ne bloque pas un contrôle sauf si le contexte l’affirme explicitement.',
    'N’invente aucun reset, refund, refresh ou réduction conditionnelle de cooldown.',
    'N’indique jamais de valeur exacte de cooldown, durée, portée, dégâts, vitesse ou pourcentage sauf si cette valeur est explicitement fournie dans le contexte LaneLens.',
    'N’estime jamais une valeur numérique de gameplay.',
    'Si une valeur exacte n’est pas connue, utilise une formulation qualitative.',
    'Pour Window, décris une fenêtre relative et actionnable, par exemple après qu’un outil d’engage important a été utilisé ou pendant qu’il est indisponible, jamais pendant un nombre inventé de secondes.',
    'Ne déduis jamais une interaction mécanique uniquement à partir des catégories générales de deux sorts.',
    'N’affirme jamais qu’une capacité bloque, annule, interrompt, purge, absorbe, empêche ou ignore un crowd control sauf si cette interaction est explicitement supportée par le contexte gameplay LaneLens.',
    'Ne confonds jamais damage shield, spell shield, CC immunity, unstoppable, cleanse et tenacity.',
    'Si une interaction entre deux capacités n’est pas confirmée, décris seulement la réponse tactique sans affirmer son résultat mécanique.',
    'earlyLevels.level1, earlyLevels.level2 et earlyLevels.level3 représentent des niveaux de champion, jamais des timestamps fixes de partie.',
    'Écris « au niveau 2 » ou « au niveau 3 », jamais « à 2 minutes » ou « à 3 minutes » par déduction.',
    'Ne fusionne jamais les effets de plusieurs capacités d’un même champion.',
    'N’attribue jamais shield, heal, dash, stun, root, slow, knock-up, déplacement ou autre propriété à une capacité si le contexte de confiance ne la fournit pas.',
    'N’invente jamais un mode de ciblage ou de lancement et ne décris jamais une capacité self-centered comme une zone librement placée.',
    'Le fait que deux capacités existent ne signifie pas qu’elles interagissent mécaniquement.',
    'N’affirme jamais un lethal ou un kill garanti sans état de combat complet.',
    'Préfère une formulation qualitative lorsque le contexte ne permet pas une précision.',
    'Conserve un raisonnement tactique concret et actionnable pour la cible prioritaire, la wave, le poke, l’engage et le roam sans transformer ces choix en faits mécaniques absolus.',
    'Avant de finaliser, vérifie que lanePlan, wavePlan, winCondition, goldenRule et cheatSheet ne se contredisent pas directement.',
    'Si la stratégie de wave change selon la phase, explicite la transition, par exemple garder d’abord la vague de votre côté puis pousser après une fenêtre favorable.',
    'Le contexte Data Dragon ci-dessous décrit les kits statiques et reste distinct du patch joueur :',
    ...gameplayFacts(gameplayContext),
    'Retourne une valeur respectant le contrat MatchupAnalysis fourni par LaneLens.',
  ].join('\n');
}

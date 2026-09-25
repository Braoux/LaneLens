import type { MatchupAnalysisInput } from './types.js';
import type { AppLocale } from '../../shared/locale.js';

const LANGUAGE_INSTRUCTIONS: Record<AppLocale, readonly string[]> = {
  'fr-FR': [
    'Rédige exclusivement en français.',
    'Tous les champs textuels de MatchupAnalysis doivent être en français : lanePlan, threat, response, window, winCondition, earlyLevels, wavePlan, targetPriority.explanation, postLevel6, roamPlan, cheatSheet et goldenRule.',
    'N’écris pas les explications en anglais.',
    'Les noms propres de champions et de capacités peuvent conserver leur nom officiel lorsqu’ils sont fournis par le contexte.',
  ],
};

export function buildMatchupAnalysisInstructions(input: MatchupAnalysisInput): string {
  return [
    ...LANGUAGE_INSTRUCTIONS[input.locale],
    'Produis une analyse tactique concrète de la botlane décrite dans input.',
    'Structure chaque interaction importante selon Threat → Response → Window → Win condition.',
    'Traite explicitement les niveaux 1, 2 et 3, la gestion de wave, les fenêtres de trade,',
    'les cooldowns et sorts importants, la cible prioritaire, le niveau 6+, le roaming,',
    'la condition de victoire de la lane, la cheatSheet et la goldenRule.',
    'Analyse les interactions précises entre les quatre champions et évite les conseils génériques.',
    'Respecte un budget de lecture pré-game : lanePlan en 2 phrases courtes maximum ;',
    'threat, response, window, niveaux 1/2/3 et goldenRule en 1 phrase concise chacun ;',
    'targetPriority.explanation en 1 à 2 phrases ; cheatSheet en 3 à 5 éléments maximum.',
    `Utilise uniquement le contexte LaneLens fourni pour les informations dépendantes du patch ${input.patch}.`,
    'N’effectue aucune recherche web pour déterminer le patch courant.',
    'Si le contexte ne suffit pas à confirmer une information, ne la présente pas comme certaine.',
    'Retourne une valeur respectant le contrat MatchupAnalysis fourni par LaneLens.',
  ].join('\n');
}

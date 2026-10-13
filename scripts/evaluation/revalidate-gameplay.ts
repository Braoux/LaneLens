import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyConfirmedFalsePositiveReview,
  applyRemovalReview,
  revalidateEvaluationResults,
  revalidateRepairResults,
  type ConfirmedFalsePositiveReview,
  type RemovalReviewEntry,
} from './revalidation.js';
import type { EvaluationResultsFile } from './types.js';
import type { EvaluationResult } from './types.js';
import type { RepairResultsFile } from './repair-types.js';

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function sourceAnalysis(result: EvaluationResult): unknown {
  return result.analysis ?? result.candidateAnalysis ?? result.rejectedResponse;
}

function detailedReview(
  source: EvaluationResultsFile,
  entry: RemovalReviewEntry,
): Record<string, unknown> {
  const result = source.results.find(({ id }) => id === entry.id);
  const historicalViolation = result?.violations?.find((violation) =>
    violation.code === entry.code
    && violation.path === entry.path
    && (entry.subject === undefined || violation.subject === entry.subject));
  return {
    ...entry,
    originalText: result === undefined
      ? undefined
      : valueAtPath(sourceAnalysis(result), entry.path),
    historicalViolation,
  };
}

const historicalFalsePositiveReview: readonly ConfirmedFalsePositiveReview[] = [
  ...[
    ['L61-G01#3', 'wavePlan'],
    ['L61-G01#4', 'wavePlan'],
    ['L61-G02#5', 'wavePlan'],
    ['L61-G03#1', 'wavePlan'],
    ['L61-G03#5', 'wavePlan'],
    ['L61-G04#1', 'wavePlan'],
    ['L61-G06#1', 'wavePlan'],
    ['L61-G06#1', 'roamPlan'],
    ['L61-G08#1', 'wavePlan'],
    ['L61-G08#1', 'roamPlan'],
  ].map(([id, path]) => ({
    id: id!,
    code: 'UNSUPPORTED_COOLDOWN_RESET',
    path: path!,
    reason: 'Le terme « reset » désigne ici un rappel ou une transition de vague, pas une réinitialisation de cooldown.',
  })),
  ...[
    ['L61-G02#2', 'cheatSheet.1'],
    ['L61-G06#4', 'threatResponseWindow.threat'],
    ['L61-G08#4', 'threatResponseWindow.threat'],
    ['L61-G10#3', 'goldenRule'],
  ].map(([id, path]) => ({
    id: id!,
    code: 'ABILITY_CHAMPION_MISMATCH',
    path: path!,
    reason: 'Le champion adjacent est la cible ou le bénéficiaire de la capacité, pas son propriétaire.',
  })),
  {
    id: 'L61-G01#1', code: 'ABILITY_EFFECT_MISMATCH', path: 'postLevel6',
    reason: 'Les effets de Leona R et Galio R sont décrits dans des propositions distinctes et sont mécaniquement corrects.',
  },
  {
    id: 'L61-G01#1', code: 'KNOWLEDGE_CONTRADICTION', path: 'postLevel6', subject: 'jinx:Q',
    reason: 'Jinx Q n’est pas le sujet de la proposition mécanique contrôlée.',
  },
  {
    id: 'L61-G03#5', code: 'ABILITY_EFFECT_MISMATCH', path: 'earlyLevels.level3',
    reason: 'Le root de Morgana Q et le slow de Ziggs E appartiennent à des propositions distinctes.',
  },
  {
    id: 'L61-G03#5', code: 'KNOWLEDGE_CONTRADICTION', path: 'earlyLevels.level3', subject: 'jinx:Q',
    reason: 'Jinx Q n’est pas le sujet de la proposition mécanique contrôlée.',
  },
  {
    id: 'L61-G09#5', code: 'ABILITY_EFFECT_MISMATCH', path: 'wavePlan',
    reason: 'Le waveclear de Ziggs et la ligne de Swain E sont des affirmations distinctes sans effet transféré.',
  },
  {
    id: 'L61-G09#5', code: 'KNOWLEDGE_CONTRADICTION', path: 'wavePlan', subject: 'swain:E',
    reason: 'Aucun effet du waveclear de Ziggs n’est attribué à Swain E.',
  },
  {
    id: 'L61-G09#5', code: 'KNOWLEDGE_CONTRADICTION', path: 'cheatSheet.2', subject: 'lux:W',
    reason: 'Le texte affirme correctement que Lux W est un bouclier qui ne bloque pas le root de Swain.',
  },
];

const supplementalFalsePositiveReview: readonly ConfirmedFalsePositiveReview[] = ([
    ['L61-G01#4', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.threat', 'leona:Q', 'Le root appartient à Leona E et le stun à Leona Q ; l’ancien diagnostic transférait le root vers Q.'],
    ['L61-G01#4', 'ABILITY_EFFECT_MISMATCH', 'threatResponseWindow.response', undefined, 'Galio W provoque, Galio E projette et Jinx E immobilise : les trois effets sont correctement attribués.'],
    ['L61-G01#4', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.response', 'leona:Q', 'Leona Q n’est pas le sujet des effets de Galio W/E et Jinx E décrits dans ce champ.'],
    ['L61-G01#4', 'ABILITY_EFFECT_MISMATCH', 'postLevel6', undefined, 'Leona R, Caitlyn R, Galio R et Jinx R sont décrits avec leurs mécaniques canoniques respectives.'],
    ['L61-G01#4', 'KNOWLEDGE_CONTRADICTION', 'postLevel6', 'jinx:R', 'Les effets de stun, bouclier et projection appartiennent à Leona R et Galio R, pas à Jinx R.'],
    ['L61-G02#2', 'ABILITY_EFFECT_MISMATCH', 'threatResponseWindow.threat', undefined, 'Ziggs W possède bien un déplacement qui peut repousser Galio.'],
    ['L61-G02#2', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.threat', 'ziggs:W', 'La KB confirme explicitement l’effet displacement de Ziggs W.'],
    ['L61-G02#2', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.winCondition', 'caitlyn:W', 'Le taunt et le knock-up appartiennent à Galio W/E ; Caitlyn W est seulement le piège de conversion.'],
    ['L61-G02#3', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.window', 'ziggs:W', 'Ziggs W est seulement décrit comme dépensé ; la provocation mentionnée appartient explicitement à Galio W.'],
    ['L61-G02#4', 'ABILITY_EFFECT_MISMATCH', 'targetPriority.explanation', undefined, 'Lux Q root, Caitlyn E self-peel et Galio W taunt sont correctement séparés.'],
    ['L61-G02#4', 'KNOWLEDGE_CONTRADICTION', 'targetPriority.explanation', 'caitlyn:E', 'Le root décrit appartient à Lux Q, pas à Caitlyn E.'],
    ['L61-G03#1', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.response', 'morgana:E', 'Black Shield absorbe bien les effets incapacitants tant que le bouclier tient ; Morgana Q porte le root séparé.'],
    ['L61-G03#3', 'ABILITY_TARGETING_MISMATCH', 'threatResponseWindow.threat', undefined, 'Galio W est correctement self-centered ; les zones de Ziggs appartiennent à des capacités distinctes.'],
    ['L61-G03#3', 'ABILITY_EFFECT_MISMATCH', 'earlyLevels.level2', undefined, 'Galio E porte le dash et Morgana E le bouclier ; aucun effet n’est transféré entre les deux.'],
    ['L61-G03#3', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level2', 'galio:Q', 'Galio Q n’est pas mentionné ; le dash appartient explicitement à Galio E.'],
    ['L61-G03#4', 'KNOWLEDGE_CONTRADICTION', 'targetPriority.explanation', 'morgana:Q', 'Morgana Q est correctement utilisée comme root ; provocation et knock-up appartiennent à Galio.'],
    ['L61-G04#5', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.threat', 'jinx:E', 'Jinx E immobilise et Jinx W ralentit ; l’ancien diagnostic fusionnait leurs effets.'],
    ['L61-G05#3', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.window', 'caitlyn:Q', 'Le texte mentionne Caitlyn E comme outil dépensé ; Caitlyn Q n’est pas le sujet de la fenêtre.'],
    ['L61-G05#3', 'ABILITY_EFFECT_MISMATCH', 'earlyLevels.level2', undefined, 'Leona E root, Leona Q stun, Lux W shield et Caitlyn E slow sont tous canoniques.'],
    ['L61-G05#3', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level2', 'caitlyn:E', 'La KB confirme le slow de Caitlyn E ; root, stun et shield appartiennent aux autres capacités nommées.'],
    ['L61-G06#2', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level3', 'jinx:W', 'La KB confirme explicitement que Zap! ralentit la première cible touchée.'],
    ['L61-G07#2', 'ABILITY_EFFECT_MISMATCH', 'threatResponseWindow.threat', undefined, 'Leona E root puis dash, Q stun et R stun/slow sont correctement décrits.'],
    ['L61-G07#2', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.threat', 'jinx:Q', 'Jinx Q n’est pas propriétaire des contrôles décrits, qui appartiennent à Leona.'],
    ['L61-G07#2', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level3', 'ziggs:Q', 'Au niveau 3, les trois sorts de base de Ziggs et Swain peuvent être appris ; le contrôle évoqué ne qualifie pas Ziggs Q.'],
    ['L61-G07#5', 'ABILITY_EFFECT_MISMATCH', 'threatResponseWindow.threat', undefined, 'Leona E root/dash puis Q stun est une séquence mécaniquement correcte.'],
    ['L61-G07#5', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.threat', 'leona:E', 'Leona E porte bien root et dash ; le stun suivant appartient explicitement à Q.'],
    ['L61-G07#5', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level1', 'ziggs:Q', 'Ziggs Q n’est pas contradictoire ; le défaut réel est la possession simultanée de Q et E par Leona au niveau 1, désormais détectée séparément.'],
    ['L61-G07#5', 'KNOWLEDGE_CONTRADICTION', 'postLevel6', 'ziggs:R', 'Stun/slow appartiennent à Leona R et heal/slow à Swain R ; Ziggs R est seulement conservé pour une zone.'],
    ['L61-G08#2', 'ABILITY_EFFECT_MISMATCH', 'wavePlan', undefined, '« slow push » est un concept de gestion de vague, pas un effet de capacité.'],
    ['L61-G08#2', 'KNOWLEDGE_CONTRADICTION', 'wavePlan', 'ziggs:W', 'Ziggs W est uniquement mentionné comme dépensé ; aucun effet mécanique ne lui est attribué.'],
    ['L61-G08#3', 'ABILITY_EFFECT_MISMATCH', 'wavePlan', undefined, 'Morgana Q raté et Black Shield consommé décrivent des disponibilités, sans revendication d’effet incorrecte.'],
    ['L61-G08#3', 'KNOWLEDGE_CONTRADICTION', 'wavePlan', 'morgana:E', 'Black Shield est seulement décrit comme disponible ou consommé ; la phrase ne lui attribue aucun effet contradictoire.'],
    ['L61-G08#3', 'KNOWLEDGE_CONTRADICTION', 'postLevel6', 'caitlyn:R', 'Les ciblages de Caitlyn R, Lux R, Ziggs R et Morgana R sont décrits dans des propositions distinctes.'],
    ['L61-G08#5', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level1', 'caitlyn:E', 'Le E mentionné appartient explicitement à Lux ; Caitlyn E n’est pas le sujet du slow ou du root.'],
    ['L61-G08#5', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level3', 'morgana:E', 'Le root appartient à Lux Q et le piège à Caitlyn W ; Morgana E est seulement le bouclier consommé.'],
    ['L61-G09#2', 'KNOWLEDGE_CONTRADICTION', 'threatResponseWindow.response', 'lux:W', 'La phrase nie explicitement que Lux W empêche un root ; elle ne lui attribue pas cette propriété.'],
    ['L61-G09#2', 'KNOWLEDGE_CONTRADICTION', 'earlyLevels.level1', 'jinx:Q', 'Q ou W sont présentés comme choix alternatifs de niveau 1 ; le slow explicite appartient à Lux E.'],
    ['L61-G09#2', 'ABILITY_TARGETING_MISMATCH', 'earlyLevels.level1', undefined, 'La phrase ne revendique aucun ciblage au sol ou ciblage libre pour Jinx Q/W.'],
    ['L61-G09#4', 'ABILITY_TARGETING_MISMATCH', 'postLevel6', undefined, 'Swain R est correctement centré sur lui et Ziggs R correctement placé au sol dans une proposition distincte.'],
    ['L61-G10#4', 'KNOWLEDGE_CONTRADICTION', 'postLevel6', 'ziggs:R', 'Le stun appartient à Morgana R ; Ziggs R est seulement utilisé en suivi ou en finition.'],
  ] as const).map(([id, code, path, subject, reason]) => ({
    id,
    code,
    path,
    ...(subject === undefined ? {} : { subject }),
    reason,
  }));

const supplementalUndeterminedReview: readonly RemovalReviewEntry[] = [{
  id: 'L61-G10#2',
  code: 'KNOWLEDGE_CONTRADICTION',
  path: 'targetPriority.explanation',
  subject: 'ziggs:E',
  classification: 'UNDETERMINED',
  reason: '« Ziggs E la bloque » peut décrire un ralentissement et du zone denial, ou être compris comme une immobilisation. Le texte seul ne permet pas de trancher.',
}];

async function main(): Promise<void> {
  const sourcePath = argumentValue('--source-results');
  const repairPath = argumentValue('--repair-results');
  const outputPath = argumentValue('--output');
  if (sourcePath === undefined || outputPath === undefined) {
    throw new Error('--source-results et --output sont obligatoires.');
  }

  const generatedAt = new Date().toISOString();
  const outputDirectory = resolve(outputPath);
  await mkdir(outputDirectory, { recursive: true });
  const sourceResults = await readJson<EvaluationResultsFile>(resolve(sourcePath));
  const evaluation = applyRemovalReview(
    applyConfirmedFalsePositiveReview(
      await revalidateEvaluationResults(
        sourceResults,
        generatedAt,
      ),
      [...historicalFalsePositiveReview, ...supplementalFalsePositiveReview],
    ),
    supplementalUndeterminedReview,
  );
  await writeFile(
    resolve(outputDirectory, 'initial-revalidation.json'),
    `${JSON.stringify(evaluation, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    resolve(outputDirectory, 'supplemental-removal-review.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt,
      summary: {
        reviewed: supplementalFalsePositiveReview.length + supplementalUndeterminedReview.length,
        confirmedFalsePositive: supplementalFalsePositiveReview.length,
        undetermined: supplementalUndeterminedReview.length,
      },
      reviews: [
        ...supplementalFalsePositiveReview.map((entry) => ({
          ...entry,
          classification: 'CONFIRMED_FALSE_POSITIVE' as const,
        })).map((entry) => detailedReview(sourceResults, entry)),
        ...supplementalUndeterminedReview.map((entry) => detailedReview(sourceResults, entry)),
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  if (repairPath !== undefined) {
    const repair = await revalidateRepairResults(
      await readJson<RepairResultsFile>(resolve(repairPath)),
      generatedAt,
    );
    await writeFile(
      resolve(outputDirectory, 'repair-revalidation.json'),
      `${JSON.stringify(repair, null, 2)}\n`,
      'utf8',
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

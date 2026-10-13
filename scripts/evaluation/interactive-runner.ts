import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AIEnvironment } from '../../server/analysis/providers/ai-provider-config.js';
import { main as runEvaluation } from './evaluate-gameplay.js';
import {
  formatRepairEligibilityIssues,
  main as runRepair,
  preflightRepairSource,
} from './repair-gameplay.js';
import { loadEvaluationCorpus, selectCorpusMatchups } from './corpus.js';
import {
  EvaluationLauncherError,
  CURRENT_KNOWLEDGE_BASE_VERSION,
  assertCompatibleNodeVersion,
  assertLocalDependencies,
  assertMatchupExists,
  buildEvaluationArguments,
  buildRepairArguments,
  createRepairOutputPath,
  createRunOutputPath,
  discoverCorpusPath,
  discoverEvaluationRuns,
  discoverRepairRuns,
  formatEvaluationConfiguration,
  latestIncompleteRun,
  latestIncompleteRepairRun,
  loadLauncherConfig,
  preflightEvaluation,
  preflightKnowledgeCoverage,
  preflightMechanicalCoverage,
  readRunInfo,
  readRepairRunInfo,
  resolveResultsRoot,
  runSearchRoots,
  saveLauncherConfig,
  type EvaluationRunInfo,
  type LauncherConfig,
  type LauncherExecutionMode,
  type RepairRunInfo,
} from './launcher.js';

export interface MenuIO {
  question(prompt: string): Promise<string>;
  write(message: string): void;
  close(): void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function displayRun(io: MenuIO, run: EvaluationRunInfo): void {
  io.write(`\nRun : ${run.name}\n`);
  io.write(`Identifiant : ${run.runId}\n`);
  io.write(`Statut : ${run.isComplete ? 'terminé' : 'incomplet'}\n`);
  io.write(`Progression : ${run.completed} / ${run.total} (${run.remaining} restant(s))\n`);
  io.write(`Répétitions : ${run.repeat}\n`);
  io.write(`Succès : ${run.success} · Échecs techniques ou conformité : ${run.failed}\n`);
  io.write(`Corpus : ${run.corpusFile}\n`);
  io.write(`Provider / modèle : ${run.provider} / ${run.model}\n`);
  displayKnowledgeBase(io, run.knowledgeBaseVersion);
  io.write(`Début : ${formatDate(run.startedAt)}\n`);
  io.write(`Dernier état : ${formatDate(run.updatedAt)}\n`);
  io.write(`Résultats : ${run.resultsPath}\n`);
  io.write(`Summary : ${run.summaryPath}\n`);
}

function displayRepairRun(io: MenuIO, run: RepairRunInfo): void {
  io.write(`\nRepair : ${run.name}\n`);
  io.write(`Identifiant : ${run.runId}\n`);
  io.write(`Run source : ${run.sourceRunId}\n`);
  io.write(`Statut : ${run.isComplete ? 'terminé' : 'incomplet'}\n`);
  io.write(`Progression : ${run.completed} / ${run.total} (${run.remaining} restant(s))\n`);
  io.write(`Ignorées car non réparables : ${run.ineligible}\n`);
  io.write(`Succès : ${run.success} · Échecs : ${run.failed}\n`);
  io.write(`Passes maximum : ${run.maxRepairs}\n`);
  io.write(`Provider / modèle : ${run.provider} / ${run.model}\n`);
  io.write(`Début : ${formatDate(run.startedAt)}\n`);
  io.write(`Dernier état : ${formatDate(run.updatedAt)}\n`);
  io.write(`Résultats : ${run.resultsPath}\n`);
  io.write(`Summary : ${run.summaryPath}\n`);
}

function displayKnowledgeBase(io: MenuIO, version: string | null): void {
  if (version === null) {
    io.write('Knowledge Base : DÉSACTIVÉE — BASELINE PRÉ-KB\n');
    io.write('Version KB : aucune\n');
    return;
  }
  io.write('Knowledge Base : ACTIVÉE\n');
  io.write(`Version KB : ${version}\n`);
}

async function chooseKnowledgeBaseMode(io: MenuIO): Promise<string | null | undefined> {
  io.write('\nMode de connaissance\n\n');
  io.write('1. Baseline pré-KB — Knowledge Base désactivée\n');
  io.write(`2. Évaluation avec Knowledge Base — ${CURRENT_KNOWLEDGE_BASE_VERSION}\n`);
  io.write('0. Retour\n\n');
  const choice = (await io.question('Votre choix : ')).trim();
  return knowledgeBaseVersionForChoice(choice);
}

export function knowledgeBaseVersionForChoice(choice: string): string | null | undefined {
  if (choice.trim() === '0') return undefined;
  if (choice.trim() === '1') return null;
  if (choice.trim() === '2') return CURRENT_KNOWLEDGE_BASE_VERSION;
  throw new EvaluationLauncherError('Mode de connaissance invalide.');
}

export function repeatForInput(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) return 1;
  if (!/^\d+$/u.test(normalized)) {
    throw new EvaluationLauncherError('Le nombre de répétitions doit être un entier positif.');
  }
  const repeat = Number(normalized);
  if (!Number.isSafeInteger(repeat) || repeat < 1) {
    throw new EvaluationLauncherError('Le nombre de répétitions doit être un entier positif.');
  }
  return repeat;
}

export function repairPassesForChoice(choice: string): 0 | 1 | 2 {
  const normalized = choice.trim();
  if (normalized === '0') return 0;
  if (normalized === '1') return 1;
  if (normalized === '2') return 2;
  throw new EvaluationLauncherError('Choix du repair invalide.');
}

async function chooseRepairPasses(io: MenuIO): Promise<0 | 1 | 2> {
  io.write('\nRepair ciblé après génération\n\n');
  io.write('0. Désactivé\n');
  io.write('1. Une passe de repair maximum\n');
  io.write('2. Deux passes de repair maximum\n\n');
  return repairPassesForChoice(await io.question('Votre choix : '));
}

async function confirm(io: MenuIO, prompt: string): Promise<boolean> {
  const answer = (await io.question(`${prompt} [o/N] `)).trim().toLocaleLowerCase('fr-FR');
  return answer === 'o' || answer === 'oui' || answer === 'y' || answer === 'yes';
}

async function ensureCorpusPath(
  io: MenuIO,
  workingDirectory: string,
  config: LauncherConfig,
): Promise<{ readonly path: string; readonly config: LauncherConfig }> {
  let candidate = await discoverCorpusPath({
    workingDirectory,
    environment: process.env,
    config,
  });
  while (true) {
    if (candidate !== undefined) {
      try {
        await loadEvaluationCorpus(candidate);
        const next = { ...config, corpusPath: candidate };
        await saveLauncherConfig(workingDirectory, next);
        return { path: candidate, config: next };
      } catch (error) {
        io.write(`\n${error instanceof Error ? error.message : 'Corpus invalide.'}\n`);
      }
    }
    const entered = (await io.question('Chemin complet du corpus JSON : ')).trim().replace(/^"|"$/gu, '');
    if (entered.length === 0) throw new EvaluationLauncherError('Aucun corpus sélectionné.');
    candidate = resolve(entered);
  }
}

async function allRuns(
  corpusPath: string | undefined,
  resultsRoot: string,
): Promise<readonly EvaluationRunInfo[]> {
  return discoverEvaluationRuns(runSearchRoots({ corpusPath, resultsRoot }));
}

async function allRepairRuns(
  corpusPath: string | undefined,
  resultsRoot: string,
): Promise<readonly RepairRunInfo[]> {
  return discoverRepairRuns(runSearchRoots({ corpusPath, resultsRoot }));
}

export async function launchNewEvaluation(options: {
  readonly io: MenuIO;
  readonly workingDirectory: string;
  readonly config: LauncherConfig;
  readonly mode: Exclude<LauncherExecutionMode, 'resume'>;
  readonly environment?: AIEnvironment;
  readonly executeEvaluation?: typeof runEvaluation;
  readonly executeRepair?: typeof runRepair;
}): Promise<LauncherConfig> {
  const corpus = await ensureCorpusPath(options.io, options.workingDirectory, options.config);
  const resultsRoot = resolveResultsRoot({
    workingDirectory: options.workingDirectory,
    environment: process.env,
    config: corpus.config,
  });
  let matchupId: string | undefined;
  if (options.mode === 'single') {
    matchupId = await assertMatchupExists(
      corpus.path,
      await options.io.question('ID du matchup (ex. LLC-009) : '),
    );
  }
  const knowledgeBaseVersion = await chooseKnowledgeBaseMode(options.io);
  if (knowledgeBaseVersion === undefined) return corpus.config;
  const repeat = repeatForInput(await options.io.question('Répétitions expérimentales [1] : '));
  const repairPasses = await chooseRepairPasses(options.io);
  const loadedCorpus = await loadEvaluationCorpus(corpus.path);
  const selection = selectCorpusMatchups(loadedCorpus.corpus, {
    sentinels: options.mode === 'sentinels',
    ...(matchupId === undefined ? {} : { id: matchupId }),
  });
  const mechanicalCoverage = await preflightMechanicalCoverage(corpus.path);
  const outputDirectory = await createRunOutputPath({ resultsRoot, knowledgeBaseVersion });
  const repairOutputDirectory = repairPasses === 0 ? undefined : await createRepairOutputPath({
    resultsRoot,
    maxRepairs: repairPasses,
  });
  const provider = await preflightEvaluation({
    workingDirectory: options.workingDirectory,
    corpusPath: corpus.path,
    outputDirectory,
    environment: options.environment ?? process.env,
    knowledgeBaseVersion,
  });
  const coverage = knowledgeBaseVersion === null ? undefined : await preflightKnowledgeCoverage({
    corpusPath: corpus.path,
    mode: options.mode,
    ...(matchupId === undefined ? {} : { matchupId }),
    knowledgeBaseVersion,
  });
  options.io.write(`\n${formatEvaluationConfiguration({
    corpusFile: basename(corpus.path),
    mode: options.mode,
    provider: provider.provider,
    model: provider.model,
    knowledgeBaseVersion,
    repeat,
    selectedMatchups: selection.matchups.length,
    outputDirectory,
    repairPasses,
    ...(repairOutputDirectory === undefined ? {} : { repairOutputDirectory }),
    ...(mechanicalCoverage === undefined ? {} : { mechanicalCoverage }),
    ...(coverage === undefined ? {} : { coverage }),
  })}`);
  if (!(await confirm(options.io, 'Confirmer le lancement ?'))) return corpus.config;
  options.io.write('Statut : running\n\n');
  const args = buildEvaluationArguments({
    mode: options.mode,
    corpusPath: corpus.path,
    outputDirectory,
    ...(matchupId === undefined ? {} : { matchupId }),
    knowledgeBaseVersion,
    repeat,
  });
  try {
    await (options.executeEvaluation ?? runEvaluation)(args);
  } catch (error) {
    options.io.write(`\nRun interrompu. Dossier conservé : ${outputDirectory}\n`);
    try {
      displayRun(options.io, await readRunInfo(outputDirectory));
      options.io.write('Relancez le launcher puis choisissez la reprise du dernier run incomplet.\n');
    } catch {
      options.io.write('Aucun snapshot de run n’a été créé.\n');
    }
    throw error;
  }
  displayRun(options.io, await readRunInfo(outputDirectory));
  if (repairPasses !== 0 && repairOutputDirectory !== undefined) {
    const repairPreflight = await preflightRepairSource(outputDirectory);
    if (repairPreflight.issues.length > 0) {
      options.io.write(`\n${repairPreflight.issues.length} analyse(s) non réparable(s) seront ignorée(s) :\n`);
      options.io.write(`${formatRepairEligibilityIssues(repairPreflight.issues)}\n`);
    }
    if (repairPreflight.repairable.length === 0) {
      options.io.write('\nRepair non nécessaire : aucune analyse invalide réparable.\n');
    } else {
      options.io.write(`\nDémarrage du repair ciblé : ${repairPreflight.repairable.length} analyse(s), ${repairPasses} passe(s) maximum.\n`);
      try {
        await (options.executeRepair ?? runRepair)(buildRepairArguments({
          sourceDirectory: outputDirectory,
          outputDirectory: repairOutputDirectory,
          maxRepairs: repairPasses,
        }));
      } catch (error) {
        options.io.write(`\nRepair interrompu. Le run initial reste terminé : ${outputDirectory}\n`);
        options.io.write(`Dossier du repair : ${repairOutputDirectory}\n`);
        throw error;
      }
      displayRepairRun(options.io, await readRepairRunInfo(repairOutputDirectory));
    }
  }
  const next = { ...corpus.config, resultsRoot };
  await saveLauncherConfig(options.workingDirectory, next);
  return next;
}

async function resumeRun(options: {
  readonly io: MenuIO;
  readonly workingDirectory: string;
  readonly config: LauncherConfig;
  readonly run: EvaluationRunInfo;
}): Promise<LauncherConfig> {
  if (options.run.isComplete) {
    options.io.write('\nCe run est déjà terminé et ne peut pas être repris.\n');
    return options.config;
  }
  const corpus = await ensureCorpusPath(options.io, options.workingDirectory, options.config);
  displayRun(options.io, options.run);
  const provider = await preflightEvaluation({
    workingDirectory: options.workingDirectory,
    corpusPath: corpus.path,
    resumeDirectory: options.run.directory,
    environment: process.env,
    knowledgeBaseVersion: options.run.knowledgeBaseVersion,
  });
  options.io.write(`Provider : ${provider.provider} · Modèle : ${provider.model}\n`);
  if (!(await confirm(options.io, 'Reprendre ce run avec cette configuration immuable ?'))) return corpus.config;
  options.io.write('Statut : running\n\n');
  try {
    await runEvaluation(buildEvaluationArguments({
      mode: 'resume',
      corpusPath: corpus.path,
      resumeDirectory: options.run.directory,
      knowledgeBaseVersion: options.run.knowledgeBaseVersion,
    }));
  } catch (error) {
    options.io.write(`\nReprise interrompue. Dossier conservé : ${options.run.directory}\n`);
    displayRun(options.io, await readRunInfo(options.run.directory));
    options.io.write('Relancez le launcher puis choisissez la reprise du dernier run incomplet.\n');
    throw error;
  }
  displayRun(options.io, await readRunInfo(options.run.directory));
  return corpus.config;
}

async function chooseRun(io: MenuIO, runs: readonly EvaluationRunInfo[]): Promise<EvaluationRunInfo | undefined> {
  if (runs.length === 0) {
    io.write('\nAucun run exploitable trouvé.\n');
    return undefined;
  }
  io.write('\nÉvaluations disponibles :\n');
  runs.forEach((run, index) => {
    const kb = run.knowledgeBaseVersion === null ? 'pré-KB' : `KB ${run.knowledgeBaseVersion}`;
    io.write(`${index + 1}. ${run.name} — ${kb} — ${run.completed}/${run.total} — ${run.isComplete ? 'terminé' : 'incomplet'}\n`);
  });
  const raw = (await io.question('Numéro du run (Entrée pour annuler) : ')).trim();
  if (raw.length === 0) return undefined;
  const selected = Number(raw);
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > runs.length) {
    throw new EvaluationLauncherError('Sélection de run invalide.');
  }
  return runs[selected - 1];
}

const EVALUATION_RUN_ARTIFACTS = new Set(['run.json', 'results.json', 'summary.json']);

export function runDirectoryForInput(value: string, workingDirectory = process.cwd()): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const candidate = resolve(workingDirectory, unquoted);
  return EVALUATION_RUN_ARTIFACTS.has(basename(candidate).toLocaleLowerCase('en-US'))
    ? dirname(candidate)
    : candidate;
}

async function chooseRepairSourceRun(
  io: MenuIO,
  runs: readonly EvaluationRunInfo[],
  workingDirectory: string,
): Promise<EvaluationRunInfo | undefined> {
  let enteredPath: string;
  if (runs.length === 0) {
    io.write('\nAucun run découvert automatiquement.\n');
    enteredPath = await io.question(
      'Chemin du dossier de run, de run.json, results.json ou summary.json (Entrée pour annuler) : ',
    );
  } else {
    io.write('\nÉvaluations terminées disponibles :\n');
    runs.forEach((run, index) => {
      const kb = run.knowledgeBaseVersion === null ? 'pré-KB' : `KB ${run.knowledgeBaseVersion}`;
      io.write(`${index + 1}. ${run.name} — ${kb} — ${run.completed}/${run.total}\n`);
    });
    io.write('P. Saisir un chemin manuellement\n');
    const choice = (await io.question(
      'Numéro du run, chemin complet ou P (Entrée pour annuler) : ',
    )).trim();
    if (choice.length === 0) return undefined;
    if (/^\d+$/u.test(choice)) {
      const selected = Number(choice);
      if (!Number.isSafeInteger(selected) || selected < 1 || selected > runs.length) {
        throw new EvaluationLauncherError('Sélection de run invalide.');
      }
      return runs[selected - 1];
    }
    enteredPath = choice.toLocaleLowerCase('fr-FR') === 'p'
      ? await io.question(
        'Chemin du dossier de run, de run.json, results.json ou summary.json (Entrée pour annuler) : ',
      )
      : choice;
  }

  const directory = runDirectoryForInput(enteredPath, workingDirectory);
  if (directory === undefined) return undefined;
  try {
    return await readRunInfo(directory);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'format de run invalide';
    throw new EvaluationLauncherError(`Run inexploitable à l’emplacement ${directory} : ${detail}`);
  }
}

async function launchRepairForExistingRun(options: {
  readonly io: MenuIO;
  readonly resultsRoot: string;
  readonly run: EvaluationRunInfo;
  readonly executeRepair?: typeof runRepair;
}): Promise<void> {
  if (!options.run.isComplete) {
    throw new EvaluationLauncherError('Le run source doit être terminé avant le repair.');
  }
  displayRun(options.io, options.run);
  const passes = await chooseRepairPasses(options.io);
  if (passes === 0) return;
  const preflight = await preflightRepairSource(options.run.directory);
  if (preflight.repairable.length === 0) {
    options.io.write('\nAucune analyse invalide réparable dans ce run.\n');
    return;
  }
  const outputDirectory = await createRepairOutputPath({
    resultsRoot: options.resultsRoot,
    maxRepairs: passes,
  });
  options.io.write('\nConfiguration du repair\n\n');
  options.io.write(`Run source       : ${options.run.name}\n`);
  options.io.write(`Analyses invalides : ${preflight.invalid}\n`);
  options.io.write(`Analyses réparables : ${preflight.repairable.length}\n`);
  options.io.write(`Analyses ignorées   : ${preflight.issues.length}\n`);
  if (preflight.issues.length > 0) {
    options.io.write(`${formatRepairEligibilityIssues(preflight.issues)}\n`);
  }
  options.io.write(`Passes maximum   : ${passes}\n`);
  options.io.write(`Appels maximum   : ${preflight.repairable.length * passes * 3}\n`);
  options.io.write(`Résultats repair : ${outputDirectory}\n`);
  if (!(await confirm(options.io, 'Confirmer le repair ?'))) return;
  await (options.executeRepair ?? runRepair)(buildRepairArguments({
    sourceDirectory: options.run.directory,
    outputDirectory,
    maxRepairs: passes,
  }));
  displayRepairRun(options.io, await readRepairRunInfo(outputDirectory));
}

async function resumeRepair(options: {
  readonly io: MenuIO;
  readonly repair: RepairRunInfo;
  readonly sourceRuns: readonly EvaluationRunInfo[];
  readonly executeRepair?: typeof runRepair;
}): Promise<void> {
  if (options.repair.isComplete) {
    options.io.write('\nCe repair est déjà terminé et ne peut pas être repris.\n');
    return;
  }
  const source = options.sourceRuns.find(({ runId }) => runId === options.repair.sourceRunId);
  if (source === undefined) {
    throw new EvaluationLauncherError(`Run source introuvable pour le repair ${options.repair.name}.`);
  }
  await preflightRepairSource(source.directory);
  displayRepairRun(options.io, options.repair);
  if (!(await confirm(options.io, 'Reprendre ce repair avec sa configuration immuable ?'))) return;
  await (options.executeRepair ?? runRepair)(buildRepairArguments({
    sourceDirectory: source.directory,
    resumeDirectory: options.repair.directory,
  }));
  displayRepairRun(options.io, await readRepairRunInfo(options.repair.directory));
}

function menu(io: MenuIO): void {
  io.write('\nLaneLens — Gameplay Evaluation Runner\n\n');
  io.write('1. Démarrer une nouvelle évaluation complète\n');
  io.write('2. Reprendre la dernière évaluation incomplète\n');
  io.write('3. Choisir une évaluation existante à reprendre\n');
  io.write('4. Lancer uniquement les sentinelles\n');
  io.write('5. Lancer un matchup précis\n');
  io.write('6. Afficher les informations du dernier run\n');
  io.write('7. Réparer un run terminé\n');
  io.write('8. Reprendre le dernier repair incomplet\n');
  io.write('0. Quitter\n\n');
}

export async function interactiveMain(io: MenuIO, workingDirectory: string): Promise<void> {
  let config = await loadLauncherConfig(workingDirectory);
  while (true) {
    menu(io);
    const choice = (await io.question('Votre choix : ')).trim();
    if (choice === '0') return;
    try {
      const knownCorpus = await discoverCorpusPath({ workingDirectory, environment: process.env, config });
      const resultsRoot = resolveResultsRoot({ workingDirectory, environment: process.env, config });
      if (choice === '1' || choice === '4' || choice === '5') {
        config = await launchNewEvaluation({
          io,
          workingDirectory,
          config,
          mode: choice === '1' ? 'full' : choice === '4' ? 'sentinels' : 'single',
        });
      } else if (choice === '2') {
        const run = latestIncompleteRun(await allRuns(knownCorpus, resultsRoot));
        if (run === undefined) io.write('\nAucun run incomplet trouvé.\n');
        else config = await resumeRun({ io, workingDirectory, config, run });
      } else if (choice === '3') {
        const run = await chooseRun(io, await allRuns(knownCorpus, resultsRoot));
        if (run !== undefined) config = await resumeRun({ io, workingDirectory, config, run });
      } else if (choice === '6') {
        const [latest] = await allRuns(knownCorpus, resultsRoot);
        if (latest === undefined) io.write('\nAucun run trouvé.\n');
        else displayRun(io, latest);
      } else if (choice === '7') {
        const run = await chooseRepairSourceRun(
          io,
          (await allRuns(knownCorpus, resultsRoot)).filter(({ isComplete }) => isComplete),
          workingDirectory,
        );
        if (run !== undefined) await launchRepairForExistingRun({ io, resultsRoot, run });
      } else if (choice === '8') {
        const repair = latestIncompleteRepairRun(await allRepairRuns(knownCorpus, resultsRoot));
        if (repair === undefined) io.write('\nAucun repair incomplet trouvé.\n');
        else await resumeRepair({
          io,
          repair,
          sourceRuns: await allRuns(knownCorpus, resultsRoot),
        });
      } else {
        io.write('\nChoix invalide. Sélectionnez un numéro du menu.\n');
      }
    } catch (error) {
      io.write('\nImpossible d’exécuter l’opération :\n');
      io.write(`${error instanceof Error ? error.message : 'Erreur inconnue.'}\n`);
    }
    await io.question('\nAppuyez sur Entrée pour revenir au menu...');
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--smoke')) {
    assertCompatibleNodeVersion(process.versions.node);
    stdout.write('LaneLens evaluation launcher smoke check: OK\n');
    return;
  }
  assertCompatibleNodeVersion(process.versions.node);
  await assertLocalDependencies(process.cwd());
  const readline = createInterface({ input: stdin, output: stdout });
  const io: MenuIO = {
    question: (prompt) => readline.question(prompt),
    write: (message) => { stdout.write(message); },
    close: () => readline.close(),
  };
  try {
    await interactiveMain(io, process.cwd());
  } finally {
    io.close();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  main().catch((error: unknown) => {
    stdout.write('\nImpossible de démarrer le launcher :\n');
    stdout.write(`${error instanceof Error ? error.message : 'Erreur inconnue.'}\n`);
    process.exitCode = 1;
  });
}

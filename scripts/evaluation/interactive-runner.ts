import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as runEvaluation } from './evaluate-gameplay.js';
import { loadEvaluationCorpus } from './corpus.js';
import {
  EvaluationLauncherError,
  assertCompatibleNodeVersion,
  assertLocalDependencies,
  assertMatchupExists,
  buildEvaluationArguments,
  createRunOutputPath,
  discoverCorpusPath,
  discoverEvaluationRuns,
  latestIncompleteRun,
  loadLauncherConfig,
  preflightEvaluation,
  readRunInfo,
  resolveResultsRoot,
  runSearchRoots,
  saveLauncherConfig,
  type EvaluationRunInfo,
  type LauncherConfig,
  type LauncherExecutionMode,
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
  io.write(`Succès : ${run.success} · Échecs techniques ou conformité : ${run.failed}\n`);
  io.write(`Corpus : ${run.corpusFile}\n`);
  io.write(`Provider / modèle : ${run.provider} / ${run.model}\n`);
  io.write(`Début : ${formatDate(run.startedAt)}\n`);
  io.write(`Dernier état : ${formatDate(run.updatedAt)}\n`);
  io.write(`Résultats : ${run.resultsPath}\n`);
  io.write(`Summary : ${run.summaryPath}\n`);
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

async function launchNewEvaluation(options: {
  readonly io: MenuIO;
  readonly workingDirectory: string;
  readonly config: LauncherConfig;
  readonly mode: Exclude<LauncherExecutionMode, 'resume'>;
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
  const outputDirectory = await createRunOutputPath({ resultsRoot });
  options.io.write(`\nCorpus : ${corpus.path}\n`);
  options.io.write(`Nouveau run : ${outputDirectory}\n`);
  if (!(await confirm(options.io, 'Lancer cette évaluation ?'))) return corpus.config;

  const provider = await preflightEvaluation({
    workingDirectory: options.workingDirectory,
    corpusPath: corpus.path,
    outputDirectory,
    environment: process.env,
  });
  options.io.write(`Provider : ${provider.provider} · Modèle : ${provider.model}\n`);
  options.io.write('Statut : running\n\n');
  const args = buildEvaluationArguments({
    mode: options.mode,
    corpusPath: corpus.path,
    outputDirectory,
    ...(matchupId === undefined ? {} : { matchupId }),
  });
  try {
    await runEvaluation(args);
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
  if (!(await confirm(options.io, 'Reprendre ce run ?'))) return corpus.config;
  const provider = await preflightEvaluation({
    workingDirectory: options.workingDirectory,
    corpusPath: corpus.path,
    resumeDirectory: options.run.directory,
    environment: process.env,
  });
  options.io.write(`Provider : ${provider.provider} · Modèle : ${provider.model}\n`);
  options.io.write('Statut : running\n\n');
  try {
    await runEvaluation(buildEvaluationArguments({
      mode: 'resume',
      corpusPath: corpus.path,
      resumeDirectory: options.run.directory,
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
    io.write(`${index + 1}. ${run.name} — ${run.completed}/${run.total} — ${run.isComplete ? 'terminé' : 'incomplet'}\n`);
  });
  const raw = (await io.question('Numéro du run (Entrée pour annuler) : ')).trim();
  if (raw.length === 0) return undefined;
  const selected = Number(raw);
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > runs.length) {
    throw new EvaluationLauncherError('Sélection de run invalide.');
  }
  return runs[selected - 1];
}

function menu(io: MenuIO): void {
  io.write('\nLaneLens — Gameplay Evaluation Runner\n\n');
  io.write('1. Démarrer une nouvelle évaluation complète\n');
  io.write('2. Reprendre la dernière évaluation incomplète\n');
  io.write('3. Choisir une évaluation existante à reprendre\n');
  io.write('4. Lancer uniquement les sentinelles\n');
  io.write('5. Lancer un matchup précis\n');
  io.write('6. Afficher les informations du dernier run\n');
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
      } else {
        io.write('\nChoix invalide. Sélectionnez un numéro du menu.\n');
      }
    } catch (error) {
      io.write('\nImpossible de lancer l’évaluation :\n');
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

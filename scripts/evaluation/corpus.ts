import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { CorpusMatchup, EvaluationCorpus, EvaluationMode } from './types.js';

export class EvaluationCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationCorpusError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EvaluationCorpusError(`Corpus invalide : ${path} doit être une chaîne non vide.`);
  }
  return value.trim();
}

function parseDuo(value: unknown, path: string) {
  if (!isRecord(value)) throw new EvaluationCorpusError(`Corpus invalide : ${path} est requis.`);
  return Object.freeze({
    carry: requiredString(value.carry, `${path}.carry`),
    support: requiredString(value.support, `${path}.support`),
  });
}

function parseMatchup(value: unknown, index: number): CorpusMatchup {
  const path = `matchups[${index}]`;
  if (!isRecord(value)) throw new EvaluationCorpusError(`Corpus invalide : ${path} doit être un objet.`);
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)) {
    throw new EvaluationCorpusError(`Corpus invalide : ${path}.tags doit être un tableau de chaînes.`);
  }
  if (typeof value.sentinel !== 'boolean') {
    throw new EvaluationCorpusError(`Corpus invalide : ${path}.sentinel doit être un booléen.`);
  }
  return Object.freeze({
    id: requiredString(value.id, `${path}.id`),
    patch: requiredString(value.patch, `${path}.patch`),
    ally: parseDuo(value.ally, `${path}.ally`),
    enemy: parseDuo(value.enemy, `${path}.enemy`),
    tags: Object.freeze(value.tags.map((tag) => tag.trim())),
    sentinel: value.sentinel,
    ...(value.sentinelRationale === undefined ? {} : {
      sentinelRationale: requiredString(value.sentinelRationale, `${path}.sentinelRationale`),
    }),
  });
}

export function parseEvaluationCorpus(raw: string): EvaluationCorpus {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new EvaluationCorpusError('Corpus invalide : le fichier ne contient pas un JSON valide.');
  }
  if (!isRecord(value)) throw new EvaluationCorpusError('Corpus invalide : la racine doit être un objet.');
  if (value.schemaVersion !== 1) {
    throw new EvaluationCorpusError('Corpus invalide : schemaVersion doit valoir 1.');
  }
  const corpusVersion = requiredString(value.corpusVersion, 'corpusVersion');
  if (!/^\d+\.\d+\.\d+$/u.test(corpusVersion)) {
    throw new EvaluationCorpusError('Corpus invalide : corpusVersion doit être une version sémantique.');
  }
  if (typeof value.frozen !== 'boolean') {
    throw new EvaluationCorpusError('Corpus invalide : frozen doit être un booléen.');
  }
  if (!Array.isArray(value.matchups) || value.matchups.length === 0) {
    throw new EvaluationCorpusError('Corpus invalide : matchups doit être un tableau non vide.');
  }
  const patch = requiredString(value.patch, 'patch');
  const matchups = value.matchups.map(parseMatchup);
  const fullCoverageGate = isRecord(value.rules) && value.rules.fullCoverageGate !== undefined
    ? requiredString(value.rules.fullCoverageGate, 'rules.fullCoverageGate')
    : undefined;
  const ids = new Set<string>();
  for (const matchup of matchups) {
    if (ids.has(matchup.id)) throw new EvaluationCorpusError(`Corpus invalide : ID dupliqué ${matchup.id}.`);
    if (matchup.patch !== patch) {
      throw new EvaluationCorpusError(`Corpus invalide : ${matchup.id} utilise un patch différent du corpus.`);
    }
    ids.add(matchup.id);
  }
  if (isRecord(value.rules)) {
    const expectedMatchups = value.rules.expectedMatchups;
    const expectedSentinels = value.rules.expectedSentinels;
    if (expectedMatchups !== undefined && expectedMatchups !== matchups.length) {
      throw new EvaluationCorpusError('Corpus invalide : le nombre de matchups ne correspond pas à rules.expectedMatchups.');
    }
    const sentinelCount = matchups.filter(({ sentinel }) => sentinel).length;
    if (expectedSentinels !== undefined && expectedSentinels !== sentinelCount) {
      throw new EvaluationCorpusError('Corpus invalide : le nombre de sentinelles ne correspond pas à rules.expectedSentinels.');
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    corpusVersion,
    patch,
    frozen: value.frozen,
    ...(fullCoverageGate === undefined ? {} : { fullCoverageGate }),
    matchups: Object.freeze(matchups),
  });
}

export async function loadEvaluationCorpus(path: string): Promise<{
  readonly corpus: EvaluationCorpus;
  readonly sha256: string;
  readonly file: string;
}> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new EvaluationCorpusError(`Corpus introuvable ou illisible : ${path}`);
  }
  return {
    corpus: parseEvaluationCorpus(raw),
    sha256: createHash('sha256').update(raw).digest('hex'),
    file: basename(path),
  };
}

export function selectCorpusMatchups(
  corpus: EvaluationCorpus,
  selection: { readonly sentinels: boolean; readonly id?: string },
): { readonly mode: EvaluationMode; readonly matchups: readonly CorpusMatchup[] } {
  if (selection.sentinels && selection.id !== undefined) {
    throw new EvaluationCorpusError('--sentinels et --id ne peuvent pas être combinés.');
  }
  if (selection.id !== undefined) {
    const matchup = corpus.matchups.find(({ id }) => id === selection.id);
    if (matchup === undefined) throw new EvaluationCorpusError(`ID de matchup inexistant : ${selection.id}`);
    return { mode: 'single', matchups: [matchup] };
  }
  if (selection.sentinels) {
    return { mode: 'sentinels', matchups: corpus.matchups.filter(({ sentinel }) => sentinel) };
  }
  return { mode: 'full', matchups: corpus.matchups };
}

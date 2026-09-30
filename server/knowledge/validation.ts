import { ABILITY_SLOTS } from '../gameplay-context/types.js';
import type { DerivationRule, KnowledgeEntry } from './types.js';

export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeValidationError';
  }
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validPatch(value: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?$/u.test(value);
}

function assertEntryShape(entry: KnowledgeEntry): void {
  if (!nonBlank(entry.id) || !nonBlank(entry.subject) || !nonBlank(entry.statement)) {
    throw new KnowledgeValidationError('Knowledge ids, subjects and statements must be non-blank.');
  }
  if (entry.championKeys.some((key) => !nonBlank(key)) || entry.tags.some((tag) => !nonBlank(tag))) {
    throw new KnowledgeValidationError(`Knowledge ${entry.id} contains a blank champion key or tag.`);
  }
  if (entry.sources.length === 0 || entry.sources.some((source) => !nonBlank(source.name))) {
    throw new KnowledgeValidationError(`Knowledge ${entry.id} must retain at least one named source.`);
  }
  if (entry.sources.some(({ url }) => url !== undefined && !/^https?:\/\//u.test(url))) {
    throw new KnowledgeValidationError(`Knowledge ${entry.id} contains a non-HTTP source URL.`);
  }
  if (entry.scope === 'patch-dependent' && entry.patch === undefined) {
    throw new KnowledgeValidationError(`Patch-dependent knowledge ${entry.id} requires patch validity.`);
  }
  if (entry.scope === 'structural' && entry.patch !== undefined) {
    throw new KnowledgeValidationError(`Structural knowledge ${entry.id} cannot declare patch validity.`);
  }
  if (entry.patch !== undefined && (
    !validPatch(entry.patch.from)
    || (entry.patch.to !== undefined && !validPatch(entry.patch.to))
  )) {
    throw new KnowledgeValidationError(`Knowledge ${entry.id} contains invalid patch validity.`);
  }
  if (entry.patch?.to !== undefined) {
    const from = entry.patch.from.split('.').map(Number);
    const to = entry.patch.to.split('.').map(Number);
    const order = from.findIndex((part, index) => part !== (to[index] ?? 0));
    if (order >= 0 && from[order]! > (to[order] ?? 0)) {
      throw new KnowledgeValidationError(`Knowledge ${entry.id} has an inverted patch range.`);
    }
  }
  if (entry.abilitySlots?.some((slot) => !ABILITY_SLOTS.includes(slot)) === true) {
    throw new KnowledgeValidationError(`Knowledge ${entry.id} contains an invalid ability slot.`);
  }
}

export function assertValidKnowledgeDataset(
  entries: readonly KnowledgeEntry[],
  rules: readonly DerivationRule[],
): void {
  const byId = new Map<string, KnowledgeEntry>();
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  for (const entry of entries) {
    assertEntryShape(entry);
    if (byId.has(entry.id)) throw new KnowledgeValidationError(`Duplicate knowledge id: ${entry.id}.`);
    byId.set(entry.id, entry);
  }

  for (const entry of entries) {
    if (entry.type === 'derived_fact') {
      if (entry.derivedFrom?.length === 0 || entry.derivedFrom === undefined || !nonBlank(entry.derivationRuleId ?? '')) {
        throw new KnowledgeValidationError(`Derived knowledge ${entry.id} requires sources and a rule.`);
      }
      if (entry.derivedFrom.some((id) => !byId.has(id))) {
        throw new KnowledgeValidationError(`Derived knowledge ${entry.id} contains an unknown dependency.`);
      }
    }
    if (
      entry.sources.some(({ type }) => type === 'llm')
      && entry.status === 'verified'
      && entry.verification !== 'human'
    ) {
      throw new KnowledgeValidationError(`LLM knowledge ${entry.id} requires human verification.`);
    }
    if (entry.status !== 'verified') continue;
    if (entry.verification === 'pending') {
      throw new KnowledgeValidationError(`Verified knowledge ${entry.id} cannot have pending verification.`);
    }
    if (
      (entry.type === 'heuristic' || entry.type === 'matchup_observation')
      && entry.verification !== 'human'
    ) {
      throw new KnowledgeValidationError(`${entry.type} ${entry.id} requires human verification.`);
    }
    if (entry.verification !== 'automatic') continue;
    if (entry.type === 'official_fact') {
      if (!entry.sources.some(({ type }) => type === 'riot')) {
        throw new KnowledgeValidationError(`Automatically verified official fact ${entry.id} requires a Riot source.`);
      }
      continue;
    }
    if (entry.type === 'derived_fact') {
      const dependencies = entry.derivedFrom?.map((id) => byId.get(id)!) ?? [];
      const rule = ruleById.get(entry.derivationRuleId ?? '');
      if (dependencies.some(({ status }) => status !== 'verified') || rule?.validated !== true) {
        throw new KnowledgeValidationError(`Automatically verified derived fact ${entry.id} has unverified inputs.`);
      }
      continue;
    }
    throw new KnowledgeValidationError(`Knowledge ${entry.id} cannot use automatic verification.`);
  }
}

export function canPromoteKnowledge(
  entry: KnowledgeEntry,
  entries: readonly KnowledgeEntry[],
  rules: readonly DerivationRule[],
): boolean {
  try {
    assertValidKnowledgeDataset(
      entries.map((candidate) => candidate.id === entry.id
        ? { ...entry, status: 'verified' as const }
        : candidate),
      rules,
    );
    return true;
  } catch {
    return false;
  }
}

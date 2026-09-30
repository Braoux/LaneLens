import type { KnowledgeRepository } from './KnowledgeRepository.js';
import type { DerivationRule, KnowledgeEntry } from './types.js';
import { assertValidKnowledgeDataset } from './validation.js';
import { DERIVATION_RULES } from './data/derivation-rules.js';
import { KNOWLEDGE_BASE_VERSION, KNOWLEDGE_ENTRIES } from './data/knowledge.js';

export class StaticKnowledgeRepository implements KnowledgeRepository {
  readonly version: string;
  private readonly dataset: readonly KnowledgeEntry[];

  constructor(
    entries: readonly KnowledgeEntry[] = KNOWLEDGE_ENTRIES,
    version = KNOWLEDGE_BASE_VERSION,
    rules: readonly DerivationRule[] = DERIVATION_RULES,
  ) {
    assertValidKnowledgeDataset(entries, rules);
    this.version = version;
    this.dataset = Object.freeze([...entries]);
  }

  entries(): readonly KnowledgeEntry[] {
    return this.dataset;
  }
}

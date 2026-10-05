import type { KnowledgeEntry } from './types.js';

export interface KnowledgeRepository {
  readonly version: string;
  entries(): readonly KnowledgeEntry[];
}

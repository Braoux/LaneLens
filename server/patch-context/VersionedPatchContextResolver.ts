import type { PatchContext } from '../analysis/types.js';
import { isValidPatchContext } from '../analysis/validation.js';
import type {
  PatchContextResolution,
  PatchContextResolver,
} from './PatchContextResolver.js';
import { PATCH_CONTEXTS } from './data/contexts.js';

export class VersionedPatchContextError extends Error {
  constructor() {
    super('Les contextes de patch versionnés sont invalides.');
    this.name = 'VersionedPatchContextError';
  }
}

function cloneContext(context: PatchContext): PatchContext {
  return {
    patch: context.patch,
    contextVersion: context.contextVersion,
    facts: context.facts.map((fact) => ({
      subject: fact.subject,
      text: fact.text,
    })),
  };
}

export class VersionedPatchContextResolver implements PatchContextResolver {
  private readonly contexts: ReadonlyMap<string, PatchContext>;

  constructor(contexts: readonly PatchContext[] = PATCH_CONTEXTS) {
    const indexedContexts = new Map<string, PatchContext>();

    for (const context of contexts) {
      if (!isValidPatchContext(context)) throw new VersionedPatchContextError();

      const normalizedPatch = context.patch.trim();
      if (indexedContexts.has(normalizedPatch)) throw new VersionedPatchContextError();
      indexedContexts.set(normalizedPatch, cloneContext(context));
    }

    this.contexts = indexedContexts;
  }

  async resolve(patch: string): Promise<PatchContextResolution> {
    const context = this.contexts.get(patch.trim());
    if (context === undefined) return { status: 'not-found' };

    return {
      status: 'ready',
      context: cloneContext(context),
    };
  }
}

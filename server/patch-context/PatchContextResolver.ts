import type { PatchContext } from '../analysis/types.js';

export type PatchContextResolution =
  | {
      readonly status: 'ready';
      readonly context: PatchContext;
    }
  | {
      readonly status: 'not-found';
    }
  | {
      readonly status: 'unavailable';
    };

export interface PatchContextResolver {
  resolve(patch: string): Promise<PatchContextResolution>;
}

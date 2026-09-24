import { loadChampionCatalog } from './champions';
import type { CatalogResult } from './champions';

export type CatalogState = { readonly status: 'idle' | 'loading' } | CatalogResult;
let state: CatalogState = { status: 'idle' };
let pending: Promise<CatalogResult> | undefined;

export function getChampionCatalogState(): CatalogState {
  return state;
}

/** Called at startup; future components can await the same promise without refetching. */
export function initializeChampionCatalog(): Promise<CatalogResult> {
  if (!pending) {
    state = { status: 'loading' };
    pending = loadChampionCatalog().then((result) => {
      state = result;
      return result;
    });
  }
  return pending;
}

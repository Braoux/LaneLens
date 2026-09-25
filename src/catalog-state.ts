import { loadChampionCatalog } from './champions';
import type { CatalogResult } from './champions';
import { DEFAULT_LOCALE } from '../shared/locale';
import type { AppLocale } from '../shared/locale';

export type CatalogState = { readonly status: 'idle' | 'loading' } | CatalogResult;
const states = new Map<AppLocale, CatalogState>();
const pending = new Map<AppLocale, Promise<CatalogResult>>();

export function getChampionCatalogState(locale: AppLocale = DEFAULT_LOCALE): CatalogState {
  return states.get(locale) ?? { status: 'idle' };
}

/** Called at startup; future components can await the same promise without refetching. */
export function initializeChampionCatalog(locale: AppLocale = DEFAULT_LOCALE): Promise<CatalogResult> {
  let task = pending.get(locale);
  if (!task) {
    states.set(locale, { status: 'loading' });
    task = loadChampionCatalog({ locale }).then((result) => {
      states.set(locale, result);
      return result;
    });
    pending.set(locale, task);
  }
  return task;
}

import { browserStorage, readJson, writeJson } from './storage';
import type { LocalStore } from './storage';
import { DEFAULT_LOCALE } from '../shared/locale';
import type { AppLocale } from '../shared/locale';

const BASE = 'https://ddragon.leagueoflegends.com';
export const VERSIONS_URL = `${BASE}/api/versions.json`;

const DATA_DRAGON_LOCALES: Record<AppLocale, string> = {
  'fr-FR': 'fr_FR',
};

export function dataDragonLocaleFor(locale: AppLocale): string {
  return DATA_DRAGON_LOCALES[locale];
}

export function championCatalogCacheKey(locale: AppLocale): string {
  return `lanelens.champion-catalog.${locale}.v1`;
}

export interface Champion {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string;
}

export interface StoredCatalog {
  readonly champions: readonly Champion[];
  readonly dataDragonVersion: string;
  readonly locale: AppLocale;
  readonly fetchedAt: string;
}

export interface ChampionCatalog extends StoredCatalog {
  readonly source: 'network' | 'cache';
  readonly stale: boolean;
}

export type CatalogResult =
  | { readonly status: 'ready'; readonly catalog: ChampionCatalog; readonly persistence: 'saved' | 'unavailable' }
  | { readonly status: 'error'; readonly code: 'CATALOG_UNAVAILABLE'; readonly message: string };

interface LoadOptions {
  fetch?: typeof globalThis.fetch;
  storage?: LocalStore | null;
  locale?: AppLocale;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function version(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function imagePrefix(dataDragonVersion: string): string {
  return `${BASE}/cdn/${dataDragonVersion}/img/champion/`;
}

function validCache(value: unknown, locale: AppLocale): value is StoredCatalog {
  if (!record(value) || !version(value.dataDragonVersion) || value.locale !== locale
    || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))
    || !Array.isArray(value.champions) || value.champions.length === 0) return false;

  const prefix = imagePrefix(value.dataDragonVersion);
  const ids = new Set<string>();
  return value.champions.every((champion: unknown) => {
    if (!record(champion) || typeof champion.id !== 'string' || !/^[A-Za-z0-9]+$/.test(champion.id)
      || ids.has(champion.id) || typeof champion.name !== 'string' || !champion.name.trim()
      || typeof champion.imageUrl !== 'string' || !champion.imageUrl.startsWith(prefix)
      || !/^[A-Za-z0-9_-]+\.png$/.test(champion.imageUrl.slice(prefix.length))) return false;
    ids.add(champion.id);
    return true;
  });
}

function normalize(value: unknown, dataDragonVersion: string, locale: AppLocale): StoredCatalog {
  if (!record(value) || value.version !== dataDragonVersion || !record(value.data)) {
    throw new Error('Catalogue Data Dragon invalide');
  }
  const champions = Object.values(value.data).map((entry): Champion => {
    if (!record(entry) || !record(entry.image) || typeof entry.image.full !== 'string'
      || !/^[A-Za-z0-9_-]+\.png$/.test(entry.image.full)
      || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      throw new Error('Champion invalide');
    }
    return { id: entry.id, name: entry.name, imageUrl: `${imagePrefix(dataDragonVersion)}${entry.image.full}` };
  });
  const catalog = { champions, dataDragonVersion, locale, fetchedAt: new Date().toISOString() };
  if (!validCache(catalog, locale)) throw new Error('Catalogue inexploitable');
  return catalog;
}

function ready(stored: StoredCatalog, source: 'network' | 'cache', stale: boolean,
  persistence: 'saved' | 'unavailable' = 'saved'): CatalogResult {
  // Expose immutable data so consumers cannot desynchronize version and portraits.
  const champions = Object.freeze(stored.champions.map((champion) => Object.freeze({
    id: champion.id, name: champion.name, imageUrl: champion.imageUrl,
  })));
  const catalog = Object.freeze({ champions, dataDragonVersion: stored.dataDragonVersion,
    locale: stored.locale, fetchedAt: stored.fetchedAt, source, stale });
  return Object.freeze({ status: 'ready', catalog, persistence });
}

export async function loadChampionCatalog(options: LoadOptions = {}): Promise<CatalogResult> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const cacheKey = championCatalogCacheKey(locale);
  const storage = options.storage === undefined ? browserStorage() : options.storage ?? undefined;
  const cached = readJson(storage, cacheKey);
  const previous = validCache(cached, locale) ? cached : undefined;
  const fetchData = options.fetch ?? globalThis.fetch;
  const json = async (url: string): Promise<unknown> => {
    const response = await fetchData(url, { signal: AbortSignal.timeout(5000), cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  try {
    // Riot's versions feed is ordered newest first; do not convert to a regional patch.
    const versions = await json(VERSIONS_URL);
    if (!Array.isArray(versions) || !version(versions[0])) throw new Error('Versions invalides');
    const latest = versions[0];
    if (previous?.dataDragonVersion === latest) return ready(previous, 'cache', false);

    const payload = await json(`${BASE}/cdn/${latest}/data/${dataDragonLocaleFor(locale)}/champion.json`);
    const catalog = normalize(payload, latest, locale);
    const saved = writeJson(storage, cacheKey, catalog);
    return ready(catalog, 'network', false, saved ? 'saved' : 'unavailable');
  } catch {
    if (previous) return ready(previous, 'cache', true);
    return { status: 'error', code: 'CATALOG_UNAVAILABLE', message: 'Le catalogue des champions est indisponible.' };
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { championCatalogCacheKey, dataDragonLocaleFor, loadChampionCatalog, VERSIONS_URL } from '../src/champions';
import type { CatalogResult } from '../src/champions';

const v1 = '1.0.1';
const v2 = '1.1.1';
const CATALOG_CACHE_KEY = championCatalogCacheKey('fr-FR');
const payload = (version: string) => ({ version, data: {
  MonkeyKing: { id: 'MonkeyKing', name: 'Wukong', image: { full: 'MonkeyKing.png' } },
} });
class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
}
function network(responses: unknown[]) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.cache, 'no-cache');
    assert.ok(init?.signal);
    assert.equal(init?.headers, undefined);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    assert.notEqual(next, undefined, 'Unexpected request');
    return Response.json(next);
  };
  return { fetch, calls };
}
function catalog(result: CatalogResult) {
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw new Error('Expected ready');
  return result.catalog;
}
async function seed(storage: MemoryStorage) {
  return loadChampionCatalog({ storage, fetch: network([[v1], payload(v1)]).fetch });
}

test('first load normalizes French data and persists a coherent catalogue without credentials', async () => {
  const storage = new MemoryStorage();
  const net = network([[v2, v1], payload(v2)]);
  const result = await loadChampionCatalog({ storage, fetch: net.fetch });
  const value = catalog(result);
  assert.equal(value.source, 'network');
  assert.equal(value.stale, false);
  assert.equal(value.locale, 'fr-FR');
  assert.equal(value.dataDragonVersion, v2);
  assert.deepEqual(value.champions, [{ id: 'MonkeyKing', name: 'Wukong',
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${v2}/img/champion/MonkeyKing.png` }]);
  assert.deepEqual(net.calls, [VERSIONS_URL, `https://ddragon.leagueoflegends.com/cdn/${v2}/data/fr_FR/champion.json`]);
  assert.equal(JSON.parse(storage.getItem(CATALOG_CACHE_KEY)!).dataDragonVersion, v2);
  assert.ok(Object.isFrozen(value.champions[0]));
});

test('application locale maps to Data Dragon locale and a dedicated cache key', () => {
  assert.equal(dataDragonLocaleFor('fr-FR'), 'fr_FR');
  assert.equal(CATALOG_CACHE_KEY, 'lanelens.champion-catalog.fr-FR.v1');
});

test('a new loader instance reuses serialized cache after checking version, preserving fetchedAt', async () => {
  const storage = new MemoryStorage();
  const initial = catalog(await seed(storage));
  const reloaded = new MemoryStorage();
  reloaded.values = new Map(storage.values);
  const net = network([[v1]]);
  const value = catalog(await loadChampionCatalog({ storage: reloaded, fetch: net.fetch }));
  assert.equal(value.source, 'cache');
  assert.equal(value.stale, false);
  assert.equal(value.fetchedAt, initial.fetchedAt);
  assert.equal(reloaded.writes, 0);
  assert.deepEqual(net.calls, [VERSIONS_URL]);
});

test('new version replaces old cache only after a valid complete response', async () => {
  const storage = new MemoryStorage();
  await seed(storage);
  const net = network([[v2], payload(v2)]);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(JSON.parse(storage.getItem(CATALOG_CACHE_KEY)!).dataDragonVersion, v1);
    return net.fetch(input, init);
  };
  assert.equal(catalog(await loadChampionCatalog({ storage, fetch })).dataDragonVersion, v2);
  assert.equal(JSON.parse(storage.getItem(CATALOG_CACHE_KEY)!).dataDragonVersion, v2);
});

for (const [name, responses] of [
  ['versions offline', [new Error('offline')]],
  ['empty versions', [[]]],
  ['new catalogue HTTP failure', [[v2], new Response('', { status: 503 })]],
  ['new catalogue timeout', [[v2], new DOMException('Timeout', 'TimeoutError')]],
  ['mismatched version', [[v2], payload(v1)]],
  ['empty catalogue', [[v2], { version: v2, data: {} }]],
  ['malformed JSON', [[v2], new Response('{')]],
] as [string, unknown[]][]) {
  test(`${name}: return stale cache without replacing it or relabelling its version`, async () => {
    const storage = new MemoryStorage();
    await seed(storage);
    const before = storage.getItem(CATALOG_CACHE_KEY);
    const value = catalog(await loadChampionCatalog({ storage, fetch: network(responses).fetch }));
    assert.equal(value.source, 'cache');
    assert.equal(value.stale, true);
    assert.equal(value.dataDragonVersion, v1);
    assert.ok(value.champions[0].imageUrl.includes(`/${v1}/`));
    assert.equal(storage.getItem(CATALOG_CACHE_KEY), before);
  });
}

for (const raw of [undefined, '{broken', '{}', JSON.stringify({ locale: 'en_US' })]) {
  test(`offline with unusable cache (${raw}) returns a controlled error`, async () => {
    const storage = new MemoryStorage();
    if (raw) storage.setItem(CATALOG_CACHE_KEY, raw);
    const result = await loadChampionCatalog({ storage, fetch: network([new Error('offline')]).fetch });
    assert.equal(result.status, 'error');
    if (result.status === 'error') assert.equal(result.code, 'CATALOG_UNAVAILABLE');
  });
}

test('cache with portrait version mismatch is rejected and recovered from network', async () => {
  const storage = new MemoryStorage();
  await seed(storage);
  const bad = JSON.parse(storage.getItem(CATALOG_CACHE_KEY)!);
  bad.champions[0].imageUrl = bad.champions[0].imageUrl.replace(v1, v2);
  storage.setItem(CATALOG_CACHE_KEY, JSON.stringify(bad));
  const net = network([[v1], payload(v1)]);
  assert.equal(catalog(await loadChampionCatalog({ storage, fetch: net.fetch })).source, 'network');
  assert.equal(net.calls.length, 2);
});

test('storage denial and quota errors do not hide successfully loaded data', async () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const result = await loadChampionCatalog({ storage, fetch: network([[v1], payload(v1)]).fetch });
  assert.equal(catalog(result).source, 'network');
  if (result.status === 'ready') assert.equal(result.persistence, 'unavailable');
});

test('startup state exposes the same promise and result to all consumers', async () => {
  const originalFetch = globalThis.fetch;
  const net = network([[v1], payload(v1)]);
  globalThis.fetch = net.fetch;
  try {
    const { initializeChampionCatalog, getChampionCatalogState } = await import('../src/catalog-state');
    assert.equal(getChampionCatalogState().status, 'idle');
    const first = initializeChampionCatalog();
    assert.equal(getChampionCatalogState().status, 'loading');
    assert.equal(initializeChampionCatalog(), first);
    const result = await first;
    assert.equal(getChampionCatalogState(), result);
    assert.equal(catalog(result).source, 'network');
    assert.equal(net.calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

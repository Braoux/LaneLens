import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlLangFor, SUPPORTED_LOCALES } from '../shared/locale';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  createTranslator,
  loadAppLocale,
  persistAppLocale,
  translate,
} from '../src/i18n';
import type { LocalStore } from '../src/storage';

class MemoryStorage implements LocalStore {
  readonly values = new Map<string, string>();
  fail = false;

  getItem(key: string): string | null {
    if (this.fail) throw new Error('denied');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw new Error('denied');
    this.values.set(key, value);
  }
}

test('French is the deterministic default regardless of browser preferences', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['fr-FR']);
  assert.equal(DEFAULT_LOCALE, 'fr-FR');
  assert.equal(loadAppLocale(new MemoryStorage()), 'fr-FR');
  assert.equal(htmlLangFor('fr-FR'), 'fr');
});

test('locale persistence accepts declared locales and safely rejects unknown or inaccessible values', () => {
  const storage = new MemoryStorage();
  storage.values.set(LOCALE_STORAGE_KEY, 'en-US');
  assert.equal(loadAppLocale(storage), 'fr-FR');
  assert.equal(persistAppLocale('fr-FR', storage), true);
  assert.equal(storage.values.get(LOCALE_STORAGE_KEY), 'fr-FR');
  storage.fail = true;
  assert.equal(loadAppLocale(storage), 'fr-FR');
  assert.equal(persistAppLocale('fr-FR', storage), false);
});

test('typed catalogue translates semantic keys and controlled interpolation', () => {
  const t = createTranslator('fr-FR');
  assert.equal(t('result.target'), 'Cible prioritaire');
  assert.equal(t('footer.attribution'), 'Designed & developed by Jonathan Assah');
  assert.equal(t('footer.github'), 'GitHub');
  assert.equal(t('history.savedAt', { date: '25/09/2026 10:30' }), 'Sauvegardée le 25/09/2026 10:30');
  assert.throws(() => translate('fr-FR', 'missing.key' as never), /Missing translation/);
});

test('the application footer exposes the author and a safe external GitHub link', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /t\('footer\.attribution'\)/);
  assert.match(source, /href="https:\/\/github\.com\/Braoux"/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /aria-label="\$\{t\('footer\.githubLabel'\)\}"/);
});

test('the French UI source no longer embeds the former English section titles', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  for (const title of [
    'QUICK OVERLAY', 'Threat', 'Response', 'Window', 'FULL ANALYSIS',
    'TARGET PRIORITY', 'Golden Rule', 'Cheat sheet',
  ]) assert.equal(source.includes(`'${title}'`), false, title);
});

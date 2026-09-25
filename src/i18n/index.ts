import { DEFAULT_LOCALE, SUPPORTED_LOCALES, htmlLangFor, isAppLocale } from '../../shared/locale';
import type { AppLocale } from '../../shared/locale';
import { browserStorage } from '../storage';
import type { LocalStore } from '../storage';
import { frFR } from './locales/fr-FR';
import type { TranslationCatalog, TranslationKey, TranslationParameters, Translator } from './types';

export const LOCALE_STORAGE_KEY = 'lanelens.locale.v1';

const CATALOGS: Record<AppLocale, TranslationCatalog> = {
  'fr-FR': frFR,
};

const LOCALE_LABEL_KEYS: Record<AppLocale, TranslationKey> = {
  'fr-FR': 'app.locale.fr-FR',
};

export function loadAppLocale(storage: LocalStore | undefined = browserStorage()): AppLocale {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function persistAppLocale(locale: AppLocale, storage: LocalStore | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  parameters: TranslationParameters = {},
): string {
  const template = CATALOGS[locale][key];
  if (template === undefined) throw new Error(`Missing translation: ${key}`);
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => {
    const value = parameters[name];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(locale: AppLocale): Translator {
  return (key: TranslationKey, parameters?: TranslationParameters): string =>
    translate(locale, key, parameters);
}

export function localeLabel(locale: AppLocale): string {
  return translate(locale, LOCALE_LABEL_KEYS[locale]);
}

export function applyDocumentLocale(locale: AppLocale): void {
  document.documentElement.lang = htmlLangFor(locale);
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { AppLocale, TranslationKey };
export type { Translator } from './types';

export const SUPPORTED_LOCALES = ['fr-FR'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'fr-FR';

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string'
    && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function htmlLangFor(locale: AppLocale): string {
  return locale.split('-', 1)[0] ?? 'fr';
}

import type { frFR } from './locales/fr-FR';

export type TranslationKey = keyof typeof frFR;
export type TranslationParameters = Readonly<Record<string, string | number>>;
export type TranslationCatalog = Readonly<Record<TranslationKey, string>>;
export type Translator = (key: TranslationKey, parameters?: TranslationParameters) => string;

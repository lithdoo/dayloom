import { detectLocale } from './detect';
import { messages, type Locale, type MessageKey } from './messages';

export type MessageVars = Record<string, string | number | boolean | null | undefined>;
export type Translator = (key: MessageKey, vars?: MessageVars) => string;

export function createTranslator(locale: Locale = detectLocale()): Translator {
  return (key, vars) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, vars);
}

export function addLangOption<T extends { option(flags: string, description?: string): T }>(command: T, t: Translator): T {
  return command.option('--lang <locale>', t('cli.lang'));
}

export { detectLocale, normalizeLocale } from './detect';
export type { Locale, MessageKey };

function interpolate(template: string, vars: MessageVars = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

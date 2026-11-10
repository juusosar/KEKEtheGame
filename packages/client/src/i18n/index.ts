// UI strings (§14): English only for now, all text in en.json. A Finnish UI can be added later as
// fi.json with the same keys. Brand names never go in here; pass them in as params from the theme.

import en from './en.json';

export type Messages = Record<string, string>;
export type MessageKey = keyof typeof en;
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Fills `{name}` placeholders from `params`. Unknown placeholders stay as they are, so a missing
 * param is visible on screen instead of silently disappearing.
 */
export function format(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** Builds a `t()` for a message table. Missing keys fall back to the key itself. */
export function createTranslator<K extends string>(messages: Readonly<Record<K, string>>) {
  return (key: K, params?: MessageParams): string => format(messages[key] ?? key, params);
}

/** Translates a UI string key, e.g. `t('boot.error', { message })`. */
export const t = createTranslator<MessageKey>(en);

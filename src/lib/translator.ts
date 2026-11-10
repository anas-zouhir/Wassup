// On-device translation with Chrome's built-in Translator API (Chrome 138+ desktop).
// Free, private (nothing leaves the device) and needs no key; other browsers
// don't have it, so callers must handle 'unsupported'.
// https://developer.chrome.com/docs/ai/translator-api

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface LanguagePair {
  sourceLanguage: string
  targetLanguage: string
}

interface TranslatorInstance {
  translate(input: string): Promise<string>
}

interface CreateMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void
}

interface TranslatorStatic {
  availability(pair: LanguagePair): Promise<Availability>
  create(options: LanguagePair & { monitor?: (m: CreateMonitor) => void }): Promise<TranslatorInstance>
}

export type Support = Availability | 'unsupported' | 'same-language'

const api = (globalThis as { Translator?: TranslatorStatic }).Translator

/** The Translator API identifies Chinese scripts, not regions; other languages by their base code. */
function toApiLanguage(tag: string): string {
  try {
    const locale = new Intl.Locale(tag).maximize()
    if (locale.language === 'zh') return locale.script === 'Hant' ? 'zh-Hant' : 'zh'
    return locale.language
  } catch {
    return tag.split('-')[0].toLowerCase()
  }
}

/** Translate into the reader's browser language. */
export const targetLanguage = toApiLanguage(navigator.language || 'en')

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

/** English name of a language tag, e.g. "fr-CA" -> "French". */
export function languageName(tag: string): string {
  const code = toApiLanguage(tag)
  return displayNames.of(code) ?? code
}

export async function checkSupport(sourceTag: string): Promise<Support> {
  // Checked first so readers never get a translation offer for text in their own language.
  const sourceLanguage = toApiLanguage(sourceTag)
  if (sourceLanguage === targetLanguage) return 'same-language'
  if (!api) return 'unsupported'
  try {
    return await api.availability({ sourceLanguage, targetLanguage })
  } catch {
    return 'unavailable'
  }
}

const translators = new Map<string, Promise<TranslatorInstance>>()

/**
 * Returns a (cached) translator for the source language. Creating one may
 * download a language model, which Chrome only allows right after a user
 * gesture, so the first call should come from a click handler.
 */
export function getTranslator(sourceTag: string, onProgress?: (fraction: number) => void) {
  if (!api) return Promise.reject(new Error('Translation is not supported in this browser'))
  const sourceLanguage = toApiLanguage(sourceTag)
  let translator = translators.get(sourceLanguage)
  if (!translator) {
    translator = api.create({
      sourceLanguage,
      targetLanguage,
      monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)),
    })
    translator.catch(() => translators.delete(sourceLanguage))
    translators.set(sourceLanguage, translator)
  }
  return translator
}

const translations = new Map<string, Promise<string>>()

/** Translates text from the source language, caching results across outlets and countries. */
export function translate(sourceTag: string, text: string): Promise<string> {
  const key = `${toApiLanguage(sourceTag)}\u0000${text}`
  let result = translations.get(key)
  if (!result) {
    result = getTranslator(sourceTag).then((t) => t.translate(text))
    result.catch(() => translations.delete(key))
    translations.set(key, result)
  }
  return result
}

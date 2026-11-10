import { useCallback, useEffect, useState } from 'react'
import { checkSupport, getTranslator, translate, type Support } from '../lib/translator'

const STORAGE_KEY = 'wassup.translate'

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePreference(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this visit.
  }
}

/**
 * `unavailable`: this browser can't translate this language (no API, or no model for the pair).
 * `not-needed`: the text is already in the reader's language.
 */
export type TranslationStatus =
  | { state: 'checking' | 'unavailable' | 'not-needed' | 'off' | 'translating' | 'translated' }
  | { state: 'downloading'; progress: number }
  | { state: 'error'; message: string }

/**
 * Translates `texts` from `lang` into the reader's language when switched on.
 * Returns the translations (keyed by original text) and the UI status.
 */
export function useTranslation(lang: string, texts: string[]) {
  // Per-language state is tagged with its language so that switching to an
  // outlet in another language never reuses a stale answer.
  const [support, setSupport] = useState<{ lang: string; value: Support } | null>(null)
  const [download, setDownload] = useState<{ lang: string; progress: number } | null>(null)
  const [failure, setFailure] = useState<{ lang: string; message: string } | null>(null)
  const [enabled, setEnabled] = useState(readPreference)
  const [translations, setTranslations] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    checkSupport(lang).then((value) => !cancelled && setSupport({ lang, value }))
    return () => {
      cancelled = true
    }
  }, [lang])

  const current = support?.lang === lang ? support.value : null
  const progress = download?.lang === lang ? download.progress : null
  const error = failure?.lang === lang ? failure.message : null
  // Without a click, Chrome refuses to download a model, so a remembered
  // preference only auto-translates languages whose model is already installed.
  const ready = current === 'available' || progress !== null
  const active = enabled && ready && !error
  const textsKey = texts.join('\u0000')

  useEffect(() => {
    if (!active) return
    let cancelled = false
    for (const text of textsKey.split('\u0000')) {
      if (!text) continue
      translate(lang, text).then(
        (translated) => !cancelled && setTranslations((t) => (t[text] === translated ? t : { ...t, [text]: translated })),
        (e: Error) => !cancelled && setFailure({ lang, message: e.message }),
      )
    }
    return () => {
      cancelled = true
    }
  }, [active, lang, textsKey])

  /** Must be called from a click handler (model downloads need a user gesture). */
  const turnOn = useCallback(() => {
    setFailure(null)
    setDownload({ lang, progress: 0 })
    getTranslator(lang, (progress) => setDownload({ lang, progress })).then(
      () => setDownload({ lang, progress: 1 }),
      (e: Error) => {
        setDownload(null)
        setFailure({ lang, message: e.message })
      },
    )
    setEnabled(true)
    writePreference(true)
  }, [lang])

  const turnOff = useCallback(() => {
    setEnabled(false)
    writePreference(false)
  }, [])

  let status: TranslationStatus
  if (current === null) status = { state: 'checking' }
  else if (current === 'same-language') status = { state: 'not-needed' }
  else if (current === 'unsupported' || current === 'unavailable') status = { state: 'unavailable' }
  else if (error) status = { state: 'error', message: error }
  else if (!active) status = { state: 'off' }
  else if (progress !== null && progress < 1) status = { state: 'downloading', progress }
  else if (texts.every((t) => !t || translations[t])) status = { state: 'translated' }
  else status = { state: 'translating' }

  return { status, translations: active ? translations : {}, turnOn, turnOff }
}

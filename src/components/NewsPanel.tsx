import { Fragment, useState, type ReactNode } from 'react'
import { useCountryData } from '../hooks/useCountryData'
import { usePersistentFlag } from '../hooks/usePersistentFlag'
import { useTranslation, type TranslationStatus } from '../hooks/useTranslation'
import { fetchCountryNews } from '../lib/data'
import { languageName, targetLanguage } from '../lib/translator'
import type { CountryFeature, OutletFeed } from '../types'
import { Panel } from './Panel'

interface Props {
  country: CountryFeature
  hasNews: boolean
  onClose: () => void
}

export function NewsPanel({ country, hasNews, onClose }: Props) {
  const { name, code } = country.properties
  const news = useCountryData(hasNews ? code : null, fetchCountryNews)

  return (
    <Panel title={name} label={`News from ${name}`} onClose={onClose}>
      {!hasNews && <p className="panel-message">No news sources for {name} yet.</p>}
      {news.status === 'loading' && <p className="panel-message">Loading…</p>}
      {news.status === 'error' && (
        <p className="panel-message">Couldn't load news: {news.error.message}</p>
      )}
      {news.status === 'success' && <OutletNews key={code} feeds={news.data.outlets} />}
    </Panel>
  )
}

function OutletNews({ feeds }: { feeds: OutletFeed[] }) {
  const [activeId, setActiveId] = useState(feeds[0]?.outlet.id)
  const active = feeds.find((f) => f.outlet.id === activeId) ?? feeds[0]
  const lang = active?.outlet.lang ?? targetLanguage
  const texts = active?.items.flatMap((item) => [item.title, item.summary ?? '']) ?? []
  const translation = useTranslation(lang, texts)
  // Pre-made English translations (from the scheduled job) work in every browser.
  const [englishPref, setEnglishPref] = usePersistentFlag('wassup.english')
  const hasEnglish = !!active?.items.some((item) => item.titleEn)
  const showEnglish = englishPref && hasEnglish

  // English (if on and available) wins, then the browser's own translation, then the original.
  const display = (original: string, english: string | undefined) => {
    if (showEnglish && english) return { text: english, lang: 'en' }
    const browser = translation.translations[original]
    return browser ? { text: browser, lang: targetLanguage } : { text: original, lang: undefined }
  }

  const english = {
    available: hasEnglish,
    on: showEnglish,
    turnOn: () => {
      translation.turnOff()
      setEnglishPref(true)
    },
    turnOff: () => setEnglishPref(false),
  }
  const turnOnBrowser = () => {
    setEnglishPref(false)
    translation.turnOn()
  }

  if (!active) return <p className="panel-message">No outlets available.</p>

  return (
    <>
      {feeds.length > 1 && (
        <nav className="outlet-tabs" role="tablist">
          {feeds.map((f) => (
            <button
              key={f.outlet.id}
              role="tab"
              aria-selected={f === active}
              className="outlet-tab"
              onClick={() => setActiveId(f.outlet.id)}
            >
              {f.outlet.name}
            </button>
          ))}
        </nav>
      )}

      <div className="outlet" lang={active.outlet.lang}>
        <div className="outlet-meta">
          <h3>{active.outlet.name}</h3>
          <a className="button" href={active.outlet.homepage} target="_blank" rel="noopener noreferrer">
            Open website ↗
          </a>
        </div>
        <p className="updated">Updated {formatTime(active.fetchedAt)}</p>
        <TranslateBar
          lang={lang}
          status={translation.status}
          turnOn={turnOnBrowser}
          turnOff={translation.turnOff}
          english={english}
        />

        <ol className="headlines">
          {active.items.map((item) => {
            const title = display(item.title, item.titleEn)
            const summary = item.summary ? display(item.summary, item.summaryEn) : null
            return (
              <li key={item.link} className="headline">
                <a href={item.link} target="_blank" rel="noopener noreferrer">
                  {/* No referrer: some outlets' CDNs block hotlinked images. */}
                  {item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  <div>
                    <h4 lang={title.lang}>{title.text}</h4>
                    {summary && <p lang={summary.lang}>{summary.text}</p>}
                    {item.publishedAt && <time dateTime={item.publishedAt}>{formatTime(item.publishedAt)}</time>}
                  </div>
                </a>
              </li>
            )
          })}
        </ol>
      </div>
    </>
  )
}

interface TranslateBarProps {
  lang: string
  /** The browser's own translator (desktop Chrome/Edge only). */
  status: TranslationStatus
  turnOn: () => void
  turnOff: () => void
  /** Pre-made English translations, available in every browser. */
  english: { available: boolean; on: boolean; turnOn: () => void; turnOff: () => void }
}

/**
 * Translation controls: "Show in English" (pre-made, everywhere) and, on
 * desktop Chrome/Edge, "Translate to <reader's language>" when that isn't English.
 */
function TranslateBar({ lang, status, turnOn, turnOff, english }: TranslateBarProps) {
  const from = languageName(lang)

  if (english.on) {
    return (
      <div className="translate-bar">
        English machine translation ·{' '}
        <button className="link-button" onClick={english.turnOff}>
          Show original
        </button>
      </div>
    )
  }

  const parts: ReactNode[] = []
  if (english.available) {
    parts.push(
      <button key="en" className="link-button" onClick={english.turnOn}>
        Show in English
      </button>,
    )
  }
  // With pre-made English available, the browser translator only adds
  // something when the reader's language isn't English.
  if (!(english.available && targetLanguage === 'en')) {
    const browser = browserControl(status, from, turnOn, turnOff)
    if (browser) parts.push(<span key="browser">{browser}</span>)
  }
  if (parts.length === 0) return null

  return (
    <div className="translate-bar" role="status">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {part}
        </Fragment>
      ))}
    </div>
  )
}

function browserControl(status: TranslationStatus, from: string, turnOn: () => void, turnOff: () => void) {
  switch (status.state) {
    case 'checking':
    case 'hidden':
      return null
    case 'off':
      return (
        <button className="link-button" onClick={turnOn}>
          Translate to {languageName(targetLanguage)}
        </button>
      )
    case 'downloading':
      return `Downloading ${from} translation… ${Math.round(status.progress * 100)}%`
    case 'translating':
      return `Translating from ${from}…`
    case 'translated':
      return (
        <>
          Translated from {from} ·{' '}
          <button className="link-button" onClick={turnOff}>
            Show original
          </button>
        </>
      )
    case 'error':
      return (
        <>
          Couldn't translate: {status.message} ·{' '}
          <button className="link-button" onClick={turnOn}>
            Try again
          </button>
        </>
      )
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

import { useState } from 'react'
import { useCountryData } from '../hooks/useCountryData'
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
  const shown = (text: string) => translation.translations[text] ?? text
  const textLang = (text: string) => (translation.translations[text] ? targetLanguage : undefined)

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
          turnOn={translation.turnOn}
          turnOff={translation.turnOff}
        />

        <ol className="headlines">
          {active.items.map((item) => (
            <li key={item.link} className="headline">
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                {/* No referrer: some outlets' CDNs block hotlinked images. */}
                {item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div>
                  <h4 lang={textLang(item.title)}>{shown(item.title)}</h4>
                  {item.summary && <p lang={textLang(item.summary)}>{shown(item.summary)}</p>}
                  {item.publishedAt && <time dateTime={item.publishedAt}>{formatTime(item.publishedAt)}</time>}
                </div>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

interface TranslateBarProps {
  lang: string
  status: TranslationStatus
  turnOn: () => void
  turnOff: () => void
}

/** Translate / show-original control; hidden when the browser can't translate this language. */
function TranslateBar({ lang, status, turnOn, turnOff }: TranslateBarProps) {
  const from = languageName(lang)
  const to = languageName(targetLanguage)

  switch (status.state) {
    case 'checking':
    case 'hidden':
      return null
    case 'off':
      return (
        <div className="translate-bar">
          <button className="link-button" onClick={turnOn}>
            Translate to {to}
          </button>
        </div>
      )
    case 'downloading':
      return (
        <div className="translate-bar" role="status">
          Downloading {from} translation… {Math.round(status.progress * 100)}%
        </div>
      )
    case 'translating':
      return (
        <div className="translate-bar" role="status">
          Translating from {from}…
        </div>
      )
    case 'translated':
      return (
        <div className="translate-bar">
          Translated from {from} ·{' '}
          <button className="link-button" onClick={turnOff}>
            Show original
          </button>
        </div>
      )
    case 'error':
      return (
        <div className="translate-bar">
          Couldn't translate: {status.message} ·{' '}
          <button className="link-button" onClick={turnOn}>
            Try again
          </button>
        </div>
      )
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

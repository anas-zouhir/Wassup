import { useEffect, useState } from 'react'
import { MODES, otherMode, type Mode } from '../lib/modes'

const SWITCHED_KEY = 'wassup.switched'
const PEEK_DELAY_MS = 1200

function hasSwitchedBefore(): boolean {
  try {
    return localStorage.getItem(SWITCHED_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  mode: Mode
  onSwitch: (mode: Mode) => void
  /** True once the loading screen is gone; the first-visit peek waits for it. */
  ready: boolean
}

/**
 * "Wassup news?" / "Wassup food?" wordmark. The italic word is the switch
 * between sections: it rolls like a reel, and on a first visit it briefly
 * peeks at the other word so people notice it can change.
 */
export function Logo({ mode, onSwitch, ready }: Props) {
  const [peeking, setPeeking] = useState(false)
  const other = otherMode(mode)

  useEffect(() => {
    if (!ready || hasSwitchedBefore()) return
    const timer = setTimeout(() => setPeeking(true), PEEK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready])

  const handleClick = () => {
    setPeeking(false)
    try {
      localStorage.setItem(SWITCHED_KEY, '1')
    } catch {
      // Without storage the peek just shows again next visit.
    }
    onSwitch(other)
  }

  return (
    <div className="logo">
      <h1 className="sr-only">Wassup {MODES[mode].label}?</h1>
      <span aria-hidden="true">Wassup</span>
      <button
        type="button"
        className="logo-switch"
        onClick={handleClick}
        title={`Switch to Wassup ${MODES[other].label}`}
        aria-label={`Switch to Wassup ${MODES[other].label}`}
      >
        <span
          className={`logo-reel${peeking ? ' peeking' : ''}`}
          data-mode={mode}
          aria-hidden="true"
          onAnimationEnd={(e) => e.target === e.currentTarget.lastElementChild && setPeeking(false)}
        >
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <span
              key={m}
              className="logo-word"
              data-state={m === mode ? 'active' : m === 'news' ? 'above' : 'below'}
            >
              {MODES[m].label}
            </span>
          ))}
        </span>
        <svg className="logo-switch-icon" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 1.5v8M1.5 3.5l2-2 2 2M8.5 10.5v-8M6.5 8.5l2 2 2-2" />
        </svg>
      </button>
      {/* Keyed so the new mark animates in on switch. */}
      <img key={mode} className="logo-mark" src={`${import.meta.env.BASE_URL}${MODES[mode].mark}`} alt="" />
    </div>
  )
}

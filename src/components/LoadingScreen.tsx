import { useState } from 'react'

// Generated once at module load so the stars don't jump around on re-render.
const SHOOTING_STARS = Array.from({ length: 14 }, () => ({
  top: `${Math.random() * 60 - 10}%`,
  left: `${Math.random() * 90 + 20}%`,
  delay: `${Math.random() * 6}s`,
  duration: `${1.2 + Math.random() * 1.6}s`,
}))

/** Full-screen loader that fades out once `done` becomes true. */
export function LoadingScreen({ done, text }: { done: boolean; text: string }) {
  const [gone, setGone] = useState(false)
  if (gone) return null

  return (
    <div
      className={`loading${done ? ' loading-done' : ''}`}
      role="status"
      aria-live="polite"
      onTransitionEnd={(e) => done && e.target === e.currentTarget && setGone(true)}
    >
      {SHOOTING_STARS.map((s, i) => (
        <span
          key={i}
          className="shooting-star"
          style={{ top: s.top, left: s.left, animationDelay: s.delay, animationDuration: s.duration }}
        />
      ))}

      <svg className="loading-globe" viewBox="-50 -50 100 100" aria-hidden="true">
        <circle r="40" className="loading-globe-outline" />
        <path d="M-40 0H40M-34.6 -20H34.6M-34.6 20H34.6" />
        {[0, 1, 2, 3].map((i) => (
          <ellipse key={i} rx="40" ry="40" className="meridian" style={{ animationDelay: `${-i * 0.75}s` }} />
        ))}
      </svg>
      <p className="loading-text">{text}</p>
    </div>
  )
}

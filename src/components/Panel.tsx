import type { ReactNode } from 'react'

interface Props {
  title: string
  label: string
  onClose: () => void
  children: ReactNode
}

/** Side panel frame shared by the news and food sections. */
export function Panel({ title, label, onClose, children }: Props) {
  return (
    <aside className="panel" aria-label={label}>
      <header className="panel-header">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>
      {children}
    </aside>
  )
}

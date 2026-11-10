import { useCallback, useEffect, useState } from 'react'
import { MODES, type Mode } from '../lib/modes'

const fromHash = (): Mode => (window.location.hash === '#food' ? 'food' : 'news')

/**
 * The current section, kept in the URL hash (#news / #food) so links can be
 * shared and the back button switches back.
 */
export function useMode() {
  const [mode, setModeState] = useState<Mode>(fromHash)

  useEffect(() => {
    const onHashChange = () => setModeState(fromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Theme hook for CSS ([data-mode="food"]) and the tab icon.
  useEffect(() => {
    document.documentElement.dataset.mode = mode
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) icon.href = `${import.meta.env.BASE_URL}${MODES[mode].favicon}`
  }, [mode])

  const setMode = useCallback((next: Mode) => {
    window.location.hash = next
  }, [])

  return [mode, setMode] as const
}

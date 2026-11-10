import { useCallback, useState } from 'react'

/** A boolean preference remembered in localStorage (falls back to memory if storage is unavailable). */
export function usePersistentFlag(key: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  const set = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // Not persisted; still works for this visit.
      }
    },
    [key],
  )

  return [value, set] as const
}

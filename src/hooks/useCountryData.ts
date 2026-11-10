import { useEffect, useState } from 'react'

type State<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

type Result<T> = { code: string } & ({ data: T } | { error: Error })

/**
 * Loads a country's data with `fetcher` (which must be a stable function).
 * Pass null for no country or no available data.
 */
export function useCountryData<T>(code: string | null, fetcher: (code: string) => Promise<T>): State<T> {
  const [result, setResult] = useState<Result<T> | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    fetcher(code).then(
      (data) => !cancelled && setResult({ code, data }),
      (error: Error) => !cancelled && setResult({ code, error }),
    )
    return () => {
      cancelled = true
    }
  }, [code, fetcher])

  if (!code) return { status: 'idle' }
  // A result for a different country is stale: the new one is still loading.
  if (result?.code !== code) return { status: 'loading' }
  return 'data' in result
    ? { status: 'success', data: result.data }
    : { status: 'error', error: result.error }
}

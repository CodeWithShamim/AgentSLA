import { useEffect, useRef } from 'react'
import { playCriteriaReveal, playDocketOpen } from '../design/motion'

/** Play the docket-open sequence once on view mount (§6). */
export function useDocketOpen<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (ref.current) playDocketOpen(ref.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** Stamp criterion results in top→bottom when they land (§6). */
export function useCriteriaReveal<T extends HTMLElement>(key: string | number | undefined) {
  const ref = useRef<T>(null)
  const played = useRef<string | number | undefined>(undefined)
  useEffect(() => {
    if (key !== undefined && key !== played.current && ref.current) {
      played.current = key
      playCriteriaReveal(ref.current)
    }
  }, [key])
  return ref
}

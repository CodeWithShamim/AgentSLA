import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/** Light/dark theme.
 *
 *  The design system carries two full palettes: the light "filing office"
 *  (`--paper*`) and the dark "chamber" (`--chamber*`). Dark mode promotes the
 *  chamber remapping to the document root (see tokens.css `[data-theme='dark']`)
 *  so the whole app runs on chamber surfaces.
 *
 *  First load follows the OS `prefers-color-scheme`; an explicit toggle persists
 *  to localStorage and, once chosen, wins over the OS. An inline script in
 *  index.html sets `data-theme` before first paint to avoid a flash — this
 *  provider mirrors that same decision so React and the DOM agree. */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'agentsla-theme'

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

type ThemeApi = {
  theme: Theme
  /** true once the user has explicitly chosen (OS changes no longer apply). */
  overridden: boolean
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme() ?? systemTheme())
  const [overridden, setOverridden] = useState<boolean>(() => storedTheme() != null)

  // Keep <html data-theme> in sync with state.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Follow the OS while the user hasn't made an explicit choice.
  useEffect(() => {
    if (overridden) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setThemeState(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [overridden])

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* private mode / storage disabled — in-session state still applies */
    }
    setOverridden(true)
    setThemeState(t)
  }

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, overridden, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

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
 *  Dark is the default — the court sits in the chamber. An explicit toggle
 *  persists to localStorage and wins on later visits. An inline script in
 *  index.html sets `data-theme` before first paint to avoid a flash — this
 *  provider mirrors that same decision so React and the DOM agree. */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'agentsla-theme'
const DEFAULT_THEME: Theme = 'dark'

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
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme() ?? DEFAULT_THEME)

  // Keep <html data-theme> in sync with state.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* private mode / storage disabled — in-session state still applies */
    }
    setThemeState(t)
  }

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

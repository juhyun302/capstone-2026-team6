import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'aleph.theme'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })

function readInitial(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* ignore */
  }
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitial)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'dark' ? '#14161c' : '#fcfcfd'
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)

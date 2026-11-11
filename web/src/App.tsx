import { useEffect } from 'react'
import { BrowserRouter, HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SkulletProvider } from 'skullet/react'
import { ThemeProvider } from './components/theme'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { LandingArt } from './screens/LandingArt'
import { NewRequest } from './screens/NewRequest'
import { Analyzing } from './screens/Analyzing'
import { Result } from './screens/Result'

// VITE_ROUTER=hash builds a bundle that works from any static host or artifact URL.
const Router = import.meta.env.VITE_ROUTER === 'hash' ? HashRouter : BrowserRouter

function FooterUnlessFirstScreen() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return <Footer />
}

function Screens() {
  const location = useLocation()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (location.hash) return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname, location.hash])
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        className="screen-anim"
        initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(6px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transition: { duration: 0.14 } }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<LandingArt />} />
          <Route path="/new" element={<NewRequest />} />
          <Route path="/jobs/:id" element={<Analyzing />} />
          <Route path="/results/:id" element={<Result />} />
          <Route path="*" element={<LandingArt />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <SkulletProvider
        mode="system"
        reveal="smart"
        theme={{
          light: { base: 'oklch(0 0 0 / 0.06)', highlight: 'oklch(1 0 0 / 0.5)' },
          dark: { base: 'oklch(1 0 0 / 0.07)', highlight: 'oklch(1 0 0 / 0.09)' },
          animation: 'shimmer',
          speed: 'slow',
          radius: '6px',
        }}
      >
        <Router>
          <button
            type="button"
            className="visually-hidden"
            onClick={() => {
              const main = document.getElementById('main')
              main?.setAttribute('tabindex', '-1')
              main?.focus()
            }}
          >
            본문으로 건너뛰기
          </button>
          <Nav />
          <div id="main">
            <Screens />
          </div>
          <FooterUnlessFirstScreen />
        </Router>
      </SkulletProvider>
    </ThemeProvider>
  )
}

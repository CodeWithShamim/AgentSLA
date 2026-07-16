import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, Link, useLocation } from 'react-router-dom'
import { destroyLenis, getLenis, initLenis, playRouteFade } from './design/motion'
import { CHAIN, CONTRACT_ADDRESS, explorerAddressUrl } from './config/chain'
import { useChainHealth, useMode } from './lib/reads'
import { shortAddr } from './lib/format'
import { writes } from './lib/writes'
import { WalletBoundary, WalletControls } from './lib/wallet'
import { ThemeToggle } from './components/ThemeToggle'
import { Board } from './views/Board'
import { Landing } from './views/Landing'
import { CaseDetail } from './views/CaseDetail'
import { CreateTask } from './views/CreateTask'
import { Agents } from './views/Agents'
import { AgentProfile } from './views/AgentProfile'
import { Appeal } from './views/Appeal'
import { Docs } from './views/Docs'

/** Route transitions (§6): a 160ms paper-level fade on the incoming view,
 *  then its own scoped docket-open. Filings don't fly. */
function RouteFade({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const lenis = getLenis()
    if (lenis) lenis.scrollTo(0, { immediate: true })
    else window.scrollTo(0, 0)
    if (ref.current) playRouteFade(ref.current)
  }, [loc.pathname])
  return <div ref={ref} className="route-fill">{children}</div>
}

function Shell() {
  const mode = useMode()
  const health = useChainHealth()
  const loc = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    initLenis()
    return () => destroyLenis()
  }, [])
  // Collapse the mobile menu whenever the route changes (a nav link was tapped).
  useEffect(() => { setMenuOpen(false) }, [loc.pathname])

  return (
    <>
      <header className="site-header">
        <div className="shell site-header-inner">
          <Link to="/" className="brand">
            <span className="brand-name">AgentSLA</span>
            <span className="brand-court t-small">· The Machine Court</span>
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M4 4l10 10M14 4L4 14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M2 5h14M2 9h14M2 13h14" />
              </svg>
            )}
          </button>
          <nav
            id="primary-nav"
            className={`site-nav t-small${menuOpen ? ' open' : ''}`}
            aria-label="Primary"
            onClick={() => setMenuOpen(false)}
          >
            <NavLink to="/board" className={({ isActive }) => (isActive ? 'active' : '')}>Docket</NavLink>
            <NavLink to="/agents" className={({ isActive }) => (isActive ? 'active' : '')}>Agents</NavLink>
            <NavLink to="/create" className={({ isActive }) => (isActive ? 'active' : '')}>File a task</NavLink>
            <NavLink to="/docs" className={({ isActive }) => (isActive ? 'active' : '')}>Docs</NavLink>
            {CONTRACT_ADDRESS && (
              <a
                href={explorerAddressUrl(CONTRACT_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                title={`View contract ${CONTRACT_ADDRESS} on GenLayer Studio Explorer`}
              >
                Explorer
              </a>
            )}
            <WalletControls />
            <ThemeToggle />
            <span
              className="sim-badge t-data"
              title={
                mode !== 'studionet'
                  ? 'No deployment configured — development build running the local protocol simulation.'
                  : health === 'ok'
                    ? `Live on GenLayer Studio Network (chain ${CHAIN.id}) — contract ${CONTRACT_ADDRESS}`
                    : health === 'connecting'
                      ? `Connecting to GenLayer Studio Network (chain ${CHAIN.id})…`
                      : `RPC not responding (chain ${CHAIN.id}) — transactions cannot be sent until the connection returns. Nothing is simulated.`
              }
            >
              {mode !== 'studionet'
                ? 'SIMULATION'
                : health === 'ok'
                  ? `STUDIO · ${CHAIN.id}`
                  : health === 'connecting'
                    ? 'CONNECTING…'
                    : 'RPC OFFLINE'}
            </span>
          </nav>
        </div>
      </header>

      <main className="shell" id="main">
        <RouteFade>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/board" element={<Board />} />
            <Route path="/create" element={<CreateTask />} />
            <Route path="/case/:id" element={<CaseDetail />} />
            <Route path="/case/:id/appeal" element={<Appeal />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agent/:address" element={<AgentProfile />} />
            <Route path="/docs" element={<Docs />} />
          </Routes>
        </RouteFade>

        <footer className="site-footer chamber t-small">
          <span>
            AgentSLA — on-chain SLA adjudication for agent-to-agent commerce.
            Verdicts by GenLayer Optimistic Democracy.
          </span>
          <span className="t-data">
            {mode === 'studionet' && CONTRACT_ADDRESS ? (
              <>
                {CHAIN.name} · chain {CHAIN.id} ·{' '}
                <a
                  href={explorerAddressUrl(CONTRACT_ADDRESS)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View contract on GenLayer Studio Explorer"
                  aria-label={`contract ${CONTRACT_ADDRESS} on explorer`}
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  {shortAddr(CONTRACT_ADDRESS)}
                </a>
              </>
            ) : (
              <>
                simulation ·{' '}
                <button
                  className="seal-download"
                  style={{ font: 'inherit', color: 'inherit', textDecoration: 'underline' }}
                  onClick={() => { writes.resetSimulation(); window.scrollTo(0, 0) }}
                >
                  reset
                </button>
              </>
            )}
          </span>
        </footer>
      </main>
    </>
  )
}

export function App() {
  return (
    <WalletBoundary>
      <Shell />
    </WalletBoundary>
  )
}

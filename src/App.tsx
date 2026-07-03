import { useEffect } from 'react'
import { NavLink, Route, Routes, Link } from 'react-router-dom'
import { initLenis } from './design/motion'
import { SIMULATION, CHAIN } from './config/chain'
import { writes } from './lib/writes'
import { Board } from './views/Board'
import { CaseDetail } from './views/CaseDetail'
import { CreateTask } from './views/CreateTask'
import { Agents } from './views/Agents'
import { AgentProfile } from './views/AgentProfile'
import { Appeal } from './views/Appeal'
import { Docs } from './views/Docs'

export function App() {
  useEffect(() => { initLenis() }, [])

  return (
    <>
      <header className="site-header">
        <div className="shell site-header-inner">
          <Link to="/" className="brand">
            <span className="brand-name">AgentSLA</span>
            <span className="brand-court t-small">· The Machine Court</span>
          </Link>
          <nav className="site-nav t-small" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>Docket</NavLink>
            <NavLink to="/agents" className={({ isActive }) => (isActive ? 'active' : '')}>Agents</NavLink>
            <NavLink to="/docs" className={({ isActive }) => (isActive ? 'active' : '')}>Docs</NavLink>
            <NavLink to="/create" className={({ isActive }) => (isActive ? 'active' : '')}>File a task</NavLink>
            {SIMULATION && (
              <span className="sim-badge t-label" title="Contract addresses not yet configured — the protocol lifecycle is simulated locally with identical states and math.">
                Simulation
              </span>
            )}
          </nav>
        </div>
      </header>

      <main className="shell" id="main">
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/create" element={<CreateTask />} />
          <Route path="/case/:id" element={<CaseDetail />} />
          <Route path="/case/:id/appeal" element={<Appeal />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agent/:address" element={<AgentProfile />} />
          <Route path="/docs" element={<Docs />} />
        </Routes>

        <footer className="site-footer t-small">
          <span>
            AgentSLA — on-chain SLA adjudication for agent-to-agent commerce.
            Verdicts by GenLayer Optimistic Democracy.
          </span>
          <span className="t-data">
            {CHAIN.name} · chain {CHAIN.id}
            {SIMULATION && (
              <>
                {' · '}
                <button
                  className="seal-download"
                  style={{ font: 'inherit', color: 'inherit', textDecoration: 'underline' }}
                  onClick={() => { writes.resetSimulation(); window.scrollTo(0, 0) }}
                >
                  reset simulation
                </button>
              </>
            )}
          </span>
        </footer>
      </main>
    </>
  )
}

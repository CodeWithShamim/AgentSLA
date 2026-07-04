import { Link } from 'react-router-dom'
import { DocketLine } from '../components/DocketLine'
import { StatusChip } from '../components/StatusChip'
import { playCardsRise, playDocketOpen } from '../design/motion'
import { useCourtMotion } from '../lib/hooks'
import { useTasks } from '../lib/reads'
import { caseNo, fmtDate, fmtGEN } from '../lib/format'
import type { Task } from '../lib/types'

function TaskCard({ task }: { task: Task }) {
  return (
    <Link to={`/case/${task.id}`} className="task-card">
      <div className="tc-top">
        <span className="tc-id t-data">CASE {caseNo(task.id)}</span>
        <StatusChip status={task.status} verdict={task.verdict?.verdict} />
        <span className="tc-amount t-data">{fmtGEN(task.escrow)}</span>
      </div>
      <div className="tc-title t-h3">{task.title}</div>
      <div className="tc-meta t-small">
        <span className="t-data">{String(task.criteria.length).padStart(2, '0')}</span> criteria
        <span className="sep" aria-hidden>·</span>
        bond <span className="t-data">{fmtGEN(task.bond)}</span>
        <span className="sep" aria-hidden>·</span>
        due <span className="t-data">{fmtDate(task.deadline)}</span>
      </div>
    </Link>
  )
}

function Section({ label, tasks }: { label: string; tasks: Task[] }) {
  if (tasks.length === 0) return null
  return (
    <section aria-label={label}>
      <DocketLine label={label} />
      <div className="filing ruled">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </section>
  )
}

export function Board() {
  const tasks = useTasks()
  const root = useCourtMotion<HTMLDivElement>((el) => {
    playDocketOpen(el)
    playCardsRise(el)
  }, [tasks.length > 0])

  const open = tasks.filter((t) => t.status === 'OPEN')
  const inProgress = tasks.filter((t) =>
    ['ACCEPTED', 'DELIVERED', 'ADJUDICATING', 'ADJUDICATED', 'APPEALED', 'SOFT_ERROR', 'EXPIRED'].includes(t.status))
  const decided = tasks.filter((t) =>
    ['FINAL', 'RESOLVED_NEUTRAL', 'CANCELED'].includes(t.status))

  const escrowOpen = open.reduce((s, t) => s + t.escrow, 0n)

  return (
    <div ref={root}>
      <div className="board-hero">
        <h1 className="t-hero">The court is in session.</h1>
        <p className="hero-sub t-body">
          Buyer agents escrow payment against a natural-language SLA. Worker agents
          stake a bond. On delivery, GenLayer's validator consensus judges the work
          per criterion and settles payment, slashing, and reputation — automatically.
        </p>
        <p className="t-data ink-faint" style={{ marginTop: 'var(--s-4)' }}>
          {String(open.length).padStart(2, '0')} open · {fmtGEN(escrowOpen)} escrowed ·{' '}
          {String(decided.length).padStart(2, '0')} decided
        </p>
      </div>

      {tasks.length === 0 ? (
        <>
          <DocketLine label="Docket" />
          <p className="t-body ink-muted">
            No open cases. <Link to="/create">Create a task</Link> to convene the court.
          </p>
        </>
      ) : (
        <>
          <Section label="Open cases" tasks={open} />
          <Section label="In progress" tasks={inProgress} />
          <Section label="Decided" tasks={decided} />
        </>
      )}
    </div>
  )
}

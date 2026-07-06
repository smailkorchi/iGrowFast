import type { WorkerHealthStatus } from '../../lib/database.types'
import { formatRelative } from '../../lib/relativeTime'

interface Props {
  worker: WorkerHealthStatus | null | undefined
  /** Total queued rows across all numbers (admin view). */
  queueDepth?: number | null
}

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Sain',
  stale:   'Obsolète',
  dead:    'Hors service',
  unknown: 'Inconnu',
}

export function MetricsTiles({ worker }: Props) {
  const isHealthy = worker?.health === 'healthy'
  const isStale = worker?.health === 'stale'
  const isDead = worker?.health === 'dead'

  return (
    <div className="metrics-grid">
      <Tile
        eyebrow="Worker"
        value={HEALTH_LABEL[worker?.health ?? 'unknown'] ?? 'Inconnu'}
        suffix={
          <span className={`metrics-dot metrics-dot--${worker?.health ?? 'unknown'}`} />
        }
        warm={isStale}
        cool={isHealthy}
        danger={isDead}
      />
      <Tile
        eyebrow="Profondeur de file"
        value={worker?.queue_depth ?? 0}
        sub={`${worker?.dispatching_count ?? 0} en distribution`}
      />
      <Tile
        eyebrow="Débit de vidage"
        value={worker?.drain_rate_1m ?? 0}
        sub="par minute (fenêtre 1 min)"
      />
      <Tile
        eyebrow="Numéros actifs"
        value={worker?.active_numbers ?? 0}
        sub={`worker ${worker?.worker_id ?? '—'}`}
      />
      <Tile
        eyebrow="Dernier battement"
        value={formatRelative(worker?.last_heartbeat_at)}
        sub={worker?.version ? `v${worker.version}` : '—'}
      />
      <Tile
        eyebrow="Dernière distribution"
        value={formatRelative(worker?.last_dispatch_at)}
        sub={worker?.hostname ?? '—'}
      />
    </div>
  )
}

function Tile({
  eyebrow, value, sub, suffix, warm, cool, danger,
}: {
  eyebrow: string
  value: string | number
  sub?: string
  suffix?: React.ReactNode
  warm?: boolean
  cool?: boolean
  danger?: boolean
}) {
  const cls = [
    'metric-tile',
    warm && 'metric-tile--warm',
    cool && 'metric-tile--cool',
    danger && 'metric-tile--danger',
  ].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <div className="metric-tile__eyebrow">{eyebrow}</div>
      <div className="metric-tile__value-row">
        <div className="metric-tile__value">{value}</div>
        {suffix}
      </div>
      {sub && <div className="metric-tile__sub">{sub}</div>}
    </div>
  )
}

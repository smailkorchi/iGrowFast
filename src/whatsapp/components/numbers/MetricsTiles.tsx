import type { LucideIcon } from 'lucide-react'
import { Activity, Clock, Gauge, Radio, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
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

const KPI_ACCENTS = {
  ink:    { dot: 'bg-ant-ink',    tile: 'bg-ant-ink/[0.06] border-ant-ink/15 text-ant-ink' },
  orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
  green:  { dot: 'bg-ant-green',  tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
  rose:   { dot: 'bg-ant-rose',   tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const

type Accent = keyof typeof KPI_ACCENTS

export function MetricsTiles({ worker }: Props) {
  const isHealthy = worker?.health === 'healthy'
  const isStale = worker?.health === 'stale'
  const isDead = worker?.health === 'dead'

  const workerAccent: Accent = isHealthy ? 'green' : isStale ? 'orange' : isDead ? 'rose' : 'ink'

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
      <Tile
        eyebrow="Worker"
        value={HEALTH_LABEL[worker?.health ?? 'unknown'] ?? 'Inconnu'}
        accent={workerAccent}
      />
      <Tile
        eyebrow="File"
        value={worker?.queue_depth ?? 0}
        sub={`${worker?.dispatching_count ?? 0} en cours`}
        icon={Activity}
      />
      <Tile
        eyebrow="Débit"
        value={worker?.drain_rate_1m ?? 0}
        sub="/ min"
        icon={Gauge}
      />
      <Tile
        eyebrow="Actifs"
        value={worker?.active_numbers ?? 0}
        sub={worker?.worker_id ?? '—'}
        icon={Radio}
      />
      <Tile
        eyebrow="Battement"
        value={formatRelative(worker?.last_heartbeat_at)}
        sub={worker?.version ? `v${worker.version}` : '—'}
        icon={Clock}
      />
      <Tile
        eyebrow="Distribution"
        value={formatRelative(worker?.last_dispatch_at)}
        sub={worker?.hostname ?? '—'}
        icon={Send}
      />
    </div>
  )
}

function Tile({
  eyebrow, value, sub, accent = 'ink', icon: Icon,
}: {
  eyebrow: string
  value: string | number
  sub?: string
  accent?: Accent
  icon?: LucideIcon
}) {
  const a = KPI_ACCENTS[accent]

  return (
    <div className="bg-ant-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
          <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
          {eyebrow}
        </div>
        {Icon && (
          <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
            <Icon className="w-4 h-4" strokeWidth={1.75} />
          </div>
        )}
      </div>
      <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
        {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
      </p>
      {sub && <p className="text-[12px] text-ant-mid mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

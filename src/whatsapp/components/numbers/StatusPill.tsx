import type { InstanceStatus } from '../../lib/database.types'
import { cn } from '@/lib/utils'

const LABEL: Record<InstanceStatus, string> = {
  pending:      'En attente d\'appairage',
  connecting:   'Connexion…',
  connected:    'En ligne',
  disconnected: 'Hors ligne',
  error:        'Erreur',
}

const STATUS_PILL: Record<InstanceStatus, string> = {
  pending:      'bg-ant-ink/[0.06] border-ant-ink/15 text-ant-mid',
  connecting:   'bg-ant-orange/10 border-ant-orange/25 text-ant-orange',
  connected:    'bg-ant-green/10 border-ant-green/25 text-ant-green',
  disconnected: 'bg-ant-mid/10 border-ant-mid/30 text-ant-muted',
  error:        'bg-ant-rose/10 border-ant-rose/25 text-ant-rose',
}

const STATUS_DOT: Record<InstanceStatus, string> = {
  pending:      'bg-ant-mid',
  connecting:   'bg-ant-orange',
  connected:    'bg-ant-green',
  disconnected: 'bg-ant-mid',
  error:        'bg-ant-rose',
}

interface Props { status: InstanceStatus }

export function StatusPill({ status }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', STATUS_PILL[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
      {LABEL[status]}
    </span>
  )
}

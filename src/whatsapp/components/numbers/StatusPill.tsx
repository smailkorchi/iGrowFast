import type { InstanceStatus } from '../../lib/database.types'

const LABEL: Record<InstanceStatus, string> = {
  pending:      'En attente d\'appairage',
  connecting:   'Connexion…',
  connected:    'En ligne',
  disconnected: 'Hors ligne',
  error:        'Erreur',
}

interface Props { status: InstanceStatus }

export function StatusPill({ status }: Props) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span className="status-pill__dot" aria-hidden="true" />
      <span className="status-pill__label">{LABEL[status]}</span>
    </span>
  )
}

import type { InstanceLifecycleState } from '../../lib/database.types'

const LABEL: Record<InstanceLifecycleState, string> = {
  warming:     'En chauffe',
  established: 'Établi',
  cooling:     'En refroidissement',
  banned:      'Banni',
}

interface Props { state: InstanceLifecycleState }

export function LifecycleBadge({ state }: Props) {
  return (
    <span className={`lifecycle-badge lifecycle-badge--${state}`}>
      {LABEL[state]}
    </span>
  )
}

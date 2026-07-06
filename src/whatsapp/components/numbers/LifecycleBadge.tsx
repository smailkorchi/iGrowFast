import type { InstanceLifecycleState } from '../../lib/database.types'
import { cn } from '@/lib/utils'

const LABEL: Record<InstanceLifecycleState, string> = {
  warming:     'En chauffe',
  established: 'Établi',
  cooling:     'En refroidissement',
  banned:      'Banni',
}

const PILL: Record<InstanceLifecycleState, string> = {
  warming:     'bg-ant-orange/10 border-ant-orange/25 text-ant-orange',
  established: 'bg-ant-green/10 border-ant-green/25 text-ant-green',
  cooling:     'bg-ant-blue/10 border-ant-blue/25 text-ant-blue',
  banned:      'bg-ant-rose/10 border-ant-rose/25 text-ant-rose',
}

const DOT: Record<InstanceLifecycleState, string> = {
  warming:     'bg-ant-orange',
  established: 'bg-ant-green',
  cooling:     'bg-ant-blue',
  banned:      'bg-ant-rose',
}

interface Props { state: InstanceLifecycleState }

export function LifecycleBadge({ state }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', PILL[state])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[state])} />
      {LABEL[state]}
    </span>
  )
}

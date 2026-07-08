import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInstances, useInstancesRealtime } from '../../lib/queries/instances'
import { CreateInstanceDialog } from '../../components/numbers/CreateInstanceDialog'
import { InstanceCard, InstanceCardSkeleton } from '../../components/numbers/InstanceCard'
import { NumbersEmptyState } from '../../components/numbers/EmptyState'
import { PairDialog } from '../../components/numbers/PairDialog'

// IGF simplification (owner ruling 2026-07-08): the worker-health KPI strip
// (MetricsTiles — queue depth, drain rate, heartbeat, dispatch host) was
// fleet-operator telemetry; removed from the admin surface.

export default function AdminNumbers() {
  useInstancesRealtime()
  const { data: instances, isLoading } = useInstances()

  const [createOpen, setCreateOpen] = useState(false)
  const [pairId, setPairId] = useState<string | null>(null)

  const hasNone = !isLoading && (instances?.length ?? 0) === 0

  return (
    <div className="ant-surface min-h-screen">
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
              <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
              Admin · Connexions
            </div>
            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
              Numéros
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Appairez des numéros WhatsApp Business et réglez leur comportement.
            </p>
          </div>
          {!hasNone && (
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              Ajouter un numéro
            </Button>
          )}
        </header>

        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <h2 className="font-display text-[18px] text-ant-ink tracking-tight">Numéros connectés</h2>
            <span className="text-[12px] text-ant-mid tabular-nums">
              {isLoading ? '—' : `${instances?.length ?? 0} au total`}
            </span>
          </header>

          {hasNone ? (
            <NumbersEmptyState onAdd={() => setCreateOpen(true)} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => <InstanceCardSkeleton key={i} />)
                : instances?.map((inst) => (
                    <InstanceCard
                      key={inst.id}
                      instance={inst}
                      onResumePair={(id) => setPairId(id)}
                    />
                  ))}
            </div>
          )}
        </section>

        <CreateInstanceDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            setPairId(id)
          }}
        />

        <PairDialog
          instanceId={pairId}
          onClose={() => setPairId(null)}
        />
      </div>
    </div>
  )
}

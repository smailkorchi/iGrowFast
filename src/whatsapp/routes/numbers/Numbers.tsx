import { useState } from 'react'
import { useInstances, useInstancesRealtime, useWorkerHealth } from '../../lib/queries/instances'
import { CreateInstanceDialog } from '../../components/numbers/CreateInstanceDialog'
import { InstanceCard, InstanceCardSkeleton } from '../../components/numbers/InstanceCard'
import { MetricsTiles } from '../../components/numbers/MetricsTiles'
import { NumbersEmptyState } from '../../components/numbers/EmptyState'
import { PairDialog } from '../../components/numbers/PairDialog'
import './Numbers.css'

export default function AdminNumbers() {
  useInstancesRealtime()
  const { data: instances, isLoading } = useInstances()
  const { data: workerHealth } = useWorkerHealth()

  const [createOpen, setCreateOpen] = useState(false)
  const [pairId, setPairId] = useState<string | null>(null)

  const primaryWorker = workerHealth?.[0] ?? null
  const hasNone = !isLoading && (instances?.length ?? 0) === 0

  return (
    <section className="numbers-page page">
      <header className="page-hero">
        <div className="page-hero__text">
          <span className="page__eyebrow">Admin · Connexions</span>
          <h1 className="page__title">Numéros</h1>
          <p className="page__subtitle">
            Appairez des numéros WhatsApp Business, surveillez leur santé en temps réel, contrôlez la cadence.
          </p>
        </div>
        {!hasNone && (
          <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
            + Ajouter un numéro
          </button>
        )}
      </header>

      <MetricsTiles worker={primaryWorker} />

      <section className="numbers-page__list-section">
        <header className="numbers-page__list-head">
          <h2 className="numbers-page__list-title">Numéros connectés</h2>
          <span className="numbers-page__list-count">
            {isLoading ? '—' : `${instances?.length ?? 0} au total`}
          </span>
        </header>

        {hasNone ? (
          <NumbersEmptyState onAdd={() => setCreateOpen(true)} />
        ) : (
          <div className="numbers-grid">
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
    </section>
  )
}

import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { WhatsappInstance } from '../../lib/database.types'
import { formatRelative } from '../../lib/relativeTime'
import { InstanceAvatar } from './InstanceAvatar'
import { LifecycleBadge } from './LifecycleBadge'
import { StatusPill } from './StatusPill'

interface Props {
  instance: WhatsappInstance
  /** Optional callback when the user clicks the resume-pairing CTA. */
  onResumePair?: (id: string) => void
}

const STATUS_STRIPE: Record<string, string> = {
  connected: 'bg-ant-green',
  connecting: 'bg-ant-orange',
  error: 'bg-ant-rose',
  disconnected: 'bg-ant-rose',
  pending: 'bg-ant-line',
}

export function InstanceCard({ instance, onResumePair }: Props) {
  const needsPair = instance.status === 'pending' || instance.status === 'disconnected'
                  || instance.status === 'error'
  const isConnecting = instance.status === 'connecting'
  const autoReconnect = (instance as unknown as { auto_reconnect?: boolean }).auto_reconnect ?? false
  const needsRepair = (instance.status_detail ?? '').startsWith('needs_repair')

  return (
    <Link
      to={`/whatsapp/numbers/${instance.id}`}
      className="group relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper block transition-all hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]"
    >
      <div
        className={cn('h-[3px] w-full', STATUS_STRIPE[instance.status] ?? 'bg-ant-line')}
        aria-hidden="true"
      />

      <div className="p-4 space-y-3">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <InstanceAvatar size={44} url={instance.profile_pic_url} displayName={instance.display_name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-display text-[15px] font-semibold text-ant-ink tracking-tight truncate">
                  {instance.display_name}
                </h3>
                {instance.worker_paused && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid shrink-0"
                    title="Mis en pause par l'admin"
                  >
                    en pause
                  </span>
                )}
              </div>
              {instance.wa_profile_name && (
                <div className="text-[12px] text-ant-mid truncate">{instance.wa_profile_name}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={instance.status} />
            <LifecycleBadge state={instance.lifecycle_state} />
            {needsRepair ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-ant-rose/10 border-ant-rose/25 text-ant-rose"
                title="Surveillance arrêtée — réappairage requis (scanner le QR)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 9v4" /><path d="M12 17h.01" />
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                Réappairer
              </span>
            ) : autoReconnect && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-ant-green/10 border-ant-green/25 text-ant-green"
                title="Surveillance de reconnexion auto active"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6l7-3z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                Auto
              </span>
            )}
          </div>
        </div>

        <div>
          {instance.phone_number ? (
            <span className="font-display text-[18px] text-ant-ink tabular-nums">{instance.phone_number}</span>
          ) : (
            <span className="font-serif italic text-[13px] text-ant-mid">Aucun numéro appairé</span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ant-line pt-3">
          <div className="space-y-0.5">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-ant-mid">Vu</span>
            <span className="block text-[12px] text-ant-ink tabular-nums">{formatRelative(instance.last_seen_at)}</span>
          </div>
          <div className="space-y-0.5 text-right">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-ant-mid">Appairé</span>
            <span className="block text-[12px] text-ant-ink tabular-nums">
              {instance.paired_at ? formatRelative(instance.paired_at) : '—'}
            </span>
          </div>
        </div>

        {needsPair && (
          <button
            type="button"
            className="w-full h-9 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[11px] font-semibold cursor-pointer transition-colors"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onResumePair?.(instance.id)
            }}
          >
            {instance.status === 'pending' ? 'Appairer le numéro →' : 'Reconnecter →'}
          </button>
        )}

        {isConnecting && (
          <div className="flex items-center gap-2 text-[11px] text-ant-orange">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Connexion…
          </div>
        )}
      </div>
    </Link>
  )
}

export function InstanceCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper">
      <div className="h-[3px] w-full bg-ant-line" aria-hidden="true" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-[60%]" />
        <Skeleton className="h-3.5 w-[40%]" />
        <Skeleton className="h-7 w-[80%]" />
        <Skeleton className="h-4 w-[50%]" />
      </div>
    </div>
  )
}

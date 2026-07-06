import { Link } from 'react-router-dom'
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

export function InstanceCard({ instance, onResumePair }: Props) {
  const needsPair = instance.status === 'pending' || instance.status === 'disconnected'
                  || instance.status === 'error'
  const isConnecting = instance.status === 'connecting'
  const autoReconnect = (instance as unknown as { auto_reconnect?: boolean }).auto_reconnect ?? false
  const needsRepair = (instance.status_detail ?? '').startsWith('needs_repair')

  return (
    <Link to={`/whatsapp/numbers/${instance.id}`} className="instance-card">
      <div
        className={`instance-card__beam instance-card__beam--${instance.status}`}
        aria-hidden="true"
      />

      <div className="instance-card__head">
        <div className="instance-card__head-row">
          <InstanceAvatar size={44} url={instance.profile_pic_url} displayName={instance.display_name} />
          <div className="instance-card__head-text">
            <div className="instance-card__title-row">
              <h3 className="instance-card__title">{instance.display_name}</h3>
              {instance.worker_paused && (
                <span className="instance-card__paused-chip" title="Mis en pause par l'admin">en pause</span>
              )}
            </div>
            {instance.wa_profile_name && (
              <div className="instance-card__wa-name">{instance.wa_profile_name}</div>
            )}
          </div>
        </div>
        <div className="instance-card__meta">
          <StatusPill status={instance.status} />
          <LifecycleBadge state={instance.lifecycle_state} />
          {needsRepair ? (
            <span className="instance-card__watchdog instance-card__watchdog--repair" title="Surveillance arrêtée — réappairage requis (scanner le QR)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 9v4" /><path d="M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              Réappairer
            </span>
          ) : autoReconnect && (
            <span className="instance-card__watchdog" title="Surveillance de reconnexion auto active">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              Auto
            </span>
          )}
        </div>
      </div>

      <div className="instance-card__phone">
        {instance.phone_number ? (
          <span className="instance-card__phone-number">{instance.phone_number}</span>
        ) : (
          <span className="instance-card__phone-placeholder">Aucun numéro appairé</span>
        )}
      </div>

      <div className="instance-card__footer">
        <div className="instance-card__metric">
          <span className="instance-card__metric-label">Vu</span>
          <span className="instance-card__metric-value">{formatRelative(instance.last_seen_at)}</span>
        </div>
        <div className="instance-card__metric">
          <span className="instance-card__metric-label">Appairé</span>
          <span className="instance-card__metric-value">
            {instance.paired_at ? formatRelative(instance.paired_at) : '—'}
          </span>
        </div>
      </div>

      {needsPair && (
        <button
          type="button"
          className="instance-card__cta"
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
        <div className="instance-card__connecting">
          <span className="instance-card__connecting-shimmer" />
          Connexion…
        </div>
      )}
    </Link>
  )
}

export function InstanceCardSkeleton() {
  return (
    <div className="instance-card instance-card--skel">
      <div className="instance-card__beam instance-card__beam--pending" aria-hidden="true" />
      <div className="instance-card__skel-row" style={{ width: '60%' }} />
      <div className="instance-card__skel-row" style={{ width: '40%', height: 14 }} />
      <div className="instance-card__skel-row" style={{ width: '80%', height: 28 }} />
      <div className="instance-card__skel-row" style={{ width: '50%' }} />
    </div>
  )
}

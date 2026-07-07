// IGF DELTA D3 (owner-ordered 2026-07-07): full-surface takeover while the
// ACTIVE instance's chat history is still syncing.
//
// Why: during a history dump, slices land as live INSERTs — an open thread
// appends old messages from random dates at the bottom until the next
// timestamp re-sort. Gating the inbox until history_synced_at lands (the
// worker's settle-based stamp) removes that whole confusion window. MEDIA is
// deliberately NOT gated — thumbnails/audio back-fill progressively and can
// take long on rich phones.
//
// New file on purpose (no donor equivalent — WA Mancer's sync signal was
// dead, so no such gate could exist there). Markup mirrors ConnectionGate's
// gate classes so it renders as the same family of takeover screens. The
// "Continuer quand même" escape mirrors PairDialog's — an admin who chose to
// continue there must not hit a wall here (remembered per instance+connect
// for this browser session).
import { useInstanceSyncMetrics } from '../../../lib/queries/instances'
import { IconLock } from './icons'

const nf = new Intl.NumberFormat('fr-MA')

export function syncGateBypassKey(instanceId: string, lastConnectAt: string | null): string {
  return `wam.syncgate.bypass.${instanceId}.${lastConnectAt ?? '-'}`
}

export function SyncingGate({
  instanceId,
  name,
  syncProgress,
  onContinueAnyway,
}: {
  instanceId: string
  name: string
  /** whatsapp_instances.sync_progress — capped at 99 until the settle stamp. */
  syncProgress: number | null
  onContinueAnyway: () => void
}) {
  const { data: m } = useInstanceSyncMetrics(instanceId, true)

  return (
    <div className="wac__empty wac__gate" role="status">
      <div className="wac__empty-illu wac__gate-illu" aria-hidden>
        <div className="wac__stream-spinner" style={{ width: 56, height: 56, borderWidth: 4 }} />
      </div>
      <h1 className="wac__empty-title">Synchronisation en cours</h1>
      <p className="wac__empty-sub">
        {`WhatsApp envoie l'historique des discussions de « ${name} ». Les conversations
        s'afficheront ici dès que la synchronisation des messages sera terminée — les médias
        (photos, audios, documents) continueront de se charger progressivement ensuite.`}
      </p>

      <ul className="wac__gate-list">
        <li className="wac__gate-item">
          <span className="wac__gate-dot" data-status="connected" aria-hidden />
          <span className="wac__gate-name">
            {m ? `${nf.format(m.conversations)} discussions · ${nf.format(m.messages)} messages reçus` : 'Réception en cours…'}
          </span>
          {typeof syncProgress === 'number' && syncProgress > 0 && (
            <span className="wac__gate-status">{Math.min(syncProgress, 99)}%</span>
          )}
        </li>
      </ul>

      <button type="button" className="wac__gate-btn wac__gate-btn--ghost" onClick={onContinueAnyway}>
        Continuer quand même
      </button>

      <div className="wac__empty-foot">
        <IconLock />
        <span>Vos messages sont chiffrés de bout en bout.</span>
      </div>
    </div>
  )
}

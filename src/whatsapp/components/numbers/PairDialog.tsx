// Multi-phase pair + sync dialog.
//
//   QR        → kicks /instance-pair, shows the QR until status flips to
//                'connected'. Evolution reports 'connecting' while serving
//                the QR AND during the brief post-scan handshake — we keep
//                the QR visible through both. Refresh button forces a new
//                code if scanning lags.
//   SYNCING   → status='connected' and live counters are ticking.
//                Conversations, messages, contacts, JID mappings, media
//                queue. Auto-detects "ready" when ingestion rate slows past
//                the threshold; admin can also click Continue any time.
//   READY     → green check + final counts + Seed Phone Book offer.
//                Skip closes; Import opens ImportContactsModal locked to
//                this instance.
//
// Stays open through the whole flow. Admin can't lose progress by closing
// — closing in SYNCING just stops watching; sync continues server-side.
//
// Brand chrome from Assignment.css (.aamodal-scrim / .aamodal__btn) +
// dedicated .pair* classes in Numbers.css.

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  useInstance,
  useInstanceSyncMetrics,
  usePairInstance,
  useDeleteInstance,
  type InstanceSyncMetrics,
} from '../../lib/queries/instances'
import ImportContactsModal from './ImportContactsModalStub'
import { normalizeError } from '../../lib/toast/store'
import { InstanceAvatar } from './InstanceAvatar'

/** Sub-stage of the SYNCING phase — drives the status strip copy. */
type SyncStage = 'messages' | 'media' | 'complete'

/** Format a duration in seconds into 12s / 2m 14s / 1h 03m. */
function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

interface Props {
  instanceId: string | null
  onClose: () => void
}

type Phase = 'qr' | 'syncing' | 'ready' | 'import'

/** Maximum syncing window before we offer the manual Continue button — used only
 *  as a safety net when the engine never emits the final-batch signal. */
const MAX_SYNCING_SECONDS    = 120

export function PairDialog({ instanceId, onClose }: Props) {
  // Poll while pairing so the worker-persisted, auto-rotated QR appears here
  // without a manual refresh (matches WhatsApp Web). `untilSynced` keeps polling
  // AFTER connect so we observe history_synced_at land (the real sync-done
  // signal) and any connection flap — instead of freezing at first 'connected'.
  const { data: instance } = useInstance(instanceId, { refetchMs: 2500, untilSynced: true })
  const pair = usePairInstance()
  const del = useDeleteInstance()
  const [refreshKey, setRefreshKey] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [continueClicked, setContinueClicked] = useState(false)

  // Cancel = fast cleanup: delete the unscanned instance, then close. No need
  // to close the modal and hunt down the stale instance manually.
  async function handleCancel() {
    if (!instanceId) { onClose(); return }
    try { await del.mutateAsync(instanceId) } catch { /* toast surfaces error */ }
    onClose()
  }

  // Derive phase from instance.status + admin actions.
  //   - We only leave QR when status becomes 'connected'. Both 'pending' and
  //     'connecting' (Evolution's "serving QR / mid-handshake" states) keep
  //     the user on the QR view — they look identical and need a scan to
  //     advance. Once Baileys reports the session is up, status = 'connected'
  //     and we jump straight to SYNCING.
  const status = instance?.status ?? null
  const phase: Phase =
    importOpen               ? 'import'
    : continueClicked        ? 'ready'
    : status === 'connected' ? 'syncing'
    : 'qr'

  // Kick pair on open / Refresh
  useEffect(() => {
    if (!instanceId) return
    pair.reset()
    pair.mutate(instanceId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, refreshKey])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-recover when the Baileys QR loop dies mid-dialog. When the finite QR
  // loop ends, the worker flips status to 'disconnected' and (now) clears
  // qr_code, so the card would otherwise sit on an empty shimmer forever.
  // Re-firing the pair mutation runs restart+connect → a fresh loop. Guarded on
  // the status TRANSITION (prev !== status) so it fires once per death, never
  // looping: a failed restart leaves status unchanged and won't re-trigger.
  const prevStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (
      phase === 'qr' &&
      (status === 'disconnected' || status === 'error') &&
      prev !== status
    ) {
      setRefreshKey((k) => k + 1)
    }
  }, [status, phase])

  if (!instanceId) return null

  // Prefer the LIVE QR from Realtime (refreshed by the worker on every
  // qrcode.updated, and cleared on terminal states) over the one-shot connect
  // response, which is captured once and goes stale. Fall back to the connect
  // body only for the brief window before the first webhook lands.
  const qr = instance?.qr_code ?? pair.data?.qr?.base64 ?? null

  return (
    <>
      <div
        className="instance-modal__backdrop"
        onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'syncing') onClose() }}
      >
        <div
          className={'pair-dialog pair-dialog--' + phase}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pair-title"
          style={phase === 'syncing' ? { maxWidth: 640 } : undefined}
        >
          {/* Indeterminate progress stripe at the very top — orange while
              syncing, fades out when ready. Replaces the old static beam. */}
          <div
            className={'pair-dialog__progress' + (phase === 'syncing' ? ' is-active' : '')}
            aria-hidden="true"
          />

          <header className="pair-dialog__head">
            <div className="pair-dialog__head-meta">
              <span className="pair-dialog__eyebrow">
                {phase === 'qr' && 'Appairer via WhatsApp'}
                {phase === 'syncing' && 'Synchronisation · en direct'}
                {phase === 'ready' && 'Prêt'}
                {phase === 'import' && 'Importer le répertoire'}
              </span>
              <h2 id="pair-title" className="pair-dialog__title">
                {instance?.display_name ?? '—'}
                {instance?.phone_number && (
                  <span className="pair-dialog__title-sub">{instance.phone_number}</span>
                )}
              </h2>
            </div>
            <button
              type="button"
              className="pair-dialog__close"
              onClick={onClose}
              aria-label="Fermer"
              disabled={phase === 'syncing'}
              title={phase === 'syncing' ? 'Attendez la synchro initiale — fermeture bloquée' : 'Fermer'}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(20,20,19,0.04)',
                border: '1px solid rgba(20,20,19,0.08)',
                color: 'rgba(20,20,19,0.65)',
                cursor: phase === 'syncing' ? 'not-allowed' : 'pointer',
                opacity: phase === 'syncing' ? 0.45 : 1,
                flexShrink: 0,
                padding: 0,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
                style={{ display: 'block', flexShrink: 0 }}
              >
                <path
                  d="M2 2 L12 12 M12 2 L2 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            {phase === 'qr' && (
              <PhaseFade key="qr" fullWidth>
                <QrBody
                  qr={qr}
                  pending={pair.isPending}
                  onRefresh={() => setRefreshKey((k) => k + 1)}
                  onCancel={handleCancel}
                  canceling={del.isPending}
                />
              </PhaseFade>
            )}
            {phase === 'syncing' && (
              <PhaseFade key="syncing" fullWidth>
                <SyncingBody
                  instanceId={instanceId}
                  historySyncedAt={instance?.history_synced_at ?? null}
                  lastConnectAt={instance?.last_connect_at ?? null}
                  syncProgress={instance?.sync_progress ?? null}
                  onContinue={() => setContinueClicked(true)}
                />
              </PhaseFade>
            )}
            {phase === 'ready' && (
              <PhaseFade key="ready" fullWidth>
                <ReadyBody
                  displayName={instance?.display_name ?? 'ce numéro'}
                  phoneNumber={instance?.phone_number ?? null}
                  profilePicUrl={instance?.profile_pic_url ?? null}
                  onSkip={onClose}
                  onImport={() => setImportOpen(true)}
                />
              </PhaseFade>
            )}
          </AnimatePresence>

          {pair.error && phase === 'qr' && (
            <p className="instance-modal__error">
              Échec de l’appairage : {normalizeError(pair.error)}
            </p>
          )}
        </div>
      </div>

      {phase === 'import' && instanceId && (
        <ImportContactsModal
          defaultInstanceId={instanceId}
          lockInstance
          onClose={onClose}
        />
      )}
    </>
  )
}

/* ─── Phase wrappers ─────────────────────────────────────────────────── */

function PhaseFade({
  children, fullWidth,
}: { children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <motion.div
      className="pair-dialog__body"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18 }}
      style={fullWidth ? { gridTemplateColumns: '1fr' } : undefined}
    >
      {children}
    </motion.div>
  )
}

/* ─── Phase bodies ───────────────────────────────────────────────────── */

function QrBody({ qr, pending, onRefresh, onCancel, canceling }: { qr: string | null; pending: boolean; onRefresh: () => void; onCancel: () => void; canceling: boolean }) {
  const steps: Array<{ title: string; sub: string }> = [
    { title: 'Ouvrez WhatsApp Business', sub: 'sur le téléphone qui détient ce numéro' },
    { title: 'Appareils connectés',      sub: 'dans le menu ⋮, en haut à droite' },
    { title: 'Connecter un appareil',    sub: 'pointez la caméra vers ce QR' },
    { title: 'Restez sur cette fenêtre', sub: 'nous suivrons la synchro et importerons les contacts une fois prêts' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 28,
        alignItems: 'center',
        width: '100%',
      }}
    >
      {/* QR card */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            position: 'relative',
            width: 224,
            height: 224,
            padding: 14,
            background: '#ffffff',
            borderRadius: 18,
            border: '1px solid rgba(20,20,19,0.10)',
            boxShadow: '0 18px 36px -22px rgba(20,20,19,0.45)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {qr ? (
            <img
              src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
              alt="QR code d'appairage WhatsApp"
              style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 12,
                background:
                  'linear-gradient(135deg, rgba(20,20,19,0.05) 0%, rgba(20,20,19,0.10) 50%, rgba(20,20,19,0.05) 100%)',
                backgroundSize: '200% 200%',
                animation: 'shimmer 1.4s ease-in-out infinite',
                display: 'grid',
                placeItems: 'end center',
                paddingBottom: 18,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.7rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'rgba(20,20,19,0.5)',
                }}
              >
                Génération du QR…
              </span>
            </div>
          )}
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(217,119,87,0.07)',
            border: '1px solid rgba(217,119,87,0.22)',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-accent-warm)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--color-accent-warm)',
              animation: 'pair-pulse 1.4s ease-in-out infinite',
            }}
          />
          En attente du scan
        </div>
      </div>

      {/* Steps */}
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {steps.map((s, i) => (
          <li key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, alignItems: 'start' }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(20,20,19,0.04)',
                border: '1px solid rgba(20,20,19,0.10)',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: '0.78rem',
                color: 'var(--color-ink)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 3 }}>
              <span
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                  lineHeight: 1.25,
                }}
              >
                {s.title}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.82rem',
                  color: 'rgba(20,20,19,0.55)',
                  lineHeight: 1.4,
                }}
              >
                {s.sub}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>

      {/* Action footer — Refresh relocated OFF the QR (it was covering a finder
          corner, breaking scans) + a Cancel that deletes the unscanned instance
          so there's no stale leftover to clean up by hand. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          borderTop: '1px solid rgba(20,20,19,0.07)',
          paddingTop: 16,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={canceling}
          style={{
            appearance: 'none',
            border: '1px solid rgba(178,59,46,0.28)',
            background: '#ffffff',
            color: '#b23b2e',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.9rem',
            fontWeight: 600,
            padding: '10px 18px',
            borderRadius: 10,
            cursor: canceling ? 'not-allowed' : 'pointer',
            opacity: canceling ? 0.55 : 1,
          }}
        >
          {canceling ? 'Annulation…' : 'Annuler et supprimer'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'rgba(20,20,19,0.5)' }}>
            Le QR se rafraîchit automatiquement
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            style={{
              appearance: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--color-accent-warm)',
              background: 'var(--color-accent-warm)',
              color: '#ffffff',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.9rem',
              fontWeight: 600,
              padding: '10px 18px',
              borderRadius: 10,
              cursor: pending ? 'not-allowed' : 'pointer',
              opacity: pending ? 0.6 : 1,
              boxShadow: '0 8px 18px -10px rgba(217,119,87,0.6)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
              <path
                d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3M21 5v5h-5M3 19v-5h5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {pending ? 'Rafraîchissement…' : 'Rafraîchir le QR'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Syncing — live counters + rate-based ready detection ──────────── */

function SyncingBody({
  instanceId, historySyncedAt, lastConnectAt, syncProgress, onContinue,
}: {
  instanceId: string
  historySyncedAt: string | null
  lastConnectAt: string | null
  syncProgress: number | null
  onContinue: () => void
}) {
  const { data: m } = useInstanceSyncMetrics(instanceId, true)

  // THE real completion signal: the worker stamps history_synced_at when WhatsApp
  // delivers the final history-sync batch (messages.set isLatest / progress=100),
  // and resets it on every connect. So "synced" = history_synced_at exists AND is
  // from THIS connect. This replaces the old message-rate heuristic, which a
  // network stall trivially satisfied (no messages flowing ⇒ low rate) → the
  // premature "success" the user hit. NOTE: SyncingBody unmounts when the socket
  // leaves 'connected' (parent phase reverts), so `elapsed` below = time the
  // CURRENT connect has stayed up — a transient flap can never ride into success.
  const historySynced = !!historySyncedAt
    && (!lastConnectAt || new Date(historySyncedAt).getTime() >= new Date(lastConnectAt).getTime())

  // Render-time sample tracking — React's "adjust state during render"
  // pattern. Avoids setState-in-effect lint hits.
  const [tracker, setTracker] = useState<{ lastN: number; samples: { t: number; n: number }[] }>(
    { lastN: -1, samples: [] },
  )
  if (m && m.messages !== tracker.lastN) {
    setTracker((prev) => {
      const next = [...prev.samples, { t: Date.now(), n: m.messages }]
      while (next.length > 8) next.shift()
      return { lastN: m.messages, samples: next }
    })
  }

  // Wall-clock ticker (independent of metrics) so the elapsed counter
  // updates every second regardless of refetch cadence.
  const [startMs] = useState(() => Date.now())
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.round((nowMs - startMs) / 1000)
  // Keep onContinue stable so the 1s ticker re-renders can't cancel the
  // auto-advance timer below.
  const onContinueRef = useRef(onContinue)
  onContinueRef.current = onContinue

  // Derived metrics (pure).
  let ratePerSec = 0
  if (tracker.samples.length >= 2) {
    const first = tracker.samples[0]
    const last  = tracker.samples[tracker.samples.length - 1]
    const dt = (last.t - first.t) / 1000
    const dn = last.n - first.n
    ratePerSec = dt > 0 ? dn / dt : 0
  }
  // Stage detection — driven by the REAL history-sync signal, never by message
  // rate (which a stall fakes). Media drains in the background after history.
  //   1. 'messages' — history still streaming (not yet synced)
  //   2. 'media'    — history synced, but media_fetch_jobs still queued
  //   3. 'complete' — history synced AND media settled
  const mediaDone = !!m && m.media_pending === 0
  let stage: SyncStage = 'messages'
  if (historySynced) stage = mediaDone ? 'complete' : 'media'

  // Auto-advance ONLY on the genuine signal: history synced (this connect) and
  // media drained. No rate-based completion ⇒ a network hiccup can no longer
  // skip to success. `canContinue` lets the admin proceed manually once history
  // is synced, or after MAX_SYNCING_SECONDS if the engine never emits isLatest
  // (degrades toward waiting, never toward premature success).
  const tooLong = elapsed > MAX_SYNCING_SECONDS
  const canContinue = historySynced || tooLong
  const ready = stage === 'complete'

  // Auto-advance to the success screen once sync is genuinely complete. Brief
  // delay lets "Sync complete" register. Depends only on `ready`.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => onContinueRef.current(), 1200)
    return () => clearTimeout(t)
  }, [ready])

  if (!m) {
    return (
      <div className="pair-syncing">
        <div className="pair-syncing__status">
          <Spinner size={20} pulsing />
          <span className="pair-syncing__status-text">Démarrage de la synchro…</span>
        </div>
      </div>
    )
  }

  // Status strip text — explicit per sub-stage. Never claims "complete" while
  // media is still downloading.
  const statusText =
    stage === 'complete' ? 'Synchro terminée · prêt à continuer'
  : stage === 'media'    ? `Téléchargement des médias · ${m.media_pending} restants`
  : (syncProgress != null && syncProgress > 0)
      ? `Récupération de l'historique depuis WhatsApp · ${Math.min(99, syncProgress)}%`
  : 'Récupération de l\'historique depuis WhatsApp'

  // Right-side meta on the status strip: rate while messages flow, count + ETA
  // hint while media downloads, totals + elapsed when complete.
  const statusMeta =
    stage === 'complete' ? `${m.messages.toLocaleString()} msgs · ${formatElapsed(elapsed)}`
  : stage === 'media'    ? `${m.media_done.toLocaleString()} faits · ${formatElapsed(elapsed)}`
  : ratePerSec > 0       ? `${ratePerSec.toFixed(1)} msg/s · ${formatElapsed(elapsed)}`
  : `${formatElapsed(elapsed)} écoulées`

  // Hero metric: messages are the primary signal of sync progress. The other
  // five are secondary. Layout puts messages + conversations on a wide
  // first row, then four compact stat chips below.
  return (
    <div className="pair-syncing">
      {/* Status strip — single line, brand-orange while syncing → green
          when ready. Inline-styled to bypass any stylesheet cache state. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 14px',
          borderRadius: 12,
          background: ready ? 'rgba(120,140,93,0.08)' : 'rgba(217,119,87,0.06)',
          border: `1px solid ${ready ? 'rgba(120,140,93,0.3)' : 'rgba(217,119,87,0.2)'}`,
          transition: 'background 0.18s, border-color 0.18s',
        }}
      >
        {ready ? <StripCheck /> : <Spinner size={18} pulsing />}
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '0.88rem',
            fontWeight: 600,
            color: 'var(--color-ink)',
            flex: '1 1 auto',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {statusText}
        </span>
        <span
          style={{
            fontFamily: '"Fira Code", ui-monospace, monospace',
            fontSize: '0.78rem',
            color: 'rgba(20,20,19,0.55)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {statusMeta}
        </span>
      </div>

      {/* 3×2 grid — inline styles to guarantee rendering regardless of
          stylesheet cache state. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
        }}
      >
        <Tile
          value={m.messages}
          label="Messages"
          sub={ratePerSec > 0 ? `${ratePerSec.toFixed(1)} par seconde` : 'synchro historique'}
          accent
        />
        <Tile
          value={m.conversations}
          label="Conversations"
          sub={`${m.conversations_dms} DM · ${m.conversations_groups} groupe`}
        />
        <Tile
          value={m.contacts}
          label="Contacts"
          sub={`${m.contacts_resolved} résolus`}
        />
        <Tile
          value={m.jid_mapping}
          label="Correspondances JID"
          sub="LID ↔ téléphone"
        />
        <Tile
          value={m.media_done}
          label="Médias téléchargés"
          sub={
            m.media_failed > 0
              ? `${m.media_failed} en échec · ${m.media_pending} en file`
            : m.media_pending > 0
              ? `${m.media_pending} encore en file`
            : 'tout est fait'
          }
          accent={m.media_pending > 0 && stage === 'media'}
          warn={m.media_failed > 0}
        />
        <Tile
          value={m.contact_profiles}
          label="Cache de profils"
          sub="métadonnées WA"
        />
      </div>

      <div className="pair-syncing__foot">
        <span className="pair-syncing__foot-stat">
          {ready ? <ReadyDot /> : <span className="pair-syncing__pulse" aria-hidden />}
          {stage === 'complete' ? 'Prêt à continuer'
            : stage === 'media' ? 'Médias encore en téléchargement en arrière-plan'
            : 'À l\'écoute de nouveaux événements'}
        </span>
        <button
          type="button"
          className={'pair-syncing__continue' + (canContinue ? ' is-ready' : '')}
          onClick={onContinue}
          disabled={!canContinue}
        >
          {stage === 'complete' ? 'Continuer' : 'Continuer quand même'}
        </button>
      </div>
    </div>
  )
}

function ReadyBody({
  displayName, phoneNumber, profilePicUrl, onSkip, onImport,
}: {
  displayName: string
  phoneNumber: string | null
  profilePicUrl: string | null
  onSkip: () => void
  onImport: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
      {/* Hero: instance avatar with a thin green success ring */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '8px 0 4px' }}>
        <div
          style={{
            position: 'relative',
            width: 100,
            height: 100,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {/* Soft green halo behind the avatar */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at center, rgba(120,140,93,0.18) 0%, rgba(120,140,93,0) 70%)',
            }}
          />
          {/* Ring */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: -4,
              borderRadius: '50%',
              border: '2px solid rgba(120,140,93,0.45)',
            }}
          />
          <InstanceAvatar size={88} url={profilePicUrl} displayName={displayName} />
          {/* Check badge */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'var(--color-accent-natural)',
              border: '3px solid #ffffff',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 6px 14px -8px rgba(120,140,93,0.6)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="#ffffff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.4rem',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              color: 'var(--color-ink)',
              lineHeight: 1.1,
            }}
          >
            {displayName}
          </div>
          {phoneNumber && (
            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: '0.92rem',
                color: 'rgba(20,20,19,0.55)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {phoneNumber}
            </div>
          )}
          <div
            style={{
              marginTop: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(120,140,93,0.10)',
              border: '1px solid rgba(120,140,93,0.28)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.7rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--color-accent-natural)',
            }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-natural)' }} />
            Synchronisé
          </div>
        </div>
      </div>

      {/* Seed card */}
      <div
        style={{
          padding: '18px 20px',
          borderRadius: 14,
          background: 'rgba(20,20,19,0.02)',
          border: '1px solid rgba(20,20,19,0.07)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-heading)',
            fontSize: '1.05rem',
            fontWeight: 600,
            color: 'var(--color-ink)',
            letterSpacing: '-0.01em',
          }}
        >
          Importer le répertoire ?
        </h3>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-body)',
            fontSize: '0.9rem',
            lineHeight: 1.55,
            color: 'rgba(20,20,19,0.62)',
          }}
        >
          Importez un fichier <code style={{ fontFamily: 'Fira Code, ui-monospace, monospace', fontSize: '0.84em', padding: '1px 6px', borderRadius: 4, background: 'rgba(20,20,19,0.06)' }}>.vcf</code>
          {' '}ou{' '}
          <code style={{ fontFamily: 'Fira Code, ui-monospace, monospace', fontSize: '0.84em', padding: '1px 6px', borderRadius: 4, background: 'rgba(20,20,19,0.06)' }}>.csv</code>
          {' '}maintenant pour que les contacts aient un nom dès le premier jour. Vous pourrez aussi le faire plus tard depuis la page Contacts.
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          type="button"
          onClick={onSkip}
          style={{
            appearance: 'none',
            border: '1px solid rgba(20,20,19,0.14)',
            background: '#ffffff',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.9rem',
            fontWeight: 600,
            padding: '10px 18px',
            borderRadius: 10,
            cursor: 'pointer',
            minWidth: 100,
            transition: 'background 0.15s, border-color 0.15s, transform 0.08s',
          }}
        >
          Ignorer pour l'instant
        </button>
        <button
          type="button"
          onClick={onImport}
          style={{
            appearance: 'none',
            border: '1px solid var(--color-accent-warm)',
            background: 'var(--color-accent-warm)',
            color: '#ffffff',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.9rem',
            fontWeight: 600,
            padding: '10px 20px',
            borderRadius: 10,
            cursor: 'pointer',
            boxShadow: '0 8px 18px -10px rgba(217,119,87,0.6)',
            transition: 'background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.2s',
          }}
        >
          Importer le répertoire
        </button>
      </div>
    </div>
  )
}

/* ─── tiny atoms ─────────────────────────────────────────────────────── */

function Tile({
  value, label, sub, accent, warn,
}: {
  value: number
  label: string
  sub: string
  accent?: boolean
  warn?: boolean
}) {
  const tinted = accent || warn
  const numColor = tinted ? 'var(--color-accent-warm)' : 'var(--color-ink)'
  const tileBg = accent
    ? 'linear-gradient(180deg, rgba(217,119,87,0.07) 0%, rgba(217,119,87,0.02) 100%)'
    : warn
      ? 'rgba(217,119,87,0.07)'
      : '#ffffff'
  const borderColor = tinted ? 'rgba(217,119,87,0.26)' : 'rgba(20,20,19,0.08)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '16px 16px 14px',
        borderRadius: 14,
        background: tileBg,
        border: `1px solid ${borderColor}`,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '1.7rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: numColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value.toLocaleString()}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '0.72rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'rgba(20,20,19,0.7)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: '0.74rem',
          color: 'rgba(20,20,19,0.5)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {sub}
      </span>
    </div>
  )
}

function Spinner({ size = 40, pulsing = true }: { size?: number; pulsing?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" className={'pair-spinner' + (pulsing ? ' is-pulsing' : '')} aria-hidden>
      <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(20,20,19,0.1)" strokeWidth="4" />
      <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-accent-warm)" strokeWidth="4"
              strokeDasharray="60 80" strokeLinecap="round" transform="rotate(-90 25 25)">
        <animateTransform attributeName="transform" type="rotate" from="-90 25 25" to="270 25 25" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

function ReadyDot() {
  return <span className="pair-syncing__ready-dot" aria-hidden />
}

function StripCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="rgba(120,140,93,0.16)" />
      <path d="M7.5 12.4l3 3 6-6.6" stroke="var(--color-accent-natural)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// Silences unused-vars on the metric type — exporting for any caller that wants it.
export type { InstanceSyncMetrics }

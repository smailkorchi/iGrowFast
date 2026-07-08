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
// Chrome = IGF ant-* design system (shadcn Dialog + Tailwind utilities);
// the phase machine and sync mechanics are verbatim WA Mancer.

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import {
  useInstance,
  useInstanceQr,
  useInstanceSyncMetrics,
  usePairInstance,
  useDeleteInstance,
  type InstanceSyncMetrics,
} from '../../lib/queries/instances'
import ImportContactsModal from '../contacts/ImportContactsModal'
import { normalizeError } from '../../lib/toast/store'
import { InstanceAvatar } from './InstanceAvatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

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

  // Live QR now comes from the admin-gated RPC (qr_code was revoked from the
  // instance row so agents can't read the pairing secret). Poll only while the
  // QR is on screen.
  const { data: liveQr } = useInstanceQr(instanceId, phase === 'qr')

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
  const qr = liveQr ?? pair.data?.qr?.base64 ?? null

  return (
    <>
      <Dialog
        open={instanceId != null}
        onOpenChange={(open) => { if (!open && phase !== 'syncing') onClose() }}
      >
        <DialogContent
          aria-labelledby="pair-title"
          aria-describedby={undefined}
          className={cn(
            'p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl sm:rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden [&>button]:hidden',
            phase === 'syncing' ? 'max-w-[640px]' : 'max-w-lg',
          )}
        >
          {/* Indeterminate progress stripe at the very top — orange while
              syncing, green when ready. Replaces the old static beam. */}
          <div
            className={cn(
              'h-[3px] w-full',
              phase === 'syncing' ? 'bg-ant-orange animate-pulse'
              : phase === 'ready' ? 'bg-ant-green'
              : 'bg-ant-line',
            )}
            aria-hidden="true"
          />

          <DialogHeader className="flex-row items-start justify-between gap-3 space-y-0 px-6 pt-5 pb-4 border-b border-ant-line text-left">
            <div className="min-w-0 space-y-1.5">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                {phase === 'qr' && 'Appairer via WhatsApp'}
                {phase === 'syncing' && 'Synchronisation · en direct'}
                {phase === 'ready' && 'Prêt'}
                {phase === 'import' && 'Importer le répertoire'}
              </div>
              <DialogTitle
                id="pair-title"
                className="font-display text-[20px] leading-tight tracking-tight text-ant-ink"
              >
                {instance?.display_name ?? '—'}
                {instance?.phone_number && (
                  <span className="block text-[13px] font-normal text-ant-mid tabular-nums">
                    {instance.phone_number}
                  </span>
                )}
              </DialogTitle>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Fermer"
              disabled={phase === 'syncing'}
              title={phase === 'syncing' ? 'Attendez la synchro initiale — fermeture bloquée' : 'Fermer'}
              className="h-9 w-9 shrink-0 rounded-full text-ant-muted hover:text-ant-ink hover:bg-ant-ink/5 cursor-pointer disabled:opacity-45"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </Button>
          </DialogHeader>

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
            <p className="px-6 pb-5 text-[12px] text-ant-rose">
              Échec de l’appairage : {normalizeError(pair.error)}
            </p>
          )}
        </DialogContent>
      </Dialog>

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
      className="px-6 py-5"
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
    <div className="flex w-full flex-col gap-[22px]">
      <div className="grid w-full grid-cols-[240px_1fr] items-center gap-7">
        {/* QR card */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative grid h-[224px] w-[224px] place-items-center rounded-2xl border border-ant-line bg-white p-3.5 shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]">
            {qr ? (
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR code d'appairage WhatsApp"
                className="h-full w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <div className="grid h-full w-full animate-pulse items-end justify-items-center rounded-xl bg-ant-ink/5 pb-[18px]">
                <span className="font-display text-[11px] uppercase tracking-[0.06em] text-ant-mid">
                  Génération du QR…
                </span>
              </div>
            )}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-ant-orange">
            <span aria-hidden className="h-[7px] w-[7px] animate-pulse rounded-full bg-ant-orange" />
            En attente du scan
          </div>
        </div>

        {/* Steps */}
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          {steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[28px_1fr] items-start gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-ant-line bg-ant-ink/5 font-display text-[12px] font-semibold text-ant-ink tabular-nums">
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5 pt-[3px]">
                <span className="font-display text-[14px] font-semibold leading-[1.25] text-ant-ink">
                  {s.title}
                </span>
                <span className="font-serif text-[13px] italic leading-snug text-ant-mid">
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
      <div className="flex items-center justify-between gap-3 border-t border-ant-line pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={canceling}
          className="h-10 rounded-full border-ant-rose/[0.28] bg-white px-5 text-[12px] font-semibold text-ant-rose hover:bg-ant-rose/5 hover:text-ant-rose cursor-pointer disabled:opacity-55"
        >
          {canceling ? 'Annulation…' : 'Annuler et supprimer'}
        </Button>

        <div className="flex items-center gap-3.5">
          <span className="text-[12px] text-ant-mid">
            Le QR se rafraîchit automatiquement
          </span>
          <Button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="h-10 gap-2 rounded-full bg-ant-orange px-5 text-[12px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(217,119,87,0.6)] hover:bg-ant-orange/90 cursor-pointer disabled:opacity-60"
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
          </Button>
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
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Spinner size={20} pulsing />
          <span className="font-display text-[14px] font-semibold text-ant-ink">
            Démarrage de la synchro…
          </span>
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
    <div className="flex w-full flex-col gap-4">
      {/* Status strip — single line, brand-orange while syncing → green
          when ready. */}
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3.5 py-[11px] transition-colors',
          ready ? 'border-ant-green/25 bg-ant-green/10' : 'border-ant-orange/25 bg-ant-orange/10',
        )}
      >
        {ready ? <StripCheck /> : <Spinner size={18} pulsing />}
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[14px] font-semibold text-ant-ink">
          {statusText}
        </span>
        <span
          className="shrink-0 whitespace-nowrap text-[12px] text-ant-muted tabular-nums"
          style={{ fontFamily: '"Fira Code", ui-monospace, monospace' }}
        >
          {statusMeta}
        </span>
      </div>

      {/* 3×2 metric grid */}
      <div className="grid grid-cols-3 gap-2.5">
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

      <div className="flex items-center justify-between gap-3 border-t border-ant-line pt-4">
        <span className="inline-flex items-center gap-2 text-[12px] text-ant-mid">
          {ready ? <ReadyDot /> : <span className="h-2 w-2 animate-pulse rounded-full bg-ant-orange" aria-hidden />}
          {stage === 'complete' ? 'Prêt à continuer'
            : stage === 'media' ? 'Médias encore en téléchargement en arrière-plan'
            : 'À l\'écoute de nouveaux événements'}
        </span>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className={cn(
            'h-10 rounded-full px-5 text-[12px] font-semibold cursor-pointer',
            canContinue
              ? 'bg-ant-ink text-white hover:bg-ant-ink/90'
              : 'bg-ant-ink/10 text-ant-mid hover:bg-ant-ink/10',
          )}
        >
          {stage === 'complete' ? 'Continuer' : 'Continuer quand même'}
        </Button>
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
    <div className="flex w-full flex-col gap-[22px]">
      {/* Hero: instance avatar with a thin green success ring */}
      <div className="flex flex-col items-center gap-3.5 pb-1 pt-2">
        <div className="relative grid h-[100px] w-[100px] place-items-center">
          {/* Soft green halo behind the avatar */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle at center, rgba(120,140,93,0.18) 0%, rgba(120,140,93,0) 70%)',
            }}
          />
          {/* Ring */}
          <span
            aria-hidden
            className="absolute -inset-1 rounded-full border-2 border-ant-green/[0.45]"
          />
          <InstanceAvatar size={88} url={profilePicUrl} displayName={displayName} />
          {/* Check badge */}
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 grid h-[30px] w-[30px] place-items-center rounded-full border-[3px] border-white bg-ant-green shadow-[0_6px_14px_-8px_rgba(120,140,93,0.6)]"
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
        <div className="flex flex-col items-center gap-1">
          <div className="font-display text-[22px] font-semibold leading-[1.1] tracking-[-0.015em] text-ant-ink">
            {displayName}
          </div>
          {phoneNumber && (
            <div className="text-[14px] text-ant-mid tabular-nums">
              {phoneNumber}
            </div>
          )}
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-ant-green/[0.28] bg-ant-green/10 px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ant-green">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ant-green" />
            Synchronisé
          </div>
        </div>
      </div>

      {/* Seed card */}
      <div className="flex flex-col gap-1.5 rounded-2xl border border-ant-line bg-ant-ink/[0.02] px-5 py-[18px]">
        <h3 className="m-0 font-display text-[16px] font-semibold tracking-[-0.01em] text-ant-ink">
          Importer le répertoire ?
        </h3>
        <p className="m-0 font-serif text-[13px] leading-[1.55] text-ant-muted">
          Importez un fichier <code style={{ fontFamily: 'Fira Code, ui-monospace, monospace', fontSize: '0.84em', padding: '1px 6px', borderRadius: 4, background: 'rgba(20,20,19,0.06)' }}>.vcf</code>
          {' '}ou{' '}
          <code style={{ fontFamily: 'Fira Code, ui-monospace, monospace', fontSize: '0.84em', padding: '1px 6px', borderRadius: 4, background: 'rgba(20,20,19,0.06)' }}>.csv</code>
          {' '}maintenant pour que les contacts aient un nom dès le premier jour. Vous pourrez aussi le faire plus tard depuis la page Contacts.
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2.5">
        <Button
          type="button"
          variant="outline"
          onClick={onSkip}
          className="h-10 min-w-[100px] rounded-full border-ant-line bg-white px-5 text-[12px] font-semibold text-ant-ink hover:bg-ant-light hover:text-ant-ink cursor-pointer"
        >
          Ignorer pour l'instant
        </Button>
        <Button
          type="button"
          onClick={onImport}
          className="h-10 rounded-full bg-ant-orange px-5 text-[12px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(217,119,87,0.6)] hover:bg-ant-orange/90 cursor-pointer"
        >
          Importer le répertoire
        </Button>
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
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-xl border px-4 pb-3.5 pt-4',
        warn
          ? 'border-ant-rose/25 bg-ant-rose/10'
          : accent
            ? 'border-ant-orange/25 bg-ant-orange/[0.08]'
            : 'border-ant-line bg-white',
      )}
    >
      <span
        className={cn(
          'font-display text-[1.7rem] font-semibold leading-none tracking-[-0.02em] tabular-nums',
          warn ? 'text-ant-rose' : accent ? 'text-ant-orange' : 'text-ant-ink',
        )}
      >
        {value.toLocaleString()}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-ant-ink/70">
        {label}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ant-mid">
        {sub}
      </span>
    </div>
  )
}

function Spinner({ size = 40, pulsing = true }: { size?: number; pulsing?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" className={cn('shrink-0', pulsing && 'animate-pulse')} aria-hidden>
      <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(20,20,19,0.1)" strokeWidth="4" />
      <circle cx="25" cy="25" r="20" fill="none" stroke="#d97757" strokeWidth="4"
              strokeDasharray="60 80" strokeLinecap="round" transform="rotate(-90 25 25)">
        <animateTransform attributeName="transform" type="rotate" from="-90 25 25" to="270 25 25" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

function ReadyDot() {
  return <span className="h-2 w-2 rounded-full bg-ant-green" aria-hidden />
}

function StripCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="rgba(120,140,93,0.16)" />
      <path d="M7.5 12.4l3 3 6-6.6" stroke="#788c5d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// Silences unused-vars on the metric type — exporting for any caller that wants it.
export type { InstanceSyncMetrics }

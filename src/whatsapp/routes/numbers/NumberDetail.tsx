// /whatsapp/numbers/:id — chokepoint cockpit for one WhatsApp instance.
// Logic 1:1 from WA Mancer; presentation re-skinned to the IGF design system.
//
// Architecture: this number is a per-instance OUTBOUND CHOKEPOINT. Many
// agents may type/send/react in parallel; the server serializes everything
// into a single human-looking stream. This page is the operator's cockpit
// for that serializer: pause, lifecycle tier, pacing overrides, business
// hours, typing-pre-roll behavior, read-receipts policy, presence override,
// plus live observability on what the dispatcher is doing right now.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useDisconnectInstance,
  useDispatcherState,
  useInstance,
  useInstanceLiveSync,
  useInstanceStats,
  useInstancesRealtime,
  usePushWaProfile,
  usePushWaSettings,
  useResyncWebhookSubscription,
  useRestartInstance,
  useSetInstancePresence,
  useSetInstanceSettings,
} from '../../lib/queries/instances'
import { formatRelative } from '../../lib/relativeTime'
import { cn } from '@/lib/utils'
import { InstanceAvatar } from '../../components/numbers/InstanceAvatar'
import { LifecycleBadge } from '../../components/numbers/LifecycleBadge'
import { PairDialog } from '../../components/numbers/PairDialog'
import { StatusPill } from '../../components/numbers/StatusPill'
import DeleteInstanceModal from '../../components/numbers/DeleteInstanceModal'
import type { WhatsappInstance } from '../../lib/database.types'
import type { PushWaProfileArgs } from '../../lib/instancesApi'

// ─── Sending-protection presets (mirror of set_instance_settings server-side
//     + worker token bucket). Named profiles → concrete rate/burst/ceilings.
//     Anchored to real Baileys survivability data. Keep in sync with the
//     CASE in whatsapp.set_instance_settings if you change the numbers.

interface ProtectionPreset {
  label: string
  rate: number     // send_rate_per_min — token-bucket refill (sustained/min)
  burst: number    // minute_burst_cap — bucket capacity (instant burst)
  hourly: number   // hourly_send_cap — hard budget ceiling
  daily: number    // daily_send_cap — hard budget ceiling
  blurb: string
}
const PROTECTION_PRESETS: Record<'conservative'|'balanced'|'aggressive', ProtectionPreset> = {
  conservative: { label: 'Conservateur', rate: 6,  burst: 4, hourly: 100, daily: 400,  blurb: 'Le plus sûr. Numéros neufs ou en refroidissement.' },
  balanced:     { label: 'Équilibré',    rate: 10, burst: 5, hourly: 250, daily: 1500, blurb: 'Par défaut. Numéros établis.' },
  aggressive:   { label: 'Agressif',     rate: 15, burst: 5, hourly: 400, daily: 2000, blurb: 'Débit maximal. Numéros chauffés uniquement.' },
}

export default function NumberDetail() {
  useInstancesRealtime()
  const { id } = useParams<{ id: string }>()
  useInstanceLiveSync(id ?? null)
  const nav = useNavigate()
  const { data: instance, isLoading } = useInstance(id ?? null)
  const { data: stats } = useInstanceStats(id ?? null)
  const { data: live } = useDispatcherState(id ?? null)

  const disconnect = useDisconnectInstance()
  const restart    = useRestartInstance()

  const [pairOpen, setPairOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // Captured at open time so the delete modal keeps a stable name even after
  // the instance row vanishes from cache mid-delete.
  const [deleteName, setDeleteName] = useState('ce numéro')

  // The delete modal owns its own success animation + navigation (setTimeout
  // → onDone). It MUST survive the moment the instance disappears from cache:
  // a successful delete (mutation onSuccess + realtime DELETE) removes the
  // single-instance query, which would otherwise flip this page to the
  // loading/not-found branch and UNMOUNT the modal — clearing its nav timer
  // and stranding the user on "Instance not found". Rendering it from a single
  // overlay that every return path includes decouples it from `instance`.
  const deleteOverlay = confirmDelete && id ? (
    <DeleteInstanceModal
      instanceId={id}
      instanceName={deleteName}
      onCancel={() => setConfirmDelete(false)}
      onDone={() => { setConfirmDelete(false); nav('/whatsapp/numbers') }}
    />
  ) : null

  if (isLoading || !id) {
    return (
      <div className="ant-surface min-h-screen">
        <div className="px-4 md:px-8 py-6 md:py-8">
          <div className="h-8 w-2/5 rounded-lg bg-ant-line animate-pulse" />
        </div>
        {deleteOverlay}
      </div>
    )
  }
  if (!instance) {
    return (
      <div className="ant-surface min-h-screen">
        <div className="px-4 md:px-8 py-6 md:py-8">
          {!confirmDelete && (
            <header className="space-y-2">
              <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Introuvable
              </span>
              <h1 className="font-display text-[30px] tracking-[-0.02em] text-ant-ink">Numéro introuvable</h1>
              <p className="font-serif italic text-[14px] text-ant-mid">
                Ce numéro a peut-être été supprimé. <Link to="/whatsapp/numbers" className="underline text-ant-orange not-italic">Retour aux numéros</Link>
              </p>
            </header>
          )}
        </div>
        {deleteOverlay}
      </div>
    )
  }

  const isConnected = instance.status === 'connected'

  return (
    <div className="ant-surface min-h-screen">
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
        <Link to="/whatsapp/numbers" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ant-mid hover:text-ant-ink transition-colors">
          ← Tous les numéros
        </Link>

        {/* HERO ------------------------------------------------------------ */}
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex items-start gap-4">
            <InstanceAvatar size={72} url={instance.profile_pic_url} displayName={instance.display_name} />
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Connexion
              </span>
              <h1 className="font-display text-[28px] md:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">{instance.display_name}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={instance.status} />
                <LifecycleBadge state={instance.lifecycle_state} />
                {instance.phone_number && <span className="text-[13px] text-ant-mid font-mono">{instance.phone_number}</span>}
                {instance.wa_profile_name && <span className="text-[13px] text-ant-mid">· {instance.wa_profile_name}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch lg:items-end gap-3">
            <WatchdogToggle instance={instance} />
            <div className="flex flex-wrap items-center gap-2">
              {(instance.status === 'pending' || instance.status === 'disconnected' || instance.status === 'error') && (
                <button type="button" className={btnPrimary} onClick={() => setPairOpen(true)}>Appairer le numéro</button>
              )}
              {isConnected && (
                <button type="button" className={btnGhost} onClick={() => setConfirmDisconnect(true)} disabled={disconnect.isPending}>
                  {disconnect.isPending ? 'Déconnexion…' : 'Déconnecter'}
                </button>
              )}
              <button type="button" className={btnGhost} onClick={() => restart.mutate(instance.id)} disabled={restart.isPending}>
                {restart.isPending ? 'Redémarrage…' : 'Redémarrer'}
              </button>
              <button type="button" className={btnDanger} onClick={() => { setDeleteName(instance.display_name ?? instance.phone_number ?? 'ce numéro'); setConfirmDelete(true) }}>Supprimer</button>
            </div>
          </div>
        </header>

        {/* Disconnect = hard unlink (re-pair required). Gate it behind a confirm so
            it can't be a one-click accidental re-pair; point users at Restart for a
            soft reconnect that keeps creds. */}
        {confirmDisconnect && isConnected && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ant-ink/40 backdrop-blur-sm p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDisconnect(false) }}
          >
            <div className="w-full max-w-[460px] rounded-2xl border border-ant-line bg-ant-paper shadow-2xl p-6" role="dialog" aria-modal="true" aria-labelledby="disc-title">
              <header className="space-y-1.5">
                <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-rose">
                  <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                  Déconnecter
                </span>
                <h2 id="disc-title" className="font-display text-[20px] tracking-tight text-ant-ink">Dissocier ce numéro ?</h2>
              </header>
              <div className="mt-3">
                <p className="text-[13px] leading-relaxed text-ant-ink/70 m-0">
                  La déconnexion <strong>dissocie</strong> cet appareil de WhatsApp — il faudra <strong>réappairer (scanner le QR)</strong> pour le réactiver. Elle ne fait pas que suspendre la connexion.
                </p>
                <p className="text-[12px] text-ant-mid mt-2.5 m-0">
                  Pour reconnecter <strong>sans</strong> réappairer, utilisez plutôt <strong>Redémarrer</strong>.
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button type="button" className={btnGhost} onClick={() => setConfirmDisconnect(false)}>Annuler</button>
                  <button
                    type="button"
                    className={btnDanger}
                    onClick={() => { disconnect.mutate(instance.id); setConfirmDisconnect(false) }}
                    disabled={disconnect.isPending}
                  >
                    {disconnect.isPending ? 'Déconnexion…' : 'Déconnecter et dissocier'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* HEADLINE KPIs ------------------------------------------------- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
          <Kpi label="Entrants 24h"  value={stats?.messages_inbound_24h ?? 0}  tone="cool" />
          <Kpi label="Sortants 24h" value={stats?.messages_outbound_24h ?? 0} tone="natural" />
          <Kpi label="Conversations actives 24h" value={stats?.conversations_active_24h ?? 0} />
          <Kpi label="Non lus" value={stats?.conversations_unread ?? 0} tone={stats && stats.conversations_unread > 0 ? 'warm' : undefined} />
        </div>

        {/* LIVE STATE — what the dispatcher is doing right now (prominent) -- */}
        <LiveStateCard live={live ?? null} instance={instance} />

        {/* DISPATCH CONTROLS — how the chokepoint sends -------------------- */}
        <SectionBlock title="Contrôles de répartition" sub="Comment le point de contrôle envoie">
          <div className="space-y-4">
            <OperationalCard instance={instance} />
            <PacingCard instance={instance} />
          </div>
        </SectionBlock>

        {/* HUMAN BEHAVIOR — how the number appears to customers ------------ */}
        <SectionBlock title="Comportement humain" sub="Comment le numéro apparaît aux clients">
          <div className="space-y-4">
            <PresenceCard instance={instance} />
            <HumanizationCard instance={instance} />
            <ScheduleCard instance={instance} />
          </div>
        </SectionBlock>

        {/* WHATSAPP ACCOUNT — peer-visible profile + connection behavior -- */}
        <SectionBlock title="Compte WhatsApp" sub="Profil visible par les contacts & comportement de connexion">
          <div className="space-y-4">
            <WaBehaviorCard instance={instance} />
            <WaProfileCard instance={instance} />
          </div>
        </SectionBlock>

        <OpsCard instance={instance} />

        {/* LIBRARY + RELIABILITY (existing) ------------------------------ */}
        <SectionBlock title="Bibliothèque" sub="Tout ce qui est rattaché à ce numéro.">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
            <MetricTile eyebrow="Conversations" value={stats?.conversations_total ?? 0} sub={`${stats?.conversations_dms ?? 0} DM · ${stats?.conversations_groups ?? 0} groupes`} />
            <MetricTile eyebrow="Contacts" value={stats?.contacts_total ?? 0} sub="contacts DM distincts" />
            <MetricTile eyebrow="Groupes" value={stats?.conversations_groups ?? 0} sub="rejoints" />
            <MetricTile eyebrow="Messages 7j" value={stats?.messages_7d ?? 0} />
            <MetricTile eyebrow="Messages au total" value={stats?.messages_total ?? 0} />
            <MetricTile eyebrow="Vu" value={formatRelative(instance.last_seen_at)} />
          </div>
        </SectionBlock>

        <SectionBlock title="Fiabilité" sub="Santé opérationnelle de ce numéro.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
            <MetricTile eyebrow="Reconnexions 7j" value={stats?.reconnects_7d ?? 0} />
            <MetricTile eyebrow="Appairé" value={instance.paired_at ? formatRelative(instance.paired_at) : 'Pas encore'} />
            <MetricTile eyebrow="Détail du statut" value={instance.status_detail ?? '—'} />
          </div>
        </SectionBlock>
      </div>

      {deleteOverlay}
      <PairDialog instanceId={pairOpen ? instance.id : null} onClose={() => setPairOpen(false)} />
    </div>
  )
}

// ─── IGF button styles ────────────────────────────────────────────────────

const btnPrimary = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'
const btnGhost   = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold border border-ant-line bg-transparent text-ant-ink hover:bg-ant-ink/5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'
const btnDanger  = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose text-white hover:bg-ant-rose/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'
const btnPush    = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-orange text-white hover:bg-ant-orange/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'

// ─── Section wrapper ──────────────────────────────────────────────────────

function SectionBlock({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
        <h2 className="font-display text-[19px] tracking-tight text-ant-ink">{title}</h2>
        <span className="font-serif italic text-[12px] text-ant-mid">{sub}</span>
      </header>
      {children}
    </section>
  )
}

// ─── Hero: auto-reconnect watchdog toggle ─────────────────────────────────
//
// Flips the per-instance auto_reconnect flag. The worker's status poll reads
// it and restarts a genuinely-down number (with backoff + caps + terminal
// detection). Prominent in the hero so the admin owns the decision per number.

function WatchdogToggle({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const on = (instance as unknown as { auto_reconnect?: boolean }).auto_reconnect ?? false
  const needsRepair = (instance.status_detail ?? '').startsWith('needs_repair')
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-2xl border px-4 py-3',
      on ? 'border-ant-green/30 bg-ant-green/5' : 'border-ant-line bg-ant-paper',
    )}>
      <span className={cn('shrink-0', on ? 'text-ant-green' : 'text-ant-mid')} aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-[12px] font-semibold text-ant-ink">Reconnexion auto</span>
        <span className="text-[11px] text-ant-mid truncate">
          {needsRepair
            ? 'Arrêtée — réappairage requis (scanner le QR)'
            : on
              ? 'Surveillance active — redémarre un lien interrompu'
              : 'Désactivée — reconnexion manuelle uniquement'}
        </span>
      </span>
      <Toggle
        checked={on}
        onChange={(v) => set.mutate({ auto_reconnect: v })}
        disabled={set.isPending}
        tone="natural"
      />
    </div>
  )
}

// ─── Card 1: Operational ──────────────────────────────────────────────────

function OperationalCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const lifecycle = instance.lifecycle_state as 'warming' | 'established' | 'cooling' | 'banned'
  return (
    <Card
      title="Exploitation"
      eyebrow="POINT DE CONTRÔLE · COMMANDES PRINCIPALES"
      accent="warm"
      help="Activez/désactivez le répartiteur et choisissez le palier de cadence que le worker doit utiliser."
    >
      <Row>
        <RowLabel>Répartiteur</RowLabel>
        <Toggle
          checked={!instance.worker_paused}
          onChange={(v) => set.mutate({ worker_paused: !v })}
          disabled={set.isPending}
          rightLabel={instance.worker_paused ? 'En pause' : 'Actif'}
          tone={instance.worker_paused ? 'warm' : 'natural'}
        />
      </Row>
      <Row>
        <RowLabel>Palier de cadence</RowLabel>
        <Segmented
          value={lifecycle === 'banned' ? 'cooling' : lifecycle}
          options={[
            { value: 'warming',     label: 'En chauffe' },
            { value: 'established', label: 'Établi' },
            { value: 'cooling',     label: 'En refroidissement' },
          ]}
          onChange={(v) => set.mutate({ lifecycle_state: v as 'warming'|'established'|'cooling' })}
          disabled={set.isPending || lifecycle === 'banned'}
        />
      </Row>
    </Card>
  )
}

// ─── Card 2: Presence ─────────────────────────────────────────────────────

function PresenceCard({ instance }: { instance: WhatsappInstance }) {
  const setPresence = useSetInstancePresence(instance.id)
  const current = instance.manual_presence
  return (
    <Card
      title="Présence"
      eyebrow="VISIBILITÉ EN LIGNE"
      accent="cool"
      help="AUTO (recommandé) : le numéro reste hors ligne et n'apparaît en ligne qu'un instant pendant qu'un agent répond activement — comme une vraie personne. EN LIGNE : le numéro est affiché en permanence en ligne pour tout le monde."
    >
      <div className="flex py-1">
        <Segmented
          value={current === 'online' ? 'online' : 'auto'}
          options={[
            { value: 'auto',    label: 'Auto' },
            { value: 'online',  label: 'Toujours en ligne' },
          ]}
          onChange={(v) => setPresence.mutate(v as 'auto'|'online')}
          disabled={setPresence.isPending}
          size="lg"
        />
      </div>
      <Row>
        <RowLabel>Effectif</RowLabel>
        {current === 'online' ? (
          <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-ant-green">
            <span aria-hidden className="h-2 w-2 rounded-full bg-ant-green ring-[3px] ring-ant-green/20" />
            Toujours en ligne
          </span>
        ) : (
          <span className="text-[12px] text-ant-mid text-right">
            Hors ligne · brièvement en ligne pendant la réponse
          </span>
        )}
      </Row>
    </Card>
  )
}

// ─── Card 3: Sending protection (preset + rate/burst/ceilings) ────────────
//
// The single knob that matters. A named profile sets all four numbers and
// locks them; Custom unlocks per-number tuning. Solo / single-contact sending
// is never slowed — these only engage under cross-contact concurrency
// (the cross-contact micro-gap) or sustained volume (the token bucket + caps).

function PacingCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const mode = ((instance as unknown as { pacing_mode?: string }).pacing_mode ?? 'balanced') as
    'conservative' | 'balanced' | 'aggressive' | 'custom'
  const isCustom = mode === 'custom'
  const presetDefault = PROTECTION_PRESETS[mode === 'custom' ? 'balanced' : mode]

  // Effective live values. Under a named preset the server keeps these columns
  // in sync with the profile, so the instance columns ARE the truth either way.
  const rate   = (instance as unknown as { send_rate_per_min?: number }).send_rate_per_min ?? presetDefault.rate
  const burst  = instance.minute_burst_cap ?? presetDefault.burst
  const hourly = instance.hourly_send_cap  ?? presetDefault.hourly
  const daily  = instance.daily_send_cap   ?? presetDefault.daily

  return (
    <Card
      title="Protection d'envoi"
      eyebrow="ENVELOPPE DE RISQUE DE BANNISSEMENT"
      accent="warm"
      help="Un agent qui parle à un seul contact envoie toujours instantanément. Ces limites ne s'activent que lorsque des agents envoient à différents contacts en même temps, ou lorsque le volume soutenu approche du plafond."
    >
      <Row>
        <RowLabel>Profil</RowLabel>
        <Segmented
          value={mode}
          options={[
            { value: 'conservative', label: 'Conservateur' },
            { value: 'balanced',     label: 'Équilibré' },
            { value: 'aggressive',   label: 'Agressif' },
            { value: 'custom',       label: 'Personnalisé' },
          ]}
          onChange={(v) => set.mutate({ pacing_mode: v as 'conservative'|'balanced'|'aggressive'|'custom' })}
          disabled={set.isPending}
          size="sm"
        />
      </Row>

      <div className="mt-1.5 rounded-xl border border-ant-orange/20 bg-ant-orange/5 px-3.5 py-2.5">
        <div className="text-[13px] text-ant-ink">
          ≈ <strong>{rate} messages/min</strong> sur l'ensemble des agents avant que le numéro ne ralentisse de lui-même.
        </div>
        <div className="font-mono text-[12px] text-ant-mid mt-0.5">
          rafale {burst} · plafonds {hourly}/h · {daily}/jour
          {!isCustom && <> · <span className="text-ant-mid/70">{presetDefault.blurb}</span></>}
        </div>
      </div>

      <PacingInput
        label="Cadence" unit="msgs/min" value={rate} preset={presetDefault.rate} disabled={!isCustom} clearable={false}
        onChange={(v) => set.mutate({ send_rate_per_min: v ?? presetDefault.rate })} />
      <PacingInput
        label="Rafale" unit="msgs" value={burst} preset={presetDefault.burst} disabled={!isCustom} clearable={false}
        onChange={(v) => set.mutate({ minute_burst_cap: v ?? presetDefault.burst })} />
      <PacingInput
        label="Plafond horaire" unit="msgs/h" value={hourly} preset={presetDefault.hourly} disabled={!isCustom} clearable={false}
        onChange={(v) => set.mutate({ hourly_send_cap: v ?? presetDefault.hourly })} />
      <PacingInput
        label="Plafond quotidien" unit="msgs/jour" value={daily} preset={presetDefault.daily} disabled={!isCustom} clearable={false}
        onChange={(v) => set.mutate({ daily_send_cap: v ?? presetDefault.daily })} />
    </Card>
  )
}

// ─── Card 4: Humanization (typing + read receipts) ────────────────────────

function HumanizationCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  return (
    <Card
      title="Humanisation"
      eyebrow="SAISIE & ACCUSÉS DE LECTURE"
      accent="cool"
      help="L'apparence du point de contrôle quand il agit — pré-saisie + moment où les coches bleues se déclenchent."
    >
      <Row>
        <RowLabel>Pré-saisie</RowLabel>
        <Toggle
          checked={instance.typing_enabled}
          onChange={(v) => set.mutate({ typing_enabled: v })}
          disabled={set.isPending}
          rightLabel={instance.typing_enabled ? 'Activée' : 'Désactivée'}
          tone={instance.typing_enabled ? 'natural' : 'warm'}
        />
      </Row>
      <PacingInput label="Base" unit="ms" value={instance.typing_base_ms} preset={2000}
        onChange={(v) => set.mutate({ typing_base_ms: v ?? 2000 })} clearable={false} />
      <PacingInput label="Par caractère" unit="ms" value={instance.typing_per_char_ms} preset={60}
        onChange={(v) => set.mutate({ typing_per_char_ms: v ?? 60 })} clearable={false} />
      <PacingInput label="Plafond" unit="ms" value={instance.typing_cap_ms} preset={12000}
        onChange={(v) => set.mutate({ typing_cap_ms: v ?? 12000 })} clearable={false} />

      <Row>
        <RowLabel>Accusés de lecture</RowLabel>
        <Segmented
          value={instance.read_receipts_mode}
          options={[
            { value: 'off',          label: 'Désactivés' },
            { value: 'on_open',      label: "À l'ouverture" },
            { value: 'on_dispatch',  label: 'À la réponse' },
          ]}
          onChange={(v) => set.mutate({ read_receipts_mode: v as 'off'|'on_open'|'on_dispatch' })}
          disabled={set.isPending}
        />
      </Row>
    </Card>
  )
}

// ─── Card 5: Live State (full-width below the KPI grid) ───────────────────

function LiveStateCard({ live, instance }: {
  live: { last_dispatched_at: string|null; last_completed_at: string|null; last_send_at: string|null;
          sends_last_min: number; queue_queued: number; queue_dispatching: number; queue_dead_24h: number } | null
  instance: WhatsappInstance
}) {
  // Tiny ticker so "x s ago" updates without refetching.
  const [, force] = useState(0)
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(id) }, [])

  const idle = (live?.queue_queued ?? 0) === 0 && (live?.queue_dispatching ?? 0) === 0
  return (
    <SectionBlock title="État en direct" sub="Instantané à la seconde de ce que fait le point de contrôle en ce moment.">
      <RateMeter sendsLastMin={live?.sends_last_min ?? 0} instance={instance} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
        <MetricTile eyebrow="Dernière distribution" value={live?.last_dispatched_at ? formatRelative(live.last_dispatched_at) : '—'} />
        <MetricTile eyebrow="Dernier achèvement" value={live?.last_completed_at ? formatRelative(live.last_completed_at) : '—'} />
        <MetricTile eyebrow="Dernier envoi" value={live?.last_send_at ? formatRelative(live.last_send_at) : '—'} />
        <MetricTile eyebrow="En file"      value={live?.queue_queued      ?? 0} tone={live && live.queue_queued      > 0 ? 'cool'   : undefined} />
        <MetricTile eyebrow="En distribution" value={live?.queue_dispatching ?? 0} tone={live && live.queue_dispatching > 0 ? 'warm'   : undefined} />
        <MetricTile eyebrow="Abandonnés 24h"    value={live?.queue_dead_24h    ?? 0} tone={live && live.queue_dead_24h    > 0 ? 'warm'   : undefined} />
      </div>
      {idle && (
        <div className="text-[13px] text-ant-mid">
          Inactif — dernier achèvement {live?.last_completed_at ? formatRelative(live.last_completed_at) : 'jamais'} ; prêt pour le prochain envoi.
        </div>
      )}
    </SectionBlock>
  )
}

// Live "rate this minute vs cap" gauge. Makes the gate visible: green while
// under the per-minute rate, warm as it approaches, so an admin can SEE
// whether the protection is even engaging when they tune the profile.
function RateMeter({ sendsLastMin, instance }: { sendsLastMin: number; instance: WhatsappInstance }) {
  const rate = (instance as unknown as { send_rate_per_min?: number }).send_rate_per_min ?? 10
  const pct = Math.min(100, Math.round((sendsLastMin / Math.max(rate, 1)) * 100))
  const barColor = pct >= 100 ? 'bg-ant-rose' : pct >= 70 ? 'bg-ant-orange' : 'bg-ant-green'
  return (
    <div className="rounded-2xl border border-ant-line bg-ant-paper px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
          Cadence cette minute
        </span>
        <span className="font-mono text-[13px] text-ant-ink tabular-nums">
          {sendsLastMin} / {rate} par min
        </span>
      </div>
      <div className="h-2 rounded-full bg-ant-ink/[0.08] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-ant-mid">
        {pct >= 100 ? 'Au plafond — les envois supplémentaires sont étalés pour rester humains.' : 'Sous le plafond — les envois passent directement.'}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// IGF primitives — Card / Row / Toggle / Segmented / PacingInput
// Behavior identical to WA Mancer's inline-styled originals; presentation
// expressed in ant-* tokens.
// ──────────────────────────────────────────────────────────────────────────

const ACCENT_DOT: Record<'warm'|'cool'|'natural', string> = {
  warm: 'bg-ant-orange', cool: 'bg-ant-blue', natural: 'bg-ant-green',
}

function Card({ title, eyebrow, help, accent, children }: {
  title: string
  eyebrow: string
  help?: string
  /** Brand accent for the eyebrow — cycled per section (orange/blue/green). */
  accent?: 'warm' | 'cool' | 'natural'
  children: React.ReactNode
}) {
  return (
    <article className="rounded-2xl border border-ant-line bg-ant-paper p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-10">
      <div className="md:w-72 shrink-0 space-y-2">
        <span className="inline-flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid leading-relaxed">
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', accent ? ACCENT_DOT[accent] : 'bg-ant-ink')} />
          {eyebrow}
        </span>
        <h3 className="font-display text-[17px] tracking-tight text-ant-ink">{title}</h3>
        {help && <p className="font-serif italic text-[13px] leading-relaxed text-ant-mid">{help}</p>}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </article>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-ant-line/60 last:border-b-0">
      {children}
    </div>
  )
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] text-ant-ink shrink-0">{children}</span>
}

function Toggle({ checked, onChange, disabled, rightLabel, tone }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  rightLabel?: string
  tone?: 'natural' | 'warm'
}) {
  const onClass = tone === 'warm' ? 'bg-ant-orange' : 'bg-ant-green'
  const labelClass = tone === 'warm' ? 'text-ant-orange' : 'text-ant-green'
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={cn(
          'relative inline-flex items-center w-12 h-7 rounded-full p-[3px] transition-colors shrink-0',
          checked ? onClass : 'bg-ant-ink/25',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span
          aria-hidden
          className="block w-[22px] h-[22px] rounded-full bg-white shadow-md transition-transform"
          style={{ transform: `translateX(${checked ? 20 : 0}px)` }}
        />
      </button>
      {rightLabel && (
        <span className={cn(
          'text-[11px] font-semibold uppercase tracking-wider',
          checked ? labelClass : 'text-ant-mid',
        )}>{rightLabel}</span>
      )}
    </span>
  )
}

function Segmented<T extends string>({ value, options, onChange, disabled, size }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  disabled?: boolean
  size?: 'sm' | 'lg'
}) {
  const pad = size === 'lg' ? 'px-5 py-3' : size === 'sm' ? 'px-3 py-2' : 'px-3.5 py-2'
  const fontSize = size === 'lg' ? 'text-[13px]' : 'text-[12px]'
  return (
    <div role="radiogroup" className="inline-flex flex-wrap p-[3px] rounded-xl bg-ant-ink/5 border border-ant-ink/10 gap-[3px]">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !disabled && !active && onChange(opt.value)}
            disabled={disabled}
            className={cn(
              'rounded-lg font-semibold whitespace-nowrap transition-all',
              pad, fontSize,
              active ? 'bg-white text-ant-ink shadow-sm' : 'bg-transparent text-ant-mid',
              disabled ? 'opacity-55 cursor-not-allowed' : active ? 'cursor-default' : 'cursor-pointer hover:text-ant-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function PacingInput({ label, unit, value, preset, onChange, step, clearable = true, disabled = false }: {
  label: string
  unit: string
  value: number | null
  preset: number
  onChange: (v: number | null) => void
  step?: number
  clearable?: boolean
  /** When true, render read-only. Used under a named preset (non-'custom')
   *  to lock the field to the server-derived value. */
  disabled?: boolean
}) {
  // Render-time sync — replaces the React.Compiler-rejected setState-in-effect.
  // Whenever the external `value` changes (e.g. after an RPC roundtrip),
  // adopt it as the new draft without going through useEffect.
  const [draft, setDraft] = useState<string>(value !== null && value !== undefined ? String(value) : '')
  const [seenValue, setSeenValue] = useState<number | null | undefined>(value)
  if (seenValue !== value) {
    setSeenValue(value)
    setDraft(value !== null && value !== undefined ? String(value) : '')
  }

  const isOverridden = value !== null && value !== undefined
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') { if (clearable) onChange(null); return }
    const n = Number(trimmed)
    if (Number.isFinite(n) && n >= 0) onChange(n)
    else setDraft(value !== null && value !== undefined ? String(value) : '')
  }

  return (
    <Row>
      <RowLabel>{label}</RowLabel>
      <span className="inline-flex items-center gap-3">
        <span className={cn(
          'inline-flex items-center gap-1.5 px-3 rounded-lg border',
          disabled ? 'border-ant-line bg-ant-ink/[0.04]' : 'border-ant-ink/15 bg-white',
        )}>
          <input
            type="number"
            inputMode="decimal"
            step={step ?? 1}
            value={draft}
            placeholder={String(preset)}
            disabled={disabled}
            readOnly={disabled}
            aria-label={`${label} (${unit})`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className={cn(
              'w-[72px] py-2 border-none bg-transparent font-mono text-[13px] text-right outline-none tabular-nums',
              disabled ? 'text-ant-mid cursor-not-allowed' : 'text-ant-ink',
            )}
          />
          <span className="font-mono text-[11px] text-ant-mid">{unit}</span>
        </span>
        <span className="min-w-[96px] text-right">
          {disabled ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ant-mid">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="block">
                <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Verrouillé
            </span>
          ) : isOverridden && clearable ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg border border-ant-orange/30 bg-ant-orange/[0.08] px-2.5 py-1 text-[11px] font-semibold text-ant-orange whitespace-nowrap cursor-pointer hover:bg-ant-orange/15 transition-colors"
            >Réinit. · {preset}{unit}</button>
          ) : (
            <span className="text-[11px] text-ant-mid whitespace-nowrap">défaut {preset}{unit}</span>
          )}
        </span>
      </span>
    </Row>
  )
}

// ─── KPI / MetricTile ─────────────────────────────────────────────────────

const TILE_TONE: Record<'warm'|'cool'|'natural', string> = {
  warm: 'text-ant-orange', cool: 'text-ant-blue', natural: 'text-ant-green',
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'warm' | 'cool' | 'natural' }) {
  return (
    <div className="bg-ant-paper p-4">
      <p className={cn('font-display text-[24px] font-semibold tabular-nums', tone ? TILE_TONE[tone] : 'text-ant-ink')}>
        {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
      </p>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ant-mid mt-1">{label}</p>
    </div>
  )
}

function MetricTile({ eyebrow, value, sub, tone }: { eyebrow: string; value: string | number; sub?: string; tone?: 'warm' | 'cool' | 'natural' }) {
  return (
    <div className="bg-ant-paper p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-ant-mid">{eyebrow}</div>
      <div className={cn('font-display text-[18px] font-semibold tabular-nums mt-1.5 truncate', tone ? TILE_TONE[tone] : 'text-ant-ink')}>
        {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
      </div>
      {sub && <div className="text-[11px] text-ant-mid mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

// ─── Card 6: Schedule (business hours + quiet hours override) ─────────────

function ScheduleCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const bh = (instance.business_hours ?? { tz: 'UTC', days: [1,2,3,4,5], open: '09:00', close: '17:00' }) as
    { tz: string; days: number[]; open: string; close: string }
  const dayLabels = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
  const override = instance.quiet_hours_override_until

  // Re-evaluate "is the override still active?" on a 30s tick. We can't read
  // Date.now() inline during render (React Compiler purity), so a state
  // ticker drives staleness. setInterval starts via useEffect; the initial
  // value is 0 which means "before first tick we assume override active if
  // present" — adopt the override eagerly so the UI never flashes "expired".
  const [nowMs, setNowMs] = useState<number>(0)
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const overrideActive = !!override && (nowMs === 0 || new Date(override).getTime() > nowMs)

  const toggleDay = (n: number) => {
    const next = bh.days.includes(n) ? bh.days.filter((d) => d !== n) : [...bh.days, n].sort()
    set.mutate({ business_hours: { ...bh, days: next } })
  }

  // Admin toggle: when off, dispatcher dispatches 24/7. Default OFF for new
  // instances. Existing instances backfilled to ON to preserve behavior.
  const enabled = ((instance as unknown as { business_hours_enabled?: boolean }).business_hours_enabled ?? false)
  const locked = !enabled

  const inputCls = (w: string) => cn(
    w, 'px-3 py-2 rounded-lg border border-ant-ink/15 bg-white text-[13px] text-ant-ink outline-none focus:border-ant-blue/50',
    locked && 'opacity-55 cursor-not-allowed',
  )

  return (
    <Card
      title="Horaire"
      eyebrow="FENÊTRE D'ACTIVITÉ"
      accent="cool"
      help={enabled
        ? "Le point de contrôle cesse d'envoyer en dehors de ces heures. Désactivez pour un envoi 24h/24 et 7j/7."
        : 'Horaire désactivé — le répartiteur envoie 24h/24 et 7j/7. Activez pour imposer une fenêtre quotidienne.'}
    >
      <Row>
        <RowLabel>Appliquer l'horaire</RowLabel>
        <Toggle
          checked={enabled}
          onChange={(v) => set.mutate({ business_hours_enabled: v })}
          disabled={set.isPending}
          rightLabel={enabled ? 'Activé' : 'Désactivé'}
          tone={enabled ? 'natural' : 'warm'}
        />
      </Row>
      <Row>
        <RowLabel>Fuseau horaire</RowLabel>
        <input
          defaultValue={bh.tz}
          disabled={locked}
          onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== bh.tz) set.mutate({ business_hours: { ...bh, tz: v } }) }}
          className={inputCls('w-40')}
        />
      </Row>
      <Row>
        <RowLabel>Ouverture</RowLabel>
        <input type="time"
          defaultValue={bh.open}
          disabled={locked}
          onBlur={(e) => { const v = e.currentTarget.value; if (v && v !== bh.open) set.mutate({ business_hours: { ...bh, open: v } }) }}
          className={inputCls('w-[110px]')}
        />
      </Row>
      <Row>
        <RowLabel>Fermeture</RowLabel>
        <input type="time"
          defaultValue={bh.close}
          disabled={locked}
          onBlur={(e) => { const v = e.currentTarget.value; if (v && v !== bh.close) set.mutate({ business_hours: { ...bh, close: v } }) }}
          className={inputCls('w-[110px]')}
        />
      </Row>
      <Row>
        <RowLabel>Jours</RowLabel>
        <span className="inline-flex flex-wrap gap-1.5">
          {dayLabels.map((d, i) => {
            const active = bh.days.includes(i)
            return (
              <button key={d} type="button" onClick={() => { if (!locked) toggleDay(i) }} disabled={locked}
                aria-pressed={active}
                className={cn(
                  'min-w-[38px] rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors',
                  active ? 'bg-ant-blue text-white' : 'bg-ant-ink/[0.06] text-ant-ink/60',
                  locked ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer',
                )}>{d}</button>
            )
          })}
        </span>
      </Row>
      <Row>
        <RowLabel>Dérogation heures calmes</RowLabel>
        <span className="inline-flex items-center gap-2">
          {overrideActive ? (
            <>
              <span className="text-[12px] font-semibold text-ant-green text-right">
                Active jusqu'au {new Date(override!).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => set.mutate({ quiet_hours_override_until: null })}
                className="text-[12px] text-ant-orange underline cursor-pointer bg-transparent border-none p-0"
              >effacer</button>
            </>
          ) : (
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.currentTarget.value
                if (!v) return
                const minutes = parseInt(v, 10)
                const until = new Date(Date.now() + minutes * 60_000).toISOString()
                set.mutate({ quiet_hours_override_until: until })
                e.currentTarget.value = ''
              }}
              className="w-44 px-3 py-2 rounded-lg border border-ant-ink/15 bg-white text-[13px] text-ant-ink outline-none cursor-pointer"
            >
              <option value="">Ajouter une dérogation…</option>
              <option value="60">+1 heure</option>
              <option value="180">+3 heures</option>
              <option value="480">+8 heures</option>
              <option value="1440">+24 heures</option>
            </select>
          )}
        </span>
      </Row>
    </Card>
  )
}

// ─── Card 7: WA Behavior (Evolution /settings/set) ────────────────────────

function WaBehaviorCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const push = usePushWaSettings(instance.id)
  return (
    <Card
      title="Comportement WhatsApp"
      eyebrow="OPTIONS CÔTÉ CONTACT"
      accent="natural"
      help="Comment ce numéro se comporte du côté WhatsApp. Le réglage enregistre la valeur ; Appliquer l'envoie à Evolution."
    >
      <Row>
        <RowLabel>Rejeter les appels entrants</RowLabel>
        <Toggle checked={instance.wa_reject_calls} onChange={(v) => set.mutate({ wa_reject_calls: v })} disabled={set.isPending} rightLabel={instance.wa_reject_calls ? 'Activé' : 'Désactivé'} tone="warm" />
      </Row>
      {instance.wa_reject_calls && (
        <Row>
          <RowLabel>Réponse auto sur appel rejeté</RowLabel>
          <input
            defaultValue={instance.wa_call_reply_text ?? ''}
            placeholder="Désolé, les appels ne sont pas surveillés…"
            onBlur={(e) => set.mutate({ wa_call_reply_text: e.currentTarget.value || null })}
            className="w-56 px-3 py-2 rounded-lg border border-ant-ink/15 bg-white text-[13px] text-ant-ink outline-none focus:border-ant-green/50"
          />
        </Row>
      )}
      <Row>
        <RowLabel>Lecture auto des entrants</RowLabel>
        <Toggle checked={instance.wa_auto_read_inbound} onChange={(v) => set.mutate({ wa_auto_read_inbound: v })} disabled={set.isPending} rightLabel={instance.wa_auto_read_inbound ? 'Activée' : 'Désactivée'} />
      </Row>
      <Row>
        <RowLabel>Marquer les statuts comme vus</RowLabel>
        <Toggle checked={instance.wa_read_status} onChange={(v) => set.mutate({ wa_read_status: v })} disabled={set.isPending} rightLabel={instance.wa_read_status ? 'Activé' : 'Désactivé'} />
      </Row>
      <Row>
        <RowLabel>Ignorer entièrement les groupes</RowLabel>
        <Toggle checked={instance.wa_ignore_groups} onChange={(v) => set.mutate({ wa_ignore_groups: v })} disabled={set.isPending} rightLabel={instance.wa_ignore_groups ? 'Activé' : 'Désactivé'} tone="warm" />
      </Row>
      <Row>
        <RowLabel>Synchroniser tout l'historique à la resynchro</RowLabel>
        <Toggle checked={instance.wa_sync_full_history} onChange={(v) => set.mutate({ wa_sync_full_history: v })} disabled={set.isPending} rightLabel={instance.wa_sync_full_history ? 'Activé' : 'Désactivé'} />
      </Row>
      <div className="mt-2 pt-4 border-t border-ant-line/60 flex justify-end">
        <button type="button" onClick={() => push.mutate()} disabled={push.isPending} className={btnPush}>
          {push.isPending ? 'Application…' : push.isSuccess ? 'Appliqué' : 'Appliquer à WhatsApp'}
        </button>
      </div>
    </Card>
  )
}

// ─── Card 8: WA Profile push ──────────────────────────────────────────────

function WaProfileCard({ instance }: { instance: WhatsappInstance }) {
  const push = usePushWaProfile(instance.id)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  // 5 MB hard cap mirrors the edge function's MAX_PICTURE_BYTES so we fail
  // fast client-side rather than after a wasted round trip.
  const MAX_BYTES = 5 * 1024 * 1024

  // NOTE: picture push REQUIRES the IGF-patched Evolution build
  // (igf-wa/evolution-api:2.3.7-igf1+). Stock 2.3.7's updateProfilePicture
  // ends with reloadConnection() — a second socket spawns while the first is
  // alive, they fight (conflict:replaced) and WhatsApp unlinks the device.
  // The patch removes that reload (see box stack/evolution-src IGF PATCH).
  //
  // SQUARE-CROP INVARIANT (2026-07-06): every avatar URL in the WA UI is
  // assumed SQUARE (WA Mancer's avatars always came from WhatsApp's CDN,
  // which stores a 640×640 center crop — Baileys crops on upload). Our edge
  // fn persists the EXACT picked bytes to R2, so a portrait file used to land
  // uncropped and squashed in every renderer without object-fit (voice-note
  // bubbles, sidebar instance avatar). Center-crop to 640×640 here, BEFORE
  // the push — also WYSIWYG with what WhatsApp itself will show.
  const squareCrop = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - side) / 2
        const sy = (img.naturalHeight - side) / 2
        const out = Math.min(side, 640)
        const canvas = document.createElement('canvas')
        canvas.width = out
        canvas.height = out
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas')); return }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
      img.src = url
    })

  const onPick = (file: File) => {
    setPickError(null)
    if (!file.type.startsWith('image/')) { setPickError('Choisissez un fichier image'); return }
    if (file.size > MAX_BYTES) { setPickError('Image trop volumineuse (max 5 Mo)'); return }
    squareCrop(file)
      .then((dataUrl) => push.mutate({ fields: ['picture'], pictureDataUrl: dataUrl }))
      .catch(() => setPickError('Impossible de lire le fichier'))
  }

  return (
    <Card
      title="Profil visible par les contacts"
      eyebrow="CE QUE VOIENT LES CONTACTS"
      accent="natural"
      help="La photo de profil visible par toute personne qui contacte ce numéro. Le changement est appliqué immédiatement."
    >
      <Row>
        <RowLabel>Nom affiché</RowLabel>
        <span className="text-[12px] text-ant-mid text-right">{instance.wa_profile_name ?? '—'}</span>
      </Row>
      <Row>
        <RowLabel>Photo de profil</RowLabel>
        <span className="inline-flex items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPick(f)
              // Reset so picking the same filename again still fires onChange.
              e.target.value = ''
            }}
          />
          {/* Wrapper exists so the camera badge can sit OUTSIDE the button's
              `overflow: hidden` (which clips the round image). The badge is
              a sibling of the button, positioned absolutely against this
              wrapper, so it appears bottom-right of the avatar, not on top. */}
          <span className="relative inline-block w-12 h-12">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={push.isPending}
              title="Changer la photo de profil"
              className={cn(
                'w-12 h-12 rounded-full border border-ant-ink/[0.12] overflow-hidden p-0 grid place-items-center',
                instance.profile_pic_url ? 'bg-transparent' : 'bg-ant-ink/[0.04]',
                push.isPending ? 'cursor-wait' : 'cursor-pointer',
              )}
            >
              {instance.profile_pic_url
                ? <img src={instance.profile_pic_url} alt="" draggable={false} className="w-full h-full object-cover" />
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(20,20,19,0.45)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="9" r="3.5" />
                    <path d="M5 20a7 7 0 0 1 14 0" />
                  </svg>}
            </button>
            <span
              aria-hidden
              className="absolute -right-[3px] -bottom-[3px] w-5 h-5 rounded-full bg-ant-orange border-2 border-white grid place-items-center text-white shadow-sm pointer-events-none"
            >
              {/* Camera glyph — clearer "change photo" affordance than a +. */}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="block">
                <path
                  d="M4 8 L8 8 L9.5 5.5 L14.5 5.5 L16 8 L20 8 A1.5 1.5 0 0 1 21.5 9.5 L21.5 17.5 A1.5 1.5 0 0 1 20 19 L4 19 A1.5 1.5 0 0 1 2.5 17.5 L2.5 9.5 A1.5 1.5 0 0 1 4 8 Z"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                />
                <circle cx="12" cy="13.5" r="3" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={push.isPending}
              className="text-[13px] text-ant-orange underline text-left cursor-pointer bg-transparent border-none p-0"
            >
              {push.isPending && push.variables && 'pictureDataUrl' in ((push.variables as PushWaProfileArgs) ?? {})
                ? 'Téléversement…'
                : instance.profile_pic_url ? 'Changer la photo' : 'Choisir une photo'}
            </button>
            {pickError && <span className="text-[11px] text-ant-rose">{pickError}</span>}
            {push.isSuccess && !push.isPending && !pickError && <span className="text-[11px] text-ant-green">Photo mise à jour</span>}
          </span>
        </span>
      </Row>
    </Card>
  )
}

// ─── Ops tools — webhook re-sync (full-width) ─────────────────────────────

function OpsCard({ instance }: { instance: WhatsappInstance }) {
  const resync = useResyncWebhookSubscription(instance.id)
  return (
    <SectionBlock title="Outils d'exploitation" sub="Boutons de secours opérationnels.">
      <div className="flex gap-3 flex-wrap">
        <button type="button" onClick={() => resync.mutate()} disabled={resync.isPending} className={btnPush}>
          {resync.isPending ? 'Resynchronisation…' : resync.isSuccess ? 'Resynchronisé' : 'Resynchroniser l\'abonnement webhook'}
        </button>
      </div>
    </SectionBlock>
  )
}

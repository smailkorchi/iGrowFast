// /whatsapp/numbers/:id — CONFIG page for one WhatsApp instance.
//
// IGF simplification (owner ruling 2026-07-08): the donor's "chokepoint
// cockpit" (live dispatcher state, rate meter, KPI grids, library/reliability
// stats, watchdog, presence override, custom pacing, ops rescue tools) is
// fleet-operator territory — stripped from the admin surface. What remains is
// exactly the admin-controllable config: cadence tier, protection profile
// (named presets only), humanization, activity window, call rejection, and
// the profile photo — plus the lifecycle actions (pair / disconnect /
// restart / delete). Send mechanics are untouched: every removed control
// keeps its DB column and worker behavior; it just isn't admin-visible.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useDisconnectInstance,
  useInstance,
  usePushWaProfile,
  usePushWaSettings,
  useRestartInstance,
  useSetInstanceSettings,
} from '../../lib/queries/instances'
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
  // instance realtime rides the unified wa:biz channel (AdminWaRealtime wrapper).
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { data: instance, isLoading } = useInstance(id ?? null)

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
                Votre numéro
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
            <div className="flex flex-wrap items-center gap-2">
              {(instance.status === 'pending' || instance.status === 'disconnected' || instance.status === 'error') && (
                <button type="button" className={btnPrimary} onClick={() => setPairOpen(true)}>Connecter le numéro</button>
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
                  La déconnexion <strong>dissocie</strong> cet appareil de WhatsApp — il faudra <strong>rescanner le QR code</strong> pour le reconnecter. Elle ne fait pas que suspendre la connexion.
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

        {/* ── The guided dossier — four chapters, ordered the way a shop
               owner thinks: the storefront, the opening hours, the human
               touch, the number's safety. ─────────────────────────────── */}
        <div className="space-y-12 pt-4 pb-8">
          <Chapter
            n="01"
            title="Votre vitrine"
            story="La première impression : la photo que vos clients voient, et l'accueil réservé à ceux qui appellent."
          >
            <WaProfileCard instance={instance} />
            <WaBehaviorCard instance={instance} />
          </Chapter>

          <Chapter
            n="02"
            title="Vos horaires"
            story="Comme une boutique, ce numéro peut avoir des heures d'ouverture — en dehors, les messages attendent sagement."
          >
            <ScheduleCard instance={instance} />
          </Chapter>

          <Chapter
            n="03"
            title="Une présence humaine"
            story="Votre numéro écrit « en train d'écrire… », prend le temps de taper, et lit les messages comme une vraie personne."
          >
            <HumanizationCard instance={instance} />
          </Chapter>

          <Chapter
            n="04"
            title="La protection du numéro"
            story="WhatsApp se méfie des envois de robot. Ces deux réglages font passer votre numéro pour ce qu'il est : une équipe qui travaille."
          >
            <OperationalCard instance={instance} />
            <PacingCard instance={instance} />
          </Chapter>
        </div>
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

// A numbered chapter of the dossier: ghost numeral in the left margin
// (editorial mark, stacks above on mobile), a short orange rule, the chapter
// title, and ONE serif-italic story sentence that explains the section to a
// non-technical reader before any control appears.
function Chapter({ n, title, story, children }: {
  n: string; title: string; story: string; children: React.ReactNode
}) {
  return (
    <section className="grid lg:grid-cols-[84px_minmax(0,1fr)] gap-x-6 gap-y-2">
      <div aria-hidden className="select-none leading-none -mb-2 lg:mb-0 lg:pt-1 lg:text-right">
        <span className="font-display text-[44px] lg:text-[56px] font-semibold tracking-[-0.05em] text-ant-ink/[0.09]">
          {n}
        </span>
      </div>
      <div className="space-y-4 min-w-0">
        <header className="space-y-2 max-w-2xl">
          <div className="h-[2px] w-10 rounded-full bg-ant-orange" />
          <h2 className="font-display text-[21px] tracking-[-0.01em] text-ant-ink">{title}</h2>
          <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid m-0">{story}</p>
        </header>
        {children}
      </div>
    </section>
  )
}
//
// ─── Card 1: Cadence tier ─────────────────────────────────────────────────
// (IGF trim 2026-07-08: the Répartiteur pause toggle and the hero
// WatchdogToggle left the admin surface — worker_paused / auto_reconnect
// stay honored server-side.)

function OperationalCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const lifecycle = instance.lifecycle_state as 'warming' | 'established' | 'cooling' | 'banned'
  return (
    <Card
      title="Palier de cadence"
      eyebrow="L'ÂGE DU NUMÉRO"
      accent="warm"
      help="Un numéro récent doit commencer doucement, comme un nouvel employé. Laissez « En chauffe » pendant le premier mois, passez à « Établi » ensuite. « En refroidissement » sert à reposer un numéro qui a trop envoyé."
    >
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

// ─── Card 2: Sending protection (named presets only) ──────────────────────
//
// IGF trim 2026-07-08: the 'Personnalisé' mode + per-number tuning inputs
// left the admin surface — named profiles only. The server-side CASE in
// whatsapp.set_instance_settings still accepts 'custom' (untouched); a
// legacy 'custom' instance simply shows no selected profile until the admin
// picks one. Solo / single-contact sending is never slowed — these limits
// only engage under cross-contact concurrency or sustained volume.

function PacingCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const mode = ((instance as unknown as { pacing_mode?: string }).pacing_mode ?? 'balanced') as
    'conservative' | 'balanced' | 'aggressive' | 'custom'
  const presetDefault = PROTECTION_PRESETS[mode === 'custom' ? 'balanced' : mode]

  // Effective live values. Under a named preset the server keeps these columns
  // in sync with the profile, so the instance columns ARE the truth either way.
  const rate   = (instance as unknown as { send_rate_per_min?: number }).send_rate_per_min ?? presetDefault.rate
  const burst  = instance.minute_burst_cap ?? presetDefault.burst
  const hourly = instance.hourly_send_cap  ?? presetDefault.hourly
  const daily  = instance.daily_send_cap   ?? presetDefault.daily

  return (
    <Card
      title="Profil d'envoi"
      eyebrow="CONTRE LE BANNISSEMENT"
      accent="warm"
      help="La vitesse maximale d'envoi quand plusieurs vendeurs écrivent en même temps. Un vendeur seul avec son client n'est jamais ralenti. Dans le doute : Équilibré."
    >
      <Row>
        <RowLabel>Profil</RowLabel>
        <Segmented
          value={mode}
          options={[
            { value: 'conservative', label: 'Conservateur' },
            { value: 'balanced',     label: 'Équilibré' },
            { value: 'aggressive',   label: 'Agressif' },
          ]}
          onChange={(v) => set.mutate({ pacing_mode: v as 'conservative'|'balanced'|'aggressive' })}
          disabled={set.isPending}
          size="sm"
        />
      </Row>

      <div className="mt-1.5 rounded-xl border border-ant-orange/20 bg-ant-orange/5 px-3.5 py-2.5">
        <div className="text-[13px] text-ant-ink">
          Environ <strong>{rate} messages par minute</strong>, tous vendeurs confondus — au-delà, le numéro
          espace les envois tout seul.
        </div>
        <div className="text-[12px] text-ant-mid mt-0.5">
          Jusqu'à {burst} d'un coup · maximum {hourly}/heure · {daily}/jour
          {mode !== 'custom' && <> · <span className="text-ant-mid/70">{presetDefault.blurb}</span></>}
        </div>
      </div>
    </Card>
  )
}

// ─── Card 4: Humanization (typing + read receipts) ────────────────────────

function HumanizationCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const receiptCaption: Record<'off'|'on_open'|'on_dispatch', string> = {
    off:         "Les coches bleues ne s'affichent jamais chez le client.",
    on_open:     "Coches bleues dès qu'un vendeur ouvre la conversation.",
    on_dispatch: "Coches bleues seulement au moment où un vendeur répond.",
  }
  return (
    <Card
      title="Humanisation"
      eyebrow="ÉCRIRE COMME UNE PERSONNE"
      accent="cool"
      help="Avant chaque message, le client voit « en train d'écrire… » pendant un temps réaliste : un temps de base, plus un petit délai par caractère tapé, sans jamais dépasser le plafond. Les durées sont en millisecondes : 1000 ms = 1 seconde."
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
      <div className="text-[12px] text-ant-mid text-right -mt-1">
        {receiptCaption[instance.read_receipts_mode as 'off'|'on_open'|'on_dispatch'] ?? ''}
      </div>
    </Card>
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
    if (trimmed === '') {
      if (clearable) onChange(null)
      else setDraft(value !== null && value !== undefined ? String(value) : '')
      return
    }
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
            >Réinit. · {preset} {unit}</button>
          ) : (
            <span className="text-[11px] text-ant-mid whitespace-nowrap">par défaut : {preset} {unit}</span>
          )}
        </span>
      </span>
    </Row>
  )
}

// ─── Card 4: Schedule (business hours + quiet hours override) ─────────────

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
  // Also locked while a save is in flight: business_hours is written as ONE
  // object spread from cache — a second edit before the refetch would
  // silently revert the first.
  const locked = !enabled || set.isPending

  const inputCls = (w: string) => cn(
    w, 'px-3 py-2 rounded-lg border border-ant-ink/15 bg-white text-[13px] text-ant-ink outline-none focus:border-ant-blue/50',
    locked && 'opacity-55 cursor-not-allowed',
  )

  // Curated timezone choices — a raw IANA text field is a trap for
  // non-technical admins. The current value is always present so nothing
  // stored ever disappears from the select.
  const TZ_LABELS: Record<string, string> = {
    'Africa/Casablanca': 'Casablanca (Maroc)',
    'Europe/Paris':      'Paris (France)',
    'Europe/Madrid':     'Madrid (Espagne)',
    'UTC':               'Heure internationale (UTC)',
  }
  const TZ_CHOICES = Object.keys(TZ_LABELS)
  const tzOptions = TZ_CHOICES.includes(bh.tz) ? TZ_CHOICES : [bh.tz, ...TZ_CHOICES]

  return (
    <Card
      title="Horaire"
      eyebrow="HEURES D'OUVERTURE"
      accent="cool"
      help={enabled
        ? "En dehors de ces heures, les envois sont mis en attente — rien n'est perdu, tout part à l'ouverture."
        : 'Horaire désactivé — le numéro envoie 24h/24 et 7j/7. Activez pour définir des heures d\'ouverture.'}
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
        <select
          value={bh.tz}
          disabled={locked}
          onChange={(e) => { const v = e.currentTarget.value; if (v && v !== bh.tz) set.mutate({ business_hours: { ...bh, tz: v } }) }}
          className={inputCls('w-48 cursor-pointer')}
        >
          {tzOptions.map((tz) => <option key={tz} value={tz}>{TZ_LABELS[tz] ?? tz}</option>)}
        </select>
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
                Active jusqu'au {new Date(override!).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
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
              disabled={locked}
              onChange={(e) => {
                const v = e.currentTarget.value
                if (!v) return
                const minutes = parseInt(v, 10)
                const until = new Date(Date.now() + minutes * 60_000).toISOString()
                set.mutate({ quiet_hours_override_until: until })
                e.currentTarget.value = ''
              }}
              className={inputCls('w-44 cursor-pointer')}
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

// ─── Card 5: WA Behavior (Evolution /settings/set) ────────────────────────
// IGF trim 2026-07-08: only call rejection is admin-facing. The other
// Evolution flags (auto-read, read-status, ignore-groups, sync-full-history)
// left the surface — their columns + push path are untouched. Removing the
// full-history toggle also protects the one-week sync rule from being
// re-enabled per instance.

function WaBehaviorCard({ instance }: { instance: WhatsappInstance }) {
  const set = useSetInstanceSettings(instance.id)
  const push = usePushWaSettings(instance.id)
  return (
    <Card
      title="Appels"
      eyebrow="QUAND UN CLIENT APPELLE"
      accent="natural"
      help="Ce numéro sert à écrire, pas à téléphoner. En rejetant les appels, vous pouvez laisser un petit message d'excuse automatique. Réglez, puis « Appliquer à WhatsApp »."
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
            placeholder="Désolé, nous ne prenons pas les appels sur ce numéro — écrivez-nous ici."
            onBlur={(e) => set.mutate({ wa_call_reply_text: e.currentTarget.value || null })}
            className="w-56 px-3 py-2 rounded-lg border border-ant-ink/15 bg-white text-[13px] text-ant-ink outline-none focus:border-ant-green/50"
          />
        </Row>
      )}
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
      title="Photo de profil"
      eyebrow="CE QUE VOIENT LES CLIENTS"
      accent="natural"
      help="La photo qui apparaît chez chaque client, dans sa liste de discussions. Le changement est immédiat pour tout le monde."
    >
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
                ? 'Envoi de la photo…'
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


// Pacing math. Pure functions, no I/O — fully unit-testable. Token-bucket era:
// only the cross-contact micro-gap and the typing pre-roll remain live.

// ---- Sampling ---------------------------------------------------------------

/** Box-Muller standard normal. */
function randn(): number {
  let u1 = 0, u2 = 0
  while (u1 === 0) u1 = Math.random()  // avoid log(0)
  while (u2 === 0) u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ---- Cross-contact micro-gap ------------------------------------------------
//
// The ONLY short-term humanization left. Models the ban bullet the product
// actually faces: multiple agents on ONE number firing to DIFFERENT contacts
// in the same instant. We never slow a single agent talking to a single
// contact — that is exactly real-WhatsApp behaviour and the lowest-risk
// pattern there is. We only insert a gap when the number switches to a
// DIFFERENT contact while a previous send is still "fresh" (active
// contention). Same-contact rapid-fire and idle-then-send both pass instantly;
// the token bucket (pacing_take_token RPC) handles any sustained-rate ceiling.

/** Below this elapsed time since the number's last send, a switch to a
 *  different contact counts as active contention and earns a gap. Past it the
 *  number is effectively idle and the next send goes immediately. */
const CONTENTION_WINDOW_MS = 8_000
/** Cross-contact gap is sampled uniformly in this range (jittered, never a
 *  fixed metronome). Anchored to observed human chat-switching cadence and the
 *  Baileys new-chat delay guidance (~1.5–3s, tail to ~4s). */
const CROSS_CONTACT_MIN_MS = 1_500
const CROSS_CONTACT_MAX_MS = 4_000

export interface CrossContactInputs {
  now: Date
  /** number_pacing_state.last_send_at — when this number last sent content. */
  numberLastSendAt: Date | null
  /** number_pacing_state.last_send_conversation_id — who that send went to. */
  numberLastSendConversationId: string | null
  /** The conversation this send is going to. */
  thisConversationId: string
  /** Only content sends are gapped; passive presence/read bypass entirely. */
  isContentSend: boolean
}

export interface CrossContactDecision {
  waitMs: number
  reason: 'no_wait' | 'idle' | 'same_contact' | 'cross_contact'
}

/**
 * Compute the cross-contact humanization gap. Returns 0 in every case except a
 * genuine fast switch between two different contacts on the same number.
 */
export function crossContactGap(input: CrossContactInputs): CrossContactDecision {
  if (!input.isContentSend) return { waitMs: 0, reason: 'no_wait' }
  if (!input.numberLastSendAt) return { waitMs: 0, reason: 'idle' }

  const elapsed = input.now.getTime() - input.numberLastSendAt.getTime()
  if (elapsed >= CONTENTION_WINDOW_MS) return { waitMs: 0, reason: 'idle' }

  // Same contact rapid-fire — instant (a human fires several bubbles into one
  // chat). The bucket bounds the extreme case.
  if (
    input.numberLastSendConversationId
    && input.numberLastSendConversationId === input.thisConversationId
  ) {
    return { waitMs: 0, reason: 'same_contact' }
  }

  // Different contact, still fresh → space it. Subtract time already elapsed so
  // a naturally-slow agent never waits the full gap on top of their own pace.
  const target = CROSS_CONTACT_MIN_MS + Math.random() * (CROSS_CONTACT_MAX_MS - CROSS_CONTACT_MIN_MS)
  const waitMs = Math.max(0, Math.round(target) - elapsed)
  return { waitMs, reason: waitMs === 0 ? 'no_wait' : 'cross_contact' }
}

// ---- Typing-presence pre-roll ----------------------------------------------

/**
 * How long the worker should show `composing` presence before a send-text /
 * send-media to make the reply look hand-typed. Per-instance configurable.
 *
 * Default behavior matches the old hardcoded math when the admin hasn't
 * touched the typing_* columns:
 *   2 s floor (base), +60 ms/char, +N(0.8 s, 0.4 s) gaussian noise.
 *   Capped at 12 s (longer feels staged).
 */
export interface TypingConfig {
  baseMs: number
  perCharMs: number
  capMs: number
}

export function typingDurationForText(
  text: string,
  cfg: TypingConfig = { baseMs: 2_000, perCharMs: 60, capMs: 12_000 },
): number {
  const noise = Math.round(800 + randn() * 400)
  const computed = Math.max(cfg.baseMs, text.length * cfg.perCharMs + noise)
  return Math.min(cfg.capMs, computed)
}

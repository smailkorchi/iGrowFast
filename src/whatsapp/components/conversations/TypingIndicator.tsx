// WhatsApp-style typing indicator.
//
// Two render modes:
//   - `bubble`  full incoming-style speech bubble with the 13×8 px tail at
//               the top-left (matching `.wac__bubble-wrap.is-streak-head.is-in`).
//               Default content: three bouncing dots (composing).
//               When `presence='recording'`: a microphone glyph with a slow
//               opacity pulse, matching real WhatsApp's "recording…" pill.
//   - `inline`  just the three dots for use in the chat-header subtitle.
//
// Animation curve: `cubic-bezier(0.45, 0.05, 0.55, 0.95)` — symmetric
// ease-in-out that simulates a ball-bounce: decelerating on the way up,
// accelerating on the way down, momentary apex pause.

import React from 'react'

interface Props {
  mode?: 'bubble' | 'inline'
  color?: string
  size?: number
  /** When 'recording' the bubble shows a pulsing mic instead of bouncing dots. */
  presence?: 'composing' | 'recording'
}

export function TypingIndicator({ mode = 'bubble', color, size, presence = 'composing' }: Props) {
  const isRecording = presence === 'recording'
  const dotSize = size ?? (mode === 'bubble' ? 7 : 5)
  const dotColor = color ?? (mode === 'bubble' ? 'rgba(200,210,215,0.95)' : 'var(--wa-green, #25d366)')
  const gap = mode === 'bubble' ? 5 : Math.round(dotSize * 0.7)

  const dots = (
    <span
      role="status"
      aria-label="typing"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        ...(mode === 'inline' ? { padding: 0, background: 'transparent' } : {}),
      }}
    >
      <span style={dotStyle(dotSize, dotColor, 0)} />
      <span style={dotStyle(dotSize, dotColor, 0.18)} />
      <span style={dotStyle(dotSize, dotColor, 0.36)} />
      <style>{KEYFRAMES_CSS}</style>
    </span>
  )

  if (mode === 'inline') return dots

  // Bubble mode: reproduce the exact WhatsApp incoming bubble — same
  // background token, same `--wa-r-bubble` radius, same tail geometry as a
  // streak-head incoming bubble (defined in conversations.css). The dots
  // float in the center of the bubble.
  //
  // We don't reuse `.wac__bubble` because it has min-width / max-width
  // tuned for text content; the typing pill needs its own compact box.
  return (
    <span style={typingBubbleWrapStyle}>
      <span style={typingBubbleTailStyle} aria-hidden />
      {isRecording ? <RecordingMic color={dotColor} /> : dots}
    </span>
  )
}

// Pulsing microphone glyph for the "recording…" state. Real WhatsApp uses a
// solid mic icon with a slow opacity breath (no scale, no color change) — the
// rest of the bubble stays static, only the icon fades between ~0.45 and 1.0.
function RecordingMic({ color }: { color: string }) {
  return (
    <span
      role="status"
      aria-label="recording"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        color,
        animation: 'wa-recording-pulse 1.4s ease-in-out infinite',
        willChange: 'opacity',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 14.5a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5.5a3 3 0 0 0 3 3Z" />
        <path d="M18.5 11.5a.9.9 0 0 0-1.8 0 4.7 4.7 0 0 1-9.4 0 .9.9 0 0 0-1.8 0 6.5 6.5 0 0 0 5.6 6.43V20H9.5a.9.9 0 0 0 0 1.8h5a.9.9 0 0 0 0-1.8h-1.6v-2.07a6.5 6.5 0 0 0 5.6-6.43Z" />
      </svg>
      <style>{RECORDING_KEYFRAMES_CSS}</style>
    </span>
  )
}

// ── Animation ──
// Custom property `--peak` lets us tune the apex per render if we want a
// taller bounce for groups vs DMs. Default 6 px matches WhatsApp's pixel
// measurement in the user's reference video.
const KEYFRAMES_CSS = `
@keyframes wa-typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.40;
  }
  30% {
    transform: translateY(-6px);
    opacity: 1.00;
  }
}
`

// Slow opacity breath for the recording mic. Lower bound 0.45 keeps the mic
// readable; upper bound 1.0 is full brightness. Symmetric in/out so it feels
// like a calm pulse, not a blink.
const RECORDING_KEYFRAMES_CSS = `
@keyframes wa-recording-pulse {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1.00; }
}
`

function dotStyle(size: number, color: string, delayS: number): React.CSSProperties {
  return {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    animation: `wa-typing-bounce 1.4s cubic-bezier(0.45, 0.05, 0.55, 0.95) ${delayS}s infinite both`,
    willChange: 'transform, opacity',
  }
}

// ── Bubble geometry ──
// Mirrors the streak-head incoming bubble:
//   border-radius:  7.5px on three corners, 0 on the top-left (where the tail meets)
//   tail:           8 × 13 px triangle clipped to a right-angle, positioned at
//                   top: 0; left: -8px so it tucks under the bubble's top-left corner
//   background:     `--wa-bubble-in` (same #1F1F1F as a regular incoming message)
const typingBubbleWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '11px 14px',
  borderRadius: 'var(--wa-r-bubble, 7.5px)',
  borderTopLeftRadius: 0,
  background: 'var(--wa-bubble-in, #1F1F1F)',
  boxShadow: 'var(--wa-shadow-bubble, 0 1px 0.5px rgba(0,0,0,0.13))',
  // Belt-and-braces — make sure the box can't grow past its content.
  width: 'fit-content',
}

const typingBubbleTailStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: -8,
  width: 8,
  height: 13,
  background: 'var(--wa-bubble-in, #1F1F1F)',
  clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
}

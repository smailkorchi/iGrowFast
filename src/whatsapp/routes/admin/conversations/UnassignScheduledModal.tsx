// Shared warning shown when an admin unassigns a user who has *pending* scheduled
// messages on the conversation. Used by both the conversation InfoPane (parts.tsx,
// inside the `.wac` scope) and the assignment routing console (Assignment.tsx,
// OUTSIDE `.wac`). Fully self-styled with inline colors so it renders identically
// regardless of scope — it must NOT depend on the `.wac`-scoped `--wa-*` CSS
// variables (those are undefined on the assignment page → invisible text).
// Popup background is #1A1A1A per the app's popup spec.
import type { CSSProperties } from 'react'

export function UnassignScheduledModal({
  userName, count, onCancel, onKeep, onDrop,
  // IGF ADDITION: bulk-unassign on the Assignment page reuses this modal for a
  // whole selection — the context phrase becomes plural. Default = donor copy.
  contextLabel = 'pour cette conversation',
}: { userName: string; count: number; onCancel: () => void; onKeep: () => void; onDrop: () => void; contextLabel?: string }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)',
          background: '#1A1A1A',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '18px 20px 0' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#e9edef' }}>
            Messages programmés en attente
          </span>
        </div>
        <div style={{ padding: '12px 20px 4px' }}>
          <p style={{ margin: 0, color: '#aebac1', lineHeight: 1.5, fontSize: 14 }}>
            <strong style={{ color: '#e9edef' }}>{userName}</strong> a{' '}
            <strong style={{ color: '#e9edef' }}>{count}</strong> message{count > 1 ? 's' : ''} programmé{count > 1 ? 's' : ''} {contextLabel}.
            En désassignant, voulez-vous aussi supprimer ces messages programmés, ou les conserver ?
            {' '}Conservés, ils seront tout de même envoyés à l'heure prévue.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '18px 20px 20px' }}>
          <button onClick={onCancel} style={btnStyle('#2a2a2a', '#e9edef')}>Annuler</button>
          <button onClick={onKeep} style={btnStyle('#2a2a2a', '#e9edef')}>Conserver</button>
          <button onClick={onDrop} style={btnStyle('#c62828', '#fff')}>Supprimer ({count})</button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(bg: string, color: string): CSSProperties {
  return {
    background: bg,
    color,
    border: 'none',
    borderRadius: 8,
    padding: '9px 16px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  }
}

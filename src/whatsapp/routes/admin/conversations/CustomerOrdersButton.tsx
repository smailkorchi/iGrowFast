// IGF ADDITION (e-commerce seam): chat-header customer order-history button
// + dropdown. Shared by the admin and seller inboxes via the ChatPane header
// (parts.tsx) — per-role behavior (which rows are clickable, which dialog a
// click opens) flows in through props from the two route components.
//
// Rendering rule: the parent only mounts this for phone-kind jids (groups,
// @lid and other non-phone jids never show the button).
import { useEffect, useRef, useState } from 'react'
import { Package } from 'lucide-react'
import {
  useCustomerOrdersCount,
  useCustomerOrdersPage,
  type CustomerOrderRow,
} from '../../../lib/queries/customerOrders'

export interface CustomerOrdersButtonProps {
  /** Digits of the conversation's remote_jid (canonical '212…'). */
  phoneDigits: string
  /** Open the role-appropriate order view dialog for this order id. */
  onViewOrder: (orderId: string) => void
  /**
   * Seller inbox: only rows whose seller_id equals this id are clickable
   * (null = restricted but the id hasn't loaded yet → nothing clickable).
   * Leave undefined in the admin inbox — every row is clickable.
   */
  restrictToSellerId?: string | null
}

export function CustomerOrdersButton({
  phoneDigits, onViewOrder, restrictToSellerId,
}: CustomerOrdersButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // COST RULE: this component only mounts with an open thread's header, so
  // the count never fires per conversation-list row.
  const countQ = useCustomerOrdersCount(phoneDigits)
  const count = countQ.data ?? 0
  const disabled = countQ.isLoading || count === 0

  // COST RULE: pages fetch only while the dropdown is open.
  const pageQ = useCustomerOrdersPage(phoneDigits, open)

  // Same outside-click / Escape mechanic as FilterChipRow.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Switching conversations swaps the phone under this component — close.
  useEffect(() => { setOpen(false) }, [phoneDigits])

  // Dedupe across pages: offset paging shifts when a new order lands between
  // fetches, so the same id can straddle two pages (duplicate React keys).
  const rows = Array.from(
    new Map((pageQ.data?.pages.flatMap((pg) => pg.rows) ?? []).map((r) => [r.id, r])).values(),
  )
  const title = disabled ? 'Aucune commande' : 'Commandes du client'

  return (
    <div className="wac__orders-anchor" ref={wrapRef}>
      <button
        type="button"
        className={'wac__icon-btn wac__orders-btn' + (open ? ' is-active' : '')}
        aria-label={title}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Package size={20} strokeWidth={1.8} />
        {count > 0 && (
          <span className="wac__orders-badge" aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="wac__orders-dropdown" role="menu" aria-label="Commandes du client">
          <div className="wac__orders-list">
            {pageQ.isLoading ? (
              <div className="wac__orders-note">Chargement…</div>
            ) : pageQ.isError ? (
              <div className="wac__orders-note">Impossible de charger les commandes.</div>
            ) : rows.length === 0 ? (
              <div className="wac__orders-note">Aucune commande</div>
            ) : (
              rows.map((row) => (
                <OrderRow
                  key={row.id}
                  row={row}
                  clickable={restrictToSellerId === undefined
                    ? true
                    : !!restrictToSellerId && row.seller_id === restrictToSellerId}
                  onOpen={() => { setOpen(false); onViewOrder(row.id) }}
                />
              ))
            )}
            {pageQ.hasNextPage && (
              <button
                type="button"
                className="wac__orders-more"
                disabled={pageQ.isFetchingNextPage}
                onClick={() => { void pageQ.fetchNextPage() }}
              >
                {pageQ.isFetchingNextPage ? 'Chargement…' : 'Voir plus'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function OrderRow({ row, clickable, onOpen }: {
  row: CustomerOrderRow
  clickable: boolean
  onOpen: () => void
}) {
  const extra = row.extra_items ?? 0
  return (
    <button
      type="button"
      role="menuitem"
      className={'wac__orders-row' + (clickable ? '' : ' is-locked')}
      title={clickable ? undefined : "Commande d'un autre vendeur"}
      aria-disabled={!clickable}
      onClick={clickable ? onOpen : undefined}
    >
      <span className="wac__orders-thumb" aria-hidden>
        {row.product_image
          ? <img src={row.product_image} alt="" loading="lazy" draggable={false} />
          : <Package size={18} strokeWidth={1.6} />}
        {extra > 0 && <span className="wac__orders-thumb-extra">+{extra}</span>}
      </span>
      <span className="wac__orders-main">
        <span className="wac__orders-name">{row.name || 'Commande'}</span>
        {row.product_name && <span className="wac__orders-product">{row.product_name}</span>}
        <span className="wac__orders-pills">
          <StatusPill label={row.order_status_label} color={row.order_status_color} />
          <StatusPill label={row.package_status_label} color={row.package_status_color} />
        </span>
      </span>
      <span className="wac__orders-side">
        <span className="wac__orders-price">{formatPrice(row.price)}</span>
        <span className="wac__orders-date">{formatOrderDate(row.order_date)}</span>
      </span>
    </button>
  )
}

// Same convention as the Orders pages: colored text over the status color at
// low alpha (colors are '#rrggbb'; '#6b7280' is the app-wide gray fallback).
function StatusPill({ label, color }: { label: string | null; color: string | null }) {
  if (!label) return null
  const c = color || '#6b7280'
  return (
    <span
      className="wac__orders-pill"
      style={{ color: c, backgroundColor: `${c}15` }}
      title={label}
    >
      {label}
    </span>
  )
}

function formatPrice(price: number | null): string {
  if (price == null) return '—'
  return `${Number(price).toLocaleString('fr-FR')} DH`
}

function formatOrderDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
}

// WhatsApp-style SVG icon set. All icons are stroked, 24×24 viewBox,
// currentColor stroke, sized via CSS width/height. No emoji glyphs anywhere.

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconNewChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="m20.5 3.5-9 9-1 3 3-1 9-9-2-2z" />
    </Svg>
  )
}

export function IconMenuDots(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5"  r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconLocationPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </Svg>
  )
}
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </Svg>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  )
}

export function IconChevronUp(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="6 15 12 9 18 15" />
    </Svg>
  )
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="18" y1="6"  x2="6" y2="18" />
      <line x1="6"  y1="6"  x2="18" y2="18" />
    </Svg>
  )
}

export function IconArrowBack(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </Svg>
  )
}

export function IconPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.5 8 6.5l-.5 4.5L4 14l3.5 3.5L11 14l4.5-.5L19.5 9.5z" />
      <line x1="11" y1="14" x2="4" y2="21" />
    </Svg>
  )
}

// WhatsApp's exact pin glyphs (filled), from the official ic-push-pin assets.
// Used by the message-pin feature so the glyph matches WhatsApp pixel-for-pixel
// and is consistent across bubble / menu / bar.
export function IconWaPin(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M16 5V12L17.7 13.7C17.8 13.8 17.875 13.9125 17.925 14.0375C17.975 14.1625 18 14.2917 18 14.425V15C18 15.2833 17.9042 15.5208 17.7125 15.7125C17.5208 15.9042 17.2833 16 17 16H13V21.85C13 22.1333 12.9042 22.3708 12.7125 22.5625C12.5208 22.7542 12.2833 22.85 12 22.85C11.7167 22.85 11.4792 22.7542 11.2875 22.5625C11.0958 22.3708 11 22.1333 11 21.85V16H7C6.71667 16 6.47917 15.9042 6.2875 15.7125C6.09583 15.5208 6 15.2833 6 15V14.425C6 14.2917 6.025 14.1625 6.075 14.0375C6.125 13.9125 6.2 13.8 6.3 13.7L8 12V5C7.71667 5 7.47917 4.90417 7.2875 4.7125C7.09583 4.52083 7 4.28333 7 4C7 3.71667 7.09583 3.47917 7.2875 3.2875C7.47917 3.09583 7.71667 3 8 3H16C16.2833 3 16.5208 3.09583 16.7125 3.2875C16.9042 3.47917 17 3.71667 17 4C17 4.28333 16.9042 4.52083 16.7125 4.7125C16.5208 4.90417 16.2833 5 16 5ZM8.85 14H15.15L14 12.85V5H10V12.85L8.85 14Z" />
    </Svg>
  )
}

export function IconWaPinSmall(p: IconProps) {
  return (
    <Svg {...p} viewBox="0 0 12 12" fill="currentColor" stroke="none">
      <path d="M7.79688 5.55L8.69688 6.45V7.35H6.44688V10.05L5.99688 10.5L5.54688 10.05V7.35H3.29688V6.45L4.19688 5.55V2.4H3.74688V1.5H8.24688V2.4H7.79688V5.55Z" />
    </Svg>
  )
}

export function IconWaUnpin(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M14.7125 4H10.7125V6.175L7.96251 3.425C7.87917 3.34167 7.81667 3.25 7.77501 3.15C7.73334 3.05 7.71251 2.95 7.71251 2.85C7.71251 2.63333 7.78751 2.4375 7.93751 2.2625C8.08751 2.0875 8.28751 2 8.53751 2H16.7125C16.9958 2 17.2333 2.09583 17.425 2.2875C17.6167 2.47917 17.7125 2.71667 17.7125 3C17.7125 3.26667 17.5917 3.45417 17.35 3.5625C17.1083 3.67083 16.8958 3.81667 16.7125 4V10C16.7125 10.2833 16.6167 10.5208 16.425 10.7125C16.2333 10.9042 15.9958 11 15.7125 11C15.4292 11 15.1917 10.9042 15 10.7125C14.8083 10.5208 14.7125 10.2833 14.7125 10V4ZM11.7125 21V15H8.11251C7.69584 15 7.36251 14.8542 7.11251 14.5625C6.86251 14.2708 6.73751 13.9417 6.73751 13.575C6.73751 13.3917 6.77501 13.2083 6.85001 13.025C6.92501 12.8417 7.04584 12.6667 7.21251 12.5L8.71251 11V9.85L2.81251 3.9C2.62917 3.71667 2.53334 3.4875 2.52501 3.2125C2.51667 2.9375 2.61251 2.7 2.81251 2.5C2.99584 2.31667 3.22917 2.225 3.5125 2.225C3.79584 2.225 4.02917 2.31667 4.21251 2.5L21.1875 19.475C21.3875 19.675 21.4833 19.9125 21.475 20.1875C21.4667 20.4625 21.3625 20.7 21.1625 20.9C20.9625 21.0833 20.7292 21.1792 20.4625 21.1875C20.1958 21.1958 19.9625 21.1 19.7625 20.9L13.8625 15H13.7125V21C13.7125 21.2833 13.6167 21.5208 13.425 21.7125C13.2333 21.9042 12.9958 22 12.7125 22C12.4292 22 12.1917 21.9042 12 21.7125C11.8083 21.5208 11.7125 21.2833 11.7125 21ZM9.56251 13H11.8625L10.7625 11.9L10.7125 11.85L9.56251 13Z" />
    </Svg>
  )
}

// Chat bubble with an unread-dot badge — ctx-menu "Marquer comme non lu".
export function IconUnreadBadge(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z" />
      <circle cx="12.5" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconMuted(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <line x1="22" y1="9"  x2="16" y2="15" />
      <line x1="16" y1="9"  x2="22" y2="15" />
    </Svg>
  )
}

export function IconCheckSingle(p: IconProps) {
  const { size = 22, ...rest } = p
  return (
    <svg width={size} height={size} viewBox="96 132 224 202" fill="currentColor" stroke="none" {...rest}>
      <polygon points="177.234,323.998 106.333,253.094 125.169,234.258 175.074,284.162 289.301,142.002 310.066,158.681" />
    </svg>
  )
}

export function IconCheckDouble(p: IconProps) {
  const { size = 22, ...rest } = p
  return (
    <svg width={size} height={size} viewBox="96 132 308 202" fill="currentColor" stroke="none" {...rest}>
      <polygon points="177.234,323.998 106.333,253.094 125.169,234.258 175.074,284.162 289.301,142.002 310.066,158.681" />
      <polygon points="260.821,323.998 226.284,289.458 243.067,268.566 258.664,284.162 372.903,142.002 393.667,158.681" />
    </svg>
  )
}

export function IconClock(p: IconProps) {
  const { size = 22, ...rest } = p
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={1.4} />
      <polyline points="8 5 8 8 10.5 9.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function IconMic(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="9"  y1="21" x2="15" y2="21" />
    </Svg>
  )
}

export function IconSend(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 12 18-8-7 18-2-8z" />
    </Svg>
  )
}

export function IconSmiley(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9"  cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    </Svg>
  )
}

// WhatsApp's composer "sticker-smiley" glyph (filled, exact WA path).
export function IconStickerSmiley({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
      <path d="M8.49893 10.2521C9.32736 10.2521 9.99893 9.5805 9.99893 8.75208C9.99893 7.92365 9.32736 7.25208 8.49893 7.25208C7.6705 7.25208 6.99893 7.92365 6.99893 8.75208C6.99893 9.5805 7.6705 10.2521 8.49893 10.2521Z" />
      <path d="M17.0011 8.75208C17.0011 9.5805 16.3295 10.2521 15.5011 10.2521C14.6726 10.2521 14.0011 9.5805 14.0011 8.75208C14.0011 7.92365 14.6726 7.25208 15.5011 7.25208C16.3295 7.25208 17.0011 7.92365 17.0011 8.75208Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M16.8221 19.9799C15.5379 21.2537 13.8087 21.9781 12 22H9.27273C5.25611 22 2 18.7439 2 14.7273V9.27273C2 5.25611 5.25611 2 9.27273 2H14.7273C18.7439 2 22 5.25611 22 9.27273V11.8141C22 13.7532 21.2256 15.612 19.8489 16.9776L16.8221 19.9799ZM14.7273 4H9.27273C6.36068 4 4 6.36068 4 9.27273V14.7273C4 17.6393 6.36068 20 9.27273 20H11.3331C11.722 19.8971 12.0081 19.5417 12.0058 19.1204L11.9935 16.8564C11.9933 16.8201 11.9935 16.784 11.9941 16.7479C11.0454 16.7473 10.159 16.514 9.33502 16.0479C8.51002 15.5812 7.84752 14.9479 7.34752 14.1479C7.24752 13.9479 7.25585 13.7479 7.37252 13.5479C7.48919 13.3479 7.66419 13.2479 7.89752 13.2479L13.5939 13.2479C14.4494 12.481 15.5811 12.016 16.8216 12.0208L19.0806 12.0296C19.5817 12.0315 19.9889 11.6259 19.9889 11.1248V9.07648H19.9964C19.8932 6.25535 17.5736 4 14.7273 4ZM14.0057 19.1095C14.0066 19.2605 13.9959 19.4089 13.9744 19.5537C14.5044 19.3124 14.9926 18.9776 15.4136 18.5599L18.4405 15.5576C18.8989 15.1029 19.2653 14.5726 19.5274 13.996C19.3793 14.0187 19.2275 14.0301 19.0729 14.0295L16.8138 14.0208C15.252 14.0147 13.985 15.2837 13.9935 16.8455L14.0057 19.1095Z" />
    </svg>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5"  y1="12" x2="19" y2="12" />
    </Svg>
  )
}

export function IconSticker(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 14V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9l-7 7H5a2 2 0 0 1-2-2z" />
      <path d="M14 21v-5a2 2 0 0 1 2-2h5" />
    </Svg>
  )
}

export function IconPhone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </Svg>
  )
}

export function IconVideo(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <polygon points="16 10 22 7 22 17 16 14" fill="currentColor" stroke="currentColor" />
    </Svg>
  )
}

export function IconReply(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="9 17 4 12 9 7" />
      <path d="M4 12h11a5 5 0 0 1 5 5v3" />
    </Svg>
  )
}

export function IconForward(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="15 17 20 12 15 7" />
      <path d="M20 12H9a5 5 0 0 0-5 5v3" />
    </Svg>
  )
}

export function IconStar(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="12 3 14.6 9 21 9.6 16 14 17.5 20.5 12 17 6.5 20.5 8 14 3 9.6 9.4 9" />
    </Svg>
  )
}

export function IconStarFilled(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <polygon points="12 3 14.6 9 21 9.6 16 14 17.5 20.5 12 17 6.5 20.5 8 14 3 9.6 9.4 9" />
    </Svg>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M4 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v0" />
    </Svg>
  )
}

export function IconHeart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </Svg>
  )
}

export function IconHeartFilled(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </Svg>
  )
}

/* IGF ADDITION (e-commerce seam): chat-header cart button — opens the
   create-order dialog with a per-role draft. Not a donor icon. */
export function IconCart(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3 4h2l2.4 11.2a1.6 1.6 0 0 0 1.57 1.3h7.65a1.6 1.6 0 0 0 1.56-1.22L20.6 8H6" />
    </Svg>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  )
}

export function IconBan(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
    </Svg>
  )
}

export function IconThumbDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H6a2 2 0 0 0-2 1.71l-1 8a2 2 0 0 0 2 2.29h5" />
      <line x1="22" y1="2" x2="22" y2="13" />
    </Svg>
  )
}

export function IconExit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  )
}

export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  )
}

export function IconShield(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3z" />
    </Svg>
  )
}

// Linked-device offline: a phone glyph crossed out. Used by the connection gate.
export function IconPhoneOff(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10 6h4" />
      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
    </Svg>
  )
}

export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </Svg>
  )
}

export function IconBellOff(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <path d="M6 8c0 7-3 9-3 9h13" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </Svg>
  )
}

export function IconDocument(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  )
}

export function IconImage(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <polyline points="21 16 16 11 5 21" />
    </Svg>
  )
}

export function IconCamera(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  )
}

export function IconHeadphones(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-7h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1v-7H3z" />
    </Svg>
  )
}

export function IconUserPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </Svg>
  )
}

export function IconUser(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  )
}

export function IconPoll(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="5"  y1="20" x2="5"  y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="19" y1="20" x2="19" y2="14" />
    </Svg>
  )
}

export function IconCalendar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3"  x2="8"  y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </Svg>
  )
}

export function IconStickerPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 14V5a2 2 0 0 1 2-2h9" />
      <line x1="17" y1="3" x2="17" y2="9" />
      <line x1="14" y1="6" x2="20" y2="6" />
      <path d="M3 14h9v9H5a2 2 0 0 1-2-2z" />
    </Svg>
  )
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  )
}

export function IconScrollDown(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="7 13 12 18 17 13" />
      <polyline points="7 7 12 12 17 7" />
    </Svg>
  )
}

export function IconPause(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6"  y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </Svg>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor">
      <polygon points="6 4 20 12 6 20" />
    </Svg>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="4 12 10 18 20 6" />
    </Svg>
  )
}

export function IconPencil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 20 1-5 11-11 4 4-11 11z" />
      <line x1="14" y1="6" x2="18" y2="10" />
    </Svg>
  )
}

export function IconLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </Svg>
  )
}

export function IconHorn(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 11v2a2 2 0 0 0 2 2h2l8 5V4L7 9H5a2 2 0 0 0-2 2z" />
    </Svg>
  )
}

export function IconList(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="9" y1="6"  x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6"  r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconUsers(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  )
}

export function IconMinusCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </Svg>
  )
}

export function IconDialPad(p: IconProps) {
  // 3×3 grid of dots — used on the "Nouvelle discussion" header to open
  // the keypad sub-view (matches WA Web).
  return (
    <Svg {...p}>
      <circle cx="6"  cy="6"  r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6"  r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6"  r="1.5" fill="currentColor" stroke="none" />
      <circle cx="6"  cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="6"  cy="18" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconBackspace(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 6H9l-6 6 6 6h13a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z" />
      <line x1="14" y1="9"  x2="19" y2="15" />
      <line x1="19" y1="9"  x2="14" y2="15" />
    </Svg>
  )
}

export function IconCalendarSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="13" height="12" rx="2" />
      <line x1="3" y1="9" x2="16" y2="9" />
      <circle cx="17.5" cy="17.5" r="3" />
      <line x1="19.5" y1="19.5" x2="22" y2="22" />
    </Svg>
  )
}

export function IconArchive(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </Svg>
  )
}

export function IconMailUnread(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <polyline points="3 8 12 14 21 8" />
      <circle cx="18" cy="6" r="2.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconSmileyFace(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" strokeLinecap="round" />
      <line x1="15" y1="9" x2="15.01" y2="9" strokeLinecap="round" />
    </Svg>
  )
}

export function IconPushPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 17v5" />
      <path d="M5 17h14" />
      <path d="M7.5 17l1-7h7l1 7" />
      <path d="M9.5 10V4.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5V10" />
    </Svg>
  )
}

export function IconForwardAll(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m12 17 5-5-5-5" />
      <path d="M2 18v-2a4 4 0 0 1 4-4h11" />
      <path d="m17 17 5-5-5-5" />
    </Svg>
  )
}

export function IconBolt(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  )
}

export function IconTag(p: IconProps) {
  return (
    <Svg {...p} fill="none" stroke="currentColor">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconTagFilled(p: IconProps) {
  return (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="#111" />
    </Svg>
  )
}

export function IconCheckbox(p: IconProps & { checked?: boolean }) {
  const { checked, ...rest } = p
  return (
    <Svg {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill={checked ? 'var(--wa-green)' : 'none'} stroke={checked ? 'var(--wa-green)' : 'currentColor'} />
      {checked && <polyline points="9 12 11 14 16 9" stroke="#fff" strokeWidth="2" />}
    </Svg>
  )
}

export function IconEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function IconEyeOff(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.1A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-2.2 3.1" />
      <path d="M6.6 6.6C3.7 8.2 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.4-.6" />
    </Svg>
  )
}

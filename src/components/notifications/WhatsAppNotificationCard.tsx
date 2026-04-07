import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import {
  whatsappNotificationStore,
  useWhatsAppNotificationsState,
  type WhatsAppNotification,
} from '@/lib/whatsappNotificationStore';

const AUTO_DISMISS_MS = 6000;

// ── Single card ────────────────────────────────────────────────────────────
function NotificationCard({ n, index }: { n: WhatsAppNotification; index: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startedAtRef = useRef(Date.now());

  // Auto-dismiss countdown (pauses on hover)
  const start = (ms: number) => {
    clearTimeout(timerRef.current!);
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => whatsappNotificationStore.dismiss(n.id), 250);
    }, ms);
  };

  useEffect(() => {
    start(AUTO_DISMISS_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  const handleMouseEnter = () => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  };
  const handleMouseLeave = () => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    start(remainingRef.current);
  };

  const handleClick = () => {
    setLeaving(true);
    setTimeout(() => {
      whatsappNotificationStore.dismiss(n.id);
      // Route to the correct inbox depending on the user's current scope.
      const isSeller = location.pathname.startsWith('/seller');
      const base = isSeller ? '/seller/whatsapp/inbox' : '/business/whatsapp/inbox';
      navigate(`${base}?instance=${encodeURIComponent(n.instanceName)}&jid=${encodeURIComponent(n.remoteJid)}`);
    }, 220);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{
        transform: leaving
          ? 'translateX(120%) scale(0.96)'
          : `translateY(${index * 6}px) scale(${1 - index * 0.015})`,
        opacity: leaving ? 0 : 1 - index * 0.05,
        transitionProperty: 'transform, opacity, box-shadow',
        transitionDuration: leaving ? '260ms' : '420ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className="group relative w-[380px] cursor-pointer rounded-[22px] bg-white/80 backdrop-blur-2xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06),0_20px_60px_-20px_rgba(0,0,0,0.25)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08),0_28px_80px_-24px_rgba(0,0,0,0.3)] ring-1 ring-black/[0.04] mb-2.5 select-none overflow-hidden hover:-translate-y-px transition-all"
    >
      {/* Subtle WhatsApp accent strip */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#25D366]/40 to-transparent" />

      <div className="flex items-start gap-3.5 p-4">
        {/* Sender avatar with instance avatar badge */}
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center ring-1 ring-black/5 shadow-sm">
            {n.senderAvatarUrl ? (
              <img src={n.senderAvatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-gray-500 text-[13px] font-semibold tracking-tight">
                {(n.senderName || '?').substring(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          {/* Instance avatar badge — overlapping bottom-right */}
          <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full overflow-hidden ring-2 ring-white shadow-sm bg-white flex items-center justify-center">
            {n.instanceAvatarUrl ? (
              <img src={n.instanceAvatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <FaWhatsapp className="w-2.5 h-2.5 text-[#25D366]" />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 pt-px">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[14.5px] font-semibold text-gray-900 truncate leading-tight tracking-[-0.01em]">
              {n.senderName || 'Unknown'}
            </p>
            <span className="text-[10px] font-medium text-gray-400 tracking-wide shrink-0">now</span>
          </div>
          <p className="text-[13px] text-gray-600 leading-[1.45] mt-1 line-clamp-2 break-words">
            {n.preview}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <FaWhatsapp className="w-2.5 h-2.5 text-[#25D366]/80 shrink-0" />
            <span className="text-[10.5px] font-medium text-gray-400 tracking-tight truncate">
              {n.instanceName}
            </span>
          </div>
        </div>

        {/* Dismiss — only on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLeaving(true);
            setTimeout(() => whatsappNotificationStore.dismiss(n.id), 220);
          }}
          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-all duration-200 w-6 h-6 rounded-full bg-black/[0.04] hover:bg-black/[0.08] backdrop-blur-sm flex items-center justify-center shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3 h-3 text-gray-600" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ── Stack (portal) ─────────────────────────────────────────────────────────
export function WhatsAppNotificationStack() {
  const { notifications } = useWhatsAppNotificationsState();
  if (typeof document === 'undefined') return null;
  if (notifications.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end pointer-events-none">
      <div className="pointer-events-auto">
        {notifications.map((n, i) => (
          <NotificationCard key={n.id} n={n} index={i} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

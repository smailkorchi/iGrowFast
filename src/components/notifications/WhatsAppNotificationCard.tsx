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

function NotificationCard({ n, index }: { n: WhatsAppNotification; index: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startedAtRef = useRef(Date.now());

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
      const isSeller = location.pathname.startsWith('/seller');
      const base = isSeller ? '/seller/whatsapp/inbox' : '/business/whatsapp/inbox';
      navigate(`${base}?instance=${encodeURIComponent(n.instanceName)}&jid=${encodeURIComponent(n.remoteJid)}`);
    }, 220);
  };

  const initials = (n.senderName || '?').trim().slice(0, 2).toUpperCase();

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
        transitionProperty: 'transform, opacity, box-shadow, border-color',
        transitionDuration: leaving ? '260ms' : '420ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className="group relative w-[380px] cursor-pointer rounded-2xl bg-ant-paper border border-ant-line hover:border-ant-ink/30 shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] hover:shadow-[0_28px_72px_-24px_rgba(20,20,19,0.28)] mb-2.5 select-none overflow-hidden hover:-translate-y-px"
    >
      {/* WhatsApp stripe — ant-green for consistency with brand */}
      <div className="absolute top-0 inset-x-0 h-[3px] bg-ant-green" />

      <div className="flex items-start gap-3 p-4 pr-10">
        {/* Sender avatar + instance badge */}
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-xl overflow-hidden border border-ant-line bg-ant-light flex items-center justify-center">
            {n.senderAvatarUrl ? (
              <img src={n.senderAvatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-[13px] font-semibold text-ant-mid tabular-nums">
                {initials}
              </span>
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-lg overflow-hidden border border-ant-paper bg-ant-paper flex items-center justify-center shadow-sm">
            {n.instanceAvatarUrl ? (
              <img src={n.instanceAvatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full rounded-[5px] bg-ant-green/10 flex items-center justify-center">
                <FaWhatsapp className="w-2.5 h-2.5 text-ant-green" />
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
            WhatsApp · nouveau message
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-display text-[14px] font-semibold text-ant-ink truncate leading-tight">
              {n.senderName || 'Inconnu'}
            </p>
            <span className="font-serif italic text-[11px] text-ant-mid shrink-0">à l&apos;instant</span>
          </div>
          <p className="text-[12px] leading-relaxed text-ant-ink/80 line-clamp-2 break-words">
            {n.preview}
          </p>
          <div className="pt-1.5 border-t border-ant-line flex items-center gap-1.5">
            <FaWhatsapp className="w-2.5 h-2.5 text-ant-green shrink-0" />
            <span className="font-serif italic text-[11px] text-ant-mid truncate">
              {n.instanceName}
            </span>
          </div>
        </div>

        {/* Dismiss */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLeaving(true);
            setTimeout(() => whatsappNotificationStore.dismiss(n.id), 220);
          }}
          aria-label="Ignorer"
          className="absolute right-2.5 top-2.5 inline-flex items-center justify-center h-6 w-6 rounded-lg border border-ant-line bg-ant-paper text-ant-mid opacity-0 group-hover:opacity-100 hover:bg-ant-light hover:text-ant-ink transition-all duration-200"
        >
          <X className="w-3 h-3" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

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

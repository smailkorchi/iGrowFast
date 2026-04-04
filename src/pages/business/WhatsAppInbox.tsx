import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';

// Untyped supabase client for new tables not yet in generated types
const db = supabase as any;
import {
  Search, Send, Smile, Paperclip, Mic, MoreVertical, Phone, Video,
  Check, CheckCheck, Filter, Play, Loader2, ArrowLeft, Plus, X,
  Star, StarOff, BellOff, Bell, Trash2, Ban, Heart, Pin, PinOff,
  Archive, Tag, MessageSquarePlus, Users, Image as ImageIcon, FileText,
  Camera, Headphones, UserPlus, BarChart3, Calendar, Sticker, ChevronDown,
  Copy, Forward, Info, CheckSquare, Clock, Lock, List, Edit3,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

// ── Types ────────────────────────────────────────────────────────────────────

interface EvolutionChat {
  id: string;
  remoteJid: string;
  pushName: string;
  profilePicUrl: string | null;
  updatedAt: string;
  lastMessage: {
    key: { id: string; fromMe: boolean };
    pushName: string;
    messageType: string;
    message: Record<string, any>;
    messageTimestamp: number;
    status: string;
  } | null;
  unreadCount: number;
}

interface EvolutionMessage {
  id: string;
  key: { id: string; fromMe: boolean; remoteJid: string };
  pushName: string;
  messageType: string;
  message: Record<string, any>;
  messageTimestamp: number;
  source: string;
  MessageUpdate?: { status: string }[];
}

interface ChatSettings {
  remote_jid: string;
  is_muted: boolean;
  is_favorited: boolean;
  is_pinned: boolean;
  is_archived: boolean;
  is_blocked: boolean;
  last_read_at: number;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

interface ChatLabel {
  remote_jid: string;
  label_id: string;
}

type SidePanel = 'none' | 'new-chat' | 'starred' | 'contact-info' | 'lists';
type FilterTab = 'all' | 'unread' | 'favorites' | 'label';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatChatDate(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const dayMs = 86400000;
  if (diff < dayMs && now.getDate() === d.getDate()) return formatTime(ts);
  if (diff < dayMs * 2) return 'Yesterday';
  if (diff < dayMs * 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function getMessagePreview(msg: EvolutionChat['lastMessage']): string {
  if (!msg) return '';
  const t = msg.messageType;
  const m = msg.message || {};
  if (t === 'conversation') return m.conversation || '';
  if (t === 'extendedTextMessage') return m.extendedTextMessage?.text || '';
  if (t === 'imageMessage') return m.imageMessage?.caption || '📷 Photo';
  if (t === 'videoMessage') return m.videoMessage?.caption || '🎥 Video';
  if (t === 'audioMessage') return '🎤 Voice message';
  if (t === 'documentMessage') return `📄 ${m.documentMessage?.fileName || 'Document'}`;
  if (t === 'stickerMessage') return 'Sticker';
  if (t === 'reactionMessage') return `Reacted ${m.reactionMessage?.text || ''}`;
  if (t === 'protocolMessage') return '';
  return '';
}

/** Extract reactions from Evolution API message records into a map of targetMessageId -> emoji[] */
function buildReactionsFromRecords(records: any[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of records) {
    if (r.messageType !== 'reactionMessage') continue;
    const rm = r.message?.reactionMessage;
    if (!rm?.key?.id || !rm.text) continue; // empty text = reaction removed
    const targetId = rm.key.id;
    if (!map[targetId]) map[targetId] = [];
    if (!map[targetId].includes(rm.text)) map[targetId].push(rm.text);
  }
  return map;
}

function getTextContent(msg: EvolutionMessage): string | null {
  const t = msg.messageType;
  const m = msg.message || {};
  if (t === 'conversation') return m.conversation || null;
  if (t === 'extendedTextMessage') return m.extendedTextMessage?.text || null;
  if (t === 'imageMessage') return m.imageMessage?.caption || null;
  if (t === 'videoMessage') return m.videoMessage?.caption || null;
  if (t === 'documentMessage') return m.documentMessage?.fileName || null;
  return null;
}

function getMediaUrl(msg: EvolutionMessage): string | null {
  const m = msg.message || {};
  const t = msg.messageType;
  if (t === 'imageMessage') return m.imageMessage?.url || null;
  if (t === 'videoMessage') return m.videoMessage?.url || null;
  if (t === 'audioMessage') return m.audioMessage?.url || null;
  if (t === 'documentMessage') return m.documentMessage?.url || null;
  if (t === 'stickerMessage') return m.stickerMessage?.url || null;
  return null;
}

function getMessageStatus(msg: EvolutionMessage): string {
  const updates = msg.MessageUpdate;
  if (updates && updates.length > 0) {
    const last = updates[updates.length - 1].status;
    if (last === 'READ') return 'read';
    if (last === 'DELIVERY_ACK') return 'delivered';
  }
  return 'sent';
}

function groupMessagesByDate(msgs: EvolutionMessage[]) {
  const groups: { label: string; messages: EvolutionMessage[] }[] = [];
  let current = '';
  for (const msg of msgs) {
    const d = new Date(msg.messageTimestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const dayMs = 86400000;
    let label: string;
    if (diff < dayMs && now.getDate() === d.getDate()) label = 'TODAY';
    else if (diff < dayMs * 2) label = 'YESTERDAY';
    else label = d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    if (label !== current) {
      current = label;
      groups.push({ label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

const LABEL_COLORS = ['#00a884', '#53bdeb', '#f7c948', '#e96c4c', '#a362ea', '#ff6b81', '#5b8c5a', '#4a90d9'];

/** Format a JID into a readable phone number or short label */
function formatPhoneFromJid(jid: string): string {
  const num = jid.split('@')[0];
  // LID format = long numeric, not a real phone number
  if (jid.includes('@lid') || num.length > 15) return '';
  return '+' + num;
}

// ── Dropdown menu component ──────────────────────────────────────────────────

function DropdownMenu({ items, onClose }: { items: { icon: any; label: string; onClick: () => void; danger?: boolean; divider?: boolean }[]; onClose: () => void }) {
  const handlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-dropdown-menu]')) return;
      onClose();
    };
    handlerRef.current = handler;
    const timer = setTimeout(() => document.addEventListener('click', handler), 10);
    return () => { clearTimeout(timer); if (handlerRef.current) document.removeEventListener('click', handlerRef.current); };
  }, [onClose]);

  return (
    <div data-dropdown-menu className="absolute right-0 top-full mt-1 bg-[#233138] rounded-md shadow-xl py-[6px] z-50 min-w-[220px] border border-[#2a3942]">
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && <div className="border-t border-[#2a3942] my-[4px]" />}
          <button
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-3 px-6 py-[10px] text-[14.5px] hover:bg-[#182229] transition-colors ${item.danger ? 'text-[#e96c4c]' : 'text-[#d1d7db]'}`}
          >
            <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Status ticks ─────────────────────────────────────────────────────────────

function StatusTicks({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck className="w-[16px] h-[16px] text-[#53bdeb] inline-block ml-1" />;
  if (status === 'delivered') return <CheckCheck className="w-[16px] h-[16px] text-[#667781] inline-block ml-1" />;
  return <Check className="w-[16px] h-[16px] text-[#667781] inline-block ml-1" />;
}

// ── Avatar ───────────────────────────────────────────────────────────────────

// Cache keyed by remoteJid (unique per contact). Stores base64 or null.
const _avatarCache = new Map<string, string | null>();
const _avatarInflight = new Map<string, Promise<string | null>>();

function Avatar({ name, size = 49, jid, picUrl, instanceName }: {
  name: string; size?: number;
  jid?: string;          // remoteJid — used as cache key
  picUrl?: string | null; // profilePicUrl from Evolution chat data (pps.whatsapp.net)
  instanceName?: string;
  phoneNumber?: string;  // kept for compatibility, unused
  src?: string | null;    // kept for compatibility, unused
}) {
  const cacheKey = jid || '';
  const [pic, setPic] = useState<string | null>(() => _avatarCache.get(cacheKey) ?? null);
  const myKey = useRef(cacheKey);
  myKey.current = cacheKey;

  useEffect(() => {
    if (!cacheKey) { setPic(null); return; }

    // Already cached
    if (_avatarCache.has(cacheKey)) { setPic(_avatarCache.get(cacheKey)!); return; }

    // No pic URL available — nothing to proxy
    if (!picUrl || !instanceName) { _avatarCache.set(cacheKey, null); return; }

    let cancelled = false;
    const doFetch = async () => {
      let promise = _avatarInflight.get(cacheKey);
      if (!promise) {
        // Proxy the profilePicUrl through our edge function (server-side fetch, returns base64)
        promise = whatsappService.invokeClient('proxy-image', { instanceName, url: picUrl })
          .then((d: any) => d?.base64 || null)
          .catch(() => null)
          .finally(() => _avatarInflight.delete(cacheKey));
        _avatarInflight.set(cacheKey, promise);
      }
      const result = await promise;
      _avatarCache.set(cacheKey, result);
      if (!cancelled && myKey.current === cacheKey) setPic(result);
    };
    doFetch();
    return () => { cancelled = true; };
  }, [cacheKey, picUrl, instanceName]);

  if (pic) {
    return <img src={pic} alt="" className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size }} onError={() => { setPic(null); _avatarCache.set(cacheKey, null); }} />;
  }
  return (
    <div className="rounded-full bg-[#6b7b8d] flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <span className="text-[#d1d7db] font-light" style={{ fontSize: size * 0.35 }}>{getInitials(name || '?')}</span>
    </div>
  );
}

// ── Voice Note Player ────────────────────────────────────────────────────────

function VoiceNotePlayer({ msgKey, duration, isOut, instanceName, profilePic, ownerPic, timestamp, status }: {
  msgKey: { remoteJid: string; fromMe: boolean; id: string };
  duration: number; isOut: boolean; instanceName: string;
  profilePic?: string | null; ownerPic?: string | null;
  timestamp: number; status: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const loadAndPlay = async () => {
    if (audioSrc) {
      if (playing) { audioRef.current?.pause(); setPlaying(false); }
      else { audioRef.current?.play(); setPlaying(true); }
      return;
    }
    setLoading(true);
    try {
      const data = await whatsappService.getMedia(instanceName, msgKey);
      if (data?.base64 && data?.mimetype) {
        setAudioSrc(`data:${data.mimetype};base64,${data.base64}`);
        setTimeout(() => { audioRef.current?.play(); setPlaying(true); }, 50);
      }
    } catch (e) { console.error('Failed to load audio:', e); }
    finally { setLoading(false); }
  };

  const onTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
    const d = audioRef.current.duration || duration;
    setProgress(d > 0 ? (audioRef.current.currentTime / d) * 100 : 0);
  };

  const onEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (audioRef.current.duration || duration);
  };

  const bars = useMemo(() => {
    const seed = msgKey.id;
    const result: number[] = [];
    for (let i = 0; i < 36; i++) {
      const c = seed.charCodeAt(i % seed.length) || 50;
      result.push(0.15 + (((c * (i + 1) * 7) % 100) / 100) * 0.85);
    }
    return result;
  }, [msgKey.id]);

  // Pick the right avatar: outgoing = owner, incoming = contact
  const avatarSrc = isOut ? ownerPic : profilePic;
  const playedColor = isOut ? '#b3d9d2' : '#00a884';
  const unplayedColor = isOut ? '#43756b' : '#3b4a54';

  return (
    <div className="flex items-center gap-[6px] min-w-[300px] max-w-[360px] h-[54px]">
      {audioSrc && <audio ref={audioRef} src={audioSrc} onTimeUpdate={onTimeUpdate} onEnded={onEnded} preload="auto" />}

      {/* Play/Pause */}
      <button onClick={loadAndPlay} disabled={loading} className="flex-shrink-0 w-[28px] flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-[24px] h-[24px] animate-spin" style={{ color: playedColor }} />
        ) : playing ? (
          <svg viewBox="0 0 24 24" width="24" height="24" fill={isOut ? '#d9fdd3' : '#aebac1'}>
            <rect x="5" y="3" width="5" height="18" rx="1.5" />
            <rect x="14" y="3" width="5" height="18" rx="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill={isOut ? '#d9fdd3' : '#aebac1'}>
            <path d="M5 3.868v16.264a1 1 0 001.515.857l12.97-8.132a1 1 0 000-1.714L6.515 3.011A1 1 0 005 3.868z" />
          </svg>
        )}
      </button>

      {/* Waveform + bottom row (duration left, timestamp+ticks right) */}
      <div className="flex-1 flex flex-col justify-center min-w-0 h-full">
        <div className="flex items-center gap-[2px] h-[32px] cursor-pointer" onClick={onSeek}>
          {bars.map((h, i) => {
            const isPlayed = (i / bars.length) * 100 <= progress;
            return (
              <div key={i} className="rounded-full transition-colors" style={{
                width: 3, minWidth: 3, height: `${h * 100}%`, alignSelf: 'center',
                backgroundColor: isPlayed ? playedColor : unplayedColor,
              }} />
            );
          })}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] leading-[12px]" style={{ color: isOut ? '#8cc2b8' : '#8696a0' }}>
            {playing || currentTime > 0 ? fmtTime(currentTime) : fmtTime(duration)}
          </span>
          <span className="flex items-center gap-[1px]">
            <span className="text-[10px] leading-[12px] text-[#ffffff99]">{formatTime(timestamp)}</span>
            {isOut && <CheckCheck className="w-[12px] h-[12px] ml-[1px]" style={{ color: status === 'read' ? '#53bdeb' : '#8696a0' }} />}
          </span>
        </div>
      </div>

      {/* Avatar with mic badge */}
      <div className="relative flex-shrink-0 self-center">
        {avatarSrc && !imgErr ? (
          <img src={avatarSrc} alt="" className="w-[46px] h-[46px] rounded-full object-cover"
            onError={() => setImgErr(true)} />
        ) : (
          <div className="w-[46px] h-[46px] rounded-full flex items-center justify-center"
            style={{ backgroundColor: isOut ? '#43756b' : '#3b4a54' }}>
            <Mic className="w-5 h-5" style={{ color: isOut ? '#b3d9d2' : '#8696a0' }} />
          </div>
        )}
        <div className="absolute -bottom-[1px] -right-[1px] w-[18px] h-[18px] rounded-full flex items-center justify-center"
          style={{ backgroundColor: isOut ? '#005c4b' : '#202c33' }}>
          <Mic className="w-[10px] h-[10px]" style={{ color: isOut ? '#00a884' : '#8696a0' }} />
        </div>
      </div>
    </div>
  );
}

// ── Media Image ──────────────────────────────────────────────────────────────

function MediaImage({ msgKey, instanceName, caption, isSticker, timestamp, status, isOut }: {
  msgKey: { remoteJid: string; fromMe: boolean; id: string };
  instanceName: string; caption?: string; isSticker?: boolean;
  timestamp?: number; status?: string; isOut?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const load = async () => {
    if (src || loading) return;
    setLoading(true);
    try {
      const data = await whatsappService.getMedia(instanceName, msgKey);
      if (data?.base64 && data?.mimetype) {
        setSrc(`data:${data.mimetype};base64,${data.base64}`);
      } else { setFailed(true); }
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };

  // Auto-load on mount
  useEffect(() => { load(); }, []);

  if (isSticker) {
    return src ? <img src={src} alt="" className="w-[128px] h-[128px]" /> : (
      <div className="w-[128px] h-[128px] flex items-center justify-center">
        {loading ? <Loader2 className="w-5 h-5 text-[#8696a0] animate-spin" /> : <Sticker className="w-8 h-8 text-[#3b4a54]" />}
      </div>
    );
  }

  return (
    <>
      <div className="relative rounded-md overflow-hidden mb-1 cursor-pointer" onClick={() => src && setFullscreen(true)} style={{ maxWidth: 330 }}>
        {src ? (
          <img src={src} alt="" className="w-full rounded-md object-cover" style={{ maxHeight: 330 }} />
        ) : (
          <div className="w-[250px] h-[180px] bg-[#1a2730] rounded-md flex items-center justify-center" onClick={load}>
            {loading ? <Loader2 className="w-6 h-6 text-[#00a884] animate-spin" /> :
              <ImageIcon className="w-8 h-8 text-[#3b4a54]" />}
          </div>
        )}
        {timestamp && (
          <span className="absolute bottom-[6px] right-[6px] flex items-center gap-[2px] bg-black/50 rounded px-1.5 py-0.5">
            <span className="text-[10px] text-white">{formatTime(timestamp)}</span>
            {isOut && <CheckCheck className="w-[12px] h-[12px] ml-[1px]" style={{ color: status === 'read' ? '#53bdeb' : 'white' }} />}
          </span>
        )}
      </div>
      {/* Fullscreen overlay */}
      {fullscreen && src && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center" onClick={() => setFullscreen(false)}>
          <button className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-full"><X className="w-6 h-6" /></button>
          <img src={src} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </>
  );
}

// ── Media Video ──────────────────────────────────────────────────────────────

function MediaVideo({ msgKey, instanceName, seconds, caption, timestamp, status, isOut }: {
  msgKey: { remoteJid: string; fromMe: boolean; id: string };
  instanceName: string; seconds?: number; caption?: string;
  timestamp?: number; status?: string; isOut?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullVideoRef = useRef<HTMLVideoElement>(null);

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const load = async () => {
    if (src || loading) return;
    setLoading(true);
    try {
      const data = await whatsappService.getMedia(instanceName, msgKey);
      if (data?.base64 && data?.mimetype) {
        setSrc(`data:${data.mimetype};base64,${data.base64}`);
      } else { setFailed(true); }
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };

  const togglePlay = () => {
    if (!src) { load(); return; }
    if (playing) { videoRef.current?.pause(); setPlaying(false); }
    else { videoRef.current?.play(); setPlaying(true); }
  };

  return (
    <>
      <div className="relative rounded-md overflow-hidden mb-1 cursor-pointer" style={{ maxWidth: 330 }} onClick={togglePlay}>
        {src ? (
          <>
            <video ref={videoRef} src={src} className="w-full rounded-md" style={{ maxHeight: 330 }}
              onEnded={() => setPlaying(false)} playsInline />
            {!playing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="w-[52px] h-[52px] rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                  <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="w-[250px] h-[180px] bg-[#1a2730] rounded-md flex items-center justify-center" onClick={load}>
            {loading ? <Loader2 className="w-6 h-6 text-[#00a884] animate-spin" /> :
              <div className="flex flex-col items-center gap-2">
                <div className="w-[52px] h-[52px] rounded-full bg-black/40 flex items-center justify-center">
                  <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
                </div>
                {failed && <span className="text-[12px] text-[#8696a0]">Tap to retry</span>}
              </div>
            }
          </div>
        )}
        {/* Duration badge (top-left like WhatsApp) */}
        {seconds && !playing && (
          <div className="absolute top-[6px] left-[6px] bg-black/60 rounded px-[6px] py-[2px] flex items-center gap-1">
            <Play className="w-[10px] h-[10px] text-white" fill="white" />
            <span className="text-[11px] text-white font-medium">{fmtDur(seconds)}</span>
          </div>
        )}
        {/* GIF badge if very short */}
        {src && seconds && seconds <= 6 && !playing && (
          <div className="absolute bottom-[6px] left-[6px] bg-black/60 rounded px-[6px] py-[2px]">
            <span className="text-[11px] text-white font-bold">GIF</span>
          </div>
        )}
        {timestamp && (
          <span className="absolute bottom-[6px] right-[6px] flex items-center gap-[2px] bg-black/50 rounded px-1.5 py-0.5">
            <span className="text-[10px] text-white">{formatTime(timestamp)}</span>
            {isOut && <CheckCheck className="w-[12px] h-[12px] ml-[1px]" style={{ color: status === 'read' ? '#53bdeb' : 'white' }} />}
          </span>
        )}
      </div>
      {/* Fullscreen button */}
      {src && (
        <button onClick={(e) => { e.stopPropagation(); setFullscreen(true); }}
          className="absolute top-[6px] right-[6px] bg-black/60 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity">
        </button>
      )}
      {/* Fullscreen video overlay */}
      {fullscreen && src && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center" onClick={() => setFullscreen(false)}>
          <button className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-full z-10"><X className="w-6 h-6" /></button>
          <video ref={fullVideoRef} src={src} className="max-w-[90vw] max-h-[90vh]" controls autoPlay playsInline
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// ── Document Bubble ──────────────────────────────────────────────────────────

function DocumentBubble({ msgKey, instanceName, fileName, mimetype, fileSize, pageCount, timestamp, status, isOut }: {
  msgKey: { remoteJid: string; fromMe: boolean; id: string };
  instanceName: string; fileName: string; mimetype: string; fileSize: number; pageCount?: number;
  timestamp?: number; status?: string; isOut?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);

  const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
  const sizeStr = fileSize > 1048576 ? `${(fileSize / 1048576).toFixed(1)} MB` :
    fileSize > 1024 ? `${Math.round(fileSize / 1024)} KB` : `${fileSize} B`;
  const pages = pageCount ? `${pageCount} pages` : '';
  const meta = [ext, sizeStr, pages].filter(Boolean).join(' \u00B7 ');

  // File type icon color
  const iconColor = ext === 'PDF' ? '#e96c4c' : ext === 'DOC' || ext === 'DOCX' ? '#4a90d9' :
    ext === 'XLS' || ext === 'XLSX' ? '#00a884' : ext === 'AI' ? '#ff9a00' : '#8696a0';

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const data = await whatsappService.getMedia(instanceName, msgKey);
      if (data?.base64 && data?.mimetype) {
        const link = document.createElement('a');
        link.href = `data:${data.mimetype};base64,${data.base64}`;
        link.download = fileName;
        link.click();
      }
    } catch { /* ignore */ }
    finally { setDownloading(false); }
  };

  return (
    <div className="relative flex items-center gap-3 bg-[#1a2730] rounded-lg p-3 pb-6 mb-1 min-w-[280px] max-w-[340px] cursor-pointer hover:bg-[#1e303a] transition-colors"
      onClick={handleDownload}>
      {/* File icon */}
      <div className="w-[42px] h-[50px] rounded-md bg-[#2a3942] flex flex-col items-center justify-center flex-shrink-0 relative">
        <FileText className="w-6 h-6 text-[#8696a0]" />
        <span className="text-[8px] font-bold mt-0.5 px-1 rounded" style={{ color: iconColor }}>{ext}</span>
      </div>
      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] text-[#d1d7db] truncate leading-[18px]">{fileName}</div>
        <div className="text-[11px] text-[#8696a0] mt-[2px]">{meta}</div>
      </div>
      {/* Download button */}
      <button onClick={(e) => { e.stopPropagation(); handleDownload(); }} disabled={downloading}
        className="flex-shrink-0 w-[32px] h-[32px] rounded-full hover:bg-[#374045] flex items-center justify-center">
        {downloading ? <Loader2 className="w-4 h-4 text-[#8696a0] animate-spin" /> :
          <ArrowLeft className="w-4 h-4 text-[#8696a0] rotate-[-90deg]" />}
      </button>
      {/* Timestamp + ticks inside */}
      {timestamp && (
        <span className="absolute bottom-[6px] right-[10px] flex items-center gap-[2px]">
          <span className="text-[10px] text-[#ffffff99]">{formatTime(timestamp)}</span>
          {isOut && <CheckCheck className="w-[12px] h-[12px] ml-[1px]" style={{ color: status === 'read' ? '#53bdeb' : '#8696a0' }} />}
        </span>
      )}
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────────

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function MessageBubble({ msg, isStarred, isPinned, reactions, instanceName, chatProfilePic, ownerPic, chatName, onStar, onReply, onReact, onDelete, onForward, onTogglePin }: {
  msg: EvolutionMessage; isStarred: boolean; isPinned: boolean; reactions?: string[];
  instanceName: string; chatProfilePic?: string | null; ownerPic?: string | null; chatName?: string;
  onStar: (msgId: string) => void;
  onReply: (msg: EvolutionMessage) => void;
  onReact: (msgKey: { remoteJid: string; fromMe: boolean; id: string }, reaction: string) => void;
  onDelete: (msg: EvolutionMessage) => void;
  onForward: (msg: EvolutionMessage) => void;
  onTogglePin: (msg: EvolutionMessage) => void;
}) {
  const [showHover, setShowHover] = useState(false);
  const [showCtxMenu, setShowCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [localReactions, setLocalReactions] = useState<string[]>(reactions || []);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOut = msg.key.fromMe;
  const text = getTextContent(msg);
  const mediaUrl = getMediaUrl(msg);
  const status = getMessageStatus(msg);
  const t = msg.messageType;

  // Sync reactions prop
  useEffect(() => { if (reactions) setLocalReactions(reactions); }, [reactions]);

  // Close context menu on outside click
  useEffect(() => {
    if (showCtxMenu) {
      const handler = () => { setShowCtxMenu(null); setShowReactionPicker(false); };
      const timer = setTimeout(() => document.addEventListener('click', handler), 10);
      return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
    }
  }, [showCtxMenu]);

  // Adjust menu position to avoid going off-screen
  const getMenuStyle = (): React.CSSProperties => {
    if (!showCtxMenu) return {};
    const menuHeight = 350; // approximate
    const menuWidth = 240;
    let { x, y } = showCtxMenu;
    if (y + menuHeight > window.innerHeight) y = Math.max(10, window.innerHeight - menuHeight - 10);
    if (x + menuWidth > window.innerWidth) x = Math.max(10, window.innerWidth - menuWidth - 10);
    return { left: x, top: y };
  };

  const handleCopy = () => { if (text) navigator.clipboard.writeText(text); };

  const handleLocalReact = (emoji: string) => {
    setLocalReactions(prev => prev.includes(emoji) ? prev : [...prev, emoji]);
    onReact(msg.key, emoji);
    setShowCtxMenu(null);
  };

  const renderMedia = () => {
    // Documents don't need mediaUrl — they use getMedia API on download
    if (t === 'documentMessage') {
      const doc = msg.message?.documentMessage || {};
      return <DocumentBubble msgKey={msg.key} instanceName={instanceName}
        fileName={doc.fileName || 'Document'} mimetype={doc.mimetype || ''}
        fileSize={doc.fileLength?.low || 0} pageCount={doc.pageCount}
        timestamp={msg.messageTimestamp} status={status} isOut={isOut} />;
    }
    if (!mediaUrl) return null;
    if (t === 'imageMessage')
      return <MediaImage msgKey={msg.key} instanceName={instanceName} caption={msg.message?.imageMessage?.caption}
        timestamp={msg.messageTimestamp} status={status} isOut={isOut} />;
    if (t === 'videoMessage')
      return <MediaVideo msgKey={msg.key} instanceName={instanceName} seconds={msg.message?.videoMessage?.seconds} caption={msg.message?.videoMessage?.caption}
        timestamp={msg.messageTimestamp} status={status} isOut={isOut} />;
    if (t === 'audioMessage')
      return (
        <VoiceNotePlayer
          msgKey={msg.key}
          duration={msg.message?.audioMessage?.seconds || 0}
          isOut={isOut}
          instanceName={instanceName}
          profilePic={chatProfilePic}
          ownerPic={ownerPic}
          timestamp={msg.messageTimestamp}
          status={status}
        />
      );
    if (t === 'stickerMessage')
      return <MediaImage msgKey={msg.key} instanceName={instanceName} isSticker />;
    return null;
  };

  return (
    <div className={`flex flex-col ${isOut ? 'items-end' : 'items-start'} mb-[2px] px-[63px] group`} data-msg-id={msg.key.id}>
      <div className="relative">
        <div
          className={`relative max-w-[500px] px-[9px] pt-[6px] pb-[8px] rounded-[7.5px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
            isOut ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
          }`}
          onMouseEnter={() => setShowHover(true)}
          onMouseLeave={() => setShowHover(false)}
          onContextMenu={(e) => { e.preventDefault(); setShowCtxMenu({ x: e.clientX, y: e.clientY }); }}
        >
          <span className={`absolute top-0 w-[8px] h-[13px] ${isOut ? '-right-[8px]' : '-left-[8px]'}`}
            style={{ background: isOut ? '#005c4b' : '#202c33', clipPath: isOut ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(100% 0, 0 0, 100% 100%)' }}
          />
          {/* Hover chevron */}
          {showHover && !showCtxMenu && (
            <button onClick={(e) => { e.stopPropagation(); setShowCtxMenu({ x: e.clientX, y: e.clientY }); }}
              className={`absolute top-0 ${isOut ? 'left-0' : 'right-0'} p-1 rounded hover:bg-black/10 z-10`}>
              <ChevronDown className="w-4 h-4 text-[#8696a0]" />
            </button>
          )}
          {/* Quoted/reply message bar */}
          {(() => {
            // Check all possible contextInfo paths (varies by message type)
            const m = msg.message || {};
            const ctx = (msg as any).contextInfo
              || m.extendedTextMessage?.contextInfo
              || m.conversation?.contextInfo
              || m.imageMessage?.contextInfo
              || m.videoMessage?.contextInfo
              || m.audioMessage?.contextInfo
              || m.documentMessage?.contextInfo
              || null;
            const quoted = ctx?.quotedMessage;
            if (!quoted) return null;
            // Skip if the quoted content is just a reaction (not a real reply)
            if (quoted.reactionMessage || quoted.protocolMessage) return null;
            // Extract quoted content
            let quotedText = quoted.conversation
              || quoted.extendedTextMessage?.text
              || (quoted.imageMessage ? '📷 Photo' : null)
              || (quoted.videoMessage ? '🎥 Video' : null)
              || (quoted.audioMessage ? '🎤 Voice message' : null)
              || (quoted.documentMessage?.fileName || (quoted.documentMessage ? '📄 Document' : null))
              || '';
            if (!quotedText) return null;
            // In 1:1 chats:
            // fromMe=true (I sent this reply) → I'm quoting the contact → show contact name
            // fromMe=false (they sent this reply) → they're quoting me → show "You"
            const quotedName = isOut ? (chatName || '') : 'You';
            const stanzaId = ctx.stanzaId;
            return (
              <div
                className={`rounded-md mb-[4px] overflow-hidden cursor-pointer hover:brightness-110 transition ${isOut ? 'bg-[#025144]' : 'bg-[#1a2730]'}`}
                onClick={() => {
                  if (!stanzaId) return;
                  const el = document.querySelector(`[data-msg-id="${stanzaId}"]`) as HTMLElement;
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.remove('wa-highlight-fade');
                    el.classList.add('wa-highlight');
                    setTimeout(() => el.classList.add('wa-highlight-fade'), 100);
                    setTimeout(() => { el.classList.remove('wa-highlight', 'wa-highlight-fade'); }, 2500);
                  }
                }}
              >
                <div className={`border-l-[4px] px-[10px] py-[5px] ${isOut ? 'border-l-[#06cf9c]' : 'border-l-[#53bdeb]'}`}>
                  {quotedName && (
                    <div className={`text-[12.5px] font-medium mb-[1px] ${isOut ? 'text-[#06cf9c]' : 'text-[#53bdeb]'}`}>
                      {quotedName}
                    </div>
                  )}
                  <div className="text-[13px] text-[#8696a0] line-clamp-2">{quotedText}</div>
                </div>
              </div>
            );
          })()}
          {renderMedia()}
          {text && t !== 'documentMessage' && <span className="text-[14.2px] leading-[19px] whitespace-pre-wrap break-words">{text}</span>}
          {/* Hide default timestamp for audio — VoiceNotePlayer renders its own */}
          {t !== 'audioMessage' && t !== 'documentMessage' && t !== 'imageMessage' && t !== 'videoMessage' && (
            <span className="float-right mt-[4px] ml-[8px] flex items-center gap-[2px]">
              {isStarred && <Star className="w-3 h-3 text-[#f7c948] fill-[#f7c948]" />}
              <span className="text-[11px] text-[#ffffff99] leading-[15px]">{formatTime(msg.messageTimestamp)}</span>
              {isOut && <StatusTicks status={status} />}
            </span>
          )}
        </div>

        {/* Reactions display (below bubble, like WhatsApp) */}
        {localReactions.length > 0 && (
          <div className={`flex gap-0.5 mt-[-8px] ${isOut ? 'justify-end mr-1' : 'justify-start ml-1'}`}>
            <div className="flex items-center gap-[2px] bg-[#1a2730] rounded-full px-1.5 py-0.5 shadow border border-[#2a3942] cursor-pointer"
              onClick={() => {
                // Click to remove all reactions (send empty string)
                setLocalReactions([]);
                onReact(msg.key, '');
              }}
              title="Click to remove reaction">
              {localReactions.map((emoji, i) => (
                <span key={i} className="text-[14px]">{emoji}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Message context menu ──────────────────────────────────────── */}
      {showCtxMenu && (
        <div ref={menuRef} className="fixed z-[100]" style={getMenuStyle()} onClick={e => e.stopPropagation()}>
          {/* Quick reactions bar */}
          <div className="flex items-center gap-1 bg-[#233138] rounded-full px-2 py-1.5 mb-1 shadow-xl border border-[#2a3942]">
            {QUICK_REACTIONS.map(emoji => (
              <button key={emoji} onClick={() => handleLocalReact(emoji)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#374045] text-[20px] transition-transform hover:scale-125">
                {emoji}
              </button>
            ))}
            <button onClick={() => setShowReactionPicker(!showReactionPicker)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#374045] text-[16px]">
              <Plus className="w-4 h-4 text-[#8696a0]" />
            </button>
          </div>

          {showReactionPicker && (
            <div className="mb-1">
              <Picker data={data} onEmojiSelect={(emoji: any) => handleLocalReact(emoji.native)}
                theme="dark" previewPosition="none" skinTonePosition="none" perLine={8} />
            </div>
          )}

          <div className="bg-[#233138] rounded-lg shadow-xl py-[6px] min-w-[220px] border border-[#2a3942]">
            {[
              { icon: ArrowLeft, iconCls: 'rotate-[135deg]', label: 'Reply', onClick: () => onReply(msg) },
              { icon: Copy, label: 'Copy', onClick: handleCopy, show: !!text },
              { icon: Smile, label: 'React', onClick: () => setShowReactionPicker(true) },
              { icon: Forward, label: 'Forward', onClick: () => onForward(msg) },
              { icon: isPinned ? PinOff : Pin, label: isPinned ? 'Unpin' : 'Pin', onClick: () => onTogglePin(msg) },
              { icon: isStarred ? StarOff : Star, label: isStarred ? 'Unstar' : 'Star', onClick: () => onStar(msg.key.id) },
              { icon: Trash2, label: 'Delete', onClick: () => onDelete(msg), danger: true, divider: true },
            ].filter(item => item.show !== false).map((item, i) => (
              <div key={i}>
                {item.divider && <div className="border-t border-[#2a3942] my-[4px]" />}
                <button onClick={() => { item.onClick(); if (item.label !== 'React') setShowCtxMenu(null); }}
                  className={`w-full flex items-center gap-3 px-5 py-[10px] text-[14.5px] hover:bg-[#182229] transition-colors ${item.danger ? 'text-[#e96c4c]' : 'text-[#d1d7db]'}`}>
                  <item.icon className={`w-[18px] h-[18px] flex-shrink-0 ${'iconCls' in item ? (item as any).iconCls : ''}`} />
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contact list item ────────────────────────────────────────────────────────

function ContactItem({ chat, isActive, isPinned, isMuted, onClick, onContextMenu, instanceName }: {
  chat: EvolutionChat; isActive: boolean; isPinned: boolean; isMuted: boolean;
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
  instanceName?: string;
}) {
  const displayName = chat.pushName || chat.remoteJid;
  const preview = getMessagePreview(chat.lastMessage);
  const ts = chat.lastMessage?.messageTimestamp;
  const isFromMe = chat.lastMessage?.key.fromMe;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-[13px] px-[13px] py-[10px] cursor-pointer hover:bg-[#202c33] transition-colors ${isActive ? 'bg-[#2a3942]' : ''}`}
    >
      <Avatar name={displayName} jid={chat.remoteJid} picUrl={chat.profilePicUrl} instanceName={instanceName} />
      <div className="flex-1 min-w-0 border-b border-[#222d34] py-[10px]">
        <div className="flex justify-between items-baseline">
          <span className="text-[17px] text-[#e9edef] truncate leading-[21px] flex items-center gap-1">
            {displayName}
            {isMuted && <BellOff className="w-3.5 h-3.5 text-[#667781] flex-shrink-0" />}
          </span>
          <span className={`text-[12px] whitespace-nowrap ml-2 flex items-center gap-1 ${chat.unreadCount > 0 ? 'text-[#00a884]' : 'text-[#8696a0]'}`}>
            {isPinned && <Pin className="w-3 h-3" />}
            {ts ? formatChatDate(ts) : ''}
          </span>
        </div>
        <div className="flex justify-between items-center mt-[2px]">
          <span className="text-[14px] text-[#8696a0] truncate leading-[20px] flex items-center gap-1">
            {isFromMe && <CheckCheck className="w-[16px] h-[16px] inline-block flex-shrink-0 text-[#53bdeb]" />}
            {preview}
          </span>
          {chat.unreadCount > 0 && (
            <span className="bg-[#00a884] text-[#111b21] text-[12px] font-medium rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-[6px] ml-2 flex-shrink-0">
              {chat.unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Attachment menu ──────────────────────────────────────────────────────────

function AttachmentMenu({ onSelect, onClose }: { onSelect: (type: string) => void; onClose: () => void }) {
  const items = [
    { icon: FileText, label: 'Document', type: 'document', color: '#7f66ff' },
    { icon: ImageIcon, label: 'Photos & Videos', type: 'image', color: '#007bfc' },
    { icon: Camera, label: 'Camera', type: 'image', color: '#ff2e74' },
    { icon: Headphones, label: 'Audio', type: 'audio', color: '#ff6723' },
    { icon: UserPlus, label: 'Contact', type: 'contact', color: '#009de2' },
    { icon: BarChart3, label: 'Poll', type: 'poll', color: '#f4c950' },
    { icon: Calendar, label: 'Event', type: 'event', color: '#e96c4c' },
    { icon: Sticker, label: 'New sticker', type: 'sticker', color: '#00a884' },
  ];

  useEffect(() => {
    const handler = () => onClose();
    const timer = setTimeout(() => document.addEventListener('click', handler), 10);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [onClose]);

  return (
    <div className="absolute bottom-full left-0 mb-2 bg-[#233138] rounded-xl shadow-xl py-2 z-50 min-w-[200px] border border-[#2a3942]">
      {items.map(item => (
        <button
          key={item.type}
          onClick={() => { onSelect(item.type); onClose(); }}
          className="w-full flex items-center gap-3 px-5 py-[10px] text-[14.5px] text-[#d1d7db] hover:bg-[#182229] transition-colors"
        >
          <item.icon className="w-[20px] h-[20px] flex-shrink-0" style={{ color: item.color }} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── New Chat Panel ───────────────────────────────────────────────────────────

function NewChatPanel({ instanceName, onSelectContact, onClose }: { instanceName: string; onSelectContact: (jid: string, name: string) => void; onClose: () => void }) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const businessId = localStorage.getItem('activeBusinessId');
        if (!businessId) { setLoading(false); return; }

        // Read contacts from Supabase
        const { data } = await (supabase as any).from('whatsapp_contacts')
          .select('phone_number, name, profile_pic')
          .eq('business_id', businessId)
          .order('name', { ascending: true, nullsFirst: false });

        if (Array.isArray(data)) {
          const filtered = data
            .filter((c: any) => c.phone_number && !c.phone_number.endsWith('@g.us') && c.phone_number !== 'status@broadcast')
            .map((c: any) => ({
              remoteJid: c.phone_number,
              pushName: c.name || '+' + c.phone_number.split('@')[0],
              profilePicUrl: c.profile_pic,
              _chatJid: c.phone_number,
              _displayPhone: c.phone_number.includes('@s.whatsapp.net') ? c.phone_number.split('@')[0] : '',
            }));
          setContacts(filtered);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [instanceName]);

  const filteredContacts = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.pushName?.toLowerCase().includes(q)) || c._displayPhone?.includes(q) || c.remoteJid.toLowerCase().includes(q);
  });

  // Group by first letter
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const c of filteredContacts) {
      const letter = (c.pushName || c._displayPhone || '#')[0].toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    return Object.entries(groups).sort(([a], [b]) => a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b));
  }, [filteredContacts]);

  return (
    <div className="absolute inset-0 bg-[#111b21] z-40 flex flex-col">
      <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4">
        <button onClick={onClose} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-[19px] text-[#e9edef]">New chat</span>
      </div>
      <div className="px-[10px] py-[7px]">
        <div className="flex items-center bg-[#202c33] rounded-lg h-[35px] px-3 gap-3">
          <Search className="w-[15px] h-[15px] text-[#8696a0]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or number"
            className="bg-transparent text-[13px] text-[#d1d7db] placeholder-[#8696a0] outline-none flex-1" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-[#00a884] animate-spin" /></div>
        ) : (
          grouped.map(([letter, items]) => (
            <div key={letter}>
              <div className="px-[30px] py-2 text-[14px] text-[#00a884] font-medium">{letter}</div>
              {items.map((c: any) => (
                <button
                  key={c._chatJid || c.remoteJid}
                  onClick={() => onSelectContact(c._chatJid || c.remoteJid, c.pushName || c._displayPhone || c.remoteJid)}
                  className="w-full flex items-center gap-[13px] px-[13px] py-[10px] hover:bg-[#202c33] transition-colors"
                >
                  <Avatar name={c.pushName || c._displayPhone || '?'}
                    jid={c._chatJid || c.remoteJid} picUrl={c.profilePicUrl} instanceName={instanceName} />
                  <div className="text-left border-b border-[#222d34] flex-1 py-[10px]">
                    <div className="text-[17px] text-[#e9edef]">{c.pushName || (c._displayPhone ? '+' + c._displayPhone : c.remoteJid)}</div>
                    {c._displayPhone && <div className="text-[13px] text-[#8696a0]">+{c._displayPhone}</div>}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Lists Panel (WhatsApp-style side panel) ─────────────────────────────────

function ListsPanel({ labels, chatLabelsMap, chats, selectedChatJid, businessId, onUpdate, onClose }: {
  labels: Label[]; chatLabelsMap: Record<string, string[]>; chats: EvolutionChat[];
  selectedChatJid?: string; businessId: string; onUpdate: () => void; onClose: () => void;
}) {
  const [view, setView] = useState<'overview' | 'editor' | 'picker'>('overview');
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorColor, setEditorColor] = useState(LABEL_COLORS[0]);
  const [editorMembers, setEditorMembers] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Get member count for a label
  const getMemberCount = (labelId: string) =>
    Object.values(chatLabelsMap).filter(arr => arr.includes(labelId)).length;

  // Get member JIDs for a label
  const getMemberJids = (labelId: string) =>
    Object.entries(chatLabelsMap).filter(([, arr]) => arr.includes(labelId)).map(([jid]) => jid);

  // Open editor for new list
  const openNewList = () => {
    setEditingLabel(null);
    setEditorName('');
    setEditorColor(LABEL_COLORS[0]);
    setEditorMembers(selectedChatJid ? [selectedChatJid] : []);
    setView('editor');
  };

  // Open editor for existing list
  const openEditList = (label: Label) => {
    setEditingLabel(label);
    setEditorName(label.name);
    setEditorColor(label.color);
    setEditorMembers(getMemberJids(label.id));
    setView('editor');
  };

  // Save (create or update)
  const handleSave = async () => {
    if (!editorName.trim()) return;
    let labelId = editingLabel?.id;

    if (editingLabel) {
      await db.from('whatsapp_labels').update({ name: editorName.trim(), color: editorColor }).eq('id', editingLabel.id);
    } else {
      const { data } = await db.from('whatsapp_labels').insert({ business_id: businessId, name: editorName.trim(), color: editorColor }).select().single();
      if (data) labelId = data.id;
    }

    if (labelId) {
      // Sync members: delete all existing, re-insert current
      await db.from('whatsapp_chat_labels').delete().eq('business_id', businessId).eq('label_id', labelId);
      if (editorMembers.length > 0) {
        await db.from('whatsapp_chat_labels').insert(
          editorMembers.map(jid => ({ business_id: businessId, remote_jid: jid, label_id: labelId }))
        );
      }
    }

    onUpdate();
    setView('overview');
  };

  // Delete a label
  const handleDelete = async (labelId: string) => {
    await db.from('whatsapp_chat_labels').delete().eq('business_id', businessId).eq('label_id', labelId);
    await db.from('whatsapp_labels').delete().eq('id', labelId);
    setConfirmDelete(null);
    onUpdate();
  };

  // Add member from picker
  const addMember = (jid: string) => {
    if (!editorMembers.includes(jid)) setEditorMembers(prev => [...prev, jid]);
    setView('editor');
    setPickerSearch('');
  };

  // Get chat name for a JID
  const getChatName = (jid: string) => {
    const chat = chats.find(c => c.remoteJid === jid);
    return chat?.pushName || '+' + jid.split('@')[0];
  };

  // Filtered chats for picker (exclude already-added members)
  const pickerChats = chats.filter(c => {
    if (editorMembers.includes(c.remoteJid)) return false;
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return c.pushName?.toLowerCase().includes(q) || c.remoteJid.includes(q);
  });

  // ── Overview view ──
  if (view === 'overview') {
    return (
      <div className="absolute inset-0 bg-[#111b21] z-40 flex flex-col">
        <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4">
          <button onClick={onClose} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-[19px] text-[#e9edef]">Lists</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {labels.length === 0 && (
            <div className="text-center text-[#8696a0] text-[14px] py-12">No lists yet. Create one to organize your chats.</div>
          )}
          {labels.map(l => (
            <div key={l.id} className="flex items-center hover:bg-[#202c33] transition-colors group">
              <button onClick={() => openEditList(l)} className="flex-1 flex items-center gap-3 px-[13px] py-[12px]">
                <div className="w-[40px] h-[40px] rounded-full flex items-center justify-center" style={{ backgroundColor: l.color + '30' }}>
                  <Tag className="w-[18px] h-[18px]" style={{ color: l.color }} />
                </div>
                <div className="flex-1 text-left border-b border-[#222d34] py-[6px]">
                  <div className="text-[17px] text-[#e9edef]">{l.name}</div>
                  <div className="text-[13px] text-[#8696a0]">{getMemberCount(l.id)} {getMemberCount(l.id) === 1 ? 'chat' : 'chats'}</div>
                </div>
              </button>
              <div className="flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEditList(l)} className="p-2 hover:bg-[#374045] rounded-full text-[#8696a0]">
                  <Edit3 className="w-4 h-4" />
                </button>
                {confirmDelete === l.id ? (
                  <button onClick={() => handleDelete(l.id)} className="px-2 py-1 bg-[#e96c4c] text-white text-[12px] rounded">Delete</button>
                ) : (
                  <button onClick={() => setConfirmDelete(l.id)} className="p-2 hover:bg-[#374045] rounded-full text-[#8696a0]">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#222d34]">
          <button onClick={openNewList}
            className="w-full flex items-center justify-center gap-2 bg-[#00a884] text-[#111b21] rounded-lg h-[42px] text-[15px] font-medium hover:bg-[#06cf9c] transition-colors">
            <Plus className="w-5 h-5" /> New list
          </button>
        </div>
      </div>
    );
  }

  // ── Chat picker view ──
  if (view === 'picker') {
    return (
      <div className="absolute inset-0 bg-[#111b21] z-40 flex flex-col">
        <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4">
          <button onClick={() => { setView('editor'); setPickerSearch(''); }} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-[19px] text-[#e9edef]">Add chats</span>
        </div>
        <div className="px-[10px] py-[7px]">
          <div className="flex items-center bg-[#202c33] rounded-lg h-[35px] px-3 gap-3">
            <Search className="w-[15px] h-[15px] text-[#8696a0]" />
            <input value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Search chats"
              className="bg-transparent text-[13px] text-[#d1d7db] placeholder-[#8696a0] outline-none flex-1" autoFocus />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {pickerChats.map(c => (
            <button key={c.remoteJid} onClick={() => addMember(c.remoteJid)}
              className="w-full flex items-center gap-[13px] px-[13px] py-[10px] hover:bg-[#202c33] transition-colors">
              <Avatar name={c.pushName || '?'} jid={c.remoteJid} picUrl={c.profilePicUrl} />
              <div className="text-left border-b border-[#222d34] flex-1 py-[10px]">
                <div className="text-[17px] text-[#e9edef]">{c.pushName || c.remoteJid}</div>
              </div>
            </button>
          ))}
          {pickerChats.length === 0 && (
            <div className="text-center text-[#8696a0] text-[13px] py-8">No chats found</div>
          )}
        </div>
      </div>
    );
  }

  // ── Editor view (create / edit) ──
  return (
    <div className="absolute inset-0 bg-[#111b21] z-40 flex flex-col">
      <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4">
        <button onClick={() => setView('overview')} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-[19px] text-[#e9edef]">{editingLabel ? 'Edit list' : 'Create a new list'}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Name input */}
        <div className="px-[20px] pt-[24px] pb-[16px]">
          <input value={editorName} onChange={e => setEditorName(e.target.value)} placeholder="List name"
            className="w-full bg-transparent text-[17px] text-[#d1d7db] placeholder-[#667781] outline-none border-b-2 border-[#00a884] pb-2"
            autoFocus />
        </div>

        {/* Color picker */}
        <div className="px-[20px] pb-[20px]">
          <div className="text-[13px] text-[#8696a0] mb-2">Color</div>
          <div className="flex gap-2">
            {LABEL_COLORS.map(c => (
              <button key={c} onClick={() => setEditorColor(c)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${editorColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>

        <div className="h-2 bg-[#0b141a]" />

        {/* Included section */}
        <div className="px-[20px] pt-[16px]">
          <div className="text-[14px] text-[#8696a0] font-medium mb-3">Included</div>

          {/* Add button */}
          <button onClick={() => setView('picker')}
            className="w-full flex items-center gap-[13px] py-[10px] hover:bg-[#202c33] rounded-lg transition-colors px-1">
            <div className="w-[40px] h-[40px] rounded-full bg-[#00a884] flex items-center justify-center">
              <Plus className="w-5 h-5 text-[#111b21]" />
            </div>
            <span className="text-[17px] text-[#e9edef]">Add chats</span>
          </button>

          {/* Member list */}
          {editorMembers.map(jid => (
            <div key={jid} className="flex items-center gap-[13px] py-[10px] px-1 group">
              <Avatar name={getChatName(jid)} jid={jid}
                picUrl={chats.find(c => c.remoteJid === jid)?.profilePicUrl} />
              <div className="flex-1 border-b border-[#222d34] py-[6px]">
                <div className="text-[17px] text-[#e9edef]">{getChatName(jid)}</div>
              </div>
              <button onClick={() => setEditorMembers(prev => prev.filter(m => m !== jid))}
                className="p-2 hover:bg-[#374045] rounded-full text-[#8696a0] opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {editorMembers.length === 0 && (
            <div className="text-center text-[#667781] text-[14px] py-6">No chats added yet</div>
          )}
        </div>
      </div>

      {/* Save button */}
      <div className="p-3 border-t border-[#222d34]">
        <button onClick={handleSave} disabled={!editorName.trim()}
          className={`w-full rounded-lg h-[42px] text-[15px] font-medium transition-colors ${
            editorName.trim()
              ? 'bg-[#00a884] text-[#111b21] hover:bg-[#06cf9c]'
              : 'bg-[#202c33] text-[#667781] cursor-not-allowed'
          }`}>
          {editingLabel ? 'Save changes' : 'Create list'}
        </button>
      </div>
    </div>
  );
}

// ── Voice Recorder ───────────────────────────────────────────────────────────

function VoiceRecorderBar({ onSend, onCancel }: { onSend: (blob: Blob) => void; onCancel: () => void }) {
  const [recording, setRecording] = useState(true);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [waveData, setWaveData] = useState<number[]>([]);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        // Analyser for waveform
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        // MediaRecorder
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.start(100);

        // Timer
        timerRef.current = setInterval(() => {
          if (!cancelled) setElapsed(prev => prev + 1);
        }, 1000);

        // Waveform animation
        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const animate = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(dataArr);
          const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length / 255;
          setWaveData(prev => [...prev.slice(-60), avg]);
          animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();
      } catch (_e) { onCancel(); }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(animFrameRef.current);
      if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handlePause = () => {
    if (paused) {
      mediaRecRef.current?.resume();
      timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
    } else {
      mediaRecRef.current?.pause();
      if (timerRef.current) clearInterval(timerRef.current);
    }
    setPaused(!paused);
  };

  const handleSend = () => {
    if (!mediaRecRef.current) return;
    mediaRecRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
      onSend(blob);
    };
    mediaRecRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleCancel = () => {
    if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    onCancel();
  };

  return (
    <div className="h-[62px] bg-[#202c33] flex items-center gap-[10px] px-[10px] flex-shrink-0">
      {/* Delete */}
      <button onClick={handleCancel} className="p-2 hover:bg-[#374045] rounded-full text-[#ef4444]">
        <Trash2 className="w-[22px] h-[22px]" />
      </button>

      {/* Recording indicator + timer */}
      <div className="flex items-center gap-2 min-w-[60px]">
        <div className={`w-[10px] h-[10px] rounded-full ${paused ? 'bg-[#ef4444]' : 'bg-[#ef4444] animate-pulse'}`} />
        <span className="text-[14px] text-[#d1d7db] font-mono tabular-nums">{fmtTime(elapsed)}</span>
      </div>

      {/* Waveform */}
      <div className="flex-1 flex items-center gap-[2px] h-[30px] overflow-hidden">
        {waveData.map((v, i) => (
          <div key={i} className="rounded-full bg-[#00a884]" style={{
            width: 3, minWidth: 3,
            height: `${Math.max(8, v * 100)}%`,
            opacity: 0.5 + v * 0.5,
          }} />
        ))}
      </div>

      {/* Pause/Resume */}
      <button onClick={handlePause} className="p-2 hover:bg-[#374045] rounded-full text-[#d1d7db]">
        {paused ? (
          <Play className="w-[22px] h-[22px]" fill="#d1d7db" />
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="#ef4444">
            <rect x="5" y="3" width="5" height="18" rx="1.5" />
            <rect x="14" y="3" width="5" height="18" rx="1.5" />
          </svg>
        )}
      </button>

      {/* Send */}
      <button onClick={handleSend}
        className="w-[42px] h-[42px] rounded-full bg-[#00a884] flex items-center justify-center hover:bg-[#06cf9c] transition-colors">
        <Send className="w-[20px] h-[20px] text-[#111b21]" />
      </button>
    </div>
  );
}

// ── Starred Messages Panel ───────────────────────────────────────────────────

function StarredMessagesPanel({ starredMsgIds, businessId, onUnstar, onClose }: {
  starredMsgIds: Set<string>; businessId: string; onUnstar: (msgId: string) => void; onClose: () => void;
}) {
  const [starredMessages, setStarredMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!businessId) { setLoading(false); return; }
      const { data } = await db.from('whatsapp_starred_messages').select('*')
        .eq('business_id', businessId).order('created_at', { ascending: false });
      setStarredMessages(data || []);
      setLoading(false);
    })();
  }, [businessId, starredMsgIds.size]);

  return (
    <div className="absolute inset-0 bg-[#111b21] z-40 flex flex-col">
      <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4 flex-shrink-0">
        <button onClick={onClose} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-[19px] text-[#e9edef]">Starred messages</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-[#00a884] animate-spin" /></div>
        ) : starredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Star className="w-16 h-16 text-[#364147] mb-4" />
            <p className="text-[#8696a0] text-[14px]">No starred messages</p>
            <p className="text-[#667781] text-[13px] mt-1">Tap and hold on any message to star it so you can find it later.</p>
          </div>
        ) : (
          starredMessages.map((msg: any) => (
            <div key={msg.id} className="px-4 py-3 border-b border-[#222d34] hover:bg-[#202c33]">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[#00a884] mb-1">{msg.remote_jid?.split('@')[0]}</div>
                  <div className="text-[14px] text-[#d1d7db] truncate">{msg.content || `[${msg.type}]`}</div>
                  <div className="text-[11px] text-[#667781] mt-1">
                    {new Date(msg.created_at).toLocaleDateString()} {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button onClick={() => onUnstar(msg.message_id)} className="p-1.5 hover:bg-[#374045] rounded-full ml-2 flex-shrink-0" title="Unstar">
                  <StarOff className="w-4 h-4 text-[#f7c948]" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Message Search Panel ─────────────────────────────────────────────────────

function MessageSearchPanel({ remoteJid, lidToPhoneMap, instanceName, chatName, onClose, onScrollTo }: {
  remoteJid: string; lidToPhoneMap: Record<string, string>; instanceName: string; chatName: string;
  onClose: () => void; onScrollTo: (msgId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => new Date());
  const abortRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve primary JID for fetching
  const primaryJid = remoteJid.includes('@lid') && lidToPhoneMap[remoteJid]
    ? lidToPhoneMap[remoteJid] : remoteJid;

  // Deep search: fetch all pages, filter client-side, show results progressively
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !instanceName) return;
    abortRef.current = false;
    setSearching(true);
    setResults([]);
    setProgress('Searching...');

    const qLower = q.toLowerCase();
    const found: any[] = [];
    let page = 1;
    let totalPages = 1;

    try {
      while (page <= totalPages && !abortRef.current) {
        setProgress(`Scanning page ${page}${totalPages > 1 ? ` of ${totalPages}` : ''}...`);
        const data = await whatsappService.findMessages(instanceName, primaryJid, 50, page);
        const msgs = data?.messages || {};
        totalPages = msgs.pages || 1;
        const records = msgs.records || [];

        if (records.length === 0) break;

        for (const m of records) {
          if (abortRef.current) break;
          const txt = m.message?.conversation
            || m.message?.extendedTextMessage?.text
            || m.message?.imageMessage?.caption
            || m.message?.videoMessage?.caption
            || m.message?.documentMessage?.fileName
            || '';
          if (txt.toLowerCase().includes(qLower)) {
            found.push({ ...m, _matchText: txt });
          }
        }
        // Update results progressively
        setResults([...found]);
        page++;
      }
    } catch (e) { console.error('Search error:', e); }

    setSearching(false);
    setProgress(found.length > 0 ? `${found.length} result${found.length !== 1 ? 's' : ''} found` : 'No results found');
  }, [instanceName, primaryJid]);

  // Debounced search trigger
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current = true; // cancel previous search
    if (!query.trim()) { setResults([]); setProgress(''); setSearching(false); return; }
    debounceRef.current = setTimeout(() => doSearch(query), 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  // Cancel on unmount
  useEffect(() => () => { abortRef.current = true; }, []);

  // No pre-scanning for calendar — all past dates are clickable, search on click

  // Calendar date click: deep scan to find first message on that date
  const [calSearching, setCalSearching] = useState(false);
  const handleDateClick = async (day: number) => {
    const targetStart = new Date(calMonth.getFullYear(), calMonth.getMonth(), day).getTime() / 1000;
    const targetEnd = targetStart + 86400;
    setCalSearching(true);
    setProgress(`Looking for messages on ${day}/${calMonth.getMonth() + 1}...`);
    abortRef.current = false;
    let page = 1;
    let totalPages = 1;
    try {
      while (page <= totalPages && !abortRef.current) {
        const data = await whatsappService.findMessages(instanceName, primaryJid, 50, page);
        const msgs = data?.messages || {};
        totalPages = msgs.pages || 1;
        const records = msgs.records || [];
        if (records.length === 0) break;
        // Pages are newest-first. If oldest record on this page is after our target, skip ahead
        const oldestTs = records[records.length - 1]?.messageTimestamp || 0;
        const newestTs = records[0]?.messageTimestamp || 0;
        // Check if target date falls within this page's range
        if (newestTs >= targetStart || oldestTs <= targetEnd) {
          for (const m of records) {
            if (m.messageTimestamp >= targetStart && m.messageTimestamp < targetEnd) {
              onScrollTo(m.key.id);
              setShowCalendar(false);
              setCalSearching(false);
              setProgress('');
              return;
            }
          }
        }
        // If the oldest message on this page is older than our target, we've passed it
        if (oldestTs < targetStart) break;
        page++;
      }
      setProgress('No messages found on this date');
    } catch (e) { setProgress('Search failed'); }
    finally { setCalSearching(false); }
  };

  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = (new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).getDay() + 6) % 7;
  const today = new Date();
  const monthName = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="w-[340px] min-w-[340px] flex flex-col border-l border-[#222d34] bg-[#111b21]">
      <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4 flex-shrink-0">
        <button onClick={onClose} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]"><X className="w-5 h-5" /></button>
        <span className="text-[16px] text-[#e9edef]">Search messages</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <button onClick={() => setShowCalendar(!showCalendar)}
          className={`p-2 rounded-lg transition-colors ${showCalendar ? 'bg-[#00a884] text-[#111b21]' : 'hover:bg-[#2a3942] text-[#8696a0]'}`}>
          <Calendar className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 flex items-center bg-[#202c33] rounded-lg h-[35px] px-3 gap-2">
          <Search className="w-[14px] h-[14px] text-[#8696a0]" />
          <input value={query} onChange={e => { setQuery(e.target.value); setShowCalendar(false); }}
            placeholder="Search" autoFocus
            className="bg-transparent text-[13px] text-[#d1d7db] placeholder-[#8696a0] outline-none flex-1" />
          {query && <button onClick={() => { setQuery(''); abortRef.current = true; }} className="text-[#8696a0]"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {showCalendar && (
        <div className="px-3 pb-3 flex-shrink-0">
          <div className="bg-[#202c33] rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] text-[#e9edef] font-medium">{monthName}</span>
              <div className="flex gap-1">
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                  className="p-1 hover:bg-[#374045] rounded text-[#8696a0]"><ArrowLeft className="w-4 h-4" /></button>
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                  className="p-1 hover:bg-[#374045] rounded text-[#8696a0]"><ArrowLeft className="w-4 h-4 rotate-180" /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => <div key={d} className="text-[11px] text-[#8696a0] py-1">{d}</div>)}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday = day === today.getDate() && calMonth.getMonth() === today.getMonth() && calMonth.getFullYear() === today.getFullYear();
                const isFuture = new Date(calMonth.getFullYear(), calMonth.getMonth(), day) > today;
                return (
                  <button key={day} disabled={isFuture || calSearching} onClick={() => handleDateClick(day)}
                    className={`text-[13px] py-1.5 rounded transition-colors
                      ${isToday ? 'bg-[#00a884] text-[#111b21] font-bold' : ''}
                      ${!isToday && !isFuture ? 'text-[#e9edef] hover:bg-[#2a3942] cursor-pointer' : ''}
                      ${isFuture ? 'text-[#3b4a54] cursor-default' : ''}`}>
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Status bar */}
        {(searching || progress) && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#222d34]">
            {searching && <Loader2 className="w-4 h-4 text-[#00a884] animate-spin flex-shrink-0" />}
            <span className="text-[12px] text-[#8696a0]">{progress}</span>
          </div>
        )}

        {!query.trim() && !showCalendar ? (
          <div className="flex items-center justify-center h-full text-[#8696a0] text-[14px] px-8 text-center">
            Search for messages with {chatName}.
          </div>
        ) : (
          results.map(msg => {
            const text: string = msg._matchText || '';
            const d = new Date(msg.messageTimestamp * 1000);
            const dateStr = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            const qLow = query.toLowerCase();
            const idx = text.toLowerCase().indexOf(qLow);
            return (
              <button key={msg.id || msg.key?.id} onClick={() => onScrollTo(msg.key.id)}
                className="w-full text-left px-4 py-3 border-b border-[#222d34] hover:bg-[#202c33] transition-colors">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-[12px] text-[#00a884]">{msg.key.fromMe ? 'You' : (msg.pushName || '')}</span>
                  <span className="text-[11px] text-[#8696a0]">{dateStr}</span>
                </div>
                <div className="text-[13px] text-[#d1d7db] line-clamp-2">
                  {idx >= 0 ? (
                    <>{text.slice(Math.max(0, idx - 20), idx)}<span className="bg-[#00a884]/30 text-[#e9edef] rounded px-0.5">{text.slice(idx, idx + query.length)}</span>{text.slice(idx + query.length, idx + query.length + 40)}</>
                  ) : text.slice(0, 60)}
                </div>
                <div className="text-[11px] text-[#667781] mt-0.5">{formatTime(msg.messageTimestamp)}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WhatsAppInbox() {
  const { toast } = useToast();
  const [chats, setChats] = useState<EvolutionChat[]>([]);
  const [messages, setMessages] = useState<EvolutionMessage[]>([]);
  const [reactionsMap, setReactionsMap] = useState<Record<string, string[]>>({});
  const [selectedChat, setSelectedChat] = useState<EvolutionChat | null>(null);
  const selectedChatRef = useRef<EvolutionChat | null>(null);
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
  const [replyText, setReplyText] = useState('');
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [instanceProfile, setInstanceProfile] = useState<{ profilePicUrl?: string; ownerJid?: string }>({});
  const [businessId, setBusinessId] = useState<string | null>(null);
  // Maps LID JIDs to phone JIDs for sending messages
  const [lidToPhoneMap, setLidToPhoneMap] = useState<Record<string, string>>({});
  const lidToPhoneRef = useRef<Record<string, string>>({});
  useEffect(() => { lidToPhoneRef.current = lidToPhoneMap; }, [lidToPhoneMap]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>('none');
  const [chatSettings, setChatSettings] = useState<Record<string, ChatSettings>>({});
  const [labels, setLabels] = useState<Label[]>([]);
  const [chatLabelsMap, setChatLabelsMap] = useState<Record<string, string[]>>({});
  const [starredMsgIds, setStarredMsgIds] = useState<Set<string>>(new Set());
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttachment, setShowAttachment] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chat: EvolutionChat } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const nextPageRef = useRef(2); // page 1 is initial load, start from 2
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileInputType, setFileInputType] = useState('');
  const [replyingTo, setReplyingTo] = useState<EvolutionMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<EvolutionMessage | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<{ message_id: string; content: string | null } | null>(null);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const biz = localStorage.getItem('activeBusinessId');
    if (biz) setBusinessId(biz);

    (async () => {
      if (!biz) return;
      const { data } = await supabase.from('whatsapp_instances').select('instance_name, profile_pic, phone_number')
        .eq('business_id', biz).eq('status', 'open').limit(1).single();
      if (data) {
        setInstanceName(data.instance_name);
        // Get owner info from Evolution API
        try {
          const evoInstances = await whatsappService.invokeClient('fetch-instances', {});
          if (Array.isArray(evoInstances)) {
            const match = evoInstances.find((i: any) => i.name === data.instance_name);
            const ownerPhone = match?.ownerJid?.split('@')[0] || data.phone_number;
            const ownerPicUrl = match?.profilePicUrl || null;
            // Proxy the owner's profile pic through edge function
            if (ownerPicUrl) {
              const picData = await whatsappService.invokeClient('proxy-image', { instanceName: data.instance_name, url: ownerPicUrl });
              if (picData?.base64) {
                setInstanceProfile({ profilePicUrl: picData.base64, ownerJid: ownerPhone });
                _avatarCache.set('owner', picData.base64);
              } else {
                setInstanceProfile({ ownerJid: ownerPhone });
              }
            } else {
              setInstanceProfile({ ownerJid: ownerPhone });
            }
            if (ownerPhone && ownerPhone !== data.phone_number) {
              await supabase.from('whatsapp_instances').update({ phone_number: ownerPhone }).eq('instance_name', data.instance_name);
            }
          }
        } catch (_e) { /* fallback: no pic */ }
      }
    })();
  }, []);

  // ── Load settings, labels, starred ─────────────────────────────────────
  const loadMetadata = useCallback(async () => {
    if (!businessId) return;
    const [settingsRes, labelsRes, chatLabelsRes, starredRes] = await Promise.all([
      db.from('whatsapp_chat_settings').select('*').eq('business_id', businessId),
      db.from('whatsapp_labels').select('*').eq('business_id', businessId),
      db.from('whatsapp_chat_labels').select('*').eq('business_id', businessId),
      db.from('whatsapp_starred_messages').select('message_id').eq('business_id', businessId),
    ]);
    if (settingsRes.data) {
      const map: Record<string, ChatSettings> = {};
      for (const s of settingsRes.data) map[s.remote_jid] = s;
      setChatSettings(map);
    }
    if (labelsRes.data) setLabels(labelsRes.data);
    if (chatLabelsRes.data) {
      const map: Record<string, string[]> = {};
      for (const cl of chatLabelsRes.data) {
        if (!map[cl.remote_jid]) map[cl.remote_jid] = [];
        map[cl.remote_jid].push(cl.label_id);
      }
      setChatLabelsMap(map);
    }
    if (starredRes.data) setStarredMsgIds(new Set(starredRes.data.map((s: any) => s.message_id)));
  }, [businessId]);

  useEffect(() => { loadMetadata(); }, [loadMetadata]);

  // ── Fetch chats (from Supabase) ─────────────────────────────────────────
  const fetchChats = useCallback(async () => {
    if (!instanceName || !businessId) return;
    try {
      // Get the instance ID
      const { data: instData } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', instanceName)
        .single();
      if (!instData) { setLoadingChats(false); return; }

      // Load JID mappings, contacts, and latest message per remote_jid in parallel
      const [jidRes, contactsRes] = await Promise.all([
        db.from('whatsapp_jid_mappings').select('lid_jid, phone_jid').eq('business_id', businessId),
        db.from('whatsapp_contacts').select('phone_number, name, profile_pic').eq('business_id', businessId),
      ]);

      // Build LID→phone map from DB
      const lidToPhone: Record<string, string> = {};
      if (jidRes.data) {
        for (const m of jidRes.data) lidToPhone[m.lid_jid] = m.phone_jid;
      }
      setLidToPhoneMap(lidToPhone);

      // Build contact lookup: JID -> { name, profilePic }
      const contactMap: Record<string, { name: string; profilePic: string | null }> = {};
      if (contactsRes.data) {
        for (const c of contactsRes.data) {
          if (c.name) contactMap[c.phone_number] = { name: c.name, profilePic: c.profile_pic };
        }
      }

      // Get distinct chats with last message using raw SQL via a direct query
      // We query the last message per remote_jid for this instance
      const { data: chatRows } = await db
        .from('whatsapp_messages')
        .select('remote_jid, content, type, direction, status, created_at, message_id')
        .eq('instance_id', instData.id)
        .order('created_at', { ascending: false });

      if (!chatRows) { setLoadingChats(false); return; }

      // Group by remote_jid, keep only the latest message per JID
      const chatMap = new Map<string, any>();
      const countMap = new Map<string, number>();
      for (const row of chatRows) {
        if (!chatMap.has(row.remote_jid)) {
          chatMap.set(row.remote_jid, row);
          countMap.set(row.remote_jid, 0);
        }
      }

      // Deduplicate: if we have both LID and phone JID entries, merge them
      const phonesToRemove = new Set(Object.values(lidToPhone));
      const deduped: string[] = [];
      for (const jid of chatMap.keys()) {
        // Skip phone JIDs that have a LID entry
        if (jid.includes('@s.whatsapp.net') && phonesToRemove.has(jid)) {
          // Merge into the LID entry
          const lidJid = Object.keys(lidToPhone).find(k => lidToPhone[k] === jid);
          if (lidJid && chatMap.has(lidJid)) {
            const lidRow = chatMap.get(lidJid);
            const phoneRow = chatMap.get(jid);
            // Keep newer message
            if (phoneRow && new Date(phoneRow.created_at) > new Date(lidRow.created_at)) {
              chatMap.set(lidJid, phoneRow);
            }
            continue;
          }
        }
        deduped.push(jid);
      }

      // Build EvolutionChat objects
      const enriched: EvolutionChat[] = deduped.map(jid => {
        const row = chatMap.get(jid)!;
        const ts = Math.floor(new Date(row.created_at).getTime() / 1000);

        // Resolve contact name
        let displayName = '';
        let profilePic: string | null = null;

        // Try direct contact lookup
        const contact = contactMap[jid];
        if (contact?.name) { displayName = contact.name; profilePic = contact.profilePic; }

        // For LID JIDs, try the phone JID contact
        if (!displayName && jid.includes('@lid')) {
          const phoneJid = lidToPhone[jid];
          if (phoneJid) {
            const phoneContact = contactMap[phoneJid];
            if (phoneContact?.name) { displayName = phoneContact.name; profilePic = phoneContact.profilePic; }
            else displayName = '+' + phoneJid.split('@')[0];
          }
        }

        // Fallback: format phone number or show unknown
        if (!displayName) {
          if (jid.includes('@s.whatsapp.net')) displayName = '+' + jid.split('@')[0];
          else displayName = '~ Contact';
        }

        return {
          id: jid,
          remoteJid: jid,
          pushName: displayName,
          profilePicUrl: profilePic,
          updatedAt: row.created_at,
          lastMessage: {
            key: { id: row.message_id, fromMe: row.direction === 'outgoing' },
            pushName: row.direction === 'outgoing' ? 'You' : displayName,
            messageType: row.type || 'conversation',
            message: row.type === 'audioMessage' ? { audioMessage: {} }
              : row.type === 'imageMessage' ? { imageMessage: { caption: row.content } }
              : row.type === 'videoMessage' ? { videoMessage: { caption: row.content } }
              : row.type === 'documentMessage' ? { documentMessage: { fileName: row.content } }
              : { conversation: row.content },
            messageTimestamp: ts,
            status: row.status || 'sent',
          },
          unreadCount: 0, // Computed from chat_settings.last_read_at
        };
      });

      // Compute unread counts from chat_settings
      const enrichedWithUnread = enriched.map(chat => {
        const s = chatSettings[chat.remoteJid];
        if (!s?.last_read_at || !chat.lastMessage) return chat;
        // Count messages after last_read_at for this JID
        const lastReadTs = s.last_read_at;
        const msgTs = chat.lastMessage.messageTimestamp;
        if (msgTs > lastReadTs && !chat.lastMessage.key.fromMe) {
          return { ...chat, unreadCount: 1 }; // At least 1 unread
        }
        return chat;
      });

      setChats(enrichedWithUnread);
    } catch (e) { console.error(e); }
    finally { setLoadingChats(false); }
  }, [instanceName, businessId, chatSettings]);

  useEffect(() => {
    if (!instanceName) return;
    fetchChats();
    const channel = supabase.channel('whatsapp_inbox_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        // Optimistically update chat list preview + order from the realtime payload
        if (payload.new) {
          const nm = payload.new as any;
          const jid = nm.remote_jid;
          const map = lidToPhoneRef.current;
          // Find which chat this belongs to (could be phone or LID jid)
          const matchJid = jid; // direct match
          const altJid = Object.keys(map).find(k => map[k] === jid) || map[jid]; // LID↔phone
          setChats(prev => {
            const idx = prev.findIndex(c => c.remoteJid === matchJid || c.remoteJid === altJid);
            if (idx === -1) { fetchChats(); return prev; } // unknown chat, full refresh
            const updated = [...prev];
            const chat = { ...updated[idx] };
            chat.lastMessage = {
              key: { id: nm.message_id, fromMe: nm.direction === 'outgoing' },
              pushName: nm.direction === 'outgoing' ? 'You' : chat.pushName,
              messageType: nm.type || 'conversation',
              message: nm.type === 'audioMessage' ? { audioMessage: {} } : { conversation: nm.content },
              messageTimestamp: Math.floor(new Date(nm.created_at).getTime() / 1000),
              status: nm.status || 'sent',
            };
            if (nm.direction === 'incoming') chat.unreadCount = (chat.unreadCount || 0) + 1;
            // Move to top
            updated.splice(idx, 1);
            updated.unshift(chat);
            return updated;
          });
        }
        // No fetchChats() here — the optimistic update above is sufficient
        // fetchChats would overwrite with potentially stale Evolution API data
        // For messages: append the new message directly instead of reloading everything
        const current = selectedChatRef.current;
        if (current && payload.new) {
          const newMsg = payload.new as any;
          // Check if message belongs to current chat (handle LID↔phone both ways)
          const map = lidToPhoneRef.current;
          const phoneJid = map[current.remoteJid];
          const lidJid = Object.keys(map).find(k => map[k] === current.remoteJid);
          if (newMsg.remote_jid === current.remoteJid || newMsg.remote_jid === phoneJid || newMsg.remote_jid === lidJid) {
            // Handle reaction messages: update reactionsMap, don't add as visible message
            if (newMsg.type === 'reactionMessage' && newMsg.content) {
              try {
                const { targetMessageId, emoji } = JSON.parse(newMsg.content);
                if (targetMessageId && emoji) {
                  setReactionsMap(prev => {
                    const existing = prev[targetMessageId] || [];
                    if (existing.includes(emoji)) return prev;
                    return { ...prev, [targetMessageId]: [...existing, emoji] };
                  });
                } else if (targetMessageId && !emoji) {
                  // Empty emoji = reaction removed
                  setReactionsMap(prev => {
                    const { [targetMessageId]: _, ...rest } = prev;
                    return rest;
                  });
                }
              } catch {}
              return; // Don't add reaction as a visible message
            }
            // Convert Supabase row to EvolutionMessage-like shape for display
            const evoMsg: EvolutionMessage = {
              id: newMsg.id,
              key: { id: newMsg.message_id, fromMe: newMsg.direction === 'outgoing', remoteJid: newMsg.remote_jid },
              pushName: newMsg.direction === 'outgoing' ? 'You' : (current.pushName || ''),
              messageType: newMsg.type || 'conversation',
              message: { conversation: newMsg.content },
              messageTimestamp: Math.floor(new Date(newMsg.created_at).getTime() / 1000),
              source: 'webhook',
              MessageUpdate: [{ status: newMsg.status === 'read' ? 'READ' : newMsg.status === 'delivered' ? 'DELIVERY_ACK' : 'SERVER_ACK' }],
            };
            setMessages(prev => {
              // Skip if already exists (optimistic or duplicate)
              if (prev.some(m => m.key.id === evoMsg.key.id)) return prev;
              // Remove optimistic messages that match (sent around same time, same direction)
              const cleaned = prev.filter(m => {
                if (!m.id.startsWith('opt-')) return true;
                return Math.abs(m.messageTimestamp - evoMsg.messageTimestamp) > 10;
              });
              return [...cleaned, evoMsg];
            });
            scrollToBottom();
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        // Update message ticks in the thread in realtime
        if (payload.new) {
          const updated = payload.new as any;
          const msgId = updated.message_id;
          const newStatus = updated.status; // 'sent' | 'delivered' | 'read'
          if (msgId && newStatus) {
            setMessages(prev => prev.map(m => {
              if (m.key.id === msgId || m.id === msgId) {
                // Map to Evolution-style status
                const evoStatus = newStatus === 'read' ? 'READ' : newStatus === 'delivered' ? 'DELIVERY_ACK' : 'SERVER_ACK';
                return { ...m, MessageUpdate: [{ status: evoStatus }] };
              }
              return m;
            }));
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [instanceName]);

  // ── Fetch messages (from Supabase) ──────────────────────────────────────
  const fetchMessages = useCallback(async (remoteJid: string) => {
    if (!instanceName || !businessId) return;
    setLoadingMessages(true);
    try {
      // Build list of JIDs to query (both LID and phone if linked)
      const jids = [remoteJid];
      if (remoteJid.includes('@lid') && lidToPhoneMap[remoteJid]) {
        jids.push(lidToPhoneMap[remoteJid]);
      } else if (remoteJid.includes('@s.whatsapp.net')) {
        const lidJid = Object.keys(lidToPhoneMap).find(k => lidToPhoneMap[k] === remoteJid);
        if (lidJid) jids.push(lidJid);
      }

      // Fetch messages from Supabase
      const { data: msgRows } = await db
        .from('whatsapp_messages')
        .select('*')
        .eq('business_id', businessId)
        .in('remote_jid', jids)
        .neq('type', 'protocolMessage')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!msgRows) { setLoadingMessages(false); return; }

      // Separate reactions from regular messages
      const reactionRows = msgRows.filter((m: any) => m.type === 'reactionMessage');
      const regularRows = msgRows.filter((m: any) => m.type !== 'reactionMessage');

      // Build reactions map from DB data
      const newReactions: Record<string, string[]> = {};
      for (const r of reactionRows) {
        try {
          const { targetMessageId, emoji } = JSON.parse(r.content || '{}');
          if (targetMessageId && emoji) {
            if (!newReactions[targetMessageId]) newReactions[targetMessageId] = [];
            if (!newReactions[targetMessageId].includes(emoji)) newReactions[targetMessageId].push(emoji);
          }
        } catch {}
      }
      setReactionsMap(newReactions);

      // Convert DB rows to EvolutionMessage format (sorted ascending)
      const records: EvolutionMessage[] = regularRows
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((row: any) => {
          const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
          const rawKey = row.raw_key || { id: row.message_id, fromMe: row.direction === 'outgoing', remoteJid: row.remote_jid };
          return {
            id: row.id,
            key: { id: row.message_id, fromMe: row.direction === 'outgoing', remoteJid: row.remote_jid },
            pushName: row.direction === 'outgoing' ? 'You' : '',
            messageType: row.type || 'conversation',
            message: row.type === 'audioMessage' ? { audioMessage: { seconds: parseInt(row.content?.match(/\d+/)?.[0] || '0'), url: row.media_url } }
              : row.type === 'imageMessage' ? { imageMessage: { caption: row.content, url: row.media_url } }
              : row.type === 'videoMessage' ? { videoMessage: { caption: row.content, url: row.media_url, seconds: 0 } }
              : row.type === 'documentMessage' ? { documentMessage: { fileName: row.content, url: row.media_url } }
              : row.type === 'stickerMessage' ? { stickerMessage: { url: row.media_url } }
              : row.type === 'extendedTextMessage' ? { extendedTextMessage: { text: row.content } }
              : { conversation: row.content },
            messageTimestamp: ts,
            source: 'database',
            MessageUpdate: [{ status: row.status === 'read' ? 'READ' : row.status === 'delivered' ? 'DELIVERY_ACK' : 'SERVER_ACK' }],
            _rawKey: rawKey, // Preserved for media retrieval
          } as EvolutionMessage & { _rawKey?: any };
        });

      // Track pagination
      setHasMoreMessages(regularRows.length >= 50);
      nextPageRef.current = 50; // offset for next page

      // Merge with any pending optimistic messages
      setMessages(prev => {
        const optimistic = prev.filter(m => m.id.startsWith('opt-'));
        if (optimistic.length === 0) return records;
        const now = Math.floor(Date.now() / 1000);
        const stillPending = optimistic.filter(opt => {
          if (now - opt.messageTimestamp > 30) return false;
          const matched = records.some(r => r.key.fromMe && Math.abs(r.messageTimestamp - opt.messageTimestamp) < 10);
          return !matched;
        });
        return [...records, ...stillPending];
      });
    } catch (e) { console.error(e); }
    finally { setLoadingMessages(false); }
  }, [instanceName, businessId, lidToPhoneMap]);

  // ── Load older messages (infinite scroll, from Supabase) ────────────────
  const loadOlderMessages = useCallback(async () => {
    const chat = selectedChatRef.current;
    if (!instanceName || !businessId || !chat || loadingOlder || !hasMoreMessages) return;
    setLoadingOlder(true);

    try {
      // Build JID list for query
      const jids = [chat.remoteJid];
      if (chat.remoteJid.includes('@lid') && lidToPhoneMap[chat.remoteJid]) {
        jids.push(lidToPhoneMap[chat.remoteJid]);
      } else if (chat.remoteJid.includes('@s.whatsapp.net')) {
        const lidJid = Object.keys(lidToPhoneMap).find(k => lidToPhoneMap[k] === chat.remoteJid);
        if (lidJid) jids.push(lidJid);
      }

      const offset = nextPageRef.current;
      const { data: olderRows } = await db
        .from('whatsapp_messages')
        .select('*')
        .eq('business_id', businessId)
        .in('remote_jid', jids)
        .neq('type', 'protocolMessage')
        .neq('type', 'reactionMessage')
        .order('created_at', { ascending: false })
        .range(offset, offset + 49);

      const records = olderRows || [];

      if (records.length < 50) {
        setHasMoreMessages(false);
      } else {
        nextPageRef.current = offset + 50;
      }

      if (records.length > 0) {
        // Merge older reactions
        const { data: reactionRows } = await db
          .from('whatsapp_messages')
          .select('content')
          .eq('business_id', businessId)
          .in('remote_jid', jids)
          .eq('type', 'reactionMessage');

        if (reactionRows) {
          const olderReactions: Record<string, string[]> = {};
          for (const r of reactionRows) {
            try {
              const { targetMessageId, emoji } = JSON.parse(r.content || '{}');
              if (targetMessageId && emoji) {
                if (!olderReactions[targetMessageId]) olderReactions[targetMessageId] = [];
                if (!olderReactions[targetMessageId].includes(emoji)) olderReactions[targetMessageId].push(emoji);
              }
            } catch {}
          }
          setReactionsMap(prev => {
            const merged = { ...prev };
            for (const [k, v] of Object.entries(olderReactions)) {
            merged[k] = merged[k] ? [...new Set([...merged[k], ...v])] : v;
          }
          return merged;
        });
        }

        // Convert DB rows to EvolutionMessage format
        const filtered: EvolutionMessage[] = records
          .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map((row: any) => {
            const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
            const rawKey = row.raw_key || { id: row.message_id, fromMe: row.direction === 'outgoing', remoteJid: row.remote_jid };
            return {
              id: row.id,
              key: { id: row.message_id, fromMe: row.direction === 'outgoing', remoteJid: row.remote_jid },
              pushName: row.direction === 'outgoing' ? 'You' : '',
              messageType: row.type || 'conversation',
              message: row.type === 'audioMessage' ? { audioMessage: { seconds: parseInt(row.content?.match(/\d+/)?.[0] || '0'), url: row.media_url } }
                : row.type === 'imageMessage' ? { imageMessage: { caption: row.content, url: row.media_url } }
                : row.type === 'videoMessage' ? { videoMessage: { caption: row.content, url: row.media_url, seconds: 0 } }
                : row.type === 'documentMessage' ? { documentMessage: { fileName: row.content, url: row.media_url } }
                : row.type === 'stickerMessage' ? { stickerMessage: { url: row.media_url } }
                : { conversation: row.content },
              messageTimestamp: ts,
              source: 'database',
              MessageUpdate: [{ status: row.status === 'read' ? 'READ' : row.status === 'delivered' ? 'DELIVERY_ACK' : 'SERVER_ACK' }],
            } as EvolutionMessage;
          });

        // With column-reverse, prepending older messages at the top doesn't shift
        // the viewport — the browser handles scroll anchoring automatically.
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.key?.id || m.id));
          const newMsgs = filtered.filter(m => !existingIds.has(m.key?.id));
          return [...newMsgs, ...prev];
        });
      }
    } catch (e) { console.error(e); }
    finally { setLoadingOlder(false); }
  }, [instanceName, businessId, lidToPhoneMap, loadingOlder, hasMoreMessages]);

  const handleSelectChat = (chat: EvolutionChat) => {
    setSelectedChat(chat);
    setMessages([]);
    setReactionsMap({});
    setPinnedMessage(null);
    setShowMessageSearch(false);
    setHasMoreMessages(true);
    nextPageRef.current = 50;
    fetchMessages(chat.remoteJid).then(() => scrollToBottom(true));
    setContextMenu(null);
    setSidePanel('none');

    // Mark chat as read — clear unread badge locally + persist read timestamp
    setChats(prev => prev.map(c => c.remoteJid === chat.remoteJid ? { ...c, unreadCount: 0 } : c));
    const nowTs = Math.floor(Date.now() / 1000);
    setChatSettings(prev => ({
      ...prev,
      [chat.remoteJid]: { ...prev[chat.remoteJid], remote_jid: chat.remoteJid, last_read_at: nowTs } as ChatSettings,
    }));
    if (businessId) {
      db.from('whatsapp_chat_settings').upsert(
        { business_id: businessId, remote_jid: chat.remoteJid, last_read_at: nowTs },
        { onConflict: 'business_id, remote_jid' }
      ).then(() => {});
    }
    // Also send read receipt to WhatsApp (best-effort, doesn't affect our unread tracking)
    if (chat.lastMessage?.key && instanceName) {
      whatsappService.markChatRead(instanceName, {
        remoteJid: chat.remoteJid,
        fromMe: chat.lastMessage.key.fromMe,
        id: chat.lastMessage.key.id,
      }).catch(() => {});
    }

    // Fetch pinned message
    if (businessId) {
      db.from('whatsapp_pinned_messages').select('message_id, content')
        .eq('business_id', businessId).eq('remote_jid', chat.remoteJid)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }: any) => { setPinnedMessage(data || null); });
    }
  };

  // Scroll to bottom — in column-reverse, scrollTop=0 IS the bottom
  const scrollToBottom = useCallback((instant = false) => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (instant) {
      el.scrollTop = 0;
    } else {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // ── Send text ──────────────────────────────────────────────────────────
  // (handleSend removed — handleSendWithReply handles all sends)

  // ── Send voice note ────────────────────────────────────────────────────
  const handleSendVoiceNote = async (blob: Blob) => {
    setIsRecording(false);
    if (!selectedChat || !instanceName) return;
    const number = getPhoneNumber(selectedChat.remoteJid);
    const chatJid = selectedChat.remoteJid;

    // Optimistic chat list update
    setChats(prev => prev.map(c =>
      c.remoteJid === chatJid
        ? { ...c, lastMessage: { key: { id: `opt-vn-${Date.now()}`, fromMe: true }, pushName: 'You', messageType: 'audioMessage', message: { audioMessage: {} }, messageTimestamp: Math.floor(Date.now() / 1000), status: 'SERVER_ACK' } }
        : c
    ));

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUri = reader.result as string;
        const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        await whatsappService.sendAudio(instanceName, number, base64);
        setTimeout(() => { const c = selectedChatRef.current; if (c) fetchMessages(c.remoteJid); fetchChats(); }, 2000);
      } catch (e: any) { toast({ title: 'Send failed', description: e.message, variant: 'destructive' }); }
    };
    reader.readAsDataURL(blob);
  };

  // ── Send media ─────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat || !instanceName) return;
    const number = getPhoneNumber(selectedChat.remoteJid);
    const chatJid = selectedChat.remoteJid; // capture now, not in closure
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        await whatsappService.sendMedia(instanceName, number, { type: fileInputType || 'document', url: base64 });
        toast({ title: 'Media sent' });
        setTimeout(() => { const c = selectedChatRef.current; if (c) fetchMessages(c.remoteJid); }, 2000);
      } catch (err: any) { toast({ title: 'Upload failed', description: err.message, variant: 'destructive' }); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const openFileInput = (type: string) => {
    setFileInputType(type);
    if (fileInputRef.current) {
      if (type === 'image') fileInputRef.current.accept = 'image/*,video/*';
      else if (type === 'audio') fileInputRef.current.accept = 'audio/*';
      else if (type === 'document') fileInputRef.current.accept = '*/*';
      else fileInputRef.current.accept = '*/*';
      fileInputRef.current.click();
    }
  };

  // ── Chat settings actions ──────────────────────────────────────────────
  const updateChatSetting = async (jid: string, field: string, value: any) => {
    if (!businessId) return;
    // Optimistic update
    setChatSettings(prev => ({
      ...prev,
      [jid]: { ...prev[jid], remote_jid: jid, [field]: value } as ChatSettings,
    }));
    await db.from('whatsapp_chat_settings').upsert(
      { business_id: businessId, remote_jid: jid, [field]: value },
      { onConflict: 'business_id, remote_jid' }
    );
    loadMetadata();
  };

  const toggleStar = async (msgId: string) => {
    if (!businessId || !selectedChat) return;
    const isStarred = starredMsgIds.has(msgId);
    if (isStarred) {
      setStarredMsgIds(prev => { const n = new Set(prev); n.delete(msgId); return n; });
      await db.from('whatsapp_starred_messages').delete().eq('business_id', businessId).eq('message_id', msgId);
    } else {
      // Find the message to save its content
      const msg = messages.find(m => m.key.id === msgId);
      const content = msg ? (getTextContent(msg) || `[${msg.messageType}]`) : '';
      const pushName = msg?.pushName || selectedChat.remoteJid.split('@')[0];
      setStarredMsgIds(prev => new Set(prev).add(msgId));
      await db.from('whatsapp_starred_messages').insert({
        business_id: businessId,
        remote_jid: selectedChat.remoteJid,
        message_id: msgId,
        content: `${pushName}: ${content}`,
      });
    }
    loadMetadata();
  };

  const archiveChat = async (jid: string) => {
    if (!businessId) return;
    setChatSettings(prev => ({ ...prev, [jid]: { ...prev[jid], remote_jid: jid, is_archived: true } as ChatSettings }));
    if (selectedChat?.remoteJid === jid) setSelectedChat(null);
    await db.from('whatsapp_chat_settings').upsert(
      { business_id: businessId, remote_jid: jid, is_archived: true },
      { onConflict: 'business_id, remote_jid' }
    );
    loadMetadata();
    toast({ title: 'Chat archived' });
  };

  const blockContact = async (jid: string) => {
    if (!businessId) return;
    setChatSettings(prev => ({ ...prev, [jid]: { ...prev[jid], remote_jid: jid, is_blocked: true } as ChatSettings }));
    if (selectedChat?.remoteJid === jid) setSelectedChat(null);
    await db.from('whatsapp_chat_settings').upsert(
      { business_id: businessId, remote_jid: jid, is_blocked: true },
      { onConflict: 'business_id, remote_jid' }
    );
    loadMetadata();
    toast({ title: 'Contact blocked' });
  };

  const deleteChatPermanent = async (jid: string) => {
    if (!businessId) return;
    setChatSettings(prev => ({ ...prev, [jid]: { ...prev[jid], remote_jid: jid, is_archived: true } as ChatSettings }));
    if (selectedChat?.remoteJid === jid) setSelectedChat(null);
    await db.from('whatsapp_chat_settings').upsert(
      { business_id: businessId, remote_jid: jid, is_archived: true },
      { onConflict: 'business_id, remote_jid' }
    );
    // Also clean up labels
    await db.from('whatsapp_chat_labels').delete().eq('business_id', businessId).eq('remote_jid', jid);
    loadMetadata();
    toast({ title: 'Chat deleted' });
  };

  // Resolve JID to a phone number for sending messages
  const getPhoneNumber = useCallback((jid: string): string => {
    if (jid.includes('@s.whatsapp.net')) return jid.split('@')[0];
    const phoneJid = lidToPhoneMap[jid];
    if (phoneJid) return phoneJid.split('@')[0];
    // LID with no mapping — return empty (can't send to this)
    return '';
  }, [lidToPhoneMap]);

  // Format for display: phone with + prefix, or empty for unresolved LIDs
  const getDisplayPhone = useCallback((jid: string): string => {
    const num = getPhoneNumber(jid);
    return num ? '+' + num : '';
  }, [getPhoneNumber]);

  // ── Message actions ─────────────────────────────────────────────────────
  const handleReply = (msg: EvolutionMessage) => {
    setReplyingTo(msg);
  };

  const handleReact = async (msgKey: { remoteJid: string; fromMe: boolean; id: string }, reaction: string) => {
    if (!instanceName) return;
    // Optimistically update reactionsMap
    setReactionsMap(prev => {
      if (!reaction) {
        // Remove all reactions for this message
        const { [msgKey.id]: _, ...rest } = prev;
        return rest;
      }
      const existing = prev[msgKey.id] || [];
      if (existing.includes(reaction)) return prev;
      return { ...prev, [msgKey.id]: [...existing, reaction] };
    });
    try {
      await whatsappService.sendReaction(instanceName, msgKey, reaction);
    } catch (e: any) {
      toast({ title: 'Reaction failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleDeleteMessage = async (msg: EvolutionMessage) => {
    if (!instanceName) return;
    try {
      await whatsappService.deleteMessage(instanceName, msg.key.id, msg.key.fromMe, msg.key.remoteJid);
      // Remove from local state immediately
      setMessages(prev => prev.filter(m => m.key.id !== msg.key.id));
      toast({ title: 'Message deleted' });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleForward = (msg: EvolutionMessage) => {
    setForwardingMsg(msg);
    setSidePanel('new-chat');
  };

  const handleTogglePin = async (msg: EvolutionMessage) => {
    if (!businessId || !selectedChat) return;
    // If this message is already pinned, unpin it
    if (pinnedMessage?.message_id === msg.key.id) {
      await db.from('whatsapp_pinned_messages').delete().eq('business_id', businessId).eq('remote_jid', selectedChat.remoteJid);
      setPinnedMessage(null);
      toast({ title: 'Message unpinned' });
    } else {
      const content = getTextContent(msg) || `[${msg.messageType}]`;
      await db.from('whatsapp_pinned_messages').delete().eq('business_id', businessId).eq('remote_jid', selectedChat.remoteJid);
      await db.from('whatsapp_pinned_messages').insert({
        business_id: businessId, remote_jid: selectedChat.remoteJid, message_id: msg.key.id, content,
      });
      setPinnedMessage({ message_id: msg.key.id, content });
      toast({ title: 'Message pinned' });
    }
  };

  // Override send to support replies
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSendWithReply = async () => {
    if (!replyText.trim() || !selectedChat || !instanceName) return;
    const sentText = replyText;
    const wasReplyingTo = replyingTo;
    setReplyText('');
    setReplyingTo(null);
    setShowEmoji(false);

    // Keep focus on input
    requestAnimationFrame(() => inputRef.current?.focus());

    // Optimistically add message to UI immediately
    const optimisticMsg: EvolutionMessage = {
      id: `opt-${Date.now()}`,
      key: { id: `opt-${Date.now()}`, fromMe: true, remoteJid: selectedChat.remoteJid },
      pushName: 'You',
      messageType: 'conversation',
      message: { conversation: sentText },
      messageTimestamp: Math.floor(Date.now() / 1000),
      source: 'web',
      MessageUpdate: [{ status: 'SERVER_ACK' }],
    };
    setMessages(prev => [...prev, optimisticMsg]);
    scrollToBottom();

    // Update chat list preview immediately
    setChats(prev => {
      const updated = prev.map(c =>
        c.remoteJid === selectedChat.remoteJid
          ? { ...c, lastMessage: { key: { id: optimisticMsg.key.id, fromMe: true }, pushName: 'You', messageType: 'conversation', message: { conversation: sentText }, messageTimestamp: optimisticMsg.messageTimestamp, status: 'SERVER_ACK' } }
          : c
      );
      // Move this chat to top
      const idx = updated.findIndex(c => c.remoteJid === selectedChat.remoteJid);
      if (idx > 0) { const [chat] = updated.splice(idx, 1); updated.unshift(chat); }
      return updated;
    });

    try {
      const number = getPhoneNumber(selectedChat.remoteJid);
      if (wasReplyingTo) {
        await whatsappService.invokeClient('send-text', {
          instanceName, number, text: sentText, delay: 1200,
          quoted: { key: wasReplyingTo.key, message: wasReplyingTo.message },
        });
      } else {
        await whatsappService.sendText(instanceName, number, sentText);
      }
      // Don't reload conversation — optimistic msg is already shown
      // Realtime subscription will handle webhook confirmation
    } catch (e: any) {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      toast({ title: 'Send failed', description: e.message, variant: 'destructive' });
    }
  };

  // Forward message to a contact selected from new-chat panel
  const handleForwardToContact = async (jid: string, _name: string) => {
    if (!instanceName || !forwardingMsg) return;
    const number = getPhoneNumber(jid);
    const text = getTextContent(forwardingMsg);
    try {
      if (text) {
        await whatsappService.sendText(instanceName, number, text);
      }
      toast({ title: 'Message forwarded' });
    } catch (e: any) {
      toast({ title: 'Forward failed', description: e.message, variant: 'destructive' });
    }
    setForwardingMsg(null);
    setSidePanel('none');
  };

  // ── Mark all as read ────────────────────────────────────────────────────
  const markAllAsRead = async () => {
    if (!instanceName) return;
    const unreadChats = chats.filter(c => c.unreadCount > 0 && c.lastMessage?.key);
    if (unreadChats.length === 0) { toast({ title: 'No unread messages' }); return; }

    let marked = 0;
    for (const chat of unreadChats) {
      try {
        await whatsappService.markChatRead(instanceName, {
          remoteJid: chat.remoteJid,
          fromMe: chat.lastMessage!.key.fromMe,
          id: chat.lastMessage!.key.id,
        });
        marked++;
      } catch (_e) { /* skip failures */ }
    }

    // Optimistically clear unread counts in local state
    setChats(prev => prev.map(c => ({ ...c, unreadCount: 0 })));
    toast({ title: `${marked} chat${marked !== 1 ? 's' : ''} marked as read` });
    // Refresh after a delay to get updated counts from API
    setTimeout(fetchChats, 2000);
  };

  // ── Filtered chats ─────────────────────────────────────────────────────
  const unreadCount = useMemo(() => chats.filter(c => {
    const s = chatSettings[c.remoteJid];
    if (s?.last_read_at && c.lastMessage?.messageTimestamp && s.last_read_at >= c.lastMessage.messageTimestamp) return false;
    return c.unreadCount > 0;
  }).length, [chats, chatSettings]);

  const filteredChats = useMemo(() => {
    let list = chats.map(c => {
      // Override unread count using our own read tracking (Evolution API count is unreliable)
      const s = chatSettings[c.remoteJid];
      if (s?.last_read_at && c.lastMessage?.messageTimestamp && s.last_read_at >= c.lastMessage.messageTimestamp) {
        return { ...c, unreadCount: 0 };
      }
      return c;
    }).filter(c => {
      const s = chatSettings[c.remoteJid];
      if (s?.is_archived || s?.is_blocked) return false;
      return true;
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => (c.pushName?.toLowerCase().includes(q)) || c.remoteJid.toLowerCase().includes(q));
    }

    if (filterTab === 'unread') list = list.filter(c => c.unreadCount > 0);
    if (filterTab === 'favorites') list = list.filter(c => chatSettings[c.remoteJid]?.is_favorited);
    if (filterTab === 'label' && activeLabelFilter) {
      list = list.filter(c => chatLabelsMap[c.remoteJid]?.includes(activeLabelFilter!));
    }

    // Sort: pinned first, then by last message time
    list.sort((a, b) => {
      const aPinned = chatSettings[a.remoteJid]?.is_pinned ? 1 : 0;
      const bPinned = chatSettings[b.remoteJid]?.is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      const aTs = a.lastMessage?.messageTimestamp || 0;
      const bTs = b.lastMessage?.messageTimestamp || 0;
      return bTs - aTs;
    });

    return list;
  }, [chats, chatSettings, searchQuery, filterTab, activeLabelFilter, chatLabelsMap]);

  const messageGroups = groupMessagesByDate(messages);

  // ── Context menu close ─────────────────────────────────────────────────
  useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      const timer = setTimeout(() => document.addEventListener('click', handler), 10);
      return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
    }
  }, [contextMenu]);

  // ── Filter dropdown close ──────────────────────────────────────────────
  useEffect(() => {
    if (showFilterDropdown) {
      const handler = () => setShowFilterDropdown(false);
      const timer = setTimeout(() => document.addEventListener('click', handler), 10);
      return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
    }
  }, [showFilterDropdown]);

  // ── Start new chat from contacts panel ─────────────────────────────────
  const startChatFromContact = (jid: string, name: string) => {
    // If forwarding a message, send it to the selected contact
    if (forwardingMsg) {
      handleForwardToContact(jid, name);
      return;
    }
    const existing = chats.find(c => c.remoteJid === jid);
    if (existing) {
      handleSelectChat(existing);
    } else {
      const fakeChat: EvolutionChat = {
        id: jid, remoteJid: jid, pushName: name, profilePicUrl: null,
        updatedAt: new Date().toISOString(), lastMessage: null, unreadCount: 0,
      };
      setSelectedChat(fakeChat);
      setMessages([]);
    }
    setSidePanel('none');
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-[#111b21] rounded-2xl">
      <style>{`
        [data-msg-id].wa-highlight {
          background-color: #0d2b22 !important;
          margin-left: -63px !important;
          margin-right: -63px !important;
          padding-left: 126px !important;
          padding-right: 126px !important;
        }
        [data-msg-id].wa-highlight-fade {
          background-color: transparent !important;
          transition: background-color 1.5s ease-out;
        }
      `}</style>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <div className="w-[420px] min-w-[340px] flex flex-col border-r border-[#222d34] bg-[#111b21] relative">
        {/* Side panels overlay */}
        {sidePanel === 'new-chat' && instanceName && (
          <NewChatPanel instanceName={instanceName} onSelectContact={startChatFromContact} onClose={() => setSidePanel('none')} />
        )}

        {sidePanel === 'starred' && (
          <StarredMessagesPanel
            starredMsgIds={starredMsgIds}
            businessId={businessId || ''}
            onUnstar={async (msgId) => { await toggleStar(msgId); }}
            onClose={() => setSidePanel('none')}
          />
        )}

        {sidePanel === 'lists' && businessId && (
          <ListsPanel
            labels={labels}
            chatLabelsMap={chatLabelsMap}
            chats={chats}
            selectedChatJid={selectedChat?.remoteJid}
            businessId={businessId}
            onUpdate={loadMetadata}
            onClose={() => setSidePanel('none')}
          />
        )}

        {/* Header */}
        <div className="h-[59px] bg-[#202c33] flex items-center justify-between px-4 flex-shrink-0">
          <Avatar name={instanceName || 'WA'} size={40}
            jid={'owner'} picUrl={instanceProfile.profilePicUrl} instanceName={instanceName || undefined} />
          <div className="flex items-center gap-1 text-[#aebac1]">
            <button onClick={() => setSidePanel('new-chat')} className="p-2 hover:bg-[#374045] rounded-full transition-colors" title="New chat">
              <MessageSquarePlus className="w-[20px] h-[20px]" />
            </button>
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowHeaderMenu(!showHeaderMenu); }} className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                <MoreVertical className="w-[20px] h-[20px]" />
              </button>
              {showHeaderMenu && (
                <DropdownMenu
                  onClose={() => setShowHeaderMenu(false)}
                  items={[
                    { icon: Star, label: 'Starred messages', onClick: () => setSidePanel('starred') },
                    { icon: Check, label: 'Mark all as read', onClick: () => markAllAsRead() },
                  ]}
                />
              )}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-[10px] py-[7px] bg-[#111b21] flex-shrink-0">
          <div className="flex items-center bg-[#202c33] rounded-lg h-[35px] px-3 gap-3">
            <Search className="w-[15px] h-[15px] text-[#8696a0]" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search or start new chat"
              className="bg-transparent text-[13px] text-[#d1d7db] placeholder-[#8696a0] outline-none flex-1" />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-[6px] px-[13px] py-[8px] flex-shrink-0 flex-wrap">
          <button onClick={() => { setFilterTab('all'); setActiveLabelFilter(null); }}
            className={`px-3 py-[5px] rounded-full text-[13px] transition-colors ${filterTab === 'all' ? 'bg-[#00a884] text-[#111b21] font-medium' : 'bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]'}`}>
            All
          </button>
          <button onClick={() => { setFilterTab('unread'); setActiveLabelFilter(null); }}
            className={`px-3 py-[5px] rounded-full text-[13px] transition-colors flex items-center gap-1.5 ${filterTab === 'unread' ? 'bg-[#00a884] text-[#111b21] font-medium' : 'bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]'}`}>
            Unread{unreadCount > 0 && <span>{unreadCount}</span>}
          </button>
          <button onClick={() => { setFilterTab('favorites'); setActiveLabelFilter(null); }}
            className={`px-3 py-[5px] rounded-full text-[13px] transition-colors ${filterTab === 'favorites' ? 'bg-[#00a884] text-[#111b21] font-medium' : 'bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]'}`}>
            Favorites
          </button>
          {/* Label filters */}
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowFilterDropdown(!showFilterDropdown); }}
              className="px-3 py-[5px] rounded-full text-[13px] bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942] flex items-center gap-1">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showFilterDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-[#233138] rounded-lg shadow-xl z-50 min-w-[180px] border border-[#2a3942] py-1">
                {labels.length > 0 && labels.map(l => (
                  <button key={l.id} onClick={() => { setFilterTab('label'); setActiveLabelFilter(l.id); setShowFilterDropdown(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-[13px] text-[#d1d7db] hover:bg-[#182229]">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                    <span className="ml-auto text-[#8696a0] text-[11px]">
                      {Object.values(chatLabelsMap).filter(arr => arr.includes(l.id)).length}
                    </span>
                  </button>
                ))}
                <button onClick={() => { setSidePanel('lists'); setShowFilterDropdown(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-[13px] text-[#d1d7db] hover:bg-[#182229] border-t border-[#2a3942] mt-1 pt-2">
                  <Plus className="w-3.5 h-3.5" /> New list
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-[#00a884] animate-spin" /></div>
          ) : filteredChats.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[#8696a0] text-sm">
              {filterTab === 'unread' ? 'No unread messages' : filterTab === 'favorites' ? 'No favorites yet' : instanceName ? 'No conversations' : 'No connected instance'}
            </div>
          ) : (
            filteredChats.map((chat) => (
              <ContactItem
                key={chat.id || chat.remoteJid}
                chat={chat}
                isActive={selectedChat?.remoteJid === chat.remoteJid}
                isPinned={chatSettings[chat.remoteJid]?.is_pinned || false}
                isMuted={chatSettings[chat.remoteJid]?.is_muted || false}
                onClick={() => handleSelectChat(chat)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chat }); }}
                instanceName={instanceName || undefined}
              />
            ))
          )}
        </div>

        {/* Context menu for chat items */}
        {contextMenu && (
          <div className="fixed bg-[#233138] rounded-md shadow-xl py-[6px] z-[60] min-w-[230px] border border-[#2a3942]"
            style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            {[
              { icon: Info, label: 'Contact info', onClick: () => { handleSelectChat(contextMenu.chat); setSidePanel('contact-info'); } },
              { icon: chatSettings[contextMenu.chat.remoteJid]?.is_muted ? Bell : BellOff,
                label: chatSettings[contextMenu.chat.remoteJid]?.is_muted ? 'Unmute' : 'Mute',
                onClick: () => updateChatSetting(contextMenu.chat.remoteJid, 'is_muted', !chatSettings[contextMenu.chat.remoteJid]?.is_muted) },
              { icon: chatSettings[contextMenu.chat.remoteJid]?.is_favorited ? StarOff : Heart,
                label: chatSettings[contextMenu.chat.remoteJid]?.is_favorited ? 'Remove from favorites' : 'Add to favorites',
                onClick: () => updateChatSetting(contextMenu.chat.remoteJid, 'is_favorited', !chatSettings[contextMenu.chat.remoteJid]?.is_favorited) },
              { icon: Tag, label: 'Add to list', onClick: () => { setSelectedChat(contextMenu.chat); setSidePanel('lists'); } },
              { icon: chatSettings[contextMenu.chat.remoteJid]?.is_pinned ? PinOff : Pin,
                label: chatSettings[contextMenu.chat.remoteJid]?.is_pinned ? 'Unpin' : 'Pin chat',
                onClick: () => updateChatSetting(contextMenu.chat.remoteJid, 'is_pinned', !chatSettings[contextMenu.chat.remoteJid]?.is_pinned) },
              { icon: Ban, label: 'Block', onClick: () => blockContact(contextMenu.chat.remoteJid), divider: true, danger: true },
              { icon: Trash2, label: 'Delete chat', onClick: () => deleteChatPermanent(contextMenu.chat.remoteJid), danger: true },
            ].map((item: any, i) => (
              <div key={i}>
                {item.divider && <div className="border-t border-[#2a3942] my-[4px]" />}
                <button onClick={() => { item.onClick(); setContextMenu(null); }}
                  className={`w-full flex items-center gap-3 px-6 py-[10px] text-[14.5px] hover:bg-[#182229] transition-colors ${item.danger ? 'text-[#e96c4c]' : 'text-[#d1d7db]'}`}>
                  <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right panel: Chat area ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedChat ? (
          <>
            {/* Chat header */}
            <div className="h-[59px] bg-[#202c33] flex items-center justify-between px-4 flex-shrink-0">
              <div className="flex items-center gap-[13px] cursor-pointer" onClick={() => setSidePanel('contact-info')}>
                <Avatar name={selectedChat.pushName || selectedChat.remoteJid} size={40}
                  jid={selectedChat.remoteJid} picUrl={selectedChat.profilePicUrl} instanceName={instanceName || undefined} />
                <div>
                  <div className="text-[16px] text-[#e9edef] leading-[21px]">{selectedChat.pushName || selectedChat.remoteJid}</div>
                  <div className="text-[13px] text-[#8696a0] leading-[20px]">{getDisplayPhone(selectedChat.remoteJid) || selectedChat.pushName}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[#aebac1]">
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors"><Video className="w-[20px] h-[20px]" /></button>
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors"><Phone className="w-[20px] h-[20px]" /></button>
                <button onClick={() => setShowMessageSearch(!showMessageSearch)} className={`p-2 rounded-full transition-colors ${showMessageSearch ? 'text-[#00a884]' : 'hover:bg-[#374045]'}`}><Search className="w-[20px] h-[20px]" /></button>
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowChatMenu(!showChatMenu); }} className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                    <MoreVertical className="w-[20px] h-[20px]" />
                  </button>
                  {showChatMenu && (
                    <DropdownMenu
                      onClose={() => setShowChatMenu(false)}
                      items={[
                        { icon: Info, label: 'Contact info', onClick: () => setSidePanel('contact-info') },
                        { icon: chatSettings[selectedChat.remoteJid]?.is_muted ? Bell : BellOff,
                          label: chatSettings[selectedChat.remoteJid]?.is_muted ? 'Unmute' : 'Mute notifications',
                          onClick: () => updateChatSetting(selectedChat.remoteJid, 'is_muted', !chatSettings[selectedChat.remoteJid]?.is_muted) },
                        { icon: Heart, label: chatSettings[selectedChat.remoteJid]?.is_favorited ? 'Remove from favorites' : 'Add to favorites',
                          onClick: () => updateChatSetting(selectedChat.remoteJid, 'is_favorited', !chatSettings[selectedChat.remoteJid]?.is_favorited) },
                        { icon: Tag, label: 'Add to list', onClick: () => setSidePanel('lists') },
                        { icon: Ban, label: 'Block', onClick: () => blockContact(selectedChat.remoteJid), divider: true, danger: true },
                        { icon: Trash2, label: 'Delete chat', onClick: () => deleteChatPermanent(selectedChat.remoteJid), danger: true },
                      ]}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Pinned message banner */}
            {pinnedMessage && (
              <div className="bg-[#1a2830] flex items-center gap-3 px-4 py-2 flex-shrink-0 border-b border-[#222d34] cursor-pointer hover:bg-[#202c33]">
                <Pin className="w-4 h-4 text-[#00a884] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[#d1d7db] truncate">{pinnedMessage.content || 'Pinned message'}</div>
                </div>
                <button onClick={() => {
                  if (businessId && selectedChat) {
                    db.from('whatsapp_pinned_messages').delete().eq('business_id', businessId).eq('remote_jid', selectedChat.remoteJid);
                    setPinnedMessage(null);
                  }
                }} className="p-1 hover:bg-[#374045] rounded-full text-[#8696a0]">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Messages area — column-reverse pins scroll to bottom natively */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto flex flex-col-reverse"
              onScroll={(e) => {
                const el = e.currentTarget;
                // In column-reverse, scrollTop=0 is the bottom. Scrolling UP increases scrollTop.
                // Trigger load-older when user scrolls near the visual top.
                const distanceFromTop = el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop);
                if (distanceFromTop < 100 && hasMoreMessages && !loadingOlder) {
                  loadOlderMessages();
                }
              }}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='300' height='300' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' patternUnits='userSpaceOnUse' width='60' height='60'%3E%3Cpath d='M30 5 L35 15 L30 10 L25 15Z' fill='%23182229' opacity='0.3'/%3E%3Ccircle cx='10' cy='40' r='3' fill='%23182229' opacity='0.2'/%3E%3Ccircle cx='50' cy='30' r='2' fill='%23182229' opacity='0.2'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='300' height='300' fill='%230b141a'/%3E%3Crect width='300' height='300' fill='url(%23p)'/%3E%3C/svg%3E")`,
                backgroundColor: '#0b141a',
              }}>
              {/* Single inner wrapper — column-reverse on parent pins this to the bottom */}
              <div className="py-[6px]">
                {/* Older messages loader */}
                {loadingOlder && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 text-[#00a884] animate-spin" />
                  </div>
                )}
                {!hasMoreMessages && messages.length > 50 && (
                  <div className="flex justify-center py-3">
                    <span className="bg-[#182229] text-[#667781] text-[11px] px-3 py-1 rounded-full">Beginning of conversation</span>
                  </div>
                )}
                <div ref={messagesTopRef} />
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full min-h-[200px]"><Loader2 className="w-8 h-8 text-[#00a884] animate-spin" /></div>
                ) : (
                  messageGroups.map((group, gi) => (
                    <div key={gi}>
                      <div className="flex justify-center my-[12px]">
                        <span className="bg-[#182229] text-[#8696a0] text-[12.5px] px-[12px] py-[5px] rounded-[7.5px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">{group.label}</span>
                      </div>
                      {group.messages.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} isStarred={starredMsgIds.has(msg.key.id)}
                          instanceName={instanceName!} chatProfilePic={selectedChat?.profilePicUrl} ownerPic={instanceProfile.profilePicUrl}
                          chatName={selectedChat?.pushName || ''}
                          reactions={reactionsMap[msg.key.id]}
                          onStar={toggleStar} onReply={handleReply} onReact={handleReact}
                          onDelete={handleDeleteMessage} onForward={handleForward}
                          isPinned={pinnedMessage?.message_id === msg.key.id}
                          onTogglePin={handleTogglePin} />
                      ))}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Emoji picker */}
            {showEmoji && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowEmoji(false)} />
                <div className="absolute bottom-[62px] left-[420px] z-50">
                  <Picker data={data} onEmojiSelect={(emoji: any) => setReplyText(prev => prev + emoji.native)} theme="dark"
                    previewPosition="none" skinTonePosition="none" />
                </div>
              </>
            )}

            {/* Voice recorder replaces input area when recording */}
            {isRecording ? (
              <VoiceRecorderBar onSend={handleSendVoiceNote} onCancel={() => setIsRecording(false)} />
            ) : (
              <>
                {/* Reply preview bar */}
                {replyingTo && (
                  <div className="bg-[#1a2830] flex items-center gap-3 px-4 py-2 border-l-4 border-[#00a884] flex-shrink-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-[#00a884] font-medium">{replyingTo.key.fromMe ? 'You' : replyingTo.pushName}</div>
                      <div className="text-[13px] text-[#8696a0] truncate">{getTextContent(replyingTo) || `[${replyingTo.messageType}]`}</div>
                    </div>
                    <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-[#374045] rounded-full text-[#8696a0]">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Input area */}
                <div className="h-[62px] bg-[#202c33] flex items-center gap-[5px] px-[10px] flex-shrink-0">
                  <button onClick={() => { setShowEmoji(!showEmoji); setShowAttachment(false); }}
                    className={`p-2 rounded-full transition-colors ${showEmoji ? 'text-[#00a884]' : 'text-[#8696a0] hover:bg-[#374045]'}`}>
                    <Smile className="w-[24px] h-[24px]" />
                  </button>
                  <div className="relative">
                    <button onClick={(e) => { e.stopPropagation(); setShowAttachment(!showAttachment); setShowEmoji(false); }}
                      className={`p-2 rounded-full transition-colors ${showAttachment ? 'text-[#00a884] rotate-45' : 'text-[#8696a0] hover:bg-[#374045]'}`}>
                      <Plus className="w-[24px] h-[24px]" />
                    </button>
                    {showAttachment && <AttachmentMenu onSelect={openFileInput} onClose={() => setShowAttachment(false)} />}
                  </div>
                  <div className="flex-1 mx-[5px]">
                    <input ref={inputRef} value={replyText} onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendWithReply(); } }}
                      onFocus={() => { setShowEmoji(false); setShowAttachment(false); }}
                      placeholder="Type a message"
                      className="w-full bg-[#2a3942] text-[15px] text-[#d1d7db] placeholder-[#8696a0] rounded-lg h-[42px] px-[12px] outline-none border-none" />
                  </div>
                  {replyText.trim() ? (
                    <button onClick={handleSendWithReply} disabled={sending}
                      className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0] disabled:opacity-50">
                      {sending ? <Loader2 className="w-[24px] h-[24px] animate-spin" /> : <Send className="w-[24px] h-[24px]" />}
                    </button>
                  ) : (
                    <button onClick={() => setIsRecording(true)} className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0]">
                      <Mic className="w-[24px] h-[24px]" />
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#222e35] border-b-[6px] border-b-[#00a884]">
            <div className="w-[320px] text-center">
              <div className="mx-auto mb-[38px]">
                <svg viewBox="0 0 303 172" width="320" className="text-[#364147]" preserveAspectRatio="xMidYMid meet">
                  <path fill="currentColor" d="M229.565 160.229c32.647-10.984 57.366-41.988 53.825-86.81C279.376 22.166 241.886-5.1 189.42.89c-28.093 3.208-54.519 17.733-69.493 28.18-11.618 8.108-22.067 17.917-30.86 29.209a141.592 141.592 0 00-7.672 11.344c-21.39-6.062-39.2-8.098-50.478-4.479-18.2 5.839-28.15 17.397-25.132 41.28 3.254 25.738 29.412 44.106 54.89 49.543 17.993 3.843 34.587 2.456 46.609-2.312 3.112 1.341 6.34 2.595 9.634 3.809l-.035-.071c7.973 2.921 16.283 5.394 24.353 7.755 26.155 7.651 52.518 15.381 47.834 20.253-.928 1.135 2.942-5.429 3.141-5.834 2.955-6.028 7.622-8.248 8.073-5.854.517 2.73-8.659 6.652-7.676 10.741.983 4.088 14.555-2.882 32.481-12.56a138.321 138.321 0 0014.975-8.578c-18.265 11.467-37.807 15.236-61.324 3.713z" />
                </svg>
              </div>
              <h1 className="text-[32px] font-light text-[#e9edef] mb-[14px] leading-[40px]">WhatsApp Web</h1>
              <p className="text-[14px] text-[#8696a0] leading-[20px]">
                Send and receive messages without keeping your phone online.<br />
                Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Message Search Panel (right side) ─────────────────────────── */}
      {showMessageSearch && selectedChat && (
        <MessageSearchPanel
          remoteJid={selectedChat.remoteJid}
          lidToPhoneMap={lidToPhoneMap}
          instanceName={instanceName!}
          chatName={selectedChat.pushName || ''}
          onClose={() => setShowMessageSearch(false)}
          onScrollTo={(msgId) => {
            const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement;
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.remove('wa-highlight-fade');
              el.classList.add('wa-highlight');
              setTimeout(() => el.classList.add('wa-highlight-fade'), 100);
              setTimeout(() => el.classList.remove('wa-highlight', 'wa-highlight-fade'), 2500);
            }
          }}
        />
      )}

      {/* ── Contact Info Panel (right side) ──────────────────────────── */}
      {sidePanel === 'contact-info' && selectedChat && (
        <div className="w-[340px] min-w-[340px] flex flex-col border-l border-[#222d34] bg-[#111b21]">
          <div className="h-[59px] bg-[#202c33] flex items-center gap-4 px-4 flex-shrink-0">
            <button onClick={() => setSidePanel('none')} className="p-2 hover:bg-[#374045] rounded-full text-[#aebac1]">
              <X className="w-5 h-5" />
            </button>
            <span className="text-[16px] text-[#e9edef]">Contact info</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Profile section */}
            <div className="flex flex-col items-center py-8 bg-[#111b21]">
              <Avatar name={selectedChat.pushName || selectedChat.remoteJid} size={200}
                jid={selectedChat.remoteJid} picUrl={selectedChat.profilePicUrl} instanceName={instanceName || undefined} />
              <h3 className="text-[22px] text-[#e9edef] mt-4">{selectedChat.pushName || selectedChat.remoteJid}</h3>
              <p className="text-[14px] text-[#8696a0] mt-1">{getDisplayPhone(selectedChat.remoteJid) || selectedChat.pushName}</p>
            </div>

            <div className="h-2 bg-[#0b141a]" />

            {/* Labels section */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[14px] text-[#8696a0]">Labels</span>
                <button onClick={() => setSidePanel('lists')} className="text-[13px] text-[#00a884]">Edit</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(chatLabelsMap[selectedChat.remoteJid] || []).map(labelId => {
                  const label = labels.find(l => l.id === labelId);
                  if (!label) return null;
                  return (
                    <span key={label.id} className="px-3 py-1 rounded-full text-[12px] text-white" style={{ backgroundColor: label.color }}>
                      {label.name}
                    </span>
                  );
                })}
                {(chatLabelsMap[selectedChat.remoteJid] || []).length === 0 && (
                  <span className="text-[13px] text-[#667781]">No labels</span>
                )}
              </div>
            </div>

            <div className="h-2 bg-[#0b141a]" />

            {/* Settings section */}
            <div className="py-2">
              {[
                { icon: chatSettings[selectedChat.remoteJid]?.is_muted ? Bell : BellOff,
                  label: chatSettings[selectedChat.remoteJid]?.is_muted ? 'Unmute notifications' : 'Mute notifications',
                  onClick: () => updateChatSetting(selectedChat.remoteJid, 'is_muted', !chatSettings[selectedChat.remoteJid]?.is_muted) },
                { icon: Star, label: 'Starred messages', onClick: () => {} },
                { icon: chatSettings[selectedChat.remoteJid]?.is_favorited ? StarOff : Heart,
                  label: chatSettings[selectedChat.remoteJid]?.is_favorited ? 'Remove from favorites' : 'Add to favorites',
                  onClick: () => updateChatSetting(selectedChat.remoteJid, 'is_favorited', !chatSettings[selectedChat.remoteJid]?.is_favorited) },
              ].map((item, i) => (
                <button key={i} onClick={item.onClick}
                  className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-[#d1d7db] hover:bg-[#202c33] transition-colors">
                  <item.icon className="w-5 h-5 text-[#8696a0]" />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="h-2 bg-[#0b141a]" />

            {/* Danger zone */}
            <div className="py-2">
              <button onClick={() => blockContact(selectedChat.remoteJid)}
                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-[#e96c4c] hover:bg-[#202c33] transition-colors">
                <Ban className="w-5 h-5" />
                Block {selectedChat.pushName || selectedChat.remoteJid.split('@')[0]}
              </button>
              <button onClick={() => deleteChatPermanent(selectedChat.remoteJid)}
                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-[#e96c4c] hover:bg-[#202c33] transition-colors">
                <Trash2 className="w-5 h-5" />
                Delete chat
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

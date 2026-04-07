import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ArrowRight, CheckCircle2, AlertCircle, Smartphone, Briefcase, User, ArrowLeft } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

// whatsapp_* tables aren't in database.types.ts yet — cast to untyped client.
// All column shapes verified via MCP against public.whatsapp_{conversations,messages,contacts,instances}.
const db = supabase as unknown as SupabaseClient;

// Evolution API response shapes (external service, not DB)
type EvolutionProfile = {
  picture?: string | null;
  profilePictureUrl?: string | null;
  name?: string | null;
  pushName?: string | null;
  verifiedName?: string | null;
  wuid?: string | null;
  isBusiness?: boolean;
  businessProfile?: unknown;
};
type EvolutionSendTextResult = { key?: { id?: string } } | null | undefined;

// ── Phone normalization ─────────────────────────────────────────────────────
// Default Morocco (212) since the platform serves MA. Handles already-international.
function normalizePhoneDigits(raw: string, defaultCountry = '212'): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 11) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits;
  }
  if (digits.startsWith('0')) digits = digits.slice(1);
  return `${defaultCountry}${digits}`;
}

interface Instance {
  id: string;
  instance_name: string;
  phone_number: string | null;
  profile_pic: string | null;
  status: string;
}

interface ResolvedContact {
  jid: string;             // canonical JID returned by Evolution
  number: string;          // bare digits
  name: string | null;     // pushName / verifiedName
  isBusiness: boolean;
  profilePicUrl: string | null;
  profilePicBase64: string | null;
}

type Step =
  | 'lookup'        // checking number + fetching profile
  | 'not-found'     // not on WhatsApp
  | 'preview'       // contact preview, "Continue"
  | 'pick'          // instance picker
  | 'compose'       // message composer
  | 'sending'
  | 'success'
  | 'error'
  | 'no-instances'; // no connected device

interface Props {
  phone: string;
  open: boolean;
  onClose: () => void;
}

export function WhatsAppQuickSend({ phone, open, onClose }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('lookup');
  const [instances, setInstances] = useState<Instance[]>([]);
  const [contact, setContact] = useState<ResolvedContact | null>(null);
  const [selected, setSelected] = useState<Instance | null>(null);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const targetDigits = normalizePhoneDigits(phone);

  // ── Reset state when modal opens ────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep('lookup');
    setSelected(null);
    setContact(null);
    setMessage('');
    setErrorMsg('');
  }, [open]);

  // ── Boot: load instances → check number → fetch profile ─────────────
  useEffect(() => {
    if (!open) return;
    if (!targetDigits) {
      setStep('error');
      setErrorMsg('Invalid phone number.');
      return;
    }

    let cancelled = false;
    (async () => {
      const businessId = localStorage.getItem('activeBusinessId');
      if (!businessId) {
        if (!cancelled) { setStep('error'); setErrorMsg('No active business.'); }
        return;
      }

      // 1. Load all connected instances
      const { data: instData } = await db
        .from('whatsapp_instances')
        .select('id, instance_name, phone_number, profile_pic, status')
        .eq('business_id', businessId)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (cancelled) return;
      const list: Instance[] = instData || [];
      setInstances(list);

      if (list.length === 0) {
        setStep('no-instances');
        return;
      }

      // 2. Use the FIRST instance as a lookup proxy to check WhatsApp registration
      const lookupInstance = list[0];
      try {
        const checkRes = await whatsappService.invokeClient('check-whatsapp-numbers', {
          instanceName: lookupInstance.instance_name,
          numbers: [targetDigits],
        });

        if (cancelled) return;
        const result = Array.isArray(checkRes) ? checkRes[0] : null;
        if (!result || !result.exists) {
          setStep('not-found');
          return;
        }

        // 3. Fetch full profile (name, business flag, picture URL)
        let profile: EvolutionProfile | null = null;
        try {
          profile = (await whatsappService.invokeClient('fetch-profile', {
            instanceName: lookupInstance.instance_name,
            number: result.jid || targetDigits,
          })) as EvolutionProfile | null;
        } catch {
          profile = null;
        }

        if (cancelled) return;

        // 4. Proxy the profile picture into base64 (avoids CORS in <img>)
        const picUrl = profile?.picture || profile?.profilePictureUrl || null;
        let picBase64: string | null = null;
        if (picUrl) {
          try {
            const proxied = await whatsappService.invokeClient('proxy-image', {
              instanceName: lookupInstance.instance_name,
              url: picUrl,
            });
            picBase64 = proxied?.base64 || null;
          } catch {
            picBase64 = null;
          }
        }

        if (cancelled) return;

        const resolvedJid: string = result.jid || `${targetDigits}@s.whatsapp.net`;
        const resolved: ResolvedContact = {
          jid: resolvedJid,
          number: resolvedJid.split('@')[0],
          name: profile?.name || profile?.pushName || profile?.verifiedName || profile?.wuid || null,
          isBusiness: !!(profile?.isBusiness || profile?.businessProfile),
          profilePicUrl: picUrl,
          profilePicBase64: picBase64,
        };
        setContact(resolved);
        setStep('preview');
      } catch (e) {
        if (cancelled) return;
        setStep('error');
        setErrorMsg(e?.message || 'Could not check this number.');
      }
    })();

    return () => { cancelled = true; };
  }, [open, targetDigits]);

  // ── Send the message ────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selected || !contact || !message.trim()) return;
    setStep('sending');
    setErrorMsg('');
    try {
      const businessId = localStorage.getItem('activeBusinessId');
      if (!businessId) throw new Error('No active business.');

      // 1. Send via Evolution API
      const apiResult = (await whatsappService.sendText(
        selected.instance_name,
        contact.number,
        message.trim()
      )) as EvolutionSendTextResult;
      const realMsgId = apiResult?.key?.id || `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      // 2. Upsert conversation row so it appears in the inbox of THIS instance
      // Unique constraint: (business_id, instance_id, jid)
      let convId: string | null = null;
      const { data: existingConv } = await db
        .from('whatsapp_conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('instance_id', selected.id)
        .eq('jid', contact.jid)
        .maybeSingle();

      if (existingConv) {
        convId = existingConv.id;
        await db.from('whatsapp_conversations').update({
          display_name: contact.name || null,
          profile_pic: contact.profilePicUrl || null,
          last_message_id: realMsgId,
          last_message_content: message.trim(),
          last_message_type: 'conversation',
          last_message_direction: 'outgoing',
          last_message_ts: now,
          last_message_status: 'sent',
          updated_at: now,
        }).eq('id', convId);
      } else {
        const { data: newConv, error: convErr } = await db
          .from('whatsapp_conversations')
          .insert({
            business_id: businessId,
            instance_id: selected.id,
            jid: contact.jid,
            phone_jid: contact.jid.includes('@s.whatsapp.net') ? contact.jid : null,
            lid_jid: contact.jid.includes('@lid') ? contact.jid : null,
            type: 'individual',
            display_name: contact.name || null,
            profile_pic: contact.profilePicUrl || null,
            last_message_id: realMsgId,
            last_message_content: message.trim(),
            last_message_type: 'conversation',
            last_message_direction: 'outgoing',
            last_message_ts: now,
            last_message_status: 'sent',
            unread_count: 0,
            updated_at: now,
          })
          .select('id')
          .single();
        if (convErr) throw new Error(convErr.message);
        convId = newConv?.id || null;
      }

      // 3. Insert the outgoing message row (linked to conversation)
      await db.from('whatsapp_messages').upsert({
        business_id: businessId,
        instance_id: selected.id,
        conversation_id: convId,
        remote_jid: contact.jid,
        message_id: realMsgId,
        type: 'conversation',
        content: message.trim(),
        direction: 'outgoing',
        status: 'sent',
        created_at: now,
      }, { onConflict: 'message_id' });

      // 4. Best-effort contact upsert for inbox autocomplete
      try {
        await db.from('whatsapp_contacts').upsert({
          business_id: businessId,
          instance_id: selected.id,
          phone_number: contact.jid,
          name: contact.name || null,
          profile_pic: contact.profilePicUrl || null,
          updated_at: now,
        }, { onConflict: 'business_id,phone_number' });
      } catch { /* contacts upsert is best-effort */ }

      setStep('success');
    } catch (e) {
      setErrorMsg(e?.message || 'Failed to send message.');
      setStep('error');
    }
  }, [selected, contact, message]);

  const handleOpenInbox = () => {
    if (!selected || !contact) return;
    onClose();
    navigate(`/business/whatsapp/inbox?instance=${encodeURIComponent(selected.instance_name)}&jid=${encodeURIComponent(contact.jid)}`);
  };

  const proceedFromPreview = () => {
    if (instances.length === 1) {
      setSelected(instances[0]);
      setStep('compose');
    } else {
      setStep('pick');
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-3xl bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/80 hover:bg-gray-100 border border-gray-100 flex items-center justify-center transition-colors"
          type="button"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40 p-7 pb-5 text-center border-b border-gray-100">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#25D366]/10 mb-3">
            <FaWhatsapp className="w-6 h-6 text-[#25D366]" />
          </div>
          <h3 className="text-xl font-extralight text-gray-900 tracking-tight">
            {step === 'lookup' && 'Checking number...'}
            {step === 'not-found' && 'Not on WhatsApp'}
            {step === 'preview' && 'Contact found'}
            {step === 'pick' && 'Send from'}
            {step === 'compose' && 'New message'}
            {step === 'sending' && 'Sending...'}
            {step === 'success' && 'Message sent'}
            {step === 'error' && 'Something went wrong'}
            {step === 'no-instances' && 'No connected devices'}
          </h3>
          <p className="text-xs text-gray-500 font-light mt-1.5">
            +{targetDigits || phone}
          </p>
        </div>

        {/* ── Step: Lookup ─────────────────────────────────────────── */}
        {step === 'lookup' && (
          <div className="py-14 flex flex-col items-center justify-center">
            <div className="relative">
              <Loader2 className="w-9 h-9 animate-spin text-[#25D366]" />
            </div>
            <p className="text-xs text-gray-400 font-light mt-4">Looking up on WhatsApp...</p>
          </div>
        )}

        {/* ── Step: Not on WhatsApp ────────────────────────────────── */}
        {step === 'not-found' && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <p className="text-sm font-medium text-gray-900">This number isn't on WhatsApp</p>
            <p className="text-xs text-gray-500 font-light mt-1.5 max-w-[280px]">
              We couldn't find an active WhatsApp account for this phone. Double-check the number or try a different contact channel.
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full h-11 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium"
              type="button"
            >
              Close
            </button>
          </div>
        )}

        {/* ── Step: Preview resolved contact ───────────────────────── */}
        {step === 'preview' && contact && (
          <div className="p-6 space-y-5">
            <div className="flex flex-col items-center text-center pt-2">
              <div className="relative">
                {contact.profilePicBase64 ? (
                  <img
                    src={contact.profilePicBase64}
                    alt=""
                    className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-lg"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 border-4 border-white shadow-lg flex items-center justify-center">
                    <User className="w-9 h-9 text-emerald-500" strokeWidth={1.5} />
                  </div>
                )}
                {contact.isBusiness && (
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#25D366] border-2 border-white flex items-center justify-center shadow-md">
                    <Briefcase className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
              <h4 className="text-base font-medium text-gray-900 mt-3">
                {contact.name || `+${contact.number}`}
              </h4>
              <p className="text-xs text-gray-500 font-light mt-0.5">+{contact.number}</p>
              <span className={cn(
                "mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                contact.isBusiness ? "bg-[#25D366]/10 text-[#0d8a3f]" : "bg-emerald-50 text-emerald-700"
              )}>
                <FaWhatsapp className="w-3 h-3" />
                {contact.isBusiness ? 'WhatsApp Business' : 'WhatsApp'}
              </span>
            </div>
            <button
              onClick={proceedFromPreview}
              className="w-full h-12 rounded-2xl bg-[#25D366] hover:bg-[#1ebe57] text-white text-sm font-medium flex items-center justify-center gap-2"
              type="button"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step: Pick instance ──────────────────────────────────── */}
        {step === 'pick' && (
          <div className="p-6 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-1">Choose a device</p>
            {instances.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => { setSelected(inst); setStep('compose'); }}
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-left"
              >
                {inst.profile_pic ? (
                  <img src={inst.profile_pic} alt="" className="w-11 h-11 rounded-full object-cover border border-gray-100" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-emerald-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{inst.instance_name}</p>
                  {inst.phone_number && (
                    <p className="text-[11px] text-gray-500 font-light mt-0.5">+{inst.phone_number}</p>
                  )}
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300" />
              </button>
            ))}
            <button
              onClick={() => setStep('preview')}
              className="w-full mt-1 text-[11px] text-gray-400 hover:text-gray-600 font-medium"
              type="button"
            >
              <ArrowLeft className="w-3 h-3 inline mr-1" /> Back
            </button>
          </div>
        )}

        {/* ── Step: Compose ────────────────────────────────────────── */}
        {step === 'compose' && selected && contact && (
          <div className="p-6 space-y-4">
            {/* Recipient + sender summary */}
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50">
              {contact.profilePicBase64 ? (
                <img src={contact.profilePicBase64} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-100" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-emerald-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">
                  {contact.name || `+${contact.number}`}
                </p>
                <p className="text-[10px] text-gray-500 font-light">via {selected.instance_name}</p>
              </div>
              {instances.length > 1 && (
                <button
                  onClick={() => setStep('pick')}
                  className="text-[10px] font-medium text-gray-400 hover:text-gray-700 uppercase tracking-wider"
                  type="button"
                >
                  Change
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Message</label>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) handleSend();
                }}
                placeholder="Type your message..."
                rows={5}
                className="w-full rounded-2xl bg-gray-50/50 border border-gray-100 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
              <p className="text-[10px] text-gray-400 text-right">⌘+Enter to send</p>
            </div>

            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className={cn(
                "w-full h-12 rounded-2xl font-medium text-sm flex items-center justify-center gap-2 transition-colors",
                message.trim()
                  ? "bg-[#25D366] hover:bg-[#1ebe57] text-white shadow-sm"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              <FaWhatsapp className="w-4 h-4" />
              Send Message
            </button>
          </div>
        )}

        {/* ── Step: Sending ────────────────────────────────────────── */}
        {step === 'sending' && (
          <div className="p-12 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#25D366]" />
            <p className="text-sm text-gray-600 font-light mt-4">Sending message...</p>
          </div>
        )}

        {/* ── Step: Success ────────────────────────────────────────── */}
        {step === 'success' && contact && (
          <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h4 className="text-lg font-medium text-gray-900">Message sent</h4>
            <p className="text-xs text-gray-500 font-light mt-1">
              Delivered to {contact.name || `+${contact.number}`}
            </p>
            <div className="flex gap-2 w-full mt-6">
              <button
                onClick={onClose}
                className="flex-1 h-11 rounded-2xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium"
                type="button"
              >
                Close
              </button>
              <button
                onClick={handleOpenInbox}
                className="flex-1 h-11 rounded-2xl bg-[#25D366] hover:bg-[#1ebe57] text-white text-xs font-medium flex items-center justify-center gap-2"
                type="button"
              >
                Open Inbox
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Error ──────────────────────────────────────────── */}
        {step === 'error' && (
          <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h4 className="text-lg font-medium text-gray-900">Send failed</h4>
            <p className="text-xs text-gray-500 font-light mt-1 max-w-[300px]">{errorMsg || 'An unknown error occurred.'}</p>
            <div className="flex gap-2 w-full mt-6">
              <button
                onClick={onClose}
                className="flex-1 h-11 rounded-2xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(contact ? 'compose' : 'lookup')}
                className="flex-1 h-11 rounded-2xl bg-primary hover:bg-primary/90 text-white text-xs font-medium"
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ── Step: No connected devices ───────────────────────────── */}
        {step === 'no-instances' && (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <Smartphone className="w-8 h-8 text-amber-500" />
            </div>
            <p className="text-sm font-medium text-gray-900">No connected devices</p>
            <p className="text-xs text-gray-500 font-light mt-1 max-w-[280px]">
              Connect a WhatsApp device first to send messages from your business.
            </p>
            <button
              onClick={() => { onClose(); navigate('/business/whatsapp/manager'); }}
              className="mt-6 w-full h-11 rounded-2xl bg-primary hover:bg-primary/90 text-white text-xs font-medium"
              type="button"
            >
              Open device manager
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

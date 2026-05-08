/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDropzone } from 'react-dropzone';
import {
    AlertTriangle,
    Upload,
    CheckCircle2,
    XCircle,
    Loader2,
    Banknote,
    Clock,
    PhoneCall,
    CreditCard,
    Copy,
    FileText,
    Lock,
    Sparkles,
    Info,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface SuspensionOverlayProps {
    role: 'admin' | 'commercial';
    businessId: string;
}

const SuspensionOverlay: React.FC<SuspensionOverlayProps> = ({ role, businessId }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        const prevHtml = document.documentElement.style.overflow;
        const prevBody = document.body.style.overflow;
        const prevOverscroll = document.body.style.overscrollBehavior;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';
        return () => {
            document.documentElement.style.overflow = prevHtml;
            document.body.style.overflow = prevBody;
            document.body.style.overscrollBehavior = prevOverscroll;
        };
    }, []);

    const { data: businessInfo } = useQuery({
        queryKey: ['suspension-business-info', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('businesses')
                .select('id, name, license_type, plan_id, plan:plans(id, name, license_type, price, currency)')
                .eq('id', businessId)
                .single();
            return data;
        },
        enabled: role === 'admin',
    });

    useEffect(() => {
        if (businessInfo?.plan?.price != null && !amount) {
            setAmount(String(businessInfo.plan.price));
        }
    }, [businessInfo, amount]);

    const { data: bankInfo } = useQuery({
        queryKey: ['platform-settings-bank'],
        queryFn: async () => {
            const { data } = await supabase
                .from('platform_settings')
                .select('key, value')
                .in('key', ['bank_name', 'bank_account_holder', 'bank_rib', 'bank_iban']);
            const map: Record<string, string> = {};
            data?.forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
            return map;
        },
        enabled: role === 'admin',
    });

    const { data: latestSubmission } = useQuery({
        queryKey: ['payment-submission', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('business_payments')
                .select('id, status, denial_message, created_at')
                .eq('business_id', businessId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            return data;
        },
        enabled: role === 'admin',
    });

    const onDrop = useCallback((accepted: File[]) => {
        const f = accepted[0];
        if (!f) return;
        setFile(f);
        if (f.type.startsWith('image/')) {
            setPreview(URL.createObjectURL(f));
        } else {
            setPreview(null);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/*': [], 'application/pdf': [] },
        maxFiles: 1,
        maxSize: 10 * 1024 * 1024,
    });

    const handleCopy = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            setTimeout(() => setCopied(null), 1400);
        } catch {
            /* ignore */
        }
    };

    const handleSubmit = async () => {
        if (!file || !amount) return;
        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const licenseType = businessInfo?.plan?.license_type || businessInfo?.license_type || 'monthly';
            const currency = businessInfo?.plan?.currency || 'MAD';

            const ext = file.name.split('.').pop();
            const path = `${businessId}/${Date.now()}.${ext}`;
            const { error: uploadErr } = await supabase.storage
                .from('payment-proofs')
                .upload(path, file);
            if (uploadErr) throw uploadErr;

            const now = new Date().toISOString();
            const { error: insertErr } = await (supabase as any)
                .from('business_payments')
                .insert({
                    business_id: businessId,
                    amount: parseFloat(amount),
                    currency,
                    license_type: licenseType,
                    payment_method: 'bank_transfer',
                    period_start: now,
                    proof_url: path,
                    submitted_by: user.id,
                    notes: notes.trim() || null,
                });
            if (insertErr) throw insertErr;

            queryClient.invalidateQueries({ queryKey: ['payment-submission', businessId] });
            setFile(null);
            setPreview(null);
            setNotes('');
            toast({ title: 'Payment submitted', description: 'Your proof is under review.' });
        } catch (err) {
            toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const isPending = latestSubmission?.status === 'pending';
    const isDenied = latestSubmission?.status === 'denied';
    const planName = businessInfo?.plan?.name || businessInfo?.license_type;
    const planPrice = businessInfo?.plan?.price;
    const planCurrency = businessInfo?.plan?.currency || 'MAD';

    // ───────────────────────────────────────────────────────────────
    // Commercial / courier / non-admin role
    // ───────────────────────────────────────────────────────────────
    if (role === 'commercial') {
        return (
            <div className="fixed inset-0 z-[9999] bg-ant-ink overflow-hidden flex items-center justify-center px-4"
                 style={{ touchAction: 'none' }}
                 onWheel={(e) => e.preventDefault()}
                 onTouchMove={(e) => e.preventDefault()}>
                {/* Ambient glow backdrop */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-1/3 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-ant-orange/8 blur-[120px]" />
                    <div className="absolute -bottom-1/4 right-0 w-[600px] h-[600px] rounded-full bg-ant-rose/6 blur-[100px]" />
                </div>

                {/* Grid texture */}
                <div
                    className="absolute inset-0 opacity-[0.025] pointer-events-none"
                    style={{
                        backgroundImage:
                            'linear-gradient(to right, #faf9f5 1px, transparent 1px), linear-gradient(to bottom, #faf9f5 1px, transparent 1px)',
                        backgroundSize: '64px 64px',
                    }}
                />

                <div className="relative w-full max-w-md">
                    {/* Editorial kicker ABOVE card */}
                    <div className="flex items-center justify-center gap-2 mb-5 opacity-80">
                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange animate-pulse" />
                        <span className="font-display text-[10px] uppercase tracking-[0.32em] text-ant-light/55">
                            Service · Paused
                        </span>
                    </div>

                    <div className="relative rounded-3xl border border-white/[0.08] bg-ant-ink/80 backdrop-blur-xl overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.6)]">
                        <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-rose to-ant-orange" />

                        <div className="p-8 text-center space-y-5">
                            {/* Icon tile with orbiting halo */}
                            <div className="relative w-20 h-20 mx-auto">
                                <span className="absolute inset-0 rounded-[28px] bg-ant-orange/15 blur-2xl" />
                                <div className="relative w-20 h-20 rounded-[28px] bg-white/[0.04] border border-white/[0.1] flex items-center justify-center">
                                    <PhoneCall className="w-8 h-8 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h1 className="font-display text-[28px] leading-[1.1] tracking-[-0.02em] text-ant-light">
                                    Service unavailable
                                </h1>
                                <p className="font-serif italic text-[13px] text-ant-light/60 leading-relaxed">
                                    Access is currently paused on this workspace.
                                </p>
                            </div>

                            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-4 py-3.5 text-left">
                                <div className="flex items-start gap-2.5">
                                    <Info className="w-3.5 h-3.5 text-ant-orange/80 shrink-0 mt-0.5" />
                                    <p className="text-[12px] text-ant-light/75 leading-relaxed">
                                        Please contact your administration to restore access. You will be able to resume work as soon as the account is reactivated.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-center gap-1.5 pt-2">
                                <Lock className="w-3 h-3 text-ant-light/30" />
                                <span className="font-display text-[9px] uppercase tracking-[0.24em] text-ant-light/30">
                                    Secure · encrypted · paused
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ───────────────────────────────────────────────────────────────
    // Admin (super admin) — payment renewal flow
    // ───────────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 z-[9999] bg-ant-ink overflow-hidden">
            {/* Ambient glow backdrop */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-1/3 -left-1/4 w-[900px] h-[900px] rounded-full bg-ant-orange/10 blur-[140px]" />
                <div className="absolute -bottom-1/4 -right-1/4 w-[700px] h-[700px] rounded-full bg-ant-rose/8 blur-[120px]" />
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-ant-green/5 blur-[120px]" />
            </div>

            {/* Grid texture */}
            <div
                className="absolute inset-0 opacity-[0.022] pointer-events-none"
                style={{
                    backgroundImage:
                        'linear-gradient(to right, #faf9f5 1px, transparent 1px), linear-gradient(to bottom, #faf9f5 1px, transparent 1px)',
                    backgroundSize: '64px 64px',
                }}
            />

            {/* Scrollable content layer — bounded inside the opaque backdrop */}
            <div
                className="absolute inset-0 overflow-y-auto overscroll-contain ant-scroll"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                <div className="relative min-h-full flex items-center justify-center px-4 py-10">
                <div className="w-full max-w-[560px] space-y-5">
                    {/* Editorial kicker */}
                    <div className="flex items-center justify-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange animate-pulse" />
                        <span className="font-display text-[10px] uppercase tracking-[0.32em] text-ant-light/55">
                            License · Renewal required
                        </span>
                    </div>

                    {/* Hero card */}
                    <div className="relative rounded-3xl border border-white/[0.08] bg-ant-ink/80 backdrop-blur-xl overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.6)]">
                        <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-rose to-ant-orange" />

                        <div className="p-6 md:p-8 space-y-5">
                            {/* Hero icon + title */}
                            <div className="text-center space-y-3">
                                <div className="relative w-20 h-20 mx-auto">
                                    <span className="absolute inset-0 rounded-[28px] bg-ant-orange/18 blur-2xl" />
                                    <div className="relative w-20 h-20 rounded-[28px] bg-white/[0.04] border border-white/[0.1] flex items-center justify-center">
                                        <AlertTriangle className="w-8 h-8 text-ant-orange" strokeWidth={1.5} />
                                    </div>
                                </div>
                                <h1 className="font-display text-[26px] md:text-[30px] leading-[1.1] tracking-[-0.02em] text-ant-light">
                                    {businessInfo?.name ? (
                                        <>
                                            <span className="text-ant-light/60 font-display italic">{businessInfo.name}</span> is paused
                                        </>
                                    ) : (
                                        'Your workspace is paused'
                                    )}
                                </h1>
                                <p className="font-serif italic text-[13px] md:text-[14px] text-ant-light/60 leading-relaxed max-w-sm mx-auto">
                                    Renew your subscription to restore access — submit a transfer and we&apos;ll review it in under 24 hours.
                                </p>
                            </div>

                            {/* Denied banner */}
                            {isDenied && latestSubmission?.denial_message && (
                                <div className="rounded-2xl bg-ant-rose/10 border border-ant-rose/25 overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-rose" />
                                    <div className="p-4 flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-ant-rose/15 border border-ant-rose/25 flex items-center justify-center text-ant-rose shrink-0">
                                            <XCircle className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0 space-y-0.5">
                                            <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                                Previous submission · Denied
                                            </p>
                                            <p className="text-[12px] text-ant-light/85 leading-relaxed">
                                                {latestSubmission.denial_message}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Pending vs renewal form */}
                            {isPending ? (
                                <div className="rounded-2xl bg-ant-orange/10 border border-ant-orange/25 overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <div className="p-6 text-center space-y-3">
                                        <div className="relative w-14 h-14 mx-auto">
                                            <span className="absolute inset-0 rounded-2xl bg-ant-orange/20 blur-xl animate-pulse" />
                                            <div className="relative w-14 h-14 rounded-2xl bg-ant-orange/15 border border-ant-orange/30 flex items-center justify-center">
                                                <Clock className="w-6 h-6 text-ant-orange" strokeWidth={1.75} />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/20 text-ant-orange">
                                                    <span className="w-1 h-1 rounded-full bg-ant-orange animate-pulse" />
                                                    Under review
                                                </span>
                                            </div>
                                            <p className="font-display text-[15px] text-ant-light">
                                                Payment proof received
                                            </p>
                                            <p className="font-serif italic text-[12px] text-ant-light/55 leading-relaxed max-w-xs mx-auto">
                                                We&apos;ll email you as soon as the owner approves it and your access resumes.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Chapter 01 — Plan */}
                                    {planName && (
                                        <section className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                                            <div className="h-[2px] w-full bg-ant-green/70" />
                                            <div className="px-4 py-3 border-b border-white/[0.06]">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-display text-[11px] text-ant-orange">01</span>
                                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                                        Current plan
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-4 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-ant-light shrink-0">
                                                        <CreditCard className="w-4 h-4" strokeWidth={1.5} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[15px] text-ant-light truncate">{planName}</p>
                                                        <p className="font-serif italic text-[11px] text-ant-light/50 mt-0.5">
                                                            {businessInfo?.plan?.license_type || businessInfo?.license_type || 'monthly'} cycle
                                                        </p>
                                                    </div>
                                                </div>
                                                {planPrice != null && (
                                                    <div className="text-right shrink-0">
                                                        <p className="font-display text-[22px] tabular-nums leading-none text-ant-light">
                                                            {planPrice}
                                                            <span className="text-[11px] text-ant-light/50 ml-1 font-normal">{planCurrency}</span>
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    {/* Chapter 02 — Bank info */}
                                    {bankInfo && Object.values(bankInfo).some(v => v) && (
                                        <section className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                                            <div className="h-[2px] w-full bg-ant-orange/70" />
                                            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-display text-[11px] text-ant-orange">02</span>
                                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                                        Transfer to
                                                    </span>
                                                </div>
                                                <span className="inline-flex items-center gap-1 text-[10px] text-ant-light/40">
                                                    <Banknote className="w-3 h-3" />
                                                    Bank
                                                </span>
                                            </div>
                                            <div className="divide-y divide-white/[0.06]">
                                                {bankInfo.bank_name && (
                                                    <BankRow
                                                        label="Bank"
                                                        value={bankInfo.bank_name}
                                                        copied={copied === 'bank'}
                                                        onCopy={() => handleCopy('bank', bankInfo.bank_name!)}
                                                    />
                                                )}
                                                {bankInfo.bank_account_holder && (
                                                    <BankRow
                                                        label="Holder"
                                                        value={bankInfo.bank_account_holder}
                                                        copied={copied === 'holder'}
                                                        onCopy={() => handleCopy('holder', bankInfo.bank_account_holder!)}
                                                    />
                                                )}
                                                {bankInfo.bank_rib && (
                                                    <BankRow
                                                        label="RIB"
                                                        value={bankInfo.bank_rib}
                                                        mono
                                                        copied={copied === 'rib'}
                                                        onCopy={() => handleCopy('rib', bankInfo.bank_rib!)}
                                                    />
                                                )}
                                                {bankInfo.bank_iban && (
                                                    <BankRow
                                                        label="IBAN"
                                                        value={bankInfo.bank_iban}
                                                        mono
                                                        copied={copied === 'iban'}
                                                        onCopy={() => handleCopy('iban', bankInfo.bank_iban!)}
                                                    />
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    {/* Chapter 03 — Proof */}
                                    <section className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                                        <div className="h-[2px] w-full bg-gradient-to-r from-ant-orange to-ant-rose" />
                                        <div className="px-4 py-3 border-b border-white/[0.06]">
                                            <div className="flex items-center gap-2">
                                                <span className="font-display text-[11px] text-ant-orange">03</span>
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                                    Submit proof
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-4 space-y-3">
                                            {/* Amount + ref */}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-light/50">
                                                        Amount paid
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            value={amount}
                                                            onChange={(e) => setAmount(e.target.value)}
                                                            placeholder="0.00"
                                                            className="w-full h-10 pl-3.5 pr-14 rounded-xl bg-white/[0.06] border border-white/[0.1] text-[13px] font-display tabular-nums text-ant-light placeholder:text-ant-light/25 focus:outline-none focus:border-ant-orange/50 focus:bg-white/[0.08] transition-all"
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase tracking-[0.18em] text-ant-light/40">
                                                            {planCurrency}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-light/50">
                                                        Transfer ref
                                                    </label>
                                                    <input
                                                        value={notes}
                                                        onChange={(e) => setNotes(e.target.value)}
                                                        placeholder="Reference #"
                                                        className="w-full h-10 px-3.5 rounded-xl bg-white/[0.06] border border-white/[0.1] text-[12px] font-mono text-ant-light placeholder:text-ant-light/25 focus:outline-none focus:border-ant-orange/50 focus:bg-white/[0.08] transition-all"
                                                    />
                                                </div>
                                            </div>

                                            {/* Dropzone */}
                                            <div
                                                {...getRootProps()}
                                                className={cn(
                                                    'relative rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all overflow-hidden',
                                                    isDragActive && 'border-ant-orange bg-ant-orange/10 scale-[1.01]',
                                                    !isDragActive && file && 'border-ant-green/40 bg-ant-green/8',
                                                    !isDragActive && !file && 'border-white/15 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]',
                                                )}
                                            >
                                                <input {...getInputProps()} />
                                                {file ? (
                                                    <div className="space-y-2.5">
                                                        {preview ? (
                                                            <div className="w-20 h-20 mx-auto rounded-xl overflow-hidden border border-white/10">
                                                                <img src={preview} alt="proof" className="w-full h-full object-cover" />
                                                            </div>
                                                        ) : (
                                                            <div className="w-14 h-14 mx-auto rounded-xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center">
                                                                <FileText className="w-6 h-6 text-ant-light/70" strokeWidth={1.5} />
                                                            </div>
                                                        )}
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            <CheckCircle2 className="w-3.5 h-3.5 text-ant-green" />
                                                            <span className="text-[12px] text-ant-light font-medium truncate max-w-[220px]">
                                                                {file.name}
                                                            </span>
                                                        </div>
                                                        <p className="font-serif italic text-[10px] text-ant-light/40">
                                                            Click or drop to replace
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <div className="w-12 h-12 mx-auto rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                                                            <Upload className="w-5 h-5 text-ant-light/50" strokeWidth={1.5} />
                                                        </div>
                                                        <p className="font-display text-[13px] text-ant-light">
                                                            Drop payment proof
                                                        </p>
                                                        <p className="font-serif italic text-[11px] text-ant-light/40">
                                                            Image or PDF · up to 10 MB
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Submit */}
                                            <button
                                                type="button"
                                                onClick={handleSubmit}
                                                disabled={!file || !amount || parseFloat(amount) <= 0 || submitting}
                                                className={cn(
                                                    'relative w-full h-12 rounded-full overflow-hidden font-display text-[13px] flex items-center justify-center gap-2 transition-all',
                                                    'bg-gradient-to-r from-ant-orange via-ant-rose to-ant-orange bg-[length:200%_100%] bg-left text-ant-light',
                                                    'hover:bg-right disabled:opacity-40 disabled:cursor-not-allowed',
                                                    'shadow-[0_16px_40px_-12px_rgba(217,118,6,0.55)]',
                                                )}
                                            >
                                                <span className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />
                                                {submitting ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 animate-spin relative" />
                                                        <span className="relative">Sending…</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles className="w-4 h-4 relative" />
                                                        <span className="relative">Submit payment proof</span>
                                                    </>
                                                )}
                                            </button>

                                            <p className="flex items-center justify-center gap-1.5 font-serif italic text-[11px] text-ant-light/35">
                                                <Lock className="w-3 h-3" />
                                                Encrypted upload · reviewed by the owner
                                            </p>
                                        </div>
                                    </section>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Footer assurance */}
                    <div className="flex items-center justify-center gap-1.5 pt-1">
                        <span className="font-display text-[9px] uppercase tracking-[0.24em] text-ant-light/30">
                            iGrowFast
                            <span className="text-ant-orange">.</span>
                            Platform
                        </span>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};

const BankRow = ({
    label,
    value,
    mono,
    copied,
    onCopy,
}: {
    label: string;
    value: string;
    mono?: boolean;
    copied: boolean;
    onCopy: () => void;
}) => (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors">
        <span className="text-[11px] text-ant-light/45 shrink-0">{label}</span>
        <div className="flex items-center gap-2 min-w-0">
            <span className={cn('text-[12px] text-ant-light truncate', mono && 'font-mono tracking-tight')}>
                {value}
            </span>
            <button
                type="button"
                onClick={onCopy}
                className={cn(
                    'w-7 h-7 rounded-full border flex items-center justify-center transition-all shrink-0',
                    copied
                        ? 'bg-ant-green/15 border-ant-green/30 text-ant-green'
                        : 'bg-white/[0.06] border-white/[0.1] text-ant-light/55 hover:text-ant-light hover:bg-white/[0.1]',
                )}
                aria-label="Copy"
            >
                {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
        </div>
    </div>
);

export default SuspensionOverlay;

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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface SuspensionOverlayProps {
    role: 'admin' | 'seller';
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

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    const { data: businessInfo } = useQuery({
        queryKey: ['suspension-business-info', businessId],
        queryFn: async () => {
            const { data } = await supabase
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
    }, [businessInfo]);

    const { data: bankInfo } = useQuery({
        queryKey: ['platform-settings-bank'],
        queryFn: async () => {
            const { data } = await supabase
                .from('platform_settings')
                .select('key, value')
                .in('key', ['bank_name', 'bank_account_holder', 'bank_rib', 'bank_iban']);
            const map: Record<string, string> = {};
            data?.forEach(r => { map[r.key] = r.value; });
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
            const { error: insertErr } = await supabase
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
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const isPending = latestSubmission?.status === 'pending';
    const isDenied = latestSubmission?.status === 'denied';
    const planName = businessInfo?.plan?.name || businessInfo?.license_type;
    const planPrice = businessInfo?.plan?.price;
    const planCurrency = businessInfo?.plan?.currency || 'MAD';

    if (role === 'seller') {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-xl"
                onKeyDown={e => e.preventDefault()}>
                <div className="relative w-full max-w-md mx-4 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-2xl shadow-2xl p-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-5">
                        <PhoneCall className="w-8 h-8 text-amber-400" />
                    </div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tight mb-2">
                        Service Temporarily Unavailable
                    </h1>
                    <p className="text-white/70 text-sm leading-relaxed">
                        Please contact your administration to resolve this issue.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-xl overflow-y-auto py-8"
            onKeyDown={e => e.preventDefault()}>
            <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-2xl shadow-2xl p-8">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-5">
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>

                <h1 className="text-2xl font-black text-white uppercase tracking-tight text-center mb-2">
                    Payment Unsuccessful
                </h1>
                <p className="text-white/70 text-sm text-center leading-relaxed mb-6">
                    Your subscription must be renewed. If not renewed, all data will be lost in 30 days.
                </p>

                {isDenied && latestSubmission?.denial_message && (
                    <div className="rounded-lg bg-red-500/20 border border-red-400/30 p-4 mb-6">
                        <div className="flex items-start gap-2">
                            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-red-300 text-sm font-semibold">Payment Denied</p>
                                <p className="text-red-200/80 text-sm mt-1">{latestSubmission.denial_message}</p>
                            </div>
                        </div>
                    </div>
                )}

                {isPending ? (
                    <div className="rounded-lg bg-amber-500/20 border border-amber-400/30 p-6 text-center">
                        <Clock className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                        <p className="text-amber-200 font-semibold text-sm">Payment Under Review</p>
                        <p className="text-amber-200/60 text-xs mt-1">
                            Your payment proof has been submitted and is being reviewed.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Plan & Amount Due */}
                        {planName && (
                            <div className="rounded-lg bg-white/5 border border-white/10 p-4 mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <CreditCard className="w-4 h-4 text-white/60" />
                                    <span className="text-white/80 text-xs font-semibold uppercase tracking-wide">
                                        Current Plan
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                    <span className="text-white font-semibold">{planName}</span>
                                    {planPrice != null && (
                                        <span className="text-white font-bold text-lg">
                                            {planPrice} <span className="text-white/50 text-xs font-normal">{planCurrency}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Bank Information */}
                        {bankInfo && Object.values(bankInfo).some(v => v) && (
                            <div className="rounded-lg bg-white/5 border border-white/10 p-4 mb-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <Banknote className="w-4 h-4 text-white/60" />
                                    <span className="text-white/80 text-xs font-semibold uppercase tracking-wide">
                                        Bank Information
                                    </span>
                                </div>
                                <div className="space-y-2 text-sm">
                                    {bankInfo.bank_name && (
                                        <div className="flex justify-between">
                                            <span className="text-white/50">Bank</span>
                                            <span className="text-white font-medium">{bankInfo.bank_name}</span>
                                        </div>
                                    )}
                                    {bankInfo.bank_account_holder && (
                                        <div className="flex justify-between">
                                            <span className="text-white/50">Holder</span>
                                            <span className="text-white font-medium">{bankInfo.bank_account_holder}</span>
                                        </div>
                                    )}
                                    {bankInfo.bank_rib && (
                                        <div className="flex justify-between">
                                            <span className="text-white/50">RIB</span>
                                            <span className="text-white font-mono font-medium">{bankInfo.bank_rib}</span>
                                        </div>
                                    )}
                                    {bankInfo.bank_iban && (
                                        <div className="flex justify-between">
                                            <span className="text-white/50">IBAN</span>
                                            <span className="text-white font-mono font-medium">{bankInfo.bank_iban}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Amount & Notes */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className="text-white/60 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                                    Amount Paid
                                </label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={amount}
                                        onChange={e => setAmount(e.target.value)}
                                        className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/30 pr-14"
                                        placeholder="0.00"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-xs font-medium">
                                        {planCurrency}
                                    </span>
                                </div>
                            </div>
                            <div>
                                <label className="text-white/60 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                                    Transfer Ref
                                </label>
                                <Input
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/30"
                                    placeholder="Reference #"
                                />
                            </div>
                        </div>

                        {/* Dropzone */}
                        <div
                            {...getRootProps()}
                            className={`
                                rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-all
                                ${isDragActive
                                    ? 'border-blue-400 bg-blue-400/10'
                                    : file
                                        ? 'border-green-400/50 bg-green-400/10'
                                        : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10'
                                }
                            `}
                        >
                            <input {...getInputProps()} />
                            {file ? (
                                <div className="space-y-2">
                                    {preview && (
                                        <img src={preview} alt="proof" className="w-20 h-20 object-cover rounded-lg mx-auto" />
                                    )}
                                    <div className="flex items-center justify-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                                        <span className="text-green-300 text-sm font-medium truncate max-w-[200px]">
                                            {file.name}
                                        </span>
                                    </div>
                                    <p className="text-white/40 text-xs">Click or drop to replace</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <Upload className="w-7 h-7 text-white/40 mx-auto" />
                                    <p className="text-white/60 text-sm font-medium">
                                        Drop payment proof here
                                    </p>
                                    <p className="text-white/30 text-xs">Image or PDF, max 10MB</p>
                                </div>
                            )}
                        </div>

                        <Button
                            onClick={handleSubmit}
                            disabled={!file || !amount || parseFloat(amount) <= 0 || submitting}
                            className="w-full mt-4 h-11 bg-white text-black font-bold hover:bg-white/90 disabled:opacity-40"
                        >
                            {submitting ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : null}
                            Submit Payment Proof
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};

export default SuspensionOverlay;

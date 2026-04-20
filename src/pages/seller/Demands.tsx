import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
    FileText,
    Plus,
    MessageSquare,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    ChevronRight,
    Send,
    HelpCircle,
    CreditCard,
    ShoppingBag,
    UserCog,
    Bug,
    UploadCloud,
    X,
    Image as ImageIcon,
    Film,
    Paperclip,
    Loader2,
    Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';

interface DemandMedia {
    path: string;
    name: string;
    type: string;
    size: number;
    /** Resolved at view time. Stored as undefined in DB. */
    url?: string;
}

interface SellerDemand {
    id: string;
    category: 'payment' | 'order' | 'account' | 'technical' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    subject: string;
    content: string;
    status: 'pending' | 'in_progress' | 'resolved' | 'dismissed';
    admin_response: string | null;
    admin_response_media: DemandMedia[] | null;
    responded_at: string | null;
    created_at: string;
    updated_at: string;
    media: DemandMedia[] | null;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_TYPES = 'image/*,video/*,application/pdf';

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const SellerDemands = () => {
    const { toast } = useToast();
    const [demands, setDemands] = useState<SellerDemand[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedDemand, setSelectedDemand] = useState<SellerDemand | null>(null);

    // New Demand Form State
    const [newDemand, setNewDemand] = useState({
        category: 'general',
        priority: 'medium',
        subject: '',
        content: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [resolvedMedia, setResolvedMedia] = useState<DemandMedia[]>([]);
    const [resolvedResponseMedia, setResolvedResponseMedia] = useState<DemandMedia[]>([]);

    // Resolve signed URLs for the selected demand's media (private bucket)
    useEffect(() => {
        let cancelled = false;
        const resolveList = async (list: DemandMedia[] | null | undefined): Promise<DemandMedia[]> => {
            if (!list || list.length === 0) return [];
            const paths = list.map((m) => m.path).filter(Boolean);
            if (paths.length === 0) return [];
            const { data, error } = await supabase.storage
                .from('demand-media')
                .createSignedUrls(paths, 60 * 60);
            if (error || !data) return list;
            const byPath = new Map(data.map((d: { path: string | null; signedUrl: string }) => [d.path, d.signedUrl]));
            return list.map((m) => ({ ...m, url: byPath.get(m.path) || undefined }));
        };
        const run = async () => {
            const [seller, response] = await Promise.all([
                resolveList(selectedDemand?.media),
                resolveList(selectedDemand?.admin_response_media),
            ]);
            if (!cancelled) {
                setResolvedMedia(seller);
                setResolvedResponseMedia(response);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [selectedDemand]);

    useEffect(() => {
        fetchDemands();
    }, []);

    const fetchDemands = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from('seller_demands')
                .select('*')
                .eq('seller_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDemands(data || []);
        } catch (error) {
            console.error('Error fetching demands:', error);
            toast({
                title: "Error",
                description: "Failed to load requests.",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const addFiles = useCallback((files: File[]) => {
        const valid: File[] = [];
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                toast({
                    title: "File too large",
                    description: `${file.name} exceeds the 50MB limit.`,
                    variant: "destructive"
                });
                continue;
            }
            valid.push(file);
        }
        if (valid.length) {
            setPendingFiles(prev => [...prev, ...valid]);
        }
    }, [toast]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) addFiles(files);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) addFiles(files);
        e.target.value = '';
    };

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const resetCreateForm = () => {
        setNewDemand({ category: 'general', priority: 'medium', subject: '', content: '' });
        setPendingFiles([]);
        setUploadProgress(0);
    };

    const uploadMedia = async (userId: string): Promise<DemandMedia[]> => {
        if (pendingFiles.length === 0) return [];

        const uploaded: DemandMedia[] = [];
        for (let i = 0; i < pendingFiles.length; i++) {
            const file = pendingFiles[i];
            const ext = file.name.split('.').pop() || 'bin';
            const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const path = `${userId}/${safeName}`;

            const { error: uploadError } = await supabase.storage
                .from('demand-media')
                .upload(path, file, {
                    cacheControl: '3600',
                    contentType: file.type || 'application/octet-stream',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // Bucket is private; store path only. Signed URLs are resolved at view time.
            uploaded.push({
                path,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size
            });

            setUploadProgress(Math.round(((i + 1) / pendingFiles.length) * 100));
        }
        return uploaded;
    };

    const handleCreateDemand = async () => {
        if (!newDemand.subject || !newDemand.content) {
            toast({
                title: "Incomplete Fields",
                description: "Please provide a subject and description.",
                variant: "destructive"
            });
            return;
        }

        setSubmitting(true);
        setUploadProgress(0);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const media = await uploadMedia(user.id);

            const { error } = await supabase
                .from('seller_demands')
                .insert({
                    seller_id: user.id,
                    ...newDemand,
                    status: 'pending',
                    media
                });

            if (error) throw error;

            toast({
                title: "Success",
                description: "Your request has been filed successfully.",
            });
            setIsCreateModalOpen(false);
            resetCreateForm();
            fetchDemands();
        } catch (error) {
            console.error('Error creating demand:', error);
            toast({
                title: "Error",
                description: (error as Error)?.message || "Failed to submit request.",
                variant: "destructive"
            });
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'pending':
                return { color: 'bg-ant-orange/10 text-ant-orange border-ant-orange/20', icon: Clock, label: 'Pending Review' };
            case 'in_progress':
                return { color: 'bg-blue-50 text-blue-600 border-blue-100', icon: HelpCircle, label: 'In Progress' };
            case 'resolved':
                return { color: 'bg-green-50 text-green-600 border-green-100', icon: CheckCircle2, label: 'Resolved' };
            case 'dismissed':
                return { color: 'bg-ant-rose/10 text-ant-rose border-red-100', icon: XCircle, label: 'Dismissed' };
            default:
                return { color: 'bg-gray-50 text-gray-600 border-gray-100', icon: Clock, label: status };
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'low': return 'text-gray-400';
            case 'medium': return 'text-blue-500';
            case 'high': return 'text-orange-500';
            case 'urgent': return 'text-ant-rose animate-pulse font-bold';
            default: return 'text-gray-400';
        }
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'payment': return CreditCard;
            case 'order': return ShoppingBag;
            case 'account': return UserCog;
            case 'technical': return Bug;
            default: return HelpCircle;
        }
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Demandes
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Demandes internes
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Vos requêtes à l&apos;administration — suivez les statuts, ajoutez des pièces jointes, recevez les résolutions.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Nouvelle demande
                    </button>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {[
                        { label: 'En attente', value: demands.filter((d) => d.status === 'pending').length, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                        { label: 'En cours', value: demands.filter((d) => d.status === 'in_progress').length, dot: 'bg-ant-ink', text: 'text-ant-ink' },
                        { label: 'Résolues', value: demands.filter((d) => d.status === 'resolved').length, dot: 'bg-ant-green', text: 'text-ant-green' },
                        { label: 'Total', value: demands.length, dot: 'bg-ant-mid', text: 'text-ant-ink' },
                    ].map((kpi, i) => (
                        <div key={i} className="bg-ant-paper p-4">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className={`h-1.5 w-1.5 rounded-full ${kpi.dot}`} />
                                {kpi.label}
                            </div>
                            <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 ${kpi.text}`}>
                                {kpi.value}
                            </p>
                        </div>
                    ))}
                </section>

            {/* Demands List */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="font-display text-ant-orange font-semibold">01</span>
                        Historique des demandes
                    </div>
                    <span className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                        {demands.length} {demands.length > 1 ? 'requêtes' : 'requête'}
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-ant-line bg-ant-light">
                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Catégorie</th>
                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Sujet</th>
                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Priorité</th>
                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Statut</th>
                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Date</th>
                                <th className="px-5 py-2.5 pr-5 w-12" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map((i) => (
                                    <tr key={i} className="border-b border-ant-line">
                                        <td colSpan={6} className="px-5 py-3">
                                            <div className="h-4 bg-ant-light rounded animate-pulse" />
                                        </td>
                                    </tr>
                                ))
                            ) : demands.length > 0 ? (
                                demands.map((d) => {
                                    const StatusIcon = getStatusConfig(d.status).icon;
                                    const CategoryIcon = getCategoryIcon(d.category);
                                    const priorityTone =
                                        d.priority === 'urgent'
                                            ? { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' }
                                            : d.priority === 'high'
                                                ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' }
                                                : d.priority === 'medium'
                                                    ? { bg: 'bg-ant-ink/6', border: 'border-ant-ink/15', text: 'text-ant-ink', dot: 'bg-ant-ink' }
                                                    : { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
                                    return (
                                        <tr key={d.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors cursor-pointer" onClick={() => { setSelectedDemand(d); setIsViewModalOpen(true); }}>
                                            <td className="px-5 py-3">
                                                <div className="inline-flex items-center gap-2">
                                                    <div className="h-7 w-7 rounded-lg border border-ant-line bg-ant-light flex items-center justify-center shrink-0">
                                                        <CategoryIcon className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                                    </div>
                                                    <span className="font-display text-[12px] font-semibold text-ant-ink capitalize">{d.category}</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 max-w-[260px]">
                                                <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{d.subject}</p>
                                                <p className="font-mono text-[10px] text-ant-mid mt-0.5">#{d.id.slice(0, 8).toUpperCase()}</p>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${priorityTone.bg} ${priorityTone.border} ${priorityTone.text}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${priorityTone.dot}`} />
                                                    {d.priority}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStatusConfig(d.status).color}`}>
                                                    <StatusIcon className="w-2.5 h-2.5" strokeWidth={2} />
                                                    {getStatusConfig(d.status).label}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 font-serif italic text-[12px] text-ant-mid tabular-nums whitespace-nowrap">
                                                {format(new Date(d.created_at), 'd MMM yyyy')}
                                            </td>
                                            <td className="px-5 py-3 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => { setSelectedDemand(d); setIsViewModalOpen(true); }}
                                                    aria-label="Détails"
                                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors"
                                                >
                                                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={6} className="p-0">
                                        <div className="mx-5 my-5 rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-10 flex flex-col items-center gap-2 text-center">
                                            <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper flex items-center justify-center">
                                                <MessageSquare className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                            </div>
                                            <p className="font-serif italic text-[12px] text-ant-mid">Aucune demande active</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Create Demand Modal */}
            <Dialog open={isCreateModalOpen} onOpenChange={(open) => { setIsCreateModalOpen(open); if (!open) resetCreateForm(); }}>
                <DialogContent className="max-w-4xl p-0 gap-0 border border-ant-line overflow-hidden rounded-2xl bg-ant-paper flex flex-col max-h-[92vh] shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]">
                    <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                    <DialogHeader className="px-6 pt-5 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Nouvelle demande
                        </div>
                        <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight">Soumettre une requête</DialogTitle>
                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                            Décrivez votre problème et la priorité. Des pièces jointes aident à le résoudre plus vite.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="px-6 pb-5 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto ant-scroll flex-1 pt-5">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Catégorie</label>
                                    <Select
                                        value={newDemand.category}
                                        onValueChange={(val) => setNewDemand((prev) => ({ ...prev, category: val }))}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus:ring-1 focus:ring-ant-orange/40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                            <SelectItem value="general">Question générale</SelectItem>
                                            <SelectItem value="payment">Paiement</SelectItem>
                                            <SelectItem value="order">Correction commande</SelectItem>
                                            <SelectItem value="account">Paramètres compte</SelectItem>
                                            <SelectItem value="technical">Bug technique</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Priorité</label>
                                    <Select
                                        value={newDemand.priority}
                                        onValueChange={(val) => setNewDemand((prev) => ({ ...prev, priority: val }))}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus:ring-1 focus:ring-ant-orange/40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                            <SelectItem value="low">Basse</SelectItem>
                                            <SelectItem value="medium">Moyenne</SelectItem>
                                            <SelectItem value="high">Haute</SelectItem>
                                            <SelectItem value="urgent">Urgente</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Sujet</label>
                                <Input
                                    placeholder="Question sur mon dernier versement…"
                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                    value={newDemand.subject}
                                    onChange={(e) => setNewDemand((prev) => ({ ...prev, subject: e.target.value }))}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Description</label>
                                <Textarea
                                    placeholder="Donnez autant de détails que possible pour accélérer la résolution."
                                    className="min-h-[160px] rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid resize-none p-3 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                    value={newDemand.content}
                                    onChange={(e) => setNewDemand((prev) => ({ ...prev, content: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Right column: attachments */}
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Pièces jointes</label>
                                    <span className="font-serif italic text-[11px] text-ant-mid">images · vidéos · PDF · 50 Mo max</span>
                                </div>
                                <div
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`relative cursor-pointer rounded-xl border border-dashed p-5 text-center transition-colors ${
                                        isDragging
                                            ? 'border-ant-orange bg-ant-orange/5'
                                            : 'border-ant-line bg-ant-light hover:bg-ant-light/70 hover:border-ant-mid/40'
                                    }`}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        accept={ACCEPTED_TYPES}
                                        className="hidden"
                                        onChange={handleFileInput}
                                    />
                                    <div className="flex flex-col items-center gap-2 pointer-events-none">
                                        <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper text-ant-mid flex items-center justify-center">
                                            <UploadCloud className="w-4 h-4" strokeWidth={1.75} />
                                        </div>
                                        <p className="font-display text-[13px] font-semibold text-ant-ink">
                                            {isDragging ? 'Déposez les fichiers' : 'Glissez-déposez ou cliquez'}
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-mid">Les captures d&apos;écran accélèrent la résolution</p>
                                    </div>
                                </div>

                                {pendingFiles.length > 0 && (
                                    <div className="space-y-1.5 pt-2">
                                        {pendingFiles.map((file, idx) => {
                                            const isImage = file.type.startsWith('image/');
                                            const isVideo = file.type.startsWith('video/');
                                            const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                            const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                            return (
                                                <div
                                                    key={`${file.name}-${idx}`}
                                                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-ant-light border border-ant-line"
                                                >
                                                    <div className="w-9 h-9 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                        {previewUrl ? (
                                                            <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Icon className="w-4 h-4 text-ant-mid" strokeWidth={1.75} />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-display text-[12px] font-semibold text-ant-ink truncate">{file.name}</p>
                                                        <p className="font-serif italic text-[11px] text-ant-mid">{formatFileSize(file.size)}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                                                        aria-label="Retirer"
                                                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-ant-mid hover:text-ant-rose transition-colors"
                                                        disabled={submitting}
                                                    >
                                                        <X className="w-3 h-3" strokeWidth={1.75} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {submitting && pendingFiles.length > 0 && (
                                    <div className="pt-2 space-y-1">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Envoi en cours</span>
                                            <span className="font-display text-[12px] font-semibold tabular-nums text-ant-ink">{uploadProgress}%</span>
                                        </div>
                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-ant-orange transition-all duration-300"
                                                style={{ width: `${uploadProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 bg-ant-paper border-t border-ant-line shrink-0 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { setIsCreateModalOpen(false); resetCreateForm(); }}
                            disabled={submitting}
                            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors disabled:opacity-50"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateDemand}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                                    Envoi…
                                </>
                            ) : (
                                <>
                                    <Send className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    Envoyer la demande
                                </>
                            )}
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* View Demand Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 gap-0 border border-ant-line overflow-hidden rounded-2xl bg-ant-paper flex flex-col max-h-[92vh] shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]">
                    {selectedDemand && (
                        <>
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 pt-5 pb-4 shrink-0 border-b border-ant-line">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center shrink-0">
                                        {React.createElement(getCategoryIcon(selectedDemand.category), {
                                            className: 'w-4 h-4 text-ant-mid',
                                            strokeWidth: 1.75,
                                        } as React.SVGProps<SVGSVGElement>)}
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid flex-wrap">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                            Demande · Aperçu
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case ${getStatusConfig(selectedDemand.status).color}`}>
                                                {getStatusConfig(selectedDemand.status).label}
                                            </span>
                                        </div>
                                        <h2 className="font-display text-[18px] font-semibold text-ant-ink leading-tight truncate">{selectedDemand.subject}</h2>
                                    </div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Créée le</p>
                                    <p className="font-display text-[13px] font-semibold text-ant-ink tabular-nums mt-0.5">
                                        {format(new Date(selectedDemand.created_at), 'd MMM yyyy')}
                                    </p>
                                </div>
                            </div>

                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto ant-scroll flex-1">
                                {/* Left: submission */}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">01</span>
                                            Votre message
                                        </div>
                                        <div className="p-4 rounded-xl bg-ant-light border border-ant-line">
                                            <p className="text-[13px] text-ant-ink leading-relaxed whitespace-pre-wrap">{selectedDemand.content}</p>
                                        </div>
                                    </div>

                                    {resolvedMedia.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Paperclip className="w-3 h-3" strokeWidth={1.75} />
                                                Pièces jointes · {resolvedMedia.length}
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {resolvedMedia.map((m, idx) => {
                                                    const isImage = m.type?.startsWith('image/');
                                                    const isVideo = m.type?.startsWith('video/');
                                                    return (
                                                        <div
                                                            key={`${m.path}-${idx}`}
                                                            className="group rounded-xl border border-ant-line bg-ant-paper overflow-hidden"
                                                        >
                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                <div className="aspect-square bg-ant-light flex items-center justify-center overflow-hidden">
                                                                    {isImage ? (
                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                    ) : isVideo ? (
                                                                        <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                    ) : (
                                                                        <Paperclip className="w-6 h-6 text-ant-mid" strokeWidth={1.5} />
                                                                    )}
                                                                </div>
                                                            </a>
                                                            <div className="p-2 border-t border-ant-line flex items-center justify-between gap-1.5">
                                                                <div className="min-w-0">
                                                                    <p className="font-display text-[11px] font-semibold text-ant-ink truncate" title={m.name}>{m.name}</p>
                                                                    <p className="font-serif italic text-[10px] text-ant-mid">{formatFileSize(m.size)}</p>
                                                                </div>
                                                                <a
                                                                    href={m.url}
                                                                    download={m.name}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-mid hover:text-ant-ink shrink-0 transition-colors"
                                                                >
                                                                    <Download className="w-3 h-3" strokeWidth={1.75} />
                                                                </a>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Right: admin response */}
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">02</span>
                                        Réponse administrateur
                                    </div>
                                    <AnimatePresence>
                                        {selectedDemand.admin_response ? (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="space-y-2"
                                            >
                                                <div className="p-4 rounded-xl bg-ant-ink text-white overflow-hidden">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                                            <AlertCircle className="w-3 h-3" strokeWidth={1.75} />
                                                            Réponse
                                                        </div>
                                                        <p className="font-serif italic text-[11px] text-white/60">
                                                            {format(new Date(selectedDemand.responded_at!), 'd MMM · HH:mm')}
                                                        </p>
                                                    </div>
                                                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{selectedDemand.admin_response}</p>

                                                    {resolvedResponseMedia.length > 0 && (
                                                        <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
                                                            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                                                <Paperclip className="w-3 h-3" strokeWidth={1.75} />
                                                                Pièces jointes · {resolvedResponseMedia.length}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {resolvedResponseMedia.map((m, idx) => {
                                                                    const isImage = m.type?.startsWith('image/');
                                                                    const isVideo = m.type?.startsWith('video/');
                                                                    return (
                                                                        <div key={`${m.path}-${idx}`} className="group rounded-lg border border-white/10 bg-white/5 overflow-hidden">
                                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                                <div className="aspect-video bg-black/20 flex items-center justify-center overflow-hidden">
                                                                                    {isImage ? (
                                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                                    ) : isVideo ? (
                                                                                        <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                                    ) : (
                                                                                        <Paperclip className="w-5 h-5 text-white/40" strokeWidth={1.5} />
                                                                                    )}
                                                                                </div>
                                                                            </a>
                                                                            <div className="p-1.5 flex items-center justify-between gap-1.5 border-t border-white/10">
                                                                                <p className="text-[10px] font-medium text-white/80 truncate flex-1" title={m.name}>{m.name}</p>
                                                                                <a
                                                                                    href={m.url}
                                                                                    download={m.name}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white/60 hover:bg-white/10 shrink-0 transition-colors"
                                                                                >
                                                                                    <Download className="w-3 h-3" strokeWidth={1.75} />
                                                                                </a>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                    <CheckCircle2 className="w-3 h-3" strokeWidth={1.75} />
                                                    Résolution validée
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-10 flex flex-col items-center justify-center text-center gap-3">
                                                <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper text-ant-mid flex items-center justify-center">
                                                    <Clock className="w-4 h-4" strokeWidth={1.5} />
                                                </div>
                                                <div className="space-y-0.5">
                                                    <p className="font-display text-[13px] font-semibold text-ant-ink">En attente</p>
                                                    <p className="font-serif italic text-[11px] text-ant-mid max-w-xs">
                                                        La demande est en cours de revue. Vous serez notifié dès qu&apos;un administrateur répond.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            </div>
        </div>
    );
};

export default SellerDemands;

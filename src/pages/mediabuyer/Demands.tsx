/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    MessageSquare,
    Clock,
    CheckCircle2,
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
    Download,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
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
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface DemandMedia {
    path: string;
    name: string;
    type: string;
    size: number;
    url?: string;
}

interface MediaBuyerDemand {
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

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/*,video/*,application/pdf';

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const STATUS_CFG: Record<string, { label: string; color: string; tint: string; dot: string }> = {
    pending: { label: 'En attente', color: 'text-ant-orange', tint: 'bg-ant-orange/12', dot: 'bg-ant-orange' },
    in_progress: { label: 'En cours', color: 'text-ant-ink', tint: 'bg-ant-ink/10', dot: 'bg-ant-ink' },
    resolved: { label: 'Résolue', color: 'text-ant-green', tint: 'bg-ant-green/12', dot: 'bg-ant-green' },
    dismissed: { label: 'Rejetée', color: 'text-ant-rose', tint: 'bg-ant-rose/12', dot: 'bg-ant-rose' },
};

const PRIORITY_CFG: Record<string, { label: string; tone: string }> = {
    low: { label: 'Faible', tone: 'text-ant-mid' },
    medium: { label: 'Moyenne', tone: 'text-ant-ink' },
    high: { label: 'Haute', tone: 'text-ant-orange' },
    urgent: { label: 'Urgente', tone: 'text-ant-rose font-semibold' },
};

const CATEGORY_CFG: Record<string, { label: string; icon: typeof HelpCircle }> = {
    general: { label: 'Général', icon: HelpCircle },
    payment: { label: 'Paiement', icon: CreditCard },
    order: { label: 'Commande', icon: ShoppingBag },
    account: { label: 'Compte', icon: UserCog },
    technical: { label: 'Technique', icon: Bug },
};

const MediaBuyerDemands = () => {
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [demands, setDemands] = useState<MediaBuyerDemand[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedDemand, setSelectedDemand] = useState<MediaBuyerDemand | null>(null);

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

    // ?id=<demandId> — deep link from the demand_received/demand_resolved emails. Opens the
    // matching demand's view modal once the list has loaded, then clears the param.
    const idParamHandledRef = useRef<string | null>(null);
    useEffect(() => {
        const requestedId = searchParams.get('id');
        if (!requestedId || loading) return;
        if (idParamHandledRef.current === requestedId) return;

        const found = demands.find((d) => d.id === requestedId);
        if (!found) return;
        idParamHandledRef.current = requestedId;

        setSelectedDemand(found);
        setIsViewModalOpen(true);

        const next = new URLSearchParams(searchParams);
        next.delete('id');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, demands, loading]);

    const fetchDemands = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return;

            const { data, error } = await (supabase as any)
                .from('mediabuyer_demands')
                .select('*')
                .eq('mediabuyer_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDemands((data || []) as MediaBuyerDemand[]);
        } catch (error) {
            console.error('Error fetching demands:', error);
            toast({ title: "Erreur", description: "Impossible de charger les demandes.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const addFiles = useCallback((files: File[]) => {
        const valid: File[] = [];
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                toast({ title: "Fichier trop volumineux", description: `${file.name} dépasse la limite de 50 Mo.`, variant: "destructive" });
                continue;
            }
            valid.push(file);
        }
        if (valid.length) setPendingFiles(prev => [...prev, ...valid]);
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
            const { error: uploadError } = await supabase.storage.from('demand-media').upload(path, file, {
                cacheControl: '3600', contentType: file.type || 'application/octet-stream', upsert: false
            });
            if (uploadError) throw uploadError;
            uploaded.push({ path, name: file.name, type: file.type || 'application/octet-stream', size: file.size });
            setUploadProgress(Math.round(((i + 1) / pendingFiles.length) * 100));
        }
        return uploaded;
    };

    const handleCreateDemand = async () => {
        if (!newDemand.subject || !newDemand.content) {
            toast({ title: "Champs incomplets", description: "Renseignez un sujet et une description.", variant: "destructive" });
            return;
        }
        setSubmitting(true);
        setUploadProgress(0);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return;
            const media = await uploadMedia(user.id);
            const { error } = await (supabase as any).from('mediabuyer_demands').insert({
                mediabuyer_id: user.id,
                'DigiCom Business': localStorage.getItem('activeBusinessId'),
                ...newDemand,
                status: 'pending',
                media
            });
            if (error) throw error;
            toast({ title: "Demande envoyée", description: "Votre demande a bien été enregistrée." });
            setIsCreateModalOpen(false);
            resetCreateForm();
            fetchDemands();
        } catch (error) {
            console.error('Error creating demand:', error);
            toast({ title: "Erreur", description: (error as Error)?.message || "Échec de l'envoi.", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Media Buyer · Demandes
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Mes demandes
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Posez vos questions, signalez un problème, suivez les réponses de l'administration.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-ant-ink text-ant-light font-medium text-[13px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.45)] hover:bg-ant-ink/95 active:scale-[0.98] transition-all shrink-0 self-stretch sm:self-auto"
                    >
                        <Plus className="w-4 h-4" />
                        Nouvelle demande
                    </button>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {[
                    { label: 'En attente', count: demands.filter(d => d.status === 'pending').length, accent: 'bg-ant-orange' },
                    { label: 'En cours', count: demands.filter(d => d.status === 'in_progress').length, accent: 'bg-ant-ink' },
                    { label: 'Résolues', count: demands.filter(d => d.status === 'resolved').length, accent: 'bg-ant-green' },
                    { label: 'Total', count: demands.length, accent: 'bg-ant-ink' },
                ].map((stat) => (
                    <div key={stat.label} className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', stat.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{stat.label}</span>
                        </div>
                        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
                            {stat.count}
                        </p>
                    </div>
                ))}
            </div>

            {/* Demands list */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                    <div className="flex items-center gap-2">
                        <span className="font-display text-[11px] text-ant-orange">01</span>
                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                            Historique des demandes
                        </span>
                    </div>
                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                        {demands.length} demande{demands.length !== 1 ? 's' : ''} au total
                    </p>
                </div>

                {loading ? (
                    <div className="p-10 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
                    </div>
                ) : demands.length === 0 ? (
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <MessageSquare className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">Aucune demande pour le moment</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Créez votre première demande pour signaler un problème ou poser une question à l'administration.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Mobile: card list */}
                        <div className="md:hidden divide-y divide-ant-line">
                            {demands.map((d) => {
                                const cat = CATEGORY_CFG[d.category] || CATEGORY_CFG.general;
                                const status = STATUS_CFG[d.status] || STATUS_CFG.pending;
                                const priority = PRIORITY_CFG[d.priority] || PRIORITY_CFG.medium;
                                const CategoryIcon = cat.icon;
                                return (
                                    <button
                                        key={d.id}
                                        type="button"
                                        onClick={() => { setSelectedDemand(d); setIsViewModalOpen(true); }}
                                        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-ant-light/50 active:bg-ant-light transition-colors"
                                    >
                                        <div className="w-9 h-9 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                                            <CategoryIcon className="w-4 h-4 text-ant-ink" />
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-1.5">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', status.tint, status.color)}>
                                                    <span className={cn('w-1 h-1 rounded-full', status.dot)} />
                                                    {status.label}
                                                </span>
                                                <span className={cn('text-[9px] font-medium uppercase tracking-[0.18em]', priority.tone)}>
                                                    {priority.label}
                                                </span>
                                            </div>
                                            <p className="font-display text-[13px] text-ant-ink leading-tight line-clamp-2">{d.subject}</p>
                                            <p className="font-serif italic text-[11px] text-ant-mid">
                                                {cat.label} · {format(new Date(d.created_at), 'dd MMM yyyy', { locale: fr })}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-ant-mid shrink-0 mt-1" />
                                    </button>
                                );
                            })}
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/40">
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Catégorie</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Sujet</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Priorité</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Statut</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Date</th>
                                        <th className="px-4 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {demands.map((d) => {
                                        const cat = CATEGORY_CFG[d.category] || CATEGORY_CFG.general;
                                        const status = STATUS_CFG[d.status] || STATUS_CFG.pending;
                                        const priority = PRIORITY_CFG[d.priority] || PRIORITY_CFG.medium;
                                        const CategoryIcon = cat.icon;
                                        return (
                                            <tr
                                                key={d.id}
                                                onClick={() => { setSelectedDemand(d); setIsViewModalOpen(true); }}
                                                className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="inline-flex items-center gap-2">
                                                        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center">
                                                            <CategoryIcon className="w-3.5 h-3.5 text-ant-ink" />
                                                        </div>
                                                        <span className="text-[11px] text-ant-ink">{cat.label}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="font-display text-[13px] text-ant-ink leading-tight line-clamp-1">{d.subject}</p>
                                                    <p className="font-mono text-[10px] text-ant-mid mt-0.5">ID {d.id.slice(0, 8).toUpperCase()}</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={cn('text-[10px] font-medium uppercase tracking-[0.18em]', priority.tone)}>
                                                        {priority.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', status.tint, status.color)}>
                                                        <span className={cn('w-1 h-1 rounded-full', status.dot)} />
                                                        {status.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-[12px] text-ant-ink tabular-nums">
                                                    {format(new Date(d.created_at), 'dd MMM yyyy', { locale: fr })}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <ChevronRight className="w-3.5 h-3.5 text-ant-mid ml-auto" />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>

            {/* Create Demand Modal */}
            <Dialog open={isCreateModalOpen} onOpenChange={(open) => { setIsCreateModalOpen(open); if (!open) resetCreateForm(); }}>
                <DialogContent className={cn(
                    'max-w-3xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    {/* Mobile drag handle */}
                    <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-ant-line" />
                    </div>
                    <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                    <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Demande · Nouvelle
                                    </span>
                                </div>
                                <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                    Créer une demande
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    Décrivez votre problème avec autant de détail que possible.
                                </DialogDescription>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCreateModalOpen(false)}
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                aria-label="Fermer"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Catégorie</label>
                                    <Select value={newDemand.category} onValueChange={(val) => setNewDemand(prev => ({ ...prev, category: val }))}>
                                        <SelectTrigger className="h-10 rounded-xl text-[12px] border-ant-line bg-ant-paper focus:ring-2 focus:ring-ant-orange/20">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                            <SelectItem value="general">Général</SelectItem>
                                            <SelectItem value="payment">Paiement</SelectItem>
                                            <SelectItem value="order">Commande</SelectItem>
                                            <SelectItem value="account">Compte</SelectItem>
                                            <SelectItem value="technical">Technique</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Priorité</label>
                                    <Select value={newDemand.priority} onValueChange={(val) => setNewDemand(prev => ({ ...prev, priority: val }))}>
                                        <SelectTrigger className="h-10 rounded-xl text-[12px] border-ant-line bg-ant-paper focus:ring-2 focus:ring-ant-orange/20">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                            <SelectItem value="low">Faible</SelectItem>
                                            <SelectItem value="medium">Moyenne</SelectItem>
                                            <SelectItem value="high">Haute</SelectItem>
                                            <SelectItem value="urgent">Urgente</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Sujet</label>
                                <input
                                    type="text"
                                    placeholder="Ex. Question sur mon dernier paiement…"
                                    className="w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                    value={newDemand.subject}
                                    onChange={(e) => setNewDemand(prev => ({ ...prev, subject: e.target.value }))}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Description détaillée</label>
                                <textarea
                                    placeholder="Expliquez le problème avec autant de détail que possible pour accélérer la résolution."
                                    className="w-full min-h-[160px] px-3.5 py-3 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 resize-none transition-all"
                                    value={newDemand.content}
                                    onChange={(e) => setNewDemand(prev => ({ ...prev, content: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Attachments */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Pièces jointes</label>
                                <span className="font-serif italic text-[10px] text-ant-mid">Images, vidéos, PDF · max 50 Mo</span>
                            </div>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                    'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all',
                                    isDragging ? 'border-ant-ink bg-ant-ink/[0.04]' : 'border-ant-line bg-ant-light hover:border-ant-ink/40',
                                )}
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
                                    <UploadCloud className={cn('w-7 h-7', isDragging ? 'text-ant-ink' : 'text-ant-mid')} />
                                    <p className="font-display text-[12px] text-ant-ink">
                                        {isDragging ? 'Relâchez pour joindre' : 'Glissez-déposez ou cliquez'}
                                    </p>
                                    <p className="font-serif italic text-[11px] text-ant-mid">
                                        Les captures d'écran accélèrent la résolution
                                    </p>
                                </div>
                            </div>

                            {pendingFiles.length > 0 && (
                                <div className="space-y-2">
                                    {pendingFiles.map((file, idx) => {
                                        const isImage = file.type.startsWith('image/');
                                        const isVideo = file.type.startsWith('video/');
                                        const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                        const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                        return (
                                            <div
                                                key={`${file.name}-${idx}`}
                                                className="flex items-center gap-3 p-2.5 rounded-xl bg-ant-paper border border-ant-line"
                                            >
                                                <div className="w-9 h-9 rounded-lg border border-ant-line bg-ant-light flex items-center justify-center overflow-hidden shrink-0">
                                                    {previewUrl ? (
                                                        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Icon className="w-3.5 h-3.5 text-ant-ink" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[12px] font-medium text-ant-ink truncate">{file.name}</p>
                                                    <p className="text-[10px] text-ant-mid">{formatFileSize(file.size)}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors shrink-0"
                                                    disabled={submitting}
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {submitting && pendingFiles.length > 0 && (
                                <div className="space-y-1">
                                    <div className="h-1 bg-ant-line rounded-full overflow-hidden">
                                        <div className="h-full bg-ant-ink transition-all" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                    <p className="font-serif italic text-[10px] text-ant-mid text-center">
                                        Téléversement {uploadProgress}%
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <button
                            type="button"
                            onClick={() => setIsCreateModalOpen(false)}
                            disabled={submitting}
                            className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors disabled:opacity-60"
                        >
                            Annuler
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateDemand}
                            disabled={submitting}
                            className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 active:scale-[0.98] transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Envoi…
                                </>
                            ) : (
                                <>
                                    <Send className="w-3.5 h-3.5" />
                                    Envoyer la demande
                                </>
                            )}
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* View Demand Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className={cn(
                    'max-w-4xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    {selectedDemand && (() => {
                        const cat = CATEGORY_CFG[selectedDemand.category] || CATEGORY_CFG.general;
                        const status = STATUS_CFG[selectedDemand.status] || STATUS_CFG.pending;
                        const CategoryIcon = cat.icon;
                        return (
                            <>
                                {/* Mobile drag handle */}
                                <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                                    <div className="w-10 h-1 rounded-full bg-ant-line" />
                                </div>
                                <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                                <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <div className="w-10 h-10 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                                                <CategoryIcon className="w-4 h-4 text-ant-ink" />
                                            </div>
                                            <div className="min-w-0 space-y-1.5 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                        Demande · Aperçu
                                                    </span>
                                                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', status.tint, status.color)}>
                                                        <span className={cn('w-1 h-1 rounded-full', status.dot)} />
                                                        {status.label}
                                                    </span>
                                                </div>
                                                <DialogTitle className="font-display text-[18px] leading-[1.15] tracking-[-0.01em] text-ant-ink">
                                                    {selectedDemand.subject}
                                                </DialogTitle>
                                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                                    {cat.label} · déposée le {format(new Date(selectedDemand.created_at), 'dd MMMM yyyy', { locale: fr })}
                                                </DialogDescription>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsViewModalOpen(false)}
                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                            aria-label="Fermer"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </DialogHeader>

                                <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Left: submission + attachments */}
                                    <div className="space-y-4">
                                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                            <div className="h-[3px] w-full bg-ant-ink" />
                                            <div className="px-4 py-3 border-b border-ant-line">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-display text-[10px] text-ant-orange">01</span>
                                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                        Votre message
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-4">
                                                <p className="text-[12px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                                                    {selectedDemand.content}
                                                </p>
                                            </div>
                                        </section>

                                        {resolvedMedia.length > 0 && (
                                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                                <div className="h-[3px] w-full bg-ant-orange" />
                                                <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-display text-[10px] text-ant-orange">02</span>
                                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                            Vos pièces jointes
                                                        </span>
                                                    </div>
                                                    <span className="text-[11px] tabular-nums text-ant-mid">{resolvedMedia.length}</span>
                                                </div>
                                                <div className="p-3 grid grid-cols-2 gap-2">
                                                    {resolvedMedia.map((m, idx) => {
                                                        const isImage = m.type?.startsWith('image/');
                                                        const isVideo = m.type?.startsWith('video/');
                                                        return (
                                                            <div key={`${m.path}-${idx}`} className="group rounded-xl border border-ant-line overflow-hidden bg-ant-light">
                                                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                    <div className="aspect-square flex items-center justify-center overflow-hidden">
                                                                        {isImage ? (
                                                                            <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                        ) : isVideo ? (
                                                                            <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                        ) : (
                                                                            <Paperclip className="w-6 h-6 text-ant-mid" />
                                                                        )}
                                                                    </div>
                                                                </a>
                                                                <div className="p-2 border-t border-ant-line bg-ant-paper flex items-center justify-between gap-1.5">
                                                                    <div className="min-w-0">
                                                                        <p className="text-[10px] font-medium text-ant-ink truncate">{m.name}</p>
                                                                        <p className="text-[9px] text-ant-mid">{formatFileSize(m.size)}</p>
                                                                    </div>
                                                                    <a
                                                                        href={m.url}
                                                                        download={m.name}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="w-6 h-6 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors shrink-0"
                                                                    >
                                                                        <Download className="w-3 h-3" />
                                                                    </a>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </section>
                                        )}
                                    </div>

                                    {/* Right: admin response */}
                                    <div className="space-y-4">
                                        {selectedDemand.admin_response ? (
                                            <section className="rounded-2xl border border-ant-green/30 bg-ant-green/5 overflow-hidden">
                                                <div className="h-[3px] w-full bg-ant-green" />
                                                <div className="px-4 py-3 border-b border-ant-green/20 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-display text-[10px] text-ant-green">✓</span>
                                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-green">
                                                            Réponse de l'administration
                                                        </span>
                                                    </div>
                                                    <span className="font-serif italic text-[10px] text-ant-mid">
                                                        {format(new Date(selectedDemand.responded_at!), 'dd MMM · HH:mm', { locale: fr })}
                                                    </span>
                                                </div>
                                                <div className="p-4 space-y-3">
                                                    <p className="text-[12px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                                                        {selectedDemand.admin_response}
                                                    </p>

                                                    {resolvedResponseMedia.length > 0 && (
                                                        <div className="pt-3 border-t border-ant-green/20 space-y-2">
                                                            <div className="flex items-center gap-1.5">
                                                                <Paperclip className="w-3 h-3 text-ant-green" />
                                                                <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-green">
                                                                    Pièces admin ({resolvedResponseMedia.length})
                                                                </p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {resolvedResponseMedia.map((m, idx) => {
                                                                    const isImage = m.type?.startsWith('image/');
                                                                    const isVideo = m.type?.startsWith('video/');
                                                                    return (
                                                                        <div key={`${m.path}-${idx}`} className="rounded-xl border border-ant-green/25 overflow-hidden bg-ant-paper">
                                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                                <div className="aspect-video flex items-center justify-center overflow-hidden">
                                                                                    {isImage ? (
                                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                                    ) : isVideo ? (
                                                                                        <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                                    ) : (
                                                                                        <Paperclip className="w-5 h-5 text-ant-green" />
                                                                                    )}
                                                                                </div>
                                                                            </a>
                                                                            <div className="px-2 py-1.5 flex items-center justify-between gap-1 border-t border-ant-green/15">
                                                                                <p className="text-[10px] font-medium text-ant-ink truncate flex-1">{m.name}</p>
                                                                                <a
                                                                                    href={m.url}
                                                                                    download={m.name}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="w-5 h-5 rounded-full bg-ant-green/10 flex items-center justify-center text-ant-green hover:bg-ant-green hover:text-ant-light transition-colors shrink-0"
                                                                                >
                                                                                    <Download className="w-2.5 h-2.5" />
                                                                                </a>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="pt-2 flex items-center gap-1.5">
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-ant-green" />
                                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-green">
                                                            Résolution vérifiée
                                                        </span>
                                                    </div>
                                                </div>
                                            </section>
                                        ) : (
                                            <section className="rounded-2xl border border-dashed border-ant-line bg-ant-light p-10 flex flex-col items-center justify-center text-center gap-2 h-full min-h-[200px]">
                                                <Clock className="w-6 h-6 text-ant-mid" />
                                                <p className="font-display text-[13px] text-ant-ink">En attente de réponse</p>
                                                <p className="font-serif italic text-[11px] text-ant-mid max-w-xs">
                                                    L'administration traitera votre demande bientôt. Vous serez notifié ici.
                                                </p>
                                            </section>
                                        )}
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default MediaBuyerDemands;

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
    MessageSquare,
    Clock,
    CheckCircle2,
    XCircle,
    Search,
    ChevronRight,
    MessageCircle,
    Timer,
    Info,
    Paperclip,
    Image as ImageIcon,
    Film,
    FileText,
    Download,
    ExternalLink,
    UploadCloud,
    X,
    Loader2,
    Headphones,
    Target,
    Inbox,
    Sparkles,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface DemandMedia {
    path: string;
    name: string;
    type: string;
    size: number;
    url?: string;
}

type DemandRole = 'seller' | 'mediabuyer';

interface DemandWithCollaborator {
    id: string;
    seller_id?: string;
    mediabuyer_id?: string;
    category: string;
    priority: string;
    subject: string;
    content: string;
    status: string;
    admin_response: string | null;
    admin_response_media: DemandMedia[] | null;
    responded_at: string | null;
    created_at: string;
    updated_at: string;
    media: DemandMedia[] | null;
    collaborator: {
        name: string;
        email: string;
        avatar_url: string | null;
        avatar_config?: unknown;
    };
}

const TABLE_FOR: Record<DemandRole, string> = {
    seller: 'seller_demands',
    mediabuyer: 'mediabuyer_demands',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/*,video/*,application/pdf';

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const DemandKpi: React.FC<{
    label: string;
    value: number | string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

// Status → Anthropic theme mapping
const statusTheme = (status: string) => {
    switch (status) {
        case 'pending':
            return { stripe: 'bg-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange', label: 'Pending', icon: Clock };
        case 'in_progress':
            return { stripe: 'bg-ant-ink', bg: 'bg-ant-ink/6', border: 'border-ant-ink/20', text: 'text-ant-ink', dot: 'bg-ant-ink', label: 'In progress', icon: Timer };
        case 'resolved':
            return { stripe: 'bg-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green', label: 'Resolved', icon: CheckCircle2 };
        case 'dismissed':
            return { stripe: 'bg-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose', label: 'Dismissed', icon: XCircle };
        default:
            return { stripe: 'bg-ant-line', bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: status, icon: Info };
    }
};

const priorityTheme = (priority: string) => {
    switch (priority) {
        case 'low':
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: 'Low' };
        case 'medium':
            return { bg: 'bg-ant-ink/6', border: 'border-ant-ink/20', text: 'text-ant-ink', dot: 'bg-ant-ink', label: 'Medium' };
        case 'high':
            return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange', label: 'High' };
        case 'urgent':
            return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose', label: 'Critical' };
        default:
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: priority };
    }
};

const Demands = () => {
    const { toast } = useToast();
    const [role, setRole] = useState<DemandRole>('seller');
    const [demands, setDemands] = useState<DemandWithCollaborator[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDemand, setSelectedDemand] = useState<DemandWithCollaborator | null>(null);
    const [isResponseModalOpen, setIsResponseModalOpen] = useState(false);
    const [resolvedMedia, setResolvedMedia] = useState<DemandMedia[]>([]);
    const [resolvedResponseMedia, setResolvedResponseMedia] = useState<DemandMedia[]>([]);
    const [responseFiles, setResponseFiles] = useState<File[]>([]);
    const [responseDragging, setResponseDragging] = useState(false);
    const [responseUploadProgress, setResponseUploadProgress] = useState(0);
    const responseInputRef = useRef<HTMLInputElement | null>(null);
    const activeBusinessId = typeof window !== 'undefined' ? localStorage.getItem('activeBusinessId') : null;

    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    const [adminResponse, setAdminResponse] = useState('');
    const [newStatus, setNewStatus] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchDemands();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBusinessId, role]);

    const fetchDemands = async () => {
        setLoading(true);
        try {
            let query = (supabase as any)
                .from(TABLE_FOR[role])
                .select('*, collaborator:users(name, email, avatar_url, avatar_config)')
                .order('created_at', { ascending: false });

            if (activeBusinessId) {
                query = query.eq('DigiCom Business', activeBusinessId);
            }

            const { data, error } = await query;
            if (error) throw error;
            setDemands((data as unknown as DemandWithCollaborator[]) || []);
        } catch (error) {
            console.error('Error fetching demands:', error);
            toast({
                title: 'Error',
                description: `Failed to load ${role === 'seller' ? 'seller' : 'media buyer'} requests.`,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

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
            const [collabMedia, response] = await Promise.all([
                resolveList(selectedDemand?.media),
                resolveList(selectedDemand?.admin_response_media),
            ]);
            if (!cancelled) {
                setResolvedMedia(collabMedia);
                setResolvedResponseMedia(response);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [selectedDemand]);

    const addResponseFiles = useCallback(
        (files: File[]) => {
            const valid: File[] = [];
            for (const file of files) {
                if (file.size > MAX_FILE_SIZE) {
                    toast({
                        title: 'File too large',
                        description: `${file.name} exceeds the 50MB limit.`,
                        variant: 'destructive',
                    });
                    continue;
                }
                valid.push(file);
            }
            if (valid.length) setResponseFiles((prev) => [...prev, ...valid]);
        },
        [toast]
    );

    const handleResponseDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setResponseDragging(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) addResponseFiles(files);
    };

    const handleResponseFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) addResponseFiles(files);
        e.target.value = '';
    };

    const removeResponseFile = (index: number) => {
        setResponseFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const uploadResponseMedia = async (demandId: string): Promise<DemandMedia[]> => {
        if (responseFiles.length === 0) return [];
        const uploaded: DemandMedia[] = [];
        for (let i = 0; i < responseFiles.length; i++) {
            const file = responseFiles[i];
            const ext = file.name.split('.').pop() || 'bin';
            const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const path = `responses/${demandId}/${safeName}`;
            const { error: upErr } = await supabase.storage
                .from('demand-media')
                .upload(path, file, {
                    cacheControl: '3600',
                    contentType: file.type || 'application/octet-stream',
                    upsert: false,
                });
            if (upErr) throw upErr;
            uploaded.push({
                path,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size,
            });
            setResponseUploadProgress(Math.round(((i + 1) / responseFiles.length) * 100));
        }
        return uploaded;
    };

    const handleUpdateDemand = async () => {
        if (!selectedDemand) return;

        setSubmitting(true);
        setResponseUploadProgress(0);
        try {
            const updates: Record<string, unknown> = {
                status: newStatus || selectedDemand.status,
                updated_at: new Date().toISOString(),
            };

            if (adminResponse.trim()) {
                updates.admin_response = adminResponse;
                updates.responded_at = new Date().toISOString();
            }

            if (responseFiles.length > 0) {
                const newMedia = await uploadResponseMedia(selectedDemand.id);
                const existing = (selectedDemand.admin_response_media || []) as DemandMedia[];
                updates.admin_response_media = [...existing, ...newMedia];
                if (!updates.responded_at) updates.responded_at = new Date().toISOString();
            }

            const { error } = await (supabase as any).from(TABLE_FOR[role]).update(updates).eq('id', selectedDemand.id);

            if (error) throw error;

            toast({
                title: 'Demand updated',
                description: `Request has been marked as ${newStatus || selectedDemand.status}.`,
            });
            setIsResponseModalOpen(false);
            setAdminResponse('');
            setNewStatus('');
            setResponseFiles([]);
            setResponseUploadProgress(0);
            fetchDemands();
        } catch (error) {
            console.error('Error updating demand:', error);
            toast({
                title: 'Update failed',
                description: 'Could not sync changes to the database.',
                variant: 'destructive',
            });
        } finally {
            setSubmitting(false);
        }
    };

    const filteredDemands = useMemo(
        () =>
            demands.filter((d) => {
                const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
                const matchesSearch =
                    d.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    d.collaborator?.name?.toLowerCase().includes(searchQuery.toLowerCase());
                return matchesStatus && matchesSearch;
            }),
        [demands, statusFilter, searchQuery]
    );

    const stats = useMemo(() => {
        const total = demands.length;
        const pending = demands.filter((d) => d.status === 'pending').length;
        const inProgress = demands.filter((d) => d.status === 'in_progress').length;
        const resolved = demands.filter((d) => d.status === 'resolved').length;
        const open = pending + inProgress;
        const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
        return { total, pending, inProgress, resolved, open, rate };
    }, [demands]);

    const statusCounts = {
        all: demands.length,
        pending: demands.filter((d) => d.status === 'pending').length,
        in_progress: demands.filter((d) => d.status === 'in_progress').length,
        resolved: demands.filter((d) => d.status === 'resolved').length,
        dismissed: demands.filter((d) => d.status === 'dismissed').length,
    };

    const STATUS_TABS: Array<{ id: keyof typeof statusCounts; label: string }> = [
        { id: 'all', label: 'All' },
        { id: 'pending', label: 'Pending' },
        { id: 'in_progress', label: 'In progress' },
        { id: 'resolved', label: 'Resolved' },
        { id: 'dismissed', label: 'Dismissed' },
    ];

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Support · Collaborator demands
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Demands
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every question from the field lands here — sellers, media buyers, couriers. Triage fast, respond in one thread, close the loop.
                        </p>
                    </div>
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                        {([
                            { key: 'seller' as DemandRole, label: 'Sellers', icon: Headphones },
                            { key: 'mediabuyer' as DemandRole, label: 'Media buyers', icon: Target },
                        ]).map((r) => {
                            const active = role === r.key;
                            const Icon = r.icon;
                            return (
                                <button
                                    key={r.key}
                                    onClick={() => setRole(r.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    {r.label}
                                </button>
                            );
                        })}
                    </div>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <DemandKpi label="Total demands" value={stats.total} suffix="tickets" accent="ink" icon={Inbox} />
                    <DemandKpi label="Open" value={stats.open} suffix={`${stats.pending} pending`} accent="orange" icon={Clock} />
                    <DemandKpi label="In progress" value={stats.inProgress} suffix="working" accent="ink" icon={Timer} />
                    <DemandKpi label="Response rate" value={`${stats.rate}%`} suffix="resolved" accent="green" icon={CheckCircle2} />
                </section>

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {STATUS_TABS.map((t) => {
                            const active = statusFilter === t.id;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setStatusFilter(t.id)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                        {statusCounts[t.id]}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative w-full md:w-[340px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder={`Search subject or ${role === 'seller' ? 'seller' : 'media buyer'} name...`}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-48 rounded-2xl bg-ant-light animate-pulse" />
                        ))}
                    </div>
                ) : filteredDemands.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <MessageSquare className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {demands.length ? 'No demands match these filters' : 'No demands yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {demands.length
                                ? 'Loosen the search or switch status to bring tickets back.'
                                : 'When a collaborator files a support request, it will surface here.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredDemands.map((d) => {
                            const s = statusTheme(d.status);
                            const p = priorityTheme(d.priority);
                            const StatusIcon = s.icon;

                            return (
                                <div
                                    key={d.id}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all flex flex-col"
                                >
                                    <div className={cn('h-[3px] w-full', s.stripe)} />

                                    {/* Header: collaborator + status */}
                                    <div className="px-4 py-3 border-b border-ant-line flex items-start justify-between gap-2.5">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <UserAvatar url={d.collaborator?.avatar_url} config={(d.collaborator as any)?.avatar_config} name={d.collaborator?.name} className="h-9 w-9 shrink-0 rounded-xl border border-ant-line" />
                                            <div className="min-w-0">
                                                <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{d.collaborator?.name || 'Unknown'}</p>
                                                <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] font-semibold tabular-nums">#{d.id.slice(0, 8).toUpperCase()}</p>
                                            </div>
                                        </div>
                                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0', s.bg, s.border, s.text)}>
                                            <StatusIcon className="w-3 h-3" />
                                            {s.label}
                                        </span>
                                    </div>

                                    {/* Body */}
                                    <div className="px-4 py-3.5 flex-1 flex flex-col gap-3">
                                        <h3 className="font-display text-[14px] font-semibold text-ant-ink line-clamp-2 leading-snug">
                                            {d.subject}
                                        </h3>

                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', p.bg, p.border, p.text)}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />
                                                {p.label}
                                            </span>
                                            <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid uppercase tracking-[0.12em]">
                                                {d.category}
                                            </span>
                                            {d.media && d.media.length > 0 && (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid tabular-nums">
                                                    <Paperclip className="w-2.5 h-2.5" />
                                                    {d.media.length}
                                                </span>
                                            )}
                                        </div>

                                        <p className="font-serif italic text-[12px] text-ant-mid line-clamp-3 leading-relaxed">
                                            {d.content}
                                        </p>
                                    </div>

                                    {/* Footer */}
                                    <div className="px-4 py-3 border-t border-ant-line flex items-center justify-between gap-2">
                                        <div className="inline-flex items-center gap-1.5 text-[10px] text-ant-mid font-semibold uppercase tracking-[0.14em]">
                                            <Clock className="w-3 h-3" />
                                            <span className="tabular-nums">{format(new Date(d.created_at), 'MMM dd · HH:mm')}</span>
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setSelectedDemand(d);
                                                setNewStatus(d.status);
                                                setAdminResponse(d.admin_response || '');
                                                setIsResponseModalOpen(true);
                                            }}
                                            className="h-8 rounded-full px-3.5 bg-ant-ink hover:bg-ant-ink/90 text-white text-[11px] font-semibold gap-1.5 cursor-pointer"
                                        >
                                            Take action
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Admin Response Modal */}
                <Dialog
                    open={isResponseModalOpen}
                    onOpenChange={(open) => {
                        setIsResponseModalOpen(open);
                        if (!open) {
                            setResponseFiles([]);
                            setResponseUploadProgress(0);
                        }
                    }}
                >
                    <DialogContent className="max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                        {selectedDemand && (() => {
                            const s = statusTheme(selectedDemand.status);
                            const p = priorityTheme(selectedDemand.priority);
                            const StatusIcon = s.icon;
                            return (
                                <>
                                    {/* Editorial header */}
                                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-3">
                                        <div className="flex items-start gap-3">
                                            <UserAvatar url={selectedDemand.collaborator?.avatar_url} config={(selectedDemand.collaborator as any)?.avatar_config} name={selectedDemand.collaborator?.name} className="h-14 w-14 shrink-0 rounded-2xl border border-ant-line" />
                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Demand · #{selectedDemand.id.slice(0, 8).toUpperCase()}
                                                </div>
                                                <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">
                                                    {selectedDemand.subject}
                                                </DialogTitle>
                                                <p className="font-serif italic text-[13px] text-ant-mid">
                                                    {selectedDemand.collaborator?.name} · {selectedDemand.collaborator?.email}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', s.bg, s.border, s.text)}>
                                                        <StatusIcon className="w-3 h-3" />
                                                        {s.label}
                                                    </span>
                                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', p.bg, p.border, p.text)}>
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />
                                                        {p.label}
                                                    </span>
                                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid uppercase tracking-[0.12em]">
                                                        {selectedDemand.category}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1.5 text-[11px] text-ant-mid font-semibold">
                                                        <Clock className="w-3 h-3" />
                                                        <span className="tabular-nums">{format(new Date(selectedDemand.created_at), 'MMM dd, yyyy · HH:mm')}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </DialogHeader>

                                    <div className="ant-scroll overflow-y-auto px-6 py-5 space-y-5 flex-1">
                                        {/* Request Content */}
                                        <section className="space-y-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <MessageCircle className="w-3 h-3" />
                                                Request content
                                            </div>
                                            <div className="rounded-2xl border border-ant-line bg-ant-light/40 p-4">
                                                <p className="font-serif text-[13px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                                                    {selectedDemand.content}
                                                </p>
                                            </div>
                                        </section>

                                        {/* Attached media */}
                                        {resolvedMedia && resolvedMedia.length > 0 && (
                                            <section className="space-y-2">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                    <Paperclip className="w-3 h-3" />
                                                    Attachments · {resolvedMedia.length}
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                    {resolvedMedia.map((m, idx) => {
                                                        const isImage = m.type?.startsWith('image/');
                                                        const isVideo = m.type?.startsWith('video/');
                                                        const isPdf = m.type === 'application/pdf';
                                                        return (
                                                            <div
                                                                key={`${m.path}-${idx}`}
                                                                className="group relative rounded-2xl bg-ant-paper border border-ant-line overflow-hidden"
                                                            >
                                                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                    <div className="aspect-square bg-ant-light flex items-center justify-center overflow-hidden">
                                                                        {isImage ? (
                                                                            <img src={m.url} alt={m.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
                                                                        ) : isVideo ? (
                                                                            <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                        ) : (
                                                                            <div className="flex flex-col items-center gap-2 text-ant-mid/40">
                                                                                {isPdf ? <FileText className="w-10 h-10" strokeWidth={1.25} /> : <Paperclip className="w-10 h-10" strokeWidth={1.25} />}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="absolute inset-0 bg-ant-ink/0 group-hover:bg-ant-ink/35 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                                        <div className="w-9 h-9 rounded-full bg-ant-paper border border-ant-line flex items-center justify-center shadow-sm">
                                                                            <ExternalLink className="w-4 h-4 text-ant-ink" />
                                                                        </div>
                                                                    </div>
                                                                </a>
                                                                <div className="p-2 border-t border-ant-line flex items-center justify-between gap-1">
                                                                    <div className="min-w-0">
                                                                        <p className="text-[11px] font-semibold text-ant-ink truncate" title={m.name}>
                                                                            {m.name}
                                                                        </p>
                                                                        <p className="text-[10px] text-ant-mid tabular-nums">{formatFileSize(m.size)}</p>
                                                                    </div>
                                                                    <a
                                                                        href={m.url}
                                                                        download={m.name}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="w-7 h-7 rounded-full flex items-center justify-center text-ant-mid hover:bg-ant-light hover:text-ant-ink shrink-0 transition-colors cursor-pointer"
                                                                        title="Download"
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

                                        {/* Status selector */}
                                        <section className="space-y-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Zap className="w-3 h-3" />
                                                Resolution status
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {[
                                                    { id: 'pending', label: 'Pending', icon: Clock, tone: 'orange' },
                                                    { id: 'in_progress', label: 'In progress', icon: Timer, tone: 'ink' },
                                                    { id: 'resolved', label: 'Resolved', icon: CheckCircle2, tone: 'green' },
                                                    { id: 'dismissed', label: 'Dismissed', icon: XCircle, tone: 'rose' },
                                                ].map((choice) => {
                                                    const active = newStatus === choice.id;
                                                    const a = KPI_ACCENTS[choice.tone as keyof typeof KPI_ACCENTS];
                                                    const ChoiceIcon = choice.icon;
                                                    return (
                                                        <button
                                                            key={choice.id}
                                                            onClick={() => setNewStatus(choice.id)}
                                                            className={cn(
                                                                'flex flex-col items-center justify-center py-3 px-3 rounded-2xl border transition-all gap-1.5 cursor-pointer',
                                                                active
                                                                    ? `${a.tile} border-2`
                                                                    : 'bg-ant-paper border-ant-line text-ant-mid hover:border-ant-ink/30 hover:text-ant-ink'
                                                            )}
                                                        >
                                                            <ChoiceIcon className="w-4 h-4" strokeWidth={1.75} />
                                                            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold">{choice.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </section>

                                        {/* Admin response */}
                                        <section className="space-y-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <MessageSquare className="w-3 h-3" />
                                                Administrative response
                                            </div>
                                            <Textarea
                                                placeholder="Type your official response here..."
                                                className="min-h-[120px] rounded-2xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                value={adminResponse}
                                                onChange={(e) => setAdminResponse(e.target.value)}
                                            />
                                            <p className="font-serif italic text-[11px] text-ant-mid">
                                                Visible to the collaborator immediately after you update.
                                            </p>
                                        </section>

                                        {/* Response attachments */}
                                        <section className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                    <Paperclip className="w-3 h-3" />
                                                    Response attachments
                                                </div>
                                                <span className="font-serif italic text-[11px] text-ant-mid">Images, videos, PDF · 50 MB each</span>
                                            </div>

                                            {/* Existing response media */}
                                            {resolvedResponseMedia.length > 0 && (
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                                                    {resolvedResponseMedia.map((m, idx) => {
                                                        const isImage = m.type?.startsWith('image/');
                                                        const isVideo = m.type?.startsWith('video/');
                                                        return (
                                                            <div key={`${m.path}-${idx}`} className="group relative rounded-2xl bg-ant-paper border border-ant-line overflow-hidden">
                                                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                    <div className="aspect-square bg-ant-light flex items-center justify-center overflow-hidden">
                                                                        {isImage ? (
                                                                            <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                        ) : isVideo ? (
                                                                            <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <FileText className="w-10 h-10 text-ant-mid/40" strokeWidth={1.25} />
                                                                        )}
                                                                    </div>
                                                                </a>
                                                                <div className="p-2 border-t border-ant-line flex items-center justify-between gap-1">
                                                                    <div className="min-w-0">
                                                                        <p className="text-[11px] font-semibold text-ant-ink truncate" title={m.name}>
                                                                            {m.name}
                                                                        </p>
                                                                        <p className="text-[10px] text-ant-mid tabular-nums">{formatFileSize(m.size)}</p>
                                                                    </div>
                                                                    <a
                                                                        href={m.url}
                                                                        download={m.name}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="w-7 h-7 rounded-full flex items-center justify-center text-ant-mid hover:bg-ant-light hover:text-ant-ink shrink-0 transition-colors"
                                                                    >
                                                                        <Download className="w-3 h-3" />
                                                                    </a>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Drop zone */}
                                            <div
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    setResponseDragging(true);
                                                }}
                                                onDragEnter={(e) => {
                                                    e.preventDefault();
                                                    setResponseDragging(true);
                                                }}
                                                onDragLeave={() => setResponseDragging(false)}
                                                onDrop={handleResponseDrop}
                                                onClick={() => responseInputRef.current?.click()}
                                                className={cn(
                                                    'relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all',
                                                    responseDragging
                                                        ? 'border-ant-orange bg-ant-orange/5'
                                                        : 'border-ant-line bg-ant-light hover:border-ant-ink/30 hover:bg-ant-light/60'
                                                )}
                                            >
                                                <input
                                                    ref={responseInputRef}
                                                    type="file"
                                                    multiple
                                                    accept={ACCEPTED_TYPES}
                                                    className="hidden"
                                                    onChange={handleResponseFileInput}
                                                />
                                                <div className="flex flex-col items-center gap-2 pointer-events-none">
                                                    <div className={cn(
                                                        'w-11 h-11 rounded-2xl border flex items-center justify-center transition-colors',
                                                        responseDragging ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' : 'bg-ant-paper border-ant-line text-ant-mid'
                                                    )}>
                                                        <UploadCloud className="w-5 h-5" strokeWidth={1.5} />
                                                    </div>
                                                    <div>
                                                        <p className="font-display text-[14px] font-semibold text-ant-ink">
                                                            {responseDragging ? 'Drop files to attach' : 'Drag & drop, or click to browse'}
                                                        </p>
                                                        <p className="font-serif italic text-[11px] text-ant-mid mt-1">
                                                            Images, videos or PDFs up to 50 MB each
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Pending files */}
                                            {responseFiles.length > 0 && (
                                                <div className="space-y-1.5 mt-2">
                                                    {responseFiles.map((file, idx) => {
                                                        const isImage = file.type.startsWith('image/');
                                                        const isVideo = file.type.startsWith('video/');
                                                        const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                                        const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                                        return (
                                                            <div key={`${file.name}-${idx}`} className="flex items-center gap-3 p-2.5 rounded-xl bg-ant-light border border-ant-line">
                                                                <div className="w-9 h-9 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                                    {previewUrl ? (
                                                                        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <Icon className="w-3.5 h-3.5 text-ant-mid" />
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[12px] font-semibold text-ant-ink truncate">{file.name}</p>
                                                                    <p className="text-[10px] text-ant-mid tabular-nums">{formatFileSize(file.size)}</p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        removeResponseFile(idx);
                                                                    }}
                                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose transition-colors cursor-pointer"
                                                                    disabled={submitting}
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {submitting && responseFiles.length > 0 && (
                                                <div className="mt-2">
                                                    <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                                        <div className="h-full bg-ant-orange transition-all duration-300" style={{ width: `${responseUploadProgress}%` }} />
                                                    </div>
                                                    <p className="text-[11px] font-semibold text-ant-mid mt-1 text-center tabular-nums">
                                                        Uploading {responseUploadProgress}%
                                                    </p>
                                                </div>
                                            )}
                                        </section>
                                    </div>

                                    <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                                        <Button
                                            variant="ghost"
                                            onClick={() => setIsResponseModalOpen(false)}
                                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                        >
                                            Discard
                                        </Button>
                                        <Button
                                            onClick={handleUpdateDemand}
                                            disabled={submitting}
                                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                                        >
                                            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                            Sync &amp; update
                                        </Button>
                                    </DialogFooter>
                                </>
                            );
                        })()}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Demands;

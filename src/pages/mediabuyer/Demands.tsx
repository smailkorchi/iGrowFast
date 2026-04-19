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
    Download,
    ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

const MediaBuyerDemands = () => {
    const { toast } = useToast();
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

    const fetchDemands = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
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
            toast({ title: "Error", description: "Failed to load requests.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const addFiles = useCallback((files: File[]) => {
        const valid: File[] = [];
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                toast({ title: "File too large", description: `${file.name} exceeds the 50MB limit.`, variant: "destructive" });
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
            toast({ title: "Incomplete Fields", description: "Please provide a subject and description.", variant: "destructive" });
            return;
        }
        setSubmitting(true);
        setUploadProgress(0);
        try {
            const { data: { user } } = await supabase.auth.getUser();
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
            toast({ title: "Success", description: "Your request has been filed successfully." });
            setIsCreateModalOpen(false);
            resetCreateForm();
            fetchDemands();
        } catch (error) {
            console.error('Error creating demand:', error);
            toast({ title: "Error", description: (error as Error)?.message || "Failed to submit request.", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'pending': return { color: 'bg-amber-500/10 text-amber-700', label: 'Pending' };
            case 'in_progress': return { color: 'bg-brand-navy/10 text-brand-navy', label: 'In Progress' };
            case 'resolved': return { color: 'bg-emerald-500/10 text-emerald-700', label: 'Resolved' };
            case 'dismissed': return { color: 'bg-red-500/10 text-red-600', label: 'Dismissed' };
            default: return { color: 'bg-gray-100 text-gray-500', label: status };
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'low': return 'text-gray-400';
            case 'medium': return 'text-brand-navy/60';
            case 'high': return 'text-amber-600';
            case 'urgent': return 'text-red-600 font-semibold';
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Demands Hub</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Submit requests and track administrative resolutions</p>
                    </div>
                    <Button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        New Request
                    </Button>
                </div>
            </header>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {[
                    { label: 'Pending', count: demands.filter(d => d.status === 'pending').length, accent: '#d97706' },
                    { label: 'In Progress', count: demands.filter(d => d.status === 'in_progress').length, accent: '#3b5e5e' },
                    { label: 'Resolved', count: demands.filter(d => d.status === 'resolved').length, accent: '#059669' },
                    { label: 'Total', count: demands.length, accent: '#6b7280' },
                ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: stat.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{stat.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none">{stat.count}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Demands table */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="px-3.5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Request History</p>
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-semibold border-gray-100 text-gray-400">
                        Authenticated Channel
                    </Badge>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Category</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Subject</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Priority</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Status</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Date</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="py-10 text-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
                                    </td>
                                </tr>
                            ) : demands.length > 0 ? (
                                demands.map((d) => {
                                    const CategoryIcon = getCategoryIcon(d.category);
                                    const statusCfg = getStatusConfig(d.status);
                                    return (
                                        <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded border border-gray-100 bg-white flex items-center justify-center shrink-0">
                                                        <CategoryIcon className="w-3.5 h-3.5 text-gray-400" />
                                                    </div>
                                                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{d.category}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <p className="text-[11px] font-semibold text-brand-navy/80 leading-tight line-clamp-1">{d.subject}</p>
                                                <p className="text-[9px] text-gray-400 mt-0.5">ID: {d.id.slice(0, 8).toUpperCase()}</p>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={cn('text-[10px] uppercase tracking-wider', getPriorityColor(d.priority))}>
                                                    {d.priority}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <Badge className={cn('h-5 px-1.5 text-[9px] font-semibold uppercase border-none', statusCfg.color)}>
                                                    {statusCfg.label}
                                                </Badge>
                                            </td>
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                                {format(new Date(d.created_at), 'dd MMM yyyy')}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => { setSelectedDemand(d); setIsViewModalOpen(true); }}
                                                    className="h-7 w-7 rounded text-gray-400 hover:text-brand-navy hover:bg-brand-navy/5"
                                                >
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <MessageSquare className="w-6 h-6 text-gray-400" />
                                            <p className="text-[11px] text-gray-400">No active requests found.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Demand Modal */}
            <Dialog open={isCreateModalOpen} onOpenChange={(open) => { setIsCreateModalOpen(open); if (!open) resetCreateForm(); }}>
                <DialogContent className="max-w-3xl p-0 border border-gray-100 overflow-hidden rounded-xl bg-white flex flex-col max-h-[90vh]">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-gray-100 shrink-0">
                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">New Support Request</DialogTitle>
                        <DialogDescription className="text-[11px] text-gray-400">Briefly describe your issue and its priority.</DialogDescription>
                    </DialogHeader>
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto flex-1">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold text-gray-600">Topic Category</label>
                                    <Select value={newDemand.category} onValueChange={(val) => setNewDemand(prev => ({ ...prev, category: val }))}>
                                        <SelectTrigger className="h-8 rounded-md text-[11px] border-gray-100">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-lg border-gray-100">
                                            <SelectItem value="general">General Inquiry</SelectItem>
                                            <SelectItem value="payment">Payment Issue</SelectItem>
                                            <SelectItem value="order">Order Correction</SelectItem>
                                            <SelectItem value="account">Account Settings</SelectItem>
                                            <SelectItem value="technical">Technical Bug</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold text-gray-600">Priority Level</label>
                                    <Select value={newDemand.priority} onValueChange={(val) => setNewDemand(prev => ({ ...prev, priority: val }))}>
                                        <SelectTrigger className="h-8 rounded-md text-[11px] border-gray-100">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-lg border-gray-100">
                                            <SelectItem value="low">Low (Routine)</SelectItem>
                                            <SelectItem value="medium">Medium</SelectItem>
                                            <SelectItem value="high">High (Urgent)</SelectItem>
                                            <SelectItem value="urgent">Critical (Blocker)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-gray-600">Request Subject</label>
                                <Input
                                    placeholder="I have a question about my latest payout..."
                                    className="h-8 rounded-md text-[11px] border-gray-100"
                                    value={newDemand.subject}
                                    onChange={(e) => setNewDemand(prev => ({ ...prev, subject: e.target.value }))}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-gray-600">Detailed Explanation</label>
                                <Textarea
                                    placeholder="Please provide as much detail as possible to help us resolve this quickly."
                                    className="min-h-[140px] rounded-md text-[11px] border-gray-100 resize-none"
                                    value={newDemand.content}
                                    onChange={(e) => setNewDemand(prev => ({ ...prev, content: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Attachments */}
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-semibold text-gray-600">Attachments</label>
                                    <span className="text-[9px] text-gray-400">Images, videos, PDF · max 50MB each</span>
                                </div>
                                <div
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={cn(
                                        'cursor-pointer rounded-lg border border-dashed p-5 text-center transition-all',
                                        isDragging ? 'border-brand-navy bg-brand-navy/5' : 'border-gray-200 bg-gray-50 hover:border-brand-navy/40'
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
                                        <UploadCloud className={cn('w-6 h-6', isDragging ? 'text-brand-navy' : 'text-gray-400')} />
                                        <p className="text-[11px] font-semibold text-gray-600">
                                            {isDragging ? 'Drop files to attach' : 'Drag & drop or click to browse'}
                                        </p>
                                        <p className="text-[9px] text-gray-400">Screenshots help us resolve issues faster</p>
                                    </div>
                                </div>

                                {pendingFiles.length > 0 && (
                                    <div className="space-y-1.5">
                                        {pendingFiles.map((file, idx) => {
                                            const isImage = file.type.startsWith('image/');
                                            const isVideo = file.type.startsWith('video/');
                                            const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                            const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                            return (
                                                <div
                                                    key={`${file.name}-${idx}`}
                                                    className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white border border-gray-100"
                                                >
                                                    <div className="w-8 h-8 rounded border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                                        {previewUrl ? (
                                                            <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Icon className="w-3.5 h-3.5 text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[10px] font-semibold text-brand-navy truncate">{file.name}</p>
                                                        <p className="text-[9px] text-gray-400">{formatFileSize(file.size)}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                                                        className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
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
                                    <div>
                                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-brand-navy transition-all" style={{ width: `${uploadProgress}%` }} />
                                        </div>
                                        <p className="text-[9px] text-gray-400 mt-1 text-center">Uploading {uploadProgress}%</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="px-5 py-4 bg-white border-t border-gray-100 shrink-0">
                        <Button
                            className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5"
                            onClick={handleCreateDemand}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <>
                                    <Send className="w-3.5 h-3.5" />
                                    File Request
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Demand Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border border-gray-100 overflow-hidden rounded-xl bg-white flex flex-col max-h-[90vh]">
                    {selectedDemand && (
                        <>
                            <div className="p-5 bg-white border-b border-gray-100 shrink-0">
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                            {React.createElement(getCategoryIcon(selectedDemand.category), { className: "w-4 h-4 text-gray-500" })}
                                        </div>
                                        <div className="min-w-0">
                                            <Badge className={cn('h-5 px-1.5 text-[9px] font-semibold uppercase border-none mb-1', getStatusConfig(selectedDemand.status).color)}>
                                                {getStatusConfig(selectedDemand.status).label}
                                            </Badge>
                                            <p className="text-[13px] font-semibold text-brand-navy leading-tight truncate">{selectedDemand.subject}</p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400">Filed On</p>
                                        <p className="text-[11px] font-semibold text-brand-navy/80 mt-0.5">{format(new Date(selectedDemand.created_at), 'MMM dd, yyyy')}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto flex-1">
                                {/* Left: submission + attachments */}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Your Submission</p>
                                        <div className="p-3.5 rounded-lg bg-gray-50 border border-gray-100">
                                            <p className="text-[11px] text-brand-navy/80 leading-relaxed whitespace-pre-wrap">{selectedDemand.content}</p>
                                        </div>
                                    </div>

                                    {resolvedMedia.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-1.5">
                                                <Paperclip className="w-3 h-3 text-gray-400" />
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Attachments ({resolvedMedia.length})</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {resolvedMedia.map((m, idx) => {
                                                    const isImage = m.type?.startsWith('image/');
                                                    const isVideo = m.type?.startsWith('video/');
                                                    return (
                                                        <div key={`${m.path}-${idx}`} className="group rounded-lg border border-gray-100 overflow-hidden">
                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                                                    {isImage ? (
                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                    ) : isVideo ? (
                                                                        <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                    ) : (
                                                                        <Paperclip className="w-6 h-6 text-gray-300" />
                                                                    )}
                                                                </div>
                                                            </a>
                                                            <div className="p-2 border-t border-gray-100 flex items-center justify-between gap-1.5">
                                                                <div className="min-w-0">
                                                                    <p className="text-[9px] font-semibold text-brand-navy truncate">{m.name}</p>
                                                                    <p className="text-[8px] text-gray-400">{formatFileSize(m.size)}</p>
                                                                </div>
                                                                <a href={m.url} download={m.name} target="_blank" rel="noopener noreferrer"
                                                                    className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100">
                                                                    <Download className="w-3 h-3" />
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
                                <div className="space-y-3">
                                    {selectedDemand.admin_response ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-emerald-700">Official Admin Response</p>
                                                <p className="text-[9px] text-gray-400">{format(new Date(selectedDemand.responded_at!), 'MMM dd, HH:mm')}</p>
                                            </div>
                                            <div className="p-3.5 rounded-lg bg-emerald-50/50 border border-emerald-100">
                                                <p className="text-[11px] text-brand-navy/80 leading-relaxed whitespace-pre-wrap">{selectedDemand.admin_response}</p>

                                                {resolvedResponseMedia.length > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-emerald-100 space-y-1.5">
                                                        <div className="flex items-center gap-1.5">
                                                            <Paperclip className="w-3 h-3 text-emerald-600" />
                                                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-emerald-700">Admin attachments ({resolvedResponseMedia.length})</p>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-1.5">
                                                            {resolvedResponseMedia.map((m, idx) => {
                                                                const isImage = m.type?.startsWith('image/');
                                                                const isVideo = m.type?.startsWith('video/');
                                                                return (
                                                                    <div key={`${m.path}-${idx}`} className="rounded border border-emerald-100 overflow-hidden">
                                                                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                            <div className="aspect-video bg-white flex items-center justify-center overflow-hidden">
                                                                                {isImage ? (
                                                                                    <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                                ) : isVideo ? (
                                                                                    <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                                ) : (
                                                                                    <Paperclip className="w-5 h-5 text-gray-300" />
                                                                                )}
                                                                            </div>
                                                                        </a>
                                                                        <div className="p-1.5 flex items-center justify-between gap-1 border-t border-emerald-50">
                                                                            <p className="text-[9px] font-semibold text-brand-navy truncate flex-1">{m.name}</p>
                                                                            <a href={m.url} download={m.name} target="_blank" rel="noopener noreferrer"
                                                                                className="w-5 h-5 rounded flex items-center justify-center text-emerald-600 hover:bg-emerald-100">
                                                                                <Download className="w-2.5 h-2.5" />
                                                                            </a>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="mt-3 flex items-center gap-2">
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                    <p className="text-[9px] font-semibold text-emerald-700 uppercase tracking-wider">Verified Resolution</p>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-full min-h-[160px] py-8 rounded-lg border border-dashed border-gray-200 flex flex-col items-center justify-center text-center gap-2">
                                            <Clock className="w-6 h-6 text-gray-400" />
                                            <p className="text-[11px] text-gray-400">Waiting for administrative review.</p>
                                            <p className="text-[10px] text-gray-300">You will be notified here when an admin replies.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default MediaBuyerDemands;

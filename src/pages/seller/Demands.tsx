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
import { Card, CardContent } from '@/components/ui/card';
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
                return { color: 'bg-amber-50 text-amber-600 border-amber-100', icon: Clock, label: 'Pending Review' };
            case 'in_progress':
                return { color: 'bg-blue-50 text-blue-600 border-blue-100', icon: HelpCircle, label: 'In Progress' };
            case 'resolved':
                return { color: 'bg-green-50 text-green-600 border-green-100', icon: CheckCircle2, label: 'Resolved' };
            case 'dismissed':
                return { color: 'bg-red-50 text-red-600 border-red-100', icon: XCircle, label: 'Dismissed' };
            default:
                return { color: 'bg-gray-50 text-gray-600 border-gray-100', icon: Clock, label: status };
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'low': return 'text-gray-400';
            case 'medium': return 'text-blue-500';
            case 'high': return 'text-orange-500';
            case 'urgent': return 'text-red-600 animate-pulse font-bold';
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
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Submit requests · Track admin resolutions</p>
                    </div>
                    <Button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white px-3 flex items-center gap-1.5"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        New Request
                    </Button>
                </div>
            </header>

            {/* KPI Tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#d97706' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Pending</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{demands.filter(d => d.status === 'pending').length}</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">In Progress</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{demands.filter(d => d.status === 'in_progress').length}</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Resolved</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{demands.filter(d => d.status === 'resolved').length}</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#6b7280' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{demands.length}</p>
                    </div>
                </div>
            </div>

            {/* Demands List */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardContent className="p-0">
                    <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5 border-b border-gray-100">
                        <span className="text-[11px] font-semibold text-brand-navy">Request History</span>
                    </div>
                    <div className="overflow-x-auto text-left">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Category</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Subject</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Priority</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Status</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Date</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    [1,2,3].map(i => (
                                        <tr key={i}>
                                            <td colSpan={6} className="px-3 py-2">
                                                <div className="h-5 bg-gray-100 rounded animate-pulse" />
                                            </td>
                                        </tr>
                                    ))
                                ) : demands.length > 0 ? (
                                    demands.map((d) => {
                                        const StatusIcon = getStatusConfig(d.status).icon;
                                        const CategoryIcon = getCategoryIcon(d.category);
                                        return (
                                            <tr key={d.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100">
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                                    <div className="flex items-center gap-1.5">
                                                        <CategoryIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                        <span className="capitalize">{d.category}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80 max-w-[200px]">
                                                    <p className="truncate font-medium">{d.subject}</p>
                                                    <p className="text-[9px] text-gray-400 tabular-nums">{d.id.slice(0, 8).toUpperCase()}</p>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`text-[9px] uppercase tracking-[0.12em] font-bold ${getPriorityColor(d.priority)}`}>
                                                        {d.priority}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[9px] font-semibold border ${getStatusConfig(d.status).color}`}>
                                                        <StatusIcon className="w-2.5 h-2.5" />
                                                        {getStatusConfig(d.status).label}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums whitespace-nowrap">
                                                    {format(new Date(d.created_at), 'MMM dd, yyyy')}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            setSelectedDemand(d);
                                                            setIsViewModalOpen(true);
                                                        }}
                                                        className="h-7 w-7 rounded-md hover:bg-gray-100 text-gray-400 hover:text-brand-navy"
                                                    >
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={6}>
                                            <div className="border border-dashed border-gray-200 rounded-xl py-8 mx-3 my-3 flex flex-col items-center justify-center text-center">
                                                <MessageSquare className="w-6 h-6 text-gray-400 mb-2" />
                                                <p className="text-[11px] font-medium text-gray-400">No active requests found.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Create Demand Modal */}
            <Dialog open={isCreateModalOpen} onOpenChange={(open) => { setIsCreateModalOpen(open); if (!open) resetCreateForm(); }}>
                <DialogContent className="max-w-4xl p-0 border border-gray-100 overflow-hidden rounded-xl bg-white flex flex-col max-h-[92vh]">
                    <DialogHeader className="px-5 pt-5 pb-4 shrink-0 border-b border-gray-100">
                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">New Support Request</DialogTitle>
                        <DialogDescription className="text-[11px] text-gray-400">Briefly describe your issue and its priority.</DialogDescription>
                    </DialogHeader>
                    <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto flex-1 pt-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Category</label>
                                <Select
                                    value={newDemand.category}
                                    onValueChange={(val) => setNewDemand(prev => ({ ...prev, category: val }))}
                                >
                                    <SelectTrigger className="h-8 rounded-md border-gray-100 bg-gray-50 text-[11px]">
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
                                <label className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Priority</label>
                                <Select
                                    value={newDemand.priority}
                                    onValueChange={(val) => setNewDemand(prev => ({ ...prev, priority: val }))}
                                >
                                    <SelectTrigger className="h-8 rounded-md border-gray-100 bg-gray-50 text-[11px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-lg border-gray-100">
                                        <SelectItem value="low">Low</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="high">High</SelectItem>
                                        <SelectItem value="urgent">Urgent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Subject</label>
                            <Input
                                placeholder="I have a question about my latest payout..."
                                className="h-8 rounded-md border-gray-100 bg-gray-50 text-[11px]"
                                value={newDemand.subject}
                                onChange={(e) => setNewDemand(prev => ({ ...prev, subject: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Description</label>
                            <Textarea
                                placeholder="Please provide as much detail as possible to help us resolve this quickly."
                                className="min-h-[140px] rounded-md border-gray-100 bg-gray-50 text-[11px] resize-none p-2.5"
                                value={newDemand.content}
                                onChange={(e) => setNewDemand(prev => ({ ...prev, content: e.target.value }))}
                            />
                        </div>
                      </div>

                      {/* Right column: attachments */}
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Attachments</label>
                                <span className="text-[9px] text-gray-400">Images, videos, PDF · max 50MB</span>
                            </div>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`relative cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all ${
                                    isDragging
                                        ? 'border-brand-navy bg-brand-navy/5'
                                        : 'border-gray-200 bg-gray-50 hover:border-brand-navy/30'
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
                                    <UploadCloud className="w-5 h-5 text-gray-400" />
                                    <p className="text-[11px] font-medium text-gray-600">
                                        {isDragging ? 'Drop files to attach' : 'Drag & drop, or click to browse'}
                                    </p>
                                    <p className="text-[9px] text-gray-400">Screenshots help us resolve issues faster</p>
                                </div>
                            </div>

                            {pendingFiles.length > 0 && (
                                <div className="space-y-1.5 pt-1.5">
                                    {pendingFiles.map((file, idx) => {
                                        const isImage = file.type.startsWith('image/');
                                        const isVideo = file.type.startsWith('video/');
                                        const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                        const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                        return (
                                            <div
                                                key={`${file.name}-${idx}`}
                                                className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100"
                                            >
                                                <div className="w-8 h-8 rounded-md bg-white border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                                    {previewUrl ? (
                                                        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Icon className="w-3.5 h-3.5 text-gray-400" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-medium text-gray-700 truncate">{file.name}</p>
                                                    <p className="text-[9px] text-gray-400">{formatFileSize(file.size)}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                                                    className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
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
                                <div className="pt-2">
                                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-brand-navy transition-all duration-300"
                                            style={{ width: `${uploadProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-gray-400 mt-1 text-center">Uploading {uploadProgress}%</p>
                                </div>
                            )}
                        </div>
                      </div>
                    </div>
                    <div className="px-5 py-3.5 bg-white border-t border-gray-100 shrink-0">
                        <Button
                            className="w-full h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white flex items-center gap-1.5 justify-center"
                            onClick={handleCreateDemand}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <Send className="w-3.5 h-3.5" />
                                    File Request
                                </>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* View Demand Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border border-gray-100 overflow-hidden rounded-xl bg-white flex flex-col max-h-[92vh]">
                    {selectedDemand && (
                        <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 pt-4 pb-3.5 shrink-0 border-b border-gray-100">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center border border-gray-100 shrink-0">
                                        {React.createElement(getCategoryIcon(selectedDemand.category), {
                                            className: "w-4 h-4 text-gray-400"
                                        })}
                                    </div>
                                    <div className="min-w-0">
                                        <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[9px] font-semibold border ${getStatusConfig(selectedDemand.status).color} mb-1`}>
                                            {getStatusConfig(selectedDemand.status).label}
                                        </span>
                                        <h2 className="text-[13px] font-semibold text-brand-navy leading-tight truncate">{selectedDemand.subject}</h2>
                                    </div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Filed On</p>
                                    <p className="text-[11px] font-medium text-brand-navy/80">{format(new Date(selectedDemand.created_at), 'MMM dd, yyyy')}</p>
                                </div>
                            </div>

                            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto flex-1">
                                {/* Left column: submission + attachments */}
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Your Submission</p>
                                        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                                            <p className="text-[11px] text-brand-navy/80 leading-relaxed whitespace-pre-wrap">{selectedDemand.content}</p>
                                        </div>
                                    </div>

                                    {resolvedMedia.length > 0 && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center gap-1.5">
                                                <Paperclip className="w-3 h-3 text-gray-400" />
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">
                                                    Attachments ({resolvedMedia.length})
                                                </p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {resolvedMedia.map((m, idx) => {
                                                    const isImage = m.type?.startsWith('image/');
                                                    const isVideo = m.type?.startsWith('video/');
                                                    return (
                                                        <div
                                                            key={`${m.path}-${idx}`}
                                                            className="group relative rounded-lg bg-white border border-gray-100 overflow-hidden"
                                                        >
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
                                                                    <p className="text-[10px] font-medium text-gray-600 truncate" title={m.name}>{m.name}</p>
                                                                    <p className="text-[9px] text-gray-400">{formatFileSize(m.size)}</p>
                                                                </div>
                                                                <a
                                                                    href={m.url}
                                                                    download={m.name}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 shrink-0"
                                                                >
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

                                {/* Right column: admin response */}
                                <div className="space-y-1.5">
                                    <AnimatePresence>
                                        {selectedDemand.admin_response ? (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="space-y-2"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-brand-navy">Admin Response</p>
                                                    <p className="text-[9px] text-gray-400">{format(new Date(selectedDemand.responded_at!), 'MMM dd, HH:mm')}</p>
                                                </div>
                                                <div className="p-3.5 rounded-xl bg-brand-navy/[0.03] border border-brand-navy/10 relative">
                                                    <AlertCircle className="absolute top-3 right-3 w-4 h-4 text-brand-navy/20" />
                                                    <p className="text-[11px] text-brand-navy/80 leading-relaxed whitespace-pre-wrap">{selectedDemand.admin_response}</p>

                                                    {resolvedResponseMedia.length > 0 && (
                                                        <div className="mt-3.5 pt-3.5 border-t border-brand-navy/10 space-y-2">
                                                            <div className="flex items-center gap-1.5">
                                                                <Paperclip className="w-3 h-3 text-brand-navy/50" />
                                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-brand-navy/60">
                                                                    Admin attachments ({resolvedResponseMedia.length})
                                                                </p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {resolvedResponseMedia.map((m, idx) => {
                                                                    const isImage = m.type?.startsWith('image/');
                                                                    const isVideo = m.type?.startsWith('video/');
                                                                    return (
                                                                        <div key={`${m.path}-${idx}`} className="group relative rounded-lg bg-white border border-brand-navy/10 overflow-hidden">
                                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                                <div className="aspect-video bg-white flex items-center justify-center overflow-hidden">
                                                                                    {isImage ? (
                                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                                    ) : isVideo ? (
                                                                                        <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                                    ) : (
                                                                                        <Paperclip className="w-5 h-5 text-brand-navy/20" />
                                                                                    )}
                                                                                </div>
                                                                            </a>
                                                                            <div className="p-1.5 flex items-center justify-between gap-1.5 border-t border-brand-navy/5">
                                                                                <p className="text-[9px] font-medium text-gray-600 truncate flex-1" title={m.name}>{m.name}</p>
                                                                                <a
                                                                                    href={m.url}
                                                                                    download={m.name}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="w-5 h-5 rounded flex items-center justify-center text-brand-navy/50 hover:bg-brand-navy/10 shrink-0"
                                                                                >
                                                                                    <Download className="w-3 h-3" />
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
                                                        <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-[0.12em]">Verified Resolution</p>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <div className="border border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center text-center">
                                                <Clock className="w-6 h-6 text-gray-400 mb-2" />
                                                <p className="text-[11px] font-medium text-gray-400">Waiting for administrative review.</p>
                                                <p className="text-[10px] text-gray-300 mt-1">You will be notified when an admin replies.</p>
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
    );
};

export default SellerDemands;

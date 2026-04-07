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
    Search,
    Filter,
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
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header Area */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Demands Hub</h1>
                            <p className="text-gray-500 font-light">Submit your requests and track administrative resolutions.</p>
                        </div>
                        <Button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-14 px-8 rounded-2xl transition-all active:scale-95 group"
                        >
                            <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                            New Request
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Pending', count: demands.filter(d => d.status === 'pending').length, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'In Progress', count: demands.filter(d => d.status === 'in_progress').length, color: 'text-blue-600', bg: 'bg-blue-50' },
                    { label: 'Resolved', count: demands.filter(d => d.status === 'resolved').length, color: 'text-green-600', bg: 'bg-green-50' },
                    { label: 'Total Files', count: demands.length, color: 'text-gray-900', bg: 'bg-gray-100' }
                ].map((stat, i) => (
                    <Card key={i} className="border-0 shadow-sm rounded-2xl overflow-hidden">
                        <CardContent className="p-4 flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{stat.label}</p>
                                <p className={`text-2xl font-light ${stat.color}`}>{stat.count}</p>
                            </div>
                            <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center`}>
                                <FileText className={`w-5 h-5 ${stat.color}`} />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Demands List */}
            <Card className="border-0 shadow-2xl rounded-[2rem] overflow-hidden bg-white">
                <CardHeader className="p-8 border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl font-light text-gray-900">Request History</CardTitle>
                            <CardDescription className="font-light">Direct line to platform administration</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 px-4 py-1 font-light">
                                Authenticated Channel
                            </Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto text-left">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-left border-b border-gray-50/50 bg-gray-50/30">
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Category</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Subject</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Priority</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Status</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Requested On</th>
                                    <th className="p-6"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="p-20 text-center">
                                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
                                        </td>
                                    </tr>
                                ) : demands.length > 0 ? (
                                    demands.map((d) => {
                                        const StatusIcon = getStatusConfig(d.status).icon;
                                        const CategoryIcon = getCategoryIcon(d.category);
                                        return (
                                            <tr key={d.id} className="group hover:bg-gray-50/50 transition-colors duration-300">
                                                <td className="p-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-xl border border-gray-100 bg-white flex items-center justify-center shadow-sm">
                                                            <CategoryIcon className="w-4 h-4 text-gray-500" />
                                                        </div>
                                                        <span className="text-xs uppercase tracking-wider text-gray-400 font-bold">{d.category}</span>
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <p className="text-sm font-medium text-gray-900 leading-tight line-clamp-1">{d.subject}</p>
                                                    <p className="text-[10px] text-gray-400 mt-1">ID: {d.id.slice(0, 8).toUpperCase()}</p>
                                                </td>
                                                <td className="p-6">
                                                    <span className={`text-[10px] uppercase tracking-widest ${getPriorityColor(d.priority)}`}>
                                                        {d.priority}
                                                    </span>
                                                </td>
                                                <td className="p-6">
                                                    <Badge className={`${getStatusConfig(d.status).color} border px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center w-fit gap-2`}>
                                                        <StatusIcon className="w-3 h-3" />
                                                        {getStatusConfig(d.status).label}
                                                    </Badge>
                                                </td>
                                                <td className="p-6">
                                                    <p className="text-xs text-gray-500 font-light">
                                                        {format(new Date(d.created_at), 'MMM dd, yyyy')}
                                                    </p>
                                                </td>
                                                <td className="p-6 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            setSelectedDemand(d);
                                                            setIsViewModalOpen(true);
                                                        }}
                                                        className="w-10 h-10 rounded-xl hover:bg-white hover:shadow-md transition-all text-gray-400 hover:text-primary"
                                                    >
                                                        <ChevronRight className="w-4 h-4" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="p-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-gray-400 font-light">
                                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                                    <MessageSquare className="w-8 h-8 text-gray-200" />
                                                </div>
                                                <p className="text-lg">No active requests found.</p>
                                                <p className="text-sm opacity-60 mt-1">Your demands will be listed here for tracking.</p>
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
                <DialogContent className="max-w-4xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-white flex flex-col max-h-[92vh]">
                    <DialogHeader className="px-10 pt-10 pb-6 shrink-0">
                        <DialogTitle className="text-3xl font-extralight text-gray-900">New Support Request</DialogTitle>
                        <DialogDescription className="font-light">Briefly describe your issue and its priority.</DialogDescription>
                    </DialogHeader>
                    <div className="px-10 pb-6 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto flex-1">
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Topic Category</label>
                                <Select
                                    value={newDemand.category}
                                    onValueChange={(val) => setNewDemand(prev => ({ ...prev, category: val }))}
                                >
                                    <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-gray-50/50">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border-gray-100">
                                        <SelectItem value="general">General Inquiry</SelectItem>
                                        <SelectItem value="payment">Payment Issue</SelectItem>
                                        <SelectItem value="order">Order Correction</SelectItem>
                                        <SelectItem value="account">Account Settings</SelectItem>
                                        <SelectItem value="technical">Technical Bug</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Priority Level</label>
                                <Select
                                    value={newDemand.priority}
                                    onValueChange={(val) => setNewDemand(prev => ({ ...prev, priority: val }))}
                                >
                                    <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-gray-50/50">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border-gray-100">
                                        <SelectItem value="low">Low (Routine)</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="high">High (Urgent)</SelectItem>
                                        <SelectItem value="urgent">Critical (Blocker)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Request Subject</label>
                            <Input
                                placeholder="I have a question about my latest payout..."
                                className="h-12 rounded-2xl border-gray-100 bg-gray-50/50 focus:ring-primary/10"
                                value={newDemand.subject}
                                onChange={(e) => setNewDemand(prev => ({ ...prev, subject: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Detailed Explanation</label>
                            <Textarea
                                placeholder="Please provide as much detail as possible to help us resolve this quickly."
                                className="min-h-[180px] rounded-2xl border-gray-100 bg-gray-50/50 focus:ring-primary/10 resize-none p-4"
                                value={newDemand.content}
                                onChange={(e) => setNewDemand(prev => ({ ...prev, content: e.target.value }))}
                            />
                        </div>
                      </div>

                      {/* Right column: attachments */}
                      <div className="space-y-6">
                        {/* Drag & drop media uploader */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between ml-1">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Attachments</label>
                                <span className="text-[10px] text-gray-400 font-light">Images, videos, PDF · max 50MB each</span>
                            </div>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                                    isDragging
                                        ? 'border-primary bg-primary/5 scale-[1.01]'
                                        : 'border-gray-200 bg-gray-50/50 hover:border-primary/40 hover:bg-primary/[0.02]'
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
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                                        isDragging ? 'bg-primary/10 text-primary' : 'bg-white text-gray-400 shadow-sm'
                                    }`}>
                                        <UploadCloud className="w-6 h-6" />
                                    </div>
                                    <p className="text-sm font-medium text-gray-700">
                                        {isDragging ? 'Drop files to attach' : 'Drag & drop, or click to browse'}
                                    </p>
                                    <p className="text-[10px] text-gray-400 font-light">Screenshots help us resolve issues faster</p>
                                </div>
                            </div>

                            {pendingFiles.length > 0 && (
                                <div className="space-y-2 pt-2">
                                    {pendingFiles.map((file, idx) => {
                                        const isImage = file.type.startsWith('image/');
                                        const isVideo = file.type.startsWith('video/');
                                        const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                                        const previewUrl = isImage ? URL.createObjectURL(file) : null;
                                        return (
                                            <div
                                                key={`${file.name}-${idx}`}
                                                className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50/70 border border-gray-100 group"
                                            >
                                                <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                                    {previewUrl ? (
                                                        <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Icon className="w-4 h-4 text-gray-400" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium text-gray-800 truncate">{file.name}</p>
                                                    <p className="text-[10px] text-gray-400">{formatFileSize(file.size)}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                                    disabled={submitting}
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {submitting && pendingFiles.length > 0 && (
                                <div className="pt-2">
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-300"
                                            style={{ width: `${uploadProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1 text-center">Uploading {uploadProgress}%</p>
                                </div>
                            )}
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="px-10 py-6 bg-white border-t border-gray-50 shrink-0">
                        <Button
                            className="w-full bg-primary hover:bg-primary/90 text-white h-14 rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95 text-lg font-light"
                            onClick={handleCreateDemand}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                            ) : (
                                <>
                                    <Send className="w-5 h-5 mr-3" />
                                    File Request
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Demand Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-5xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-gray-50 flex flex-col max-h-[92vh]">
                    {selectedDemand && (
                        <>
                            <div className="relative p-8 bg-white shrink-0 border-b border-gray-50">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
                                <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
                                    <div className="flex items-center gap-5">
                                        <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                                            {React.createElement(getCategoryIcon(selectedDemand.category), {
                                                className: "w-7 h-7 text-gray-400"
                                            })}
                                        </div>
                                        <div className="min-w-0">
                                            <Badge className={`${getStatusConfig(selectedDemand.status).color} border px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-2 mb-2`}>
                                                {getStatusConfig(selectedDemand.status).label}
                                            </Badge>
                                            <h2 className="text-2xl font-light text-gray-900 leading-tight">{selectedDemand.subject}</h2>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Filed On</p>
                                        <p className="text-sm font-medium text-gray-600">{format(new Date(selectedDemand.created_at), 'MMMM dd, yyyy')}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto flex-1">
                                {/* Left column: submission + attachments */}
                                <div className="space-y-6">
                                    <div className="space-y-3">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Your Submission</p>
                                        <div className="p-6 rounded-3xl bg-white border border-gray-100 shadow-sm">
                                            <p className="text-gray-700 font-light leading-relaxed whitespace-pre-wrap">{selectedDemand.content}</p>
                                        </div>
                                    </div>

                                    {resolvedMedia.length > 0 && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 ml-1">
                                                <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                                                    Attachments ({resolvedMedia.length})
                                                </p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {resolvedMedia.map((m, idx) => {
                                                    const isImage = m.type?.startsWith('image/');
                                                    const isVideo = m.type?.startsWith('video/');
                                                    return (
                                                        <div
                                                            key={`${m.path}-${idx}`}
                                                            className="group relative rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all"
                                                        >
                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                                                    {isImage ? (
                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                                                    ) : isVideo ? (
                                                                        <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                    ) : (
                                                                        <Paperclip className="w-8 h-8 text-gray-300" />
                                                                    )}
                                                                </div>
                                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                                    <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center">
                                                                        <ExternalLink className="w-4 h-4 text-gray-900" />
                                                                    </div>
                                                                </div>
                                                            </a>
                                                            <div className="p-2.5 border-t border-gray-50 flex items-center justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <p className="text-[11px] font-medium text-gray-700 truncate" title={m.name}>{m.name}</p>
                                                                    <p className="text-[9px] text-gray-400">{formatFileSize(m.size)}</p>
                                                                </div>
                                                                <a
                                                                    href={m.url}
                                                                    download={m.name}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
                                                                >
                                                                    <Download className="w-3.5 h-3.5" />
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
                                <div className="space-y-3">
                                    <AnimatePresence>
                                        {selectedDemand.admin_response ? (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="space-y-3"
                                            >
                                                <div className="flex items-center justify-between ml-1">
                                                    <p className="text-[10px] uppercase tracking-widest font-bold text-primary">Official Admin Response</p>
                                                    <p className="text-[10px] text-gray-400">{format(new Date(selectedDemand.responded_at!), 'MMM dd, HH:mm')}</p>
                                                </div>
                                                <div className="p-7 rounded-[2rem] bg-primary/5 border border-primary/10 shadow-inner relative">
                                                    <AlertCircle className="absolute top-4 right-4 w-5 h-5 text-primary/20" />
                                                    <p className="text-gray-900 font-medium leading-relaxed whitespace-pre-wrap">{selectedDemand.admin_response}</p>

                                                    {resolvedResponseMedia.length > 0 && (
                                                        <div className="mt-5 pt-5 border-t border-primary/10 space-y-2">
                                                            <div className="flex items-center gap-2">
                                                                <Paperclip className="w-3.5 h-3.5 text-primary/60" />
                                                                <p className="text-[10px] uppercase tracking-widest font-bold text-primary/70">
                                                                    Admin attachments ({resolvedResponseMedia.length})
                                                                </p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {resolvedResponseMedia.map((m, idx) => {
                                                                    const isImage = m.type?.startsWith('image/');
                                                                    const isVideo = m.type?.startsWith('video/');
                                                                    return (
                                                                        <div key={`${m.path}-${idx}`} className="group relative rounded-xl bg-white border border-primary/10 overflow-hidden">
                                                                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                                                                <div className="aspect-video bg-white flex items-center justify-center overflow-hidden">
                                                                                    {isImage ? (
                                                                                        <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                                                                    ) : isVideo ? (
                                                                                        <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                                                                    ) : (
                                                                                        <Paperclip className="w-6 h-6 text-primary/30" />
                                                                                    )}
                                                                                </div>
                                                                            </a>
                                                                            <div className="p-2 flex items-center justify-between gap-2 border-t border-primary/5">
                                                                                <p className="text-[10px] font-medium text-gray-700 truncate flex-1" title={m.name}>{m.name}</p>
                                                                                <a
                                                                                    href={m.url}
                                                                                    download={m.name}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="w-6 h-6 rounded-md flex items-center justify-center text-primary/60 hover:bg-primary/10 shrink-0"
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

                                                    <div className="mt-6 flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                            <CheckCircle2 className="w-4 h-4 text-primary" />
                                                        </div>
                                                        <p className="text-xs font-bold text-primary uppercase tracking-tighter">Verified Resolution</p>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <div className="h-full min-h-[200px] p-8 rounded-[2rem] bg-gray-100/50 border border-dashed border-gray-200 flex flex-col items-center justify-center text-center">
                                                <Clock className="w-6 h-6 text-gray-300 mb-2" />
                                                <p className="text-sm text-gray-400 font-light">Waiting for administrative review.</p>
                                                <p className="text-xs text-gray-300 font-light mt-1">You will be notified here when an admin replies.</p>
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

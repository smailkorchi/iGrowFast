import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Filter,
  ChevronRight,
  Send,
  User,
  ArrowRight,
  MessageCircle,
  UserCircle,
  BadgeAlert,
  Timer,
  Info,
  Paperclip,
  Image as ImageIcon,
  Film,
  FileText,
  Download,
  ExternalLink,
  UploadCloud,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';

interface DemandMedia {
  path: string;
  name: string;
  type: string;
  size: number;
  /** Resolved at view time via signed URL. */
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
  };
}

const TABLE_FOR: Record<DemandRole, string> = {
  seller: 'seller_demands',
  mediabuyer: 'mediabuyer_demands',
};

const FK_COL_FOR: Record<DemandRole, string> = {
  seller: 'seller_id',
  mediabuyer: 'mediabuyer_id',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_TYPES = 'image/*,video/*,application/pdf';

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Response State
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
        .select('*, collaborator:users(name, email, avatar_url)')
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
        title: "Error",
        description: `Failed to load ${role === 'seller' ? 'seller' : 'media buyer'} requests.`,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Resolve signed URLs for the selected demand's media (private bucket)
  useEffect(() => {
    let cancelled = false;
    const resolveList = async (list: DemandMedia[] | null | undefined): Promise<DemandMedia[]> => {
      if (!list || list.length === 0) return [];
      const paths = list.map((m) => m.path).filter(Boolean);
      if (paths.length === 0) return [];
      const { data, error } = await supabase.storage
        .from('demand-media')
        .createSignedUrls(paths, 60 * 60); // 1h
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

  const formatFileSizeLocal = (bytes: number) => formatFileSize(bytes);

  const addResponseFiles = useCallback((files: File[]) => {
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
    if (valid.length) setResponseFiles(prev => [...prev, ...valid]);
  }, [toast]);

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
    setResponseFiles(prev => prev.filter((_, i) => i !== index));
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
          upsert: false
        });
      if (upErr) throw upErr;
      uploaded.push({
        path,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size
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
        updated_at: new Date().toISOString()
      };

      if (adminResponse.trim()) {
        updates.admin_response = adminResponse;
        updates.responded_at = new Date().toISOString();
      }

      // Upload any new response attachments and append to existing list
      if (responseFiles.length > 0) {
        const newMedia = await uploadResponseMedia(selectedDemand.id);
        const existing = (selectedDemand.admin_response_media || []) as DemandMedia[];
        updates.admin_response_media = [...existing, ...newMedia];
        if (!updates.responded_at) updates.responded_at = new Date().toISOString();
      }

      const { error } = await (supabase as any)
        .from(TABLE_FOR[role])
        .update(updates)
        .eq('id', selectedDemand.id);

      if (error) throw error;

      toast({
        title: "Demand Updated",
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
        title: "Update Failed",
        description: "Could not sync changes to the database.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':
        return { color: 'bg-amber-50 text-amber-600 border-amber-100', icon: Clock, label: 'Pending' };
      case 'in_progress':
        return { color: 'bg-blue-50 text-blue-600 border-blue-100', icon: Timer, label: 'In Progress' };
      case 'resolved':
        return { color: 'bg-green-50 text-green-600 border-green-100', icon: CheckCircle2, label: 'Resolved' };
      case 'dismissed':
        return { color: 'bg-red-50 text-red-600 border-red-100', icon: XCircle, label: 'Dismissed' };
      default:
        return { color: 'bg-gray-50 text-gray-600 border-gray-100', icon: Info, label: status };
    }
  };

  const getPriorityConfig = (priority: string) => {
    switch (priority) {
      case 'low': return { label: 'Low', color: 'bg-gray-50 text-gray-500 border-gray-100' };
      case 'medium': return { label: 'Medium', color: 'bg-blue-50 text-blue-500 border-blue-100' };
      case 'high': return { label: 'High Priority', color: 'bg-orange-50 text-orange-600 border-orange-100 font-bold' };
      case 'urgent': return { label: 'CRITICAL', color: 'bg-red-50 text-red-600 border-red-200 font-bold animate-pulse' };
      default: return { label: priority, color: 'bg-gray-50 text-gray-500' };
    }
  };

  const filteredDemands = demands.filter(d => {
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchesSearch = d.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.collaborator?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const resolvedCount = demands.filter(d => d.status === 'resolved').length;
  const openCount = demands.filter(d => d.status === 'pending' || d.status === 'in_progress').length;
  const responseRate = demands.length > 0 ? ((resolvedCount / demands.length) * 100).toFixed(0) : '0';

  const STATUS_PILLS = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'dismissed', label: 'Dismissed' },
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Demands</h1>
          <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
            {role === 'seller' ? 'Seller' : 'Media Buyer'} Support Requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Role toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-md">
            {(['seller', 'mediabuyer'] as DemandRole[]).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`h-7 px-3 rounded-[4px] text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  role === r
                    ? 'bg-brand-navy text-white'
                    : 'text-gray-500 hover:text-brand-navy hover:bg-gray-50'
                }`}
              >
                {r === 'seller' ? 'Sellers' : 'Media Buyers'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: 'Total Requests', value: demands.length, accent: '#1e3a5f' },
          { label: 'Open Tickets', value: openCount, accent: '#d97706' },
          { label: 'Response Rate', value: `${responseRate}%`, accent: '#16a34a' },
        ].map((s) => (
          <div key={s.label} className="flex items-stretch bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
            <div className="w-[3px] self-stretch rounded-full shrink-0" style={{ backgroundColor: s.accent }} />
            <div className="flex flex-col justify-center px-3 py-2.5 gap-0.5">
              <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold">{s.label}</p>
              <p className="text-[15px] font-bold text-brand-navy leading-none">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            placeholder={`Search by subject or ${role === 'seller' ? 'seller' : 'media buyer'} name...`}
            className="pl-8 h-8 rounded-md border-gray-200 text-[11px] bg-white"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          {STATUS_PILLS.map((p) => (
            <button
              key={p.id}
              onClick={() => setStatusFilter(p.id)}
              className={`h-7 px-2.5 rounded-[4px] text-[10px] font-semibold transition-colors ${
                statusFilter === p.id
                  ? 'bg-brand-navy text-white'
                  : 'text-gray-500 hover:text-brand-navy hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-navy" />
        </div>
      )}

      {/* Empty */}
      {!loading && filteredDemands.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-gray-300" />
          </div>
          <p className="text-[11px] text-gray-400 font-medium">No demands found</p>
        </div>
      )}

      {/* Demand Cards Grid */}
      {!loading && filteredDemands.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredDemands.map((d) => {
            const statusCfg = getStatusConfig(d.status);
            const priorityCfg = getPriorityConfig(d.priority);
            return (
              <div
                key={d.id}
                className="flex flex-col bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden"
              >
                {/* Card Header */}
                <div className="px-3 py-2.5 border-b border-gray-50 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-6 w-6 shrink-0 rounded-full">
                      <AvatarImage src={d.collaborator?.avatar_url || ''} />
                      <AvatarFallback className="text-[9px] bg-gray-100 text-gray-500">
                        {d.collaborator?.name?.charAt(0)?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-800 truncate">{d.collaborator?.name || 'Unknown'}</p>
                      <p className="text-[9px] text-gray-400 font-mono">#{d.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                  </div>
                  <Badge className={`h-5 px-1.5 text-[9px] font-semibold uppercase tracking-wider border rounded shrink-0 ${statusCfg.color}`}>
                    {statusCfg.label}
                  </Badge>
                </div>

                {/* Card Body */}
                <div className="px-3 py-2.5 flex-1 flex flex-col gap-2">
                  <p className="text-[12px] font-semibold text-gray-800 line-clamp-2 leading-snug">{d.subject}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`h-5 px-1.5 text-[9px] border rounded ${priorityCfg.color}`}>
                      {priorityCfg.label}
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px] border border-gray-100 text-gray-400 rounded uppercase">
                      {d.category}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
                    {d.content}
                  </p>
                </div>

                {/* Card Footer */}
                <div className="px-3 py-2 border-t border-gray-50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-[9px] text-gray-400 uppercase tracking-[0.12em] font-semibold">
                    <Clock className="w-3 h-3" />
                    {format(new Date(d.created_at), 'MMM dd, HH:mm')}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedDemand(d);
                      setNewStatus(d.status);
                      setAdminResponse(d.admin_response || '');
                      setIsResponseModalOpen(true);
                    }}
                    className="h-7 px-2.5 rounded-md text-[10px] font-semibold border-gray-200"
                  >
                    Take Action
                    <ChevronRight className="w-3 h-3 ml-1" />
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
        <DialogContent className="max-w-2xl p-0 border border-gray-100 overflow-hidden rounded-xl bg-white flex flex-col max-h-[92vh] shadow-none">
          {selectedDemand && (
            <div className="overflow-y-auto text-left">
              {/* Modal Header */}
              <div className="px-4 py-3 border-b border-gray-100">
                <DialogHeader>
                  <div className="flex items-start gap-2.5">
                    <Avatar className="h-6 w-6 shrink-0 rounded-full">
                      <AvatarImage src={selectedDemand.collaborator?.avatar_url || ''} />
                      <AvatarFallback className="text-[9px] bg-gray-100 text-gray-500">
                        {selectedDemand.collaborator?.name?.charAt(0)?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <DialogTitle className="text-[13px] font-semibold text-brand-navy leading-snug line-clamp-2">
                        {selectedDemand.subject}
                      </DialogTitle>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {selectedDemand.collaborator?.name} · {selectedDemand.collaborator?.email}
                      </p>
                    </div>
                  </div>
                </DialogHeader>
              </div>

              <div className="px-4 py-3 space-y-4">
                {/* Demand Content */}
                <div>
                  <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-1.5 flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" /> Request Content
                  </p>
                  <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                    <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {selectedDemand.content}
                    </p>
                  </div>
                </div>

                {/* Attached Media */}
                {resolvedMedia && resolvedMedia.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-1.5 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> Attachments ({resolvedMedia.length})
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {resolvedMedia.map((m, idx) => {
                        const isImage = m.type?.startsWith('image/');
                        const isVideo = m.type?.startsWith('video/');
                        const isPdf = m.type === 'application/pdf';
                        return (
                          <div
                            key={`${m.path}-${idx}`}
                            className="group relative rounded-xl bg-white border border-gray-100 overflow-hidden"
                          >
                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                              <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                {isImage ? (
                                  <img src={m.url} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                ) : isVideo ? (
                                  <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                ) : (
                                  <div className="flex flex-col items-center gap-1 text-gray-300">
                                    {isPdf ? <FileText className="w-8 h-8" /> : <Paperclip className="w-8 h-8" />}
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center">
                                  <ExternalLink className="w-3.5 h-3.5 text-gray-800" />
                                </div>
                              </div>
                            </a>
                            <div className="p-2 border-t border-gray-50 flex items-center justify-between gap-1">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium text-gray-700 truncate" title={m.name}>{m.name}</p>
                                <p className="text-[9px] text-gray-400">{formatFileSize(m.size)}</p>
                              </div>
                              <a
                                href={m.url}
                                download={m.name}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
                                title="Download"
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

                {/* Status Selector */}
                <div>
                  <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-1.5">Resolution Status</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                    {[
                      { id: 'pending', label: 'Pending', icon: Clock, active: 'border-amber-400 bg-amber-50 text-amber-600', idle: 'border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-500' },
                      { id: 'in_progress', label: 'Processing', icon: Timer, active: 'border-blue-400 bg-blue-50 text-blue-600', idle: 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500' },
                      { id: 'resolved', label: 'Resolved', icon: CheckCircle2, active: 'border-green-400 bg-green-50 text-green-600', idle: 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-500' },
                      { id: 'dismissed', label: 'Dismissed', icon: XCircle, active: 'border-red-400 bg-red-50 text-red-600', idle: 'border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500' }
                    ].map((choice) => (
                      <button
                        key={choice.id}
                        onClick={() => setNewStatus(choice.id)}
                        className={`flex flex-col items-center justify-center py-2 px-2 rounded-lg border transition-colors gap-1 ${
                          newStatus === choice.id ? choice.active : choice.idle
                        }`}
                      >
                        <choice.icon className="w-4 h-4" />
                        <span className="text-[9px] uppercase tracking-wider font-semibold">{choice.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Admin Response */}
                <div>
                  <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-1.5">Administrative Response</p>
                  <Textarea
                    placeholder="Type your official response here..."
                    className="min-h-[100px] rounded-lg border-gray-200 text-[11px] resize-none"
                    value={adminResponse}
                    onChange={(e) => setAdminResponse(e.target.value)}
                  />
                  <p className="text-[9px] text-gray-400 mt-1">
                    Response will be visible to the collaborator immediately upon update.
                  </p>
                </div>

                {/* Response Attachments */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-semibold">Response Attachments</p>
                    <span className="text-[9px] text-gray-400">Images, videos, PDF · max 50MB each</span>
                  </div>

                  {/* Already-attached response media */}
                  {resolvedResponseMedia.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                      {resolvedResponseMedia.map((m, idx) => {
                        const isImage = m.type?.startsWith('image/');
                        const isVideo = m.type?.startsWith('video/');
                        const isPdf = m.type === 'application/pdf';
                        return (
                          <div key={`${m.path}-${idx}`} className="group relative rounded-xl bg-white border border-gray-100 overflow-hidden">
                            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                              <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                {isImage ? (
                                  <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                ) : isVideo ? (
                                  <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                ) : (
                                  <FileText className="w-8 h-8 text-gray-300" />
                                )}
                              </div>
                            </a>
                            <div className="p-2 border-t border-gray-50 flex items-center justify-between gap-1">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium text-gray-700 truncate" title={m.name}>{m.name}</p>
                                <p className="text-[9px] text-gray-400">{formatFileSizeLocal(m.size)}</p>
                              </div>
                              <a
                                href={m.url}
                                download={m.name}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
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
                    onDragOver={(e) => { e.preventDefault(); setResponseDragging(true); }}
                    onDragEnter={(e) => { e.preventDefault(); setResponseDragging(true); }}
                    onDragLeave={() => setResponseDragging(false)}
                    onDrop={handleResponseDrop}
                    onClick={() => responseInputRef.current?.click()}
                    className={`relative cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-all ${
                      responseDragging
                        ? 'border-brand-navy bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <input
                      ref={responseInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED_TYPES}
                      className="hidden"
                      onChange={handleResponseFileInput}
                    />
                    <div className="flex flex-col items-center gap-1.5 pointer-events-none">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        responseDragging ? 'bg-brand-navy/10 text-brand-navy' : 'bg-gray-50 text-gray-400'
                      }`}>
                        <UploadCloud className="w-4 h-4" />
                      </div>
                      <p className="text-[11px] font-medium text-gray-600">
                        {responseDragging ? 'Drop files to attach' : 'Drag & drop, or click to browse'}
                      </p>
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
                          <div key={`${file.name}-${idx}`} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="w-8 h-8 rounded-md bg-white border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                              {previewUrl ? (
                                <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                              ) : (
                                <Icon className="w-3.5 h-3.5 text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-gray-800 truncate">{file.name}</p>
                              <p className="text-[9px] text-gray-400">{formatFileSizeLocal(file.size)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeResponseFile(idx); }}
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

                  {submitting && responseFiles.length > 0 && (
                    <div className="mt-2">
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-navy transition-all duration-300" style={{ width: `${responseUploadProgress}%` }} />
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1 text-center">Uploading {responseUploadProgress}%</p>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="px-4 py-3 border-t border-gray-100">
                <div className="flex items-center gap-2 w-full justify-end">
                  <Button
                    variant="outline"
                    className="h-8 px-3 rounded-md border-gray-200 text-[11px] font-semibold text-gray-600"
                    onClick={() => setIsResponseModalOpen(false)}
                  >
                    Discard
                  </Button>
                  <Button
                    className="h-8 px-3 rounded-md bg-brand-navy hover:bg-brand-navy/90 text-white text-[11px] font-semibold"
                    onClick={handleUpdateDemand}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        Sync & Update
                      </>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Demands;

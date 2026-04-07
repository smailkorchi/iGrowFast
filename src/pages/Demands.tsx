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

interface SellerDemandWithSeller {
  id: string;
  seller_id: string;
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
  seller: {
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_TYPES = 'image/*,video/*,application/pdf';

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const Demands = () => {
  const { toast } = useToast();
  const [demands, setDemands] = useState<SellerDemandWithSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDemand, setSelectedDemand] = useState<SellerDemandWithSeller | null>(null);
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
  }, [activeBusinessId]);

  const fetchDemands = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('seller_demands')
        .select('*, seller:users(name, email, avatar_url)')
        .order('created_at', { ascending: false });

      if (activeBusinessId) {
        query = query.eq('DigiCom Business', activeBusinessId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setDemands((data as unknown as SellerDemandWithSeller[]) || []);
    } catch (error) {
      console.error('Error fetching demands:', error);
      toast({
        title: "Error",
        description: "Failed to load seller requests.",
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

      const { error } = await supabase
        .from('seller_demands')
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
      d.seller?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Header Area */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 text-left">
            <div>
              <h1 className="text-4xl font-extralight text-gray-900 mb-2">Seller Demands</h1>
              <p className="text-gray-500 font-light">Direct administrative oversight of seller specialized requests.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-white/50 backdrop-blur-sm border border-white p-2 rounded-2xl flex items-center gap-4 px-6 shadow-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Response Rate</p>
                  <p className="text-xl font-light text-primary">
                    {demands.length > 0 ? ((demands.filter(d => d.status === 'resolved').length / demands.length) * 100).toFixed(0) : 0}%
                  </p>
                </div>
                <div className="w-px h-8 bg-gray-100" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Open Tickets</p>
                  <p className="text-xl font-light text-amber-600">
                    {demands.filter(d => d.status === 'pending' || d.status === 'in_progress').length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[300px] group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Search by subject or seller name..."
            className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 h-12 rounded-2xl border-gray-100 bg-white">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl border-gray-100">
            <SelectItem value="all">All Records</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredDemands.map((d) => {
            const statusCfg = getStatusConfig(d.status);
            const priorityCfg = getPriorityConfig(d.priority);
            return (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Card className="border-0 shadow-lg rounded-[2rem] bg-white group hover:shadow-2xl transition-all duration-500 overflow-hidden text-left h-full flex flex-col">
                  <div className="p-6 pb-4 border-b border-gray-50 bg-gradient-to-tr from-gray-50/50 to-transparent">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-12 h-12 rounded-2xl border-2 border-white shadow-sm ring-1 ring-gray-100">
                          <AvatarImage src={d.seller?.avatar_url || ''} />
                          <AvatarFallback className="bg-primary/5 text-primary">
                            {d.seller?.name?.charAt(0)?.toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-gray-900 line-clamp-1">{d.seller?.name || 'Unknown'}</p>
                          <p className="text-[10px] text-gray-400 font-mono tracking-tighter">#{d.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                      </div>
                      <Badge className={`${statusCfg.color} border px-2 py-0.5 rounded-lg text-[10px] uppercase tracking-widest font-bold`}>
                        {statusCfg.label}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-light text-gray-900 line-clamp-2 min-h-[3.5rem] leading-tight group-hover:text-primary transition-colors">
                      {d.subject}
                    </h3>
                  </div>
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="outline" className={`${priorityCfg.color} text-[10px] py-0.5 px-3 rounded-full border`}>
                        {priorityCfg.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] py-0.5 px-3 rounded-full uppercase border-gray-100 text-gray-400 font-light">
                        {d.category}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 font-light line-clamp-3 mb-6 italic">
                      "{d.content}"
                    </p>
                    <div className="mt-auto pt-4 flex items-center justify-between border-t border-gray-50">
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                        <Clock className="w-3 h-3" />
                        {format(new Date(d.created_at), 'MMM dd, HH:mm')}
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedDemand(d);
                          setNewStatus(d.status);
                          setAdminResponse(d.admin_response || '');
                          setIsResponseModalOpen(true);
                        }}
                        className="h-10 rounded-xl px-4 text-xs font-light hover:bg-gray-900 hover:text-white transition-all overflow-hidden relative group/btn"
                      >
                        <span className="relative z-10 group-hover/btn:translate-x-1 duration-300">Take Action</span>
                        <ChevronRight className="w-3 h-3 ml-2 group-hover/btn:translate-x-1 duration-300" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

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
        <DialogContent className="max-w-2xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-gray-50 flex flex-col max-h-[92vh]">
          {selectedDemand && (
            <div className="overflow-y-auto scrollbar-hide text-left">
              <div className="relative p-10 bg-white shadow-sm">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
                <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
                  <div className="flex items-start gap-6">
                    <Avatar className="w-16 h-16 rounded-[1.5rem] border-2 border-white shadow-lg ring-1 ring-gray-100">
                      <AvatarImage src={selectedDemand.seller?.avatar_url || ''} />
                      <AvatarFallback className="bg-primary/5 text-primary text-xl">
                        {selectedDemand.seller?.name?.charAt(0)?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className="bg-primary/5 text-primary border-primary/10 rounded-lg text-[10px] uppercase font-bold tracking-widest">
                          Seller Request
                        </Badge>
                        <p className="text-[10px] text-gray-400 font-mono">ID: {selectedDemand.id.toUpperCase()}</p>
                      </div>
                      <h2 className="text-2xl font-light text-gray-900 leading-tight">{selectedDemand.subject}</h2>
                      <p className="text-gray-500 font-medium text-xs mt-1">{selectedDemand.seller?.name} • {selectedDemand.seller?.email}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-10 space-y-8">
                {/* Demand Content Card */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 ml-1">
                    <MessageCircle className="w-4 h-4 text-gray-400" />
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Request Content</p>
                  </div>
                  <div className="p-8 rounded-[2rem] bg-white border border-gray-100 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-gray-50 rounded-full translate-x-1/2 -translate-y-1/2 blur-2xl" />
                    <p className="text-gray-800 font-light leading-relaxed whitespace-pre-wrap relative z-10 italic">
                      "{selectedDemand.content}"
                    </p>
                  </div>
                </div>

                {/* Attached Media */}
                {resolvedMedia && resolvedMedia.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 ml-1">
                      <Paperclip className="w-4 h-4 text-gray-400" />
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                        Attachments ({resolvedMedia.length})
                      </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {resolvedMedia.map((m, idx) => {
                        const isImage = m.type?.startsWith('image/');
                        const isVideo = m.type?.startsWith('video/');
                        const isPdf = m.type === 'application/pdf';
                        return (
                          <div
                            key={`${m.path}-${idx}`}
                            className="group relative rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all"
                          >
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                {isImage ? (
                                  <img
                                    src={m.url}
                                    alt={m.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                  />
                                ) : isVideo ? (
                                  <video
                                    src={m.url}
                                    className="w-full h-full object-cover"
                                    muted
                                    playsInline
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-2 text-gray-400">
                                    {isPdf ? (
                                      <FileText className="w-10 h-10" />
                                    ) : (
                                      <Paperclip className="w-10 h-10" />
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                  <ExternalLink className="w-4 h-4 text-gray-900" />
                                </div>
                              </div>
                            </a>
                            <div className="p-3 border-t border-gray-50 flex items-center justify-between gap-2">
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
                                title="Download"
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

                {/* Action Console */}
                <div className="space-y-8">
                  <div className="space-y-4">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Resolution Status</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { id: 'pending', label: 'Pending', icon: Clock, color: 'hover:border-amber-500 hover:text-amber-500', active: 'border-amber-500 bg-amber-50/50 text-amber-600' },
                        { id: 'in_progress', label: 'Processing', icon: Timer, color: 'hover:border-blue-500 hover:text-blue-500', active: 'border-blue-500 bg-blue-50/50 text-blue-600' },
                        { id: 'resolved', label: 'Resolved', icon: CheckCircle2, color: 'hover:border-green-500 hover:text-green-500', active: 'border-green-500 bg-green-50/50 text-green-600' },
                        { id: 'dismissed', label: 'Dismissed', icon: XCircle, color: 'hover:border-red-500 hover:text-red-500', active: 'border-red-500 bg-red-50/50 text-red-600' }
                      ].map((choice) => (
                        <button
                          key={choice.id}
                          onClick={() => setNewStatus(choice.id)}
                          className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-300 gap-2 group/choice ${newStatus === choice.id
                            ? choice.active
                            : 'border-white bg-white text-gray-400 ' + choice.color
                            }`}
                        >
                          <choice.icon className={`w-5 h-5 ${newStatus === choice.id ? '' : 'opacity-40 group-hover/choice:opacity-100'} transition-opacity`} />
                          <span className="text-[10px] uppercase tracking-widest font-bold">{choice.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Administrative Response</label>
                    <Textarea
                      placeholder="Type your official response to the seller here..."
                      className="min-h-[150px] rounded-[2rem] border-white bg-white shadow-sm focus:ring-primary/10 p-6 text-sm resize-none"
                      value={adminResponse}
                      onChange={(e) => setAdminResponse(e.target.value)}
                    />
                    <p className="text-[10px] text-gray-400 italic mt-2 ml-2">
                      This response will be visible to the seller immediately upon clicking Sync.
                    </p>
                  </div>

                  {/* Response attachments uploader */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Response Attachments</label>
                      <span className="text-[10px] text-gray-400 font-light">Images, videos, PDF · max 50MB each</span>
                    </div>

                    {/* Already-attached response media */}
                    {resolvedResponseMedia.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {resolvedResponseMedia.map((m, idx) => {
                          const isImage = m.type?.startsWith('image/');
                          const isVideo = m.type?.startsWith('video/');
                          const isPdf = m.type === 'application/pdf';
                          return (
                            <div key={`${m.path}-${idx}`} className="group relative rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
                              <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                                <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                                  {isImage ? (
                                    <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                                  ) : isVideo ? (
                                    <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                                  ) : (
                                    <FileText className="w-9 h-9 text-gray-300" />
                                  )}
                                </div>
                              </a>
                              <div className="p-2.5 border-t border-gray-50 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-gray-700 truncate" title={m.name}>{m.name}</p>
                                  <p className="text-[9px] text-gray-400">{formatFileSizeLocal(m.size)}</p>
                                </div>
                                <a
                                  href={m.url}
                                  download={m.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
                                >
                                  <Download className="w-3.5 h-3.5" />
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
                      className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                        responseDragging
                          ? 'border-primary bg-primary/5 scale-[1.01]'
                          : 'border-gray-200 bg-white hover:border-primary/40'
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
                      <div className="flex flex-col items-center gap-2 pointer-events-none">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
                          responseDragging ? 'bg-primary/10 text-primary' : 'bg-gray-50 text-gray-400'
                        }`}>
                          <UploadCloud className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-gray-700">
                          {responseDragging ? 'Drop files to attach' : 'Drag & drop, or click to browse'}
                        </p>
                      </div>
                    </div>

                    {/* Pending files queued for upload */}
                    {responseFiles.length > 0 && (
                      <div className="space-y-2">
                        {responseFiles.map((file, idx) => {
                          const isImage = file.type.startsWith('image/');
                          const isVideo = file.type.startsWith('video/');
                          const Icon = isImage ? ImageIcon : isVideo ? Film : Paperclip;
                          const previewUrl = isImage ? URL.createObjectURL(file) : null;
                          return (
                            <div key={`${file.name}-${idx}`} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-gray-100">
                              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                {previewUrl ? (
                                  <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                                ) : (
                                  <Icon className="w-4 h-4 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{file.name}</p>
                                <p className="text-[10px] text-gray-400">{formatFileSizeLocal(file.size)}</p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeResponseFile(idx); }}
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

                    {submitting && responseFiles.length > 0 && (
                      <div className="pt-1">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${responseUploadProgress}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 text-center">Uploading {responseUploadProgress}%</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter className="p-10 pt-0 bg-gray-50">
                <div className="grid grid-cols-2 w-full gap-4">
                  <Button
                    variant="outline"
                    className="h-14 rounded-2xl border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-light"
                    onClick={() => setIsResponseModalOpen(false)}
                  >
                    Discard Changes
                  </Button>
                  <Button
                    className="h-14 rounded-2xl bg-gray-900 hover:bg-black text-white font-light group shadow-xl shadow-gray-200"
                    onClick={handleUpdateDemand}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                        Sync & Update Seller
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

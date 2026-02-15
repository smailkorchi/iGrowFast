import React, { useState, useEffect } from 'react';
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
  Info
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

interface SellerDemandWithSeller {
  id: string;
  seller_id: string;
  category: string;
  priority: string;
  subject: string;
  content: string;
  status: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  seller: {
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

const Demands = () => {
  const { toast } = useToast();
  const [demands, setDemands] = useState<SellerDemandWithSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDemand, setSelectedDemand] = useState<SellerDemandWithSeller | null>(null);
  const [isResponseModalOpen, setIsResponseModalOpen] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Response State
  const [adminResponse, setAdminResponse] = useState('');
  const [newStatus, setNewStatus] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDemands();
  }, []);

  const fetchDemands = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('seller_demands')
        .select('*, seller:users(name, email, avatar_url)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDemands(data as any || []);
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

  const handleUpdateDemand = async () => {
    if (!selectedDemand) return;

    setSubmitting(true);
    try {
      const updates: any = {
        status: newStatus || selectedDemand.status,
        updated_at: new Date().toISOString()
      };

      if (adminResponse.trim()) {
        updates.admin_response = adminResponse;
        updates.responded_at = new Date().toISOString();
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
      <Dialog open={isResponseModalOpen} onOpenChange={setIsResponseModalOpen}>
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

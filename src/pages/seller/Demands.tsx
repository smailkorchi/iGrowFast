import React, { useState, useEffect } from 'react';
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
    Bug
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

interface SellerDemand {
    id: string;
    category: 'payment' | 'order' | 'account' | 'technical' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    subject: string;
    content: string;
    status: 'pending' | 'in_progress' | 'resolved' | 'dismissed';
    admin_response: string | null;
    responded_at: string | null;
    created_at: string;
    updated_at: string;
}

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
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { error } = await supabase
                .from('seller_demands')
                .insert({
                    seller_id: user.id,
                    ...newDemand,
                    status: 'pending'
                });

            if (error) throw error;

            toast({
                title: "Success",
                description: "Your request has been filed successfully.",
            });
            setIsCreateModalOpen(false);
            setNewDemand({ category: 'general', priority: 'medium', subject: '', content: '' });
            fetchDemands();
        } catch (error) {
            console.error('Error creating demand:', error);
            toast({
                title: "Error",
                description: "Failed to submit request.",
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
            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent className="max-w-xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-white">
                    <DialogHeader className="p-10 pb-6">
                        <DialogTitle className="text-3xl font-extralight text-gray-900">New Support Request</DialogTitle>
                        <DialogDescription className="font-light">Briefly describe your issue and its priority.</DialogDescription>
                    </DialogHeader>
                    <div className="p-10 pt-0 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Topic Category</label>
                                <Select
                                    value={newDemand.category}
                                    onValueChange={(val: any) => setNewDemand(prev => ({ ...prev, category: val }))}
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
                                    onValueChange={(val: any) => setNewDemand(prev => ({ ...prev, priority: val }))}
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
                                className="min-h-[150px] rounded-2xl border-gray-100 bg-gray-50/50 focus:ring-primary/10 resize-none p-4"
                                value={newDemand.content}
                                onChange={(e) => setNewDemand(prev => ({ ...prev, content: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter className="p-10 pt-0 bg-white">
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
                <DialogContent className="max-w-2xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-gray-50 flex flex-col max-h-[92vh]">
                    {selectedDemand && (
                        <div className="overflow-y-auto scrollbar-hide">
                            <div className="relative p-10 bg-white">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
                                <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-16 h-16 bg-gray-50 rounded-[1.5rem] flex items-center justify-center shadow-inner">
                                            {React.createElement(getCategoryIcon(selectedDemand.category), {
                                                className: "w-8 h-8 text-gray-400"
                                            })}
                                        </div>
                                        <div>
                                            <Badge className={`${getStatusConfig(selectedDemand.status).color} border px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 mb-2`}>
                                                {getStatusConfig(selectedDemand.status).label}
                                            </Badge>
                                            <h2 className="text-2xl font-light text-gray-900 leading-tight">{selectedDemand.subject}</h2>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Filed On</p>
                                        <p className="text-sm font-medium text-gray-600">{format(new Date(selectedDemand.created_at), 'MMMM dd, yyyy')}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-10 space-y-8">
                                {/* Seller Message */}
                                <div className="space-y-4">
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Your Submission</p>
                                    <div className="p-6 rounded-3xl bg-white border border-gray-100 shadow-sm">
                                        <p className="text-gray-700 font-light leading-relaxed whitespace-pre-wrap">{selectedDemand.content}</p>
                                    </div>
                                </div>

                                {/* Admin Response Area */}
                                <AnimatePresence>
                                    {selectedDemand.admin_response ? (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="space-y-4"
                                        >
                                            <div className="flex items-center justify-between ml-1">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-primary">Official Admin Response</p>
                                                <p className="text-[10px] text-gray-400">{format(new Date(selectedDemand.responded_at!), 'MMM dd, HH:mm')}</p>
                                            </div>
                                            <div className="p-8 rounded-[2rem] bg-primary/5 border border-primary/10 shadow-inner relative group">
                                                <AlertCircle className="absolute top-4 right-4 w-5 h-5 text-primary/20 group-hover:text-primary/40 transition-colors" />
                                                <p className="text-gray-900 font-medium leading-relaxed whitespace-pre-wrap">{selectedDemand.admin_response}</p>
                                                <div className="mt-6 flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                        <CheckCircle2 className="w-4 h-4 text-primary" />
                                                    </div>
                                                    <p className="text-xs font-bold text-primary uppercase tracking-tighter">Verified Resolution</p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <div className="p-8 rounded-[2rem] bg-gray-100/50 border border-dashed border-gray-200 text-center">
                                            <Clock className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400 font-light">Waiting for administrative review. You will be notified of responses here.</p>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerDemands;

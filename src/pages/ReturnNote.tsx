import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, parseISO } from 'date-fns';
import {
    RotateCcw,
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Eye,
    Building2,
    Truck,
    Calendar,
    Hash,
    CheckCircle2,
    Clock,
    XCircle,
    Download,
    Filter,
    ArrowLeftCircle,
    ChevronRight,
    SearchX,
    PackageMinus,
    Undo2
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from '@/hooks/use-toast';

const ReturnNote = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: companyReturnNotes = [], isLoading: loadingCompany } = useQuery({
        queryKey: ['company-return-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('company_return_notes')
                .select(`
                    *,
                    provider:providers(name),
                    parcels:company_parcels(count),
                    status:status_id(label)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data.map(note => ({
                ...note,
                date: format(parseISO(note.created_at), 'PPP'),
                provider: (note.provider as any)?.name,
                parcels: (note.parcels?.[0] as any)?.count || 0,
                status: (note.status as any)?.label || 'pending'
            })) || [];
        }
    });

    const { data: courierReturnNotes = [], isLoading: loadingCourier } = useQuery({
        queryKey: ['courier-return-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('courier_return_notes')
                .select(`
                    *,
                    courier:users(name),
                    parcels:courier_parcels(count),
                    status:status_id(label)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data.map(note => ({
                ...note,
                date: format(parseISO(note.created_at), 'PPP'),
                courier: (note.courier as any)?.name,
                parcels: (note.parcels?.[0] as any)?.count || 0,
                status: (note.status as any)?.label || 'pending'
            })) || [];
        }
    });

    const isLoading = loadingCompany || loadingCourier;

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Completed</Badge>;
            case 'processing':
                return <Badge className="bg-amber-50 text-amber-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Clock className="w-3 h-3" /> Processing</Badge>;
            case 'pending_pickup':
                return <Badge className="bg-indigo-50 text-indigo-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Truck className="w-3 h-3" /> Pending Pick-up</Badge>;
            default:
                return <Badge className="bg-slate-50 text-slate-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5">{status}</Badge>;
        }
    };

    const renderNoteCard = (note: any, type: 'company' | 'courier') => (
        <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
            <div className={`absolute top-0 left-0 w-full h-1.5 ${type === 'company' ? 'bg-red-500' : 'bg-rose-500'}`} />

            <CardContent className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl ${type === 'company' ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-600'} flex items-center justify-center font-bold`}>
                                <Undo2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-brand-navy tracking-tight">{note.reference}</h3>
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Calendar className="w-3 h-3" />
                                    <span className="text-[10px] font-bold tracking-wider">{note.date}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {getStatusBadge(note.status)}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-500">
                            {type === 'company' ? <Building2 className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">{type === 'company' ? 'Provider' : 'Courier'}</span>
                            <span className="text-xs font-bold text-brand-navy truncate">{note.provider || note.courier}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-500">
                            <PackageMinus className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">Returns</span>
                            <span className="text-xs font-bold text-brand-navy">{note.parcels} units</span>
                        </div>
                    </div>
                </div>

                <Separator className="bg-brand-navy/[0.05]" />

                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSelectedNote(note);
                            setIsViewModalOpen(true);
                        }}
                        className="text-brand-navy hover:bg-brand-navy/5 font-bold text-xs gap-2 rounded-xl h-10 px-4"
                    >
                        <Eye className="w-4 h-4" /> Preview
                    </Button>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsEditModalOpen(true);
                            }}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-brand-navy hover:bg-brand-navy/5"
                        >
                            <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50"
                        >
                            <Download className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsDeleteModalOpen(true);
                            }}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="min-h-screen bg-brand-white p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-red-600 rounded-2xl shadow-lg shadow-red-600/20">
                            <RotateCcw className="w-6 h-6 text-brand-white" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-brand-navy">Return Notes</h1>
                    </div>
                    <p className="text-muted-foreground text-lg font-medium">Manage and process product returns from providers and couriers.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search return reference..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => setIsAddModalOpen(true)}
                        className="bg-red-600 hover:bg-red-700 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-red-600/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Create Return Note
                    </Button>
                </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="company" className="space-y-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <TabsList className="bg-white/50 p-1.5 rounded-[20px] border border-brand-navy/5 h-14 backdrop-blur-sm self-start">
                        <TabsTrigger
                            value="company"
                            className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                        >
                            Company Returns
                        </TabsTrigger>
                        <TabsTrigger
                            value="courier"
                            className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                        >
                            Courier Returns
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex items-center gap-2 px-4 py-2 bg-red-600/[0.02] rounded-xl border border-red-600/[0.04]">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-xs font-bold text-brand-navy">
                            Awaiting {companyReturnNotes.length + courierReturnNotes.length} returns
                        </span>
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoading ? (
                            Array(3).fill(0).map((_, i) => (
                                <Card key={i} className="h-[300px] animate-pulse bg-white/50 rounded-[32px]" />
                            ))
                        ) : companyReturnNotes.length > 0 ? (
                            companyReturnNotes.map(note => renderNoteCard(note, 'company'))
                        ) : (
                            <div className="col-span-full py-20 text-center">
                                <SearchX className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-20" />
                                <p className="text-muted-foreground font-bold">No company return notes found.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="courier" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoading ? (
                            Array(3).fill(0).map((_, i) => (
                                <Card key={i} className="h-[300px] animate-pulse bg-white/50 rounded-[32px]" />
                            ))
                        ) : courierReturnNotes.length > 0 ? (
                            courierReturnNotes.map(note => renderNoteCard(note, 'courier'))
                        ) : (
                            <div className="col-span-full py-20 text-center">
                                <SearchX className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-20" />
                                <p className="text-muted-foreground font-bold">No courier return notes found.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Add Modal */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="sm:max-w-[600px] rounded-[32px] border-none p-0 overflow-hidden">
                    <div className="bg-red-600 p-8 text-white relative">
                        <DialogTitle className="text-2xl font-black">Issue Return Note</DialogTitle>
                        <DialogDescription className="text-white/60 font-medium">Log returning parcels from your delivery partners.</DialogDescription>
                        <div className="absolute top-8 right-8 w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center">
                            <RotateCcw className="w-8 h-8" />
                        </div>
                    </div>
                    <div className="p-8 space-y-6 bg-white">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Partner Type</label>
                                <select className="w-full h-12 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20">
                                    <option>Company Provider</option>
                                    <option>Internal Courier</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Select Partner</label>
                                <select className="w-full h-12 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20">
                                    <option>AMEEX</option>
                                    <option>Coliaty</option>
                                    <option>Ahmed Delivery</option>
                                </select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Return Reason / Notes</label>
                            <textarea placeholder="Reason for return status..." className="w-full h-32 bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20 resize-none" />
                        </div>
                        <DialogFooter className="pt-4 gap-3">
                            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)} className="rounded-2xl h-12 px-6 font-bold text-brand-navy">Cancel</Button>
                            <Button className="bg-red-600 hover:bg-red-700 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-red-600/20 transition-all active:scale-95">Log Return Note</Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Preview Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="sm:max-w-[700px] rounded-[32px] border-none p-0 overflow-hidden bg-slate-50">
                    <div className="p-10 space-y-8">
                        <div className="flex justify-between items-start">
                            <div className="space-y-2">
                                <div className="text-3xl font-black text-brand-navy uppercase tracking-tighter">Return Note</div>
                                <div className="flex items-center gap-2 text-muted-foreground font-bold">
                                    <span className="text-brand-navy/40">Ref:</span>
                                    <span>{selectedNote?.reference}</span>
                                </div>
                            </div>
                            <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center text-white font-black text-xl">R</div>
                        </div>

                        <div className="grid grid-cols-2 gap-10">
                            <div className="space-y-4">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Warehouse / Logistics</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">DigiCom Inventory</div>
                                    <div className="text-sm text-muted-foreground font-medium">Main Hub, Casablanca</div>
                                </div>
                            </div>
                            <div className="space-y-4 text-right">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Returning Partner</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">{selectedNote?.provider || selectedNote?.courier}</div>
                                    <div className="text-sm text-muted-foreground font-medium">Recorded: {selectedNote?.date}</div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-brand-navy/5">
                            <table className="w-full">
                                <thead className="bg-red-50/50">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Parcel ID</th>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Original Order</th>
                                        <th className="px-6 py-4 text-right text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Return Reason</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-navy/5">
                                    {[1, 2].map((i) => (
                                        <tr key={i} className="hover:bg-red-50/20 transition-colors">
                                            <td className="px-6 py-4 font-bold text-sm text-brand-navy">RET-00{i}</td>
                                            <td className="px-6 py-4 text-xs font-medium text-muted-foreground">#ORD-99{i}</td>
                                            <td className="px-6 py-4 text-right">
                                                <Badge className="bg-red-50 text-red-600 border-none text-[8px] font-black px-2 py-0.5 rounded-lg">REFUSED</Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10 hover:bg-white transition-all">
                                Print Report
                            </Button>
                            <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-10 font-bold shadow-lg shadow-brand-navy/20 transition-all">
                                Confirm Receipt
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent className="sm:max-w-[400px] rounded-[32px] border-none p-8 text-center space-y-6">
                    <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-600 mx-auto">
                        <Trash2 className="w-10 h-10" />
                    </div>
                    <div className="space-y-2">
                        <DialogTitle className="text-2xl font-black text-brand-navy">Delete Return Note?</DialogTitle>
                        <DialogDescription className="text-muted-foreground font-medium">
                            Deleting this note will remove the return record for <span className="font-bold text-brand-navy">{selectedNote?.reference}</span>.
                        </DialogDescription>
                    </div>
                    <div className="flex flex-col gap-3">
                        <Button variant="destructive" className="h-14 rounded-2xl font-black text-sm tracking-widest uppercase shadow-lg shadow-red-500/20">
                            Confirm Delete
                        </Button>
                        <Button variant="ghost" onClick={() => setIsDeleteModalOpen(false)} className="h-12 rounded-2xl font-bold text-brand-navy">
                            Keep Record
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ReturnNote;

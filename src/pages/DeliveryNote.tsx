import React, { useState } from 'react';
import {
    FileText,
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
    ArrowRightCircle,
    ChevronRight,
    SearchX
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const DeliveryNote = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    // Mock Data
    const companyNotes = [
        { id: 1, reference: 'DN-2024-001', provider: 'AMEEX', date: '2024-01-31', status: 'delivered', parcels: 12 },
        { id: 2, reference: 'DN-2024-002', provider: 'Coliaty', date: '2024-01-30', status: 'pending', parcels: 8 },
    ];

    const courierNotes = [
        { id: 3, reference: 'CDN-2024-001', courier: 'Ahmed Delivery', date: '2024-01-31', status: 'picked_up', parcels: 5 },
        { id: 4, reference: 'CDN-2024-002', courier: 'Smail Korchi', date: '2024-01-29', status: 'delivered', parcels: 15 },
    ];

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'delivered':
                return <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Delivered</Badge>;
            case 'pending':
                return <Badge className="bg-amber-50 text-amber-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Clock className="w-3 h-3" /> Pending</Badge>;
            case 'picked_up':
                return <Badge className="bg-indigo-50 text-indigo-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Truck className="w-3 h-3" /> Picked Up</Badge>;
            default:
                return <Badge className="bg-slate-50 text-slate-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5">{status}</Badge>;
        }
    };

    const renderNoteCard = (note: any, type: 'company' | 'courier') => (
        <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
            <div className={`absolute top-0 left-0 w-full h-1.5 ${type === 'company' ? 'bg-blue-500' : 'bg-orange-500'}`} />

            <CardContent className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl ${type === 'company' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'} flex items-center justify-center font-bold`}>
                                {type === 'company' ? <Building2 className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
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
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500">
                            <Hash className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">Parcels</span>
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
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-blue-500 hover:bg-blue-50"
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
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50"
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
                        <div className="p-3 bg-brand-navy rounded-2xl shadow-lg shadow-brand-navy/20">
                            <FileText className="w-6 h-6 text-brand-white" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-brand-navy">Delivery Notes</h1>
                    </div>
                    <p className="text-muted-foreground text-lg font-medium">Manage and track your outgoing shipment documents.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search by reference or provider..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => setIsAddModalOpen(true)}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Generate Note
                    </Button>
                </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="company" className="space-y-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <TabsList className="bg-white/50 p-1.5 rounded-[20px] border border-brand-navy/5 h-14 backdrop-blur-sm self-start">
                        <TabsTrigger
                            value="company"
                            className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                        >
                            Company Notes
                        </TabsTrigger>
                        <TabsTrigger
                            value="courier"
                            className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                        >
                            Courier Notes
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex items-center gap-2 px-4 py-2 bg-brand-navy/[0.02] rounded-xl border border-brand-navy/[0.04]">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-bold text-brand-navy">
                            History updated just now
                        </span>
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {companyNotes.map(note => renderNoteCard(note, 'company'))}
                    </div>
                </TabsContent>

                <TabsContent value="courier" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {courierNotes.map(note => renderNoteCard(note, 'courier'))}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Modal Mockups */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="sm:max-w-[600px] rounded-[32px] border-none p-0 overflow-hidden">
                    <div className="bg-brand-navy p-8 text-white relative">
                        <DialogTitle className="text-2xl font-black">Generate Delivery Note</DialogTitle>
                        <DialogDescription className="text-white/60 font-medium">Create a new delivery record for shipments.</DialogDescription>
                        <div className="absolute top-8 right-8 w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center">
                            <Plus className="w-8 h-8" />
                        </div>
                    </div>
                    <div className="p-8 space-y-6 bg-white">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Type</label>
                                <select className="w-full h-12 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20">
                                    <option>Company Provider</option>
                                    <option>Internal Courier</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Select Provider/Courier</label>
                                <select className="w-full h-12 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20">
                                    <option>AMEEX</option>
                                    <option>Coliaty</option>
                                    <option>Smail Korchi</option>
                                </select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-brand-navy/40 uppercase tracking-widest">Note/Remarks</label>
                            <textarea placeholder="Any delivery instructions..." className="w-full h-32 bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20 resize-none" />
                        </div>
                        <DialogFooter className="pt-4 gap-3">
                            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)} className="rounded-2xl h-12 px-6 font-bold text-brand-navy">Cancel</Button>
                            <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/20 transition-all active:scale-95">Generate Document</Button>
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
                                <div className="text-3xl font-black text-brand-navy uppercase tracking-tighter">Delivery Note</div>
                                <div className="flex items-center gap-2 text-muted-foreground font-bold">
                                    <span className="text-brand-navy/40">Ref:</span>
                                    <span>{selectedNote?.reference}</span>
                                </div>
                            </div>
                            <div className="w-16 h-16 bg-brand-navy rounded-2xl flex items-center justify-center text-white font-black text-xl">D</div>
                        </div>

                        <div className="grid grid-cols-2 gap-10">
                            <div className="space-y-4">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">From / Logistics</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">DigiCom Management</div>
                                    <div className="text-sm text-muted-foreground font-medium">Casablanca, Morocco</div>
                                    <div className="text-sm text-muted-foreground font-medium">+212 5XX-XXXXXX</div>
                                </div>
                            </div>
                            <div className="space-y-4 text-right">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Transport Provider</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">{selectedNote?.provider || selectedNote?.courier}</div>
                                    <div className="text-sm text-muted-foreground font-medium">Scheduled: {selectedNote?.date}</div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-brand-navy/5">
                            <table className="w-full">
                                <thead className="bg-brand-navy/[0.03]">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Parcel ID</th>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Order Ref</th>
                                        <th className="px-6 py-4 text-right text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-navy/5">
                                    {[1, 2, 3].map((i) => (
                                        <tr key={i} className="hover:bg-brand-navy/[0.01] transition-colors">
                                            <td className="px-6 py-4 font-bold text-sm text-brand-navy">PAR-00{i}</td>
                                            <td className="px-6 py-4 text-xs font-medium text-muted-foreground">#ORD-55{i}</td>
                                            <td className="px-6 py-4 text-right">
                                                <Badge className="bg-emerald-50 text-emerald-600 border-none text-[8px] font-black px-2 py-0.5 rounded-lg shadow-none">READY</Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10 hover:bg-white transition-all flex items-center gap-2">
                                <Download className="w-4 h-4" /> PDF Export
                            </Button>
                            <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-10 font-bold shadow-lg shadow-brand-navy/20 transition-all">
                                Update Status
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent className="sm:max-w-[400px] rounded-[32px] border-none p-8 text-center space-y-6">
                    <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mx-auto">
                        <Trash2 className="w-10 h-10" />
                    </div>
                    <div className="space-y-2">
                        <DialogTitle className="text-2xl font-black text-brand-navy">Discard Note?</DialogTitle>
                        <DialogDescription className="text-muted-foreground font-medium">
                            This action cannot be undone. The delivery note <span className="font-bold text-brand-navy">{selectedNote?.reference}</span> will be permanently removed.
                        </DialogDescription>
                    </div>
                    <div className="flex flex-col gap-3">
                        <Button variant="destructive" className="h-14 rounded-2xl font-black text-sm tracking-widest uppercase shadow-lg shadow-red-500/20 active:scale-95 transition-all">
                            Confirm Deletion
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

export default DeliveryNote;

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
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
    Package,
    CheckCircle2,
    Clock,
    XCircle,
    Download,
    Filter,
    ArrowRightCircle,
    ChevronRight,
    SearchX,
    Loader2,
    LayoutGrid,
    List,
    PlusCircle
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DeliveryNoteWizard } from '@/components/delivery/DeliveryNoteWizard';

const DeliveryNote = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<any>(null);
    const [noteDetails, setNoteDetails] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [providerFilter, setProviderFilter] = useState<string>("all");

    // Tracking States
    const [trackingHistory, setTrackingHistory] = useState<any>(null);
    const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);
    const [isTrackingLoading, setIsTrackingLoading] = useState(false);
    const [trackingParcel, setTrackingParcel] = useState<any>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [wizardZoneId, setWizardZoneId] = useState<string | undefined>(undefined);
    const [wizardProviderId, setWizardProviderId] = useState<string | undefined>(undefined);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const EDGE_FUNCTION_URL = "https://zjkqprrfbibjoslvlmxf.supabase.co/functions/v1/provider-integration";

    const handleTrackParcel = async (parcel: any) => {
        setTrackingParcel(parcel);
        setIsTrackingModalOpen(true);
        setIsTrackingLoading(true);
        setTrackingHistory(null);

        try {
            console.log("Tracking parcel via Edge Function:", {
                tracking_code: parcel.tracking_code,
                external_id: parcel.external_id,
                provider_id: parcel.provider_id || selectedNote?.provider_id
            });

            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'track_parcel',
                    provider_id: parcel.provider_id || selectedNote?.provider_id,
                    data: {
                        tracking_code: parcel.tracking_code,
                        external_id: parcel.external_id
                    }
                })
            });

            console.log("Edge Function Response Status:", response.status);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Failed to fetch tracking data' }));
                console.error("Tracking error data:", errData);
                throw new Error(errData.error || `Error ${response.status}`);
            }
            const result = await response.json();
            console.log("Tracking result:", result);

            if (result.success) {
                console.log("Setting tracking history:", result.data);
                setTrackingHistory(result.data);

                // Persist status change to DB if available
                const providerStatus = result.data?.statusLabel || result.data?.status || result.data?.current_status;
                const providerColor = result.data?.statusColor || result.data?.color;

                if (providerStatus) {
                    // map to internal status
                    const { data: matchedStatus } = await supabase
                        .from('package_statuses')
                        .select('id')
                        .ilike('label', providerStatus)
                        .maybeSingle();

                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matchedStatus?.id || null,
                            status_label: providerStatus,
                            status_color: providerColor
                        })
                        .eq('id', parcel.id);
                }

                // Update local state for immediate feedback
                if (noteDetails?.parcels) {
                    setNoteDetails({
                        ...noteDetails,
                        parcels: noteDetails.parcels.map((p: any) =>
                            p.id === parcel.id
                                ? {
                                    ...p,
                                    status_label: providerStatus,
                                    status_color: providerColor,
                                    real_time_status_label: providerStatus,
                                    real_time_status_color: providerColor
                                }
                                : p
                        )
                    });
                }

                // Invalidate query
                queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            } else {
                console.error("Tracking result failed:", result.error);
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error: any) {
            console.error("handleTrackParcel catch block:", error);
            toast({
                title: "Tracking Error",
                description: error.message,
                variant: "destructive"
            });
            setIsTrackingModalOpen(false);
        } finally {
            setIsTrackingLoading(false);
        }
    };

    const handlePrintLabels = async (format: string = 'A6') => {
        if (!selectedNote || !noteDetails?.provider) return;

        toast({
            title: "Generating Labels",
            description: "Please wait while we prepare your labels...",
        });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'get_print_url',
                    provider_id: selectedNote.provider_id,
                    data: {
                        delivery_note_ref: selectedNote.reference,
                        note_id: selectedNote.id,
                        external_id: selectedNote.external_id,
                        print_type: format === 'Note' ? 'note' : 'labels',
                        label_format: format
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Failed to generate labels' }));
                throw new Error(errData.error || `Error ${response.status}`);
            }
            const result = await response.json();

            if (result.success && result.data?.print_html) {
                const printContent = String(result.data.print_html);

                if (printContent.startsWith('data:application/pdf;base64,')) {
                    // Convert base64 to Blob to open in new tab instead of downloading
                    const base64Data = printContent.split(',')[1];
                    const byteCharacters = atob(base64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/pdf' });
                    const fileURL = URL.createObjectURL(blob);

                    window.open(fileURL, '_blank');
                } else if (printContent.startsWith('http')) {
                    window.open(printContent, '_blank');
                } else {
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                        // Determine page size and orientation
                        let pageSize = 'auto';
                        let isCentering = true;

                        if (format === 'Label_100_100' || format === '10x10' || format === 'A6') {
                            pageSize = '100mm 100mm';
                        } else if (format === 'Label_70_100') {
                            pageSize = '70mm 100mm';
                        } else if (format?.includes('A4') || format === 'Note') {
                            pageSize = 'A4';
                            isCentering = false;
                        }

                        const styledContent = `
                            <!DOCTYPE html>
                            <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <title>Print Labels - ${selectedNote.reference}</title>
                                    <style>
                                        /* Critical: Set page size and remove ALL margins */
                                        @page { 
                                            size: ${pageSize}; 
                                            margin: 0mm;
                                        }
                                        
                                        html, body { 
                                            margin: 0;
                                            padding: 0;
                                            width: 100%;
                                            height: 100%;
                                            background: white;
                                        }
                                        
                                        .print-container {
                                            width: 100%;
                                            height: 100%;
                                        }
                                        
                                        /* CRITICAL: Hide empty elements that cause blank pages */
                                        div:empty,
                                        p:empty,
                                        span:empty {
                                            display: none !important;
                                        }
                                        
                                        /* Prevent page breaks between elements */
                                        @media print {
                                            .print-container > * {
                                                page-break-before: avoid !important;
                                                page-break-after: avoid !important;
                                                page-break-inside: avoid !important;
                                            }
                                        }
                                        
                                        /* For thermal printer labels: fill entire space */
                                        ${format === 'Label_100_100' || format === '10x10' || format === 'A6' || format === 'Label_70_100' ? `
                                            body {
                                                overflow: hidden;
                                            }
                                            .print-container > div,
                                            .print-container > svg {
                                                width: 100%;
                                                height: 100%;
                                                margin: 0;
                                                padding: 0;
                                            }
                                        ` : ''}
                                        
                                        /* Scale SVG and images to fit exactly */
                                        svg { 
                                            width: 100%;
                                            height: 100%;
                                            display: block;
                                        }
                                        
                                        img { 
                                            max-width: 100%; 
                                            height: auto; 
                                        }
                                        
                                        /* Ensure tables fill the space */
                                        table {
                                            border-collapse: collapse;
                                            width: 100%;
                                        }
                                    </style>
                                </head>
                                <body>
                                    <div class="print-container">
                                        ${printContent}
                                    </div>
                                    <script>
                                        // Remove empty elements that cause blank pages
                                        document.addEventListener('DOMContentLoaded', () => {
                                            const allDivs = document.querySelectorAll('div, p, span, section');
                                            allDivs.forEach(el => {
                                                const text = el.textContent?.trim() || '';
                                                const hasImages = el.querySelector('img, svg, canvas');
                                                const hasContent = text.length > 0 || hasImages;
                                                
                                                if (!hasContent && el.children.length === 0) {
                                                    el.style.display = 'none';
                                                }
                                            });
                                        });
                                        
                                        // Auto-trigger print dialog after content loads and cleanup
                                        function doPrint() {
                                            setTimeout(() => {
                                                window.print();
                                            }, 800);
                                        }
                                        
                                        if (document.readyState === 'complete') {
                                            doPrint();
                                        } else {
                                            window.addEventListener('load', doPrint);
                                        }
                                    </script>
                                </body>
                            </html>
                        `;
                        printWindow.document.write(styledContent);
                        printWindow.document.close();
                    }
                }
            } else {
                throw new Error(result.error || 'Failed to get print content');
            }
        } catch (error: any) {
            toast({
                title: "Print Error",
                description: error.message,
                variant: "destructive"
            });
        }
    };
    const handleFinalizeNote = async (note: any) => {
        if (!note || note.is_finalized) return;

        toast({
            title: "Finalizing Note",
            description: "Closing the delivery note in the provider's system...",
        });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'finalize_delivery_note',
                    provider_id: note.provider_id,
                    data: {
                        delivery_note_ref: note.reference,
                        external_id: note.external_id
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Failed to finalize delivery note' }));
                throw new Error(errData.error || `Error ${response.status}`);
            }

            // Update database
            const { error } = await supabase
                .from('company_delivery_notes')
                .update({ is_finalized: true })
                .eq('id', note.id);

            if (error) throw error;

            toast({
                title: "Finalized Successfully",
                description: "The delivery note is now finalized and closed.",
            });

            // Refresh queries
            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });

            // If the modal is open, update the local state
            if (selectedNote?.id === note.id) {
                setSelectedNote({ ...note, is_finalized: true });
            }

        } catch (error: any) {
            toast({
                title: "Finalization Error",
                description: error.message,
                variant: "destructive"
            });
        }
    };


    const handleDeleteNote = async () => {
        if (!selectedNote) return;

        try {
            const isCompanyNote = selectedNote.provider_id != null;
            const parcelsTable = isCompanyNote ? 'company_parcels' : 'courier_parcels';
            const noteTable = isCompanyNote ? 'company_delivery_notes' : 'courier_delivery_notes';
            const noteIdField = isCompanyNote ? 'company_delivery_note_id' : 'courier_delivery_note_id';

            // 1. Delete associated parcels first
            const { error: parcelsError } = await supabase
                .from(parcelsTable)
                .delete()
                .eq(noteIdField, selectedNote.id);

            if (parcelsError) throw parcelsError;

            // 2. Delete the delivery note itself
            const { error: noteError } = await supabase
                .from(noteTable)
                .delete()
                .eq('id', selectedNote.id);

            if (noteError) throw noteError;

            // 3. Optional: Call provider to cancel if it was a provider note
            if (isCompanyNote) {
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch(EDGE_FUNCTION_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session?.access_token}`
                        },
                        body: JSON.stringify({
                            action: 'delete_delivery_note',
                            provider_id: selectedNote.provider_id,
                            data: {
                                reference: selectedNote.reference,
                                external_id: selectedNote.external_id
                            }
                        })
                    });
                } catch (e) {
                    console.error("Provider deletion failed (non-critical):", e);
                }
            }

            toast({
                title: "Deleted Successfully",
                description: "The delivery note and its parcels have been removed from the database.",
            });

            setIsDeleteModalOpen(false);
            setSelectedNote(null);

            // Invalidate queries to refresh the list
            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });

        } catch (error: any) {
            toast({
                title: "Delete Error",
                description: error.message,
                variant: "destructive"
            });
        }
    };

    // Fetch delivery note details when modal opens
    useEffect(() => {
        async function fetchNoteDetails() {
            if (!selectedNote || !isViewModalOpen) {
                setNoteDetails(null);
                return;
            }

            // Determine table based on note structure
            const isCompanyNote = selectedNote.provider_id != null;
            const parcelsTable = isCompanyNote ? 'company_parcels' : 'courier_parcels';
            const noteIdField = isCompanyNote ? 'company_delivery_note_id' : 'courier_delivery_note_id';

            // Fetch provider/courier details
            let providerInfo = null;
            if (isCompanyNote && selectedNote.provider_id) {
                const { data: provider } = await supabase
                    .from('providers')
                    .select('name, business_name, logo_url, provider_type')
                    .eq('id', selectedNote.provider_id)
                    .single();
                providerInfo = provider;
            } else if (!isCompanyNote && selectedNote.courier_id) {
                const { data: courier } = await supabase
                    .from('users')
                    .select('name, phone, email')
                    .eq('id', selectedNote.courier_id)
                    .single();
                providerInfo = { name: courier?.name, business_name: courier?.name };
            }

            // Fetch parcels with tracking codes
            const { data: parcels } = await supabase
                .from(parcelsTable)
                .select('id, reference, order_id, status_id, tracking_code, status_label, external_id, provider_id')
                .eq(noteIdField, selectedNote.id);

            // Fetch real-time status for each parcel from provider
            let updatedParcels = parcels || [];
            if (isCompanyNote && providerInfo?.provider_type && parcels && parcels.length > 0) {
                try {
                    const { data: { session } } = await supabase.auth.getSession();

                    // Fetch real-time status for each parcel
                    const statusPromises = parcels.map(async (parcel) => {
                        if (!parcel.tracking_code) return parcel;

                        try {
                            const response = await fetch(EDGE_FUNCTION_URL, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${session?.access_token}`
                                },
                                body: JSON.stringify({
                                    action: 'get_parcel_info',
                                    provider_id: selectedNote.provider_id,
                                    data: {
                                        tracking_code: parcel.tracking_code
                                    }
                                })
                            });

                            if (response.ok) {
                                const result = await response.json();
                                if (result.success && result.data) {
                                    const providerStatus = result.data.statusLabel || result.data.status || 'Nouveau';
                                    const providerColor = result.data.statusColor || result.data.color;
                                    let mappedStatusId = parcel.status_id;

                                    // Map provider status to internal package_statuses
                                    const { data: matchedStatus } = await supabase
                                        .from('package_statuses')
                                        .select('id')
                                        .ilike('label', providerStatus)
                                        .single();

                                    if (matchedStatus) {
                                        mappedStatusId = matchedStatus.id;
                                    }

                                    // Persist to database if status or color changed
                                    if (mappedStatusId !== parcel.status_id || providerStatus !== parcel.status_label || providerColor !== parcel.status_color) {
                                        await supabase
                                            .from('company_parcels')
                                            .update({
                                                status_id: mappedStatusId,
                                                status_label: providerStatus,
                                                status_color: providerColor,
                                                provider_response: result.data // Update with latest info
                                            })
                                            .eq('id', parcel.id);
                                    }

                                    return {
                                        ...parcel,
                                        status_id: mappedStatusId,
                                        status_label: providerStatus,
                                        status_color: providerColor,
                                        real_time_status: result.data.status,
                                        real_time_status_label: providerStatus,
                                        real_time_status_color: providerColor || result.data.statusColor
                                    };
                                }
                            }
                        } catch (err) {
                            console.error('Failed to fetch real-time status for parcel:', parcel.tracking_code, err);
                        }
                        return parcel;
                    });

                    updatedParcels = await Promise.all(statusPromises);
                } catch (error) {
                    console.error('Error fetching real-time parcel statuses:', error);
                }
            }

            setNoteDetails({
                provider: providerInfo,
                parcels: updatedParcels
            });
        }

        fetchNoteDetails();
    }, [selectedNote, isViewModalOpen]);

    // Fetch company delivery notes
    const { data: companyNotes, isLoading: loadingCompany } = useQuery({
        queryKey: ['company-delivery-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('company_delivery_notes')
                .select(`
                    *,
                    providers:provider_id (
                        id,
                        name,
                        provider_type,
                        logo_url,
                        business_name
                    )
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        }
    });

    // Fetch courier delivery notes
    const { data: courierNotes, isLoading: loadingCourier } = useQuery({
        queryKey: ['courier-delivery-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('courier_delivery_notes')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        }
    });

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

    const renderNoteCard = (note: any, type: 'company' | 'courier') => {
        // Get provider info and brand color
        const provider = note.providers;
        const providerType = provider?.provider_type?.toLowerCase();
        const brandColor = providerType === 'coliaty' ? 'emerald' : providerType === 'ameex' ? 'orange' : providerType === 'ozon' ? 'red' : 'blue';

        return (
            <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
                {/* Provider brand color accent */}
                <div className={`absolute top-0 left-0 w-full h-1.5 ${brandColor === 'emerald' ? 'bg-emerald-500' :
                    brandColor === 'orange' ? 'bg-orange-500' :
                        brandColor === 'red' ? 'bg-red-500' :
                            'bg-blue-500'
                    }`} />

                <CardContent className="p-8 space-y-6">
                    {/* Header with provider logo */}
                    <div className="flex justify-between items-start gap-4">
                        <div className="flex items-center gap-4 flex-1">
                            {/* Provider Logo */}
                            {provider?.logo_url ? (
                                <div className={`p-3 rounded-2xl border-2 ${brandColor === 'emerald' ? 'bg-emerald-50 border-emerald-200' :
                                    brandColor === 'orange' ? 'bg-orange-50 border-orange-200' :
                                        brandColor === 'red' ? 'bg-red-50 border-red-200' :
                                            'bg-blue-50 border-blue-200'
                                    }`}>
                                    <img
                                        src={provider.logo_url}
                                        alt={provider.name}
                                        className="w-12 h-12 object-contain"
                                    />
                                </div>
                            ) : (
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-white ${brandColor === 'emerald' ? 'bg-emerald-500' :
                                    brandColor === 'orange' ? 'bg-orange-500' :
                                        brandColor === 'red' ? 'bg-red-500' :
                                            'bg-blue-500'
                                    }`}>
                                    {type === 'company' ? <Building2 className="w-7 h-7" /> : <Truck className="w-7 h-7" />}
                                </div>
                            )}

                            {/* Note Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xl font-black text-brand-navy tracking-tight truncate">{note.reference}</h3>
                                    {!note.is_finalized && (
                                        <Badge className="bg-amber-500/10 text-amber-600 border-none font-black text-[9px] uppercase tracking-tighter px-2 rounded-lg">Draft</Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground mt-1">
                                    <Calendar className="w-3.5 h-3.5" />
                                    <span className="text-xs font-semibold">
                                        {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Provider and Parcels Info */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Provider */}
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${brandColor === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                brandColor === 'orange' ? 'bg-orange-50 text-orange-600' :
                                    'bg-blue-50 text-blue-600'
                                }`}>
                                {type === 'company' ? <Building2 className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">
                                    {type === 'company' ? 'Provider' : 'Courier'}
                                </span>
                                <span className="text-sm font-bold text-brand-navy truncate mt-1">
                                    {provider?.business_name || provider?.name || 'N/A'}
                                </span>
                            </div>
                        </div>

                        {/* Parcel Count */}
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${brandColor === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                brandColor === 'orange' ? 'bg-orange-50 text-orange-600' :
                                    'bg-blue-50 text-blue-600'
                                }`}>
                                <Package className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">Parcels</span>
                                <span className="text-sm font-bold text-brand-navy mt-1">{note.parcel_count || 0} units</span>
                            </div>
                        </div>
                    </div>

                    <Separator className="bg-brand-navy/[0.05]" />

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsViewModalOpen(true);
                            }}
                            className={`font-bold text-xs gap-2 rounded-xl h-11 px-5 ${brandColor === 'emerald' ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700' :
                                brandColor === 'orange' ? 'text-orange-600 hover:bg-orange-50 hover:text-orange-700' :
                                    'text-blue-600 hover:bg-blue-50 hover:text-blue-700'
                                }`}
                        >
                            <Eye className="w-4 h-4" /> Preview
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsDeleteModalOpen(true);
                            }}
                            className="w-11 h-11 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>

                    {!note.is_finalized && note.provider_id && (
                        <Button
                            onClick={() => {
                                setWizardZoneId(note.zone_id);
                                setWizardProviderId(note.provider_id);
                                setIsWizardOpen(true);
                            }}
                            className="w-full bg-brand-navy/5 hover:bg-brand-navy/10 text-brand-navy rounded-xl h-10 font-bold text-xs gap-2"
                        >
                            <PlusCircle className="w-4 h-4" /> Add Orders
                        </Button>
                    )}
                </CardContent>
            </Card>
        );
    };

    const renderNoteTable = (notes: any[], type: 'company' | 'courier') => (
        <div className="bg-white/50 backdrop-blur-sm shadow-xl rounded-[32px] overflow-hidden border border-brand-navy/[0.03] mb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-brand-navy/[0.02]">
                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Reference & Date</th>
                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Provider / Courier</th>
                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Shipment Info</th>
                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-navy/[0.03]">
                        {notes.map((note) => {
                            const provider = note.providers;
                            const providerType = provider?.provider_type?.toLowerCase();
                            const brandColor = providerType === 'coliaty' ? 'emerald' : providerType === 'ameex' ? 'orange' : providerType === 'ozon' ? 'red' : 'blue';

                            return (
                                <tr key={note.id} className="hover:bg-brand-navy/[0.01] transition-colors group">
                                    <td className="p-6">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ${brandColor === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                                brandColor === 'orange' ? 'bg-orange-50 text-orange-600' :
                                                    brandColor === 'red' ? 'bg-red-50 text-red-600' :
                                                        'bg-blue-50 text-blue-600'
                                                }`}>
                                                <FileText className="w-5 h-5" />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold text-brand-navy truncate">
                                                        {note.reference}
                                                    </span>
                                                    {!note.is_finalized && (
                                                        <Badge className="bg-amber-500/10 text-amber-600 border-none font-black text-[8px] uppercase tracking-tighter px-1.5 rounded-md">Draft</Badge>
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-bold text-muted-foreground tracking-wider">
                                                    {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-brand-navy/[0.04] p-2 flex items-center justify-center overflow-hidden border border-brand-navy/[0.03]">
                                                {provider?.logo_url ? (
                                                    <img src={provider.logo_url} alt="" className="w-full h-full object-contain" />
                                                ) : (
                                                    type === 'company' ? <Building2 className="w-4 h-4 text-blue-500" /> : <Truck className="w-4 h-4 text-orange-500" />
                                                )}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest leading-none">
                                                    {type === 'company' ? 'Provider' : 'Courier'}
                                                </span>
                                                <span className="text-sm font-bold text-brand-navy truncate mt-1">
                                                    {provider?.business_name || provider?.name || 'Local'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-brand-navy">
                                                <Package className="w-3.5 h-3.5 text-indigo-500" />
                                                {note.parcel_count || 0} Parcels
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest">
                                                ID: {note.id.split('-')[0]}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setSelectedNote(note);
                                                    setIsViewModalOpen(true);
                                                }}
                                                className="h-9 w-9 rounded-xl bg-brand-navy/[0.04] hover:bg-brand-navy text-brand-navy hover:text-brand-white transition-all shadow-sm"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </Button>
                                            {!note.is_finalized && note.provider_id && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setWizardZoneId(note.zone_id);
                                                        setWizardProviderId(note.provider_id);
                                                        setIsWizardOpen(true);
                                                    }}
                                                    className="h-9 w-9 rounded-xl bg-brand-navy/[0.04] hover:bg-emerald-500 text-brand-navy hover:text-white transition-all shadow-sm"
                                                >
                                                    <PlusCircle className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setSelectedNote(note);
                                                    setIsDeleteModalOpen(true);
                                                }}
                                                className="h-9 w-9 rounded-xl bg-brand-navy/[0.04] text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Delivery Notes</h1>
                            <p className="text-gray-500 font-light">Manage and track your outgoing shipment documents.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search by reference or provider..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => setIsWizardOpen(true)}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" />
                                Generate Note
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="company" className="space-y-8">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <TabsList className="bg-white/50 p-1.5 rounded-[20px] border border-brand-navy/5 h-14 backdrop-blur-sm">
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

                        {/* View Switcher */}
                        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-brand-navy/5 shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    "h-8 px-3 rounded-lg gap-2 transition-all duration-300",
                                    viewMode === 'grid'
                                        ? "bg-brand-navy text-brand-white shadow-lg"
                                        : "text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                )}
                            >
                                <LayoutGrid className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Grid</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    "h-8 px-3 rounded-lg gap-2 transition-all duration-300",
                                    viewMode === 'list'
                                        ? "bg-brand-navy text-brand-white shadow-lg"
                                        : "text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                )}
                            >
                                <List className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">List</span>
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 px-4 py-2 bg-brand-navy/[0.02] rounded-xl border border-brand-navy/[0.04]">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-bold text-brand-navy">
                            History updated just now
                        </span>
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    {loadingCompany ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
                        </div>
                    ) : companyNotes?.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            No company delivery notes yet. Click "Generate Note" to create one.
                        </div>
                    ) : (
                        viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {companyNotes?.map(note => renderNoteCard(note, 'company'))}
                            </div>
                        ) : (
                            renderNoteTable(companyNotes || [], 'company')
                        )
                    )}
                </TabsContent>

                <TabsContent value="courier" className="mt-0">
                    {loadingCourier ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
                        </div>
                    ) : courierNotes?.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            No courier delivery notes yet.
                        </div>
                    ) : (
                        viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {courierNotes?.map(note => renderNoteCard(note, 'courier'))}
                            </div>
                        ) : (
                            renderNoteTable(courierNotes || [], 'courier')
                        )
                    )}
                </TabsContent>
            </Tabs>


            {/* Delivery Note Wizard */}
            <DeliveryNoteWizard
                open={isWizardOpen}
                onOpenChange={(open) => {
                    setIsWizardOpen(open);
                    if (!open) {
                        setWizardZoneId(undefined);
                        setWizardProviderId(undefined);
                    }
                }}
                lockZoneId={wizardZoneId}
                lockProviderId={wizardProviderId}
            />


            {/* Preview Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="sm:max-w-[700px] rounded-[32px] border-none p-0 overflow-hidden bg-slate-50">
                    <div className="p-10 space-y-8 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-start">
                            <div className="space-y-2">
                                <div className="text-3xl font-black text-brand-navy uppercase tracking-tighter">Delivery Note</div>
                                <div className="flex items-center gap-2 text-muted-foreground font-bold">
                                    <span className="text-brand-navy/40">Ref:</span>
                                    <span>{selectedNote?.reference}</span>
                                </div>
                            </div>
                            {noteDetails?.provider?.logo_url ? (
                                <div className="p-3 bg-white rounded-2xl shadow-sm border border-brand-navy/5 flex items-center justify-center min-w-[80px]">
                                    <img src={noteDetails.provider.logo_url} alt="Provider Logo" className="h-10 w-auto object-contain" />
                                </div>
                            ) : (
                                <div className="w-16 h-16 bg-brand-navy rounded-2xl flex items-center justify-center text-white font-black text-xl">D</div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-10">
                            <div className="space-y-4">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Provider / Business</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">{noteDetails?.provider?.business_name || noteDetails?.provider?.name || 'Loading...'}</div>
                                    <div className="text-sm text-muted-foreground font-medium">Provider: {noteDetails?.provider?.provider_type?.toUpperCase() || 'N/A'}</div>
                                    <div className="text-sm text-muted-foreground font-medium">Reference: {selectedNote?.reference}</div>
                                </div>
                            </div>
                            <div className="space-y-4 text-right">
                                <div className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Delivery Details</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-brand-navy text-lg">{selectedNote?.parcel_count || 0} Parcels</div>
                                    <div className="text-sm text-muted-foreground font-medium">Created: {selectedNote?.created_at ? format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}</div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-brand-navy/5">
                            <table className="w-full">
                                <thead className="bg-brand-navy/[0.03]">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Tracking Code</th>
                                        <th className="px-6 py-4 text-left text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Order Ref</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Status</th>
                                        <th className="px-6 py-4 text-right text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-navy/5">
                                    {!noteDetails ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading parcels...</td>
                                        </tr>
                                    ) : noteDetails.parcels.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No parcels in this delivery note</td>
                                        </tr>
                                    ) : (
                                        noteDetails.parcels.map((parcel: any) => (
                                            <tr key={parcel.id} className="hover:bg-brand-navy/[0.01] transition-colors">
                                                <td className="px-6 py-4 font-bold text-sm text-brand-navy">{parcel.tracking_code || parcel.reference}</td>
                                                <td className="px-6 py-4 text-xs font-medium text-muted-foreground">{parcel.order_id?.slice(0, 8)}</td>
                                                <td className="px-6 py-4 text-center">
                                                    {parcel.real_time_status_label ? (
                                                        <Badge
                                                            className="border-none text-[8px] font-black px-2 py-0.5 rounded-lg shadow-none"
                                                            style={{
                                                                backgroundColor: parcel.real_time_status_color ? `${parcel.real_time_status_color}15` : '#10b98115',
                                                                color: parcel.real_time_status_color || '#10b981'
                                                            }}
                                                        >
                                                            {parcel.real_time_status_label}
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-emerald-50 text-emerald-600 border-none text-[8px] font-black px-2 py-0.5 rounded-lg shadow-none">
                                                            {parcel.status_label || parcel.status_id || 'Nouveau'}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {parcel.tracking_code && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-8 text-xs font-bold text-brand-navy hover:bg-brand-navy/5"
                                                            onClick={() => handleTrackParcel(parcel)}
                                                        >
                                                            <Clock className="w-3 h-3 mr-1" />
                                                            Suivi
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            {!selectedNote?.is_finalized && selectedNote?.provider_id && (
                                <Button
                                    onClick={() => handleFinalizeNote(selectedNote)}
                                    className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-emerald-500/10 transition-all flex items-center gap-2"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Finaliser le Bon
                                </Button>
                            )}

                            {noteDetails?.provider?.provider_type === 'ameex' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-2xl bg-white min-w-[200px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('Label_100_100')}>
                                            Étiquette 100/100
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('Label_A4')}>
                                            Étiquette A4-4
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('Label_A4_8')}>
                                            Étiquette A4-8
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('Label_70_100')}>
                                            Étiquette 70/100
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-blue-600" onClick={() => handlePrintLabels('Note')}>
                                            Bon Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : noteDetails?.provider?.provider_type === 'coliaty' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-2xl bg-white min-w-[200px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('10x10')}>
                                            10cm / 10cm
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('A4')}>
                                            A4 (4 tickets)
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (noteDetails?.provider?.provider_type === 'ozon' || noteDetails?.provider?.provider_type === 'OZON') ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-2xl bg-white min-w-[200px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('10x10')}>
                                            Ticket Thermique (10x10)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('A4')}>
                                            Tickets A4 (4/page)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-blue-600" onClick={() => handlePrintLabels('Note')}>
                                            Bon de Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Button
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2"
                                    onClick={() => handlePrintLabels()}
                                >
                                    <Download className="w-4 h-4" />
                                    Imprimer Étiquettes
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Tracking Modal */}
            <Dialog open={isTrackingModalOpen} onOpenChange={setIsTrackingModalOpen}>
                <DialogContent className="sm:max-w-[500px] rounded-[32px] border-none p-0 overflow-hidden bg-white">
                    <DialogHeader className="p-8 pb-0">
                        <DialogTitle className="text-2xl font-black text-brand-navy flex items-center gap-3">
                            <div className="p-2 bg-brand-navy/5 rounded-xl">
                                <Truck className="w-5 h-5 text-brand-navy" />
                            </div>
                            Suivi du colis
                        </DialogTitle>
                        <DialogDescription className="font-bold text-muted-foreground">
                            Code: <span className="text-brand-navy">{trackingParcel?.tracking_code}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-8 max-h-[60vh] overflow-y-auto">
                        {isTrackingLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
                                <p className="font-bold text-muted-foreground animate-pulse">Récupération des données...</p>
                            </div>
                        ) : trackingHistory ? (
                            <div className="space-y-8 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-navy/5">
                                {(() => {
                                    // Handle both old (array) and new (object with .history) formats
                                    const events = Array.isArray(trackingHistory)
                                        ? trackingHistory
                                        : (trackingHistory?.history || []);
                                    return events;
                                })().map((event: any, idx: number) => {
                                    // Status mapping for Coliaty/Ameex labels
                                    const statusMap: any = {
                                        'NEW_PARCEL': 'Nouveau',
                                        'WAITING_PICKUP': 'En attente de ramassage',
                                        'DISTRIBUTION': 'En cours de distribution',
                                        'DELIVERED': 'Livré',
                                        'REFUSED': 'Refusé',
                                        'REFUSE': 'Refusé',
                                        'ANNULE': 'Annulé',
                                        'CANCELLED': 'Annulé',
                                        'RETURNED': 'Retourné',
                                        'RETOUR': 'Retourné',
                                        'POSTPONED': 'Reporté',
                                        'WAITING_PREPARATION': 'En préparation',
                                        'PICKED_UP': 'Ramassé',
                                        'READY_FOR_PICKUP': 'Prêt pour ramassage'
                                    };

                                    // Our Edge Function now returns normalized fields: status, date, comment, user
                                    // AMEEX also provides statusLabel (friendly name from API)
                                    const rawStatus = event.status || "Nouveau";
                                    const statusLabel = event.statusLabel; // AMEEX provides this
                                    const status = statusLabel || statusMap[rawStatus] || rawStatus;
                                    const date = event.date;
                                    const comment = event.comment || "";
                                    const user = (typeof event.user === 'object' ? event.user?.name : event.user) || "";

                                    return (
                                        <div key={idx} className="relative pl-12 group">
                                            <div className={`absolute left-0 top-1 w-9 h-9 rounded-full border-4 border-white shadow-sm flex items-center justify-center transition-all group-hover:scale-110 z-10 ${idx === 0 ? 'bg-brand-navy text-white shadow-brand-navy/20' : 'bg-slate-50 text-brand-navy/40'
                                                }`}>
                                                <div className="w-2 h-2 rounded-full bg-current" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className={`text-sm font-black tracking-tight ${idx === 0 ? 'text-brand-navy' : 'text-muted-foreground'}`}>
                                                        {status}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-muted-foreground opacity-60">
                                                        {date ? format(new Date(date), 'dd/MM/yyyy HH:mm') : ''}
                                                    </span>
                                                </div>
                                                {comment && (
                                                    <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
                                                        "{comment}"
                                                    </p>
                                                )}
                                                {user && (
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                        <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center">
                                                            <Hash className="w-2 h-2" />
                                                        </div>
                                                        Par {user}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                                <div className="p-4 bg-slate-50 rounded-full">
                                    <SearchX className="w-8 h-8 text-muted-foreground/40" />
                                </div>
                                <p className="font-bold text-muted-foreground">Aucun historique disponible pour ce colis.</p>
                            </div>
                        )}
                    </div>

                    <div className="p-8 pt-0">
                        <Button
                            variant="ghost"
                            onClick={() => setIsTrackingModalOpen(false)}
                            className="w-full h-14 rounded-2xl font-black text-sm tracking-widest uppercase hover:bg-slate-50"
                        >
                            Fermer
                        </Button>
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
                        <Button
                            variant="destructive"
                            onClick={handleDeleteNote}
                            className="h-14 rounded-2xl font-black text-sm tracking-widest uppercase shadow-lg shadow-red-500/20 active:scale-95 transition-all"
                        >
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

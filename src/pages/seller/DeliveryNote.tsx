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
    PlusCircle,
    Unlock,
    Phone,
    MapPin,
    CalendarClock,
    Info
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs';
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
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DeliveryNoteWizard } from '@/components/delivery/DeliveryNoteWizard';
import { CourierDeliveryNoteWizard } from '@/components/delivery/CourierDeliveryNoteWizard';
import { printCourierDeliveryNote } from '@/lib/courierLabelGenerator';
import { removeCompanyParcelFromDeliveryNote } from '@/lib/removeCompanyParcelFromDeliveryNote';
import { deleteOpenCompanyDeliveryNote } from '@/lib/deleteOpenCompanyDeliveryNote';

const DeliveryNote = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [isCourierWizardOpen, setIsCourierWizardOpen] = useState(false);
    const [courierWizardLockId, setCourierWizardLockId] = useState<string | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
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

    const [wizardProviderId, setWizardProviderId] = useState<string | undefined>(undefined);
    const [isReopening, setIsReopening] = useState(false);
    const [removingParcelId, setRemovingParcelId] = useState<string | null>(null);
    const [parcelPendingRemove, setParcelPendingRemove] = useState<{ id: string } | null>(null);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: sellerShippingCtx } = useQuery({
        queryKey: ['seller-delivery-shipping-ctx', activeBusinessId],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) return null;
            const { data: row, error } = await supabase
                .from('users')
                .select('id, products')
                .eq('id', session.user.id)
                .single();
            if (error || !row) return null;
            const productIds = Array.isArray(row.products)
                ? (row.products as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
                : [];
            return { userId: row.id as string, productIds };
        },
        enabled: !!activeBusinessId,
    });

    const sellerScope =
        sellerShippingCtx && sellerShippingCtx.productIds.length > 0
            ? { userId: sellerShippingCtx.userId, productIds: sellerShippingCtx.productIds }
            : sellerShippingCtx
              ? { userId: sellerShippingCtx.userId, productIds: sellerShippingCtx.productIds }
              : undefined;

    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    const handleTrackParcel = async (parcel: any) => {
        setTrackingParcel(parcel);
        setIsTrackingModalOpen(true);
        setIsTrackingLoading(true);
        setTrackingHistory(null);

        const isCourierParcel = !parcel.provider_id && !selectedNote?.provider_id;
        if (isCourierParcel) {
            setTrackingHistory({
                statusLabel: parcel.status_label || 'Nouveau',
                statusColor: parcel.status_color || '#3b82f6',
                history: [
                    {
                        status: parcel.status_label || 'Nouveau',
                        statusLabel: parcel.status_label || 'Nouveau',
                        date: parcel.created_at || selectedNote?.created_at || null,
                        comment: 'Colis créé en interne',
                        color: parcel.status_color || '#3b82f6',
                    },
                ],
            });
            setIsTrackingLoading(false);
            return;
        }

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
                queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
            } else {
                console.error("Tracking result failed:", result.error);
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
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

    const openRemoveParcelDialog = (parcel: { id: string }) => {
        setParcelPendingRemove({ id: parcel.id });
    };

    const confirmRemoveParcelFromNote = async () => {
        const parcelId = parcelPendingRemove?.id;
        if (!parcelId || !selectedNote?.id) return;
        setRemovingParcelId(parcelId);
        const isCourierNote = !selectedNote?.provider_id && !!selectedNote?.courier_id;
        try {
            if (isCourierNote) {
                if (selectedNote.is_finalized) {
                    throw new Error('note_finalized');
                }

                const { data: parcelRow, error: parcelLookupError } = await (supabase as any)
                    .from('courier_parcels')
                    .select('order_id')
                    .eq('id', parcelId)
                    .maybeSingle();
                if (parcelLookupError) throw parcelLookupError;
                const orderId = parcelRow?.order_id;

                const { error: delError } = await (supabase as any)
                    .from('courier_parcels')
                    .delete()
                    .eq('id', parcelId);
                if (delError) throw delError;

                if (orderId) {
                    const { data: confirmedStatus } = await supabase
                        .from('order_statuses')
                        .select('id')
                        .eq('label', 'CONFIRMER')
                        .single();
                    if (confirmedStatus) {
                        await (supabase as any)
                            .from('orders')
                            .update({ order_status_id: confirmedStatus.id, courier_id: null })
                            .eq('id', orderId);
                    }
                }

                const { count } = await (supabase as any)
                    .from('courier_parcels')
                    .select('*', { count: 'exact', head: true })
                    .eq('courier_delivery_note_id', selectedNote.id);
                await (supabase as any)
                    .from('courier_delivery_notes')
                    .update({ parcel_count: count || 0 })
                    .eq('id', selectedNote.id);
            } else {
                if (!selectedNote?.provider_id) return;
                await removeCompanyParcelFromDeliveryNote(parcelId, selectedNote.id);
            }

            toast({
                title: 'Colis retiré',
                description: 'La commande est repassée en confirmée.',
            });
            setParcelPendingRemove(null);
            setNoteDetails((prev: any) =>
                prev ? { ...prev, parcels: prev.parcels.filter((p: any) => p.id !== parcelId) } : null
            );
            setSelectedNote((prev: any) =>
                prev
                    ? {
                          ...prev,
                          parcel_count: Math.max(0, (prev.parcel_count ?? 1) - 1),
                      }
                    : null
            );
            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-zone'] });
        } catch (error: any) {
            const blob = `${error?.message ?? ''} ${error?.details ?? ''}`;
            let description = error?.message ?? 'Échec du retrait du colis.';
            if (blob.includes('order_has_multiple_parcels')) {
                description =
                    'Impossible : cette commande a plusieurs colis. Retirez-les tous ou ajustez autrement.';
            } else if (blob.includes('note_finalized')) {
                description = 'Le bon est finalisé.';
            } else if (blob.includes('forbidden')) {
                description = 'Action non autorisée.';
            } else if (blob.includes('parcel_not_found')) {
                description = 'Colis introuvable.';
            }
            toast({
                title: 'Erreur',
                description,
                variant: 'destructive',
            });
        } finally {
            setRemovingParcelId(null);
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
        } catch (error) {
            toast({
                title: "Print Error",
                description: error.message,
                variant: "destructive"
            });
        }
    };
    const handleFinalizeNote = async (note: any) => {
        if (!note || note.is_finalized) return;

        const isCourierNote = !note.provider_id && !!note.courier_id;

        toast({
            title: "Finalizing Note",
            description: isCourierNote
                ? "Closing the courier delivery note..."
                : "Closing the delivery note in the provider's system...",
        });

        try {
            if (isCourierNote) {
                const { error } = await (supabase as any)
                    .from('courier_delivery_notes')
                    .update({ is_finalized: true, updated_at: new Date().toISOString() })
                    .eq('id', note.id);
                if (error) throw error;
            } else {
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

                const { error } = await supabase
                    .from('company_delivery_notes')
                    .update({ is_finalized: true })
                    .eq('id', note.id);

                if (error) throw error;
            }

            // Set all linked orders to PROCESSED → DB trigger deducts stock
            const parcelsTable = isCourierNote ? 'courier_parcels' : 'company_parcels';
            const noteIdField = isCourierNote ? 'courier_delivery_note_id' : 'company_delivery_note_id';

            const { data: linkedParcels } = await (supabase as any)
                .from(parcelsTable)
                .select('order_id')
                .eq(noteIdField, note.id)
                .not('order_id', 'is', null);

            if (linkedParcels && linkedParcels.length > 0) {
                const { data: processedStatus } = await supabase
                    .from('order_statuses')
                    .select('id')
                    .eq('label', 'PROCESSED')
                    .single();

                if (processedStatus) {
                    const orderIds = linkedParcels.map((p: any) => p.order_id);
                    await supabase
                        .from('orders')
                        .update({ order_status_id: processedStatus.id })
                        .in('id', orderIds);
                }
            }

            toast({
                title: "Finalized Successfully",
                description: "The delivery note is now finalized and closed.",
            });

            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });

            if (selectedNote?.id === note.id) {
                setSelectedNote({ ...note, is_finalized: true });
            }

        } catch (error) {
            toast({
                title: "Finalization Error",
                description: (error as Error).message,
                variant: "destructive"
            });
        }
    };

    const handleReopenNote = async (note: any) => {
        if (!note || !note.is_finalized) return;

        const isCourierNote = !note.provider_id && !!note.courier_id;
        const providerType = note.providers?.provider_type?.toLowerCase();
        setIsReopening(true);

        try {
            if (isCourierNote) {
                toast({
                    title: "Réouverture en cours",
                    description: "Réouverture du bon coursier...",
                });
                const { error } = await (supabase as any)
                    .from('courier_delivery_notes')
                    .update({ is_finalized: false, updated_at: new Date().toISOString() })
                    .eq('id', note.id);
                if (error) throw error;
            } else if (providerType === 'ameex' || providerType === 'ozon') {
                toast({
                    title: "Réouverture en cours",
                    description: "Ouverture du bon de livraison chez le prestataire...",
                });

                const { data: { session } } = await supabase.auth.getSession();
                const REOPEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reopen-delivery-note`;

                const response = await fetch(REOPEN_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`
                    },
                    body: JSON.stringify({
                        provider_id: note.provider_id,
                        reference: note.reference,
                        delivery_note_id: note.id
                    })
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.error || `Erreur HTTP ${response.status}`);
                }
            } else {
                toast({
                    title: "Réouverture en cours",
                    description: "Réouverture interne du bon de livraison...",
                });

                const { error } = await supabase
                    .from('company_delivery_notes')
                    .update({ is_finalized: false, updated_at: new Date().toISOString() })
                    .eq('id', note.id);

                if (error) throw error;
            }

            // Set all linked orders back to CONFIRMED → DB trigger restores stock
            const parcelsTable = isCourierNote ? 'courier_parcels' : 'company_parcels';
            const noteIdField = isCourierNote ? 'courier_delivery_note_id' : 'company_delivery_note_id';

            const { data: linkedParcels } = await (supabase as any)
                .from(parcelsTable)
                .select('order_id')
                .eq(noteIdField, note.id)
                .not('order_id', 'is', null);

            if (linkedParcels && linkedParcels.length > 0) {
                const { data: confirmedStatus } = await supabase
                    .from('order_statuses')
                    .select('id')
                    .eq('label', 'CONFIRMER')
                    .single();

                if (confirmedStatus) {
                    const orderIds = linkedParcels.map((p: any) => p.order_id);
                    await supabase
                        .from('orders')
                        .update({ order_status_id: confirmedStatus.id })
                        .in('id', orderIds);
                }
            }

            toast({
                title: "Bon réouvert",
                description: `Le bon ${note.reference} a été réouvert avec succès.`,
            });

            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });

            if (selectedNote?.id === note.id) {
                setSelectedNote({ ...note, is_finalized: false });
            }

        } catch (error) {
            toast({
                title: "Erreur de réouverture",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsReopening(false);
        }
    };


    const handleDeleteNote = async () => {
        if (!selectedNote) return;

        const isCompanyNote = selectedNote.provider_id != null;

        try {
            if (isCompanyNote) {
                if (selectedNote.is_finalized) {
                    toast({
                        title: 'Suppression impossible',
                        description: 'Seuls les bons ouverts (non finalisés) peuvent être supprimés.',
                        variant: 'destructive',
                    });
                    return;
                }
                await deleteOpenCompanyDeliveryNote(selectedNote.id);
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
            } else {
                const { error: parcelsError } = await supabase
                    .from('courier_parcels')
                    .delete()
                    .eq('courier_delivery_note_id', selectedNote.id);
                if (parcelsError) throw parcelsError;
                const { error: noteError } = await supabase
                    .from('courier_delivery_notes')
                    .delete()
                    .eq('id', selectedNote.id);
                if (noteError) throw noteError;
            }

            toast({
                title: 'Supprimé',
                description: isCompanyNote
                    ? 'Le bon a été supprimé. Les commandes concernées ont été remises en confirmée lorsque applicable.'
                    : 'Le bon coursier et ses colis ont été supprimés.',
            });

            setIsDeleteModalOpen(false);
            setIsViewModalOpen(false);
            setNoteDetails(null);
            setSelectedNote(null);

            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-zone'] });

        } catch (error: any) {
            const blob = `${error?.message ?? ''} ${error?.details ?? ''}`;
            let description = error?.message ?? 'Échec de la suppression.';
            if (blob.includes('note_finalized')) {
                description = 'Ce bon est finalisé et ne peut pas être supprimé.';
            } else if (blob.includes('forbidden')) {
                description = 'Action non autorisée.';
            } else if (blob.includes('note_not_found')) {
                description = 'Bon introuvable.';
            }
            toast({
                title: 'Erreur',
                description,
                variant: 'destructive'
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
                    .select('name, business_name, logo_url, provider_type, color')
                    .eq('id', selectedNote.provider_id)
                    .single();
                providerInfo = provider;
            } else if (!isCompanyNote && selectedNote.courier_id) {
                const { data: courier } = await supabase
                    .from('users')
                    .select('name, phone, email, avatar_url')
                    .eq('id', selectedNote.courier_id)
                    .single();
                providerInfo = {
                    name: courier?.name,
                    business_name: courier?.name,
                    phone: courier?.phone,
                    email: courier?.email,
                    avatar_url: courier?.avatar_url,
                    isCourier: true,
                };
            }

            // Fetch parcels with tracking codes
            let parcels: any[] = [];
            if (isCompanyNote) {
                const { data } = await supabase
                    .from('company_parcels')
                    .select('id, reference, order_id, status_id, tracking_code, status_label, external_id, provider_id')
                    .eq('company_delivery_note_id', selectedNote.id);
                parcels = data || [];
            } else {
                const { data } = await (supabase as any)
                    .from('courier_parcels')
                    .select('id, reference, order_id, status_id, status_label, status_color, tracking_code, courier_id, created_at')
                    .eq('courier_delivery_note_id', selectedNote.id);
                parcels = data || [];
            }

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

    // Fetch company delivery notes created by this seller only
    const { data: companyNotes, isLoading: loadingCompany } = useQuery({
        queryKey: ['seller-company-delivery-notes', activeBusinessId, sellerShippingCtx?.userId],
        queryFn: async () => {
            if (!activeBusinessId || !sellerShippingCtx?.userId) return [];
            const { data, error } = await supabase
                .from('company_delivery_notes')
                .select(`
                    *,
                    providers:provider_id (
                        id,
                        name,
                        provider_type,
                        logo_url,
                        business_name,
                        color
                    )
                `)
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', sellerShippingCtx.userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!activeBusinessId && !!sellerShippingCtx?.userId,
    });

    // Fetch courier delivery notes created by this seller only
    const { data: courierNotes, isLoading: loadingCourier } = useQuery({
        queryKey: ['seller-courier-delivery-notes', activeBusinessId, sellerShippingCtx?.userId],
        queryFn: async () => {
            if (!activeBusinessId || !sellerShippingCtx?.userId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_delivery_notes')
                .select(`
                    *,
                    courier:users!courier_delivery_notes_courier_id_fkey(id, name, avatar_url, phone)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', sellerShippingCtx.userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!activeBusinessId && !!sellerShippingCtx?.userId,
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

    const getProviderColor = (provider: any) => provider?.color || '#3b82f6';

    const renderNoteCard = (note: any, type: 'company' | 'courier') => {
        const isCourier = type === 'courier';
        const provider = note.providers;
        const courier = note.courier;
        const brandColor = isCourier ? '#2d6d6c' : getProviderColor(provider);
        const displayName = isCourier
            ? (courier?.name || 'Local')
            : (provider?.business_name || provider?.name || 'N/A');
        const logoUrl = !isCourier ? provider?.logo_url : null;
        const avatarUrl = isCourier ? courier?.avatar_url : null;

        return (
            <Card key={note.id} className="group relative overflow-hidden border border-gray-100 shadow-none rounded-xl">
                <div className="absolute top-0 left-0 w-full h-[3px]" style={{ backgroundColor: brandColor }} />

                <CardContent className="p-3.5 space-y-3">
                    <div className="flex justify-between items-start gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {logoUrl ? (
                                <div className="p-1.5 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-center min-w-[40px]">
                                    <img src={logoUrl} alt={displayName} className="w-8 h-8 object-contain" />
                                </div>
                            ) : avatarUrl ? (
                                <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100 shrink-0">
                                    <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>
                                    {isCourier ? <Truck className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px] font-semibold text-brand-navy tracking-tight truncate">{note.reference}</span>
                                    {!note.is_finalized && (
                                        <Badge className="bg-amber-50 text-amber-600 border-none text-[9px] uppercase px-1.5 rounded">Draft</Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 text-gray-400 mt-0.5">
                                    <Calendar className="w-2.5 h-2.5" />
                                    <span className="text-[10px]">
                                        {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>
                                {isCourier ? <Truck className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] leading-none">
                                    {isCourier ? 'Courier' : 'Provider'}
                                </span>
                                <span className="text-[11px] font-semibold text-brand-navy truncate mt-0.5">{displayName}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>
                                <Package className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] leading-none">Parcels</span>
                                <span className="text-[11px] font-semibold text-brand-navy mt-0.5">{note.parcel_count || 0} units</span>
                            </div>
                        </div>
                    </div>

                    <Separator className="bg-gray-100" />

                    <div className="flex items-center justify-between gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsViewModalOpen(true);
                            }}
                            className="text-[11px] font-semibold gap-1.5 rounded-md h-8 px-3 hover:bg-gray-100"
                            style={{ color: brandColor }}
                        >
                            <Eye className="w-3.5 h-3.5" /> Preview
                        </Button>

                        <div className="flex items-center gap-1">
                            {!note.is_finalized && (note.provider_id || note.courier_id) && (
                                <Button size="icon" variant="ghost" onClick={() => handleFinalizeNote(note)}
                                    className="h-8 w-8 rounded-md text-emerald-600 hover:bg-emerald-50" title="Finaliser">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                </Button>
                            )}
                            {note.is_finalized && (note.provider_id || note.courier_id) && (
                                <Button size="icon" variant="ghost" onClick={() => handleReopenNote(note)} disabled={isReopening}
                                    className="h-8 w-8 rounded-md text-amber-600 hover:bg-amber-50 disabled:opacity-50" title="Réouvrir">
                                    {isReopening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                                </Button>
                            )}
                            {!note.is_finalized && note.provider_id && (
                                <Button size="icon" variant="ghost" onClick={() => { setWizardProviderId(note.provider_id); setIsWizardOpen(true); }}
                                    className="h-8 w-8 rounded-md text-brand-navy/50 hover:bg-gray-100" title="Add Orders">
                                    <PlusCircle className="w-3.5 h-3.5" />
                                </Button>
                            )}
                            {!note.is_finalized && isCourier && note.courier_id && (
                                <Button size="icon" variant="ghost" onClick={() => { setCourierWizardLockId(note.courier_id); setIsCourierWizardOpen(true); }}
                                    className="h-8 w-8 rounded-md text-brand-navy/50 hover:bg-gray-100" title="Add Orders">
                                    <PlusCircle className="w-3.5 h-3.5" />
                                </Button>
                            )}
                            {!note.is_finalized && (
                                <Button size="icon" variant="ghost" onClick={() => { setSelectedNote(note); setIsDeleteModalOpen(true); }}
                                    className="h-8 w-8 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Supprimer">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderNoteTable = (notes: any[], type: 'company' | 'courier') => (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-gray-100">
                            <th className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Reference &amp; Date</th>
                            <th className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Provider / Courier</th>
                            <th className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Shipment Info</th>
                            <th className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {notes.map((note) => {
                            const isCourier = type === 'courier';
                            const provider = note.providers;
                            const courier = note.courier;
                            const brandColor = isCourier ? '#2d6d6c' : getProviderColor(provider);
                            const displayName = isCourier
                                ? (courier?.name || 'Local')
                                : (provider?.business_name || provider?.name || 'Local');
                            const logoUrl = !isCourier ? provider?.logo_url : null;
                            const avatarUrl = isCourier ? courier?.avatar_url : null;

                            return (
                                <tr key={note.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>
                                                <FileText className="w-3.5 h-3.5" />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[11px] font-semibold text-brand-navy/80 tabular-nums truncate">
                                                        {note.reference}
                                                    </span>
                                                    {!note.is_finalized && (
                                                        <Badge className="bg-amber-50 text-amber-600 border-none text-[9px] uppercase px-1.5 rounded">Draft</Badge>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-gray-400">
                                                    {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                                {logoUrl ? (
                                                    <img src={logoUrl} alt="" className="w-full h-full object-contain p-1" />
                                                ) : avatarUrl ? (
                                                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    isCourier ? <Truck className="w-3 h-3 text-brand-navy/50" /> : <Building2 className="w-3 h-3 text-brand-navy/50" />
                                                )}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.12em] leading-none">
                                                    {isCourier ? 'Courier' : 'Provider'}
                                                </span>
                                                <span className="text-[11px] font-semibold text-brand-navy/80 truncate mt-0.5">{displayName}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-navy/80 tabular-nums">
                                                <Package className="w-3 h-3 text-gray-400" />
                                                {note.parcel_count || 0} Parcels
                                            </div>
                                            <span className="text-[9px] text-gray-400 uppercase tracking-[0.12em]">
                                                ID: {note.id.split('-')[0]}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setSelectedNote(note);
                                                    setIsViewModalOpen(true);
                                                }}
                                                className="h-8 w-8 rounded-md hover:bg-gray-100 text-brand-navy/50"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </Button>
                                            {!note.is_finalized && (note.provider_id || note.courier_id) && (
                                                <Button variant="ghost" size="icon" onClick={() => handleFinalizeNote(note)}
                                                    className="h-8 w-8 rounded-md text-emerald-600 hover:bg-emerald-50" title="Finaliser">
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                </Button>
                                            )}
                                            {note.is_finalized && (note.provider_id || note.courier_id) && (
                                                <Button variant="ghost" size="icon" onClick={() => handleReopenNote(note)} disabled={isReopening}
                                                    className="h-8 w-8 rounded-md text-amber-600 hover:bg-amber-50 disabled:opacity-50" title="Réouvrir">
                                                    {isReopening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                                                </Button>
                                            )}
                                            {!note.is_finalized && note.provider_id && (
                                                <Button variant="ghost" size="icon"
                                                    onClick={() => { setWizardProviderId(note.provider_id); setIsWizardOpen(true); }}
                                                    className="h-8 w-8 rounded-md text-brand-navy/50 hover:bg-gray-100" title="Add Orders">
                                                    <PlusCircle className="w-3.5 h-3.5" />
                                                </Button>
                                            )}
                                            {!note.is_finalized && isCourier && note.courier_id && (
                                                <Button variant="ghost" size="icon"
                                                    onClick={() => { setCourierWizardLockId(note.courier_id); setIsCourierWizardOpen(true); }}
                                                    className="h-8 w-8 rounded-md text-brand-navy/50 hover:bg-gray-100" title="Add Orders">
                                                    <PlusCircle className="w-3.5 h-3.5" />
                                                </Button>
                                            )}
                                            {!note.is_finalized && (
                                                <Button variant="ghost" size="icon"
                                                    onClick={() => { setSelectedNote(note); setIsDeleteModalOpen(true); }}
                                                    className="h-8 w-8 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50" title="Supprimer">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            )}
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Delivery Notes</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Manage &amp; track outgoing shipment documents</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search by reference or provider..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 w-56 rounded-md border-gray-200 bg-white text-[11px]"
                            />
                        </div>
                        <Button
                            onClick={() => {
                                if (activeTab === 'courier') {
                                    setIsCourierWizardOpen(true);
                                } else {
                                    setIsWizardOpen(true);
                                }
                            }}
                            className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {activeTab === 'courier' ? 'Courier Note' : 'Generate Note'}
                        </Button>
                    </div>
                </div>
                {sellerShippingCtx && sellerShippingCtx.productIds.length === 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-900 text-[11px] font-semibold">
                        No products are assigned to your account. Assign products in your profile to create delivery notes.
                    </div>
                )}
            </header>

            {/* Content Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'company' | 'courier')} className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <TabsList className="h-8">
                            <TabsTrigger value="company" className="text-[11px] h-6 px-3">Company Notes</TabsTrigger>
                            <TabsTrigger value="courier" className="text-[11px] h-6 px-3">Courier Notes</TabsTrigger>
                        </TabsList>
                        {/* View Switcher */}
                        <div className="flex border border-gray-200 rounded-md overflow-hidden shrink-0">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={cn("h-8 w-8 flex items-center justify-center transition-colors",
                                    viewMode === 'grid' ? "bg-brand-navy text-white" : "bg-white text-gray-400 hover:text-brand-navy hover:bg-gray-50")}
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={cn("h-8 w-8 flex items-center justify-center border-l border-gray-200 transition-colors",
                                    viewMode === 'list' ? "bg-brand-navy text-white" : "bg-white text-gray-400 hover:text-brand-navy hover:bg-gray-50")}
                            >
                                <List className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-medium text-brand-navy/60">Live</span>
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    {loadingCompany ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
                        </div>
                    ) : companyNotes?.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            No company delivery notes yet. Click &quot;Generate Note&quot; to create one.
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


            {/* Delivery Note Wizard (Company) */}
            <DeliveryNoteWizard
                open={isWizardOpen}
                onOpenChange={(open) => {
                    setIsWizardOpen(open);
                    if (!open) {
                        setWizardProviderId(undefined);
                    }
                }}
                lockProviderId={wizardProviderId}
                sellerScope={sellerScope}
            />

            {/* Delivery Note Wizard (Courier — pure internal) */}
            <CourierDeliveryNoteWizard
                open={isCourierWizardOpen}
                onOpenChange={(open) => {
                    setIsCourierWizardOpen(open);
                    if (!open) setCourierWizardLockId(undefined);
                }}
                lockCourierId={courierWizardLockId}
                sellerScope={sellerScope}
            />


            {/* Preview Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="sm:max-w-[700px] rounded-xl border border-gray-100 shadow-none p-0 overflow-hidden bg-white">
                    <div className="p-4 space-y-3.5 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-start gap-3">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Delivery Note</p>
                                <p className="text-[13px] font-semibold text-brand-navy mt-0.5">{selectedNote?.reference}</p>
                            </div>
                            {noteDetails?.provider?.logo_url ? (
                                <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-center min-w-[48px]">
                                    <img src={noteDetails.provider.logo_url} alt="Provider Logo" className="h-7 w-auto object-contain" />
                                </div>
                            ) : noteDetails?.provider?.avatar_url ? (
                                <div className="w-9 h-9 rounded-lg border border-gray-100 overflow-hidden shrink-0">
                                    <img src={noteDetails.provider.avatar_url} alt={noteDetails.provider.name || 'Courier'} className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-9 h-9 bg-brand-navy rounded-lg flex items-center justify-center text-white shrink-0">
                                    {noteDetails?.provider?.isCourier ? <Truck className="w-4 h-4" /> : <span className="text-[11px] font-semibold">D</span>}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] font-bold mb-1">
                                    {noteDetails?.provider?.isCourier ? 'Courier' : 'Provider'}
                                </p>
                                <p className="text-[11px] font-semibold text-brand-navy">{noteDetails?.provider?.business_name || noteDetails?.provider?.name || 'Loading...'}</p>
                                {noteDetails?.provider?.isCourier && noteDetails?.provider?.phone && (
                                    <p className="text-[10px] text-gray-500 mt-0.5">Phone: {noteDetails.provider.phone}</p>
                                )}
                                {!noteDetails?.provider?.isCourier && (
                                    <p className="text-[10px] text-gray-500 mt-0.5">{noteDetails?.provider?.provider_type?.toUpperCase() || 'N/A'}</p>
                                )}
                            </div>
                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-right">
                                <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] font-bold mb-1">Details</p>
                                <p className="text-[11px] font-semibold text-brand-navy">{selectedNote?.parcel_count || 0} Parcels</p>
                                <p className="text-[10px] text-gray-500 mt-0.5">{selectedNote?.created_at ? format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-100 overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/60">
                                        <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">Tracking</th>
                                        <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">Order Ref</th>
                                        <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">Status</th>
                                        <th className="px-3 py-2 text-right text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {!noteDetails ? (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-6 text-center text-[11px] text-gray-400">Loading parcels...</td>
                                        </tr>
                                    ) : noteDetails.parcels.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-6 text-center text-[11px] text-gray-400">No parcels in this delivery note</td>
                                        </tr>
                                    ) : (
                                        noteDetails.parcels.map((parcel: any) => (
                                            <tr key={parcel.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums font-medium">{parcel.tracking_code || parcel.reference}</td>
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{parcel.order_id?.slice(0, 8)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {parcel.real_time_status_label ? (
                                                        <Badge
                                                            className="border-none text-[9px] font-semibold px-1.5 py-0.5 rounded shadow-none"
                                                            style={{
                                                                backgroundColor: parcel.real_time_status_color ? `${parcel.real_time_status_color}15` : '#10b98115',
                                                                color: parcel.real_time_status_color || '#10b981'
                                                            }}
                                                        >
                                                            {parcel.real_time_status_label}
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-emerald-50 text-emerald-600 border-none text-[9px] font-semibold px-1.5 py-0.5 rounded shadow-none">
                                                            {parcel.status_label || parcel.status_id || 'Nouveau'}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                                        {parcel.tracking_code && (
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 shrink-0 rounded-md text-brand-navy hover:bg-gray-100"
                                                                title="Suivi"
                                                                aria-label="Suivi"
                                                                onClick={() => handleTrackParcel(parcel)}
                                                            >
                                                                <Clock className="h-3.5 w-3.5" />
                                                            </Button>
                                                        )}
                                                        {(selectedNote?.provider_id || selectedNote?.courier_id) && !selectedNote?.is_finalized && (
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 shrink-0 rounded-md text-red-500 hover:bg-red-50 hover:text-red-600"
                                                                title="Retirer du bon"
                                                                aria-label="Retirer du bon"
                                                                disabled={removingParcelId === parcel.id}
                                                                onClick={() => openRemoveParcelDialog(parcel)}
                                                            >
                                                                {removingParcelId === parcel.id ? (
                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                )}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            {!selectedNote?.is_finalized && (
                                <Button
                                    onClick={() => setIsDeleteModalOpen(true)}
                                    variant="ghost"
                                    className="h-8 rounded-md px-3 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center gap-1.5"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Supprimer
                                </Button>
                            )}

                            {!selectedNote?.is_finalized && (selectedNote?.provider_id || selectedNote?.courier_id) && (
                                <Button
                                    onClick={() => handleFinalizeNote(selectedNote)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Finaliser le Bon
                                </Button>
                            )}

                            {selectedNote?.is_finalized && (selectedNote?.provider_id || selectedNote?.courier_id) && (
                                <Button
                                    onClick={() => handleReopenNote(selectedNote)}
                                    disabled={isReopening}
                                    className="bg-amber-500 hover:bg-amber-600 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {isReopening ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Unlock className="w-4 h-4" />
                                    )}
                                    {isReopening ? 'Réouverture...' : 'Réouvrir le Bon'}
                                </Button>
                            )}

                            {noteDetails?.provider?.isCourier ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-xl p-1 border border-gray-100 shadow-none bg-white min-w-[220px]">
                                        <DropdownMenuItem
                                            className="rounded-xl font-bold py-3 cursor-pointer"
                                            onClick={async () => {
                                                if (!selectedNote?.id) return;
                                                try {
                                                    await printCourierDeliveryNote(selectedNote.id, 'sticker');
                                                } catch (e) {
                                                    console.error('[courier-label] caller caught error', e);
                                                    toast({ title: 'Erreur', description: (e as Error).message || String(e), variant: 'destructive' });
                                                }
                                            }}
                                        >
                                            Étiquette 100×100
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="rounded-xl font-bold py-3 cursor-pointer text-blue-600"
                                            onClick={async () => {
                                                if (!selectedNote?.id) return;
                                                try {
                                                    await printCourierDeliveryNote(selectedNote.id, 'note');
                                                } catch (e) {
                                                    console.error('[courier-label] caller caught error', e);
                                                    toast({ title: 'Erreur', description: (e as Error).message || String(e), variant: 'destructive' });
                                                }
                                            }}
                                        >
                                            Bon de Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : noteDetails?.provider?.provider_type === 'ameex' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-xl p-1 border border-gray-100 shadow-none bg-white min-w-[200px]">
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
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-xl p-1 border border-gray-100 shadow-none bg-white min-w-[200px]">
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
                                        <Button className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5">
                                            <Download className="w-4 h-4" />
                                            Imprimer
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-xl p-1 border border-gray-100 shadow-none bg-white min-w-[200px]">
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
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 rounded-md px-3 text-[11px] font-semibold flex items-center gap-1.5"
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
                <DialogContent className="sm:max-w-[500px] rounded-xl border border-gray-100 p-0 overflow-hidden bg-white">
                    <DialogHeader className="p-4 pb-0">
                        <DialogTitle className="text-[15px] font-semibold text-brand-navy flex items-center gap-2">
                            <Truck className="w-4 h-4 text-brand-navy/50" />
                            Suivi du colis
                        </DialogTitle>
                        <DialogDescription className="font-bold text-muted-foreground">
                            Code: <span className="text-brand-navy">{trackingParcel?.tracking_code}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-4 max-h-[60vh] overflow-y-auto">
                        {isTrackingLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
                                <p className="text-[11px] text-gray-400">Récupération des données...</p>
                            </div>
                        ) : trackingHistory ? (
                            <div className="relative pl-8">
                                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gray-200" />
                                <div className="space-y-0">
                                {(() => {
                                    const events = Array.isArray(trackingHistory)
                                        ? trackingHistory
                                        : (trackingHistory?.history || []);
                                    return [...events].reverse(); // oldest first
                                })().map((event: any, idx: number, arr: any[]) => {
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
                                    const situationMap: Record<string, { label: string; className: string }> = {
                                        PAID: { label: 'Payé', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                                        NOT_PAID: { label: 'Non payé', className: 'bg-amber-50 text-amber-700 border-amber-200' },
                                        INVOICED: { label: 'Facturé', className: 'bg-blue-50 text-blue-700 border-blue-200' },
                                    };

                                    const rawStatus = event.status || "Nouveau";
                                    const statusLabel = event.statusLabel; // AMEEX provides this
                                    const status = statusLabel || statusMap[rawStatus] || rawStatus;
                                    const date = event.date;
                                    const comment = event.comment || "";
                                    const u = event.user;
                                    const user = (typeof u === 'object' && u !== null && 'name' in u ? (u as { name?: string }).name : (u as string | undefined)) || "";

                                    const phone = (event.phone as string) || '';
                                    const hub = (event.hub as string) || '';
                                    const city = (event.city as string) || '';
                                    const situation = (event.situation as string) || '';
                                    const scheduledDate = event.scheduledDate as string | undefined;
                                    const statusColor = (event.color as string) || '';
                                    const dataList = (event.data_list as any[]) || [];
                                    const eventFor = (event.eventFor as string) || '';

                                    // Determine location string
                                    const locationParts = [hub, city].filter(Boolean);
                                    const location = locationParts.length > 0 ? locationParts.join(' — ') : '';

                                    // Filter data_list: remove items already shown elsewhere
                                    const meaningfulDataList = dataList.filter(item => {
                                        if (!item || !item.title) return false;
                                        // Skip if it's a distribution count
                                        if (item.title === 'Nombre de distributions') return false;
                                        return true;
                                    });

                                    const sitInfo = situation ? situationMap[situation] : null;
                                    const isLast = idx === arr.length - 1;

                                    return (
                                        <div key={idx} className="relative pb-6 last:pb-0 group">
                                            <div
                                                className={`absolute -left-10 top-0 w-8 h-8 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center z-10 transition-all group-hover:scale-110 ${isLast ? 'ring-2 ring-offset-2' : ''}`}
                                                style={{ backgroundColor: isLast ? (statusColor || '#94a3b8') : '#f8fafc', color: isLast ? '#ffffff' : (statusColor || '#94a3b8'), ['--tw-ring-color' as any]: isLast ? `${statusColor || '#94a3b8'}40` : undefined }}
                                            >
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : (statusColor || '#94a3b8') }} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded" style={{ color: statusColor || '#94a3b8', backgroundColor: `${statusColor || '#94a3b8'}15` }}>
                                                        {status}
                                                    </span>
                                                    {sitInfo && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${sitInfo.className}`}>{sitInfo.label}</span>}
                                                </div>
                                                {date && <p className="text-[10px] font-bold text-muted-foreground/50">{format(new Date(date), 'dd/MM/yyyy HH:mm')}</p>}

                                                {/* Location (hub / city) */}
                                                {location && (
                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/70">
                                                        <MapPin className="w-3 h-3 shrink-0" />
                                                        <span>{location}</span>
                                                    </div>
                                                )}

                                                {/* Comment */}
                                                {comment && (
                                                    <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
                                                        "{comment}"
                                                    </p>
                                                )}

                                                {/* Courier info (name + phone) */}
                                                {(user || phone) && (
                                                    <div className="flex items-center gap-3 flex-wrap">
                                                        {user && (
                                                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                                                                <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center">
                                                                    <Hash className="w-2 h-2" />
                                                                </div>
                                                                Par {user}
                                                            </div>
                                                        )}
                                                        {phone && (
                                                            <a
                                                                href={`tel:${phone}`}
                                                                className="flex items-center gap-1 text-[10px] font-bold text-brand-navy/70 hover:text-brand-navy transition-colors"
                                                            >
                                                                <Phone className="w-3 h-3" />
                                                                {phone}
                                                            </a>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Scheduled date */}
                                                {scheduledDate && (
                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-600/70">
                                                        <CalendarClock className="w-3 h-3 shrink-0" />
                                                        <span>Programmé: {format(new Date(scheduledDate), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                )}

                                                {/* Data list items */}
                                                {meaningfulDataList.length > 0 && (
                                                    <div className="mt-1 space-y-0.5">
                                                        {meaningfulDataList.map((item, i) => {
                                                            const isItemPhone = /^0[5-8]\d{8}$/.test(String(item.value));
                                                            const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.value));

                                                            return (
                                                                <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/80">
                                                                    <Info className="w-2.5 h-2.5 shrink-0 opacity-50" />
                                                                    <span className="font-semibold">{item.title}:</span>
                                                                    {isItemPhone ? (
                                                                        <a href={`tel:${item.value}`} className="text-brand-navy/70 hover:text-brand-navy font-bold transition-colors">
                                                                            {item.value}
                                                                        </a>
                                                                    ) : isDate ? (
                                                                        <span className="text-blue-600/70 font-semibold">{item.value}</span>
                                                                    ) : (
                                                                        <span className="font-semibold">{item.value}</span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                                <SearchX className="w-6 h-6 text-gray-400" />
                                <p className="text-[11px] font-medium text-gray-400">Aucun historique disponible pour ce colis.</p>
                            </div>
                        )}
                    </div>

                    <div className="p-4 pt-0">
                        <Button
                            variant="ghost"
                            onClick={() => setIsTrackingModalOpen(false)}
                            className="w-full h-8 rounded-md text-[11px] font-semibold hover:bg-gray-50"
                        >
                            Fermer
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>


            {/* Delete Confirmation */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent className="sm:max-w-[400px] rounded-xl border border-gray-100 p-5 text-center space-y-4">
                    <div className="space-y-2">
                        <DialogTitle className="text-[15px] font-semibold text-brand-navy">Supprimer le bon ?</DialogTitle>
                        <DialogDescription className="text-[11px] text-gray-400">
                            {selectedNote?.provider_id != null ? (
                                <>
                                    Le bon{' '}
                                    <span className="font-semibold text-brand-navy">{selectedNote?.reference}</span> sera
                                    supprimé. Les commandes qui n'ont plus d'autre colis repasseront en{' '}
                                    <span className="font-semibold text-brand-navy">confirmée</span> et leur logistique sera
                                    effacée.
                                </>
                            ) : (
                                <>
                                    Cette action est définitive. Le bon coursier{' '}
                                    <span className="font-semibold text-brand-navy">{selectedNote?.reference}</span> et ses
                                    colis seront supprimés.
                                </>
                            )}
                        </DialogDescription>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button
                            variant="destructive"
                            onClick={handleDeleteNote}
                            className="h-8 rounded-md text-[11px] font-semibold"
                        >
                            Confirm Deletion
                        </Button>
                        <Button variant="ghost" onClick={() => setIsDeleteModalOpen(false)} className="h-8 rounded-md text-[11px] font-semibold text-brand-navy">
                            Keep Record
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={!!parcelPendingRemove}
                onOpenChange={(open) => {
                    if (!open) setParcelPendingRemove(null);
                }}
            >
                <AlertDialogContent className="rounded-xl border border-gray-100 max-w-md p-5">
                    <AlertDialogHeader className="space-y-2">
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">
                            Retirer ce colis du bon ?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-400">
                            La commande repassera en confirmée et la logistique (transporteur, suivi, statuts) sera
                            effacée.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
                        <AlertDialogCancel className="rounded-md h-8 text-[11px] font-semibold border border-gray-200 text-brand-navy hover:bg-gray-50 m-0">
                            Annuler
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            className="rounded-md h-8 text-[11px] font-semibold m-0 w-full sm:w-auto"
                            disabled={!!removingParcelId}
                            onClick={() => void confirmRemoveParcelFromNote()}
                        >
                            {removingParcelId === parcelPendingRemove?.id ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : null}
                            Retirer
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default DeliveryNote;

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { matchPackageStatus } from '@/lib/matchPackageStatus';
import { DynamicIcon } from '@/lib/renderReactIcon';
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
    User,
    Unlock,
    Phone,
    MapPin,
    CalendarClock,
    Info,
    ExternalLink
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
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    // Active package statuses — used to resolve a timeline event's icon + color from its raw provider status.
    const { data: pkgStatuses } = useQuery({
        queryKey: ['package-statuses-icons'],
        queryFn: async () => {
            const { data } = await supabase
                .from('package_statuses')
                .select('id, code, label, color, icon, delivery_service_statuses')
                .eq('active', true)
                .eq('show_in_courier', true);
            return (data || []) as Array<{ id: string; code: string; label: string; color: string | null; icon: string | null; delivery_service_statuses: string[] | null; }>;
        },
        staleTime: 5 * 60 * 1000,
    });

    const matchPkgStatus = (rawStatus: string | undefined | null, statusLabel: string | undefined | null) => {
        if (!pkgStatuses?.length) return null;
        const candidates = [statusLabel, rawStatus].filter(Boolean).map(String);
        for (const c of candidates) {
            const lower = c.toLowerCase();
            const byDss = pkgStatuses.find(ps => ps.delivery_service_statuses?.some(s => s.toLowerCase() === lower));
            if (byDss) return byDss;
            const byLabel = pkgStatuses.find(ps => ps.label.toLowerCase() === lower);
            if (byLabel) return byLabel;
            const byCode = pkgStatuses.find(ps => ps.code.toLowerCase() === lower);
            if (byCode) return byCode;
        }
        return null;
    };

    const handleTrackParcel = async (parcel: any) => {
        setTrackingParcel(parcel);
        setIsTrackingModalOpen(true);
        setIsTrackingLoading(true);
        setTrackingHistory(null);

        const isCourierParcel = !parcel.provider_id && !selectedNote?.provider_id;
        if (isCourierParcel) {
            // Internal-only tracking — synthesize a single timeline event from the parcel row.
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
                    // map to internal status (containment → RPC → ilike fallback)
                    const matched = await matchPackageStatus(supabase, providerStatus);
                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matched?.id ?? null,
                            status_label: matched?.label ?? providerStatus,
                            status_color: matched?.color ?? providerColor ?? null,
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

                // Fetch the parcel's order first so we can reset it.
                const { data: parcelRow, error: parcelLookupError } = await (supabase as any)
                    .from('courier_parcels')
                    .select('order_id')
                    .eq('id', parcelId)
                    .maybeSingle();
                if (parcelLookupError) throw parcelLookupError;
                const orderId = parcelRow?.order_id;

                // Delete the parcel itself.
                const { error: delError } = await (supabase as any)
                    .from('courier_parcels')
                    .delete()
                    .eq('id', parcelId);
                if (delError) throw delError;

                // Reset the order back to confirmed and clear its courier pointer.
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

                // Refresh parcel_count on the note.
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
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
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
                // Courier notes are purely internal — just flip is_finalized.
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

                // Update database
                const { error } = await supabase
                    .from('company_delivery_notes')
                    .update({ is_finalized: true })
                    .eq('id', note.id);

                if (error) throw error;
            }

            // Set all linked orders to PROCESSED → DB trigger deducts stock.
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

            // Refresh queries
            queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });

            // If the modal is open, update the local state
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
                // Courier notes are purely internal — just flip is_finalized.
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
                // Ameex & Ozon: call edge function to reopen on provider side + DB
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
                // Coliaty & others: internal DB-only reopen (no external API)
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
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
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
                const noteIdField = 'courier_delivery_note_id';
                const { error: parcelsError } = await supabase
                    .from('courier_parcels')
                    .delete()
                    .eq(noteIdField, selectedNote.id);
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
            queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-zone'] });

        } catch (error) {
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
                                // Validate result.data is a real status object (not null, not empty array)
                                if (result.success && result.data && !Array.isArray(result.data) && (result.data.statusLabel || result.data.status)) {
                                    const providerStatus = result.data.statusLabel || result.data.status;
                                    const providerColor = result.data.statusColor || result.data.color;

                                    // Map provider status to internal package_statuses (containment → RPC → ilike fallback)
                                    const matched = await matchPackageStatus(supabase, providerStatus);
                                    const mappedStatusId = matched?.id ?? parcel.status_id ?? null;
                                    const finalLabel = matched?.label ?? providerStatus;
                                    const finalColor = matched?.color ?? providerColor ?? null;

                                    // Persist to database if status or color changed
                                    if (mappedStatusId !== parcel.status_id || finalLabel !== parcel.status_label || finalColor !== parcel.status_color) {
                                        await supabase
                                            .from('company_parcels')
                                            .update({
                                                status_id: mappedStatusId,
                                                status_label: finalLabel,
                                                status_color: finalColor,
                                                provider_response: result.data
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
                        business_name,
                        color
                    ),
                    creator:users!company_delivery_notes_created_by_fkey(name, avatar_url, role)
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
            const { data, error } = await (supabase as any)
                .from('courier_delivery_notes')
                .select(`
                    *,
                    courier:users!courier_delivery_notes_courier_id_fkey(id, name, avatar_url, phone),
                    creator:users!courier_delivery_notes_created_by_fkey(id, name, avatar_url, role)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        }
    });

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'delivered':
                return <Badge className="bg-ant-green/10 text-ant-green border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Delivered</Badge>;
            case 'pending':
                return <Badge className="bg-ant-orange/10 text-ant-orange border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Clock className="w-3 h-3" /> Pending</Badge>;
            case 'picked_up':
                return <Badge className="bg-indigo-50 text-indigo-600 border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5"><Truck className="w-3 h-3" /> Picked Up</Badge>;
            default:
                return <Badge className="bg-ant-light text-ant-muted border-none font-bold text-[10px] tracking-widest px-3 py-1.5 rounded-xl uppercase flex items-center gap-1.5">{status}</Badge>;
        }
    };

    const getProviderColor = (provider: any) => provider?.color || '#3b82f6';

    const renderNoteCard = (note: any, type: 'company' | 'courier') => {
        const isCourier = type === 'courier';
        const provider = note.providers;
        const courier = note.courier;
        const brandColor = isCourier ? '#788c5d' : getProviderColor(provider);
        const displayName = isCourier
            ? (courier?.name || 'Local')
            : (provider?.business_name || provider?.name || 'N/A');
        const logoUrl = !isCourier ? provider?.logo_url : null;
        const avatarUrl = isCourier ? courier?.avatar_url : null;
        const parcelCount = note.parcel_count || 0;

        return (
            <Card
                key={note.id}
                className="group relative overflow-hidden border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 rounded-2xl"
            >
                {/* Brand color hairline — hugs the inside of the rounded border */}
                <div className="h-[3px]" style={{ backgroundColor: brandColor }} />

                <CardContent className="p-5 space-y-4">
                    {/* Identity row — logo/avatar + reference/draft + meta */}
                    <div className="flex items-start gap-4">
                        {logoUrl ? (
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 p-2 border border-ant-line bg-ant-paper"
                            >
                                <img src={logoUrl} alt={displayName} className="w-full h-full object-contain" />
                            </div>
                        ) : avatarUrl ? (
                            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-ant-line">
                                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                            </div>
                        ) : (
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white"
                                style={{ backgroundColor: brandColor }}
                            >
                                {isCourier ? <Truck className="w-5 h-5" strokeWidth={1.75} /> : <Building2 className="w-5 h-5" strokeWidth={1.75} />}
                            </div>
                        )}

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-display text-[16px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                    {note.reference}
                                </h3>
                                {!note.is_finalized ? (
                                    <span className="inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-orange bg-ant-orange/10 border border-ant-orange/30 px-2 py-0.5 rounded-full">
                                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                        Draft
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-green bg-ant-green/10 border border-ant-green/25 px-2 py-0.5 rounded-full">
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                        Finalized
                                    </span>
                                )}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[11px] text-ant-muted">
                                <span className="flex items-center gap-1 tabular-nums">
                                    <Calendar className="w-3 h-3 text-ant-mid" />
                                    {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy · HH:mm') : 'N/A'}
                                </span>
                                {note.creator && (
                                    <span className="flex items-center gap-1 min-w-0">
                                        {note.creator?.avatar_url ? (
                                            <img src={note.creator.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                        ) : (
                                            <User className="w-3 h-3 text-ant-mid shrink-0" />
                                        )}
                                        <span className="truncate">{note.creator?.name ?? 'Unknown'}</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Two-column identity strip on hairline divider row */}
                    <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                        <div className="bg-ant-paper px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: brandColor }} />
                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    {isCourier ? 'Courier' : 'Provider'}
                                </span>
                            </div>
                            <div className="font-display text-[14px] font-semibold text-ant-ink tracking-[-0.01em] leading-tight mt-1 truncate">
                                {displayName}
                            </div>
                        </div>
                        <div className="bg-ant-paper px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                                <Package className="w-2.5 h-2.5 text-ant-mid" strokeWidth={2} />
                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    Parcels
                                </span>
                            </div>
                            <div className="font-display text-[18px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-1">
                                {parcelCount}
                                <span className="text-[10px] font-medium text-ant-mid ml-1">units</span>
                            </div>
                        </div>
                    </div>

                    {/* Actions footer */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setSelectedNote(note);
                                setIsViewModalOpen(true);
                            }}
                            className="flex-1 h-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:border-ant-ink/25 hover:bg-ant-line-soft text-[11.5px] font-medium gap-1.5"
                        >
                            <Eye className="w-3.5 h-3.5" /> Preview
                        </Button>

                        {!note.is_finalized && (note.provider_id || note.courier_id) && (
                            <Button
                                onClick={() => handleFinalizeNote(note)}
                                className="flex-1 h-9 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[11.5px] font-medium gap-1.5"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5 text-ant-orange" /> Finalize
                            </Button>
                        )}
                        {note.is_finalized && (note.provider_id || note.courier_id) && (
                            <Button
                                onClick={() => handleReopenNote(note)}
                                disabled={isReopening}
                                className="flex-1 h-9 rounded-full bg-ant-orange/10 hover:bg-ant-orange/20 text-ant-orange border border-ant-orange/25 text-[11.5px] font-medium gap-1.5 disabled:opacity-50"
                            >
                                {isReopening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                                {isReopening ? 'Reopening…' : 'Reopen'}
                            </Button>
                        )}

                        {!note.is_finalized && note.provider_id && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setWizardProviderId(note.provider_id);
                                    setIsWizardOpen(true);
                                }}
                                className="h-9 w-9 rounded-full text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                                title="Add orders to this note"
                            >
                                <PlusCircle className="w-4 h-4" />
                            </Button>
                        )}
                        {!note.is_finalized && isCourier && note.courier_id && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setCourierWizardLockId(note.courier_id);
                                    setIsCourierWizardOpen(true);
                                }}
                                className="h-9 w-9 rounded-full text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                                title="Add orders to this note"
                            >
                                <PlusCircle className="w-4 h-4" />
                            </Button>
                        )}

                        {!note.is_finalized && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setSelectedNote(note);
                                    setIsDeleteModalOpen(true);
                                }}
                                className="h-9 w-9 rounded-full text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10"
                                title="Delete note"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderNoteTable = (notes: any[], type: 'company' | 'courier') => (
        <div className="bg-ant-paper rounded-2xl overflow-hidden border border-ant-line">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-ant-line-soft">
                            <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Reference & Date</th>
                            <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Provider / Courier</th>
                            <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Shipment Info</th>
                            <th className="px-4 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ant-line">
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
                                <tr key={note.id} className="hover:bg-ant-line-soft transition-colors group">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                                                style={{ backgroundColor: `${brandColor}14`, color: brandColor }}
                                            >
                                                <FileText className="w-4 h-4" strokeWidth={1.75} />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-display text-[13px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                                        {note.reference}
                                                    </span>
                                                    {note.is_finalized ? (
                                                        <span className="inline-flex items-center text-[9px] font-medium uppercase tracking-[0.2em] text-ant-green bg-ant-green/10 border border-ant-green/25 px-1.5 py-0.5 rounded-full">
                                                            Final
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center text-[9px] font-medium uppercase tracking-[0.2em] text-ant-orange bg-ant-orange/10 border border-ant-orange/30 px-1.5 py-0.5 rounded-full">
                                                            Draft
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[10.5px] text-ant-muted tabular-nums">
                                                    {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                                </span>
                                                {note.creator && (
                                                    <span className="text-[10.5px] text-ant-muted flex items-center gap-1 mt-0.5">
                                                        {note.creator?.avatar_url ? (
                                                            <img src={note.creator.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                                                        ) : (
                                                            <User className="w-3 h-3" />
                                                        )}
                                                        {note.creator?.name ?? 'Unknown'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-ant-line-soft flex items-center justify-center overflow-hidden border border-ant-line">
                                                {logoUrl ? (
                                                    <img src={logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
                                                ) : avatarUrl ? (
                                                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    isCourier ? <Truck className="w-4 h-4 text-ant-mid" /> : <Building2 className="w-4 h-4 text-ant-orange" />
                                                )}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em] leading-none">
                                                    {isCourier ? 'Courier' : 'Provider'}
                                                </span>
                                                <span className="text-[13px] font-semibold text-ant-ink truncate mt-1">{displayName}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ant-ink">
                                                <Package className="w-3.5 h-3.5 text-ant-orange" />
                                                {note.parcel_count || 0} Parcels
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">
                                                ID: {note.id.split('-')[0]}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setSelectedNote(note);
                                                    setIsViewModalOpen(true);
                                                }}
                                                className="h-9 w-9 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:border-ant-ink/25 hover:bg-ant-line-soft"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </Button>
                                            {!note.is_finalized && (note.provider_id || note.courier_id) && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleFinalizeNote(note)}
                                                    className="h-9 w-9 rounded-full border border-ant-green/25 bg-ant-green/10 text-ant-green hover:bg-ant-green hover:text-white"
                                                    title="Finaliser le Bon"
                                                >
                                                    <CheckCircle2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {note.is_finalized && (note.provider_id || note.courier_id) && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleReopenNote(note)}
                                                    disabled={isReopening}
                                                    className="h-9 w-9 rounded-full border border-ant-orange/25 bg-ant-orange/10 text-ant-orange hover:bg-ant-orange hover:text-white disabled:opacity-50"
                                                    title="Réouvrir le Bon"
                                                >
                                                    {isReopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                                                </Button>
                                            )}
                                            {!note.is_finalized && note.provider_id && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setWizardProviderId(note.provider_id);
                                                        setIsWizardOpen(true);
                                                    }}
                                                    className="h-9 w-9 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-green hover:text-white hover:border-ant-green"
                                                    title="Add Orders"
                                                >
                                                    <PlusCircle className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {!note.is_finalized && isCourier && note.courier_id && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setCourierWizardLockId(note.courier_id);
                                                        setIsCourierWizardOpen(true);
                                                    }}
                                                    className="h-9 w-9 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-green hover:text-white hover:border-ant-green"
                                                    title="Add Orders"
                                                >
                                                    <PlusCircle className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {!note.is_finalized && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setSelectedNote(note);
                                                        setIsDeleteModalOpen(true);
                                                    }}
                                                    className="h-9 w-9 rounded-xl bg-ant-ink/[0.04] text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10 transition-all shadow-sm"
                                                    title="Supprimer le bon"
                                                >
                                                    <Trash2 className="w-4 h-4" />
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

    const totalCompany = companyNotes?.length || 0;
    const totalCourier = courierNotes?.length || 0;
    const openCompany = (companyNotes || []).filter((n: any) => !n.is_finalized).length;
    const openCourier = (courierNotes || []).filter((n: any) => !n.is_finalized).length;
    const activeList = activeTab === 'company' ? companyNotes : courierNotes;
    const activeLoading = activeTab === 'company' ? loadingCompany : loadingCourier;
    const activeOpen = activeTab === 'company' ? openCompany : openCourier;
    const activeTotal = activeTab === 'company' ? totalCompany : totalCourier;

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Shipping · Documents
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Delivery notes
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Bundle confirmed orders into a handover manifest for couriers and providers.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-full sm:w-[280px]">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder="Search reference or provider…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                        />
                    </div>
                    <Button
                        onClick={() => {
                            if (activeTab === 'courier') setIsCourierWizardOpen(true);
                            else setIsWizardOpen(true);
                        }}
                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {activeTab === 'courier' ? 'New courier note' : 'New note'}
                    </Button>
                </div>
            </header>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <DeliverySummaryTile label={activeTab === 'company' ? 'Company notes' : 'Courier notes'} value={activeTotal} accent="#141413" icon={FileText} />
                <DeliverySummaryTile label="Drafts" value={activeOpen} accent="#d97757" icon={Clock} />
                <DeliverySummaryTile label="Finalized" value={Math.max(0, activeTotal - activeOpen)} accent="#788c5d" icon={CheckCircle2} />
            </div>

            {/* Content Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'company' | 'courier')} className="space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Channel tabs — pill group */}
                        <TabsList className="h-9 p-0.5 rounded-full bg-ant-paper border border-ant-line gap-0">
                            <TabsTrigger
                                value="company"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Building2 className="w-3 h-3" /> Company
                                <span className="text-[10px] tabular-nums opacity-70">{totalCompany}</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="courier"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Truck className="w-3 h-3" /> Courier
                                <span className="text-[10px] tabular-nums opacity-70">{totalCourier}</span>
                            </TabsTrigger>
                        </TabsList>

                        {/* View Switcher — pill group with orange active state */}
                        <ToggleGroup
                            type="single"
                            value={viewMode}
                            onValueChange={(v) => { if (v) setViewMode(v as 'grid' | 'list'); }}
                            className="gap-0 shrink-0 rounded-full border border-ant-line bg-ant-paper p-0.5"
                        >
                            <ToggleGroupItem
                                value="grid"
                                aria-label="Grid view"
                                className="h-8 w-8 p-0 rounded-full border-0 text-ant-mid data-[state=on]:bg-ant-ink data-[state=on]:text-ant-light"
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="list"
                                aria-label="List view"
                                className="h-8 w-8 p-0 rounded-full border-0 text-ant-mid data-[state=on]:bg-ant-ink data-[state=on]:text-ant-light"
                            >
                                <List className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                    </div>

                    <div className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-ant-paper border border-ant-line">
                        <span className="relative inline-flex">
                            <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
                            <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-ant-green animate-ping" />
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Live</span>
                        <span className="text-[11px] font-medium text-ant-ink">History up to date</span>
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    {activeLoading && activeList === companyNotes ? (
                        <DeliveryListSkeleton />
                    ) : !companyNotes || companyNotes.length === 0 ? (
                        <EmptyDeliveryState
                            kind="company"
                            onAction={() => setIsWizardOpen(true)}
                        />
                    ) : (
                        viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {companyNotes.map((note) => renderNoteCard(note, 'company'))}
                            </div>
                        ) : (
                            renderNoteTable(companyNotes, 'company')
                        )
                    )}
                </TabsContent>

                <TabsContent value="courier" className="mt-0">
                    {loadingCourier ? (
                        <DeliveryListSkeleton />
                    ) : !courierNotes || courierNotes.length === 0 ? (
                        <EmptyDeliveryState
                            kind="courier"
                            onAction={() => setIsCourierWizardOpen(true)}
                        />
                    ) : (
                        viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {courierNotes.map((note) => renderNoteCard(note, 'courier'))}
                            </div>
                        ) : (
                            renderNoteTable(courierNotes, 'courier')
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
            />

            {/* Delivery Note Wizard (Courier — pure internal) */}
            <CourierDeliveryNoteWizard
                open={isCourierWizardOpen}
                onOpenChange={(open) => {
                    setIsCourierWizardOpen(open);
                    if (!open) setCourierWizardLockId(undefined);
                }}
                lockCourierId={courierWizardLockId}
            />


            {/* Preview Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="ant-surface sm:max-w-[720px] rounded-2xl border border-ant-line p-0 overflow-hidden bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
                    <div className="p-8 space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
                        <div className="flex justify-between items-start gap-6">
                            <div>
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                    Delivery note
                                </span>
                                <h2 className="font-display text-[28px] font-semibold text-ant-ink tracking-[-0.02em] mt-1 leading-tight">
                                    {selectedNote?.reference || '—'}
                                </h2>
                                <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1">
                                    Handover manifest for {noteDetails?.provider?.isCourier ? 'the courier' : 'the provider'}.
                                </p>
                            </div>
                            {noteDetails?.provider?.logo_url ? (
                                <div className="p-3 bg-white rounded-2xl shadow-sm border border-ant-line flex items-center justify-center min-w-[80px]">
                                    <img src={noteDetails.provider.logo_url} alt="Provider Logo" className="h-10 w-auto object-contain" />
                                </div>
                            ) : noteDetails?.provider?.avatar_url ? (
                                <div className="w-16 h-16 rounded-2xl shadow-sm border border-ant-line overflow-hidden">
                                    <img src={noteDetails.provider.avatar_url} alt={noteDetails.provider.name || 'Courier'} className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-16 h-16 bg-ant-ink rounded-2xl flex items-center justify-center text-white font-semibold text-xl">
                                    {noteDetails?.provider?.isCourier ? <Truck className="w-7 h-7" /> : 'D'}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-10">
                            <div className="space-y-4">
                                <div className="text-[10px] font-semibold text-ant-mid uppercase tracking-widest">
                                    {noteDetails?.provider?.isCourier ? 'Courier' : 'Provider / Business'}
                                </div>
                                <div className="space-y-1">
                                    <div className="font-bold text-ant-ink text-lg">{noteDetails?.provider?.business_name || noteDetails?.provider?.name || 'Loading...'}</div>
                                    {noteDetails?.provider?.isCourier ? (
                                        <>
                                            {noteDetails?.provider?.phone && (
                                                <div className="text-sm text-ant-muted font-medium">Phone: {noteDetails.provider.phone}</div>
                                            )}
                                            <div className="text-sm text-ant-muted font-medium">Reference: {selectedNote?.reference}</div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-sm text-ant-muted font-medium">Provider: {noteDetails?.provider?.provider_type?.toUpperCase() || 'N/A'}</div>
                                            <div className="text-sm text-ant-muted font-medium">Reference: {selectedNote?.reference}</div>
                                        </>
                                    )}
                                </div>
                            </div>
                                <div className="space-y-4 text-right">
                                <div className="text-[10px] font-semibold text-ant-mid uppercase tracking-widest">Delivery Details</div>
                                <div className="space-y-1">
                                    <div className="font-bold text-ant-ink text-lg">{selectedNote?.parcel_count || 0} Parcels</div>
                                    <div className="text-sm text-ant-muted font-medium">Created: {selectedNote?.created_at ? format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}</div>
                                    <div className="text-sm text-ant-muted font-medium flex items-center justify-end gap-2">
                                        {selectedNote?.creator?.avatar_url ? (
                                            <img src={selectedNote.creator.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                                        ) : (
                                            <User className="w-4 h-4" />
                                        )}
                                        <span>By: {selectedNote?.creator?.name ?? 'Unknown'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-ant-line">
                            <table className="w-full">
                                <thead className="bg-ant-ink/[0.03]">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-[10px] font-semibold text-ant-mid uppercase tracking-widest">Tracking Code</th>
                                        <th className="px-6 py-4 text-left text-[10px] font-semibold text-ant-mid uppercase tracking-widest">Order Ref</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-semibold text-ant-mid uppercase tracking-widest">Status</th>
                                        <th className="px-6 py-4 text-right text-[10px] font-semibold text-ant-mid uppercase tracking-widest">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-navy/5">
                                    {!noteDetails ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-ant-muted">Loading parcels...</td>
                                        </tr>
                                    ) : noteDetails.parcels.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-ant-muted">No parcels in this delivery note</td>
                                        </tr>
                                    ) : (
                                        noteDetails.parcels.map((parcel: any) => (
                                            <tr key={parcel.id} className="hover:bg-ant-light transition-colors">
                                                <td className="px-6 py-4 font-bold text-sm text-ant-ink">{parcel.tracking_code || parcel.reference}</td>
                                                <td className="px-6 py-4 text-xs font-medium text-ant-muted">{parcel.order_id?.slice(0, 8)}</td>
                                                <td className="px-6 py-4 text-center">
                                                    {parcel.real_time_status_label ? (
                                                        <Badge
                                                            className="border-none text-[8px] font-semibold px-2 py-0.5 rounded-lg shadow-none"
                                                            style={{
                                                                backgroundColor: parcel.real_time_status_color ? `${parcel.real_time_status_color}15` : '#10b98115',
                                                                color: parcel.real_time_status_color || '#10b981'
                                                            }}
                                                        >
                                                            {parcel.real_time_status_label}
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-ant-green/10 text-ant-green border-none text-[8px] font-semibold px-2 py-0.5 rounded-lg shadow-none">
                                                            {parcel.status_label || 'Nouveau'}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                                        {parcel.tracking_code && (
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 shrink-0 rounded-lg text-ant-ink hover:bg-slate-200/90 hover:text-ant-ink focus-visible:text-ant-ink"
                                                                title="Suivi"
                                                                aria-label="Suivi"
                                                                onClick={() => handleTrackParcel(parcel)}
                                                            >
                                                                <Clock className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {(selectedNote?.provider_id || selectedNote?.courier_id) && !selectedNote?.is_finalized && (
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 shrink-0 rounded-lg text-ant-rose hover:bg-ant-rose/15 hover:text-ant-rose focus-visible:text-ant-rose"
                                                                title="Retirer du bon"
                                                                aria-label="Retirer du bon"
                                                                disabled={removingParcelId === parcel.id}
                                                                onClick={() => openRemoveParcelDialog(parcel)}
                                                            >
                                                                {removingParcelId === parcel.id ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="h-4 w-4" />
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
                                    className="rounded-2xl h-12 px-6 font-bold text-ant-rose hover:bg-ant-rose/10 hover:text-ant-rose transition-all flex items-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Supprimer
                                </Button>
                            )}

                            {!selectedNote?.is_finalized && (selectedNote?.provider_id || selectedNote?.courier_id) && (
                                <Button
                                    onClick={() => handleFinalizeNote(selectedNote)}
                                    className="bg-ant-green hover:bg-ant-green text-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-emerald-500/10 transition-all flex items-center gap-2"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Finaliser le Bon
                                </Button>
                            )}

                            {selectedNote?.is_finalized && (selectedNote?.provider_id || selectedNote?.courier_id) && (
                                <Button
                                    onClick={() => handleReopenNote(selectedNote)}
                                    disabled={isReopening}
                                    className="bg-ant-orange hover:bg-amber-600 text-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-amber-500/10 transition-all flex items-center gap-2 disabled:opacity-50"
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
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[220px]">
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
                                            className="rounded-xl font-bold py-3 cursor-pointer text-ant-orange"
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
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[200px]">
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
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-ant-orange" onClick={() => handlePrintLabels('Note')}>
                                            Bon Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : noteDetails?.provider?.provider_type === 'coliaty' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer Étiquettes
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[200px]">
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
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[200px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('10x10')}>
                                            Ticket Thermique (10x10)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('A4')}>
                                            Tickets A4 (4/page)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-ant-orange" onClick={() => handlePrintLabels('Note')}>
                                            Bon de Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : noteDetails?.provider?.provider_type === 'quicklivraison' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[240px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('ticket')}>
                                            Étiquettes (stickers)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('eticket')}>
                                            E-Étiquettes
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-ant-orange" onClick={() => handlePrintLabels('note')}>
                                            Bon de Livraison (PDF)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="rounded-xl font-bold py-3 cursor-pointer"
                                            onClick={() => window.open('https://clients.quicklivraison.ma', '_blank', 'noopener,noreferrer')}
                                        >
                                            <ExternalLink className="w-4 h-4 mr-2" /> Ouvrir Quick Livraison
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : noteDetails?.provider?.provider_type === 'vitex' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2">
                                            <Download className="w-4 h-4" />
                                            Imprimer
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="rounded-2xl p-2 border-none shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] bg-white min-w-[240px]">
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('ticket')}>
                                            Tickets (stickers)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer" onClick={() => handlePrintLabels('eticket')}>
                                            E-Tickets
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="rounded-xl font-bold py-3 cursor-pointer text-ant-orange" onClick={() => handlePrintLabels('note')}>
                                            Bon de Livraison (PDF)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="rounded-xl font-bold py-3 cursor-pointer"
                                            onClick={() => window.open('https://vitex.ma/clients', '_blank', 'noopener,noreferrer')}
                                        >
                                            <ExternalLink className="w-4 h-4 mr-2" /> Ouvrir VITEX
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Button
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-brand-white rounded-2xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/10 transition-all flex items-center gap-2"
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
                <DialogContent className="ant-surface sm:max-w-[520px] rounded-2xl border border-ant-line p-0 overflow-hidden bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
                    <DialogHeader className="p-6 pb-3 border-b border-ant-line">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-ant-orange/10 ring-1 ring-ant-orange/20 flex items-center justify-center">
                                <Truck className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                    Parcel tracking
                                </span>
                                <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight mt-0.5">
                                    Shipment history
                                </DialogTitle>
                                <DialogDescription className="text-[11.5px] text-ant-muted mt-1 tabular-nums">
                                    Code: <span className="text-ant-ink font-medium">{trackingParcel?.tracking_code || '—'}</span>
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="p-8 max-h-[60vh] overflow-y-auto">
                        {isTrackingLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <Loader2 className="w-10 h-10 text-ant-ink animate-spin" />
                                <p className="font-bold text-ant-muted animate-pulse">Récupération des données...</p>
                            </div>
                        ) : trackingHistory ? (
                            <div className="relative pl-10">
                                <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-slate-200 via-slate-200 to-brand-navy/30" />
                                <div className="space-y-0">
                                {(() => {
                                    const events = Array.isArray(trackingHistory)
                                        ? trackingHistory
                                        : (trackingHistory?.history || []);
                                    if (events.length === 0) {
                                        return [{ status: trackingHistory?.statusLabel || trackingHistory?.status || 'Nouveau', date: null, comment: 'Aucun historique détaillé disponible', statusLabel: trackingHistory?.statusLabel }];
                                    }
                                    return [...events].reverse(); // oldest first
                                })().map((event: any, idx: number, arr: any[]) => {
                                    const statusMap: any = {
                                        'NEW_PARCEL': 'Nouveau', 'WAITING_PICKUP': 'En attente de ramassage', 'DISTRIBUTION': 'En cours de distribution',
                                        'DELIVERED': 'Livré', 'REFUSED': 'Refusé', 'REFUSE': 'Refusé', 'ANNULE': 'Annulé', 'CANCELLED': 'Annulé',
                                        'RETURNED': 'Retourné', 'RETOUR': 'Retourné', 'POSTPONED': 'Reporté', 'WAITING_PREPARATION': 'En préparation',
                                        'PICKED_UP': 'Ramassé', 'READY_FOR_PICKUP': 'Prêt pour ramassage'
                                    };
                                    const situationMap: Record<string, { label: string; className: string }> = {
                                        PAID: { label: 'Payé', className: 'bg-ant-green/10 text-ant-green border-emerald-200' },
                                        NOT_PAID: { label: 'Non payé', className: 'bg-ant-orange/10 text-ant-orange border-amber-200' },
                                        INVOICED: { label: 'Facturé', className: 'bg-ant-blue/10 text-blue-700 border-blue-200' },
                                    };

                                    const rawStatus = event.status || "Nouveau";
                                    const statusLabel = event.statusLabel;
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
                                    const eventColor = (event.color as string) || '';
                                    const dataList = (event.data_list as any[]) || [];
                                    const location = [hub, city].filter(Boolean).join(' — ');
                                    const meaningfulDataList = dataList.filter((item: any) => item?.title && item.title !== 'Nombre de distributions');
                                    const sitInfo = situation ? situationMap[situation] : null;
                                    const isLast = idx === arr.length - 1;

                                    // Resolve icon + color from DB package_statuses (mirrors ParcelTrackingDialog behavior).
                                    const matched = matchPkgStatus(rawStatus, statusLabel);
                                    const statusColor = matched?.color || eventColor || '#94a3b8';
                                    const iconName = matched?.icon;

                                    return (
                                        <div key={idx} className="relative pb-6 last:pb-0 group">
                                            <div
                                                className={`absolute -left-10 top-0 w-8 h-8 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center z-10 transition-all group-hover:scale-110 ${isLast ? 'ring-2 ring-offset-2' : ''}`}
                                                style={{ backgroundColor: isLast ? statusColor : '#f8fafc', color: isLast ? '#ffffff' : statusColor, ['--tw-ring-color' as any]: isLast ? `${statusColor}40` : undefined }}
                                            >
                                                {iconName ? (
                                                    <DynamicIcon name={iconName} className="w-3.5 h-3.5" />
                                                ) : (
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : statusColor }} />
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-lg" style={{ color: statusColor, backgroundColor: `${statusColor}15` }}>
                                                        {status}
                                                    </span>
                                                    {sitInfo && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${sitInfo.className}`}>{sitInfo.label}</span>}
                                                </div>
                                                {date && <p className="text-[10px] font-bold text-ant-muted/50">{format(new Date(date), 'dd/MM/yyyy HH:mm')}</p>}
                                                {comment && <p className="text-[11px] font-medium text-ant-muted leading-relaxed italic">&quot;{comment}&quot;</p>}
                                                {location && (
                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ant-mid">
                                                        <MapPin className="w-3 h-3 shrink-0" /><span>{location}</span>
                                                    </div>
                                                )}
                                                {(user || phone) && (
                                                    <div className="flex items-center gap-3 flex-wrap">
                                                        {user && <div className="flex items-center gap-1.5 text-[10px] font-bold text-ant-muted"><div className="w-4 h-4 rounded-full bg-ant-line flex items-center justify-center"><Hash className="w-2 h-2" /></div>Par {user}</div>}
                                                        {phone && <a href={`tel:${phone}`} className="flex items-center gap-1 text-[10px] font-bold text-ant-ink/70 hover:text-ant-ink transition-colors"><Phone className="w-3 h-3" />{phone}</a>}
                                                    </div>
                                                )}
                                                {scheduledDate && (
                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ant-orange/70">
                                                        <CalendarClock className="w-3 h-3 shrink-0" /><span>Programmé: {format(new Date(scheduledDate), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                )}
                                                {meaningfulDataList.length > 0 && (
                                                    <div className="mt-1 space-y-0.5">
                                                        {meaningfulDataList.map((item: any, i: number) => {
                                                            const isItemPhone = /^0[5-8]\d{8}$/.test(String(item.value));
                                                            const isDateVal = /^\d{4}-\d{2}-\d{2}$/.test(String(item.value));
                                                            return (
                                                                <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-ant-muted/80">
                                                                    <Info className="w-2.5 h-2.5 shrink-0 opacity-50" /><span className="font-semibold">{item.title}:</span>
                                                                    {isItemPhone ? <a href={`tel:${item.value}`} className="text-ant-ink/70 hover:text-ant-ink font-bold transition-colors">{item.value}</a>
                                                                    : isDateVal ? <span className="text-ant-orange/70 font-semibold">{item.value}</span>
                                                                    : <span className="font-semibold">{item.value}</span>}
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
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                                <div className="p-4 bg-ant-light rounded-full">
                                    <SearchX className="w-8 h-8 text-ant-muted/40" />
                                </div>
                                <p className="font-bold text-ant-muted">Aucun historique disponible pour ce colis.</p>
                            </div>
                        )}
                    </div>

                    <div className="px-6 pb-6 pt-2 border-t border-ant-line">
                        <Button
                            variant="outline"
                            onClick={() => setIsTrackingModalOpen(false)}
                            className="w-full h-10 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                        >
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>


            {/* Delete Confirmation */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent className="ant-surface sm:max-w-[420px] rounded-2xl border border-ant-line p-7 text-center space-y-5 bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
                    <div className="w-20 h-20 bg-ant-rose/10 rounded-full flex items-center justify-center text-ant-rose mx-auto">
                        <Trash2 className="w-10 h-10" />
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-ant-rose/10 ring-1 ring-ant-rose/20 flex items-center justify-center text-ant-rose mx-auto">
                        <Trash2 className="w-5 h-5" strokeWidth={1.75} />
                    </div>
                    <div className="space-y-1.5">
                        <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em]">
                            Delete this note?
                        </DialogTitle>
                        <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed">
                            {selectedNote?.provider_id != null ? (
                                <>
                                    Note <span className="not-italic font-medium text-ant-ink">{selectedNote?.reference}</span> will be removed.
                                    Orders with no other parcel will revert to{' '}
                                    <span className="not-italic font-medium text-ant-ink">confirmed</span> and their logistics data will be cleared.
                                </>
                            ) : (
                                <>
                                    Courier note <span className="not-italic font-medium text-ant-ink">{selectedNote?.reference}</span> and its parcels will be permanently deleted.
                                </>
                            )}
                        </DialogDescription>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <Button
                            variant="outline"
                            onClick={() => setIsDeleteModalOpen(false)}
                            className="flex-1 h-10 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                        >
                            Keep it
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteNote}
                            className="flex-1 h-10 rounded-full font-medium text-[12px] bg-ant-rose hover:bg-ant-rose/90"
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                            Delete note
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
                <AlertDialogContent className="ant-surface rounded-2xl border border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] max-w-md p-6">
                    <AlertDialogHeader className="space-y-2">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-1">
                            <Package className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em]">
                            Remove this parcel from the note?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed">
                            The order will revert to confirmed and all logistics (carrier, tracking, statuses) will be wiped.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-3">
                        <AlertDialogCancel className="rounded-full h-10 px-4 font-medium border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft hover:text-ant-ink m-0 text-[12px]">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            className="rounded-full h-10 px-4 font-medium text-[12px] bg-ant-rose hover:bg-ant-rose/90 m-0 w-full sm:w-auto"
                            disabled={!!removingParcelId}
                            onClick={() => void confirmRemoveParcelFromNote()}
                        >
                            {removingParcelId === parcelPendingRemove?.id ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            Remove
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// Editorial summary cell used in the strip above the tabs. Matches the Orders
// KPI tile so the two pages feel continuous.
function DeliverySummaryTile({
    label,
    value,
    accent,
    icon: Icon,
}: {
    label: string;
    value: number;
    accent: string;
    icon: typeof FileText;
}) {
    return (
        <div className="bg-ant-paper px-4 py-3">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: accent }} aria-hidden />
                    <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">
                        {label}
                    </span>
                </div>
                <span
                    className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                    style={{ backgroundColor: `${accent}14`, color: accent }}
                >
                    <Icon className="w-3 h-3" strokeWidth={1.75} />
                </span>
            </div>
            <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2">
                {value.toLocaleString('fr-FR')}
            </div>
        </div>
    );
}

function DeliveryListSkeleton() {
    return (
        <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-ant-line-soft animate-pulse" />
            ))}
        </div>
    );
}

function EmptyDeliveryState({ kind, onAction }: { kind: 'company' | 'courier'; onAction: () => void }) {
    const Icon = kind === 'courier' ? Truck : Building2;
    return (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-4">
                <Icon className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
            </div>
            <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">
                No {kind} delivery notes yet
            </h3>
            <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
                Bundle a batch of confirmed orders into a single handover document — one click ships them to the {kind === 'courier' ? 'courier' : 'provider'}.
            </p>
            <Button
                onClick={onAction}
                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium gap-2"
            >
                <Plus className="w-3.5 h-3.5" />
                Generate the first note
            </Button>
        </div>
    );
}

export default DeliveryNote;

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from '@/hooks/use-toast';
import {
    Search,
    Building2,
    Package,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Truck,
    FileText,
    ExternalLink,
    Download
} from 'lucide-react';

const EDGE_FUNCTION_URL = 'https://zjkqprrfbibjoslvlmxf.supabase.co/functions/v1/provider-integration';

interface DeliveryNoteWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const DeliveryNoteWizard: React.FC<DeliveryNoteWizardProps> = ({ open, onOpenChange }) => {
    const [step, setStep] = useState<'zone' | 'creating' | 'review' | 'finalizing'>('zone');
    const [selectedZoneId, setSelectedZoneId] = useState<string>('');
    const [zoneSearch, setZoneSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<any[]>([]);
    const [deliveryNotes, setDeliveryNotes] = useState<any[]>([]);
    const [currentProvider, setCurrentProvider] = useState<string>('');

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Fetch zones that have confirmed orders
    const { data: zones } = useQuery({
        queryKey: ['zones-with-confirmed-orders'],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data: confirmedStatus } = await supabase
                .from('order_statuses')
                .select('id')
                .eq('label', 'CONFIRMER')
                .single();

            if (!confirmedStatus) return [];

            // Get zones that have cities with confirmed orders
            const { data, error } = await supabase
                .from('zones')
                .select(`
                    id,
                    name,
                    cities!inner(
                        id,
                        orders!inner(
                            id,
                            company_id,
                            "DigiCom Business"
                        )
                    )
                `)
                .eq('cities.orders.order_status_id', confirmedStatus.id)
                .eq('cities.orders.DigiCom Business', activeBusinessId);

            if (error) throw error;

            // Filter zones that actually have orders
            return data?.filter(zone =>
                zone.cities.some((city: any) => city.orders.length > 0)
            ) || [];
        },
        enabled: open
    });

    // Fetch confirmed orders for selected zone grouped by provider
    const { data: ordersGrouped } = useQuery({
        queryKey: ['confirmed-orders-by-zone', selectedZoneId],
        queryFn: async () => {
            if (!selectedZoneId) return null;

            const { data: confirmedStatus } = await supabase
                .from('order_statuses')
                .select('id')
                .eq('label', 'CONFIRMER')
                .single();

            const { data, error } = await supabase
                .from('orders')
                .select(`
                    *,
                    city:cities!inner(id, name, zone_id, ameex_code),
                    company:providers(id, name, provider_type),
                    items:order_items(
                        *,
                        product:products(name, code)
                    )
                `)
                .eq('order_status_id', confirmedStatus.id)
                .eq('city.zone_id', selectedZoneId)
                .eq('DigiCom Business', activeBusinessId)
                .not('company_id', 'is', null);

            if (error) throw error;

            // Group by provider
            const grouped = (data || []).reduce((acc: any, order: any) => {
                const providerId = order.company_id;
                if (!acc[providerId]) {
                    acc[providerId] = {
                        provider: order.company,
                        orders: []
                    };
                }
                acc[providerId].orders.push(order);
                return acc;
            }, {});

            return grouped;
        },
        enabled: !!selectedZoneId && step === 'zone'
    });

    // Create parcels for a provider
    const createParcelsMutation = useMutation({
        mutationFn: async ({ providerId, orders }: { providerId: string; orders: any[] }) => {
            // Get session once at the start
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.access_token) {
                throw new Error('Not authenticated. Please log in again.');
            }

            const provider = orders[0].company;
            const results = [];

            for (const order of orders) {
                try {
                    // Prepare parcel data
                    const parcelData = {
                        customer_name: order.name,
                        customer_phone: order.phone,
                        delivery_address: order.address,
                        cod_amount: Number(order.price),
                        city_id: order.city?.id,
                        city_name: order.city?.name,
                        ameex_city_code: (order.city as any)?.ameex_code,
                        product_info: order.items?.map((i: any) => `${i.product?.code || 'P'} x${i.quantity || 1}`).join(', '),
                        note: order.note || '', // Internal note
                        delivery_note: order.delivery_note || '', // Public note for courier
                        replaceable: order.replace || false,
                    };

                    // Call Edge Function
                    const response = await fetch(EDGE_FUNCTION_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({
                            action: 'create_parcel',
                            provider_id: providerId,
                            data: parcelData
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `API returned ${response.status}`);
                    }

                    const result = await response.json();

                    // Map provider status to our internal package_statuses
                    const providerStatus = result.data?.status || result.data?.label || result.data?.statusLabel || 'Nouveau';
                    const providerColor = result.data?.statusColor || result.data?.color;
                    let mappedStatusId = null;

                    // Try to find matching status in package_statuses table for internal mapping
                    const { data: matchedStatus } = await supabase
                        .from('package_statuses')
                        .select('id')
                        .ilike('label', providerStatus)
                        .single();

                    if (matchedStatus) {
                        mappedStatusId = matchedStatus.id;
                    }

                    // Save to database with mapped status_id and native color
                    const { data: parcel, error: parcelError } = await supabase
                        .from('company_parcels')
                        .insert({
                            provider_id: providerId,
                            order_id: order.id,
                            reference: result.data?.tracking_code || result.data?.reference || result.data?.bar_code || 'N/A',
                            tracking_code: result.data?.tracking_code || result.data?.reference || result.data?.bar_code,
                            status_label: providerStatus,
                            status_color: providerColor,
                            external_id: result.data?.id || String(result.data?.external_id || ''),
                            provider_response: result.data,
                            status_id: mappedStatusId,
                            'DigiCom Business': activeBusinessId
                        })
                        .select()
                        .single();

                    if (parcelError) throw parcelError;

                    results.push({
                        order,
                        parcel,
                        tracking_code: result.data?.tracking_code || result.data?.reference || 'N/A'
                    });
                } catch (error: any) {
                    console.error('Parcel creation error:', error);
                    results.push({
                        order,
                        error: error.message
                    });
                }
            }

            return results;
        },
        onSuccess: (results) => {
            setCreatedParcels(prev => [...prev, ...results]);
        }
    });

    // Create delivery note for provider
    const createDeliveryNoteMutation = useMutation({
        mutationFn: async ({ providerId, parcelCodes }: { providerId: string; parcelCodes: string[] }) => {
            // Get user session
            const { data: { session } } = await supabase.auth.getSession();

            // Create delivery note via Edge Function
            const response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'create_delivery_note',
                    provider_id: providerId
                })
            });

            if (!response.ok) throw new Error('Failed to create delivery note');

            const result = await response.json();
            const deliveryNoteRef = result.data.reference;

            // Add parcels to delivery note
            const addResponse = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'add_parcels_to_delivery_note',
                    provider_id: providerId,
                    data: {
                        delivery_note_ref: deliveryNoteRef,
                        parcel_codes: parcelCodes
                    }
                })
            });

            if (!addResponse.ok) throw new Error('Failed to add parcels to delivery note');

            // Finalize delivery note
            const finalizeResponse = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'finalize_delivery_note',
                    provider_id: providerId,
                    data: {
                        delivery_note_ref: deliveryNoteRef
                    }
                })
            });

            if (!finalizeResponse.ok) throw new Error('Failed to finalize delivery note');

            // Save to database
            const { data: note, error: noteError } = await supabase
                .from('company_delivery_notes')
                .insert({
                    provider_id: providerId,
                    reference: deliveryNoteRef,
                    external_id: result.data?.id || String(result.data?.external_id || ''),
                    parcel_count: parcelCodes.length,
                    status_id: null,
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (noteError) throw noteError;

            // Update parcels with delivery note ID
            const parcelIds = createdParcels
                .filter(p => parcelCodes.includes(p.tracking_code))
                .map(p => p.parcel.id);

            await supabase
                .from('company_parcels')
                .update({ company_delivery_note_id: note.id })
                .in('id', parcelIds);

            return { note, providerId };
        },
        onSuccess: (result) => {
            setDeliveryNotes(prev => [...prev, result]);
            toast({
                title: "Delivery Note Created",
                description: `Reference: ${result.note.reference}`
            });
        }
    });

    const handleZoneSelect = () => {
        if (!selectedZoneId) {
            toast({
                title: "Error",
                description: "Please select a zone",
                variant: "destructive"
            });
            return;
        }
        setStep('creating');
        handleCreateParcels();
    };

    const handleCreateParcels = async () => {
        if (!ordersGrouped) return;

        setCreatedParcels([]);

        for (const [providerId, group] of Object.entries(ordersGrouped)) {
            const { provider, orders } = group as { provider: any; orders: any[] };
            setCurrentProvider(provider.name);
            await createParcelsMutation.mutateAsync({ providerId, orders });
        }

        setStep('review');
    };

    const handleConfirmDeliveryNotes = async () => {
        setStep('finalizing');

        // Group parcels by provider
        const parcelsByProvider = createdParcels.reduce((acc: any, p: any) => {
            if (!p.error) {
                const providerId = p.order.company_id;
                if (!acc[providerId]) acc[providerId] = [];
                acc[providerId].push(p.tracking_code);
            }
            return acc;
        }, {});

        for (const [providerId, parcelCodes] of Object.entries(parcelsByProvider) as any) {
            await createDeliveryNoteMutation.mutateAsync({ providerId, parcelCodes });
        }

        // Update order statuses to 'PROCESSED'
        try {
            const { data: processedStatus } = await supabase
                .from('order_statuses')
                .select('id')
                .eq('label', 'PROCESSED')
                .single();

            if (processedStatus) {
                const successfulOrderIds = createdParcels
                    .filter(p => !p.error && p.order?.id)
                    .map(p => p.order.id);

                if (successfulOrderIds.length > 0) {
                    await supabase
                        .from('orders')
                        .update({ order_status_id: processedStatus.id })
                        .in('id', successfulOrderIds);
                }
            }
        } catch (error) {
            console.error('Error updating order statuses:', error);
        }

        queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-zone'] });

        toast({
            title: "Success!",
            description: `Created ${Object.keys(parcelsByProvider).length} delivery note(s) and updated order statuses`
        });

        onOpenChange(false);
        resetWizard();
    };

    const resetWizard = () => {
        setStep('zone');
        setSelectedZoneId('');
        setCreatedParcels([]);
        setDeliveryNotes([]);
        setCurrentProvider('');
    };

    const filteredZones = useMemo(() => {
        if (!zones) return [];
        return zones.filter(z =>
            z.name.toLowerCase().includes(zoneSearch.toLowerCase())
        );
    }, [zones, zoneSearch]);

    const successfulParcels = createdParcels.filter(p => !p.error);
    const failedParcels = createdParcels.filter(p => p.error);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] rounded-[32px] border-none p-0 overflow-hidden">
                {step === 'zone' && (
                    <>
                        <div className="bg-brand-navy p-8 text-white relative">
                            <DialogTitle className="text-2xl font-black">Select Delivery Zone</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                Choose a zone with confirmed orders ready for shipment.
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search zones..."
                                    value={zoneSearch}
                                    onChange={(e) => setZoneSearch(e.target.value)}
                                    className="pl-11 h-12 bg-slate-50 border-none rounded-2xl"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {filteredZones.map((zone) => (
                                    <button
                                        key={zone.id}
                                        onClick={() => setSelectedZoneId(zone.id)}
                                        className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${selectedZoneId === zone.id
                                            ? 'border-brand-navy bg-brand-navy/5'
                                            : 'border-slate-200 hover:border-brand-navy/30'
                                            }`}
                                    >
                                        <div className="font-bold text-brand-navy">{zone.name}</div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {zone.cities.length} cities with orders
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {selectedZoneId && ordersGrouped && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="text-sm font-bold text-brand-navy/60">Detected Providers:</div>
                                    <div className="flex gap-3">
                                        {Object.values(ordersGrouped as any).map(({ provider, orders }: any) => (
                                            <div key={provider.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl flex-1">
                                                <Building2 className="w-5 h-5 text-blue-500" />
                                                <div className="flex-1">
                                                    <div className="font-bold text-sm">{provider.name}</div>
                                                    <div className="text-xs text-muted-foreground">{orders.length} orders</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button
                                    onClick={handleZoneSelect}
                                    disabled={!selectedZoneId}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl"
                                >
                                    Create Parcels
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'creating' && (
                    <div className="p-16 text-center space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-brand-navy" />
                        <div>
                            <div className="text-xl font-black text-brand-navy">Creating Parcels...</div>
                            <div className="text-sm text-muted-foreground mt-2">Provider: {currentProvider}</div>
                        </div>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <div className="bg-brand-navy p-8 text-white">
                            <DialogTitle className="text-2xl font-black">Review Parcels</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                {successfulParcels.length} parcels created successfully
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-4 max-h-[500px] overflow-y-auto">
                            {successfulParcels.map((item, idx) => (
                                <div key={idx} className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="font-bold text-brand-navy">{item.order.name}</div>
                                            <div className="text-xs text-muted-foreground">{item.order.phone}</div>
                                        </div>
                                        <Badge className="bg-emerald-500 text-white border-none">
                                            {item.tracking_code}
                                        </Badge>
                                    </div>
                                </div>
                            ))}

                            {failedParcels.map((item, idx) => (
                                <div key={idx} className="p-4 bg-red-50 rounded-2xl border border-red-200">
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                                        <div>
                                            <div className="font-bold text-brand-navy">{item.order.name}</div>
                                            <div className="text-xs text-red-600">{item.error}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-8 pt-0">
                            <DialogFooter>
                                <Button variant="ghost" onClick={resetWizard}>Start Over</Button>
                                <Button
                                    onClick={handleConfirmDeliveryNotes}
                                    disabled={successfulParcels.length === 0}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl"
                                >
                                    <FileText className="w-4 h-4 mr-2" />
                                    Generate Delivery Notes
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'finalizing' && (
                    <div className="p-16 text-center space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-brand-navy" />
                        <div>
                            <div className="text-xl font-black text-brand-navy">Generating Delivery Notes...</div>
                            <div className="text-sm text-muted-foreground mt-2">Please wait</div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Trash2,
    RotateCcw,
    Clock,
    Loader2,
    Phone,
    User,
    Search,
    ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

type TrashedOrder = {
    id: string;
    name: string | null;
    phone: string | null;
    price: number | null;
    date_deleted: string | null;
    status: {
        label: string | null;
        color: string | null;
        icon: string | null;
    } | null;
};

const Trash = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const [search, setSearch] = useState('');
    const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{ id: string; name: string } | null>(null);

    const { data: trashedOrders = [], isLoading } = useQuery({
        queryKey: ['trashed-orders', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, name, phone, price, date_deleted, status:order_statuses(label, color, icon)')
                .eq('DigiCom Business', activeBusinessId)
                .not('date_deleted', 'is', null)
                .order('date_deleted', { ascending: false });
            if (error) throw error;
            return data as TrashedOrder[];
        },
        enabled: !!activeBusinessId,
    });

    const restoreMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase as any)
                .from('orders')
                .update({ date_deleted: null })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trashed-orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            toast({ title: "Order Restored", description: "Order has been restored successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    const permanentDeleteMutation = useMutation({
        mutationFn: async (id: string) => {
            // Delete from company_payment_note_orders first (NO ACTION FK)
            const { error: fkError } = await (supabase as any)
                .from('company_payment_note_orders')
                .delete()
                .eq('order_id', id);
            if (fkError) throw fkError;

            const { error } = await (supabase as any)
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trashed-orders', activeBusinessId] });
            setPendingPermanentDelete(null);
            toast({ title: "Order Permanently Deleted", description: "Order has been permanently removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    const getDaysRemaining = (dateDeleted: string | null) => {
        if (!dateDeleted) return 0;
        const deleted = new Date(dateDeleted);
        const now = new Date();
        const diffMs = now.getTime() - deleted.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return Math.max(0, 14 - daysPassed);
    };

    const getDaysRemainingColor = (days: number) => {
        if (days > 7) return 'bg-emerald-100 text-emerald-700';
        if (days > 3) return 'bg-amber-100 text-amber-700';
        return 'bg-red-100 text-red-700';
    };

    const filteredOrders = trashedOrders.filter((order) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            order.name?.toLowerCase().includes(q) ||
            order.phone?.toLowerCase().includes(q)
        );
    });

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Trash</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Items permanently deleted after 14 days</p>
                </div>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: 'Trashed Orders', value: trashedOrders.length, accent: '#d97706' },
                    { label: 'Expiring Soon', value: trashedOrders.filter(o => getDaysRemaining(o.date_deleted) <= 3).length, accent: '#ef4444' },
                    { label: 'Total Value', value: `${trashedOrders.reduce((sum, o) => sum + (o.price || 0), 0).toLocaleString()} MAD`, accent: '#9ca3af' },
                ].map((kpi, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: kpi.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{kpi.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{kpi.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs + Content */}
            <Tabs defaultValue="orders" className="w-full space-y-3">
                <TabsList className="h-8">
                    <TabsTrigger value="orders" className="text-[11px] h-6 px-3 gap-1.5">
                        <Trash2 className="w-3 h-3" /> Orders
                        {trashedOrders.length > 0 && (
                            <span className="ml-1 bg-gray-200 text-gray-700 rounded-full px-1.5 text-[9px] font-bold">
                                {trashedOrders.length}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="space-y-3 mt-0">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search by name or phone..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                            />
                        </div>
                        {filteredOrders.length !== trashedOrders.length && (
                            <p className="text-[10px] text-gray-400">
                                Showing <span className="font-semibold text-brand-navy">{filteredOrders.length}</span> of {trashedOrders.length}
                            </p>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="space-y-2">
                            {[1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-white border border-gray-100 animate-pulse" />)}
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
                                <Trash2 className="w-5 h-5 text-gray-300" />
                                <p className="text-[11px] font-semibold text-brand-navy">Trash is empty</p>
                                <p className="text-[10px] text-gray-400">Deleted orders will appear here</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50/60">
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Customer</th>
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Phone</th>
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Price</th>
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Deleted</th>
                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Days Left</th>
                                                <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredOrders.map((order) => {
                                                const daysLeft = getDaysRemaining(order.date_deleted);
                                                return (
                                                    <tr key={order.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                                                        <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy/80">
                                                            {order.name || '---'}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center gap-1.5">
                                                                <Phone className="w-3 h-3 text-gray-400" />
                                                                <span className="text-[11px] font-mono text-brand-navy/70">{order.phone || '---'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-[11px] tabular-nums font-semibold text-brand-navy/80">
                                                            {order.price != null ? `${order.price.toLocaleString()} MAD` : '---'}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {order.status?.label ? (
                                                                <Badge
                                                                    className="h-5 px-1.5 text-[9px] font-semibold border-0"
                                                                    style={{
                                                                        backgroundColor: order.status.color ? `${order.status.color}20` : undefined,
                                                                        color: order.status.color || undefined,
                                                                    }}
                                                                >
                                                                    {order.status.label}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-[11px] text-gray-400">---</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 text-[10px] tabular-nums text-gray-400">
                                                            {order.date_deleted
                                                                ? new Date(order.date_deleted).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                                                : '---'}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex items-center rounded-md text-[9px] font-bold px-1.5 py-0.5 ${getDaysRemainingColor(daysLeft)}`}>
                                                                {daysLeft}d left
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-7 px-2 rounded-md text-[10px] font-semibold text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                                                    disabled={restoreMutation.isPending}
                                                                    onClick={() => restoreMutation.mutate(order.id)}
                                                                >
                                                                    {restoreMutation.isPending ? (
                                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                                    ) : (
                                                                        <RotateCcw className="w-3 h-3 mr-1" />
                                                                    )}
                                                                    Restore
                                                                </Button>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-7 px-2 rounded-md text-[10px] font-semibold text-red-500 border-red-200 hover:bg-red-50"
                                                                    onClick={() => setPendingPermanentDelete({ id: order.id, name: order.name || 'Unknown' })}
                                                                >
                                                                    <Trash2 className="w-3 h-3 mr-1" />
                                                                    Delete
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>

            {/* Permanent Delete Confirmation */}
            <AlertDialog open={!!pendingPermanentDelete} onOpenChange={(open) => { if (!open) setPendingPermanentDelete(null); }}>
                <AlertDialogContent className="max-w-sm rounded-xl border border-gray-100 p-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[13px] font-semibold text-brand-navy">
                            Permanently delete?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            {pendingPermanentDelete
                                ? `This will permanently delete the order for "${pendingPermanentDelete.name}". This action cannot be undone.`
                                : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 mt-3">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            className="h-8 px-3 rounded-md text-[11px] font-semibold"
                            disabled={permanentDeleteMutation.isPending}
                            onClick={() => {
                                if (pendingPermanentDelete) permanentDeleteMutation.mutate(pendingPermanentDelete.id);
                            }}
                        >
                            {permanentDeleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            Delete permanently
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Trash;

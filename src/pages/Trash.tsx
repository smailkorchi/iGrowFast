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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

    if (isLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 animate-spin text-brand-navy" />
                    <p className="text-muted-foreground animate-pulse font-medium">Loading trash...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Trash</h1>
                            <p className="text-gray-500 font-light">Items are permanently deleted after 14 days.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="rounded-[32px] border-none shadow-lg bg-gradient-to-br from-brand-navy to-brand-navy/90 text-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium opacity-80">Trashed Orders</CardTitle>
                        <Trash2 className="w-6 h-6 opacity-60" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black">{trashedOrders.length}</div>
                        <p className="text-sm opacity-60 mt-1">Pending permanent deletion</p>
                    </CardContent>
                </Card>
                <Card className="rounded-[32px] border-none shadow-lg bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium text-brand-navy/60">Expiring Soon</CardTitle>
                        <Clock className="w-6 h-6 text-brand-navy/40" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-brand-navy">
                            {trashedOrders.filter(o => getDaysRemaining(o.date_deleted) <= 3).length}
                        </div>
                        <p className="text-sm text-brand-navy/40 mt-1">Less than 3 days remaining</p>
                    </CardContent>
                </Card>
                <Card className="rounded-[32px] border-none shadow-lg bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium text-brand-navy/60">Total Value</CardTitle>
                        <ShoppingBag className="w-6 h-6 text-brand-navy/40" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-brand-navy">
                            {trashedOrders.reduce((sum, o) => sum + (o.price || 0), 0).toLocaleString()} MAD
                        </div>
                        <p className="text-sm text-brand-navy/40 mt-1">In trashed orders</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs + Content */}
            <Tabs defaultValue="orders" className="w-full space-y-6">
                <TabsList className="bg-white rounded-2xl p-1.5 h-auto shadow-sm border border-brand-navy/5">
                    <TabsTrigger
                        value="orders"
                        className="rounded-xl px-6 py-2.5 font-bold text-sm data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-md text-brand-navy/50 transition-all"
                    >
                        Orders
                        {trashedOrders.length > 0 && (
                            <span className="ml-2 bg-white/20 data-[state=active]:bg-white/20 rounded-full px-2 py-0.5 text-xs font-bold">
                                {trashedOrders.length}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="space-y-4">
                    {/* Controls */}
                    <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between bg-white p-4 rounded-[24px] shadow-sm border border-brand-navy/5">
                        <div className="relative w-full sm:w-96 shrink-0">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name or phone..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-11 h-12 rounded-xl border-brand-navy/10 focus:border-brand-navy focus:ring-brand-navy bg-brand-navy/[0.02]"
                            />
                        </div>
                        {filteredOrders.length !== trashedOrders.length && (
                            <p className="text-xs font-medium text-muted-foreground px-1 shrink-0">
                                Showing <span className="font-bold text-brand-navy">{filteredOrders.length}</span> of {trashedOrders.length} orders
                            </p>
                        )}
                    </div>

                    {/* Content */}
                    {filteredOrders.length === 0 ? (
                        <Card className="rounded-[32px] border-none shadow-lg bg-white">
                            <CardContent className="flex flex-col items-center justify-center py-24">
                                <div className="w-20 h-20 rounded-3xl bg-brand-navy/5 flex items-center justify-center mb-6">
                                    <Trash2 className="w-10 h-10 text-brand-navy/20" />
                                </div>
                                <p className="text-xl font-bold text-brand-navy/70">Trash is empty</p>
                                <p className="text-sm font-light text-gray-500 mt-2">Deleted orders will appear here</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="rounded-[32px] border-none shadow-lg bg-white overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-brand-navy/[0.06]">
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Customer</th>
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Phone</th>
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Price</th>
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Status</th>
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Deleted</th>
                                            <th className="text-left px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Days Left</th>
                                            <th className="text-right px-6 py-4 text-xs font-bold text-brand-navy/40 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredOrders.map((order) => {
                                            const daysLeft = getDaysRemaining(order.date_deleted);
                                            return (
                                                <tr key={order.id} className="border-b border-brand-navy/[0.04] last:border-0 hover:bg-brand-navy/[0.015] transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-9 h-9 rounded-xl bg-brand-navy/5 flex items-center justify-center text-brand-navy font-bold text-sm shrink-0">
                                                                {(order.name || '?').charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="text-sm font-bold text-brand-navy">{order.name || '---'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <Phone className="w-3.5 h-3.5 text-brand-navy/30" />
                                                            <span className="text-sm font-mono tracking-tight text-brand-navy/70">{order.phone || '---'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm font-bold text-brand-navy">{order.price != null ? `${order.price.toLocaleString()} MAD` : '---'}</span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {order.status?.label ? (
                                                            <Badge
                                                                className="rounded-lg text-xs font-bold px-2.5 py-1 border-0"
                                                                style={{
                                                                    backgroundColor: order.status.color ? `${order.status.color}20` : undefined,
                                                                    color: order.status.color || undefined,
                                                                }}
                                                            >
                                                                {order.status.label}
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-sm text-brand-navy/30">---</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm font-medium text-brand-navy/60">
                                                            {order.date_deleted
                                                                ? new Date(order.date_deleted).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                                                : '---'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`inline-flex items-center rounded-full text-xs font-bold px-3 py-1 ${getDaysRemainingColor(daysLeft)}`}>
                                                            {daysLeft}d remaining
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="rounded-xl h-9 px-4 text-xs font-bold text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                                                                disabled={restoreMutation.isPending}
                                                                onClick={() => restoreMutation.mutate(order.id)}
                                                            >
                                                                {restoreMutation.isPending ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                                                )}
                                                                Restore
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="rounded-xl h-9 px-4 text-xs font-bold text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                                                                onClick={() => setPendingPermanentDelete({ id: order.id, name: order.name || 'Unknown' })}
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
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
                        </Card>
                    )}
                </TabsContent>
            </Tabs>

            {/* Permanent Delete Confirmation */}
            <AlertDialog open={!!pendingPermanentDelete} onOpenChange={(open) => { if (!open) setPendingPermanentDelete(null); }}>
                <AlertDialogContent className="rounded-[32px] border-none shadow-2xl max-w-md p-8">
                    <AlertDialogHeader className="space-y-3">
                        <AlertDialogTitle className="text-2xl font-black text-brand-navy tracking-tight">
                            Permanently delete?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-base text-brand-navy/60 font-medium leading-relaxed">
                            {pendingPermanentDelete
                                ? `This will permanently delete the order for "${pendingPermanentDelete.name}". This action cannot be undone.`
                                : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
                        <AlertDialogCancel className="rounded-2xl h-12 font-bold border border-brand-navy/10 bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08] m-0">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            className="rounded-2xl h-12 font-bold shadow-lg m-0 w-full sm:w-auto"
                            disabled={permanentDeleteMutation.isPending}
                            onClick={() => {
                                if (pendingPermanentDelete) permanentDeleteMutation.mutate(pendingPermanentDelete.id);
                            }}
                        >
                            {permanentDeleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete permanently
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Trash;

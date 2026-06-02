import { format } from 'date-fns';
import {
  MapPin, Truck, Eye, Package, MoreVertical, Edit2, Trash2,
  Calendar, RefreshCcw, Pencil, Package as PackageIcon,
} from 'lucide-react';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OrderPhoneContactDropdown, OrderContactSubmenu } from '@/components/orders/OrderPhoneQuickActions';
import { getLatestTrackableCompanyParcel } from '@/lib/orders/getLatestTrackableCompanyParcel';
import SourceIcon from '@/components/orders/SourceIcon';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
import { cn } from '@/lib/utils';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';

interface OrdersListViewProps {
  orders: any[];
  selectedOrders: string[];
  duplicatePhones: Set<string>;
  toggleOrderSelection: (id: string) => void;
  toggleSelectAll: (ids: string[]) => void;
  onView: (order: any) => void;
  onEdit: (order: any) => void;
  onDelete: (order: { id: string; name: string }) => void;
  onTrackParcel: (orderId: string) => void;
  onStatusHistory: (order: any) => void;
  onQuickStatusChange: (order: any) => void;
  isOrderCategory: (statusId: string | null | undefined, cat: string) => boolean;
  getCourierPackageStatus: (order: any) => { label: string; color: string | null } | null;
}

export default function OrdersListView({
  orders,
  selectedOrders,
  duplicatePhones,
  toggleOrderSelection,
  toggleSelectAll,
  onView,
  onEdit,
  onDelete,
  onTrackParcel,
  onStatusHistory,
  onQuickStatusChange,
  isOrderCategory,
  getCourierPackageStatus,
}: OrdersListViewProps) {
  const { resolve } = usePackageStatusResolver();
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-ant-line overflow-hidden mb-20 animate-in fade-in duration-300">
      <div className="w-full">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-ant-line sticky top-0 z-10 bg-white/95 backdrop-blur-sm">
              <th className="px-3 py-3.5 w-10">
                <Checkbox
                  checked={selectedOrders.length === orders.length && orders.length > 0}
                  onCheckedChange={() => toggleSelectAll(orders.map((o) => o.id))}
                  className="h-4 w-4 rounded border-ant-ink/15 data-[state=checked]:bg-ant-ink data-[state=checked]:text-ant-light"
                />
              </th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">Customer</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">City / Source</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">Order Status</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">Package</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">Delivery</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid">Commercial</th>
              <th className="px-3 py-3.5 text-[10px] font-bold uppercase tracking-wider text-ant-mid text-right">Amount</th>
              <th className="px-3 py-3.5 w-[120px]" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order, idx) => {
              const isDuplicate = duplicatePhones.has(order.phone);
              const allParcels = [...(order.parcels || []), ...(order.courier_parcels || [])].filter((p: any) => p.tracking_code);
              const latestParcel = allParcels.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())?.[0];
              const trackingCode = latestParcel?.tracking_code;
              const hasTrackableCourierParcel = (order.courier_parcels || []).some((p: any) => p?.tracking_code && String(p.tracking_code).trim());
              const canTrack = !!getLatestTrackableCompanyParcel(order) || hasTrackableCourierParcel;

              const courierPkg = getCourierPackageStatus(order);
              const rawPkgLabel = order.package_status?.label || order.package_status_label || courierPkg?.label;
              const rawPkgColor = order.package_status?.color || courierPkg?.color || null;
              // Always resolve to the master status (label + color + icon); raw only as fallback.
              const resolvedPkg = rawPkgLabel ? resolve(rawPkgLabel, order.package_status?.label, rawPkgColor) : null;
              const pkgLabel = resolvedPkg?.label ?? rawPkgLabel;
              const pkgColor = resolvedPkg?.color ?? rawPkgColor;
              const pkgIcon = resolvedPkg?.icon ?? order.package_status?.icon ?? null;

              // First product (or accessory) with an image — the customer avatar
              // was never filled, so we surface the actually-ordered product
              // and reuse the products-page hover preview component.
              const firstItemWithImage = (Array.isArray(order.items) ? order.items : [])
                .find((it: any) => it?.product?.image_url || it?.accessory?.image_url);
              const productThumb: string | null =
                firstItemWithImage?.product?.image_url || firstItemWithImage?.accessory?.image_url || null;
              const productLabel: string =
                firstItemWithImage?.product?.name
                || firstItemWithImage?.accessory?.name
                || (order.items || []).find((i: any) => i?.product?.name || i?.accessory?.name)?.product?.name
                || (order.items || []).find((i: any) => i?.accessory?.name)?.accessory?.name
                || '';
              const productCode: string =
                firstItemWithImage?.product?.code || firstItemWithImage?.accessory?.code || '';

              const isSelected = selectedOrders.includes(order.id);

              return (
                <tr
                  key={order.id}
                  className={cn(
                    'border-b border-ant-line transition-all duration-200 group',
                    isSelected
                      ? 'bg-ant-ink/[0.025] border-l-[3px] border-l-brand-navy/25'
                      : 'border-l-[3px] border-l-transparent hover:bg-ant-ink/[0.012]',
                    idx % 2 === 0 && !isSelected && 'bg-ant-ink/[0.005]'
                  )}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      className="h-4 w-4 rounded border-ant-ink/15 data-[state=checked]:bg-ant-ink data-[state=checked]:text-ant-light"
                    />
                  </td>

                  {/* Customer + Date */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <ImageHoverPreview imageUrl={productThumb} name={productLabel} code={productCode}>
                        <div
                          className={cn(
                            'w-9 h-9 rounded-lg shrink-0 overflow-hidden flex items-center justify-center',
                            isDuplicate ? 'ring-1 ring-[#d4c438]/40' : 'bg-ant-ink/[0.04] border border-ant-line/60'
                          )}
                        >
                          {productThumb ? (
                            <img
                              src={productThumb}
                              alt={productLabel}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <PackageIcon className="w-4 h-4 text-ant-mid" />
                          )}
                        </div>
                      </ImageHoverPreview>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold truncate leading-tight flex items-center gap-1.5">
                          <span
                            className={cn('truncate', isDuplicate ? 'text-[#9a7f00]' : 'text-ant-ink')}
                            title={isDuplicate ? 'Same phone number on multiple orders' : order.name}
                          >
                            {order.name}
                          </span>
                          {order.replace && (
                            <span className="inline-flex shrink-0" title="Exchange">
                              <RefreshCcw className="w-3 h-3 text-ant-rose" />
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-ant-ink/35 font-medium truncate">{order.phone}</p>
                        {order.created_at && (
                          <p className="text-[10px] text-ant-ink/25 font-medium flex items-center gap-1 mt-0.5">
                            <Calendar className="w-2.5 h-2.5" />
                            {format(new Date(order.created_at), 'dd MMM · HH:mm')}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* City / Source */}
                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <p className="text-[12px] font-bold text-ant-ink leading-tight flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-ant-ink/25 shrink-0" />
                        {order.city?.name || '—'}
                      </p>
                      {order.source_name && (
                        <div className="flex items-center gap-1">
                          <SourceIcon source={order.source_name} showLabel />
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Order Status — Clickable */}
                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => onQuickStatusChange(order)}
                        className="group/status inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all duration-200 hover:shadow-md hover:scale-[1.03] cursor-pointer relative"
                        style={{
                          backgroundColor: `${order.status?.color}15`,
                          color: order.status?.color,
                        }}
                        title="Click to change status"
                      >
                        {order.status?.icon ? (
                          <DynamicIcon name={order.status.icon} className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: order.status?.color }} />
                        )}
                        {order.status?.label || 'DRAFT'}
                        <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/status:opacity-60 transition-opacity ml-0.5" />
                      </button>
                      {isOrderCategory(order.order_status_id, 'postponed') && order.reported_date && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-ant-orange">
                          <Calendar className="w-2.5 h-2.5" />
                          {format(new Date(order.reported_date), 'dd/MM HH:mm')}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Package Status */}
                  <td className="px-3 py-3">
                    {pkgLabel ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: pkgColor ? `${pkgColor}15` : 'rgba(0,31,63,0.04)',
                          color: pkgColor || 'rgba(0,31,63,0.45)',
                        }}
                      >
                        {pkgIcon ? (
                          <DynamicIcon name={pkgIcon} className="w-3.5 h-3.5 shrink-0" />
                        ) : pkgColor ? (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pkgColor }} />
                        ) : (
                          <Truck className="w-3.5 h-3.5 shrink-0" />
                        )}
                        {pkgLabel}
                      </span>
                    ) : (
                      <span className="text-[10px] text-ant-ink/15">—</span>
                    )}
                  </td>

                  {/* Delivery Provider / Courier */}
                  <td className="px-3 py-3">
                    {(order.company?.name || order.courier?.name) ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="shrink-0">
                                {order.company?.logo_url ? (
                                  <img
                                    src={order.company.logo_url}
                                    alt=""
                                    className="w-7 h-7 rounded-lg object-contain bg-white border border-ant-line p-0.5"
                                  />
                                ) : order.courier?.avatar_url ? (
                                  <Avatar className="w-7 h-7 border border-ant-line">
                                    <AvatarImage src={order.courier.avatar_url} />
                                    <AvatarFallback className="bg-ant-ink/10 text-ant-ink text-[9px] font-bold">
                                      {(order.courier.name || '?')[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                ) : (
                                  <div className="w-7 h-7 rounded-lg bg-ant-ink/[0.06] flex items-center justify-center">
                                    <Truck className="w-3.5 h-3.5 text-ant-mid" />
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs font-bold">
                              {order.company?.name || order.courier?.name}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-ant-ink/60 truncate max-w-[80px]">
                            {order.company?.name || order.courier?.name}
                          </p>
                          {trackingCode && (
                            <p className="text-[9px] font-mono font-bold text-indigo-600/70 truncate max-w-[80px]" title={trackingCode}>
                              {trackingCode}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-ant-ink/15">—</span>
                    )}
                  </td>

                  {/* Commercial / Assignee */}
                  <td className="px-3 py-3">
                    {order.assignee ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="w-6 h-6 border border-white shadow-sm">
                          <AvatarImage src={order.assignee.avatar_url} />
                          <AvatarFallback className="bg-ant-ink/10 text-ant-ink text-[9px] font-bold">
                            {order.assignee.name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[11px] font-bold text-ant-ink/60 truncate max-w-[70px]">
                          {order.assignee.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-ant-ink/15">—</span>
                    )}
                  </td>

                  {/* Amount */}
                  <td className="px-3 py-3 text-right">
                    <span className="text-sm font-black text-ant-ink tabular-nums">
                      {new Intl.NumberFormat('fr-FR').format(order.price || 0)}
                    </span>
                    <span className="text-[10px] font-bold text-ant-mid ml-1">DH</span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => onView(order)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-ant-ink/25 hover:text-ant-ink hover:bg-ant-ink/5 transition-colors"
                        title="View details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <OrderPhoneContactDropdown phone={order.phone} variant="icon" />
                      <button
                        type="button"
                        disabled={!canTrack}
                        title={canTrack ? 'Track parcel' : 'No parcel to track'}
                        onClick={() => { if (canTrack) onTrackParcel(order.id); }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-ant-ink/25 hover:text-ant-ink hover:bg-ant-ink/5 transition-colors disabled:opacity-25 disabled:pointer-events-none"
                      >
                        <Truck className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Status history"
                        onClick={() => onStatusHistory(order)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-ant-ink/25 hover:text-ant-ink hover:bg-ant-ink/5 transition-colors"
                      >
                        <Package className="w-3.5 h-3.5" />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-ant-mid hover:text-ant-ink hover:bg-ant-ink/5 transition-colors"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-none shadow-2xl p-1.5 min-w-[150px]">
                          <DropdownMenuItem onClick={() => onEdit(order)} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </DropdownMenuItem>
                          <OrderContactSubmenu phone={order.phone} />
                          <DropdownMenuItem
                            disabled={!canTrack}
                            onClick={() => { if (canTrack) onTrackParcel(order.id); }}
                            className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold"
                          >
                            <Truck className="w-3.5 h-3.5" /> Track
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onDelete({ id: order.id, name: order.name })}
                            className="rounded-lg px-3 py-2 cursor-pointer text-ant-rose focus:bg-ant-rose/10 focus:text-ant-rose gap-2.5 text-xs font-bold"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
}

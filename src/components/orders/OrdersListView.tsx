import { format } from 'date-fns';
import {
  MapPin, Truck, Eye, Package, MoreVertical, Edit2, Trash2, FileSpreadsheet,
  Calendar, RefreshCcw, Pencil, Package as PackageIcon, AlertTriangle, PackageOpen,
} from 'lucide-react';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { UserAvatar } from '@/components/users/UserAvatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OrderPhoneContactDropdown, OrderContactSubmenu } from '@/components/orders/OrderPhoneQuickActions';
import SourceIcon from '@/components/orders/SourceIcon';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
import { cn } from '@/lib/utils';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';

// D1: rows are the SLIM `orders_list_page` RPC shape — flat `city_name`,
// server-computed `latest_tracking_code` / `can_track` / `is_duplicate_phone`,
// and flat `items[]` ({product_id, accessory_id, quantity, accessory_quantity,
// name, code, image_url}) instead of the old nested PostgREST joins.
interface OrdersListViewProps {
  orders: any[];
  selectedOrders: string[];
  shortOrderIds?: Set<string>;
  lockedOrderIds?: Set<string>;
  toggleOrderSelection: (id: string) => void;
  toggleSelectAll: (ids: string[]) => void;
  onView: (order: any) => void;
  onEdit: (order: any) => void;
  onDelete: (order: { id: string; name: string }) => void;
  onTrackParcel: (orderId: string) => void;
  onStatusHistory: (order: any) => void;
  onQuickStatusChange: (order: any) => void;
  onStockAlert?: (order: any) => void;
  /** Coliaty parcel-change demand — host owns the dialog's open state. */
  onModifyParcel?: (order: any) => void;
  getModifyParcelGate?: (order: any) => { visible: boolean };
  isOrderCategory: (statusId: string | null | undefined, cat: string) => boolean;
  getCourierPackageStatus: (order: any) => { label: string; color: string | null } | null;
}

export default function OrdersListView({
  orders,
  selectedOrders,
  shortOrderIds,
  lockedOrderIds,
  toggleOrderSelection,
  toggleSelectAll,
  onView,
  onEdit,
  onDelete,
  onTrackParcel,
  onStatusHistory,
  onQuickStatusChange,
  onStockAlert,
  onModifyParcel,
  getModifyParcelGate,
  isOrderCategory,
  getCourierPackageStatus,
}: OrdersListViewProps) {
  const { resolve, resolveById } = usePackageStatusResolver();
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
              const isDuplicate = !!order.is_duplicate_phone;
              const isShort = !!shortOrderIds?.has(order.id);
              const locked = !!lockedOrderIds?.has(order.id);
              const exchangeRole = order._exchangeRole as ('exchange' | 'sale' | 'original' | undefined);
              const trackingCode = order.latest_tracking_code;
              const canTrack = !!order.can_track;
              const modifyParcelGate = getModifyParcelGate?.(order);

              const courierPkg = getCourierPackageStatus(order);
              const rawPkgLabel = order.package_status?.label || courierPkg?.label;
              const rawPkgColor = order.package_status?.color || courierPkg?.color || null;
              // Always resolve to the master status (label + color + icon); raw only as fallback.
              const resolvedPkg = resolveById(order.package_status_id)
                ?? (rawPkgLabel ? resolve(rawPkgLabel, order.package_status?.label, rawPkgColor) : null);
              const pkgLabel = resolvedPkg?.label ?? rawPkgLabel;
              const pkgColor = resolvedPkg?.color ?? rawPkgColor;
              const pkgIcon = resolvedPkg?.icon ?? order.package_status?.icon ?? null;

              // First item with an image — the customer avatar was never
              // filled, so we surface the actually-ordered product and reuse
              // the products-page hover preview component. Slim items carry a
              // flat name/code/image_url (product name, accessory image
              // coalesced server-side).
              const firstItemWithImage = (Array.isArray(order.items) ? order.items : [])
                .find((it: any) => it?.image_url);
              const productThumb: string | null = firstItemWithImage?.image_url || null;
              const productLabel: string =
                firstItemWithImage?.name
                || (order.items || []).find((i: any) => i?.name)?.name
                || '';
              const productCode: string = firstItemWithImage?.code || '';

              const isSelected = selectedOrders.includes(order.id);

              return (
                <tr
                  key={order.id}
                  className={cn(
                    'border-b border-ant-line transition-all duration-200 group',
                    isSelected
                      ? 'bg-ant-ink/[0.025] border-l-[3px] border-l-brand-navy/25'
                      : 'border-l-[3px] border-l-transparent hover:bg-ant-ink/[0.012]',
                    idx % 2 === 0 && !isSelected && 'bg-ant-ink/[0.005]',
                    // Duplicate-phone rows: a clean, soft wash of the brand orange across
                    // the whole row. Last in the list so tailwind-merge overrides the
                    // zebra/selection background.
                    isDuplicate && !isShort && !isSelected && 'bg-yellow-400/[0.12] hover:bg-yellow-400/[0.18] border-l-yellow-400/60',
                    isDuplicate && !isShort && isSelected && 'bg-yellow-400/[0.22] border-l-yellow-400/70',
                    // Insufficient-stock rows: red wash wins over duplicate orange.
                    isShort && !isSelected && 'bg-red-500/[0.06] hover:bg-red-500/[0.10] border-l-red-500/50',
                    isShort && isSelected && 'bg-red-500/[0.12] border-l-red-500/60',
                    // Exchange group: render 2–3 related rows (returned leg + added-sale leg +
                    // original) as ONE connected purple block — unified fill, continuous left
                    // bar, cap on the first (top) and last (bottom) rows, no divider between.
                    exchangeRole && 'bg-purple-500/[0.07] hover:bg-purple-500/[0.11] border-l-[3px] border-l-purple-500/70',
                    exchangeRole && !order._exchangeLast && 'border-b-0',
                    exchangeRole && order._exchangeFirst && 'border-t border-t-purple-400/50',
                    exchangeRole && order._exchangeLast && 'border-b border-b-purple-400/50',
                  )}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      disabled={locked}
                      className={cn("h-4 w-4 rounded border-ant-ink/15 data-[state=checked]:bg-ant-ink data-[state=checked]:text-ant-light", locked && 'opacity-40 cursor-not-allowed')}
                    />
                  </td>

                  {/* Customer + Date */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <ImageHoverPreview imageUrl={productThumb} name={productLabel} code={productCode}>
                        <div
                          className={cn(
                            'w-9 h-9 rounded-lg shrink-0 overflow-hidden flex items-center justify-center',
                            isDuplicate ? 'ring-1 ring-ant-orange/30' : 'bg-ant-ink/[0.04] border border-ant-line/60'
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
                            className={cn('truncate', isDuplicate ? 'text-ant-orange' : isShort ? 'text-red-600' : 'text-ant-ink')}
                            title={isShort ? 'Insufficient stock — cannot be confirmed' : isDuplicate ? 'Same phone number on multiple orders' : order.name}
                          >
                            {order.name}
                          </span>
                          {isShort && (
                            <button
                              type="button"
                              title="Stock insuffisant — cliquer pour les détails"
                              onClick={(e) => { e.stopPropagation(); onStockAlert?.(order); }}
                              className="ml-1 shrink-0 inline-flex items-center justify-center text-red-500 hover:text-red-600"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {order.replace && (
                            <span className="inline-flex shrink-0" title="Exchange">
                              <RefreshCcw className="w-3 h-3 text-ant-rose" />
                            </span>
                          )}
                          {exchangeRole === 'exchange' && (
                            <span className="ml-1 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 text-[9px] font-bold uppercase tracking-wide">ÉCHANGE</span>
                          )}
                          {exchangeRole === 'sale' && (
                            <span className="ml-1 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 text-[9px] font-bold uppercase tracking-wide" title="Produit ajouté — vente liée à l'échange">+ VENTE</span>
                          )}
                          {exchangeRole === 'original' && (
                            <span className="ml-1 shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold text-purple-700/70" title="Colis d'origine (retour de l'échange)">↳ origine</span>
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
                        {order.city_name || '—'}
                      </p>
                      {(order as any).channel?.name ? (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-ant-ink/70">
                          <FileSpreadsheet className="w-3 h-3 text-[#0F9D58] shrink-0" />
                          <span className="truncate capitalize">{(order as any).channel.name}</span>
                        </div>
                      ) : order.source_name ? (
                        <div className="flex items-center gap-1">
                          <SourceIcon source={order.source_name} showLabel />
                        </div>
                      ) : null}
                    </div>
                  </td>

                  {/* Order Status — Clickable */}
                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => { if (locked) return; onQuickStatusChange(order); }}
                        disabled={locked}
                        className={cn("group/status inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all duration-200 relative", locked ? "cursor-default opacity-70" : "hover:shadow-md hover:scale-[1.03] cursor-pointer")}
                        style={{
                          backgroundColor: `${order.status?.color}15`,
                          color: order.status?.color,
                        }}
                        title={locked ? "Commande verrouillée" : "Click to change status"}
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
                                {resolveProviderLogo(order.company) ? (
                                  <img
                                    src={resolveProviderLogo(order.company)!}
                                    alt=""
                                    className="w-7 h-7 rounded-lg object-contain bg-white border border-ant-line p-0.5"
                                  />
                                ) : order.courier?.avatar_url || (order.courier as any)?.avatar_config ? (
                                  <UserAvatar
                                    url={order.courier.avatar_url}
                                    config={(order.courier as any).avatar_config}
                                    name={order.courier.name}
                                    className="w-7 h-7 rounded-full border border-ant-line"
                                  />
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
                        <UserAvatar
                          url={order.assignee.avatar_url}
                          config={(order.assignee as any).avatar_config}
                          name={order.assignee.name}
                          className="w-6 h-6 rounded-full border border-white shadow-sm"
                        />
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
                          <DropdownMenuItem onClick={() => onEdit(order)} disabled={locked} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
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
                          {modifyParcelGate?.visible && (
                            <DropdownMenuItem
                              onClick={() => onModifyParcel?.(order)}
                              className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold"
                            >
                              <PackageOpen className="w-3.5 h-3.5" /> Modify Parcel
                            </DropdownMenuItem>
                          )}
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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
    Wallet,
    TrendingUp,
    Package,
    CheckCircle2,
    Eye,
    Printer,
    Search,
    SearchX,
    Loader2,
    Hash,
    Calendar,
    X,
    Sparkles,
    ArrowDown,
    Receipt,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type PaymentNote = {
    id: string;
    reference: string;
    status: string;
    total_amount: number;
    total_shipping_fees: number;
    net_amount: number;
    order_count: number;
    paid_at: string | null;
    created_at: string;
    note: string | null;
    line_items: Array<{
        id: string;
        order_id: string;
        tracking_code: string | null;
        amount: number;
        shipping_fee: number;
    }>;
};

const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const CourierPayments = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);

    // ─── Current courier ───
    const { data: me } = useQuery({
        queryKey: ['courier-me-payments'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, "DigiCom Business"')
                .eq('id', user.id)
                .maybeSingle();
            return data as { id: string; name: string | null; avatar_url: string | null; ['DigiCom Business']: string } | null;
        },
        staleTime: 60_000,
    });

    const courierId = me?.id;
    const businessId = me?.['DigiCom Business'];

    // ─── Fetch courier's PAID payment notes only ───
    const { data: notes = [], isLoading } = useQuery({
        queryKey: ['courier-payment-notes', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select(
                    `id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at, note,
                    line_items:courier_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`
                )
                .eq('courier_id', courierId)
                .eq('DigiCom Business', businessId)
                .eq('status', 'paid')
                .order('paid_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
        enabled: !!courierId && !!businessId,
    });

    // ─── Aggregate stats ───
    const stats = useMemo(() => {
        const lifetimeEarnings = notes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const lifetimeDelivered = notes.reduce((s, n) => s + Number(n.order_count || 0), 0);
        const lifetimeGross = notes.reduce((s, n) => s + Number(n.total_amount || 0), 0);

        const now = new Date();
        const monthKey = format(now, 'yyyy-MM');
        const thisMonthNotes = notes.filter(
            (n) => n.paid_at && format(new Date(n.paid_at), 'yyyy-MM') === monthKey
        );
        const thisMonthEarnings = thisMonthNotes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const thisMonthDelivered = thisMonthNotes.reduce((s, n) => s + Number(n.order_count || 0), 0);

        return {
            lifetimeEarnings,
            lifetimeDelivered,
            lifetimeGross,
            thisMonthEarnings,
            thisMonthDelivered,
            totalNotes: notes.length,
        };
    }, [notes]);

    // ─── Search filter ───
    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return notes;
        const q = searchQuery.toLowerCase();
        return notes.filter(
            (n) =>
                n.reference.toLowerCase().includes(q) ||
                n.line_items.some((li) => (li.tracking_code || '').toLowerCase().includes(q))
        );
    }, [notes, searchQuery]);

    // ─── Premium print template (courier-oriented) ───
    const handlePrint = async (note: PaymentNote) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(
            '<!doctype html><html><head><title>' +
                note.reference +
                '</title></head><body style="font-family:system-ui;padding:40px;color:#3b5e5e">Loading…</body></html>'
        );
        w.document.close();

        let businessName = 'DigiCom';
        let businessLogo: string | null = null;
        if (businessId) {
            const { data } = await (supabase as any).from('businesses').select('name, logo').eq('id', businessId).single();
            if (data) {
                businessName = data.name || businessName;
                businessLogo = data.logo || null;
            }
        }

        const courierName = me?.name || 'Courier';
        const courierAvatar = me?.avatar_url || null;
        const createdAt = format(new Date(note.created_at), 'dd MMM yyyy • HH:mm');
        const paidAt = note.paid_at ? format(new Date(note.paid_at), 'dd MMM yyyy • HH:mm') : '—';

        const rows = note.line_items
            .map(
                (li, i) => `
            <tr>
                <td class="num">${String(i + 1).padStart(2, '0')}</td>
                <td class="track">${li.tracking_code || '—'}</td>
                <td class="right">${Number(li.amount).toFixed(2)}</td>
                <td class="right green bold">+${Number(li.shipping_fee).toFixed(2)}</td>
                <td class="right">${(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
            </tr>`
            )
            .join('');

        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${note.reference}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #3b5e5e; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; font-feature-settings: "ss01","cv11"; }
  .sheet { padding: 22mm 18mm; min-height: 297mm; display: flex; flex-direction: column; }
  .hdr { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 28px; border-bottom: 1px solid #eef1ee; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand .logo { width: 56px; height: 56px; border-radius: 16px; background: #f6f7f3; border: 1px solid #eef1ee; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .brand .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .brand .logo.fallback { background: #3b5e5e; color: #daddcc; font-weight: 900; font-size: 18px; letter-spacing: 0.5px; }
  .brand .name { font-size: 18px; font-weight: 800; color: #3b5e5e; letter-spacing: -0.3px; line-height: 1; }
  .brand .sub { font-size: 9px; font-weight: 700; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2.5px; margin-top: 6px; }
  .meta { text-align: right; }
  .meta .kicker { font-size: 9px; font-weight: 800; color: #059669; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; }
  .meta h1 { margin: 0; font-size: 26px; font-weight: 900; color: #3b5e5e; font-family: "SF Mono", Menlo, monospace; letter-spacing: -0.5px; }
  .meta .date { font-size: 11px; color: #9aa6a0; margin-top: 6px; font-weight: 500; }
  .courier { margin-top: 32px; display: flex; align-items: center; gap: 18px; padding: 20px 22px; background: #f9faf7; border: 1px solid #eef1ee; border-radius: 20px; }
  .courier .ava { width: 60px; height: 60px; border-radius: 18px; overflow: hidden; background: #fff; border: 1px solid #eef1ee; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .courier .ava img { width: 100%; height: 100%; object-fit: cover; }
  .courier .ava.fallback { background: #3b5e5e; color: #daddcc; font-weight: 900; font-size: 18px; }
  .courier .info .label { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  .courier .info .val { font-size: 20px; font-weight: 800; color: #3b5e5e; letter-spacing: -0.3px; }
  .courier .badge { margin-left: auto; padding: 8px 16px; border-radius: 999px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; background: #d1fae5; color: #065f46; }
  .hero { margin-top: 22px; padding: 32px 28px; background: linear-gradient(135deg, #3b5e5e 0%, #2d4747 100%); color: #fff; border-radius: 24px; position: relative; overflow: hidden; }
  .hero::before { content: ''; position: absolute; top: 0; right: 0; width: 240px; height: 240px; background: radial-gradient(circle, rgba(167,243,208,0.18) 0%, transparent 70%); }
  .hero .lbl { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 3px; color: rgba(167,243,208,0.8); margin-bottom: 10px; position: relative; }
  .hero .val { font-size: 48px; font-weight: 900; color: #a7f3d0; letter-spacing: -1.5px; font-variant-numeric: tabular-nums; line-height: 1; position: relative; }
  .hero .val span { font-size: 20px; font-weight: 700; color: rgba(167,243,208,0.6); margin-left: 8px; }
  .hero .sub { margin-top: 12px; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.55); position: relative; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 18px; }
  .stat { padding: 18px 20px; background: #fff; border: 1px solid #eef1ee; border-radius: 18px; }
  .stat .k { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .stat .v { font-size: 18px; font-weight: 900; color: #3b5e5e; font-variant-numeric: tabular-nums; }
  .stat .v.ghost { color: #9aa6a0; }
  table { width: 100%; border-collapse: collapse; margin-top: 28px; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; padding: 12px 14px; font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1px solid #eef1ee; }
  thead th.right { text-align: right; }
  tbody td { padding: 14px; font-size: 12px; border-bottom: 1px solid #f4f6f2; color: #3b5e5e; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: #9aa6a0; font-weight: 700; width: 40px; }
  td.track { font-family: "SF Mono", Menlo, monospace; font-size: 11px; font-weight: 700; letter-spacing: -0.3px; }
  td.right { text-align: right; }
  td.green { color: #059669; }
  td.bold { font-weight: 800; }
  .foot { margin-top: auto; padding-top: 24px; border-top: 1px solid #eef1ee; display: flex; justify-content: space-between; font-size: 9px; color: #9aa6a0; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; }
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <div class="brand">
      ${
          businessLogo
              ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>`
              : `<div class="logo fallback">${businessName.substring(0, 2).toUpperCase()}</div>`
      }
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Courier Payout</div>
      </div>
    </div>
    <div class="meta">
      <div class="kicker">Settled</div>
      <h1>${note.reference}</h1>
      <div class="date">${paidAt}</div>
    </div>
  </div>

  <div class="courier">
    ${
        courierAvatar
            ? `<div class="ava"><img src="${courierAvatar}" alt=""/></div>`
            : `<div class="ava fallback">${courierName.substring(0, 2).toUpperCase()}</div>`
    }
    <div class="info">
      <div class="label">Beneficiary</div>
      <div class="val">${courierName}</div>
    </div>
    <span class="badge">Paid</span>
  </div>

  <div class="hero">
    <div class="lbl">Your Earnings</div>
    <div class="val">${fmtMAD(note.total_shipping_fees)}<span>MAD</span></div>
    <div class="sub">Delivery fees for ${note.order_count} successfully delivered parcel${note.order_count !== 1 ? 's' : ''}</div>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Delivered</div><div class="v">${note.order_count}</div></div>
    <div class="stat"><div class="k">Gross Collected</div><div class="v ghost">${fmtMAD(note.total_amount)} MAD</div></div>
    <div class="stat"><div class="k">Settled to Business</div><div class="v ghost">${fmtMAD(note.net_amount)} MAD</div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Order</th><th class="right">Your Fee</th><th class="right">To Business</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="foot">
    <span>${businessName} • Payout Statement</span>
    <span>Generated ${createdAt}</span>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},120);};</script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    return (
        <div className="space-y-5 sm:space-y-6 pb-28 sm:pb-6">
            {/* ─── Hero: lifetime earnings ─── */}
            <div className="relative overflow-hidden rounded-[28px] sm:rounded-[36px] bg-gradient-to-br from-brand-navy via-[#2d4747] to-[#1f3535] text-white shadow-2xl">
                <div className="absolute -top-20 -right-20 w-[280px] h-[280px] rounded-full bg-emerald-300/20 blur-3xl" />
                <div className="absolute -bottom-24 -left-10 w-[220px] h-[220px] rounded-full bg-brand-white/5 blur-3xl" />

                <div className="relative p-6 sm:p-10 space-y-6 sm:space-y-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-200/75">
                                Lifetime Earnings
                            </p>
                            <h1 className="text-xs sm:text-sm font-semibold text-white/50">
                                {me?.name || 'Courier'}
                            </h1>
                        </div>
                        <div className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-300/15 backdrop-blur-md border border-emerald-300/20 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-200" />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-5xl sm:text-7xl font-black tracking-tight text-emerald-200 tabular-nums leading-none">
                                {fmtMAD(stats.lifetimeEarnings)}
                            </span>
                            <span className="text-lg sm:text-2xl font-bold text-emerald-200/50">MAD</span>
                        </div>
                        <p className="mt-3 text-[11px] sm:text-xs font-semibold text-white/40 flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-emerald-300/60" />
                            From {stats.lifetimeDelivered} delivered parcels across {stats.totalNotes} payout{stats.totalNotes !== 1 ? 's' : ''}
                        </p>
                    </div>

                    {/* Mini stats grid */}
                    <div className="grid grid-cols-2 gap-3 pt-5 border-t border-white/10">
                        <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Calendar className="w-3 h-3 text-white/30" />
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">
                                    This Month
                                </p>
                            </div>
                            <p className="text-xl sm:text-2xl font-black text-white tabular-nums">
                                {fmtMAD(stats.thisMonthEarnings)}
                                <span className="text-[10px] font-bold text-white/30 ml-1">MAD</span>
                            </p>
                            <p className="text-[10px] font-semibold text-white/30 mt-0.5">
                                {stats.thisMonthDelivered} parcels
                            </p>
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Package className="w-3 h-3 text-white/30" />
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">
                                    Gross Collected
                                </p>
                            </div>
                            <p className="text-xl sm:text-2xl font-black text-white tabular-nums">
                                {fmtMAD(stats.lifetimeGross)}
                                <span className="text-[10px] font-bold text-white/30 ml-1">MAD</span>
                            </p>
                            <p className="text-[10px] font-semibold text-white/30 mt-0.5">Handled lifetime</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Title + search ─── */}
            <div className="space-y-3">
                <div className="flex items-end justify-between gap-3 px-1">
                    <div>
                        <h2 className="text-lg sm:text-2xl font-black text-brand-navy tracking-tight">
                            Payout History
                        </h2>
                        <p className="text-[11px] sm:text-xs font-semibold text-brand-navy/45">
                            Settled payments from the business
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                            Paid Only
                        </span>
                    </div>
                </div>

                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                    <Input
                        placeholder="Search by ref or tracking code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-12 sm:h-14 pl-11 sm:pl-12 pr-4 rounded-2xl sm:rounded-[20px] border-none bg-white shadow-sm font-bold text-brand-navy placeholder:text-brand-navy/30 focus-visible:ring-brand-navy/10"
                    />
                </div>
            </div>

            {/* ─── List ─── */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 text-brand-navy/40 animate-spin" />
                    <p className="text-xs font-bold text-brand-navy/40 uppercase tracking-widest">Chargement…</p>
                </div>
            ) : filteredNotes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 sm:py-20 gap-4 text-center px-6">
                    <div className="w-16 h-16 rounded-3xl bg-brand-navy/[0.04] flex items-center justify-center">
                        <SearchX className="w-7 h-7 text-brand-navy/30" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-bold text-brand-navy">
                            {searchQuery ? 'Aucun paiement trouvé' : 'Aucun paiement pour le moment'}
                        </p>
                        <p className="text-xs text-brand-navy/40 font-medium max-w-xs">
                            {searchQuery
                                ? 'Essayez un autre terme de recherche.'
                                : 'Vos payouts apparaîtront ici une fois versés par le business.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredNotes.map((note) => (
                        <PayoutCard
                            key={note.id}
                            note={note}
                            onOpen={() => setSelectedNote(note)}
                            onPrint={() => handlePrint(note)}
                        />
                    ))}
                </div>
            )}

            {/* ─── Detail sheet ─── */}
            <PayoutDetailSheet
                note={selectedNote}
                onClose={() => setSelectedNote(null)}
                onPrint={() => selectedNote && handlePrint(selectedNote)}
            />
        </div>
    );
};

export default CourierPayments;

// ─────────────────────────────────────────────────────────────────────────────
// Payout card
// ─────────────────────────────────────────────────────────────────────────────
function PayoutCard({
    note,
    onOpen,
    onPrint,
}: {
    note: PaymentNote;
    onOpen: () => void;
    onPrint: () => void;
}) {
    const dateStr = note.paid_at
        ? format(new Date(note.paid_at), 'dd MMM yyyy')
        : format(new Date(note.created_at), 'dd MMM yyyy');

    return (
        <div className="group relative bg-white rounded-[22px] sm:rounded-[28px] border border-brand-navy/[0.05] shadow-sm hover:shadow-lg hover:border-brand-navy/15 transition-all duration-300 overflow-hidden">
            <div className="h-[3px] w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600" />

            <button
                type="button"
                onClick={onOpen}
                className="w-full text-left p-4 sm:p-5 active:scale-[0.995] transition-transform"
            >
                {/* Row 1 */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Paid
                            </span>
                            <span className="text-[10px] font-bold text-brand-navy/40">{dateStr}</span>
                        </div>
                        <p className="mt-1.5 font-mono text-sm sm:text-base font-black text-brand-navy tracking-tight truncate">
                            {note.reference}
                        </p>
                    </div>

                    <div className="text-right shrink-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/35">Earned</p>
                        <div className="flex items-baseline gap-1 justify-end">
                            <span className="text-xl sm:text-2xl font-black text-emerald-600 tabular-nums leading-none">
                                +{fmtMAD(note.total_shipping_fees)}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-600/50">MAD</span>
                        </div>
                    </div>
                </div>

                {/* Row 2 */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/65">
                        <Package className="w-3 h-3 text-brand-navy/35" />
                        {note.order_count} delivered
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/65">
                        <Wallet className="w-3 h-3 text-brand-navy/35" />
                        {fmtMAD(note.total_amount)} collected
                    </span>
                </div>
            </button>

            {/* Actions — 44px+ touch targets */}
            <div className="px-3 pb-3 sm:px-4 sm:pb-4 grid grid-cols-2 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpen();
                    }}
                    className="h-11 rounded-xl font-bold text-xs border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5"
                >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    View
                </Button>
                <Button
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onPrint();
                    }}
                    className="h-11 rounded-xl font-bold text-xs bg-brand-navy hover:bg-brand-navy/90 text-white"
                >
                    <Printer className="w-3.5 h-3.5 mr-1.5" />
                    Print
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet (mobile bottom sheet / desktop dialog)
// ─────────────────────────────────────────────────────────────────────────────
function PayoutDetailSheet({
    note,
    onClose,
    onPrint,
}: {
    note: PaymentNote | null;
    onClose: () => void;
    onPrint: () => void;
}) {
    return (
        <Dialog open={!!note} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className={cn(
                    'p-0 border-none bg-brand-white overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[600px] sm:rounded-[32px] sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-[28px] max-sm:!rounded-b-none'
                )}
            >
                {note && (
                    <div className="flex flex-col h-full max-h-[inherit]">
                        {/* Mobile drag handle */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-12 h-1.5 rounded-full bg-brand-navy/10" />
                        </div>

                        {/* Header */}
                        <DialogHeader className="px-5 sm:px-8 pt-3 sm:pt-8 pb-4 shrink-0 border-b border-brand-navy/5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider">
                                            <CheckCircle2 className="w-2.5 h-2.5" />
                                            Paid
                                        </span>
                                        <DialogDescription className="text-[10px] font-bold text-brand-navy/40 m-0">
                                            {note.paid_at
                                                ? format(new Date(note.paid_at), 'dd MMM yyyy • HH:mm')
                                                : '—'}
                                        </DialogDescription>
                                    </div>
                                    <DialogTitle className="font-mono text-lg sm:text-2xl font-black text-brand-navy truncate">
                                        {note.reference}
                                    </DialogTitle>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="hidden sm:flex w-10 h-10 shrink-0 items-center justify-center rounded-full hover:bg-brand-navy/5 text-brand-navy/50 hover:text-brand-navy transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </DialogHeader>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 space-y-5">
                            {/* Earnings hero */}
                            <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-brand-navy via-[#2d4747] to-[#1f3535] text-white p-6 sm:p-7">
                                <div className="absolute -top-16 -right-16 w-[200px] h-[200px] rounded-full bg-emerald-300/15 blur-3xl" />
                                <div className="relative">
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-200/75 mb-3">
                                        Your Earnings
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-4xl sm:text-5xl font-black text-emerald-200 tabular-nums leading-none">
                                            {fmtMAD(note.total_shipping_fees)}
                                        </span>
                                        <span className="text-base sm:text-xl font-bold text-emerald-200/50">MAD</span>
                                    </div>
                                    <p className="mt-3 text-[11px] font-semibold text-white/40">
                                        Delivery fees for {note.order_count} successfully delivered parcel
                                        {note.order_count !== 1 ? 's' : ''}
                                    </p>
                                </div>
                            </div>

                            {/* Context stats */}
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="p-3.5 rounded-2xl bg-white border border-brand-navy/[0.06]">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Package className="w-3 h-3 text-brand-navy/30" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">
                                            Delivered
                                        </p>
                                    </div>
                                    <p className="text-lg font-black text-brand-navy tabular-nums">{note.order_count}</p>
                                </div>
                                <div className="p-3.5 rounded-2xl bg-white border border-brand-navy/[0.06]">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Wallet className="w-3 h-3 text-brand-navy/30" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">
                                            Gross
                                        </p>
                                    </div>
                                    <p className="text-lg font-black text-brand-navy tabular-nums">
                                        {fmtMAD(note.total_amount)}
                                        <span className="text-[9px] font-bold text-brand-navy/30 ml-1">MAD</span>
                                    </p>
                                </div>
                            </div>

                            {/* Flow breakdown */}
                            <div className="rounded-2xl bg-white border border-brand-navy/[0.06] p-4 sm:p-5 space-y-3.5">
                                <div className="flex items-center gap-2 mb-1">
                                    <Receipt className="w-3.5 h-3.5 text-brand-navy/40" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        Flow Breakdown
                                    </p>
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-brand-navy/60">Total collected</span>
                                    <span className="text-sm font-black text-brand-navy tabular-nums">
                                        {fmtMAD(note.total_amount)}{' '}
                                        <span className="text-[10px] font-bold text-brand-navy/30">MAD</span>
                                    </span>
                                </div>

                                <div className="relative pl-6">
                                    <ArrowDown className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/25" />
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-emerald-700">Your delivery fees</span>
                                        <span className="text-sm font-black text-emerald-600 tabular-nums">
                                            +{fmtMAD(note.total_shipping_fees)}{' '}
                                            <span className="text-[10px] font-bold text-emerald-600/50">MAD</span>
                                        </span>
                                    </div>
                                </div>

                                <div className="h-px bg-brand-navy/5" />

                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-brand-navy/50">Settled to business</span>
                                    <span className="text-sm font-black text-brand-navy/50 tabular-nums">
                                        {fmtMAD(note.net_amount)}{' '}
                                        <span className="text-[10px] font-bold text-brand-navy/25">MAD</span>
                                    </span>
                                </div>
                            </div>

                            {/* Parcels */}
                            <div>
                                <div className="flex items-center justify-between mb-2.5 px-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/50">
                                        Parcels ({note.line_items.length})
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    {note.line_items.map((li, i) => (
                                        <div
                                            key={li.id}
                                            className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-brand-navy/[0.05]"
                                        >
                                            <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-navy/[0.04] flex items-center justify-center">
                                                <span className="text-[10px] font-black text-brand-navy/40 tabular-nums">
                                                    {String(i + 1).padStart(2, '0')}
                                                </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1">
                                                    <Hash className="w-3 h-3 text-brand-navy/30 shrink-0" />
                                                    <p className="font-mono text-xs font-black text-brand-navy truncate">
                                                        {li.tracking_code || '—'}
                                                    </p>
                                                </div>
                                                <p className="text-[10px] font-semibold text-brand-navy/40 tabular-nums mt-0.5">
                                                    {fmtMAD(li.amount)} MAD order
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600/60">
                                                    Earned
                                                </p>
                                                <p className="text-sm font-black text-emerald-600 tabular-nums">
                                                    +{fmtMAD(li.shipping_fee)}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Sticky footer */}
                        <div className="shrink-0 border-t border-brand-navy/5 bg-white p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
                            <Button
                                variant="outline"
                                onClick={onClose}
                                className="flex-1 h-12 rounded-2xl font-bold border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5 sm:hidden"
                            >
                                Close
                            </Button>
                            <Button
                                onClick={onPrint}
                                className="flex-1 h-12 rounded-2xl font-bold bg-brand-navy hover:bg-brand-navy/90 text-white shadow-xl shadow-brand-navy/20"
                            >
                                <Printer className="w-4 h-4 mr-2" />
                                Print Payout
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

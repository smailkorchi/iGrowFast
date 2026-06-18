import { AlertTriangle, X } from 'lucide-react';

export interface StockShortageGroup {
  orderName: string;
  lines: { name: string; needed: number; have: number }[];
}

export function StockShortageModal({
  open,
  onClose,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  groups: StockShortageGroup[];
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-ant-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-ant-line">
          <div className="shrink-0 w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-ant-ink">Stock insuffisant</h3>
            <p className="text-xs text-ant-ink/60 mt-0.5">
              La quantité commandée dépasse le stock disponible. Cette commande ne peut pas être confirmée.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-ant-ink/40 hover:text-ant-ink transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {groups.map((g, gi) => (
            <div key={gi}>
              {groups.length > 1 && (
                <div className="text-[11px] font-bold uppercase tracking-wide text-ant-ink/50 mb-1.5">{g.orderName}</div>
              )}
              <div className="space-y-1.5">
                {g.lines.length === 0 ? (
                  <div className="text-xs text-ant-ink/60">Stock insuffisant sur un ou plusieurs articles.</div>
                ) : g.lines.map((l, li) => (
                  <div key={li} className="flex items-center justify-between gap-3 text-xs rounded-lg bg-red-500/[0.06] px-3 py-2">
                    <span className="font-semibold text-ant-ink truncate">{l.name}</span>
                    <span className="shrink-0 text-ant-ink/70">
                      besoin <b className="text-red-600">{l.needed}</b> · en stock <b className="text-ant-ink">{l.have}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-ant-line flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-ant-ink text-white text-xs font-semibold hover:opacity-90 transition-opacity">
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}

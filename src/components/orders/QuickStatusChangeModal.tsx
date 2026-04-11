import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Loader2, Calendar as CalendarIcon, Clock, User } from 'lucide-react';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface QuickStatusChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: any;
  orderStatuses: any[];
  isOrderCategory: (statusId: string | null | undefined, cat: string) => boolean;
  onStatusChange: (params: {
    orderId: string;
    statusId: string;
    comment?: string;
    reportedDate?: string;
  }) => void;
  isPending: boolean;
}

export default function QuickStatusChangeModal({
  open,
  onOpenChange,
  order,
  orderStatuses,
  isOrderCategory,
  onStatusChange,
  isPending,
}: QuickStatusChangeModalProps) {
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reportedDate, setReportedDate] = useState<Date | undefined>(undefined);
  const [reportedTime, setReportedTime] = useState('12:00');

  if (!order) return null;

  const currentStatusId = order.order_status_id;
  const needsComment = selectedStatusId ? statusRequiresHistoryComment(selectedStatusId) : false;
  const isPostponed = selectedStatusId ? isOrderCategory(selectedStatusId, 'postponed') : false;
  const needsExtraInput = needsComment || isPostponed;

  const handleReset = () => {
    setSelectedStatusId(null);
    setComment('');
    setReportedDate(undefined);
    setReportedTime('12:00');
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) handleReset();
  };

  const handleStatusClick = (statusId: string) => {
    if (statusId === currentStatusId) return;

    const requiresComment = statusRequiresHistoryComment(statusId);
    const postponed = isOrderCategory(statusId, 'postponed');

    if (requiresComment || postponed) {
      setSelectedStatusId(statusId);
      return;
    }

    // Direct fire — no extra input needed
    onStatusChange({ orderId: order.id, statusId });
    handleReset();
  };

  const handleConfirm = () => {
    if (!selectedStatusId) return;
    if (needsComment && !comment.trim()) return;
    if (isPostponed && !reportedDate) return;

    let finalReportedDate: string | undefined;
    if (isPostponed && reportedDate) {
      const [hours, minutes] = reportedTime.split(':');
      const dt = new Date(reportedDate);
      dt.setHours(Number(hours), Number(minutes), 0, 0);
      finalReportedDate = dt.toISOString();
    }

    let finalComment = comment.trim() || undefined;
    if (isPostponed && reportedDate && finalComment) {
      const formattedDate = format(reportedDate, 'dd/MM/yyyy');
      finalComment = `[Report\u00e9 pour: ${formattedDate} ${reportedTime}] ${finalComment}`;
    } else if (isPostponed && reportedDate) {
      const formattedDate = format(reportedDate, 'dd/MM/yyyy');
      finalComment = `[Report\u00e9 pour: ${formattedDate} ${reportedTime}]`;
    }

    onStatusChange({
      orderId: order.id,
      statusId: selectedStatusId,
      comment: finalComment,
      reportedDate: finalReportedDate,
    });
    handleReset();
  };

  const selectedStatus = orderStatuses.find((s: any) => s.id === selectedStatusId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg p-0 border-none bg-brand-white rounded-[28px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 shrink-0 border-b border-brand-navy/[0.05]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-navy/[0.06] flex items-center justify-center">
              <User className="w-5 h-5 text-brand-navy/50" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-black text-brand-navy truncate">{order.name}</DialogTitle>
              <DialogDescription className="text-xs font-bold text-brand-navy/40">{order.phone}</DialogDescription>
            </div>
            {order.status && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide shrink-0"
                style={{ backgroundColor: `${order.status.color}15`, color: order.status.color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: order.status.color }} />
                {order.status.label}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          {/* Extra input section (shown when a status requiring comment/date is selected) */}
          {needsExtraInput && selectedStatus && (
            <div className="space-y-4 p-4 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.05]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedStatus.color }} />
                <span className="text-sm font-black text-brand-navy">{selectedStatus.label}</span>
              </div>

              {isPostponed && (
                <div className="flex items-center gap-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'flex-1 h-10 justify-start gap-2 rounded-xl border-brand-navy/[0.08] bg-white text-sm font-bold',
                          !reportedDate && 'text-brand-navy/30'
                        )}
                      >
                        <CalendarIcon className="w-4 h-4 text-brand-navy/30" />
                        {reportedDate ? format(reportedDate, 'dd MMM yyyy') : 'Pick date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-2xl" align="start">
                      <Calendar
                        mode="single"
                        selected={reportedDate}
                        onSelect={setReportedDate}
                        initialFocus
                        className="rounded-2xl"
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="relative w-28 shrink-0">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/30" />
                    <Input
                      type="time"
                      value={reportedTime}
                      onChange={(e) => setReportedTime(e.target.value)}
                      className="h-10 pl-9 rounded-xl border-brand-navy/[0.08] bg-white text-sm font-bold"
                    />
                  </div>
                </div>
              )}

              <Textarea
                placeholder={needsComment ? 'Comment required for this status...' : 'Add a comment (optional)...'}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-h-[70px] resize-none rounded-xl border-brand-navy/[0.08] bg-white text-sm font-bold text-brand-navy placeholder:text-brand-navy/25 focus-visible:ring-1 focus-visible:ring-brand-navy/20"
              />

              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="rounded-xl text-xs font-bold text-brand-navy/50 hover:text-brand-navy"
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isPending || (needsComment && !comment.trim()) || (isPostponed && !reportedDate)}
                  className="rounded-xl text-xs font-bold bg-brand-navy text-brand-white hover:bg-brand-navy/90 px-6"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                </Button>
              </div>
            </div>
          )}

          {/* Status grid */}
          {!needsExtraInput && (
            <div className="grid grid-cols-2 gap-2">
              {orderStatuses.map((status: any) => {
                const isCurrent = status.id === currentStatusId;
                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() => handleStatusClick(status.id)}
                    disabled={isPending || isCurrent}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 group',
                      isCurrent
                        ? 'bg-brand-navy/[0.06] ring-2 ring-brand-navy/15 cursor-default'
                        : 'bg-brand-navy/[0.015] hover:bg-brand-navy/[0.05] hover:shadow-sm cursor-pointer',
                      isPending && 'opacity-50 pointer-events-none'
                    )}
                  >
                    <span
                      className={cn(
                        'w-3.5 h-3.5 rounded-full shrink-0 transition-transform',
                        !isCurrent && 'group-hover:scale-125'
                      )}
                      style={{ backgroundColor: status.color }}
                    />
                    <span className={cn(
                      'text-[13px] font-bold truncate flex-1',
                      isCurrent ? 'text-brand-navy' : 'text-brand-navy/70 group-hover:text-brand-navy'
                    )}>
                      {status.label}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] font-black uppercase tracking-wider text-brand-navy/30">Current</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

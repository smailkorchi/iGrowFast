import { useToast } from "@/hooks/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastKicker,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastVariant,
} from "@/components/ui/toast";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
};

const VARIANT_ICON_TONE: Record<ToastVariant, string> = {
  default: "border-ant-ink/15 bg-ant-ink/6 text-ant-ink",
  success: "border-ant-green/25 bg-ant-green/10 text-ant-green",
  warning: "border-ant-orange/25 bg-ant-orange/10 text-ant-orange",
  destructive: "border-ant-rose/25 bg-ant-rose/10 text-ant-rose",
};

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={4500}>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const resolved: ToastVariant = (variant as ToastVariant) ?? "default";
        const Icon = VARIANT_ICON[resolved];
        return (
          <Toast key={id} variant={resolved} {...props}>
            <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${VARIANT_ICON_TONE[resolved]}`}>
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <ToastKicker />
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}

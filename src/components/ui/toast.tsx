import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[380px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border border-ant-line bg-ant-paper p-4 pr-10 shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] transition-all before:absolute before:inset-x-0 before:top-0 before:h-[3px] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "before:bg-ant-ink",
        success: "before:bg-ant-green",
        warning: "before:bg-ant-orange",
        destructive: "before:bg-ant-rose",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type ToastVariant = NonNullable<VariantProps<typeof toastVariants>["variant"]>;

const ToastVariantContext = React.createContext<ToastVariant>("default");

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  const resolved: ToastVariant = variant ?? "default";
  return (
    <ToastVariantContext.Provider value={resolved}>
      <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant: resolved }), className)} {...props} />
    </ToastVariantContext.Provider>
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

function useToastVariant() {
  return React.useContext(ToastVariantContext);
}

const VARIANT_DOT: Record<ToastVariant, string> = {
  default: "bg-ant-ink",
  success: "bg-ant-green",
  warning: "bg-ant-orange",
  destructive: "bg-ant-rose",
};

const VARIANT_KICKER: Record<ToastVariant, string> = {
  default: "Notice",
  success: "Success",
  warning: "Heads up",
  destructive: "Error",
};

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => {
  const variant = useToastVariant();
  const tone: Record<ToastVariant, string> = {
    default: "border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light",
    success: "border-ant-green/25 bg-ant-green/10 text-ant-green hover:bg-ant-green/15",
    warning: "border-ant-orange/25 bg-ant-orange/10 text-ant-orange hover:bg-ant-orange/15",
    destructive: "border-ant-rose/25 bg-ant-rose/10 text-ant-rose hover:bg-ant-rose/15",
  };
  return (
    <ToastPrimitives.Action
      ref={ref}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center rounded-full border px-3 text-[11px] font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-ant-orange/40 disabled:pointer-events-none disabled:opacity-50",
        tone[variant],
        className,
      )}
      {...props}
    />
  );
});
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-ant-line bg-ant-paper text-ant-mid opacity-0 transition-colors hover:bg-ant-light hover:text-ant-ink group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-ant-orange/40",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3 w-3" strokeWidth={1.75} />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastKicker = ({ children }: { children?: React.ReactNode }) => {
  const variant = useToastVariant();
  return (
    <div className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.28em] text-ant-mid">
      <span className={cn("h-1.5 w-1.5 rounded-full", VARIANT_DOT[variant])} />
      {children ?? VARIANT_KICKER[variant]}
    </div>
  );
};

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("font-display text-[14px] font-semibold text-ant-ink leading-tight", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("font-serif italic text-[12px] leading-relaxed text-ant-mid", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  type ToastVariant,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastKicker,
  ToastDescription,
  ToastClose,
  ToastAction,
  useToastVariant,
};

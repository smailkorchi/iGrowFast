/* eslint-disable react-refresh/only-export-components */
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-2xl border border-ant-line bg-ant-paper text-ant-ink shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] p-4 gap-3",
          title: "font-display text-[14px] font-semibold text-ant-ink leading-tight",
          description: "font-serif italic text-[12px] leading-relaxed text-ant-mid",
          actionButton:
            "rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-semibold px-3 h-8 hover:bg-ant-light transition-colors",
          cancelButton:
            "rounded-full border border-ant-line bg-ant-paper text-ant-mid text-[11px] font-semibold px-3 h-8 hover:bg-ant-light transition-colors",
          success:
            "group toast rounded-2xl border border-ant-green/25 bg-ant-paper text-ant-ink shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] p-4 gap-3 [&>[data-icon]]:text-ant-green",
          error:
            "group toast rounded-2xl border border-ant-rose/25 bg-ant-paper text-ant-ink shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] p-4 gap-3 [&>[data-icon]]:text-ant-rose",
          warning:
            "group toast rounded-2xl border border-ant-orange/25 bg-ant-paper text-ant-ink shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] p-4 gap-3 [&>[data-icon]]:text-ant-orange",
          info:
            "group toast rounded-2xl border border-ant-ink/15 bg-ant-paper text-ant-ink shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)] p-4 gap-3 [&>[data-icon]]:text-ant-ink",
          closeButton:
            "rounded-lg border border-ant-line bg-ant-paper text-ant-mid hover:bg-ant-light hover:text-ant-ink transition-colors",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

import { cn } from '@/lib/utils';

type FullscreenLoaderProps = {
    label?: string;
    sublabel?: string;
    className?: string;
};

export function FullscreenLoader({
    label = 'Chargement',
    sublabel = 'Un instant, le tableau de bord se met en place.',
    className,
}: FullscreenLoaderProps) {
    return (
        <div className={cn('ant-surface min-h-screen w-full flex items-center justify-center px-6', className)}>
            <div className="flex flex-col items-center gap-6 text-center">
                <div className="relative h-16 w-16">
                    <div className="absolute inset-0 rounded-2xl border border-ant-line bg-ant-paper flex items-center justify-center shadow-[0_24px_60px_-24px_rgba(20,20,19,0.2)]">
                        <img
                            src="/Logo/iGrowFast Favicon.png"
                            alt="iGrowFast"
                            className="w-9 h-9 object-contain"
                        />
                    </div>
                    <span
                        aria-hidden
                        className="absolute -inset-1 rounded-[20px] border border-ant-orange/40 border-dashed animate-spin"
                        style={{ animationDuration: '2.4s' }}
                    />
                </div>
                <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange animate-pulse" />
                        {label}
                    </div>
                    <p className="font-serif italic text-[13px] leading-relaxed text-ant-mid max-w-xs">
                        {sublabel}
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink/60 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink/40 animate-bounce" style={{ animationDelay: '240ms' }} />
                </div>
            </div>
        </div>
    );
}

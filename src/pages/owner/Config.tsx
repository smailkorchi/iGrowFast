import EmailAccountsSection from '@/components/owner/config/EmailAccountsSection';

const OwnerConfig = () => {
    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Configuration
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Configuration
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Platform-wide settings and controls.
                        </p>
                    </div>
                </div>
            </header>

            {/* Sections — add future config blocks below */}
            <div className="space-y-5 md:space-y-6">
                <EmailAccountsSection />
            </div>
        </div>
    );
};

export default OwnerConfig;

import { HelpCircle } from 'lucide-react';

const SellerHelp = () => {
    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Help</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Support & Guides</p>
                    </div>
                </div>
            </header>

            <div className="rounded-xl border border-gray-100 bg-white p-3.5 flex flex-col items-center justify-center py-16 gap-3">
                <HelpCircle className="w-8 h-8 text-gray-200" />
                <div className="text-center">
                    <p className="text-[13px] font-semibold text-brand-navy">Coming Soon</p>
                    <p className="text-[11px] text-gray-400 mt-1 max-w-xs">
                        FAQs, guides, and direct support will be available here.
                    </p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-navy animate-pulse" />
                    <span className="text-[9px] text-gray-400 uppercase tracking-[0.18em] font-bold">Under Development</span>
                </div>
            </div>
        </div>
    );
};

export default SellerHelp;

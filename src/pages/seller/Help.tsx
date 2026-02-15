import { HelpCircle } from 'lucide-react';

const SellerHelp = () => {
    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <h1 className="text-4xl font-extralight text-gray-900 mb-2">Help</h1>
                    <p className="text-gray-500 font-light">Get support and find answers to your questions.</p>
                </div>
            </div>

            {/* Coming Soon */}
            <div className="flex flex-col items-center justify-center py-32">
                <div className="w-24 h-24 bg-gradient-to-br from-primary/10 to-primary/20 rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-primary/10">
                    <HelpCircle className="w-12 h-12 text-primary" />
                </div>
                <h2 className="text-2xl font-light text-gray-900 mb-2">Coming Soon</h2>
                <p className="text-gray-400 font-light text-center max-w-md">
                    FAQs, guides, and direct support will be available here to help you.
                </p>
                <div className="mt-8 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs text-primary font-medium tracking-wider uppercase">Under Development</span>
                </div>
            </div>
        </div>
    );
};

export default SellerHelp;

import React from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Image } from 'lucide-react';
import { FaFacebook, FaInstagram } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CTA_OPTIONS, type AdData } from '../shared/constants';

interface Props {
    ad: AdData;
    pageName: string;
}

export const AdPreviewPanel: React.FC<Props> = ({ ad, pageName }) => {
    const ctaLabel = CTA_OPTIONS.find((c) => c.value === ad.cta)?.label ?? 'Learn more';
    const text = ad.primary_texts[0] || 'Your primary text will appear here...';
    const headline = ad.headlines[0] || 'Your headline';
    const desc = ad.descriptions[0] || 'Your description';
    const hostname = (() => {
        try { return ad.website_url ? new URL(ad.website_url).hostname : 'yoursite.com'; }
        catch { return 'yoursite.com'; }
    })();

    return (
        <div className="h-full flex flex-col">
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-ant-muted px-1 mb-3">
                Ad preview
            </div>
            <Tabs defaultValue="fb_feed" className="flex-1">
                <TabsList className="w-full bg-ant-line rounded-lg h-8 p-0.5">
                    <TabsTrigger value="fb_feed" className="rounded-md text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        FB Feed
                    </TabsTrigger>
                    <TabsTrigger value="ig_feed" className="rounded-md text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        IG Feed
                    </TabsTrigger>
                    <TabsTrigger value="ig_story" className="rounded-md text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        Stories
                    </TabsTrigger>
                    <TabsTrigger value="right_col" className="rounded-md text-[10px] h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        Right col
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="fb_feed" className="mt-3">
                    <FBFeedPreview ad={ad} pageName={pageName} text={text} headline={headline} desc={desc} hostname={hostname} ctaLabel={ctaLabel} />
                </TabsContent>
                <TabsContent value="ig_feed" className="mt-3">
                    <IGFeedPreview ad={ad} pageName={pageName} text={text} headline={headline} ctaLabel={ctaLabel} />
                </TabsContent>
                <TabsContent value="ig_story" className="mt-3">
                    <IGStoryPreview ad={ad} pageName={pageName} ctaLabel={ctaLabel} />
                </TabsContent>
                <TabsContent value="right_col" className="mt-3">
                    <RightColumnPreview ad={ad} headline={headline} hostname={hostname} />
                </TabsContent>
            </Tabs>
        </div>
    );
};

// ── Facebook Feed Preview ──────────────────────────────────────────────
const FBFeedPreview: React.FC<{
    ad: AdData; pageName: string; text: string; headline: string; desc: string; hostname: string; ctaLabel: string;
}> = ({ ad, pageName, text, headline, desc, hostname, ctaLabel }) => (
    <div className="rounded-lg border border-ant-line bg-white overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="w-9 h-9 rounded-full bg-[#1877F2] flex items-center justify-center">
                <FaFacebook className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
                <div className="text-[12px] font-bold text-ant-ink">{pageName}</div>
                <div className="text-[10px] text-[#65676B]">Sponsored · <span className="text-[10px]">🌍</span></div>
            </div>
            <MoreHorizontal className="w-4 h-4 text-[#65676B]" />
        </div>
        <div className="px-3 pb-2">
            <p className="text-[12px] text-ant-ink leading-relaxed line-clamp-3">{text}</p>
        </div>
        <MediaPreview url={ad.image_url} aspect="aspect-[1.91/1]" />
        <div className="px-3 py-2 bg-ant-light">
            <div className="text-[9px] text-[#65676B] uppercase tracking-wider truncate">{hostname}</div>
            <div className="text-[12px] font-bold text-ant-ink truncate mt-0.5">{headline}</div>
            <div className="text-[10px] text-[#65676B] truncate">{desc}</div>
        </div>
        <div className="px-3 py-2 border-t border-ant-line flex justify-end">
            <div className="px-3 py-1.5 rounded-md bg-ant-line text-[10px] font-bold text-ant-ink">
                {ctaLabel}
            </div>
        </div>
    </div>
);

// ── Instagram Feed Preview ─────────────────────────────────────────────
const IGFeedPreview: React.FC<{
    ad: AdData; pageName: string; text: string; headline: string; ctaLabel: string;
}> = ({ ad, pageName, text, headline, ctaLabel }) => (
    <div className="rounded-lg border border-ant-line bg-white overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#feda75] via-[#fa7e1e] via-[#d62976] to-[#962fbf] p-[2px]">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                    <FaInstagram className="w-3 h-3 text-[#262626]" />
                </div>
            </div>
            <div className="flex-1">
                <div className="text-[11px] font-bold text-[#262626]">{pageName}</div>
                <div className="text-[9px] text-[#8e8e8e]">Sponsored</div>
            </div>
            <MoreHorizontal className="w-4 h-4 text-[#262626]" />
        </div>
        <MediaPreview url={ad.image_url} aspect="aspect-square" />
        <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex gap-3">
                <Heart className="w-5 h-5 text-[#262626]" />
                <MessageCircle className="w-5 h-5 text-[#262626]" />
                <Send className="w-5 h-5 text-[#262626]" />
            </div>
            <Bookmark className="w-5 h-5 text-[#262626]" />
        </div>
        <div className="px-3 py-1 border-t border-[#efefef]">
            <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-[#262626] truncate">{headline}</div>
                <div className="px-2.5 py-1 rounded text-[9px] font-bold text-[#0095f6] border border-[#0095f6]">
                    {ctaLabel}
                </div>
            </div>
        </div>
        <div className="px-3 pb-2">
            <p className="text-[11px] text-[#262626] line-clamp-2">
                <span className="font-bold">{pageName}</span>{' '}{text}
            </p>
        </div>
    </div>
);

// ── Instagram Stories Preview ──────────────────────────────────────────
const IGStoryPreview: React.FC<{
    ad: AdData; pageName: string; ctaLabel: string;
}> = ({ ad, pageName, ctaLabel }) => (
    <div className="rounded-lg border border-ant-line overflow-hidden shadow-sm bg-black relative" style={{ aspectRatio: '9/16', maxHeight: 420 }}>
        {ad.image_url ? (
            <img src={ad.image_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
            <div className="w-full h-full flex items-center justify-center">
                <Image className="w-10 h-10 text-white/30" />
            </div>
        )}
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/40 to-transparent">
            <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <FaInstagram className="w-3 h-3 text-white" />
                </div>
                <span className="text-[10px] font-bold text-white">{pageName}</span>
                <span className="text-[9px] text-white/70">Sponsored</span>
            </div>
        </div>
        {/* Bottom CTA */}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent text-center">
            <div className="inline-block px-6 py-2 rounded-full bg-white text-[11px] font-bold text-[#262626]">
                {ctaLabel}
            </div>
        </div>
    </div>
);

// ── Right Column Preview ──────────────────────────────────────────────
const RightColumnPreview: React.FC<{
    ad: AdData; headline: string; hostname: string;
}> = ({ ad, headline, hostname }) => (
    <div className="rounded-lg border border-ant-line bg-white overflow-hidden shadow-sm max-w-[254px]">
        <div className="aspect-[254/133] bg-ant-light">
            {ad.image_url ? (
                <img src={ad.image_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
                <div className="w-full h-full flex items-center justify-center">
                    <Image className="w-6 h-6 text-ant-mid" />
                </div>
            )}
        </div>
        <div className="p-2">
            <div className="text-[11px] font-bold text-ant-ink line-clamp-2">{headline}</div>
            <div className="text-[9px] text-[#65676B] mt-0.5">{hostname}</div>
        </div>
    </div>
);

// ── Media placeholder ──────────────────────────────────────────────────
const MediaPreview: React.FC<{ url: string; aspect: string }> = ({ url, aspect }) => (
    <div className={cn(aspect, 'bg-ant-light')}>
        {url ? (
            <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
            <div className="w-full h-full flex items-center justify-center">
                <Image className="w-8 h-8 text-ant-mid" />
            </div>
        )}
    </div>
);

import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, Loader2, X, Zap } from 'lucide-react';
import { FaFacebook } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { invokeMeta, toBudgetCents } from '@/lib/metaAds';

import { CampaignStep } from './steps/CampaignStep';
import { AdSetStep } from './steps/AdSetStep';
import { AdStep } from './steps/AdStep';
import { ReviewStep } from './steps/ReviewStep';
import { AdPreviewPanel } from './sections/AdPreviewPanel';

import {
    DEFAULT_CAMPAIGN,
    DEFAULT_ADSET,
    DEFAULT_AD,
    type CampaignData,
    type AdSetData,
    type AdData,
} from './shared/constants';

type Step = 'campaign' | 'adset' | 'ad' | 'review';

const STEPS: { key: Step; num: number; label: string }[] = [
    { key: 'campaign', num: 1, label: 'Campaign' },
    { key: 'adset', num: 2, label: 'Ad set' },
    { key: 'ad', num: 3, label: 'Ad' },
    { key: 'review', num: 4, label: 'Review & publish' },
];

interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    connectionId: string;
    currency: string;
}

export const CreateCampaignWizard: React.FC<Props> = ({
    open,
    onOpenChange,
    connectionId,
    currency,
}) => {
    const { toast } = useToast();
    const qc = useQueryClient();

    const [step, setStep] = useState<Step>('campaign');
    const [loading, setLoading] = useState(false);
    const [pages, setPages] = useState<Array<{ id: string; name: string }>>([]);

    const [campaign, setCampaign] = useState<CampaignData>({ ...DEFAULT_CAMPAIGN });
    const [adset, setAdset] = useState<AdSetData>({ ...DEFAULT_ADSET });
    const [ad, setAd] = useState<AdData>({ ...DEFAULT_AD });

    useEffect(() => {
        if (!open) {
            setStep('campaign');
            setCampaign({ ...DEFAULT_CAMPAIGN });
            setAdset({ ...DEFAULT_ADSET });
            setAd({ ...DEFAULT_AD });
            return;
        }
        invokeMeta<{ ok: true; pages: Array<{ id: string; name: string }> }>({
            action: 'list_pages',
            connection_id: connectionId,
        })
            .then((r) => {
                setPages(r.pages ?? []);
                if (r.pages?.length) setAd((d) => ({ ...d, page_id: r.pages[0].id }));
            })
            .catch(() => {});
    }, [open, connectionId]);

    if (!open) return null;

    const stepIdx = STEPS.findIndex((s) => s.key === step);

    // Override the app's CSS variables inside the wizard so all shadcn
    // components (Input focus ring, Switch, Checkbox, Slider, etc.) use
    // Meta's blue (#1877F2 = hsl(214, 89%, 52%)) instead of brand-navy green.
    const metaTheme = {
        '--ring': '214 89% 52%',
        '--primary': '214 89% 52%',
        '--accent': '214 89% 96%',
    } as React.CSSProperties;

    const submit = async () => {
        setLoading(true);
        try {
            // 1. Campaign
            const campBudget: Record<string, unknown> = {};
            if (campaign.cbo) {
                const k = campaign.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
                campBudget[k] = toBudgetCents(
                    Number(campaign.budget_type === 'daily' ? campaign.daily_budget : campaign.lifetime_budget) || 0
                );
            }
            const campRes = await invokeMeta<{ ok: true; id: string }>({
                action: 'create_campaign',
                connection_id: connectionId,
                name: campaign.name,
                objective: campaign.objective,
                special_ad_categories: campaign.special_ad_categories,
                status: 'PAUSED',
                // When CBO is on, bid_strategy lives at campaign level
                ...(campaign.cbo ? { bid_strategy: adset.bid_strategy } : {}),
                ...campBudget,
            });

            // 2. Ad set
            const genders = adset.gender === 'all' ? [0] : adset.gender === 'male' ? [1] : [2];
            const targeting: Record<string, unknown> = {
                geo_locations: { countries: adset.countries },
                age_min: adset.age_min,
                age_max: adset.age_max,
                genders,
            };
            if (!adset.advantage_placements) {
                targeting.publisher_platforms = [
                    ...(adset.facebook_positions.length ? ['facebook'] : []),
                    ...(adset.instagram_positions.length ? ['instagram'] : []),
                    ...(adset.audience_network_positions.length ? ['audience_network'] : []),
                    ...(adset.messenger_positions.length ? ['messenger'] : []),
                ];
            }

            const adsetBudget: Record<string, unknown> = {};
            if (!campaign.cbo) {
                const k = adset.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
                adsetBudget[k] = toBudgetCents(
                    Number(adset.budget_type === 'daily' ? adset.daily_budget : adset.lifetime_budget) || 0
                );
            }

            const adsetRes = await invokeMeta<{ ok: true; id: string }>({
                action: 'create_adset',
                connection_id: connectionId,
                campaign_id: campRes.id,
                name: adset.name,
                optimization_goal: adset.optimization_goal,
                billing_event: adset.billing_event,
                // When CBO is off, bid_strategy lives at ad set level
                ...(!campaign.cbo ? { bid_strategy: adset.bid_strategy } : {}),
                ...(adset.bid_amount ? { bid_amount: toBudgetCents(Number(adset.bid_amount)) } : {}),
                targeting,
                status: 'PAUSED',
                ...(adset.start_date ? { start_time: adset.start_date } : {}),
                ...(adset.end_date ? { end_time: adset.end_date } : {}),
                ...adsetBudget,
            });

            // 3. Ad — wrapped separately so campaign + ad set success isn't lost
            let adError: string | null = null;
            try {
                const storySpec: Record<string, unknown> = {
                    page_id: ad.page_id,
                    link_data: {
                        link: ad.website_url,
                        message: ad.primary_texts[0] || '',
                        name: ad.headlines[0] || '',
                        description: ad.descriptions[0] || '',
                        call_to_action: { type: ad.cta, value: { link: ad.website_url } },
                    },
                };

                if (ad.image_url.trim()) {
                    try {
                        const imgRes = await invokeMeta<{
                            ok: true;
                            images: Record<string, { hash: string }>;
                        }>({
                            action: 'upload_image_from_url',
                            connection_id: connectionId,
                            image_url: ad.image_url,
                        });
                        const hash = Object.values(imgRes.images ?? {})[0]?.hash;
                        if (hash) (storySpec.link_data as any).image_hash = hash;
                    } catch {
                        /* proceed without image */
                    }
                }

                await invokeMeta<{ ok: true; id: string }>({
                    action: 'create_ad',
                    connection_id: connectionId,
                    adset_id: adsetRes.id,
                    name: ad.name,
                    status: 'PAUSED',
                    creative: { object_story_spec: storySpec },
                });
            } catch (e) {
                adError = (e as Error).message;
            }

            qc.invalidateQueries({ queryKey: ['meta-campaigns'] });
            onOpenChange(false);

            if (adError) {
                toast({
                    title: 'Campaign & ad set created',
                    description: `Ad creation failed: ${adError}. You can add ads from Meta Ads Manager or retry.`,
                });
            } else {
                toast({
                    title: 'Campaign created',
                    description: `${campaign.name} — Campaign + Ad Set + Ad created in PAUSED status.`,
                });
            }
        } catch (e) {
            toast({
                title: 'Creation failed',
                description: (e as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" style={metaTheme}>
            <div className="flex w-full h-full">
                <div className="flex w-full max-w-[1380px] mx-auto my-3 rounded-xl overflow-hidden bg-[#f0f2f5] shadow-2xl">
                    {/* ── Left nav ────────────────────────────── */}
                    <div className="w-[240px] bg-white border-r border-[#dddfe2] flex flex-col shrink-0">
                        <div className="px-5 py-5 border-b border-[#e4e6eb]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-[#1877F2] flex items-center justify-center shadow-sm">
                                    <FaFacebook className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8d91]">
                                        Create
                                    </div>
                                    <div className="text-[14px] font-bold text-[#1c1e21]">
                                        New campaign
                                    </div>
                                </div>
                            </div>
                        </div>

                        <nav className="flex-1 py-2">
                            {STEPS.map((s, i) => {
                                const active = s.key === step;
                                const done = i < stepIdx;
                                return (
                                    <button
                                        key={s.key}
                                        onClick={() => (done || active) && setStep(s.key)}
                                        className={cn(
                                            'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-all',
                                            active
                                                ? 'bg-[#ebf5ff] text-[#1877F2] border-r-[3px] border-[#1877F2]'
                                                : done
                                                    ? 'text-[#1c1e21] hover:bg-[#f7f8fa] cursor-pointer'
                                                    : 'text-[#bec3c9] cursor-default'
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 transition-colors',
                                                active
                                                    ? 'bg-[#1877F2] text-white'
                                                    : done
                                                        ? 'bg-[#31a24c] text-white'
                                                        : 'bg-[#e4e6eb] text-[#bec3c9]'
                                            )}
                                        >
                                            {done ? <Check className="w-4 h-4" /> : s.num}
                                        </div>
                                        <span className="text-[13px] font-semibold">{s.label}</span>
                                    </button>
                                );
                            })}
                        </nav>

                        <div className="px-5 py-4 border-t border-[#e4e6eb]">
                            <button
                                onClick={() => onOpenChange(false)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium text-[#606770] hover:bg-[#f0f2f5] transition"
                            >
                                <X className="w-4 h-4" />
                                Discard
                            </button>
                        </div>
                    </div>

                    {/* ── Main content ────────────────────────── */}
                    <div className="flex-1 flex flex-col min-w-0 bg-[#f0f2f5]">
                        <ScrollArea className="flex-1">
                            <div className="max-w-[720px] mx-auto py-6 px-4">
                                <AnimatePresence mode="wait">
                                    {step === 'campaign' && (
                                        <CampaignStep
                                            key="campaign"
                                            data={campaign}
                                            onChange={setCampaign}
                                            currency={currency}
                                        />
                                    )}
                                    {step === 'adset' && (
                                        <AdSetStep
                                            key="adset"
                                            data={adset}
                                            onChange={setAdset}
                                            useCBO={campaign.cbo}
                                            currency={currency}
                                        />
                                    )}
                                    {step === 'ad' && (
                                        <AdStep
                                            key="ad"
                                            data={ad}
                                            onChange={setAd}
                                            pages={pages}
                                        />
                                    )}
                                    {step === 'review' && (
                                        <ReviewStep
                                            key="review"
                                            campaign={campaign}
                                            adset={adset}
                                            ad={ad}
                                            currency={currency}
                                            pages={pages}
                                        />
                                    )}
                                </AnimatePresence>
                            </div>
                        </ScrollArea>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-[#dddfe2] bg-white flex items-center justify-between">
                            {stepIdx > 0 ? (
                                <Button
                                    variant="outline"
                                    className="rounded-lg border-[#ccd0d5] text-[#1c1e21]"
                                    onClick={() => setStep(STEPS[stepIdx - 1].key)}
                                >
                                    Back
                                </Button>
                            ) : (
                                <div />
                            )}
                            {step === 'review' ? (
                                <Button
                                    onClick={submit}
                                    disabled={loading}
                                    className="rounded-lg bg-[#1877F2] hover:bg-[#166fe5] text-white font-semibold px-6 h-10"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Creating…
                                        </>
                                    ) : (
                                        <>
                                            <Zap className="w-4 h-4 mr-2" />
                                            Publish as Paused
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => setStep(STEPS[stepIdx + 1].key)}
                                    className="rounded-lg bg-[#1877F2] hover:bg-[#166fe5] text-white font-semibold px-6 h-10"
                                >
                                    Continue
                                    <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* ── Right preview ───────────────────────── */}
                    <div className="w-[320px] bg-white border-l border-[#dddfe2] shrink-0 hidden xl:block">
                        <div className="p-5 h-full">
                            <AdPreviewPanel
                                ad={ad}
                                pageName={pages.find((p) => p.id === ad.page_id)?.name ?? 'Your Page'}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

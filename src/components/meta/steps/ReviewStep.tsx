import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import {
    OBJECTIVES,
    OPTIMIZATION_GOALS,
    BILLING_EVENTS,
    BID_STRATEGIES,
    CTA_OPTIONS,
    type CampaignData,
    type AdSetData,
    type AdData,
} from '../shared/constants';

interface Props {
    campaign: CampaignData;
    adset: AdSetData;
    ad: AdData;
    currency: string;
    pages: Array<{ id: string; name: string }>;
}

export const ReviewStep: React.FC<Props> = ({ campaign, adset, ad, currency, pages }) => {
    const find = <T extends { value: string; label: string }>(arr: T[], v: string) =>
        arr.find((x) => x.value === v)?.label ?? v;

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
        >
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                    <div className="text-[13px] font-semibold text-amber-900">
                        Everything will be created in PAUSED status
                    </div>
                    <div className="text-[12px] text-amber-700 mt-0.5">
                        You'll need to review and activate it from the campaign table or Meta Ads Manager.
                    </div>
                </div>
            </div>

            <ReviewCard title="Campaign">
                <Row label="Name" value={campaign.name} />
                <Row label="Objective" value={find(OBJECTIVES, campaign.objective)} />
                <Row label="Buying type" value={campaign.buying_type} />
                {campaign.special_ad_categories.length > 0 && (
                    <Row label="Special categories" value={campaign.special_ad_categories.join(', ')} />
                )}
                {campaign.cbo && (
                    <Row
                        label="Campaign budget"
                        value={`${campaign.budget_type === 'daily' ? campaign.daily_budget : campaign.lifetime_budget} ${currency}/${campaign.budget_type === 'daily' ? 'day' : 'total'}`}
                    />
                )}
            </ReviewCard>

            <ReviewCard title="Ad set">
                <Row label="Name" value={adset.name} />
                <Row label="Conversion" value={adset.conversion_location} />
                <Row label="Performance goal" value={find(OPTIMIZATION_GOALS, adset.optimization_goal)} />
                <Row label="Billing event" value={find(BILLING_EVENTS, adset.billing_event)} />
                <Row label="Bid strategy" value={find(BID_STRATEGIES, adset.bid_strategy)} />
                {adset.languages && <Row label="Languages" value={adset.languages} />}
                {!campaign.cbo && (
                    <Row
                        label="Budget"
                        value={`${adset.budget_type === 'daily' ? adset.daily_budget : adset.lifetime_budget} ${currency}/${adset.budget_type === 'daily' ? 'day' : 'total'}`}
                    />
                )}
                <Row label="Locations" value={adset.countries.join(', ')} />
                <Row label="Age" value={`${adset.age_min}–${adset.age_max === 65 ? '65+' : adset.age_max}`} />
                <Row label="Gender" value={adset.gender === 'all' ? 'All genders' : adset.gender === 'male' ? 'Men' : 'Women'} />
                {adset.interests.length > 0 && <Row label="Interests" value={adset.interests.join(', ')} />}
                <Row label="Audience" value={adset.advantage_audience ? 'Advantage+ audience' : 'Manual'} />
                <Row label="Placements" value={adset.advantage_placements ? 'Advantage+ (automatic)' : 'Manual'} />
            </ReviewCard>

            <ReviewCard title="Ad">
                <Row label="Name" value={ad.name} />
                <Row label="Page" value={pages.find((p) => p.id === ad.page_id)?.name ?? ad.page_id} />
                <Row label="Format" value={ad.format.replace(/_/g, ' ')} />
                <Row label="Primary text" value={(ad.primary_texts[0] || '').slice(0, 60) + ((ad.primary_texts[0]?.length ?? 0) > 60 ? '...' : '')} />
                {ad.primary_texts.length > 1 && <Row label="Text variants" value={`${ad.primary_texts.length} versions`} />}
                <Row label="Headline" value={ad.headlines[0] || '—'} />
                <Row label="Website URL" value={ad.website_url} />
                <Row label="CTA" value={find(CTA_OPTIONS, ad.cta)} />
            </ReviewCard>
        </motion.div>
    );
};

const ReviewCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="bg-white rounded-2xl border border-[#dddfe2] shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden">
        <div className="px-5 py-3 bg-[#f0f2f5] border-b border-[#e4e6eb]">
            <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#606770]">{title}</span>
        </div>
        <div className="divide-y divide-[#e4e6eb]">{children}</div>
    </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex items-start justify-between px-5 py-3 gap-6">
        <span className="text-[13px] text-[#606770] shrink-0">{label}</span>
        <span className="text-[13px] font-medium text-[#1c1e21] text-right truncate max-w-[320px]">{value || '—'}</span>
    </div>
);

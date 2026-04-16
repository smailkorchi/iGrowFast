import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { AccordionSection } from '../sections/AccordionSection';
import { FieldLabel, FieldHelper } from '../shared/FieldLabel';
import {
    OBJECTIVES,
    SPECIAL_AD_CATEGORIES,
    type CampaignData,
} from '../shared/constants';

interface Props {
    data: CampaignData;
    onChange: (d: CampaignData) => void;
    currency: string;
}

export const CampaignStep: React.FC<Props> = ({ data, onChange, currency }) => {
    const set = <K extends keyof CampaignData>(k: K, v: CampaignData[K]) =>
        onChange({ ...data, [k]: v });

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
        >
            {/* Campaign name */}
            <AccordionSection title="Campaign name">
                <FieldLabel tooltip="This name is only visible to you, not to your audience.">
                    Campaign name
                </FieldLabel>
                <Input
                    value={data.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Summer Sale 2026 — Conversions"
                    className="h-10 rounded-lg border-[#ccd0d5] focus:border-[#1877F2] focus:ring-1 focus:ring-[#1877F2]/30"
                />
            </AccordionSection>

            {/* Campaign objective */}
            <AccordionSection title="Campaign objective" subtitle="Choose the goal that best matches your business outcome.">
                <div className="space-y-2">
                    {OBJECTIVES.map((obj) => {
                        const Icon = obj.icon;
                        const active = data.objective === obj.value;
                        return (
                            <button
                                key={obj.value}
                                onClick={() => set('objective', obj.value)}
                                className={cn(
                                    'w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all border-2',
                                    active
                                        ? 'border-[#1877F2] bg-[#ebf5ff]'
                                        : 'border-transparent hover:bg-[#f7f8fa]'
                                )}
                            >
                                {/* Left border indicator */}
                                <div className={cn(
                                    'w-1 h-12 rounded-full shrink-0 transition-colors',
                                    active ? 'bg-[#1877F2]' : 'bg-transparent'
                                )} />

                                {/* Icon */}
                                <div
                                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: active ? '#1877F2' : obj.color }}
                                >
                                    <Icon className="w-5 h-5 text-white" />
                                </div>

                                {/* Text */}
                                <div className="flex-1 min-w-0">
                                    <div className={cn(
                                        'text-[14px] font-semibold leading-tight',
                                        active ? 'text-[#1877F2]' : 'text-[#1c1e21]'
                                    )}>
                                        {obj.label}
                                    </div>
                                    <div className="text-[12px] text-[#606770] mt-0.5 line-clamp-2 leading-relaxed">
                                        {obj.desc}
                                    </div>
                                </div>

                                {/* Radio indicator */}
                                <div className={cn(
                                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition',
                                    active ? 'border-[#1877F2] bg-[#1877F2]' : 'border-[#ccd0d5]'
                                )}>
                                    {active && <Check className="w-3 h-3 text-white" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </AccordionSection>

            {/* Special ad categories */}
            <AccordionSection title="Special ad categories" defaultOpen={false}>
                <FieldHelper>
                    Declare if your ads are related to credit, employment, housing, or
                    social issues. Most advertisers don't need to select any category.
                </FieldHelper>
                <div className="space-y-3 mt-3">
                    {SPECIAL_AD_CATEGORIES.map((cat) => {
                        const checked = data.special_ad_categories.includes(cat.value);
                        return (
                            <label
                                key={cat.value}
                                className="flex items-center gap-3 cursor-pointer group"
                            >
                                <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) =>
                                        set(
                                            'special_ad_categories',
                                            v
                                                ? [...data.special_ad_categories, cat.value]
                                                : data.special_ad_categories.filter((x) => x !== cat.value)
                                        )
                                    }
                                />
                                <span className="text-[13px] text-[#1c1e21] group-hover:text-[#1877F2] transition">
                                    {cat.label}
                                </span>
                            </label>
                        );
                    })}
                </div>
            </AccordionSection>

            {/* Advantage campaign budget (CBO) */}
            <AccordionSection title="Advantage campaign budget">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-[13px] font-medium text-[#1c1e21]">
                            Advantage campaign budget
                        </div>
                        <div className="text-[12px] text-[#606770] mt-0.5 leading-relaxed max-w-md">
                            Allow Meta to distribute your campaign budget across ad sets to get
                            more results. You set one central campaign budget.
                        </div>
                    </div>
                    <Switch
                        checked={data.cbo}
                        onCheckedChange={(v) => set('cbo', v)}
                    />
                </div>

                {data.cbo && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-4 space-y-3"
                    >
                        <FieldLabel tooltip="Choose whether to set a daily or total lifetime budget for this campaign.">
                            Campaign budget
                        </FieldLabel>
                        <div className="flex gap-2">
                            <Select
                                value={data.budget_type}
                                onValueChange={(v) => set('budget_type', v as 'daily' | 'lifetime')}
                            >
                                <SelectTrigger className="h-10 rounded-lg border-[#ccd0d5] w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="daily">Daily budget</SelectItem>
                                    <SelectItem value="lifetime">Lifetime budget</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative flex-1">
                                <Input
                                    value={data.budget_type === 'daily' ? data.daily_budget : data.lifetime_budget}
                                    onChange={(e) =>
                                        set(data.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget', e.target.value)
                                    }
                                    placeholder="0.00"
                                    className="h-10 rounded-lg border-[#ccd0d5] pr-14 font-mono"
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#8a8d91]">
                                    {currency}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AccordionSection>
        </motion.div>
    );
};

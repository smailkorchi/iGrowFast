import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, MapPin, Plus, X } from 'lucide-react';
import { FaFacebook, FaInstagram } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
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
    CONVERSION_LOCATIONS,
    OPTIMIZATION_GOALS,
    BILLING_EVENTS,
    BID_STRATEGIES,
    FACEBOOK_POSITIONS,
    INSTAGRAM_POSITIONS,
    AUDIENCE_NETWORK_POSITIONS,
    MESSENGER_POSITIONS,
    LANGUAGES,
    type AdSetData,
} from '../shared/constants';

interface Props {
    data: AdSetData;
    onChange: (d: AdSetData) => void;
    useCBO: boolean;
    currency: string;
}

export const AdSetStep: React.FC<Props> = ({ data, onChange, useCBO, currency }) => {
    const set = <K extends keyof AdSetData>(k: K, v: AdSetData[K]) =>
        onChange({ ...data, [k]: v });

    const [countryInput, setCountryInput] = useState('');
    const [interestInput, setInterestInput] = useState('');

    const addCountry = () => {
        const code = countryInput.trim().toUpperCase();
        if (code && !data.countries.includes(code)) {
            set('countries', [...data.countries, code]);
        }
        setCountryInput('');
    };

    const addInterest = () => {
        const val = interestInput.trim();
        if (val && !data.interests.includes(val)) {
            set('interests', [...data.interests, val]);
        }
        setInterestInput('');
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
        >
            {/* Ad set name */}
            <AccordionSection title="Ad set name">
                <Input
                    value={data.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Morocco — 18-45 — Broad interests"
                    className="h-10 rounded-lg border-ant-line"
                />
            </AccordionSection>

            {/* Conversion location */}
            <AccordionSection title="Conversion" subtitle="Choose where you want to drive results.">
                <div className="flex flex-wrap gap-2">
                    {CONVERSION_LOCATIONS.map((loc) => (
                        <button
                            key={loc.value}
                            onClick={() => set('conversion_location', loc.value)}
                            className={cn(
                                'px-4 py-2 rounded-full text-[13px] font-medium border transition-all',
                                data.conversion_location === loc.value
                                    ? 'bg-[#ebf5ff] border-[#1877F2] text-[#1877F2]'
                                    : 'border-ant-line text-ant-muted hover:bg-ant-line-soft'
                            )}
                        >
                            {loc.label}
                        </button>
                    ))}
                </div>
            </AccordionSection>

            {/* Performance goal */}
            <AccordionSection title="Performance goal" subtitle="Tell us what result you want from this ad set.">
                <div className="space-y-4">
                    <div>
                        <FieldLabel>Optimization goal</FieldLabel>
                        <Select value={data.optimization_goal} onValueChange={(v) => set('optimization_goal', v)}>
                            <SelectTrigger className="h-10 rounded-lg border-ant-line">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {OPTIMIZATION_GOALS.map((g) => (
                                    <SelectItem key={g.value} value={g.value}>
                                        <div>
                                            <div className="font-medium">{g.label}</div>
                                            <div className="text-[11px] text-ant-mid">{g.desc}</div>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <FieldLabel tooltip="Choose when you get charged for your ads.">Billing event</FieldLabel>
                        <Select value={data.billing_event} onValueChange={(v) => set('billing_event', v)}>
                            <SelectTrigger className="h-10 rounded-lg border-ant-line">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {BILLING_EVENTS.map((b) => (
                                    <SelectItem key={b.value} value={b.value}>
                                        <div>
                                            <div className="font-medium">{b.label}</div>
                                            <div className="text-[11px] text-ant-mid">{b.desc}</div>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </AccordionSection>

            {/* Budget */}
            {!useCBO && (
                <AccordionSection title="Budget & bidding">
                    <div className="space-y-4">
                        <div>
                            <FieldLabel tooltip="Set a daily or lifetime budget for this ad set.">Budget</FieldLabel>
                            <div className="flex gap-2">
                                <Select value={data.budget_type} onValueChange={(v) => set('budget_type', v as any)}>
                                    <SelectTrigger className="h-10 rounded-lg border-ant-line w-[160px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="daily">Daily budget</SelectItem>
                                        <SelectItem value="lifetime">Lifetime budget</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative flex-1">
                                    <Input
                                        value={data.budget_type === 'daily' ? data.daily_budget : data.lifetime_budget}
                                        onChange={(e) => set(data.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget', e.target.value)}
                                        placeholder="0.00" className="h-10 rounded-lg border-ant-line pr-14 font-mono"
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-ant-mid">{currency}</div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <FieldLabel tooltip="Choose the bidding strategy that best fits your goals.">Bid strategy</FieldLabel>
                            <Select value={data.bid_strategy} onValueChange={(v) => set('bid_strategy', v)}>
                                <SelectTrigger className="h-10 rounded-lg border-ant-line"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {BID_STRATEGIES.map((b) => (
                                        <SelectItem key={b.value} value={b.value}>
                                            <div>
                                                <div className="font-medium">{b.label}</div>
                                                <div className="text-[11px] text-ant-mid">{b.desc}</div>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </AccordionSection>
            )}

            {/* Schedule (always visible) */}
            <AccordionSection title="Schedule" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <FieldLabel>Start date</FieldLabel>
                        <Input type="datetime-local" value={data.start_date} onChange={(e) => set('start_date', e.target.value)}
                            className="h-10 rounded-lg border-ant-line" />
                    </div>
                    <div>
                        <FieldLabel>End date</FieldLabel>
                        <Input type="datetime-local" value={data.end_date} onChange={(e) => set('end_date', e.target.value)}
                            className="h-10 rounded-lg border-ant-line" />
                    </div>
                </div>
                <FieldHelper>
                    Leave empty to start immediately and run continuously.
                </FieldHelper>
            </AccordionSection>

            {/* Audience */}
            <AccordionSection title="Audience" subtitle="Define who sees your ads.">
                <div className="space-y-5">
                    {/* Advantage+ audience toggle */}
                    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-ant-light">
                        <div>
                            <div className="text-[13px] font-semibold text-ant-ink">Advantage+ audience</div>
                            <div className="text-[12px] text-ant-muted mt-0.5 max-w-md leading-relaxed">
                                Reach a broader audience beyond your selections. Meta's AI finds
                                the best people to show your ads to.
                            </div>
                        </div>
                        <Switch checked={data.advantage_audience} onCheckedChange={(v) => set('advantage_audience', v)} />
                    </div>

                    <AnimatePresence>
                        {!data.advantage_audience && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25 }}
                                className="overflow-hidden space-y-5"
                            >
                                {/* Locations */}
                                <div>
                                    <FieldLabel tooltip="Target people in specific countries, regions, or cities.">
                                        Locations
                                    </FieldLabel>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                            <Input
                                                value={countryInput}
                                                onChange={(e) => setCountryInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCountry())}
                                                placeholder="Type a country code (e.g. MA) and press Enter"
                                                className="h-10 rounded-lg border-ant-line pl-9"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {data.countries.map((c) => (
                                            <Badge
                                                key={c}
                                                variant="secondary"
                                                className="bg-ant-line text-ant-ink hover:bg-ant-line rounded-md text-[12px] font-medium px-2.5 py-1 gap-1"
                                            >
                                                {c}
                                                <button
                                                    onClick={() => set('countries', data.countries.filter((x) => x !== c))}
                                                    className="hover:text-red-600"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                {/* Age */}
                                <div>
                                    <FieldLabel tooltip="Set the minimum and maximum age range.">Age</FieldLabel>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[13px] font-medium text-ant-ink w-8 text-center">{data.age_min}</span>
                                        <Slider
                                            value={[data.age_min, data.age_max]}
                                            min={13}
                                            max={65}
                                            step={1}
                                            onValueChange={([min, max]) => {
                                                set('age_min', min);
                                                onChange({ ...data, age_min: min, age_max: max });
                                            }}
                                            className="flex-1"
                                        />
                                        <span className="text-[13px] font-medium text-ant-ink w-8 text-center">
                                            {data.age_max === 65 ? '65+' : data.age_max}
                                        </span>
                                    </div>
                                </div>

                                {/* Gender */}
                                <div>
                                    <FieldLabel>Gender</FieldLabel>
                                    <div className="flex gap-2">
                                        {([
                                            { value: 'all', label: 'All' },
                                            { value: 'male', label: 'Men' },
                                            { value: 'female', label: 'Women' },
                                        ] as const).map((g) => (
                                            <button
                                                key={g.value}
                                                onClick={() => set('gender', g.value)}
                                                className={cn(
                                                    'flex-1 py-2 rounded-lg text-[13px] font-medium border transition-all',
                                                    data.gender === g.value
                                                        ? 'bg-[#ebf5ff] border-[#1877F2] text-[#1877F2]'
                                                        : 'border-ant-line text-ant-muted hover:bg-ant-line-soft'
                                                )}
                                            >
                                                {g.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Detailed targeting (interests) */}
                                <div>
                                    <FieldLabel tooltip="Add interests, behaviours, or demographics to narrow your audience.">
                                        Detailed targeting
                                    </FieldLabel>
                                    <Input
                                        value={interestInput}
                                        onChange={(e) => setInterestInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addInterest())}
                                        placeholder="Add interests, behaviours, or demographics"
                                        className="h-10 rounded-lg border-ant-line"
                                    />
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {data.interests.map((i) => (
                                            <Badge
                                                key={i}
                                                variant="secondary"
                                                className="bg-[#ebf5ff] text-[#1877F2] hover:bg-[#d4ecff] rounded-md text-[12px] font-medium px-2.5 py-1 gap-1"
                                            >
                                                {i}
                                                <button
                                                    onClick={() => set('interests', data.interests.filter((x) => x !== i))}
                                                    className="hover:text-red-600"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                {/* Languages */}
                                <div>
                                    <FieldLabel tooltip="Target people who speak specific languages.">
                                        Languages
                                    </FieldLabel>
                                    <Select
                                        value=""
                                        onValueChange={(v) => {
                                            if (v && !data.languages.includes(v)) {
                                                set('languages', data.languages ? `${data.languages},${v}` : v);
                                            }
                                        }}
                                    >
                                        <SelectTrigger className="h-10 rounded-lg border-ant-line">
                                            <SelectValue placeholder="Add a language" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LANGUAGES.map((l) => (
                                                <SelectItem key={l.value} value={l.value}>
                                                    {l.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {data.languages && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {data.languages.split(',').filter(Boolean).map((code) => {
                                                const lang = LANGUAGES.find((l) => l.value === code);
                                                return (
                                                    <Badge
                                                        key={code}
                                                        variant="secondary"
                                                        className="bg-ant-line text-ant-ink hover:bg-ant-line rounded-md text-[12px] font-medium px-2.5 py-1 gap-1"
                                                    >
                                                        {lang?.label ?? code}
                                                        <button
                                                            onClick={() =>
                                                                set(
                                                                    'languages',
                                                                    data.languages
                                                                        .split(',')
                                                                        .filter((c) => c !== code)
                                                                        .join(',')
                                                                )
                                                            }
                                                            className="hover:text-red-600"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </Badge>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Audience size indicator */}
                                <div className="p-3 rounded-xl bg-ant-light">
                                    <div className="flex items-center justify-between text-[11px] font-medium text-ant-mid mb-1.5">
                                        <span>Specific</span>
                                        <span>Broad</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gradient-to-r from-red-400 via-yellow-400 via-green-400 to-green-500 relative">
                                        <div
                                            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-[#1877F2] shadow"
                                            style={{
                                                left: `${Math.min(90, Math.max(10, (data.advantage_audience ? 80 : 30 + data.countries.length * 5 + (data.interests.length > 0 ? -10 : 0))))}%`,
                                            }}
                                        />
                                    </div>
                                    <div className="text-[11px] text-ant-muted mt-1.5 text-center">Estimated audience size</div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </AccordionSection>

            {/* Placements */}
            <AccordionSection title="Placements" subtitle="Choose where your ads appear across Meta technologies.">
                <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-ant-light">
                        <div>
                            <div className="text-[13px] font-semibold text-ant-ink">Advantage+ placements</div>
                            <div className="text-[12px] text-ant-muted mt-0.5 max-w-md leading-relaxed">
                                Use Meta's delivery system to maximise your budget across all placements.
                                This is recommended for most advertisers.
                            </div>
                        </div>
                        <Switch checked={data.advantage_placements} onCheckedChange={(v) => set('advantage_placements', v)} />
                    </div>

                    <AnimatePresence>
                        {!data.advantage_placements && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25 }}
                                className="overflow-hidden space-y-3"
                            >
                                <PlacementGroup
                                    label="Facebook"
                                    icon={<FaFacebook className="w-4 h-4 text-[#1877F2]" />}
                                    positions={FACEBOOK_POSITIONS}
                                    selected={data.facebook_positions}
                                    onChange={(v) => set('facebook_positions', v)}
                                />
                                <PlacementGroup
                                    label="Instagram"
                                    icon={<FaInstagram className="w-4 h-4 text-[#E4405F]" />}
                                    positions={INSTAGRAM_POSITIONS}
                                    selected={data.instagram_positions}
                                    onChange={(v) => set('instagram_positions', v)}
                                />
                                <PlacementGroup
                                    label="Audience Network"
                                    icon={<div className="w-4 h-4 rounded bg-[#4a4a4a] flex items-center justify-center text-[8px] text-white font-bold">AN</div>}
                                    positions={AUDIENCE_NETWORK_POSITIONS}
                                    selected={data.audience_network_positions}
                                    onChange={(v) => set('audience_network_positions', v)}
                                />
                                <PlacementGroup
                                    label="Messenger"
                                    icon={<div className="w-4 h-4 rounded bg-gradient-to-br from-[#00B2FF] to-[#006AFF] flex items-center justify-center text-[8px] text-white font-bold">M</div>}
                                    positions={MESSENGER_POSITIONS}
                                    selected={data.messenger_positions}
                                    onChange={(v) => set('messenger_positions', v)}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </AccordionSection>
        </motion.div>
    );
};

// ── Placement group with collapsible positions ──────────────────────────
const PlacementGroup: React.FC<{
    label: string;
    icon: React.ReactNode;
    positions: Array<{ value: string; label: string }>;
    selected: string[];
    onChange: (v: string[]) => void;
}> = ({ label, icon, positions, selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const allSelected = positions.every((p) => selected.includes(p.value));

    return (
        <div className="border border-ant-line rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ant-line-soft transition"
            >
                {icon}
                <span className="text-[13px] font-semibold text-ant-ink flex-1 text-left">{label}</span>
                <span className="text-[11px] text-ant-mid">{selected.length}/{positions.length}</span>
                <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronDown className="w-4 h-4 text-ant-muted" />
                </motion.div>
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 py-3 border-t border-ant-line space-y-2">
                            <label className="flex items-center gap-2.5 cursor-pointer">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={(v) =>
                                        onChange(v ? positions.map((p) => p.value) : [])
                                    }
                                />
                                <span className="text-[12px] font-medium text-ant-muted">Select all</span>
                            </label>
                            {positions.map((pos) => (
                                <label key={pos.value} className="flex items-center gap-2.5 cursor-pointer ml-1">
                                    <Checkbox
                                        checked={selected.includes(pos.value)}
                                        onCheckedChange={(v) =>
                                            onChange(
                                                v
                                                    ? [...selected, pos.value]
                                                    : selected.filter((x) => x !== pos.value)
                                            )
                                        }
                                    />
                                    <span className="text-[12px] text-ant-ink">{pos.label}</span>
                                </label>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

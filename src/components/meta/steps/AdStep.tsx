import React from 'react';
import { motion } from 'framer-motion';
import { Image, Layers, LayoutGrid, Plus, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { AccordionSection } from '../sections/AccordionSection';
import { FieldLabel, FieldHelper } from '../shared/FieldLabel';
import { CTA_OPTIONS, AD_FORMATS, type AdData } from '../shared/constants';

interface Props {
    data: AdData;
    onChange: (d: AdData) => void;
    pages: Array<{ id: string; name: string }>;
}

const FORMAT_ICONS = { image: Image, layers: Layers, grid: LayoutGrid } as const;

export const AdStep: React.FC<Props> = ({ data, onChange, pages }) => {
    const set = <K extends keyof AdData>(k: K, v: AdData[K]) =>
        onChange({ ...data, [k]: v });

    const addVariant = (field: 'primary_texts' | 'headlines' | 'descriptions') => {
        if (data[field].length < 5) {
            set(field, [...data[field], '']);
        }
    };

    const updateVariant = (field: 'primary_texts' | 'headlines' | 'descriptions', idx: number, val: string) => {
        const arr = [...data[field]];
        arr[idx] = val;
        set(field, arr);
    };

    const removeVariant = (field: 'primary_texts' | 'headlines' | 'descriptions', idx: number) => {
        if (data[field].length > 1) {
            set(field, data[field].filter((_, i) => i !== idx));
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
        >
            {/* Ad name */}
            <AccordionSection title="Ad name">
                <Input
                    value={data.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Summer Sale — Image A — Learn More"
                    className="h-10 rounded-lg border-ant-line"
                />
            </AccordionSection>

            {/* Identity */}
            <AccordionSection title="Identity" subtitle="Choose the Facebook Page that represents your business in ads.">
                <FieldLabel required>Facebook Page</FieldLabel>
                {pages.length === 0 ? (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                        No Facebook Pages found. The account needs at least one Page to create ads.
                    </div>
                ) : (
                    <Select value={data.page_id} onValueChange={(v) => set('page_id', v)}>
                        <SelectTrigger className="h-10 rounded-lg border-ant-line">
                            <SelectValue placeholder="Select a Page" />
                        </SelectTrigger>
                        <SelectContent>
                            {pages.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </AccordionSection>

            {/* Ad format */}
            <AccordionSection title="Ad setup" subtitle="Choose the format for your ad.">
                <div className="space-y-2">
                    {AD_FORMATS.map((f) => {
                        const Icon = FORMAT_ICONS[f.icon];
                        const active = data.format === f.value;
                        return (
                            <button
                                key={f.value}
                                onClick={() => set('format', f.value as AdData['format'])}
                                className={cn(
                                    'w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all border',
                                    active
                                        ? 'border-[#1877F2] bg-[#ebf5ff]'
                                        : 'border-ant-line hover:bg-ant-line-soft',
                                    f.value === 'collection' && 'opacity-50 cursor-not-allowed'
                                )}
                                disabled={f.value === 'collection'}
                            >
                                <div className={cn(
                                    'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                                    active ? 'bg-[#1877F2]' : 'bg-ant-line'
                                )}>
                                    <Icon className={cn('w-5 h-5', active ? 'text-white' : 'text-ant-muted')} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={cn('text-[13px] font-semibold', active ? 'text-[#1877F2]' : 'text-ant-ink')}>
                                        {f.label}
                                    </div>
                                    <div className="text-[11px] text-ant-mid mt-0.5">{f.desc}</div>
                                </div>
                                <div className={cn(
                                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                                    active ? 'border-[#1877F2] bg-[#1877F2]' : 'border-ant-line'
                                )}>
                                    {active && <div className="w-2 h-2 rounded-full bg-white" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </AccordionSection>

            {/* Media */}
            <AccordionSection title="Ad creative" subtitle="Add media and enter your ad text.">
                <div className="space-y-5">
                    {/* Upload zone */}
                    <div>
                        <FieldLabel>Media</FieldLabel>
                        {!data.image_url ? (
                            <div className="border-2 border-dashed border-ant-line rounded-xl p-8 text-center hover:border-[#1877F2] hover:bg-ant-line-soft transition cursor-pointer">
                                <Upload className="w-8 h-8 text-ant-mid mx-auto mb-2" />
                                <div className="text-[13px] font-medium text-ant-ink">Add media</div>
                                <div className="text-[11px] text-ant-mid mt-1">Or paste an image URL below</div>
                            </div>
                        ) : (
                            <div className="relative rounded-xl overflow-hidden border border-ant-line">
                                <img
                                    src={data.image_url}
                                    alt=""
                                    className="w-full aspect-[1.91/1] object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <button
                                    onClick={() => set('image_url', '')}
                                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition"
                                >
                                    <X className="w-4 h-4 text-white" />
                                </button>
                            </div>
                        )}
                        <Input
                            value={data.image_url}
                            onChange={(e) => set('image_url', e.target.value)}
                            placeholder="Paste image URL"
                            className="h-9 rounded-lg border-ant-line mt-2 text-[12px]"
                        />
                    </div>

                    {/* Primary text (multi-variant) */}
                    <div>
                        <FieldLabel tooltip="Write up to 5 versions. Meta will test and show the best-performing one.">
                            Primary text
                        </FieldLabel>
                        {data.primary_texts.map((text, idx) => (
                            <div key={idx} className="flex gap-2 mb-2">
                                <Textarea
                                    value={text}
                                    onChange={(e) => updateVariant('primary_texts', idx, e.target.value)}
                                    placeholder="Tell people what your ad is about..."
                                    className="rounded-lg border-ant-line min-h-[80px] flex-1 text-[13px]"
                                />
                                {data.primary_texts.length > 1 && (
                                    <button
                                        onClick={() => removeVariant('primary_texts', idx)}
                                        className="w-8 h-8 rounded-lg hover:bg-ant-rose/10 flex items-center justify-center text-ant-mid hover:text-ant-rose shrink-0 self-start mt-1"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {data.primary_texts.length < 5 && (
                            <button
                                onClick={() => addVariant('primary_texts')}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-[#1877F2] hover:text-[#0b5fbf] mt-1"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add another option
                            </button>
                        )}
                    </div>

                    {/* Headlines (multi-variant) */}
                    <div>
                        <FieldLabel tooltip="Short, attention-grabbing text. Up to 5 versions.">Headline</FieldLabel>
                        {data.headlines.map((text, idx) => (
                            <div key={idx} className="flex gap-2 mb-2">
                                <Input
                                    value={text}
                                    onChange={(e) => updateVariant('headlines', idx, e.target.value)}
                                    placeholder="e.g. Shop Now — 50% Off"
                                    className="h-10 rounded-lg border-ant-line flex-1"
                                />
                                {data.headlines.length > 1 && (
                                    <button
                                        onClick={() => removeVariant('headlines', idx)}
                                        className="w-8 h-8 rounded-lg hover:bg-ant-rose/10 flex items-center justify-center text-ant-mid hover:text-ant-rose shrink-0"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {data.headlines.length < 5 && (
                            <button onClick={() => addVariant('headlines')}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-[#1877F2] hover:text-[#0b5fbf] mt-1">
                                <Plus className="w-3.5 h-3.5" />Add another option
                            </button>
                        )}
                    </div>

                    {/* Descriptions (multi-variant) */}
                    <div>
                        <FieldLabel>Description</FieldLabel>
                        {data.descriptions.map((text, idx) => (
                            <div key={idx} className="flex gap-2 mb-2">
                                <Input
                                    value={text}
                                    onChange={(e) => updateVariant('descriptions', idx, e.target.value)}
                                    placeholder="e.g. Free delivery on orders over 200 MAD"
                                    className="h-10 rounded-lg border-ant-line flex-1"
                                />
                                {data.descriptions.length > 1 && (
                                    <button onClick={() => removeVariant('descriptions', idx)}
                                        className="w-8 h-8 rounded-lg hover:bg-ant-rose/10 flex items-center justify-center text-ant-mid hover:text-ant-rose shrink-0">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {data.descriptions.length < 5 && (
                            <button onClick={() => addVariant('descriptions')}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-[#1877F2] hover:text-[#0b5fbf] mt-1">
                                <Plus className="w-3.5 h-3.5" />Add another option
                            </button>
                        )}
                    </div>
                </div>
            </AccordionSection>

            {/* Destination */}
            <AccordionSection title="Destination">
                <div className="space-y-4">
                    <div>
                        <FieldLabel required>Website URL</FieldLabel>
                        <Input
                            value={data.website_url}
                            onChange={(e) => set('website_url', e.target.value)}
                            placeholder="https://yoursite.com/landing-page"
                            className="h-10 rounded-lg border-ant-line"
                        />
                    </div>
                    <div>
                        <FieldLabel tooltip="Optional. Shows a custom domain in the ad instead of the full URL.">Display link</FieldLabel>
                        <Input
                            value={data.display_link}
                            onChange={(e) => set('display_link', e.target.value)}
                            placeholder="yoursite.com"
                            className="h-10 rounded-lg border-ant-line"
                        />
                    </div>
                </div>
            </AccordionSection>

            {/* Call to action */}
            <AccordionSection title="Call to action">
                <Select value={data.cta} onValueChange={(v) => set('cta', v)}>
                    <SelectTrigger className="h-10 rounded-lg border-ant-line">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CTA_OPTIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </AccordionSection>

            {/* URL parameters */}
            <AccordionSection title="Tracking" defaultOpen={false} subtitle="Add URL parameters for analytics tracking.">
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <FieldLabel>utm_source</FieldLabel>
                            <Input value={data.utm_source} onChange={(e) => set('utm_source', e.target.value)}
                                placeholder="facebook" className="h-9 rounded-lg border-ant-line text-[12px]" />
                        </div>
                        <div>
                            <FieldLabel>utm_medium</FieldLabel>
                            <Input value={data.utm_medium} onChange={(e) => set('utm_medium', e.target.value)}
                                placeholder="paid" className="h-9 rounded-lg border-ant-line text-[12px]" />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <FieldLabel>utm_campaign</FieldLabel>
                            <Input value={data.utm_campaign} onChange={(e) => set('utm_campaign', e.target.value)}
                                placeholder="summer_sale" className="h-9 rounded-lg border-ant-line text-[12px]" />
                        </div>
                        <div>
                            <FieldLabel>utm_content</FieldLabel>
                            <Input value={data.utm_content} onChange={(e) => set('utm_content', e.target.value)}
                                placeholder="image_a" className="h-9 rounded-lg border-ant-line text-[12px]" />
                        </div>
                        <div>
                            <FieldLabel>utm_term</FieldLabel>
                            <Input value={data.utm_term} onChange={(e) => set('utm_term', e.target.value)}
                                placeholder="" className="h-9 rounded-lg border-ant-line text-[12px]" />
                        </div>
                    </div>
                </div>
            </AccordionSection>
        </motion.div>
    );
};

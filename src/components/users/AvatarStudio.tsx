import { useCallback, useEffect, useState } from 'react';
import NiceAvatar, { genConfig } from 'react-nice-avatar';
import type { AvatarFullConfig } from 'react-nice-avatar';
import { Shuffle, Upload, ImageIcon, Sparkles, Palette, Glasses, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { blobToDataUrl, compressImage, validateImageFile } from '@/lib/imageCompress';

type Mode = 'generate' | 'upload';
type Tab = 'Style' | 'Color' | 'Accessories';
type Cfg = AvatarFullConfig & Record<string, unknown>;

/** What the studio produces: a generated config OR an uploaded image data URL. */
export interface AvatarValue { config?: Cfg | null; dataUrl?: string | null; }

// Option sets + palettes mirrored from the WhatsApp Mancer AvatarPicker.
type Seg = { label: string; value: string };
const SEX: Seg[] = [{ label: 'Man', value: 'man' }, { label: 'Woman', value: 'woman' }];
const HAIR_MAN: Seg[] = [{ label: 'Normal', value: 'normal' }, { label: 'Thick', value: 'thick' }, { label: 'Mohawk', value: 'mohawk' }];
const HAIR_WOMAN: Seg[] = [{ label: 'Normal', value: 'normal' }, { label: 'Long', value: 'womanLong' }, { label: 'Short', value: 'womanShort' }];
const EYEBROWS: Seg[] = [{ label: 'Normal', value: 'up' }, { label: 'Arched', value: 'upWoman' }];
const EARS: Seg[] = [{ label: 'Small', value: 'small' }, { label: 'Big', value: 'big' }];
const EYES: Seg[] = [{ label: 'Round', value: 'circle' }, { label: 'Oval', value: 'oval' }, { label: 'Smile', value: 'smile' }];
const NOSE: Seg[] = [{ label: 'Short', value: 'short' }, { label: 'Long', value: 'long' }, { label: 'Round', value: 'round' }];
const MOUTH: Seg[] = [{ label: 'Smile', value: 'smile' }, { label: 'Laugh', value: 'laugh' }, { label: 'Peace', value: 'peace' }];
const SHIRT: Seg[] = [{ label: 'Hoody', value: 'hoody' }, { label: 'Tee', value: 'short' }, { label: 'Polo', value: 'polo' }];
const HAT: Seg[] = [{ label: 'None', value: 'none' }, { label: 'Beanie', value: 'beanie' }, { label: 'Turban', value: 'turban' }];
const GLASSES: Seg[] = [{ label: 'None', value: 'none' }, { label: 'Round', value: 'round' }, { label: 'Square', value: 'square' }];

const PALETTE = {
    faceColors: ['#F9C9B6', '#E0AC69', '#C68642', '#8D5524', '#FFE0BD'],
    hairColors: ['#141413', '#3a2a1c', '#7a4a2b', '#b07b3e', '#d4a373', '#a3a3a3', '#d97757', '#6a9bcc'],
    bgColors: ['#faf9f5', '#e8e6dc', '#d97757', '#6a9bcc', '#788c5d', '#141413', '#f3e5d0', '#cfd9e8'],
    shirtColors: ['#141413', '#d97757', '#6a9bcc', '#788c5d', '#b0aea5', '#faf9f5'],
    hatColors: ['#141413', '#3a2a1c', '#7a4a2b', '#d97757', '#6a9bcc', '#788c5d', '#faf9f5'],
};

const isWomanHair = (s?: string) => s === 'womanLong' || s === 'womanShort';
const inferSex = (c: Cfg): 'man' | 'woman' => (c.sex as 'man' | 'woman') || (isWomanHair(c.hairStyle as string) ? 'woman' : 'man');

interface AvatarStudioProps {
    onChange: (value: AvatarValue) => void;
    seed?: string;
}

/** Centre-cropped square, downscaled and re-encoded by the shared compressor. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
    const { blob } = await compressImage(file, 'avatar');
    return blobToDataUrl(blob);
}

const Segmented = ({ options, value, onChange }: { options: Seg[]; value: string; onChange: (v: string) => void }) => (
    <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
            const active = o.value === value;
            return (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={cn('h-7 px-2.5 rounded-full text-[11px] font-semibold border transition cursor-pointer',
                        active ? 'bg-white text-ant-ink border-white' : 'border-white/15 text-white/70 hover:text-white hover:border-white/30')}>
                    {o.label}
                </button>
            );
        })}
    </div>
);

const Swatches = ({ colors, value, onChange }: { colors: string[]; value?: string; onChange: (c: string) => void }) => (
    <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => {
            const active = (value ?? '').toLowerCase() === c.toLowerCase();
            return (
                <button key={c} type="button" onClick={() => onChange(c)} style={{ backgroundColor: c }} aria-label={c}
                    className={cn('w-6 h-6 rounded-full border-2 transition cursor-pointer flex items-center justify-center',
                        active ? 'border-white scale-110' : 'border-white/20')}>
                    {active && <Check className="w-3 h-3" style={{ color: c.toLowerCase() === '#faf9f5' || c.toLowerCase() === '#ffe0bd' ? '#000' : '#fff' }} />}
                </button>
            );
        })}
    </div>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 py-1">
        <span className="text-[11px] font-semibold text-white/45 w-16 shrink-0">{label}</span>
        <div className="flex-1 min-w-0">{children}</div>
    </div>
);

export const AvatarStudio = ({ onChange, seed }: AvatarStudioProps) => {
    const [mode, setMode] = useState<Mode>('generate');
    const [config, setConfig] = useState<Cfg>(() => genConfig(seed || undefined) as Cfg);
    const [uploaded, setUploaded] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('Style');

    // Generated avatars are saved as config (rendered live everywhere) — no rasterization.
    useEffect(() => { if (mode === 'generate') onChange({ config }); }, [config, mode, onChange]);
    useEffect(() => { if (mode === 'upload') onChange({ dataUrl: uploaded }); }, [mode, uploaded, onChange]);

    const shuffle = useCallback(() => setConfig(genConfig() as Cfg), []);
    const patch = useCallback((p: Partial<Cfg>) => setConfig((c) => ({ ...c, ...p })), []);

    const sex = inferSex(config);
    const changeSex = (v: string) => patch({
        sex: v,
        hairStyle: v === 'woman' ? 'womanLong' : 'thick',
        eyeBrowStyle: v === 'woman' ? 'upWoman' : 'up',
    } as Partial<Cfg>);

    const onFile = async (file?: File) => {
        if (!file) return;
        const problem = validateImageFile(file);
        if (problem) { setUploadError(problem); return; }
        setUploadError(null);
        try {
            setUploaded(await fileToAvatarDataUrl(file));
        } catch (e) {
            setUploadError((e as Error).message);
        }
    };

    const modeBtn = (active: boolean) => cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-[12px] font-semibold transition cursor-pointer',
        active ? 'bg-white text-ant-ink' : 'text-white/60 hover:text-white',
    );
    const tabBtn = (active: boolean) => cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-full text-[11px] font-semibold transition cursor-pointer',
        active ? 'bg-ant-ink text-white' : 'text-white/55 hover:text-white',
    );

    return (
        <div className="space-y-4">
            <div className="inline-flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/[0.04] w-full">
                <button type="button" className={modeBtn(mode === 'generate')} onClick={() => setMode('generate')}>
                    <Sparkles className="w-3.5 h-3.5" /> Generate
                </button>
                <button type="button" className={modeBtn(mode === 'upload')} onClick={() => setMode('upload')}>
                    <ImageIcon className="w-3.5 h-3.5" /> Upload
                </button>
            </div>

            {mode === 'generate' ? (
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4 items-start">
                    <div className="flex flex-col items-center gap-3">
                        <div className="rounded-2xl overflow-hidden border border-white/15 shadow-lg">
                            <NiceAvatar style={{ width: 140, height: 140 }} {...(config as object)} />
                        </div>
                        <button type="button" onClick={shuffle}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ant-orange/15 border border-ant-orange/30 text-ant-orange text-[12px] font-semibold hover:bg-ant-orange/25 transition cursor-pointer">
                            <Shuffle className="w-3.5 h-3.5" /> Shuffle
                        </button>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <div className="flex items-center gap-1 p-1 border-b border-white/10">
                            <button type="button" className={tabBtn(tab === 'Style')} onClick={() => setTab('Style')}><Sparkles className="w-3 h-3" /> Style</button>
                            <button type="button" className={tabBtn(tab === 'Color')} onClick={() => setTab('Color')}><Palette className="w-3 h-3" /> Color</button>
                            <button type="button" className={tabBtn(tab === 'Accessories')} onClick={() => setTab('Accessories')}><Glasses className="w-3 h-3" /> Extras</button>
                        </div>

                        <div className="p-3.5 space-y-1">
                            {tab === 'Style' && (
                                <>
                                    <Row label="Sex"><Segmented options={SEX} value={sex} onChange={changeSex} /></Row>
                                    <Row label="Hair"><Segmented options={sex === 'woman' ? HAIR_WOMAN : HAIR_MAN} value={(config.hairStyle as string) ?? (sex === 'woman' ? 'womanLong' : 'normal')} onChange={(v) => patch({ hairStyle: v } as Partial<Cfg>)} /></Row>
                                    {sex === 'woman' && (
                                        <Row label="Eyebrows"><Segmented options={EYEBROWS} value={(config.eyeBrowStyle as string) ?? 'upWoman'} onChange={(v) => patch({ eyeBrowStyle: v } as Partial<Cfg>)} /></Row>
                                    )}
                                    <Row label="Ears"><Segmented options={EARS} value={(config.earSize as string) ?? 'small'} onChange={(v) => patch({ earSize: v } as Partial<Cfg>)} /></Row>
                                    <Row label="Eyes"><Segmented options={EYES} value={(config.eyeStyle as string) ?? 'circle'} onChange={(v) => patch({ eyeStyle: v } as Partial<Cfg>)} /></Row>
                                    <Row label="Nose"><Segmented options={NOSE} value={(config.noseStyle as string) ?? 'short'} onChange={(v) => patch({ noseStyle: v } as Partial<Cfg>)} /></Row>
                                    <Row label="Mouth"><Segmented options={MOUTH} value={(config.mouthStyle as string) ?? 'smile'} onChange={(v) => patch({ mouthStyle: v } as Partial<Cfg>)} /></Row>
                                    <Row label="Shirt"><Segmented options={SHIRT} value={(config.shirtStyle as string) ?? 'hoody'} onChange={(v) => patch({ shirtStyle: v } as Partial<Cfg>)} /></Row>
                                </>
                            )}
                            {tab === 'Color' && (
                                <>
                                    <Row label="Skin"><Swatches colors={PALETTE.faceColors} value={config.faceColor as string} onChange={(c) => patch({ faceColor: c } as Partial<Cfg>)} /></Row>
                                    <Row label="Hair"><Swatches colors={PALETTE.hairColors} value={config.hairColor as string} onChange={(c) => patch({ hairColor: c, hairColorRandom: true } as Partial<Cfg>)} /></Row>
                                    <Row label="Shirt"><Swatches colors={PALETTE.shirtColors} value={config.shirtColor as string} onChange={(c) => patch({ shirtColor: c } as Partial<Cfg>)} /></Row>
                                    <Row label="Background"><Swatches colors={PALETTE.bgColors} value={config.bgColor as string} onChange={(c) => patch({ bgColor: c, isGradient: false } as Partial<Cfg>)} /></Row>
                                </>
                            )}
                            {tab === 'Accessories' && (
                                <>
                                    <Row label="Hat"><Segmented options={HAT} value={(config.hatStyle as string) ?? 'none'} onChange={(v) => patch({ hatStyle: v } as Partial<Cfg>)} /></Row>
                                    {config.hatStyle && config.hatStyle !== 'none' && (
                                        <Row label="Hat color"><Swatches colors={PALETTE.hatColors} value={config.hatColor as string} onChange={(c) => patch({ hatColor: c } as Partial<Cfg>)} /></Row>
                                    )}
                                    <Row label="Glasses"><Segmented options={GLASSES} value={(config.glassesStyle as string) ?? 'none'} onChange={(v) => patch({ glassesStyle: v } as Partial<Cfg>)} /></Row>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <label className="flex flex-col items-center justify-center gap-3 h-44 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] hover:border-white/30 cursor-pointer transition overflow-hidden">
                        {uploaded ? (
                            <img src={uploaded} alt="" className="w-28 h-28 object-cover rounded-2xl" />
                        ) : (
                            <>
                                <Upload className="w-6 h-6 text-white/50" strokeWidth={1.5} />
                                <span className="text-[12px] font-semibold text-white/70">Click to upload a photo</span>
                                <span className="text-[10px] text-white/40">PNG / JPG · cropped to a square · 25 Mo max</span>
                            </>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                    </label>
                    {uploadError && <p className="text-[11px] text-ant-rose">{uploadError}</p>}
                </div>
            )}
        </div>
    );
};

export default AvatarStudio;

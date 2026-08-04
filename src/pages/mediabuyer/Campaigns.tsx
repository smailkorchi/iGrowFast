import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    LayoutGrid,
    List as ListIcon,
    Eye,
    Edit2,
    Trash2,
    MoreVertical,
    Power,
    PowerOff,
    Megaphone,
    ListChecks,
    Lock,
    Loader2,
    Calendar as CalendarIcon,
    PlayCircle,
    Infinity as InfinityIcon,
    ThumbsUp,
    MessageCircle,
    Share2,
    ChevronLeft,
    ChevronRight,
    User as UserIcon,
    Sparkles,
    Target,
    type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { imageUrl } from '@/lib/imageUrl';
import {
    CAMPAIGN_PLATFORMS,
    getPlatformIcon,
    getPlatformColor,
    type Campaign,
    type CampaignMedia,
} from '@/lib/campaignConstants';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useCampaignBasePath } from '@/hooks/useCampaignBasePath';
import { format } from 'date-fns';

type CampaignAction = 'preview' | 'manage' | 'toggle' | 'edit' | 'delete';

type CreatorInfo = {
    id: string;
    name: string | null;
    avatar_url: string | null;
    avatar_config?: unknown;
    role: string | null;
} | null;

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const CampaignKpi: React.FC<{
    label: string;
    value: number | string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
    suffix?: string;
}> = ({ label, value, accent, icon: Icon, suffix }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const statusPill = (status: string) => {
    if (status === 'active') return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
    return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
};

// ── Ad-mock card (Facebook/Instagram-style preview) ───────────────────────────
const AdMockCard: React.FC<{
    campaign: Campaign;
    businessName: string;
    businessLogo: string | null;
    canEdit: boolean;
    creator: CreatorInfo;
    showCreator: boolean;
    onClick: () => void;
    onActions: (action: CampaignAction) => void;
}> = ({ campaign, businessName, businessLogo, canEdit, creator, showCreator, onClick, onActions }) => {
    const [mediaIdx, setMediaIdx] = useState(0);
    const media = (campaign.media || []) as CampaignMedia[];
    const current = media[mediaIdx];
    const hasMultiple = media.length > 1;
    const isActive = campaign.status === 'active';
    const pill = statusPill(campaign.status);
    const stripe = isActive ? 'bg-ant-green' : 'bg-ant-orange';

    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)] transition-all">
            <div className={cn('h-[3px] w-full', stripe)} />

            {/* Mock Ad Header */}
            <div className="flex items-center gap-2.5 px-3.5 py-3">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                    {businessLogo ? (
                        <img src={imageUrl(businessLogo, 'avatarMd')} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-semibold text-ant-ink">
                            {(businessName || 'DG').substring(0, 2).toUpperCase()}
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-ant-ink truncate leading-tight">{businessName || 'Your business'}</p>
                    <p className="text-[10px] font-serif italic text-ant-mid">Sponsored</p>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', pill.bg, pill.border, pill.text)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
                        {campaign.status}
                    </span>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-ant-mid hover:text-ant-ink hover:bg-ant-ink/5 cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[160px]">
                            <DropdownMenuItem onClick={() => onActions('preview')} className="rounded-lg px-3 py-2 text-[12px] font-medium text-ant-ink cursor-pointer gap-2">
                                <Eye className="w-3.5 h-3.5" /> Preview
                            </DropdownMenuItem>
                            {canEdit && (
                                <>
                                    <DropdownMenuItem onClick={() => onActions('manage')} className="rounded-lg px-3 py-2 text-[12px] font-medium text-ant-ink cursor-pointer gap-2">
                                        <ListChecks className="w-3.5 h-3.5" /> Manage data
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('toggle')} className="rounded-lg px-3 py-2 text-[12px] font-medium text-ant-ink cursor-pointer gap-2">
                                        {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                                        {isActive ? 'Pause campaign' : 'Activate campaign'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('edit')} className="rounded-lg px-3 py-2 text-[12px] font-medium text-ant-ink cursor-pointer gap-2">
                                        <Edit2 className="w-3.5 h-3.5" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-ant-line" />
                                    <DropdownMenuItem
                                        onClick={() => onActions('delete')}
                                        className="rounded-lg px-3 py-2 text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 cursor-pointer gap-2"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> Delete
                                    </DropdownMenuItem>
                                </>
                            )}
                            {!canEdit && (
                                <DropdownMenuItem disabled className="rounded-lg px-3 py-2 text-[11px] font-semibold text-ant-mid uppercase tracking-[0.18em] gap-2">
                                    <Lock className="w-3 h-3" /> Read only
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Created by strip */}
            {showCreator && (
                <div className="px-3.5 pb-2 flex items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">By</span>
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-ant-line bg-ant-light">
                        <UserAvatar url={creator?.avatar_url} config={(creator as any)?.avatar_config} name={creator?.name} className="w-3.5 h-3.5 rounded-full border border-ant-line" />
                        <span className="text-[10px] font-semibold text-ant-ink truncate max-w-[120px]">
                            {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin')}
                        </span>
                    </div>
                </div>
            )}

            {/* Primary text */}
            {campaign.primary_text && (
                <div className="px-3.5 pb-3">
                    <p className="text-[12px] leading-snug text-ant-ink/85 line-clamp-2 whitespace-pre-wrap break-words">
                        {campaign.primary_text}
                    </p>
                </div>
            )}

            {/* Media area */}
            <button
                type="button"
                onClick={onClick}
                className="relative w-full aspect-square bg-ant-light overflow-hidden block cursor-pointer"
            >
                {current ? (
                    current.type === 'video' ? (
                        <video
                            src={current.url}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            loop
                            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                            onMouseLeave={(e) => e.currentTarget.pause()}
                        />
                    ) : (
                        <img src={imageUrl(current.url, 'card')} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-ant-mid/40">
                        <Megaphone className="w-10 h-10" strokeWidth={1.25} />
                        <span className="text-[10px] uppercase tracking-[0.24em] font-semibold">No media</span>
                    </div>
                )}

                {current?.type === 'video' && (
                    <div className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-ant-ink/55 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-4 h-4 text-white" />
                    </div>
                )}

                {/* Platform pill */}
                <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-ant-ink/70 backdrop-blur-sm px-2.5 py-1">
                    <span className="text-white">{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white font-semibold">{campaign.platform.replace(/ ads$/i, '')}</span>
                </div>

                {/* Carousel dots */}
                {hasMultiple && (
                    <>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                            {media.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        'h-1 rounded-full transition-all',
                                        i === mediaIdx ? 'bg-white w-4' : 'bg-white/50 w-1'
                                    )}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === 0 ? media.length - 1 : i - 1)); }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ant-paper/90 backdrop-blur border border-ant-line flex items-center justify-center shadow-sm cursor-pointer hover:bg-ant-paper transition-colors"
                        >
                            <ChevronLeft className="w-3.5 h-3.5 text-ant-ink" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === media.length - 1 ? 0 : i + 1)); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ant-paper/90 backdrop-blur border border-ant-line flex items-center justify-center shadow-sm cursor-pointer hover:bg-ant-paper transition-colors"
                        >
                            <ChevronRight className="w-3.5 h-3.5 text-ant-ink" />
                        </button>
                    </>
                )}
            </button>

            {/* Headline + CTA */}
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-ant-light border-t border-ant-line">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[10px] uppercase tracking-[0.18em] text-ant-mid truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && (
                            <p className="text-[12px] font-semibold text-ant-ink leading-tight truncate">
                                {campaign.headline}
                            </p>
                        )}
                    </div>
                    {campaign.cta_label && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onClick}
                            className="shrink-0 h-8 px-3 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 text-[11px] font-semibold cursor-pointer"
                        >
                            {campaign.cta_label}
                        </Button>
                    )}
                </div>
            )}

            {/* Engagement row */}
            <div className="flex items-center gap-4 px-3.5 py-2.5 text-ant-mid border-t border-ant-line">
                <div className="flex items-center gap-1.5"><ThumbsUp className="w-3 h-3" /><span className="text-[10px] font-medium">Like</span></div>
                <div className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3" /><span className="text-[10px] font-medium">Comment</span></div>
                <div className="flex items-center gap-1.5"><Share2 className="w-3 h-3" /><span className="text-[10px] font-medium">Share</span></div>
            </div>

            {/* Budget footer */}
            <div className="px-4 py-3 bg-ant-ink text-white flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75">
                    {campaign.spending_type === 'ongoing' ? (
                        <><InfinityIcon className="w-3.5 h-3.5" /> Ongoing</>
                    ) : (
                        <><CalendarIcon className="w-3.5 h-3.5" /> Date-limited</>
                    )}
                </span>
                <span className="font-display text-[14px] font-semibold tabular-nums text-white">
                    {campaign.spending_type === 'ongoing'
                        ? `${campaign.daily_budget ?? 0} ${campaign.currency}/d`
                        : `${campaign.total_budget ?? 0} ${campaign.currency}`}
                </span>
            </div>
        </div>
    );
};

// ── List row ──────────────────────────────────────────────────────────────────
const CampaignRow: React.FC<{
    campaign: Campaign;
    canEdit: boolean;
    creator: CreatorInfo;
    showCreator: boolean;
    onClick: () => void;
    onActions: (action: CampaignAction) => void;
}> = ({ campaign, canEdit, creator, showCreator, onClick, onActions }) => {
    const media = (campaign.media || []) as CampaignMedia[];
    const thumb = media[0];
    const isActive = campaign.status === 'active';
    const pill = statusPill(campaign.status);
    const stripe = isActive ? 'bg-ant-green' : 'bg-ant-orange';

    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 transition-colors">
            <div className={cn('h-[3px] w-full', stripe)} />
            <div className="px-4 py-3.5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <button
                    type="button"
                    onClick={onClick}
                    className="relative h-16 w-16 rounded-xl overflow-hidden bg-ant-light border border-ant-line shrink-0 cursor-pointer"
                >
                    {thumb ? (
                        thumb.type === 'video' ? (
                            <>
                                <video src={thumb.url} className="w-full h-full object-cover" muted playsInline />
                                <div className="absolute inset-0 flex items-center justify-center bg-ant-ink/35">
                                    <PlayCircle className="w-5 h-5 text-white" />
                                </div>
                            </>
                        ) : (
                            <img src={imageUrl(thumb.url, 'thumb')} alt="" className="w-full h-full object-cover" />
                        )
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-ant-mid/40">
                            <Megaphone className="w-6 h-6" strokeWidth={1.25} />
                        </div>
                    )}
                    <div
                        className="absolute top-1 left-1 w-5 h-5 rounded-md flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                    >
                        <span className="text-white">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5')}</span>
                    </div>
                </button>

                <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-start gap-2 flex-wrap mb-1">
                        <h3 className="font-display text-[15px] font-semibold text-ant-ink leading-snug min-w-0 flex-1 truncate">{campaign.name}</h3>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0', pill.bg, pill.border, pill.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
                            {campaign.status}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span className="text-ant-mid capitalize">{campaign.platform}</span>
                        <span className="text-ant-mid">
                            {campaign.spending_type === 'ongoing' ? 'Ongoing' : 'Date-limited'}
                        </span>
                        <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums">
                            {campaign.spending_type === 'ongoing'
                                ? `${campaign.daily_budget ?? 0} ${campaign.currency}/day`
                                : `${campaign.total_budget ?? 0} ${campaign.currency}`}
                        </span>
                        {campaign.start_date && (
                            <span className="text-ant-mid tabular-nums">
                                {format(new Date(campaign.start_date), 'dd MMM yyyy')}
                                {campaign.end_date ? ` → ${format(new Date(campaign.end_date), 'dd MMM yyyy')}` : ''}
                            </span>
                        )}
                        {showCreator && (
                            <span className="flex items-center gap-1.5 pl-3 border-l border-ant-line text-ant-mid">
                                <UserIcon className="w-3 h-3" />
                                <span className="font-serif italic">
                                    {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin')}
                                </span>
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 w-full sm:w-auto justify-end">
                    <Button variant="ghost" size="icon" onClick={() => onActions('preview')} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-ink cursor-pointer" title="Preview">
                        <Eye className="w-3.5 h-3.5" />
                    </Button>
                    {canEdit ? (
                        <>
                            <Button variant="ghost" size="icon" onClick={() => onActions('manage')} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-ink cursor-pointer" title="Manage data">
                                <ListChecks className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('toggle')} className="h-9 w-9 rounded-full hover:bg-ant-green/10 text-ant-green cursor-pointer" title={isActive ? 'Pause' : 'Activate'}>
                                {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('edit')} className="h-9 w-9 rounded-full hover:bg-ant-orange/10 text-ant-orange cursor-pointer" title="Edit">
                                <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('delete')} className="h-9 w-9 rounded-full hover:bg-ant-rose/10 text-ant-rose cursor-pointer" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </>
                    ) : (
                        <div className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full border border-ant-line bg-ant-light text-ant-mid">
                            <Lock className="w-3 h-3" />
                            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold">Read only</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Campaigns = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();
    const basePath = useCampaignBasePath();
    const isAdminView = !location.pathname.startsWith('/mediabuyer');

    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft'>('all');
    const [platformFilter, setPlatformFilter] = useState<string>('all');
    const [toDelete, setToDelete] = useState<Campaign | null>(null);

    const { data: business } = useQuery({
        queryKey: ['campaigns-business', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data } = await (supabase as any)
                .from('businesses')
                .select('name, logo')
                .eq('id', activeBusinessId)
                .single();
            return data;
        },
        enabled: !!activeBusinessId,
    });

    const { data: campaigns, isLoading } = useQuery({
        queryKey: ['campaigns', activeBusinessId],
        queryFn: async (): Promise<Campaign[]> => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as Campaign[];
        },
        enabled: !!activeBusinessId,
    });

    const { data: creators = [] } = useQuery({
        queryKey: ['campaigns-creators', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config, role')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as Array<CreatorInfo & { id: string }>;
        },
        enabled: !!activeBusinessId && isAdminView,
    });

    const creatorById = useMemo(() => {
        const map = new Map<string, CreatorInfo>();
        for (const u of creators) if (u) map.set(u.id, u);
        return map;
    }, [creators]);

    const toggleMutation = useMutation({
        mutationFn: async (campaign: Campaign) => {
            if (!currentUserId || campaign.created_by !== currentUserId) {
                throw new Error('You can only modify campaigns you created');
            }
            const next = campaign.status === 'active' ? 'draft' : 'active';
            const { error } = await (supabase as any)
                .from('campaigns')
                .update({ status: next })
                .eq('id', campaign.id);
            if (error) throw error;
            return next;
        },
        onSuccess: (next) => {
            queryClient.invalidateQueries({ queryKey: ['campaigns', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['dash-stats', 'mediabuyer'] });
            toast({ title: next === 'active' ? 'Campaign activated' : 'Campaign paused' });
        },
        onError: (err: any) => {
            const isLock = String(err?.message || '').includes('source_taken');
            toast({
                title: isLock ? 'Source indisponible' : 'Error',
                description: isLock ? (err?.details || 'Cette source est déjà gérée par un autre media buyer.') : err.message,
                variant: 'destructive',
            });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (campaign: Campaign) => {
            if (!currentUserId || campaign.created_by !== currentUserId) {
                throw new Error('You can only delete campaigns you created');
            }
            const paths = (campaign.media || []).map((m) => m.path).filter(Boolean);
            if (paths.length > 0) {
                await supabase.storage.from('campaign-media').remove(paths);
            }
            const { error } = await (supabase as any)
                .from('campaigns')
                .delete()
                .eq('id', campaign.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['dash-stats', 'mediabuyer'] });
            toast({ title: 'Campaign deleted' });
            setToDelete(null);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const filtered = useMemo(() => {
        if (!campaigns) return [];
        return campaigns.filter((c) => {
            if (statusFilter !== 'all' && c.status !== statusFilter) return false;
            if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                return (
                    c.name.toLowerCase().includes(q) ||
                    (c.headline || '').toLowerCase().includes(q) ||
                    (c.primary_text || '').toLowerCase().includes(q) ||
                    c.platform.toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [campaigns, statusFilter, platformFilter, searchQuery]);

    const stats = useMemo(() => {
        const list = campaigns || [];
        return {
            total: list.length,
            active: list.filter((c) => c.status === 'active').length,
            draft: list.filter((c) => c.status === 'draft').length,
            ongoing: list.filter((c) => c.spending_type === 'ongoing').length,
        };
    }, [campaigns]);

    const statusCounts = {
        all: campaigns?.length ?? 0,
        active: stats.active,
        draft: stats.draft,
    };

    const handleAction = (campaign: Campaign, action: CampaignAction) => {
        if (action === 'edit') navigate(`${basePath}/${campaign.id}/edit`);
        else if (action === 'manage') navigate(`${basePath}/${campaign.id}/manage`);
        else if (action === 'preview') navigate(`${basePath}/${campaign.id}`);
        else if (action === 'toggle') toggleMutation.mutate(campaign);
        else if (action === 'delete') setToDelete(campaign);
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Marketing · Creatives
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Global Ads
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every creative, every platform, every pitch — one catalog of the ads you are running, paused, or drafting.
                        </p>
                    </div>
                    <Button
                        onClick={() => navigate(`${basePath}/new`)}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        New campaign
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <CampaignKpi label="Total" value={stats.total} accent="ink" icon={Megaphone} suffix="creatives" />
                        <CampaignKpi label="Active" value={stats.active} accent="green" icon={Power} suffix="live" />
                        <CampaignKpi label="Draft" value={stats.draft} accent="orange" icon={PowerOff} suffix="paused" />
                        <CampaignKpi label="Ongoing" value={stats.ongoing} accent="rose" icon={InfinityIcon} suffix="no end date" />
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {([
                            { key: 'all', label: 'All' },
                            { key: 'active', label: 'Active' },
                            { key: 'draft', label: 'Draft' },
                        ] as const).map((t) => {
                            const active = statusFilter === t.key;
                            const count = statusCounts[t.key];
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setStatusFilter(t.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <Select value={platformFilter} onValueChange={setPlatformFilter}>
                            <SelectTrigger className="h-9 w-[180px] rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink capitalize">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-ant-line">
                                <SelectItem value="all" className="text-[12px]">All platforms</SelectItem>
                                {CAMPAIGN_PLATFORMS.map((p) => (
                                    <SelectItem key={p} value={p} className="text-[12px] capitalize">
                                        {p}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="relative flex-1 min-w-0 md:w-[260px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search campaigns..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                        <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper shrink-0">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-semibold transition cursor-pointer', viewMode === 'grid' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                            >
                                <LayoutGrid className="w-3 h-3" /> Grid
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-semibold transition cursor-pointer', viewMode === 'list' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                            >
                                <ListIcon className="w-3 h-3" /> List
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                {isLoading ? (
                    <div className={cn('grid gap-3', viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1')}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className={viewMode === 'grid' ? 'h-[480px] rounded-2xl' : 'h-24 rounded-2xl'} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Target className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {campaigns?.length ? 'No creatives match your filters' : 'No campaigns yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {campaigns?.length
                                ? 'Relax the status or platform filters to bring creatives back into view.'
                                : 'Launch your first creative — headline, image, budget — and start writing the story of your next sale.'}
                        </p>
                        {!campaigns?.length && (
                            <Button
                                onClick={() => navigate(`${basePath}/new`)}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Sparkles className="w-4 h-4" />
                                Build first campaign
                            </Button>
                        )}
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filtered.map((c) => (
                            <AdMockCard
                                key={c.id}
                                campaign={c}
                                businessName={business?.name || ''}
                                businessLogo={business?.logo || null}
                                canEdit={!!currentUserId && c.created_by === currentUserId}
                                creator={c.created_by ? creatorById.get(c.created_by) || null : null}
                                showCreator={isAdminView}
                                onClick={() => handleAction(c, 'preview')}
                                onActions={(a) => handleAction(c, a)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((c) => (
                            <CampaignRow
                                key={c.id}
                                campaign={c}
                                canEdit={!!currentUserId && c.created_by === currentUserId}
                                creator={c.created_by ? creatorById.get(c.created_by) || null : null}
                                showCreator={isAdminView}
                                onClick={() => handleAction(c, 'preview')}
                                onActions={(a) => handleAction(c, a)}
                            />
                        ))}
                    </div>
                )}

                <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this campaign?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                The record <span className="not-italic font-semibold text-ant-ink">&ldquo;{toDelete?.name}&rdquo;</span> and all its uploaded media will be permanently removed. This cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => toDelete && deleteMutation.mutate(toDelete)}
                                disabled={deleteMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default Campaigns;

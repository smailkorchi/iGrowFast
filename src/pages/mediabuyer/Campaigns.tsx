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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

// ── Ad-mock card (Facebook/Instagram-style preview) ──────────────────────
type CampaignAction = 'preview' | 'manage' | 'toggle' | 'edit' | 'delete';

type CreatorInfo = {
    id: string;
    name: string | null;
    avatar_url: string | null;
    role: string | null;
} | null;

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

    return (
        <div
            className={cn(
                'group/card relative rounded-[28px] overflow-hidden bg-white border border-brand-navy/[0.06] shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)] transition-all duration-500',
                'hover:shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)] hover:-translate-y-1 hover:border-brand-navy/10',
            )}
        >
            {/* ── Mock Ad Header (profile + sponsored + menu) ── */}
            <div className="flex items-center gap-3 p-4 pb-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-brand-navy/[0.05] flex items-center justify-center shrink-0 border border-brand-navy/5">
                    {businessLogo ? (
                        <img src={businessLogo} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[11px] font-black text-brand-navy">
                            {(businessName || 'DG').substring(0, 2).toUpperCase()}
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-brand-navy truncate leading-tight">{businessName || 'Your business'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground font-medium">Sponsored</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <div className="w-2.5 h-2.5 rounded-full bg-brand-navy/10 flex items-center justify-center">
                            <div className="w-1 h-1 rounded-full bg-brand-navy/40" />
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Badge
                        className={cn(
                            'rounded-full text-[9px] uppercase font-black tracking-wider px-2.5 py-0.5 border-none',
                            isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                        )}
                    >
                        {campaign.status}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-1">
                            <DropdownMenuItem onClick={() => onActions('preview')} className="rounded-xl p-2.5 text-xs font-bold cursor-pointer">
                                <Eye className="w-4 h-4 mr-2" /> Preview
                            </DropdownMenuItem>
                            {canEdit && (
                                <>
                                    <DropdownMenuItem onClick={() => onActions('manage')} className="rounded-xl p-2.5 text-xs font-bold cursor-pointer">
                                        <ListChecks className="w-4 h-4 mr-2" /> Manage data
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('toggle')} className="rounded-xl p-2.5 text-xs font-bold cursor-pointer">
                                        {isActive ? <PowerOff className="w-4 h-4 mr-2" /> : <Power className="w-4 h-4 mr-2" />}
                                        {isActive ? 'Deactivate' : 'Activate'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('edit')} className="rounded-xl p-2.5 text-xs font-bold cursor-pointer">
                                        <Edit2 className="w-4 h-4 mr-2" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onActions('delete')}
                                        className="rounded-xl p-2.5 text-xs font-bold cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                                    </DropdownMenuItem>
                                </>
                            )}
                            {!canEdit && (
                                <DropdownMenuItem disabled className="rounded-xl p-2.5 text-[10px] font-bold text-brand-navy/40 uppercase tracking-wider">
                                    <Lock className="w-3 h-3 mr-2" /> Read only
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* ── Created by strip (admin view only) ── */}
            {showCreator && (
                <div className="px-4 pb-2 flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-brand-navy/30">Created by</span>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-brand-navy/[0.04]">
                        <div className="w-4 h-4 rounded-full bg-brand-navy/10 flex items-center justify-center overflow-hidden">
                            {creator?.avatar_url ? (
                                <img src={creator.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <UserIcon className="w-2.5 h-2.5 text-brand-navy/50" />
                            )}
                        </div>
                        <span className="text-[10px] font-bold text-brand-navy/70 truncate max-w-[140px]">
                            {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin (legacy)')}
                        </span>
                        {creator?.role && (
                            <span className="text-[8px] font-black uppercase tracking-widest text-brand-navy/40">
                                {creator.role.replace(/_/g, ' ')}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── Primary text ── */}
            {campaign.primary_text && (
                <div className="px-4 pb-3">
                    <p className="text-[13px] leading-snug text-brand-navy/80 line-clamp-2 whitespace-pre-wrap break-words">
                        {campaign.primary_text}
                    </p>
                </div>
            )}

            {/* ── Media area ── */}
            <button
                type="button"
                onClick={onClick}
                className="relative w-full aspect-square bg-gradient-to-br from-brand-navy/[0.04] to-brand-navy/[0.08] overflow-hidden block"
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
                        <img src={current.url} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-brand-navy/20">
                        <Megaphone className="w-12 h-12" />
                        <span className="text-xs font-bold uppercase tracking-wider">No media</span>
                    </div>
                )}

                {current?.type === 'video' && (
                    <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-5 h-5 text-white" />
                    </div>
                )}

                {/* Platform badge overlay */}
                <div
                    className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md shadow-lg"
                    style={{ backgroundColor: `${getPlatformColor(campaign.platform)}E6` }}
                >
                    <span className="text-white">{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                    <span className="text-[9px] font-black uppercase tracking-wider text-white">{campaign.platform.replace(/ ads$/i, '')}</span>
                </div>

                {/* Carousel dots */}
                {hasMultiple && (
                    <>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                            {media.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        'w-1.5 h-1.5 rounded-full transition-all',
                                        i === mediaIdx ? 'bg-white w-4' : 'bg-white/50'
                                    )}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === 0 ? media.length - 1 : i - 1)); }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center shadow-md opacity-0 group-hover/card:opacity-100 transition-opacity"
                        >
                            <ChevronLeft className="w-4 h-4 text-brand-navy" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === media.length - 1 ? 0 : i + 1)); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center shadow-md opacity-0 group-hover/card:opacity-100 transition-opacity"
                        >
                            <ChevronRight className="w-4 h-4 text-brand-navy" />
                        </button>
                    </>
                )}
            </button>

            {/* ── Headline + CTA strip (mimics FB ad footer) ── */}
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-brand-navy/[0.02] border-y border-brand-navy/5">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && (
                            <p className="text-[13px] font-bold text-brand-navy leading-tight truncate">
                                {campaign.headline}
                            </p>
                        )}
                    </div>
                    {campaign.cta_label && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onClick}
                            className="shrink-0 h-8 px-3 rounded-xl bg-brand-navy/[0.06] hover:bg-brand-navy hover:text-white text-brand-navy text-[10px] font-black uppercase tracking-wider border-none shadow-none"
                        >
                            {campaign.cta_label}
                        </Button>
                    )}
                </div>
            )}

            {/* ── Meta engagement row (purely decorative) ── */}
            <div className="flex items-center justify-between px-4 py-2.5 text-brand-navy/30">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /><span className="text-[10px] font-bold">Like</span></div>
                    <div className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /><span className="text-[10px] font-bold">Comment</span></div>
                    <div className="flex items-center gap-1"><Share2 className="w-3.5 h-3.5" /><span className="text-[10px] font-bold">Share</span></div>
                </div>
            </div>

            {/* ── Footer strip — budget + dates ── */}
            <div className="px-4 py-3 bg-brand-navy text-white flex items-center justify-between gap-2 text-[10px] font-bold">
                <div className="flex items-center gap-1.5">
                    {campaign.spending_type === 'ongoing' ? (
                        <><InfinityIcon className="w-3 h-3" /> Ongoing</>
                    ) : (
                        <><CalendarIcon className="w-3 h-3" /> Date-limited</>
                    )}
                </div>
                <div className="tabular-nums">
                    {campaign.spending_type === 'ongoing'
                        ? `${campaign.daily_budget ?? 0} ${campaign.currency}/d`
                        : `${campaign.total_budget ?? 0} ${campaign.currency} total`}
                </div>
            </div>
        </div>
    );
};

// ── List row variant ─────────────────────────────────────────────────────
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

    return (
        <Card className="border-none bg-white/90 backdrop-blur-sm rounded-[24px] overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group/row">
            <CardContent className="p-4 flex items-center gap-4">
                <button
                    type="button"
                    onClick={onClick}
                    className="relative h-20 w-20 rounded-2xl overflow-hidden bg-brand-navy/[0.05] shrink-0"
                >
                    {thumb ? (
                        thumb.type === 'video' ? (
                            <>
                                <video src={thumb.url} className="w-full h-full object-cover" muted playsInline />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <PlayCircle className="w-6 h-6 text-white" />
                                </div>
                            </>
                        ) : (
                            <img src={thumb.url} alt="" className="w-full h-full object-cover" />
                        )
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-brand-navy/20">
                            <Megaphone className="w-6 h-6" />
                        </div>
                    )}
                    <div
                        className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center shadow"
                        style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                    >
                        <span className="text-white">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5')}</span>
                    </div>
                </button>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-bold text-brand-navy truncate">{campaign.name}</h3>
                        <Badge
                            className={cn(
                                'rounded-full text-[9px] uppercase font-black tracking-wider px-2 py-0.5 border-none shrink-0',
                                isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                            )}
                        >
                            {campaign.status}
                        </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground font-medium">
                        <span className="capitalize">{campaign.platform}</span>
                        <span className="flex items-center gap-1">
                            {campaign.spending_type === 'ongoing' ? <InfinityIcon className="w-3 h-3" /> : <CalendarIcon className="w-3 h-3" />}
                            {campaign.spending_type === 'ongoing' ? 'Ongoing' : 'Date-limited'}
                        </span>
                        <span className="tabular-nums font-bold text-brand-navy">
                            {campaign.spending_type === 'ongoing'
                                ? `${campaign.daily_budget ?? 0} ${campaign.currency}/day`
                                : `${campaign.total_budget ?? 0} ${campaign.currency}`}
                        </span>
                        {campaign.start_date && (
                            <span>{format(new Date(campaign.start_date), 'dd MMM yyyy')}{campaign.end_date ? ` → ${format(new Date(campaign.end_date), 'dd MMM yyyy')}` : ''}</span>
                        )}
                        {showCreator && (
                            <span className="flex items-center gap-1 pl-2 border-l border-brand-navy/10">
                                <div className="w-3.5 h-3.5 rounded-full bg-brand-navy/10 flex items-center justify-center overflow-hidden">
                                    {creator?.avatar_url ? (
                                        <img src={creator.avatar_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <UserIcon className="w-2 h-2 text-brand-navy/50" />
                                    )}
                                </div>
                                <span className="text-[10px] font-bold text-brand-navy/60">
                                    {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin (legacy)')}
                                </span>
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => onActions('preview')} className="h-9 w-9 rounded-xl text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5" title="Preview">
                        <Eye className="w-4 h-4" />
                    </Button>
                    {canEdit ? (
                        <>
                            <Button variant="ghost" size="icon" onClick={() => onActions('manage')} className="h-9 w-9 rounded-xl text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5" title="Manage data">
                                <ListChecks className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('toggle')} className="h-9 w-9 rounded-xl text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5" title={isActive ? 'Deactivate' : 'Activate'}>
                                {isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('edit')} className="h-9 w-9 rounded-xl text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5" title="Edit">
                                <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('delete')} className="h-9 w-9 rounded-xl text-red-500/60 hover:text-red-600 hover:bg-red-50" title="Delete">
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl bg-brand-navy/[0.04] text-brand-navy/50" title="You can only edit campaigns you created">
                            <Lock className="w-3 h-3" />
                            <span className="text-[9px] font-black uppercase tracking-wider">Read only</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
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
    // Creator badge only shows in admin view — redundant noise under /mediabuyer.
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

    // Creators lookup — only loaded when the page is rendered in admin view,
    // since media buyers only see their own rows and don't need the badge.
    const { data: creators = [] } = useQuery({
        queryKey: ['campaigns-creators', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, role')
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
            toast({ title: next === 'active' ? 'Campaign activated' : 'Campaign paused' });
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (campaign: Campaign) => {
            if (!currentUserId || campaign.created_by !== currentUserId) {
                throw new Error('You can only delete campaigns you created');
            }
            // Best-effort cleanup of media files in storage.
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

    const handleAction = (campaign: Campaign, action: CampaignAction) => {
        if (action === 'edit') navigate(`${basePath}/${campaign.id}/edit`);
        else if (action === 'manage') navigate(`${basePath}/${campaign.id}/manage`);
        else if (action === 'preview') navigate(`${basePath}/${campaign.id}`);
        else if (action === 'toggle') toggleMutation.mutate(campaign);
        else if (action === 'delete') setToDelete(campaign);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Campaigns</h1>
                            <p className="text-gray-500 font-light">Create, monitor and manage your advertising campaigns.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="flex bg-white/80 p-1 rounded-2xl border border-gray-100 shadow-sm">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setViewMode('grid')}
                                    className={cn(
                                        'rounded-xl w-10 h-10 transition-all',
                                        viewMode === 'grid' ? 'bg-white shadow-xl text-primary font-bold' : 'text-gray-400 hover:text-primary'
                                    )}
                                >
                                    <LayoutGrid className="w-5 h-5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setViewMode('list')}
                                    className={cn(
                                        'rounded-xl w-10 h-10 transition-all',
                                        viewMode === 'list' ? 'bg-white shadow-xl text-primary font-bold' : 'text-gray-400 hover:text-primary'
                                    )}
                                >
                                    <ListIcon className="w-5 h-5" />
                                </Button>
                            </div>
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search by name, headline, platform..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => navigate(`${basePath}/new`)}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
                                Create Campaign
                            </Button>
                        </div>
                    </div>

                    {/* Stats strip */}
                    {isLoading ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 pt-6">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-24 rounded-3xl bg-white/60" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-6">
                            {[
                                { label: 'Total', value: stats.total, tone: 'bg-brand-navy/10 text-brand-navy' },
                                { label: 'Active', value: stats.active, tone: 'bg-emerald-500/10 text-emerald-600' },
                                { label: 'Draft', value: stats.draft, tone: 'bg-amber-500/10 text-amber-600' },
                                { label: 'Ongoing', value: stats.ongoing, tone: 'bg-primary/10 text-primary' },
                            ].map((s) => (
                                <div key={s.label} className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{s.label}</p>
                                            <p className="text-2xl font-black tabular-nums text-gray-900 tracking-tight">{s.value}</p>
                                        </div>
                                        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', s.tone)}>
                                            <Megaphone className="h-5 w-5" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Filters */}
            <Card className="border-none shadow-sm bg-white/50 backdrop-blur-sm rounded-[24px]">
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                    <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                        <SelectTrigger className="w-[160px] h-11 rounded-2xl border-gray-100 bg-white font-bold text-brand-navy">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="draft">Draft</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={platformFilter} onValueChange={setPlatformFilter}>
                        <SelectTrigger className="w-[200px] h-11 rounded-2xl border-gray-100 bg-white font-bold text-brand-navy">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            <SelectItem value="all">All platforms</SelectItem>
                            {CAMPAIGN_PLATFORMS.map((p) => (
                                <SelectItem key={p} value={p} className="capitalize">
                                    {p}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground font-bold ml-auto">
                        {filtered.length} / {campaigns?.length ?? 0} campaigns
                    </span>
                </CardContent>
            </Card>

            {/* Content */}
            {isLoading ? (
                <div className={cn('grid gap-6', viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1')}>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className={viewMode === 'grid' ? 'h-[560px] rounded-[28px]' : 'h-28 rounded-[24px]'} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Megaphone className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No campaigns yet</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">
                            Launch your first advertising campaign and start tracking performance across platforms.
                        </p>
                    </div>
                    <Button
                        onClick={() => navigate(`${basePath}/new`)}
                        variant="outline"
                        className="rounded-xl border-brand-navy/10 font-bold hover:bg-brand-navy hover:text-brand-white transition-all"
                    >
                        Create First Campaign
                    </Button>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
                <div className="grid grid-cols-1 gap-4">
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
                <AlertDialogContent className="rounded-[32px] border-none shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-bold text-brand-navy">Delete campaign?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                            This will permanently delete <span className="font-bold text-brand-navy">{toDelete?.name}</span> and all its uploaded media. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl font-bold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => toDelete && deleteMutation.mutate(toDelete)}
                            disabled={deleteMutation.isPending}
                            className="rounded-xl font-bold bg-red-600 hover:bg-red-700"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Campaigns;

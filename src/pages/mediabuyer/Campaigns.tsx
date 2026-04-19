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

type CampaignAction = 'preview' | 'manage' | 'toggle' | 'edit' | 'delete';

type CreatorInfo = {
    id: string;
    name: string | null;
    avatar_url: string | null;
    role: string | null;
} | null;

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

    return (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden hover:shadow-sm transition-shadow">
            {/* Mock Ad Header */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
                    {businessLogo ? (
                        <img src={businessLogo} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-semibold text-brand-navy">
                            {(businessName || 'DG').substring(0, 2).toUpperCase()}
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-brand-navy truncate leading-tight">{businessName || 'Your business'}</p>
                    <p className="text-[9px] text-gray-400">Sponsored</p>
                </div>
                <div className="flex items-center gap-1">
                    <Badge
                        className={cn(
                            'h-5 px-1.5 text-[9px] rounded-md border-none font-semibold',
                            isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                        )}
                    >
                        {campaign.status}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-50"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-gray-100 shadow-md p-1">
                            <DropdownMenuItem onClick={() => onActions('preview')} className="rounded-md text-[11px] font-semibold cursor-pointer">
                                <Eye className="w-3.5 h-3.5 mr-2" /> Preview
                            </DropdownMenuItem>
                            {canEdit && (
                                <>
                                    <DropdownMenuItem onClick={() => onActions('manage')} className="rounded-md text-[11px] font-semibold cursor-pointer">
                                        <ListChecks className="w-3.5 h-3.5 mr-2" /> Manage data
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('toggle')} className="rounded-md text-[11px] font-semibold cursor-pointer">
                                        {isActive ? <PowerOff className="w-3.5 h-3.5 mr-2" /> : <Power className="w-3.5 h-3.5 mr-2" />}
                                        {isActive ? 'Deactivate' : 'Activate'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onActions('edit')} className="rounded-md text-[11px] font-semibold cursor-pointer">
                                        <Edit2 className="w-3.5 h-3.5 mr-2" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onActions('delete')}
                                        className="rounded-md text-[11px] font-semibold cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                    </DropdownMenuItem>
                                </>
                            )}
                            {!canEdit && (
                                <DropdownMenuItem disabled className="rounded-md text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    <Lock className="w-3 h-3 mr-2" /> Read only
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Created by strip */}
            {showCreator && (
                <div className="px-3 pb-2 flex items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-gray-400">By</span>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50">
                        <div className="w-3.5 h-3.5 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                            {creator?.avatar_url ? (
                                <img src={creator.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <UserIcon className="w-2 h-2 text-gray-400" />
                            )}
                        </div>
                        <span className="text-[10px] font-medium text-brand-navy/70 truncate max-w-[120px]">
                            {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin')}
                        </span>
                    </div>
                </div>
            )}

            {/* Primary text */}
            {campaign.primary_text && (
                <div className="px-3 pb-2">
                    <p className="text-[11px] leading-snug text-brand-navy/80 line-clamp-2 whitespace-pre-wrap break-words">
                        {campaign.primary_text}
                    </p>
                </div>
            )}

            {/* Media area */}
            <button
                type="button"
                onClick={onClick}
                className="relative w-full aspect-square bg-gray-50 overflow-hidden block"
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
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300">
                        <Megaphone className="w-10 h-10" />
                        <span className="text-[9px] uppercase tracking-[0.18em]">No media</span>
                    </div>
                )}

                {current?.type === 'video' && (
                    <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-4 h-4 text-white" />
                    </div>
                )}

                {/* Platform badge */}
                <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
                    <span className="text-white">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5')}</span>
                    <span className="text-[9px] uppercase tracking-[0.12em] text-white font-semibold">{campaign.platform.replace(/ ads$/i, '')}</span>
                </div>

                {/* Carousel dots */}
                {hasMultiple && (
                    <>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                            {media.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        'h-1 rounded-full transition-all',
                                        i === mediaIdx ? 'bg-white w-3' : 'bg-white/50 w-1'
                                    )}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === 0 ? media.length - 1 : i - 1)); }}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow"
                        >
                            <ChevronLeft className="w-3.5 h-3.5 text-brand-navy" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMediaIdx((i) => (i === media.length - 1 ? 0 : i + 1)); }}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow"
                        >
                            <ChevronRight className="w-3.5 h-3.5 text-brand-navy" />
                        </button>
                    </>
                )}
            </button>

            {/* Headline + CTA */}
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[9px] uppercase tracking-[0.12em] text-gray-400 truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && (
                            <p className="text-[11px] font-semibold text-brand-navy leading-tight truncate">
                                {campaign.headline}
                            </p>
                        )}
                    </div>
                    {campaign.cta_label && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onClick}
                            className="shrink-0 h-7 px-2.5 rounded-md bg-brand-navy text-white text-[10px] font-semibold shadow-none border-none"
                        >
                            {campaign.cta_label}
                        </Button>
                    )}
                </div>
            )}

            {/* Engagement row */}
            <div className="flex items-center gap-3 px-3 py-2 text-gray-400">
                <div className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" /><span className="text-[9px]">Like</span></div>
                <div className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /><span className="text-[9px]">Comment</span></div>
                <div className="flex items-center gap-1"><Share2 className="w-3 h-3" /><span className="text-[9px]">Share</span></div>
            </div>

            {/* Budget footer */}
            <div className="px-3 py-2 bg-brand-navy text-white flex items-center justify-between text-[10px] font-semibold">
                <span className="flex items-center gap-1">
                    {campaign.spending_type === 'ongoing' ? (
                        <><InfinityIcon className="w-3 h-3" /> Ongoing</>
                    ) : (
                        <><CalendarIcon className="w-3 h-3" /> Date-limited</>
                    )}
                </span>
                <span className="tabular-nums">
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

    return (
        <div className="border border-gray-100 rounded-xl bg-white hover:bg-gray-50 transition-colors">
            <div className="px-3 py-2 flex items-center gap-3">
                <button
                    type="button"
                    onClick={onClick}
                    className="relative h-14 w-14 rounded-md overflow-hidden bg-gray-100 shrink-0"
                >
                    {thumb ? (
                        thumb.type === 'video' ? (
                            <>
                                <video src={thumb.url} className="w-full h-full object-cover" muted playsInline />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <PlayCircle className="w-5 h-5 text-white" />
                                </div>
                            </>
                        ) : (
                            <img src={thumb.url} alt="" className="w-full h-full object-cover" />
                        )
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <Megaphone className="w-5 h-5" />
                        </div>
                    )}
                    <div
                        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-sm flex items-center justify-center"
                        style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                    >
                        <span className="text-white">{getPlatformIcon(campaign.platform, 'w-2 h-2')}</span>
                    </div>
                </button>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-[12px] font-semibold text-brand-navy truncate">{campaign.name}</h3>
                        <Badge
                            className={cn(
                                'h-5 px-1.5 text-[9px] rounded-md border-none font-semibold shrink-0',
                                isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                            )}
                        >
                            {campaign.status}
                        </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-400 tabular-nums">
                        <span className="capitalize">{campaign.platform}</span>
                        <span>
                            {campaign.spending_type === 'ongoing' ? 'Ongoing' : 'Date-limited'}
                        </span>
                        <span className="font-semibold text-brand-navy/80">
                            {campaign.spending_type === 'ongoing'
                                ? `${campaign.daily_budget ?? 0} ${campaign.currency}/day`
                                : `${campaign.total_budget ?? 0} ${campaign.currency}`}
                        </span>
                        {campaign.start_date && (
                            <span>{format(new Date(campaign.start_date), 'dd MMM yyyy')}{campaign.end_date ? ` → ${format(new Date(campaign.end_date), 'dd MMM yyyy')}` : ''}</span>
                        )}
                        {showCreator && (
                            <span className="flex items-center gap-1 pl-2 border-l border-gray-200">
                                <UserIcon className="w-2.5 h-2.5 text-gray-400" />
                                <span className="text-[9px] text-brand-navy/60">
                                    {creator?.name || (campaign.created_by ? 'Unknown' : 'Admin')}
                                </span>
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => onActions('preview')} className="h-8 w-8 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-100" title="Preview">
                        <Eye className="w-3.5 h-3.5" />
                    </Button>
                    {canEdit ? (
                        <>
                            <Button variant="ghost" size="icon" onClick={() => onActions('manage')} className="h-8 w-8 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-100" title="Manage data">
                                <ListChecks className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('toggle')} className="h-8 w-8 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-100" title={isActive ? 'Deactivate' : 'Activate'}>
                                {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('edit')} className="h-8 w-8 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-100" title="Edit">
                                <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onActions('delete')} className="h-8 w-8 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </>
                    ) : (
                        <div className="flex items-center gap-1 px-2 h-8 rounded-md bg-gray-50 text-gray-400">
                            <Lock className="w-3 h-3" />
                            <span className="text-[9px] uppercase tracking-[0.18em]">Read only</span>
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Campaigns</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Advertising campaigns</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center border border-gray-100 rounded-md overflow-hidden">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    'h-8 w-8 rounded-none',
                                    viewMode === 'grid' ? 'bg-gray-100 text-brand-navy' : 'text-gray-400'
                                )}
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    'h-8 w-8 rounded-none',
                                    viewMode === 'list' ? 'bg-gray-100 text-brand-navy' : 'text-gray-400'
                                )}
                            >
                                <ListIcon className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <Input
                                placeholder="Search campaigns..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 h-8 rounded-md text-[11px] w-52 border-gray-200"
                            />
                        </div>
                        <Button
                            onClick={() => navigate(`${basePath}/new`)}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Create
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                        { label: 'Total', value: stats.total, accent: '#3b5e5e' },
                        { label: 'Active', value: stats.active, accent: '#059669' },
                        { label: 'Draft', value: stats.draft, accent: '#d97706' },
                        { label: 'Ongoing', value: stats.ongoing, accent: '#9ca3af' },
                    ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{s.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="border border-gray-100 rounded-xl bg-white p-3 flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                    <SelectTrigger className="w-[140px] h-8 rounded-md border-gray-200 text-[11px] font-semibold text-brand-navy">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                        <SelectItem value="all" className="text-[11px]">All statuses</SelectItem>
                        <SelectItem value="active" className="text-[11px]">Active</SelectItem>
                        <SelectItem value="draft" className="text-[11px]">Draft</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={platformFilter} onValueChange={setPlatformFilter}>
                    <SelectTrigger className="w-[180px] h-8 rounded-md border-gray-200 text-[11px] font-semibold text-brand-navy">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                        <SelectItem value="all" className="text-[11px]">All platforms</SelectItem>
                        {CAMPAIGN_PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p} className="text-[11px] capitalize">
                                {p}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="text-[10px] text-gray-400 ml-auto tabular-nums">
                    {filtered.length} / {campaigns?.length ?? 0}
                </span>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className={cn('grid gap-3', viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1')}>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className={viewMode === 'grid' ? 'h-[480px] rounded-xl' : 'h-16 rounded-xl'} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4 border border-gray-100 rounded-xl bg-white">
                    <Megaphone className="w-10 h-10 text-gray-200" />
                    <div className="text-center space-y-1">
                        <p className="text-[13px] font-semibold text-brand-navy">No campaigns</p>
                        <p className="text-[11px] text-gray-400 max-w-xs">Launch your first advertising campaign to start tracking performance.</p>
                    </div>
                    <Button
                        onClick={() => navigate(`${basePath}/new`)}
                        className="h-8 rounded-md text-[11px] font-semibold px-4"
                    >
                        Create Campaign
                    </Button>
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
                <div className="space-y-1.5">
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
                <AlertDialogContent className="rounded-xl border-gray-100 shadow-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Delete campaign?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[12px] text-gray-500">
                            This will permanently delete <span className="font-semibold text-brand-navy">{toDelete?.name}</span> and all its uploaded media. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => toDelete && deleteMutation.mutate(toDelete)}
                            disabled={deleteMutation.isPending}
                            className="h-8 rounded-md text-[11px] font-semibold bg-red-600 hover:bg-red-700"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Campaigns;

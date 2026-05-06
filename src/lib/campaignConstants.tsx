import React from 'react';
import {
    FaFacebook,
    FaInstagram,
    FaWhatsapp,
    FaGoogle,
    FaTiktok,
    FaSnapchatGhost,
    FaTwitter,
    FaPinterest,
    FaReddit,
    FaMicrosoft,
    FaBullseye,
} from 'react-icons/fa';
import { SiMessenger } from 'react-icons/si';
import { Image, Images, GalleryHorizontal, Video, Clapperboard, Link as LinkIcon, ShoppingBag, ClipboardList, Megaphone } from 'lucide-react';

// Kept identical to src/pages/AdsHistory.tsx PLATFORMS so order source_name mapping stays consistent.
export const CAMPAIGN_PLATFORMS = [
    'Whatsapp ads',
    'Messenger ads',
    'Instagram ads',
    'Facebook ads',
    'Google ads',
    'Tiktok ads',
    'Native ads',
    'Snapchat ads',
    'Twitter ads',
    'Bing ads',
    'pinterest ads',
    'Reddit ads',
] as const;

export type CampaignPlatform = typeof CAMPAIGN_PLATFORMS[number];

// Mirror of AdsHistory PLATFORM_SOURCE_MAP — used to attribute orders to a campaign by matching
// orders.source_name against the lowercase source derived from the campaign.platform.
export const PLATFORM_SOURCE_MAP: Record<string, string> = {
    'whatsapp ads': 'whatsapp',
    'messenger ads': 'messenger',
    'instagram ads': 'instagram',
    'facebook ads': 'facebook',
    'google ads': 'google',
    'tiktok ads': 'tiktok',
    'native ads': 'native',
    'snapchat ads': 'snapchat',
    'twitter ads': 'twitter',
    'bing ads': 'bing',
    'pinterest ads': 'pinterest',
    'reddit ads': 'reddit',
};

export const getPlatformSource = (platform: string): string => {
    return PLATFORM_SOURCE_MAP[(platform || '').toLowerCase()] || '';
};

export const getPlatformIcon = (name: string, className = 'w-4 h-4') => {
    switch ((name || '').toLowerCase()) {
        case 'whatsapp ads': return <FaWhatsapp className={className} />;
        case 'messenger ads': return <SiMessenger className={className} />;
        case 'instagram ads': return <FaInstagram className={className} />;
        case 'facebook ads': return <FaFacebook className={className} />;
        case 'google ads': return <FaGoogle className={className} />;
        case 'tiktok ads': return <FaTiktok className={className} />;
        case 'snapchat ads': return <FaSnapchatGhost className={className} />;
        case 'twitter ads': return <FaTwitter className={className} />;
        case 'pinterest ads': return <FaPinterest className={className} />;
        case 'reddit ads': return <FaReddit className={className} />;
        case 'bing ads': return <FaMicrosoft className={className} />;
        case 'native ads': return <FaBullseye className={className} />;
        default: return <Megaphone className={className} />;
    }
};

export const getPlatformColor = (name: string): string => {
    switch ((name || '').toLowerCase()) {
        case 'whatsapp ads': return '#25D366';
        case 'messenger ads': return '#0084FF';
        case 'instagram ads': return '#E1306C';
        case 'facebook ads': return '#1877F2';
        case 'google ads': return '#EA4335';
        case 'tiktok ads': return '#000000';
        case 'snapchat ads': return '#FFFC00';
        case 'twitter ads': return '#1DA1F2';
        case 'pinterest ads': return '#E60023';
        case 'reddit ads': return '#FF4500';
        case 'bing ads': return '#008373';
        case 'native ads': return '#6366F1';
        default: return '#0F172A';
    }
};

export type CampaignType = 'single_image' | 'multi_image' | 'carousel' | 'video' | 'multi_video';

export const CAMPAIGN_TYPES: { value: CampaignType; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'single_image', label: 'Single image', description: 'One static creative', icon: Image },
    { value: 'multi_image', label: 'Multi images', description: 'Several image creatives', icon: Images },
    { value: 'carousel', label: 'Carousel', description: 'Swipeable cards', icon: GalleryHorizontal },
    { value: 'video', label: 'Video', description: 'One video creative', icon: Video },
    { value: 'multi_video', label: 'Multi videos', description: 'Several video creatives', icon: Clapperboard },
];

export const isVideoType = (t: CampaignType) => t === 'video' || t === 'multi_video';
export const isMultiType = (t: CampaignType) => t === 'multi_image' || t === 'multi_video' || t === 'carousel';

export type ConversionType = 'landing_page' | 'whatsapp' | 'shop' | 'facebook_form';

export const CONVERSION_TYPES: { value: ConversionType; label: string; icon: React.ComponentType<{ className?: string }>; placeholder: string; contentLabel: string }[] = [
    { value: 'landing_page', label: 'Landing page', icon: LinkIcon, placeholder: 'https://landing.example.com', contentLabel: 'Landing URL' },
    { value: 'whatsapp', label: 'WhatsApp', icon: FaWhatsapp as any, placeholder: '+212600000000', contentLabel: 'WhatsApp number' },
    { value: 'shop', label: 'Online shop', icon: ShoppingBag, placeholder: 'https://shop.example.com/product', contentLabel: 'Shop URL' },
    { value: 'facebook_form', label: 'Facebook form', icon: ClipboardList, placeholder: 'Form ID or URL', contentLabel: 'Form reference' },
];

export const CAMPAIGN_OBJECTIVES = [
    { value: 'conversions', label: 'Conversions' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'messages', label: 'Messages' },
    { value: 'leads', label: 'Leads' },
    { value: 'awareness', label: 'Awareness' },
    { value: 'engagement', label: 'Engagement' },
    { value: 'video_views', label: 'Video views' },
    { value: 'reach', label: 'Reach' },
] as const;

export const DEFAULT_CTA_LABELS = [
    'Shop Now',
    'Order Now',
    'Learn More',
    'Sign Up',
    'Contact Us',
    'Send Message',
    'Get Offer',
    'Download',
] as const;

export type CampaignMedia = {
    url: string;
    path: string;
    type: 'image' | 'video';
    name?: string;
};

export type CampaignDailyEntry = {
    id: string;
    campaign_id: string | null; // nullable — entry survives campaign deletion
    'DigiCom Business': string;
    entry_date: string; // YYYY-MM-DD
    spend: number;
    leads: number;
    notes: string | null;
    platform: string; // denormalized from campaigns on insert/update via trigger
    created_by: string | null; // denormalized from campaigns.created_by
    created_at: string;
    updated_at: string;
};

export type Campaign = {
    id: string;
    'DigiCom Business': string;
    created_by: string | null;
    name: string;
    status: 'active' | 'draft';
    platform: string;
    objective: string | null;
    spending_type: 'ongoing' | 'date_limited';
    daily_budget: number | null;
    total_budget: number | null;
    start_date: string | null;
    end_date: string | null;
    campaign_type: CampaignType;
    media: CampaignMedia[];
    conversion_type: ConversionType;
    conversion_content: string | null;
    primary_text: string | null;
    headline: string | null;
    cta_label: string | null;
    audience: Record<string, unknown>;
    pixel_id: string | null;
    notes: string | null;
    currency: string;
    created_at: string;
    updated_at: string;
};

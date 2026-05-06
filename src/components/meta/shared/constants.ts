import {
    DollarSign,
    Globe2,
    Megaphone,
    Smartphone,
    Target,
    Users,
    type LucideIcon,
} from 'lucide-react';

export type Objective = {
    value: string;
    label: string;
    desc: string;
    icon: LucideIcon;
    color: string;
};

export const OBJECTIVES: Objective[] = [
    { value: 'OUTCOME_SALES', label: 'Sales', desc: 'Find people likely to purchase your product or service.', icon: DollarSign, color: '#10b981' },
    { value: 'OUTCOME_LEADS', label: 'Leads', desc: 'Collect leads for your business through messages, phone calls, or signups.', icon: Users, color: '#3b82f6' },
    { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', desc: 'Get more messages, purchases through messaging, video views, post engagement, Page likes, or event responses.', icon: Megaphone, color: '#8b5cf6' },
    { value: 'OUTCOME_AWARENESS', label: 'Awareness', desc: 'Show your ads to people who are most likely to remember them.', icon: Target, color: '#f59e0b' },
    { value: 'OUTCOME_TRAFFIC', label: 'Traffic', desc: 'Send people to a destination, such as your website, app, or Facebook event.', icon: Globe2, color: '#0ea5e9' },
    { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion', desc: 'Find new people to install your app and continue using it.', icon: Smartphone, color: '#ef4444' },
];

export const SPECIAL_AD_CATEGORIES = [
    { value: 'FINANCIAL_PRODUCTS_AND_SERVICES', label: 'Financial products & services' },
    { value: 'EMPLOYMENT', label: 'Employment' },
    { value: 'HOUSING', label: 'Housing' },
    { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Social issues, elections or politics' },
];

export const CONVERSION_LOCATIONS = [
    { value: 'WEBSITE', label: 'Website', desc: 'Send traffic to your website' },
    { value: 'APP', label: 'App', desc: 'Get app installs and engagement' },
    { value: 'MESSENGER', label: 'Messenger', desc: 'Start conversations in Messenger' },
    { value: 'INSTAGRAM', label: 'Instagram', desc: 'Get engagement on Instagram' },
    { value: 'ON_AD', label: 'On ad', desc: 'Collect leads directly on the ad' },
    { value: 'CALLS', label: 'Calls', desc: 'Get people to call your business' },
];

export const OPTIMIZATION_GOALS = [
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversions', desc: 'Optimise for people most likely to take a specific action on your website.' },
    { value: 'VALUE', label: 'Value', desc: 'Optimise for the highest purchase value.' },
    { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views', desc: 'Show ads to people most likely to view your landing page.' },
    { value: 'LINK_CLICKS', label: 'Link clicks', desc: 'Show ads to people most likely to click the link.' },
    { value: 'IMPRESSIONS', label: 'Impressions', desc: 'Show your ads to people as many times as possible.' },
    { value: 'REACH', label: 'Daily unique reach', desc: 'Show ads to the maximum number of unique people each day.' },
    { value: 'LEAD_GENERATION', label: 'Leads', desc: 'Get the most leads at the lowest cost.' },
    { value: 'ENGAGED_USERS', label: 'Engaged users', desc: 'Show ads to people most likely to engage with your content.' },
];

export const BILLING_EVENTS = [
    { value: 'IMPRESSIONS', label: 'Impression', desc: 'Pay each time your ad is shown (CPM)' },
    { value: 'LINK_CLICKS', label: 'Link click', desc: 'Pay each time someone clicks (CPC)' },
    { value: 'THRUPLAY', label: 'ThruPlay', desc: 'Pay for video views of 15 seconds or more' },
];

export const BID_STRATEGIES = [
    { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume', desc: 'Get the most results for your budget.' },
    { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap', desc: 'Set the maximum you want to bid in any auction.' },
    { value: 'COST_CAP', label: 'Cost per result goal', desc: 'Get the most results while keeping costs around a set amount.' },
    { value: 'MINIMUM_ROAS', label: 'ROAS goal', desc: 'Set a minimum return on ad spend target.' },
];

export const FACEBOOK_POSITIONS = [
    { value: 'feed', label: 'Facebook Feed' },
    { value: 'right_hand_column', label: 'Right column' },
    { value: 'marketplace', label: 'Facebook Marketplace' },
    { value: 'video_feeds', label: 'Facebook video feeds' },
    { value: 'story', label: 'Facebook Stories' },
    { value: 'reels', label: 'Facebook Reels' },
    { value: 'instream_video', label: 'In-stream videos' },
    { value: 'search', label: 'Search results' },
];

export const INSTAGRAM_POSITIONS = [
    { value: 'stream', label: 'Instagram Feed' },
    { value: 'story', label: 'Instagram Stories' },
    { value: 'reels', label: 'Instagram Reels' },
    { value: 'explore', label: 'Explore' },
    { value: 'explore_home', label: 'Explore home' },
    { value: 'profile_feed', label: 'Profile feed' },
    { value: 'shop', label: 'Instagram Shop' },
];

export const AUDIENCE_NETWORK_POSITIONS = [
    { value: 'classic', label: 'Native, banner and interstitial' },
    { value: 'rewarded_video', label: 'Rewarded videos' },
];

export const MESSENGER_POSITIONS = [
    { value: 'messenger_home', label: 'Messenger inbox' },
    { value: 'story', label: 'Messenger Stories' },
    { value: 'sponsored_messages', label: 'Sponsored messages' },
];

export const CTA_OPTIONS = [
    { value: 'LEARN_MORE', label: 'Learn more' },
    { value: 'SHOP_NOW', label: 'Shop now' },
    { value: 'SIGN_UP', label: 'Sign up' },
    { value: 'SUBSCRIBE', label: 'Subscribe' },
    { value: 'CONTACT_US', label: 'Contact us' },
    { value: 'ORDER_NOW', label: 'Order now' },
    { value: 'BOOK_NOW', label: 'Book now' },
    { value: 'DOWNLOAD', label: 'Download' },
    { value: 'APPLY_NOW', label: 'Apply now' },
    { value: 'GET_QUOTE', label: 'Get quote' },
    { value: 'WATCH_MORE', label: 'Watch more' },
    { value: 'SEND_MESSAGE', label: 'Send message' },
    { value: 'WHATSAPP_MESSAGE', label: 'Send WhatsApp message' },
    { value: 'CALL_NOW', label: 'Call now' },
    { value: 'NO_BUTTON', label: 'No button' },
];

export const AD_FORMATS = [
    { value: 'single_image', label: 'Single image or video', desc: 'One image or video, or a slideshow with multiple images.', icon: 'image' as const },
    { value: 'carousel', label: 'Carousel', desc: 'Two or more scrollable images or videos.', icon: 'layers' as const },
    { value: 'collection', label: 'Collection', desc: 'A group of items that opens into a full-screen mobile experience.', icon: 'grid' as const },
];

// ── Types shared across steps ──────────────────────────────────────────
export type CampaignData = {
    name: string;
    objective: string;
    buying_type: 'AUCTION' | 'RESERVED';
    special_ad_categories: string[];
    cbo: boolean;
    budget_type: 'daily' | 'lifetime';
    daily_budget: string;
    lifetime_budget: string;
    spending_limit: string;
};

export type AdSetData = {
    name: string;
    conversion_location: string;
    optimization_goal: string;
    billing_event: string;
    bid_strategy: string;
    bid_amount: string;
    budget_type: 'daily' | 'lifetime';
    daily_budget: string;
    lifetime_budget: string;
    start_date: string;
    end_date: string;
    advantage_audience: boolean;
    countries: string[];
    age_min: number;
    age_max: number;
    gender: 'all' | 'male' | 'female';
    interests: string[];
    languages: string;
    advantage_placements: boolean;
    facebook_positions: string[];
    instagram_positions: string[];
    audience_network_positions: string[];
    messenger_positions: string[];
};

export type AdData = {
    name: string;
    page_id: string;
    instagram_account_id: string;
    format: 'single_image' | 'carousel' | 'collection';
    image_url: string;
    primary_texts: string[];
    headlines: string[];
    descriptions: string[];
    display_link: string;
    website_url: string;
    cta: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string;
    utm_term: string;
};

export const DEFAULT_CAMPAIGN: CampaignData = {
    name: '',
    objective: 'OUTCOME_SALES',
    buying_type: 'AUCTION',
    special_ad_categories: [],
    cbo: false,
    budget_type: 'daily',
    daily_budget: '',
    lifetime_budget: '',
    spending_limit: '',
};

export const DEFAULT_ADSET: AdSetData = {
    name: '',
    conversion_location: 'WEBSITE',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    bid_amount: '',
    budget_type: 'daily',
    daily_budget: '20',
    lifetime_budget: '',
    start_date: '',
    end_date: '',
    advantage_audience: true,
    countries: ['MA'],
    age_min: 18,
    age_max: 65,
    gender: 'all',
    interests: [],
    languages: '',
    advantage_placements: true,
    facebook_positions: ['feed', 'story', 'reels', 'video_feeds', 'marketplace', 'right_hand_column', 'instream_video', 'search'],
    instagram_positions: ['stream', 'story', 'reels', 'explore', 'explore_home', 'profile_feed'],
    audience_network_positions: ['classic', 'rewarded_video'],
    messenger_positions: ['messenger_home', 'story'],
};

export const LANGUAGES = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
    { value: 'ar', label: 'Arabic' },
    { value: 'es', label: 'Spanish' },
    { value: 'de', label: 'German' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'it', label: 'Italian' },
    { value: 'nl', label: 'Dutch' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'zh', label: 'Chinese' },
    { value: 'ru', label: 'Russian' },
    { value: 'tr', label: 'Turkish' },
    { value: 'pl', label: 'Polish' },
    { value: 'hi', label: 'Hindi' },
];

export const DEFAULT_AD: AdData = {
    name: '',
    page_id: '',
    instagram_account_id: '',
    format: 'single_image',
    image_url: '',
    primary_texts: [''],
    headlines: [''],
    descriptions: [''],
    display_link: '',
    website_url: '',
    cta: 'LEARN_MORE',
    utm_source: 'facebook',
    utm_medium: 'paid',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
};

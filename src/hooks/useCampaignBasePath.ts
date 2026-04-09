import { useLocation } from 'react-router-dom';

/**
 * Returns the current campaigns base path. Campaigns pages are mounted under two roots:
 *   - `/mediabuyer/campaigns` for the mediabuyer role
 *   - `/campaigns`            for admin / super admin
 *
 * Components use this helper instead of hard-coding paths so they work under both mount points.
 */
export function useCampaignBasePath(): string {
    const loc = useLocation();
    return loc.pathname.startsWith('/mediabuyer') ? '/mediabuyer/campaigns' : '/campaigns';
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Returns the authenticated auth.users.id of the current session.
 * Cached across the app — does not re-fetch on remount.
 */
export function useCurrentUserId(): string | null {
    const { data } = useQuery({
        queryKey: ['current-user-id'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            return user?.id ?? null;
        },
        staleTime: Infinity,
    });
    return data ?? null;
}

import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { FullscreenLoader } from '@/components/ui/fullscreen-loader';
import { AnnouncementGate } from '@/components/announcements/AnnouncementGate';
import { LogOut, ShieldOff } from 'lucide-react';
import { firstAllowedPath, isPageAllowed, type PagePermissionMap } from '@/lib/permissions';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles?: string[];
}

/** Terminal state for an admin whose permission map denies every registry page. */
const NoAllowedPages = () => {
    const navigate = useNavigate();
    // Same sign-out sequence the app uses for a blocked account (stale business id must go too).
    const logout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };
    return (
        <div className="min-h-screen w-full bg-ant-light flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border border-ant-line bg-ant-paper px-6 py-7 text-center shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
                <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center mx-auto">
                    <ShieldOff className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-4">
                    Aucune page autorisée
                </p>
                <p className="text-[12.5px] text-ant-mid leading-snug mt-2">
                    Contactez votre administrateur pour obtenir l&rsquo;accès.
                </p>
                <button
                    type="button"
                    onClick={logout}
                    className="mt-6 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-ant-ink text-white text-[12px] font-semibold hover:bg-ant-ink/90 transition-colors duration-200 motion-reduce:transition-none cursor-pointer"
                >
                    <LogOut className="w-3.5 h-3.5" />
                    Se déconnecter
                </button>
            </div>
        </div>
    );
};

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
    const [loading, setLoading] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    // Page permissions are resolved from the SAME profile fetch as the role — no extra query.
    const [role, setRole] = useState<string | null>(null);
    const [pageMap, setPageMap] = useState<PagePermissionMap>(undefined);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                navigate('/auth');
                setLoading(false);
                return;
            }

            // Always fetch the user profile to check active status
            const { data: userProfile, error } = await supabase
                .from('users')
                .select('role, active, permissions')
                .eq('id', session.user.id)
                .single();

            if (error || !userProfile) {
                console.error("Error fetching user profile or profile not found:", error);
                navigate('/auth');
                setLoading(false);
                return;
            }

            // Block disabled accounts: sign them out immediately
            if (userProfile.active === false) {
                await supabase.auth.signOut();
                localStorage.removeItem('activeBusinessId');
                navigate('/auth');
                setLoading(false);
                return;
            }

            if (allowedRoles && allowedRoles.length > 0) {
                if (!allowedRoles.includes(userProfile.role)) {
                    if (userProfile.role === 'commercial') {
                        navigate('/seller/dashboard');
                    } else if (userProfile.role === 'owner') {
                        navigate('/owner/dashboard');
                    } else if (userProfile.role === 'courier') {
                        navigate('/courier/dashboard');
                    } else if (userProfile.role === 'mediabuyer') {
                        navigate('/mediabuyer/dashboard');
                    } else {
                        navigate('/');
                    }
                    return;
                }
            }

            setRole(userProfile.role ?? null);
            setPageMap((userProfile as { permissions?: { pages?: Record<string, boolean> | null } | null })
                .permissions?.pages ?? undefined);
            setAuthenticated(true);
            setLoading(false);
        };

        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                navigate('/auth');
            } else if (session) {
                // We might want to re-check role here if session changes, but for now basic auth check
                setAuthenticated(true);
            }
        });

        return () => subscription.unsubscribe();
    }, [navigate, allowedRoles]);

    if (loading) {
        return <FullscreenLoader sublabel="Nous vérifions vos autorisations." />;
    }

    if (!authenticated) return null;

    // Page gate — role 'admin' ONLY. Every other role passes through untouched.
    if (role === 'admin' && !isPageAllowed(location.pathname, pageMap)) {
        const landing = firstAllowedPath(pageMap);
        if (!landing) return <NoAllowedPages />;
        return <Navigate to={landing} replace />;
    }

    return (
        <>
            {children}
            <AnnouncementGate />
        </>
    );
};

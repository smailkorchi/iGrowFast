import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/auditLog';
import { FullscreenLoader } from '@/components/ui/fullscreen-loader';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles?: string[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
    const [loading, setLoading] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
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
                .select('role, active')
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
                void logAction({
                    action: 'forbidden',
                    metadata: { reason: 'account_disabled', path: location.pathname },
                });
                await supabase.auth.signOut();
                localStorage.removeItem('activeBusinessId');
                navigate('/auth');
                setLoading(false);
                return;
            }

            if (allowedRoles && allowedRoles.length > 0) {
                if (!allowedRoles.includes(userProfile.role)) {
                    void logAction({
                        action: 'access_denied',
                        metadata: {
                            reason: 'role_mismatch',
                            path: location.pathname,
                            required_roles: allowedRoles,
                            actor_role: userProfile.role,
                        },
                    });
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

            setAuthenticated(true);
            setLoading(false);
        };

        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                void logAction({ action: 'logout' });
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

    return authenticated ? <>{children}</> : null;
};

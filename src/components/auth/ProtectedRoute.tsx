import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

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
                await supabase.auth.signOut();
                localStorage.removeItem('activeBusinessId');
                navigate('/auth');
                setLoading(false);
                return;
            }

            if (allowedRoles && allowedRoles.length > 0) {
                if (!allowedRoles.includes(userProfile.role)) {
                    if (userProfile.role === 'seller' || userProfile.role === 'commercial') {
                        navigate('/seller/dashboard');
                    } else if (userProfile.role === 'owner') {
                        navigate('/owner/businesses');
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
                navigate('/auth');
            } else if (session) {
                // We might want to re-check role here if session changes, but for now basic auth check
                setAuthenticated(true);
            }
        });

        return () => subscription.unsubscribe();
    }, [navigate, allowedRoles]);

    if (loading) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center bg-brand-white">
                <Loader2 className="w-12 h-12 text-brand-navy animate-spin" />
            </div>
        );
    }

    return authenticated ? <>{children}</> : null;
};

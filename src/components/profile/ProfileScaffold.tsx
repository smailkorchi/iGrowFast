import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/users/UserAvatar';
import { AvatarEditDialog } from '@/components/profile/AvatarEditDialog';
import { SecuritySection } from '@/components/profile/SecuritySection';
import { saveOwnBasicInfo } from '@/lib/profile';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Mail, Pen, Check, X, Loader2, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';

/** Standardized self-profile: editable avatar + identity + Security (OTP change + 2FA). */
export function ProfileScaffold({ roleLabel, extra, securityChapter }: { roleLabel: string; extra?: (profile: any) => React.ReactNode; securityChapter?: string }) {
    const { toast } = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ name: '', username: '', phone: '' });

    const { data: profile, isLoading } = useQuery({
        queryKey: ['profile-self'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
            return data as any;
        },
    });

    useEffect(() => {
        if (profile && !editing) setForm({ name: profile.name || '', username: profile.username || '', phone: profile.phone || '' });
    }, [profile, editing]);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['profile-self'] });

    const save = async () => {
        setSaving(true);
        try { await saveOwnBasicInfo(form); invalidate(); setEditing(false); toast({ title: 'Profil mis à jour' }); }
        catch (e) { toast({ title: 'Erreur', description: (e as Error).message, variant: 'destructive' }); }
        finally { setSaving(false); }
    };
    const logout = async () => { await supabase.auth.signOut(); localStorage.removeItem('activeBusinessId'); navigate('/auth'); };

    if (isLoading) return <div className="ant-surface min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-ant-mid" /></div>;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="flex items-end justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Compte · Profil
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">Mon profil</h1>
                    </div>
                    <button onClick={logout} className="h-10 px-4 rounded-full border border-ant-line text-[12px] font-semibold text-ant-rose hover:bg-ant-rose/5 inline-flex items-center gap-2 cursor-pointer">
                        <LogOut className="w-4 h-4" /> Déconnexion
                    </button>
                </header>

                {/* Hero */}
                <section className="rounded-2xl border border-ant-ink bg-ant-ink overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-6 md:p-8 flex items-center gap-5">
                        <button type="button" onClick={() => setAvatarOpen(true)} title="Modifier l'avatar"
                            className="relative h-20 w-20 md:h-24 md:w-24 rounded-2xl overflow-hidden border-2 border-white/10 shrink-0 group cursor-pointer">
                            <UserAvatar url={profile?.avatar_url} config={profile?.avatar_config} name={profile?.name} className="w-full h-full text-[24px]" />
                            <span className="absolute inset-0 bg-ant-ink/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold uppercase tracking-[0.18em] text-white">Modifier</span>
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-orange/90">{roleLabel}</div>
                            <h2 className="font-display text-[24px] md:text-[28px] font-semibold text-white truncate">{profile?.name || '—'}</h2>
                            <div className="flex items-center gap-3 flex-wrap text-[12px] text-white/55 mt-1">
                                {profile?.username && <span>@{profile.username}</span>}
                                {profile?.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> {profile.email}</span>}
                            </div>
                        </div>
                    </div>
                </section>

                {/* 01 Identité */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[2px] w-full bg-ant-orange/70" />
                    <div className="px-5 md:px-6 pt-5 pb-3 flex items-center justify-between">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                            <span className="font-display text-ant-orange font-semibold">01</span> Identité
                        </div>
                        {!editing ? (
                            <button onClick={() => setEditing(true)} className="h-9 px-4 rounded-full border border-ant-line text-[12px] font-semibold text-ant-ink inline-flex items-center gap-1.5 cursor-pointer hover:bg-ant-light">
                                <Pen className="w-3.5 h-3.5 text-ant-orange" /> Modifier
                            </button>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setEditing(false)} className="h-9 px-3 rounded-full border border-ant-line text-[12px] font-semibold text-ant-mid inline-flex items-center gap-1.5 cursor-pointer"><X className="w-3.5 h-3.5" /> Annuler</button>
                                <button onClick={save} disabled={saving} className="h-9 px-4 rounded-full bg-ant-ink text-white text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Enregistrer
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="px-5 md:px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className={labelCls}>Nom complet</label>
                            {editing ? <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl border-ant-line bg-ant-paper text-[13px]" />
                                : <p className="font-display text-[14px] font-semibold text-ant-ink">{profile?.name || '—'}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <label className={labelCls}>Identifiant</label>
                            {editing ? <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="h-11 rounded-xl border-ant-line bg-ant-paper text-[13px]" />
                                : <p className="font-display text-[14px] font-semibold text-ant-ink">@{profile?.username || '—'}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <label className={labelCls}>Téléphone</label>
                            {editing ? <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11 rounded-xl border-ant-line bg-ant-paper text-[13px]" />
                                : <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">{profile?.phone || <span className="font-serif italic font-normal text-ant-mid">Non renseigné</span>}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <label className={cn(labelCls, 'inline-flex items-center gap-1.5')}>E-mail <span className="text-[8px] text-ant-mid/70">(verrouillé)</span></label>
                            <p className="font-display text-[14px] font-semibold text-ant-ink truncate">{profile?.email || '—'}</p>
                        </div>
                    </div>
                </section>

                {extra ? extra(profile) : null}

                <SecuritySection email={profile?.email} chapter={securityChapter ?? (extra ? '03' : '02')} />
            </div>

            <AvatarEditDialog isOpen={avatarOpen} onClose={() => setAvatarOpen(false)} onSaved={invalidate} seed={profile?.email} />
        </div>
    );
}

export default ProfileScaffold;

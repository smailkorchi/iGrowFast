import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    User, Mail, Phone, AtSign, Lock, Building2,
    Camera, Loader2, CheckCircle2, AlertCircle, Pen, ChevronRight, KeyRound, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

const Profile = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

    const [passwordData, setPasswordData] = useState({ new_password: '', confirm: '' });
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    const { data: profile, isLoading } = useQuery({
        queryKey: ['current-profile'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();
            if (error) return null;
            return data as any;
        }
    });

    const { data: business } = useQuery({
        queryKey: ['profile-business', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data, error } = await supabase
                .from('businesses')
                .select('*')
                .eq('id', activeBusinessId)
                .single();
            if (error) return null;
            return data as any;
        },
        enabled: !!activeBusinessId,
    });

    React.useEffect(() => {
        if (profile && !isEditing) {
            setFormData({
                name: profile.name || '',
                username: profile.username || '',
                email: profile.email || '',
                phone: profile.phone || '',
            });
            setAvatarPreview(profile.avatar_url || null);
        }
    }, [profile, isEditing]);

    const onDrop = useCallback((files: File[]) => {
        const file = files[0];
        if (!file) return;
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        multiple: false,
        noClick: !isEditing,
        noDrag: !isEditing,
    });

    const updateMutation = useMutation({
        mutationFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            let avatar_url = profile?.avatar_url;

            if (avatarFile) {
                const ext = avatarFile.name.split('.').pop();
                const path = `avatars/${user.id}.${ext}`;
                const { error: uploadErr } = await supabase.storage
                    .from('providers-logos')
                    .upload(path, avatarFile, { upsert: true });
                if (!uploadErr) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('providers-logos')
                        .getPublicUrl(path);
                    avatar_url = publicUrl;
                }
            }

            const { error } = await supabase
                .from('users')
                .update({
                    name: formData.name,
                    username: formData.username,
                    phone: formData.phone,
                    avatar_url,
                } as any)
                .eq('id', user.id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['current-profile'] });
            setIsEditing(false);
            setAvatarFile(null);
            toast({ title: 'Profil mis à jour', description: 'Vos modifications ont été enregistrées.' });
        },
        onError: (err: any) => {
            toast({ title: 'Échec de la mise à jour', description: err.message, variant: 'destructive' });
        },
    });

    const passwordMutation = useMutation({
        mutationFn: async () => {
            if (passwordData.new_password !== passwordData.confirm) throw new Error('Les mots de passe ne correspondent pas');
            if (passwordData.new_password.length < 6) throw new Error('Le mot de passe doit contenir au moins 6 caractères');
            const { error } = await supabase.auth.updateUser({ password: passwordData.new_password });
            if (error) throw error;
        },
        onSuccess: () => {
            setPasswordData({ new_password: '', confirm: '' });
            setIsChangingPassword(false);
            toast({ title: 'Mot de passe modifié', description: 'Votre mot de passe a été mis à jour.' });
        },
        onError: (err: any) => {
            toast({ title: 'Échec', description: err.message, variant: 'destructive' });
        },
    });

    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setFormData(prev => ({ ...prev, [key]: e.target.value }));

    if (isLoading) {
        return (
            <div className="ant-surface min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-ant-mid" strokeWidth={1.5} />
            </div>
        );
    }

    const initials = (profile?.name || 'U').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
    const roleLabel = profile?.role || 'Admin';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Compte · Profil
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Profil
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Votre fiche personnelle — nom, contact, mot de passe. Ce que les autres voient, ce qui vous identifie, ce qui protège l&apos;accès.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (isEditing) { setIsEditing(false); setAvatarFile(null); }
                            else setIsEditing(true);
                        }}
                        className={cn(
                            'inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12px] font-semibold cursor-pointer shrink-0 transition-colors',
                            isEditing
                                ? 'border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink'
                                : 'bg-ant-ink hover:bg-ant-ink/90 text-white'
                        )}
                    >
                        {isEditing ? (
                            <>
                                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                                Annuler
                            </>
                        ) : (
                            <>
                                <Pen className="w-3.5 h-3.5" strokeWidth={1.75} />
                                Modifier le profil
                            </>
                        )}
                    </button>
                </header>

                {/* Hero Identity Card */}
                <section className="rounded-2xl border border-ant-ink bg-ant-ink overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6">
                        <div
                            {...getRootProps()}
                            className={cn(
                                'relative h-20 w-20 md:h-24 md:w-24 rounded-2xl overflow-hidden border-2 border-white/10 shrink-0',
                                isEditing && 'cursor-pointer group ring-2 ring-ant-orange/40'
                            )}
                        >
                            <input {...getInputProps()} />
                            {avatarPreview ? (
                                <img src={avatarPreview} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-white/5">
                                    <span className="font-display text-[24px] font-semibold text-white/70">{initials}</span>
                                </div>
                            )}
                            {isEditing && (
                                <div className="absolute inset-0 bg-ant-ink/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera className="w-5 h-5 text-white" strokeWidth={1.75} />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                {roleLabel}
                            </div>
                            <h2 className="font-display text-[24px] md:text-[28px] font-semibold text-white leading-tight truncate">
                                {profile?.name || 'Utilisateur'}
                            </h2>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-serif italic text-[12px] text-white/60">
                                <span className="inline-flex items-center gap-1.5">
                                    <AtSign className="w-3 h-3" strokeWidth={1.75} />
                                    {profile?.username || 'sans pseudo'}
                                </span>
                                {profile?.email && (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="w-3 h-3" strokeWidth={1.75} />
                                        {profile.email}
                                    </span>
                                )}
                                {profile?.phone && (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Phone className="w-3 h-3" strokeWidth={1.75} />
                                        {profile.phone}
                                    </span>
                                )}
                            </div>
                        </div>

                        {business && (
                            <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3 max-w-[260px]">
                                <div className="h-9 w-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 p-1">
                                    {business.logo ? (
                                        <img src={business.logo} alt="" className="max-w-full max-h-full object-contain" />
                                    ) : (
                                        <Building2 className="w-4 h-4 text-white/50" strokeWidth={1.75} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/50">Entreprise active</p>
                                    <p className="font-display text-[13px] font-semibold text-white truncate">{business.name}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className={cn('h-1.5 w-1.5 rounded-full', business.active ? 'bg-ant-green' : 'bg-white/40')} />
                                        <span className="font-serif italic text-[10px] text-white/60">
                                            {business.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Personal Information */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">01</span>
                                Identité personnelle
                            </div>
                            <span className="font-serif italic text-[11px] text-ant-mid">
                                {isEditing ? 'Modification en cours' : 'Lecture seule'}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                            <FieldCell
                                icon={User}
                                label="Nom complet"
                                value={formData.name}
                                onChange={set('name')}
                                editing={isEditing}
                                placeholder="Votre nom"
                            />
                            <FieldCell
                                icon={AtSign}
                                label="Pseudo"
                                value={formData.username}
                                onChange={set('username')}
                                editing={isEditing}
                                placeholder="identifiant"
                            />
                            <FieldCell
                                icon={Mail}
                                label="Email"
                                value={formData.email}
                                editing={false}
                                locked
                            />
                            <FieldCell
                                icon={Phone}
                                label="Téléphone"
                                value={formData.phone}
                                onChange={set('phone')}
                                editing={isEditing}
                                placeholder="Ajouter un numéro"
                            />
                        </div>

                        {isEditing && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-ant-line">
                                <p className="font-serif italic text-[11px] text-ant-mid">
                                    Glissez une image sur l&apos;avatar pour la remplacer.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => updateMutation.mutate()}
                                    disabled={updateMutation.isPending}
                                    className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                >
                                    {updateMutation.isPending ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                                    ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    )}
                                    Enregistrer les modifications
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                {/* Security */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-rose" />
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">02</span>
                                Sécurité
                            </div>
                            <KeyRound className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        </div>

                        {isChangingPassword ? (
                            <div className="space-y-3 max-w-md">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Nouveau mot de passe</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                        <Input
                                            type="password"
                                            placeholder="Au moins 6 caractères"
                                            value={passwordData.new_password}
                                            onChange={e => setPasswordData(p => ({ ...p, new_password: e.target.value }))}
                                            className="h-10 pl-9 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Confirmation</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                        <Input
                                            type="password"
                                            placeholder="Retapez le mot de passe"
                                            value={passwordData.confirm}
                                            onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))}
                                            className="h-10 pl-9 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                        />
                                    </div>
                                </div>
                                {passwordData.new_password && passwordData.confirm && passwordData.new_password !== passwordData.confirm && (
                                    <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                        <AlertCircle className="w-3 h-3" strokeWidth={1.75} />
                                        Les mots de passe ne correspondent pas
                                    </div>
                                )}
                                <div className="flex gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => { setIsChangingPassword(false); setPasswordData({ new_password: '', confirm: '' }); }}
                                        className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => passwordMutation.mutate()}
                                        disabled={passwordMutation.isPending || !passwordData.new_password || passwordData.new_password !== passwordData.confirm}
                                        className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[11px] font-semibold cursor-pointer transition-colors"
                                    >
                                        {passwordMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />}
                                        Mettre à jour le mot de passe
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsChangingPassword(true)}
                                className="group w-full md:w-auto inline-flex items-center gap-3 rounded-xl border border-ant-line bg-ant-light hover:bg-ant-paper hover:border-ant-ink/20 px-4 py-3 text-left cursor-pointer transition-colors"
                            >
                                <div className="h-10 w-10 rounded-xl border border-ant-ink/15 bg-ant-ink/6 text-ant-ink flex items-center justify-center shrink-0">
                                    <Lock className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-display text-[13px] font-semibold text-ant-ink">Changer le mot de passe</p>
                                    <p className="font-serif italic text-[11px] text-ant-mid">Rotation recommandée tous les 90 jours.</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-ant-mid group-hover:text-ant-ink transition-colors shrink-0" strokeWidth={1.75} />
                            </button>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

function FieldCell({ icon: Icon, label, value, onChange, editing, locked, placeholder }: {
    icon: any;
    label: string;
    value: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    editing: boolean;
    locked?: boolean;
    placeholder?: string;
}) {
    return (
        <div className="bg-ant-paper p-4 flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg border border-ant-line bg-ant-light text-ant-mid flex items-center justify-center shrink-0 mt-px">
                <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">{label}</p>
                    {locked && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid">
                            <Lock className="w-2.5 h-2.5" strokeWidth={1.75} />
                            Verrouillé
                        </span>
                    )}
                </div>
                {editing && !locked ? (
                    <Input
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder || label}
                        className="h-9 rounded-lg border-ant-line bg-ant-light text-[13px] font-medium text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40 placeholder:font-serif placeholder:italic placeholder:text-ant-mid"
                    />
                ) : (
                    <p className={cn(
                        'font-display text-[14px] font-semibold truncate leading-snug',
                        value ? 'text-ant-ink' : 'font-serif italic font-normal text-ant-mid'
                    )}>
                        {value || placeholder || 'Non renseigné'}
                    </p>
                )}
            </div>
        </div>
    );
}

export default Profile;

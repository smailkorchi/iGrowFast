import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    User, Mail, Phone, AtSign, Shield, Lock, Building2,
    Camera, Loader2, CheckCircle2, AlertCircle, Pen
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
            toast({ title: 'Profile updated', description: 'Your changes have been saved.' });
        },
        onError: (err: any) => {
            toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
        },
    });

    const passwordMutation = useMutation({
        mutationFn: async () => {
            if (passwordData.new_password !== passwordData.confirm) throw new Error('Passwords do not match');
            if (passwordData.new_password.length < 6) throw new Error('Password must be at least 6 characters');
            const { error } = await supabase.auth.updateUser({ password: passwordData.new_password });
            if (error) throw error;
        },
        onSuccess: () => {
            setPasswordData({ new_password: '', confirm: '' });
            setIsChangingPassword(false);
            toast({ title: 'Password changed', description: 'Your password has been updated.' });
        },
        onError: (err: any) => {
            toast({ title: 'Password change failed', description: err.message, variant: 'destructive' });
        },
    });

    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setFormData(prev => ({ ...prev, [key]: e.target.value }));

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/20" />
            </div>
        );
    }

    const initials = (profile?.name || 'U').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

    return (
        <div className="max-w-xl mx-auto animate-in fade-in duration-500 py-6 pb-16">
            <div className="bg-white rounded-[36px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.06)] overflow-hidden">

                {/* ── Hero + Avatar ── */}
                <div className="relative">
                    <div className="h-40 bg-brand-navy relative overflow-hidden">
                        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />

                        {/* Edit toggle */}
                        <button
                            onClick={() => {
                                if (isEditing) { setIsEditing(false); setAvatarFile(null); }
                                else setIsEditing(true);
                            }}
                            className={cn(
                                "absolute top-4 right-4 z-20 h-9 px-4 rounded-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest transition-all duration-300",
                                isEditing
                                    ? "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm"
                                    : "bg-white/10 text-white/70 hover:text-white hover:bg-white/20 backdrop-blur-sm"
                            )}
                        >
                            <Pen className="w-3 h-3" />
                            <span>{isEditing ? 'Cancel' : 'Edit'}</span>
                        </button>
                    </div>

                    {/* Centered avatar */}
                    <div className="flex justify-center -mt-14 relative z-10">
                        <div
                            {...getRootProps()}
                            className={cn(
                                "relative w-28 h-28 rounded-full overflow-hidden border-[5px] border-white shadow-lg",
                                isEditing && "cursor-pointer group ring-4 ring-brand-navy/10"
                            )}
                        >
                            <input {...getInputProps()} />
                            {avatarPreview ? (
                                <img src={avatarPreview} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-navy/[0.08] to-brand-navy/[0.03]">
                                    <span className="text-2xl font-black text-brand-navy/25">{initials}</span>
                                </div>
                            )}
                            {isEditing && (
                                <div className="absolute inset-0 bg-brand-navy/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-[2px]">
                                    <Camera className="w-5 h-5 text-white" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Identity ── */}
                <div className="text-center pt-4 pb-2 px-8">
                    <h1 className="text-[22px] font-black text-brand-navy tracking-tight">{profile?.name}</h1>
                    <div className="flex items-center justify-center gap-2.5 mt-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white bg-brand-navy px-3 py-1 rounded-full">
                            {profile?.role || 'Admin'}
                        </span>
                        <span className="text-[13px] text-slate-400 font-medium">@{profile?.username}</span>
                    </div>
                </div>

                {/* ── Business strip ── */}
                {business && (
                    <div className="mx-8 mt-4 mb-2 flex items-center gap-3.5 px-4 py-3 rounded-2xl bg-slate-50/80 border border-slate-100/80">
                        <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center overflow-hidden shrink-0 p-1.5 shadow-sm">
                            {business.logo ? (
                                <img src={business.logo} alt="" className="max-w-full max-h-full object-contain" />
                            ) : (
                                <Building2 className="w-4 h-4 text-brand-navy/15" />
                            )}
                        </div>
                        <span className="text-[13px] font-bold text-brand-navy truncate flex-1">{business.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <div className={cn("w-[6px] h-[6px] rounded-full", business.active ? "bg-emerald-500" : "bg-slate-300")} />
                            <span className={cn("text-[10px] font-black uppercase tracking-widest", business.active ? "text-emerald-600" : "text-slate-400")}>
                                {business.active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    </div>
                )}

                {/* ── Fields ── */}
                <div className="px-8 pt-6 pb-2">
                    <FieldRow icon={User} label="Full Name" value={formData.name} onChange={set('name')} editing={isEditing} />
                    <FieldRow icon={AtSign} label="Username" value={formData.username} onChange={set('username')} editing={isEditing} />
                    <FieldRow icon={Mail} label="Email" value={formData.email} editing={false} locked />
                    <FieldRow icon={Phone} label="Phone" value={formData.phone} onChange={set('phone')} editing={isEditing} placeholder="Add phone number" last />
                </div>

                {/* ── Save ── */}
                {isEditing && (
                    <div className="px-8 pb-6 pt-2">
                        <Button
                            onClick={() => updateMutation.mutate()}
                            disabled={updateMutation.isPending}
                            className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-[52px] text-sm font-black shadow-lg shadow-brand-navy/10 transition-all active:scale-[0.98]"
                        >
                            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                            Save Changes
                        </Button>
                    </div>
                )}

                {/* ── Divider ── */}
                <div className="mx-8 h-px bg-slate-100" />

                {/* ── Security ── */}
                <div className="px-8 py-6">
                    {isChangingPassword ? (
                        <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-brand-navy/30 mb-4">Change Password</p>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/20" />
                                <Input
                                    type="password" placeholder="New password"
                                    value={passwordData.new_password}
                                    onChange={e => setPasswordData(p => ({ ...p, new_password: e.target.value }))}
                                    className="h-[48px] pl-11 rounded-xl border-slate-200 bg-slate-50/50 font-semibold text-brand-navy focus-visible:ring-brand-navy/15 placeholder:text-slate-300"
                                />
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/20" />
                                <Input
                                    type="password" placeholder="Confirm password"
                                    value={passwordData.confirm}
                                    onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))}
                                    className="h-[48px] pl-11 rounded-xl border-slate-200 bg-slate-50/50 font-semibold text-brand-navy focus-visible:ring-brand-navy/15 placeholder:text-slate-300"
                                />
                            </div>
                            {passwordData.new_password && passwordData.confirm && passwordData.new_password !== passwordData.confirm && (
                                <p className="text-xs font-semibold text-red-500 flex items-center gap-1.5 pl-1">
                                    <AlertCircle className="w-3 h-3" /> Passwords do not match
                                </p>
                            )}
                            <div className="flex gap-3 pt-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => { setIsChangingPassword(false); setPasswordData({ new_password: '', confirm: '' }); }}
                                    className="flex-1 rounded-xl h-11 font-bold text-slate-500"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => passwordMutation.mutate()}
                                    disabled={passwordMutation.isPending || !passwordData.new_password || passwordData.new_password !== passwordData.confirm}
                                    className="flex-1 bg-brand-navy hover:bg-brand-navy/90 text-white rounded-xl h-11 font-bold"
                                >
                                    {passwordMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                                    Update
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsChangingPassword(true)}
                            className="w-full flex items-center gap-4 py-1 group transition-all"
                        >
                            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:bg-brand-navy/5 group-hover:border-brand-navy/10 transition-colors">
                                <Shield className="w-[18px] h-[18px] text-brand-navy/25 group-hover:text-brand-navy/40 transition-colors" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-[13px] font-bold text-brand-navy">Change Password</p>
                                <p className="text-[11px] text-slate-400 font-medium">Secure your account</p>
                            </div>
                            <Lock className="w-4 h-4 text-slate-200 group-hover:text-slate-400 transition-colors" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

function FieldRow({ icon: Icon, label, value, onChange, editing, locked, placeholder, last }: {
    icon: any;
    label: string;
    value: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    editing: boolean;
    locked?: boolean;
    placeholder?: string;
    last?: boolean;
}) {
    return (
        <div className={cn("flex items-center gap-4 py-4", !last && "border-b border-slate-50")}>
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100/80 flex items-center justify-center shrink-0">
                <Icon className="w-[18px] h-[18px] text-brand-navy/25" />
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-navy/25 mb-0.5">{label}</p>
                {editing && !locked ? (
                    <Input
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder || label}
                        className="h-8 px-0 py-0 border-0 shadow-none bg-transparent font-semibold text-[15px] text-brand-navy focus-visible:ring-0 placeholder:text-slate-300"
                    />
                ) : (
                    <p className={cn("text-[15px] font-semibold truncate leading-snug", value ? "text-brand-navy" : "text-slate-300")}>
                        {value || placeholder || 'Not set'}
                    </p>
                )}
            </div>

            {locked && (
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 shrink-0">Fixed</span>
            )}
        </div>
    );
}

export default Profile;

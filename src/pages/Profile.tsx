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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Profile</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Account settings</p>
                    </div>
                    <Button
                        variant={isEditing ? 'outline' : 'outline'}
                        onClick={() => {
                            if (isEditing) { setIsEditing(false); setAvatarFile(null); }
                            else setIsEditing(true);
                        }}
                        className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                    >
                        <Pen className="w-3.5 h-3.5" />
                        {isEditing ? 'Cancel' : 'Edit Profile'}
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Avatar + Identity card */}
                <div className="rounded-xl border border-gray-100 bg-white p-3.5 flex flex-col items-center gap-3">
                    <div
                        {...getRootProps()}
                        className={cn(
                            "relative h-14 w-14 rounded-full overflow-hidden border-2 border-gray-100",
                            isEditing && "cursor-pointer group ring-2 ring-brand-navy/10"
                        )}
                    >
                        <input {...getInputProps()} />
                        {avatarPreview ? (
                            <img src={avatarPreview} className="w-full h-full object-cover" alt="" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                <span className="text-[15px] font-semibold text-brand-navy/40">{initials}</span>
                            </div>
                        )}
                        {isEditing && (
                            <div className="absolute inset-0 bg-brand-navy/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200">
                                <Camera className="w-4 h-4 text-white" />
                            </div>
                        )}
                    </div>

                    <div className="text-center">
                        <p className="text-[13px] font-semibold text-brand-navy">{profile?.name}</p>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white bg-brand-navy px-2 py-0.5 rounded">
                                {profile?.role || 'Admin'}
                            </span>
                            <span className="text-[11px] text-gray-400">@{profile?.username}</span>
                        </div>
                    </div>

                    {/* Business strip */}
                    {business && (
                        <div className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="w-7 h-7 rounded-md bg-white border border-gray-100 flex items-center justify-center overflow-hidden shrink-0 p-1">
                                {business.logo ? (
                                    <img src={business.logo} alt="" className="max-w-full max-h-full object-contain" />
                                ) : (
                                    <Building2 className="w-3.5 h-3.5 text-gray-300" />
                                )}
                            </div>
                            <span className="text-[11px] font-semibold text-brand-navy truncate flex-1">{business.name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                                <div className={cn("w-1.5 h-1.5 rounded-full", business.active ? "bg-emerald-500" : "bg-gray-300")} />
                                <span className={cn("text-[9px] font-bold uppercase tracking-wider", business.active ? "text-emerald-600" : "text-gray-400")}>
                                    {business.active ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Fields card */}
                <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white p-3.5 space-y-1">
                    <p className="text-[11px] font-semibold text-brand-navy mb-3">Personal Information</p>
                    <FieldRow icon={User} label="Full Name" value={formData.name} onChange={set('name')} editing={isEditing} />
                    <FieldRow icon={AtSign} label="Username" value={formData.username} onChange={set('username')} editing={isEditing} />
                    <FieldRow icon={Mail} label="Email" value={formData.email} editing={false} locked />
                    <FieldRow icon={Phone} label="Phone" value={formData.phone} onChange={set('phone')} editing={isEditing} placeholder="Add phone number" last />

                    {isEditing && (
                        <div className="pt-3">
                            <Button
                                onClick={() => updateMutation.mutate()}
                                disabled={updateMutation.isPending}
                                className="h-8 rounded-md text-[11px] font-semibold"
                            >
                                {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                                Save Changes
                            </Button>
                        </div>
                    )}
                </div>

                {/* Security card */}
                <div className="lg:col-span-3 rounded-xl border border-gray-100 bg-white p-3.5">
                    <p className="text-[11px] font-semibold text-brand-navy mb-3">Security</p>
                    {isChangingPassword ? (
                        <div className="space-y-2.5 max-w-sm">
                            <div className="relative">
                                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                                <Input
                                    type="password" placeholder="New password"
                                    value={passwordData.new_password}
                                    onChange={e => setPasswordData(p => ({ ...p, new_password: e.target.value }))}
                                    className="h-9 pl-8 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                />
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                                <Input
                                    type="password" placeholder="Confirm password"
                                    value={passwordData.confirm}
                                    onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))}
                                    className="h-9 pl-8 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                />
                            </div>
                            {passwordData.new_password && passwordData.confirm && passwordData.new_password !== passwordData.confirm && (
                                <p className="text-[10px] font-semibold text-red-500 flex items-center gap-1.5">
                                    <AlertCircle className="w-3 h-3" /> Passwords do not match
                                </p>
                            )}
                            <div className="flex gap-2 pt-1">
                                <Button
                                    variant="ghost"
                                    onClick={() => { setIsChangingPassword(false); setPasswordData({ new_password: '', confirm: '' }); }}
                                    className="h-8 rounded-md text-[11px] font-semibold text-gray-500"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => passwordMutation.mutate()}
                                    disabled={passwordMutation.isPending || !passwordData.new_password || passwordData.new_password !== passwordData.confirm}
                                    className="h-8 rounded-md text-[11px] font-semibold"
                                >
                                    {passwordMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                                    Update Password
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsChangingPassword(true)}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors text-left"
                        >
                            <Shield className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Change Password</p>
                                <p className="text-[9px] text-gray-400">Secure your account</p>
                            </div>
                            <Lock className="w-3 h-3 text-gray-300 ml-4" />
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
        <div className={cn("flex items-center gap-3 py-2.5", !last && "border-b border-gray-50")}>
            <Icon className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400 mb-0.5">{label}</p>
                {editing && !locked ? (
                    <Input
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder || label}
                        className="h-7 px-0 py-0 border-0 shadow-none bg-transparent font-medium text-[12px] text-brand-navy focus-visible:ring-0 placeholder:text-gray-300"
                    />
                ) : (
                    <p className={cn("text-[12px] font-medium truncate leading-snug", value ? "text-brand-navy" : "text-gray-300")}>
                        {value || placeholder || 'Not set'}
                    </p>
                )}
            </div>
            {locked && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-300 shrink-0">Fixed</span>
            )}
        </div>
    );
}

export default Profile;

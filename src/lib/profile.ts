import { supabase } from '@/lib/supabase';

function dataURLtoBlob(dataUrl: string): Blob {
    const [head, b64] = dataUrl.split(',');
    const mime = /:(.*?);/.exec(head)?.[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

/**
 * Save the logged-in user's own avatar. Uploaded photo → `avatar` bucket (avatar_url);
 * generated avatar → avatar_config. The other is cleared so UserAvatar shows the new one.
 */
export async function saveOwnAvatar(v: { config?: object | null; dataUrl?: string | null }): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    if (v.dataUrl) {
        const blob = dataURLtoBlob(v.dataUrl);
        // The path stays `.png` on purpose: the object is upserted, and there is no
        // DELETE policy on the avatar bucket for ordinary users, so changing the
        // extension when the compressor switches codec would strand the old file
        // forever. Storage serves by the stored Content-Type, not by the name.
        const path = `self/${user.id}.png`;
        const { error: upErr } = await supabase.storage.from('avatar')
            .upload(path, blob, { upsert: true, contentType: blob.type || 'image/png' });
        if (upErr) throw upErr;
        const base = supabase.storage.from('avatar').getPublicUrl(path).data.publicUrl;
        const url = `${base}?v=${Date.now()}`; // cache-bust the stable path
        const { error } = await supabase.from('users')
            .update({ avatar_url: url, avatar_config: null } as never).eq('id', user.id);
        if (error) throw error;
    } else if (v.config) {
        const { error } = await supabase.from('users')
            .update({ avatar_config: v.config, avatar_url: null } as never).eq('id', user.id);
        if (error) throw error;
    }
}

/** Save the logged-in user's own basic identity fields. */
export async function saveOwnBasicInfo(patch: { name?: string; username?: string; phone?: string }): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase.from('users').update(patch as never).eq('id', user.id);
    if (error) throw error;
}

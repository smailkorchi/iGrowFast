import NiceAvatar from 'react-nice-avatar';
import { cn } from '@/lib/utils';
import { imageUrl, type ImagePreset } from '@/lib/imageUrl';

/**
 * Single source of truth for rendering a user's avatar anywhere in the app.
 * Precedence: uploaded photo (`url`) → generated `config` (react-nice-avatar) → initials.
 * Pass the container size/shape via `className` (e.g. "h-10 w-10 rounded-full").
 *
 * The photo is served through the storage image renderer at `preset` instead of
 * as the original upload (the largest avatar on the box is an 18.9 MB PNG).
 * Default `avatarMd` = 128px, which covers every current usage (largest is
 * `w-16` = 64 CSS px) at 2x. Pass a bigger preset if you render it larger.
 */
export function UserAvatar({
    url,
    config,
    name,
    className,
    preset = 'avatarMd',
}: {
    url?: string | null;
    config?: unknown;
    name?: string | null;
    className?: string;
    preset?: ImagePreset;
}) {
    const hasConfig = !!config && typeof config === 'object' && Object.keys(config as object).length > 0;
    const initials = (name || '').trim().split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?';

    return (
        <span className={cn('relative inline-flex items-center justify-center overflow-hidden bg-ant-ink/5 text-ant-ink shrink-0', className)}>
            {url ? (
                <img src={imageUrl(url, preset)} alt="" className="w-full h-full object-cover" />
            ) : hasConfig ? (
                <NiceAvatar className="w-full h-full" style={{ width: '100%', height: '100%' }} shape="square" {...(config as object)} />
            ) : (
                <span className="font-display font-semibold" style={{ fontSize: '38%' }}>{initials}</span>
            )}
        </span>
    );
}

export default UserAvatar;

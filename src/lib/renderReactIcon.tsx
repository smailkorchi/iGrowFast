import { type ComponentType, useState, useEffect } from 'react';

type IconComp = ComponentType<{ className?: string; style?: React.CSSProperties }>;

// Only include the most useful packs (6 packs ≈ 8k icons — covers all delivery/status needs)
// Fa (FontAwesome 5), Md (Material Design), Tb (Tabler), Hi2 (Heroicons 2), Lu (Lucide), Bs (Bootstrap)
const packLoaders: Record<string, () => Promise<Record<string, IconComp>>> = {
    Hi2: () => import('react-icons/hi2') as any,
    Fa: () => import('react-icons/fa') as any,
    Md: () => import('react-icons/md') as any,
    Tb: () => import('react-icons/tb') as any,
    Lu: () => import('react-icons/lu') as any,
    Bs: () => import('react-icons/bs') as any,
};

const prefixes = Object.keys(packLoaders).sort((a, b) => b.length - a.length);
const loadedPacks: Record<string, Record<string, IconComp>> = {};

function getPrefix(name: string): string | null {
    for (const prefix of prefixes) {
        if (name.startsWith(prefix)) return prefix;
    }
    return null;
}

export function getIconComponent(name: string): IconComp | null {
    if (!name) return null;
    const prefix = getPrefix(name);
    if (!prefix) return null;
    return loadedPacks[prefix]?.[name] || null;
}

async function loadIcon(name: string): Promise<IconComp | null> {
    const prefix = getPrefix(name);
    if (!prefix || !packLoaders[prefix]) return null;
    if (!loadedPacks[prefix]) {
        loadedPacks[prefix] = await packLoaders[prefix]();
    }
    return loadedPacks[prefix][name] || null;
}

export async function getAllIconNamesAsync(): Promise<string[]> {
    const allNames: string[] = [];
    await Promise.all(
        Object.entries(packLoaders).map(async ([prefix, loader]) => {
            if (!loadedPacks[prefix]) {
                loadedPacks[prefix] = await loader();
            }
            for (const key of Object.keys(loadedPacks[prefix])) {
                if (typeof loadedPacks[prefix][key] === 'function') {
                    allNames.push(key);
                }
            }
        })
    );
    return allNames;
}

export function DynamicIcon({
    name,
    className,
    style,
}: {
    name: string | null | undefined;
    className?: string;
    style?: React.CSSProperties;
}) {
    const [Icon, setIcon] = useState<IconComp | null>(() => name ? getIconComponent(name) : null);

    useEffect(() => {
        if (!name) { setIcon(null); return; }
        const sync = getIconComponent(name);
        if (sync) { setIcon(sync); return; }
        let cancelled = false;
        loadIcon(name).then(comp => { if (!cancelled) setIcon(comp); });
        return () => { cancelled = true; };
    }, [name]);

    if (!Icon) return null;
    return <Icon className={className} style={style} />;
}

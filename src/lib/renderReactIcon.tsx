import { type ComponentType } from 'react';
import * as Ai from 'react-icons/ai';
import * as Bi from 'react-icons/bi';
import * as Bs from 'react-icons/bs';
import * as Cg from 'react-icons/cg';
import * as Ci from 'react-icons/ci';
import * as Di from 'react-icons/di';
import * as Fa from 'react-icons/fa';
import * as Fa6 from 'react-icons/fa6';
import * as Fc from 'react-icons/fc';
import * as Fi from 'react-icons/fi';
import * as Gi from 'react-icons/gi';
import * as Go from 'react-icons/go';
import * as Gr from 'react-icons/gr';
import * as Hi from 'react-icons/hi';
import * as Hi2 from 'react-icons/hi2';
import * as Im from 'react-icons/im';
import * as Io from 'react-icons/io';
import * as Io5 from 'react-icons/io5';
import * as Lia from 'react-icons/lia';
import * as Lu from 'react-icons/lu';
import * as Md from 'react-icons/md';
import * as Pi from 'react-icons/pi';
import * as Ri from 'react-icons/ri';
import * as Rx from 'react-icons/rx';
import * as Si from 'react-icons/si';
import * as Sl from 'react-icons/sl';
import * as Tb from 'react-icons/tb';
import * as Tfi from 'react-icons/tfi';
import * as Ti from 'react-icons/ti';
import * as Vsc from 'react-icons/vsc';
import * as Wi from 'react-icons/wi';

type IconComp = ComponentType<{ className?: string; style?: React.CSSProperties }>;

/** All 31 react-icons packs — sorted longest prefix first for correct matching */
const packs: [string, Record<string, IconComp>][] = [
    ['Fa6', Fa6 as any],
    ['Hi2', Hi2 as any],
    ['Io5', Io5 as any],
    ['Lia', Lia as any],
    ['Tfi', Tfi as any],
    ['Vsc', Vsc as any],
    ['Ai', Ai as any],
    ['Bi', Bi as any],
    ['Bs', Bs as any],
    ['Cg', Cg as any],
    ['Ci', Ci as any],
    ['Di', Di as any],
    ['Fa', Fa as any],
    ['Fc', Fc as any],
    ['Fi', Fi as any],
    ['Gi', Gi as any],
    ['Go', Go as any],
    ['Gr', Gr as any],
    ['Hi', Hi as any],
    ['Im', Im as any],
    ['Io', Io as any],
    ['Lu', Lu as any],
    ['Md', Md as any],
    ['Pi', Pi as any],
    ['Ri', Ri as any],
    ['Rx', Rx as any],
    ['Si', Si as any],
    ['Sl', Sl as any],
    ['Tb', Tb as any],
    ['Ti', Ti as any],
    ['Wi', Wi as any],
];

/** Resolve a react-icons name string (e.g. "FaTruck") to its component */
export function getIconComponent(name: string): IconComp | null {
    if (!name) return null;
    for (const [prefix, pack] of packs) {
        if (name.startsWith(prefix) && pack[name]) return pack[name];
    }
    return null;
}

/** Get all icon names from all packs (for the icon picker) */
let _cachedNames: string[] | null = null;
export function getAllIconNames(): string[] {
    if (_cachedNames) return _cachedNames;
    const names: string[] = [];
    for (const [, pack] of packs) {
        for (const key of Object.keys(pack)) {
            if (typeof pack[key] === 'function') names.push(key);
        }
    }
    _cachedNames = names;
    return names;
}

/** React component that renders an icon by name string */
export function DynamicIcon({
    name,
    className,
    style,
}: {
    name: string | null | undefined;
    className?: string;
    style?: React.CSSProperties;
}) {
    if (!name) return null;
    const Icon = getIconComponent(name);
    if (!Icon) return null;
    return <Icon className={className} style={style} />;
}

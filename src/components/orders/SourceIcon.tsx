import { FaWhatsapp, FaFacebook, FaInstagram, FaTiktok } from 'react-icons/fa';
import { Phone, Users, RotateCcw, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SourceIconProps {
  source: string | null | undefined;
  className?: string;
  showLabel?: boolean;
}

const SOURCE_MAP: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  whatsapp:     { icon: FaWhatsapp,  color: '#25d366', label: 'WhatsApp' },
  facebook:     { icon: FaFacebook,  color: '#1877f2', label: 'Facebook' },
  instagram:    { icon: FaInstagram, color: '#e4405f', label: 'Instagram' },
  tiktok:       { icon: FaTiktok,    color: '#010101', label: 'TikTok' },
  'phone call': { icon: Phone,       color: '#6366f1', label: 'Phone' },
  connaissance: { icon: Users,       color: '#8b5cf6', label: 'Connaissance' },
  reorder:      { icon: RotateCcw,   color: '#f59e0b', label: 'Reorder' },
  website:      { icon: Globe,       color: '#0ea5e9', label: 'Website' },
};

const DEFAULT_SOURCE = { icon: Globe, color: '#6b7280', label: 'Other' };

export function getSourceMeta(source: string | null | undefined) {
  if (!source) return DEFAULT_SOURCE;
  return SOURCE_MAP[source.toLowerCase().trim()] || { ...DEFAULT_SOURCE, label: source };
}

export default function SourceIcon({ source, className, showLabel = false }: SourceIconProps) {
  const { icon: Icon, color, label } = getSourceMeta(source);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      {showLabel && (
        <span className="text-[10px] font-bold capitalize" style={{ color }}>
          {label}
        </span>
      )}
    </span>
  );
}

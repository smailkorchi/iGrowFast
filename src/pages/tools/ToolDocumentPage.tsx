import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

type ToolDocumentPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function ToolDocumentPage({ title, description, icon: Icon }: ToolDocumentPageProps) {
  return (
    <div className="space-y-8 pb-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Tools</p>
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">{title}</h1>
            <p className="text-gray-500 font-light text-sm max-w-lg">{description}</p>
          </div>
          <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
            <Icon className="w-7 h-7 text-primary/80" />
          </div>
        </div>
      </div>

      <Card className="border-0 shadow-sm rounded-3xl bg-white">
        <CardContent className="p-12 sm:p-16 min-h-[280px] flex items-center justify-center">
          <p className="text-sm text-gray-400 font-light">Contenu à venir.</p>
        </CardContent>
      </Card>
    </div>
  );
}

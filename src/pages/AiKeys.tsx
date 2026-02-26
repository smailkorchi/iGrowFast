import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Key,
    Loader2,
    Bot,
    Activity,
    Server,
    Zap
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const aiModelSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, "Model name required"),
    type: z.string().min(1, "Model type required"),
    concurrency_limit: z.coerce.number().min(1, "Limit must be at least 1"),
});

const aiKeySchema = z.object({
    name: z.string().min(1, "Name required"),
    api_key: z.string().min(1, "API Key required"),
    base_url: z.string().default('https://openrouter.ai/api/v1'),
    models: z.array(aiModelSchema).min(1, "At least one model is required")
});

type AiModel = z.infer<typeof aiModelSchema>;
type AiKeyValues = z.infer<typeof aiKeySchema>;
type AiKeyData = AiKeyValues & { id: string; created_at: string };

const AiKeys = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<AiKeyData | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: aiKeys, isLoading } = useQuery({
        queryKey: ['ai_keys', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('ai_keys')
                .select(`
                    *,
                    models:ai_models(*)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        }
    });

    const mutation = useMutation({
        mutationFn: async ({ values, id }: { values: AiKeyValues, id?: string }) => {
            let keyId = id;
            if (id) {
                const { error: keyError } = await supabase.from('ai_keys')
                    .update({
                        name: values.name,
                        api_key: values.api_key,
                        base_url: values.base_url,
                        'DigiCom Business': activeBusinessId
                    })
                    .eq('id', id);
                if (keyError) throw keyError;

                // Delete old models
                const { error: delError } = await supabase.from('ai_models')
                    .delete()
                    .eq('ai_key_id', id);
                if (delError) throw delError;

            } else {
                const { data: newKey, error: keyError } = await supabase.from('ai_keys')
                    .insert([{
                        name: values.name,
                        api_key: values.api_key,
                        base_url: values.base_url,
                        'DigiCom Business': activeBusinessId
                    }])
                    .select()
                    .single();
                if (keyError) throw keyError;
                keyId = newKey.id;
            }

            // Insert new models
            const modelsToInsert = values.models.map(m => ({
                ai_key_id: keyId,
                name: m.name,
                type: m.type,
                concurrency_limit: m.concurrency_limit,
                'DigiCom Business': activeBusinessId
            }));

            const { error: modelsError } = await supabase.from('ai_models')
                .insert(modelsToInsert);
            if (modelsError) throw modelsError;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ai_keys', activeBusinessId] });
            setIsModalOpen(false);
            setEditingItem(null);
            toast({ title: "Success", description: "AI Key saved successfully." });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('ai_keys')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ai_keys', activeBusinessId] });
            toast({ title: "Removed", description: "AI Key successfully deleted." });
        }
    });

    const filteredKeys = aiKeys?.filter(k =>
        k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        k.api_key.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-8 p-4 md:p-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black tracking-tighter text-brand-navy">AI Keys</h1>
                    <p className="text-muted-foreground mt-2 text-lg">Manage your AI API keys and model limits.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search keys..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => {
                            setEditingItem(null);
                            setIsModalOpen(true);
                        }}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5 mr-1" /> New Key
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    [1, 2, 3].map(i => <div key={i} className="h-64 rounded-[32px] bg-white animate-pulse" />)
                ) : filteredKeys?.length ? (
                    filteredKeys.map(item => (
                        <Card key={item.id} className="group overflow-hidden border-none bg-white hover:shadow-2xl transition-all duration-500 rounded-[32px]">
                            <CardHeader className="p-6">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy">
                                            <Key className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg font-black text-brand-navy">{item.name}</CardTitle>
                                            <p className="text-xs text-muted-foreground font-medium mt-1">
                                                Added {format(new Date(item.created_at), 'MMM dd, yyyy')}
                                            </p>
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9 hover:bg-slate-50">
                                                <MoreVertical className="w-4 h-4 text-slate-400" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px]">
                                            <DropdownMenuItem onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy">
                                                <Edit2 className="w-4 h-4 mr-3 text-slate-400" /> Edit Key
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => deleteMutation.mutate(item.id)} className="rounded-xl p-3 cursor-pointer font-bold text-red-500 hover:bg-red-50">
                                                <Trash2 className="w-4 h-4 mr-3 text-red-400" /> Delete Key
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </CardHeader>
                            <CardContent className="px-6 pb-6 pt-0 space-y-4">
                                <div className="flex flex-col gap-2">
                                    <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">API KEY</p>
                                    <div className="p-3 bg-slate-50 rounded-xl font-mono text-xs text-brand-navy/60 truncate relative">
                                        <span className="blur-sm select-none">{item.api_key.substring(0, 15)}...</span>
                                        <span className="absolute inset-x-3">{item.api_key.substring(0, 4)}••••••••••••••••</span>
                                    </div>
                                </div>
                                <div className="space-y-3 pt-4 border-t border-slate-100">
                                    <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/60 flex items-center gap-2">
                                        <Server className="w-3 h-3" /> Connected Models ({item.models?.length || 0})
                                    </p>
                                    <div className="grid grid-cols-1 gap-2 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar">
                                        {item.models?.map((model: AiModel) => (
                                            <div key={model.id} className="flex items-center justify-between p-3 bg-brand-navy/[0.02] rounded-xl border border-brand-navy/[0.04]">
                                                <div className="flex items-center gap-2 truncate">
                                                    <Bot className="w-3.5 h-3.5 text-brand-navy/40 shrink-0" />
                                                    <span className="text-xs font-bold text-brand-navy truncate">{model.name}</span>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <Badge variant="outline" className="text-[9px] uppercase font-black bg-white">{model.type}</Badge>
                                                    <div className="flex items-center gap-1 text-[10px] font-bold text-brand-navy/50">
                                                        <Activity className="w-3 h-3" /> {model.concurrency_limit}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                ) : (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center bg-white rounded-[40px] border border-dashed border-slate-200">
                        <div className="bg-brand-navy/5 p-6 rounded-full mb-6 relative">
                            <Key className="w-12 h-12 text-brand-navy/40" />
                            <Zap className="w-6 h-6 text-brand-navy absolute -bottom-2 -right-2" />
                        </div>
                        <h3 className="text-2xl font-black text-brand-navy">No AI Keys configured</h3>
                        <p className="text-muted-foreground mt-2 max-w-sm">Add your provider API keys and setup model configurations to get started.</p>
                        <Button
                            onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
                            className="mt-6 bg-brand-navy hover:bg-brand-navy/90 text-white rounded-xl font-bold px-8 shadow-lg"
                        >
                            Add First Key
                        </Button>
                    </div>
                )}
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <AiKeyForm
                        initialData={editingItem}
                        onSubmit={(v) => mutation.mutate({ values: v, id: editingItem?.id })}
                        loading={mutation.isPending}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};

const AiKeyForm = ({ initialData, onSubmit, loading }: { initialData: AiKeyData | null, onSubmit: (val: AiKeyValues) => void, loading: boolean }) => {
    const form = useForm<AiKeyValues>({
        resolver: zodResolver(aiKeySchema),
        defaultValues: {
            name: initialData?.name || '',
            api_key: initialData?.api_key || '',
            base_url: initialData?.base_url || 'https://openrouter.ai/api/v1',
            models: initialData?.models?.length ? initialData.models : [{ name: '', type: 'Language Model', concurrency_limit: 1 }]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "models"
    });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col max-h-[90vh]">
                <DialogHeader className="p-8 pb-6 bg-brand-navy/[0.02]">
                    <DialogTitle className="text-3xl font-black text-brand-navy tracking-tight">
                        {initialData ? 'Edit AI Configuration' : 'New AI Configuration'}
                    </DialogTitle>
                    <DialogDescription className="text-base font-semibold text-slate-500">
                        Securely provide your API key and configure its related models.
                    </DialogDescription>
                </DialogHeader>

                <div className="overflow-y-auto p-8 pt-6 space-y-8 flex-1 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField control={form.control} name="name" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Provider Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. OpenAI, Anthropic..." {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-black shadow-inner px-5 focus-visible:ring-1 focus-visible:ring-brand-navy" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="api_key" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">API Key</FormLabel>
                                <FormControl>
                                    <Input type={initialData ? "password" : "text"} placeholder="sk-..." {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-black shadow-inner px-5 focus-visible:ring-1 focus-visible:ring-brand-navy" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </div>
                    <FormField control={form.control} name="base_url" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Base URL</FormLabel>
                            <FormControl>
                                <Input placeholder="https://openrouter.ai/api/v1" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner px-5 focus-visible:ring-1 focus-visible:ring-brand-navy text-xs" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />

                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between border-b border-brand-navy/5 pb-4">
                            <div>
                                <h3 className="text-lg font-black text-brand-navy">Configured Models</h3>
                                <p className="text-xs font-bold text-muted-foreground">List the models accessible via this key</p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => append({ name: '', type: 'text', concurrency_limit: 1 })}
                                className="rounded-xl border-dashed border-2 border-brand-navy/20 hover:border-brand-navy/40 font-bold bg-transparent text-brand-navy h-10 px-4"
                            >
                                <Plus className="w-4 h-4 mr-2" /> Add Model
                            </Button>
                        </div>

                        <div className="space-y-3">
                            {fields.map((field, index) => (
                                <div key={field.id} className="p-4 rounded-[24px] bg-white border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-start md:items-end animate-in fade-in run-in-from-bottom-2 duration-300">
                                    <div className="flex-1 w-full relative group">
                                        <FormField control={form.control} name={`models.${index}.name`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Model Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. gpt-4, claude-3-opus..." {...field} className="h-12 rounded-xl bg-brand-navy/[0.02] border-none font-bold text-sm shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="w-full md:w-[140px] shrink-0">
                                        <FormField control={form.control} name={`models.${index}.type`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Type</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="text, image..." {...field} className="h-12 rounded-xl bg-brand-navy/[0.02] border-none font-bold text-sm shadow-inner text-center" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="w-full md:w-[120px] shrink-0">
                                        <FormField control={form.control} name={`models.${index}.concurrency_limit`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Concurrency</FormLabel>
                                                <FormControl>
                                                    <Input type="number" min={1} {...field} className="h-12 rounded-xl bg-brand-navy/[0.02] border-none font-bold text-sm shadow-inner text-center" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => remove(index)}
                                        className="shrink-0 h-10 w-10 p-0 rounded-xl text-red-400 hover:text-red-500 hover:bg-red-50 mb-1 active:scale-95 transition-transform"
                                        disabled={fields.length === 1}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-8 pb-8 pt-4 bg-brand-white border-t border-slate-50">
                    <Button type="submit" disabled={loading} className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-[24px] h-14 text-base font-black shadow-xl transition-all active:scale-[0.98]">
                        {loading && <Loader2 className="w-5 h-5 mr-3 animate-spin" />}
                        Save AI Configuration
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};

export default AiKeys;

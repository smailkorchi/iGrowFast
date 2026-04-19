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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">AI Keys</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Manage API keys and model configurations</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <Input
                            placeholder="Search keys..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                        />
                    </div>
                    <Button
                        onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5" /> New Key
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {isLoading ? (
                    [1, 2, 3].map(i => <div key={i} className="h-48 rounded-xl bg-white border border-gray-100 animate-pulse" />)
                ) : filteredKeys?.length ? (
                    filteredKeys.map(item => (
                        <Card key={item.id} className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                            <CardHeader className="p-3 pb-2 flex flex-row items-start justify-between space-y-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-8 h-8 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                                        <Key className="w-4 h-4 text-brand-navy/40" />
                                    </div>
                                    <div className="min-w-0">
                                        <CardTitle className="text-[12px] font-semibold text-brand-navy tracking-tight leading-tight truncate">{item.name}</CardTitle>
                                        <p className="text-[9px] text-gray-400 mt-0.5 tabular-nums">
                                            Added {format(new Date(item.created_at), 'MMM dd, yyyy')}
                                        </p>
                                    </div>
                                </div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="rounded-md h-6 w-6 hover:bg-gray-50 shadow-none -mr-1 -mt-1">
                                            <MoreVertical className="w-3.5 h-3.5 text-gray-400" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="rounded-md min-w-[140px]">
                                        <DropdownMenuItem onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="text-[11px] font-medium text-brand-navy">
                                            <Edit2 className="w-3 h-3 mr-2 text-gray-400" /> Edit Key
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => deleteMutation.mutate(item.id)} className="text-[11px] font-medium text-red-600 hover:bg-red-50 focus:bg-red-50">
                                            <Trash2 className="w-3 h-3 mr-2" /> Delete Key
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </CardHeader>
                            <CardContent className="px-3 pb-3 space-y-2">
                                <div>
                                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-0.5">API Key</p>
                                    <div className="px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100 font-mono text-[10px] text-brand-navy/60 truncate">
                                        {item.api_key.substring(0, 4)}••••••••••••••••
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-gray-100">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-1.5 flex items-center gap-1">
                                        <Server className="w-2.5 h-2.5" /> Models ({item.models?.length || 0})
                                    </p>
                                    <div className="space-y-1 max-h-[120px] overflow-y-auto">
                                        {item.models?.map((model: AiModel) => (
                                            <div key={model.id} className="flex items-center justify-between px-2 py-1 rounded-md bg-gray-50 border border-gray-100">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <Bot className="w-3 h-3 text-brand-navy/40 shrink-0" />
                                                    <span className="text-[10px] font-semibold text-brand-navy truncate">{model.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <Badge variant="outline" className="text-[9px] font-semibold h-4 px-1 bg-white">{model.type}</Badge>
                                                    <div className="flex items-center gap-0.5 text-[9px] font-semibold text-brand-navy/50">
                                                        <Activity className="w-2.5 h-2.5" /> {model.concurrency_limit}
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
                    <div className="col-span-full border border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center text-center gap-2">
                        <Key className="w-5 h-5 text-gray-300" />
                        <p className="text-[11px] font-semibold text-brand-navy">No AI Keys configured</p>
                        <p className="text-[10px] text-gray-400">Add your provider API keys to get started.</p>
                        <Button
                            onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
                            className="mt-1 bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold"
                        >
                            Add First Key
                        </Button>
                    </div>
                )}
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-2xl p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden">
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
                <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                    <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                        {initialData ? 'Edit AI Configuration' : 'New AI Configuration'}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] text-gray-500">
                        Securely provide your API key and configure its related models.
                    </DialogDescription>
                </DialogHeader>

                <div className="overflow-y-auto p-4 space-y-3 flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField control={form.control} name="name" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-medium text-gray-500">Provider Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. OpenAI, Anthropic..." {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                                </FormControl>
                                <FormMessage className="text-[10px]" />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="api_key" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-medium text-gray-500">API Key</FormLabel>
                                <FormControl>
                                    <Input type={initialData ? "password" : "text"} placeholder="sk-..." {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                                </FormControl>
                                <FormMessage className="text-[10px]" />
                            </FormItem>
                        )} />
                    </div>
                    <FormField control={form.control} name="base_url" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-medium text-gray-500">Base URL</FormLabel>
                            <FormControl>
                                <Input placeholder="https://openrouter.ai/api/v1" {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                            </FormControl>
                            <FormMessage className="text-[10px]" />
                        </FormItem>
                    )} />

                    <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Configured Models</p>
                                <p className="text-[9px] text-gray-400">List the models accessible via this key</p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => append({ name: '', type: 'text', concurrency_limit: 1 })}
                                className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200 gap-1.5"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Model
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {fields.map((field, index) => (
                                <div key={field.id} className="p-2.5 rounded-xl border border-gray-100 bg-gray-50/50 flex flex-col md:flex-row gap-2 items-start md:items-end">
                                    <div className="flex-1 w-full">
                                        <FormField control={form.control} name={`models.${index}.name`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-medium text-gray-500">Model Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. gpt-4, claude-3-opus..." {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="w-full md:w-[130px] shrink-0">
                                        <FormField control={form.control} name={`models.${index}.type`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-medium text-gray-500">Type</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="text, image..." {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="w-full md:w-[110px] shrink-0">
                                        <FormField control={form.control} name={`models.${index}.concurrency_limit`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-medium text-gray-500">Concurrency</FormLabel>
                                                <FormControl>
                                                    <Input type="number" min={1} {...field} className="h-9 text-[12px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )} />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => remove(index)}
                                        className="shrink-0 h-8 w-8 p-0 rounded-md text-red-400 hover:text-red-500 hover:bg-red-50"
                                        disabled={fields.length === 1}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter className="px-4 py-3 border-t border-gray-100 bg-white gap-2">
                    <Button type="submit" disabled={loading} className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5">
                        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Save Configuration
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};

export default AiKeys;

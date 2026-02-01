import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Upload,
    X,
    ImageIcon,
    Loader2,
    CheckCircle2,
    Building2
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export const businessSchema = z.object({
    name: z.string().min(2, "Business name must be at least 2 characters"),
    active: z.boolean().default(true),
    logo: z.string().optional().nullable(),
});

export type BusinessFormValues = z.infer<typeof businessSchema>;

interface AddEditBusinessModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: BusinessFormValues) => void;
    initialData?: any;
    loading?: boolean;
}

export const AddEditBusinessModal: React.FC<AddEditBusinessModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    initialData,
    loading
}) => {
    const { toast } = useToast();
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    const form = useForm<BusinessFormValues>({
        resolver: zodResolver(businessSchema),
        defaultValues: {
            name: '',
            active: true,
            logo: '',
        }
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({
                    name: initialData.name,
                    active: initialData.active,
                    logo: initialData.logo || '',
                });
                setLogoPreview(initialData.logo);
            } else {
                form.reset({ name: '', active: true, logo: '' });
                setLogoPreview(null);
            }
        }
    }, [isOpen, initialData, form]);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `logos/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('business-logos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('business-logos')
                .getPublicUrl(filePath);

            setLogoPreview(publicUrl);
            form.setValue('logo', publicUrl);
            toast({ title: "Logo Uploaded", description: "Business logo has been saved." });
        } catch (error: any) {
            toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    }, [form, toast]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        multiple: false
    });

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
                        <DialogHeader className="p-10 pb-6 bg-brand-navy text-white">
                            <DialogTitle className="text-3xl font-black uppercase tracking-tight">
                                {initialData ? 'Update Business' : 'New Identity'}
                            </DialogTitle>
                            <DialogDescription className="text-white/40 font-bold uppercase text-xs tracking-[0.2em] pt-1">
                                Configure System Entity & Assets
                            </DialogDescription>
                        </DialogHeader>

                        <div className="p-10 space-y-8">
                            <div className="space-y-4">
                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Visual Identity (Logo)</FormLabel>
                                <div {...getRootProps()} className={cn(
                                    "relative h-48 rounded-[32px] border-4 border-dashed flex flex-col items-center justify-center transition-all duration-500 overflow-hidden cursor-pointer",
                                    logoPreview ? "border-transparent" : "border-brand-navy/5 bg-brand-navy/[0.02] hover:border-brand-navy/20",
                                    isDragActive && "border-blue-500 bg-blue-50/50"
                                )}>
                                    <input {...getInputProps()} />
                                    {logoPreview ? (
                                        <div className="relative w-full h-full group/logo">
                                            <img src={logoPreview} alt="" className="w-full h-full object-contain p-6" />
                                            <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-sm opacity-0 group-hover/logo:opacity-100 transition-opacity flex items-center justify-center">
                                                <Upload className="w-10 h-10 text-white" />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center space-y-3">
                                            <div className="w-16 h-16 rounded-2xl bg-brand-navy/5 flex items-center justify-center mx-auto transition-transform group-hover:scale-110">
                                                <ImageIcon className="w-8 h-8 text-brand-navy/20" />
                                            </div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Drop JPG/PNG here</p>
                                        </div>
                                    )}
                                    {isUploading && (
                                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Business Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Enter commercial name..." {...field} className="h-16 rounded-2xl border-none bg-brand-navy/5 font-bold text-lg text-brand-navy shadow-inner px-6" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="active" render={({ field }) => (
                                <FormItem className="flex items-center justify-between p-4 rounded-2xl bg-brand-navy/5 border border-transparent">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy">Entity Status</FormLabel>
                                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Active units appear in select menus</p>
                                    </div>
                                    <FormControl>
                                        <div
                                            onClick={() => field.onChange(!field.value)}
                                            className={cn(
                                                "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-300",
                                                field.value ? "bg-emerald-500" : "bg-slate-300"
                                            )}
                                        >
                                            <div className={cn(
                                                "w-4 h-4 rounded-full bg-white transition-transform duration-300",
                                                field.value ? "translate-x-6" : "translate-x-0"
                                            )} />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )} />
                        </div>

                        <DialogFooter className="p-10 pt-0">
                            <Button
                                type="submit"
                                disabled={loading || isUploading}
                                className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-16 text-lg font-black shadow-2xl transition-all flex items-center gap-3 active:scale-95"
                            >
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                                {initialData ? 'Update Entity' : 'Finalize Registration'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

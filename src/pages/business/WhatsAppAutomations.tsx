import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Bot, Plus, Trash } from 'lucide-react';

export default function WhatsAppAutomations() {
    const [replies, setReplies] = useState<
        Array<{ id: string; trigger_keyword: string; reply_message: string; active: boolean }>
    >([]);
    const [keyword, setKeyword] = useState('');
    const [message, setMessage] = useState('');
    const { toast } = useToast();

    useEffect(() => {
        fetchReplies();
    }, []);

    const fetchReplies = async () => {
        const businessId = localStorage.getItem('activeBusinessId');
        if (!businessId) return;
        const { data } = await supabase
            .from('whatsapp_auto_replies')
            .select('*')
            .eq('business_id', businessId);
        if (data) setReplies(data);
    };

    const handleAdd = async () => {
        const businessId = localStorage.getItem('activeBusinessId');
        if (!businessId || !keyword || !message) return;

        await supabase.from('whatsapp_auto_replies').insert({
            business_id: businessId,
            trigger_keyword: keyword,
            reply_message: message,
            active: true,
        });

        setKeyword('');
        setMessage('');
        fetchReplies();
        toast({ title: 'Automation added' });
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header — matches Analytics compact style */}
            <header className="flex items-center gap-2">
                <Bot className="w-3.5 h-3.5 text-gray-400" />
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                        WhatsApp Automations
                    </h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                        Trigger-based auto-replies
                    </p>
                </div>
            </header>

            {/* New auto-reply */}
            <div className="bg-white border border-gray-100 rounded-xl p-3.5 space-y-2.5 max-w-xl">
                <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-semibold text-brand-navy">New auto-reply</h3>
                </div>
                <div className="space-y-2">
                    <Input
                        placeholder="Trigger keyword (e.g. price, menu)"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="h-8 rounded-md text-[11px]"
                    />
                    <Input
                        placeholder="Reply message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="h-8 rounded-md text-[11px]"
                    />
                </div>
                <Button
                    size="sm"
                    onClick={handleAdd}
                    disabled={!keyword || !message}
                    className="h-7 px-2.5 text-[11px] font-semibold rounded-md"
                >
                    <Plus className="w-3 h-3 mr-1" />
                    Add rule
                </Button>
            </div>

            {/* Rules list */}
            <div className="space-y-1.5 max-w-3xl">
                {replies.map((r) => (
                    <div
                        key={r.id}
                        className="bg-white border border-gray-100 rounded-xl p-2.5 flex items-center justify-between gap-2"
                    >
                        <div className="flex-1 min-w-0">
                            <div className="inline-flex items-center gap-1 bg-gray-100 px-1.5 py-0.5 rounded-md text-[10px] font-mono text-brand-navy/80 mb-1">
                                <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">
                                    when
                                </span>
                                <span className="truncate">"{r.trigger_keyword}"</span>
                            </div>
                            <div className="text-[11px] text-gray-600 pl-2 border-l-2 border-brand-navy/30 leading-snug">
                                {r.reply_message}
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md shrink-0"
                            onClick={async () => {
                                await supabase.from('whatsapp_auto_replies').delete().eq('id', r.id);
                                fetchReplies();
                            }}
                        >
                            <Trash className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                ))}
                {replies.length === 0 && (
                    <p className="text-[11px] text-gray-400 py-4 text-center">
                        No auto-replies configured yet.
                    </p>
                )}
            </div>
        </div>
    );
}

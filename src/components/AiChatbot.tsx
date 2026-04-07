import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Brain, X, Send, ImagePlus, Bot, User, Loader2,
    ChevronDown, Trash2, Sparkles, Paperclip, Video
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    images?: string[];
    videos?: string[];
    timestamp: number;
    isStreaming?: boolean;
}

interface SelectedModel {
    ai_key_id: string;
    keyName: string;
    modelName: string;
    modelType: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const getHistoryKey = (modelName: string) => `ai_chat_${modelName}`;

const AiChatbot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [uploadedImages, setUploadedImages] = useState<string[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: aiKeys } = useQuery({
        queryKey: ['ai_keys_chat', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('ai_keys')
                .select('*, models:ai_models(*)')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data || [];
        }
    });

    // Only the model name matters for the history lookup. Pulling it out as a primitive
    // lets the effect depend on a simple string (satisfies exhaustive-deps cleanly).
    const selectedModelName = selectedModel?.modelName;
    useEffect(() => {
        if (selectedModelName) {
            const saved = localStorage.getItem(getHistoryKey(selectedModelName));
            if (saved) {
                try { setMessages(JSON.parse(saved)); } catch { setMessages([]); }
            } else {
                setMessages([]);
            }
        }
    }, [selectedModelName]);

    useEffect(() => {
        if (selectedModel && messages.length > 0 && !messages.some(m => m.isStreaming)) {
            localStorage.setItem(getHistoryKey(selectedModel.modelName), JSON.stringify(messages.slice(-50)));
        }
    }, [messages, selectedModel]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const getModelCategory = (type: string): 'chat' | 'image' | 'video' => {
        if (type.toLowerCase().includes('image')) return 'image';
        if (type.toLowerCase().includes('video')) return 'video';
        return 'chat';
    };

    const isVisionModel = (name: string) => /\dV($|-|V)/.test(name) || name.includes('OCR');

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result as string;
                setUploadedImages(prev => [...prev, base64]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const handleSend = useCallback(async () => {
        if ((!input.trim() && uploadedImages.length === 0) || !selectedModel || isLoading) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: input.trim(),
            images: uploadedImages.length > 0 ? [...uploadedImages] : undefined,
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setUploadedImages([]);
        setIsLoading(true);

        const category = getModelCategory(selectedModel.modelType);

        try {
            if (category === 'chat') {
                const apiMessages = messages.concat(userMsg).map(m => {
                    if (m.role === 'user' && m.images?.length) {
                        return {
                            role: 'user',
                            content: [
                                { type: 'text', text: m.content || 'What is in this image?' },
                                ...m.images.map(img => ({ type: 'image_url', image_url: { url: img } }))
                            ]
                        };
                    }
                    return { role: m.role, content: m.content };
                });

                const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({
                        ai_key_id: selectedModel.ai_key_id,
                        model: selectedModel.modelName,
                        messages: apiMessages,
                        type: 'chat'
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    let msg = 'Something went wrong';
                    try {
                        const extractMessage = (obj: unknown): string | null => {
                            if (!obj || typeof obj !== 'object') return null;
                            const o = obj as Record<string, unknown>;
                            if (typeof o.message === 'string') return o.message;
                            if (typeof o.error === 'string') {
                                try { return extractMessage(JSON.parse(o.error)); } catch { return o.error; }
                            }
                            if (typeof o.error === 'object') return extractMessage(o.error);
                            return null;
                        };
                        msg = extractMessage(JSON.parse(errText)) || `Request failed (${response.status})`;
                    } catch { msg = errText.slice(0, 200) || `Request failed (${response.status})`; }
                    if (response.status === 429) msg = '⏳ Rate limited — please wait a moment and try again.';
                    throw new Error(msg);
                }

                const assistantId = crypto.randomUUID();
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true }]);

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                let fullContent = '';

                if (reader) {
                    let buffer = '';
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                            try {
                                const json = JSON.parse(line.slice(6));
                                const delta = json.choices?.[0]?.delta?.content;
                                if (delta) {
                                    fullContent += delta;
                                    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                                }
                            } catch { /* skip malformed lines */ }
                        }
                    }
                }

                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m));

            } else if (category === 'image') {
                const assistantId = crypto.randomUUID();
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '🎨 Generating image...', timestamp: Date.now(), isStreaming: true }]);

                const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({
                        ai_key_id: selectedModel.ai_key_id,
                        model: selectedModel.modelName,
                        prompt: input.trim(),
                        type: 'image',
                        image_url: uploadedImages[0] || undefined
                    })
                });

                const data = await response.json();
                const imageUrls = data.data?.map((d: Record<string, string>) => d.url || d.b64_json) || [];
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Here is your generated image:', images: imageUrls, isStreaming: false } : m));

            } else if (category === 'video') {
                const assistantId = crypto.randomUUID();
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '🎬 Generating video... This may take a few minutes.', timestamp: Date.now(), isStreaming: true }]);

                const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({
                        ai_key_id: selectedModel.ai_key_id,
                        model: selectedModel.modelName,
                        prompt: input.trim(),
                        type: 'video',
                        image_url: uploadedImages[0] || undefined
                    })
                });

                const data = await response.json();
                const taskId = data.id;

                if (taskId) {
                    const pollVideo = async () => {
                        for (let i = 0; i < 60; i++) {
                            await new Promise(r => setTimeout(r, 5000));
                            const statusRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${session.access_token}`,
                                    'Content-Type': 'application/json',
                                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
                                },
                                body: JSON.stringify({
                                    ai_key_id: selectedModel.ai_key_id,
                                    type: 'video-status',
                                    task_id: taskId
                                })
                            });
                            const statusData = await statusRes.json();
                            if (statusData.task_status === 'SUCCESS') {
                                const videoUrls = statusData.video_result?.map((v: Record<string, string>) => v.url) || [];
                                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Here is your generated video:', videos: videoUrls, isStreaming: false } : m));
                                return;
                            } else if (statusData.task_status === 'FAIL') {
                                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '❌ Video generation failed.', isStreaming: false } : m));
                                return;
                            }
                            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `🎬 Still generating... (${i * 5}s elapsed)` } : m));
                        }
                        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '⏰ Video generation timed out.', isStreaming: false } : m));
                    };
                    pollVideo();
                }
            }
        } catch (err) {
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `❌ Error: ${(err as Error).message}`, timestamp: Date.now() }]);
        } finally {
            setIsLoading(false);
        }
    }, [input, selectedModel, isLoading, messages, uploadedImages]);

    const clearHistory = () => {
        if (selectedModel) {
            localStorage.removeItem(getHistoryKey(selectedModel.modelName));
            setMessages([]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-500 group",
                    isOpen
                        ? "bg-red-500 hover:bg-red-600 rotate-90 scale-90"
                        : "bg-brand-navy hover:bg-brand-navy/90 hover:scale-110 hover:shadow-brand-navy/30"
                )}
            >
                {isOpen ? <X className="w-6 h-6 text-white" /> : (
                    <div className="relative">
                        <Brain className="w-7 h-7 text-white" />
                        <Sparkles className="w-3 h-3 text-yellow-300 absolute -top-1 -right-1 animate-pulse" />
                    </div>
                )}
            </button>

            {/* Chat Panel */}
            <div className={cn(
                "fixed bottom-24 right-6 z-[9998] w-[420px] max-w-[calc(100vw-2rem)] rounded-[28px] bg-white shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden transition-all duration-500 origin-bottom-right border border-slate-100",
                isOpen ? "opacity-100 scale-100 translate-y-0 pointer-events-auto h-[600px]" : "opacity-0 scale-75 translate-y-8 pointer-events-none h-0"
            )}>
                {/* Header */}
                <div className="bg-brand-navy p-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
                            <Brain className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-white font-black text-sm tracking-tight">DigiCom AI</h3>
                            <p className="text-white/50 text-[10px] font-bold">{selectedModel ? selectedModel.modelName : 'Select a model'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {selectedModel && (
                            <button onClick={clearHistory} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors" title="Clear chat">
                                <Trash2 className="w-3.5 h-3.5 text-white/50" />
                            </button>
                        )}
                        <button onClick={() => setShowModelPicker(!showModelPicker)} className="h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors">
                            <Bot className="w-3 h-3" /> Model <ChevronDown className={cn("w-3 h-3 transition-transform", showModelPicker && "rotate-180")} />
                        </button>
                    </div>
                </div>

                {/* Model Picker */}
                {showModelPicker && (
                    <div className="bg-slate-50 border-b border-slate-100 p-3 max-h-[240px] overflow-y-auto shrink-0 custom-scrollbar animate-in slide-in-from-top-2 duration-200">
                        {aiKeys?.map((key: Record<string, unknown>) => (
                            <div key={key.id as string} className="mb-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-2 py-1">{key.name as string}</p>
                                <div className="grid grid-cols-2 gap-1">
                                    {(key.models as Array<Record<string, unknown>>)?.map((model) => (
                                        <button
                                            key={model.id as string}
                                            onClick={() => {
                                                setSelectedModel({
                                                    ai_key_id: key.id as string,
                                                    keyName: key.name as string,
                                                    modelName: model.name as string,
                                                    modelType: model.type as string
                                                });
                                                setShowModelPicker(false);
                                            }}
                                            className={cn(
                                                "text-left p-2 rounded-xl text-[11px] font-bold transition-all",
                                                selectedModel?.modelName === model.name
                                                    ? "bg-brand-navy text-white shadow-lg"
                                                    : "bg-white hover:bg-brand-navy/5 text-brand-navy"
                                            )}
                                        >
                                            <span className="block truncate">{model.name as string}</span>
                                            <span className="text-[8px] opacity-50 uppercase">{(model.type as string).replace(' Model', '')}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                            <Brain className="w-12 h-12 text-brand-navy/30 mb-3" />
                            <p className="text-sm font-bold text-brand-navy/60">
                                {selectedModel ? `Chat with ${selectedModel.modelName}` : 'Select a model to start'}
                            </p>
                            <p className="text-xs text-brand-navy/40 mt-1">Supports text, images & video gen</p>
                        </div>
                    )}
                    {messages.map(msg => (
                        <div key={msg.id} className={cn("flex gap-2", msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                            {msg.role === 'assistant' && (
                                <div className="w-7 h-7 rounded-lg bg-brand-navy/5 flex items-center justify-center shrink-0 mt-1">
                                    <Bot className="w-4 h-4 text-brand-navy/50" />
                                </div>
                            )}
                            <div className={cn(
                                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                                msg.role === 'user'
                                    ? "bg-brand-navy text-white rounded-br-lg"
                                    : "bg-slate-100 text-brand-navy rounded-bl-lg"
                            )}>
                                {msg.images && msg.images.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {msg.images.map((img, i) => (
                                            <img key={i} src={img} alt="" className="max-w-full max-h-48 rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(img, '_blank')} />
                                        ))}
                                    </div>
                                )}
                                {msg.videos && msg.videos.length > 0 && (
                                    <div className="flex flex-col gap-2 mb-2">
                                        {msg.videos.map((vid, i) => (
                                            <video key={i} src={vid} controls className="max-w-full rounded-xl" />
                                        ))}
                                    </div>
                                )}
                                <p className="whitespace-pre-wrap break-words font-medium">{msg.content}</p>
                                {msg.isStreaming && <span className="inline-block w-1.5 h-4 bg-brand-navy/40 rounded-full animate-pulse ml-1 align-middle" />}
                            </div>
                            {msg.role === 'user' && (
                                <div className="w-7 h-7 rounded-lg bg-brand-navy flex items-center justify-center shrink-0 mt-1">
                                    <User className="w-4 h-4 text-white" />
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Uploaded Images Preview */}
                {uploadedImages.length > 0 && (
                    <div className="px-4 pt-2 flex gap-2 flex-wrap shrink-0 border-t border-slate-50">
                        {uploadedImages.map((img, i) => (
                            <div key={i} className="relative group">
                                <img src={img} alt="" className="w-14 h-14 rounded-xl object-cover" />
                                <button
                                    onClick={() => setUploadedImages(prev => prev.filter((_, idx) => idx !== i))}
                                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="w-3 h-3 text-white" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Input */}
                <div className="p-3 border-t border-slate-100 shrink-0">
                    <div className="flex items-end gap-2 bg-slate-50 rounded-2xl p-2">
                        <input type="file" ref={fileInputRef} accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!selectedModel}
                            className="w-9 h-9 rounded-xl hover:bg-white flex items-center justify-center transition-colors shrink-0 text-brand-navy/30 hover:text-brand-navy disabled:opacity-30"
                            title="Upload image"
                        >
                            <ImagePlus className="w-4 h-4" />
                        </button>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={selectedModel ? "Type a message..." : "Select a model first"}
                            disabled={!selectedModel}
                            rows={1}
                            className="flex-1 bg-transparent resize-none outline-none text-sm font-medium text-brand-navy placeholder:text-brand-navy/30 max-h-24 min-h-[36px] py-2 disabled:opacity-30"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!selectedModel || isLoading || (!input.trim() && uploadedImages.length === 0)}
                            className={cn(
                                "w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0",
                                input.trim() || uploadedImages.length > 0
                                    ? "bg-brand-navy text-white hover:bg-brand-navy/90 shadow-lg active:scale-90"
                                    : "bg-slate-200 text-slate-400"
                            )}
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default AiChatbot;

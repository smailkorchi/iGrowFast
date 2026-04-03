import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Bot, Plus, Trash } from 'lucide-react';

export default function WhatsAppAutomations() {
  const [replies, setReplies] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [message, setMessage] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchReplies();
  }, []);

  const fetchReplies = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    const { data } = await supabase.from('whatsapp_auto_replies').select('*').eq('business_id', businessId);
    if (data) setReplies(data);
  };

  const handleAdd = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId || !keyword || !message) return;

    await supabase.from('whatsapp_auto_replies').insert({
      business_id: businessId,
      trigger_keyword: keyword,
      reply_message: message,
      active: true
    });

    setKeyword('');
    setMessage('');
    fetchReplies();
    toast({ title: 'Automation added' });
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Bot className="w-6 h-6" /> WhatsApp Automations
      </h1>
      
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8 flex flex-col gap-4 max-w-xl">
        <h3 className="font-semibold text-gray-800">New Auto-Reply</h3>
        <Input placeholder="Trigger Keyword (e.g. price, menu)" value={keyword} onChange={e => setKeyword(e.target.value)}/>
        <Input placeholder="Reply Message" value={message} onChange={e => setMessage(e.target.value)}/>
        <Button onClick={handleAdd} className="w-max"><Plus className="w-4 h-4 mr-2"/> Add Rule</Button>
      </div>

      <div className="space-y-4 max-w-3xl">
        {replies.map(r => (
          <div key={r.id} className="bg-white p-4 border border-gray-200 rounded-lg shadow-sm flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-800 bg-gray-100 w-max px-2 py-1 rounded text-sm mb-2 font-mono">
                WHEN MESSAGE EQUALS: "{r.trigger_keyword}"
              </div>
              <div className="text-sm text-gray-600 pl-2 border-l-4 border-blue-400">
                {r.reply_message}
              </div>
            </div>
            <Button variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={async () => {
              await supabase.from('whatsapp_auto_replies').delete().eq('id', r.id);
              fetchReplies();
            }}>
              <Trash className="w-5 h-5"/>
            </Button>
          </div>
        ))}
        {replies.length === 0 && <p className="text-gray-500">No auto-replies configured yet.</p>}
      </div>
    </div>
  );
}

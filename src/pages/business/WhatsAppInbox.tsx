import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Phone } from 'lucide-react';

export default function WhatsAppInbox() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [instances, setInstances] = useState<any[]>([]);

  useEffect(() => {
    fetchData();

    const channel = supabase.channel('whatsapp_inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        const newMessage = payload.new;
        if (selectedContact && newMessage.contact_id === selectedContact.id) {
          setMessages(prev => [...prev, newMessage]);
        }
        fetchData(); // Refresh list for latest contact sort
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedContact]);

  const fetchData = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    // Fetch instances to map instance messages
    const { data: instData } = await supabase.from('whatsapp_instances').select('*').eq('business_id', businessId);
    if (instData) setInstances(instData);

    // Fetch contacts
    const { data: contactsData } = await supabase.from('whatsapp_contacts').select('*').eq('business_id', businessId);
    if (contactsData) setContacts(contactsData);

    if (selectedContact) {
      const { data: msgData } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('contact_id', selectedContact.id)
        .order('created_at', { ascending: true });
      if (msgData) setMessages(msgData);
    }
  };

  const handleSend = async () => {
    if (!replyText.trim() || !selectedContact) return;
    // Assume sending via the first active instance or the one mapped to the contact
    const instance = instances[0]; 
    if(!instance) return;

    try {
      await whatsappService.sendText(instance.instance_name, selectedContact.phone_number, replyText);
      // Let Evolution API webhook handle real message insert, or optimistically append
      setReplyText('');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-[calc(100vh-80px)] bg-white overflow-hidden rounded-xl shadow-sm border border-gray-100 m-6">
      <div className="w-1/3 border-r border-gray-200 flex flex-col h-full bg-gray-50/50">
        <div className="p-4 border-b bg-white">
          <h2 className="font-bold text-lg flex items-center gap-2"><Phone className="w-5 h-5"/> Inbox</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map(contact => (
            <div 
              key={contact.id} 
              onClick={() => setSelectedContact(contact)}
              className={`p-4 border-b cursor-pointer hover:bg-gray-100 transition ${selectedContact?.id === contact.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
            >
              <div className="font-semibold text-gray-900">{contact.name || contact.phone_number}</div>
              <div className="text-sm text-gray-500 truncate">{contact.phone_number}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-2/3 flex flex-col h-full bg-[#E5DDD5]">
        {selectedContact ? (
          <>
            <div className="p-4 bg-white border-b shadow-sm flex items-center gap-3">
              <div className="font-bold text-lg">{selectedContact.name || selectedContact.phone_number}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-3 rounded-lg shadow-sm ${msg.direction === 'outgoing' ? 'bg-[#dcf8c6] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    {msg.content}
                    <div className="text-[10px] text-gray-500 text-right mt-1">
                      {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 bg-gray-100 flex gap-2">
              <Input 
                value={replyText} 
                onChange={e => setReplyText(e.target.value)} 
                placeholder="Type a message... (use / for fast replies)" 
                className="bg-white rounded-full border-none shadow-sm h-12 px-6"
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <Button onClick={handleSend} className="rounded-full h-12 w-12 p-0 flex items-center justify-center bg-blue-600 hover:bg-blue-700">
                <Send className="w-5 h-5 ml-1" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <Phone className="w-16 h-16 mb-4 text-gray-300" />
            <p className="text-lg">Select a contact to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}

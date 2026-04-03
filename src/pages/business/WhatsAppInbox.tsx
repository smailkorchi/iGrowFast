import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import {
  Search,
  Send,
  Smile,
  Paperclip,
  Mic,
  MoreVertical,
  Phone,
  Video,
  ArrowDown,
  Check,
  CheckCheck,
  Filter,
  Image as ImageIcon,
  Play,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatChatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const dayMs = 86400000;
  if (diff < dayMs && now.getDate() === d.getDate()) return formatTime(dateStr);
  if (diff < dayMs * 2) return 'Yesterday';
  if (diff < dayMs * 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function groupMessagesByDate(msgs: any[]) {
  const groups: { label: string; messages: any[] }[] = [];
  let current = '';
  for (const msg of msgs) {
    const d = new Date(msg.created_at);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const dayMs = 86400000;
    let label: string;
    if (diff < dayMs && now.getDate() === d.getDate()) label = 'TODAY';
    else if (diff < dayMs * 2) label = 'YESTERDAY';
    else label = d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

    if (label !== current) {
      current = label;
      groups.push({ label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

// ── Status ticks ─────────────────────────────────────────────────────────────

function StatusTicks({ status }: { status?: string }) {
  if (!status) return null;
  if (status === 'read')
    return <CheckCheck className="w-[16px] h-[16px] text-[#53bdeb] inline-block ml-1" />;
  if (status === 'delivered')
    return <CheckCheck className="w-[16px] h-[16px] text-[#667781] inline-block ml-1" />;
  if (status === 'sent')
    return <Check className="w-[16px] h-[16px] text-[#667781] inline-block ml-1" />;
  return null;
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: any }) {
  const isOut = msg.direction === 'outgoing';

  const renderMedia = () => {
    if (!msg.media_url) return null;
    const t = msg.type || '';
    if (t === 'imageMessage' || t === 'image')
      return (
        <img
          src={msg.media_url}
          alt=""
          className="rounded-md max-w-full max-h-[300px] object-cover mb-1"
        />
      );
    if (t === 'videoMessage' || t === 'video')
      return (
        <div className="relative rounded-md overflow-hidden mb-1 bg-black/20 flex items-center justify-center h-[200px]">
          <video src={msg.media_url} className="max-w-full max-h-[200px]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
            </div>
          </div>
        </div>
      );
    if (t === 'audioMessage' || t === 'audio')
      return (
        <div className="flex items-center gap-3 min-w-[240px]">
          <button className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center flex-shrink-0">
            <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
          </button>
          <div className="flex-1 h-[6px] bg-[#3b4a54] rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-[#00a884] rounded-full" />
          </div>
          <span className="text-[11px] text-[#8696a0] whitespace-nowrap">0:00</span>
        </div>
      );
    return null;
  };

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-[2px] px-[63px]`}>
      <div
        className={`relative max-w-[65%] px-[9px] pt-[6px] pb-[8px] rounded-[7.5px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
          isOut
            ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none'
            : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
        }`}
      >
        {/* Tail */}
        <span
          className={`absolute top-0 w-[8px] h-[13px] ${
            isOut ? '-right-[8px]' : '-left-[8px]'
          }`}
          style={{
            background: isOut ? '#005c4b' : '#202c33',
            clipPath: isOut
              ? 'polygon(0 0, 0 100%, 100% 0)'
              : 'polygon(100% 0, 0 0, 100% 100%)',
          }}
        />
        {renderMedia()}
        {msg.content && (
          <span className="text-[14.2px] leading-[19px] whitespace-pre-wrap break-words">
            {msg.content}
          </span>
        )}
        <span className="float-right mt-[4px] ml-[8px] flex items-center gap-[2px]">
          <span className="text-[11px] text-[#ffffff99] leading-[15px]">
            {formatTime(msg.created_at)}
          </span>
          {isOut && <StatusTicks status={msg.status} />}
        </span>
      </div>
    </div>
  );
}

// ── Contact list item ────────────────────────────────────────────────────────

function ContactItem({
  contact,
  isActive,
  lastMessage,
  unreadCount,
  onClick,
}: {
  contact: any;
  isActive: boolean;
  lastMessage?: any;
  unreadCount: number;
  onClick: () => void;
}) {
  const displayName = contact.name || contact.phone_number;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[13px] px-[13px] py-[10px] cursor-pointer hover:bg-[#202c33] transition-colors ${
        isActive ? 'bg-[#2a3942]' : ''
      }`}
    >
      {/* Avatar */}
      {contact.profile_pic ? (
        <img
          src={contact.profile_pic}
          alt=""
          className="w-[49px] h-[49px] rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-[49px] h-[49px] rounded-full bg-[#6b7b8d] flex items-center justify-center flex-shrink-0">
          <span className="text-[#d1d7db] text-[17px] font-light">
            {getInitials(displayName)}
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0 border-b border-[#222d34] py-[10px]">
        <div className="flex justify-between items-baseline">
          <span className="text-[17px] text-[#e9edef] truncate leading-[21px]">
            {displayName}
          </span>
          <span
            className={`text-[12px] whitespace-nowrap ml-2 ${
              unreadCount > 0 ? 'text-[#00a884]' : 'text-[#8696a0]'
            }`}
          >
            {lastMessage ? formatChatDate(lastMessage.created_at) : ''}
          </span>
        </div>
        <div className="flex justify-between items-center mt-[2px]">
          <span className="text-[14px] text-[#8696a0] truncate leading-[20px] flex items-center gap-1">
            {lastMessage?.direction === 'outgoing' && (
              <CheckCheck className="w-[16px] h-[16px] inline-block flex-shrink-0 text-[#53bdeb]" />
            )}
            {lastMessage?.content || ''}
          </span>
          {unreadCount > 0 && (
            <span className="bg-[#00a884] text-[#111b21] text-[12px] font-medium rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-[6px] ml-2 flex-shrink-0">
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WhatsAppInbox() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [instances, setInstances] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactLastMessages, setContactLastMessages] = useState<Record<string, any>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('whatsapp_inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          const newMessage = payload.new;
          if (selectedContact && newMessage.contact_id === selectedContact.id) {
            setMessages((prev) => [...prev, newMessage]);
          }
          fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedContact]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchData = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    const { data: instData } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('business_id', businessId);
    if (instData) setInstances(instData);

    const { data: contactsData } = await supabase
      .from('whatsapp_contacts')
      .select('*')
      .eq('business_id', businessId);

    if (contactsData) {
      // Fetch last message for each contact
      const lastMsgs: Record<string, any> = {};
      for (const c of contactsData) {
        const { data: lastMsg } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('contact_id', c.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (lastMsg) lastMsgs[c.id] = lastMsg;
      }
      setContactLastMessages(lastMsgs);

      // Sort contacts by last message time (newest first)
      const sorted = [...contactsData].sort((a, b) => {
        const aTime = lastMsgs[a.id]?.created_at || a.created_at;
        const bTime = lastMsgs[b.id]?.created_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
      setContacts(sorted);
    }

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
    const instance = instances[0];
    if (!instance) return;

    try {
      await whatsappService.sendText(
        instance.instance_name,
        selectedContact.phone_number,
        replyText,
      );
      setReplyText('');
    } catch (e) {
      console.error(e);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      c.phone_number.toLowerCase().includes(q)
    );
  });

  const messageGroups = groupMessagesByDate(messages);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-[#111b21] rounded-2xl">
      {/* ── Left panel: Chat list ──────────────────────────────────────────── */}
      <div className="w-[420px] min-w-[340px] flex flex-col border-r border-[#222d34] bg-[#111b21]">
        {/* Header */}
        <div className="h-[59px] bg-[#202c33] flex items-center justify-between px-4">
          <div className="w-10 h-10 rounded-full bg-[#6b7b8d] flex items-center justify-center">
            <span className="text-[#d1d7db] text-sm">ME</span>
          </div>
          <div className="flex items-center gap-3 text-[#aebac1]">
            <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
              <Filter className="w-[20px] h-[20px]" />
            </button>
            <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
              <MoreVertical className="w-[20px] h-[20px]" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-[10px] py-[7px] bg-[#111b21]">
          <div className="flex items-center bg-[#202c33] rounded-lg h-[35px] px-3 gap-3">
            <Search className="w-[15px] h-[15px] text-[#8696a0]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or start new chat"
              className="bg-transparent text-[13px] text-[#d1d7db] placeholder-[#8696a0] outline-none flex-1"
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-[6px] px-[13px] py-[8px]">
          {['All', 'Unread', 'Favorites'].map((tab) => (
            <button
              key={tab}
              className={`px-3 py-[5px] rounded-full text-[13px] transition-colors ${
                tab === 'All'
                  ? 'bg-[#00a884] text-[#111b21] font-medium'
                  : 'bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Contacts list */}
        <div className="flex-1 overflow-y-auto">
          {filteredContacts.map((contact) => (
            <ContactItem
              key={contact.id}
              contact={contact}
              isActive={selectedContact?.id === contact.id}
              lastMessage={contactLastMessages[contact.id]}
              unreadCount={0}
              onClick={() => setSelectedContact(contact)}
            />
          ))}
          {filteredContacts.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[#8696a0] text-sm">
              No contacts found
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: Chat area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedContact ? (
          <>
            {/* Chat header */}
            <div className="h-[59px] bg-[#202c33] flex items-center justify-between px-4 flex-shrink-0">
              <div className="flex items-center gap-[13px]">
                {selectedContact.profile_pic ? (
                  <img
                    src={selectedContact.profile_pic}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#6b7b8d] flex items-center justify-center">
                    <span className="text-[#d1d7db] text-[15px] font-light">
                      {getInitials(
                        selectedContact.name || selectedContact.phone_number,
                      )}
                    </span>
                  </div>
                )}
                <div>
                  <div className="text-[16px] text-[#e9edef] leading-[21px]">
                    {selectedContact.name || selectedContact.phone_number}
                  </div>
                  <div className="text-[13px] text-[#8696a0] leading-[20px]">
                    {selectedContact.phone_number}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[#aebac1]">
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                  <Video className="w-[20px] h-[20px]" />
                </button>
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                  <Phone className="w-[20px] h-[20px]" />
                </button>
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                  <Search className="w-[20px] h-[20px]" />
                </button>
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors">
                  <MoreVertical className="w-[20px] h-[20px]" />
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto py-[6px]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='300' height='300' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' patternUnits='userSpaceOnUse' width='60' height='60'%3E%3Cpath d='M30 5 L35 15 L30 10 L25 15Z' fill='%23182229' opacity='0.3'/%3E%3Ccircle cx='10' cy='40' r='3' fill='%23182229' opacity='0.2'/%3E%3Ccircle cx='50' cy='30' r='2' fill='%23182229' opacity='0.2'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='300' height='300' fill='%230b141a'/%3E%3Crect width='300' height='300' fill='url(%23p)'/%3E%3C/svg%3E")`,
                backgroundColor: '#0b141a',
              }}
            >
              {messageGroups.map((group, gi) => (
                <div key={gi}>
                  {/* Date separator */}
                  <div className="flex justify-center my-[12px]">
                    <span className="bg-[#182229] text-[#8696a0] text-[12.5px] px-[12px] py-[5px] rounded-[7.5px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                      {group.label}
                    </span>
                  </div>
                  {group.messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="h-[62px] bg-[#202c33] flex items-center gap-[5px] px-[10px] flex-shrink-0">
              <button className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0]">
                <Smile className="w-[24px] h-[24px]" />
              </button>
              <button className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0]">
                <Paperclip className="w-[24px] h-[24px]" />
              </button>
              <div className="flex-1 mx-[5px]">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Type a message"
                  className="w-full bg-[#2a3942] text-[15px] text-[#d1d7db] placeholder-[#8696a0] rounded-lg h-[42px] px-[12px] outline-none border-none"
                />
              </div>
              {replyText.trim() ? (
                <button
                  onClick={handleSend}
                  className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0]"
                >
                  <Send className="w-[24px] h-[24px]" />
                </button>
              ) : (
                <button className="p-2 hover:bg-[#374045] rounded-full transition-colors text-[#8696a0]">
                  <Mic className="w-[24px] h-[24px]" />
                </button>
              )}
            </div>
          </>
        ) : (
          /* ── Empty state ─────────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center bg-[#222e35] border-b-[6px] border-b-[#00a884]">
            <div className="w-[320px] text-center">
              <div className="mx-auto mb-[38px]">
                <svg
                  viewBox="0 0 303 172"
                  width="320"
                  className="text-[#364147]"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <path
                    fill="currentColor"
                    d="M229.565 160.229c32.647-10.984 57.366-41.988 53.825-86.81C279.376 22.166 241.886-5.1 189.42.89c-28.093 3.208-54.519 17.733-69.493 28.18-11.618 8.108-22.067 17.917-30.86 29.209a141.592 141.592 0 00-7.672 11.344c-21.39-6.062-39.2-8.098-50.478-4.479-18.2 5.839-28.15 17.397-25.132 41.28 3.254 25.738 29.412 44.106 54.89 49.543 17.993 3.843 34.587 2.456 46.609-2.312 3.112 1.341 6.34 2.595 9.634 3.809l-.035-.071c7.973 2.921 16.283 5.394 24.353 7.755 26.155 7.651 52.518 15.381 47.834 20.253-.928 1.135 2.942-5.429 3.141-5.834 2.955-6.028 7.622-8.248 8.073-5.854.517 2.73-8.659 6.652-7.676 10.741.983 4.088 14.555-2.882 32.481-12.56a138.321 138.321 0 0014.975-8.578c-18.265 11.467-37.807 15.236-61.324 3.713z"
                  />
                </svg>
              </div>
              <h1 className="text-[32px] font-light text-[#e9edef] mb-[14px] leading-[40px]">
                WhatsApp Web
              </h1>
              <p className="text-[14px] text-[#8696a0] leading-[20px]">
                Send and receive messages without keeping your phone online.
                <br />
                Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
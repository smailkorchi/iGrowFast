import { supabase } from '../supabase';

export const whatsappService = {
  // ── Edge function proxy (Evolution API actions) ─────────────────────
  async invokeClient(action: string, payload: any = {}) {
    const { data, error } = await supabase.functions.invoke('evolution-client', {
      body: { action, payload }
    });

    if (error) {
      console.error("FunctionsHttpError details:", error);
      let errMsg = error.message;
      try {
        if (error.context) {
          const errData = await error.context.json();
          errMsg = errData?.error || errData?.message || JSON.stringify(errData);
        }
      } catch (e) {}
      throw new Error(errMsg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },

  // ── Instance lifecycle ──────────────────────────────────────────────
  async createInstance(instanceName: string) {
    return this.invokeClient('create-instance', {
      instanceName,
      integration: "WHATSAPP-BAILEYS"
    });
  },

  async getQrCode(instanceName: string) {
    return this.invokeClient('get-qr', { instanceName });
  },

  async deleteInstance(instanceName: string) {
    return this.invokeClient('delete-instance', { instanceName });
  },

  // ── Webhook management ──────────────────────────────────────────────
  async setWebhook(instanceName: string) {
    return this.invokeClient('set-webhook', { instanceName });
  },

  async findWebhook(instanceName: string) {
    return this.invokeClient('find-webhook', { instanceName });
  },

  // ── Sending (still via Evolution API) ───────────────────────────────
  async sendText(instanceName: string, number: string, text: string) {
    return this.invokeClient('send-text', {
      instanceName,
      number,
      text,
      delay: 1200,
      linkPreview: false,
    });
  },

  async sendMedia(instanceName: string, number: string, mediaData: { type: string, url: string, caption?: string }) {
    return this.invokeClient('send-media', {
      instanceName,
      number,
      options: { delay: 1200, presence: "composing" },
      mediaMessage: {
        mediatype: mediaData.type,
        caption: mediaData.caption || "",
        media: mediaData.url
      }
    });
  },

  async sendAudio(instanceName: string, number: string, audioBase64: string) {
    return this.invokeClient('send-audio', { instanceName, number, audio: audioBase64 });
  },

  async sendReaction(instanceName: string, key: { remoteJid: string; fromMe: boolean; id: string }, reaction: string) {
    return this.invokeClient('send-reaction', { instanceName, key, reaction });
  },

  async deleteMessage(instanceName: string, messageId: string, fromMe: boolean, remoteJid: string) {
    return this.invokeClient('delete-message', { instanceName, messageId, fromMe, remoteJid });
  },

  async markChatRead(instanceName: string, lastMessageKey: { remoteJid: string; fromMe: boolean; id: string }) {
    return this.invokeClient('mark-chat-read', { instanceName, lastMessageKey });
  },

  // ── Media retrieval (still via Evolution API) ───────────────────────
  async getMedia(instanceName: string, key: { remoteJid: string; fromMe: boolean; id: string }) {
    return this.invokeClient('get-media', { instanceName, key });
  },

  // ── Evolution API reads (kept for search & backfill only) ───────────
  async findMessages(instanceName: string, remoteJid: string, limit = 50, page?: number) {
    return this.invokeClient('find-messages', {
      instanceName,
      where: { key: { remoteJid } },
      limit,
      ...(page ? { page } : {}),
    });
  },

  async syncContacts(instanceName: string) {
    return this.invokeClient('sync-contacts', { instanceName });
  },

  async syncChats(instanceName: string) {
    return this.invokeClient('sync-chats', { instanceName });
  },
};

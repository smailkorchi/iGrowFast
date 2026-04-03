import { supabase } from '../supabase'; // Assuming there's a supabase client exported here

export const whatsappService = {
  /**
   * Invokes the evolution-client edge function 
   */
  async invokeClient(action: string, payload: any = {}) {
    const { data, error } = await supabase.functions.invoke('evolution-client', {
      body: { action, payload }
    });
    
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async createInstance(instanceName: string) {
    return this.invokeClient('create-instance', { instanceName });
  },

  async getQrCode(instanceName: string) {
    return this.invokeClient('get-qr', { instanceName });
  },

  async deleteInstance(instanceName: string) {
    return this.invokeClient('delete-instance', { instanceName });
  },

  async sendText(instanceName: string, number: string, text: string) {
    return this.invokeClient('send-text', {
      instanceName,
      number,
      options: {
        delay: 1200,
        presence: "composing",
        linkPreview: false
      },
      textMessage: { text }
    });
  },

  async sendMedia(instanceName: string, number: string, mediaData: { type: string, url: string, caption?: string }) {
    return this.invokeClient('send-media', {
      instanceName,
      number,
      options: {
        delay: 1200,
        presence: "composing"
      },
      mediaMessage: {
        mediatype: mediaData.type, // 'image', 'video', 'audio', 'document'
        caption: mediaData.caption || "",
        media: mediaData.url // expects base64 or URL
      }
    });
  }
};

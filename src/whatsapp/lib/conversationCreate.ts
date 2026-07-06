// Client wrapper for the ensure_conversation RPC.
//
// Used by the "Vous" quick-action and the dial-pad in the new-chat view to
// create-or-open a conversation row for an arbitrary JID without waiting for
// an inbound webhook. The RPC is idempotent — it returns the existing row's
// id when one already exists.

import { supabase } from './supabase'

export interface EnsureConversationArgs {
  instanceId: string
  remoteJid: string
  peerDisplayName?: string | null
  peerProfilePic?: string | null
}

export async function ensureConversation(args: EnsureConversationArgs): Promise<string> {
  const { data, error } = await supabase.schema('whatsapp').rpc('ensure_conversation', {
    p_instance_id:        args.instanceId,
    p_remote_jid:         args.remoteJid,
    p_peer_display_name:  args.peerDisplayName ?? undefined,
    p_peer_profile_pic:   args.peerProfilePic ?? undefined,
  })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string') throw new Error('ensure_conversation: invalid response')
  return data
}

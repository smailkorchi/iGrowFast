// Per-node Evolution routing (fleet sharding, Blocker #2 Half B).
//
// Each WhatsApp number lives on exactly one Evolution node (whatsapp_instances.node_id
// → whatsapp.wa_nodes). The edge runtime reaches a node's Evolution over the tailnet at
// the node's own base URL, stored ENCRYPTED in wa_nodes.base_url_ct and revealed by the
// service-role SECDEF fn whatsapp.reveal_node_base_url(). This resolver turns a node_id
// into that base URL so every lifecycle edge fn calls the RIGHT node's Evolution instead
// of one hardcoded EVOLUTION_API_URL.
//
// FALLBACK: when an instance has no node (legacy/null node_id) or the node has no stored
// URL, we fall back to the env EVOLUTION_API_URL — i.e. exactly today's behavior. On the
// current single node this makes the whole change a functional no-op: node 24's stored
// URL already equals EVOLUTION_API_URL.

import { admin } from './admin.ts'

const ENV_FALLBACK = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/$/, '')

/** Resolve the Evolution base URL for a node_id (trailing slash stripped).
 *  Returns the env EVOLUTION_API_URL when node_id is null/unknown or has no
 *  stored URL, so pre-sharding instances behave identically. */
export async function resolveNodeBaseUrl(nodeId: number | null | undefined): Promise<string> {
  if (nodeId == null) return ENV_FALLBACK
  const { data, error } = await admin
    .schema('whatsapp')
    .rpc('reveal_node_base_url', { p_node_id: nodeId })
  if (error || typeof data !== 'string' || data.trim() === '') return ENV_FALLBACK
  return data.replace(/\/$/, '')
}

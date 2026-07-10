// Conversations page mutation API. Thin wrappers over the SECURITY DEFINER
// RPCs introduced in F1.9 + F1.10. All calls flow through supabase-js using
// the caller's JWT, so server-side ACLs (admin OR assigned agent) apply.

import { supabase } from './supabase'
import type { ConversationStatus, MessageKind } from './database.types'
import type { MessageStep } from './queries/quickReplies'

// ─── send-side RPCs ────────────────────────────────────────────────────────

export interface SendMessageArgs {
  conversationId: string
  body?: string
  kind?: MessageKind
  replyTo?: string
  /** R2 object key from uploadChatMedia(). Required for media kinds. */
  mediaStorageKey?: string
  /** Defaults to 'wamancer-media' server-side; pass only for test buckets. */
  mediaStorageBucket?: string
  /** Mime type Evolution needs to wrap the payload correctly. */
  mediaMime?: string
  /** Size in bytes — purely informational, surfaced in bubble metadata. */
  mediaSizeBytes?: number
  mediaMeta?: Record<string, unknown>
  ptt?: boolean
  forwardFrom?: string
  pollOptions?: string[]
  /** Send source. Drives the dispatcher's typing pre-roll: 'quick_reply' and
   *  'scheduled' show a typing indicator (no human typed live); typed
   *  'interactive' sends already emit live composer typing so they don't. */
  origin?: 'interactive' | 'quick_reply' | 'scheduled' | 'forward' | 'batch' | 'auto'
  /** Optional UUID for server-side dedup. If omitted, generated client-side
   *  per call. Same key → same conversation → returns existing message_id
   *  without enqueuing again. Defends against double-click + network retries. */
  idempotencyKey?: string
}

export interface SendMessageResult {
  message_id: string
  queue_id: string
  enqueued_at: string
  status: 'PENDING'
  /** True when the call returned an existing message (idempotency hit). */
  duplicate?: boolean
}

export async function sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
  const idempotencyKey = args.idempotencyKey ?? crypto.randomUUID()
  const rpcArgs = {
    p_conversation_id:      args.conversationId,
    p_body:                 args.body ?? undefined,
    p_kind:                 args.kind ?? 'text',
    p_reply_to:             args.replyTo ?? undefined,
    p_media_storage_key:    args.mediaStorageKey ?? undefined,
    p_media_storage_bucket: args.mediaStorageBucket ?? undefined,
    p_media_mime:           args.mediaMime ?? undefined,
    p_media_size_bytes:     args.mediaSizeBytes ?? undefined,
    p_media_meta:           (args.mediaMeta as unknown as never) ?? undefined,
    p_ptt:                  args.ptt ?? false,
    p_forward_from:         args.forwardFrom ?? undefined,
    p_poll_options:         args.pollOptions ? (args.pollOptions as unknown as never) : undefined,
    p_idempotency_key:      idempotencyKey,
    p_origin:               args.origin ?? undefined,
  }
  // p_idempotency_key is a new RPC parameter (added 2026-05-28 migration);
  // database.types.ts hasn't been regenerated yet, so cast to bypass the stale
  // signature check. The RPC accepts it server-side (default NULL otherwise).
  const { data, error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'send_message',
    rpcArgs,
  )
  if (error) throw new Error(error.message)
  return data as unknown as SendMessageResult
}

// ─── Node-sequence dispatch (quick replies / scheduled-message preview) ──────
//
// Map one authoring node ("step") to a sendMessage() call. voice → audio voice
// note (ptt), audio_file → audio document (no ptt). All carry origin so the
// dispatcher applies canned-origin humanization (modality presence + burst
// spacing + media-hash variation).
export function stepToSendArgs(step: MessageStep, conversationId: string): SendMessageArgs {
  if (step.type === 'text') {
    return { conversationId, body: step.body, kind: 'text', origin: 'quick_reply' }
  }
  const isAudio = step.type === 'voice' || step.type === 'audio_file'
  const ptt = step.type === 'voice'
  const kind: MessageKind =
    step.type === 'voice' || step.type === 'audio_file' ? 'audio'
      : step.type === 'image' ? 'image'
        : step.type === 'video' ? 'video'
          : 'document'
  return {
    conversationId,
    kind,
    mediaStorageKey: step.r2_key,
    mediaStorageBucket: step.r2_bucket,
    mediaMime: step.mime,
    mediaSizeBytes: step.size_bytes,
    // Persist ptt + clip length into media_meta: ptt drives our own thread's
    // voice-note-vs-audio-file rendering; seconds sizes the worker's
    // "recording…" presence window for voice notes.
    mediaMeta: {
      fileName: step.file_name,
      ...(isAudio ? { ptt, ...(step.seconds ? { seconds: step.seconds } : {}) } : {}),
    },
    ...(isAudio ? { ptt } : {}),
    origin: 'quick_reply',
  }
}

// Dispatch an ordered node sequence one message at a time, in saved order.
// Sequential awaits guarantee outbound_queue.seq increments in step order, so
// the worker drains them in exactly this order. Blank text nodes are skipped.
export async function sendStepSequence(
  conversationId: string,
  steps: MessageStep[],
): Promise<void> {
  for (const step of steps) {
    if (step.type === 'text' && !step.body.trim()) continue
    await sendMessage(stepToSendArgs(step, conversationId))
  }
}

// Cancel a queued/failed outbound message. Server-side authorize: admin OR
// the agent who sent it. Idempotent on already-cancelled messages.
export async function cancelOutboundMessage(messageId: string): Promise<void> {
  const { error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)(
    'cancel_outbound_message',
    { p_message_id: messageId },
  )
  if (error) throw new Error(error.message)
}

// Edit an outbound text message (within WhatsApp's 15-min window). Server
// re-enforces direction/kind/window; throws the typed error code on rejection
// (edit_window_expired, can_only_edit_text_kind, already_revoked, …).
export async function editMessage(messageId: string, newText: string): Promise<void> {
  const { error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)(
    'edit_message',
    { p_message_id: messageId, p_new_text: newText },
  )
  if (error) throw new Error(error.message)
}

// Delete-for-everyone: revoke on WhatsApp via the dispatcher (outbound, ≤60h).
export async function deleteMessageForEveryone(messageId: string): Promise<void> {
  const { error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)(
    'delete_message',
    { p_message_id: messageId, p_scope: 'everyone' },
  )
  if (error) throw new Error(error.message)
}

// Delete-for-me: app-local hide for the calling agent only. No WhatsApp call;
// works for any message (inbound/outbound, any age).
export async function deleteMessageForMe(messageId: string): Promise<void> {
  const { error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)(
    'delete_message',
    { p_message_id: messageId, p_scope: 'me' },
  )
  if (error) throw new Error(error.message)
}

// Punch the schedule gate (business_hours window) for 60s and wake the
// dispatcher. Cap gates still apply — agents can't bypass ban-risk caps.
export async function forceDispatchNow(messageId: string): Promise<void> {
  const { error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)(
    'force_dispatch_now',
    { p_message_id: messageId },
  )
  if (error) throw new Error(error.message)
}

export async function sendReaction(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('send_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  })
  if (error) throw new Error(error.message)
}

export async function sendTyping(
  conversationId: string,
  state: 'composing' | 'recording' | 'paused',
): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('send_typing', {
    p_conversation_id: conversationId,
    p_state: state,
  })
  if (error) throw new Error(error.message)
}

export async function sendReadReceipt(conversationId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('send_read_receipt', {
    p_conversation_id: conversationId,
  })
  if (error) throw new Error(error.message)
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  })
  if (error) throw new Error(error.message)
}

// Inverse of markConversationRead: flags the conversation unread (server bumps
// unread_count to at least 1, never clobbers a real backlog). Same gate as
// mark-read (_assert_conversation_access), so agents can use it too.
export async function markConversationUnread(conversationId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('mark_conversation_unread', {
    p_conversation_id: conversationId,
  })
  if (error) throw new Error(error.message)
}

// ─── bulk instance-wide ops (mig 064) ──────────────────────────────────────
// One RPC = one set-based statement server-side; the caller scope is resolved
// there (admin = every conversation of the instance, agent = assigned-only)
// and the bump/delete row triggers live-sync every open client. Mark read/
// unread are open to anyone who can use the instance; clear/delete are
// admin-gated (mirrors the per-conversation clear/delete gates). Each returns
// the number of conversations touched.

export async function markAllConversationsRead(instanceId: string): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('conversations_mark_all_read', {
    p_instance_id: instanceId,
  })
  if (error) throw new Error(error.message)
  return (data as unknown as number) ?? 0
}

export async function markAllConversationsUnread(instanceId: string): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('conversations_mark_all_unread', {
    p_instance_id: instanceId,
  })
  if (error) throw new Error(error.message)
  return (data as unknown as number) ?? 0
}

// Destructive bulk ops go through the conversation-cleanup EDGE FN, never the
// bare RPC: the edge fn runs the bulk purge preflight, wipes the R2 media
// batches FIRST (else every media object of the instance orphans in the
// bucket — no GC cron exists), then calls the mig 064 RPC, then (delete_all)
// purge_peer's the worker cache. Same pipeline as the per-conversation
// clear/delete in queries/conversations.ts.
async function invokeBulkCleanup(instanceId: string, mode: 'clear_all' | 'delete_all'): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean; reason?: string; error?: string
    summary?: { db_result?: unknown }
  }>('conversation-cleanup', { body: { instance_id: instanceId, mode } })
  if (error) throw new Error(`conversation-cleanup ${mode} failed: ${error.message}`)
  if (!data?.ok) throw new Error(data?.reason || data?.error || `conversation-cleanup ${mode} returned not-ok`)
  return (data.summary?.db_result as number) ?? 0
}

export function clearAllConversations(instanceId: string): Promise<number> {
  return invokeBulkCleanup(instanceId, 'clear_all')
}

export function deleteAllConversations(instanceId: string): Promise<number> {
  return invokeBulkCleanup(instanceId, 'delete_all')
}

// ─── assignment / status / pin / archive / star ────────────────────────────

export async function assignConversation(conversationId: string, userIds: string[]): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('assign_conversation', {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  })
  if (error) throw new Error(error.message)
}

export async function claimConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('claim_conversation', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message)
}

export async function unassignConversation(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('unassign_conversation', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
}

export async function updateConversationStatus(
  conversationId: string,
  status: ConversationStatus,
  snoozedUntil?: string,
): Promise<void> {
  const { error } = await supabase.schema('whatsapp').rpc('update_conversation_status', {
    p_conversation_id: conversationId,
    p_status: status,
    p_snoozed_until: snoozedUntil ?? undefined,
  })
  if (error) throw new Error(error.message)
}

export async function togglePin(conversationId: string): Promise<{ is_pinned: boolean }> {
  const { data, error } = await supabase.schema('whatsapp').rpc('toggle_pin', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message)
  return data as unknown as { is_pinned: boolean }
}

export async function toggleArchive(conversationId: string): Promise<{ is_archived: boolean }> {
  const { data, error } = await supabase.schema('whatsapp').rpc('toggle_archive', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message)
  return data as unknown as { is_archived: boolean }
}

export async function toggleStar(messageId: string): Promise<{ is_starred: boolean }> {
  const { data, error } = await supabase.schema('whatsapp').rpc('toggle_star', { p_message_id: messageId })
  if (error) throw new Error(error.message)
  return data as unknown as { is_starred: boolean }
}

// App-local, team-shared message pin (distinct from togglePin above, which is
// the chat-list conversation pin). Pin never reaches WhatsApp — no Evolution
// endpoint — it's a shared annotation surfaced via the pinned bar + bubble glyph.
// expiresAt = ISO timestamp for auto-unpin (24h/7d/30d), or null = forever.
// A per-minute cron flips expired pins off.
export async function setMessagePin(
  messageId: string,
  pinned: boolean,
  expiresAt?: string | null,
): Promise<{ is_pinned: boolean }> {
  const { data, error } = await (supabase.schema('whatsapp').rpc as Function)('set_message_pin', {
    p_message_id: messageId,
    p_pinned: pinned,
    p_expires_at: expiresAt ?? null,
  })
  if (error) throw new Error(error.message)
  return data as unknown as { is_pinned: boolean }
}

export interface ForwardResult { results: Array<{ conversation_id: string; ok: boolean; message_id?: string; error?: string }> }

export async function forwardMessage(messageId: string, targetConversationIds: string[]): Promise<ForwardResult> {
  const { data, error } = await supabase.schema('whatsapp').rpc('forward_message', {
    p_message_id: messageId,
    p_target_conv_ids: targetConversationIds,
  })
  if (error) throw new Error(error.message)
  return data as unknown as ForwardResult
}

// ─── R2 upload ────────────────────────────────────────────────────────────
//
// Outbound media path:
//   1. Frontend calls media-upload edge function with conv id + mime + size.
//   2. Edge function checks RLS, mints a 15-min presigned PUT URL, returns it.
//   3. Frontend PUTs the file directly to R2 (browser → R2, never via VPS).
//   4. Frontend calls sendMessage with the returned key + bucket + mime.
//   5. Dispatcher reads the key, pulls bytes from R2, posts to Evolution.
//
// R2 has zero egress so the dispatcher's read is free. The browser PUT goes
// straight to R2 — Supabase Storage is no longer involved for chat media.

export interface UploadMediaResult {
  /** Bucket name (defaults to 'wamancer-media'). */
  bucket: string
  /** R2 object key: <instance_id>/<conv_id>/<draft_uuid>.<ext>. */
  key: string
  mime: string
  size: number
  fileName: string
}

interface MediaUploadResponse {
  ok:         boolean
  bucket?:    string
  key?:       string
  url?:       string
  expires_at?:string
  max_bytes?: number
  reason?:    string
}

export class MediaUploadError extends Error {
  override readonly name = 'MediaUploadError'
  readonly reason: string
  constructor(reason: string, message?: string) {
    super(message ?? reason)
    this.reason = reason
  }
}

/**
 * Upload a file (or Blob from MediaRecorder) directly to Cloudflare R2 via a
 * presigned PUT URL minted by the media-upload edge function. Returns the
 * R2 key to feed into sendMessage().
 *
 * Throws MediaUploadError on RLS/size/mime rejection; throws Error on
 * underlying network / R2 PUT failure.
 */
export async function uploadChatMedia(
  conversationId: string,
  file: Blob,
  options: { fileName?: string; contentType?: string } = {},
): Promise<UploadMediaResult> {
  const mime = options.contentType ?? file.type ?? 'application/octet-stream'
  const size = (file as { size?: number }).size ?? 0
  if (!size) throw new MediaUploadError('invalid_input', 'file size is 0')

  // 1) Ask the edge function for a presigned PUT URL.
  const { data, error } = await supabase.functions.invoke<MediaUploadResponse>('media-upload', {
    body: {
      conversation_id: conversationId,
      mime,
      size_bytes: size,
    },
  })
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<MediaUploadResponse> } }).context
    const body = await ctx?.json?.().catch(() => undefined)
    throw new MediaUploadError(body?.reason ?? 'sign_failed', error.message)
  }
  if (!data?.ok || !data.url || !data.key || !data.bucket) {
    throw new MediaUploadError(data?.reason ?? 'sign_failed')
  }

  // 2) PUT the bytes straight to R2. Content-Type and Content-Length MUST
  // match what the edge function signed -- R2 verifies headers in SigV4.
  const putRes = await fetch(data.url, {
    method:  'PUT',
    body:    file,
    headers: {
      'Content-Type':   mime,
      'Content-Length': String(size),
    },
  })
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    throw new Error(`r2 put failed: ${putRes.status} ${text.slice(0, 200)}`)
  }

  // Derive a filename for media_meta display. R2 doesn't care — Evolution
  // uses it for documents, and the frontend shows it in DocumentBody.
  const fileName = options.fileName ?? deriveFileName(data.key, mime)
  return {
    bucket:   data.bucket,
    key:      data.key,
    mime,
    size,
    fileName,
  }
}

function deriveFileName(key: string, mime: string): string {
  const last = key.split('/').pop() ?? `media.${mime.split('/')[1] ?? 'bin'}`
  return last
}

/**
 * Upload a rendered document-preview thumbnail (JPEG) to R2 under a key derived
 * from the message's media key (`<media_key>.preview.jpg`). The edge function
 * RLS-gates this by message access. Idempotent — re-uploads just overwrite.
 * Used by the chat thread so a document is rendered to a preview ONCE and then
 * cached for every agent (zero re-render, zero VPS load).
 */
export async function uploadDocPreview(messageId: string, jpeg: Blob): Promise<void> {
  const { data, error } = await supabase.functions.invoke<MediaUploadResponse>('media-upload', {
    body: { purpose: 'doc_preview', message_id: messageId, mime: 'image/jpeg', size_bytes: jpeg.size },
  })
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<MediaUploadResponse> } }).context
    const body = await ctx?.json?.().catch(() => undefined)
    throw new MediaUploadError(body?.reason ?? 'sign_failed', error.message)
  }
  if (!data?.ok || !data.url) throw new MediaUploadError(data?.reason ?? 'sign_failed')
  const put = await fetch(data.url, {
    method: 'PUT',
    body: jpeg,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.size) },
  })
  if (!put.ok) throw new Error(`r2 preview put failed: ${put.status}`)
}

// ─── conversation_notes (direct CRUD via RLS) ─────────────────────────────

export async function createNote(conversationId: string, body: string, mentions: string[] = []): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not authenticated')
  const { error } = await supabase.schema('whatsapp').from('conversation_notes').insert({
    conversation_id: conversationId,
    body,
    mentions,
    author_id: user.id,
  })
  if (error) throw new Error(error.message)
}

export async function updateNote(noteId: string, body: string, pinned?: boolean): Promise<void> {
  const patch: { body: string; pinned?: boolean } = { body }
  if (typeof pinned === 'boolean') patch.pinned = pinned
  const { error } = await supabase.schema('whatsapp').from('conversation_notes').update(patch).eq('id', noteId)
  if (error) throw new Error(error.message)
}

export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase.schema('whatsapp').from('conversation_notes').delete().eq('id', noteId)
  if (error) throw new Error(error.message)
}

// (Legacy text-based conversation_tags helpers were removed when the schema
// migrated to a tag_id FK. The current tag system lives in queries/tags.ts.)

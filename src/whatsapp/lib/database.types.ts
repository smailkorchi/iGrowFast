// PORTED 1:1 from WA Mancer src/lib/database.types.ts. ONLY change: schema key public->whatsapp
// (WA Mancer's public block = WA tables only). Runtime routing is via .schema('whatsapp').
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  whatsapp: {
    Tables: {
      audit_log: {
        Row: {
          actor_uid: string | null
          event_type: string
          id: number
          occurred_at: string
          payload: Json
          prev_hash: string
          target_id: string | null
          target_type: string | null
          this_hash: string
        }
        Insert: {
          actor_uid?: string | null
          event_type: string
          id?: number
          occurred_at?: string
          payload?: Json
          prev_hash: string
          target_id?: string | null
          target_type?: string | null
          this_hash: string
        }
        Update: {
          actor_uid?: string | null
          event_type?: string
          id?: number
          occurred_at?: string
          payload?: Json
          prev_hash?: string
          target_id?: string | null
          target_type?: string | null
          this_hash?: string
        }
        Relationships: []
      }
      contact_profiles: {
        Row: {
          instance_id: string
          jid: string
          profile_pic: string | null
          push_name: string | null
          updated_at: string
        }
        Insert: {
          instance_id: string
          jid: string
          profile_pic?: string | null
          push_name?: string | null
          updated_at?: string
        }
        Update: {
          instance_id?: string
          jid?: string
          profile_pic?: string | null
          push_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_profiles_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          book_name: string | null
          created_at: string
          id: string
          instance_id: string
          is_resolved: boolean
          lid: string | null
          phone_jid: string | null
          phone_number: string | null
          profile_pic: string | null
          push_name: string | null
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          book_name?: string | null
          created_at?: string
          id?: string
          instance_id: string
          is_resolved?: boolean
          lid?: string | null
          phone_jid?: string | null
          phone_number?: string | null
          profile_pic?: string | null
          push_name?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          book_name?: string | null
          created_at?: string
          id?: string
          instance_id?: string
          is_resolved?: boolean
          lid?: string | null
          phone_jid?: string | null
          phone_number?: string | null
          profile_pic?: string | null
          push_name?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          conversation_id: string
          is_group: boolean
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          conversation_id: string
          is_group?: boolean
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          conversation_id?: string
          is_group?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_notes: {
        Row: {
          author_id: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          mentions: string[]
          pinned: boolean
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          mentions?: string[]
          pinned?: boolean
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mentions?: string[]
          pinned?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          tag_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          tag_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          instance_id: string
          is_archived: boolean
          is_group: boolean
          is_pinned: boolean
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction:
            | Database["whatsapp"]["Enums"]["message_direction"]
            | null
          last_message_kind: Database["whatsapp"]["Enums"]["message_kind"] | null
          last_message_media_meta: Json | null
          last_message_preview_ct: string | null
          last_message_sender_name: string | null
          last_outbound_at: string | null
          peer_display_name: string | null
          peer_profile_pic: string | null
          remote_jid: string
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          instance_id: string
          is_archived?: boolean
          is_group?: boolean
          is_pinned?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?:
            | Database["whatsapp"]["Enums"]["message_direction"]
            | null
          last_message_kind?: Database["whatsapp"]["Enums"]["message_kind"] | null
          last_message_media_meta?: Json | null
          last_message_preview_ct?: string | null
          last_message_sender_name?: string | null
          last_outbound_at?: string | null
          peer_display_name?: string | null
          peer_profile_pic?: string | null
          remote_jid: string
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          instance_id?: string
          is_archived?: boolean
          is_group?: boolean
          is_pinned?: boolean
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?:
            | Database["whatsapp"]["Enums"]["message_direction"]
            | null
          last_message_kind?: Database["whatsapp"]["Enums"]["message_kind"] | null
          last_message_media_meta?: Json | null
          last_message_preview_ct?: string | null
          last_message_sender_name?: string | null
          last_outbound_at?: string | null
          peer_display_name?: string | null
          peer_profile_pic?: string | null
          remote_jid?: string
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      group_participants: {
        Row: {
          admin_level: string | null
          group_jid: string
          instance_id: string
          participant_jid: string
          phone_jid: string | null
          profile_pic: string | null
          push_name: string | null
          updated_at: string
        }
        Insert: {
          admin_level?: string | null
          group_jid: string
          instance_id: string
          participant_jid: string
          phone_jid?: string | null
          profile_pic?: string | null
          push_name?: string | null
          updated_at?: string
        }
        Update: {
          admin_level?: string | null
          group_jid?: string
          instance_id?: string
          participant_jid?: string
          phone_jid?: string | null
          profile_pic?: string | null
          push_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          claimed_at: string | null
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string
          email: string | null
          expires_at: string
          failed_attempts: number
          full_name: string | null
          id: string
          revoked_at: string | null
          revoked_by: string | null
          target_role: Database["whatsapp"]["Enums"]["user_role"]
          token_hash: string
        }
        Insert: {
          claimed_at?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          expires_at?: string
          failed_attempts?: number
          full_name?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          target_role: Database["whatsapp"]["Enums"]["user_role"]
          token_hash: string
        }
        Update: {
          claimed_at?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string
          failed_attempts?: number
          full_name?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          target_role?: Database["whatsapp"]["Enums"]["user_role"]
          token_hash?: string
        }
        Relationships: []
      }
      jid_mapping: {
        Row: {
          discovered_at: string
          instance_id: string
          lid: string
          phone_jid: string
          source: string
        }
        Insert: {
          discovered_at?: string
          instance_id: string
          lid: string
          phone_jid: string
          source: string
        }
        Update: {
          discovered_at?: string
          instance_id?: string
          lid?: string
          phone_jid?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "jid_mapping_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      media_fetch_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          evolution_message_id: string
          id: number
          instance_id: string
          kind: Database["whatsapp"]["Enums"]["message_kind"]
          last_error: string | null
          message_id: string
          next_attempt_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          evolution_message_id: string
          id?: number
          instance_id: string
          kind: Database["whatsapp"]["Enums"]["message_kind"]
          last_error?: string | null
          message_id: string
          next_attempt_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          evolution_message_id?: string
          id?: number
          instance_id?: string
          kind?: Database["whatsapp"]["Enums"]["message_kind"]
          last_error?: string | null
          message_id?: string
          next_attempt_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_fetch_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_fetch_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_fetch_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages_decrypted"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          scope: string
          updated_at: string
          variables: string[]
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          scope: string
          updated_at?: string
          variables?: string[]
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          scope?: string
          updated_at?: string
          variables?: string[]
        }
        Relationships: []
      }
      messages: {
        Row: {
          body_ciphertext: string | null
          conversation_id: string
          created_at: string
          delivery_status: string | null
          direction: Database["whatsapp"]["Enums"]["message_direction"]
          evolution_message_id: string | null
          forwarded: boolean
          forwarding_score: number
          id: string
          instance_id: string
          is_starred: boolean
          kind: Database["whatsapp"]["Enums"]["message_kind"]
          media_meta: Json | null
          media_mime: string | null
          media_pending: boolean
          media_sha256: string | null
          media_size_bytes: number | null
          media_storage_bucket: string | null
          media_storage_key: string | null
          media_uploaded_at: string | null
          reactions: Json
          reply_to_message_id: string | null
          sender_jid: string | null
          sent_by_agent_id: string | null
          whatsapp_timestamp: string
        }
        Insert: {
          body_ciphertext?: string | null
          conversation_id: string
          created_at?: string
          delivery_status?: string | null
          direction: Database["whatsapp"]["Enums"]["message_direction"]
          evolution_message_id?: string | null
          forwarded?: boolean
          forwarding_score?: number
          id?: string
          instance_id: string
          is_starred?: boolean
          kind?: Database["whatsapp"]["Enums"]["message_kind"]
          media_meta?: Json | null
          media_mime?: string | null
          media_pending?: boolean
          media_sha256?: string | null
          media_size_bytes?: number | null
          media_storage_bucket?: string | null
          media_storage_key?: string | null
          media_uploaded_at?: string | null
          reactions?: Json
          reply_to_message_id?: string | null
          sender_jid?: string | null
          sent_by_agent_id?: string | null
          whatsapp_timestamp: string
        }
        Update: {
          body_ciphertext?: string | null
          conversation_id?: string
          created_at?: string
          delivery_status?: string | null
          direction?: Database["whatsapp"]["Enums"]["message_direction"]
          evolution_message_id?: string | null
          forwarded?: boolean
          forwarding_score?: number
          id?: string
          instance_id?: string
          is_starred?: boolean
          kind?: Database["whatsapp"]["Enums"]["message_kind"]
          media_meta?: Json | null
          media_mime?: string | null
          media_pending?: boolean
          media_sha256?: string | null
          media_size_bytes?: number | null
          media_storage_bucket?: string | null
          media_storage_key?: string | null
          media_uploaded_at?: string | null
          reactions?: Json
          reply_to_message_id?: string | null
          sender_jid?: string | null
          sent_by_agent_id?: string | null
          whatsapp_timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages_decrypted"
            referencedColumns: ["id"]
          },
        ]
      }
      number_pacing_state: {
        Row: {
          last_completed_at: string | null
          last_dispatched_at: string | null
          last_send_at: string | null
          number_id: string
          updated_at: string
        }
        Insert: {
          last_completed_at?: string | null
          last_dispatched_at?: string | null
          last_send_at?: string | null
          number_id: string
          updated_at?: string
        }
        Update: {
          last_completed_at?: string | null
          last_dispatched_at?: string | null
          last_send_at?: string | null
          number_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "number_pacing_state_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_queue: {
        Row: {
          action_type: Database["whatsapp"]["Enums"]["outbound_action_type"]
          agent_id: string
          attempts: number
          completed_at: string | null
          conversation_id: string
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          evolution_msg_id: string | null
          id: string
          not_before: string
          number_id: string
          payload: Json
          priority: number
          seq: number
          status: Database["whatsapp"]["Enums"]["outbound_action_status"]
        }
        Insert: {
          action_type: Database["whatsapp"]["Enums"]["outbound_action_type"]
          agent_id: string
          attempts?: number
          completed_at?: string | null
          conversation_id: string
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          evolution_msg_id?: string | null
          id?: string
          not_before?: string
          number_id: string
          payload: Json
          priority?: number
          seq?: number
          status?: Database["whatsapp"]["Enums"]["outbound_action_status"]
        }
        Update: {
          action_type?: Database["whatsapp"]["Enums"]["outbound_action_type"]
          agent_id?: string
          attempts?: number
          completed_at?: string | null
          conversation_id?: string
          dispatched_at?: string | null
          enqueued_at?: string
          error?: string | null
          evolution_msg_id?: string | null
          id?: string
          not_before?: string
          number_id?: string
          payload?: Json
          priority?: number
          seq?: number
          status?: Database["whatsapp"]["Enums"]["outbound_action_status"]
        }
        Relationships: [
          {
            foreignKeyName: "outbound_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_queue_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_config: Json
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_auto_assigned_at: string | null
          role: Database["whatsapp"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_config?: Json
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          last_auto_assigned_at?: string | null
          role?: Database["whatsapp"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_config?: Json
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_auto_assigned_at?: string | null
          role?: Database["whatsapp"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          instance_id: string
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id: string
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          instance_id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          auto_assign_enabled: boolean
          auto_assign_strategy: string
          auto_assign_user_pool: string[]
          business_hours: Json
          created_at: string
          created_by: string
          display_name: string
          evolution_api_token_ct: string | null
          evolution_instance_name: string
          id: string
          last_seen_at: string | null
          lifecycle_state: Database["whatsapp"]["Enums"]["instance_lifecycle_state"]
          pacing_config: Json
          paired_at: string | null
          phone_number: string | null
          profile_pic_url: string | null
          qr_code: string | null
          recent_tag_colors: Json
          status: Database["whatsapp"]["Enums"]["instance_status"]
          status_detail: string | null
          updated_at: string
          wa_owner_jid: string | null
          wa_profile_name: string | null
          webhook_secret_ct: string | null
          worker_paused: boolean
        }
        Insert: {
          auto_assign_enabled?: boolean
          auto_assign_strategy?: string
          auto_assign_user_pool?: string[]
          business_hours?: Json
          created_at?: string
          created_by: string
          display_name: string
          evolution_api_token_ct?: string | null
          evolution_instance_name: string
          id?: string
          last_seen_at?: string | null
          lifecycle_state?: Database["whatsapp"]["Enums"]["instance_lifecycle_state"]
          pacing_config?: Json
          paired_at?: string | null
          phone_number?: string | null
          profile_pic_url?: string | null
          qr_code?: string | null
          recent_tag_colors?: Json
          status?: Database["whatsapp"]["Enums"]["instance_status"]
          status_detail?: string | null
          updated_at?: string
          wa_owner_jid?: string | null
          wa_profile_name?: string | null
          webhook_secret_ct?: string | null
          worker_paused?: boolean
        }
        Update: {
          auto_assign_enabled?: boolean
          auto_assign_strategy?: string
          auto_assign_user_pool?: string[]
          business_hours?: Json
          created_at?: string
          created_by?: string
          display_name?: string
          evolution_api_token_ct?: string | null
          evolution_instance_name?: string
          id?: string
          last_seen_at?: string | null
          lifecycle_state?: Database["whatsapp"]["Enums"]["instance_lifecycle_state"]
          pacing_config?: Json
          paired_at?: string | null
          phone_number?: string | null
          profile_pic_url?: string | null
          qr_code?: string | null
          recent_tag_colors?: Json
          status?: Database["whatsapp"]["Enums"]["instance_status"]
          status_detail?: string | null
          updated_at?: string
          wa_owner_jid?: string | null
          wa_profile_name?: string | null
          webhook_secret_ct?: string | null
          worker_paused?: boolean
        }
        Relationships: []
      }
      worker_health: {
        Row: {
          active_numbers: number
          dispatching_count: number
          drain_rate_1m: number
          hostname: string
          last_dispatch_at: string | null
          last_heartbeat_at: string
          notes: Json
          queue_depth: number
          started_at: string
          version: string
          worker_id: string
        }
        Insert: {
          active_numbers?: number
          dispatching_count?: number
          drain_rate_1m?: number
          hostname: string
          last_dispatch_at?: string | null
          last_heartbeat_at?: string
          notes?: Json
          queue_depth?: number
          started_at: string
          version: string
          worker_id: string
        }
        Update: {
          active_numbers?: number
          dispatching_count?: number
          drain_rate_1m?: number
          hostname?: string
          last_dispatch_at?: string | null
          last_heartbeat_at?: string
          notes?: Json
          queue_depth?: number
          started_at?: string
          version?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      conversations_decrypted: {
        Row: {
          contact_book_name: string | null
          contact_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          is_archived: boolean | null
          is_group: boolean | null
          is_pinned: boolean | null
          last_inbound_at: string | null
          left_at: string | null
          last_message_at: string | null
          last_message_direction:
            | Database["whatsapp"]["Enums"]["message_direction"]
            | null
          last_message_kind: Database["whatsapp"]["Enums"]["message_kind"] | null
          last_message_media_meta: Json | null
          last_message_preview: string | null
          last_message_sender_name: string | null
          last_outbound_at: string | null
          peer_display_name: string | null
          peer_profile_pic: string | null
          remote_jid: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: Database["whatsapp"]["Enums"]["conversation_status"] | null
          unread_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      messages_decrypted: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string | null
          delivery_status: string | null
          direction: Database["whatsapp"]["Enums"]["message_direction"] | null
          evolution_message_id: string | null
          forwarded: boolean | null
          forwarding_score: number | null
          id: string | null
          instance_id: string | null
          is_starred: boolean | null
          kind: Database["whatsapp"]["Enums"]["message_kind"] | null
          media_meta: Json | null
          media_mime: string | null
          media_pending: boolean | null
          media_size_bytes: number | null
          media_storage_bucket: string | null
          media_storage_key: string | null
          media_uploaded_at: string | null
          reactions: Json | null
          reply_to_message_id: string | null
          sender_jid: string | null
          sent_by_agent_id: string | null
          whatsapp_timestamp: string | null
          edited_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          is_pinned: boolean | null
          pinned_at: string | null
          pinned_by: string | null
          pin_expires_at: string | null
        }
        Insert: {
          body?: never
          conversation_id?: string | null
          created_at?: string | null
          delivery_status?: string | null
          direction?: Database["whatsapp"]["Enums"]["message_direction"] | null
          evolution_message_id?: string | null
          forwarded?: boolean | null
          forwarding_score?: number | null
          id?: string | null
          instance_id?: string | null
          is_starred?: boolean | null
          kind?: Database["whatsapp"]["Enums"]["message_kind"] | null
          media_meta?: Json | null
          media_mime?: string | null
          media_pending?: boolean | null
          media_size_bytes?: number | null
          media_storage_bucket?: string | null
          media_storage_key?: string | null
          media_uploaded_at?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          sender_jid?: string | null
          sent_by_agent_id?: string | null
          whatsapp_timestamp?: string | null
        }
        Update: {
          body?: never
          conversation_id?: string | null
          created_at?: string | null
          delivery_status?: string | null
          direction?: Database["whatsapp"]["Enums"]["message_direction"] | null
          evolution_message_id?: string | null
          forwarded?: boolean | null
          forwarding_score?: number | null
          id?: string | null
          instance_id?: string | null
          is_starred?: boolean | null
          kind?: Database["whatsapp"]["Enums"]["message_kind"] | null
          media_meta?: Json | null
          media_mime?: string | null
          media_pending?: boolean | null
          media_size_bytes?: number | null
          media_storage_bucket?: string | null
          media_storage_key?: string | null
          media_uploaded_at?: string | null
          reactions?: Json | null
          reply_to_message_id?: string | null
          sender_jid?: string | null
          sent_by_agent_id?: string | null
          whatsapp_timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations_decrypted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages_decrypted"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _assert_conversation_access: {
        Args: { p_conversation_id: string }
        Returns: {
          contact_id: string | null
          created_at: string
          id: string
          instance_id: string
          is_archived: boolean
          is_group: boolean
          is_pinned: boolean
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction:
            | Database["whatsapp"]["Enums"]["message_direction"]
            | null
          last_message_kind: Database["whatsapp"]["Enums"]["message_kind"] | null
          last_message_media_meta: Json | null
          last_message_preview_ct: string | null
          last_message_sender_name: string | null
          last_outbound_at: string | null
          peer_display_name: string | null
          peer_profile_pic: string | null
          remote_jid: string
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _canonical_remote_jid: {
        Args: { p_instance_id: string; p_raw_jid: string }
        Returns: string
      }
      _cron_outbound_queue_cleanup: { Args: never; Returns: undefined }
      _cron_reclaim_stale_dispatching: { Args: never; Returns: undefined }
      _cron_worker_health_alert: { Args: never; Returns: undefined }
      _decrypt_conv_preview: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      _decrypt_message_body: { Args: { p_message_id: string }; Returns: string }
      _envelope_key: { Args: never; Returns: string }
      admin_apply_auto_assign_backlog: {
        Args: { p_instance_id: string }
        Returns: number
      }
      admin_assign_conversations: {
        Args: { p_conversation_ids: string[]; p_user_id: string }
        Returns: number
      }
      admin_instance_delete_preflight: {
        Args: { p_instance_id: string }
        Returns: Json
      }
      admin_instance_sync_metrics: {
        Args: { p_instance_id: string }
        Returns: Json
      }
      admin_list_unassigned_conversations: {
        Args: { p_instance_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          contact_book_name: string
          contact_id: string
          id: string
          instance_id: string
          is_group: boolean
          last_message_at: string
          last_message_direction: Database["whatsapp"]["Enums"]["message_direction"]
          last_message_kind: Database["whatsapp"]["Enums"]["message_kind"]
          last_message_preview: string
          peer_display_name: string
          peer_profile_pic: string
          remote_jid: string
          status: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count: number
        }[]
      }
      admin_set_auto_assign: {
        Args: {
          p_enabled: boolean
          p_instance_id: string
          p_pool: string[]
          p_strategy: string
        }
        Returns: Json
      }
      admin_set_user_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: {
          avatar_config: Json
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_auto_assigned_at: string | null
          role: Database["whatsapp"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_user_role: {
        Args: {
          p_role: Database["whatsapp"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: {
          avatar_config: Json
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_auto_assigned_at: string | null
          role: Database["whatsapp"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_unassign_conversations: {
        Args: { p_conversation_ids: string[]; p_user_id: string }
        Returns: number
      }
      apply_reaction: {
        Args: {
          p_emoji: string
          p_instance_id: string
          p_is_from_me?: boolean
          p_remote_jid: string
          p_sender_jid: string
          p_sender_name?: string
          p_target_evo_id: string
          p_whatsapp_ts: string
        }
        Returns: undefined
      }
      assign_conversation: {
        Args: { p_conversation_id: string; p_user_ids: string[] }
        Returns: Json
      }
      audit: {
        Args: {
          p_event_type: string
          p_payload?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: number
      }
      bootstrap_admin: {
        Args: { p_user_id: string }
        Returns: {
          avatar_config: Json
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_auto_assigned_at: string | null
          role: Database["whatsapp"]["Enums"]["user_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_conversation: { Args: { p_conversation_id: string }; Returns: Json }
      complete_media_fetch: {
        Args: {
          p_message_id: string
          p_mime: string
          p_sha256: string
          p_size_bytes: number
          p_storage_bucket: string
          p_storage_key: string
        }
        Returns: undefined
      }
      decrypt_text: { Args: { p_ct: string }; Returns: string }
      encrypt_text: { Args: { p_plain: string }; Returns: string }
      enqueue_media_fetch: {
        Args: {
          p_evolution_message_id: string
          p_instance_id: string
          p_kind: Database["whatsapp"]["Enums"]["message_kind"]
          p_message_id: string
        }
        Returns: number
      }
      ensure_conversation: {
        Args: {
          p_instance_id: string
          p_peer_display_name?: string
          p_peer_profile_pic?: string
          p_remote_jid: string
        }
        Returns: string
      }
      fail_media_fetch:
        | { Args: { p_error: string; p_job_id: number }; Returns: undefined }
        | {
            Args: { p_error: string; p_job_id: number; p_terminal?: boolean }
            Returns: undefined
          }
      forward_message: {
        Args: { p_message_id: string; p_target_conv_ids: string[] }
        Returns: Json
      }
      get_recent_tag_colors: { Args: { p_instance_id: string }; Returns: Json }
      has_role: {
        Args: { p_role: Database["whatsapp"]["Enums"]["user_role"] }
        Returns: boolean
      }
      import_phone_book_entry: {
        Args: {
          p_book_name: string
          p_instance_id: string
          p_phone_number: string
        }
        Returns: undefined
      }
      ingest_message:
        | {
            Args: {
              p_body: string
              p_delivery_status: string
              p_direction: Database["whatsapp"]["Enums"]["message_direction"]
              p_evolution_message_id: string
              p_instance_id: string
              p_kind: Database["whatsapp"]["Enums"]["message_kind"]
              p_media_meta: Json
              p_remote_jid: string
              p_reply_to: string
              p_sender_jid: string
              p_whatsapp_ts: string
            }
            Returns: string
          }
        | {
            Args: {
              p_body: string
              p_delivery_status: string
              p_direction: Database["whatsapp"]["Enums"]["message_direction"]
              p_evolution_message_id: string
              p_instance_id: string
              p_kind: Database["whatsapp"]["Enums"]["message_kind"]
              p_media_meta: Json
              p_remote_jid: string
              p_reply_to: string
              p_sender_jid: string
              p_whatsapp_ts: string
            }
            Returns: string
          }
      invitation_claim: {
        Args: { p_submitted_email: string; p_token_hash: string }
        Returns: Database["whatsapp"]["CompositeTypes"]["invitation_claim_result"]
        SetofOptions: {
          from: "*"
          to: "invitation_claim_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invitation_finalize: {
        Args: { p_invite_id: string; p_new_user: string }
        Returns: undefined
      }
      invitation_rollback: { Args: { p_invite_id: string }; Returns: undefined }
      invitation_status: { Args: { p_token_hash: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      queue_claim_next: {
        Args: { p_number_id: string }
        Returns: {
          action_type: Database["whatsapp"]["Enums"]["outbound_action_type"]
          agent_id: string
          attempts: number
          completed_at: string | null
          conversation_id: string
          dispatched_at: string | null
          enqueued_at: string
          error: string | null
          evolution_msg_id: string | null
          id: string
          not_before: string
          number_id: string
          payload: Json
          priority: number
          seq: number
          status: Database["whatsapp"]["Enums"]["outbound_action_status"]
        }
        SetofOptions: {
          from: "*"
          to: "outbound_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      queue_mark_dead: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      queue_mark_failed: {
        Args: { p_error: string; p_id: string; p_retry_in_seconds?: number }
        Returns: undefined
      }
      queue_mark_sent: {
        Args: { p_evolution_msg_id: string; p_id: string }
        Returns: undefined
      }
      resolve_contact_from_mapping: {
        Args: {
          p_instance_id: string
          p_lid: string
          p_phone_jid: string
          p_profile_pic?: string
          p_push_name?: string
        }
        Returns: string
      }
      reveal_instance_token: {
        Args: { p_instance_id: string }
        Returns: string
      }
      reveal_instance_webhook_secret: {
        Args: { p_instance_id: string }
        Returns: string
      }
      search_conversations: {
        Args: { p_instance_id: string; p_limit?: number; p_query: string }
        Returns: {
          id: string
          instance_id: string
          is_group: boolean
          last_message_at: string
          last_message_preview: string
          match_score: number
          peer_display_name: string
          peer_profile_pic: string
          remote_jid: string
          status: Database["whatsapp"]["Enums"]["conversation_status"]
          unread_count: number
        }[]
      }
      send_message: {
        Args: {
          p_body?: string
          p_conversation_id: string
          p_forward_from?: string
          p_kind?: Database["whatsapp"]["Enums"]["message_kind"]
          p_media_meta?: Json
          p_media_mime?: string
          p_media_size_bytes?: number
          p_media_storage_bucket?: string
          p_media_storage_key?: string
          p_poll_options?: Json
          p_ptt?: boolean
          p_reply_to?: string
        }
        Returns: Json
      }
      send_reaction: {
        Args: { p_emoji: string; p_message_id: string }
        Returns: Json
      }
      send_read_receipt: { Args: { p_conversation_id: string }; Returns: Json }
      send_typing: {
        Args: { p_conversation_id: string; p_state: string }
        Returns: Json
      }
      set_instance_token: {
        Args: { p_instance_id: string; p_token: string }
        Returns: undefined
      }
      set_instance_webhook_secret: {
        Args: { p_instance_id: string; p_secret: string }
        Returns: undefined
      }
      toggle_archive: { Args: { p_conversation_id: string }; Returns: Json }
      toggle_message_star: { Args: { p_message_id: string }; Returns: boolean }
      toggle_pin: { Args: { p_conversation_id: string }; Returns: Json }
      toggle_star: { Args: { p_message_id: string }; Returns: Json }
      unassign_conversation: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: Json
      }
      update_conversation_status: {
        Args: {
          p_conversation_id: string
          p_snoozed_until?: string
          p_status: Database["whatsapp"]["Enums"]["conversation_status"]
        }
        Returns: Json
      }
      update_recent_tag_colors: {
        Args: { p_colors: Json; p_instance_id: string }
        Returns: undefined
      }
      upsert_contact_profile: {
        Args: {
          p_instance_id: string
          p_jid: string
          p_profile_pic: string
          p_push_name: string
        }
        Returns: undefined
      }
      upsert_jid_mapping: {
        Args: {
          p_instance_id: string
          p_lid: string
          p_phone_jid: string
          p_source: string
        }
        Returns: undefined
      }
      validate_audit_chain: {
        Args: { p_limit?: number }
        Returns: {
          broken_id: number
        }[]
      }
      validate_avatar_config: { Args: { p: Json }; Returns: boolean }
      worker_heartbeat: {
        Args: {
          p_active_numbers: number
          p_dispatching_count: number
          p_drain_rate_1m: number
          p_hostname: string
          p_last_dispatch_at?: string
          p_notes?: Json
          p_queue_depth: number
          p_version: string
          p_worker_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      conversation_status: "open" | "pending" | "resolved" | "snoozed"
      instance_lifecycle_state: "warming" | "established" | "cooling" | "banned"
      instance_status:
        | "pending"
        | "connecting"
        | "connected"
        | "disconnected"
        | "error"
      message_direction: "inbound" | "outbound"
      message_kind:
        | "text"
        | "image"
        | "video"
        | "audio"
        | "document"
        | "sticker"
        | "location"
        | "contact"
        | "reaction"
        | "system"
        | "poll"
      outbound_action_status:
        | "queued"
        | "dispatching"
        | "sent"
        | "failed"
        | "dead"
        | "cancelled"
      outbound_action_type:
        | "send_text"
        | "send_media"
        | "mark_read"
        | "typing_start"
        | "typing_stop"
        | "react"
        | "edit_message"
        | "delete_message"
        | "send_poll"
      user_role: "admin" | "user"
    }
    CompositeTypes: {
      invitation_claim_result: {
        ok: boolean | null
        reason: string | null
        id: string | null
        target_role: Database["whatsapp"]["Enums"]["user_role"] | null
        email: string | null
        full_name: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "whatsapp">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  whatsapp: {
    Enums: {
      conversation_status: ["open", "pending", "resolved", "snoozed"],
      instance_lifecycle_state: ["warming", "established", "cooling", "banned"],
      instance_status: [
        "pending",
        "connecting",
        "connected",
        "disconnected",
        "error",
      ],
      message_direction: ["inbound", "outbound"],
      message_kind: [
        "text",
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contact",
        "reaction",
        "system",
        "poll",
      ],
      outbound_action_status: [
        "queued",
        "dispatching",
        "sent",
        "failed",
        "dead",
        "cancelled",
      ],
      outbound_action_type: [
        "send_text",
        "send_media",
        "mark_read",
        "typing_start",
        "typing_stop",
        "react",
        "edit_message",
        "delete_message",
        "send_poll",
      ],
      user_role: ["admin", "user"],
    },
  },
} as const

// ─── Convenience aliases ────────────────────────────────────────────────────
// Maintained alongside the generated types. Re-add after each regeneration.

export type ConversationDecrypted = Database['whatsapp']['Views']['conversations_decrypted']['Row']
export type ConversationStatus = Database['whatsapp']['Enums']['conversation_status']
export type MessageDecrypted = Database['whatsapp']['Views']['messages_decrypted']['Row']
export type Profile = Database['whatsapp']['Tables']['profiles']['Row']
export type WhatsappInstance = Database['whatsapp']['Tables']['whatsapp_instances']['Row'] & {
  // Phase 1 chokepoint settings columns. Generated types are stale; manual
  // shim keeps the code typed without a full regeneration round-trip.
  pacing_floor_ms:              number | null
  pacing_jitter_median_ms:      number | null
  pacing_jitter_spread:         number | null
  pacing_per_conv_floor_ms:     number | null
  pacing_read_to_reply_min_ms:  number | null
  typing_base_ms:               number
  typing_per_char_ms:           number
  typing_cap_ms:                number
  typing_enabled:               boolean
  read_receipts_mode:           'off' | 'on_open' | 'on_dispatch'
  quiet_hours_override_until:   string | null
  manual_presence:              'auto' | 'online' | 'offline'
  // Phase 2 — WA peer-side flags (mirror to Evolution via /settings/set)
  wa_reject_calls:              boolean
  wa_call_reply_text:           string | null
  wa_always_online:             boolean
  wa_auto_read_inbound:         boolean
  wa_read_status:               boolean
  wa_ignore_groups:             boolean
  wa_sync_full_history:         boolean
  wa_profile_status:            string | null
  // Phase 2 — capacity caps + compliance + metadata
  daily_send_cap:               number
  hourly_send_cap:              number
  minute_burst_cap:             number
  require_consent_for_outbound: boolean
  opt_out_keywords:             string[]
  instance_tags:                string[]
  internal_notes:               string | null
  // Connect/sync state (pairing modal completion). Generated types stale.
  last_connect_at:              string | null
  history_synced_at:            string | null
  sync_progress:                number | null
}
export type ConversationNote = Database['whatsapp']['Tables']['conversation_notes']['Row']
export type MessageTemplate = Database['whatsapp']['Tables']['message_templates']['Row']
export type Invitation = Database['whatsapp']['Tables']['invitations']['Row']
export type MessageKind = Database['whatsapp']['Enums']['message_kind']
export type UserRole = Database['whatsapp']['Enums']['user_role']
export type InstanceLifecycleState = Database['whatsapp']['Enums']['instance_lifecycle_state']
export type InstanceStatus = Database['whatsapp']['Enums']['instance_status']
export type AvatarConfig = any
export type MessageDirection = Database['whatsapp']['Enums']['message_direction']

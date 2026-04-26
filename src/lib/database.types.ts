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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accessories: {
        Row: {
          active: boolean | null
          code: string
          cost_price: number
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          image_url: string | null
          name: string
          stock: number
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          code: string
          cost_price?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          image_url?: string | null
          name: string
          stock?: number
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          code?: string
          cost_price?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          image_url?: string | null
          name?: string
          stock?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accessories_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accessories_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_history: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          end_date: string
          id: string
          method: string
          product_id: string | null
          results: number
          start_date: string
          updated_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          end_date: string
          id?: string
          method: string
          product_id?: string | null
          results?: number
          start_date: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          end_date?: string
          id?: string
          method?: string
          product_id?: string | null
          results?: number
          start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_history_business_id_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ads_history_business_id_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_business_brain: {
        Row: {
          brain_model_id: string | null
          business_hours_end: string | null
          business_hours_start: string | null
          business_hours_weekdays: number[] | null
          business_id: string
          created_at: string
          default_mode: Database["public"]["Enums"]["ai_thread_mode_value"]
          embedding_model_id: string | null
          fallback_text_when_paused: string | null
          human_takeover_pause_minutes: number
          language: Database["public"]["Enums"]["ai_brain_language"]
          max_consecutive_ai_messages: number
          monthly_cap_usd: number
          persona_summary: string | null
          quota_status: Database["public"]["Enums"]["ai_provider_key_status"]
          review_deadline_minutes: number
          sandbox_globally: boolean
          spend_last_reset_at: string
          spent_this_month_usd: number
          stt_model_id: string | null
          tone: Database["public"]["Enums"]["ai_brain_tone"]
          tongue_model_id: string | null
          tts_model_id: string | null
          updated_at: string
        }
        Insert: {
          brain_model_id?: string | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          business_hours_weekdays?: number[] | null
          business_id: string
          created_at?: string
          default_mode?: Database["public"]["Enums"]["ai_thread_mode_value"]
          embedding_model_id?: string | null
          fallback_text_when_paused?: string | null
          human_takeover_pause_minutes?: number
          language?: Database["public"]["Enums"]["ai_brain_language"]
          max_consecutive_ai_messages?: number
          monthly_cap_usd?: number
          persona_summary?: string | null
          quota_status?: Database["public"]["Enums"]["ai_provider_key_status"]
          review_deadline_minutes?: number
          sandbox_globally?: boolean
          spend_last_reset_at?: string
          spent_this_month_usd?: number
          stt_model_id?: string | null
          tone?: Database["public"]["Enums"]["ai_brain_tone"]
          tongue_model_id?: string | null
          tts_model_id?: string | null
          updated_at?: string
        }
        Update: {
          brain_model_id?: string | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          business_hours_weekdays?: number[] | null
          business_id?: string
          created_at?: string
          default_mode?: Database["public"]["Enums"]["ai_thread_mode_value"]
          embedding_model_id?: string | null
          fallback_text_when_paused?: string | null
          human_takeover_pause_minutes?: number
          language?: Database["public"]["Enums"]["ai_brain_language"]
          max_consecutive_ai_messages?: number
          monthly_cap_usd?: number
          persona_summary?: string | null
          quota_status?: Database["public"]["Enums"]["ai_provider_key_status"]
          review_deadline_minutes?: number
          sandbox_globally?: boolean
          spend_last_reset_at?: string
          spent_this_month_usd?: number
          stt_model_id?: string | null
          tone?: Database["public"]["Enums"]["ai_brain_tone"]
          tongue_model_id?: string | null
          tts_model_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_business_brain_brain_model_id_fkey"
            columns: ["brain_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_brain_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_business_brain_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_brain_embedding_model_id_fkey"
            columns: ["embedding_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_brain_stt_model_id_fkey"
            columns: ["stt_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_brain_tongue_model_id_fkey"
            columns: ["tongue_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_brain_tts_model_id_fkey"
            columns: ["tts_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_business_skills: {
        Row: {
          auto_promoted_at: string | null
          business_id: string
          created_at: string
          custom_config: Json
          enabled: boolean
          failure_count: number
          id: string
          last_invoked_at: string | null
          mode: Database["public"]["Enums"]["ai_business_skill_mode"]
          owner_approvals_count: number
          required_approvals: number
          skill_id: string
          success_count: number
          updated_at: string
        }
        Insert: {
          auto_promoted_at?: string | null
          business_id: string
          created_at?: string
          custom_config?: Json
          enabled?: boolean
          failure_count?: number
          id?: string
          last_invoked_at?: string | null
          mode?: Database["public"]["Enums"]["ai_business_skill_mode"]
          owner_approvals_count?: number
          required_approvals?: number
          skill_id: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          auto_promoted_at?: string | null
          business_id?: string
          created_at?: string
          custom_config?: Json
          enabled?: boolean
          failure_count?: number
          id?: string
          last_invoked_at?: string | null
          mode?: Database["public"]["Enums"]["ai_business_skill_mode"]
          owner_approvals_count?: number
          required_approvals?: number
          skill_id?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_business_skills_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_business_skills_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_business_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "ai_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_decisions: {
        Row: {
          brain_intent: Json | null
          brain_model_id: string | null
          brain_provider_id: string | null
          business_id: string
          cost_usd: number
          created_at: string
          id: string
          inbound_message_id: string | null
          latency_ms: number | null
          outbound_message_id: string | null
          outbound_wa_message_id: string | null
          outcome: Database["public"]["Enums"]["ai_decision_outcome"]
          outcome_reason: string | null
          provider_chain: string[] | null
          redaction_map: Json | null
          review_status: Database["public"]["Enums"]["ai_review_status"]
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          sandbox: boolean
          thread_id: string | null
          tokens_in: number
          tokens_out: number
          tongue_model_id: string | null
          tongue_output: string | null
          tongue_provider_id: string | null
          tool_calls: Json
        }
        Insert: {
          brain_intent?: Json | null
          brain_model_id?: string | null
          brain_provider_id?: string | null
          business_id: string
          cost_usd?: number
          created_at?: string
          id?: string
          inbound_message_id?: string | null
          latency_ms?: number | null
          outbound_message_id?: string | null
          outbound_wa_message_id?: string | null
          outcome: Database["public"]["Enums"]["ai_decision_outcome"]
          outcome_reason?: string | null
          provider_chain?: string[] | null
          redaction_map?: Json | null
          review_status?: Database["public"]["Enums"]["ai_review_status"]
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          sandbox?: boolean
          thread_id?: string | null
          tokens_in?: number
          tokens_out?: number
          tongue_model_id?: string | null
          tongue_output?: string | null
          tongue_provider_id?: string | null
          tool_calls?: Json
        }
        Update: {
          brain_intent?: Json | null
          brain_model_id?: string | null
          brain_provider_id?: string | null
          business_id?: string
          cost_usd?: number
          created_at?: string
          id?: string
          inbound_message_id?: string | null
          latency_ms?: number | null
          outbound_message_id?: string | null
          outbound_wa_message_id?: string | null
          outcome?: Database["public"]["Enums"]["ai_decision_outcome"]
          outcome_reason?: string | null
          provider_chain?: string[] | null
          redaction_map?: Json | null
          review_status?: Database["public"]["Enums"]["ai_review_status"]
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          sandbox?: boolean
          thread_id?: string | null
          tokens_in?: number
          tokens_out?: number
          tongue_model_id?: string | null
          tongue_output?: string | null
          tongue_provider_id?: string | null
          tool_calls?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_decisions_brain_model_id_fkey"
            columns: ["brain_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_brain_provider_id_fkey"
            columns: ["brain_provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_decisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "ai_decisions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_tongue_model_id_fkey"
            columns: ["tongue_model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_tongue_provider_id_fkey"
            columns: ["tongue_provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_jailbreak_signals: {
        Row: {
          action: Database["public"]["Enums"]["ai_jailbreak_action"]
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          pattern: string
          severity: Database["public"]["Enums"]["ai_jailbreak_severity"]
        }
        Insert: {
          action?: Database["public"]["Enums"]["ai_jailbreak_action"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          pattern: string
          severity?: Database["public"]["Enums"]["ai_jailbreak_severity"]
        }
        Update: {
          action?: Database["public"]["Enums"]["ai_jailbreak_action"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          pattern?: string
          severity?: Database["public"]["Enums"]["ai_jailbreak_severity"]
        }
        Relationships: []
      }
      ai_knowledge_chunks: {
        Row: {
          active: boolean
          business_id: string
          chunk_index: number
          created_at: string
          embedding: string | null
          id: string
          language: string | null
          metadata: Json
          source_id: string | null
          source_kind: Database["public"]["Enums"]["ai_kb_source_kind"]
          source_label: string | null
          text: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          chunk_index?: number
          created_at?: string
          embedding?: string | null
          id?: string
          language?: string | null
          metadata?: Json
          source_id?: string | null
          source_kind: Database["public"]["Enums"]["ai_kb_source_kind"]
          source_label?: string | null
          text: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          chunk_index?: number
          created_at?: string
          embedding?: string | null
          id?: string
          language?: string | null
          metadata?: Json
          source_id?: string | null
          source_kind?: Database["public"]["Enums"]["ai_kb_source_kind"]
          source_label?: string | null
          text?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_chunks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_knowledge_chunks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_media_cache: {
        Row: {
          business_id: string
          byte_count: number | null
          char_count: number
          created_at: string
          expires_at: string
          hash_key: string
          hit_count: number
          id: string
          last_hit_at: string | null
          storage_path: string
          voice_id: string | null
          voice_kind: Database["public"]["Enums"]["ai_voice_kind"]
        }
        Insert: {
          business_id: string
          byte_count?: number | null
          char_count?: number
          created_at?: string
          expires_at?: string
          hash_key: string
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          storage_path: string
          voice_id?: string | null
          voice_kind: Database["public"]["Enums"]["ai_voice_kind"]
        }
        Update: {
          business_id?: string
          byte_count?: number | null
          char_count?: number
          created_at?: string
          expires_at?: string
          hash_key?: string
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          storage_path?: string
          voice_id?: string | null
          voice_kind?: Database["public"]["Enums"]["ai_voice_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_media_cache_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_media_cache_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          audio_cost_per_minute: number | null
          context_window: number | null
          created_at: string
          display_name: string
          id: string
          input_cost_per_1m: number | null
          is_active: boolean
          model_id: string
          notes: string | null
          output_cost_per_1m: number | null
          provider_id: string
          role: Database["public"]["Enums"]["ai_model_role"]
          updated_at: string
        }
        Insert: {
          audio_cost_per_minute?: number | null
          context_window?: number | null
          created_at?: string
          display_name: string
          id?: string
          input_cost_per_1m?: number | null
          is_active?: boolean
          model_id: string
          notes?: string | null
          output_cost_per_1m?: number | null
          provider_id: string
          role: Database["public"]["Enums"]["ai_model_role"]
          updated_at?: string
        }
        Update: {
          audio_cost_per_minute?: number | null
          context_window?: number | null
          created_at?: string
          display_name?: string
          id?: string
          input_cost_per_1m?: number | null
          is_active?: boolean
          model_id?: string
          notes?: string | null
          output_cost_per_1m?: number | null
          provider_id?: string
          role?: Database["public"]["Enums"]["ai_model_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_pending_actions: {
        Row: {
          applied_at: string | null
          applied_error: string | null
          applied_ref_id: string | null
          applied_ref_table: string | null
          business_id: string
          created_at: string
          decision_id: string | null
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["ai_pending_action_kind"]
          payload: Json
          skill_slug: string
          status: Database["public"]["Enums"]["ai_pending_action_status"]
          thread_id: string | null
          tool_use_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_error?: string | null
          applied_ref_id?: string | null
          applied_ref_table?: string | null
          business_id: string
          created_at?: string
          decision_id?: string | null
          expires_at?: string
          id?: string
          kind: Database["public"]["Enums"]["ai_pending_action_kind"]
          payload: Json
          skill_slug: string
          status?: Database["public"]["Enums"]["ai_pending_action_status"]
          thread_id?: string | null
          tool_use_id: string
        }
        Update: {
          applied_at?: string | null
          applied_error?: string | null
          applied_ref_id?: string | null
          applied_ref_table?: string | null
          business_id?: string
          created_at?: string
          decision_id?: string | null
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["ai_pending_action_kind"]
          payload?: Json
          skill_slug?: string
          status?: Database["public"]["Enums"]["ai_pending_action_status"]
          thread_id?: string | null
          tool_use_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_pending_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_pending_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "ai_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "ai_pending_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_platform_keys: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          last_probe_at: string | null
          last_probe_error: string | null
          last_probe_ok: boolean | null
          last_reset_at: string
          monthly_cap_usd: number
          provider_id: string
          secret_id: string
          spent_this_month_usd: number
          status: Database["public"]["Enums"]["ai_provider_key_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          last_probe_at?: string | null
          last_probe_error?: string | null
          last_probe_ok?: boolean | null
          last_reset_at?: string
          monthly_cap_usd?: number
          provider_id: string
          secret_id: string
          spent_this_month_usd?: number
          status?: Database["public"]["Enums"]["ai_provider_key_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          last_probe_at?: string | null
          last_probe_error?: string | null
          last_probe_ok?: boolean | null
          last_reset_at?: string
          monthly_cap_usd?: number
          provider_id?: string
          secret_id?: string
          spent_this_month_usd?: number
          status?: Database["public"]["Enums"]["ai_provider_key_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_platform_keys_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_platform_keys_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompts: {
        Row: {
          body: string
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["ai_prompt_kind"]
          skill_slug: string | null
          version: number
        }
        Insert: {
          body: string
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["ai_prompt_kind"]
          skill_slug?: string | null
          version?: number
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["ai_prompt_kind"]
          skill_slug?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_prompts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_prompts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_prompts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          created_at: string
          display_name: string
          homepage_url: string | null
          id: string
          is_active: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          homepage_url?: string | null
          id?: string
          is_active?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          homepage_url?: string | null
          id?: string
          is_active?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_redaction_rules: {
        Row: {
          business_id: string | null
          created_at: string
          custom_label: string | null
          id: string
          is_active: boolean
          pattern: string
          placeholder_kind: Database["public"]["Enums"]["ai_redaction_kind"]
          priority: number
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          custom_label?: string | null
          id?: string
          is_active?: boolean
          pattern: string
          placeholder_kind: Database["public"]["Enums"]["ai_redaction_kind"]
          priority?: number
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          custom_label?: string | null
          id?: string
          is_active?: boolean
          pattern?: string
          placeholder_kind?: Database["public"]["Enums"]["ai_redaction_kind"]
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_redaction_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_redaction_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_review_queue: {
        Row: {
          assigned_to: string | null
          business_id: string
          created_at: string
          deadline_at: string | null
          decision_id: string
          id: string
          notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ai_review_status"]
        }
        Insert: {
          assigned_to?: string | null
          business_id: string
          created_at?: string
          deadline_at?: string | null
          decision_id: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ai_review_status"]
        }
        Update: {
          assigned_to?: string | null
          business_id?: string
          created_at?: string
          deadline_at?: string | null
          decision_id?: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ai_review_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_review_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_review_queue_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_review_queue_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_review_queue_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "ai_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_skills: {
        Row: {
          category: Database["public"]["Enums"]["ai_skill_category"]
          created_at: string
          default_config: Json
          default_safety_tier: Database["public"]["Enums"]["ai_skill_safety_tier"]
          deprecated: boolean
          description: string
          id: string
          name: string
          required_role_filter:
            | Database["public"]["Enums"]["user_role"][]
            | null
          requires_write_db: boolean
          slug: string
          tool_schema: Json
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["ai_skill_category"]
          created_at?: string
          default_config?: Json
          default_safety_tier?: Database["public"]["Enums"]["ai_skill_safety_tier"]
          deprecated?: boolean
          description: string
          id?: string
          name: string
          required_role_filter?:
            | Database["public"]["Enums"]["user_role"][]
            | null
          requires_write_db?: boolean
          slug: string
          tool_schema?: Json
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["ai_skill_category"]
          created_at?: string
          default_config?: Json
          default_safety_tier?: Database["public"]["Enums"]["ai_skill_safety_tier"]
          deprecated?: boolean
          description?: string
          id?: string
          name?: string
          required_role_filter?:
            | Database["public"]["Enums"]["user_role"][]
            | null
          requires_write_db?: boolean
          slug?: string
          tool_schema?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ai_thread_mode: {
        Row: {
          business_id: string
          consecutive_ai_messages: number
          last_human_takeover_at: string | null
          mode_override:
            | Database["public"]["Enums"]["ai_thread_mode_value"]
            | null
          paused_until: string | null
          takeover_user_id: string | null
          thread_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          consecutive_ai_messages?: number
          last_human_takeover_at?: string | null
          mode_override?:
            | Database["public"]["Enums"]["ai_thread_mode_value"]
            | null
          paused_until?: string | null
          takeover_user_id?: string | null
          thread_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          consecutive_ai_messages?: number
          last_human_takeover_at?: string | null
          mode_override?:
            | Database["public"]["Enums"]["ai_thread_mode_value"]
            | null
          paused_until?: string | null
          takeover_user_id?: string | null
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_thread_mode_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_thread_mode_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_thread_mode_takeover_user_id_fkey"
            columns: ["takeover_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_thread_mode_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_thread_mode_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "ai_thread_mode_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_daily: {
        Row: {
          business_id: string
          day: string
          refreshed_at: string
          total_audio_minutes: number
          total_blocked_calls: number
          total_calls: number
          total_cost_usd: number
          total_escalations: number
          total_sandbox_calls: number
          total_tokens_in: number
          total_tokens_out: number
        }
        Insert: {
          business_id: string
          day: string
          refreshed_at?: string
          total_audio_minutes?: number
          total_blocked_calls?: number
          total_calls?: number
          total_cost_usd?: number
          total_escalations?: number
          total_sandbox_calls?: number
          total_tokens_in?: number
          total_tokens_out?: number
        }
        Update: {
          business_id?: string
          day?: string
          refreshed_at?: string
          total_audio_minutes?: number
          total_blocked_calls?: number
          total_calls?: number
          total_cost_usd?: number
          total_escalations?: number
          total_sandbox_calls?: number
          total_tokens_in?: number
          total_tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_daily_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_usage_daily_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          audio_minutes: number | null
          business_id: string
          cost_usd: number
          decision_id: string | null
          id: string
          model_id: string
          occurred_at: string
          provider_id: string
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          audio_minutes?: number | null
          business_id: string
          cost_usd?: number
          decision_id?: string | null
          id?: string
          model_id: string
          occurred_at?: string
          provider_id: string
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          audio_minutes?: number | null
          business_id?: string
          cost_usd?: number
          decision_id?: string | null
          id?: string
          model_id?: string
          occurred_at?: string
          provider_id?: string
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_usage_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "ai_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_voice_profiles: {
        Row: {
          azure_voice_id: string | null
          business_id: string
          created_at: string
          default_voice_kind: Database["public"]["Enums"]["ai_voice_kind"]
          elevenlabs_voice_id: string | null
          pitch_offset: number
          speed_offset: number
          updated_at: string
        }
        Insert: {
          azure_voice_id?: string | null
          business_id: string
          created_at?: string
          default_voice_kind?: Database["public"]["Enums"]["ai_voice_kind"]
          elevenlabs_voice_id?: string | null
          pitch_offset?: number
          speed_offset?: number
          updated_at?: string
        }
        Update: {
          azure_voice_id?: string | null
          business_id?: string
          created_at?: string
          default_voice_kind?: Database["public"]["Enums"]["ai_voice_kind"]
          elevenlabs_voice_id?: string | null
          pitch_offset?: number
          speed_offset?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_voice_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "ai_voice_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ameex_cities: {
        Row: {
          ameex_city_id: string
          created_at: string | null
          d_fees: number | null
          friday: boolean | null
          id: string
          lat: string | null
          lng: string | null
          monday: boolean | null
          name: string
          r_fees: number | null
          ref: string | null
          relaunch_zone: string | null
          saturday: boolean | null
          sunday: boolean | null
          thursday: boolean | null
          tuesday: boolean | null
          updated_at: string | null
          wednesday: boolean | null
          zone: string | null
        }
        Insert: {
          ameex_city_id: string
          created_at?: string | null
          d_fees?: number | null
          friday?: boolean | null
          id?: string
          lat?: string | null
          lng?: string | null
          monday?: boolean | null
          name: string
          r_fees?: number | null
          ref?: string | null
          relaunch_zone?: string | null
          saturday?: boolean | null
          sunday?: boolean | null
          thursday?: boolean | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
          zone?: string | null
        }
        Update: {
          ameex_city_id?: string
          created_at?: string | null
          d_fees?: number | null
          friday?: boolean | null
          id?: string
          lat?: string | null
          lng?: string | null
          monday?: boolean | null
          name?: string
          r_fees?: number | null
          ref?: string | null
          relaunch_zone?: string | null
          saturday?: boolean | null
          sunday?: boolean | null
          thursday?: boolean | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
          zone?: string | null
        }
        Relationships: []
      }
      audit_log_geo_jobs: {
        Row: {
          audit_log_id: string
          dispatched_at: string
          ip: string
          request_id: number
        }
        Insert: {
          audit_log_id: string
          dispatched_at?: string
          ip: string
          request_id: number
        }
        Update: {
          audit_log_id?: string
          dispatched_at?: string
          ip?: string
          request_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_geo_jobs_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_avatar_url: string | null
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          business_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_table: string | null
          geo: Json | null
          id: string
          ip: string | null
          metadata: Json | null
          scope: string
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_avatar_url?: string | null
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          business_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_table?: string | null
          geo?: Json | null
          id?: string
          ip?: string | null
          metadata?: Json | null
          scope: string
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_avatar_url?: string | null
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          business_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_table?: string | null
          geo?: Json | null
          id?: string
          ip?: string | null
          metadata?: Json | null
          scope?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bons_commande: {
        Row: {
          bc_number: string
          business_id: string
          created_at: string
          created_by: string | null
          direction: string
          id: string
          issued_at: string
          pdf_storage_path: string | null
          snapshot_json: Json
          status: string
          subtotal_ht: number
          total_ttc: number
          tva_amount: number
          tva_rate: number
          updated_at: string
        }
        Insert: {
          bc_number: string
          business_id: string
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
        }
        Update: {
          bc_number?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bons_commande_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "bons_commande_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bons_livraison: {
        Row: {
          bl_number: string
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          issued_at: string
          pdf_storage_path: string | null
          snapshot_json: Json
          status: string
          updated_at: string
        }
        Insert: {
          bl_number: string
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          bl_number?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bons_livraison_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "bons_livraison_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          currency: string
          denial_message: string | null
          id: string
          license_type: string
          notes: string | null
          paid_by: string | null
          payment_method: string
          period_end: string | null
          period_start: string
          proof_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string | null
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          currency?: string
          denial_message?: string | null
          id?: string
          license_type: string
          notes?: string | null
          paid_by?: string | null
          payment_method?: string
          period_end?: string | null
          period_start: string
          proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          currency?: string
          denial_message?: string | null
          id?: string
          license_type?: string
          notes?: string | null
          paid_by?: string | null
          payment_method?: string
          period_end?: string | null
          period_start?: string
          proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "business_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_payments_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          active: boolean | null
          business_email: string | null
          business_phone: string | null
          cachet_url: string | null
          capital_social: string | null
          cnss: string | null
          created_at: string | null
          creator_id: string | null
          ice: string | null
          id: string
          identifiant_fiscal: string | null
          legal_address: string | null
          legal_city: string | null
          legal_form: string | null
          license_end: string | null
          license_start: string
          license_type: string
          logo: string | null
          name: string
          paid: boolean
          patente: string | null
          plan_id: string | null
          postal_code: string | null
          rc: string | null
          signature_url: string | null
          status: string
          updated_at: string | null
          website: string | null
        }
        Insert: {
          active?: boolean | null
          business_email?: string | null
          business_phone?: string | null
          cachet_url?: string | null
          capital_social?: string | null
          cnss?: string | null
          created_at?: string | null
          creator_id?: string | null
          ice?: string | null
          id?: string
          identifiant_fiscal?: string | null
          legal_address?: string | null
          legal_city?: string | null
          legal_form?: string | null
          license_end?: string | null
          license_start?: string
          license_type?: string
          logo?: string | null
          name: string
          paid?: boolean
          patente?: string | null
          plan_id?: string | null
          postal_code?: string | null
          rc?: string | null
          signature_url?: string | null
          status?: string
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          active?: boolean | null
          business_email?: string | null
          business_phone?: string | null
          cachet_url?: string | null
          capital_social?: string | null
          cnss?: string | null
          created_at?: string | null
          creator_id?: string | null
          ice?: string | null
          id?: string
          identifiant_fiscal?: string | null
          legal_address?: string | null
          legal_city?: string | null
          legal_form?: string | null
          license_end?: string | null
          license_start?: string
          license_type?: string
          logo?: string | null
          name?: string
          paid?: boolean
          patente?: string | null
          plan_id?: string | null
          postal_code?: string | null
          rc?: string | null
          signature_url?: string | null
          status?: string
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "businesses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_daily_entries: {
        Row: {
          campaign_id: string | null
          created_at: string
          created_by: string | null
          "DigiCom Business": string
          entry_date: string
          id: string
          leads: number
          notes: string | null
          platform: string
          spend: number
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business": string
          entry_date: string
          id?: string
          leads?: number
          notes?: string | null
          platform: string
          spend?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string
          entry_date?: string
          id?: string
          leads?: number
          notes?: string | null
          platform?: string
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_daily_entries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_entries_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "campaign_daily_entries_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience: Json | null
          campaign_type: string
          conversion_content: string | null
          conversion_type: string
          created_at: string
          created_by: string | null
          cta_label: string | null
          currency: string
          daily_budget: number | null
          "DigiCom Business": string
          end_date: string | null
          headline: string | null
          id: string
          media: Json
          name: string
          notes: string | null
          objective: string | null
          pixel_id: string | null
          platform: string
          primary_text: string | null
          spending_type: string
          start_date: string | null
          status: string
          total_budget: number | null
          updated_at: string
        }
        Insert: {
          audience?: Json | null
          campaign_type: string
          conversion_content?: string | null
          conversion_type: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          currency?: string
          daily_budget?: number | null
          "DigiCom Business": string
          end_date?: string | null
          headline?: string | null
          id?: string
          media?: Json
          name: string
          notes?: string | null
          objective?: string | null
          pixel_id?: string | null
          platform: string
          primary_text?: string | null
          spending_type: string
          start_date?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Update: {
          audience?: Json | null
          campaign_type?: string
          conversion_content?: string | null
          conversion_type?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          currency?: string
          daily_budget?: number | null
          "DigiCom Business"?: string
          end_date?: string | null
          headline?: string | null
          id?: string
          media?: Json
          name?: string
          notes?: string | null
          objective?: string | null
          pixel_id?: string | null
          platform?: string
          primary_text?: string | null
          spending_type?: string
          start_date?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "campaigns_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          ameex_code: string | null
          created_at: string | null
          id: string
          name: string
          zone_id: string | null
        }
        Insert: {
          ameex_code?: string | null
          created_at?: string | null
          id?: string
          name: string
          zone_id?: string | null
        }
        Update: {
          ameex_code?: string | null
          created_at?: string | null
          id?: string
          name?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cities_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      coliaty_cities: {
        Row: {
          category_name: string | null
          category_ref: string | null
          city_active: boolean | null
          city_code: string | null
          city_name: string
          coliaty_city_id: number
          created_at: string | null
          custom_pricing_delivered: number | null
          custom_pricing_refused: number | null
          custom_pricing_returned: number | null
          custom_pricing_type: string | null
          fee_delivered: number | null
          fee_refused: number | null
          fee_returned: number | null
          friday: boolean | null
          hub_id: number | null
          hub_name: string | null
          id: string
          monday: boolean | null
          saturday: boolean | null
          sunday: boolean | null
          thursday: boolean | null
          tuesday: boolean | null
          updated_at: string | null
          wednesday: boolean | null
        }
        Insert: {
          category_name?: string | null
          category_ref?: string | null
          city_active?: boolean | null
          city_code?: string | null
          city_name: string
          coliaty_city_id: number
          created_at?: string | null
          custom_pricing_delivered?: number | null
          custom_pricing_refused?: number | null
          custom_pricing_returned?: number | null
          custom_pricing_type?: string | null
          fee_delivered?: number | null
          fee_refused?: number | null
          fee_returned?: number | null
          friday?: boolean | null
          hub_id?: number | null
          hub_name?: string | null
          id?: string
          monday?: boolean | null
          saturday?: boolean | null
          sunday?: boolean | null
          thursday?: boolean | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
        }
        Update: {
          category_name?: string | null
          category_ref?: string | null
          city_active?: boolean | null
          city_code?: string | null
          city_name?: string
          coliaty_city_id?: number
          created_at?: string | null
          custom_pricing_delivered?: number | null
          custom_pricing_refused?: number | null
          custom_pricing_returned?: number | null
          custom_pricing_type?: string | null
          fee_delivered?: number | null
          fee_refused?: number | null
          fee_returned?: number | null
          friday?: boolean | null
          hub_id?: number | null
          hub_name?: string | null
          id?: string
          monday?: boolean | null
          saturday?: boolean | null
          sunday?: boolean | null
          thursday?: boolean | null
          tuesday?: boolean | null
          updated_at?: string | null
          wednesday?: boolean | null
        }
        Relationships: []
      }
      company_delivery_notes: {
        Row: {
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          external_id: string | null
          id: string
          is_finalized: boolean | null
          parcel_count: number | null
          provider_id: string | null
          reference: string | null
          status_id: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_finalized?: boolean | null
          parcel_count?: number | null
          provider_id?: string | null
          reference?: string | null
          status_id?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_finalized?: boolean | null
          parcel_count?: number | null
          provider_id?: string | null
          reference?: string | null
          status_id?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_delivery_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_delivery_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_delivery_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_delivery_notes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_delivery_notes_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_delivery_notes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      company_fees: {
        Row: {
          city_id: string | null
          company_id: string
          created_at: string | null
          "DigiCom Business": string | null
          fee: number
          id: string
          master_city_id: string | null
          return_fee: number
          updated_at: string | null
        }
        Insert: {
          city_id?: string | null
          company_id: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          fee?: number
          id?: string
          master_city_id?: string | null
          return_fee?: number
          updated_at?: string | null
        }
        Update: {
          city_id?: string | null
          company_id?: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          fee?: number
          id?: string
          master_city_id?: string | null
          return_fee?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_fees_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_fees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_fees_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_fees_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_fees_master_city_id_fkey"
            columns: ["master_city_id"]
            isOneToOne: false
            referencedRelation: "master_cities"
            referencedColumns: ["id"]
          },
        ]
      }
      company_parcels: {
        Row: {
          company_delivery_note_id: string | null
          company_return_note_id: string | null
          created_at: string | null
          "DigiCom Business": string | null
          external_id: string | null
          id: string
          order_id: string | null
          provider_id: string | null
          provider_response: Json | null
          reference: string | null
          status_color: string | null
          status_id: string | null
          status_label: string | null
          tracking_code: string | null
          updated_at: string | null
        }
        Insert: {
          company_delivery_note_id?: string | null
          company_return_note_id?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          provider_response?: Json | null
          reference?: string | null
          status_color?: string | null
          status_id?: string | null
          status_label?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Update: {
          company_delivery_note_id?: string | null
          company_return_note_id?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          provider_response?: Json | null
          reference?: string | null
          status_color?: string | null
          status_id?: string | null
          status_label?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_parcels_company_delivery_note_id_fkey"
            columns: ["company_delivery_note_id"]
            isOneToOne: false
            referencedRelation: "company_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_parcels_company_return_note_id_fkey"
            columns: ["company_return_note_id"]
            isOneToOne: false
            referencedRelation: "company_return_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_parcels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_parcels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_parcels_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_parcels_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_parcels_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      company_payment_note_orders: {
        Row: {
          amount: number
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          order_id: string
          payment_note_id: string
          shipping_fee: number
          tracking_code: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id: string
          payment_note_id: string
          shipping_fee?: number
          tracking_code?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string
          payment_note_id?: string
          shipping_fee?: number
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_payment_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_payment_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_payment_note_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_payment_note_orders_payment_note_id_fkey"
            columns: ["payment_note_id"]
            isOneToOne: false
            referencedRelation: "company_payment_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      company_payment_notes: {
        Row: {
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number
          note: string | null
          order_count: number
          paid_at: string | null
          provider_id: string
          reference: string
          status: string
          total_amount: number
          total_shipping_fees: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number
          note?: string | null
          order_count?: number
          paid_at?: string | null
          provider_id: string
          reference: string
          status?: string
          total_amount?: number
          total_shipping_fees?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number
          note?: string | null
          order_count?: number
          paid_at?: string | null
          provider_id?: string
          reference?: string
          status?: string
          total_amount?: number
          total_shipping_fees?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_payment_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_payment_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_payment_notes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      company_return_note_orders: {
        Row: {
          amount: number | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          order_id: string
          return_note_id: string
          shipping_fee: number | null
          tracking_code: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id: string
          return_note_id: string
          shipping_fee?: number | null
          tracking_code?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string
          return_note_id?: string
          shipping_fee?: number | null
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_return_note_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_return_note_orders_return_note_id_fkey"
            columns: ["return_note_id"]
            isOneToOne: false
            referencedRelation: "company_return_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      company_return_notes: {
        Row: {
          company_delivery_note_id: string | null
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number | null
          note: string | null
          order_count: number | null
          provider_id: string | null
          received_at: string | null
          reference: string | null
          status: string
          status_id: string | null
          total_amount: number | null
          total_shipping_fees: number | null
          updated_at: string | null
        }
        Insert: {
          company_delivery_note_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          note?: string | null
          order_count?: number | null
          provider_id?: string | null
          received_at?: string | null
          reference?: string | null
          status?: string
          status_id?: string | null
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Update: {
          company_delivery_note_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          note?: string | null
          order_count?: number | null
          provider_id?: string | null
          received_at?: string | null
          reference?: string | null
          status?: string
          status_id?: string | null
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_return_notes_company_delivery_note_id_fkey"
            columns: ["company_delivery_note_id"]
            isOneToOne: false
            referencedRelation: "company_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_return_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_return_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_return_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_return_notes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_return_notes_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      company_zones: {
        Row: {
          company_id: string
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          zone_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          zone_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_zones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_zones_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "company_zones_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_delivery_notes: {
        Row: {
          courier_id: string | null
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          external_id: string | null
          id: string
          is_finalized: boolean | null
          parcel_count: number | null
          reference: string | null
          status_id: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_finalized?: boolean | null
          parcel_count?: number | null
          reference?: string | null
          status_id?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_finalized?: boolean | null
          parcel_count?: number | null
          reference?: string | null
          status_id?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_delivery_notes_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_delivery_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_delivery_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_delivery_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_delivery_notes_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_delivery_notes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_fees: {
        Row: {
          city_id: string | null
          courier_id: string
          created_at: string | null
          "DigiCom Business": string | null
          fee: number
          id: string
          master_city_id: string | null
          return_fee: number
          updated_at: string | null
        }
        Insert: {
          city_id?: string | null
          courier_id: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          fee?: number
          id?: string
          master_city_id?: string | null
          return_fee?: number
          updated_at?: string | null
        }
        Update: {
          city_id?: string | null
          courier_id?: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          fee?: number
          id?: string
          master_city_id?: string | null
          return_fee?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_fees_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_fees_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_fees_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_fees_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_fees_master_city_id_fkey"
            columns: ["master_city_id"]
            isOneToOne: false
            referencedRelation: "master_cities"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_notifications: {
        Row: {
          body: string | null
          courier_id: string
          created_at: string
          "DigiCom Business": string
          id: string
          payload: Json | null
          read_at: string | null
          target_url: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          courier_id: string
          created_at?: string
          "DigiCom Business": string
          id?: string
          payload?: Json | null
          read_at?: string | null
          target_url?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          courier_id?: string
          created_at?: string
          "DigiCom Business"?: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          target_url?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_notifications_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_notifications_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_notifications_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_parcels: {
        Row: {
          courier_delivery_note_id: string | null
          courier_id: string | null
          courier_return_note_id: string | null
          created_at: string | null
          delivered_at: string | null
          "DigiCom Business": string | null
          external_id: string | null
          id: string
          is_fragile: boolean | null
          is_open: boolean | null
          is_try_on: boolean | null
          order_id: string | null
          provider_response: Json | null
          reference: string | null
          status_color: string | null
          status_id: string | null
          status_label: string | null
          tracking_code: string | null
          updated_at: string | null
        }
        Insert: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          courier_return_note_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_fragile?: boolean | null
          is_open?: boolean | null
          is_try_on?: boolean | null
          order_id?: string | null
          provider_response?: Json | null
          reference?: string | null
          status_color?: string | null
          status_id?: string | null
          status_label?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Update: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          courier_return_note_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          is_fragile?: boolean | null
          is_open?: boolean | null
          is_try_on?: boolean | null
          order_id?: string | null
          provider_response?: Json | null
          reference?: string | null
          status_color?: string | null
          status_id?: string | null
          status_label?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_parcels_courier_delivery_note_id_fkey"
            columns: ["courier_delivery_note_id"]
            isOneToOne: false
            referencedRelation: "courier_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_parcels_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_parcels_courier_return_note_id_fkey"
            columns: ["courier_return_note_id"]
            isOneToOne: false
            referencedRelation: "courier_return_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_parcels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_parcels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_parcels_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_parcels_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_payment_note_orders: {
        Row: {
          amount: number
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          order_id: string
          payment_note_id: string
          shipping_fee: number
          tracking_code: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id: string
          payment_note_id: string
          shipping_fee?: number
          tracking_code?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string
          payment_note_id?: string
          shipping_fee?: number
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_payment_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_payment_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_payment_note_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_payment_note_orders_payment_note_id_fkey"
            columns: ["payment_note_id"]
            isOneToOne: false
            referencedRelation: "courier_payment_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_payment_notes: {
        Row: {
          courier_id: string | null
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number
          note: string | null
          order_count: number
          paid_at: string | null
          reference: string
          status: string
          total_amount: number
          total_shipping_fees: number
          updated_at: string | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number
          note?: string | null
          order_count?: number
          paid_at?: string | null
          reference: string
          status?: string
          total_amount?: number
          total_shipping_fees?: number
          updated_at?: string | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number
          note?: string | null
          order_count?: number
          paid_at?: string | null
          reference?: string
          status?: string
          total_amount?: number
          total_shipping_fees?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_payment_notes_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_payment_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_payment_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_payment_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_return_note_orders: {
        Row: {
          amount: number | null
          created_at: string
          "DigiCom Business": string | null
          id: string
          order_id: string | null
          return_note_id: string
          shipping_fee: number | null
          tracking_code: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string | null
          return_note_id: string
          shipping_fee?: number | null
          tracking_code?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string | null
          return_note_id?: string
          shipping_fee?: number | null
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_return_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_return_note_orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_note_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_note_orders_return_note_id_fkey"
            columns: ["return_note_id"]
            isOneToOne: false
            referencedRelation: "courier_return_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_return_notes: {
        Row: {
          courier_delivery_note_id: string | null
          courier_id: string | null
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number | null
          note: string | null
          order_count: number | null
          received_at: string | null
          reference: string | null
          status: string
          status_id: string | null
          total_amount: number | null
          total_shipping_fees: number | null
          updated_at: string | null
        }
        Insert: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          note?: string | null
          order_count?: number | null
          received_at?: string | null
          reference?: string | null
          status?: string
          status_id?: string | null
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Update: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          note?: string | null
          order_count?: number | null
          received_at?: string | null
          reference?: string | null
          status?: string
          status_id?: string | null
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_return_notes_courier_delivery_note_id_fkey"
            columns: ["courier_delivery_note_id"]
            isOneToOne: false
            referencedRelation: "courier_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_notes_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_return_notes_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_return_notes_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_zones: {
        Row: {
          courier_id: string
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          zone_id: string
        }
        Insert: {
          courier_id: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          zone_id: string
        }
        Update: {
          courier_id?: string
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_zones_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_zones_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "courier_zones_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city_name: string | null
          created_at: string
          "DigiCom Business": string
          first_order_at: string | null
          id: string
          last_order_at: string | null
          master_city_id: string | null
          name: string | null
          notes: string | null
          phone: string
          phone_normalized: string
          source: string
          tags: string[]
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city_name?: string | null
          created_at?: string
          "DigiCom Business": string
          first_order_at?: string | null
          id?: string
          last_order_at?: string | null
          master_city_id?: string | null
          name?: string | null
          notes?: string | null
          phone: string
          phone_normalized: string
          source?: string
          tags?: string[]
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city_name?: string | null
          created_at?: string
          "DigiCom Business"?: string
          first_order_at?: string | null
          id?: string
          last_order_at?: string | null
          master_city_id?: string | null
          name?: string | null
          notes?: string | null
          phone?: string
          phone_normalized?: string
          source?: string
          tags?: string[]
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_master_city_id_fkey"
            columns: ["master_city_id"]
            isOneToOne: false
            referencedRelation: "master_cities"
            referencedColumns: ["id"]
          },
        ]
      }
      devis: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          devis_number: string
          id: string
          issued_at: string
          pdf_storage_path: string | null
          snapshot_json: Json
          status: string
          subtotal_ht: number
          total_ttc: number
          tva_amount: number
          tva_rate: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          devis_number: string
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          devis_number?: string
          id?: string
          issued_at?: string
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devis_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "devis_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_types: {
        Row: {
          active: boolean | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          name: string
          recurrent: boolean | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name: string
          recurrent?: boolean | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name?: string
          recurrent?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_types_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expense_types_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          created_at: string | null
          date: string
          description: string | null
          "DigiCom Business": string | null
          id: string
          name: string
          type_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          date?: string
          description?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name: string
          type_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          date?: string
          description?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name?: string
          type_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "expense_types"
            referencedColumns: ["id"]
          },
        ]
      }
      factures: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          devis_reference: string | null
          due_date: string | null
          facture_number: string
          id: string
          issued_at: string
          payment_terms: string | null
          pdf_storage_path: string | null
          snapshot_json: Json
          status: string
          subtotal_ht: number
          total_ttc: number
          tva_amount: number
          tva_rate: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          devis_reference?: string | null
          due_date?: string | null
          facture_number: string
          id?: string
          issued_at?: string
          payment_terms?: string | null
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          devis_reference?: string | null
          due_date?: string | null
          facture_number?: string
          id?: string
          issued_at?: string
          payment_terms?: string | null
          pdf_storage_path?: string | null
          snapshot_json?: Json
          status?: string
          subtotal_ht?: number
          total_ttc?: number
          tva_amount?: number
          tva_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factures_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "factures_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      google_analytics_connections: {
        Row: {
          created_at: string
          created_by: string | null
          "DigiCom Business": string
          display_name: string
          id: string
          is_default: boolean
          last_verified_at: string | null
          property_id: string
          updated_at: string
          verification_error: string | null
          verification_status: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          "DigiCom Business": string
          display_name: string
          id?: string
          is_default?: boolean
          last_verified_at?: string | null
          property_id: string
          updated_at?: string
          verification_error?: string | null
          verification_status?: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string
          display_name?: string
          id?: string
          is_default?: boolean
          last_verified_at?: string | null
          property_id?: string
          updated_at?: string
          verification_error?: string | null
          verification_status?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_analytics_connections_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "google_analytics_connections_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      master_cities: {
        Row: {
          ameex_city_id: string | null
          coliaty_city_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          lat: number | null
          lng: number | null
          name: string
          name_ar: string | null
          ozon_city_id: string | null
          region: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          ameex_city_id?: string | null
          coliaty_city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          name: string
          name_ar?: string | null
          ozon_city_id?: string | null
          region?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          ameex_city_id?: string | null
          coliaty_city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          lat?: number | null
          lng?: number | null
          name?: string
          name_ar?: string | null
          ozon_city_id?: string | null
          region?: string | null
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_cities_ameex_city_id_fkey"
            columns: ["ameex_city_id"]
            isOneToOne: false
            referencedRelation: "ameex_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_cities_coliaty_city_id_fkey"
            columns: ["coliaty_city_id"]
            isOneToOne: false
            referencedRelation: "coliaty_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_cities_ozon_city_id_fkey"
            columns: ["ozon_city_id"]
            isOneToOne: false
            referencedRelation: "ozonexpress_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_cities_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      mediabuyer_demands: {
        Row: {
          admin_response: string | null
          admin_response_media: Json
          category: string
          content: string | null
          created_at: string
          "DigiCom Business": string
          id: string
          media: Json
          mediabuyer_id: string
          priority: string
          responded_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          admin_response?: string | null
          admin_response_media?: Json
          category: string
          content?: string | null
          created_at?: string
          "DigiCom Business": string
          id?: string
          media?: Json
          mediabuyer_id: string
          priority?: string
          responded_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          admin_response?: string | null
          admin_response_media?: Json
          category?: string
          content?: string | null
          created_at?: string
          "DigiCom Business"?: string
          id?: string
          media?: Json
          mediabuyer_id?: string
          priority?: string
          responded_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mediabuyer_demands_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "mediabuyer_demands_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_demands_mediabuyer_id_fkey"
            columns: ["mediabuyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mediabuyer_payments: {
        Row: {
          bank_snapshot: Json | null
          campaigns_count: number
          commission_earned: number
          created_at: string
          delivered_orders: number
          "DigiCom Business": string
          id: string
          mediabuyer_id: string
          paid_at: string | null
          payment_type: string
          payout_month: string
          salary_earned: number
          status: string
          total_amount: number
          total_spend: number
          updated_at: string
        }
        Insert: {
          bank_snapshot?: Json | null
          campaigns_count?: number
          commission_earned?: number
          created_at?: string
          delivered_orders?: number
          "DigiCom Business": string
          id?: string
          mediabuyer_id: string
          paid_at?: string | null
          payment_type: string
          payout_month: string
          salary_earned?: number
          status?: string
          total_amount?: number
          total_spend?: number
          updated_at?: string
        }
        Update: {
          bank_snapshot?: Json | null
          campaigns_count?: number
          commission_earned?: number
          created_at?: string
          delivered_orders?: number
          "DigiCom Business"?: string
          id?: string
          mediabuyer_id?: string
          paid_at?: string | null
          payment_type?: string
          payout_month?: string
          salary_earned?: number
          status?: string
          total_amount?: number
          total_spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mediabuyer_payments_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "mediabuyer_payments_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_payments_mediabuyer_id_fkey"
            columns: ["mediabuyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_connections: {
        Row: {
          ad_account_id: string
          business_id_meta: string | null
          created_at: string
          created_by: string | null
          "DigiCom Business": string
          display_name: string
          id: string
          is_default: boolean
          last_verified_at: string | null
          pixel_id: string | null
          token_expires_at: string | null
          token_secret_id: string
          updated_at: string
          verification_error: string | null
          verification_status: string
        }
        Insert: {
          ad_account_id: string
          business_id_meta?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business": string
          display_name: string
          id?: string
          is_default?: boolean
          last_verified_at?: string | null
          pixel_id?: string | null
          token_expires_at?: string | null
          token_secret_id: string
          updated_at?: string
          verification_error?: string | null
          verification_status?: string
        }
        Update: {
          ad_account_id?: string
          business_id_meta?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string
          display_name?: string
          id?: string
          is_default?: boolean
          last_verified_at?: string | null
          pixel_id?: string | null
          token_expires_at?: string | null
          token_secret_id?: string
          updated_at?: string
          verification_error?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_connections_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "meta_ads_connections_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      old_seller_daily_earnings: {
        Row: {
          commission_earned: number | null
          created_at: string | null
          date: string | null
          delivered_count: number | null
          "DigiCom Business": string | null
          id: string
          salary_earned: number | null
          seller_id: string | null
          total_earned: number | null
        }
        Insert: {
          commission_earned?: number | null
          created_at?: string | null
          date?: string | null
          delivered_count?: number | null
          "DigiCom Business"?: string | null
          id?: string
          salary_earned?: number | null
          seller_id?: string | null
          total_earned?: number | null
        }
        Update: {
          commission_earned?: number | null
          created_at?: string | null
          date?: string | null
          delivered_count?: number | null
          "DigiCom Business"?: string | null
          id?: string
          salary_earned?: number | null
          seller_id?: string | null
          total_earned?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_daily_earnings_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "seller_daily_earnings_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_daily_earnings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          accessory_id: string | null
          accessory_quantity: number | null
          accessory_unit_price: number | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          order_id: string
          product_id: string
          product_unit_cost_snapshot: number | null
          quantity: number
          total_price: number | null
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          accessory_id?: string | null
          accessory_quantity?: number | null
          accessory_unit_price?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id: string
          product_id: string
          product_unit_cost_snapshot?: number | null
          quantity?: number
          total_price?: number | null
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          accessory_id?: string | null
          accessory_quantity?: number | null
          accessory_unit_price?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          order_id?: string
          product_id?: string
          product_unit_cost_snapshot?: number | null
          quantity?: number
          total_price?: number | null
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "accessories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "order_items_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          comment: string | null
          created_at: string
          "DigiCom Business": string
          id: string
          order_id: string
          status_id: string
        }
        Insert: {
          changed_by?: string | null
          comment?: string | null
          created_at?: string
          "DigiCom Business": string
          id?: string
          order_id: string
          status_id: string
        }
        Update: {
          changed_by?: string | null
          comment?: string | null
          created_at?: string
          "DigiCom Business"?: string
          id?: string
          order_id?: string
          status_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_status_history_business"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "fk_order_status_history_business"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_statuses: {
        Row: {
          active: boolean | null
          category: string | null
          code: string
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          label: string
          perf_breakdown: boolean
          perf_breakdown_phase: string | null
          ranking: number | null
          recheck: boolean | null
          show_in_order: boolean
          show_in_quick_status: boolean
          show_in_seller_confirmation: boolean
          show_in_seller_suivi: boolean
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          code: string
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          label: string
          perf_breakdown?: boolean
          perf_breakdown_phase?: string | null
          ranking?: number | null
          recheck?: boolean | null
          show_in_order?: boolean
          show_in_quick_status?: boolean
          show_in_seller_confirmation?: boolean
          show_in_seller_suivi?: boolean
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          code?: string
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          label?: string
          perf_breakdown?: boolean
          perf_breakdown_phase?: string | null
          ranking?: number | null
          recheck?: boolean | null
          show_in_order?: boolean
          show_in_quick_status?: boolean
          show_in_seller_confirmation?: boolean
          show_in_seller_suivi?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          address: string | null
          ameex_old_tracking: string | null
          annulation_date: string | null
          assign_id: string | null
          assignment_date: string | null
          canceled_by_id: string | null
          city_id: string | null
          coliaty_old_tracking: string | null
          company_id: string | null
          confirmation_date: string | null
          confirmed_by_id: string | null
          courier_id: string | null
          created_at: string | null
          current_courier_payment_note_id: string | null
          current_courier_return_note_id: string | null
          current_delivery_note_id: string | null
          current_return_note_id: string | null
          date: string | null
          date_deleted: string | null
          date_livraison: string | null
          delivered: boolean | null
          delivery_fees_id: string | null
          delivery_note: string | null
          delivery_type: string | null
          "DigiCom Business": string | null
          forcelog_old_tracking: string | null
          free_shipping: boolean | null
          id: string
          include_delivery_in_total: boolean
          master_city_id: string | null
          name: string | null
          note: string | null
          old_client_id: string | null
          order_status_id: string | null
          package_status_color: string | null
          package_status_id: string | null
          package_status_label: string | null
          payed: boolean | null
          payment_delivery_id: string | null
          phone: string | null
          price: number | null
          processing: boolean | null
          published: boolean | null
          quicklivraison_old_tracking: string | null
          raw_price: number | null
          replace: boolean | null
          reported_date: string | null
          seller_id: string | null
          sendit_old_tracking: string | null
          shipping_cost: number | null
          source_id: string | null
          source_name: string | null
          stock_changed: boolean | null
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          ameex_old_tracking?: string | null
          annulation_date?: string | null
          assign_id?: string | null
          assignment_date?: string | null
          canceled_by_id?: string | null
          city_id?: string | null
          coliaty_old_tracking?: string | null
          company_id?: string | null
          confirmation_date?: string | null
          confirmed_by_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          current_courier_payment_note_id?: string | null
          current_courier_return_note_id?: string | null
          current_delivery_note_id?: string | null
          current_return_note_id?: string | null
          date?: string | null
          date_deleted?: string | null
          date_livraison?: string | null
          delivered?: boolean | null
          delivery_fees_id?: string | null
          delivery_note?: string | null
          delivery_type?: string | null
          "DigiCom Business"?: string | null
          forcelog_old_tracking?: string | null
          free_shipping?: boolean | null
          id?: string
          include_delivery_in_total?: boolean
          master_city_id?: string | null
          name?: string | null
          note?: string | null
          old_client_id?: string | null
          order_status_id?: string | null
          package_status_color?: string | null
          package_status_id?: string | null
          package_status_label?: string | null
          payed?: boolean | null
          payment_delivery_id?: string | null
          phone?: string | null
          price?: number | null
          processing?: boolean | null
          published?: boolean | null
          quicklivraison_old_tracking?: string | null
          raw_price?: number | null
          replace?: boolean | null
          reported_date?: string | null
          seller_id?: string | null
          sendit_old_tracking?: string | null
          shipping_cost?: number | null
          source_id?: string | null
          source_name?: string | null
          stock_changed?: boolean | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          ameex_old_tracking?: string | null
          annulation_date?: string | null
          assign_id?: string | null
          assignment_date?: string | null
          canceled_by_id?: string | null
          city_id?: string | null
          coliaty_old_tracking?: string | null
          company_id?: string | null
          confirmation_date?: string | null
          confirmed_by_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          current_courier_payment_note_id?: string | null
          current_courier_return_note_id?: string | null
          current_delivery_note_id?: string | null
          current_return_note_id?: string | null
          date?: string | null
          date_deleted?: string | null
          date_livraison?: string | null
          delivered?: boolean | null
          delivery_fees_id?: string | null
          delivery_note?: string | null
          delivery_type?: string | null
          "DigiCom Business"?: string | null
          forcelog_old_tracking?: string | null
          free_shipping?: boolean | null
          id?: string
          include_delivery_in_total?: boolean
          master_city_id?: string | null
          name?: string | null
          note?: string | null
          old_client_id?: string | null
          order_status_id?: string | null
          package_status_color?: string | null
          package_status_id?: string | null
          package_status_label?: string | null
          payed?: boolean | null
          payment_delivery_id?: string | null
          phone?: string | null
          price?: number | null
          processing?: boolean | null
          published?: boolean | null
          quicklivraison_old_tracking?: string | null
          raw_price?: number | null
          replace?: boolean | null
          reported_date?: string | null
          seller_id?: string | null
          sendit_old_tracking?: string | null
          shipping_cost?: number | null
          source_id?: string | null
          source_name?: string | null
          stock_changed?: boolean | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_assign_id_fkey"
            columns: ["assign_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_confirmed_by_id_fkey"
            columns: ["confirmed_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_current_courier_payment_note_id_fkey"
            columns: ["current_courier_payment_note_id"]
            isOneToOne: false
            referencedRelation: "courier_payment_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_current_courier_return_note_id_fkey"
            columns: ["current_courier_return_note_id"]
            isOneToOne: false
            referencedRelation: "courier_return_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_master_city_id_fkey"
            columns: ["master_city_id"]
            isOneToOne: false
            referencedRelation: "master_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_order_status_id_fkey"
            columns: ["order_status_id"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_package_status_id_fkey"
            columns: ["package_status_id"]
            isOneToOne: false
            referencedRelation: "package_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ozonexpress_cities: {
        Row: {
          created_at: string
          delivered_price: number | null
          id: string
          name: string | null
          ozon_city_id: number
          ref: string | null
          refused_price: number | null
          returned_price: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          delivered_price?: number | null
          id?: string
          name?: string | null
          ozon_city_id: number
          ref?: string | null
          refused_price?: number | null
          returned_price?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          delivered_price?: number | null
          id?: string
          name?: string | null
          ozon_city_id?: number
          ref?: string | null
          refused_price?: number | null
          returned_price?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      package_statuses: {
        Row: {
          active: boolean | null
          category: string | null
          code: string
          color: string | null
          created_at: string | null
          delivery_service_statuses: Json | null
          icon: string | null
          id: string
          label: string
          perf_breakdown: boolean
          perf_breakdown_phase: string | null
          ranking: number | null
          recheck: boolean | null
          show_in_courier: boolean
          show_in_seller_confirmation: boolean
          show_in_seller_suivi: boolean
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          code: string
          color?: string | null
          created_at?: string | null
          delivery_service_statuses?: Json | null
          icon?: string | null
          id?: string
          label: string
          perf_breakdown?: boolean
          perf_breakdown_phase?: string | null
          ranking?: number | null
          recheck?: boolean | null
          show_in_courier?: boolean
          show_in_seller_confirmation?: boolean
          show_in_seller_suivi?: boolean
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          code?: string
          color?: string | null
          created_at?: string | null
          delivery_service_statuses?: Json | null
          icon?: string | null
          id?: string
          label?: string
          perf_breakdown?: boolean
          perf_breakdown_phase?: string | null
          ranking?: number | null
          recheck?: boolean | null
          show_in_courier?: boolean
          show_in_seller_confirmation?: boolean
          show_in_seller_suivi?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          description: string | null
          features: Json | null
          id: string
          license_type: string
          name: string
          old_price: number | null
          price: number
          promotion_active: boolean
          promotion_label: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json | null
          id?: string
          license_type: string
          name: string
          old_price?: number | null
          price: number
          promotion_active?: boolean
          promotion_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json | null
          id?: string
          license_type?: string
          name?: string
          old_price?: number | null
          price?: number
          promotion_active?: boolean
          promotion_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      product_accessories: {
        Row: {
          accessory_id: string
          created_at: string | null
          default_quantity: number
          "DigiCom Business": string | null
          id: string
          product_id: string
        }
        Insert: {
          accessory_id: string
          created_at?: string | null
          default_quantity?: number
          "DigiCom Business"?: string | null
          id?: string
          product_id: string
        }
        Update: {
          accessory_id?: string
          created_at?: string | null
          default_quantity?: number
          "DigiCom Business"?: string | null
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_accessories_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "accessories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_accessories_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "product_accessories_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_accessories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean | null
          code: string
          cost_price: number
          created_at: string | null
          description: string | null
          "DigiCom Business": string | null
          id: string
          image_url: string | null
          label: string | null
          name: string
          selling_price: number
          stock: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          code: string
          cost_price?: number
          created_at?: string | null
          description?: string | null
          "DigiCom Business"?: string | null
          id?: string
          image_url?: string | null
          label?: string | null
          name: string
          selling_price?: number
          stock?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          code?: string
          cost_price?: number
          created_at?: string | null
          description?: string | null
          "DigiCom Business"?: string | null
          id?: string
          image_url?: string | null
          label?: string | null
          name?: string
          selling_price?: number
          stock?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "products_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cities: {
        Row: {
          created_at: string | null
          fees: Json | null
          id: string
          lat: number | null
          lng: number | null
          master_city_id: string | null
          metadata: Json | null
          provider_city_id: string | null
          provider_city_name: string
          provider_type: string
          schedule: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          fees?: Json | null
          id?: string
          lat?: number | null
          lng?: number | null
          master_city_id?: string | null
          metadata?: Json | null
          provider_city_id?: string | null
          provider_city_name: string
          provider_type: string
          schedule?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          fees?: Json | null
          id?: string
          lat?: number | null
          lng?: number | null
          master_city_id?: string | null
          metadata?: Json | null
          provider_city_id?: string | null
          provider_city_name?: string
          provider_type?: string
          schedule?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_cities_master_city_id_fkey"
            columns: ["master_city_id"]
            isOneToOne: false
            referencedRelation: "master_cities"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_webhooks: {
        Row: {
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          is_active: boolean | null
          last_received_at: string | null
          provider_id: string
          updated_at: string | null
          webhook_secret: string
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          provider_id: string
          updated_at?: string | null
          webhook_secret: string
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          provider_id?: string
          updated_at?: string | null
          webhook_secret?: string
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_webhooks_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "provider_webhooks_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhooks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          active: boolean
          ameex_parcel_fragile: boolean
          ameex_parcel_open: boolean
          ameex_parcel_replace: boolean
          ameex_parcel_try_on: boolean
          api_base_url: string | null
          api_key: string | null
          api_login: string | null
          api_password: string | null
          api_public_key: string | null
          api_secret_key: string | null
          business_id: string | null
          business_name: string | null
          coliaty_package_no_open: boolean
          color: string | null
          created_at: string | null
          "DigiCom Business": string | null
          forcelog_parcel_carton: boolean
          forcelog_parcel_fragile: boolean
          forcelog_parcel_open: boolean
          id: string
          logo_url: string | null
          name: string
          ozon_parcel_fragile: number
          ozon_parcel_open: number
          ozon_parcel_replace: number
          provider_type: string | null
          quicklivraison_parcel_fragile: boolean
          quicklivraison_parcel_open: boolean
          quicklivraison_parcel_try_on: boolean
          sendit_allow_try: boolean
          sendit_pickup_address: string | null
          sendit_pickup_district_id: number | null
          sendit_pickup_name: string | null
          sendit_pickup_phone: string | null
          session_cache: Json | null
          updated_at: string | null
          vitex_parcel_fragile: boolean
          vitex_parcel_open: boolean
        }
        Insert: {
          active?: boolean
          ameex_parcel_fragile?: boolean
          ameex_parcel_open?: boolean
          ameex_parcel_replace?: boolean
          ameex_parcel_try_on?: boolean
          api_base_url?: string | null
          api_key?: string | null
          api_login?: string | null
          api_password?: string | null
          api_public_key?: string | null
          api_secret_key?: string | null
          business_id?: string | null
          business_name?: string | null
          coliaty_package_no_open?: boolean
          color?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          forcelog_parcel_carton?: boolean
          forcelog_parcel_fragile?: boolean
          forcelog_parcel_open?: boolean
          id?: string
          logo_url?: string | null
          name: string
          ozon_parcel_fragile?: number
          ozon_parcel_open?: number
          ozon_parcel_replace?: number
          provider_type?: string | null
          quicklivraison_parcel_fragile?: boolean
          quicklivraison_parcel_open?: boolean
          quicklivraison_parcel_try_on?: boolean
          sendit_allow_try?: boolean
          sendit_pickup_address?: string | null
          sendit_pickup_district_id?: number | null
          sendit_pickup_name?: string | null
          sendit_pickup_phone?: string | null
          session_cache?: Json | null
          updated_at?: string | null
          vitex_parcel_fragile?: boolean
          vitex_parcel_open?: boolean
        }
        Update: {
          active?: boolean
          ameex_parcel_fragile?: boolean
          ameex_parcel_open?: boolean
          ameex_parcel_replace?: boolean
          ameex_parcel_try_on?: boolean
          api_base_url?: string | null
          api_key?: string | null
          api_login?: string | null
          api_password?: string | null
          api_public_key?: string | null
          api_secret_key?: string | null
          business_id?: string | null
          business_name?: string | null
          coliaty_package_no_open?: boolean
          color?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          forcelog_parcel_carton?: boolean
          forcelog_parcel_fragile?: boolean
          forcelog_parcel_open?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          ozon_parcel_fragile?: number
          ozon_parcel_open?: number
          ozon_parcel_replace?: number
          provider_type?: string | null
          quicklivraison_parcel_fragile?: boolean
          quicklivraison_parcel_open?: boolean
          quicklivraison_parcel_try_on?: boolean
          sendit_allow_try?: boolean
          sendit_pickup_address?: string | null
          sendit_pickup_district_id?: number | null
          sendit_pickup_name?: string | null
          sendit_pickup_phone?: string | null
          session_cache?: Json | null
          updated_at?: string | null
          vitex_parcel_fragile?: boolean
          vitex_parcel_open?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "providers_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "providers_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          "DigiCom Business": string | null
          endpoint: string
          id: string
          p256dh: string
          platform: string | null
          revoked_at: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          "DigiCom Business"?: string | null
          endpoint: string
          id?: string
          p256dh: string
          platform?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          "DigiCom Business"?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          platform?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "push_subscriptions_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channels: {
        Row: {
          consumer_key: string | null
          consumer_secret: string | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          name: string
          spreadsheet_id: string | null
          spreadsheet_name: string | null
          start_row: number | null
          type: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name: string
          spreadsheet_id?: string | null
          spreadsheet_name?: string | null
          start_row?: number | null
          type: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name?: string
          spreadsheet_id?: string | null
          spreadsheet_name?: string | null
          start_row?: number | null
          type?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_channels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "sales_channels_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_attribution_state: {
        Row: {
          business_id: string
          created_at: string
          credit: number
          date: string
          id: string
          orders_today: number
          seller_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          credit?: number
          date?: string
          id?: string
          orders_today?: number
          seller_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          credit?: number
          date?: string
          id?: string
          orders_today?: number
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_attribution_state_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "seller_attribution_state_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_attribution_state_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_demands: {
        Row: {
          admin_response: string | null
          admin_response_media: Json
          category: string | null
          content: string | null
          created_at: string | null
          "DigiCom Business": string
          id: string
          media: Json
          priority: string | null
          responded_at: string | null
          seller_id: string | null
          status: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          admin_response?: string | null
          admin_response_media?: Json
          category?: string | null
          content?: string | null
          created_at?: string | null
          "DigiCom Business": string
          id?: string
          media?: Json
          priority?: string | null
          responded_at?: string | null
          seller_id?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_response?: string | null
          admin_response_media?: Json
          category?: string | null
          content?: string | null
          created_at?: string | null
          "DigiCom Business"?: string
          id?: string
          media?: Json
          priority?: string | null
          responded_at?: string | null
          seller_id?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_demands_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "seller_demands_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_demands_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_payments: {
        Row: {
          bank_snapshot: Json | null
          commission_earned: number | null
          created_at: string | null
          days_present: number | null
          delivered_orders: number | null
          "DigiCom Business": string | null
          id: string
          paid_at: string | null
          payout_month: string | null
          salary_earned: number | null
          seller_id: string | null
          status: string | null
          total_amount: number | null
        }
        Insert: {
          bank_snapshot?: Json | null
          commission_earned?: number | null
          created_at?: string | null
          days_present?: number | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          id?: string
          paid_at?: string | null
          payout_month?: string | null
          salary_earned?: number | null
          seller_id?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          bank_snapshot?: Json | null
          commission_earned?: number | null
          created_at?: string | null
          days_present?: number | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          id?: string
          paid_at?: string | null
          payout_month?: string | null
          salary_earned?: number | null
          seller_id?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_payments_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "seller_payments_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_payments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_presences: {
        Row: {
          created_at: string | null
          date: string | null
          "DigiCom Business": string | null
          id: string
          seller_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          seller_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          seller_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_presences_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "seller_presences_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_presences_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_sync_runs: {
        Row: {
          changed: number
          duration_ms: number | null
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          started_at: string
          status: string
          total: number
          trigger: string
        }
        Insert: {
          changed?: number
          duration_ms?: number | null
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          total?: number
          trigger?: string
        }
        Update: {
          changed?: number
          duration_ms?: number | null
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          total?: number
          trigger?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          address: string | null
          created_at: string | null
          date: string | null
          "DigiCom Business": string | null
          email: string | null
          id: string
          name: string
          note: string | null
          paid_price: number | null
          phone: string | null
          price: number | null
          product_id: string | null
          quantity: number | null
          status: string | null
          total_price: number | null
          tva: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          email?: string | null
          id?: string
          name: string
          note?: string | null
          paid_price?: number | null
          phone?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          status?: string | null
          total_price?: number | null
          tva?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          paid_price?: number | null
          phone?: string | null
          price?: number | null
          product_id?: string | null
          quantity?: number | null
          status?: string | null
          total_price?: number | null
          tva?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "transactions_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      trns_payment: {
        Row: {
          amount: number
          created_at: string | null
          date: string | null
          "DigiCom Business": string | null
          id: string
          method: string | null
          transaction_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          method?: string | null
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          method?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trns_payment_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "trns_payment_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trns_payment_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      trns_purchase: {
        Row: {
          accessory_id: string | null
          accessory_quantity: number | null
          accessory_sub_total: number | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          product_id: string | null
          quantity: number
          sub_total: number
          transaction_id: string | null
        }
        Insert: {
          accessory_id?: string | null
          accessory_quantity?: number | null
          accessory_sub_total?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          product_id?: string | null
          quantity?: number
          sub_total?: number
          transaction_id?: string | null
        }
        Update: {
          accessory_id?: string | null
          accessory_quantity?: number | null
          accessory_sub_total?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          product_id?: string | null
          quantity?: number
          sub_total?: number
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trns_purchase_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "accessories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trns_purchase_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "trns_purchase_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trns_purchase_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trns_purchase_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean | null
          address: string | null
          assignment: number | null
          avatar_url: string | null
          bank_account_holder: string | null
          bank_name: string | null
          bank_rib: string | null
          cin_number: string | null
          commission_basis: string
          commission_price: number | null
          courier_parcel_fragile: boolean | null
          courier_parcel_open: boolean | null
          courier_parcel_try_on: boolean | null
          created_at: string
          "DigiCom Business": string | null
          email: string
          id: string
          name: string
          payment_type: string | null
          permissions: Json | null
          phone: string | null
          products: Json | null
          role: Database["public"]["Enums"]["user_role"]
          salary_amount: number | null
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          assignment?: number | null
          avatar_url?: string | null
          bank_account_holder?: string | null
          bank_name?: string | null
          bank_rib?: string | null
          cin_number?: string | null
          commission_basis?: string
          commission_price?: number | null
          courier_parcel_fragile?: boolean | null
          courier_parcel_open?: boolean | null
          courier_parcel_try_on?: boolean | null
          created_at?: string
          "DigiCom Business"?: string | null
          email: string
          id?: string
          name: string
          payment_type?: string | null
          permissions?: Json | null
          phone?: string | null
          products?: Json | null
          role: Database["public"]["Enums"]["user_role"]
          salary_amount?: number | null
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean | null
          address?: string | null
          assignment?: number | null
          avatar_url?: string | null
          bank_account_holder?: string | null
          bank_name?: string | null
          bank_rib?: string | null
          cin_number?: string | null
          commission_basis?: string
          commission_price?: number | null
          courier_parcel_fragile?: boolean | null
          courier_parcel_open?: boolean | null
          courier_parcel_try_on?: boolean | null
          created_at?: string
          "DigiCom Business"?: string | null
          email?: string
          id?: string
          name?: string
          payment_type?: string | null
          permissions?: Json | null
          phone?: string | null
          products?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          salary_amount?: number | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "users_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_auto_replies: {
        Row: {
          active_hours_end: string | null
          active_hours_start: string | null
          active_weekdays: number[] | null
          business_id: string
          cooldown_seconds: number
          created_at: string
          id: string
          instance_id: string | null
          is_active: boolean
          media_id: string | null
          reply_message: string
          trigger_kind: string
          trigger_value: string
        }
        Insert: {
          active_hours_end?: string | null
          active_hours_start?: string | null
          active_weekdays?: number[] | null
          business_id: string
          cooldown_seconds?: number
          created_at?: string
          id?: string
          instance_id?: string | null
          is_active?: boolean
          media_id?: string | null
          reply_message: string
          trigger_kind: string
          trigger_value: string
        }
        Update: {
          active_hours_end?: string | null
          active_hours_start?: string | null
          active_weekdays?: number[] | null
          business_id?: string
          cooldown_seconds?: number
          created_at?: string
          id?: string
          instance_id?: string | null
          is_active?: boolean
          media_id?: string | null
          reply_message?: string
          trigger_kind?: string
          trigger_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_auto_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_auto_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "wa_media"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_avatar_fetch_queue: {
        Row: {
          attempts: number
          business_id: string
          contact_id: string
          enqueued_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_try_at: string
          priority: number
          processed_at: string | null
        }
        Insert: {
          attempts?: number
          business_id: string
          contact_id: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_try_at?: string
          priority?: number
          processed_at?: string | null
        }
        Update: {
          attempts?: number
          business_id?: string
          contact_id?: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_try_at?: string
          priority?: number
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_avatar_fetch_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_avatar_fetch_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contacts: {
        Row: {
          blocked_at: string | null
          business_id: string
          created_at: string
          custom_name: string | null
          first_seen_at: string
          id: string
          is_blocked: boolean
          is_business: boolean
          last_seen_at: string
          phone_e164: string | null
          primary_lid: string | null
          profile_pic_fetched_at: string | null
          profile_pic_url: string | null
          updated_at: string
          whatsapp_name: string | null
        }
        Insert: {
          blocked_at?: string | null
          business_id: string
          created_at?: string
          custom_name?: string | null
          first_seen_at?: string
          id?: string
          is_blocked?: boolean
          is_business?: boolean
          last_seen_at?: string
          phone_e164?: string | null
          primary_lid?: string | null
          profile_pic_fetched_at?: string | null
          profile_pic_url?: string | null
          updated_at?: string
          whatsapp_name?: string | null
        }
        Update: {
          blocked_at?: string | null
          business_id?: string
          created_at?: string
          custom_name?: string | null
          first_seen_at?: string
          id?: string
          is_blocked?: boolean
          is_business?: boolean
          last_seen_at?: string
          phone_e164?: string | null
          primary_lid?: string | null
          profile_pic_fetched_at?: string | null
          profile_pic_url?: string | null
          updated_at?: string
          whatsapp_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_group_participants: {
        Row: {
          contact_id: string | null
          group_id: string
          id: string
          jid: string
          joined_at: string
          left_at: string | null
          role: string
        }
        Insert: {
          contact_id?: string | null
          group_id: string
          id?: string
          jid: string
          joined_at?: string
          left_at?: string | null
          role?: string
        }
        Update: {
          contact_id?: string | null
          group_id?: string
          id?: string
          jid?: string
          joined_at?: string
          left_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_group_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "wa_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_groups: {
        Row: {
          business_id: string
          created_at: string
          creation_ts: string | null
          description: string | null
          group_jid: string
          id: string
          instance_id: string
          invite_code: string | null
          is_announce: boolean
          is_community: boolean
          is_locked: boolean
          owner_jid: string | null
          participant_count: number
          profile_pic_url: string | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          creation_ts?: string | null
          description?: string | null
          group_jid: string
          id?: string
          instance_id: string
          invite_code?: string | null
          is_announce?: boolean
          is_community?: boolean
          is_locked?: boolean
          owner_jid?: string | null
          participant_count?: number
          profile_pic_url?: string | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          creation_ts?: string | null
          description?: string | null
          group_jid?: string
          id?: string
          instance_id?: string
          invite_code?: string | null
          is_announce?: boolean
          is_community?: boolean
          is_locked?: boolean
          owner_jid?: string | null
          participant_count?: number
          profile_pic_url?: string | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_instances: {
        Row: {
          business_id: string
          created_at: string
          evo_instance_id: string
          evo_token: string
          id: string
          last_event_at: string | null
          name: string
          owner_lid: string | null
          owner_phone_e164: string | null
          paired_at: string | null
          profile_pic_url: string | null
          status: string
          status_changed_at: string | null
          status_reason: string | null
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          business_id: string
          created_at?: string
          evo_instance_id: string
          evo_token: string
          id?: string
          last_event_at?: string | null
          name: string
          owner_lid?: string | null
          owner_phone_e164?: string | null
          paired_at?: string | null
          profile_pic_url?: string | null
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          evo_instance_id?: string
          evo_token?: string
          id?: string
          last_event_at?: string | null
          name?: string
          owner_lid?: string | null
          owner_phone_e164?: string | null
          paired_at?: string | null
          profile_pic_url?: string | null
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_jid_aliases: {
        Row: {
          business_id: string
          contact_id: string
          first_seen_at: string
          id: string
          is_primary: boolean
          jid: string
          jid_kind: string
          last_seen_at: string
        }
        Insert: {
          business_id: string
          contact_id: string
          first_seen_at?: string
          id?: string
          is_primary?: boolean
          jid: string
          jid_kind: string
          last_seen_at?: string
        }
        Update: {
          business_id?: string
          contact_id?: string
          first_seen_at?: string
          id?: string
          is_primary?: boolean
          jid?: string
          jid_kind?: string
          last_seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_jid_aliases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_jid_aliases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_jid_aliases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_jid_aliases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_labels: {
        Row: {
          business_id: string
          color: string
          created_at: string
          evo_label_id: string | null
          id: string
          instance_id: string | null
          name: string
          predefined_id: string | null
        }
        Insert: {
          business_id: string
          color?: string
          created_at?: string
          evo_label_id?: string | null
          id?: string
          instance_id?: string | null
          name: string
          predefined_id?: string | null
        }
        Update: {
          business_id?: string
          color?: string
          created_at?: string
          evo_label_id?: string | null
          id?: string
          instance_id?: string | null
          name?: string
          predefined_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_media: {
        Row: {
          business_id: string
          cdn_url: string | null
          cdn_url_expires_at: string | null
          created_at: string
          download_attempts: number
          download_error: string | null
          download_failed_at: string | null
          duration_seconds: number | null
          evo_direct_path: string | null
          evo_media_key: string | null
          evo_message_id: string | null
          file_name: string | null
          file_size_bytes: number | null
          height: number | null
          id: string
          mime_type: string
          sha256: string | null
          storage_bucket: string
          storage_path: string | null
          thumbnail_storage_path: string | null
          uploaded_at: string | null
          width: number | null
        }
        Insert: {
          business_id: string
          cdn_url?: string | null
          cdn_url_expires_at?: string | null
          created_at?: string
          download_attempts?: number
          download_error?: string | null
          download_failed_at?: string | null
          duration_seconds?: number | null
          evo_direct_path?: string | null
          evo_media_key?: string | null
          evo_message_id?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          mime_type: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string | null
          thumbnail_storage_path?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Update: {
          business_id?: string
          cdn_url?: string | null
          cdn_url_expires_at?: string | null
          created_at?: string
          download_attempts?: number
          download_error?: string | null
          download_failed_at?: string | null
          duration_seconds?: number | null
          evo_direct_path?: string | null
          evo_media_key?: string | null
          evo_message_id?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          mime_type?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string | null
          thumbnail_storage_path?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_media_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_media_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          business_id: string
          contact_id: string | null
          deleted_at: string | null
          deleted_by_user_id: string | null
          direction: string
          edited_at: string | null
          edited_text: string | null
          forward_score: number
          id: string
          instance_id: string
          is_forwarded: boolean
          media_id: string | null
          message_kind: string
          raw_payload: Json | null
          received_at: string
          reply_to_message_id: string | null
          reply_to_text: string | null
          reply_to_wa_id: string | null
          status: string
          status_changed_at: string | null
          text_content: string | null
          thread_id: string
          wa_from_me: boolean
          wa_message_id: string
          wa_remote_jid: string
          wa_sender_jid: string | null
          wa_timestamp: string
        }
        Insert: {
          business_id: string
          contact_id?: string | null
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          direction: string
          edited_at?: string | null
          edited_text?: string | null
          forward_score?: number
          id?: string
          instance_id: string
          is_forwarded?: boolean
          media_id?: string | null
          message_kind: string
          raw_payload?: Json | null
          received_at?: string
          reply_to_message_id?: string | null
          reply_to_text?: string | null
          reply_to_wa_id?: string | null
          status?: string
          status_changed_at?: string | null
          text_content?: string | null
          thread_id: string
          wa_from_me: boolean
          wa_message_id: string
          wa_remote_jid: string
          wa_sender_jid?: string | null
          wa_timestamp: string
        }
        Update: {
          business_id?: string
          contact_id?: string | null
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          direction?: string
          edited_at?: string | null
          edited_text?: string | null
          forward_score?: number
          id?: string
          instance_id?: string
          is_forwarded?: boolean
          media_id?: string | null
          message_kind?: string
          raw_payload?: Json | null
          received_at?: string
          reply_to_message_id?: string | null
          reply_to_text?: string | null
          reply_to_wa_id?: string | null
          status?: string
          status_changed_at?: string | null
          text_content?: string | null
          thread_id?: string
          wa_from_me?: boolean
          wa_message_id?: string
          wa_remote_jid?: string
          wa_sender_jid?: string | null
          wa_timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_deleted_by_user_id_fkey"
            columns: ["deleted_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "wa_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_quick_replies: {
        Row: {
          business_id: string
          created_at: string
          created_by_user_id: string | null
          id: string
          media_id: string | null
          message: string
          shortcut: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          media_id?: string | null
          message: string
          shortcut: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          media_id?: string | null
          message?: string
          shortcut?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_quick_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_quick_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_quick_replies_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_quick_replies_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "wa_media"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_reactions: {
        Row: {
          emoji: string
          message_id: string
          reacted_at: string
          reactor_contact_id: string | null
          reactor_jid: string
        }
        Insert: {
          emoji: string
          message_id: string
          reacted_at?: string
          reactor_contact_id?: string | null
          reactor_jid: string
        }
        Update: {
          emoji?: string
          message_id?: string
          reacted_at?: string
          reactor_contact_id?: string | null
          reactor_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_reactions_reactor_contact_id_fkey"
            columns: ["reactor_contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_reactions_reactor_contact_id_fkey"
            columns: ["reactor_contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_sync_jobs: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          current_phase: string | null
          error_message: string | null
          id: string
          instance_id: string
          kind: string
          max_retries: number
          metadata: Json
          phase_cursor: Json
          retry_count: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          current_phase?: string | null
          error_message?: string | null
          id?: string
          instance_id: string
          kind: string
          max_retries?: number
          metadata?: Json
          phase_cursor?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          current_phase?: string | null
          error_message?: string | null
          id?: string
          instance_id?: string
          kind?: string
          max_retries?: number
          metadata?: Json
          phase_cursor?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_sync_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_thread_labels: {
        Row: {
          applied_at: string
          label_id: string
          thread_id: string
        }
        Insert: {
          applied_at?: string
          label_id: string
          thread_id: string
        }
        Update: {
          applied_at?: string
          label_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_thread_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "wa_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_thread_pinned: {
        Row: {
          message_id: string
          pinned_at: string
          pinned_by_user_id: string | null
          thread_id: string
        }
        Insert: {
          message_id: string
          pinned_at?: string
          pinned_by_user_id?: string | null
          thread_id: string
        }
        Update: {
          message_id?: string
          pinned_at?: string
          pinned_by_user_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_thread_pinned_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_pinned_by_user_id_fkey"
            columns: ["pinned_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_threads: {
        Row: {
          ai_mode_resolved: Database["public"]["Enums"]["ai_thread_mode_value"]
          business_id: string
          contact_id: string | null
          created_at: string
          group_id: string | null
          id: string
          instance_id: string
          kind: string
          last_message_at: string | null
          last_message_direction: string | null
          last_message_id: string | null
          last_message_kind: string | null
          last_message_preview: string | null
          last_message_sender_jid: string | null
          last_message_status: string | null
          message_count: number
          unread_count: number
          updated_at: string
        }
        Insert: {
          ai_mode_resolved?: Database["public"]["Enums"]["ai_thread_mode_value"]
          business_id: string
          contact_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          instance_id: string
          kind: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_id?: string | null
          last_message_kind?: string | null
          last_message_preview?: string | null
          last_message_sender_jid?: string | null
          last_message_status?: string | null
          message_count?: number
          unread_count?: number
          updated_at?: string
        }
        Update: {
          ai_mode_resolved?: Database["public"]["Enums"]["ai_thread_mode_value"]
          business_id?: string
          contact_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          instance_id?: string
          kind?: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_id?: string | null
          last_message_kind?: string | null
          last_message_preview?: string | null
          last_message_sender_jid?: string | null
          last_message_status?: string | null
          message_count?: number
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "wa_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_last_message_fk"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_last_message_fk"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_user_instance_access: {
        Row: {
          business_id: string
          granted_at: string
          granted_by: string | null
          instance_id: string
          scope: string
          user_id: string
        }
        Insert: {
          business_id: string
          granted_at?: string
          granted_by?: string | null
          instance_id?: string
          scope?: string
          user_id: string
        }
        Update: {
          business_id?: string
          granted_at?: string
          granted_by?: string | null
          instance_id?: string
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_user_instance_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_user_instance_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_instance_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_instance_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_user_starred: {
        Row: {
          message_id: string
          starred_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          starred_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          starred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_user_starred_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_starred_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_starred_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_user_thread_state: {
        Row: {
          draft_text: string | null
          draft_updated_at: string | null
          internal_note: string | null
          is_archived: boolean
          is_muted: boolean
          is_pinned: boolean
          last_read_at: string | null
          last_read_message_id: string | null
          muted_until: string | null
          thread_id: string
          user_id: string
        }
        Insert: {
          draft_text?: string | null
          draft_updated_at?: string | null
          internal_note?: string | null
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: string | null
          last_read_message_id?: string | null
          muted_until?: string | null
          thread_id: string
          user_id: string
        }
        Update: {
          draft_text?: string | null
          draft_updated_at?: string | null
          internal_note?: string | null
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: string | null
          last_read_message_id?: string | null
          muted_until?: string | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_user_thread_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_webhook_events: {
        Row: {
          event_type: string
          evo_instance_name: string | null
          id: string
          idempotency_key: string
          instance_id: string | null
          max_retries: number
          next_retry_at: string | null
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
          retry_count: number
        }
        Insert: {
          event_type: string
          evo_instance_name?: string | null
          id?: string
          idempotency_key: string
          instance_id?: string | null
          max_retries?: number
          next_retry_at?: string | null
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          retry_count?: number
        }
        Update: {
          event_type?: string
          evo_instance_name?: string | null
          id?: string
          idempotency_key?: string
          instance_id?: string | null
          max_retries?: number
          next_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          retry_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wa_webhook_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_webhook_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_webhook_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          "DigiCom Business": string | null
          error_message: string | null
          id: string
          payload: Json
          processed: boolean
          provider_id: string | null
          tracking_code: string | null
        }
        Insert: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          error_message?: string | null
          id?: string
          payload?: Json
          processed?: boolean
          provider_id?: string | null
          tracking_code?: string | null
        }
        Update: {
          created_at?: string | null
          "DigiCom Business"?: string | null
          error_message?: string | null
          id?: string
          payload?: Json
          processed?: boolean
          provider_id?: string | null
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "webhook_logs_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_logs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      ai_business_health: {
        Row: {
          business_id: string | null
          business_monthly_cap_usd: number | null
          business_quota_status:
            | Database["public"]["Enums"]["ai_provider_key_status"]
            | null
          business_spent_this_month_usd: number | null
          default_mode:
            | Database["public"]["Enums"]["ai_thread_mode_value"]
            | null
          error_rate_7d: number | null
          last_decision_at: string | null
          live_skills_count: number | null
          pending_reviews: number | null
          platform_keys_all_active: boolean | null
          platform_monthly_cap_usd: number | null
          platform_spent_this_month_usd: number | null
          sandbox_globally: boolean | null
          sandbox_skills_count: number | null
        }
        Relationships: []
      }
      seller_daily_earnings: {
        Row: {
          commission_earned: number | null
          created_at: string | null
          date: string | null
          delivered_count: number | null
          "DigiCom Business": string | null
          id: string | null
          salary_earned: number | null
          seller_id: string | null
          total_earned: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "orders_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_instance_health: {
        Row: {
          business_id: string | null
          health: string | null
          id: string | null
          last_event_at: string | null
          message_count: number | null
          name: string | null
          paired_at: string | null
          queue_dead: number | null
          queue_pending: number | null
          status: string | null
          status_changed_at: string | null
          thread_count: number | null
          time_since_event: string | null
        }
        Insert: {
          business_id?: string | null
          health?: never
          id?: string | null
          last_event_at?: string | null
          message_count?: never
          name?: string | null
          paired_at?: string | null
          queue_dead?: never
          queue_pending?: never
          status?: string | null
          status_changed_at?: string | null
          thread_count?: never
          time_since_event?: never
        }
        Update: {
          business_id?: string | null
          health?: never
          id?: string | null
          last_event_at?: string | null
          message_count?: never
          name?: string | null
          paired_at?: string | null
          queue_dead?: never
          queue_pending?: never
          status?: string | null
          status_changed_at?: string | null
          thread_count?: never
          time_since_event?: never
        }
        Relationships: [
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_v_thread_with_state: {
        Row: {
          business_id: string | null
          contact_id: string | null
          created_at: string | null
          display_name: string | null
          draft_text: string | null
          group_id: string | null
          instance_id: string | null
          is_archived: boolean | null
          is_muted: boolean | null
          is_pinned: boolean | null
          kind: string | null
          last_message_at: string | null
          last_message_direction: string | null
          last_message_id: string | null
          last_message_kind: string | null
          last_message_preview: string | null
          last_message_sender_jid: string | null
          last_message_status: string | null
          last_read_at: string | null
          last_read_message_id: string | null
          message_count: number | null
          muted_until: string | null
          phone_e164: string | null
          primary_lid: string | null
          profile_pic_url: string | null
          thread_id: string | null
          unread_count: number | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "wa_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_last_message_fk"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_last_message_fk"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_auto_replies: {
        Row: {
          active: boolean | null
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          media_url: string | null
          reply_message: string | null
          trigger_keyword: string | null
          trigger_type: string | null
        }
        Insert: {
          active?: boolean | null
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          instance_id?: string | null
          media_url?: never
          reply_message?: string | null
          trigger_keyword?: string | null
          trigger_type?: string | null
        }
        Update: {
          active?: boolean | null
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          instance_id?: string | null
          media_url?: never
          reply_message?: string | null
          trigger_keyword?: string | null
          trigger_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_auto_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_auto_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_labels: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          label_id: string | null
          remote_jid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_thread_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "wa_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_thread_labels_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_settings: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          is_archived: boolean | null
          is_blocked: boolean | null
          is_favorited: boolean | null
          is_muted: boolean | null
          is_pinned: boolean | null
          last_read_at: number | null
          muted_until: string | null
          remote_jid: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_user_thread_state_thread_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          name: string | null
          phone_number: string | null
          profile_pic: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          business_id: string | null
          contact_id: string | null
          created_at: string | null
          display_name: string | null
          group_id: string | null
          id: string | null
          instance_id: string | null
          jid: string | null
          last_message_content: string | null
          last_message_direction: string | null
          last_message_id: string | null
          last_message_status: string | null
          last_message_ts: string | null
          last_message_type: string | null
          lid_jid: string | null
          message_count: number | null
          phone_jid: string | null
          profile_pic: string | null
          type: string | null
          unread_count: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "wa_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_fast_replies: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          message: string | null
          shortcut: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          shortcut?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          shortcut?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_quick_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_quick_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_group_participants: {
        Row: {
          business_id: string | null
          created_at: string | null
          display_name: string | null
          group_id: string | null
          id: string | null
          participant_jid: string | null
          role: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "wa_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          business_id: string | null
          created_at: string | null
          creation_ts: string | null
          description: string | null
          group_jid: string | null
          id: string | null
          instance_id: string | null
          invite_code: string | null
          is_announce: boolean | null
          is_community: boolean | null
          is_restrict: boolean | null
          owner_jid: string | null
          participant_count: number | null
          profile_pic: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          creation_ts?: string | null
          description?: string | null
          group_jid?: string | null
          id?: string | null
          instance_id?: string | null
          invite_code?: string | null
          is_announce?: boolean | null
          is_community?: boolean | null
          is_restrict?: boolean | null
          owner_jid?: string | null
          participant_count?: number | null
          profile_pic?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          creation_ts?: string | null
          description?: string | null
          group_jid?: string | null
          id?: string | null
          instance_id?: string | null
          invite_code?: string | null
          is_announce?: boolean | null
          is_community?: boolean | null
          is_restrict?: boolean | null
          owner_jid?: string | null
          participant_count?: number | null
          profile_pic?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_groups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_name: string | null
          phone_number: string | null
          profile_pic: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          instance_name?: string | null
          phone_number?: string | null
          profile_pic?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          id?: string | null
          instance_name?: string | null
          phone_number?: string | null
          profile_pic?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_jid_mappings: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          lid_jid: string | null
          phone_jid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_jid_aliases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_jid_aliases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_labels: {
        Row: {
          business_id: string | null
          color: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          name: string | null
          whatsapp_label_id: string | null
        }
        Insert: {
          business_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string | null
          instance_id?: string | null
          name?: string | null
          whatsapp_label_id?: string | null
        }
        Update: {
          business_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string | null
          instance_id?: string | null
          name?: string | null
          whatsapp_label_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          business_id: string | null
          contact_id: string | null
          content: string | null
          conversation_id: string | null
          created_at: string | null
          direction: string | null
          id: string | null
          instance_id: string | null
          media_url: string | null
          message_id: string | null
          raw_key: Json | null
          remote_jid: string | null
          sender_jid: string | null
          status: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_messages_thread_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_pinned_messages: {
        Row: {
          business_id: string | null
          content: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          message_id: string | null
          pinned_by: string | null
          remote_jid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "wa_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "wa_v_thread_with_state"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "wa_thread_pinned_thread_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_starred_messages: {
        Row: {
          business_id: string | null
          content: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          message_id: string | null
          remote_jid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_threads_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_starred_message_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_starred_message_id_fkey"
            columns: ["id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sync_jobs: {
        Row: {
          business_id: string | null
          completed_at: string | null
          created_at: string | null
          current_phase: number | null
          error_message: string | null
          id: string | null
          instance_id: string | null
          instance_name: string | null
          max_retries: number | null
          phase_cursors: Json | null
          phases: Json | null
          retry_count: number | null
          started_at: string | null
          status: string | null
          sync_metadata: Json | null
          updated_at: string | null
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_phase?: never
          error_message?: string | null
          id?: string | null
          instance_id?: string | null
          instance_name?: never
          max_retries?: number | null
          phase_cursors?: Json | null
          phases?: never
          retry_count?: number | null
          started_at?: string | null
          status?: string | null
          sync_metadata?: Json | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_phase?: never
          error_message?: string | null
          id?: string | null
          instance_id?: string | null
          instance_name?: never
          max_retries?: number | null
          phase_cursors?: Json | null
          phases?: never
          retry_count?: number | null
          started_at?: string | null
          status?: string | null
          sync_metadata?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_sync_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instance_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_user_instances: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          scope: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          id?: never
          instance_id?: string | null
          scope?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          id?: never
          instance_id?: string | null
          scope?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_user_instance_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "ai_business_health"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "wa_user_instance_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_user_instance_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _wa_thread_by_jid: {
        Args: { p_business_id: string; p_instance_id: string; p_jid: string }
        Returns: string
      }
      ai_apply_create_order: { Args: { p_action_id: string }; Returns: string }
      ai_apply_discount: { Args: { p_action_id: string }; Returns: string }
      ai_apply_exchange: { Args: { p_action_id: string }; Returns: string }
      ai_apply_pending_actions_for_decision: {
        Args: { p_decision_id: string }
        Returns: Json
      }
      ai_auto_promote_skill: {
        Args: { p_business_id: string; p_skill_slug: string }
        Returns: Json
      }
      ai_can_spend: { Args: { p_business_id: string }; Returns: string }
      ai_compute_thread_mode: {
        Args: { p_thread_id: string }
        Returns: Database["public"]["Enums"]["ai_thread_mode_value"]
      }
      ai_current_business_id: { Args: never; Returns: string }
      ai_current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      ai_decrypt_platform_key: {
        Args: { p_provider_id: string }
        Returns: string
      }
      ai_expire_pending_actions: { Args: never; Returns: number }
      ai_is_admin_or_owner: { Args: never; Returns: boolean }
      ai_is_super_admin: { Args: never; Returns: boolean }
      ai_link_pending_actions: {
        Args: {
          p_business_id: string
          p_decision_id: string
          p_tool_use_ids: string[]
        }
        Returns: number
      }
      ai_media_cache_purge: { Args: never; Returns: number }
      ai_monthly_reset: {
        Args: never
        Returns: {
          business_rows: number
          platform_rows: number
        }[]
      }
      ai_queue_decision: {
        Args: { p_business_id: string; p_decision_id: string }
        Returns: string
      }
      ai_record_decision: {
        Args: {
          p_brain_cost_usd: number
          p_brain_intent: Json
          p_brain_model_id: string
          p_brain_provider_id: string
          p_brain_tokens_in: number
          p_brain_tokens_out: number
          p_business_id: string
          p_inbound_message_id: string
          p_latency_ms: number
          p_outbound_message_id: string
          p_outcome: Database["public"]["Enums"]["ai_decision_outcome"]
          p_outcome_reason: string
          p_provider_chain: string[]
          p_redaction_map: Json
          p_review_status: Database["public"]["Enums"]["ai_review_status"]
          p_sandbox: boolean
          p_thread_id: string
          p_tongue_cost_usd: number
          p_tongue_model_id: string
          p_tongue_output: string
          p_tongue_provider_id: string
          p_tongue_tokens_in: number
          p_tongue_tokens_out: number
          p_tool_calls: Json
        }
        Returns: string
      }
      ai_record_usage: {
        Args: {
          p_audio_minutes: number
          p_business_id: string
          p_cost_usd: number
          p_model_id: string
          p_provider_id: string
          p_tokens_in: number
          p_tokens_out: number
        }
        Returns: undefined
      }
      ai_register_human_takeover: {
        Args: { p_business_id: string; p_thread_id: string; p_user_id: string }
        Returns: undefined
      }
      ai_reject_pending_actions_for_decision: {
        Args: { p_decision_id: string }
        Returns: number
      }
      ai_resolve_review: {
        Args: {
          p_action: string
          p_decision_id: string
          p_outbound_wa_id: string
          p_outcome: Database["public"]["Enums"]["ai_decision_outcome"]
          p_override_text: string
          p_reviewer_id: string
        }
        Returns: undefined
      }
      ai_search_knowledge: {
        Args: {
          p_business_id: string
          p_embedding: string
          p_k?: number
          p_kinds?: Database["public"]["Enums"]["ai_kb_source_kind"][]
        }
        Returns: {
          chunk_index: number
          id: string
          similarity: number
          source_id: string
          source_kind: Database["public"]["Enums"]["ai_kb_source_kind"]
          source_label: string
          text: string
        }[]
      }
      ai_set_thread_mode: {
        Args: {
          p_mode: Database["public"]["Enums"]["ai_thread_mode_value"]
          p_pause_minutes?: number
          p_thread_id: string
        }
        Returns: undefined
      }
      ai_skill_ads_roi: {
        Args: { p_business_id: string; p_period_days?: number }
        Returns: Json
      }
      ai_skill_get_order_status: {
        Args: { p_business_id: string; p_identifier: string }
        Returns: {
          city_name: string
          created_at: string
          customer_name: string
          customer_phone: string
          date_livraison: string
          delivered: boolean
          id: string
          price: number
          status_category: string
          status_code: string
          status_color: string
          status_label: string
          tracking_number: string
        }[]
      }
      ai_skill_lookup_orders_by_phone: {
        Args: { p_business_id: string; p_limit?: number; p_phone: string }
        Returns: {
          city_name: string
          created_at: string
          customer_name: string
          customer_phone: string
          delivered: boolean
          id: string
          price: number
          product_name: string
          quantity: number
          status_code: string
          status_color: string
          status_label: string
          tracking_number: string
        }[]
      }
      ai_skill_match_morocco_city: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: string
          name: string
          name_ar: string
          region: string
          similarity: number
        }[]
      }
      ai_skill_quote_shipping: {
        Args: { p_business_id: string; p_master_city_id: string }
        Returns: {
          fee: number
          provider_id: string
          provider_kind: string
          provider_name: string
          return_fee: number
        }[]
      }
      ai_skill_search_products: {
        Args: { p_business_id: string; p_limit?: number; p_query: string }
        Returns: {
          code: string
          description: string
          id: string
          image_url: string
          name: string
          selling_price: number
          similarity: number
          stock: number
        }[]
      }
      ai_skill_summarize_sales: {
        Args: { p_business_id: string; p_period?: string }
        Returns: Json
      }
      ai_stamp_outbound: {
        Args: { p_decision_id: string; p_wa_message_id: string }
        Returns: undefined
      }
      ai_usage_rollup: { Args: never; Returns: number }
      audit_log_dispatch_geo: { Args: never; Returns: undefined }
      audit_log_reap_geo: { Args: never; Returns: undefined }
      check_expired_licenses: { Args: never; Returns: undefined }
      check_user_role: {
        Args: { allowed_roles: string[]; target_id: string }
        Returns: boolean
      }
      create_meta_ads_connection: {
        Args: {
          p_ad_account_id: string
          p_business_id: string
          p_business_id_meta?: string
          p_created_by?: string
          p_display_name: string
          p_is_default?: boolean
          p_pixel_id?: string
          p_token: string
          p_token_expires_at?: string
        }
        Returns: string
      }
      current_user_digicom_business_id: { Args: never; Returns: string }
      delete_business: { Args: { p_business_id: string }; Returns: undefined }
      delete_open_company_delivery_note: {
        Args: { p_delivery_note_id: string }
        Returns: undefined
      }
      get_daily_attribution_progress: {
        Args: { p_business_id: string; p_date?: string }
        Returns: {
          assignment: number
          credit: number
          is_full: boolean
          orders_today: number
          pct_complete: number
          seller_id: string
          seller_name: string
        }[]
      }
      get_google_analytics_sa_key: { Args: never; Returns: string }
      get_meta_ads_token: { Args: { p_connection_id: string }; Returns: string }
      get_meta_app_secret: { Args: never; Returns: string }
      get_meta_oauth_state_secret: { Args: never; Returns: string }
      invoke_ozon_poll: { Args: { p_trigger?: string }; Returns: number }
      invoke_quicklivraison_poll: {
        Args: { p_trigger?: string }
        Returns: number
      }
      invoke_tracking_sync: { Args: { p_trigger?: string }; Returns: number }
      invoke_vitex_poll: { Args: { p_trigger?: string }; Returns: number }
      is_owner: { Args: never; Returns: boolean }
      log_audit: { Args: { payload: Json }; Returns: string }
      match_package_status: {
        Args: { p_status_value: string }
        Returns: {
          category: string
          code: string
          color: string
          id: string
          label: string
        }[]
      }
      normalize_phone_for_customer: { Args: { p: string }; Returns: string }
      purge_soft_deleted_orders: { Args: never; Returns: undefined }
      query_audit_logs: {
        Args: {
          p_filters?: Json
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_to?: string
        }
        Returns: {
          rows: Json
          total: number
        }[]
      }
      reattribute_unassigned_orders: {
        Args: { p_business_id: string; p_date?: string }
        Returns: number
      }
      refresh_customer_from_orders: {
        Args: { p_business_id: string; p_phone_normalized: string }
        Returns: undefined
      }
      remove_company_parcel_from_delivery_note: {
        Args: { p_delivery_note_id: string; p_parcel_id: string }
        Returns: undefined
      }
      reset_daily_attribution: {
        Args: { p_business_id: string; p_date?: string }
        Returns: undefined
      }
      row_actor: { Args: never; Returns: Json }
      scrub_sensitive: { Args: { j: Json }; Returns: Json }
      sum_order_units_for_seller_products: {
        Args: { p_order_id: string; p_seller_id: string }
        Returns: number
      }
      sync_imported_orders: { Args: { p_business_id: string }; Returns: Json }
      update_business_profile_fields: {
        Args: {
          p_business_email: string
          p_business_id: string
          p_business_phone: string
          p_cachet_url: string
          p_capital_social: string
          p_cnss: string
          p_ice: string
          p_identifiant_fiscal: string
          p_legal_address: string
          p_legal_city: string
          p_legal_form: string
          p_logo: string
          p_name: string
          p_patente: string
          p_postal_code: string
          p_rc: string
          p_signature_url: string
          p_website: string
        }
        Returns: Json
      }
      upsert_meta_ads_connection: {
        Args: {
          p_ad_account_id: string
          p_business_id: string
          p_business_id_meta?: string
          p_created_by?: string
          p_display_name: string
          p_is_default?: boolean
          p_pixel_id?: string
          p_token: string
          p_token_expires_at?: string
        }
        Returns: string
      }
      wa_avatar_claim_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          out_attempts: number
          out_business_id: string
          out_contact_id: string
          out_instance_name: string
          out_jid: string
          out_phone_e164: string
          out_queue_id: string
        }[]
      }
      wa_avatar_mark_processed: {
        Args: { p_error?: string; p_queue_id: string; p_success: boolean }
        Returns: undefined
      }
      wa_avatar_requeue_stale: {
        Args: { p_older_than?: string }
        Returns: number
      }
      wa_classify_message_kind: {
        Args: { p_message_type: string }
        Returns: string
      }
      wa_classify_status: { Args: { p_evo_status: string }; Returns: string }
      wa_cleanup_avatar_queue: { Args: { p_keep?: string }; Returns: number }
      wa_cleanup_webhook_events: { Args: { p_keep?: string }; Returns: number }
      wa_detect_silent_instances: { Args: never; Returns: number }
      wa_dispatch_event: {
        Args: {
          p_event_type: string
          p_evo_instance_name: string
          p_payload: Json
        }
        Returns: undefined
      }
      wa_ingest_chat: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_connection: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_contact: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: string
      }
      wa_ingest_group: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: string
      }
      wa_ingest_group_participant: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_label: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: string
      }
      wa_ingest_label_assoc: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_message: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: string
      }
      wa_ingest_message_delete: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_message_edit: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_message_status: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_ingest_reaction: {
        Args: { p_instance_id: string; p_payload: Json }
        Returns: undefined
      }
      wa_invoke_edge: {
        Args: { p_body?: Json; p_function_name: string }
        Returns: number
      }
      wa_jid_kind: { Args: { p_jid: string }; Returns: string }
      wa_jid_local: { Args: { p_jid: string }; Returns: string }
      wa_mark_thread_read: { Args: { p_thread_id: string }; Returns: number }
      wa_message_preview: {
        Args: { p_kind: string; p_text: string }
        Returns: string
      }
      wa_normalize_phone: { Args: { p_jid: string }; Returns: string }
      wa_reconcile_thread_metadata: { Args: never; Returns: number }
      wa_reconcile_unread_bulk: {
        Args: { p_chats: Json; p_instance_id: string }
        Returns: number
      }
      wa_reconcile_unread_counts: { Args: never; Returns: number }
      wa_reconcile_unread_from_events: { Args: never; Returns: number }
      wa_resolve_contact: {
        Args: {
          p_alt_jid?: string
          p_business_id: string
          p_jid: string
          p_profile_pic_url?: string
          p_push_name?: string
        }
        Returns: string
      }
      wa_resolve_thread: {
        Args: {
          p_contact_id?: string
          p_group_id?: string
          p_instance_id: string
          p_kind: string
        }
        Returns: string
      }
      wa_set_contact_profile_pic: {
        Args: { p_evo_instance_name: string; p_jid: string; p_pic_url: string }
        Returns: string
      }
      wa_set_thread_pref: {
        Args: {
          p_archived?: boolean
          p_draft?: string
          p_muted?: boolean
          p_muted_until?: string
          p_pinned?: boolean
          p_thread_id: string
        }
        Returns: undefined
      }
      wa_status_rank: { Args: { p_status: string }; Returns: number }
      wa_toggle_star: {
        Args: { p_message_id: string; p_star: boolean }
        Returns: undefined
      }
      wa_user_business_id: { Args: never; Returns: string }
      wa_user_can_see_instance: {
        Args: { p_instance_id: string }
        Returns: boolean
      }
      wa_user_role: { Args: never; Returns: string }
      wa_worker_claim_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          event_type: string
          evo_instance_name: string
          id: string
          instance_id: string
          max_retries: number
          payload: Json
          retry_count: number
        }[]
      }
    }
    Enums: {
      ai_brain_language: "darija" | "french" | "arabic" | "english"
      ai_brain_tone: "warm" | "professional" | "playful" | "formal"
      ai_business_skill_mode: "sandbox" | "live"
      ai_decision_outcome:
        | "sent"
        | "failed"
        | "escalated"
        | "blocked_redaction"
        | "blocked_quota"
        | "blocked_jailbreak"
        | "sandbox_pending"
      ai_jailbreak_action: "log" | "escalate" | "block"
      ai_jailbreak_severity: "low" | "medium" | "high"
      ai_kb_source_kind:
        | "product"
        | "faq"
        | "qna"
        | "doc"
        | "example_conversation"
      ai_model_role: "brain" | "tongue" | "stt" | "tts" | "embedding"
      ai_pending_action_kind:
        | "create_order"
        | "apply_discount"
        | "handle_exchange"
      ai_pending_action_status:
        | "pending"
        | "applied"
        | "rejected"
        | "expired"
        | "failed"
      ai_prompt_kind: "brain_system" | "tongue_style" | "skill_specific"
      ai_provider_key_status: "active" | "paused" | "exhausted" | "invalid"
      ai_redaction_kind:
        | "phone"
        | "address"
        | "name"
        | "ice"
        | "rc"
        | "email"
        | "custom"
      ai_review_status: "pending" | "approved" | "rejected" | "skipped"
      ai_skill_category:
        | "messaging"
        | "sales"
        | "orders"
        | "support"
        | "analytics"
        | "moderation"
      ai_skill_safety_tier: "sandbox_required" | "opt_in" | "safe_by_default"
      ai_thread_mode_value: "off" | "static" | "dynamic" | "agent"
      ai_voice_kind:
        | "azure_female"
        | "azure_male"
        | "elevenlabs_cloned"
        | "none"
      user_role:
        | "super admin"
        | "admin"
        | "commercial"
        | "mediabuyer"
        | "owner"
        | "courier"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

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
  public: {
    Enums: {
      ai_brain_language: ["darija", "french", "arabic", "english"],
      ai_brain_tone: ["warm", "professional", "playful", "formal"],
      ai_business_skill_mode: ["sandbox", "live"],
      ai_decision_outcome: [
        "sent",
        "failed",
        "escalated",
        "blocked_redaction",
        "blocked_quota",
        "blocked_jailbreak",
        "sandbox_pending",
      ],
      ai_jailbreak_action: ["log", "escalate", "block"],
      ai_jailbreak_severity: ["low", "medium", "high"],
      ai_kb_source_kind: [
        "product",
        "faq",
        "qna",
        "doc",
        "example_conversation",
      ],
      ai_model_role: ["brain", "tongue", "stt", "tts", "embedding"],
      ai_pending_action_kind: [
        "create_order",
        "apply_discount",
        "handle_exchange",
      ],
      ai_pending_action_status: [
        "pending",
        "applied",
        "rejected",
        "expired",
        "failed",
      ],
      ai_prompt_kind: ["brain_system", "tongue_style", "skill_specific"],
      ai_provider_key_status: ["active", "paused", "exhausted", "invalid"],
      ai_redaction_kind: [
        "phone",
        "address",
        "name",
        "ice",
        "rc",
        "email",
        "custom",
      ],
      ai_review_status: ["pending", "approved", "rejected", "skipped"],
      ai_skill_category: [
        "messaging",
        "sales",
        "orders",
        "support",
        "analytics",
        "moderation",
      ],
      ai_skill_safety_tier: ["sandbox_required", "opt_in", "safe_by_default"],
      ai_thread_mode_value: ["off", "static", "dynamic", "agent"],
      ai_voice_kind: [
        "azure_female",
        "azure_male",
        "elevenlabs_cloned",
        "none",
      ],
      user_role: [
        "super admin",
        "admin",
        "commercial",
        "mediabuyer",
        "owner",
        "courier",
      ],
    },
  },
} as const


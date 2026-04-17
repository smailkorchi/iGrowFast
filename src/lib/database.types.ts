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
      ai_keys: {
        Row: {
          api_key: string
          base_url: string | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          api_key: string
          base_url?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          api_key?: string
          base_url?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_keys_business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          ai_key_id: string | null
          concurrency_limit: number | null
          created_at: string | null
          "DigiCom Business": string | null
          id: string
          name: string
          type: string
        }
        Insert: {
          ai_key_id?: string | null
          concurrency_limit?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name: string
          type: string
        }
        Update: {
          ai_key_id?: string | null
          concurrency_limit?: number | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_ai_key_id_fkey"
            columns: ["ai_key_id"]
            isOneToOne: false
            referencedRelation: "ai_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_models_business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
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
          raw_price: number | null
          replace: boolean | null
          reported_date: string | null
          seller_id: string | null
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
          raw_price?: number | null
          replace?: boolean | null
          reported_date?: string | null
          seller_id?: string | null
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
          raw_price?: number | null
          replace?: boolean | null
          reported_date?: string | null
          seller_id?: string | null
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
          id: string
          logo_url: string | null
          name: string
          ozon_parcel_fragile: number
          ozon_parcel_open: number
          ozon_parcel_replace: number
          provider_type: string | null
          updated_at: string | null
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
          id?: string
          logo_url?: string | null
          name: string
          ozon_parcel_fragile?: number
          ozon_parcel_open?: number
          ozon_parcel_replace?: number
          provider_type?: string | null
          updated_at?: string | null
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
          id?: string
          logo_url?: string | null
          name?: string
          ozon_parcel_fragile?: number
          ozon_parcel_open?: number
          ozon_parcel_replace?: number
          provider_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
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
            referencedRelation: "businesses"
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
      whatsapp_auto_replies: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          instance_id: string | null
          media_url: string | null
          reply_message: string
          trigger_keyword: string | null
          trigger_type: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          media_url?: string | null
          reply_message: string
          trigger_keyword?: string | null
          trigger_type?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          media_url?: string | null
          reply_message?: string
          trigger_keyword?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_auto_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_auto_replies_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_labels: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_id: string | null
          label_id: string
          remote_jid: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          label_id: string
          remote_jid: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          label_id?: string
          remote_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chat_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chat_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chat_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_settings: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_id: string | null
          is_archived: boolean
          is_blocked: boolean
          is_favorited: boolean
          is_muted: boolean
          is_pinned: boolean
          last_read_at: number | null
          muted_until: string | null
          remote_jid: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          is_archived?: boolean
          is_blocked?: boolean
          is_favorited?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: number | null
          muted_until?: string | null
          remote_jid: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          is_archived?: boolean
          is_blocked?: boolean
          is_favorited?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          last_read_at?: number | null
          muted_until?: string | null
          remote_jid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chat_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chat_settings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_id: string | null
          name: string | null
          phone_number: string
          profile_pic: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          name?: string | null
          phone_number: string
          profile_pic?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          name?: string | null
          phone_number?: string
          profile_pic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          business_id: string
          contact_id: string | null
          created_at: string | null
          display_name: string | null
          group_id: string | null
          id: string
          instance_id: string
          jid: string
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
          type: string
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          business_id: string
          contact_id?: string | null
          created_at?: string | null
          display_name?: string | null
          group_id?: string | null
          id?: string
          instance_id: string
          jid: string
          last_message_content?: string | null
          last_message_direction?: string | null
          last_message_id?: string | null
          last_message_status?: string | null
          last_message_ts?: string | null
          last_message_type?: string | null
          lid_jid?: string | null
          message_count?: number | null
          phone_jid?: string | null
          profile_pic?: string | null
          type?: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          contact_id?: string | null
          created_at?: string | null
          display_name?: string | null
          group_id?: string | null
          id?: string
          instance_id?: string
          jid?: string
          last_message_content?: string | null
          last_message_direction?: string | null
          last_message_id?: string | null
          last_message_status?: string | null
          last_message_ts?: string | null
          last_message_type?: string | null
          lid_jid?: string | null
          message_count?: number | null
          phone_jid?: string | null
          profile_pic?: string | null
          type?: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_fast_replies: {
        Row: {
          business_id: string
          created_at: string
          id: string
          message: string
          shortcut: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          message: string
          shortcut: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          message?: string
          shortcut?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_fast_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_group_participants: {
        Row: {
          business_id: string
          created_at: string | null
          display_name: string | null
          group_id: string
          id: string
          participant_jid: string
          role: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          display_name?: string | null
          group_id: string
          id?: string
          participant_jid: string
          role?: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          display_name?: string | null
          group_id?: string
          id?: string
          participant_jid?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_group_participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          business_id: string
          created_at: string | null
          creation_ts: number | null
          description: string | null
          group_jid: string
          id: string
          instance_id: string
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
          business_id: string
          created_at?: string | null
          creation_ts?: number | null
          description?: string | null
          group_jid: string
          id?: string
          instance_id: string
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
          business_id?: string
          created_at?: string | null
          creation_ts?: number | null
          description?: string | null
          group_jid?: string
          id?: string
          instance_id?: string
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
            foreignKeyName: "whatsapp_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_name: string
          phone_number: string | null
          profile_pic: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_name: string
          phone_number?: string | null
          profile_pic?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_name?: string
          phone_number?: string | null
          profile_pic?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_jid_mappings: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_id: string
          lid_jid: string
          phone_jid: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_id: string
          lid_jid: string
          phone_jid: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string
          lid_jid?: string
          phone_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_jid_mappings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_jid_mappings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_labels: {
        Row: {
          business_id: string
          color: string
          created_at: string
          id: string
          instance_id: string | null
          name: string
          whatsapp_label_id: string | null
        }
        Insert: {
          business_id: string
          color?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          name: string
          whatsapp_label_id?: string | null
        }
        Update: {
          business_id?: string
          color?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          name?: string
          whatsapp_label_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_labels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_labels_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          business_id: string
          contact_id: string | null
          content: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          id: string
          instance_id: string
          media_url: string | null
          message_id: string
          raw_key: Json | null
          remote_jid: string
          sender_jid: string | null
          status: string
          type: string
        }
        Insert: {
          business_id: string
          contact_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          id?: string
          instance_id: string
          media_url?: string | null
          message_id: string
          raw_key?: Json | null
          remote_jid: string
          sender_jid?: string | null
          status?: string
          type?: string
        }
        Update: {
          business_id?: string
          contact_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          instance_id?: string
          media_url?: string | null
          message_id?: string
          raw_key?: Json | null
          remote_jid?: string
          sender_jid?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_pinned_messages: {
        Row: {
          business_id: string
          content: string | null
          created_at: string
          id: string
          instance_id: string | null
          message_id: string
          pinned_by: string | null
          remote_jid: string
        }
        Insert: {
          business_id: string
          content?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          message_id: string
          pinned_by?: string | null
          remote_jid: string
        }
        Update: {
          business_id?: string
          content?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          message_id?: string
          pinned_by?: string | null
          remote_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_pinned_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_pinned_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_starred_messages: {
        Row: {
          business_id: string
          content: string | null
          created_at: string
          id: string
          instance_id: string | null
          message_id: string
          remote_jid: string
        }
        Insert: {
          business_id: string
          content?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          message_id: string
          remote_jid: string
        }
        Update: {
          business_id?: string
          content?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          message_id?: string
          remote_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_starred_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_starred_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sync_jobs: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          current_phase: number
          error_message: string | null
          id: string
          instance_id: string
          instance_name: string
          max_retries: number
          phase_cursors: Json
          phases: Json
          retry_count: number
          started_at: string | null
          status: string
          sync_metadata: Json
          updated_at: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          current_phase?: number
          error_message?: string | null
          id?: string
          instance_id: string
          instance_name: string
          max_retries?: number
          phase_cursors?: Json
          phases?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          sync_metadata?: Json
          updated_at?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          current_phase?: number
          error_message?: string | null
          id?: string
          instance_id?: string
          instance_name?: string
          max_retries?: number
          phase_cursors?: Json
          phases?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          sync_metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sync_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_user_instances: {
        Row: {
          business_id: string
          created_at: string
          id: string
          instance_id: string | null
          scope: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          scope: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_user_instances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_user_instances_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_user_instances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
    }
    Functions: {
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
      delete_open_company_delivery_note: {
        Args: { p_delivery_note_id: string }
        Returns: undefined
      }
      get_chat_list: {
        Args: { p_instance_id: string }
        Returns: {
          contact_id: string
          conv_type: string
          conversation_id: string
          display_name: string
          group_id: string
          jid: string
          last_message_content: string
          last_message_direction: string
          last_message_id: string
          last_message_status: string
          last_message_ts: string
          last_message_type: string
          profile_pic: string
          unread_count: number
        }[]
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
      invoke_tracking_sync: { Args: { p_trigger?: string }; Returns: number }
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
    }
    Enums: {
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

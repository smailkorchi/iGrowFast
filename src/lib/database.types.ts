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
          source_exclusivity_enabled: boolean
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
          source_exclusivity_enabled?: boolean
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
          source_exclusivity_enabled?: boolean
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
      campaign_source_locks: {
        Row: {
          created_at: string
          "DigiCom Business": string
          id: string
          mediabuyer_id: string
          source: string
        }
        Insert: {
          created_at?: string
          "DigiCom Business": string
          id?: string
          mediabuyer_id: string
          source: string
        }
        Update: {
          created_at?: string
          "DigiCom Business"?: string
          id?: string
          mediabuyer_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_source_locks_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_source_locks_mb_fk"
            columns: ["mediabuyer_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      channel_aliases: {
        Row: {
          alias_key: string
          alias_type: string
          canonical_id: string | null
          canonical_value: string | null
          channel_id: string | null
          created_at: string
          created_by: string | null
          "DigiCom Business": string
          id: string
          updated_at: string
        }
        Insert: {
          alias_key: string
          alias_type: string
          canonical_id?: string | null
          canonical_value?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business": string
          id?: string
          updated_at?: string
        }
        Update: {
          alias_key?: string
          alias_type?: string
          canonical_id?: string | null
          canonical_value?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_aliases_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_aliases_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string | null
          "DigiCom Business": string | null
          external_id: string | null
          id: string
          order_id: string | null
          provider_id: string | null
          provider_response: Json | null
          status_id: string | null
          tracking_code: string | null
          updated_at: string | null
        }
        Insert: {
          company_delivery_note_id?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          provider_response?: Json | null
          status_id?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Update: {
          company_delivery_note_id?: string | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          provider_response?: Json | null
          status_id?: string | null
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
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number | null
          order_count: number | null
          provider_id: string | null
          received_at: string | null
          reference: string | null
          status: string
          total_amount: number | null
          total_shipping_fees: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          order_count?: number | null
          provider_id?: string | null
          received_at?: string | null
          reference?: string | null
          status?: string
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          order_count?: number | null
          provider_id?: string | null
          received_at?: string | null
          reference?: string | null
          status?: string
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Relationships: [
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
          created_at: string | null
          delivered_at: string | null
          "DigiCom Business": string | null
          id: string
          is_fragile: boolean | null
          is_open: boolean | null
          is_try_on: boolean | null
          order_id: string | null
          status_id: string | null
          tracking_code: string | null
          updated_at: string | null
        }
        Insert: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          is_fragile?: boolean | null
          is_open?: boolean | null
          is_try_on?: boolean | null
          order_id?: string | null
          status_id?: string | null
          tracking_code?: string | null
          updated_at?: string | null
        }
        Update: {
          courier_delivery_note_id?: string | null
          courier_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          "DigiCom Business"?: string | null
          id?: string
          is_fragile?: boolean | null
          is_open?: boolean | null
          is_try_on?: boolean | null
          order_id?: string | null
          status_id?: string | null
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
          courier_id: string | null
          created_at: string | null
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          net_amount: number | null
          order_count: number | null
          received_at: string | null
          reference: string | null
          status: string
          total_amount: number | null
          total_shipping_fees: number | null
          updated_at: string | null
        }
        Insert: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          order_count?: number | null
          received_at?: string | null
          reference?: string | null
          status?: string
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Update: {
          courier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          net_amount?: number | null
          order_count?: number | null
          received_at?: string | null
          reference?: string | null
          status?: string
          total_amount?: number | null
          total_shipping_fees?: number | null
          updated_at?: string | null
        }
        Relationships: [
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
      credential_change_requests: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          otp_attempts: number
          otp_expires_at: string | null
          otp_hash: string | null
          requested_by: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          otp_attempts?: number
          otp_expires_at?: string | null
          otp_hash?: string | null
          requested_by?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          otp_attempts?: number
          otp_expires_at?: string | null
          otp_hash?: string | null
          requested_by?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          email_address: string
          from_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          last_test_at: string | null
          last_test_error: string | null
          last_test_ok: boolean | null
          name: string
          password_secret_id: string
          pop3_host: string | null
          pop3_port: number | null
          pop3_security: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_address: string
          from_name?: string | null
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          is_active?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          name: string
          password_secret_id: string
          pop3_host?: string | null
          pop3_port?: number | null
          pop3_security?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_security?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_address?: string
          from_name?: string | null
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          is_active?: boolean
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          name?: string
          password_secret_id?: string
          pop3_host?: string | null
          pop3_port?: number | null
          pop3_security?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_security?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          account_id: string | null
          created_at: string
          error: string | null
          id: string
          status: string
          template_key: string | null
          to_email: string
          to_user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          status?: string
          template_key?: string | null
          to_email: string
          to_user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          status?: string
          template_key?: string | null
          to_email?: string
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string
          created_by: string | null
          email_account_id: string | null
          html_body: string
          id: string
          is_active: boolean
          key: string | null
          name: string
          preheader: string | null
          subject: string
          text_body: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_account_id?: string | null
          html_body?: string
          id?: string
          is_active?: boolean
          key?: string | null
          name: string
          preheader?: string | null
          subject?: string
          text_body?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_account_id?: string | null
          html_body?: string
          id?: string
          is_active?: boolean
          key?: string | null
          name?: string
          preheader?: string | null
          subject?: string
          text_body?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
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
          occurrence_date: string | null
          recurring_id: string | null
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
          occurrence_date?: string | null
          recurring_id?: string | null
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
          occurrence_date?: string | null
          recurring_id?: string | null
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
            foreignKeyName: "expenses_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_charges"
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
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
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
      mediabuyer_ga_access: {
        Row: {
          business_id: string
          created_at: string
          ga_connection_id: string | null
          id: string
          scope: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          ga_connection_id?: string | null
          id?: string
          scope: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          ga_connection_id?: string | null
          id?: string
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mediabuyer_ga_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_ga_access_ga_connection_id_fkey"
            columns: ["ga_connection_id"]
            isOneToOne: false
            referencedRelation: "google_analytics_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_ga_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mediabuyer_meta_access: {
        Row: {
          business_id: string
          created_at: string
          id: string
          meta_connection_id: string | null
          scope: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          meta_connection_id?: string | null
          scope: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          meta_connection_id?: string | null
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mediabuyer_meta_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_meta_access_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_ads_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mediabuyer_meta_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mediabuyer_payment_txns: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          mediabuyer_payment_id: string
          note: string | null
          paid_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          mediabuyer_payment_id: string
          note?: string | null
          paid_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          mediabuyer_payment_id?: string
          note?: string | null
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mediabuyer_payment_txns_mediabuyer_payment_id_fkey"
            columns: ["mediabuyer_payment_id"]
            isOneToOne: false
            referencedRelation: "mediabuyer_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      mediabuyer_payments: {
        Row: {
          bank_snapshot: Json | null
          campaigns_count: number
          carried_in: number
          carried_out: number | null
          closed_at: string | null
          commission_earned: number
          created_at: string
          delivered_orders: number
          "DigiCom Business": string
          earned_frozen: boolean
          id: string
          mediabuyer_id: string
          month_earned: number
          paid_amount: number
          paid_at: string | null
          payment_type: string
          payout_month: string
          period_state: string
          salary_earned: number
          status: string
          total_amount: number
          total_spend: number
          updated_at: string
        }
        Insert: {
          bank_snapshot?: Json | null
          campaigns_count?: number
          carried_in?: number
          carried_out?: number | null
          closed_at?: string | null
          commission_earned?: number
          created_at?: string
          delivered_orders?: number
          "DigiCom Business": string
          earned_frozen?: boolean
          id?: string
          mediabuyer_id: string
          month_earned?: number
          paid_amount?: number
          paid_at?: string | null
          payment_type: string
          payout_month: string
          period_state?: string
          salary_earned?: number
          status?: string
          total_amount?: number
          total_spend?: number
          updated_at?: string
        }
        Update: {
          bank_snapshot?: Json | null
          campaigns_count?: number
          carried_in?: number
          carried_out?: number | null
          closed_at?: string | null
          commission_earned?: number
          created_at?: string
          delivered_orders?: number
          "DigiCom Business"?: string
          earned_frozen?: boolean
          id?: string
          mediabuyer_id?: string
          month_earned?: number
          paid_amount?: number
          paid_at?: string | null
          payment_type?: string
          payout_month?: string
          period_state?: string
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
          code: string
          color: string | null
          created_at: string | null
          excluded_from_delivery_rate: boolean
          icon: string | null
          id: string
          is_callback: boolean
          is_cancelled: boolean
          is_confirmed: boolean
          is_new: boolean
          is_paid: boolean
          is_unpaid: boolean
          deducts_stock: boolean
          is_blacklisted: boolean
          is_double: boolean
          is_fake: boolean
          is_postponed: boolean
          is_relaunch: boolean
          is_return: boolean
          label: string
          pending_confirmation: boolean
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
          code: string
          color?: string | null
          created_at?: string | null
          excluded_from_delivery_rate?: boolean
          icon?: string | null
          id?: string
          is_callback?: boolean
          is_cancelled?: boolean
          is_confirmed?: boolean
          is_new?: boolean
          is_paid?: boolean
          is_unpaid?: boolean
          deducts_stock?: boolean
          is_blacklisted?: boolean
          is_double?: boolean
          is_fake?: boolean
          is_postponed?: boolean
          is_relaunch?: boolean
          is_return?: boolean
          label: string
          pending_confirmation?: boolean
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
          code?: string
          color?: string | null
          created_at?: string | null
          excluded_from_delivery_rate?: boolean
          icon?: string | null
          id?: string
          is_callback?: boolean
          is_cancelled?: boolean
          is_confirmed?: boolean
          is_new?: boolean
          is_paid?: boolean
          is_unpaid?: boolean
          deducts_stock?: boolean
          is_blacklisted?: boolean
          is_double?: boolean
          is_fake?: boolean
          is_postponed?: boolean
          is_relaunch?: boolean
          is_return?: boolean
          label?: string
          pending_confirmation?: boolean
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
          assignment_date: string | null
          canceled_by_id: string | null
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
          deleted_by_id: string | null
          delivered: boolean | null
          delivery_note: string | null
          delvoexpress_old_tracking: string | null
          "DigiCom Business": string | null
          exchange_of_order_id: string | null
          external_row_id: string | null
          external_source_key: string | null
          forcelog_old_tracking: string | null
          id: string
          include_delivery_in_total: boolean
          master_city_id: string | null
          name: string | null
          note: string | null
          order_status_id: string | null
          package_status_id: string | null
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
          source_review_status: string
          stock_changed: boolean | null
          swap_only: boolean
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          ameex_old_tracking?: string | null
          annulation_date?: string | null
          assignment_date?: string | null
          canceled_by_id?: string | null
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
          deleted_by_id?: string | null
          delivered?: boolean | null
          delivery_note?: string | null
          delvoexpress_old_tracking?: string | null
          "DigiCom Business"?: string | null
          exchange_of_order_id?: string | null
          external_row_id?: string | null
          external_source_key?: string | null
          forcelog_old_tracking?: string | null
          id?: string
          include_delivery_in_total?: boolean
          master_city_id?: string | null
          name?: string | null
          note?: string | null
          order_status_id?: string | null
          package_status_id?: string | null
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
          source_review_status?: string
          stock_changed?: boolean | null
          swap_only?: boolean
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          ameex_old_tracking?: string | null
          annulation_date?: string | null
          assignment_date?: string | null
          canceled_by_id?: string | null
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
          deleted_by_id?: string | null
          delivered?: boolean | null
          delivery_note?: string | null
          delvoexpress_old_tracking?: string | null
          "DigiCom Business"?: string | null
          exchange_of_order_id?: string | null
          external_row_id?: string | null
          external_source_key?: string | null
          forcelog_old_tracking?: string | null
          id?: string
          include_delivery_in_total?: boolean
          master_city_id?: string | null
          name?: string | null
          note?: string | null
          order_status_id?: string | null
          package_status_id?: string | null
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
          source_review_status?: string
          stock_changed?: boolean | null
          swap_only?: boolean
          updated_at?: string | null
        }
        Relationships: [
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
            foreignKeyName: "orders_deleted_by_id_fkey"
            columns: ["deleted_by_id"]
            isOneToOne: false
            referencedRelation: "users"
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
            foreignKeyName: "orders_exchange_of_order_id_fkey"
            columns: ["exchange_of_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
      package_statuses: {
        Row: {
          active: boolean | null
          code: string
          color: string | null
          created_at: string | null
          delivery_service_statuses: Json | null
          excluded_from_delivery_rate: boolean
          icon: string | null
          id: string
          is_delivered: boolean
          is_returned: boolean
          is_shipped: boolean
          is_refused: boolean
          is_new: boolean
          is_cancelled: boolean
          is_postponed: boolean
          is_recheck: boolean
          is_terminal: boolean
          flow_rank: number | null
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
          code: string
          color?: string | null
          created_at?: string | null
          delivery_service_statuses?: Json | null
          excluded_from_delivery_rate?: boolean
          icon?: string | null
          id?: string
          is_delivered?: boolean
          is_returned?: boolean
          is_shipped?: boolean
          is_refused?: boolean
          is_new?: boolean
          is_cancelled?: boolean
          is_postponed?: boolean
          is_recheck?: boolean
          is_terminal?: boolean
          flow_rank?: number | null
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
          code?: string
          color?: string | null
          created_at?: string | null
          delivery_service_statuses?: Json | null
          excluded_from_delivery_rate?: boolean
          icon?: string | null
          id?: string
          is_delivered?: boolean
          is_returned?: boolean
          is_shipped?: boolean
          is_refused?: boolean
          is_new?: boolean
          is_cancelled?: boolean
          is_postponed?: boolean
          is_recheck?: boolean
          is_terminal?: boolean
          flow_rank?: number | null
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
          attach_mode: string
          created_at: string | null
          default_quantity: number
          "DigiCom Business": string | null
          id: string
          product_id: string
        }
        Insert: {
          accessory_id: string
          attach_mode?: string
          created_at?: string | null
          default_quantity?: number
          "DigiCom Business"?: string | null
          id?: string
          product_id: string
        }
        Update: {
          accessory_id?: string
          attach_mode?: string
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
          master_city_id: string | null
          provider_city_id: string | null
          provider_city_name: string
          provider_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          fees?: Json | null
          id?: string
          master_city_id?: string | null
          provider_city_id?: string | null
          provider_city_name: string
          provider_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          fees?: Json | null
          id?: string
          master_city_id?: string | null
          provider_city_id?: string | null
          provider_city_name?: string
          provider_type?: string
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
          delvoexpress_allow_open: boolean
          "DigiCom Business": string | null
          digylog_allow_open: boolean
          digylog_default_port: number
          digylog_network_id: number | null
          digylog_store_name: string | null
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
          delvoexpress_allow_open?: boolean
          "DigiCom Business"?: string | null
          digylog_allow_open?: boolean
          digylog_default_port?: number
          digylog_network_id?: number | null
          digylog_store_name?: string | null
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
          delvoexpress_allow_open?: boolean
          "DigiCom Business"?: string | null
          digylog_allow_open?: boolean
          digylog_default_port?: number
          digylog_network_id?: number | null
          digylog_store_name?: string | null
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
      recurring_charges: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          description: string | null
          "DigiCom Business": string
          end_date: string | null
          frequency: string
          id: string
          last_generated_date: string | null
          name: string
          start_date: string
          type_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number
          created_at?: string
          description?: string | null
          "DigiCom Business": string
          end_date?: string | null
          frequency: string
          id?: string
          last_generated_date?: string | null
          name: string
          start_date: string
          type_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          description?: string | null
          "DigiCom Business"?: string
          end_date?: string | null
          frequency?: string
          id?: string
          last_generated_date?: string | null
          name?: string
          start_date?: string
          type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_charges_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_charges_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "expense_types"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channels: {
        Row: {
          column_map: Json | null
          created_at: string | null
          "DigiCom Business": string | null
          has_header: boolean
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          spreadsheet_id: string | null
          spreadsheet_name: string | null
          start_row: number | null
          sync_cadence: string
          sync_error: string | null
          sync_status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          column_map?: Json | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          has_header?: boolean
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          spreadsheet_id?: string | null
          spreadsheet_name?: string | null
          start_row?: number | null
          sync_cadence?: string
          sync_error?: string | null
          sync_status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          column_map?: Json | null
          created_at?: string | null
          "DigiCom Business"?: string | null
          has_header?: boolean
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          spreadsheet_id?: string | null
          spreadsheet_name?: string | null
          start_row?: number | null
          sync_cadence?: string
          sync_error?: string | null
          sync_status?: string | null
          type?: string
          updated_at?: string | null
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
      seller_payment_txns: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          "DigiCom Business": string | null
          id: string
          note: string | null
          paid_at: string
          seller_payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          note?: string | null
          paid_at?: string
          seller_payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          "DigiCom Business"?: string | null
          id?: string
          note?: string | null
          paid_at?: string
          seller_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_payment_txns_seller_payment_id_fkey"
            columns: ["seller_payment_id"]
            isOneToOne: false
            referencedRelation: "seller_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_payment_txns_seller_payment_id_fkey"
            columns: ["seller_payment_id"]
            isOneToOne: false
            referencedRelation: "seller_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_payments: {
        Row: {
          carried_in: number
          carried_out: number | null
          closed_at: string | null
          created_at: string | null
          delivered_orders: number | null
          "DigiCom Business": string | null
          earned_frozen: boolean
          id: string
          month_earned: number
          paid_amount: number
          paid_at: string | null
          payout_month: string | null
          period_state: string
          seller_id: string | null
          status: string | null
          total_amount: number | null
        }
        Insert: {
          carried_in?: number
          carried_out?: number | null
          closed_at?: string | null
          created_at?: string | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          earned_frozen?: boolean
          id?: string
          month_earned?: number
          paid_amount?: number
          paid_at?: string | null
          payout_month?: string | null
          period_state?: string
          seller_id?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          carried_in?: number
          carried_out?: number | null
          closed_at?: string | null
          created_at?: string | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          earned_frozen?: boolean
          id?: string
          month_earned?: number
          paid_amount?: number
          paid_at?: string | null
          payout_month?: string | null
          period_state?: string
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
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          seller_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          "DigiCom Business"?: string | null
          id?: string
          seller_id?: string | null
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
      sheet_ingest_rows: {
        Row: {
          channel_id: string
          content_hash: string
          created_at: string
          "DigiCom Business": string
          external_row_id: string
          fetched_at: string
          id: string
          mapped: Json | null
          order_id: string | null
          raw: Json
          resolved: Json | null
          sheet_row_number: number | null
          status: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          content_hash: string
          created_at?: string
          "DigiCom Business": string
          external_row_id: string
          fetched_at?: string
          id?: string
          mapped?: Json | null
          order_id?: string | null
          raw: Json
          resolved?: Json | null
          sheet_row_number?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          content_hash?: string
          created_at?: string
          "DigiCom Business"?: string
          external_row_id?: string
          fetched_at?: string
          id?: string
          mapped?: Json | null
          order_id?: string | null
          raw?: Json
          resolved?: Json | null
          sheet_row_number?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_ingest_rows_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_ingest_rows_DigiCom Business_fkey"
            columns: ["DigiCom Business"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_ingest_rows_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
          status: string | null
          total_price: number | null
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
          status?: string | null
          total_price?: number | null
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
          status?: string | null
          total_price?: number | null
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
      user_invitations: {
        Row: {
          business_id: string
          claimed_at: string | null
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_verified_at: string | null
          expires_at: string
          failed_attempts: number
          id: string
          profile_payload: Json
          reminder_sent_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          signup_otp_attempts: number
          signup_otp_email: string | null
          signup_otp_expires_at: string | null
          signup_otp_hash: string | null
          signup_otp_last_send_at: string | null
          signup_otp_sends: number
          target_role: Database["public"]["Enums"]["user_role"]
          token_hash: string
        }
        Insert: {
          business_id: string
          claimed_at?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_verified_at?: string | null
          expires_at?: string
          failed_attempts?: number
          id?: string
          profile_payload?: Json
          reminder_sent_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signup_otp_attempts?: number
          signup_otp_email?: string | null
          signup_otp_expires_at?: string | null
          signup_otp_hash?: string | null
          signup_otp_last_send_at?: string | null
          signup_otp_sends?: number
          target_role: Database["public"]["Enums"]["user_role"]
          token_hash: string
        }
        Update: {
          business_id?: string
          claimed_at?: string | null
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_verified_at?: string | null
          expires_at?: string
          failed_attempts?: number
          id?: string
          profile_payload?: Json
          reminder_sent_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signup_otp_attempts?: number
          signup_otp_email?: string | null
          signup_otp_expires_at?: string | null
          signup_otp_hash?: string | null
          signup_otp_last_send_at?: string | null
          signup_otp_sends?: number
          target_role?: Database["public"]["Enums"]["user_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_consumed_by_fkey"
            columns: ["consumed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean | null
          address: string | null
          avatar_config: Json | null
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
          avatar_config?: Json | null
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
          avatar_config?: Json | null
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
      seller_ledger: {
        Row: {
          carried_in: number | null
          carried_out: number | null
          closed_at: string | null
          created_at: string | null
          delivered_orders: number | null
          "DigiCom Business": string | null
          earned_frozen: boolean | null
          id: string | null
          month_earned: number | null
          paid_amount: number | null
          paid_at: string | null
          payout_month: string | null
          period_state: string | null
          remaining: number | null
          seller_id: string | null
          status: string | null
          total_amount: number | null
        }
        Insert: {
          carried_in?: number | null
          carried_out?: number | null
          closed_at?: string | null
          created_at?: string | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          earned_frozen?: boolean | null
          id?: string | null
          month_earned?: number | null
          paid_amount?: number | null
          paid_at?: string | null
          payout_month?: string | null
          period_state?: string | null
          remaining?: never
          seller_id?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          carried_in?: number | null
          carried_out?: number | null
          closed_at?: string | null
          created_at?: string | null
          delivered_orders?: number | null
          "DigiCom Business"?: string | null
          earned_frozen?: boolean | null
          id?: string | null
          month_earned?: number | null
          paid_amount?: number | null
          paid_at?: string | null
          payout_month?: string | null
          period_state?: string | null
          remaining?: never
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
    }
    Functions: {
      _sheet_default_map: { Args: never; Returns: Json }
      _sheet_pick: { Args: { p_aliases: Json; p_raw: Json }; Returns: string }
      app_invoke_edge: {
        Args: { p_body?: Json; p_function_name: string }
        Returns: number
      }
      approve_sheet_order: { Args: { p_order_id: string }; Returns: Json }
      business_storage_objects: {
        Args: { p_business_id: string }
        Returns: {
          bucket: string
          path: string
        }[]
      }
      check_expired_licenses: { Args: never; Returns: undefined }
      check_user_role: {
        Args: { allowed_roles: string[]; target_id: string }
        Returns: boolean
      }
      close_mediabuyer_month: {
        Args: { p_close_month?: string }
        Returns: undefined
      }
      close_seller_month: {
        Args: { p_close_month?: string }
        Returns: undefined
      }
      create_email_account: {
        Args: {
          p_created_by: string
          p_email_address: string
          p_from_name: string
          p_imap_host: string
          p_imap_port: number
          p_imap_security: string
          p_is_active: boolean
          p_name: string
          p_password: string
          p_pop3_host: string
          p_pop3_port: number
          p_pop3_security: string
          p_smtp_host: string
          p_smtp_port: number
          p_smtp_security: string
          p_username: string
        }
        Returns: string
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
      delete_open_courier_delivery_note: {
        Args: { p_delivery_note_id: string }
        Returns: undefined
      }
      generate_recurring_charges: {
        Args: { p_id?: string; p_through?: string }
        Returns: number
      }
      get_email_account_secret: { Args: { p_id: string }; Returns: string }
      get_google_analytics_sa_key: { Args: never; Returns: string }
      get_ipgeo_api_key: { Args: never; Returns: string }
      get_meta_ads_token: { Args: { p_connection_id: string }; Returns: string }
      get_meta_app_secret: { Args: never; Returns: string }
      get_meta_oauth_state_secret: { Args: never; Returns: string }
      ingest_sheet_rows: {
        Args: { p_channel_id: string; p_rows: Json }
        Returns: Json
      }
      invitation_claim: { Args: { p_token_hash: string }; Returns: Json }
      invitation_finalize: {
        Args: { p_invite_id: string; p_new_user: string }
        Returns: undefined
      }
      invitation_rollback: { Args: { p_invite_id: string }; Returns: undefined }
      invitation_status: { Args: { p_token_hash: string }; Returns: Json }
      invoke_ozon_poll: { Args: { p_trigger?: string }; Returns: number }
      invoke_quicklivraison_poll: {
        Args: { p_trigger?: string }
        Returns: number
      }
      invoke_sheets_poll: { Args: { p_trigger?: string }; Returns: number }
      invoke_tracking_sync: { Args: { p_trigger?: string }; Returns: number }
      invoke_vitex_poll: { Args: { p_trigger?: string }; Returns: number }
      is_owner: { Args: never; Returns: boolean }
      login_email_for_username: {
        Args: { p_username: string }
        Returns: string
      }
      link_company_parcels_to_delivery_note: {
        Args: { p_delivery_note_id: string; p_parcel_ids: string[] }
        Returns: Json
      }
      link_courier_parcels_to_delivery_note: {
        Args: { p_delivery_note_id: string; p_parcel_ids: string[] }
        Returns: Json
      }
      match_package_status: {
        Args: { p_status_value: string }
        Returns: {
          code: string
          color: string
          id: string
          label: string
        }[]
      }
      mb_ga_allowed: { Args: { p_conn: string }; Returns: boolean }
      mb_meta_allowed: { Args: { p_conn: string }; Returns: boolean }
      mb_month_earned: {
        Args: { p_business_id: string; p_mb: string; p_month: string }
        Returns: {
          campaigns: number
          delivered: number
          earned: number
          spend: number
        }[]
      }
      mb_source_norm: { Args: { p: string }; Returns: string }
      mb_sync_source_lock: {
        Args: { p_biz: string; p_src: string }
        Returns: undefined
      }
      mediabuyer_month_orders: {
        Args: { p_business: string; p_mb: string; p_month: string }
        Returns: {
          bucket_date: string
          client: string
          commission: number
          delivered_at: string
          order_id: string
          phone: string
          source: string
          tracking: string
          units: number
        }[]
      }
      normalize_phone_for_customer: { Args: { p: string }; Returns: string }
      pay_mediabuyer: {
        Args: {
          p_amount: number
          p_business_id: string
          p_mb: string
          p_note?: string
          p_paid_at?: string
        }
        Returns: string
      }
      pay_seller: {
        Args: {
          p_amount: number
          p_business_id: string
          p_note?: string
          p_paid_at?: string
          p_seller_id: string
        }
        Returns: string
      }
      purge_soft_deleted_orders: { Args: never; Returns: undefined }
      refresh_customer_from_orders: {
        Args: { p_business_id: string; p_phone_normalized: string }
        Returns: undefined
      }
      refresh_mediabuyer_payment_balance: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      refresh_open_mediabuyer_ticket: {
        Args: { p_business_id: string; p_mb: string; p_month?: string }
        Returns: undefined
      }
      refresh_open_seller_ticket: {
        Args: { p_business_id: string; p_month?: string; p_seller_id: string }
        Returns: undefined
      }
      refresh_seller_payment_balance: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      remove_company_parcel_from_delivery_note: {
        Args: { p_delivery_note_id: string; p_parcel_id: string }
        Returns: undefined
      }
      remove_courier_parcel_from_delivery_note: {
        Args: { p_delivery_note_id: string; p_parcel_id: string }
        Returns: undefined
      }
      seller_month_orders: {
        Args: { p_business: string; p_month: string; p_seller: string }
        Returns: {
          client: string
          commission: number
          delivered_at: string
          order_id: string
          phone: string
          tracking: string
          units: number
        }[]
      }
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
      update_email_account: {
        Args: {
          p_email_address: string
          p_from_name: string
          p_id: string
          p_imap_host: string
          p_imap_port: number
          p_imap_security: string
          p_is_active: boolean
          p_name: string
          p_password: string
          p_pop3_host: string
          p_pop3_port: number
          p_pop3_security: string
          p_smtp_host: string
          p_smtp_port: number
          p_smtp_security: string
          p_username: string
        }
        Returns: undefined
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

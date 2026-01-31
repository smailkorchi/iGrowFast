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
            ads_history: {
                Row: {
                    amount: number
                    created_at: string | null
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
                        foreignKeyName: "ads_history_product_id_fkey"
                        columns: ["product_id"]
                        isOneToOne: false
                        referencedRelation: "products"
                        referencedColumns: ["id"]
                    },
                ]
            }
            cities: {
                Row: {
                    created_at: string | null
                    id: string
                    name: string
                    zone_id: string | null
                }
                Insert: {
                    created_at?: string | null
                    id?: string
                    name: string
                    zone_id?: string | null
                }
                Update: {
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
            company_delivery_notes: {
                Row: {
                    id: string
                    reference: string
                    provider_id: string
                    status: string
                    parcel_count: number
                    notes: string | null
                    provider_response: Json | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    reference: string
                    provider_id: string
                    status?: string
                    parcel_count?: number
                    notes?: string | null
                    provider_response?: Json | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    reference?: string
                    provider_id?: string
                    status?: string
                    parcel_count?: number
                    notes?: string | null
                    provider_response?: Json | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "company_delivery_notes_provider_id_fkey"
                        columns: ["provider_id"]
                        isOneToOne: false
                        referencedRelation: "providers"
                        referencedColumns: ["id"]
                    },
                ]
            }
            company_parcels: {
                Row: {
                    id: string
                    reference: string
                    tracking_code: string | null
                    external_id: string | null
                    order_id: string
                    provider_id: string
                    company_delivery_note_id: string | null
                    status_id: string | null
                    cod_amount: number
                    provider_response: Json | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    reference: string
                    tracking_code?: string | null
                    external_id?: string | null
                    order_id: string
                    provider_id: string
                    company_delivery_note_id?: string | null
                    status_id?: string | null
                    cod_amount?: number
                    provider_response?: Json | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    reference?: string
                    tracking_code?: string | null
                    external_id?: string | null
                    order_id?: string
                    provider_id?: string
                    company_delivery_note_id?: string | null
                    status_id?: string | null
                    cod_amount?: number
                    provider_response?: Json | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Relationships: [
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
                        foreignKeyName: "company_parcels_company_delivery_note_id_fkey"
                        columns: ["company_delivery_note_id"]
                        isOneToOne: false
                        referencedRelation: "company_delivery_notes"
                        referencedColumns: ["id"]
                    },
                ]
            }
            courier_delivery_notes: {
                Row: {
                    id: string
                    reference: string
                    courier_id: string
                    status: string
                    parcel_count: number
                    notes: string | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    reference: string
                    courier_id: string
                    status?: string
                    parcel_count?: number
                    notes?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    reference?: string
                    courier_id?: string
                    status?: string
                    parcel_count?: number
                    notes?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "courier_delivery_notes_courier_id_fkey"
                        columns: ["courier_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    },
                ]
            }
            courier_parcels: {
                Row: {
                    id: string
                    reference: string
                    order_id: string
                    courier_id: string
                    courier_delivery_note_id: string | null
                    status_id: string | null
                    cod_amount: number
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    reference: string
                    order_id: string
                    courier_id: string
                    courier_delivery_note_id?: string | null
                    status_id?: string | null
                    cod_amount?: number
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    reference?: string
                    order_id?: string
                    courier_id?: string
                    courier_delivery_note_id?: string | null
                    status_id?: string | null
                    cod_amount?: number
                    created_at?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "courier_parcels_order_id_fkey"
                        columns: ["order_id"]
                        isOneToOne: false
                        referencedRelation: "orders"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "courier_parcels_courier_id_fkey"
                        columns: ["courier_id"]
                        isOneToOne: false
                        referencedRelation: "users"
                        referencedColumns: ["id"]
                    },
                ]
            }
            order_items: {
                Row: {
                    created_at: string | null
                    id: string
                    order_id: string
                    product_id: string
                    quantity: number
                    total_price: number | null
                    unit_price: number
                    updated_at: string | null
                }
                Insert: {
                    created_at?: string | null
                    id?: string
                    order_id: string
                    product_id: string
                    quantity?: number
                    total_price?: number | null
                    unit_price?: number
                    updated_at?: string | null
                }
                Update: {
                    created_at?: string | null
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
            order_statuses: {
                Row: {
                    active: boolean
                    code: string
                    color: string
                    created_at: string | null
                    id: string
                    label: string
                    ranking: number
                    recheck: boolean
                    updated_at: string | null
                }
                Insert: {
                    active?: boolean
                    code: string
                    color: string
                    created_at?: string | null
                    id?: string
                    label: string
                    ranking: number
                    recheck?: boolean
                    updated_at?: string | null
                }
                Update: {
                    active?: boolean
                    code?: string
                    color?: string
                    created_at?: string | null
                    id?: string
                    label?: string
                    ranking?: number
                    recheck?: boolean
                    updated_at?: string | null
                }
                Relationships: []
            }
            orders: {
                Row: {
                    address: string | null
                    annulation_date: string | null
                    assign_id: string | null
                    assignment_date: string | null
                    city_id: string | null
                    company_id: string | null
                    confirmation_date: string | null
                    confirmed_by_id: string | null
                    created_at: string | null
                    current_delivery_note_id: string | null
                    current_return_note_id: string | null
                    date: string | null
                    date_deleted: string | null
                    date_livraison: string | null
                    delivered: boolean | null
                    delivery_fees_id: string | null
                    delivery_note: string | null
                    delivery_type: string | null
                    free_shipping: boolean | null
                    id: string
                    courier_id: string | null
                    name: string | null
                    note: string | null
                    old_client_id: string | null
                    order_status_id: string | null
                    package_status_id: string | null
                    payed: boolean | null
                    payment_delivery_id: string | null
                    phone: string | null
                    price: number | null
                    processing: boolean | null
                    published: boolean | null
                    raw_price: number | null
                    replace: boolean | null
                    reported_date: string | null
                    shipping_cost: number | null
                    source_id: string | null
                    source_name: string | null
                    stock_changed: boolean | null
                    tracking_number: string | null
                    updated_at: string | null
                }
                Insert: {
                    address?: string | null
                    annulation_date?: string | null
                    assign_id?: string | null
                    assignment_date?: string | null
                    city_id?: string | null
                    company_id?: string | null
                    confirmation_date?: string | null
                    confirmed_by_id?: string | null
                    created_at?: string | null
                    current_delivery_note_id?: string | null
                    current_return_note_id?: string | null
                    date?: string | null
                    date_deleted?: string | null
                    date_livraison?: string | null
                    delivered?: boolean | null
                    delivery_fees_id?: string | null
                    delivery_note?: string | null
                    delivery_type?: string | null
                    free_shipping?: boolean | null
                    id?: string
                    courier_id?: string | null
                    name?: string | null
                    note?: string | null
                    old_client_id?: string | null
                    order_status_id?: string | null
                    package_status_id?: string | null
                    payed?: boolean | null
                    payment_delivery_id?: string | null
                    phone?: string | null
                    price?: number | null
                    processing?: boolean | null
                    published?: boolean | null
                    raw_price?: number | null
                    replace?: boolean | null
                    reported_date?: string | null
                    shipping_cost?: number | null
                    source_id?: string | null
                    source_name?: string | null
                    stock_changed?: boolean | null
                    tracking_number?: string | null
                    updated_at?: string | null
                }
                Update: {
                    address?: string | null
                    annulation_date?: string | null
                    assign_id?: string | null
                    assignment_date?: string | null
                    city_id?: string | null
                    company_id?: string | null
                    confirmation_date?: string | null
                    confirmed_by_id?: string | null
                    created_at?: string | null
                    current_delivery_note_id?: string | null
                    current_return_note_id?: string | null
                    date?: string | null
                    date_deleted?: string | null
                    date_livraison?: string | null
                    delivered?: boolean | null
                    delivery_fees_id?: string | null
                    delivery_note?: string | null
                    delivery_type?: string | null
                    free_shipping?: boolean | null
                    id?: string
                    courier_id?: string | null
                    name?: string | null
                    note?: string | null
                    old_client_id?: string | null
                    order_status_id?: string | null
                    package_status_id?: string | null
                    payed?: boolean | null
                    payment_delivery_id?: string | null
                    phone?: string | null
                    price?: number | null
                    processing?: boolean | null
                    published?: boolean | null
                    raw_price?: number | null
                    replace?: boolean | null
                    reported_date?: string | null
                    shipping_cost?: number | null
                    source_id?: string | null
                    source_name?: string | null
                    stock_changed?: boolean | null
                    tracking_number?: string | null
                    updated_at?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "orders_city_id_fkey"
                        columns: ["city_id"]
                        isOneToOne: false
                        referencedRelation: "cities"
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
                    active: boolean
                    code: string
                    color: string
                    created_at: string | null
                    id: string
                    label: string
                    updated_at: string | null
                }
                Insert: {
                    active?: boolean
                    code: string
                    color: string
                    created_at?: string | null
                    id?: string
                    label: string
                    updated_at?: string | null
                }
                Update: {
                    active?: boolean
                    code?: string
                    color?: string
                    created_at?: string | null
                    id?: string
                    label?: string
                    updated_at?: string | null
                }
                Relationships: []
            }
            products: {
                Row: {
                    active: boolean
                    code: string
                    cost_price: number
                    created_at: string | null
                    description: string | null
                    id: string
                    image_url: string | null
                    label: string | null
                    name: string
                    selling_price: number
                    stock: number
                    updated_at: string | null
                }
                Insert: {
                    active?: boolean
                    code: string
                    cost_price: number
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    image_url?: string | null
                    label?: string | null
                    name: string
                    selling_price: number
                    stock?: number
                    updated_at?: string | null
                }
                Update: {
                    active?: boolean
                    code?: string
                    cost_price?: number
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    image_url?: string | null
                    label?: string | null
                    name?: string
                    selling_price?: number
                    stock?: number
                    updated_at?: string | null
                }
                Relationships: []
            }
            sales_channels: {
                Row: {
                    active: boolean
                    created_at: string | null
                    description: string | null
                    id: string
                    name: string
                    type: string
                    updated_at: string | null
                }
                Insert: {
                    active?: boolean
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    name: string
                    type: string
                    updated_at?: string | null
                }
                Update: {
                    active?: boolean
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    name?: string
                    type?: string
                    updated_at?: string | null
                }
                Relationships: []
            }
            users: {
                Row: {
                    active: boolean | null
                    assignment: number | null
                    avatar_url: string | null
                    created_at: string
                    email: string
                    id: string
                    name: string
                    permissions: Json | null
                    products: Json | null
                    role: Database["public"]["Enums"]["user_role"]
                    updated_at: string
                    username: string
                }
                Insert: {
                    active?: boolean | null
                    assignment?: number | null
                    avatar_url?: string | null
                    created_at?: string
                    email: string
                    id: string
                    name: string
                    permissions?: Json | null
                    products?: Json | null
                    role?: Database["public"]["Enums"]["user_role"]
                    updated_at?: string
                    username: string
                }
                Update: {
                    active?: boolean | null
                    assignment?: number | null
                    avatar_url?: string | null
                    created_at?: string
                    email?: string
                    id?: string
                    name?: string
                    permissions?: Json | null
                    products?: Json | null
                    role?: Database["public"]["Enums"]["user_role"]
                    updated_at?: string
                    username?: string
                }
                Relationships: []
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
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            user_role: "super admin" | "admin" | "commercial" | "mediabuyer"
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]
type DatabaseWithoutInternals = Pick<Database, Exclude<keyof Database, "__InternalSupabase">>

export type Tables<
    DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
    }
    ? R
    : never
    : never

export type TablesInsert<
    DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
            user_role: ["super admin", "admin", "commercial", "mediabuyer"],
        },
    },
} as const

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    public: {
        Tables: {
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
            products: {
                Row: {
                    active: boolean | null
                    code: string
                    cost_price: number
                    created_at: string | null
                    description: string | null
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
                    id?: string
                    image_url?: string | null
                    label?: string | null
                    name?: string
                    selling_price?: number
                    stock?: number | null
                    updated_at?: string | null
                }
                Relationships: []
            }
            transactions: {
                Row: {
                    address: string | null
                    created_at: string | null
                    date: string | null
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
                    id: string
                    method: string | null
                    transaction_id: string | null
                }
                Insert: {
                    amount?: number
                    created_at?: string | null
                    date?: string | null
                    id?: string
                    method?: string | null
                    transaction_id?: string | null
                }
                Update: {
                    amount?: number
                    created_at?: string | null
                    date?: string | null
                    id?: string
                    method?: string | null
                    transaction_id?: string | null
                }
                Relationships: [
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
                    created_at: string | null
                    id: string
                    product_id: string | null
                    quantity: number
                    sub_total: number
                    transaction_id: string | null
                }
                Insert: {
                    created_at?: string | null
                    id?: string
                    product_id?: string | null
                    quantity?: number
                    sub_total?: number
                    transaction_id?: string | null
                }
                Update: {
                    created_at?: string | null
                    id?: string
                    product_id?: string | null
                    quantity?: number
                    sub_total?: number
                    transaction_id?: string | null
                }
                Relationships: [
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
                    assignment: number | null
                    avatar_url: string | null
                    created_at: string
                    email: string
                    id: string
                    name: string | null
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
                    id?: string
                    name?: string | null
                    permissions?: Json | null
                    products?: Json | null
                    role: Database["public"]["Enums"]["user_role"]
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
                    name?: string | null
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
    PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] & PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
    }
    ? R
    : never
    : never

export type TablesInsert<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Insert: infer I
    }
    ? I
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
    }
    ? I
    : never
    : never

export type TablesUpdate<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Update: infer U
    }
    ? U
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
    }
    ? U
    : never
    : never

export type Enums<
    PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
    EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
    : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof Database
    }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
    ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

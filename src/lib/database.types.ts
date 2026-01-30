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
                    id?: string
                    name: string
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
                    name?: string
                    permissions?: Json | null
                    products?: Json | null
                    role?: Database["public"]["Enums"]["user_role"]
                    updated_at?: string
                    username?: string
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

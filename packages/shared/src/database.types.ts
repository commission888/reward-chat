export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      chat_logs: {
        Row: {
          created_at: string
          customer_id: string | null
          direction: string
          id: string
          message_text: string
          shop_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          direction: string
          id?: string
          message_text: string
          shop_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          direction?: string
          id?: string
          message_text?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_logs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          line_user_id: string
          phone: string | null
          picture_url: string | null
          points_balance: number
          shop_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          line_user_id: string
          phone?: string | null
          picture_url?: string | null
          points_balance?: number
          shop_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          line_user_id?: string
          phone?: string | null
          picture_url?: string | null
          points_balance?: number
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          file_id: string
          id: string
          shop_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          file_id: string
          id?: string
          shop_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          file_id?: string
          id?: string
          shop_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          mime_type: string | null
          original_name: string
          shop_id: string
          status: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          mime_type?: string | null
          original_name: string
          shop_id: string
          status?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          mime_type?: string | null
          original_name?: string
          shop_id?: string
          status?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_cards: {
        Row: {
          customer_id: string
          id: string
          issued_at: string
          qr_token: string
          revoked_at: string | null
          shop_id: string
        }
        Insert: {
          customer_id: string
          id?: string
          issued_at?: string
          qr_token: string
          revoked_at?: string | null
          shop_id: string
        }
        Update: {
          customer_id?: string
          id?: string
          issued_at?: string
          qr_token?: string
          revoked_at?: string | null
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_cards_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      point_grants: {
        Row: {
          claimed_at: string | null
          claimed_by_customer_id: string | null
          created_at: string
          expires_at: string
          id: string
          points: number
          shop_id: string
          staff_user_id: string | null
          token: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_customer_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          points: number
          shop_id: string
          staff_user_id?: string | null
          token: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by_customer_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          points?: number
          shop_id?: string
          staff_user_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_grants_claimed_by_customer_id_fkey"
            columns: ["claimed_by_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_grants_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_grants_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      points_transactions: {
        Row: {
          balance_after: number
          created_at: string
          customer_id: string
          delta: number
          id: string
          reason: string | null
          shop_id: string
          staff_user_id: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          customer_id: string
          delta: number
          id?: string
          reason?: string | null
          shop_id: string
          staff_user_id?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          customer_id?: string
          delta?: number
          id?: string
          reason?: string | null
          shop_id?: string
          staff_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_transactions_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          shop_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role: string
          shop_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      redemptions: {
        Row: {
          code: string
          completed_at: string | null
          created_at: string
          customer_id: string
          id: string
          points_cost: number
          reward_id: string | null
          reward_name: string
          shop_id: string
          staff_user_id: string | null
          status: string
        }
        Insert: {
          code: string
          completed_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          points_cost: number
          reward_id?: string | null
          reward_name: string
          shop_id: string
          staff_user_id?: string | null
          status?: string
        }
        Update: {
          code?: string
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          points_cost?: number
          reward_id?: string | null
          reward_name?: string
          shop_id?: string
          staff_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemptions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemptions_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          points_cost: number
          shop_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          points_cost: number
          shop_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          points_cost?: number
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rewards_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          created_at: string
          id: string
          liff_id: string | null
          line_channel_access_token: string | null
          line_channel_id: string | null
          line_channel_secret: string | null
          name: string
          openai_api_key: string | null
          points_config: Json
          reply_templates: Json
          slip_receiver_account_name_en: string | null
          slip_receiver_account_name_th: string | null
          slip_receiver_account_number: string | null
          slip_receiver_account_type: string | null
          slip2go_api_secret: string | null
          slug: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          liff_id?: string | null
          line_channel_access_token?: string | null
          line_channel_id?: string | null
          line_channel_secret?: string | null
          name: string
          openai_api_key?: string | null
          points_config?: Json
          reply_templates?: Json
          slip_receiver_account_name_en?: string | null
          slip_receiver_account_name_th?: string | null
          slip_receiver_account_number?: string | null
          slip_receiver_account_type?: string | null
          slip2go_api_secret?: string | null
          slug: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          liff_id?: string | null
          line_channel_access_token?: string | null
          line_channel_id?: string | null
          line_channel_secret?: string | null
          name?: string
          openai_api_key?: string | null
          points_config?: Json
          reply_templates?: Json
          slip_receiver_account_name_en?: string | null
          slip_receiver_account_name_th?: string | null
          slip_receiver_account_number?: string | null
          slip_receiver_account_type?: string | null
          slip2go_api_secret?: string | null
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      slip_verifications: {
        Row: {
          amount: number | null
          bank_name: string | null
          created_at: string
          customer_id: string | null
          id: string
          points_awarded: number | null
          raw_response: Json | null
          reference_id: string | null
          sender_name: string | null
          shop_id: string
          slip2go_code: string
          status: string
          trans_ref: string | null
        }
        Insert: {
          amount?: number | null
          bank_name?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          points_awarded?: number | null
          raw_response?: Json | null
          reference_id?: string | null
          sender_name?: string | null
          shop_id: string
          slip2go_code: string
          status: string
          trans_ref?: string | null
        }
        Update: {
          amount?: number | null
          bank_name?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          points_awarded?: number | null
          raw_response?: Json | null
          reference_id?: string | null
          sender_name?: string | null
          shop_id?: string
          slip2go_code?: string
          status?: string
          trans_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slip_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slip_verifications_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_points: {
        Args: { p_customer_id: string; p_delta: number; p_reason?: string }
        Returns: number
      }
      apply_points_system: {
        Args: { p_customer_id: string; p_delta: number; p_reason?: string }
        Returns: number
      }
      cancel_redemption: {
        Args: { p_redemption_id: string }
        Returns: undefined
      }
      claim_point_grant: {
        Args: { p_customer_id: string; p_token: string }
        Returns: {
          balance: number
          points: number
        }[]
      }
      complete_redemption: {
        Args: { p_redemption_id: string }
        Returns: number
      }
      current_profile: {
        Args: never
        Returns: {
          role: string
          shop_id: string
        }[]
      }
      is_super_admin: { Args: never; Returns: boolean }
      match_document_chunks: {
        Args: {
          p_match_count?: number
          p_query_embedding: string
          p_shop_id: string
        }
        Returns: {
          content: string
          distance: number
          file_id: string
          id: string
        }[]
      }
      my_shop_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


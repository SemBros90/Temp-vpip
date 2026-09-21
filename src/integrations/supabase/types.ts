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
  public: {
    Tables: {
      vpip_discussions: {
        Row: {
          attachments: Json
          created_at: string
          id: string
          messages: Json
          project_id: string
          summary: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          created_at?: string
          id: string
          messages?: Json
          project_id: string
          summary?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          created_at?: string
          id?: string
          messages?: Json
          project_id?: string
          summary?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_discussions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          markdown: string
          model: string | null
          project_id: string
          provider: string | null
          source_discussion_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          markdown?: string
          model?: string | null
          project_id: string
          provider?: string | null
          source_discussion_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          markdown?: string
          model?: string | null
          project_id?: string
          provider?: string | null
          source_discussion_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_knowledge: {
        Row: {
          author: string
          code: string
          created_at: string
          description: string
          id: string
          merged_from: Json
          project_id: string
          provider: string | null
          revisions: Json
          source_discussion_id: string | null
          source_discussion_title: string | null
          source_messages: Json
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          author?: string
          code: string
          created_at?: string
          description?: string
          id: string
          merged_from?: Json
          project_id: string
          provider?: string | null
          revisions?: Json
          source_discussion_id?: string | null
          source_discussion_title?: string | null
          source_messages?: Json
          status?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          author?: string
          code?: string
          created_at?: string
          description?: string
          id?: string
          merged_from?: Json
          project_id?: string
          provider?: string | null
          revisions?: Json
          source_discussion_id?: string | null
          source_discussion_title?: string | null
          source_messages?: Json
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_knowledge_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_projects: {
        Row: {
          archived: boolean
          created_at: string
          description: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      vpip_prompts: {
        Row: {
          created_at: string
          id: string
          kind: string
          markdown: string
          model: string | null
          project_id: string
          provider: string | null
          title: string
          version: number
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          markdown?: string
          model?: string | null
          project_id: string
          provider?: string | null
          title: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          markdown?: string
          model?: string | null
          project_id?: string
          provider?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vpip_prompts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_settings: {
        Row: {
          author: string
          auto_save_interval_sec: number
          backup_folder_label: string
          default_provider: string
          id: number
          project_root_label: string
          providers: Json
          saved_at: string
        }
        Insert: {
          author?: string
          auto_save_interval_sec?: number
          backup_folder_label?: string
          default_provider?: string
          id?: number
          project_root_label?: string
          providers?: Json
          saved_at?: string
        }
        Update: {
          author?: string
          auto_save_interval_sec?: number
          backup_folder_label?: string
          default_provider?: string
          id?: number
          project_root_label?: string
          providers?: Json
          saved_at?: string
        }
        Relationships: []
      }
      vpip_snapshots: {
        Row: {
          created_at: string
          id: string
          kind: string
          markdown: string
          project_id: string
          ref_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          markdown?: string
          project_id: string
          ref_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          markdown?: string
          project_id?: string
          ref_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

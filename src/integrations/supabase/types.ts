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
      vpip_activity: {
        Row: {
          action: string
          author: string
          created_at: string
          id: string
          model: string | null
          note: string
          project_id: string
          provider: string | null
          subject_id: string
          subject_label: string
          subject_type: string
        }
        Insert: {
          action?: string
          author?: string
          created_at: string
          id: string
          model?: string | null
          note?: string
          project_id: string
          provider?: string | null
          subject_id?: string
          subject_label?: string
          subject_type?: string
        }
        Update: {
          action?: string
          author?: string
          created_at?: string
          id?: string
          model?: string | null
          note?: string
          project_id?: string
          provider?: string | null
          subject_id?: string
          subject_label?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_artifacts: {
        Row: {
          branch: string | null
          build_code: string | null
          build_record_id: string | null
          build_run_code: string | null
          build_session_id: string | null
          code: string
          commit_sha: string | null
          content: string
          created_at: string
          decision_codes: Json
          id: string
          model: string | null
          name: string
          path: string
          project_id: string
          prompt_id: string | null
          prompt_title: string | null
          prompt_version: number | null
          provider: string | null
          repository_full_name: string | null
          requirement_codes: Json
          size: number
          task_code: string | null
          task_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          branch?: string | null
          build_code?: string | null
          build_record_id?: string | null
          build_run_code?: string | null
          build_session_id?: string | null
          code: string
          commit_sha?: string | null
          content?: string
          created_at: string
          decision_codes?: Json
          id: string
          model?: string | null
          name: string
          path: string
          project_id: string
          prompt_id?: string | null
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          repository_full_name?: string | null
          requirement_codes?: Json
          size?: number
          task_code?: string | null
          task_id?: string | null
          type: string
          updated_at: string
        }
        Update: {
          branch?: string | null
          build_code?: string | null
          build_record_id?: string | null
          build_run_code?: string | null
          build_session_id?: string | null
          code?: string
          commit_sha?: string | null
          content?: string
          created_at?: string
          decision_codes?: Json
          id?: string
          model?: string | null
          name?: string
          path?: string
          project_id?: string
          prompt_id?: string | null
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          repository_full_name?: string | null
          requirement_codes?: Json
          size?: number
          task_code?: string | null
          task_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_build_records: {
        Row: {
          artifact_ids: Json
          branch: string | null
          build_code: string
          build_session_id: string
          code: string
          commit_sha: string | null
          created_at: string
          decision_codes: Json
          ended_at: string | null
          id: string
          logs: Json
          model: string | null
          output: string | null
          project_id: string
          prompt_id: string
          prompt_title: string
          prompt_version: number
          provider: string | null
          repository_full_name: string | null
          repository_id: string | null
          requirement_codes: Json
          started_at: string
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          artifact_ids?: Json
          branch?: string | null
          build_code?: string
          build_session_id?: string
          code: string
          commit_sha?: string | null
          created_at: string
          decision_codes?: Json
          ended_at?: string | null
          id: string
          logs?: Json
          model?: string | null
          output?: string | null
          project_id: string
          prompt_id?: string
          prompt_title?: string
          prompt_version?: number
          provider?: string | null
          repository_full_name?: string | null
          repository_id?: string | null
          requirement_codes?: Json
          started_at: string
          status?: string
          summary?: string | null
          updated_at: string
        }
        Update: {
          artifact_ids?: Json
          branch?: string | null
          build_code?: string
          build_session_id?: string
          code?: string
          commit_sha?: string | null
          created_at?: string
          decision_codes?: Json
          ended_at?: string | null
          id?: string
          logs?: Json
          model?: string | null
          output?: string | null
          project_id?: string
          prompt_id?: string
          prompt_title?: string
          prompt_version?: number
          provider?: string | null
          repository_full_name?: string | null
          repository_id?: string | null
          requirement_codes?: Json
          started_at?: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_build_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_build_sessions: {
        Row: {
          actions: Json
          agent_tasks: Json
          build_plan: Json | null
          code: string
          context_package: string
          context_package_id: string | null
          counts: Json
          created_at: string
          db_connections: Json
          files: Json
          id: string
          last_commit_at: string | null
          last_commit_sha: string | null
          model: string | null
          note: string | null
          opened_at: string | null
          preview_entry_path: string | null
          project_id: string
          prompt_id: string
          prompt_kind: string
          prompt_title: string
          prompt_version: number
          provider: string | null
          repository_branch: string | null
          repository_full_name: string | null
          repository_id: string | null
          repository_provider: string | null
          requirements: Json
          source_discussion_ids: Json
          source_document_ids: Json
          status: string
          terminal: Json
          turns: Json
          updated_at: string
          validation: Json | null
        }
        Insert: {
          actions?: Json
          agent_tasks?: Json
          build_plan?: Json | null
          code: string
          context_package?: string
          context_package_id?: string | null
          counts?: Json
          created_at: string
          db_connections?: Json
          files?: Json
          id: string
          last_commit_at?: string | null
          last_commit_sha?: string | null
          model?: string | null
          note?: string | null
          opened_at?: string | null
          preview_entry_path?: string | null
          project_id: string
          prompt_id: string
          prompt_kind?: string
          prompt_title?: string
          prompt_version?: number
          provider?: string | null
          repository_branch?: string | null
          repository_full_name?: string | null
          repository_id?: string | null
          repository_provider?: string | null
          requirements?: Json
          source_discussion_ids?: Json
          source_document_ids?: Json
          status?: string
          terminal?: Json
          turns?: Json
          updated_at: string
          validation?: Json | null
        }
        Update: {
          actions?: Json
          agent_tasks?: Json
          build_plan?: Json | null
          code?: string
          context_package?: string
          context_package_id?: string | null
          counts?: Json
          created_at?: string
          db_connections?: Json
          files?: Json
          id?: string
          last_commit_at?: string | null
          last_commit_sha?: string | null
          model?: string | null
          note?: string | null
          opened_at?: string | null
          preview_entry_path?: string | null
          project_id?: string
          prompt_id?: string
          prompt_kind?: string
          prompt_title?: string
          prompt_version?: number
          provider?: string | null
          repository_branch?: string | null
          repository_full_name?: string | null
          repository_id?: string | null
          repository_provider?: string | null
          requirements?: Json
          source_discussion_ids?: Json
          source_document_ids?: Json
          status?: string
          terminal?: Json
          turns?: Json
          updated_at?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "vpip_build_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_change_records: {
        Row: {
          action: string
          build_code: string | null
          build_record_id: string | null
          build_run_code: string | null
          build_session_id: string | null
          created_at: string
          from_path: string | null
          id: string
          model: string | null
          path: string
          project_id: string
          prompt_id: string | null
          provider: string | null
          task_code: string | null
          task_id: string | null
        }
        Insert: {
          action: string
          build_code?: string | null
          build_record_id?: string | null
          build_run_code?: string | null
          build_session_id?: string | null
          created_at: string
          from_path?: string | null
          id: string
          model?: string | null
          path: string
          project_id: string
          prompt_id?: string | null
          provider?: string | null
          task_code?: string | null
          task_id?: string | null
        }
        Update: {
          action?: string
          build_code?: string | null
          build_record_id?: string | null
          build_run_code?: string | null
          build_session_id?: string | null
          created_at?: string
          from_path?: string | null
          id?: string
          model?: string | null
          path?: string
          project_id?: string
          prompt_id?: string | null
          provider?: string | null
          task_code?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vpip_change_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_context_packages: {
        Row: {
          code: string
          counts: Json
          created_at: string
          decision_ids: Json
          discussion_ids: Json
          document_ids: Json
          id: string
          markdown: string
          model: string | null
          project_id: string
          prompt_id: string | null
          prompt_ids: Json
          prompt_title: string | null
          prompt_version: number | null
          provider: string | null
          requirement_ids: Json
          title: string
          updated_at: string
        }
        Insert: {
          code?: string
          counts?: Json
          created_at: string
          decision_ids?: Json
          discussion_ids?: Json
          document_ids?: Json
          id: string
          markdown?: string
          model?: string | null
          project_id: string
          prompt_id?: string | null
          prompt_ids?: Json
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          requirement_ids?: Json
          title?: string
          updated_at: string
        }
        Update: {
          code?: string
          counts?: Json
          created_at?: string
          decision_ids?: Json
          discussion_ids?: Json
          document_ids?: Json
          id?: string
          markdown?: string
          model?: string | null
          project_id?: string
          prompt_id?: string | null
          prompt_ids?: Json
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          requirement_ids?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_context_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_discussions: {
        Row: {
          attachments: Json
          created_at: string
          id: string
          messages: Json
          project_id: string
          reopen_context: Json
          reopened_at: string | null
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
          reopen_context?: Json
          reopened_at?: string | null
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
          reopen_context?: Json
          reopened_at?: string | null
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
      vpip_failures: {
        Row: {
          author: string
          build_ids: Json
          code: string
          created_at: string
          decision_codes: Json
          id: string
          lessons: string
          model: string | null
          project_id: string
          prompt_ids: Json
          provider: string | null
          requirement_codes: Json
          resolution: string
          root_cause: string
          status: string
          subject_id: string
          subject_label: string
          subject_type: string
          title: string
          updated_at: string
        }
        Insert: {
          author?: string
          build_ids?: Json
          code?: string
          created_at: string
          decision_codes?: Json
          id: string
          lessons?: string
          model?: string | null
          project_id: string
          prompt_ids?: Json
          provider?: string | null
          requirement_codes?: Json
          resolution?: string
          root_cause?: string
          status?: string
          subject_id?: string
          subject_label?: string
          subject_type?: string
          title?: string
          updated_at: string
        }
        Update: {
          author?: string
          build_ids?: Json
          code?: string
          created_at?: string
          decision_codes?: Json
          id?: string
          lessons?: string
          model?: string | null
          project_id?: string
          prompt_ids?: Json
          provider?: string | null
          requirement_codes?: Json
          resolution?: string
          root_cause?: string
          status?: string
          subject_id?: string
          subject_label?: string
          subject_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_failures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_intelligence: {
        Row: {
          author: string
          code: string
          created_at: string
          description: string
          id: string
          model: string | null
          pattern_type: string
          project_id: string
          provider: string | null
          source_id: string | null
          source_kind: string | null
          source_project_id: string | null
          source_project_name: string | null
          tags: Json
          title: string
          updated_at: string
        }
        Insert: {
          author?: string
          code?: string
          created_at: string
          description?: string
          id: string
          model?: string | null
          pattern_type?: string
          project_id: string
          provider?: string | null
          source_id?: string | null
          source_kind?: string | null
          source_project_id?: string | null
          source_project_name?: string | null
          tags?: Json
          title?: string
          updated_at: string
        }
        Update: {
          author?: string
          code?: string
          created_at?: string
          description?: string
          id?: string
          model?: string | null
          pattern_type?: string
          project_id?: string
          provider?: string | null
          source_id?: string | null
          source_kind?: string | null
          source_project_id?: string | null
          source_project_name?: string | null
          tags?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_intelligence_project_id_fkey"
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
          reason_for_change: string | null
          revisions: Json
          source_discussion_id: string | null
          source_discussion_title: string | null
          source_kind: string
          source_messages: Json
          source_ref_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          version: number
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
          reason_for_change?: string | null
          revisions?: Json
          source_discussion_id?: string | null
          source_discussion_title?: string | null
          source_kind?: string
          source_messages?: Json
          source_ref_id?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          version?: number
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
          reason_for_change?: string | null
          revisions?: Json
          source_discussion_id?: string | null
          source_discussion_title?: string | null
          source_kind?: string
          source_messages?: Json
          source_ref_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          version?: number
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
      vpip_outcomes: {
        Row: {
          author: string
          code: string
          created_at: string
          id: string
          lessons: string
          model: string | null
          notes: string
          project_id: string
          provider: string | null
          recommendations: string
          result: string
          subject_id: string
          subject_label: string
          subject_type: string
          updated_at: string
        }
        Insert: {
          author?: string
          code?: string
          created_at: string
          id: string
          lessons?: string
          model?: string | null
          notes?: string
          project_id: string
          provider?: string | null
          recommendations?: string
          result?: string
          subject_id?: string
          subject_label?: string
          subject_type?: string
          updated_at: string
        }
        Update: {
          author?: string
          code?: string
          created_at?: string
          id?: string
          lessons?: string
          model?: string | null
          notes?: string
          project_id?: string
          provider?: string | null
          recommendations?: string
          result?: string
          subject_id?: string
          subject_label?: string
          subject_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_outcomes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_phase_runs: {
        Row: {
          attempt: number
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          model: string | null
          output: string | null
          phase_id: string
          project_id: string
          prompt_id: string
          provider: string | null
          started_at: string
          status: string
        }
        Insert: {
          attempt?: number
          created_at: string
          ended_at?: string | null
          error?: string | null
          id: string
          model?: string | null
          output?: string | null
          phase_id: string
          project_id: string
          prompt_id?: string
          provider?: string | null
          started_at: string
          status?: string
        }
        Update: {
          attempt?: number
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          model?: string | null
          output?: string | null
          phase_id?: string
          project_id?: string
          prompt_id?: string
          provider?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_phase_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_project_members: {
        Row: {
          created_at: string
          email: string | null
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_project_members_project_id_fkey"
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
      vpip_prompt_phases: {
        Row: {
          build_session_id: string | null
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          markdown: string
          model: string | null
          output: string | null
          phase_no: number
          project_id: string
          prompt_id: string
          provider: string | null
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          build_session_id?: string | null
          created_at: string
          ended_at?: string | null
          error?: string | null
          id: string
          markdown?: string
          model?: string | null
          output?: string | null
          phase_no?: number
          project_id: string
          prompt_id: string
          provider?: string | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at: string
        }
        Update: {
          build_session_id?: string | null
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          markdown?: string
          model?: string | null
          output?: string | null
          phase_no?: number
          project_id?: string
          prompt_id?: string
          provider?: string | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_prompt_phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_prompts: {
        Row: {
          created_at: string
          id: string
          kind: string
          linked_decision_ids: Json
          linked_discussion_ids: Json
          linked_document_ids: Json
          linked_requirement_ids: Json
          markdown: string
          model: string | null
          project_id: string
          provider: string | null
          status: string
          title: string
          version: number
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          linked_decision_ids?: Json
          linked_discussion_ids?: Json
          linked_document_ids?: Json
          linked_requirement_ids?: Json
          markdown?: string
          model?: string | null
          project_id: string
          provider?: string | null
          status?: string
          title: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          linked_decision_ids?: Json
          linked_discussion_ids?: Json
          linked_document_ids?: Json
          linked_requirement_ids?: Json
          markdown?: string
          model?: string | null
          project_id?: string
          provider?: string | null
          status?: string
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
      vpip_repair_audit: {
        Row: {
          action: string
          change_type: string | null
          confidence: number | null
          created_at: string
          dependencies: Json
          files: Json
          id: string
          note: string
          project_id: string
          repository_id: string | null
          risk: string | null
          user: string
        }
        Insert: {
          action: string
          change_type?: string | null
          confidence?: number | null
          created_at: string
          dependencies?: Json
          files?: Json
          id: string
          note?: string
          project_id: string
          repository_id?: string | null
          risk?: string | null
          user: string
        }
        Update: {
          action?: string
          change_type?: string | null
          confidence?: number | null
          created_at?: string
          dependencies?: Json
          files?: Json
          id?: string
          note?: string
          project_id?: string
          repository_id?: string | null
          risk?: string | null
          user?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repair_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repair_proposals: {
        Row: {
          approved_files: Json
          build_session_id: string | null
          classification: string
          confidence: number
          confidence_note: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          dependencies: Json
          files: Json
          fix: string
          id: string
          impact: Json
          problem: string
          project_id: string
          repository_id: string | null
          risk: string
          simulation_id: string
          snapshot_id: string | null
          status: string
        }
        Insert: {
          approved_files?: Json
          build_session_id?: string | null
          classification: string
          confidence: number
          confidence_note: string
          created_at: string
          decided_at?: string | null
          decided_by?: string | null
          dependencies?: Json
          files?: Json
          fix: string
          id: string
          impact?: Json
          problem: string
          project_id: string
          repository_id?: string | null
          risk: string
          simulation_id: string
          snapshot_id?: string | null
          status?: string
        }
        Update: {
          approved_files?: Json
          build_session_id?: string | null
          classification?: string
          confidence?: number
          confidence_note?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          dependencies?: Json
          files?: Json
          fix?: string
          id?: string
          impact?: Json
          problem?: string
          project_id?: string
          repository_id?: string | null
          risk?: string
          simulation_id?: string
          snapshot_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repair_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repo_branches: {
        Row: {
          base_branch: string | null
          created_at: string
          id: string
          name: string
          repository_id: string
          sha: string
        }
        Insert: {
          base_branch?: string | null
          created_at: string
          id: string
          name: string
          repository_id: string
          sha?: string
        }
        Update: {
          base_branch?: string | null
          created_at?: string
          id?: string
          name?: string
          repository_id?: string
          sha?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repo_branches_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "vpip_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repo_commits: {
        Row: {
          author: string
          branch: string
          build_code: string | null
          build_session_id: string | null
          created_at: string
          decision_codes: Json
          files: Json
          html_url: string | null
          id: string
          message: string
          model: string | null
          project_id: string
          prompt_id: string | null
          prompt_title: string | null
          prompt_version: number | null
          provider: string | null
          release_name: string | null
          release_tag: string | null
          repository_id: string
          requirement_codes: Json
          sha: string
        }
        Insert: {
          author?: string
          branch?: string
          build_code?: string | null
          build_session_id?: string | null
          created_at: string
          decision_codes?: Json
          files?: Json
          html_url?: string | null
          id: string
          message?: string
          model?: string | null
          project_id: string
          prompt_id?: string | null
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          release_name?: string | null
          release_tag?: string | null
          repository_id: string
          requirement_codes?: Json
          sha: string
        }
        Update: {
          author?: string
          branch?: string
          build_code?: string | null
          build_session_id?: string | null
          created_at?: string
          decision_codes?: Json
          files?: Json
          html_url?: string | null
          id?: string
          message?: string
          model?: string | null
          project_id?: string
          prompt_id?: string | null
          prompt_title?: string | null
          prompt_version?: number | null
          provider?: string | null
          release_name?: string | null
          release_tag?: string | null
          repository_id?: string
          requirement_codes?: Json
          sha?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repo_commits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repo_env: {
        Row: {
          id: string
          key: string
          project_id: string
          repository_id: string
          updated_at: string
          value: string
        }
        Insert: {
          id: string
          key: string
          project_id: string
          repository_id: string
          updated_at: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          project_id?: string
          repository_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repo_env_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vpip_repo_env_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "vpip_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repo_reports: {
        Row: {
          aliases: Json
          branch: string
          build_session_id: string | null
          classification: Json
          commit_sha: string | null
          created_at: string
          dependencies: Json
          environment: Json
          health: Json
          id: string
          imports: Json
          ingestion: Json | null
          preview_diagnostics: Json
          project_id: string
          readiness: Json | null
          repository_id: string | null
          stages: Json | null
          unsupported: Json
        }
        Insert: {
          aliases?: Json
          branch?: string
          build_session_id?: string | null
          classification?: Json
          commit_sha?: string | null
          created_at: string
          dependencies?: Json
          environment?: Json
          health?: Json
          id: string
          imports?: Json
          ingestion?: Json | null
          preview_diagnostics?: Json
          project_id: string
          readiness?: Json | null
          repository_id?: string | null
          stages?: Json | null
          unsupported?: Json
        }
        Update: {
          aliases?: Json
          branch?: string
          build_session_id?: string | null
          classification?: Json
          commit_sha?: string | null
          created_at?: string
          dependencies?: Json
          environment?: Json
          health?: Json
          id?: string
          imports?: Json
          ingestion?: Json | null
          preview_diagnostics?: Json
          project_id?: string
          readiness?: Json | null
          repository_id?: string | null
          stages?: Json | null
          unsupported?: Json
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repo_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vpip_repo_reports_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "vpip_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repo_snapshots: {
        Row: {
          build_session_id: string | null
          created_at: string
          files: Json
          id: string
          is_zero: boolean
          label: string
          metadata: Json
          project_id: string
          repository_id: string | null
          tree: Json
        }
        Insert: {
          build_session_id?: string | null
          created_at: string
          files?: Json
          id: string
          is_zero?: boolean
          label: string
          metadata?: Json
          project_id: string
          repository_id?: string | null
          tree?: Json
        }
        Update: {
          build_session_id?: string | null
          created_at?: string
          files?: Json
          id?: string
          is_zero?: boolean
          label?: string
          metadata?: Json
          project_id?: string
          repository_id?: string | null
          tree?: Json
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repo_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_repositories: {
        Row: {
          classification: Json | null
          created_at: string
          current_branch: string
          default_branch: string
          description: string
          full_name: string
          html_url: string
          id: string
          last_commit_at: string | null
          last_commit_message: string | null
          last_commit_sha: string | null
          last_push_at: string | null
          name: string
          owner: string
          project_id: string
          provider: string
          status: string
          status_message: string | null
          token: string
          updated_at: string
          validated_at: string | null
          visibility: string
        }
        Insert: {
          classification?: Json | null
          created_at: string
          current_branch?: string
          default_branch?: string
          description?: string
          full_name?: string
          html_url?: string
          id: string
          last_commit_at?: string | null
          last_commit_message?: string | null
          last_commit_sha?: string | null
          last_push_at?: string | null
          name?: string
          owner?: string
          project_id: string
          provider?: string
          status?: string
          status_message?: string | null
          token?: string
          updated_at: string
          validated_at?: string | null
          visibility?: string
        }
        Update: {
          classification?: Json | null
          created_at?: string
          current_branch?: string
          default_branch?: string
          description?: string
          full_name?: string
          html_url?: string
          id?: string
          last_commit_at?: string | null
          last_commit_message?: string | null
          last_commit_sha?: string | null
          last_push_at?: string | null
          name?: string
          owner?: string
          project_id?: string
          provider?: string
          status?: string
          status_message?: string | null
          token?: string
          updated_at?: string
          validated_at?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_repositories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_runtime_audit: {
        Row: {
          action: string
          build_id: string | null
          created_at: string
          detail: Json
          duration_ms: number | null
          e2b_sandbox_id: string | null
          error: string | null
          id: string
          project_id: string
          sandbox_row_id: string | null
          status: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          build_id?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          e2b_sandbox_id?: string | null
          error?: string | null
          id?: string
          project_id: string
          sandbox_row_id?: string | null
          status: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          build_id?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          e2b_sandbox_id?: string | null
          error?: string | null
          id?: string
          project_id?: string
          sandbox_row_id?: string | null
          status?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vpip_runtime_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_runtime_providers: {
        Row: {
          enabled: boolean
          id: string
          is_active: boolean
          last_test_at: string | null
          last_test_message: string | null
          last_test_ok: boolean | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      vpip_runtime_sandboxes: {
        Row: {
          build_id: string
          created_at: string
          destroyed_at: string | null
          dev_command: string | null
          e2b_sandbox_id: string | null
          env_report: Json
          id: string
          last_active_at: string
          last_error: string | null
          last_sync_at: string | null
          node_source: string | null
          node_version: string | null
          owner_id: string
          package_manager: string | null
          phase: string
          phase_events: Json
          phase_events_seen: number
          port: number
          preview_slug: string | null
          project_id: string
          running_since: string | null
          runtime_seconds: number
          status: string
          sync_errors: Json
          sync_stats: Json
          sync_status: string
          updated_at: string
        }
        Insert: {
          build_id: string
          created_at?: string
          destroyed_at?: string | null
          dev_command?: string | null
          e2b_sandbox_id?: string | null
          env_report?: Json
          id: string
          last_active_at?: string
          last_error?: string | null
          last_sync_at?: string | null
          node_source?: string | null
          node_version?: string | null
          owner_id: string
          package_manager?: string | null
          phase?: string
          phase_events?: Json
          phase_events_seen?: number
          port?: number
          preview_slug?: string | null
          project_id: string
          running_since?: string | null
          runtime_seconds?: number
          status?: string
          sync_errors?: Json
          sync_stats?: Json
          sync_status?: string
          updated_at?: string
        }
        Update: {
          build_id?: string
          created_at?: string
          destroyed_at?: string | null
          dev_command?: string | null
          e2b_sandbox_id?: string | null
          env_report?: Json
          id?: string
          last_active_at?: string
          last_error?: string | null
          last_sync_at?: string | null
          node_source?: string | null
          node_version?: string | null
          owner_id?: string
          package_manager?: string | null
          phase?: string
          phase_events?: Json
          phase_events_seen?: number
          port?: number
          preview_slug?: string | null
          project_id?: string
          running_since?: string | null
          runtime_seconds?: number
          status?: string
          sync_errors?: Json
          sync_stats?: Json
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_runtime_sandboxes_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "vpip_build_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vpip_runtime_sandboxes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "vpip_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vpip_runtime_secrets: {
        Row: {
          domain: string | null
          envd_token: string | null
          sandbox_row_id: string
          traffic_token: string | null
          updated_at: string
        }
        Insert: {
          domain?: string | null
          envd_token?: string | null
          sandbox_row_id: string
          traffic_token?: string | null
          updated_at?: string
        }
        Update: {
          domain?: string | null
          envd_token?: string | null
          sandbox_row_id?: string
          traffic_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vpip_runtime_secrets_sandbox_row_id_fkey"
            columns: ["sandbox_row_id"]
            isOneToOne: true
            referencedRelation: "vpip_runtime_sandboxes"
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
      vpip_validation_runs: {
        Row: {
          created_at: string
          id: string
          metrics: Json
          results: Json
          targets: Json
        }
        Insert: {
          created_at: string
          id: string
          metrics?: Json
          results?: Json
          targets?: Json
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json
          results?: Json
          targets?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
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

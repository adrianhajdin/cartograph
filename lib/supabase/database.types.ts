// Generated from the live schema by Supabase's type generator. Regenerate after
// every migration rather than editing by hand.

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
      analyses: {
        Row: {
          commit_sha: string | null
          coverage: Json | null
          created_at: string
          detected_projects: Json | null
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          project_id: string
          stage: Database["public"]["Enums"]["analysis_stage"] | null
          stage_message: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_status"]
        }
        Insert: {
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          detected_projects?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          project_id: string
          stage?: Database["public"]["Enums"]["analysis_stage"] | null
          stage_message?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Update: {
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          detected_projects?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          stage?: Database["public"]["Enums"]["analysis_stage"] | null
          stage_message?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Relationships: [
          {
            foreignKeyName: "analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_organization_id_fkey"
            columns: ["project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          id: string
          kind: string
          line: number
          organization_id: string
          source_file_id: string
          specifier: string
          target_file_id: string
          type_only: boolean
        }
        Insert: {
          analysis_id: string
          id?: string
          kind: string
          line: number
          organization_id: string
          source_file_id: string
          specifier: string
          target_file_id: string
          type_only: boolean
        }
        Update: {
          analysis_id?: string
          id?: string
          kind?: string
          line?: number
          organization_id?: string
          source_file_id?: string
          specifier?: string
          target_file_id?: string
          type_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "edges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_organization_id_fkey"
            columns: ["source_file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "edges_target_file_id_organization_id_fkey"
            columns: ["target_file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      explanations: {
        Row: {
          body: string
          created_at: string
          file_id: string
          id: string
          model: string
          organization_id: string
        }
        Insert: {
          body: string
          created_at?: string
          file_id: string
          id?: string
          model: string
          organization_id: string
        }
        Update: {
          body?: string
          created_at?: string
          file_id?: string
          id?: string
          model?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_file_id_organization_id_fkey"
            columns: ["file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          file_id: string
          id: string
          organization_id: string
          role: string
          source: string
        }
        Insert: {
          file_id: string
          id?: string
          organization_id: string
          role: string
          source: string
        }
        Update: {
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_file_id_organization_id_fkey"
            columns: ["file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "file_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          bytes: number | null
          fan_in: number | null
          fan_out: number | null
          hash: string | null
          id: string
          lines: number | null
          module: string | null
          organization_id: string
          path: string
          reached_by: string | null
          skip_detail: string | null
          skip_reason: string | null
        }
        Insert: {
          analysis_id: string
          bytes?: number | null
          fan_in?: number | null
          fan_out?: number | null
          hash?: string | null
          id?: string
          lines?: number | null
          module?: string | null
          organization_id: string
          path: string
          reached_by?: string | null
          skip_detail?: string | null
          skip_reason?: string | null
        }
        Update: {
          analysis_id?: string
          bytes?: number | null
          fan_in?: number | null
          fan_out?: number | null
          hash?: string | null
          id?: string
          lines?: number | null
          module?: string | null
          organization_id?: string
          path?: string
          reached_by?: string | null
          skip_detail?: string | null
          skip_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          repo_name: string
          repo_owner: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          repo_name: string
          repo_owner: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          method: string
          organization_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          method: string
          organization_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          method?: string
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "routes_file_id_organization_id_fkey"
            columns: ["file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      insert_edges: {
        Args: { p_analysis_id: string; p_edges: Json }
        Returns: number
      }
    }
    Enums: {
      analysis_stage: "fetch" | "select" | "parse" | "store"
      analysis_status: "queued" | "running" | "complete" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T]

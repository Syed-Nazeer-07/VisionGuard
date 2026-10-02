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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
      }
      alerts: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          type?: string
        }
      }
      analysis_runs: {
        Row: {
          camera_id: string
          ended_at: string | null
          id: string
          metrics: Json | null
          started_at: string
          status: string
        }
        Insert: {
          camera_id: string
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          camera_id?: string
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: string
        }
      }
      cameras: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          name: string
          status: string
          stream_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name: string
          status?: string
          stream_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name?: string
          status?: string
          stream_url?: string | null
        }
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          id: string
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
        }
      }
      saved_reports: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          title: string
        }
        Insert: {
          config: Json
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
        }
      }
      scene_profiles: {
        Row: {
          calibration_data: Json | null
          camera_id: string
          created_at: string
          id: string
          roi_polygon: Json | null
        }
        Insert: {
          calibration_data?: Json | null
          camera_id: string
          created_at?: string
          id?: string
          roi_polygon?: Json | null
        }
        Update: {
          calibration_data?: Json | null
          camera_id?: string
          created_at?: string
          id?: string
          roi_polygon?: Json | null
        }
      }
      traffic_stats: {
        Row: {
          avg_speed: number | null
          camera_id: string
          id: string
          timestamp: string
          vehicle_count: number
        }
        Insert: {
          avg_speed?: number | null
          camera_id: string
          id?: string
          timestamp?: string
          vehicle_count?: number
        }
        Update: {
          avg_speed?: number | null
          camera_id?: string
          id?: string
          timestamp?: string
          vehicle_count?: number
        }
      }
      violations: {
        Row: {
          analysis_run_id: string | null
          camera_id: string
          id: string
          severity: string
          snapshot_url: string | null
          status: string
          timestamp: string
          type: string
          metadata: Json | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
        }
        Insert: {
          analysis_run_id?: string | null
          camera_id: string
          id?: string
          severity: string
          snapshot_url?: string | null
          status?: string
          timestamp?: string
          type: string
          metadata?: Json | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
        }
        Update: {
          analysis_run_id?: string | null
          camera_id?: string
          id?: string
          severity?: string
          snapshot_url?: string | null
          status?: string
          timestamp?: string
          type?: string
          metadata?: Json | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
        }
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

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type VideoProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'paused'

export type AnalysisLogCategory =
  | 'SYSTEM'
  | 'UPLOAD'
  | 'PROCESSING'
  | 'MODEL'
  | 'DETECTION'
  | 'TRACKING'
  | 'INCIDENT'
  | 'EVIDENCE'
  | 'PERSISTENCE'
  | 'ERROR'

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
          severity: string
          camera_id: string | null
          violation_id: string | null
          status: string
          acknowledged_at: string | null
          resolved_at: string | null
          acknowledged_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          type: string
          severity?: string
          camera_id?: string | null
          violation_id?: string | null
          status?: string
          acknowledged_at?: string | null
          resolved_at?: string | null
          acknowledged_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          type?: string
          severity?: string
          camera_id?: string | null
          violation_id?: string | null
          status?: string
          acknowledged_at?: string | null
          resolved_at?: string | null
          acknowledged_by?: string | null
        }
      }
      analysis_runs: {
        Row: {
          camera_id: string | null
          video_id: string | null
          created_by: string | null
          ended_at: string | null
          id: string
          metrics: Json | null
          started_at: string
          status: string
          fps: number | null
          latency: number | null
          queue_depth: number | null
          frames_processed: number | null
          detections_generated: number | null
          incidents_created: number | null
          incidents_suppressed: number | null
        }
        Insert: {
          camera_id?: string | null
          video_id?: string | null
          created_by?: string | null
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: string
          fps?: number
          latency?: number
          queue_depth?: number
          frames_processed?: number
          detections_generated?: number
          incidents_created?: number
          incidents_suppressed?: number
        }
        Update: {
          camera_id?: string | null
          video_id?: string | null
          created_by?: string | null
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: string
          fps?: number
          latency?: number
          queue_depth?: number
          frames_processed?: number
          detections_generated?: number
          incidents_created?: number
          incidents_suppressed?: number
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
          source_type: string
          enabled: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name: string
          status?: string
          stream_url?: string | null
          source_type?: string
          enabled?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name?: string
          status?: string
          stream_url?: string | null
          source_type?: string
          enabled?: boolean
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
      system_settings: {
        Row: {
          key: string
          value: Json
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          key?: string
          value?: Json
          updated_by?: string | null
          updated_at?: string | null
        }
      }
      video_assets: {
        Row: {
          id: string
          filename: string
          storage_path: string
          file_size: number | null
          duration: number | null
          uploaded_by: string | null
          uploaded_at: string | null
          processing_status: VideoProcessingStatus
          metadata: Json | null
          display_number: number | null
          storage_provider: 'supabase' | 'b2'
        }
        Insert: {
          id?: string
          filename: string
          storage_path?: string
          file_size?: number | null
          duration?: number | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          processing_status?: VideoProcessingStatus
          metadata?: Json | null
          display_number?: number | null
          storage_provider?: 'supabase' | 'b2'
        }
        Update: {
          id?: string
          filename?: string
          storage_path?: string
          file_size?: number | null
          duration?: number | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          processing_status?: VideoProcessingStatus
          metadata?: Json | null
          display_number?: number | null
          storage_provider?: 'supabase' | 'b2'
        }
      }
      analysis_logs: {
        Row: {
          id: string
          video_id: string | null
          camera_id: string | null
          analysis_run_id: string | null
          timestamp: string
          category: AnalysisLogCategory
          message: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          video_id?: string | null
          camera_id?: string | null
          analysis_run_id?: string | null
          timestamp?: string
          category: AnalysisLogCategory
          message: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          video_id?: string | null
          camera_id?: string | null
          analysis_run_id?: string | null
          timestamp?: string
          category?: AnalysisLogCategory
          message?: string
          metadata?: Json | null
          created_at?: string
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

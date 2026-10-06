import { supabase } from '../lib/supabase'
import type { Database } from '../types/supabase'

export type Camera = Database['public']['Tables']['cameras']['Row']
export type Violation = Database['public']['Tables']['violations']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type AnalysisRun = Database['public']['Tables']['analysis_runs']['Row']
export type TrafficStat = Database['public']['Tables']['traffic_stats']['Row']
export type Alert = Database['public']['Tables']['alerts']['Row']
export type ActivityLog = Database['public']['Tables']['activity_logs']['Row']
export type SceneProfile = Database['public']['Tables']['scene_profiles']['Row']

export const db = {
  cameras: {
    async list() {
      const { data, error } = await (supabase as any).from('cameras').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    async get(id: string) {
      const { data, error } = await (supabase as any).from('cameras').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    async create(camera: Partial<Database['public']['Tables']['cameras']['Insert']>) {
      const { data, error } = await (supabase as any).from('cameras').insert(camera).select().single()
      if (error) throw error
      return data
    },
    async update(id: string, camera: Partial<Database['public']['Tables']['cameras']['Update']>) {
      const { data, error } = await (supabase as any).from('cameras').update(camera).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    async delete(id: string) {
      const { error } = await (supabase as any).from('cameras').delete().eq('id', id)
      if (error) throw error
      return true
    }
  },
  violations: {
    async list(limit = 50) {
      const { data, error } = await (supabase as any).from('violations').select('*, cameras(name)').order('timestamp', { ascending: false }).limit(limit)
      if (error) throw error
      return data
    },
    async create(violation: Database['public']['Tables']['violations']['Insert']) {
      const { data, error } = await (supabase as any).from('violations').insert(violation).select().single()
      if (error) throw error
      return data
    },
    async createBatch(violations: Database['public']['Tables']['violations']['Insert'][]) {
      if (violations.length === 0) return []
      const { data, error } = await (supabase as any).from('violations').insert(violations).select()
      if (error) throw error
      return data
    },
    async update(id: string, updates: Database['public']['Tables']['violations']['Update']) {
      const { data, error } = await (supabase as any).from('violations').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    async reviewViolation(id: string, status: 'approved' | 'rejected', notes?: string) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Unauthorized')
      
      const { data, error } = await (supabase as any).from('violations')
        .update({ 
          status, 
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          review_notes: notes || null
        })
        .eq('id', id)
        .eq('status', 'pending_review') // Prevent re-reviewing
        .select().single()
        
      if (error) throw error
      return data
    },
    async approveViolation(id: string, notes?: string) {
      return this.reviewViolation(id, 'approved', notes)
    },
    async rejectViolation(id: string, notes?: string) {
      return this.reviewViolation(id, 'rejected', notes)
    }
  },
  stats: {
    async record(stat: Database['public']['Tables']['traffic_stats']['Insert']) {
      const { data, error } = await (supabase as any).from('traffic_stats').insert(stat).select().single()
      if (error) throw error
      return data
    },
    async list(cameraId: string, limit = 100) {
      const { data, error } = await (supabase as any).from('traffic_stats').select('*').eq('camera_id', cameraId).order('timestamp', { ascending: false }).limit(limit)
      if (error) throw error
      return data
    }
  },
  alerts: {
    async create(alert: Database['public']['Tables']['alerts']['Insert']) {
      // Prevent duplicate active alerts
      const { data: existing } = await (supabase as any)
        .from('alerts')
        .select('id')
        .eq('type', alert.type)
        .eq('camera_id', alert.camera_id)
        .eq('status', 'active')
        .maybeSingle()
        
      if (existing) {
        return existing
      }

      const { data, error } = await (supabase as any).from('alerts').insert(alert).select().single()
      if (error) throw error
      return data
    },
    async list() {
      const { data, error } = await (supabase as any).from('alerts').select('*, cameras(name)').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    async update(id: string, updates: Database['public']['Tables']['alerts']['Update']) {
      // Validate transitions
      if (updates.status) {
        const { data: current } = await (supabase as any).from('alerts').select('status').eq('id', id).single()
        if (current) {
          if (current.status === 'resolved') {
            throw new Error('Cannot update a resolved alert')
          }
          if (current.status === 'acknowledged' && updates.status === 'active') {
            throw new Error('Cannot revert acknowledged alert to active')
          }
        }
      }

      const { data, error } = await (supabase as any).from('alerts').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    async getUnread() {
      const { data, error } = await (supabase as any).from('alerts').select('*').eq('is_read', false).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    async markAsRead(id: string) {
      const { error } = await (supabase as any).from('alerts').update({ is_read: true }).eq('id', id)
      if (error) throw error
    }
  },
  scene_profiles: {
    async upsert(profile: Database['public']['Tables']['scene_profiles']['Insert']) {
      const { data, error } = await (supabase as any).from('scene_profiles').upsert(profile).select().single()
      if (error) throw error
      return data
    },
    async get(cameraId: string) {
      const { data, error } = await (supabase as any).from('scene_profiles').select('*').eq('camera_id', cameraId).maybeSingle()
      if (error) throw error
      return data
    }
  },
  analytics: {
    async getDashboard(cameraId?: string, startDate?: string, endDate?: string, violationType?: string) {
      const args: any = {};
      if (cameraId) args.p_camera_id = cameraId;
      if (startDate) args.p_start_date = startDate;
      if (endDate) args.p_end_date = endDate;
      if (violationType) args.p_violation_type = violationType;
      
      const { data, error } = await supabase.rpc('get_analytics_summary', args);
      if (error) throw error;
      return data;
    }
  },
  reports: {
    async getViolations(filters: { startDate?: string, endDate?: string, cameraId?: string, violationType?: string, status?: string }) {
      let query = supabase.from('violations').select('*, cameras(name)').order('timestamp', { ascending: false });
      
      if (filters.startDate) query = query.gte('timestamp', filters.startDate);
      if (filters.endDate) query = query.lte('timestamp', filters.endDate);
      if (filters.cameraId) query = query.eq('camera_id', filters.cameraId);
      if (filters.violationType) query = query.eq('type', filters.violationType);
      if (filters.status) query = query.eq('status', filters.status);
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    async getAlerts(filters: { startDate?: string, endDate?: string, cameraId?: string, status?: string }) {
      let query = supabase.from('alerts').select('*, cameras(name)').order('created_at', { ascending: false });
      
      if (filters.startDate) query = query.gte('created_at', filters.startDate);
      if (filters.endDate) query = query.lte('created_at', filters.endDate);
      if (filters.cameraId) query = query.eq('camera_id', filters.cameraId);
      if (filters.status) query = query.eq('status', filters.status);
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  },
  settings: {
    async list() {
      const { data, error } = await (supabase as any).from('system_settings').select('*');
      if (error) throw error;
      
      const config: Record<string, any> = {};
      for (const row of (data as any[]) || []) {
        config[row.key] = row.value;
      }
      return config;
    },
    async update(updates: Record<string, any>) {
      const { data: user } = await supabase.auth.getUser();
      const userId = user?.user?.id;
      
      const payload = Object.entries(updates).map(([key, value]) => ({
        key,
        value,
        updated_by: userId || null,
        updated_at: new Date().toISOString()
      })) as any[];
      
      const { error } = await (supabase as any).from('system_settings').upsert(payload, { onConflict: 'key' });
      if (error) throw error;
    }
  },
  analysisRuns: {
    async create(run: Database['public']['Tables']['analysis_runs']['Insert']) {
      const { data, error } = await (supabase as any).from('analysis_runs').insert(run).select().single()
      if (error) throw error
      return data
    },
    async update(id: string, updates: Database['public']['Tables']['analysis_runs']['Update']) {
      const { data, error } = await (supabase as any).from('analysis_runs').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    }
  },
  auditLogs: {
    async create(log: any) {
      const { data, error } = await (supabase as any).from('audit_logs').insert(log).select().single()
      if (error) throw error
      return data
    }
  },
  evidence: {
    async listByCase(caseId: string) {
      const { data, error } = await (supabase as any).from('evidence').select('*').eq('case_id', caseId).order('capture_timestamp', { ascending: false })
      if (error) throw error
      return data
    },
    async listByIncident(incidentId: string) {
      const { data, error } = await (supabase as any).from('evidence').select('*').eq('incident_id', incidentId).order('capture_timestamp', { ascending: false })
      if (error) throw error
      return data
    },
    async update(id: string, updates: any) {
      const { data, error } = await (supabase as any).from('evidence').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    }
  },
  videoAssets: {
    async get(id: string) {
      const { data, error } = await (supabase as any).from('video_assets').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    async list() {
      const { data, error } = await (supabase as any).from('video_assets').select('*').order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
    async update(id: string, updates: any) {
      const { data, error } = await (supabase as any).from('video_assets').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    }
  },
  analysisLogs: {
    async list(filters: { videoId?: string; cameraId?: string }) {
      let query = (supabase as any).from('analysis_logs').select('*')
      if (filters.videoId) query = query.eq('video_id', filters.videoId)
      if (filters.cameraId) query = query.eq('camera_id', filters.cameraId)
      const { data, error } = await query.order('timestamp', { ascending: true })
      if (error) throw error
      return data
    },
    async create(log: any) {
      const { data, error } = await (supabase as any).from('analysis_logs').insert(log).select().single()
      if (error) throw error
      return data
    }
  }
}

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
    }
  }
}

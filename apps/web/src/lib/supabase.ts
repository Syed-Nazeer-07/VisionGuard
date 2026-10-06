import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isMock = !supabaseUrl || supabaseUrl.includes('placeholder')

if (isMock) {
  console.info('[VisionGuard] Running in preview/demo mode with in-memory store.')
}

// Initial mock data seed
const now = new Date()
const seedCameras = [
  {
    id: 'cam-01',
    name: 'Downtown Intersection — North Quad',
    location: '4th Ave & Main St, Sector 1',
    status: 'online',
    stream_url: '/car-detection.mp4',
    source_url: '/car-detection.mp4',
    source_type: 'video',
    health_score: 98,
    is_deleted: false,
    created_at: new Date(now.getTime() - 86400000 * 7).toISOString(),
    last_seen: now.toISOString()
  },
  {
    id: 'cam-02',
    name: 'Interstate 95 Express Lane — MP 14',
    location: 'I-95 Northbound Corridor',
    status: 'online',
    stream_url: '/car-detection.mp4',
    source_url: '/car-detection.mp4',
    source_type: 'video',
    health_score: 95,
    is_deleted: false,
    created_at: new Date(now.getTime() - 86400000 * 5).toISOString(),
    last_seen: now.toISOString()
  },
  {
    id: 'cam-03',
    name: 'Central Boulevard — Pedestrian Crossing',
    location: 'Central Blvd & 7th St',
    status: 'online',
    stream_url: '/car-detection.mp4',
    source_url: '/car-detection.mp4',
    source_type: 'video',
    health_score: 92,
    is_deleted: false,
    created_at: new Date(now.getTime() - 86400000 * 2).toISOString(),
    last_seen: now.toISOString()
  }
]

const seedIncidents = [
  {
    id: 'inc-01',
    incident_type: 'Speeding',
    severity: 'High',
    status: 'Active',
    location: 'I-95 Northbound Corridor',
    description: 'Vehicle detected traveling at 88 mph in a 65 mph speed zone',
    camera_id: 'cam-02',
    cameras: { name: 'Interstate 95 Express Lane — MP 14' },
    created_at: new Date(now.getTime() - 3600000 * 2).toISOString(),
    assigned_to: 'demo-admin-id'
  },
  {
    id: 'inc-02',
    incident_type: 'Red Light Violation',
    severity: 'Critical',
    status: 'Active',
    location: '4th Ave & Main St, Sector 1',
    description: 'Vehicle crossed stop line 2.4s after red signal initiation',
    camera_id: 'cam-01',
    cameras: { name: 'Downtown Intersection — North Quad' },
    created_at: new Date(now.getTime() - 3600000 * 4).toISOString(),
    assigned_to: 'demo-admin-id'
  },
  {
    id: 'inc-03',
    incident_type: 'Illegal Lane Change',
    severity: 'Moderate',
    status: 'Under Review',
    location: 'Central Blvd & 7th St',
    description: 'Crossed double white solid barrier lines during peak traffic flow',
    camera_id: 'cam-03',
    cameras: { name: 'Central Boulevard — Pedestrian Crossing' },
    created_at: new Date(now.getTime() - 3600000 * 8).toISOString(),
    assigned_to: 'demo-admin-id'
  }
]

const seedCases = [
  {
    id: 'case-01',
    case_number: 'CASE-2026-0042',
    status: 'New',
    priority: 'High',
    incident_id: 'inc-02',
    incident: { severity: 'Critical' },
    notes: 'Review red light camera timing and trigger threshold',
    created_at: new Date(now.getTime() - 3600000 * 3).toISOString()
  },
  {
    id: 'case-02',
    case_number: 'CASE-2026-0041',
    status: 'Investigating',
    priority: 'Moderate',
    incident_id: 'inc-01',
    incident: { severity: 'High' },
    notes: 'Secondary optical speed verification in progress',
    created_at: new Date(now.getTime() - 3600000 * 12).toISOString()
  }
]

const seedAlerts = [
  {
    id: 'alt-01',
    title: 'Speed Threshold Exceeded',
    severity: 'warning',
    status: 'active',
    type: 'Speed Violation',
    message: 'High speed cluster (>85 mph) detected on I-95 Northbound Corridor',
    is_read: false,
    created_at: new Date(now.getTime() - 3600000 * 2).toISOString()
  },
  {
    id: 'alt-02',
    title: 'Congestion Surge Alert',
    severity: 'info',
    status: 'active',
    type: 'Traffic Density',
    message: 'Vehicle queue density exceeds 85% at Downtown Intersection',
    is_read: true,
    created_at: new Date(now.getTime() - 3600000 * 6).toISOString()
  }
]

const seedAuditLogs = [
  {
    id: 'log-01',
    action: 'CAMERA_PROVISIONED',
    details: 'Camera Downtown Intersection — North Quad provisioned with calibrated ROI',
    timestamp: new Date(now.getTime() - 86400000 * 2).toISOString()
  },
  {
    id: 'log-02',
    action: 'SPEED_RULE_UPDATED',
    details: 'Automated overspeed trigger set to +15 mph above roadway limit',
    timestamp: new Date(now.getTime() - 86400000 * 1).toISOString()
  }
]

const seedViolations = [
  {
    id: 'viol-01',
    camera_id: 'cam-01',
    cameras: { name: 'Downtown Intersection — North Quad' },
    type: 'Speeding',
    severity: 'high',
    status: 'pending_review',
    timestamp: new Date(now.getTime() - 3600000 * 3).toISOString(),
    snapshot_url: '/platform_preview.png',
    speed: 82,
    speed_limit: 65
  },
  {
    id: 'viol-02',
    camera_id: 'cam-02',
    cameras: { name: 'Interstate 95 Express Lane — MP 14' },
    type: 'Lane Violation',
    severity: 'medium',
    status: 'pending_review',
    timestamp: new Date(now.getTime() - 3600000 * 5).toISOString(),
    snapshot_url: '/platform_preview.png'
  }
]

const seedVideos = [
  {
    id: 'vid-01',
    filename: 'car-detection.mp4',
    storage_path: 'car-detection.mp4',
    file_size: 2811553,
    duration: 15,
    processing_status: 'completed',
    uploaded_at: new Date(now.getTime() - 3600000).toISOString(),
    metadata: {}
  }
]

const seedTrackedObjects = [
  {
    id: 'track-seed-1',
    video_id: 'vid-01',
    track_id: 1,
    object_type: 'car',
    confidence: 0.94,
    first_seen_timestamp: 0.5,
    last_seen_timestamp: 14.5,
    frame_count: 420,
    metadata: {
      trajectory: [
        { time: 0.5, bbox: [220, 180, 160, 110], speed: 64 },
        { time: 2.0, bbox: [240, 195, 175, 120], speed: 66 },
        { time: 4.0, bbox: [270, 220, 200, 140], speed: 68 },
        { time: 6.0, bbox: [310, 250, 230, 160], speed: 71 },
        { time: 8.0, bbox: [360, 280, 260, 180], speed: 73 },
        { time: 10.0, bbox: [410, 310, 290, 200], speed: 71 },
        { time: 12.0, bbox: [470, 350, 330, 230], speed: 69 },
        { time: 14.0, bbox: [540, 400, 380, 260], speed: 67 }
      ]
    },
    created_at: now.toISOString()
  },
  {
    id: 'track-seed-2',
    video_id: 'vid-01',
    track_id: 2,
    object_type: 'truck',
    confidence: 0.89,
    first_seen_timestamp: 1.2,
    last_seen_timestamp: 12.0,
    frame_count: 320,
    metadata: {
      trajectory: [
        { time: 1.2, bbox: [480, 160, 180, 140], speed: 52 },
        { time: 3.5, bbox: [510, 185, 205, 160], speed: 53 },
        { time: 6.0, bbox: [550, 215, 235, 180], speed: 55 },
        { time: 8.5, bbox: [600, 250, 270, 210], speed: 54 },
        { time: 11.5, bbox: [670, 295, 320, 250], speed: 52 }
      ]
    },
    created_at: now.toISOString()
  }
]

const seedEvidence = [
  {
    id: 'ev-01',
    incident_id: 'inc-01',
    video_id: 'vid-01',
    camera_id: 'cam-02',
    file_type: 'snapshot',
    file_url: '/platform_preview.png',
    file_path: 'evidence/snapshot.jpg',
    status: 'ready',
    capture_timestamp: now.toISOString()
  }
]

// In-memory mock store with localStorage hydration
const STORAGE_KEY = 'visionguard_mock_store_v1'
function loadSavedStore(): Record<string, any[]> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

const saved = loadSavedStore()

const mockStore: Record<string, any[]> = saved || {
  cameras: [...seedCameras],
  incidents: [...seedIncidents],
  cases: [...seedCases],
  alerts: [...seedAlerts],
  audit_logs: [...seedAuditLogs],
  violations: [...seedViolations],
  videos: [...seedVideos],
  video_assets: [...seedVideos],
  tracked_objects: [...seedTrackedObjects],
  evidence: [...seedEvidence],
  analysis_runs: [],
  analysis_logs: [],
  traffic_stats: [],
  profiles: [
    {
      id: 'demo-admin-id',
      email: 'admin@transport.gov',
      role: 'Admin',
      name: 'System Administrator',
      organization: 'Department of Transportation',
      status: 'Active',
      created_at: now.toISOString()
    }
  ],
  user_settings: [
    {
      id: 'demo-admin-id',
      theme: 'light',
      dark_mode: false,
      density: 'comfortable',
      email_alerts: true,
      system_alerts: true,
      incident_alerts: true,
      report_notifications: true
    }
  ]
}

// Persist mockStore updates
function persistStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockStore))
  } catch {}
}

const uploadedFilesMap = new Map<string, string>()
uploadedFilesMap.set('car-detection.mp4', '/car-detection.mp4')

function createMockQueryBuilder(tableName: string) {
  let isSingle = false
  let isMaybeSingle = false
  let filters: Array<(item: any) => boolean> = []
  let sortFn: ((a: any, b: any) => number) | null = null
  let limitCount: number | null = null

  const getTableData = () => {
    if (!mockStore[tableName]) {
      mockStore[tableName] = []
    }
    return mockStore[tableName]
  }

  const execute = () => {
    let list = [...getTableData()]
    for (const f of filters) {
      list = list.filter(f)
    }
    if (sortFn) {
      list.sort(sortFn)
    }
    if (limitCount !== null) {
      list = list.slice(0, limitCount)
    }

    if (isSingle) {
      const item = list[0] ?? null
      return { data: item, error: item ? null : { code: 'PGRST116', message: 'Row not found' }, count: list.length }
    }
    if (isMaybeSingle) {
      const item = list[0] ?? null
      return { data: item, error: null, count: list.length }
    }
    return { data: list, error: null, count: list.length }
  }

  const builder: any = {
    select(_columns?: string, _options?: any) {
      return builder
    },
    insert(rows: any | any[]) {
      const items = Array.isArray(rows) ? rows : [rows]
      const inserted = items.map(item => ({
        id: item.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        created_at: item.created_at || new Date().toISOString(),
        ...item
      }))
      getTableData().unshift(...inserted)
      persistStore()
      return {
        ...builder,
        then: (onfulfilled?: any) => Promise.resolve({ data: Array.isArray(rows) ? inserted : inserted[0], error: null }).then(onfulfilled)
      }
    },
    upsert(rows: any | any[], _options?: any) {
      const items = Array.isArray(rows) ? rows : [rows]
      const currentList = getTableData()
      const result: any[] = []

      for (const item of items) {
        const existingIdx = currentList.findIndex(x => 
          (item.id && x.id === item.id) || 
          (item.video_id && item.track_id && x.video_id === item.video_id && x.track_id === item.track_id) ||
          (item.camera_id && item.track_id && x.camera_id === item.camera_id && x.track_id === item.track_id) ||
          (item.key && x.key === item.key)
        )
        if (existingIdx >= 0) {
          currentList[existingIdx] = { ...currentList[existingIdx], ...item, updated_at: new Date().toISOString() }
          result.push(currentList[existingIdx])
        } else {
          const inserted = {
            id: item.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            created_at: item.created_at || new Date().toISOString(),
            ...item
          }
          currentList.unshift(inserted)
          result.push(inserted)
        }
      }
      persistStore()
      return {
        ...builder,
        then: (onfulfilled?: any) => Promise.resolve({ data: Array.isArray(rows) ? result : result[0], error: null }).then(onfulfilled)
      }
    },
    update(updates: any) {
      const currentList = getTableData()
      let updatedRows: any[] = []
      for (let i = 0; i < currentList.length; i++) {
        let matches = true
        for (const f of filters) {
          if (!f(currentList[i])) {
            matches = false
            break
          }
        }
        if (matches) {
          currentList[i] = { ...currentList[i], ...updates }
          updatedRows.push(currentList[i])
        }
      }
      persistStore()
      return {
        ...builder,
        then: (onfulfilled?: any) => Promise.resolve({ data: isSingle ? updatedRows[0] || null : updatedRows, error: null }).then(onfulfilled)
      }
    },
    delete() {
      const currentList = getTableData()
      mockStore[tableName] = currentList.filter(item => {
        for (const f of filters) {
          if (!f(item)) return true
        }
        return false
      })
      persistStore()
      return {
        ...builder,
        then: (onfulfilled?: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled)
      }
    },
    eq(column: string, value: any) {
      filters.push(item => item[column] === value)
      return builder
    },
    neq(column: string, value: any) {
      filters.push(item => item[column] !== value)
      return builder
    },
    gte(column: string, value: any) {
      filters.push(item => item[column] >= value)
      return builder
    },
    lte(column: string, value: any) {
      filters.push(item => item[column] <= value)
      return builder
    },
    gt(column: string, value: any) {
      filters.push(item => item[column] > value)
      return builder
    },
    lt(column: string, value: any) {
      filters.push(item => item[column] < value)
      return builder
    },
    in(column: string, values: any[]) {
      filters.push(item => values && values.includes(item[column]))
      return builder
    },
    order(column: string, options?: { ascending?: boolean }) {
      const asc = options?.ascending ?? true
      sortFn = (a, b) => {
        if (a[column] < b[column]) return asc ? -1 : 1
        if (a[column] > b[column]) return asc ? 1 : -1
        return 0
      }
      return builder
    },
    limit(n: number) {
      limitCount = n
      return builder
    },
    single() {
      isSingle = true
      return builder
    },
    maybeSingle() {
      isMaybeSingle = true
      return builder
    },
    then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
      return Promise.resolve(execute()).then(onfulfilled, onrejected)
    },
    catch(onrejected?: (reason: any) => any) {
      return Promise.resolve(execute()).catch(onrejected)
    }
  }

  return builder
}

const authListeners = new Set<(event: string, session: any) => void>()

function getStoredDemoSession() {
  try {
    const raw = localStorage.getItem('visionguard_demo_session')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed.session || null
    }
    // Auto-seed demo administrator session for preview mode unless explicitly logged out
    if (sessionStorage.getItem('visionguard_logged_out') !== 'true') {
      const demoUser = {
        id: 'demo-admin-id',
        email: 'admin@transport.gov',
        user_metadata: { full_name: 'System Administrator' },
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString()
      }
      const demoSession = {
        access_token: 'demo-token',
        token_type: 'bearer',
        user: demoUser
      }
      const demoProfile = {
        id: 'demo-admin-id',
        email: 'admin@transport.gov',
        role: 'Admin',
        status: 'Active',
        name: 'System Administrator',
        organization: 'Department of Transportation'
      }
      localStorage.setItem('visionguard_demo_session', JSON.stringify({ session: demoSession, profile: demoProfile, settings: {} }))
      return demoSession
    }
  } catch {}
  return null
}

const mockSupabase = {
  from: (table: string) => createMockQueryBuilder(table),
  channel: (_name: string) => ({
    on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    subscribe: () => ({ unsubscribe: () => {} }),
    unsubscribe: () => {}
  }),
  storage: {
    from: (_bucket: string) => ({
      getPublicUrl: (filePath: string) => {
        const storedBlob = uploadedFilesMap.get(filePath)
        if (storedBlob) return { data: { publicUrl: storedBlob } }
        if (filePath === 'car-detection.mp4' || filePath.includes('car-detection')) {
          return { data: { publicUrl: '/car-detection.mp4' } }
        }
        const clean = filePath.startsWith('http') || filePath.startsWith('/') ? filePath : `/${filePath}`
        return { data: { publicUrl: clean } }
      },
      createSignedUrl: async (filePath: string) => {
        const storedBlob = uploadedFilesMap.get(filePath)
        const url = storedBlob || (filePath.includes('car-detection') ? '/car-detection.mp4' : (filePath.startsWith('/') ? filePath : `/${filePath}`))
        return { data: { signedUrl: url }, error: null }
      },
      upload: async (filePath: string, fileData: any) => {
        try {
          if (typeof window !== 'undefined' && (fileData instanceof Blob || fileData instanceof File)) {
            const blobUrl = URL.createObjectURL(fileData)
            uploadedFilesMap.set(filePath, blobUrl)
          }
          return { data: { path: filePath }, error: null }
        } catch (e: any) {
          return { data: null, error: e }
        }
      },
      remove: async (paths: string[]) => {
        paths.forEach(p => uploadedFilesMap.delete(p))
        return { data: paths, error: null }
      },
      download: async () => ({ data: new Blob(), error: null }),
      list: async () => ({ data: [], error: null })
    })
  },
  auth: {
    getSession: async () => ({ data: { session: getStoredDemoSession() }, error: null }),
    getUser: async () => {
      const session = getStoredDemoSession()
      return { data: { user: session?.user || null }, error: null }
    },
    signInWithPassword: async ({ email }: any) => {
      const demoUser = {
        id: 'demo-admin-id',
        email: email || 'admin@transport.gov',
        user_metadata: { full_name: 'System Administrator' },
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString()
      }
      const demoSession = {
        access_token: 'demo-token',
        token_type: 'bearer',
        user: demoUser
      }
      const demoProfile = {
        id: 'demo-admin-id',
        email: email || 'admin@transport.gov',
        role: 'Admin',
        status: 'Active',
        name: 'System Administrator',
        organization: 'Department of Transportation'
      }
      localStorage.setItem('visionguard_demo_session', JSON.stringify({ session: demoSession, profile: demoProfile, settings: {} }))
      sessionStorage.removeItem('visionguard_logged_out')
      authListeners.forEach(listener => {
        try { listener('SIGNED_IN', demoSession) } catch {}
      })
      return { data: { user: demoUser, session: demoSession }, error: null }
    },
    signUp: async () => ({ data: { user: null, session: null }, error: null }),
    signOut: async () => {
      localStorage.removeItem('visionguard_demo_session')
      sessionStorage.setItem('visionguard_logged_out', 'true')
      authListeners.forEach(listener => {
        try { listener('SIGNED_OUT', null) } catch {}
      })
      return { error: null }
    },
    onAuthStateChange: (callback: any) => {
      authListeners.add(callback)
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              authListeners.delete(callback)
            }
          }
        }
      }
    },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: {}, error: null })
  }
}

export const supabase: any = isMock
  ? mockSupabase
  : createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })


import { useState, useEffect } from 'react'
import { 
  Search, Filter, Maximize2, AlertCircle, 
  Camera as CameraIcon, ShieldAlert, CheckCircle2,
  Activity, Settings2, Plus, Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import Hls from 'hls.js'
import { useRef } from 'react'

function CameraStream({ cam }: { cam: any }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  
  useEffect(() => {
    if (!cam || !videoRef.current) return;
    const url = cam.stream_url || cam.source_url;
    if (!url) return;

    const video = videoRef.current;
    let hls: Hls | null = null;

    if (cam.source_type === 'hls' || url.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, lowLatencyMode: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
      } else {
        video.src = url;
        video.play().catch(() => {});
      }
    } else {
      video.src = url;
      video.play().catch(() => {});
    }

    return () => {
      if (hls) hls.destroy();
    }
  }, [cam]);

  if (!cam || (!cam.stream_url && !cam.source_url)) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <CameraIcon className="w-12 h-12 text-slate-700/50" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover"
      muted
      autoPlay
      playsInline
    />
  );
}

export function Monitor() {
  const [activeLayout, setActiveLayout] = useState('grid-4')
  const { role } = useAuthStore()
  
  const [cameras, setCameras] = useState<any[]>([])
  const [activeIncidents, setActiveIncidents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
    
    // Subscribe to realtime updates for incidents
    const incidentsSub = supabase.channel('active_incidents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, (_payload: any) => {
        fetchData() // Simple refresh for now
      })
      .subscribe()
      
    return () => {
      incidentsSub.unsubscribe()
    }
  }, [])

  const fetchData = async () => {
    setLoading(true)
    
    const [camsRes, incsRes] = await Promise.all([
      supabase.from('cameras').select('*').order('created_at', { ascending: false }),
      supabase.from('incidents').select('*, cameras(name)').eq('status', 'Active').order('created_at', { ascending: false }).limit(5)
    ])
    
    if (camsRes.data) setCameras(camsRes.data)
    if (incsRes.data) setActiveIncidents(incsRes.data)
      
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (cameras.length === 0) {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <CameraIcon className="w-8 h-8 text-blue-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">No Cameras Connected</h2>
          <p className="text-slate-500 text-[14px] mb-6">
            Add your first camera to begin monitoring traffic activity and generating AI insights.
          </p>
          {(role === 'Admin' || role === 'Operator') && (
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-[14px] font-bold transition-all shadow-sm flex items-center justify-center gap-2 mx-auto cursor-pointer">
              <Plus className="w-4 h-4" /> Add Camera Feed
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-136px)] flex gap-6">
      
      {/* Left Panel: Camera List */}
      <div className="w-80 flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900">Camera Directory</h3>
            <span className="bg-blue-100 text-blue-700 text-[12px] font-bold px-2 py-0.5 rounded-full">
              {cameras.length} Total
            </span>
          </div>
          
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search by ID or location..." 
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm cursor-text"
              />
            </div>
            <div className="flex gap-2">
              <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm cursor-pointer">
                <Filter className="w-3.5 h-3.5" /> Filter
              </button>
              <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm cursor-pointer">
                <Settings2 className="w-3.5 h-3.5" /> Groups
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {cameras.map(cam => (
            <div key={cam.id} className="p-3 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer group flex items-start gap-3 border border-transparent hover:border-slate-100">
              <div className="mt-0.5">
                {cam.status === 'online' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                 cam.status === 'warning' ? <AlertCircle className="w-4 h-4 text-amber-500" /> :
                 <AlertCircle className="w-4 h-4 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[13px] font-bold text-slate-900 truncate">{cam.name}</span>
                </div>
                <div className="text-[12px] text-slate-600 truncate">{cam.location || 'No location set'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Center Panel: Camera Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 bg-white p-3 border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-900 mr-2">Layout:</span>
            {[
              { id: 'grid-1', label: '1x1' },
              { id: 'grid-4', label: '2x2' },
              { id: 'grid-9', label: '3x3' }
            ].map(layout => (
              <button
                key={layout.id}
                onClick={() => setActiveLayout(layout.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer",
                  activeLayout === layout.id 
                    ? "bg-slate-900 text-white shadow-sm" 
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {layout.label}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
            <Maximize2 className="w-4 h-4" /> Fullscreen
          </button>
        </div>

        {/* Grid Area */}
        <div className={cn(
          "flex-1 grid gap-4 min-h-0",
          activeLayout === 'grid-1' ? "grid-cols-1" :
          activeLayout === 'grid-4' ? "grid-cols-2 grid-rows-2" :
          "grid-cols-3 grid-rows-3"
        )}>
          {Array.from({ length: activeLayout === 'grid-1' ? 1 : activeLayout === 'grid-4' ? 4 : 9 }).map((_, i) => {
            const cam = cameras[i % cameras.length] // Loop cameras if we have fewer cameras than grid slots
            return (
            <div key={i} className="bg-slate-900 rounded-xl overflow-hidden relative group shadow-sm border border-slate-800">
              
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900">
                <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')]"></div>
                <CameraStream cam={cam} />
              </div>
              
              <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-white font-bold text-[13px] drop-shadow-md">{cam?.name || `CAM-${i+1}`}</div>
                    <div className="text-white/80 font-medium text-[11px] drop-shadow-md mt-0.5">{cam?.location || 'Unknown Location'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider">
                      <div className={cn("w-1.5 h-1.5 rounded-full", cam?.status === 'online' ? "bg-red-500 animate-pulse" : "bg-slate-500")}></div> 
                      {cam?.status === 'online' ? 'Live' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-end">
                <div className="flex gap-2">
                  <button className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-lg text-white transition-colors cursor-pointer">
                    <Settings2 className="w-4 h-4" />
                  </button>
                  <button className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-lg text-white transition-colors cursor-pointer">
                    <Activity className="w-4 h-4" />
                  </button>
                </div>
                <button className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-lg text-white transition-colors cursor-pointer">
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

            </div>
          )})}
        </div>
      </div>

      {/* Right Panel: Incident Feed */}
      <div className="w-80 flex-shrink-0 flex flex-col min-h-0 gap-4">
        
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" /> Active Alerts
            </h3>
            {activeIncidents.length > 0 && (
              <span className="bg-red-100 text-red-700 text-[12px] font-bold px-2 py-0.5 rounded-full">
                {activeIncidents.length} New
              </span>
            )}
          </div>
          <div className="p-3 flex-1 overflow-y-auto space-y-3">
            {activeIncidents.length === 0 ? (
              <div className="text-center p-6 mt-8">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-[13px] font-bold text-slate-900">All Clear</p>
                <p className="text-[12px] text-slate-500">No active incidents detected.</p>
              </div>
            ) : activeIncidents.map(inc => (
              <div key={inc.id} className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-red-200 transition-colors cursor-pointer group">
                <div className="flex justify-between items-start mb-2">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                    inc.severity === 'Critical' ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                  )}>
                    {inc.severity}
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    {new Date(inc.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
                <div className="font-bold text-[13px] text-slate-900 mb-1">{inc.incident_type}</div>
                <div className="text-[12px] text-slate-600 flex items-center gap-1.5">
                  <CameraIcon className="w-3.5 h-3.5" /> {inc.cameras?.name || 'Unknown'}
                </div>
              </div>
            ))}
          </div>
        </div>



      </div>

    </div>
  )
}

import { useState, useEffect } from 'react'
import { 
  Search, Plus, Camera as CameraIcon, 
  MapPin,
  Map as MapIcon, List, Eye, Trash2, Edit2, Loader2, Play
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { motion, AnimatePresence } from 'framer-motion'
import { CameraCreationWizard } from '../components/cameras/CameraCreationWizard'
import { useNavigate } from 'react-router-dom'

export function Cameras() {
  const { role, user } = useAuthStore()
  const navigate = useNavigate()
  
  const [cameras, setCameras] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [activeFilter, setActiveFilter] = useState('All')
  
  // Drawer States
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [selectedCamera, setSelectedCamera] = useState<any | null>(null)

  useEffect(() => {
    fetchCameras()
    
    const channel = supabase.channel('camera_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => {
        fetchCameras()
      })
      .subscribe()
      
    return () => { channel.unsubscribe() }
  }, [])

  const fetchCameras = async () => {
    const { data, error } = await supabase
      .from('cameras')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      
    if (error) console.error(error)
    if (data) setCameras(data)
    setLoading(false)
  }

  const handleOpenAdd = () => {
    setSelectedCamera(null)
    setIsDetailsOpen(false)
    setIsFormOpen(true)
  }

  const handleOpenEdit = (cam: any) => {
    setSelectedCamera(cam)
    setIsDetailsOpen(false)
    setIsFormOpen(true)
  }

  const handleOpenDetails = (cam: any) => {
    setSelectedCamera(cam)
    setIsFormOpen(false)
    setIsDetailsOpen(true)
  }

  const handleDelete = async (cam: any) => {
    try {
      if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Are you sure you want to delete ${cam.name}?`)) {
        return
      }
    } catch {
      // In iframe sandbox where window.confirm may be restricted, continue deletion
    }
    try {
      await supabase.from('cameras').update({ is_deleted: true }).eq('id', cam.id)
      await supabase.from('audit_logs').insert([{ user_id: user?.id, action: `Deleted Camera ${cam.camera_identifier || cam.id}` }])
      setIsDetailsOpen(false)
    } catch (err) {
      console.error(err)
    }
  }

  const filteredCameras = cameras.filter(c => {
    if (activeFilter === 'Online') return c.status === 'online'
    if (activeFilter === 'Offline') return c.status === 'offline'
    if (activeFilter === 'Warning') return c.status === 'warning'
    return true
  })

  // Permission Checks
  const canEdit = role === 'Admin' || role === 'Operator' || role === 'Supervisor'
  const canDelete = role === 'Admin'

  return (
    <div className="flex h-[calc(100vh-136px)] gap-6">
      
      {/* Main Content Area */}
      <div className={cn("flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col transition-all duration-300", (isFormOpen || isDetailsOpen) ? "hidden lg:flex lg:w-2/3" : "w-full")}>
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {['All', 'Online', 'Warning', 'Offline'].map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer",
                  activeFilter === filter 
                    ? "bg-slate-900 text-white shadow-sm" 
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {filter}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-3">
            
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-1.5 rounded-md transition-colors cursor-pointer", viewMode === 'list' ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700")}
              >
                <List className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setViewMode('map')}
                className={cn("p-1.5 rounded-md transition-colors cursor-pointer", viewMode === 'map' ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700")}
              >
                <MapIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search cameras..." 
                className="w-48 xl:w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
              />
            </div>

            {canEdit && (
              <button 
                onClick={handleOpenAdd}
                className="flex items-center gap-2 py-2 px-3 bg-blue-600 border border-blue-600 rounded-lg text-[13px] font-bold text-white hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Add Camera
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : cameras.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-50/50">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                <CameraIcon className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Cameras Connected</h3>
              <p className="text-slate-500 max-w-sm text-[14px] mb-6">
                Add your first traffic camera to begin monitoring roadway activity and analyzing insights.
              </p>
              {canEdit && (
                <button 
                  onClick={handleOpenAdd}
                  className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Add Camera
                </button>
              )}
            </div>
          ) : viewMode === 'list' ? (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(226,232,240,1)]">
                <tr>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Identifier / Name</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Health</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCameras.map((cam) => (
                  <tr 
                    key={cam.id} 
                    className="transition-colors hover:bg-slate-50/80 group"
                  >
                    <td className="px-5 py-3 cursor-pointer" onClick={() => handleOpenDetails(cam)}>
                      <div className="font-bold text-[14px] text-slate-900">{cam.camera_identifier || cam.id.substring(0,8)}</div>
                      <div className="text-[12px] text-slate-500">{cam.name}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-[13px] text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" /> {cam.location || 'Unknown'}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider gap-1.5",
                        cam.status === 'online' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        cam.status === 'warning' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                        "bg-red-50 text-red-700 border border-red-200"
                      )}>
                        <div className={cn("w-1.5 h-1.5 rounded-full", 
                          cam.status === 'online' ? "bg-emerald-500 animate-pulse" : 
                          cam.status === 'warning' ? "bg-amber-500" : "bg-red-500"
                        )}></div>
                        {cam.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full", cam.health_score > 80 ? "bg-emerald-500" : cam.health_score > 50 ? "bg-amber-500" : "bg-red-500")}
                            style={{ width: `${cam.health_score || 0}%` }}
                          />
                        </div>
                        <span className="text-[12px] font-bold text-slate-700">{cam.health_score || 0}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => navigate(`/app/analyze?camera=${cam.id}`)}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                          title="Launch Live AI Analysis"
                        >
                          <Play className="w-4 h-4 text-emerald-600" />
                        </button>
                        <button 
                          onClick={() => handleOpenDetails(cam)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canEdit && (
                          <button 
                            onClick={() => handleOpenEdit(cam)}
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Edit Camera"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button 
                            onClick={() => handleDelete(cam)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Camera"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // Schematic Map View
            <div className="absolute inset-0 bg-[#e2e8f0] overflow-hidden relative">
              {/* Fake grid pattern to simulate a tactical map surface */}
              <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+CjxwYXRoIGQ9Ik0wIDBoNDB2NDBIMHoiIGZpbGw9Im5vbmUiLz4KPHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEiIG9wYWNpdHk9IjAuMSIvPgo8L3N2Zz4=')]"></div>
              
              {filteredCameras.map((cam, i) => {
                // Generate a stable pseudo-random position if lat/lng missing
                const top = cam.latitude ? ((cam.latitude % 100) + 10) + '%' : `${20 + (i * 17 % 60)}%`;
                const left = cam.longitude ? ((cam.longitude % 100) + 10) + '%' : `${15 + (i * 23 % 70)}%`;
                
                return (
                  <div 
                    key={cam.id} 
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer"
                    style={{ top, left }}
                    onClick={() => handleOpenDetails(cam)}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 border-white shadow-md relative z-10",
                      cam.status === 'online' ? "bg-emerald-500" :
                      cam.status === 'warning' ? "bg-amber-500" : "bg-red-500"
                    )}>
                      {cam.status === 'online' && <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-50"></div>}
                    </div>
                    <div className="mt-1 bg-white/90 backdrop-blur px-2 py-0.5 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[10px] font-bold text-slate-800 border border-slate-200">
                      {cam.camera_identifier || cam.name}
                    </div>
                  </div>
                )
              })}
              
              <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur p-3 rounded-lg border border-slate-200 shadow-sm text-[11px] font-bold text-slate-600 flex flex-col gap-2">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Online</div>
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500"></div> Warning</div>
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div> Offline</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side Drawer (Forms & Details) */}
      <AnimatePresence>
        {(isFormOpen || isDetailsOpen) && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-full lg:w-96 flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden relative z-20"
          >
            {/* Form View */}
            {isFormOpen && (
              <CameraCreationWizard 
                initialData={selectedCamera} 
                onSuccess={() => { 
                  setIsFormOpen(false); 
                  fetchCameras(); 
                }} 
                onCancel={() => setIsFormOpen(false)} 
              />
            )}

            {/* Details View */}
            {isDetailsOpen && selectedCamera && (
              <>
                <div className="p-5 border-b border-slate-100 flex flex-col relative bg-slate-900 overflow-hidden">
                  <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')]"></div>
                  
                  <div className="flex justify-between items-start z-10">
                    <button onClick={() => setIsDetailsOpen(false)} className="text-white/60 hover:text-white transition-colors cursor-pointer text-[20px]">
                      ×
                    </button>
                    {canEdit && (
                      <button onClick={() => handleOpenEdit(selectedCamera)} className="bg-white/10 hover:bg-white/20 backdrop-blur text-white px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer">
                        Edit
                      </button>
                    )}
                  </div>
                  
                  <div className="mt-8 z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        selectedCamera.status === 'online' ? "bg-emerald-400" :
                        selectedCamera.status === 'warning' ? "bg-amber-400" : "bg-red-400"
                      )}></span>
                      <span className="text-white/80 text-[12px] font-bold uppercase tracking-wider">{selectedCamera.status}</span>
                    </div>
                    <h2 className="text-[22px] font-bold text-white tracking-tight">{selectedCamera.camera_identifier || selectedCamera.name}</h2>
                    <p className="text-white/60 text-[13px] mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> {selectedCamera.location || 'Unknown Location'}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50">
                  <div className="p-5 space-y-6">
                    
                    {/* Live Preview Button */}
                    <button 
                      onClick={() => navigate(`/app/analyze?camera=${selectedCamera.id}`)}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-slate-200 p-3 rounded-lg text-[13px] font-bold text-slate-900 shadow-sm hover:border-blue-300 transition-colors cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <Play className="w-4 h-4 ml-0.5" />
                      </div>
                      Watch Live Stream
                    </button>

                    {/* Info Card */}
                    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">System Health</div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className={cn("h-full rounded-full", selectedCamera.health_score > 80 ? "bg-emerald-500" : selectedCamera.health_score > 50 ? "bg-amber-500" : "bg-red-500")}
                              style={{ width: `${selectedCamera.health_score || 0}%` }}
                            />
                          </div>
                          <span className="text-[14px] font-bold text-slate-900">{selectedCamera.health_score || 0}%</span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                        <div>
                          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Source Type</div>
                          <div className="text-[13px] font-medium text-slate-900 capitalize">
                            {(selectedCamera.source_type || 'rtsp').replace('_', ' ')}
                          </div>
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Source URL</div>
                          <div className="text-[13px] font-medium text-slate-900 truncate" title={selectedCamera.source_url || selectedCamera.stream_url}>
                            {selectedCamera.source_url || selectedCamera.stream_url || 'N/A'}
                          </div>
                        </div>
                      </div>

                      {selectedCamera.description && (
                        <div className="pt-3 border-t border-slate-100">
                          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Description</div>
                          <div className="text-[13px] text-slate-700 leading-relaxed">
                            {selectedCamera.description}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Danger Zone */}
                    {canDelete && (
                      <div className="pt-4">
                        <button 
                          onClick={() => handleDelete(selectedCamera)}
                          className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 p-3 rounded-lg text-[13px] font-bold transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" /> Delete Camera
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Film, Search, Play, Trash2, Clock, UploadCloud, RefreshCw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { cn } from '../lib/utils'

export function VideoLibrary() {
  const [videos, setVideos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchVideos()
  }, [])

  const fetchVideos = async () => {
    setLoading(true)
    const { data, error } = await (supabase as any)
      .from('video_assets')
      .select('*')
      .order('uploaded_at', { ascending: false })
    
    if (data && !error) setVideos(data)
    setLoading(false)
  }

  const handleDelete = async (id: string, storagePath: string) => {
    try {
      if (typeof window !== 'undefined' && window.confirm && !window.confirm('Are you sure you want to delete this video?')) {
        return
      }
    } catch {
      // In iframe sandbox where window.confirm may be restricted, continue deletion
    }

    try {
      await supabase.storage.from('videos').remove([storagePath])
      await (supabase as any).from('video_assets').delete().eq('id', id)
      setVideos(prev => prev.filter(v => v.id !== id))
    } catch (err) {
      console.error('Failed to delete video', err)
    }
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const filtered = videos.filter(v => v.filename.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900">Video Library</h2>
          <p className="text-[14px] text-slate-500">Manage uploaded videos and review past analysis results.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search videos..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm"
            />
          </div>
          <button 
            onClick={() => navigate('/app/analyze')}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-[13px] font-bold shadow-sm transition-all"
          >
            <UploadCloud className="w-4 h-4" /> New Upload
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[500px]">
        {loading ? (
          <div className="flex items-center justify-center h-[500px]">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[500px] text-center p-6">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-200">
              <Film className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Videos Found</h3>
            <p className="text-slate-500 text-[14px] mb-6">Upload a new video to start processing and analyzing.</p>
            <button 
              onClick={() => navigate('/app/analyze')}
              className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-[13px] font-bold transition-all"
            >
              Upload Video
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">File Name</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Size</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Uploaded</th>
                <th className="px-5 py-3.5 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((video) => (
                <tr key={video.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Film className="w-5 h-5 text-indigo-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 text-[14px] truncate">{video.filename}</p>
                        <p className="text-[12px] text-slate-500 font-mono mt-0.5">{video.id.split('-')[0]}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-600 font-medium">
                    {formatSize(video.file_size)}
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider",
                      video.processing_status === 'completed' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                      video.processing_status === 'processing' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                      video.processing_status === 'failed' ? "bg-rose-50 text-rose-700 border border-rose-200" :
                      video.processing_status === 'uploaded' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                      "bg-slate-100 text-slate-700 border border-slate-200"
                    )}>
                      {video.processing_status === 'pending' ? 'Ready' : (video.processing_status || 'Ready')}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-500 flex items-center gap-1.5 h-full">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDistanceToNow(new Date(video.uploaded_at))} ago
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button 
                      onClick={() => navigate(`/app/video-review?video=${video.id}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[13px] font-bold hover:bg-indigo-100 transition-colors shadow-sm cursor-pointer"
                      title="Replay persistent detections in Video Review"
                    >
                      <Film className="w-3.5 h-3.5 text-indigo-600" /> Replay Review
                    </button>
                    <button 
                      onClick={() => navigate(`/app/analyze?video=${video.id}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-[13px] font-bold hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
                      title="Run Live Analysis on this video"
                    >
                      <Play className="w-3.5 h-3.5 text-emerald-600" /> Analyze
                    </button>
                    <button 
                      onClick={() => handleDelete(video.id, video.storage_path)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      title="Delete Video"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

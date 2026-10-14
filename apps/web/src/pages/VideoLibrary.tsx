import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { VideoAsset } from '../services/db'
import { fallbackVideoNumbers, formatBytes, videoDisplayName } from '../lib/videoAssets'
import { deleteVideoWithArtifacts } from '../services/videoStorage'
import { getActiveBackendJob } from '../services/backendAnalysis'
import { Film, Search, Play, Trash2, Clock, Upload, RefreshCw, Eye, RotateCcw, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cn } from '../lib/utils'
import VideoReview from './VideoReview'

export function VideoLibrary() {
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runsByVideo, setRunsByVideo] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedVideoId = searchParams.get('video')

  useEffect(() => {
    fetchVideos()
  }, [])

  const fetchVideos = async () => {
    setLoading(true)
    try {
      const [videosResult, runsResult] = await Promise.allSettled([
        supabase
          .from('video_assets')
          .select('*')
          .order('uploaded_at', { ascending: false }),
        supabase
          .from('analysis_runs')
          .select('id, video_id, status, metrics, started_at, ended_at')
          .order('started_at', { ascending: false })
      ])

      let rawVideos: VideoAsset[] = []
      if (videosResult.status === 'fulfilled' && !videosResult.value.error) {
        setLoadError(null)
        rawVideos = (videosResult.value.data || []) as VideoAsset[]
      } else {
        const errMsg = videosResult.status === 'rejected'
          ? String(videosResult.reason)
          : (videosResult.value?.error?.message || 'Failed to load videos')
        setLoadError(errMsg)
      }

      if (runsResult.status === 'fulfilled' && runsResult.value.data) {
        const byVideo: Record<string, any[]> = {}
        for (const r of runsResult.value.data) {
          if (r.video_id) {
            if (!byVideo[r.video_id]) byVideo[r.video_id] = []
            byVideo[r.video_id].push(r)
          }
        }
        setRunsByVideo(byVideo)
      }

      const activeJob = getActiveBackendJob()

      // Reconcile stale processing runs where the job is no longer running
      const reconciled = rawVideos.map(v => {
        const meta = (v.metadata && typeof v.metadata === 'object' && !Array.isArray(v.metadata) ? v.metadata : {}) as Record<string, any>
        const hasArtifact = Boolean(meta.artifact_storage_path)
        const isJobActiveLocally = Boolean(activeJob && activeJob.videoId === v.id && (activeJob.status === 'running' || activeJob.status === 'queued'))

        if (!isJobActiveLocally && ((v.processing_status as string) === 'processing' || (v.processing_status as string) === 'queued')) {
          if (hasArtifact) {
            void supabase.from('video_assets').update({ processing_status: 'completed' }).eq('id', v.id)
            return { ...v, processing_status: 'completed' as const }
          } else {
            const uploadAgeMs = v.uploaded_at ? Date.now() - new Date(v.uploaded_at).getTime() : Infinity
            if (uploadAgeMs > 5 * 60 * 1000) {
              void supabase.from('video_assets').update({ processing_status: 'failed' }).eq('id', v.id)
              return { ...v, processing_status: 'failed' as const }
            }
          }
        }
        return v
      })
      setVideos(reconciled as VideoAsset[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (video: VideoAsset, name: string) => {
    try {
      if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Delete "${name}" and all associated analysis artifacts, tracks, and incidents? This action cannot be undone.`)) {
        return
      }
    } catch {
      // In sandbox environments where confirm may throw
    }

    setActionError(null)
    setDeletingId(video.id)
    try {
      await deleteVideoWithArtifacts(video)
      setVideos(prev => prev.filter(v => v.id !== video.id))
    } catch (e) {
      setActionError(`Could not delete ${name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeletingId(null)
    }
  }

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])
  const query = searchQuery.trim().toLowerCase()
  const filtered = videos.filter(v =>
    !query ||
    videoDisplayName(v, fallbackNumbers).toLowerCase().includes(query) ||
    v.filename.toLowerCase().includes(query) ||
    v.id.startsWith(query)
  )

  if (selectedVideoId) {
    return (
      <VideoReview
        videoId={selectedVideoId}
        showSidebar={false}
        onBack={() => {
          const next = new URLSearchParams(searchParams)
          next.delete('video')
          next.delete('time')
          next.delete('t')
          next.delete('incident')
          setSearchParams(next)
        }}
      />
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">History & Saved Videos</h1>
          <p className="text-xs text-slate-500 mt-0.5">Review persisted AI detection runs or rerun inference on saved traffic footage.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search saved videos..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <button 
            onClick={() => navigate('/app/analyze')}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-md text-xs font-medium shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Video
          </button>
        </div>
      </div>

      {(loadError || actionError) && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2.5 rounded-md text-xs flex items-center justify-between">
          <span>{loadError ? `Failed to load videos: ${loadError}` : actionError}</span>
          <button onClick={() => { setLoadError(null); setActionError(null); }} className="text-rose-500 hover:text-rose-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Main Content */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center h-[400px]">
            <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center mb-3 text-slate-500">
              <Film className="w-5 h-5 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              {searchQuery ? 'No matching videos' : 'No saved videos'}
            </h3>
            <p className="text-slate-500 text-xs max-w-sm mb-4">
              {searchQuery 
                ? 'Try searching with a different term or clear the filter.'
                : 'Videos appear here when "Save video to History" is enabled during upload in Live Analysis.'}
            </p>
            <button 
              onClick={() => navigate('/app/analyze')}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors shadow-xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" /> Upload Video
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto w-full min-w-0">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Video</th>
                  <th className="px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Size</th>
                  <th className="hidden md:table-cell px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date Added</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap min-w-[220px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((video) => {
                  const name = videoDisplayName(video, fallbackNumbers)
                  const meta = (video.metadata && typeof video.metadata === 'object' && !Array.isArray(video.metadata) ? video.metadata : {}) as Record<string, any>
                  const videoRuns = runsByVideo[video.id] || []
                  const activeJob = getActiveBackendJob()

                  // Check if a durable analysis artifact or completed run actually exists to review
                  const hasCompletedArtifact =
                    Boolean(meta.artifact_storage_path) ||
                    video.processing_status === 'completed' ||
                    videoRuns.some(r => r.status === 'completed' && Boolean(
                      (r.metrics && typeof r.metrics === 'object' && (r.metrics.artifact_storage_path || r.metrics.summary || r.metrics.total_frames || r.metrics.incidents_saved || r.metrics.tracked_objects)) ||
                      r.ended_at
                    ))

                  // Check if currently active or queued in background
                  const isJobActiveLocally = Boolean(activeJob && activeJob.videoId === video.id && (activeJob.status === 'running' || activeJob.status === 'queued'))
                  const uploadAgeMs = video.uploaded_at ? Date.now() - new Date(video.uploaded_at).getTime() : Infinity
                  const isFreshProcessing = ((video.processing_status as string) === 'processing' || (video.processing_status as string) === 'queued') && uploadAgeMs < 5 * 60 * 1000
                  const isActivelyAnalyzing = isJobActiveLocally || (!hasCompletedArtifact && isFreshProcessing)

                  // Check if processing explicitly failed or artifact is missing
                  const isFailed = !isActivelyAnalyzing && !hasCompletedArtifact && (
                    video.processing_status === 'failed' ||
                    (videoRuns.length > 0 && videoRuns.every(r => r.status === 'failed' || r.status === 'stopped'))
                  )

                  const isDeleting = deletingId === video.id

                  const handleAnalyze = (reanalyze = false) => {
                    const runMeta = (videoRuns[0]?.metrics && typeof videoRuns[0].metrics === 'object' ? videoRuns[0].metrics : {}) as Record<string, any>
                    const prevProfile = meta.detection_profile || meta.profile || runMeta.detection_profile || runMeta.profile
                    const prevSpeed = meta.processing_speed || meta.speed || runMeta.processing_speed || runMeta.speed
                    const params = new URLSearchParams({ video: video.id })
                    if (reanalyze) params.set('reanalyze', 'true')
                    if (prevProfile) params.set('profile', String(prevProfile))
                    if (prevSpeed) params.set('speed', String(prevSpeed))
                    navigate(`/app/analyze?${params.toString()}`)
                  }

                  return (
                    <tr key={video.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Video Name and Details */}
                      <td className="px-4 py-3 min-w-0 max-w-[240px] sm:max-w-xs md:max-w-sm">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                            <Film className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 text-xs truncate" title={name}>{name}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={video.filename}>
                              {video.filename} · <span className="font-mono text-slate-400">{video.id.split('-')[0]}</span>
                              {video.duration ? ` · ${Math.round(video.duration)}s` : ''}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {isActivelyAnalyzing ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80">
                            <Loader2 className="w-3 h-3 animate-spin text-amber-500" /> Analyzing
                          </span>
                        ) : hasCompletedArtifact ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Analyzed
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Ready
                          </span>
                        )}
                      </td>

                      {/* File Size */}
                      <td className="hidden sm:table-cell px-3 py-3 text-xs text-slate-600 font-mono whitespace-nowrap">
                        {formatBytes(video.file_size)}
                      </td>

                      {/* Date Added */}
                      <td className="hidden md:table-cell px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{video.uploaded_at ? `${formatDistanceToNow(new Date(video.uploaded_at))} ago` : '—'}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap min-w-[220px]">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {isActivelyAnalyzing ? (
                            <button
                              onClick={() => navigate(`/app/analyze?video=${encodeURIComponent(video.id)}`)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs shrink-0"
                              title={`View live analysis in progress for ${name}`}
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" /> In Progress
                            </button>
                          ) : hasCompletedArtifact ? (
                            <>
                              <button
                                onClick={() => setSearchParams({ video: video.id })}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-50 text-indigo-700 hover:text-indigo-900 border border-indigo-200 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs shrink-0"
                                title={`Review saved detections and incident replay for ${name}`}
                              >
                                <Eye className="w-3.5 h-3.5" /> Review Analysis
                              </button>
                              <button
                                onClick={() => handleAnalyze(true)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md text-xs font-medium transition-colors cursor-pointer shadow-2xs shrink-0"
                                title={`Run fresh inference on ${name}`}
                              >
                                <RotateCcw className="w-3 h-3 text-slate-500" /> Analyze Again
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleAnalyze(false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-medium transition-colors cursor-pointer shadow-2xs shrink-0"
                              title={`Start analysis for ${name}`}
                            >
                              <Play className="w-3 h-3 fill-current" /> Analyze Video
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(video, name)}
                            disabled={isDeleting}
                            className={cn(
                              "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer shrink-0",
                              isDeleting ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            )}
                            title={`Delete ${name}`}
                          >
                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

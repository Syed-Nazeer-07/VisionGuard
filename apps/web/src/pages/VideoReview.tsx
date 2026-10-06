import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Film, Activity, FileWarning, Image, ChevronRight, Eye } from 'lucide-react';
import { cn } from '../lib/utils';

export default function VideoReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [videos, setVideos] = useState<any[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [incidents, setIncidents] = useState<any[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<any[]>([]);
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'tracks' | 'evidence'>('timeline');
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);

  const selectedVideoIdRef = useRef<string | null>(null);

  const selectVideo = useCallback(async (video: any) => {
    if (!video) return;
    if (selectedVideoIdRef.current === video.id && selectedVideo?.id === video.id) return;
    selectedVideoIdRef.current = video.id;
    setSelectedVideo(video);
    setVideoUrl(null);

    const currentParam = new URLSearchParams(window.location.search).get('video');
    if (currentParam !== video.id) {
      setSearchParams({ video: video.id }, { replace: true });
    }

    try {
      let resolvedUrl = '';
      if (video.storage_path) {
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(video.storage_path);
        resolvedUrl = urlData?.publicUrl || '';
      }
      if (!resolvedUrl && (video.filename?.includes('car-detection') || video.storage_path === 'car-detection.mp4')) {
        resolvedUrl = '/car-detection.mp4';
      }
      setVideoUrl(resolvedUrl || '/car-detection.mp4');
    } catch (e) {
      console.error('Failed to load video URL:', e);
      setVideoUrl('/car-detection.mp4');
    }

    // 1. Fetch related incidents
    try {
      const { data: incidentData } = await (supabase as any)
        .from('incidents')
        .select('*')
        .eq('video_id', video.id)
        .order('created_at', { ascending: true });
      if (incidentData) setIncidents(incidentData);
    } catch (e) {
      console.warn('Failed to fetch video incidents:', e);
    }

    // 2. Fetch related tracked objects (with trajectory metadata)
    try {
      const { data: trackData } = await (supabase as any)
        .from('tracked_objects')
        .select('*')
        .eq('video_id', video.id);
      if (trackData) setTrackedObjects(trackData);
    } catch (e) {
      console.warn('Failed to fetch tracked objects:', e);
    }

    // 3. Fetch related evidence
    try {
      const { data: evData } = await (supabase as any)
        .from('evidence')
        .select('*')
        .eq('video_id', video.id);
      if (evData) setEvidenceList(evData);
    } catch (e) {
      console.warn('Failed to fetch evidence:', e);
    }
  }, [selectedVideo?.id, setSearchParams]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    async function loadInitialVideos() {
      try {
        const { data } = await (supabase as any)
          .from('video_assets')
          .select('*')
          .order('uploaded_at', { ascending: false });
        
        const vList = data || [];
        if (!isMounted) return;
        setVideos(vList);

        const targetVideoId = searchParams.get('video') || localStorage.getItem('visionguard_active_video_id');
        if (targetVideoId && vList.length > 0) {
          const found = vList.find((v: any) => v.id === targetVideoId);
          selectVideo(found || vList[0]);
        } else if (vList.length > 0) {
          selectVideo(vList[0]);
        }
      } catch (e) {
        console.warn('Failed to fetch video assets:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInitialVideos();

    return () => {
      isMounted = false;
    };
  }, []); // Run strictly once on mount

  // Synchronize URL param changes with selected video
  useEffect(() => {
    const videoParam = searchParams.get('video');
    if (videoParam && videoParam !== selectedVideoIdRef.current && videos.length > 0) {
      const match = videos.find(v => v.id === videoParam);
      if (match) {
        selectVideo(match);
      }
    }
  }, [searchParams, videos, selectVideo]);

  // Render saved bounding-box trajectories during video replay WITHOUT re-running AI inference
  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !selectedVideo) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const nowTime = video.currentTime;
    const scaleX = canvas.width / (video.videoWidth || canvas.width || 640);
    const scaleY = canvas.height / (video.videoHeight || canvas.height || 480);

    trackedObjects.forEach((t: any) => {
      const traj = t.metadata?.trajectory;
      if (!Array.isArray(traj) || traj.length === 0) return;

      // Find closest trajectory sample point within 0.5s of current playback position
      let closest: any = null;
      let minDiff = 0.5;

      for (const pt of traj) {
        const diff = Math.abs(pt.time - nowTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = pt;
        }
      }

      if (closest && closest.bbox) {
        const [bx, by, bw, bh] = closest.bbox;
        const x = bx * scaleX;
        const y = by * scaleY;
        const w = bw * scaleX;
        const h = bh * scaleY;

        // Render sleek tracking box
        ctx.strokeStyle = '#06b6d4'; // cyan-500
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, y, w, h);

        // Track label tag
        const label = `${t.object_type || 'Vehicle'} #${t.track_id}${closest.speed ? ` · ${closest.speed} mph` : ''}`;
        ctx.font = 'bold 11px Inter, sans-serif';
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(x, Math.max(0, y - 20), textWidth + 10, 18);

        ctx.fillStyle = '#22d3ee';
        ctx.fillText(label, x + 5, Math.max(13, y - 6));
      }
    });

    requestRef.current = requestAnimationFrame(drawOverlay);
  }, [selectedVideo, trackedObjects]);

  useEffect(() => {
    if (selectedVideo) {
      requestRef.current = requestAnimationFrame(drawOverlay);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [selectedVideo, drawOverlay]);

  // Jump player to incident timestamp
  const seekToIncident = (inc: any) => {
    const video = videoRef.current;
    if (!video) return;

    if (inc.metadata?.time !== undefined) {
      video.currentTime = Number(inc.metadata.time);
      video.play().catch(() => {});
    } else if (inc.created_at) {
      // Approximate from timeline or start at 0
      video.currentTime = Math.max(0, video.currentTime);
      video.play().catch(() => {});
    }
  };

  return (
    <div className="flex-1 h-[calc(100vh-64px)] overflow-hidden flex bg-slate-50">
      {/* Video Selector Sidebar */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
        <div className="p-4 border-b border-slate-200 bg-white sticky top-0 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Film className="w-5 h-5 text-indigo-600" />
              Video Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Replay persistent AI analysis</p>
          </div>
          <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
            {videos.length} Videos
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center p-6 text-sm text-slate-400">Loading video library...</div>
          ) : videos.length === 0 ? (
            <div className="text-center p-6 text-sm text-slate-400">
              No videos uploaded yet.
              <Link to="/app/analyze" className="block mt-2 text-indigo-600 font-semibold hover:underline">
                Upload a video in Analyze →
              </Link>
            </div>
          ) : (
            videos.map(v => (
              <button
                key={v.id}
                onClick={() => selectVideo(v)}
                className={cn(
                  "w-full text-left p-3 rounded-xl border transition-all cursor-pointer",
                  selectedVideo?.id === v.id
                    ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-500/20'
                    : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-slate-50 shadow-sm'
                )}
              >
                <div className="font-semibold text-slate-900 text-sm truncate pr-2">{v.filename}</div>
                <div className="text-xs text-slate-500 mt-1 flex justify-between items-center">
                  <span>{new Date(v.uploaded_at).toLocaleDateString()}</span>
                  <span className="font-mono text-[11px] text-slate-400">{v.id.split('-')[0]}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Analysis Display & Trajectory Overlay */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50">
        {selectedVideo ? (
          <>
            <div className="flex-1 p-6 flex flex-col items-center justify-center relative min-h-[50vh] overflow-hidden">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-black max-h-[58vh] flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  src={videoUrl || undefined}
                  controls
                  crossOrigin="anonymous"
                  playsInline
                  className="max-h-[58vh] w-auto max-w-full"
                  onPlay={() => { if (!requestRef.current) drawOverlay(); }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 pointer-events-none z-10 w-full h-full"
                />
              </div>

              {/* Sub-header controls */}
              <div className="mt-3 flex items-center justify-between w-full max-w-4xl text-xs text-slate-600 px-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{selectedVideo.filename}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{trackedObjects.length} Tracked Objects</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{incidents.length} Infractions</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Replaying Persistent Trajectories
                  </span>
                </div>
              </div>
            </div>
            
            {/* Bottom Tabs: Historical Incidents, Tracked Objects, Evidence */}
            <div className="h-72 border-t border-slate-200 bg-white flex flex-col shrink-0">
              <div className="flex border-b border-slate-200 px-4 bg-slate-50/80">
                <button
                  onClick={() => setActiveTab('timeline')}
                  className={cn(
                    "px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-all",
                    activeTab === 'timeline' ? "border-indigo-600 text-indigo-600 bg-white" : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  <FileWarning className="w-4 h-4 text-rose-500" />
                  Incident Timeline ({incidents.length})
                </button>
                <button
                  onClick={() => setActiveTab('tracks')}
                  className={cn(
                    "px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-all",
                    activeTab === 'tracks' ? "border-indigo-600 text-indigo-600 bg-white" : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Activity className="w-4 h-4 text-cyan-500" />
                  Tracked Objects ({trackedObjects.length})
                </button>
                <button
                  onClick={() => setActiveTab('evidence')}
                  className={cn(
                    "px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-all",
                    activeTab === 'evidence' ? "border-indigo-600 text-indigo-600 bg-white" : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Image className="w-4 h-4 text-purple-500" />
                  Captured Evidence ({evidenceList.length})
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {activeTab === 'timeline' && (
                  <div className="space-y-2 max-w-4xl">
                    {incidents.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 text-center">No traffic infractions recorded for this video asset.</div>
                    ) : (
                      incidents.map((inc, i) => (
                        <div 
                          key={inc.id || i}
                          onClick={() => seekToIncident(inc)}
                          className="p-3 bg-slate-50 hover:bg-indigo-50/60 border border-slate-200 hover:border-indigo-200 rounded-xl flex items-center justify-between text-sm transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
                              inc.severity === 'Critical' || inc.severity === 'high' ? "bg-rose-100 text-rose-700 border border-rose-200" :
                              inc.severity === 'Medium' || inc.severity === 'medium' ? "bg-amber-100 text-amber-700 border border-amber-200" :
                              "bg-blue-100 text-blue-700 border border-blue-200"
                            )}>
                              {inc.severity || 'Medium'}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                                {inc.incident_type || 'Traffic Violation'}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {inc.description || 'Infraction registered by analysis engine'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-indigo-600 font-semibold">
                            <span>Seek to moment</span>
                            <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'tracks' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {trackedObjects.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 col-span-3 text-center">No object trajectories found.</div>
                    ) : (
                      trackedObjects.map(obj => (
                        <div key={obj.id || obj.track_id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm flex justify-between items-center">
                          <div>
                            <span className="font-bold text-slate-800 capitalize">{obj.object_type || 'Vehicle'}</span>
                            <span className="text-slate-400 font-mono text-xs ml-1.5">#{obj.track_id}</span>
                            <div className="text-xs text-slate-500 mt-1">
                              Duration: {((obj.last_seen_timestamp || 0) - (obj.first_seen_timestamp || 0)).toFixed(1)}s ({obj.frame_count || 1} frames)
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-slate-700 bg-white px-2 py-1 rounded border border-slate-200">
                              {Math.round((obj.confidence || 0.8) * 100)}% conf
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'evidence' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {evidenceList.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 col-span-full text-center">No snapshot or crop evidence records found for this video.</div>
                    ) : (
                      evidenceList.map(ev => (
                        <div 
                          key={ev.id}
                          onClick={() => setSelectedEvidence(ev)}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer group"
                        >
                          <div className="h-28 bg-slate-100 flex items-center justify-center overflow-hidden relative">
                            <img 
                              src={ev.file_url || ev.file_path || '/platform_preview.png'} 
                              alt="Violation Evidence"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <Eye className="w-5 h-5" />
                            </div>
                          </div>
                          <div className="p-2.5 text-xs">
                            <div className="font-semibold text-slate-900 capitalize truncate">{ev.file_type || 'Snapshot'}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">{new Date(ev.capture_timestamp || ev.created_at).toLocaleTimeString()}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Film className="w-16 h-16 mb-4 opacity-20" />
            <p className="font-medium text-slate-500">Select a video from the library to review AI analysis</p>
          </div>
        )}
      </div>

      {/* Evidence Full View Modal */}
      {selectedEvidence && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedEvidence(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-900 text-lg capitalize">{selectedEvidence.file_type || 'Violation Evidence'}</h3>
              <button onClick={() => setSelectedEvidence(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>
            <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-200 mb-4 max-h-[60vh] flex items-center justify-center">
              <img 
                src={selectedEvidence.file_url || selectedEvidence.file_path || '/platform_preview.png'} 
                alt="Full Evidence" 
                className="max-h-[55vh] w-auto object-contain"
              />
            </div>
            <div className="text-xs text-slate-500 flex justify-between items-center">
              <span>Incident ID: {selectedEvidence.incident_id || 'N/A'}</span>
              <span>Captured: {new Date(selectedEvidence.capture_timestamp || selectedEvidence.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

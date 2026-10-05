import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Film, Activity, FileWarning } from 'lucide-react';

export default function VideoReview() {
  const [videos, setVideos] = useState<any[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [incidents, setIncidents] = useState<any[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<any[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('video_assets')
      .select('*')
      .order('uploaded_at', { ascending: false });
    
    if (data) setVideos(data);
    setLoading(false);
  };

  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const selectVideo = async (video: any) => {
    setSelectedVideo(video);
    setVideoUrl(null);

    try {
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(video.storage_path);
      if (urlData) {
        setVideoUrl(urlData.publicUrl);
      }
    } catch (e) {
      console.error('Failed to load video url:', e);
    }
    
    // Fetch related incidents
    const { data: incidentData } = await supabase
      .from('incidents')
      .select('*')
      .eq('video_id', video.id)
      .order('created_at', { ascending: true });
      
    if (incidentData) setIncidents(incidentData);

    // Fetch related tracked objects
    const { data: trackData } = await supabase
      .from('tracked_objects')
      .select('*')
      .eq('video_id', video.id);
      
    if (trackData) setTrackedObjects(trackData);
  };

  // Rendering loop for drawing bounding boxes during playback based on saved tracked objects
  // This is a naive implementation since we only have aggregated tracked_objects (first_seen, last_seen)
  // We can show active tracks that overlap the current time
  const drawOverlay = () => {
    if (!videoRef.current || !canvasRef.current || !selectedVideo) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    
    // const activeTracks = trackedObjects.filter(t => t.first_seen_timestamp <= now && t.last_seen_timestamp >= now);
    
    // We don't have per-frame coordinates saved in the DB (only aggregates). 
    // To properly draw bounding boxes, we would need to store bounding box per frame.
    // For this review page, we will list the tracked objects and incidents on the side.

    requestRef.current = requestAnimationFrame(drawOverlay);
  };

  useEffect(() => {
    if (selectedVideo) {
      requestRef.current = requestAnimationFrame(drawOverlay);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [selectedVideo, trackedObjects]);

  return (
    <div className="flex-1 h-[calc(100vh-64px)] overflow-hidden flex bg-slate-50">
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
        <div className="p-4 border-b border-slate-200 bg-white sticky top-0">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Film className="w-5 h-5 text-indigo-600" />
            Video Review
          </h2>
          <p className="text-sm text-slate-500 mt-1">Select a video to replay analysis</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center p-4 text-slate-400">Loading videos...</div>
          ) : videos.length === 0 ? (
            <div className="text-center p-4 text-slate-400">No videos uploaded yet.</div>
          ) : (
            videos.map(v => (
              <button
                key={v.id}
                onClick={() => selectVideo(v)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selectedVideo?.id === v.id
                    ? 'bg-indigo-50 border-indigo-200 shadow-sm ring-1 ring-indigo-500/10'
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50 shadow-sm'
                }`}
              >
                <div className="font-medium text-slate-900 truncate pr-2">{v.filename}</div>
                <div className="text-xs text-slate-500 mt-1 flex justify-between">
                  <span>{new Date(v.uploaded_at).toLocaleString()}</span>
                  <span>{(v.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50">
        {selectedVideo ? (
          <>
            <div className="flex-1 p-6 flex items-center justify-center relative min-h-[50vh]">
              <div className="relative rounded-xl overflow-hidden shadow-2xl bg-black max-h-full">
                <video
                  ref={videoRef}
                  src={videoUrl || undefined}
                  controls
                  crossOrigin="anonymous"
                  className="max-h-[60vh] max-w-full"
                  onPlay={() => { if (!requestRef.current) drawOverlay(); }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 pointer-events-none z-10"
                />
              </div>
            </div>
            
            <div className="h-64 border-t border-slate-200 bg-white grid grid-cols-2 shrink-0">
              <div className="border-r border-slate-200 p-4 flex flex-col h-full">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
                  <FileWarning className="w-4 h-4 text-rose-500" />
                  Incidents ({incidents.length})
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                  {incidents.length === 0 ? <div className="text-sm text-slate-500">No incidents found in this video.</div> : incidents.map(inc => (
                    <div key={inc.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                      <div className="font-medium text-slate-900">{inc.incident_type}</div>
                      <div className="text-xs text-slate-500 mt-1 flex justify-between">
                        <span>Confidence: {inc.confidence ? (inc.confidence * 100).toFixed(1) + '%' : 'N/A'}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${inc.severity === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                          {inc.severity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 flex flex-col h-full">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  Tracked Objects ({trackedObjects.length})
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                  {trackedObjects.length === 0 ? <div className="text-sm text-slate-500">No objects tracked.</div> : trackedObjects.map(obj => (
                    <div key={obj.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-slate-700 capitalize">{obj.object_type}</span> <span className="text-slate-400">#{obj.track_id}</span>
                        <div className="text-xs text-slate-500 mt-1">Visible for {((obj.last_seen_timestamp - obj.first_seen_timestamp)).toFixed(1)}s ({obj.frame_count} frames)</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium text-slate-900">{(obj.confidence * 100).toFixed(0)}% conf</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Film className="w-16 h-16 mb-4 opacity-20" />
            <p>Select a video from the list to review</p>
          </div>
        )}
      </div>
    </div>
  );
}

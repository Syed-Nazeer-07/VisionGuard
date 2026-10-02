import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Camera, Activity, AlertCircle, Play, Square, Video } from 'lucide-react';
import { db } from '../services/db';
import type { Camera as DbCamera } from '../services/db';
import { probeStream, relayYouTubeStream } from '../services/stream';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { WorkerOutputMessage } from '../pipeline/types';

export function Monitor() {
  const [cameras, setCameras] = useState<DbCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<DbCamera | null>(null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'probing' | 'online' | 'offline'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState<number>(0);
  const [trackCount, setTrackCount] = useState<number>(0);
  
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const isWorkerBusyRef = useRef(false);
  const animationFrameRef = useRef<number>(0);
  
  // Load cameras
  useEffect(() => {
    db.cameras.list().then(cams => {
      setCameras(cams.filter((c: DbCamera) => c.enabled && c.source_type !== 'upload'));
    });
  }, []);

  // Worker Initialization
  useEffect(() => {
    const worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
      const msg = e.data;
      if (msg.type === 'result') {
        isWorkerBusyRef.current = false;
        
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (canvas && video && canvas.getContext('2d')) {
          if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
            canvas.width = video.clientWidth;
            canvas.height = video.clientHeight;
          }
          drawBoundingBoxes(
            canvas.getContext('2d')!, 
            msg.tracks, 
            canvas.width, 
            canvas.height, 
            video.videoWidth,
            video.videoHeight
          );
          setTrackCount(msg.tracks.length);
        }
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // Frame Loop
  const processFrame = async () => {
    if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
      return;
    }
    
    if (!isWorkerBusyRef.current && workerRef.current) {
      try {
        const bitmap = await createImageBitmap(videoRef.current);
        isWorkerBusyRef.current = true;
        workerRef.current.postMessage({
          type: 'inference',
          bitmap,
          mediaTime: videoRef.current.currentTime
        }, [bitmap]);
        
        frameCountRef.current++;
        const now = performance.now();
        if (now - lastFpsTimeRef.current >= 1000) {
          setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
          frameCountRef.current = 0;
          lastFpsTimeRef.current = now;
        }
      } catch (err) {
        isWorkerBusyRef.current = false;
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(processFrame);
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
        animationFrameRef.current = requestAnimationFrame(processFrame);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  };

  const selectCamera = async (cam: DbCamera) => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    cancelAnimationFrame(animationFrameRef.current);
    setIsPlaying(false);
    
    setSelectedCamera(cam);
    setError(null);
    setStreamStatus('probing');
    
    if (!cam.stream_url) {
      setError('No stream URL provided for this camera.');
      setStreamStatus('offline');
      return;
    }

    try {
      const profile = await db.scene_profiles.get(cam.id);
      if (!profile) {
        setError('Missing scene profile for this camera. Please set up the scene first.');
        setStreamStatus('offline');
        return;
      }
      
      const probe = await probeStream(cam.stream_url, cam.source_type);
      if (probe.status !== 'online') {
        setError(`Stream is ${probe.status}: ${probe.error || 'Unknown error'}`);
        setStreamStatus('offline');
        return;
      }
      
      let playUrl = cam.stream_url;
      
      if (cam.source_type === 'youtube') {
        playUrl = await relayYouTubeStream(cam.stream_url);
      }
      
      setStreamStatus('online');
      
      if (Hls.isSupported() && videoRef.current) {
        const hls = new Hls();
        hls.loadSource(playUrl);
        hls.attachMedia(videoRef.current);
        hlsRef.current = hls;
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (videoRef.current) {
            videoRef.current.play().then(() => {
              setIsPlaying(true);
              animationFrameRef.current = requestAnimationFrame(processFrame);
            }).catch(e => console.error("Play prevented", e));
          }
        });
      } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        videoRef.current.src = playUrl;
        videoRef.current.addEventListener('loadedmetadata', () => {
          videoRef.current?.play().then(() => {
            setIsPlaying(true);
            animationFrameRef.current = requestAnimationFrame(processFrame);
          }).catch(e => console.error("Play prevented", e));
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start stream');
      setStreamStatus('offline');
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex gap-6">
      <div className="w-64 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-800 bg-gray-950">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-indigo-500" />
            Live Cameras
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {cameras.length === 0 ? (
            <div className="text-gray-500 text-sm text-center p-4">No enabled stream cameras found.</div>
          ) : (
            cameras.map(cam => (
              <button
                key={cam.id}
                onClick={() => selectCamera(cam)}
                className={`w-full text-left p-3 rounded-lg mb-2 transition-colors ${selectedCamera?.id === cam.id ? 'bg-indigo-900/30 border border-indigo-500/50' : 'hover:bg-gray-800 border border-transparent'}`}
              >
                <div className="font-medium text-gray-200">{cam.name}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">{cam.source_type}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col relative">
        {!selectedCamera ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
            <Video className="w-16 h-16 mb-4 opacity-20" />
            <p>Select a camera to view live stream</p>
          </div>
        ) : (
          <>
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <div className="bg-gray-900/80 backdrop-blur border border-gray-700 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm font-medium">
                {streamStatus === 'online' ? (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${streamStatus === 'probing' ? 'bg-yellow-500 animate-pulse' : 'bg-gray-500'}`} />
                )}
                {selectedCamera.name} ({streamStatus})
              </div>
              
              {streamStatus === 'online' && (
                <div className="bg-gray-900/80 backdrop-blur border border-gray-700 text-white px-3 py-1.5 rounded flex items-center gap-4 text-sm font-medium">
                  <span className="flex items-center gap-1"><Activity className="w-4 h-4 text-indigo-400" /> {fps} FPS</span>
                  <span className="text-gray-400">|</span>
                  <span className="flex items-center gap-1"><Activity className="w-4 h-4 text-emerald-400" /> {trackCount} Tracks</span>
                </div>
              )}
            </div>

            {error && (
              <div className="absolute top-16 left-4 z-10 bg-red-900/80 backdrop-blur border border-red-500/50 text-red-200 px-4 py-2 rounded shadow-lg max-w-md">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            )}

            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                className="max-w-full max-h-full object-contain absolute z-0"
                playsInline
                muted
                autoPlay
              />
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain absolute z-10 pointer-events-none"
              />
            </div>
            
            <div className="bg-gray-950 p-4 border-t border-gray-800 flex justify-between items-center">
              <div className="flex gap-4">
                <button
                  onClick={handlePlayPause}
                  disabled={streamStatus !== 'online'}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? 'Stop' : 'Play'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

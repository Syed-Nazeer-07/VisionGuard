import React, { useEffect, useRef, useState } from 'react';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { WorkerOutputMessage } from '../pipeline/types';
import { db } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';

export default function Analyze() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [provider, setProvider] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [inferenceTime, setInferenceTime] = useState<number>(0);
  const [trackCount, setTrackCount] = useState<number>(0);
  const [avgSpeed, setAvgSpeed] = useState<number>(0);
  const [peakSpeed, setPeakSpeed] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const isWorkerBusyRef = useRef(false);

  useEffect(() => {
    // Initialize Web Worker with new modular path
    const worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        setModelReady(true);
        setProvider(msg.provider);
      } else if (msg.type === 'result') {
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
        }
        
        setInferenceTime(msg.inferenceTime);
        setTrackCount(msg.tracks.length);
        
        let activeSpeeds = msg.tracks.filter(t => t.speed !== undefined).map(t => t.speed!);
        if (activeSpeeds.length > 0) {
          const sum = activeSpeeds.reduce((a, b) => a + b, 0);
          setAvgSpeed(Math.round(sum / activeSpeeds.length));
          const currentPeak = Math.max(...activeSpeeds);
          setPeakSpeed(prev => Math.max(prev, Math.round(currentPeak)));
        } else {
          setAvgSpeed(0);
        }
        
        updateFps();

        // Handle violations
        if (msg.violations && msg.violations.length > 0) {
          // Send to DB, mapping it to the Violations table schema
          // We need a dummy camera_id since Analyze page doesn't have one in route
          // Wait, the DB requires a valid camera_id. We should fetch the first camera or mock one.
          // For now we will wrap in try/catch to avoid crashing if camera_id is invalid.
          
          msg.violations.forEach(async (v) => {
            try {
              const cameras = await db.cameras.list();
              if (cameras.length > 0) {
                // If there's a plate crop and ocr_status is pending, request OCR
                if (v.metadata.plate_crop_path && v.metadata.ocr_status === 'pending') {
                  try {
                    const ocrRes = await requestOcr(v.metadata.plate_crop_path);
                    v.metadata.plate_text = ocrRes.text;
                    v.metadata.plate_confidence = ocrRes.confidence;
                    v.metadata.ocr_status = 'completed';
                  } catch (ocrErr) {
                    v.metadata.ocr_status = 'failed';
                    console.warn('OCR Request failed:', ocrErr);
                  }
                }

                await db.violations.create({
                  camera_id: cameras[0].id,
                  type: v.type,
                  severity: v.severity,
                  status: v.status,
                  timestamp: v.timestamp,
                  metadata: v.metadata as any
                });
              }
            } catch (err) {
              console.warn('Failed to save violation:', err);
            }
          });
        }
      } else if (msg.type === 'error') {
        setError(msg.error);
        isWorkerBusyRef.current = false;
      }
    };

    worker.postMessage({ type: 'init', modelPath: '/models/yolo11n.onnx' });

    return () => {
      worker.terminate();
    };
  }, []);

  const updateFps = () => {
    frameCountRef.current += 1;
    const now = performance.now();
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / elapsed));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  };

  const processFrame = async () => {
    if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
      setIsProcessing(false);
      return;
    }

    if (!isWorkerBusyRef.current && modelReady) {
      const video = videoRef.current;
      
      // Use createImageBitmap to avoid slow getImageData on the main thread
      try {
        const bitmap = await createImageBitmap(video);
        isWorkerBusyRef.current = true;
        
        // Use a dummy calibration for POC if not loaded from DB
        const calibration = {
          referenceWidth: 2,
          referenceHeight: 2,
          speedLimit: 60,
          tolerance: 10,
          // Simple rectangle in normalized coordinates
          calibrationArea: [
            { x: 0.3, y: 0.5 },
            { x: 0.7, y: 0.5 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 }
          ]
        };

        // Transfer bitmap to worker to avoid structured cloning cost
        workerRef.current?.postMessage({
          type: 'inference',
          bitmap,
          mediaTime: video.currentTime,
          calibration,
          featureFlags: {
            speed_detection: true,
            red_light_detection: false,
            lane_detection: false,
            helmet_detection: false,
            triple_riding_detection: false,
            plate_detection: true
          }
        }, [bitmap]);
      } catch (err) {
        console.warn('Failed to create ImageBitmap', err);
      }
    }

    if (isProcessing) {
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        (videoRef.current as any).requestVideoFrameCallback(processFrame);
      } else {
        requestAnimationFrame(processFrame);
      }
    }
  };

  useEffect(() => {
    if (isProcessing) {
      processFrame();
    }
  }, [isProcessing, modelReady]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && videoRef.current) {
      const url = URL.createObjectURL(file);
      videoRef.current.src = url;
      
      // Reset tracker when new video is uploaded
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'reset_tracker' });
      }
      setTrackCount(0);
      
      // Multiple uploads work without refresh because the video element handles new src URLs cleanly
    }
  };

  const handlePlay = () => setIsProcessing(true);
  const handlePause = () => setIsProcessing(false);

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold mb-2">Analyze Video</h1>
          <p className="text-gray-400">Run local YOLO11n inference in your browser.</p>
        </div>
        <div className="flex gap-4 items-center text-sm">
          <span className={`px-3 py-1 rounded-full font-medium ${modelReady ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
            Model: {modelReady ? 'Ready' : 'Loading...'}
          </span>
          {provider && (
            <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full font-medium">
              Backend: {provider.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="mb-6">
        <label className="inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-md cursor-pointer transition-colors font-medium">
          Upload Video
          <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      <div className="relative bg-gray-950 rounded-xl overflow-hidden flex items-center justify-center min-h-[480px] border border-gray-800 shadow-2xl">
        <video
          ref={videoRef}
          controls
          playsInline
          muted
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handlePause}
          className="max-h-[70vh] w-auto z-10"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
          style={{ width: videoRef.current?.clientWidth, height: videoRef.current?.clientHeight }}
        />
        {!videoRef.current?.src && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 z-0">
            Select a video to begin analysis
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
          <div className="text-gray-400 text-sm mb-1">FPS</div>
          <div className="text-3xl font-semibold text-green-400">{fps}</div>
        </div>
        <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
          <div className="text-gray-400 text-sm mb-1">Inference Time</div>
          <div className="text-3xl font-semibold text-blue-400">{Math.round(inferenceTime)} ms</div>
        </div>
        <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
          <div className="text-gray-400 text-sm mb-1">Active Tracks</div>
          <div className="text-3xl font-semibold text-purple-400">{trackCount}</div>
        </div>
        <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
          <div className="text-gray-400 text-sm mb-1">Avg Speed</div>
          <div className="text-3xl font-semibold text-yellow-400">{avgSpeed} <span className="text-lg">km/h</span></div>
        </div>
        <div className="bg-gray-900 p-5 rounded-xl border border-gray-800">
          <div className="text-gray-400 text-sm mb-1">Peak Speed</div>
          <div className="text-3xl font-semibold text-red-400">{peakSpeed} <span className="text-lg">km/h</span></div>
        </div>
      </div>
    </div>
  );
}

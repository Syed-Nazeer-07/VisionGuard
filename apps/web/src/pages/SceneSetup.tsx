import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/db';

interface Point { x: number; y: number; }

export default function SceneSetup() {
  const { id } = useParams<{ id: string }>(); // camera id
  const navigate = useNavigate();

  // Selected tool mode
  const [mode, setMode] = useState<'zone' | 'stopline' | 'light' | 'lanes' | 'calibration' | null>(null);

  // State structures
  const [detectionZone, setDetectionZone] = useState<Point[]>([]);
  const [stopLine, setStopLine] = useState<Point[]>([]);
  const [trafficLight, setTrafficLight] = useState<Point[]>([]);
  const [lanes, setLanes] = useState<Point[][]>([]);
  const [calibrationArea, setCalibrationArea] = useState<Point[]>([]);

  const [calibrationData, setCalibrationData] = useState({
    referenceWidth: 2,
    referenceHeight: 1.5,
    speedLimit: 60,
    tolerance: 10
  });

  const [draggingPoint, setDraggingPoint] = useState<{ type: string, laneIdx?: number, ptIdx: number } | null>(null);
  const [activeLaneIdx, setActiveLaneIdx] = useState<number | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load existing profile if camera exists
  useEffect(() => {
    async function loadData() {
      if (!id || id === 'new') return;
      try {
        await db.cameras.get(id); // Ensure camera exists
      } catch (err: any) {
        setError(err.message);
      }
    }
    loadData();
  }, [id]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && videoRef.current) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
    }
  };

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Return normalized coordinates 0-1
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  const drawPoint = (ctx: CanvasRenderingContext2D, p: Point, width: number, height: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  const drawLines = (ctx: CanvasRenderingContext2D, pts: Point[], width: number, height: number, color: string, close = false) => {
    if (pts.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * width, pts[0].y * height);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * width, pts[i].y * height);
    }
    if (close && pts.length > 2) ctx.closePath();
    ctx.stroke();
    if (close && pts.length > 2) {
      ctx.fillStyle = color + '40'; // 25% opacity
      ctx.fill();
    }
    pts.forEach(p => drawPoint(ctx, p, width, height, color));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Set logical size to match physical size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawLines(ctx, detectionZone, canvas.width, canvas.height, '#3b82f6', true); // blue
    drawLines(ctx, stopLine, canvas.width, canvas.height, '#ef4444'); // red
    drawLines(ctx, trafficLight, canvas.width, canvas.height, '#eab308', true); // yellow
    drawLines(ctx, calibrationArea, canvas.width, canvas.height, '#8b5cf6', true); // purple
    
    lanes.forEach(lane => {
      drawLines(ctx, lane, canvas.width, canvas.height, '#10b981'); // green
    });

  }, [detectionZone, stopLine, trafficLight, lanes, calibrationArea, mode, videoSrc]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // If we just finished dragging, ignore click
    if (draggingPoint) {
      setDraggingPoint(null);
      return;
    }

    if (!mode) return;
    const pt = getCanvasPoint(e);

    // Limit points based on mode
    if (mode === 'zone') setDetectionZone(prev => [...prev, pt]);
    if (mode === 'stopline') setStopLine(prev => prev.length < 2 ? [...prev, pt] : prev);
    if (mode === 'light') setTrafficLight(prev => prev.length < 4 ? [...prev, pt] : prev);
    if (mode === 'calibration') setCalibrationArea(prev => prev.length < 4 ? [...prev, pt] : prev);
    if (mode === 'lanes') {
      if (activeLaneIdx === null) {
        setLanes(prev => [...prev, [pt]]);
        setActiveLaneIdx(lanes.length);
      } else {
        setLanes(prev => {
          const newLanes = [...prev];
          if (newLanes[activeLaneIdx].length < 2) {
            newLanes[activeLaneIdx] = [...newLanes[activeLaneIdx], pt];
          }
          return newLanes;
        });
      }
    }
  };

  const getNearbyPoint = (pt: Point) => {
    const threshold = 0.02; // 2% of screen
    const dist = (p1: Point, p2: Point) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    
    let closest = { d: threshold, match: null as any };
    
    detectionZone.forEach((p, i) => { const d = dist(p, pt); if (d < closest.d) closest = { d, match: { type: 'zone', ptIdx: i } }; });
    stopLine.forEach((p, i) => { const d = dist(p, pt); if (d < closest.d) closest = { d, match: { type: 'stopline', ptIdx: i } }; });
    trafficLight.forEach((p, i) => { const d = dist(p, pt); if (d < closest.d) closest = { d, match: { type: 'light', ptIdx: i } }; });
    calibrationArea.forEach((p, i) => { const d = dist(p, pt); if (d < closest.d) closest = { d, match: { type: 'calibration', ptIdx: i } }; });
    lanes.forEach((lane, lIdx) => lane.forEach((p, i) => { const d = dist(p, pt); if (d < closest.d) closest = { d, match: { type: 'lanes', laneIdx: lIdx, ptIdx: i } }; }));

    return closest.match;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) { // Right click delete
      e.preventDefault();
      const pt = getCanvasPoint(e);
      const match = getNearbyPoint(pt);
      if (match) {
        if (match.type === 'zone') setDetectionZone(prev => prev.filter((_, i) => i !== match.ptIdx));
        if (match.type === 'stopline') setStopLine(prev => prev.filter((_, i) => i !== match.ptIdx));
        if (match.type === 'light') setTrafficLight(prev => prev.filter((_, i) => i !== match.ptIdx));
        if (match.type === 'calibration') setCalibrationArea(prev => prev.filter((_, i) => i !== match.ptIdx));
        if (match.type === 'lanes') setLanes(prev => {
          const l = [...prev];
          l[match.laneIdx!].splice(match.ptIdx, 1);
          if (l[match.laneIdx!].length === 0) l.splice(match.laneIdx!, 1);
          return l;
        });
      }
      return;
    }

    const pt = getCanvasPoint(e);
    const match = getNearbyPoint(pt);
    if (match) setDraggingPoint(match);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingPoint) return;
    const pt = getCanvasPoint(e);
    const updatePt = (prev: Point[]) => prev.map((p, i) => i === draggingPoint.ptIdx ? pt : p);
    
    if (draggingPoint.type === 'zone') setDetectionZone(updatePt);
    if (draggingPoint.type === 'stopline') setStopLine(updatePt);
    if (draggingPoint.type === 'light') setTrafficLight(updatePt);
    if (draggingPoint.type === 'calibration') setCalibrationArea(updatePt);
    if (draggingPoint.type === 'lanes') setLanes(prev => {
      const l = [...prev];
      l[draggingPoint.laneIdx!][draggingPoint.ptIdx] = pt;
      return l;
    });
  };

  const handleMouseUp = () => setDraggingPoint(null);

  const handleResetMode = () => {
    if (mode === 'zone') setDetectionZone([]);
    if (mode === 'stopline') setStopLine([]);
    if (mode === 'light') setTrafficLight([]);
    if (mode === 'calibration') setCalibrationArea([]);
    if (mode === 'lanes') { setLanes([]); setActiveLaneIdx(null); }
  };

  const handleSave = async () => {
    // Validation
    if (detectionZone.length > 0 && detectionZone.length < 3) return setError('Detection zone must be a valid polygon (3+ points)');
    if (stopLine.length === 1) return setError('Stop line must have 2 points');
    if (trafficLight.length > 0 && trafficLight.length < 3) return setError('Traffic light box must be a valid polygon (3+ points)');
    
    setSaving(true);
    setError(null);
    setSuccess(null);
    
    const roi_polygon = {
      detectionZone,
      stopLine,
      trafficLight,
      lanes,
      calibrationArea
    };

    try {
      // Assuming camera exists, just updating/inserting scene profile
      // In a real flow, we ensure camera is created first. Since it's a POC, we create a dummy camera if 'new'
      let targetCameraId = id;
      if (!targetCameraId || targetCameraId === 'new') {
        const cam = await db.cameras.create({ name: 'Scene Setup Camera', status: 'online' } as any);
        targetCameraId = cam.id;
      }

      await db.scene_profiles.upsert({
        camera_id: targetCameraId!,
        roi_polygon: roi_polygon as any,
        calibration_data: calibrationData as any
      });
      setSuccess('Configuration saved successfully');
      
      // For POC navigation
      if (id === 'new') navigate(`/app/cameras/${targetCameraId}/scene`, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950 text-white">
      <header className="px-8 py-6 border-b border-gray-800 shrink-0">
        <h1 className="text-3xl font-bold">Scene Setup</h1>
        <p className="text-gray-400 mt-1">Define tracking bounds, calibration areas, and rules for this camera.</p>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tools */}
        <div className="w-80 bg-gray-900 border-r border-gray-800 flex flex-col p-6 overflow-y-auto shrink-0">
          
          <div className="mb-6">
            <label className="block w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md cursor-pointer transition-colors font-medium">
              Upload Background Video
              <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
            </label>
          </div>

          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Drawing Tools</h3>
          
          <div className="space-y-2 mb-8">
            <button 
              onClick={() => setMode('zone')} 
              className={`w-full text-left px-4 py-3 rounded-lg border transition ${mode === 'zone' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}
            >
              <div className="font-medium">Detection Zone</div>
              <div className="text-xs opacity-70">Polygon where AI runs</div>
            </button>
            <button 
              onClick={() => setMode('stopline')} 
              className={`w-full text-left px-4 py-3 rounded-lg border transition ${mode === 'stopline' ? 'bg-red-600/20 border-red-500 text-red-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}
            >
              <div className="font-medium">Stop Line</div>
              <div className="text-xs opacity-70">Line for red light violations</div>
            </button>
            <button 
              onClick={() => setMode('light')} 
              className={`w-full text-left px-4 py-3 rounded-lg border transition ${mode === 'light' ? 'bg-yellow-600/20 border-yellow-500 text-yellow-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}
            >
              <div className="font-medium">Traffic Light Box</div>
              <div className="text-xs opacity-70">Region to monitor signal status</div>
            </button>
            <button 
              onClick={() => { setMode('lanes'); setActiveLaneIdx(null); }} 
              className={`w-full text-left px-4 py-3 rounded-lg border transition ${mode === 'lanes' ? 'bg-green-600/20 border-green-500 text-green-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}
            >
              <div className="font-medium">Lane Boundaries</div>
              <div className="text-xs opacity-70">Lines dividing traffic lanes</div>
            </button>
            <button 
              onClick={() => setMode('calibration')} 
              className={`w-full text-left px-4 py-3 rounded-lg border transition ${mode === 'calibration' ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}
            >
              <div className="font-medium">Calibration Area</div>
              <div className="text-xs opacity-70">Reference polygon for speed (perspective)</div>
            </button>
          </div>

          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Calibration Data</h3>
          <div className="space-y-4 mb-8">
            <div>
              <label className="text-xs text-gray-400">Ref Width (m)</label>
              <input type="number" value={calibrationData.referenceWidth} onChange={e => setCalibrationData({...calibrationData, referenceWidth: parseFloat(e.target.value)})} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Ref Height (m)</label>
              <input type="number" value={calibrationData.referenceHeight} onChange={e => setCalibrationData({...calibrationData, referenceHeight: parseFloat(e.target.value)})} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Speed Limit (km/h)</label>
              <input type="number" value={calibrationData.speedLimit} onChange={e => setCalibrationData({...calibrationData, speedLimit: parseInt(e.target.value)})} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 mt-1" />
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <button onClick={handleResetMode} disabled={!mode} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-md transition disabled:opacity-50">
              Clear Current Tool
            </button>
            <button onClick={handleSave} disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md transition font-semibold disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            {error && <div className="text-red-400 text-xs text-center">{error}</div>}
            {success && <div className="text-green-400 text-xs text-center">{success}</div>}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 p-6 flex flex-col bg-gray-950 overflow-hidden relative">
          <div className="bg-gray-900 rounded-lg flex-1 relative overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center">
            {videoSrc ? (
              <>
                <video 
                  src={videoSrc} 
                  autoPlay 
                  loop 
                  muted 
                  className="max-h-full w-auto absolute z-10"
                />
                <canvas 
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onContextMenu={(e) => e.preventDefault()}
                  className="absolute inset-0 z-20 w-full h-full cursor-crosshair"
                />
              </>
            ) : (
              <div className="text-gray-500">Upload a video to begin scene setup</div>
            )}
          </div>
          
          {/* Coordinates overlay display */}
          <div className="h-48 mt-4 bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-xs overflow-y-auto text-gray-400 shadow-inner">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-blue-400 mb-1">Detection Zone</h4>
                {detectionZone.length === 0 ? 'Not set' : detectionZone.map((p, i) => <div key={i}>[{p.x.toFixed(3)}, {p.y.toFixed(3)}]</div>)}
              </div>
              <div>
                <h4 className="text-red-400 mb-1">Stop Line</h4>
                {stopLine.length === 0 ? 'Not set' : stopLine.map((p, i) => <div key={i}>[{p.x.toFixed(3)}, {p.y.toFixed(3)}]</div>)}
              </div>
              <div>
                <h4 className="text-yellow-400 mb-1">Traffic Light</h4>
                {trafficLight.length === 0 ? 'Not set' : trafficLight.map((p, i) => <div key={i}>[{p.x.toFixed(3)}, {p.y.toFixed(3)}]</div>)}
              </div>
              <div>
                <h4 className="text-purple-400 mb-1">Calibration Area</h4>
                {calibrationArea.length === 0 ? 'Not set' : calibrationArea.map((p, i) => <div key={i}>[{p.x.toFixed(3)}, {p.y.toFixed(3)}]</div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

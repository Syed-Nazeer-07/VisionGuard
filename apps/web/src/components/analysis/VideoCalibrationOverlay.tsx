import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Point } from '../../pipeline/types';
import { videoPointFromDisplay, videoPointToDisplay } from '../../pipeline/tracker/calibrationValidation';

export function VideoCalibrationOverlay({
  videoRef,
  points,
  onPoint,
  fit = 'contain'
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  points: Point[];
  onPoint: (point: Point) => void;
  fit?: 'contain' | 'cover';
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, videoWidth: 0, videoHeight: 0 });

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;
    const update = () => {
      const rect = overlay.getBoundingClientRect();
      setSize(prev => {
        const next = {
          width: rect.width, height: rect.height,
          videoWidth: video.videoWidth, videoHeight: video.videoHeight
        };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(overlay);
    video.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', update);
    };
  }, [videoRef]);

  const displayed = size.videoWidth > 0 && size.videoHeight > 0
    ? points.map(point => videoPointToDisplay(point, size, size, fit))
    : [];

  return (
    <div ref={overlayRef} role="group" aria-label="Measured road plane calibration overlay"
      className="absolute inset-0 z-30 cursor-crosshair bg-indigo-950/10"
      onClick={event => {
        const element = overlayRef.current;
        const video = videoRef.current;
        if (!element || !video || points.length >= 4) return;
        const rect = element.getBoundingClientRect();
        const point = videoPointFromDisplay(event.clientX, event.clientY, rect, video, fit);
        if (point) onPoint(point);
      }}
    >
      <svg aria-hidden="true" width="100%" height="100%" className="absolute inset-0 pointer-events-none">
        {displayed.length > 1 && (
          <polyline points={displayed.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke="#a5b4fc" strokeWidth="3" strokeDasharray="6 4" />
        )}
        {displayed.length === 4 && (
          <polygon points={displayed.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(99,102,241,0.16)" stroke="#818cf8" strokeWidth="2" />
        )}
        {displayed.map((point, i) => (
          <g key={i}>
            <circle cx={point.x} cy={point.y} r="11" fill="#4338ca" stroke="white" strokeWidth="2" />
            <text x={point.x} y={point.y + 4} textAnchor="middle" fill="white"
              fontSize="11" fontWeight="700">{i + 1}</text>
          </g>
        ))}
      </svg>
      {displayed.length < 4 && (
        <span className="absolute left-3 bottom-3 bg-indigo-950/95 text-white rounded-lg px-3 py-2 text-xs font-semibold pointer-events-none">
          Select point {displayed.length + 1} of 4 · {['top-left', 'top-right', 'bottom-right', 'bottom-left'][displayed.length]}
        </span>
      )}
    </div>
  );
}

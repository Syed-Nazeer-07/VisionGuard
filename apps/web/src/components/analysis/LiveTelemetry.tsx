type LiveTelemetryProps = {
  detections: number | null;
  tracks: number;
  classes: Record<string, number>;
  fastest: number | null;
  frames: number;
  provider: string;
  fallbackReason: string;
  latency: number | null;
  inferenceFps: number | null;
  playbackFps: number | null;
  overlayAgeMs: number | null;
};

export function LiveTelemetry({
  detections, tracks, classes, fastest, frames, provider, fallbackReason, latency,
  inferenceFps, playbackFps, overlayAgeMs
}: LiveTelemetryProps) {
  const entries = Object.entries(classes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <aside className="vg-live-telemetry vg-panel" id="vg-analysis-telemetry" aria-labelledby="vg-telemetry-title">
      <div className="vg-section-head"><h2 id="vg-telemetry-title">Live observations</h2></div>
      <dl className="vg-live-counts">
        <div><dt>Detector candidates</dt><dd>{detections ?? '—'}</dd></div>
        <div><dt>Observed tracks</dt><dd>{detections === null && !tracks ? '—' : tracks}</dd></div>
      </dl>
      <section className="vg-live-classes" aria-label="Visible vehicle classes">
        <h3>Vehicle classes</h3>
        {entries.length === 0 ? <p>Observed vehicles will appear here.</p> :
          <ul>{entries.map(([label, count]) => <li key={label}><span>{label}</span><strong>{count}</strong></li>)}</ul>}
      </section>
      <div className="vg-live-speed">
        <span>Fastest visible estimate</span>
        <strong>{fastest === null ? '—' : '≈' + Math.round(fastest) + ' km/h'}</strong>
        <small>Uncalibrated optical estimate</small>
      </div>
      <details className="vg-live-performance">
        <summary>Performance {provider && <span>{provider === 'wasm' ? 'WASM' : 'WebGPU'}</span>}</summary>
        <dl>
          <div><dt>Last worker frame</dt><dd>{latency === null ? '—' : latency + ' ms'}</dd></div>
          <div><dt>Inference FPS</dt><dd>{inferenceFps?.toFixed(1) ?? '—'}</dd></div>
          <div><dt>Playback FPS</dt><dd>{playbackFps?.toFixed(1) ?? '—'}</dd></div>
          <div><dt>Overlay source age</dt><dd>{overlayAgeMs === null ? '—' : overlayAgeMs + ' ms'}</dd></div>
          <div><dt>Inference frames</dt><dd>{frames}</dd></div>
        </dl>
        {fallbackReason && <p>WebGPU unavailable in this session. {fallbackReason}</p>}
      </details>
    </aside>
  );
}

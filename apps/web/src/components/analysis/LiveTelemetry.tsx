import type { DetectorStartup } from '../../pipeline/worker/detectorProtocol';

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
  detectorSourceAge: number | null;
  canInspectFile: boolean;
  startup: (DetectorStartup & { totalMs: number }) | null;
};

export function LiveTelemetry({
  detections, tracks, classes, fastest, frames, provider, fallbackReason, latency,
  inferenceFps, playbackFps, overlayAgeMs, startup, detectorSourceAge, canInspectFile
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
          <div><dt>Last detector source age</dt><dd>{detectorSourceAge === null ? '—' : detectorSourceAge + ' ms'}</dd></div>
          <div><dt>Overlay source age</dt><dd>{overlayAgeMs === null ? '—' : overlayAgeMs + ' ms'}</dd></div>
          <div><dt>Inference frames</dt><dd>{frames}</dd></div>
          {startup && <>
            <div><dt>Ready in</dt><dd>{Math.round(startup.totalMs)} ms</dd></div>
            <div><dt>Read model</dt><dd>{Math.round(startup.downloadMs)} ms</dd></div>
            <div><dt>Initialize session</dt><dd>{Math.round(startup.sessionMs)} ms</dd></div>
            {startup.wasmThreads != null && <div><dt>WASM threads</dt><dd>{startup.wasmThreads}</dd></div>}
          </>}
        </dl>
        {canInspectFile && inferenceFps !== null && inferenceFps < 1 &&
          <p>Updates arrive less than once a second. Pause and choose Inspect frame to check the detector on that image.</p>}
        {fallbackReason && <p>WebGPU unavailable in this session. {fallbackReason}</p>}
      </details>
    </aside>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, AlertCircle, Camera, CheckCircle2, Loader2, Search, Settings2, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { CameraStream } from '../components/cameras/CameraStream';
import { cameraSourceLabel, getCameraPlaybackSource, type CameraSourceRecord } from '../services/cameraSources';

interface CameraRow extends CameraSourceRecord {
  id: string;
  name: string;
  camera_identifier?: string | null;
  location?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
}
interface IncidentRow {
  id: string;
  incident_type: string;
  severity: string | null;
  created_at: string;
  cameras?: { name: string } | null;
}

export function Monitor() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('camera');
  const [layout, setLayout] = useState<1 | 4 | 9>(4);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'warning' | 'offline'>('all');
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [cams, incs] = await Promise.all([
      supabase.from('cameras').select('*').eq('is_deleted', false).order('created_at', { ascending: false }),
      supabase.from('incidents').select('id, incident_type, severity, created_at, cameras(name)')
        .eq('status', 'Active').order('created_at', { ascending: false }).limit(5),
    ]);
    if (cams.error) setLoadError(`Could not load camera directory: ${cams.error.message}`);
    else {
      setCameras((cams.data ?? []) as CameraRow[]);
      setLoadError(incs.error ? `Incident feed unavailable: ${incs.error.message}` : null);
    }
    if (!incs.error) setIncidents((incs.data ?? []) as IncidentRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = supabase.channel('monitor_camera_and_incident_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(subscription); };
  }, [refresh]);

  const filteredCameras = useMemo(() => cameras.filter(cam => {
    const matchesSearch = [cam.name, cam.camera_identifier, cam.location].some(v =>
      (v ?? '').toLowerCase().includes(search.toLowerCase().trim()));
    return matchesSearch && (statusFilter === 'all' || cam.status === statusFilter);
  }), [cameras, search, statusFilter]);
  const selected = filteredCameras.find(cam => cam.id === selectedId);
  const visibleCameras = (selected
    ? [selected, ...filteredCameras.filter(cam => cam.id !== selected.id)]
    : filteredCameras).slice(0, layout);
  const select = (cam: CameraRow) => setParams({ camera: cam.id });

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] text-slate-600 gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading camera directory…
    </div>
  );

  return (
    <div className="flex flex-col gap-4 min-h-[calc(100vh-136px)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Camera Monitor</h1>
          <p className="text-sm text-slate-600 mt-1">
            Live browser playback for configured HLS feeds. This preview does not run AI detection or recording.
          </p>
        </div>
        <Link to="/app/cameras" className="inline-flex items-center gap-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-white font-semibold">
          <Camera className="w-4 h-4" /> Manage cameras
        </Link>
      </div>
      {loadError && (
        <div role="alert" className="flex items-center gap-2 border border-rose-200 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {loadError}
          <button onClick={() => void refresh()} className="ml-auto underline">Retry</button>
        </div>
      )}
      {cameras.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
          <Camera className="w-12 h-12 mx-auto text-slate-400" />
          <h2 className="text-xl font-bold text-slate-900">No cameras configured</h2>
          <p className="text-slate-600">Add a browser-playable HLS camera from the Camera Directory.</p>
          <Link to="/app/cameras" className="inline-block text-blue-700 font-semibold underline">Open Camera Directory</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_250px] gap-4 flex-1 min-h-0">
          <aside className="bg-white border border-slate-200 rounded-xl p-3 space-y-3 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Camera Directory</h2>
            <label className="relative block">
              <Search className="w-4 h-4 absolute left-2 top-2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg w-full text-sm"
                placeholder="Search cameras" aria-label="Search cameras" />
            </label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm" aria-label="Filter camera status">
              <option value="all">All configured statuses</option>
              <option value="online">Marked online</option>
              <option value="warning">Marked warning</option>
              <option value="offline">Marked offline</option>
            </select>
            <div className="space-y-1 max-h-[65vh] overflow-y-auto">
              {filteredCameras.length === 0 ? <p className="text-xs text-slate-500 p-2">No matching cameras.</p> :
                filteredCameras.map(cam => (
                  <button key={cam.id} onClick={() => select(cam)}
                    className={cn('w-full text-left rounded-lg border p-2 text-sm hover:bg-slate-50',
                      selectedId === cam.id ? 'bg-blue-50 border-blue-300' : 'border-transparent')}>
                    <div className="font-semibold text-slate-900 truncate">{cam.name}</div>
                    <div className="text-xs text-slate-500 truncate">{cam.location || 'Location not specified'}</div>
                    <div className="text-[11px] text-slate-500">{cameraSourceLabel(cam)}</div>
                  </button>
                ))}
            </div>
          </aside>
          <main className="bg-white border border-slate-200 rounded-xl p-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-bold text-sm text-slate-900">Live previews · {visibleCameras.length} distinct feeds</h2>
              <div className="flex gap-1" role="group" aria-label="Camera grid layout">
                {([1, 4, 9] as const).map(count => (
                  <button key={count} onClick={() => setLayout(count)}
                    className={cn('text-xs rounded px-3 py-1.5 border',
                      layout === count ? 'bg-slate-900 text-white' : 'bg-white text-slate-600')}>
                    {count === 1 ? '1×1' : count === 4 ? '2×2' : '3×3'}
                  </button>
                ))}
              </div>
            </div>
            <div className={cn('grid gap-3', layout === 1 ? 'grid-cols-1' : layout === 4 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')}>
              {visibleCameras.map(cam => (
                <div key={cam.id} className="aspect-video bg-slate-900 border border-slate-800 rounded-lg overflow-hidden relative">
                  <CameraStream camera={cam} />
                  <div className="pointer-events-none absolute left-0 right-0 top-0 p-2 bg-gradient-to-b from-black/75 to-transparent text-white text-xs">
                    <span className="font-semibold truncate">{cam.name}</span>
                    <span className="block opacity-70">{cameraSourceLabel(cam)} · Preview only</span>
                  </div>
                  <Link to={`/app/scene-setup/${encodeURIComponent(cam.id)}`}
                    title="Configure camera scene" className="absolute bottom-2 right-2 p-1.5 bg-slate-900/80 text-white rounded-lg">
                    <Settings2 className="w-4 h-4" />
                  </Link>
                </div>
              ))}
              {filteredCameras.length === 0 && <div className="p-8 text-sm text-slate-500">No matching camera feeds.</div>}
            </div>
            {visibleCameras.some(cam => !getCameraPlaybackSource(cam).playable) && (
              <p className="text-xs text-amber-800 mt-3">Some configured sources cannot play in the browser until an ingestion gateway is added.</p>
            )}
          </main>
          <aside className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldAlert className="w-4 h-4 text-amber-600" /> Active incident records
            </h2>
            {incidents.length === 0 && !loadError ? (
              <p className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> No active incidents currently recorded.
              </p>
            ) : incidents.map(inc => (
              <Link key={inc.id} to={`/app/cases?tab=review&id=${encodeURIComponent(inc.id)}`}
                className="block border border-slate-200 rounded-lg p-3 hover:bg-slate-50">
                <div className="font-semibold text-sm text-slate-900">{inc.incident_type}</div>
                <div className="text-xs text-slate-500">{inc.cameras?.name || 'Video analysis'} · {inc.severity || 'Unspecified'}</div>
                <div className="text-xs text-slate-500">{new Date(inc.created_at).toLocaleString()}</div>
              </Link>
            ))}
            <Link to="/app/cases?tab=review" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700">
              <Activity className="w-4 h-4" /> Open Review Queue
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Camera, Plus, Trash2, Edit2, Play, Square, Activity } from 'lucide-react';
import { db } from '../services/db';
import type { Camera as DbCamera } from '../services/db';
import { useAuthStore } from '../store/auth';
import { probeStream } from '../services/stream';
import { Link } from 'react-router-dom';

export default function Cameras() {
  const [cameras, setCameras] = useState<DbCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [currentCamera, setCurrentCamera] = useState<Partial<DbCamera>>({ source_type: 'upload', enabled: true });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [streamStatuses, setStreamStatuses] = useState<Record<string, string>>({});

  const { role } = useAuthStore();
  const canManage = role === 'Authority' || role === 'Admin';

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const data = await db.cameras.list();
      setCameras(data);
      
      // Probe stream health for non-upload cameras
      data.forEach((cam: DbCamera) => {
        if (cam.source_type !== 'upload' && cam.stream_url && cam.enabled) {
          probeStream(cam.stream_url, cam.source_type).then(res => {
            setStreamStatuses(prev => ({ ...prev, [cam.id]: res.status }));
          });
        }
      });
    } catch (err: any) {
      setError(err.message || 'Failed to fetch cameras');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    
    try {
      setIsSubmitting(true);
      setError(null);
      
      const payload: any = {
        name: currentCamera.name!,
        location: currentCamera.location || null,
        source_type: currentCamera.source_type || 'upload',
        stream_url: currentCamera.stream_url || null,
        enabled: currentCamera.enabled ?? true
      };
      
      if (currentCamera.id) {
        // We need a proper update method for cameras
        // Mocking it with generic db update if we add it, otherwise... wait, we only have 'list' in db.cameras right now!
        // We'll need to update db.ts to have full CRUD for cameras.
        await db.cameras.update(currentCamera.id, payload);
      } else {
        await db.cameras.create(payload);
      }
      
      setIsEditing(false);
      setCurrentCamera({ source_type: 'upload', enabled: true });
      fetchCameras();
    } catch (err: any) {
      setError(err.message || 'Failed to save camera');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canManage || !confirm('Are you sure you want to delete this camera?')) return;
    try {
      setLoading(true);
      await db.cameras.delete(id);
      fetchCameras();
    } catch (err: any) {
      setError(err.message || 'Failed to delete camera');
      setLoading(false);
    }
  };

  const toggleEnabled = async (cam: DbCamera) => {
    if (!canManage) return;
    try {
      await db.cameras.update(cam.id, { enabled: !cam.enabled });
      setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, enabled: !cam.enabled } : c));
    } catch (err: any) {
      setError(err.message || 'Failed to toggle camera');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <Camera className="w-8 h-8 text-indigo-500" />
            Camera Management
          </h1>
          <p className="text-gray-400">Manage video sources and live streams.</p>
        </div>
        
        {canManage && (
          <button
            onClick={() => { setCurrentCamera({ source_type: 'upload', enabled: true }); setIsEditing(true); }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Camera
          </button>
        )}
      </header>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {isEditing && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4">{currentCamera.id ? 'Edit Camera' : 'Add New Camera'}</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                <input required type="text" value={currentCamera.name || ''} onChange={e => setCurrentCamera({ ...currentCamera, name: e.target.value })} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Location</label>
                <input type="text" value={currentCamera.location || ''} onChange={e => setCurrentCamera({ ...currentCamera, location: e.target.value })} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Source Type</label>
                <select value={currentCamera.source_type} onChange={e => setCurrentCamera({ ...currentCamera, source_type: e.target.value })} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-white">
                  <option value="upload">Uploaded Video</option>
                  <option value="hls">HLS Stream</option>
                  <option value="rtsp">RTSP Stream</option>
                  <option value="youtube">YouTube Live</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Stream URL</label>
                <input type="text" value={currentCamera.stream_url || ''} onChange={e => setCurrentCamera({ ...currentCamera, stream_url: e.target.value })} className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-white" placeholder="https://..." disabled={currentCamera.source_type === 'upload'} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 mt-4">
              <input type="checkbox" id="enabled" checked={currentCamera.enabled} onChange={e => setCurrentCamera({ ...currentCamera, enabled: e.target.checked })} className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900" />
              <label htmlFor="enabled" className="text-sm text-gray-300">Enabled</label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setIsEditing(false)} className="px-4 py-2 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50">Save Camera</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading cameras...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cameras.map(cam => (
            <div key={cam.id} className={`bg-gray-900 border ${cam.enabled ? 'border-gray-700' : 'border-gray-800 opacity-75'} rounded-xl overflow-hidden`}>
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold text-white">{cam.name}</h3>
                  <div className="flex items-center gap-2">
                    {cam.source_type !== 'upload' && (
                      <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${
                        streamStatuses[cam.id] === 'online' ? 'bg-green-900/30 text-green-400 border-green-800' :
                        streamStatuses[cam.id] === 'offline' ? 'bg-red-900/30 text-red-400 border-red-800' :
                        'bg-yellow-900/30 text-yellow-400 border-yellow-800'
                      }`}>
                        <Activity className="w-3 h-3" />
                        {streamStatuses[cam.id] || 'unknown'}
                      </span>
                    )}
                    <span className="text-xs px-2 py-1 bg-gray-800 text-gray-300 rounded uppercase tracking-wider border border-gray-700">
                      {cam.source_type}
                    </span>
                  </div>
                </div>
                
                <div className="text-sm text-gray-400 mb-4 truncate" title={cam.stream_url || 'No URL'}>
                  {cam.location ? `${cam.location}` : 'No location specified'}
                </div>
                
                <div className="flex justify-between items-center pt-4 border-t border-gray-800">
                  <div className="flex gap-2">
                    {canManage && (
                      <>
                        <button onClick={() => { setCurrentCamera(cam); setIsEditing(true); }} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => toggleEnabled(cam)} className={`p-2 rounded transition-colors ${cam.enabled ? 'text-green-400 hover:bg-green-900/30' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}>
                          {cam.enabled ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                        </button>
                        <button onClick={() => handleDelete(cam.id)} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                  <Link to={`/app/cameras/${cam.id}/scene`} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium">Scene Setup &rarr;</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, Filter, AlertCircle, ShieldAlert } from 'lucide-react';
import { db } from '../services/db';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

export default function Alerts() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [cameraFilter, setCameraFilter] = useState<string>('all');

  const { role, user } = useAuthStore();
  const canManage = role === 'Authority' || role === 'Admin';

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const data = await db.alerts.list();
      setAlerts(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();

    const channel = supabase.channel('custom-all-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchAlerts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleAcknowledge = async (id: string) => {
    if (!canManage) return;
    try {
      await db.alerts.update(id, {
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: user?.id
      });
    } catch (err: any) {
      setError(err.message || 'Failed to acknowledge alert');
    }
  };

  const handleResolve = async (id: string) => {
    if (!canManage) return;
    try {
      // If resolving from active directly, we might also want to set acknowledged_by if not set,
      // but let's just set resolved_at and status.
      await db.alerts.update(id, {
        status: 'resolved',
        resolved_at: new Date().toISOString()
      });
    } catch (err: any) {
      setError(err.message || 'Failed to resolve alert');
    }
  };

  // unique cameras for filter dropdown
  const cameras = Array.from(new Set(alerts.map(a => a.cameras?.name).filter(Boolean)));

  const filteredAlerts = alerts.filter(a => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (cameraFilter !== 'all' && a.cameras?.name !== cameraFilter) return false;
    return true;
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-900/50 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-900/50 text-orange-400 border-orange-500/50';
      case 'medium': return 'bg-yellow-900/50 text-yellow-400 border-yellow-500/50';
      default: return 'bg-blue-900/50 text-blue-400 border-blue-500/50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'acknowledged': return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'resolved': return <CheckCircle className="w-5 h-5 text-green-500" />;
      default: return <AlertTriangle className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <ShieldAlert className="w-8 h-8 text-red-500" />
            System Alerts
          </h1>
          <p className="text-gray-400">Manage operational alerts, OCR failures, and system health.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-gray-900 p-2 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 px-2 border-r border-gray-700">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400">Filters</span>
          </div>
          
          <select 
            value={statusFilter} 
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </select>

          <select 
            value={severityFilter} 
            onChange={e => setSeverityFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          <select 
            value={cameraFilter} 
            onChange={e => setCameraFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Cameras</option>
            {cameras.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {loading && alerts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-500/50 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-300">All clear</h3>
          <p className="text-gray-500 mt-2">No alerts match your current filters.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredAlerts.map(alert => (
            <div key={alert.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col md:flex-row gap-6 items-start md:items-center hover:border-gray-700 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {getStatusIcon(alert.status)}
                  <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider border font-medium ${getSeverityColor(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="text-sm text-gray-400 capitalize bg-gray-800 px-2 py-0.5 rounded">
                    {alert.type.replace('_', ' ')}
                  </span>
                  <span className="text-sm text-gray-500 ml-auto flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>
                
                <h3 className="text-lg font-medium text-gray-200 mb-2">{alert.message}</h3>
                
                <div className="flex items-center gap-4 text-sm">
                  {alert.cameras?.name && (
                    <span className="text-gray-400">Camera: <span className="text-white font-medium">{alert.cameras.name}</span></span>
                  )}
                  {alert.violation_id && (
                    <span className="text-gray-400">Violation ID: <span className="text-white font-mono">{alert.violation_id.substring(0, 8)}...</span></span>
                  )}
                </div>
              </div>
              
              <div className="flex gap-2 w-full md:w-auto">
                {alert.status === 'active' && canManage && (
                  <button
                    onClick={() => handleAcknowledge(alert.id)}
                    className="flex-1 md:flex-none px-4 py-2 bg-yellow-600/20 text-yellow-500 hover:bg-yellow-600/30 border border-yellow-600/30 rounded-lg text-sm font-medium transition-colors"
                  >
                    Acknowledge
                  </button>
                )}
                {alert.status !== 'resolved' && canManage && (
                  <button
                    onClick={() => handleResolve(alert.id)}
                    className="flex-1 md:flex-none px-4 py-2 bg-green-600/20 text-green-500 hover:bg-green-600/30 border border-green-600/30 rounded-lg text-sm font-medium transition-colors"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

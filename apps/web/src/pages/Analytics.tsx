import { useState, useEffect } from 'react';
import { db } from '../services/db';
import { supabase } from '../lib/supabase';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer 
} from 'recharts';
import { Activity, Car, AlertTriangle, Filter, Settings2, BarChart2 } from 'lucide-react';
import type { Camera as DbCamera } from '../services/db';

export default function Analytics() {
  const [data, setData] = useState<any>(null);
  const [cameras, setCameras] = useState<DbCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [cameraId, setCameraId] = useState<string>('');
  const [dateRange, setDateRange] = useState<string>('7d');
  const [violationType, setViolationType] = useState<string>('');

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      let startDate: string | undefined;
      let endDate: string | undefined;
      
      if (dateRange !== 'all') {
        const d = new Date();
        if (dateRange === '1d') d.setDate(d.getDate() - 1);
        if (dateRange === '7d') d.setDate(d.getDate() - 7);
        if (dateRange === '30d') d.setDate(d.getDate() - 30);
        startDate = d.toISOString();
        endDate = new Date().toISOString();
      }
      
      const dashboard = await db.analytics.getDashboard(
        cameraId || undefined, 
        startDate, 
        endDate, 
        violationType || undefined
      );
      setData(dashboard);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    db.cameras.list().then(setCameras);
  }, []);

  useEffect(() => {
    fetchAnalytics();
    
    // Realtime subscriptions
    const channel = supabase.channel('analytics-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'violations' }, () => fetchAnalytics())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'traffic_stats' }, () => fetchAnalytics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => fetchAnalytics())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cameraId, dateRange, violationType]);

  const StatCard = ({ title, value, icon, subtitle }: { title: string, value: string | number, icon: any, subtitle?: string }) => (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col justify-between">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-gray-400 font-medium text-sm">{title}</h3>
        <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">{icon}</div>
      </div>
      <div>
        <div className="text-3xl font-bold text-white">{value}</div>
        {subtitle && <div className="text-sm text-gray-500 mt-1">{subtitle}</div>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <BarChart2 className="w-8 h-8 text-indigo-500" />
            Analytics Overview
          </h1>
          <p className="text-gray-400">Monitor traffic flow, speed metrics, and violation trends.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-gray-900 p-2 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 px-2 border-r border-gray-700">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400">Filters</span>
          </div>
          
          <select 
            value={dateRange} 
            onChange={e => setDateRange(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="1d">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>

          <select 
            value={cameraId} 
            onChange={e => setCameraId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Cameras</option>
            {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select 
            value={violationType} 
            onChange={e => setViolationType(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Violations</option>
            <option value="overspeed">Overspeed</option>
            <option value="red_light">Red Light</option>
            <option value="lane_violation">Lane Violation</option>
          </select>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard 
              title="Total Vehicles" 
              value={data.traffic_volume.toLocaleString()} 
              subtitle={`~${data.vehicles_per_day} per day`}
              icon={<Car className="w-5 h-5" />} 
            />
            <StatCard 
              title="Average Speed" 
              value={`${data.avg_speed} km/h`} 
              subtitle={`Peak: ${data.peak_speed} km/h`}
              icon={<Activity className="w-5 h-5" />} 
            />
            <StatCard 
              title="Total Violations" 
              value={data.total_violations.toLocaleString()} 
              subtitle={`${data.overspeed_rate}% overspeed rate`}
              icon={<AlertTriangle className="w-5 h-5" />} 
            />
            <StatCard 
              title="Active Alerts" 
              value={data.active_alerts.toLocaleString()} 
              icon={<Settings2 className="w-5 h-5" />} 
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-gray-200 font-medium mb-6">Traffic Volume Over Time</h3>
              <div className="h-72 w-full">
                {data.traffic_over_time.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.traffic_over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }} />
                      <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="Vehicles" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">No traffic data</div>
                )}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-gray-200 font-medium mb-6">Violations Over Time</h3>
              <div className="h-72 w-full">
                {data.violations_over_time.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.violations_over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }} />
                      <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} dot={false} name="Violations" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">No violations data</div>
                )}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-gray-200 font-medium mb-6">Speed Distribution</h3>
              <div className="h-72 w-full">
                {data.speed_distribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.speed_distribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="speed_range" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }} />
                      <Bar dataKey="count" fill="#10b981" name="Vehicles" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">No speed data</div>
                )}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-gray-200 font-medium mb-6">System Alerts Over Time</h3>
              <div className="h-72 w-full">
                {data.alerts_over_time.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.alerts_over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6' }} />
                      <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={false} name="Alerts" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">No alerts data</div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

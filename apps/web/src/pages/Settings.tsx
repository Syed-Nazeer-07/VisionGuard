import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, RefreshCw, AlertCircle, CheckCircle, ShieldAlert } from 'lucide-react';
import { db } from '../services/db';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

export default function Settings() {
  const { role } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [settings, setSettings] = useState<Record<string, any>>({});
  
  const canModify = role === 'Admin';
  const canView = role === 'Admin' || role === 'Authority';

  const fetchSettings = async () => {
    if (!canView) return;
    try {
      setLoading(true);
      setError(null);
      const data = await db.settings.list();
      setSettings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();

    if (canView) {
      const channel = supabase.channel('system-settings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => {
          fetchSettings();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [canView]);

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!canModify) return;
    
    // Validation
    if (Number(settings.evidence_retention_days) <= 0) {
      setError('Evidence retention days must be > 0');
      return;
    }
    if (Number(settings.speed_limit_default) <= 0) {
      setError('Speed limit must be > 0');
      return;
    }
    if (Number(settings.speed_tolerance_default) < 0) {
      setError('Speed tolerance must be >= 0');
      return;
    }
    
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      
      // Ensure strict typing before sending
      const updates = {
        evidence_retention_days: Number(settings.evidence_retention_days),
        speed_limit_default: Number(settings.speed_limit_default),
        speed_tolerance_default: Number(settings.speed_tolerance_default),
        feature_speed_detection: Boolean(settings.feature_speed_detection),
        feature_plate_detection: Boolean(settings.feature_plate_detection),
        feature_helmet_detection: Boolean(settings.feature_helmet_detection),
        feature_triple_riding_detection: Boolean(settings.feature_triple_riding_detection),
        feature_red_light_detection: Boolean(settings.feature_red_light_detection),
        feature_lane_detection: Boolean(settings.feature_lane_detection),
        feature_alerts: Boolean(settings.feature_alerts),
        maintenance_mode: Boolean(settings.maintenance_mode)
      };
      
      await db.settings.update(updates);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-gray-400">You do not have permission to view System Settings.</p>
      </div>
    );
  }

  if (loading && Object.keys(settings).length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  const Toggle = ({ label, field }: { label: string, field: string }) => (
    <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg border border-gray-700">
      <span className="text-gray-300 font-medium">{label}</span>
      <button
        type="button"
        disabled={!canModify}
        onClick={() => handleChange(field, !settings[field])}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
          settings[field] ? 'bg-indigo-600' : 'bg-gray-600'
        } ${!canModify ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            settings[field] ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );

  const InputField = ({ label, field, type = 'number', unit = '' }: { label: string, field: string, type?: string, unit?: string }) => (
    <div className="flex flex-col gap-2 p-4 bg-gray-800 rounded-lg border border-gray-700">
      <label className="text-gray-300 font-medium">{label}</label>
      <div className="relative flex items-center">
        <input
          type={type}
          disabled={!canModify}
          value={settings[field] ?? ''}
          onChange={(e) => handleChange(field, e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {unit && <span className="absolute right-4 text-gray-500">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <SettingsIcon className="w-8 h-8 text-indigo-500" />
            System Settings
          </h1>
          <p className="text-gray-400">Configure global parameters and feature flags.</p>
        </div>
        {canModify && (
          <div className="flex gap-3">
            <button
              onClick={fetchSettings}
              disabled={saving}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg flex items-center gap-3 text-red-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-900/50 border border-emerald-500/50 rounded-lg flex items-center gap-3 text-emerald-200">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <p>Settings saved successfully!</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-white mb-4 border-b border-gray-800 pb-2">Evidence Settings</h2>
            <InputField label="Evidence Retention Period" field="evidence_retention_days" unit="days" />
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4 border-b border-gray-800 pb-2">Detection Defaults</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="Default Speed Limit" field="speed_limit_default" unit="km/h" />
              <InputField label="Default Tolerance" field="speed_tolerance_default" unit="km/h" />
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4 border-b border-gray-800 pb-2">System Settings</h2>
            <Toggle label="Maintenance Mode" field="maintenance_mode" />
            <p className="text-sm text-gray-500 mt-2">When enabled, non-admin users will be temporarily restricted.</p>
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-white mb-4 border-b border-gray-800 pb-2">Feature Flags</h2>
            <div className="flex flex-col gap-3">
              <Toggle label="Speed Detection" field="feature_speed_detection" />
              <Toggle label="License Plate Detection (OCR)" field="feature_plate_detection" />
              <Toggle label="Helmet Detection" field="feature_helmet_detection" />
              <Toggle label="Triple Riding Detection" field="feature_triple_riding_detection" />
              <Toggle label="Red Light Detection" field="feature_red_light_detection" />
              <Toggle label="Lane Violation Detection" field="feature_lane_detection" />
              <Toggle label="System Alerts" field="feature_alerts" />
            </div>
            <p className="text-sm text-gray-500 mt-3">Disabling a feature flag completely halts the respective pipeline operations immediately across all nodes.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

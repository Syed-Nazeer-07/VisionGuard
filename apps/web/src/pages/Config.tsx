import { useEffect, useState, type FormEvent } from 'react';
import { Cpu, HardDrive, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';

const RETENTION_KEY = 'evidence_retention_days';

export function Config() {
  const userId = useAuthStore(state => state.user?.id);
  const role = useAuthStore(state => state.role);
  const [storedDays, setStoredDays] = useState<number | null>(null);
  const [days, setDays] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from('system_settings').select('value').eq('key', RETENTION_KEY).maybeSingle()
      .then(({ data, error }: { data: { value: unknown } | null; error: Error | null }) => {
        if (!active) return;
        const value = data?.value;
        const days = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
        if (error || !Number.isSafeInteger(days) || days < 1) {
          setFeedback({ message: 'Could not load the stored retention setting.', error: true });
          return;
        }
        setStoredDays(days);
        setDays(String(days));
      })
      .catch(() => {
        if (active) setFeedback({ message: 'Could not load the stored retention setting.', error: true });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, loadAttempt]);

  const requestedDays = Number(days);
  const valid = Number.isSafeInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 3650;
  const canSave = role === 'Admin' && !!userId && !loading && !saving &&
    storedDays !== null && valid && requestedDays !== storedDays;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || !userId) return;
    setSaving(true);
    setFeedback(null);
    try {
      const { error } = await supabase.from('system_settings').update({
        value: requestedDays, updated_by: userId, updated_at: new Date().toISOString()
      }).eq('key', RETENTION_KEY).select('key').single();
      if (error) throw error;
      setStoredDays(requestedDays);
      const { error: auditError } = await supabase.from('audit_logs').insert({
        user_id: userId, action: 'Update System Configuration',
        metadata: { updated_keys: [RETENTION_KEY], previous_days: storedDays, days: requestedDays }
      });
      setFeedback(auditError
        ? { message: 'Retention saved. The audit entry could not be recorded.', error: true }
        : { message: 'Evidence retention saved.' });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : 'Could not save the retention setting.', error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="vg-page vg-configuration">
      <header className="vg-page-header">
        <div><div className="vg-product-eyebrow">Administration / Policy</div><h1>System configuration</h1><p>Review the active detector and manage archived evidence retention.</p></div>
      </header>
      <div className="vg-config-grid">
        <section className="vg-panel">
          <div className="vg-section-head"><h2><Cpu size={17} aria-hidden="true"/> Browser detector</h2></div>
          <dl className="vg-config-facts">
            <div><dt>Model</dt><dd>YOLO11s ONNX</dd></div>
            <div><dt>Execution</dt><dd>WebGPU with WASM fallback</dd></div>
            <div><dt>Inference input</dt><dd>640 × 640 RGB</dd></div>
            <div><dt>Source processing</dt><dd>On this device</dd></div>
          </dl>
          <p className="vg-config-note">Confidence thresholds, association, and processing cadence are set by the browser pipeline. Review candidates use uncalibrated optical estimates and require human review.</p>
        </section>
        <section className="vg-panel">
          <div className="vg-section-head"><h2><HardDrive size={17} aria-hidden="true"/> Evidence retention</h2></div>
          <form onSubmit={event => void save(event)} className="vg-config-form">
            <div><p className="vg-product-eyebrow">Current policy: {storedDays === null ? 'Unavailable' : storedDays + ' days'}</p><label htmlFor="evidence-days">Days to retain evidence</label>
              <p id="evidence-days-help">Applies to archived incident evidence. Analysis history and original video files have their own storage settings.</p>
            </div>
            <input id="evidence-days" className="vg-field" type="number" min="1" max="3650" step="1"
              aria-describedby="evidence-days-help" value={days}
              disabled={loading || saving || storedDays === null || role !== 'Admin'}
              onChange={event => setDays(event.target.value)}/>
            {loading && <p role="status">Loading retention settings…</p>}
            {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
            {storedDays === null && !loading &&
              <button type="button" className="vg-secondary" onClick={() => {
                setLoading(true);
                setFeedback(null);
                setLoadAttempt(previous => previous + 1);
              }}>Retry loading</button>}
            <button type="submit" className="vg-primary" disabled={!canSave}><Save size={15} aria-hidden="true"/>{saving ? 'Saving…' : 'Save retention'}</button>
          </form>
        </section>
      </div>
    </div>
  );
}

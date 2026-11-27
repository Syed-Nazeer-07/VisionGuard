import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileText, Table2 } from 'lucide-react';
import { summarizeActivity, useActivityLedger } from '../services/activityLedger';
import { buildReportCsv, reportSessions } from '../services/reportData';
import { useAuthStore } from '../store/auth';
import '../styles/activity-experience.css';

const formats = [
  { id: 'executive', label: 'Executive summary PDF', help: 'Session summaries, class breakdown and review totals.', icon: FileText },
  { id: 'detailed', label: 'Detailed analysis PDF', help: 'Every saved observation and incident, grouped by session.', icon: FileText },
  { id: 'vehicle', label: 'Vehicle-observation CSV', help: 'All stored track rows, with a repeated-track column.', icon: Table2 },
  { id: 'incident', label: 'Incident-review CSV', help: 'Review decisions, flags and evidence notes.', icon: Table2 },
] as const;
type Format = typeof formats[number]['id'];

function saveCsv(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function ActivityReports() {
  const ownerId = useAuthStore(state => state.user?.id ?? null);
  return <AccountReports key={ownerId ?? 'signed-out'} ownerId={ownerId}/>;
}

function AccountReports({ ownerId }: { ownerId: string | null }) {
  const { records, loaded, error } = useActivityLedger(ownerId);
  const [params] = useSearchParams();
  const [session, setSession] = useState(params.get('session') ?? '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [format, setFormat] = useState<Format>('executive');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const invalidRange = Boolean(start && end && start > end);
  const filtered = useMemo(() => reportSessions(records, { session, start, end }), [records, session, start, end]);
  const totals = useMemo(() => summarizeActivity(filtered), [filtered]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const scope = [session ? 'Selected session' : 'Saved sessions', start ? 'from ' + start : '', end ? 'through ' + end : ''].filter(Boolean).join(' ');
  const formatLabel = formats.find(item => item.id === format)?.label;

  async function download() {
    if (busy || invalidRange || !loaded || !filtered.length) return;
    setBusy(true);
    setNotice('');
    try {
      const name = 'VisionGuard-' + format + '-' + new Date().toISOString().slice(0, 10);
      if (format === 'vehicle' || format === 'incident') {
        saveCsv(buildReportCsv(filtered, format), name + '.csv');
      } else {
        const { createReportPdf } = await import('../services/reportPdf');
        const pdf = await createReportPdf(filtered, format, scope);
        if (useAuthStore.getState().user?.id === ownerId) pdf.save(name + '.pdf');
      }
    } catch {
      setNotice('Could not create the report. Try again.');
    } finally { setBusy(false); }
  }

  return <div className="vg-page vg-data-page vg-reports-page">
    <header className="vg-page-header"><div><h1>Reports</h1><p>Export saved observations for your chosen sessions.</p></div></header>
    {(error || notice) && <p role="alert" className="vg-activity-alert">{notice || error}</p>}
    <div className="vg-report-layout">
      <section className="vg-panel vg-report-panel" aria-labelledby="report-setup">
        <h2 id="report-setup">Configure report</h2>
        <label htmlFor="report-session">Session</label>
        <select id="report-session" className="vg-field" value={session} onChange={event => setSession(event.target.value)}>
          <option value="">All saved sessions</option>
          {session && !records.some(run => run.id === session) && <option value={session}>Selected session unavailable</option>}
          {records.map(run => <option key={run.id} value={run.id}>{run.sourceName} · {new Date(run.createdAt).toLocaleDateString()}</option>)}
        </select>
        <div className="vg-report-dates">
          <div><label htmlFor="report-start">From date</label><input className="vg-field" type="date" id="report-start" value={start} onChange={event => setStart(event.target.value)}/></div>
          <div><label htmlFor="report-end">Through date</label><input className="vg-field" type="date" id="report-end" value={end} onChange={event => setEnd(event.target.value)}/></div>
        </div>
        <p className="vg-section-subtitle">Filters use session start dates in {timezone}.</p>
        {invalidRange && <p className="vg-activity-alert" role="alert">Choose an end date on or after the start date.</p>}
        <fieldset className="vg-report-types"><legend>Report type</legend>
          {formats.map(({ id, label, help, icon: Icon }) => <label key={id}>
            <input type="radio" name="report-type" value={id} checked={format === id} onChange={() => { setNotice(''); setFormat(id); }}/>
            <Icon size={17} aria-hidden="true"/><span><strong>{label}</strong><small>{help}</small></span>
          </label>)}
        </fieldset>
      </section>
      <section className="vg-panel vg-report-panel" aria-labelledby="report-included">
        <h2 id="report-included">In this report</h2>
        <p className="vg-section-subtitle">{formatLabel}</p>
        {!loaded ? <p role="status">Loading saved sessions…</p> : !filtered.length ? <div className="vg-report-empty">
          <strong>{records.length ? 'No sessions match this scope.' : 'No saved sessions yet.'}</strong>
          <p>{records.length ? 'Change the session or date range.' : 'Run an analysis to create a report.'}</p>
          {!records.length && <Link to="/app/analyze">Start an analysis</Link>}
        </div> : <dl className="vg-report-totals">
          <div><dt>Sessions</dt><dd>{totals.runs.toLocaleString()}</dd></div>
          {(format !== 'incident') && <div><dt>Repeated tracks</dt><dd>{totals.vehicles.toLocaleString()}</dd></div>}
          {(format === 'detailed' || format === 'vehicle') && <div><dt>Stored observation rows</dt><dd>{(totals.vehicles + totals.transientTrackCandidates).toLocaleString()}</dd></div>}
          {(format !== 'vehicle') && <div><dt>Review flags</dt><dd>{totals.violations.toLocaleString()}</dd></div>}
        </dl>}
        <button type="button" className="vg-primary vg-report-download" disabled={busy || !loaded || !filtered.length || invalidRange}
          onClick={() => void download()} aria-busy={busy}><Download size={17}/> {busy ? 'Preparing report…' : 'Download report'}</button>
        <p className="vg-section-subtitle">Track IDs are session-specific. Speed estimates come from image motion and are uncalibrated.</p>
      </section>
    </div>
  </div>;
}

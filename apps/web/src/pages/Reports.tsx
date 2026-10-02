import { useState, useEffect } from 'react';
import { FileText, Download, FileSpreadsheet, Filter } from 'lucide-react';
import { db } from '../services/db';
import type { Camera as DbCamera } from '../services/db';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getSignedUrl } from '../pipeline/evidence/storage';

type ReportType = 'violation' | 'traffic' | 'alert';

export default function Reports() {
  const [reportType, setReportType] = useState<ReportType>('violation');
  const [cameras, setCameras] = useState<DbCamera[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any[]>([]);

  // Filters
  const [dateRange, setDateRange] = useState<string>('7d');
  const [cameraId, setCameraId] = useState<string>('');
  const [violationType, setViolationType] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    db.cameras.list().then(setCameras);
  }, []);

  const getDates = () => {
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
    return { startDate, endDate };
  };

  const generatePreview = async () => {
    setLoading(true);
    setError(null);
    setData([]);
    
    try {
      const { startDate, endDate } = getDates();

      if (reportType === 'violation') {
        const res = await db.reports.getViolations({
          startDate, endDate, cameraId: cameraId || undefined, 
          violationType: violationType || undefined, 
          status: status || undefined
        }) as any[];
        
        // Resolve signed URLs for evidence
        const mapped = await Promise.all(res.map(async (v) => {
          let evidenceUrl = v.snapshot_url;
          if (v.snapshot_url) {
            try {
              evidenceUrl = await getSignedUrl(v.snapshot_url);
            } catch (e) {}
          }
          return {
            ...v,
            evidenceUrl
          };
        }));
        
        setData(mapped);
      } else if (reportType === 'alert') {
        const res = await db.reports.getAlerts({
          startDate, endDate, cameraId: cameraId || undefined, 
          status: status || undefined
        }) as any[];
        setData(res);
      } else if (reportType === 'traffic') {
        const res = await db.analytics.getDashboard(
          cameraId || undefined, startDate, endDate, violationType || undefined
        ) as any;
        
        // Convert the JSON object to a single row array for table preview
        setData([{
          vehicles: res.traffic_volume,
          avgSpeed: res.avg_speed,
          peakSpeed: res.peak_speed,
          violations: res.total_violations,
          overspeedRate: res.overspeed_rate
        }]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (data.length === 0) return;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    
    if (reportType === 'violation') {
      csvContent += "Violation ID,Camera,Timestamp,Violation Type,Speed,Speed Limit,Plate Number,OCR Confidence,Review Status,Reviewer,Evidence Link\n";
      data.forEach(v => {
        const meta = v.metadata || {};
        const row = [
          v.id,
          v.cameras?.name || 'Unknown',
          v.timestamp,
          v.type,
          meta.speed || 'N/A',
          meta.speed_limit || 'N/A',
          meta.plate_text || 'N/A',
          meta.plate_confidence || 'N/A',
          v.status,
          v.reviewed_by || 'Unreviewed',
          v.evidenceUrl || v.snapshot_url || 'N/A'
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\n";
      });
    } else if (reportType === 'alert') {
      csvContent += "Alert Type,Severity,Camera,Status,Created Time,Resolved Time\n";
      data.forEach(a => {
        const row = [
          a.type,
          a.severity,
          a.cameras?.name || 'Unknown',
          a.status,
          a.created_at,
          a.resolved_at || 'N/A'
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\n";
      });
    } else if (reportType === 'traffic') {
      csvContent += "Vehicle Count,Average Speed,Peak Speed,Violations Count,Overspeed Rate\n";
      data.forEach(d => {
        const row = [
          d.vehicles,
          d.avgSpeed,
          d.peakSpeed,
          d.violations,
          d.overspeedRate + '%'
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\n";
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${reportType}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportPDF = () => {
    if (data.length === 0) return;
    
    const doc = new jsPDF();
    const title = `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report`;
    
    // Metadata
    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Date Range: ${dateRange === 'all' ? 'All Time' : 'Last ' + dateRange.replace('d', ' Days')}`, 14, 36);
    
    // Headers & Body
    let head = [[]] as any[];
    let body = [] as any[];
    
    if (reportType === 'violation') {
      head = [['ID', 'Camera', 'Type', 'Speed', 'Plate', 'Status']];
      body = data.map(v => [
        v.id.substring(0, 8),
        v.cameras?.name || 'Unknown',
        v.type,
        v.metadata?.speed ? `${Math.round(v.metadata.speed)} km/h` : 'N/A',
        v.metadata?.plate_text || 'N/A',
        v.status
      ]);
    } else if (reportType === 'alert') {
      head = [['Type', 'Severity', 'Camera', 'Status', 'Created']];
      body = data.map(a => [
        a.type.replace('_', ' '),
        a.severity,
        a.cameras?.name || 'Unknown',
        a.status,
        new Date(a.created_at).toLocaleString()
      ]);
    } else if (reportType === 'traffic') {
      head = [['Vehicles', 'Avg Speed', 'Peak Speed', 'Violations', 'Overspeed %']];
      body = data.map(d => [
        d.vehicles,
        `${d.avgSpeed} km/h`,
        `${d.peakSpeed} km/h`,
        d.violations,
        `${d.overspeedRate}%`
      ]);
    }

    autoTable(doc, {
      startY: 45,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 9 }
    });

    doc.save(`${reportType}_report.pdf`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <FileText className="w-8 h-8 text-indigo-500" />
            Reports & Exports
          </h1>
          <p className="text-gray-400">Generate detailed data reports for analysis and compliance.</p>
        </div>
      </header>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-col md:flex-row gap-4 items-end mb-6">
          <div className="w-full md:w-auto flex-1">
            <label className="block text-sm font-medium text-gray-400 mb-1">Report Type</label>
            <select 
              value={reportType} 
              onChange={e => { setReportType(e.target.value as ReportType); setData([]); }}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="violation">Violation Report</option>
              <option value="traffic">Traffic Summary Report</option>
              <option value="alert">Alert Report</option>
            </select>
          </div>

          <div className="w-full md:w-auto">
            <label className="block text-sm font-medium text-gray-400 mb-1">Date Range</label>
            <select 
              value={dateRange} 
              onChange={e => setDateRange(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="1d">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <div className="w-full md:w-auto">
            <label className="block text-sm font-medium text-gray-400 mb-1">Camera</label>
            <select 
              value={cameraId} 
              onChange={e => setCameraId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Cameras</option>
              {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {(reportType === 'violation' || reportType === 'traffic') && (
            <div className="w-full md:w-auto">
              <label className="block text-sm font-medium text-gray-400 mb-1">Violation Type</label>
              <select 
                value={violationType} 
                onChange={e => setViolationType(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Types</option>
                <option value="overspeed">Overspeed</option>
                <option value="red_light">Red Light</option>
              </select>
            </div>
          )}

          {(reportType === 'violation' || reportType === 'alert') && (
            <div className="w-full md:w-auto">
              <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
              <select 
                value={status} 
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Statuses</option>
                {reportType === 'violation' ? (
                  <>
                    <option value="pending_review">Pending Review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </>
                ) : (
                  <>
                    <option value="active">Active</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                  </>
                )}
              </select>
            </div>
          )}

          <div className="w-full md:w-auto">
            <button
              onClick={generatePreview}
              disabled={loading}
              className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Preview
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : data.length > 0 ? (
        <div className="space-y-4">
          <div className="flex justify-end gap-3">
            <button
              onClick={exportCSV}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Export CSV
            </button>
            <button
              onClick={exportPDF}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4 text-red-400" />
              Export PDF
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-950 border-b border-gray-800">
                  {reportType === 'violation' && (
                    <>
                      <th className="p-4 text-sm font-medium text-gray-400">ID</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Camera</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Type</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Speed</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Plate</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Status</th>
                    </>
                  )}
                  {reportType === 'alert' && (
                    <>
                      <th className="p-4 text-sm font-medium text-gray-400">Type</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Severity</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Camera</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Status</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Created</th>
                    </>
                  )}
                  {reportType === 'traffic' && (
                    <>
                      <th className="p-4 text-sm font-medium text-gray-400">Total Vehicles</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Avg Speed</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Peak Speed</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Total Violations</th>
                      <th className="p-4 text-sm font-medium text-gray-400">Overspeed Rate</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.map((row, i) => (
                  <tr key={row.id || i} className="hover:bg-gray-800/50">
                    {reportType === 'violation' && (
                      <>
                        <td className="p-4 text-sm text-gray-300 font-mono">{row.id?.substring(0,8)}</td>
                        <td className="p-4 text-sm text-gray-300">{row.cameras?.name}</td>
                        <td className="p-4 text-sm text-gray-300">{row.type}</td>
                        <td className="p-4 text-sm text-gray-300">{row.metadata?.speed ? `${Math.round(row.metadata.speed)} km/h` : '-'}</td>
                        <td className="p-4 text-sm text-gray-300">{row.metadata?.plate_text || '-'}</td>
                        <td className="p-4 text-sm text-gray-300">{row.status}</td>
                      </>
                    )}
                    {reportType === 'alert' && (
                      <>
                        <td className="p-4 text-sm text-gray-300">{row.type}</td>
                        <td className="p-4 text-sm text-gray-300">{row.severity}</td>
                        <td className="p-4 text-sm text-gray-300">{row.cameras?.name}</td>
                        <td className="p-4 text-sm text-gray-300">{row.status}</td>
                        <td className="p-4 text-sm text-gray-300">{new Date(row.created_at).toLocaleString()}</td>
                      </>
                    )}
                    {reportType === 'traffic' && (
                      <>
                        <td className="p-4 text-sm text-gray-300">{row.vehicles}</td>
                        <td className="p-4 text-sm text-gray-300">{row.avgSpeed} km/h</td>
                        <td className="p-4 text-sm text-gray-300">{row.peakSpeed} km/h</td>
                        <td className="p-4 text-sm text-gray-300">{row.violations}</td>
                        <td className="p-4 text-sm text-gray-300">{row.overspeedRate}%</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-300">No Data</h3>
          <p className="text-gray-500 mt-2">Click preview to load report data, or try adjusting filters.</p>
        </div>
      )}
    </div>
  );
}

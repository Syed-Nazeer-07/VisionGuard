import { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle, Clock, RefreshCw, Car } from 'lucide-react';
import { db } from '../services/db';
import type { Violation } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';
import { SecureImage } from '../components/ui/SecureImage';

export default function Violations() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_review' | 'approved' | 'rejected'>('all');

  const loadViolations = async () => {
    try {
      setLoading(true);
      const data = await db.violations.list();
      setViolations(data);
    } catch (err) {
      console.error('Failed to load violations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadViolations();
  }, []);

  const handleRetryOcr = async (violation: Violation) => {
    const meta = violation.metadata as any;
    if (!meta || !meta.plate_crop_path) return;

    try {
      // Optimistically update UI
      setViolations(prev => prev.map(v => v.id === violation.id ? { ...v, metadata: { ...meta, ocr_status: 'pending' } } : v));
      
      const ocrRes = await requestOcr(meta.plate_crop_path);
      const updatedMeta = {
        ...meta,
        plate_text: ocrRes.text,
        plate_confidence: ocrRes.confidence,
        ocr_status: 'completed'
      };
      
      await db.violations.update(violation.id, { metadata: updatedMeta });
      setViolations(prev => prev.map(v => v.id === violation.id ? { ...v, metadata: updatedMeta } : v));
    } catch (err) {
      console.warn('OCR Retry failed:', err);
      const failedMeta = { ...meta, ocr_status: 'failed' };
      await db.violations.update(violation.id, { metadata: failedMeta });
      setViolations(prev => prev.map(v => v.id === violation.id ? { ...v, metadata: failedMeta } : v));
    }
  };

  const filteredViolations = violations.filter(v => statusFilter === 'all' || v.status === statusFilter);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending_review': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'rejected': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getSeverityClass = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'medium': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'low': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  return (
    <div className="flex-1 p-8">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-indigo-400" />
            Violation Review
          </h1>
          <p className="text-gray-400">Review and manage detected traffic violations.</p>
        </div>
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden p-1 mr-2">
          {['all', 'pending_review', 'approved', 'rejected'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status as any)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
                statusFilter === status 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>
        <button 
          onClick={loadViolations}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-md flex items-center gap-2 transition-colors border border-gray-700"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
      ) : filteredViolations.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <ShieldAlert className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-300">No violations found</h3>
          <p className="text-gray-500 mt-2">There are no violations matching the current filter.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredViolations.map((violation) => {
            const meta = violation.metadata as any || {};
            
            return (
              <div key={violation.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col md:flex-row gap-6 hover:border-gray-700 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider ${getSeverityClass(violation.severity)}`}>
                      {violation.severity}
                    </span>
                    <h3 className="text-lg font-semibold capitalize">{violation.type.replace('_', ' ')}</h3>
                    <div className="ml-auto flex items-center gap-2 text-sm text-gray-400">
                      {getStatusIcon(violation.status)}
                      <span className="capitalize">{violation.status.replace('_', ' ')}</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Time</div>
                      <div className="text-sm font-medium">{new Date(violation.timestamp).toLocaleString()}</div>
                    </div>
                    {meta.speed && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Detected Speed</div>
                        <div className="text-sm font-medium text-red-400">{Math.round(meta.speed)} km/h</div>
                      </div>
                    )}
                    {meta.speed_limit && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Speed Limit</div>
                        <div className="text-sm font-medium text-gray-300">{meta.speed_limit} km/h</div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Track ID</div>
                      <div className="text-sm font-medium font-mono">#{meta.track_id || 'N/A'}</div>
                    </div>
                  </div>
                  
                  {meta.ocr_status && (
                    <div className="mb-4 bg-gray-950 p-4 rounded-lg border border-gray-800 flex items-start gap-4">
                      <div className="bg-gray-900 w-24 h-12 flex items-center justify-center rounded border border-gray-700 overflow-hidden shrink-0">
                        {meta.plate_crop_path ? (
                          <SecureImage path={meta.plate_crop_path} alt="Plate crop" className="max-w-full max-h-full object-contain" />
                        ) : (
                          <Car className="text-gray-600 w-6 h-6" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-sm font-semibold tracking-wider bg-gray-800 px-2 py-0.5 rounded text-gray-200">
                            {meta.plate_text || 'UNKNOWN'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {meta.plate_confidence ? `${Math.round(meta.plate_confidence * 100)}% Conf.` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={`capitalize ${meta.ocr_status === 'completed' ? 'text-green-400' : meta.ocr_status === 'failed' ? 'text-red-400' : 'text-yellow-400'}`}>
                            Status: {meta.ocr_status}
                          </span>
                          {meta.ocr_status !== 'completed' && meta.plate_crop_path && (
                            <button 
                              onClick={() => handleRetryOcr(violation)}
                              disabled={meta.ocr_status === 'pending'}
                              className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className="w-3 h-3" /> Retry OCR
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {meta.evidence_metadata && (
                    <div className="bg-gray-950 p-3 rounded-lg border border-gray-800 mt-4 text-xs font-mono text-gray-400 overflow-x-auto">
                      <div className="text-gray-500 mb-1">Evidence Summary:</div>
                      {JSON.stringify(meta.evidence_metadata)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

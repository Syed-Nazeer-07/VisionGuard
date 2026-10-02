import { useState, useEffect } from 'react';
import { ClipboardCheck, CheckCircle, XCircle, Clock, ShieldAlert, Image as ImageIcon } from 'lucide-react';
import { db } from '../services/db';
import type { Violation } from '../services/db';
import { useAuthStore } from '../store/auth';
import { SecureImage } from '../components/ui/SecureImage';

export default function ReviewQueue() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending_review' | 'approved' | 'rejected' | 'all'>('pending_review');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { role } = useAuthStore();
  const canReview = role === 'Authority' || role === 'Admin';

  const fetchViolations = async () => {
    try {
      setLoading(true);
      // Depending on scale, we would pass filters to db.ts, but for this milestone we fetch and filter locally
      const data = await db.violations.list(500); 
      setViolations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch review queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchViolations();
  }, []);

  const filteredViolations = violations
    .filter(v => filter === 'all' || v.status === filter)
    .sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sort === 'newest' ? timeB - timeA : timeA - timeB;
    });

  const handleReview = async (status: 'approved' | 'rejected') => {
    if (!selectedViolation) return;
    if (!canReview) {
      setError('You do not have permission to review violations.');
      return;
    }
    
    try {
      setActionLoading(true);
      setError(null);
      
      if (status === 'approved') {
        await db.violations.approveViolation(selectedViolation.id, notes);
      } else {
        await db.violations.rejectViolation(selectedViolation.id, notes);
      }
      
      setViolations(prev => prev.map(v => v.id === selectedViolation.id ? { ...v, status, review_notes: notes } : v));
      setSelectedViolation(null);
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to submit review');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 mb-2">
            <ClipboardCheck className="w-8 h-8 text-indigo-500" />
            Human Review Queue
          </h1>
          <p className="text-gray-400">Review pending violations to ensure accuracy before enforcement.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden p-1">
            {['pending_review', 'approved', 'rejected', 'all'].map(status => (
              <button
                key={status}
                onClick={() => setFilter(status as any)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
                  filter === status ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {status.replace('_', ' ')}
              </button>
            ))}
          </div>
          <select 
            value={sort} 
            onChange={(e) => setSort(e.target.value as any)}
            className="bg-gray-900 border border-gray-800 text-gray-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading queue...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List View */}
          <div className="lg:col-span-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[70vh]">
            <div className="p-4 border-b border-gray-800 bg-gray-900/50">
              <h2 className="font-semibold text-gray-200">Queue ({filteredViolations.length})</h2>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-2">
              {filteredViolations.map(violation => {
                const meta = violation.metadata as any;
                const isSelected = selectedViolation?.id === violation.id;
                
                return (
                  <button
                    key={violation.id}
                    onClick={() => { setSelectedViolation(violation); setNotes(violation.review_notes || ''); setError(null); }}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      isSelected 
                        ? 'bg-indigo-900/30 border-indigo-500 shadow-md' 
                        : 'bg-gray-950 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-gray-200 capitalize">{violation.type.replace('_', ' ')}</span>
                      <span className={`text-xs px-2 py-0.5 rounded capitalize ${
                        violation.status === 'approved' ? 'bg-green-900/50 text-green-400' :
                        violation.status === 'rejected' ? 'bg-red-900/50 text-red-400' :
                        'bg-yellow-900/50 text-yellow-400'
                      }`}>
                        {violation.status.replace('_', ' ')}
                      </span>
                    </div>
                    
                    <div className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                      <Clock className="w-3 h-3" />
                      {new Date(violation.timestamp).toLocaleString()}
                    </div>
                    
                    <div className="flex items-center gap-3 mt-3">
                      {meta?.plate_text && (
                        <div className="bg-gray-800 px-2 py-1 rounded text-xs font-mono font-semibold tracking-wider text-gray-200 border border-gray-700">
                          {meta.plate_text}
                        </div>
                      )}
                      {meta?.speed && (
                        <div className="text-xs text-red-400 font-semibold">
                          {Math.round(meta.speed)} km/h
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
              {filteredViolations.length === 0 && (
                <div className="text-center py-12 text-gray-600 text-sm">
                  No violations match the current filter.
                </div>
              )}
            </div>
          </div>

          {/* Details View */}
          <div className="lg:col-span-2">
            {selectedViolation ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden h-full flex flex-col">
                <div className="p-6 border-b border-gray-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-white capitalize mb-1">
                        {selectedViolation.type.replace('_', ' ')}
                      </h2>
                      <div className="text-sm text-gray-400 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {new Date(selectedViolation.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                      selectedViolation.status === 'approved' ? 'bg-green-900/50 text-green-400 border border-green-800' :
                      selectedViolation.status === 'rejected' ? 'bg-red-900/50 text-red-400 border border-red-800' :
                      'bg-yellow-900/50 text-yellow-400 border border-yellow-800'
                    }`}>
                      {selectedViolation.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>
                
                <div className="p-6 flex-1 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-300 border-b border-gray-800 pb-2">Violation Details</h3>
                      
                      <div className="grid grid-cols-2 gap-y-4">
                        <div>
                          <div className="text-xs text-gray-500">Camera ID</div>
                          <div className="text-sm font-mono mt-1 text-gray-300">{(selectedViolation as any).cameras?.name || selectedViolation.camera_id.slice(0,8)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Track ID</div>
                          <div className="text-sm font-mono mt-1 text-gray-300">#{(selectedViolation.metadata as any)?.track_id}</div>
                        </div>
                        {(selectedViolation.metadata as any)?.speed && (
                          <>
                            <div>
                              <div className="text-xs text-gray-500">Detected Speed</div>
                              <div className="text-sm font-semibold mt-1 text-red-400">{Math.round((selectedViolation.metadata as any).speed)} km/h</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Speed Limit</div>
                              <div className="text-sm font-semibold mt-1 text-gray-300">{(selectedViolation.metadata as any).speed_limit} km/h</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-300 border-b border-gray-800 pb-2">LPR & OCR</h3>
                      {(selectedViolation.metadata as any)?.plate_crop_path ? (
                        <div className="flex gap-4 items-start">
                          <div className="bg-gray-950 p-2 rounded border border-gray-800">
                            <SecureImage 
                              path={(selectedViolation.metadata as any).plate_crop_path} 
                              alt="License Plate" 
                              className="h-12 object-contain"
                            />
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold tracking-widest text-white">
                              {(selectedViolation.metadata as any).plate_text || 'UNKNOWN'}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Confidence: {Math.round(((selectedViolation.metadata as any).plate_confidence || 0) * 100)}%
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 italic">No plate detected</div>
                      )}
                    </div>
                  </div>

                  {/* Evidence Snapshot (Mocked for now since not implemented fully yet, but space reserved) */}
                  <div className="mb-8">
                    <h3 className="font-semibold text-gray-300 border-b border-gray-800 pb-2 mb-4">Evidence Snapshot</h3>
                    <div className="bg-gray-950 border border-gray-800 rounded-lg h-64 flex items-center justify-center text-gray-600">
                      {selectedViolation.snapshot_url ? (
                        <SecureImage path={selectedViolation.snapshot_url} alt="Evidence" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <ImageIcon className="w-8 h-8 opacity-50" />
                          <span>No snapshot available</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {selectedViolation.status !== 'pending_review' && (
                    <div className="mb-4">
                      <h3 className="font-semibold text-gray-300 border-b border-gray-800 pb-2 mb-4">Review Information</h3>
                      <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 text-sm text-gray-300">
                        <div className="mb-2"><strong>Reviewed At:</strong> {selectedViolation.reviewed_at ? new Date(selectedViolation.reviewed_at).toLocaleString() : 'N/A'}</div>
                        <div><strong>Notes:</strong> {selectedViolation.review_notes || <span className="text-gray-600 italic">No notes provided.</span>}</div>
                      </div>
                    </div>
                  )}

                </div>
                
                {/* Review Actions */}
                <div className="p-6 border-t border-gray-800 bg-gray-900/50">
                  {selectedViolation.status === 'pending_review' ? (
                    canReview ? (
                      <div className="space-y-4">
                        <textarea
                          placeholder="Add review notes (optional)..."
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 focus:ring-indigo-500 focus:border-indigo-500"
                          rows={3}
                        />
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => handleReview('rejected')}
                            disabled={actionLoading}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-gray-800 text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors border border-gray-700 disabled:opacity-50"
                          >
                            <XCircle className="w-5 h-5" /> Reject
                          </button>
                          <button
                            onClick={() => handleReview('approved')}
                            disabled={actionLoading}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle className="w-5 h-5" /> Approve
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 text-center text-sm text-gray-400">
                        You do not have permission to review violations. (Viewer role)
                      </div>
                    )
                  ) : (
                    <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 text-center text-sm text-gray-400">
                      This violation has already been {selectedViolation.status.replace('_', ' ')}.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Select a violation from the queue to review.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

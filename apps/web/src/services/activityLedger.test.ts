import { describe, expect, it } from 'vitest';
import { changeIncidentReviewStatus, clearResolvedCloudWarning, mergeEstimatedSpeeds, summarizeActivity, type AnalysisRecord } from './activityLedger';

function record(id: string, vehicles: Record<string, { id:number; type:string;confidence:number;firstSeenAt:number;lastSeenAt:number;observations:number;estimatedSpeedKmh:number|null }>): AnalysisRecord {
  return {
    id, sourceName:'Test video', sourceType:'uploaded-video',
    createdAt:100, updatedAt:200, analyzedFrames:100, maximumVisibleVehicles:2,
    vehicles, violations:[]
  };
}
const a = {id:1,type:'car',confidence:.87,firstSeenAt:0,lastSeenAt:12,observations:45,estimatedSpeedKmh:20};

describe('persistent analysis aggregation',()=>{
  it('counts unique track IDs per run, not every detected frame',()=>{
    const data = summarizeActivity([record('a',{'1':a,'2':{...a,id:2,type:'bus'}})]);
    expect(data.vehicles).toBe(2);
    expect(data.analyzedFrames).toBe(100);
    expect(data.distribution.car).toBe(1);
    expect(data.distribution.bus).toBe(1);
    expect(data.violations).toBe(0);
  });
  it('counts separate runs without manufacturing violations',()=>{
    const data = summarizeActivity([record('a',{'1':a}),record('b',{'1':a})]);
    expect(data.runs).toBe(2);
    expect(data.vehicles).toBe(2);
    expect(data.violations).toBe(0);
  });
});

describe('estimated speed persistence',()=>{
  it('updates an already-detected vehicle without manufacturing extra tracks',()=>{
    const original = {'1':{...a,estimatedSpeedKmh:null}, '2':{...a,id:2,estimatedSpeedKmh:0}};
    const next = mergeEstimatedSpeeds(original,[{id:1,speedKmh:34.5},{id:999,speedKmh:70}]);
    expect(Object.keys(next)).toHaveLength(2);
    expect(next['1'].estimatedSpeedKmh).toBe(34.5);
    expect(next['2'].estimatedSpeedKmh).toBe(0);
    expect(original['1'].estimatedSpeedKmh).toBeNull();
  });
  it('does not save imagined speeds from short-term prediction',()=>{
    const original = {'1':{...a,estimatedSpeedKmh:15}};
    expect(mergeEstimatedSpeeds(original,[{id:1,speedKmh:155,isPredicted:true}])).toBe(original);
  });
  it('rejects impossible measurements and avoids needless writes for jitter',()=>{
    const original = {'1':{...a,estimatedSpeedKmh:35}};
    expect(mergeEstimatedSpeeds(original,[{id:1,speedKmh:NaN}])).toBe(original);
    expect(mergeEstimatedSpeeds(original,[{id:1,speedKmh:-9}])).toBe(original);
    expect(mergeEstimatedSpeeds(original,[{id:1,speedKmh:900}])).toBe(original);
    expect(mergeEstimatedSpeeds(original,[{id:1,speedKmh:35.4}])).toBe(original);
  });
});

describe('cloud reconnect warnings', () => {
  it('clears obsolete cloud warnings when metadata synchronization succeeds', () => {
    expect(clearResolvedCloudWarning('Cloud sync unavailable; activity remains saved locally. Timeout')).toBeNull();
    expect(clearResolvedCloudWarning('Cloud backup unavailable; saved locally. Timeout')).toBeNull();
  });
  it('does not conceal local save errors or unrelated messages', () => {
    expect(clearResolvedCloudWarning('Local activity save failed')).toBe('Local activity save failed');
    expect(clearResolvedCloudWarning('Local or cloud activity save warning: disk full')).toBe('Local or cloud activity save warning: disk full');
    expect(clearResolvedCloudWarning(null)).toBeNull();
  });
});

describe('persisted review decisions', () => {
  const reviewEvent = {
    id: 'auto:speed_estimate_review:42',
    trackId: 42,
    type: 'speed_estimate_review',
    observedAt: 123,
    status: 'pending_review' as const,
    evidenceNote: 'Unverified speed estimate; check footage.',
  };
  const session = { ...record('first', {'1':a}), violations: [reviewEvent] };

  it('updates a single incident while retaining the original evidence and vehicle history', () => {
    const input = [session, record('other', {})];
    const result = changeIncidentReviewStatus(input,'first',reviewEvent.id,'approved',201);
    expect(result).not.toBe(input);
    expect(result[0].vehicles).toBe(session.vehicles);
    expect(result[0].violations[0]).toMatchObject({
      id: reviewEvent.id, status: 'approved', trackId: 42,
      observedAt: 123, evidenceNote: reviewEvent.evidenceNote,
    });
    expect(result[0].updatedAt).toBe(201);
    expect(input[0].violations[0].status).toBe('pending_review');
    expect(result[1]).toBe(input[1]);
  });
  it('makes rapid decisions monotonically newer for cloud synchronization', () => {
    const marked = changeIncidentReviewStatus([session],'first',reviewEvent.id,'rejected',200);
    expect(marked[0].updatedAt).toBe(201);
    const reopened = changeIncidentReviewStatus(marked,'first',reviewEvent.id,'pending_review',200);
    expect(reopened[0].updatedAt).toBe(202);
  });
  it('does not mutate or write when an event is missing or already has the target status', () => {
    const input = [session];
    expect(changeIncidentReviewStatus(input,'other',reviewEvent.id,'approved')).toBe(input);
    expect(changeIncidentReviewStatus(input,'first','missing','approved')).toBe(input);
    expect(changeIncidentReviewStatus(input,'first',reviewEvent.id,'pending_review')).toBe(input);
  });
  it('treats reviewed and dismissed flags as stored observations, not new violations', () => {
    const input = [session];
    const marked = changeIncidentReviewStatus(input,'first',reviewEvent.id,'approved');
    const dismissed = changeIncidentReviewStatus(marked,'first',reviewEvent.id,'rejected');
    expect(summarizeActivity(dismissed)).toMatchObject({
      violations: 1, pendingReviews: 0, reviewedFlags: 0, dismissedFlags: 1,
    });
    expect(summarizeActivity(input)).toMatchObject({
      violations: 1, pendingReviews: 1, reviewedFlags: 0, dismissedFlags: 0,
    });
  });
});

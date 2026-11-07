import { describe, expect, it } from 'vitest';
import { reconcileAnalysisRun, readCloudAnalysisRow } from './activityReconciliation';
import type { AnalysisRecord, VehicleRecord, ViolationRecord } from './activityLedger';

const vehicle = (id: number, observations = 5, lastSeenAt = 3): VehicleRecord => ({
  id, type: 'car', confidence: .8, firstSeenAt: 1,
  lastSeenAt, observations, estimatedSpeedKmh: 32,
});
const incident = (status: ViolationRecord['status'], updated?: number): ViolationRecord => ({
  id: 'auto:speed:1', trackId: 1, type: 'speed_estimate_review',
  observedAt: 123, status,
  evidenceNote: 'Unverified optical estimate; human review required.',
  ...(updated === undefined ? {} : { statusUpdatedAt: updated }),
});
const record = (updatedAt: number, overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id:'run-1', sourceName:'test.mp4', sourceType:'uploaded-video',
  createdAt: 100, updatedAt, analyzedFrames: 10, maximumVisibleVehicles:1,
  vehicles:{'1':vehicle(1)},violations:[incident('pending_review')],...overrides,
});

describe('account-scoped analysis conflict resolution', () => {
  it('uses the server copy without another write when it already has everything', () => {
    const cloud = record(400, { violations: [incident('approved', 400)] });
    const local = record(200);
    const result = reconcileAnalysisRun(local,cloud,400);
    expect(result).toEqual({ record: cloud, needsUpload: false });
  });
  it('preserves a newer reviewed decision even if unrelated cloud video frames are newer', () => {
    const local = record(500, { violations:[incident('rejected',500)] });
    const cloud = record(800, { analyzedFrames: 20, violations:[incident('pending_review')] });
    const result = reconcileAnalysisRun(local,cloud,800);
    expect(result.needsUpload).toBe(true);
    expect(result.record.updatedAt).toBe(801);
    expect(result.record.violations[0].status).toBe('rejected');
    expect(result.record.violations[0].statusUpdatedAt).toBe(500);
    expect(result.record.analyzedFrames).toBe(20);
  });
  it('prefers the newest explicit reviewer decision when both sides changed it', () => {
    const local = record(700,{violations:[incident('approved',700)]});
    const cloud = record(600,{violations:[incident('rejected',550)]});
    const result = reconcileAnalysisRun(local,cloud,600);
    expect(result.record.violations[0].status).toBe('approved');
    expect(result.needsUpload).toBe(true);
  });
  it('includes independent incident additions and separate tracked vehicles', () => {
    const local = record(500,{
      vehicles:{'1':vehicle(1,8,5),'2':vehicle(2)},
      violations:[incident('pending_review'),
        {id:'manual-5',trackId:null,type:'observed_event',observedAt:500,
          status:'pending_review',evidenceNote:'Observed road event'}],
    });
    const cloud = record(600, {vehicles:{'1':vehicle(1,10,6),'3':vehicle(3)}});
    const result = reconcileAnalysisRun(local,cloud,650);
    expect(Object.keys(result.record.vehicles).sort()).toEqual(['1','2','3']);
    expect(result.record.vehicles['1'].observations).toBe(10);
    expect(result.record.violations.map(e=>e.id)).toContain('manual-5');
    expect(result.record.updatedAt).toBe(651);
  });
  it('does not duplicate incident IDs or inflate observations on repeated conflict retries', () => {
    const local = record(500,{violations:[incident('approved',500)]});
    const remote = record(400);
    const one = reconcileAnalysisRun(local,remote,400);
    const two = reconcileAnalysisRun(one.record,one.record,one.record.updatedAt);
    expect(one.record.violations).toHaveLength(1);
    expect(two.needsUpload).toBe(false);
    expect(two.record.analyzedFrames).toBe(10);
  });
  it('fails closed on mixed session IDs, instead of merging different users or footage', () => {
    expect(() => reconcileAnalysisRun(record(1),{...record(2),id:'run-2'}))
      .toThrow(/different analysis sessions/);
  });
  it('does not lose the original incident evidence when synchronizing decisions', () => {
    const local = record(800,{violations:[{...incident('approved',700),evidenceNote:''}]});
    const remote = record(500,{violations:[incident('pending_review')]});
    const outcome = reconcileAnalysisRun(local,remote,500);
    expect(outcome.record.violations[0].status).toBe('approved');
    expect(outcome.record.violations[0].evidenceNote).toContain('Unverified');
  });
});

describe('cloud upsert acknowledgement validation', () => {
  const payload = record(500);
  it('reads the actual database revision instead of assuming the sent timestamp', () => {
    const response = readCloudAnalysisRow({
      run_id: payload.id, payload, updated_at: new Date(700).toISOString(),
    });
    expect(response.revisionAt).toBe(700);
    expect(response.record).toBe(payload);
  });
  it('does not accept a missing row, mismatched session or malformed payload', () => {
    expect(() => readCloudAnalysisRow(null)).toThrow(/invalid analysis row/);
    expect(() => readCloudAnalysisRow({
      run_id: 'other', payload, updated_at: new Date(700).toISOString()
    })).toThrow(/invalid analysis row/);
    expect(() => readCloudAnalysisRow({
      run_id: payload.id, payload: {...payload, violations:null},
      updated_at: new Date(700).toISOString()
    })).toThrow(/invalid analysis row/);
  });
  it('rejects an unparseable or dishonest server revision', () => {
    expect(() => readCloudAnalysisRow({
      run_id:payload.id,payload,updated_at:'invalid'
    })).toThrow(/invalid analysis revision/);
  });
});

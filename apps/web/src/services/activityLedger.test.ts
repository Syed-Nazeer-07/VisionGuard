import { describe, expect, it } from 'vitest';
import { mergeEstimatedSpeeds, summarizeActivity, type AnalysisRecord } from './activityLedger';

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

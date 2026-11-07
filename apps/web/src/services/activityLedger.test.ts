import { describe, expect, it } from 'vitest';
import { summarizeActivity, type AnalysisRecord } from './activityLedger';

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

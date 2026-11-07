import { describe, it, expect } from 'vitest';
import { AutomaticIncidentDetector, type IncidentObservation } from './automaticIncidentDetector';
function car(id: number, speedKmh: number | null, extra: Partial<IncidentObservation> = {}): IncidentObservation {
  return { id, className:'car', confidence:.92, x:120,y:90,w:42,h:28,speedKmh,...extra };
}
describe('automatic incident review candidates', () => {
  it('does not generate incidents from a single optical spike or predicted box', () => {
    const detector = new AutomaticIncidentDetector();
    expect(detector.ingest([car(1,120)], 0)).toEqual([]);
    for (let i=1;i<15;i++) expect(detector.ingest([car(1,120,{isPredicted:true})],i*.25)).toEqual([]);
  });
  it('flags one sustained speed review, never verified speeding', () => {
    const d = new AutomaticIncidentDetector(), events = [];
    for(let i=0;i<15;i++) events.push(...d.ingest([car(1,95,{x:120+i*5})],i*.25));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({trackId:1,type:'speed_estimate_review'});
    expect(events[0].evidenceNote).toContain('NOT verified');
  });
  it('does not flag a motionless box from stale, high speed estimates', () => {
    const detector = new AutomaticIncidentDetector();
    const events = [];
    for (let i = 0; i < 25; i++) {
      events.push(...detector.ingest([car(1, 120)], i * .25));
    }
    expect(events).toEqual([]);
  });
  it('rejects alternating noise and low-confidence detections', () => {
    const d = new AutomaticIncidentDetector(), events = [];
    for(let i=0;i<16;i++) events.push(...d.ingest([
      car(1,i%2?35:110),car(2,140,{confidence:.3})
    ],i*.25));
    expect(events).toEqual([]);
  });
  it('resets during a seek or disconnected long gap', () => {
    const d = new AutomaticIncidentDetector();
    for(let i=0;i<3;i++) d.ingest([car(1,90)],10+i*.25);
    expect(d.ingest([car(1,90)],13)).toEqual([]);
    expect(d.ingest([car(1,90)],2)).toEqual([]);
  });
  it('automatically flags one 10-second stationary vehicle surrounded by moving peers', () => {
    const d = new AutomaticIncidentDetector(), events = [];
    for(let i=0;i<56;i++) events.push(...d.ingest([
      car(1,0),car(2,22,{x:200+i*.3}),car(3,18,{x:300+i*.3})
    ],i*.25));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({trackId:1,type:'stationary_vehicle_review'});
  });
  it('does not confuse separate passing cars with simultaneous traffic evidence', () => {
    const d = new AutomaticIncidentDetector();
    const events = [];
    for (let i = 0; i < 60; i++) {
      const peer = i % 2 === 0 ? car(2, 25) : car(3, 25);
      events.push(...d.ingest([car(1, 0), peer], i * .25));
    }
    expect(events).toEqual([]);
  });
  it('does not treat an isolated parked car as an incident', () => {
    const d = new AutomaticIncidentDetector(), events = [];
    for(let i=0;i<60;i++) events.push(...d.ingest([car(1,0)],i*.25));
    expect(events).toEqual([]);
  });
  it('rejects an apparently stationary box that keeps drifting', () => {
    const d = new AutomaticIncidentDetector(), events = [];
    for(let i=0;i<60;i++) events.push(...d.ingest([
      car(1,0,{x:100+i*2.5}),car(2,20),car(3,22)
    ],i*.25));
    expect(events).toEqual([]);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxIoU, evaluateTracking, gateFailures, FORMAT } from './evaluate-tracking.mjs';

const box=(x,w=20)=>({x,y:40,w,h:20});
const gt=(id,x,cls='car')=>({id,className:cls,box:box(x)});
const pred=(id,x,cls='car')=>({id,className:cls,box:box(x)});
const f=(time,groundTruth=[],predictions=[],exitedIds=[])=>({
  time,width:200,height:100,groundTruth,predictions,exitedIds
});
const trace=(...frames)=>({format:FORMAT,frames});

test('IoU: exact overlapping and nonoverlapping boxes',()=>{
  assert.equal(boxIoU(box(10),box(10)),1);
  assert.equal(boxIoU(box(10),box(100)),0);
});
test('perfect tracking yields 100% matches and zero ID switches',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',20)],[pred(1,20)]),
    f(.1,[gt('A',25)],[pred(1,25)]),f(.2,[gt('A',30)],[pred(1,30)])));
  assert.equal(score.precision,1);assert.equal(score.recall,1);
  assert.equal(score.f1,1);assert.equal(score.idSwitches,0);
});
test('class confusion counts both false positive and false negative',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',20,'truck')],[pred(1,20,'car')])));
  assert.equal(score.tp,0);assert.equal(score.fp,1);assert.equal(score.fn,1);
  assert.equal(score.perClass.truck.fn,1);assert.equal(score.perClass.car.fp,1);
});
test('detects duplicate boxes and false detections',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',20),gt('B',95)],
    [pred(1,20),pred(2,20)])));
  assert.equal(score.tp,1);assert.equal(score.fp,1);assert.equal(score.fn,1);
  assert.equal(score.duplicatePredictionPairs,1);assert.equal(score.f1,.5);
});
test('ID switches count only for short gaps',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',20)],[pred(1,20)]),
    f(.1,[gt('A',25)],[pred(2,25)]),f(2,[gt('A',30)],[pred(3,30)])));
  assert.equal(score.idSwitches,1);
});
test('annotation-marked exits measure lingering ghost boxes',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',180)],[pred(7,180)]),
    f(.1,[],[pred(7,190)],['A']),f(.2,[],[pred(7,190)]),f(.3,[],[])));
  assert.equal(score.exitGhostFrames,2);
  assert.ok(Math.abs(score.maxExitGhostSeconds-.1)<1e-8);
  assert.equal(score.fp,2);
});
test('occlusion without explicit exit does not get mislabelled as ghost',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',180)],[pred(7,180)]),
    f(.1,[],[pred(7,190)])));
  assert.equal(score.exitGhostFrames,0);assert.equal(score.fp,1);
});
test('invalid ground truth and timestamps fail rather than fake a score',()=>{
  assert.throws(()=>evaluateTracking({frames:[]}),/Expected/);
  assert.throws(()=>evaluateTracking(trace(f(0),f(0))),/Invalid frame/);
  assert.throws(()=>evaluateTracking(trace(f(0,[gt('A',20),gt('A',40)]))),
    /Duplicate ground-truth/);
  assert.throws(()=>evaluateTracking(trace(f(0,[gt('A',20)],[],['A']))),
    /first ABSENT/);
});
test('threshold gates give an explicit failure, not a false success',()=>{
  const score=evaluateTracking(trace(f(0,[gt('A',20)],[])));
  assert.equal(gateFailures(score,{minRecall:.8,maxGhostFrames:0}).length,1);
  assert.throws(()=>gateFailures(score,{minPrecision:4}),/Invalid quality/);
});

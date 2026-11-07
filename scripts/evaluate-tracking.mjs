/** Annotation-driven scoring for browser tracking. Does not run YOLO.
 * Real results require human-labelled frames AND aligned browser predictions.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORMAT = 'visionguard-tracking-eval/v1';
const IOU_THRESHOLD = 0.5;
const MAX_ID_GAP_SECONDS = 0.5;
const rate = (n, total) => total ? n / total : 0;
const metrics = (tp, fp, fn) => {
  const precision = rate(tp, tp + fp), recall = rate(tp, tp + fn);
  return { precision, recall, f1: rate(2 * precision * recall, precision + recall) };
};
export function boxIoU(a, b) {
  const x1 = Math.max(a.x-a.w/2,b.x-b.w/2), y1 = Math.max(a.y-a.h/2,b.y-b.h/2);
  const x2 = Math.min(a.x+a.w/2,b.x+b.w/2), y2 = Math.min(a.y+a.h/2,b.y+b.h/2);
  const area = Math.max(0,x2-x1)*Math.max(0,y2-y1);
  const union = a.w*a.h+b.w*b.h-area;
  return union > 0 ? area/union : 0;
}
function normalize(record, name) {
  if (!record || !['number','string'].includes(typeof record.id) ||
      !String(record.id).trim() || typeof record.className !== 'string' ||
      !record.className.trim() || !record.box ||
      ![record.box.x,record.box.y,record.box.w,record.box.h].every(Number.isFinite) ||
      record.box.w <= 0 || record.box.h <= 0) {
    throw Error('Invalid ' + name + ': needs id, className, positive finite center box.');
  }
  return { ...record, id: String(record.id), className:record.className.trim().toLowerCase() };
}
export function evaluateTracking(data) {
  if (!data || data.format !== FORMAT || !Array.isArray(data.frames) || !data.frames.length)
    throw Error('Expected ' + FORMAT + ' with at least one annotated frame.');
  let tp=0,fp=0,fn=0,idSwitches=0,duplicates=0,exitGhostFrames=0;
  let maxExitGhostSeconds=0,matchedIoU=0,previousTime=-Infinity;
  const classes=new Map(), ids=new Map(), exited=new Map();
  const classTotals = name => {
    if(!classes.has(name)) classes.set(name,{tp:0,fp:0,fn:0});
    return classes.get(name);
  };
  for(let frameIndex=0;frameIndex<data.frames.length;frameIndex++) {
    const frame=data.frames[frameIndex];
    if(!frame || !Number.isFinite(frame.time) || frame.time<0 || frame.time<=previousTime ||
       !Number.isFinite(frame.width) || frame.width<=0 ||
       !Number.isFinite(frame.height) || frame.height<=0 ||
       !Array.isArray(frame.groundTruth) || !Array.isArray(frame.predictions) ||
       (frame.exitedIds!==undefined && !Array.isArray(frame.exitedIds)))
      throw Error('Invalid frame/time/annotations at index '+frameIndex);
    const gt=frame.groundTruth.map((v,i)=>normalize(v,'groundTruth['+i+']'));
    const pred=frame.predictions.map((v,i)=>normalize(v,'predictions['+i+']'));
    const gtIds=new Set(gt.map(x=>x.id));
    if(gtIds.size!==gt.length) throw Error('Duplicate ground-truth IDs at frame '+frameIndex);
    for(const id of frame.exitedIds || []) {
      const key=String(id);
      if(gtIds.has(key)) throw Error('An exit must be labelled at the first ABSENT frame.');
      const last=ids.get(key);
      if(last) exited.set(key,{ predictedId:last.predictedId, firstAbsentAt:frame.time });
    }
    // Class-aware, one-to-one overlap assignment. Class confusion is FP+FN.
    const pairs=[];
    for(let a=0;a<gt.length;a++) for(let b=0;b<pred.length;b++) {
      if(gt[a].className!==pred[b].className)continue;
      const overlap=boxIoU(gt[a].box,pred[b].box);
      if(overlap>=IOU_THRESHOLD)pairs.push({a,b,overlap});
    }
    pairs.sort((x,y)=>y.overlap-x.overlap);
    const matchedGt=new Set(),matchedPred=new Set();
    for(const {a,b,overlap} of pairs) {
      if(matchedGt.has(a)||matchedPred.has(b))continue;
      matchedGt.add(a);matchedPred.add(b);
      tp++;matchedIoU+=overlap;classTotals(gt[a].className).tp++;
      const previous=ids.get(gt[a].id);
      if(previous && previous.predictedId!==pred[b].id &&
         frame.time-previous.time<=MAX_ID_GAP_SECONDS)idSwitches++;
      ids.set(gt[a].id,{predictedId:pred[b].id,time:frame.time});
    }
    for(let i=0;i<gt.length;i++) if(!matchedGt.has(i)) {
      fn++;classTotals(gt[i].className).fn++;
    }
    for(let i=0;i<pred.length;i++) if(!matchedPred.has(i)) {
      fp++;classTotals(pred[i].className).fp++;
    }
    for(let a=0;a<pred.length;a++)for(let b=a+1;b<pred.length;b++) {
      if(pred[a].className===pred[b].className&&boxIoU(pred[a].box,pred[b].box)>=.85)duplicates++;
    }
    const acceptedIds=new Set([...matchedPred].map(i=>pred[i].id));
    for(const [gtId,info] of exited) {
      if(gtIds.has(gtId)){exited.delete(gtId);continue;}
      if(pred.some(p=>p.id===info.predictedId)&&!acceptedIds.has(info.predictedId)) {
        exitGhostFrames++;
        maxExitGhostSeconds=Math.max(maxExitGhostSeconds,frame.time-info.firstAbsentAt);
      } else exited.delete(gtId);
    }
    previousTime=frame.time;
  }
  return {
    evaluationType:'annotation-comparison-not-real-world-validation',
    frames:data.frames.length,tp,fp,fn,...metrics(tp,fp,fn),
    meanMatchedIoU:rate(matchedIoU,tp),idSwitches,
    duplicatePredictionPairs:duplicates,exitGhostFrames,maxExitGhostSeconds,
    perClass:Object.fromEntries([...classes].sort(([a],[b])=>a.localeCompare(b))
      .map(([name,c])=>[name,{...c,...metrics(c.tp,c.fp,c.fn)}])),
  };
}
export function gateFailures(result, gates={}) {
  const rules=[
    ['minPrecision','precision',false],['minRecall','recall',false],
    ['maxIdSwitches','idSwitches',true],['maxGhostFrames','exitGhostFrames',true]
  ];
  const failures=[];
  for(const [flag,field,maximum] of rules) {
    if(gates[flag]===undefined)continue;
    const limit=gates[flag];
    if(!Number.isFinite(limit)||limit<0||(!maximum&&limit>1))
      throw Error('Invalid quality threshold: '+flag);
    if(maximum?result[field]>limit:result[field]<limit)
      failures.push(field+'='+result[field]+' failed '+flag+'='+limit);
  }
  return failures;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(!args[0]||args[0].startsWith('--'))throw Error(
      'Usage: node scripts/evaluate-tracking.mjs annotated-trace.json [--min-precision=0.8] [--max-ghost-frames=0]');
    const supported={
      '--min-precision':'minPrecision','--min-recall':'minRecall',
      '--max-id-switches':'maxIdSwitches','--max-ghost-frames':'maxGhostFrames'
    };
    const gates={};
    for(const arg of args.slice(1)) {
      const pieces=arg.split('=');
      if(pieces.length!==2||!Object.hasOwn(supported,pieces[0])||pieces[1]==='')
        throw Error('Invalid quality gate: '+arg);
      gates[supported[pieces[0]]]=Number(pieces[1]);
    }
    const report=evaluateTracking(JSON.parse(readFileSync(args[0],'utf8')));
    console.log(JSON.stringify(report,null,2));
    const failures=gateFailures(report,gates);
    if(failures.length){console.error(failures.join('\n'));process.exitCode=2;}
  }catch(error){console.error(error.message);process.exitCode=1;}
}

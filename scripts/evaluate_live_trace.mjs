import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluateTracking, FORMAT } from './evaluate-tracking.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'roi-min-y': { type: 'string' },
} });
if (positionals.length < 3) {
  throw new Error('Usage: node scripts/evaluate_live_trace.mjs [--roi-min-y Y] LABELS BEFORE_TRACE AFTER_TRACE [TRACE ...]');
}

const [labels, ...traces] = await Promise.all(positionals.map(async file => JSON.parse(await readFile(file, 'utf8'))));
const minY = values['roi-min-y'] === undefined ? -Infinity : Number(values['roi-min-y']);
if (Number.isNaN(minY)) throw new Error('ROI must be a numeric source-pixel y coordinate.');
const frameKey = time => Math.round(time * 1000);
function frameIndex(file) {
  if (file.format !== FORMAT || !Array.isArray(file.frames) || !file.frames.length) {
    throw new Error('Expected a VisionGuard trace with frames.');
  }
  const index = new Map();
  for (const frame of file.frames) {
    const key = frameKey(frame.time);
    if (!Number.isFinite(frame.time) || index.has(key)) throw new Error('Trace has invalid or duplicate timestamps.');
    index.set(key, frame);
  }
  return index;
}
const indexes = traces.map(frameIndex);
frameIndex(labels);
const pendingExits = new Set();
const shared = [];
for (const frame of labels.frames) {
  for (const id of frame.exitedIds ?? []) pendingExits.add(String(id));
  for (const { id } of frame.groundTruth) pendingExits.delete(String(id));
  if (indexes.every(index => index.has(frameKey(frame.time)))) {
    shared.push({ ...frame, exitedIds: [...pendingExits] });
    pendingExits.clear();
  }
}
if (!shared.length) throw new Error('No common labeled frame timestamps. Keep the exact media time and clip in each run.');
const score = (trace, index) => evaluateTracking({
  ...labels,
  frames: shared.map(reference => {
    const observation = index.get(frameKey(reference.time));
    if (reference.width !== observation.width || reference.height !== observation.height) {
      throw new Error('The trace and labels have different source dimensions.');
    }
    return {
      ...reference,
      predictions: observation.predictions.filter(pred => pred.box.y >= minY)
    };
  })
});
console.log(JSON.stringify({
  source: labels.source, labeledFrames: labels.frames.length, sharedFrames: shared.length,
  scores: traces.map((trace, run) => ({
    traceFile: positionals[run + 1], exportedFrames: trace.frames.length, ...score(trace, indexes[run]),
    benchmark: trace.benchmark
  }))
}, null, 2));

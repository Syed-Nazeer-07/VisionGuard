import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { evaluateTracking } from './evaluate-tracking.mjs';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://localhost:3000' },
  model: { type: 'string', default: '/models/yolo11s.onnx' },
  video: { type: 'string' },
  annotations: { type: 'string' },
  out: { type: 'string' },
  repeat: { type: 'string', default: '1' },
  provider: { type: 'string', default: 'auto' },
  channel: { type: 'string' },
  executable: { type: 'string' },
  'roi-min-y': { type: 'string' },
  'replay-anchors': { type: 'string' },
  'replay-step': { type: 'string', default: '0.12' },
  isolated: { type: 'boolean' },
  headed: { type: 'boolean' },
} });
const url = new URL(values.url);
const repeat = Number(values.repeat);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !values.video || !values.annotations || !['auto', 'wasm'].includes(values.provider) ||
    !Number.isInteger(repeat) || repeat < 1) {
  throw new Error('Provide local --url, --video, --annotations, and optional --provider auto|wasm, --repeat N, --out FILE.');
}
const truth = JSON.parse(await readFile(values.annotations, 'utf8'));
if (!Array.isArray(truth.frames) || !truth.frames.length) {
  throw new Error('Provide at least one independently annotated frame.');
}
const references = new Map(truth.frames.map(frame => [frame.time, frame]));
const times = [...references.keys()];
const replay = values['replay-anchors'] ? {
  anchors: values['replay-anchors'].split(',').map(Number),
  step: Number(values['replay-step'])
} : undefined;
if (replay && (!Number.isFinite(replay.step) || replay.step < .02 || replay.step > .25 ||
    replay.anchors.some((time, index) => !Number.isFinite(time) || time < 0 ||
      (index > 0 && time <= replay.anchors[index - 1]) ||
      Math.max(...times) - time <= 0 || Math.max(...times) - time > 30))) {
  throw new Error('Replay anchors must increase and precede the last labeled frame by at most 30 s; use a 0.02–0.25 s step.');
}
const minY = values['roi-min-y'] === undefined ? -Infinity : Number(values['roi-min-y']);
if (Number.isNaN(minY)) throw new Error('ROI must be a numeric source-pixel y coordinate.');
const { chromium } = await import(process.env.VISIONGUARD_PLAYWRIGHT_MODULE || 'playwright');
const launch = { channel: values.channel, executablePath: values.executable, headless: !values.headed };
const browser = await chromium.launch(launch);

function percentiles(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = q => Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 10) / 10;
  return { p50: at(.50), p95: at(.95) };
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(new URL('/benchmark/detector.html', url).href);
  await page.locator('#video-file').setInputFiles(values.video);
  const runs = [];
  const predictions = boxes => boxes
    .filter(track => track.y >= minY)
    .map(({ id, className, x, y, w, h }, boxIndex) => ({
      id: id ?? boxIndex, className, box: { x, y, w, h }
    }));
  for (let i = 0; i < repeat; i++) {
    const run = await page.evaluate(async options => window.benchmarkDetector(options), {
      modelPath: values.model, provider: values.provider, times, replay
    });
    if (values.isolated && !run.isolated) {
      throw new Error('Restart Vite with VISIONGUARD_BENCH_ISOLATION=1 to run an isolated benchmark.');
    }
    const referenceFor = (frame, width, height) => {
        const reference = references.get(frame.mediaTime ?? frame.time);
        if (width !== reference.width || height !== reference.height) {
          throw new Error('Decoded video dimensions differ from the labeled footage.');
        }
        return reference;
    };
    let accuracy;
    if (run.replay) {
      const { width, height } = run.frames[0];
      accuracy = { replayAccuracy: run.replay.map(({ anchor, frames }) => ({
        anchor, ...evaluateTracking({
          ...truth, frames: frames.map(frame => ({
            ...referenceFor(frame, width, height), predictions: predictions(frame.tracks)
          }))
        })
      })) };
    } else {
      const score = key => evaluateTracking({
        ...truth, frames: run.frames.map(frame => ({
          ...referenceFor(frame, frame.width, frame.height), predictions: predictions(frame[key])
        }))
      });
      // Raw observations have no temporal IDs. The matcher still scores their classes and boxes.
      const { idSwitches, exitGhostFrames, maxExitGhostSeconds, ...rawAccuracy } = score('detections');
      accuracy = { rawAccuracy, matchedTrackerAccuracy: score('tracks') };
    }
    runs.push({
      ...run, firstFrameMs: run.frames[0]?.inferenceMs,
      warmWorkerMs: percentiles(run.frames.slice(1).map(frame => frame.inferenceMs)),
      captureMs: percentiles(run.frames.map(frame => frame.captureMs)),
      ...accuracy
    });
  }
  const result = { model: values.model, providerRequest: values.provider, source: truth.source, runs };
  if (values.out) await writeFile(values.out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(runs.map(({ frames, replay, ...summary }) => summary), null, 2));
} finally {
  await browser.close();
}

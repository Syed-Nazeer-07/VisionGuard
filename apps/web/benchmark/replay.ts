import { advanceOpticalTracks, takeGrayFrame, type GrayFrame } from '../src/pipeline/tracker/opticalTracking';
import { recoverBriefOpticalMisses, type PersistentTrack } from '../src/pipeline/tracker/stableVehicles';
import type { DetectorEvent } from '../src/pipeline/worker/detectorProtocol';

export async function seekFrame(video: HTMLVideoElement, time: number) {
  if (!Number.isFinite(time) || time < 0 || time >= video.duration) {
    throw new Error('A requested timestamp is outside the decoded video.');
  }
  if (video.currentTime === time) return;
  await new Promise<void>((resolve, reject) => {
    const abort = new AbortController();
    const settle = (error?: Error) => {
      clearTimeout(timeout);
      abort.abort();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => settle(new Error('Timed out seeking to ' + time)), 15_000);
    video.addEventListener('seeked', () => settle(), { signal: abort.signal });
    video.addEventListener('error', () => settle(new Error('The browser could not decode timestamp ' + time)), { signal: abort.signal });
    video.currentTime = time;
  });
}

/** Hold model cadence constant while comparing optical geometry on real pixels. */
export async function replayDetections(
  video: HTMLVideoElement,
  seeds: readonly Extract<DetectorEvent, { type: 'result' }>[],
  times: readonly number[],
  step: number,
) {
  const canvas = document.createElement('canvas');
  const lastTime = Math.max(...times);
  const runs = [];
  for (const seed of seeds) {
    const scoredTimes = times.filter(time => time >= seed.mediaTime);
    const schedule = new Set([seed.mediaTime, ...scoredTimes]);
    for (let n = 1; seed.mediaTime + n * step < lastTime; n++) {
      schedule.add(Number((seed.mediaTime + n * step).toFixed(6)));
    }
    let tracks: PersistentTrack[] = seed.tracks.map(track => ({
      ...track, lastDetectedAt: seed.mediaTime, lastOpticalAt: seed.mediaTime,
      speedKmh: null, speedIsEstimate: true
    }));
    let previous: GrayFrame | null = null;
    const frames = [];
    for (const time of [...schedule].sort((a, b) => a - b)) {
      await seekFrame(video, time);
      const current = takeGrayFrame(video, time, canvas);
      if (!current) throw new Error('Unable to sample optical features at ' + time);
      if (previous) {
        const moved = advanceOpticalTracks(tracks, previous, current);
        tracks = recoverBriefOpticalMisses(tracks, moved, previous.time, current.time,
          current.sourceWidth, current.sourceHeight);
      }
      previous = current;
      if (scoredTimes.includes(time)) frames.push({ time, tracks });
    }
    runs.push({ anchor: seed.mediaTime, frames });
  }
  return runs;
}

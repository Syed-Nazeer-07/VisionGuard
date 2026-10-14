import re

with open('apps/web/src/pipeline/tracker/speed.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_update = """
  update(trackId: number, baseBox: {x: number, y: number, w: number, h: number}, mediaTime: number): { speed: number, isOverspeed: boolean, isEstimated: boolean } | null {
    let worldPt: Point;
    let isEstimated = false;

    // Use bottom center of the bounding box for ground plane projection
    const imagePt: Point = {
      x: baseBox.x,
      y: baseBox.y + baseBox.h / 2
    };

    if (this.hMatrix) {
      worldPt = projectPoint(this.hMatrix, imagePt);
    } else {
      // Fallback pseudo-calibration for uncalibrated scenes (typical highway camera).
      // We assume an average car is ~2 meters wide, so the scene width at this vehicle's depth is 2 / baseBox.w meters.
      // We scale the normalized image coordinates by this inferred scene width to get pseudo-meters.
      // We add temporal smoothing so box-jitter doesn't cause huge speed spikes.
      const inferredWidthMeters = 2.0 / Math.max(0.01, baseBox.w);
      const inferredHeightMeters = inferredWidthMeters * 1.5; // perspective assumption
      worldPt = {
        x: imagePt.x * inferredWidthMeters,
        y: imagePt.y * inferredHeightMeters
      };
      isEstimated = true;
    }

    const state = this.history.get(trackId);

    if (!state) {
      this.history.set(trackId, { lastWorldPt: worldPt, lastTime: mediaTime, speeds: [], overspeedCount: 0 });
      return null;
    }

    const dt = mediaTime - state.lastTime;
    if (dt <= 0.001) return null;

    const dx = worldPt.x - state.lastWorldPt.x;
    const dy = worldPt.y - state.lastWorldPt.y;
    const distMeters = Math.hypot(dx, dy);

    // Limit extreme jumps
    const rawSpeedMps = distMeters / dt;
    if (rawSpeedMps > 60) {
      state.lastWorldPt = worldPt;
      state.lastTime = mediaTime;
      return null;
    }

    const rawSpeedKmh = rawSpeedMps * 3.6;
    state.speeds.push(rawSpeedKmh);
    if (state.speeds.length > this.windowSize) {
      state.speeds.shift();
    }

    const sorted = [...state.speeds].sort((a, b) => a - b);
    const medianSpeed = sorted[Math.floor(sorted.length / 2)];

    if (medianSpeed > this.speedLimit + this.tolerance) {
      state.overspeedCount++;
    } else {
      state.overspeedCount = 0;
    }

    state.lastWorldPt = worldPt;
    state.lastTime = mediaTime;

    return {
      speed: medianSpeed,
      isOverspeed: state.overspeedCount >= 3,
      isEstimated
    };
  }
"""

content = re.sub(
    r'  update\(trackId: number, baseBox.*?\n  remove',
    new_update.strip() + '\n\n  remove',
    content,
    flags=re.DOTALL
)

with open('apps/web/src/pipeline/tracker/speed.ts', 'w', encoding='utf-8') as f:
    f.write(content)

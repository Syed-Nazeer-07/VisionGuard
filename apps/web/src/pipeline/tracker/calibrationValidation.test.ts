import { describe, expect, it } from 'vitest';
import { validateVideoCalibration, videoPointFromDisplay, videoPointToDisplay } from './calibrationValidation';
import type { CalibrationData } from '../types';

const valid: CalibrationData = {
  referenceWidth: 4, referenceHeight: 15, speedLimit: 60, tolerance: 5,
  calibrationArea: [{ x: .35, y: .3 }, { x: .6, y: .3 }, { x: .8, y: .9 }, { x: .15, y: .9 }]
};

describe('measured road-plane video calibration', () => {
  it('accepts a convex quadrilateral with measured metric dimensions', () => {
    expect(validateVideoCalibration(valid)).toBeNull();
  });
  it('rejects missing, crossed, degenerate and off-frame corners', () => {
    expect(validateVideoCalibration({ ...valid, calibrationArea: [] })).toContain('four');
    expect(validateVideoCalibration({ ...valid, calibrationArea: [valid.calibrationArea[0], valid.calibrationArea[2], valid.calibrationArea[1], valid.calibrationArea[3]] })).toContain('non-crossing');
    expect(validateVideoCalibration({ ...valid, calibrationArea: [{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .3, y: .1 }, { x: .4, y: .1 }] })).toContain('non-crossing');
    expect(validateVideoCalibration({ ...valid, calibrationArea: [{ x: -1, y: .1 }, ...valid.calibrationArea.slice(1)] })).toContain('frame');
  });
  it('rejects guessed or invalid metric reference dimensions', () => {
    expect(validateVideoCalibration({ ...valid, referenceWidth: 0 })).toContain('metres');
    expect(validateVideoCalibration({ ...valid, referenceHeight: NaN })).toContain('finite');
  });
  it('maps display clicks back to source coordinates despite letterboxing', () => {
    const rect = { left: 10, top: 20, width: 400, height: 400 };
    const video = { videoWidth: 1920, videoHeight: 1080 };
    const pt = { x: .3, y: .6 };
    const display = videoPointToDisplay(pt, rect, video);
    const result = videoPointFromDisplay(rect.left + display.x, rect.top + display.y, rect, video);
    expect(result?.x).toBeCloseTo(pt.x, 5);
    expect(result?.y).toBeCloseTo(pt.y, 5);
    expect(videoPointFromDisplay(210, 30, rect, video)).toBeNull();
  });
});

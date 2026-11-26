import { describe, expect, it } from 'vitest';
import { vehicleOverlayLabels } from './vehicleOverlayLabels';

describe('vehicle type labels in live detection overlays', () => {
  it.each(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'bus/truck'])(
    'keeps the detected %s class visible in full and compact labels',
    className => {
      const labels = vehicleOverlayLabels({ id: 42, className, speedKmh: 37.4 });
      for (const text of labels) {
        expect(text.startsWith('#42 ' + className.toUpperCase() + ' ')).toBe(true);
        expect(text).toContain('≈37');
        expect(text).toContain('km/h*');
      }
    }
  );

  it('keeps the class visible even when speed has not been estimated', () => {
    const labels = vehicleOverlayLabels({ id: 6, className: 'car', speedKmh: null });
    expect(labels).toEqual(['#6 CAR — km/h*', '#6 CAR —km/h*']);
  });

  it('never shows an invalid speed or a blank class label', () => {
    const labels = vehicleOverlayLabels({ id: 3, className: ' ', speedKmh: NaN });
    expect(labels[0]).toContain('VEHICLE');
    expect(labels[1]).toContain('—');
    expect(labels.join(' ')).not.toContain('NaN');
  });
});

it('hides carried-forward speed on predicted boxes and rejects invalid ranges', () => {
  for (const data of [{ speedKmh: 90, isPredicted: true }, { speedKmh: -1 }, { speedKmh: 161 }]) {
    expect(vehicleOverlayLabels({ id: 1, className: 'car', ...data })[0]).toBe('#1 CAR — km/h*');
  }
  expect(vehicleOverlayLabels({ id: 1, className: 'car', speedKmh: 0 })[0]).toContain('≈0');
});

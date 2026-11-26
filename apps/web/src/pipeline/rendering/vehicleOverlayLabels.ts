/**
 * Vehicle labels must ALWAYS show the detected class. Compact labels used
 * to omit CAR/TRUCK/BUS completely, making working detections look broken.
 * Both variants keep the vehicle ID and a visibly estimated speed field.
 */
export interface VehicleLabelSource {
  id: number;
  className: string;
  speedKmh: number | null;
  isPredicted?: boolean;
}

export function vehicleOverlayLabels(track: VehicleLabelSource): readonly [string, string] {
  const vehicleClass = track.className.trim().toUpperCase() || 'VEHICLE';
  const speed = track.isPredicted || track.speedKmh === null || !Number.isFinite(track.speedKmh) ||
    track.speedKmh < 0 || track.speedKmh > 160
    ? '—'
    : '≈' + Math.round(track.speedKmh);

  return [
    '#' + track.id + ' ' + vehicleClass + ' ' + speed + ' km/h*',
    '#' + track.id + ' ' + vehicleClass + ' ' + speed + 'km/h*',
  ];
}

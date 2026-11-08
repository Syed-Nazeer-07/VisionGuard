/**
 * Vehicle labels must ALWAYS show the detected class. Compact labels used
 * to omit CAR/TRUCK/BUS completely, making working detections look broken.
 * Both variants keep the vehicle ID and a visibly estimated speed field.
 */
export interface VehicleLabelSource {
  id: number;
  className: string;
  speedKmh: number | null;
}

export function vehicleOverlayLabels(track: VehicleLabelSource): readonly [string, string] {
  const vehicleClass = track.className.trim().toUpperCase() || 'VEHICLE';
  const speed = track.speedKmh === null || !Number.isFinite(track.speedKmh)
    ? '—'
    : '≈' + Math.round(Math.max(0, track.speedKmh));

  return [
    '#' + track.id + ' ' + vehicleClass + ' ' + speed + ' km/h*',
    vehicleClass + '#' + track.id + ' ' + speed + 'km/h*',
  ];
}

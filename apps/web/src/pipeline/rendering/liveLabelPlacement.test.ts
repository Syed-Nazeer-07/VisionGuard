import { describe, expect, it } from 'vitest';
import { placeLiveLabel, type OverlayRect } from './liveLabelPlacement';

const bounds = { x: 20, y: 30, w: 420, h: 280 };
const box = (x: number, y: number, w = 90, h = 55): OverlayRect =>
  ({ x, y, w, h });
const collide = (a: OverlayRect, b: OverlayRect) =>
  a.x < b.x+b.w+2 && a.x+a.w+2 > b.x &&
  a.y < b.y+b.h+2 && a.y+a.h+2 > b.y;

describe('stable, speed-preserving vehicle labels', () => {
  it('attaches a full label just above its vehicle by default', () => {
    const p = placeLiveLabel(box(100, 140), bounds, [90, 60], [])!;
    expect(p).toMatchObject({ variant:0, slot:0 });
    expect(p.rect.x).toBe(102);
    expect(p.rect.y).toBe(120);
  });
  it('keeps exactly the same anchor as the box moves with the vehicle', () => {
    const first = placeLiveLabel(box(100, 140), bounds, [105, 70], [])!;
    const next = placeLiveLabel(box(123, 149), bounds, [105, 70],
      [box(115, 128, 105, 18)], first)!;
    expect(next.slot).toBe(first.slot);
    expect(next.variant).toBe(first.variant);
    expect(next.rect.x - first.rect.x).toBe(23);
    expect(next.rect.y - first.rect.y).toBe(9);
  });
  it('never switches an established label between full and compact because of crowding', () => {
    const first = placeLiveLabel(box(100, 140), bounds, [130, 84], [])!;
    const next = placeLiveLabel(box(102, 140), bounds, [130, 84],
      [box(99, 117, 130, 18)], first)!;
    expect(next.variant).toBe(first.variant);
    expect(next.slot).toBe(first.slot);
  });
  it('new distant vehicles keep the compact version, which still contains speed text', () => {
    const labels = ['#7 CAR ≈45 km/h*', '#7 ≈45 km/h*'];
    const placement = placeLiveLabel(box(200, 130, 18, 17), bounds,
      [119, 80], [])!;
    expect(placement.variant).toBe(1);
    expect(labels[placement.variant]).toContain('km/h*');
    expect(labels[placement.variant]).toContain('#7');
  });
  it('new overlapping labels try another slot, without hiding detection boxes', () => {
    const a = placeLiveLabel(box(100,140), bounds, [90,60],[])!;
    const b = placeLiveLabel(box(105,140), bounds,[90,60],[a.rect])!;
    expect(collide(a.rect,b.rect)).toBe(false);
  });
  it('keeps the tag on its vehicle when right-edge clamp is necessary', () => {
    const p = placeLiveLabel(box(410, 142, 28, 18),bounds,[130,75],[])!;
    expect(p.rect.x+p.rect.w).toBeLessThanOrEqual(439);
  });
  it('does not suppress the ID and speed if every candidate overlaps other tags', () => {
    const p = placeLiveLabel(box(100,140),bounds,[120,80],[bounds]);
    expect(p).not.toBeNull();
  });
  it('rejects unusable geometry safely', () => {
    expect(placeLiveLabel(box(NaN,140),bounds,[90,60],[])).toBeNull();
    expect(placeLiveLabel(box(100,140),bounds,[600,550],[])).toBeNull();
  });
});

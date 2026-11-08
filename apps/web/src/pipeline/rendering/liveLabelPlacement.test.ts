import { describe, expect, it } from 'vitest';
import { placeLiveLabel, type OverlayRect } from './liveLabelPlacement';

const viewport = { x: 20, y: 30, w: 420, h: 280 };
const box = (x: number, y: number, w = 80, h = 55): OverlayRect =>
  ({x, y, w, h});
const collision = (a: OverlayRect, b: OverlayRect) =>
  a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x &&
  a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;

describe('Live Analysis overlay label crowding', () => {
  it('puts the main label near the box with no overlap when there is space', () => {
    const p = placeLiveLabel(box(100, 140), viewport, [90, 55, 25], []);
    expect(p).not.toBeNull();
    expect(p!.variant).toBe(0);
    expect(p!.rect.x).toBeCloseTo(102);
    expect(p!.rect.y).toBeCloseTo(120);
  });
  it('places the next label elsewhere rather than printing text on top', () => {
    const first = placeLiveLabel(box(100, 140), viewport, [110, 70, 25], [])!;
    const second = placeLiveLabel(box(108, 139), viewport, [110, 70, 25], [first.rect]);
    expect(second).not.toBeNull();
    expect(collision(first.rect, second!.rect)).toBe(false);
  });
  it('prefers a shorter label for a distant tiny vehicle', () => {
    const result = placeLiveLabel(box(200, 130, 18, 17), viewport, [110, 46, 22], []);
    expect(result?.variant).toBe(1);
  });
  it('keeps labels fully inside the video viewport at edges', () => {
    for(const b of [box(21, 31, 50, 20),box(405, 288, 30, 18)]) {
      const p = placeLiveLabel(b, viewport, [100, 55, 23], []);
      if (!p) continue;
      expect(p.rect.x).toBeGreaterThanOrEqual(viewport.x);
      expect(p.rect.y).toBeGreaterThanOrEqual(viewport.y);
      expect(p.rect.x+p.rect.w).toBeLessThanOrEqual(viewport.x+viewport.w);
      expect(p.rect.y+p.rect.h).toBeLessThanOrEqual(viewport.y+viewport.h);
    }
  });
  it('suppresses labels when all nearby positions collide, without removing the box', () => {
    const p = placeLiveLabel(box(100, 140), viewport, [110, 70, 25],
      [box(20, 30, 420, 280)]);
    expect(p).toBeNull();
  });
  it('rejects invalid geometry and impossible label sizes', () => {
    expect(placeLiveLabel(box(NaN, 20),viewport,[90],[])).toBeNull();
    expect(placeLiveLabel(box(100,140),viewport,[500],[])).toBeNull();
  });
});

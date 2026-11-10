import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './Landing';

const renderLanding = () =>
  renderToStaticMarkup(<MemoryRouter><Landing /></MemoryRouter>);

describe('VisionGuard public landing experience', () => {
  it('offers the correct sign-in and registration destinations', () => {
    const html = renderLanding();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="#experience"');
    expect(html).toContain('href="#capabilities"');
    expect(html).toContain('href="#workflow"');
  });

  it('labels the sample video as a preview, never as live model output', () => {
    const html = renderLanding();
    expect(html).toContain('car-detection.mp4');
    expect(html).toContain('preload="none"');
    expect(html).toContain('SAMPLE FOOTAGE — NOT LIVE DETECTIONS');
    expect(html).toContain('NO TRACKS OR SPEEDS ARE GENERATED IN THIS PREVIEW');
    expect(html).toContain('Play sample traffic footage');
  });

  it('keeps calibration, storage choice, and human review limitations visible', () => {
    const html = renderLanding();
    expect(html).toContain('Image-derived speed values are approximations');
    expect(html).toContain('cloud backup requires explicit upload');
    expect(html).toContain('human review');
    expect(html).toContain('Detect');
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './Landing';

const renderLanding = () => renderToStaticMarkup(
  <MemoryRouter><Landing /></MemoryRouter>
);

describe('VisionGuard public landing experience', () => {
  it('keeps entry points and all internal navigation anchored to real sections', () => {
    const html = renderLanding();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="#platform"');
    expect(html).toContain('id="platform"');
    expect(html).toContain('href="#capabilities"');
    expect(html).toContain('id="capabilities"');
    expect(html).toContain('href="#workflow"');
    expect(html).toContain('id="workflow"');
  });

  it('shows a full-color traffic illustration and concise feature strip without old stage controls', () => {
    const html = renderLanding();
    expect(html).toContain('/signin_hero.jpg');
    expect(html).toContain('/traffic_flow_analysis.jpg');
    expect(html).toContain('Illustrative traffic scene');
    expect(html).toContain('vgn-feature-strip');
    expect(html).not.toContain('vgn-stage-tab');
    expect(html).not.toContain('/imagery/motorway-recording-frame.webp');
  });

  it('never displays a fake live dashboard, sample video player, or fabricated metrics', () => {
    const html = renderLanding();
    expect(html).toContain('Traffic camera overlooking a multilane highway');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('car-detection.mp4');
    expect(html).not.toContain('platform_preview.png');
    expect(html).not.toContain('fps');
  });

  it('explains the supported video sources without fake product metrics', () => {
    const html = renderLanding();
    expect(html).toContain('Recorded video');
    expect(html).toContain('Live camera');
    expect(html).toContain('Browser tab');
    expect(html).toContain('vgn-source-grid');
  });

  it('includes real reporting, browser architecture and accessible FAQ chapters', () => {
    const html = renderLanding();
    expect(html).toContain('id="records"');
    expect(html).toContain('id="technology"');
    expect(html).toContain('id="answers"');
    expect(html).toContain('YOLO11s');
    expect(html).toContain('PDF or CSV');
    expect(html).toContain('<details>');
    expect(html).toContain('uncalibrated optical estimates');
  });

  it('states speed, storage and human-review limitations rather than overstating accuracy', () => {
    const html = renderLanding();
    expect(html).toContain('Review flagged observations');
    expect(html).toContain('Cloud video backup requires explicit upload');
  });

  it('shows the same current logo and keeps the footer compact', () => {
    const html = renderLanding();
    expect(html.split('src="/brand-mark.svg?v=20261111"').length - 1).toBe(2);
    expect(html).toContain('vgn-footer');
    expect(html).not.toContain('vgn-footer-wordmark');
  });
});

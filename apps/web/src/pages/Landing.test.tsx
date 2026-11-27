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

  it('uses a product-led interactive stage with three accessible perspectives', () => {
    const html = renderLanding();
    expect(html).toContain('/imagery/traffic-night.webp');
    expect(html).toContain('/imagery/motorway-still.webp');
    expect(html).toContain('Explore the VisionGuard analysis workflow');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Observe');
    expect(html).toContain('Follow');
    expect(html).toContain('Review');
    expect(html).toContain('Illustrative workflow preview');
  });

  it('never displays a fake live dashboard, sample video player, or fabricated metrics', () => {
    const html = renderLanding();
    expect(html).toContain('Traffic and light trails');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('car-detection.mp4');
    expect(html).not.toContain('platform_preview.png');
    expect(html).not.toContain('fps');
  });

  it('states speed, storage and human-review limitations rather than overstating accuracy', () => {
    const html = renderLanding();
    expect(html).toContain('Review flagged observations');
    expect(html).toContain('Cloud video backup requires explicit upload');
  });

  it('shows the same current logo, keeps the footer compact, and has no ornamental arrow cards', () => {
    const html = renderLanding();
    expect(html.split('src="/brand-mark.svg?v=20261111"').length - 1).toBe(2);
    expect(html).toContain('vgn-footer');
    expect(html).not.toContain('vgn-footer-wordmark');
    const controls = html.match(/<button[^>]*class="vgn-stage-tab(?: vgn-stage-tab-active)?"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(controls).toHaveLength(3);
    expect(controls.every(tab => !tab.includes('lucide-arrow'))).toBe(true);
  });
});

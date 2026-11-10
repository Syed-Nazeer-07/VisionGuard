import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './Landing';

const renderLanding = () =>
  renderToStaticMarkup(<MemoryRouter><Landing /></MemoryRouter>);

describe('VisionGuard public landing page', () => {
  it('keeps sign-in, registration, and main section navigation working', () => {
    const html = renderLanding();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="#explore"');
    expect(html).toContain('href="#capabilities"');
    expect(html).toContain('href="#workflow"');
  });

  it('uses a multi-image gallery rather than a video or an old fake console screenshot', () => {
    const html = renderLanding();
    expect(html).toContain('traffic_operations_center.jpg');
    expect(html).toContain('traffic_flow_analysis.jpg');
    expect(html).toContain('traffic_monitoring_corridor.jpg');
    expect(html).toContain('landing_hero.jpg');
    expect(html).not.toContain('car-detection.mp4');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('platform_preview.png');
    expect(html).toContain('Illustrative scene — not live AI output');
    expect(html).toContain('Select a traffic perspective');
  });

  it('keeps storage, speed limitations, and human review disclosures accessible', () => {
    const html = renderLanding();
    expect(html).toContain('cloud originals require explicit upload');
    expect(html).toContain('not calibrated road-speed measurements');
    expect(html).toContain('human judgement');
  });

  it('uses the original logo and reserves directional arrows for navigation', () => {
    const html = renderLanding();
    expect(html.split('src="/brand-mark.svg"').length - 1).toBe(2);
    expect(html).not.toContain('vgx-info-arrow');
    expect(html).not.toContain('vgx-capability-arrow');
    const tabs = html.split('class="vgx-gallery-tab').slice(1);
    expect(tabs).toHaveLength(3);
    expect(tabs.every(tab => !tab.split('</button>')[0].includes('lucide-arrow'))).toBe(true);
  });

  it('uses compact footer branding without the old oversized wordmark', () => {
    const html = renderLanding();
    expect(html).toContain('vgx-footer');
    expect(html).not.toContain('vx-footer-wordmark');
    expect(html).toContain('AI-assisted analysis');
  });
});

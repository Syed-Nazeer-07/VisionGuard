import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ActivityDashboard } from './ActivityPages';

describe('browser-first operations overview', () => {
  const render = () => renderToStaticMarkup(
    <MemoryRouter initialEntries={['/app']}>
      <ActivityDashboard />
    </MemoryRouter>
  );

  it('puts a clear analysis action above the real-data metrics', () => {
    const html = render();
    expect(html).toContain('Every observation, in focus.');
    expect(html).toContain('VISIONGUARD / OPERATIONS OVERVIEW');
    expect(html).toContain('href="/app/analyze"');
    expect(html).toContain('Start an analysis');
    expect(html).toContain('Repeated vehicle tracks');
    expect(html).toContain('Inference frames');
  });

  it('does not present invented online status or fabricated session values', () => {
    const html = render();
    expect(html).toContain('Loading workspace');
    expect(html).toContain('Loading saved sessions');
    expect(html).not.toContain('Monitoring live');
    expect(html).not.toContain('System healthy');
  });
});

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ActivityDashboard, ActivityAnalytics, ActivityIncidents, ActivityVideoLibrary } from './ActivityPages';
import Settings from './Settings';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mount(element: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<MemoryRouter>{element}</MemoryRouter>));
  return {
    host,
    dispose: () => {
      act(() => root.unmount());
      host.remove();
    }
  };
}

describe('operations workspace interactions', () => {
  it('switches the analytics time range through accessible segmented controls', () => {
    const view = mount(<ActivityAnalytics />);
    try {
      const options = [...view.host.querySelectorAll<HTMLButtonElement>('.vg-range-option')];
      expect(options).toHaveLength(4);
      expect(options[0].getAttribute('aria-pressed')).toBe('true');
      act(() => options[2].click());
      expect(options[0].getAttribute('aria-pressed')).toBe('false');
      expect(options[2].getAttribute('aria-pressed')).toBe('true');
      expect(view.host.textContent).toContain('Classification breakdown');
    } finally { view.dispose(); }
  });

  it('allows searching session and cloud-video history with a native search field', () => {
    const view = mount(<ActivityVideoLibrary />);
    try {
      const search = view.host.querySelector<HTMLInputElement>('input[aria-label="Search saved videos and sessions"]');
      expect(search).not.toBeNull();
      expect(search?.type).toBe('search');
      act(() => {
        if (!search) return;
        search.value = 'highway footage';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(view.host.textContent).toContain('Analysis sessions');
      const sources = [...view.host.querySelectorAll<HTMLButtonElement>('.vg-history-filter button')];
      expect(sources).toHaveLength(3);
      act(() => sources[2].click());
      expect(sources[2].getAttribute('aria-pressed')).toBe('true');
      expect(sources[0].getAttribute('aria-pressed')).toBe('false');
    } finally { view.dispose(); }
  });

  it('filters incident reviews without changing saved data', () => {
    const view = mount(<ActivityIncidents />);
    try {
      const options = [...view.host.querySelectorAll<HTMLButtonElement>('.vg-filter-pill')];
      expect(options).toHaveLength(4);
      expect(options[0].getAttribute('aria-pressed')).toBe('true');
      act(() => options[1].click());
      expect(options[1].getAttribute('aria-pressed')).toBe('true');
      expect(view.host.textContent).toContain('Review queue');
    } finally { view.dispose(); }
  });

  it('keeps settings sections keyboard-addressable with one active tab', () => {
    const view = mount(<Settings />);
    try {
      const options = [...view.host.querySelectorAll<HTMLButtonElement>('.vg-settings-tab')];
      expect(options).toHaveLength(6);
      expect(options[0].getAttribute('aria-pressed')).toBe('true');
      act(() => options[1].click());
      expect(options[1].getAttribute('aria-pressed')).toBe('true');
      expect(view.host.querySelector('select[aria-label="Color theme"]')).not.toBeNull();
      act(() => options[2].click());
      expect(view.host.querySelector('#settings-start')).not.toBeNull();
      act(() => options[4].click());
      expect(view.host.textContent).toContain('Backblaze B2 upload is a separate');
      expect(view.host.querySelector('.vg-settings-save')).toBeNull();
      act(() => options[5].click());
      expect(view.host.textContent).toContain('uncalibrated estimates');
      expect(view.host.querySelector('.vg-settings-save')).toBeNull();
    } finally { view.dispose(); }
  });
});

it('uses one analysis action and links from real work sections', () => {
  const view = mount(<ActivityDashboard />);
  try {
    expect(view.host.querySelector('nav[aria-label="Quick access to workspace tools"]')).toBeNull();
    expect(view.host.querySelectorAll('a[href="/app/analyze"]')).toHaveLength(1);
    expect(view.host.querySelector('a[href="/app/cases"]')).not.toBeNull();
    expect(view.host.textContent).toContain('Recent sessions');
    expect(view.host.textContent).toContain('Review queue');
  } finally { view.dispose(); }
});

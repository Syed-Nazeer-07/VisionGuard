import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ActivityAnalytics, ActivityIncidents, ActivityVideoLibrary } from './ActivityPages';
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
      expect(view.host.textContent).toContain('Needs review');
    } finally { view.dispose(); }
  });

  it('keeps settings sections keyboard-addressable with one active tab', () => {
    const view = mount(<Settings />);
    try {
      const options = [...view.host.querySelectorAll<HTMLButtonElement>('.vg-settings-tab')];
      expect(options).toHaveLength(3);
      expect(options[0].getAttribute('aria-pressed')).toBe('true');
      act(() => options[1].click());
      expect(options[1].getAttribute('aria-pressed')).toBe('true');
      expect(view.host.querySelector('#settings-start')).not.toBeNull();
    } finally { view.dispose(); }
  });
});
